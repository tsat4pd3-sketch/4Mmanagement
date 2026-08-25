/* ═══ ทะเบียนเคลมลูกค้า (Customer Claim Registry) — แท็บใน /qa ═══
   2026-08-17 · เฟส 3 ของลูปปิด 8D → PE · docs/CLOSED-LOOP-8D-PE.md

   ทำไมตัวนี้คุ้มสุด: ประวัติ revision ที่นำเข้าจากไฟล์จริงพิสูจน์ว่ากระบวนการจริงคือ
   **เคลม → แก้ FMEA → ออก rev** อยู่แล้ว แค่ยังไม่มีทะเบียนเคลมในระบบ
   ทำตัวเดียวปิด IATF §8.2.1 (สื่อสารลูกค้า) + §9.1.2 (ความพึงพอใจ) + §10.2 (corrective action)

   ⚠️ หัวใจที่ห้ามถอด: **ตรวจจับเคลมซ้ำ** — พาร์ทเดิม อาการคล้ายเดิม ภายใน 12 เดือน
      = 8D ครั้งก่อน "ไม่ได้ผลจริง" · เป็นการวัด effectiveness ที่ IATF §10.2.3 ต้องการ
      และเป็นสิ่งที่คนมองไม่เห็นเองเพราะเคลมแต่ละใบมาคนละเดือน */

import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { UserContext } from '../App';
import { nextDocNo } from '../utils/qaDocNo';
import { findRepeats, sureRepeats, REPEAT_MONTHS } from '../utils/peLink';

const STATUS = {
  open: { label: 'รับเรื่องแล้ว', color: '#ef4444' },
  investigating: { label: 'กำลังสอบสวน', color: '#f59e0b' },
  replied: { label: 'ตอบลูกค้าแล้ว', color: '#4d9fff' },
  closed: { label: 'ปิดเคลม', color: '#22c55e' },
};
const CATEGORY = { quality: 'คุณภาพ', delivery: 'การส่งมอบ', packaging: 'บรรจุภัณฑ์', warranty: 'รับประกัน', other: 'อื่นๆ' };
const SEVERITY = { minor: { label: 'เล็กน้อย', color: '#6b7280' }, major: { label: 'สำคัญ', color: '#f59e0b' }, critical: { label: 'วิกฤต', color: '#ef4444' } };

const inputSt = { width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 };
const thSt = { padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const tdSt = { padding: '8px 10px', fontSize: 12.5, color: 'var(--text2)', borderTop: '1px solid var(--border)', verticalAlign: 'top' };
const btnSt = (bg = 'var(--accent)', fg = '#08130a') => ({ padding: '7px 14px', borderRadius: 8, border: 'none', background: bg, color: fg, fontWeight: 800, fontSize: 12.5, cursor: 'pointer' });
const ghostBtn = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' };

const Chip = ({ label, color }) => (
  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, color, background: `${color}22`, border: `1px solid ${color}66`, whiteSpace: 'nowrap' }}>{label}</span>
);
const Field = ({ label, children, span }) => (
  <label style={{ display: 'block', gridColumn: span ? `span ${span}` : undefined }}>
    <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
    {children}
  </label>
);

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayAdd = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return localDate(d); };
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return localDate(d); };

const EMPTY = () => ({
  id: null, claim_no: '', claim_date: localDate(), customer: '', customer_ref: '',
  part_no: '', part_name: '', line_name: '', category: 'quality', severity: 'major',
  defect_desc: '', qty_claim: 0, qty_returned: 0, lot_ref: '',
  due_reply_date: dayAdd(localDate(), 3), reply_note: '', cost_impact: '', status: 'open', remark: '',
});

export default function QaClaims({ lines = [], canRecord, canManage, onOpenCapa }) {
  const { fullName } = useContext(UserContext);
  const [list, setList] = useState([]);
  const [filter, setFilter] = useState('active');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);   // ยังไม่ apply migration

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('qa_customer_claims')
      .select('*, qa_ncr(ncr_no, status), qa_capa(capa_no, status, pe_review_status)')
      .order('claim_date', { ascending: false }).limit(300);
    if (error) { setMissing(error.code === '42P01'); setList([]); return; }
    setMissing(false);
    setList(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = localDate();
  /* scope ตาม pattern มาตรฐาน — `lines` ที่ส่งมาถูกกรองตามสิทธิ์แล้ว (ไม่มี scope = ครบทุกไลน์ = no-op)
     เคลมที่ยังไม่ระบุไลน์ให้เห็นได้ทุกคน (เพิ่งรับเรื่อง ยังไม่รู้ว่าไลน์ไหนผลิต) */
  const scoped = useMemo(() => list.filter((c) => !c.line_name || lines.includes(c.line_name)), [list, lines]);
  const shown = useMemo(() => scoped.filter((c) => (
    filter === 'all' ? true : filter === 'closed' ? c.status === 'closed' : c.status !== 'closed'
  )), [scoped, filter]);

  const openList = scoped.filter((c) => c.status !== 'closed');
  const overdue = openList.filter((c) => c.due_reply_date && c.due_reply_date < today && !c.replied_at);
  /* เคลมซ้ำ — นับเป็นจำนวน "ใบที่มีของเก่าซ้ำ" ไม่ใช่จำนวนคู่ */
  /* แยก 2 ระดับ — ซ้ำแน่ (ข้อความตรง) vs อาจซ้ำ (ตรงแค่กลุ่มคำ) · ห้ามยุบรวม ดู findRepeats */
  const repMap = useMemo(() => {
    const m = new Map();
    for (const c of scoped) { const r = findRepeats(c, list); if (r.length) m.set(c.id, r); }
    return m;
  }, [scoped, list]);
  const sureIds = useMemo(() => new Set([...repMap].filter(([, r]) => sureRepeats(r).length).map(([id]) => id)), [repMap]);
  const maybeIds = useMemo(() => new Set([...repMap.keys()].filter((id) => !sureIds.has(id))), [repMap, sureIds]);

  const save = async (extra = {}, msg = 'บันทึกแล้ว ✓') => {
    const f = { ...detail, ...extra };
    if (!f.customer?.trim()) { toast.error('กรอกชื่อลูกค้า'); return null; }
    if (!f.defect_desc?.trim()) { toast.error('กรอกอาการที่ลูกค้าแจ้ง'); return null; }
    setBusy(true);
    const payload = {
      claim_date: f.claim_date, customer: f.customer.trim(), customer_ref: f.customer_ref?.trim() || null,
      part_no: f.part_no?.trim() || null, part_name: f.part_name?.trim() || null, line_name: f.line_name || null,
      category: f.category, severity: f.severity, defect_desc: f.defect_desc.trim(),
      qty_claim: Number(f.qty_claim) || 0, qty_returned: Number(f.qty_returned) || 0,
      lot_ref: f.lot_ref?.trim() || null, due_reply_date: f.due_reply_date || null,
      reply_note: f.reply_note?.trim() || null, cost_impact: f.cost_impact === '' ? null : Number(f.cost_impact),
      status: f.status, remark: f.remark?.trim() || null,
      ...(f.status === 'replied' && !f.replied_at ? { replied_at: new Date().toISOString() } : {}),
      ...(f.status === 'closed' && !f.closed_at ? { closed_at: new Date().toISOString(), closed_by: fullName || null } : {}),
    };
    let row, error;
    if (f.id) ({ data: row, error } = await supabase.from('qa_customer_claims').update(payload).eq('id', f.id).select('id').single());
    else {
      const claim_no = await nextDocNo('qa_customer_claims', 'claim_no', 'CLM');
      ({ data: row, error } = await supabase.from('qa_customer_claims').insert({ ...payload, claim_no, created_by: fullName || null }).select('id').single());
    }
    setBusy(false);
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return null; }
    toast.success(msg);
    setDetail(null); load();
    return row?.id || f.id;
  };

  /* เปิด 8D จากเคลม — สร้างใบ CAPA แล้วผูกกลับทันที (ไม่ปล่อยให้ผูกทีหลังแล้วลืม) */
  const openCapa = async (c) => {
    if (c.capa_id) { onOpenCapa?.({ _openId: c.capa_id }); return; }
    if (!canRecord) return;
    setBusy(true);
    const capa_no = await nextDocNo('qa_capa', 'capa_no', 'CAPA');
    const { data, error } = await supabase.from('qa_capa').insert({
      capa_no, ncr_id: c.ncr_id || null,
      title: `เคลมลูกค้า ${c.customer} — ${c.defect_desc.slice(0, 50)} (${c.claim_no})`,
      owner_name: fullName || null, part_no: c.part_no || null, line_name: c.line_name || null,
      d2_problem: `${c.defect_desc}\n(ลูกค้า: ${c.customer}${c.customer_ref ? ` · ref ${c.customer_ref}` : ''} · จำนวนเคลม ${c.qty_claim} ชิ้น)`,
      status: 'open', created_by: fullName || null,
    }).select('id').single();
    if (error) { setBusy(false); toast.error(error.message); return; }
    await supabase.from('qa_customer_claims').update({ capa_id: data.id, status: c.status === 'open' ? 'investigating' : c.status }).eq('id', c.id);
    setBusy(false);
    toast.success(`เปิด ${capa_no} จากเคลมนี้แล้ว`);
    load();
    onOpenCapa?.({ _openId: data.id });
  };

  if (missing) {
    return (
      <div style={{ padding: 22, textAlign: 'center', color: 'var(--muted)', fontSize: 13, border: '1px dashed var(--border2)', borderRadius: 12 }}>
        ยังไม่ได้ติดตั้งทะเบียนเคลมลูกค้า — แจ้ง admin ให้ apply migration <b>20260817_qa_customer_claims</b>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── สรุปสั้น: ตัวเลขที่ผู้จัดการถามก่อนเสมอ ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {[
          ['📮 เคลมที่ยังไม่ปิด', openList.length, openList.length ? '#f59e0b' : '#22c55e', 'ทั้งหมดในทะเบียน'],
          ['⏰ เลยกำหนดตอบ', overdue.length, overdue.length ? '#ef4444' : '#22c55e', 'ยังไม่ได้ตอบลูกค้า'],
          ['🔁 เคลมซ้ำ', sureIds.size, sureIds.size ? '#ef4444' : '#22c55e', maybeIds.size ? `+ อาจซ้ำอีก ${maybeIds.size} ใบ (ใน ${REPEAT_MONTHS} เดือน)` : `พาร์ท+อาการเดิมใน ${REPEAT_MONTHS} เดือน`],
          ['🛠 ผูก 8D แล้ว', scoped.filter((c) => c.capa_id).length, undefined, `จากทั้งหมด ${scoped.length} ใบ`],
        ].map(([label, val, color, sub]) => (
          <div key={label} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 13px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--text)' }}>{val}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{sub}</div>
          </div>
        ))}
      </div>

      {(sureIds.size > 0 || maybeIds.size > 0) && (
        <div style={{ padding: '9px 13px', borderRadius: 10, border: `1px solid ${sureIds.size ? '#ef444466' : '#f59e0b66'}`, background: sureIds.size ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)', fontSize: 12.5, lineHeight: 1.6 }}>
          {sureIds.size > 0 && <div style={{ color: '#ef4444' }}>
            🔁 <b>เคลมซ้ำ {sureIds.size} ใบ</b> — พาร์ทเดิม อาการเดิม กลับมาภายใน {REPEAT_MONTHS} เดือน
            <span style={{ color: 'var(--text2)' }}> · มาตรการจาก 8D ครั้งก่อน<b>ยังไม่ได้ผลจริง</b> — ทบทวนของเดิม อย่าเปิด 8D ใบใหม่ด้วยวิธีเดิม (IATF §10.2.3)</span>
          </div>}
          {maybeIds.size > 0 && <div style={{ color: '#f59e0b', marginTop: sureIds.size ? 5 : 0 }}>
            ❓ <b>อาจซ้ำอีก {maybeIds.size} ใบ</b>
            <span style={{ color: 'var(--text2)' }}> — พาร์ทเดิมและพูดถึงชิ้นส่วนเดียวกัน แต่ข้อความไม่ตรงพอจะฟันธง (เช่น "นัทไม่มี" กับ "นัทเชื่อมเยื้องศูนย์" คนละอาการ) <b>ต้องเปิดดูเอง</b></span>
          </div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['active', 'ยังไม่ปิด'], ['closed', 'ปิดแล้ว'], ['all', 'ทั้งหมด']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ ...ghostBtn, ...(filter === v ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {canRecord && <button style={btnSt()} onClick={() => setDetail(EMPTY())}>📮 รับเคลมใหม่</button>}
      </div>

      <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead style={{ background: 'var(--bg2)' }}>
            <tr>{['เลขเคลม', 'วันที่', 'ลูกค้า', 'พาร์ท', 'อาการ', 'จำนวน', 'กำหนดตอบ', 'สถานะ', 'งานแก้ไข'].map((h) => <th key={h} style={thSt}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const st = STATUS[c.status] || STATUS.open;
              const late = c.due_reply_date && c.due_reply_date < today && !c.replied_at && c.status !== 'closed';
              const sure = sureIds.has(c.id), maybe = maybeIds.has(c.id);
              return (
                <tr key={c.id} onClick={() => setDetail({ ...c, cost_impact: c.cost_impact ?? '' })} style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg3)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ ...tdSt, fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {c.claim_no}
                    {sure && <div><Chip label="🔁 ซ้ำ" color="#ef4444" /></div>}
                    {maybe && <div><Chip label="❓ อาจซ้ำ" color="#f59e0b" /></div>}
                  </td>
                  <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>{c.claim_date}</td>
                  <td style={tdSt}>{c.customer}{c.customer_ref && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>ref {c.customer_ref}</div>}</td>
                  <td style={tdSt}>{c.part_no || '—'}{c.line_name && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>🏭 {c.line_name}</div>}</td>
                  <td style={{ ...tdSt, maxWidth: 260 }}>{(c.defect_desc || '').slice(0, 70)}<div><Chip label={SEVERITY[c.severity]?.label} color={SEVERITY[c.severity]?.color} /> <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{CATEGORY[c.category]}</span></div></td>
                  <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>{c.qty_claim}{c.qty_returned ? ` / คืน ${c.qty_returned}` : ''}</td>
                  <td style={{ ...tdSt, whiteSpace: 'nowrap', color: late ? '#ef4444' : undefined, fontWeight: late ? 800 : undefined }}>
                    {c.due_reply_date || '—'}{late && <div style={{ fontSize: 10.5 }}>เลยกำหนด</div>}
                  </td>
                  <td style={tdSt}><Chip label={st.label} color={st.color} /></td>
                  <td style={tdSt}>
                    {c.qa_capa ? <Chip label={`🛠 ${c.qa_capa.capa_no}`} color={c.qa_capa.status === 'closed' ? '#22c55e' : '#f59e0b'} />
                      : <span style={{ fontSize: 11, color: '#ef4444' }}>ยังไม่มี 8D</span>}
                    {c.qa_ncr && <div style={{ marginTop: 3 }}><Chip label={`🚨 ${c.qa_ncr.ncr_no}`} color="#4d9fff" /></div>}
                  </td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={9} style={{ ...tdSt, textAlign: 'center', color: 'var(--muted)', padding: 26 }}>ยังไม่มีเคลมในช่วงนี้</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && <ClaimModal {...{ detail, setDetail, lines, canRecord, canManage, busy, save, openCapa, repeats: findRepeats(detail, list) }} />}
    </div>
  );
}

function ClaimModal({ detail, setDetail, lines, canRecord, canManage, busy, save, openCapa, repeats }) {
  const set = (k) => (e) => setDetail((f) => ({ ...f, [k]: e.target.value }));
  const ro = !canRecord || detail.status === 'closed';
  return (
    <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */ style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(980px, 100%)', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>📮 {detail.id ? detail.claim_no : 'รับเคลมลูกค้าใหม่'}</h3>

        {/* ⚠️ เคลมซ้ำ = 8D ก่อนหน้าไม่ได้ผล — ต้องเห็นก่อนเริ่มสอบสวน ไม่ใช่รู้ทีหลัง */}
        {repeats.length > 0 && (() => {
          const sure = repeats.filter((r) => r._sure);
          return (
            <div style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 10, border: `1px solid ${sure.length ? '#ef444466' : '#f59e0b66'}`, background: sure.length ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)', fontSize: 12.5, lineHeight: 1.65 }}>
              <b style={{ color: sure.length ? '#ef4444' : '#f59e0b' }}>
                {sure.length ? `🔁 เคลมซ้ำ — พาร์ทนี้เคยถูกเคลมด้วยอาการเดียวกันมาแล้ว ${sure.length} ครั้ง` : `❓ พาร์ทนี้เคยถูกเคลมเรื่องชิ้นส่วนเดียวกัน ${repeats.length} ครั้ง — ตรวจดูว่าอาการเดียวกันไหม`}
              </b>
              <div style={{ color: 'var(--text2)', marginTop: 4 }}>
                {repeats.slice(0, 4).map((r) => (
                  <div key={r.id}>{r._sure ? '🔁' : '❓'} {r.claim_date} · {r.claim_no} — {(r.defect_desc || '').slice(0, 60)}</div>
                ))}
              </div>
              {sure.length > 0 && (
                <div style={{ color: '#f59e0b', marginTop: 5 }}>
                  มาตรการจาก 8D ครั้งก่อน<b>ยังไม่ได้ผลจริง</b> — ทบทวนของเดิมก่อน อย่าเปิด 8D ใบใหม่ด้วยวิธีเดิม (IATF §10.2.3 effectiveness)
                </div>
              )}
            </div>
          );
        })()}

        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 11, marginBottom: 12 }}>
          <Field label="วันที่รับเคลม *"><input type="date" style={inputSt} value={detail.claim_date} onChange={set('claim_date')} disabled={ro} /></Field>
          <Field label="ลูกค้า *"><input style={inputSt} value={detail.customer} onChange={set('customer')} placeholder="เช่น FTM / AAT" disabled={ro} /></Field>
          <Field label="เลขเคลมฝั่งลูกค้า"><input style={inputSt} value={detail.customer_ref || ''} onChange={set('customer_ref')} placeholder="เช่น WLS6033" disabled={ro} /></Field>
          <Field label="กำหนดตอบกลับ"><input type="date" style={inputSt} value={detail.due_reply_date || ''} onChange={set('due_reply_date')} disabled={ro} /></Field>
          <Field label="เลขพาร์ท (กุญแจหาเอกสาร PFMEA)"><input style={inputSt} value={detail.part_no || ''} onChange={set('part_no')} placeholder="MB3B-8C306-BE" disabled={ro} /></Field>
          <Field label="ชื่อพาร์ท"><input style={inputSt} value={detail.part_name || ''} onChange={set('part_name')} disabled={ro} /></Field>
          <Field label="ไลน์ผลิต">
            <select style={inputSt} value={detail.line_name || ''} onChange={set('line_name')} disabled={ro}>
              <option value="">— ไม่ระบุ —</option>
              {lines.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="ประเภท">
            <select style={inputSt} value={detail.category} onChange={set('category')} disabled={ro}>
              {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="ความรุนแรง">
            <select style={inputSt} value={detail.severity} onChange={set('severity')} disabled={ro}>
              {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="จำนวนที่เคลม (ชิ้น)"><input type="number" style={inputSt} value={detail.qty_claim} onChange={set('qty_claim')} disabled={ro} /></Field>
          <Field label="จำนวนที่ส่งคืน"><input type="number" style={inputSt} value={detail.qty_returned} onChange={set('qty_returned')} disabled={ro} /></Field>
          <Field label="Lot / Invoice ที่อ้าง"><input style={inputSt} value={detail.lot_ref || ''} onChange={set('lot_ref')} disabled={ro} /></Field>
          <Field label="ค่าใช้จ่ายที่เกิด (บาท)"><input type="number" style={inputSt} value={detail.cost_impact} onChange={set('cost_impact')} placeholder="คัดแยก/ขนส่ง/ชดเชย" disabled={ro} /></Field>
        </div>

        <Field label="อาการที่ลูกค้าแจ้ง * (ข้อความนี้คือต้นทางที่ระบบใช้ค้น PFMEA/Control Plan)" span={2}>
          <textarea rows={3} style={{ ...inputSt, resize: 'vertical' }} value={detail.defect_desc} onChange={set('defect_desc')} disabled={ro} />
        </Field>
        <div style={{ height: 10 }} />
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 11 }}>
          <Field label="สรุปที่ตอบลูกค้า">
            <textarea rows={2} style={{ ...inputSt, resize: 'vertical' }} value={detail.reply_note || ''} onChange={set('reply_note')} disabled={ro} />
          </Field>
          <Field label="หมายเหตุ">
            <textarea rows={2} style={{ ...inputSt, resize: 'vertical' }} value={detail.remark || ''} onChange={set('remark')} disabled={ro} />
          </Field>
        </div>

        {detail.id && (
          <div style={{ marginTop: 14, padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>งานแก้ไข:</b>
            {detail.capa_id
              ? <><Chip label="🛠 มี 8D แล้ว" color="#22c55e" /><button style={ghostBtn} onClick={() => openCapa(detail)}>เปิดใบ 8D →</button></>
              : <>
                <span style={{ color: '#ef4444' }}>ยังไม่มี 8D — เคลมลูกค้าต้องมีการแก้ไขเป็นระบบเสมอ</span>
                {canRecord && <button style={btnSt('#f59e0b')} disabled={busy} onClick={() => openCapa(detail)}>🛠 เปิด 8D จากเคลมนี้</button>}
              </>}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>ในใบ 8D จะมีปุ่มให้ระบบค้น PFMEA/Control Plan ที่ต้องแก้ต่อ</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button style={ghostBtn} onClick={() => setDetail(null)}>ปิด</button>
          {!ro && <button style={btnSt('#f59e0b')} disabled={busy} onClick={() => save()}>💾 บันทึก</button>}
          {!ro && detail.id && detail.status !== 'replied' && (
            <button style={btnSt('#4d9fff', '#fff')} disabled={busy} onClick={() => {
              if (!detail.reply_note?.trim()) { toast.error('กรอกสรุปที่ตอบลูกค้าก่อน'); return; }
              save({ status: 'replied' }, 'บันทึกการตอบลูกค้าแล้ว ✓');
            }}>📤 บันทึกว่าตอบลูกค้าแล้ว</button>
          )}
          {canManage && detail.id && detail.status !== 'closed' && (
            <button style={btnSt('#22c55e')} disabled={busy} onClick={() => {
              /* ⚠️ ปิดเคลมโดยไม่มี 8D = ไม่มีหลักฐานว่าแก้อะไร — auditor จับข้อนี้แน่ */
              if (!detail.capa_id) { toast.error('ปิดเคลมไม่ได้ — ต้องเปิด 8D และดำเนินการแก้ไขก่อน'); return; }
              save({ status: 'closed' }, `ปิด ${detail.claim_no} แล้ว ✓`);
            }}>✅ ปิดเคลม</button>
          )}
        </div>
      </div>
    </div>
  );
}
