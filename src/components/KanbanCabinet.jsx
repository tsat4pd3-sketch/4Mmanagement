import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import QRCode from 'qrcode';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import NoticeBar from './NoticeBar';
import MatLabel from './MatLabel';
import LineSelect from './LineSelect';
import { can } from '../utils/permissions';
import { checkWriteRows, checkWrite } from '../utils/dbWrite';
import { canWriteLine, writeBlockText } from '../utils/writeScope';
import { loadLinesRes } from '../utils/useProductionLines';
import { sortLineNames } from '../utils/lineHierarchy';
import { buildQrPayload } from '../utils/qrCode';
import { fetchAllPages } from '../utils/fetchByIds';
import { CARD_STATES, nextCardState, canMoveCard, pickWalkOrder, cabinetSummary } from '../utils/kanbanCard';
import { tr } from '../utils/i18n';
import { askConfirm } from '../utils/askConfirm';

/* ══ 🎴 ตู้ e-Kanban — ใบคัมบังบนจอ แทนใบที่ต้องวนกลับสโตร์ (2026-11-25 · คำสั่ง user) ═══
   user: *"ไม่ต้องมีการส่งใบจริง ใช้การสแกนผ่านจอได้เลย"* · *"อยากลดการเดินของพนักงาน"*

   🔴 แทนเฉพาะ **ใบ PW KANBAN ที่วนกลับสโตร์** — **แท็ก one-way จาก SAP ที่ติดกล่อง ไม่แตะ**
     (บอกว่ากล่องนี้คือพาร์ทอะไร · ไปกับของ ไม่วนกลับ) ⇒ ห้ามทำป้ายติดกล่องชุดที่ 2

   2 มุมมองในแผงเดียว เพราะเป็นคนละงานของคนละคน:
     🏭 **มุมไลน์**  — ใบของไลน์ตัวเอง · กด "ใช้หมดแล้ว" = วางการ์ดขึ้นตู้ (ไม่ต้องเดินไปตู้จริง)
     🏬 **มุมสโตร์** — ใบในตู้ของ *ทุกไลน์* **เรียงตามโซนหยิบ** ⇒ เดินรอบเดียวครบ (ไม่ต้องเดินเก็บการ์ด)

   🔴 ตัวเลข/การตัดสินทุกตัวมาจาก `src/utils/kanbanCard.js` — ห้ามคิดเองในไฟล์นี้
   🔴 สิทธิ์: ไลน์กด = `wip_request:receive` · สโตร์กด = `wip_request:decide` (คีย์เดิม ไม่เพิ่มใหม่)
      + ชั้น ③ `canWriteLine()` **ในฟังก์ชันที่เขียน DB จริง** ไม่ใช่แค่ซ่อนปุ่ม
   📄 docs/modules/kanban-auto-calc.md §e-Kanban
   ══════════════════════════════════════════════════════════════════════════════ */

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 };
const btn = (bg, color = '#fff') => ({ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 700, background: bg, color, fontFamily: 'var(--font-body)' });
const n0 = (v) => (Number(v) || 0).toLocaleString();

/* ── ใบ e-kanban 1 ใบ — ช่องเดียวกับใบจริง (MAT · PART NO · QTY/PACK · FROM/TO · QR) ── */
function CardFace({ c, qr, onAct, acting, actLabel, canAct }) {
  const meta = CARD_STATES[c.state] || {};
  return (
    <div style={{ border: `2px solid ${meta.color || 'var(--border)'}`, borderRadius: 10, padding: 10,
      background: 'var(--bg2-surf)', display: 'grid', gap: 6, alignContent: 'start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <b style={{ fontSize: 13 }}>{c.card_no}</b>
        <span style={{ fontSize: 11, fontWeight: 700, color: meta.color || 'var(--muted)' }}>{tr(meta.label || c.state)}</span>
      </div>
      <MatLabel mat={c.mat_no} name={c.part_name} />
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
        {tr('ใบที่')} {c.seq}{c.total_cards ? `/${c.total_cards}` : ''} · {n0(c.qty_per_card)} {tr('ชิ้น/กล่อง')}
        <div>{c.from_location || tr('— ยังไม่ตั้งต้นทาง —')} → <b>{c.line_name}</b></div>
      </div>
      {/* 🔴 ระบบเสนอ คนตัดสิน — ข้อเสนอขึ้นเป็นข้อความ ไม่เปลี่ยนสถานะให้เอง */}
      {c.suggested_at && c.state === 'at_line' && (
        <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>
          🤖 {tr('ระบบเสนอว่าน่าจะหมดแล้ว')}{c.suggest_reason ? ` · ${c.suggest_reason}` : ''}
        </div>
      )}
      {qr && <img src={qr} alt={`QR ${c.card_no}`} width={88} height={88} style={{ alignSelf: 'center' }} />}
      {canAct && (
        <button type="button" disabled={acting} onClick={() => onAct(c)}
          style={{ ...btn(meta.color || 'var(--accent)'), opacity: acting ? 0.6 : 1 }}>
          {acting ? tr('กำลังบันทึก…') : actLabel}
        </button>
      )}
    </div>
  );
}

export default function KanbanCabinet({ role }) {
  const { fullName, section: homeSection, sections: mySections, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  const wctx = useMemo(() => ({ role, section: homeSection, sections: mySections, allUnits, respCostCenters, scopeIdx }),
    [role, homeSection, mySections, allUnits, respCostCenters, scopeIdx]);
  const canLine  = can('wip_request', 'receive', role);   // ไลน์: "ใช้หมดแล้ว" · "ถึงไลน์แล้ว"
  const canStore = can('wip_request', 'decide', role);    // สโตร์: รับคิว · ออกเดินส่ง

  const [view, setView] = useState('store');     // store = คิวหยิบรวม · line = ใบรายไลน์
  const [cards, setCards] = useState(null);      // null = ยังไม่รู้ (อ่านไม่ได้/ยังไม่โหลด) ห้ามแปลว่าว่าง
  const [lines, setLines] = useState([]);
  const [lineFilter, setLineFilter] = useState('');
  const [loadFail, setLoadFail] = useState('');
  const [qrs, setQrs] = useState({});
  const [acting, setActing] = useState('');

  const load = useCallback(async () => {
    const [cr, pl] = await Promise.all([
      fetchAllPages(() => supabaseDR.from('kanban_cards')
        .select('id, card_no, mat_no, line_name, from_location, qty_per_card, seq, total_cards, state, state_at, suggested_at, suggest_reason')
        .eq('is_active', true), { orderBy: ['line_name', 'mat_no', 'seq'] }),
      loadLinesRes(),
    ]);
    /* 🔴 ห้ามกลืน error — อ่านไม่ได้แล้วโชว์ "ไม่มีใบ" คือจอโกหก */
    if (cr.error || pl.error) { setLoadFail(String(cr.error || pl.error)); setCards(null); return; }
    setLoadFail(''); setCards(cr.rows); setLines(pl.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* QR ของใบ = ESM:K:<uuid> (ไม่ใช่เลขใบ — เลขใบเปลี่ยนได้ตอนทะเบียนปรับจำนวน) */
  useEffect(() => {
    let alive = true;
    const want = (cards || []).slice(0, 60);     // เพดานกันวาดทีละร้อยใบ
    (async () => {
      const out = {};
      for (const c of want) {
        if (qrs[c.id]) continue;
        try { out[c.id] = await QRCode.toDataURL(buildQrPayload('card', c.id), { width: 176, margin: 1 }); } catch { /* ป้ายวาดไม่ได้ = ไม่มีรูป ใบยังใช้ได้ */ }
      }
      if (alive && Object.keys(out).length) setQrs(q => ({ ...q, ...out }));
    })();
    return () => { alive = false; };
  }, [cards, qrs]);

  /* 🔴 ลิสต์ชื่อไลน์ผ่าน `sortLineNames` เท่านั้น — `.sort()` ดิบ = แต่ละหน้าเรียงคนละแบบ (มีด่าน) */
  const lineNames = useMemo(
    () => sortLineNames([...new Set((cards || []).map(c => c.line_name))].filter(Boolean), lines),
    [cards, lines]);
  /* ชื่อที่ไม่อยู่ในทะเบียนไลน์ (คลัง/ชื่อเก่า) ต้องยังเลือกได้ ไม่งั้นใบของมันเปิดไม่ขึ้น */
  const extraNames = useMemo(
    () => lineNames.filter(n => !lines.some(l => l.name === n)),
    [lineNames, lines]);

  const inBox = useMemo(() => (cards || []).filter(c => c.state === 'in_box'), [cards]);
  const walk  = useMemo(() => pickWalkOrder(inBox), [inBox]);
  const lineCards = useMemo(
    () => (lineFilter ? (cards || []).filter(c => c.line_name === lineFilter) : []),
    [cards, lineFilter]);
  const sum = useMemo(() => cabinetSummary(lineFilter ? lineCards : cards), [cards, lineCards, lineFilter]);

  /* ── เดินใบไปขั้นถัดไป ─────────────────────────────────────────────────────── */
  const advance = async (c) => {
    const to = nextCardState(c.state);
    const mv = canMoveCard(c.state, to);
    if (!mv.ok) { toast.error(mv.why); return; }
    /* 🔐 ชั้น ③ — ใบนี้เป็นของไลน์หน่วยงานเราไหม (เช็คตรงที่เขียน DB ไม่ใช่แค่ซ่อนปุ่ม) */
    const w = canWriteLine(wctx, c.line_name, lines);
    if (!w.ok) { toast.error(writeBlockText(w, { what: `${tr('ใบคัมบังของ')} ${c.line_name}` })); return; }
    if (!await askConfirm(`${tr('ย้ายใบ')} ${c.card_no} → ${tr(CARD_STATES[to]?.label || to)}?`
      + `\n${c.mat_no} · ${n0(c.qty_per_card)} ${tr('ชิ้น')} · ${c.line_name}`
      + `\n\n${tr('ในนาม')} ${fullName || '—'}`)) return;

    setActing(c.id);
    /* 🔴 compare-and-swap: ย้ายได้ต่อเมื่อใบยังอยู่สถานะเดิมจริง (คนอื่นอาจกดไปแล้ว)
       นับแถวด้วย — RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" */
    const moved = checkWriteRows(await supabaseDR.from('kanban_cards')
      .update({ state: to, state_by: fullName || null, updated_by_name: fullName || null,
        ...(to === 'in_box' ? {} : { suggested_at: null, suggest_reason: null }) })
      .eq('id', c.id).eq('state', c.state).select('id'), 'ย้ายใบคัมบัง');
    if (!moved) { setActing(''); load(); return; }
    /* ledger — ล้มก็ไม่ย้อนสถานะ แต่ต้องบอก ไม่ใช่เงียบ */
    checkWrite(await supabaseDR.from('kanban_card_events')
      .insert({ card_id: c.id, from_state: c.state, to_state: to, source: 'manual', by_name: fullName || null }),
      'บันทึกประวัติใบคัมบัง');
    setActing('');
    toast.success(`✅ ${c.card_no} → ${tr(CARD_STATES[to]?.label || to)}`);
    load();
  };

  const actOf = (c) => {
    const meta = CARD_STATES[c.state] || {};
    const isStoreStep = c.state === 'in_box' || c.state === 'picking';
    return { label: tr(meta.act || 'ถัดไป'), allowed: isStoreStep ? canStore : canLine };
  };

  /* ── จอ ─────────────────────────────────────────────────────────────────────── */
  if (loadFail) return (
    <div style={card}>
      <NoticeBar tone="bad"><b>{tr('อ่านใบคัมบังไม่ได้')}</b> · {tr('ยังบอกไม่ได้ว่ามีใบค้างกี่ใบ — ลองโหลดหน้าใหม่')}</NoticeBar>
    </div>
  );
  if (cards === null) return <div style={{ ...card, textAlign: 'center', color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</div>;

  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>🎴 {tr('ตู้ e-Kanban')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setView('store')}
              style={btn(view === 'store' ? 'var(--accent)' : 'var(--bg3)', view === 'store' ? '#fff' : 'var(--text)')}>
              🏬 {tr('คิวหยิบของสโตร์')}{walk.rows.length ? ` (${walk.rows.length})` : ''}
            </button>
            <button type="button" onClick={() => setView('line')}
              style={btn(view === 'line' ? 'var(--accent)' : 'var(--bg3)', view === 'line' ? '#fff' : 'var(--text)')}>
              🏭 {tr('ใบของไลน์')}
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginTop: 8 }}>
          {tr('ใบนี้แทน')} <b>{tr('ใบคัมบังที่ต้องวนกลับสโตร์')}</b> {tr('เท่านั้น — แท็ก one-way จาก SAP ที่ติดกล่องยังใช้เหมือนเดิม')}
        </div>
        {!cards.length && (
          <NoticeBar tone="info" style={{ marginTop: 10 }}>
            <b>{tr('ยังไม่มีใบคัมบังในระบบ')}</b> · {tr('ต้องออกใบจากทะเบียน kanban_standards ก่อน (จำนวนใบ + ชิ้นต่อใบ)')}
          </NoticeBar>
        )}
      </div>

      {view === 'store' ? (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
            🏬 {tr('คิวหยิบ — เรียงตามโซนเพื่อเดินรอบเดียว')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            {tr('ใบรอหยิบ')} <b>{walk.rows.length}</b> {tr('ใบ')} · {tr('กระจาย')} <b>{walk.zones}</b> {tr('โซน')}
            {sum?.oldestMin != null && <> · {tr('รอนานสุด')} <b>{n0(sum.oldestMin)}</b> {tr('นาที')}</>}
          </div>
          {walk.unknown > 0 && (
            <NoticeBar tone="warn" style={{ marginTop: 10 }}>
              <b>{walk.unknown} {tr('ใบยังไม่รู้โซนหยิบ')}</b> · {tr('อยู่ท้ายคิว — ตั้งต้นทางให้ใบพวกนี้ถึงจะจัดเส้นทางเดินได้ครบ')}
            </NoticeBar>
          )}
          {!walk.rows.length ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>{tr('ไม่มีใบรอหยิบ — ไลน์ยังไม่แจ้งว่าหมด')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              marginTop: 12, alignContent: 'start' }}>
              {walk.rows.map(c => {
                const a = actOf(c);
                return <CardFace key={c.id} c={c} qr={qrs[c.id]} onAct={advance} acting={acting === c.id}
                  actLabel={a.label} canAct={a.allowed} />;
              })}
            </div>
          )}
        </div>
      ) : (
        <div style={card}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>🏭 {tr('ใบของไลน์')}</div>
            {/* 🔴 ช่องเลือกไลน์ = picker กลาง `<LineSelect>` ห้ามวาด <select> เอง (UI §5.1.2) */}
            <LineSelect
              lines={lines} value={lineFilter} onChange={setLineFilter} role={role}
              placeholder={tr('— เลือกไลน์ —')}
              style={{ width: 260, padding: '6px 8px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border)',
                background: 'var(--bg2-surf)', color: 'var(--text)', fontSize: 13 }}
              extraGroups={extraNames.length ? [{ label: tr('อื่นๆ'), options: extraNames.map(n => ({ value: n })) }] : []}
            />
          </div>
          {!lineFilter ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('เลือกไลน์ก่อน แล้วใบของไลน์นั้นจะขึ้นให้ดู')}</div>
          ) : !lineCards.length ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('ไลน์นี้ยังไม่มีใบคัมบัง')}</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 10 }}>
                {tr('ทั้งหมด')} <b>{lineCards.length}</b> {tr('ใบ')} · {tr('อยู่ในตู้รอสโตร์')} <b>{sum?.waiting ?? '—'}</b>
                {sum?.suggested ? <> · 🤖 {tr('ระบบเสนอให้ถอด')} <b>{sum.suggested}</b> {tr('ใบ')}</> : null}
              </div>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', alignContent: 'start' }}>
                {lineCards.map(c => {
                  const a = actOf(c);
                  return <CardFace key={c.id} c={c} qr={qrs[c.id]} onAct={advance} acting={acting === c.id}
                    actLabel={a.label} canAct={a.allowed} />;
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
