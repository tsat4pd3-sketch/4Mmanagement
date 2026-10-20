/* ══════════════════════════════════════════════════════════════════════════════════════
   ใบขอซื้อ (PR) งานช่าง + ทะเบียนรหัส GL + เลขรัน PR   (2026-10-14 · MTN REQUEST)

   ชิ้นที่ export:
     · <MtnPrPanel order>    แผงในใบ MO — เส้นทางงานซ่อม + PR หลายใบต่อ 1 MO
     · <MtnPrBoard>          แผงในคลังอะไหล่ — อะไหล่ติด Min → เปิด PR · คิว PR ค้าง → สั่งแล้ว → รับของ
     · <MtnGlMaster>         ทะเบียนรหัส GL (⚙️ ข้อมูลหลัก)
     🔢 เลข PR = เลขจาก SAP ที่แอดมินช่างกรอก (19/10 · คำสั่ง user) — ระบบไม่ออกเลขเอง
        · ใบที่ยังไม่มีเลข = "⏳ รอเลข PR" โชว์เป็นคิวใน <MtnPrBoard> พร้อมลิงก์ไปใบ MO

   กฎ/สูตรอยู่ `src/utils/mtnPurchase.js` ที่เดียว · ตาราง DR (anon-open ตาม convention)
   🔴 รับของ = RPC `mtn_pr_receive` (สถานะ + เข้าสต็อกในทรานแซกชันเดียว) ห้ามเขียน 2 คำสั่งแยก
   🔴 ยกเลิก = status 'cancelled' + เหตุผล — ไม่มีปุ่มลบ (RLS ไม่เปิด DELETE)
   สิทธิ์: เปิด/กรอกเลข/สั่ง/รับ PR = `mtn_repair:service` · ทะเบียน GL = `mtn_repair:manage_master` (ไม่มีคีย์ใหม่)
   ══════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { fetchAllRows } from '../utils/fetchAllRows';
import { fetchByIds } from '../utils/fetchByIds';
import SearchSelect from './SearchSelect';
import SupplierSelect from './SupplierSelect';
import { fmtDateTime } from '../utils/dateFormat';
import {
  PR_STATUS_META, PR_SOURCE_LABEL, prStatusMeta, isPrOpen, REPAIR_PATHS, repairPathMeta,
  GL_CATEGORIES, glCategoryLabel, glCategoryForPr, defaultGlFor, isBelowMin, suggestReorderQty, openPrQtyByPart,
  normalizePrNo, isAwaitingPrNo, mosNeedingPr, NEEDS_PR_PATHS,
} from '../utils/mtnPurchase';
import { isMoOpen, MO_DONE_STATUSES } from '../utils/mtnStepPerm';
import { isMttrHeld, mttrHoldMin } from '../utils/mtnVendor';
import { notifyEvent } from '../utils/notifyEvent';
import { teamKeyOf, teamRowOwner, teamRowLockNote } from '../utils/mtnTeams';
import { can } from '../utils/permissions';

const inp = { width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5, boxSizing: 'border-box' };
const btnPri = { background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const box = { padding: '9px 11px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', marginBottom: 10 };

/** คอลัมน์ที่จอใช้ (egress — ห้าม select('*')) */
export const PR_COLS = 'id, pr_no, source, order_id, part_id, item_name, qty, unit, unit_price, amount, gl_category, gl_code, supplier, team, section, status, note, requested_at, requested_by, ordered_at, ordered_by, po_no, received_at, received_by, received_qty, cancelled_at, cancelled_by, cancel_reason';

/** ทะเบียน GL — คืน { rows, error } (ห้ามแกะเป็นอาร์เรย์ลอยๆ · กฎเหล็ก DB ข้อ 12) */
export async function loadGlCodes() {
  const { data, error } = await supabaseDR.from('mtn_gl_codes')
    .select('id, category, gl_code, name, note, is_default, is_active, sort_order')
    .eq('is_active', true).order('category').order('sort_order').order('gl_code');
  return { rows: data || [], error };
}

/** PR ของหลายใบ MO (export Excel) — chunk ผ่าน fetchByIds · คืน { byOrder, error } ห้ามกลืน error */
export async function loadPrsForOrders(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return { byOrder: {}, error: null };
  const { rows, error, truncated } = await fetchByIds(ids,
    (chunk) => supabaseDR.from('mtn_purchase_requests').select('order_id, pr_no, status').in('order_id', chunk));
  const byOrder = {};
  (rows || []).forEach(r => { (byOrder[r.order_id] || (byOrder[r.order_id] = [])).push(r); });
  return { byOrder, error: error ? (error.message || String(error)) : (truncated ? 'เลข PR เยอะเกินเพดาน — โหลดได้ไม่ครบ' : null) };
}

/** เลขใบ MO ของหลายใบขอซื้อ (คิวรอเลข PR · ลิงก์กลับไปใบ MO) — คืน { byId, error } */
async function loadMoNos(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return { byId: {}, error: null };
  const { rows, error } = await fetchByIds(ids, (chunk) => supabaseDR.from('mtn_orders').select('id, mo_no, machine_no, line_name').in('id', chunk));
  const byId = {};
  (rows || []).forEach(r => { byId[r.id] = r; });
  return { byId, error: error ? (error.message || String(error)) : null };
}

/** กรอก/แก้เลข PR จาก SAP — เลขเดียวกันผูกใบอื่นอยู่แล้ว = ถามยืนยัน (PR ใน SAP มีหลายรายการได้) ไม่บล็อก
 *  คืน true เมื่อบันทึกสำเร็จ · ล้ม = toast บอก ห้ามเงียบ */
async function savePrNo(pr, raw) {
  const no = normalizePrNo(raw);
  if (!no) { toast.error('ใส่เลข PR จาก SAP'); return false; }
  const dup = await supabaseDR.from('mtn_purchase_requests').select('id, order_id, item_name').eq('pr_no', no).neq('id', pr.id).neq('status', 'cancelled');
  if (dup.error) { toast.error(`ตรวจเลขซ้ำไม่สำเร็จ: ${dup.error.message} — ยังไม่ได้บันทึก`); return false; }
  if ((dup.data || []).length
    && !confirm(`เลข PR ${no} ผูกกับรายการอื่นอยู่แล้ว ${dup.data.length} รายการ (${dup.data.slice(0, 3).map(d => d.item_name).join(', ')}${dup.data.length > 3 ? ' …' : ''})\n\nPR ใน SAP ใบเดียวมีหลายรายการได้ — ยืนยันผูกเลขนี้ด้วย?`)) return false;
  return checkWriteRows(await supabaseDR.from('mtn_purchase_requests')
    .update({ pr_no: no, updated_at: new Date().toISOString() }).eq('id', pr.id).select('id'), 'บันทึกเลข PR');
}

/* ⏸️ ช่วงหยุดนับ MTTR (20/10 · คำสั่ง user) — เริ่มตอน MTN ตัดสินเส้นทาง · จบเมื่อพร้อมซ่อมต่อ
   สูตรหักอยู่ `techRepairMin()` (utils/mtnVendor.js) · downtime ของเครื่องไม่เกี่ยว (นับเต็ม) */

/** อะไหล่ของใบ "ซ่อมเอง+PR" รับครบแล้ว (ไม่เหลือ PR เปิด) ⇒ จบช่วงหยุด MTTR ให้เอง
 *  ใบ "ส่งภายนอก" ไม่จบที่นี่ (จบตอนของกลับจาก supplier / ช่างกดซ่อมต่อ) · ล้ม = toast ไม่กลืน */
async function endHoldIfPartsIn(orderId) {
  if (!orderId) return;
  const [o, open] = await Promise.all([
    supabaseDR.from('mtn_orders').select('id, repair_path, mttr_hold_from, mttr_hold_to').eq('id', orderId).maybeSingle(),
    supabaseDR.from('mtn_purchase_requests').select('id').eq('order_id', orderId).in('status', ['requested', 'ordered']),
  ]);
  if (o.error || open.error) { toast.error('ตรวจว่าอะไหล่ครบหรือยังไม่สำเร็จ — ถ้าครบแล้วกด "▶ กลับมาซ่อมต่อ" ในใบ MO'); return; }
  if (o.data?.repair_path !== 'inhouse_pr' || !isMttrHeld(o.data) || (open.data || []).length) return;
  if (checkWrite(await supabaseDR.from('mtn_orders').update({ mttr_hold_to: new Date().toISOString() })
    .eq('id', orderId).is('mttr_hold_to', null), 'จบช่วงหยุด MTTR')) toast.success('อะไหล่ครบแล้ว — เริ่มนับ MTTR ช่างต่อ');
}

/** แจ้งแอดมินช่าง (`mtn_pr_waiting` · ผู้รับตั้งที่ /notification-config) — fire-and-forget */
function notifyPrWaiting({ order, team, why, fullName }) {
  notifyEvent({
    event: 'mtn_pr_waiting', actor: fullName || undefined, team: teamKeyOf(team || order?.mtn_dept) || undefined,
    ref_table: 'mtn_orders', ref_id: order?.id,
    lines: [
      `🔧 ใบ ${order?.mo_no || '(ยังไม่ออกเลข)'} · ${order?.line_name || '-'}${order?.machine_no ? ` · ${order.machine_no}` : ''}`,
      why,
      '👉 กรอกเลข PR จาก SAP ที่คลังอะไหล่ → แผงใบขอซื้อ (PR)',
    ],
  });
}

function GlPicker({ category, value, glCodes, onChange }) {
  const rows = (glCodes || []).filter(g => !category || g.category === category);
  const others = (glCodes || []).filter(g => category && g.category !== category);
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} style={inp}>
      <option value="">— ยังไม่ระบุ GL —</option>
      {rows.map(g => <option key={g.id} value={g.gl_code}>{g.gl_code}{g.name ? ` · ${g.name}` : ''}{g.is_default ? ' (ตั้งต้น)' : ''}</option>)}
      {others.length > 0 && <optgroup label="หมวดอื่น">{others.map(g => <option key={g.id} value={g.gl_code}>{g.gl_code}{g.name ? ` · ${g.name}` : ''} · {glCategoryLabel(g.category)}</option>)}</optgroup>}
    </select>
  );
}

/* ── แถว PR หนึ่งใบ + ปุ่มเดินสถานะ (ใช้ทั้งในใบ MO และบอร์ดคลัง) ───────────────────── */
/* `own` = ผลด่านชั้น ③ ฝั่งช่าง (แกน "ทีม") — ส่งมาจากบอร์ดคลัง · ในใบ MO ไม่ส่ง = `{ ok: true }`
   (อยู่ในใบของทีมตัวเองอยู่แล้ว และผ่านด่านขั้น/ฝั่งของใบนั้นมาก่อน) */
function PrRow({ pr, canEdit, fullName, onChanged, showSource, mo = null, own = { ok: true } }) {
  const st = prStatusMeta(pr.status);
  const waitNo = isAwaitingPrNo(pr);
  const [mode, setMode] = useState(null);         // 'prno' | 'order' | 'receive' | 'cancel'
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  /* 🔴 เช็คซ้ำในฟังก์ชันที่เขียนจริงทุกตัว — ซ่อนปุ่มอย่างเดียวไม่ใช่ด่าน (QC audit 20/10)
     ใบ PR ของทีมอื่น: รับของเข้า = ขยับสต็อกคลังของทีมนั้น · ยกเลิก = ลบงานเขาแบบ soft */
  const ownBlock = () => { if (own.ok) return false; toast.error(teamRowLockNote(pr, own.code)); return true; };
  const doPrNo = () => run(async () => { if (ownBlock()) return; if (await savePrNo(pr, val)) { toast.success(`บันทึกเลข PR ${normalizePrNo(val)}`); setMode(null); onChanged?.(); } });
  const doOrder = () => run(async () => {
    if (ownBlock()) return;
    const ok = checkWriteRows(await supabaseDR.from('mtn_purchase_requests')
      .update({ status: 'ordered', ordered_at: new Date().toISOString(), ordered_by: fullName || null, po_no: val.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', pr.id).eq('status', 'requested').select('id'), 'บันทึกสั่งซื้อ',
      { zeroMsg: 'ใบนี้ถูกเปลี่ยนสถานะไปแล้ว (มีคนกดก่อน) — โหลดใหม่' });
    if (ok) { toast.success('บันทึก "สั่งแล้ว"'); setMode(null); onChanged?.(); }
  });
  const doReceive = () => run(async () => {
    if (ownBlock()) return;
    const q = Number(val);
    if (!(q > 0)) return toast.error('ใส่จำนวนที่รับจริง');
    const { data, error } = await supabaseDR.rpc('mtn_pr_receive', { p_id: pr.id, p_qty: q, p_by_name: fullName || null });
    if (error) return toast.error(`รับของไม่สำเร็จ: ${error.message}`);
    toast.success(pr.part_id ? `รับของแล้ว — สต็อกคงเหลือ ${data}` : 'รับของแล้ว (ไม่ผูกอะไหล่ในทะเบียน — ไม่มีสต็อกให้เข้า)');
    await endHoldIfPartsIn(pr.order_id);
    setMode(null); onChanged?.();
  });
  const doCancel = () => run(async () => {
    if (ownBlock()) return;
    if (!val.trim()) return toast.error('ใส่เหตุผลที่ยกเลิก');
    const ok = checkWriteRows(await supabaseDR.from('mtn_purchase_requests')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: fullName || null, cancel_reason: val.trim(), updated_at: new Date().toISOString() })
      .eq('id', pr.id).in('status', ['requested', 'ordered']).select('id'), 'ยกเลิก PR',
      { zeroMsg: 'ใบนี้รับของ/ยกเลิกไปแล้ว — โหลดใหม่' });
    if (ok) { toast.success('ยกเลิก PR แล้ว'); setMode(null); onChanged?.(); }
  });

  return (
    <div style={{ padding: '7px 9px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', borderLeft: `4px solid ${st.color}`, marginBottom: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
        {pr.pr_no
          ? <b style={{ fontFamily: 'monospace', fontSize: 13 }}>PR {pr.pr_no}</b>
          : <b style={{ fontSize: 12, color: waitNo ? '#f59e0b' : 'var(--muted)' }}>{waitNo ? '⏳ รอเลข PR จาก SAP' : '(ไม่มีเลข PR)'}</b>}
        {mo && <a href={`/mtn-repair?mo=${encodeURIComponent(mo.id)}`} style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 700 }} title="เปิดใบ MO">🔧 {mo.mo_no || 'ใบ MO (ยังไม่มีเลข)'}{mo.machine_no ? ` · ${mo.machine_no}` : ''}</a>}
        <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>
        {showSource && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{PR_SOURCE_LABEL[pr.source] || pr.source}</span>}
        <span style={{ flex: 1, minWidth: 140 }}>{pr.item_name} × <b>{pr.qty}</b> {pr.unit || ''}</span>
        {pr.gl_code
          ? <span style={{ fontSize: 11, color: 'var(--text2)' }}>GL {pr.gl_code}</span>
          : <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ ยังไม่ระบุ GL</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
        ขอ {fmtDateTime(pr.requested_at)}{pr.requested_by ? ` · ${pr.requested_by}` : ''}
        {pr.supplier ? ` · ผู้ขาย ${pr.supplier}` : ''}
        {pr.ordered_at ? ` · สั่ง ${fmtDateTime(pr.ordered_at)}${pr.po_no ? ` (PO ${pr.po_no})` : ''}` : ''}
        {pr.received_at ? ` · รับ ${fmtDateTime(pr.received_at)} ${pr.received_qty ?? ''} ${pr.unit || ''}${pr.received_by ? ` โดย ${pr.received_by}` : ''}` : ''}
        {pr.cancelled_at ? ` · ยกเลิก: ${pr.cancel_reason || '-'}` : ''}
        {!pr.part_id && pr.status !== 'cancelled' ? ' · ไม่ผูกอะไหล่ในทะเบียน (รับแล้วไม่เข้าสต็อก)' : ''}
        {pr.note ? ` · ${pr.note}` : ''}
      </div>
      {/* 🔒 ไม่ใช่ของทีมเรา = เขียนบอกเหตุผล **ห้ามซ่อนปุ่มเงียบ** (กฎความซื่อสัตย์ของจอ) */}
      {canEdit && isPrOpen(pr) && !own.ok && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>🔒 {teamRowLockNote(pr, own.code)}</div>
      )}
      {canEdit && own.ok && isPrOpen(pr) && !mode && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => { setVal(pr.pr_no || ''); setMode('prno'); }}
            style={waitNo ? { ...btnGhost, color: '#f59e0b', borderColor: '#f59e0b', fontWeight: 800 } : btnGhost}>{waitNo ? '✏️ กรอกเลข PR (SAP)' : '✏️ แก้เลข PR'}</button>
          {pr.status === 'requested' && <button disabled={busy} onClick={() => { setVal(''); setMode('order'); }} style={{ ...btnGhost, color: '#0ea5e9', borderColor: '#0ea5e9' }}>🚚 สั่งแล้ว</button>}
          <button disabled={busy} onClick={() => { setVal(String(pr.qty ?? '')); setMode('receive'); }} style={{ ...btnGhost, color: '#22c55e', borderColor: '#22c55e' }}>📥 รับของเข้า</button>
          <button disabled={busy} onClick={() => { setVal(''); setMode('cancel'); }} style={{ ...btnGhost, color: 'var(--muted)' }}>✖ ยกเลิก</button>
        </div>
      )}
      {mode && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input autoFocus value={val} onChange={e => setVal(e.target.value)} type={mode === 'receive' ? 'number' : 'text'} min={mode === 'receive' ? 0 : undefined}
            placeholder={mode === 'prno' ? 'เลข PR จาก SAP' : mode === 'order' ? 'เลข PO (ถ้ามี)' : mode === 'receive' ? 'จำนวนที่รับจริง' : 'เหตุผลที่ยกเลิก (บังคับ)'}
            onKeyDown={e => { if (e.key === 'Enter' && mode === 'prno') doPrNo(); }}
            style={{ ...inp, flex: 1, minWidth: 150, ...(mode === 'prno' ? { fontFamily: 'monospace', fontWeight: 700 } : {}) }} />
          <button disabled={busy} onClick={mode === 'prno' ? doPrNo : mode === 'order' ? doOrder : mode === 'receive' ? doReceive : doCancel} style={btnPri}>
            {busy ? 'กำลังบันทึก…' : mode === 'prno' ? 'บันทึกเลข PR' : mode === 'order' ? 'ยืนยันสั่งแล้ว' : mode === 'receive' ? (pr.part_id ? 'รับ + เข้าสต็อก' : 'ยืนยันรับ') : 'ยืนยันยกเลิก'}
          </button>
          <button onClick={() => setMode(null)} style={btnGhost}>ปิด</button>
        </div>
      )}
    </div>
  );
}

/* ── ฟอร์มเปิด PR ใหม่ ─────────────────────────────────────────────────────────────── */
function NewPrForm({ parts = [], glCodes = [], defaults = {}, fullName, onDone, onCancel }) {
  const [f, setF] = useState(() => ({
    part_id: defaults.part_id || '', item_name: defaults.item_name || '', qty: defaults.qty ?? '', unit: defaults.unit || '',
    unit_price: defaults.unit_price ?? '', supplier: defaults.supplier || '', note: '', pr_no: '',
    gl_category: defaults.gl_category || glCategoryForPr({ partId: defaults.part_id, repairPath: defaults.repairPath }),
    gl_code: '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  // GL ตั้งต้นตามหมวด — เติมเฉพาะตอนช่องยังว่าง (ไม่ทับที่คนเลือก)
  useEffect(() => {
    setF(p => (p.gl_code ? p : { ...p, gl_code: defaultGlFor(p.gl_category, glCodes)?.gl_code || '' }));
  }, [f.gl_category, glCodes]);
  const partOpts = useMemo(() => (parts || []).map(p => ({
    id: p.id, title: p.name, code: p.code || p.mat_no || '', sub: `คงเหลือ ${p.stock_qty ?? 0} ${p.unit || ''}${p.shelf ? ` · ${p.shelf}` : ''}`,
    keywords: [p.code, p.mat_no, p.part_no, p.shelf].filter(Boolean).join(' '), label: p.name,
  })), [parts]);

  const save = async () => {
    const qty = Number(f.qty);
    if (!f.item_name.trim()) return toast.error('ระบุรายการที่ขอซื้อ');
    if (!(qty > 0)) return toast.error('จำนวนต้องมากกว่า 0');
    setBusy(true);
    try {
      const price = f.unit_price === '' ? null : Number(f.unit_price);
      // uid ของคนเปิดใบ (Main auth) — best-effort: ไม่ได้ = null ไม่ล้มทั้งใบ
      const uid = await supabase.auth.getUser().then(r => r?.data?.user?.id || null).catch(() => null);
      const row = {
        source: defaults.source || 'mo', order_id: defaults.order_id || null, part_id: f.part_id || null,
        item_name: f.item_name.trim(), qty, unit: f.unit || null, unit_price: price,
        amount: price != null && Number.isFinite(price) ? price * qty : null,
        gl_category: f.gl_category || null, gl_code: f.gl_code || null, supplier: f.supplier || null,
        team: defaults.team || null, section: defaults.section || null, note: f.note.trim() || null,
        requested_by: fullName || null, requested_by_uid: uid,
        pr_no: normalizePrNo(f.pr_no),   // เลขจาก SAP — ว่างได้ (แอดมินช่างกรอกทีหลังจากคิว "รอเลข PR")
      };
      const { error } = await supabaseDR.from('mtn_purchase_requests').insert(row);
      if (error) return toast.error(`บันทึกใบขอซื้อไม่สำเร็จ: ${error.message}`);
      toast.success(row.pr_no ? `บันทึกใบขอซื้อ PR ${row.pr_no} แล้ว` : 'บันทึกใบขอซื้อแล้ว — แจ้งแอดมินช่างกรอกเลข PR จาก SAP');
      if (!row.pr_no) notifyPrWaiting({ order: defaults.order || { id: row.order_id }, team: row.team, fullName,
        why: `🛒 ขอซื้อ "${row.item_name}" × ${row.qty}${row.unit ? ` ${row.unit}` : ''} — รอเลข PR จาก SAP` });
      onDone?.();
    } finally { setBusy(false); }
  };

  return (
    <div style={{ ...box, background: 'var(--card)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 2 }}>🛒 ขอซื้อ (PR) ใหม่</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>เลข PR มาจาก SAP — รู้แล้วกรอกเลย ไม่รู้เว้นว่าง ใบจะเข้าคิว “⏳ รอเลข PR” ให้แอดมินช่างกรอกทีหลัง</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>อะไหล่ในทะเบียน (เลือก = รับของแล้วเข้าสต็อกให้เอง · พิมพ์เอง = ของนอกทะเบียน/งานบริการ)</div>
      <SearchSelect value={f.part_id} text={f.item_name} options={partOpts} allowFree freeHint="ไม่เข้าสต็อก"
        placeholder="ค้นอะไหล่ — ชื่อ / รหัส / ชั้นวาง หรือพิมพ์รายการเอง"
        onChange={({ id, text }) => {
          const p = (parts || []).find(x => x.id === id);
          setF(o => ({ ...o, part_id: id || '', item_name: text || '', unit: p?.unit ?? o.unit, unit_price: p?.unit_price ?? o.unit_price,
            supplier: o.supplier || p?.supplier || '', gl_category: glCategoryForPr({ partId: id, repairPath: defaults.repairPath }), gl_code: '' }));
        }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginTop: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>จำนวน<input type="number" min="0" value={f.qty} onChange={e => set('qty', e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>หน่วย<input value={f.unit} onChange={e => set('unit', e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>ราคา/หน่วย (บาท)<input type="number" min="0" value={f.unit_price} onChange={e => set('unit_price', e.target.value)} style={inp} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6, marginTop: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>หมวด GL
          <select value={f.gl_category} onChange={e => setF(p => ({ ...p, gl_category: e.target.value, gl_code: '' }))} style={inp}>
            {GL_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>รหัส GL<GlPicker category={f.gl_category} value={f.gl_code} glCodes={glCodes} onChange={v => set('gl_code', v)} /></label>
      </div>
      {!glCodes.length && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚠ ทะเบียนรหัส GL ยังว่าง — เพิ่มที่ /mtn-repair → ⚙️ ข้อมูลหลัก → 💳 รหัส GL (PR ยังเปิดได้ เติม GL ทีหลัง)</div>}
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>ผู้ขาย / ผู้รับจ้าง (ถ้ารู้)</div>
        <SupplierSelect value={f.supplier} onChange={res => set('supplier', res.supplier || '')} placeholder="ค้นชื่อผู้ขาย — พิมพ์เองได้" inputStyle={{ background: 'var(--bg)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6, marginTop: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>เลข PR จาก SAP (ว่างได้)<input value={f.pr_no} onChange={e => set('pr_no', e.target.value)} placeholder="เช่น 10002345" style={{ ...inp, fontFamily: 'monospace', fontWeight: 700 }} /></label>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>หมายเหตุ<input value={f.note} onChange={e => set('note', e.target.value)} placeholder="สเปก / ด่วน / เหตุผล" style={inp} /></label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onCancel} style={btnGhost}>ยกเลิก</button>
        <button disabled={busy} onClick={save} style={btnPri}>{busy ? 'กำลังบันทึก…' : '🛒 บันทึกใบขอซื้อ'}</button>
      </div>
    </div>
  );
}

/* ══ แผงในใบ MO ════════════════════════════════════════════════════════════════════════ */
export function MtnPrPanel({ order, parts = [], fullName, canEdit = false, teamKey = null, onOrderChanged }) {
  const [prs, setPrs] = useState([]);
  const [glCodes, setGlCodes] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState(order?.repair_path || '');
  const orderId = order?.id;
  useEffect(() => { setPath(order?.repair_path || ''); }, [order?.repair_path]);

  const load = useCallback(async () => {
    if (!orderId) return;
    const [r, g] = await Promise.all([
      supabaseDR.from('mtn_purchase_requests').select(PR_COLS).eq('order_id', orderId).order('requested_at'),
      loadGlCodes(),
    ]);
    setLoadErr(r.error?.message || null);
    setPrs(r.data || []); setGlCodes(g.rows);
  }, [orderId]);
  useEffect(() => {
    let alive = true;
    (async () => { if (alive) await load(); })();
    return () => { alive = false; };
  }, [load]);

  /* ⏸️ MTN ตัดสินเส้นทาง = จุดเริ่มหยุด MTTR (20/10 · คำสั่ง user)
       · เลือก "ซ่อมเอง+PR" / "ส่งภายนอก" ครั้งแรก → mttr_hold_from = ตอนนี้
       · เปลี่ยนกลับเป็น "ซ่อมเอง ไม่ต้อง PR" ระหว่างหยุดอยู่ → จบช่วงที่ตอนนี้ (เวลาที่รอไปแล้วยังนับว่ารอ ไม่ลบทิ้ง)
       · ช่วงหยุดมีได้ช่วงเดียวต่อใบ — จบไปแล้วเลือกใหม่ = ไม่เริ่มซ้ำ (จอบอก) */
  const savePath = async (k) => {
    const prev = path; setPath(k);
    const nowIso = new Date().toISOString();
    const needs = !!repairPathMeta(k)?.needsPr;
    const patch = { repair_path: k || null };
    if (needs && !order?.mttr_hold_from) { patch.mttr_hold_from = nowIso; patch.mttr_hold_to = null; }
    if (!needs && isMttrHeld(order)) patch.mttr_hold_to = nowIso;
    const ok = checkWriteRows(await supabaseDR.from('mtn_orders').update(patch).eq('id', orderId).select('id'), 'บันทึกเส้นทางงานซ่อม');
    if (!ok) { setPath(prev); return; }
    if (needs && !prs.some(p => p.status !== 'cancelled'))
      notifyPrWaiting({ order, team: teamKey, fullName, why: `🛒 MTN ตัดสิน: ${repairPathMeta(k)?.label} — รอเปิด PR` });
    onOrderChanged?.();
  };
  const resumeRepair = async () => {
    if (!confirm('จบช่วงหยุด MTTR แล้วเริ่มนับเวลาซ่อมของช่างต่อ?')) return;
    if (checkWriteRows(await supabaseDR.from('mtn_orders').update({ mttr_hold_to: new Date().toISOString() })
      .eq('id', orderId).is('mttr_hold_to', null).select('id'), 'จบช่วงหยุด MTTR', { zeroMsg: 'ช่วงหยุด MTTR ของใบนี้จบไปแล้ว — โหลดใหม่' })) {
      toast.success('เริ่มนับ MTTR ช่างต่อแล้ว'); onOrderChanged?.();
    }
  };
  const held = isMttrHeld(order);
  const meta = repairPathMeta(path);
  const openCount = prs.filter(isPrOpen).length;

  return (
    <div style={box}>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>🛒 เส้นทางงานซ่อม & ใบขอซื้อ (PR) {prs.length ? `· ${prs.length} ใบ` : ''}{openCount ? ` · ค้าง ${openCount}` : ''}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {REPAIR_PATHS.map(p => (
          <button key={p.key} disabled={!canEdit} onClick={() => savePath(path === p.key ? '' : p.key)}
            style={{ ...(path === p.key ? btnPri : btnGhost), padding: '6px 10px', fontSize: 12, opacity: canEdit || path === p.key ? 1 : 0.6 }}>{p.label}</button>
        ))}
      </div>
      {!path && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>ยังไม่ระบุเส้นทาง — ช่างเลือกได้ตั้งแต่รับงาน (ใบเก่าไม่ได้เดาให้)</div>}
      {order?.mttr_hold_from && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, padding: '6px 9px', borderRadius: 8, marginBottom: 6,
          background: held ? 'rgba(245,158,11,0.10)' : 'var(--bg)', border: `1px solid ${held ? 'rgba(245,158,11,0.45)' : 'var(--border)'}` }}>
          <span style={{ flex: 1, minWidth: 200, lineHeight: 1.6 }}>
            {held ? '⏸️ หยุดนับ MTTR ช่างอยู่' : '⏸️ เคยหยุดนับ MTTR'} — ตั้งแต่ MTN ตัดสิน {fmtDateTime(order.mttr_hold_from)}
            {order.mttr_hold_to ? ` ถึง ${fmtDateTime(order.mttr_hold_to)}` : ''} · รวม {mttrHoldMin(order, Date.now(), new Date(order.mttr_hold_from).getTime(), order.mttr_hold_to ? new Date(order.mttr_hold_to).getTime() : Date.now())} นาที
            <span style={{ color: 'var(--muted)' }}> · downtime ของเครื่องยังนับเต็ม</span>
          </span>
          {held && canEdit && <button onClick={resumeRepair} style={{ ...btnGhost, color: '#22c55e', borderColor: '#22c55e' }}>▶ กลับมาซ่อมต่อ</button>}
        </div>
      )}
      {held && path === 'inhouse_pr' && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>อะไหล่ PR ของใบนี้รับครบ = ระบบเริ่มนับต่อให้เอง</div>}
      {meta?.outsource && (
        <div style={{ fontSize: 11, color: 'var(--text2)', background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.35)', borderRadius: 8, padding: '6px 9px', marginBottom: 6, lineHeight: 1.6 }}>
          📤 ส่งซ่อมภายนอก: กดปุ่ม <b>“📤 ส่งซ่อมภายนอก”</b> ด้านบนเพื่อเริ่มนับช่วงอยู่กับ supplier —
          <b> MTTR ของช่างหยุดนับช่วงนั้น</b> แต่ <b>downtime / machine breakdown ของเครื่องนับเต็ม</b> · เปิด PR ค่าจ้าง (GL งานบริการ) ที่นี่
        </div>
      )}
      {meta?.needsPr && !prs.some(p => p.status !== 'cancelled') && (
        <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6 }}>⚠ เส้นทางนี้ต้องเปิด PR — ยังไม่มีใบ</div>
      )}
      {loadErr && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>⚠ โหลดใบขอซื้อไม่สำเร็จ: {loadErr}</div>}
      {prs.map(pr => <PrRow key={pr.id} pr={pr} canEdit={canEdit} fullName={fullName} onChanged={load} />)}
      {prs.length > 1 && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📝 ใบพิมพ์: มีหลายเลข PR ⇒ ช่อง PR.No. ข้างบนเว้นว่าง และพิมพ์ทุกเลขในช่องรายละเอียด</div>}
      {canEdit && (adding
        ? <NewPrForm parts={parts} glCodes={glCodes} fullName={fullName}
            defaults={{ source: 'mo', order_id: orderId, order, team: teamKey, repairPath: path, supplier: path === 'outsource' ? order?.supplier : '' }}
            onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />
        : <button onClick={() => setAdding(true)} style={{ ...btnGhost, color: 'var(--accent)', borderColor: 'var(--accent)' }}>+ เปิด PR</button>)}
    </div>
  );
}

/* ══ บอร์ดในคลังอะไหล่ — ติด Min → เปิด PR · คิว PR ค้าง ══════════════════════════════ */
export function MtnPrBoard({ parts = [], fullName, canEdit = false, onStockChanged, myTeams = [], role = '' }) {
  /* 🔐 ชั้น ③ ฝั่งช่าง = แกน "ทีม" (`utils/mtnTeams.js`) — บอร์ดนี้โหลด PR ของทุกทีมทั้งโรงงาน
     ⇒ ไม่มีด่านเจ้าของ = หัวหน้าแผนกที่ถือ `spare_master` รับของ/ยกเลิกใบของทีมช่างอื่นได้
     (เคสเดียวกับที่ PERMISSIONS-DESIGN §14 เขียนไว้) · เกณฑ์ strict เดียวกับทะเบียนอะไหล่ */
  const strictOwn = can('mtn_repair', 'spare_master', role) && !can('mtn_repair', 'manage_master', role);
  const ownOf = useCallback((pr) => teamRowOwner(pr, { myTeams, role, strict: strictOwn }), [myTeams, role, strictOwn]);
  const [prs, setPrs] = useState([]);
  const [glCodes, setGlCodes] = useState([]);
  const [err, setErr] = useState(null);
  const [openFor, setOpenFor] = useState(null);      // part ที่กำลังเปิด PR
  const [showDone, setShowDone] = useState(false);
  const [freeForm, setFreeForm] = useState(false);
  const [mos, setMos] = useState({});
  const [pathMos, setPathMos] = useState([]);       // ใบ MO ที่เลือก "ต้องเปิด PR" (ต้นคิวของแอดมิน)
  const [prFor, setPrFor] = useState(null);         // ใบ MO ที่กำลังกรอกรายการขอซื้อ

  const load = useCallback(async () => {
    const [r, g] = await Promise.all([
      fetchAllRows(supabaseDR, 'mtn_purchase_requests', PR_COLS, q => q.order('requested_at', { ascending: false }).order('id')),
      loadGlCodes(),
    ]);
    const rows = r.data || [];
    // เลขใบ MO เฉพาะใบที่ยังเปิดอยู่ (คิวรอเลข/ค้าง) — ลิงก์กลับไปใบ MO ให้แอดมินเห็นว่าเลข PR นี้ของงานไหน
    const [m, pm] = await Promise.all([
      loadMoNos(rows.filter(isPrOpen).map(x => x.order_id)),
      // ใบ MO ที่ช่างเลือกเส้นทาง "ต้องเปิด PR" — ยังไม่มีรายการขอซื้อ = ต้องขึ้นคิว ห้ามตกหล่น (20/10)
      supabaseDR.from('mtn_orders').select('id, mo_no, machine_no, line_name, item_type, status, repair_path, mtn_dept, report_at, dept_section')
        .in('repair_path', NEEDS_PR_PATHS()).not('status', 'in', `(${MO_DONE_STATUSES.join(',')})`)
        .order('report_at', { ascending: false }).limit(500),
    ]);
    setErr(r.error?.message || m.error || (pm.error ? `โหลดใบ MO ที่ต้องเปิด PR ไม่สำเร็จ: ${pm.error.message}` : null));
    if ((pm.data || []).length >= 500) toast.info('ใบ MO ที่ต้องเปิด PR เกิน 500 ใบ — คิวโชว์ 500 ใบล่าสุด');
    setPrs(rows); setGlCodes(g.rows); setMos(m.byId); setPathMos(pm.data || []);
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => { if (alive) await load(); })();
    return () => { alive = false; };
  }, [load]);
  const reload = () => { load(); onStockChanged?.(); };

  const openQty = useMemo(() => openPrQtyByPart(prs), [prs]);
  const below = useMemo(() => (parts || []).filter(isBelowMin)
    .map(p => ({ p, open: openQty[p.id] || 0, need: suggestReorderQty(p, openQty[p.id] || 0) }))
    .sort((a, b) => (b.need > 0) - (a.need > 0) || (a.p.stock_qty ?? 0) - (b.p.stock_qty ?? 0)), [parts, openQty]);
  const needOrder = below.filter(x => x.need > 0);
  const openList = prs.filter(isPrOpen);
  const waitNoList = openList.filter(isAwaitingPrNo);
  const noPrMos = useMemo(() => mosNeedingPr(pathMos, prs, isMoOpen), [pathMos, prs]);
  const hasNoList = openList.filter(p => !isAwaitingPrNo(p));
  const doneList = prs.filter(p => !isPrOpen(p)).slice(0, 50);

  return (
    <div style={{ ...box, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ fontSize: 13.5 }}>🛒 ใบขอซื้ออะไหล่ (PR)</b>
        <span style={{ fontSize: 11.5, color: needOrder.length ? '#ef4444' : 'var(--muted)' }}>ติด Min ยังไม่เปิด PR {needOrder.length} รายการ</span>
        <span style={{ fontSize: 11.5, color: noPrMos.length ? '#ef4444' : 'var(--muted)' }}>· ใบ MO รอเปิด PR {noPrMos.length}</span>
        <span style={{ fontSize: 11.5, color: waitNoList.length ? '#f59e0b' : 'var(--muted)' }}>· รอเลข PR {waitNoList.length}</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>· PR ค้าง {hasNoList.length} ใบ</span>
        {canEdit && <button onClick={() => setFreeForm(v => !v)} style={{ ...btnGhost, marginLeft: 'auto' }}>{freeForm ? 'ปิดฟอร์ม' : '+ เปิด PR เอง'}</button>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
        ลูปเดียวกับสโตร์ purchase part: <b>ติด Min / ใบ MO ขอซื้อ → แอดมินช่างกรอกเลข PR จาก SAP → สั่งแล้ว (PO) → ของเข้า กดรับ = เข้าสต็อกอัตโนมัติ</b>
        · จำนวนเสนอ = เติมถึง Max (ไม่ตั้ง Max = 2×Min) หักยอดที่เปิด PR ค้างไว้แล้ว · Min ว่าง/0 = ไม่ตรวจ
      </div>
      {err && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>⚠ โหลดใบขอซื้อไม่สำเร็จ: {err} — ตัวนับข้างบนอาจไม่ครบ</div>}
      {freeForm && canEdit && <NewPrForm parts={parts} glCodes={glCodes} fullName={fullName}
        defaults={{ source: 'manual' }} onCancel={() => setFreeForm(false)} onDone={() => { setFreeForm(false); reload(); }} />}

      {below.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>🔴 อะไหล่ที่ติด Min ({below.length})</div>
          {below.map(({ p, open, need }) => (
            <div key={p.id}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
                <span style={{ flex: 1, minWidth: 160 }}><b>{p.name}</b>{p.code ? <span style={{ color: 'var(--muted)', fontFamily: 'monospace' }}> · {p.code}</span> : null}</span>
                <span style={{ color: '#ef4444' }}>คงเหลือ {p.stock_qty ?? 0}</span>
                <span style={{ color: 'var(--muted)' }}>Min {p.min_qty}{p.max_qty ? ` · Max ${p.max_qty}` : ''}</span>
                {open > 0 && <span style={{ color: '#0ea5e9' }}>PR ค้าง {open}</span>}
                {need > 0
                  ? (canEdit && <button onClick={() => setOpenFor(openFor === p.id ? null : p.id)} style={{ ...btnGhost, color: 'var(--accent)', borderColor: 'var(--accent)' }}>🛒 เปิด PR {need} {p.unit || ''}</button>)
                  : <span style={{ fontSize: 11, color: '#22c55e' }}>✓ PR ค้างครอบแล้ว</span>}
              </div>
              {openFor === p.id && <NewPrForm parts={parts} glCodes={glCodes} fullName={fullName}
                defaults={{ source: 'spare_min', part_id: p.id, item_name: p.name, qty: need, unit: p.unit, unit_price: p.unit_price, supplier: p.supplier, team: p.team, section: p.section, gl_category: 'spare_part' }}
                onCancel={() => setOpenFor(null)} onDone={() => { setOpenFor(null); reload(); }} />}
            </div>
          ))}
        </div>
      )}
      {!below.length && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>✅ ไม่มีอะไหล่ที่ติด Min (เฉพาะรายการที่ตั้ง Min ไว้)</div>}

      <div style={{ fontSize: 12, fontWeight: 700, margin: '6px 0 4px', color: noPrMos.length ? '#ef4444' : undefined }}>🔧 ใบ MO ที่ช่างเลือกว่าต้องเปิด PR — ยังไม่มีรายการขอซื้อ ({noPrMos.length})</div>
      {noPrMos.length ? noPrMos.map(o => (
        <div key={o.id}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '5px 9px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', borderLeft: '4px solid #ef4444', marginBottom: 6 }}>
            <a href={`/mtn-repair?mo=${encodeURIComponent(o.id)}`} style={{ color: 'var(--accent)', fontWeight: 800 }} title="เปิดใบ MO">🔧 {o.mo_no || 'ใบ MO (ยังไม่มีเลข)'}</a>
            <span style={{ flex: 1, minWidth: 160 }}>{[o.item_type, o.machine_no, o.line_name].filter(Boolean).join(' · ') || '—'}</span>
            <span style={{ color: 'var(--muted)' }}>{repairPathMeta(o.repair_path)?.label}</span>
            <span style={{ color: 'var(--muted)' }}>แจ้ง {fmtDateTime(o.report_at)}</span>
            {canEdit && <button onClick={() => setPrFor(prFor === o.id ? null : o.id)} style={{ ...btnGhost, color: 'var(--accent)', borderColor: 'var(--accent)' }}>+ กรอกรายการขอซื้อ / เลข PR</button>}
          </div>
          {prFor === o.id && <NewPrForm parts={parts} glCodes={glCodes} fullName={fullName}
            defaults={{ source: 'mo', order_id: o.id, order: o, team: o.mtn_dept, section: o.dept_section || null, repairPath: o.repair_path }}
            onCancel={() => setPrFor(null)} onDone={() => { setPrFor(null); reload(); }} />}
        </div>
      )) : <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>ไม่มีใบ MO ที่รอเปิด PR</div>}
      <div style={{ fontSize: 12, fontWeight: 700, margin: '6px 0 4px', color: waitNoList.length ? '#f59e0b' : undefined }}>⏳ รอเลข PR จาก SAP ({waitNoList.length}) — แอดมินช่างกรอกเลขผูกกับใบ MO</div>
      {waitNoList.length ? waitNoList.map(pr => <PrRow key={pr.id} pr={pr} canEdit={canEdit} own={ownOf(pr)} fullName={fullName} onChanged={reload} showSource mo={mos[pr.order_id] || null} />)
        : <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>ไม่มีใบที่รอเลข PR</div>}
      <div style={{ fontSize: 12, fontWeight: 700, margin: '6px 0 4px' }}>📋 PR ค้าง — รอสั่ง / รอของ ({hasNoList.length})</div>
      {hasNoList.length ? hasNoList.map(pr => <PrRow key={pr.id} pr={pr} canEdit={canEdit} own={ownOf(pr)} fullName={fullName} onChanged={reload} showSource mo={mos[pr.order_id] || null} />)
        : <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ไม่มี PR ค้าง</div>}
      <button onClick={() => setShowDone(v => !v)} style={{ ...btnGhost, marginTop: 6 }}>{showDone ? 'ซ่อน' : 'ดู'} PR ที่จบแล้ว (50 ล่าสุด)</button>
      {showDone && <div style={{ marginTop: 6 }}>{doneList.map(pr => <PrRow key={pr.id} pr={pr} canEdit={false} fullName={fullName} showSource />)}</div>}
    </div>
  );
}

/* ══ ทะเบียนรหัส GL ═══════════════════════════════════════════════════════════════════ */
export function MtnGlMaster({ canEdit = false, fullName }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [n, setN] = useState({ category: 'service', gl_code: '', name: '' });
  const load = useCallback(async () => {
    const r = await loadGlCodes(); setErr(r.error?.message || null); setRows(r.rows);
  }, []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    if (!n.gl_code.trim()) return toast.error('ใส่รหัส GL');
    if (checkWrite(await supabaseDR.from('mtn_gl_codes').insert({ ...n, gl_code: n.gl_code.trim(), updated_by_name: fullName || null }), 'เพิ่มรหัส GL')) {
      setN(p => ({ ...p, gl_code: '', name: '' })); load();
    }
  };
  const upd = async (id, patch) => {
    if (checkWriteRows(await supabaseDR.from('mtn_gl_codes').update({ ...patch, updated_at: new Date().toISOString(), updated_by_name: fullName || null }).eq('id', id).select('id'), 'แก้รหัส GL')) load();
  };
  const setDefault = async (g) => {
    // ตั้งต้นได้ตัวเดียวต่อหมวด — ปลดตัวอื่นในหมวดก่อน
    const others = rows.filter(x => x.category === g.category && x.is_default && x.id !== g.id);
    for (const o of others) if (!checkWrite(await supabaseDR.from('mtn_gl_codes').update({ is_default: false }).eq('id', o.id), 'ปลดรหัสตั้งต้น')) return;
    upd(g.id, { is_default: !g.is_default });
  };
  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.7 }}>
        รหัส GL ของงานช่าง — ใบขอซื้อ (PR) เติมรหัส <b>ตั้งต้นของหมวด</b> ให้เอง (แก้ทับในใบได้):
        <b> 🧑‍🔧 งานบริการ</b> = จ้างภายนอก/ส่งซ่อม · <b>🔩 อะไหล่โรงงาน</b> = ซื้ออะไหล่เข้าคลัง
        · รอไฟล์ GL จากฝ่ายบัญชี/MTN มาเติม · ลบ = ปิดใช้งาน (PR เก่ายังอ่านรหัสเดิมได้)
      </div>
      {err && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>⚠ โหลดทะเบียน GL ไม่สำเร็จ: {err}</div>}
      {canEdit && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <select value={n.category} onChange={e => setN(p => ({ ...p, category: e.target.value }))} style={{ ...inp, width: 210 }}>
            {GL_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input value={n.gl_code} onChange={e => setN(p => ({ ...p, gl_code: e.target.value }))} placeholder="รหัส GL" style={{ ...inp, width: 140, fontFamily: 'monospace' }} />
          <input value={n.name} onChange={e => setN(p => ({ ...p, name: e.target.value }))} placeholder="ชื่อบัญชี" style={{ ...inp, width: 240 }} />
          <button onClick={add} style={btnPri}>+ เพิ่ม</button>
        </div>
      )}
      {GL_CATEGORIES.map(c => {
        const list = rows.filter(r => r.category === c.key);
        return (
          <div key={c.key} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>{c.label} ({list.length})</div>
            {!list.length && <div style={{ fontSize: 11.5, color: '#f59e0b' }}>⚠ ยังไม่มีรหัสในหมวดนี้</div>}
            {list.map(g => (
              <div key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '5px 8px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 4 }}>
                <input defaultValue={g.gl_code} disabled={!canEdit} onBlur={e => e.target.value.trim() && e.target.value.trim() !== g.gl_code && upd(g.id, { gl_code: e.target.value.trim() })} style={{ ...inp, width: 140, fontFamily: 'monospace', fontWeight: 700 }} />
                <input defaultValue={g.name || ''} disabled={!canEdit} onBlur={e => e.target.value !== (g.name || '') && upd(g.id, { name: e.target.value })} style={{ ...inp, flex: 1, minWidth: 160 }} />
                <button disabled={!canEdit} onClick={() => setDefault(g)} style={{ ...(g.is_default ? btnPri : btnGhost), padding: '5px 10px' }}>{g.is_default ? '★ ตั้งต้น' : '☆ ตั้งเป็นตั้งต้น'}</button>
                {canEdit && <button onClick={() => confirm(`ปิดใช้งาน GL ${g.gl_code}?`) && upd(g.id, { is_active: false })} style={{ ...btnGhost, color: 'var(--muted)' }}>ปิดใช้งาน</button>}
              </div>
            ))}
          </div>
        );
      })}
      {rows.filter(r => !GL_CATEGORIES.some(c => c.key === r.category)).length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>หมวดอื่น: {rows.filter(r => !GL_CATEGORIES.some(c => c.key === r.category)).map(r => `${r.gl_code} (${r.category})`).join(' · ')}</div>
      )}
    </div>
  );
}
