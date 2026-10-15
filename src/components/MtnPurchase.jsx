/* ══════════════════════════════════════════════════════════════════════════════════════
   ใบขอซื้อ (PR) งานช่าง + ทะเบียนรหัส GL + เลขรัน PR   (2026-10-14 · MTN REQUEST)

   ชิ้นที่ export:
     · <MtnPrPanel order>    แผงในใบ MO — เส้นทางงานซ่อม + PR หลายใบต่อ 1 MO
     · <MtnPrBoard>          แผงในคลังอะไหล่ — อะไหล่ติด Min → เปิด PR · คิว PR ค้าง → สั่งแล้ว → รับของ
     · <MtnGlMaster>         ทะเบียนรหัส GL (⚙️ ข้อมูลหลัก)
     · <MtnPrSeqMaster>      รูปแบบ/เลขล่าสุดของเลขรัน PR (⚙️ ข้อมูลหลัก)

   กฎ/สูตรอยู่ `src/utils/mtnPurchase.js` ที่เดียว · ตาราง DR (anon-open ตาม convention)
   🔴 รับของ = RPC `mtn_pr_receive` (สถานะ + เข้าสต็อกในทรานแซกชันเดียว) ห้ามเขียน 2 คำสั่งแยก
   🔴 ยกเลิก = status 'cancelled' + เหตุผล — ไม่มีปุ่มลบ (RLS ไม่เปิด DELETE)
   สิทธิ์: เปิด/สั่ง/รับ PR = `mtn_repair:service` · ทะเบียน GL/เลขรัน = `mtn_repair:manage_master` (ไม่มีคีย์ใหม่)
   ══════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { fetchAllRows } from '../utils/fetchAllRows';
import SearchSelect from './SearchSelect';
import SupplierSelect from './SupplierSelect';
import { fmtDateTime } from '../utils/dateFormat';
import {
  PR_STATUS_META, PR_SOURCE_LABEL, prStatusMeta, isPrOpen, REPAIR_PATHS, repairPathMeta,
  GL_CATEGORIES, glCategoryLabel, glCategoryForPr, defaultGlFor, isBelowMin, suggestReorderQty, openPrQtyByPart,
} from '../utils/mtnPurchase';

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

/** ออกเลข PR ให้ใบที่เพิ่ง insert — ล้ม = ใบยังอยู่ (เลขว่าง) + toast บอก ห้ามเงียบ */
async function assignPrNo(id) {
  const { data, error } = await supabaseDR.rpc('mtn_assign_pr_no', { p_id: id });
  if (error) { toast.error(`ออกเลข PR ไม่สำเร็จ: ${error.message} — ใบถูกบันทึกแล้ว กด "ออกเลข" ซ้ำได้`); return null; }
  return data;
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
function PrRow({ pr, canEdit, fullName, onChanged, showSource }) {
  const st = prStatusMeta(pr.status);
  const [mode, setMode] = useState(null);         // 'order' | 'receive' | 'cancel'
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const doAssign = () => run(async () => { const no = await assignPrNo(pr.id); if (no) { toast.success(`ออกเลข ${no}`); onChanged?.(); } });
  const doOrder = () => run(async () => {
    const ok = checkWriteRows(await supabaseDR.from('mtn_purchase_requests')
      .update({ status: 'ordered', ordered_at: new Date().toISOString(), ordered_by: fullName || null, po_no: val.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', pr.id).eq('status', 'requested').select('id'), 'บันทึกสั่งซื้อ',
      { zeroMsg: 'ใบนี้ถูกเปลี่ยนสถานะไปแล้ว (มีคนกดก่อน) — โหลดใหม่' });
    if (ok) { toast.success('บันทึก "สั่งแล้ว"'); setMode(null); onChanged?.(); }
  });
  const doReceive = () => run(async () => {
    const q = Number(val);
    if (!(q > 0)) return toast.error('ใส่จำนวนที่รับจริง');
    const { data, error } = await supabaseDR.rpc('mtn_pr_receive', { p_id: pr.id, p_qty: q, p_by_name: fullName || null });
    if (error) return toast.error(`รับของไม่สำเร็จ: ${error.message}`);
    toast.success(pr.part_id ? `รับของแล้ว — สต็อกคงเหลือ ${data}` : 'รับของแล้ว (ไม่ผูกอะไหล่ในทะเบียน — ไม่มีสต็อกให้เข้า)');
    setMode(null); onChanged?.();
  });
  const doCancel = () => run(async () => {
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
        <b style={{ fontFamily: 'monospace', fontSize: 13 }}>{pr.pr_no || '(ยังไม่มีเลข)'}</b>
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
      {canEdit && isPrOpen(pr) && !mode && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {!pr.pr_no && <button disabled={busy} onClick={doAssign} style={btnGhost}>🔢 ออกเลข PR</button>}
          {pr.status === 'requested' && <button disabled={busy} onClick={() => { setVal(''); setMode('order'); }} style={{ ...btnGhost, color: '#0ea5e9', borderColor: '#0ea5e9' }}>🚚 สั่งแล้ว</button>}
          <button disabled={busy} onClick={() => { setVal(String(pr.qty ?? '')); setMode('receive'); }} style={{ ...btnGhost, color: '#22c55e', borderColor: '#22c55e' }}>📥 รับของเข้า</button>
          <button disabled={busy} onClick={() => { setVal(''); setMode('cancel'); }} style={{ ...btnGhost, color: 'var(--muted)' }}>✖ ยกเลิก</button>
        </div>
      )}
      {mode && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input autoFocus value={val} onChange={e => setVal(e.target.value)} type={mode === 'receive' ? 'number' : 'text'} min={mode === 'receive' ? 0 : undefined}
            placeholder={mode === 'order' ? 'เลข PO (ถ้ามี)' : mode === 'receive' ? 'จำนวนที่รับจริง' : 'เหตุผลที่ยกเลิก (บังคับ)'}
            style={{ ...inp, flex: 1, minWidth: 150 }} />
          <button disabled={busy} onClick={mode === 'order' ? doOrder : mode === 'receive' ? doReceive : doCancel} style={btnPri}>
            {busy ? 'กำลังบันทึก…' : mode === 'order' ? 'ยืนยันสั่งแล้ว' : mode === 'receive' ? (pr.part_id ? 'รับ + เข้าสต็อก' : 'ยืนยันรับ') : 'ยืนยันยกเลิก'}
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
    unit_price: defaults.unit_price ?? '', supplier: defaults.supplier || '', note: '',
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
      };
      const { data, error } = await supabaseDR.from('mtn_purchase_requests').insert(row).select('id').single();
      if (error) return toast.error(`เปิด PR ไม่สำเร็จ: ${error.message}`);
      const no = await assignPrNo(data.id);
      if (no) toast.success(`เปิด PR ${no} แล้ว`);
      onDone?.();
    } finally { setBusy(false); }
  };

  return (
    <div style={{ ...box, background: 'var(--card)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>🛒 เปิดใบขอซื้อ (PR) ใหม่ — ระบบรันเลขให้</div>
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
      <input value={f.note} onChange={e => set('note', e.target.value)} placeholder="หมายเหตุ (สเปก / ด่วน / เหตุผล)" style={{ ...inp, marginTop: 6 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onCancel} style={btnGhost}>ยกเลิก</button>
        <button disabled={busy} onClick={save} style={btnPri}>{busy ? 'กำลังบันทึก…' : '🛒 เปิด PR + ออกเลข'}</button>
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

  const savePath = async (k) => {
    const prev = path; setPath(k);
    const ok = checkWriteRows(await supabaseDR.from('mtn_orders').update({ repair_path: k || null }).eq('id', orderId).select('id'), 'บันทึกเส้นทางงานซ่อม');
    if (!ok) { setPath(prev); return; }
    onOrderChanged?.();
  };
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
            defaults={{ source: 'mo', order_id: orderId, team: teamKey, repairPath: path, supplier: path === 'outsource' ? order?.supplier : '' }}
            onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />
        : <button onClick={() => setAdding(true)} style={{ ...btnGhost, color: 'var(--accent)', borderColor: 'var(--accent)' }}>+ เปิด PR</button>)}
    </div>
  );
}

/* ══ บอร์ดในคลังอะไหล่ — ติด Min → เปิด PR · คิว PR ค้าง ══════════════════════════════ */
export function MtnPrBoard({ parts = [], fullName, canEdit = false, onStockChanged }) {
  const [prs, setPrs] = useState([]);
  const [glCodes, setGlCodes] = useState([]);
  const [err, setErr] = useState(null);
  const [openFor, setOpenFor] = useState(null);      // part ที่กำลังเปิด PR
  const [showDone, setShowDone] = useState(false);
  const [freeForm, setFreeForm] = useState(false);

  const load = useCallback(async () => {
    const [r, g] = await Promise.all([
      fetchAllRows(supabaseDR, 'mtn_purchase_requests', PR_COLS, q => q.order('requested_at', { ascending: false }).order('id')),
      loadGlCodes(),
    ]);
    setErr(r.error?.message || null); setPrs(r.data || []); setGlCodes(g.rows);
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
  const doneList = prs.filter(p => !isPrOpen(p)).slice(0, 50);

  return (
    <div style={{ ...box, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ fontSize: 13.5 }}>🛒 ใบขอซื้ออะไหล่ (PR)</b>
        <span style={{ fontSize: 11.5, color: needOrder.length ? '#ef4444' : 'var(--muted)' }}>ติด Min ยังไม่เปิด PR {needOrder.length} รายการ</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>· PR ค้าง {openList.length} ใบ</span>
        {canEdit && <button onClick={() => setFreeForm(v => !v)} style={{ ...btnGhost, marginLeft: 'auto' }}>{freeForm ? 'ปิดฟอร์ม' : '+ เปิด PR เอง'}</button>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
        ลูปเดียวกับสโตร์ purchase part: <b>ติด Min → เปิด PR (ระบบรันเลข) → สั่งแล้ว (PO) → ของเข้า กดรับ = เข้าสต็อกอัตโนมัติ</b>
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

      <div style={{ fontSize: 12, fontWeight: 700, margin: '6px 0 4px' }}>📋 PR ค้าง ({openList.length})</div>
      {openList.length ? openList.map(pr => <PrRow key={pr.id} pr={pr} canEdit={canEdit} fullName={fullName} onChanged={reload} showSource />)
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

/* ══ รูปแบบเลขรัน PR ══════════════════════════════════════════════════════════════════ */
export function MtnPrSeqMaster({ canEdit = false }) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabaseDR.from('mtn_pr_seq').select('key, prefix, reset, digits, period, last_no').eq('key', 'PR').maybeSingle();
    setErr(error?.message || null); setS(data || null);
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (patch) => {
    if (checkWriteRows(await supabaseDR.from('mtn_pr_seq').update({ ...patch, updated_at: new Date().toISOString() }).eq('key', 'PR').select('key'), 'บันทึกเลขรัน PR')) { toast.success('บันทึกแล้ว'); load(); }
  };
  if (err) return <div style={{ color: '#ef4444', fontSize: 12 }}>⚠ โหลดเลขรัน PR ไม่สำเร็จ: {err}</div>;
  if (!s) return <div style={{ color: 'var(--muted)', fontSize: 12 }}>กำลังโหลด…</div>;
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', month: '2-digit', year: '2-digit' }).formatToParts(new Date());
  const yy = p.find(x => x.type === 'year').value, mm = p.find(x => x.type === 'month').value;
  const period = s.reset === 'month' ? `${yy}${mm}` : s.reset === 'year' ? yy : '';
  const nextNo = (s.period || '') === period ? s.last_no + 1 : 1;
  const preview = `${s.prefix}${period}${period ? '-' : ''}${String(nextNo).padStart(s.digits, '0')}`;
  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.7 }}>
        เลข PR ออกตอนกด <b>“เปิด PR”</b> (ใบ MO หรือคลังอะไหล่) · ค่าตั้งต้น <code>PR + ปีเดือน + เลขรัน 4 หลัก</code> = 11 ตัวพอดีช่อง PR.No. บนฟอร์ม
        · ตั้ง "เลขล่าสุด" เพื่อต่อจากระบบเดิม · เลขชนของเก่า ระบบข้ามไปเลขว่างถัดไปให้เอง (ไม่ออกซ้ำ)
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
        <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>คำนำหน้า <input disabled={!canEdit} defaultValue={s.prefix} onBlur={e => e.target.value.trim() && e.target.value.trim() !== s.prefix && save({ prefix: e.target.value.trim().toUpperCase() })} style={{ ...inp, width: 80, marginLeft: 4, fontWeight: 700 }} /></label>
        <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>เริ่มนับใหม่ <select disabled={!canEdit} value={s.reset} onChange={e => save({ reset: e.target.value })} style={{ ...inp, width: 130, marginLeft: 4 }}>
          <option value="month">ทุกเดือน</option><option value="year">ทุกปี</option><option value="never">ไม่รีเซ็ต</option></select></label>
        <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>จำนวนหลัก <input disabled={!canEdit} type="number" min="3" max="8" defaultValue={s.digits} onBlur={e => Number(e.target.value) !== s.digits && save({ digits: Math.min(8, Math.max(3, parseInt(e.target.value, 10) || 4)) })} style={{ ...inp, width: 70, marginLeft: 4 }} /></label>
        <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>เลขล่าสุด (งวดนี้) <input disabled={!canEdit} type="number" min="0" defaultValue={(s.period || '') === period ? s.last_no : 0} onBlur={e => save({ last_no: Math.max(0, parseInt(e.target.value, 10) || 0), period })} style={{ ...inp, width: 96, marginLeft: 4 }} /></label>
        <span style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'monospace' }}>ถัดไป: {preview}</span>
      </div>
    </div>
  );
}

export { PR_STATUS_META };
