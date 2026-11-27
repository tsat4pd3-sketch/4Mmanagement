import { useState, useCallback, useMemo, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { getActor } from '../utils/actorStamp';
import { useLiveBoard } from '../utils/useLiveBoard';
import usePartImages from '../utils/usePartImages';
import { storeBtn } from '../utils/storeUi';
import { toneVar } from '../utils/statusTone';
import { allOf } from '../utils/filterLabels';
import FilterBar from './FilterBar';
import Segmented from './Segmented';
import SearchInput from './SearchInput';
import PartCard from './PartCard';
import StatusZones from './StatusZones';
import InfoMore from './InfoMore';
import { Link } from 'react-router-dom';
import {
  DEFAULT_STALE_MIN, receiptAgeMin, ageText, validateReceive, receiptZoneStatus, sortReceipts,
  groupReceipts, allocateFifo,
} from '../utils/stockReceipts';
import { mergeById } from '../utils/mergeRows';

import { tr } from '../utils/i18n';
/* ═══ 📥 คิวรอรับเข้าคลัง — ของที่ปิดใบผลิตแล้ว รอคนนับของจริงแล้วกดรับ (2026-10-02 · คำสั่ง user)

   ใครทำอะไร:  ไลน์ผลิตสแกนปิดใบ (ผู้ส่ง) → ใบเข้าคิวนี้อัตโนมัติ → คลังปลายทางนับของจริง (ผู้รับ)
              → ตรง = กดรับ · ไม่ตรง = กรอกยอดที่นับได้ + เหตุผล → สต็อกเข้าตามที่นับจริง
   · กฎ/สูตร = `utils/stockReceipts.js` · กดรับ = RPC `stock_receipt_confirm` (ธุรกรรมเดียว)
   · สิทธิ์กดรับ = `line_stock:issue` (คีย์เดียวกับการลงสต็อกมือ) — ไม่มีสิทธิ์ = ดูอย่างเดียว + เขียนบอก
   · ไม่ใช้ `select('*')` — คิวโตได้วันละ ~120 ใบ (กฎเหล็ก DB ข้อ 11)

   🧺 **โหมดกอง = ค่าตั้งต้น** (22/10 · คำสั่ง user) — ปิดใบผลิต 1 ใบ = ใบรอรับ 1 ใบ
      วัดจริง 22/10: `20058498` ค้าง **169 ใบ** ที่เส้นทางเดียวกันเป๊ะ ⇒ การ์ดต่อใบ = คิวตาย
      (ผลพวง: FG ติดลบ −630 เพราะขาขายหักออโต้ทัน แต่ขารับเข้าค้างคิว)
      🔴 **ยุบเพื่อ "กด" เท่านั้น ห้ามยุบการเก็บ** — RPC ปิดใบรายตัวพร้อม `qty_received` ของตัวเอง
         (user เคาะ "เก็บรายใบไว้ กางดูได้") · ปุ่ม "กางดู N ใบ" ต้องมีเสมอ
      🔴 ยอดไม่ตรง = ปัน **FIFO** ผ่าน `allocateFifo()` · ฝั่ง DB `stock_receipt_confirm_group`
         ใช้ตรรกะเดียวกันเป๊ะ — **แก้ข้างใดข้างหนึ่งต้องแก้อีกข้าง** */
const COLS = 'id, prod_order_id, prod_no, mat_no, part_name, qty_expected, dest_line_name, source_line, work_date, '
  + 'partial_reason, status, qty_received, diff_reason, received_by, received_at, created_at';

const ZONES = (withDone) => [
  { key: 'stale', statuses: ['stale'], label: '⏰ ค้างเกินกำหนด', color: 'var(--red)', hint: 'ปิดใบผลิตนานแล้วยังไม่มีใครรับ — ตามของก่อน' },
  { key: 'pending', statuses: ['pending'], label: 'รอรับเข้า', color: 'var(--amber)', hint: 'นับของจริง → ตรงกดรับ · ไม่ตรงกรอกยอดที่นับได้' },
  ...(withDone ? [{ key: 'received', statuses: ['received'], label: '✅ รับแล้ว (วันนี้)', color: 'var(--green)', hint: '' }] : []),
];
const hhmm = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${tr("น.")}` : null;
};
const fmt = (n) => Number(n || 0).toLocaleString();

/* 📋 19/11 (mockup รับของเข้าคลังที่ user เคาะ) — แถบกรองเดียว (คลังปลายทาง+ยอดค้างรายคลังบนปุ่ม · ต้นทาง · ค้นหา ·
   รวมกอง · ล้าง) → `banner` (แถบไลน์เรียกของ จากแม่) → ตัวเลขสรุป 4 ช่อง → ตาราง (`table`) · คำอธิบายพับหลัง ⓘ
   🔴 ห้ามพับ: คำเตือนไม่มีสิทธิ์รับ / โหลดไม่ครบ (InfoMore §ห้ามพับ) */
export default function StockReceiptQueue({ banner = null, table = false }) {
  const { role, fullName } = useContext(UserContext);
  const canReceive = can('line_stock', 'issue', role);
  const imgOf = usePartImages();
  const [rows, setRows] = useState([]);
  const [staleByDest, setStaleByDest] = useState({});
  const [loadErr, setLoadErr] = useState('');
  const [dest, setDest] = useState('');
  const [src, setSrc] = useState('');
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(null);
  const [diffFor, setDiffFor] = useState(null);       // ใบ/กองที่กำลังกรอก "ยอดไม่ตรง"
  const [form, setForm] = useState({ qty: '', reason: '' });
  const [byGroup, setByGroup] = useState(true);       // 🧺 ค่าตั้งต้น = รวมเป็นกอง
  const [openKey, setOpenKey] = useState(null);       // กองที่กางดูรายใบอยู่

  const load = useCallback(async () => {
    // รอรับทั้งหมด + รับแล้วใน 24 ชม. (โชว์เมื่อกด "รวมที่รับแล้ว")
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [pend, done, rules] = await Promise.all([
      supabaseDR.from('stock_receipts').select(COLS).eq('status', 'pending').order('created_at').limit(1000),
      supabaseDR.from('stock_receipts').select(COLS).eq('status', 'received').gte('received_at', since)
        .order('received_at', { ascending: false }).limit(300),
      supabaseDR.from('stock_inflow_rules').select('dest_line_name, stale_after_min'),
    ]);
    const err = pend.error || done.error;
    setLoadErr(err ? err.message : '');
    /* ใบที่ถูกกดรับ "ระหว่าง" 2 คิวรี (คิวนี้มีหลายเครื่องเปิดพร้อมกัน + realtime) เข้าเงื่อนไขทั้งคู่
       ⇒ คีย์ซ้ำ + ใบเดียวโผล่ทั้งแถวรอรับและรับแล้ว · ชุดหลัง (รับแล้ว) ชนะ — utils/mergeRows.js */
    setRows(mergeById(pend.data || [], done.data || []));
    const m = {};
    (rules.data || []).forEach(r => { m[r.dest_line_name] = Math.min(m[r.dest_line_name] ?? Infinity, r.stale_after_min || DEFAULT_STALE_MIN); });
    setStaleByDest(m);
  }, []);
  useLiveBoard(load, { tables: ['stock_receipts'], topic: 'stock-receipts' });

  const dests = useMemo(() => [...new Set(rows.map(r => r.dest_line_name))].sort(), [rows]);
  const staleOf = useCallback((r) => staleByDest[r.dest_line_name] ?? DEFAULT_STALE_MIN, [staleByDest]);
  const now = Date.now();
  const s = q.trim().toLowerCase();
  const shown = sortReceipts(rows.filter(r =>
    (showDone || r.status === 'pending')
    && (!dest || r.dest_line_name === dest)
    && (!src || r.source_line === src)
    && (!s || [r.prod_no, r.mat_no, r.part_name, r.source_line].some(v => String(v ?? '').toLowerCase().includes(s)))));
  const shownPending = shown.filter(r => r.status === 'pending');
  const inScope = (r) => (!dest || r.dest_line_name === dest) && (!src || r.source_line === src);
  const pendingCount = rows.filter(r => r.status === 'pending' && inScope(r)).length;
  const pendingQty = rows.filter(r => r.status === 'pending' && inScope(r))
    .reduce((a, r) => a + Number(r.qty_expected || 0), 0);
  const srcs = useMemo(() => [...new Set(rows.map(r => r.source_line).filter(Boolean))].sort(), [rows]);
  /* ตัวเลขสรุป — ชุดข้อมูลเดียวกับคิว (รอรับทั้งหมด + รับแล้ว 24 ชม.) · ตามตัวกรองคลัง/ต้นทาง */
  const staleCount = rows.filter(r => r.status === 'pending' && inScope(r) && receiptZoneStatus(r, staleOf, now) === 'stale').length;
  const recv24 = rows.filter(r => r.status === 'received' && inScope(r));
  const short24 = recv24.filter(r => Number(r.qty_received) < Number(r.qty_expected)).length;
  const groups = groupReceipts(shownPending);
  /* 🔴 นับแยกคลังเสมอ แม้กำลังกรองอยู่คลังเดียว (user เคาะ 22/10 "แยกตามปลายทาง")
     ไม่ขึ้นให้เห็น = คลังที่ไม่ได้เลือกดูกองค้างไปเรื่อยๆ โดยไม่มีใครรู้ว่าเป็นของตัวเอง */
  const destLoad = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (r.status !== 'pending') continue;
      const k = r.dest_line_name || '—';
      const c = m.get(k) || { slips: 0, pcs: 0 };
      c.slips += 1; c.pcs += Number(r.qty_expected) || 0;
      m.set(k, c);
    }
    return [...m.entries()].sort((a, b) => b[1].slips - a[1].slips);
  }, [rows]);

  const receive = async (r, qty, reason) => {
    const v = validateReceive({ expected: r.qty_expected, qty, reason });
    if (!v.ok) { toast.error(v.error); return false; }
    setBusy(r.id);
    const actor = getActor();
    const { error } = await supabaseDR.rpc('stock_receipt_confirm', {
      p_id: r.id, p_qty: Number(qty), p_reason: reason || null,
      p_by: fullName || actor.name || '', p_by_uid: actor.uid || null,
    });
    setBusy(null);
    if (error) { toast.error(`${tr("รับเข้าไม่สำเร็จ")} — ${error.message}`); load(); return false; }
    toast.success(Number(qty) === Number(r.qty_expected)
      ? `✅ ${tr("รับเข้า")} ${r.dest_line_name} · ${r.mat_no} +${fmt(qty)}`
      : `✅ ${tr("รับเข้า")} ${fmt(qty)} ${tr("จากใบ")} ${fmt(r.qty_expected)} (${reason})`);
    load();
    return true;
  };

  /* รับทั้งกอง — ปิดใบรายตัวฝั่ง DB (ธุรกรรมเดียว) ห้ามวนยิง RPC ใบเดียว 169 ครั้งจากจอ */
  const receiveGroup = async (g, qty, reason) => {
    const v = validateReceive({ expected: g.expected, qty, reason });
    if (!v.ok) { toast.error(v.error); return false; }
    const alloc = allocateFifo(g.slips, qty);
    setBusy(g.key);
    const actor = getActor();
    const { error } = await supabaseDR.rpc('stock_receipt_confirm_group', {
      p_ids: g.slips.map(x => x.id), p_qty: Number(qty), p_reason: reason || null,
      p_by: fullName || actor.name || '', p_by_uid: actor.uid || null,
    });
    setBusy(null);
    if (error) { toast.error(`${tr("รับเข้าไม่สำเร็จ")} — ${error.message}`); load(); return false; }
    toast.success(alloc.diff === 0
      ? `✅ ${tr("รับเข้า")} ${g.dest_line_name} · ${g.mat_no} +${fmt(alloc.got)} (${tr("ปิด")} ${g.count} ${tr("ใบ")})`
      : `✅ ${tr("รับเข้า")} ${fmt(alloc.got)} ${tr("จากใบรวม")} ${fmt(g.expected)} · ${tr("ปิด")} ${g.count} ${tr("ใบ")}`
        + (alloc.zeroed ? ` · ${alloc.zeroed} ${tr("ใบยังมาไม่ถึง (ได้")} 0)` : ''));
    load();
    return true;
  };

  /* สแกนเลขใบผลิตลงช่องค้นหาแล้วกด Enter = เจอใบเดียวที่ตรงเป๊ะ → รับเต็มจำนวนเลยไม่ได้
     (ต้องนับก่อน) ⇒ แค่เปิดช่องกรอกยอดของใบนั้นให้ ไม่กดรับแทนคน */
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const hit = rows.filter(r => r.status === 'pending' && String(r.prod_no || '').toLowerCase() === s);
    if (hit.length === 1) { setDiffFor(hit[0].id); setForm({ qty: String(hit[0].qty_expected), reason: '' }); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* UI-STANDARD §1: แท็บ → แถบกรอง ติดกัน (ห้ามมีคำอธิบายคั่น) · แถบระดับหน้า = แถบมาตรฐาน ไม่ใช่ `bare` (stdsweep 05/10: เดิมห่าง 48px) */}
      <FilterBar onClear={(dest || src || q || showDone) ? () => { setDest(''); setSrc(''); setQ(''); setShowDone(false); } : undefined} clearKeep={['store']}>
        {/* 🏬 ยอดค้างรายคลังอยู่บนปุ่มคลังเอง — เห็นเสมอแม้กรองอยู่คลังเดียว (user เคาะ 22/10 · คลังที่ไม่ได้เลือกดูห้ามค้างเงียบ) */}
        <Segmented value={dest} onChange={setDest} label={tr('คลังปลายทาง')}
          options={[{ value: '', label: allOf('คลัง') }, ...dests.map(d => {
            const c = destLoad.find(([n]) => n === d)?.[1];
            return { value: d, label: c ? `${d} · ${c.slips}` : d };
          })]} />
        <select value={src} onChange={e => setSrc(e.target.value)} aria-label={tr('ไลน์ต้นทาง')}>
          <option value="">{tr('ต้นทาง: ทุกไลน์')}</option>
          {srcs.map(x => <option key={x} value={x}>{tr('ต้นทาง:')} {x}</option>)}
        </select>
        <SearchInput value={q} onChange={setQ} fields={tr("เลขใบผลิต / MAT / ชื่อพาร์ท / ไลน์")} grow={false} onKeyDown={onSearchKey} />
        <button type="button" onClick={() => { setByGroup(v => !v); setDiffFor(null); setOpenKey(null); }}
          style={storeBtn(byGroup ? 'primary' : 'secondary', { minHeight: 36, padding: '6px 12px', fontSize: 12.5 })}>
          {byGroup ? tr('🧺 รวมเป็นกอง') : tr('📄 ทีละใบ')}
        </button>
        {!byGroup && (
          <button type="button" onClick={() => setShowDone(v => !v)} style={storeBtn('secondary', { minHeight: 36, padding: '6px 12px', fontSize: 12.5 })}>
            {showDone ? tr('⏳ เฉพาะที่รอรับ') : tr('✅ รวมที่รับแล้ว 24 ชม.')}
          </button>
        )}
        <span className="spacer" />
        <InfoMore label={tr('วิธีรับของ')}>
          {tr('📥 ไลน์สแกนปิดใบผลิตแล้ว ของถูกส่งมาที่คลังปลายทาง —')} <b>{tr('นับของจริงก่อน')}</b> {tr('ตรงกดรับ · ไม่ตรงกรอกยอดที่นับได้พร้อมเหตุผล ·')}
          {tr('สต็อกเข้าตามที่กดรับเท่านั้น')}
          {byGroup && <> · {tr('ยุบเป็น')} <b>{groups.length} {tr('กอง')}</b> {tr('(พาร์ท × ต้นทาง × ปลายทาง) — กดรับทั้งกองได้ แต่ระบบยังปิดใบรายตัวให้ครบ')}</>}
        </InfoMore>
      </FilterBar>

      {banner}

      {!canReceive && <div style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 700 }}>{tr('บัญชีนี้ไม่มีสิทธิ์รับเข้า (line_stock:issue) — ดูได้อย่างเดียว')}</div>}

      {/* ตัวเลขสรุป 4 ช่อง (mockup) — "รับแล้ว"/"รับไม่ครบ" = 24 ชม. ล่าสุดตามที่คิวนี้โหลดจริง ไม่ใช่ "วันนี้" */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {[
          { k: 'รอรับ', v: `${fmt(pendingCount)} ${tr("ใบ")}`, sub: `${fmt(pendingQty)} ${tr("ชิ้น")}` },
          { k: 'ค้างเกินกำหนด', v: `${fmt(staleCount)} ${tr("ใบ")}`, sub: 'ปิดใบนานแล้วยังไม่มีคนรับ', bad: staleCount > 0 },
          { k: 'รับแล้ว 24 ชม.', v: `${fmt(recv24.length)} ${tr("ใบ")}` },
          { k: 'รับไม่ครบ 24 ชม.', v: `${fmt(short24)} ${tr("ใบ")}`, link: short24 > 0 },
        ].map(c => (
          <div key={c.k} style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 12px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>{tr(c.k)}</div>
            <div style={{ fontSize: 21, fontWeight: 800, color: c.bad ? 'var(--red)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{c.v}</div>
            {c.sub && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr(c.sub)}</div>}
            {c.link && <Link to="/line-stock?tab=diff" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--blue)' }}>{tr('ไปที่ คลังพัก/ผลต่าง →')}</Link>}
          </div>
        ))}
      </div>

      {loadErr && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{tr('⚠ โหลดคิวไม่ครบ —')} {loadErr} {tr('· ตัวเลขบนจออาจขาด')}</div>}

      {byGroup && (groups.length === 0
        ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            {pendingCount === 0 && !loadErr ? tr("ไม่มีของรอรับเข้า — ใบที่ปิดแล้วรับครบหมด") : `${tr("ไม่มีใบที่ตรงตัวกรอง")}${q ? ` "${q}"` : ''}`}
          </div>
        : <StatusZones layout={table ? 'table' : 'cards'} rows={groups} zones={ZONES(false)} statusOf={g => receiptZoneStatus(g.slips[0], staleOf, now)} renderCard={g => {
            const oldest = g.slips[0];
            const age = receiptAgeMin(oldest, now);
            const stale = receiptZoneStatus(oldest, staleOf, now) === 'stale';
            const editing = diffFor === g.key;
            const open = openKey === g.key;
            /* พรีวิวการปัน — ให้คนเห็นก่อนกดว่าใบไหนจะได้ 0 (ไม่ใช่รู้ทีหลัง) */
            const prev = editing ? allocateFifo(g.slips, form.qty) : null;
            const nFull = prev ? prev.parts.filter(x => x.alloc > 0 && x.alloc >= x.expected).length : 0;
            const nPart = prev ? prev.parts.filter(x => x.alloc > 0 && x.alloc < x.expected).length : 0;
            return (
              <PartCard key={g.key} code={g.mat_no} name={g.part_name} img={imgOf(g.mat_no)} alert={stale}
                status={stale ? { label: tr('⏰ ค้าง'), color: toneVar('bad') } : { label: tr('📥 รอรับ'), color: toneVar('warn') }}
                metric={{ label: tr("ยอดตามใบผลิตรวม"), value: fmt(g.expected), unit: tr("ชิ้น") }}
                aside={{ label: tr("เข้าคลัง"), value: g.dest_line_name }}
                rows={[
                  { k: tr("จากไลน์"), v: g.source_line },
                  { k: tr("จำนวนใบ"), v: `${g.count} ${tr("ใบ")}` },
                  { k: tr("ค้างนานสุด"), v: `${ageText(age)} (${tr("ปิดใบ")} ${hhmm(oldest?.created_at) || '—'})` },
                ]}
                footer={
                  <div style={{ display: 'grid', gap: 8 }}>
                    {canReceive && (editing ? (
                      <>
                        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
                          {tr("ยอดที่นับได้จริงของทั้งกอง (ใบผลิตรวม")} {fmt(g.expected)})
                          <input type="number" min="0" inputMode="numeric" value={form.qty} autoFocus
                            onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                            style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', fontSize: 15, fontWeight: 800,
                              borderRadius: 'var(--radius)', border: '1px solid var(--border2)', background: 'var(--bg2-surf)', color: 'var(--text)', boxSizing: 'border-box' }} />
                        </label>
                        {prev && prev.diff !== 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6 }}>
                            {tr("ปันแบบ")} <b>{tr("ใบเก่าก่อน")}</b>: {nFull} {tr("ใบได้เต็ม")}{nPart ? ` · ${nPart} ${tr("ใบได้บางส่วน")}` : ''}
                            {prev.zeroed ? <> · <b style={{ color: toneVar('warn') }}>{prev.zeroed} {tr('ใบได้ 0')}</b> {tr('(ของยังมาไม่ถึง)')}</> : null}
                          </div>
                        )}
                        <input placeholder={tr('เหตุผล (บังคับเมื่อยอดไม่ตรง) เช่น ของเสีย 24 / ยังมาไม่ครบ')} value={form.reason}
                          onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                          style={{ padding: '8px 10px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border2)', background: 'var(--bg2-surf)', color: 'var(--text)' }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" disabled={busy === g.key} style={storeBtn('primary', { flex: 1 })}
                            onClick={async () => { if (await receiveGroup(g, form.qty, form.reason.trim())) setDiffFor(null); }}>
                            {busy === g.key ? tr("กำลังบันทึก…") : `✅ ${tr("รับเข้า")} ${form.qty === '' ? '' : fmt(form.qty)}`}
                          </button>
                          <button type="button" style={storeBtn('secondary')} onClick={() => setDiffFor(null)}>{tr("ยกเลิก")}</button>
                        </div>
                      </>
                    ) : (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" disabled={busy === g.key} style={storeBtn('primary', { flex: 1 })}
                          onClick={() => receiveGroup(g, g.expected, '')}>
                          {busy === g.key ? tr("กำลังบันทึก…") : `✅ ${tr("นับแล้วตรง · รับ")} ${fmt(g.expected)} (${g.count} ${tr("ใบ")})`}
                        </button>
                        <button type="button" style={storeBtn('secondary')}
                          onClick={() => { setDiffFor(g.key); setForm({ qty: String(g.expected), reason: '' }); }}>
                          ✏️ {tr("ยอดไม่ตรง")}
                        </button>
                      </div>
                    ))}
                    {/* 🔴 "กางดูรายใบ" ต้องมีเสมอ — ยุบเพื่อกด ไม่ใช่ยุบการเก็บ */}
                    <button type="button" style={storeBtn('secondary', { minHeight: 30, fontSize: 12 })}
                      onClick={() => setOpenKey(k => (k === g.key ? null : g.key))}>
                      {open ? tr("▲ ซ่อนรายใบ") : `▼ ${tr("กางดูรายใบ")} (${g.count} ${tr("ใบ")})`}
                    </button>
                    {open && (
                      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border2)', borderRadius: 'var(--radius)' }}>
                        {g.slips.map((x, i) => (
                          <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5,
                            padding: '5px 8px', borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                            <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {x.prod_no || '—'}{x.partial_reason ? ` · ${x.partial_reason}` : ''}
                            </span>
                            <span style={{ whiteSpace: 'nowrap' }}>{fmt(x.qty_expected)} {tr("ชิ้น")} · {hhmm(x.created_at) || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                } />
            );
          }} />)}

      {!byGroup && (shown.length === 0
        ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            {rows.length === 0 && !loadErr ? tr("ไม่มีของรอรับเข้า — ใบที่ปิดแล้วรับครบหมด") : `${tr("ไม่มีใบที่ตรงตัวกรอง")}${q ? ` "${q}"` : ''}`}
          </div>
        : <StatusZones layout={table ? 'table' : 'cards'} rows={shown} zones={ZONES(showDone)} statusOf={r => receiptZoneStatus(r, staleOf, now)} renderCard={r => {
            const age = receiptAgeMin(r, now);
            const pending = r.status === 'pending';
            const editing = diffFor === r.id;
            const stale = receiptZoneStatus(r, staleOf, now) === 'stale';
            return (
              <PartCard key={r.id} code={r.mat_no} name={r.part_name} img={imgOf(r.mat_no)} alert={stale}
                status={pending
                  ? (stale ? { label: '⏰ ค้าง', color: 'var(--red)' } : { label: 'รอรับ', color: 'var(--amber)' })
                  : { label: '✅ รับแล้ว', color: 'var(--green)' }}
                metric={{ label: pending ? 'ยอดตามใบผลิต' : 'รับเข้าจริง', value: fmt(pending ? r.qty_expected : r.qty_received), unit: tr("ชิ้น") }}
                aside={{ label: tr("เข้าคลัง"), value: r.dest_line_name }}
                dim={!pending}
                rows={[
                  { k: tr("จากไลน์"), v: r.source_line },
                  { k: tr("ใบผลิต"), v: r.prod_no },
                  { k: tr("ปิดใบ"), v: `${hhmm(r.created_at) || '—'} · ${ageText(age)} ${tr("ที่แล้ว")}` },
                  /* 19/11 — ใบคืนจากถังเหลือง (QA งานดี/ซ่อมผ่าน · trigger fn_qbin_return_receipt) เขียนเหตุผลเต็มประโยคมาเอง */
                  { k: tr("หมายเหตุ"), v: r.partial_reason ? (String(r.partial_reason).startsWith('คืนจาก') ? r.partial_reason : `${tr("ยอดบางส่วนจาก")}${r.partial_reason}`) : null },
                  { k: tr("ผู้รับ"), v: pending ? null : `${r.received_by || '—'} · ${hhmm(r.received_at) || ''}` },
                  { k: tr("ส่วนต่าง"), v: !pending && r.diff_reason ? `${fmt(r.qty_received - r.qty_expected)} — ${r.diff_reason}` : null },
                ]}
                footer={pending && canReceive ? (editing ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
                      {tr('ยอดที่นับได้จริง (ใบผลิต')} {fmt(r.qty_expected)})
                      <input type="number" min="0" inputMode="numeric" value={form.qty} autoFocus
                        onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                        style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', fontSize: 15, fontWeight: 800,
                          borderRadius: 'var(--ctl-r)', border: '1px solid var(--border2)', background: 'var(--bg2-surf)', color: 'var(--text)', boxSizing: 'border-box' }} />
                    </label>
                    <input placeholder={tr('เหตุผล (บังคับเมื่อยอดไม่ตรง) เช่น ของเสีย 5 / ยังมาไม่ครบ')} value={form.reason}
                      onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                      style={{ padding: '8px 10px', fontSize: 13, borderRadius: 'var(--ctl-r)', border: '1px solid var(--border2)', background: 'var(--bg2-surf)', color: 'var(--text)' }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" disabled={busy === r.id} style={storeBtn('primary', { flex: 1 })}
                        onClick={async () => { if (await receive(r, form.qty, form.reason.trim())) setDiffFor(null); }}>
                        {busy === r.id ? tr("กำลังบันทึก…") : `✅ ${tr("รับเข้า")} ${form.qty === '' ? '' : fmt(form.qty)}`}
                      </button>
                      <button type="button" style={storeBtn('secondary')} onClick={() => setDiffFor(null)}>{tr('ยกเลิก')}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" disabled={busy === r.id} style={storeBtn('primary', { flex: 1 })}
                      onClick={() => receive(r, r.qty_expected, '')}>
                      {busy === r.id ? tr("กำลังบันทึก…") : `✅ ${tr("นับแล้วตรง · รับ")} ${fmt(r.qty_expected)}`}
                    </button>
                    <button type="button" style={storeBtn('secondary')}
                      onClick={() => { setDiffFor(r.id); setForm({ qty: String(r.qty_expected), reason: '' }); }}>
                      ✏️ {tr("ยอดไม่ตรง")}
                    </button>
                  </div>
                )) : null} />
            );
          }} />)}
    </div>
  );
}
