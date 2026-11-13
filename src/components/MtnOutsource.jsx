/* ═══════════════════════════════════════════════════════════════════════════════════════
   🔧 ของที่ถอดออกมาแล้วส่งซ่อมภายนอก เพื่อเอากลับมาเป็นสแปร์   (แผงในใบ MO · 2026-11-09)

   เคสจริง (ทีม MTN · Axis Com Robot): ช่างใส่อะไหล่สำรองเข้าเครื่อง **เครื่องกลับมาผลิตทันที
   ใบ MO ปิดได้ตามปกติ** — แต่ตัวที่ถอดออกมาไม่ได้ทิ้ง ส่งไปซ่อมข้างนอกแล้วเอากลับมาเป็นสแปร์

   🔴 **คนละเรื่องกับ `mtn_orders.vendor_*`** — ชุดนั้นแปลว่า "ใบนี้รอของจาก supplier อยู่"
      (เครื่องยังเสีย ใบยังไม่จบ) และ `summarizeMachineHistory()` เอาช่วง
      `vendor_sent_at → vendor_back_at` ไป**หักออกจากเวลาซ่อมของช่าง**
      ⇒ ใบที่ปิดแล้วแต่ของยังอยู่ข้างนอก ถ้าไปยืมคอลัมน์นั้น = KPI เวลาซ่อมเพี้ยน

   🔴 **สต็อก: ตอนส่งไม่แตะ** (ของเสียไม่เคยอยู่ในสต็อก) · **ตอนรับกลับ +qty ผ่าน `mtn_stock_move('in')`**
      ⇒ ลำดับบังคับ (กฎเหล็ก DB ข้อ 6): **จอง `back_at` ก่อน (compare-and-swap) → ค่อยขยับสต็อก
      → สต็อกล้ม = คืน `back_at` เป็น null** ไม่งั้นกดซ้ำ 2 ครั้ง = ของเข้าสต็อก 2 เท่า

   🔴 **ยกเลิก = `cancelled_at` + เหตุผล ห้าม delete** (ซ่อมไม่ได้/ไม่เอากลับ ก็ยังเป็นประวัติของเครื่อง)

   ⚠️ ตาราง `mtn_outsource_parts` อยู่ **DR (Product DB)** · anon-open ตาม convention ฝั่งนั้น
   ⚠️ **ไฟล์นี้ห้ามมีสีดิบ (hex/rgba)** — ใช้ token เท่านั้น (ด่าน colorRatchet: ไฟล์ใหม่ = 0)
   📄 `docs/modules/mtn-work-order.md` §ของส่งซ่อมนอก
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import SearchSelect from './SearchSelect';
import SupplierSelect from './SupplierSelect';
import { fmtDateTime } from '../utils/dateFormat';
import { isOutsourcePending as isPending, outsourceState } from '../utils/mtnOutsource';

import { tr } from '../utils/i18n';
const inp = { width: '100%', padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, boxSizing: 'border-box' };
const btnPri = { background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' };
const lbl = { fontSize: 11, color: 'var(--muted)' };

const COLS = 'id, order_id, part_id, part_name, qty, supplier, pr_no, repair_cost, sent_at, sent_by, expected_at, back_at, back_by, cancelled_at, cancel_reason, note';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
export default function MtnOutsourcePanel({ order, parts = [], fullName = '', canEdit = false, onStockChanged }) {
  const orderId = order?.id || null;
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [backFor, setBackFor] = useState(null);   // id ของแถวที่กำลังกดรับเข้า
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) { setRows([]); return; }
    const r = await supabaseDR.from('mtn_outsource_parts').select(COLS)
      .eq('order_id', orderId).order('sent_at', { ascending: false });
    /* 🔴 อ่านไม่ได้ต้องเขียนบนจอ — "ไม่มีรายการ" ทั้งที่คิวรีล่ม = จอโกหก */
    setErr(r.error?.message || null);
    setRows(r.data || []);
  }, [orderId]);

  useEffect(() => { let alive = true; (async () => { if (alive) await load(); })(); return () => { alive = false; }; }, [load]);

  const pending = rows.filter(isPending);
  const done = rows.filter(r => !isPending(r));

  /* ── รับของกลับ ─────────────────────────────────────────────────────────────────────
     ลำดับบังคับ: จองสถานะก่อน → ขยับสต็อก → สต็อกล้มคืนสถานะ (กฎเหล็ก DB ข้อ 6) */
  const receive = async (row, qtyBack, note) => {
    const q = num(qtyBack);
    if (!q || q <= 0) return toast.error('ใส่จำนวนที่รับกลับ');
    setBusy(true);
    try {
      const claim = await supabaseDR.from('mtn_outsource_parts')
        .update({ back_at: new Date().toISOString(), back_by: fullName || null, updated_at: new Date().toISOString(), updated_by_name: fullName || null })
        .eq('id', row.id).is('back_at', null).is('cancelled_at', null).select('id');
      if (!checkWriteRows(claim, 'รับของกลับจากร้านซ่อม')) { setBusy(false); return; }

      /* ของนอกทะเบียน (`part_id` ว่าง) = ไม่มีที่ให้เข้าสต็อก — จบแค่สถานะ ต้องบอกบนจอ */
      if (!row.part_id) {
        toast.success(`รับ "${row.part_name}" กลับแล้ว — ไม่ได้ผูกอะไหล่ในทะเบียน จึงไม่เข้าสต็อก`);
      } else {
        const { error } = await supabaseDR.rpc('mtn_stock_move', {
          p_part_id: row.part_id, p_type: 'in', p_qty: q,
          p_note: `รับกลับจากซ่อมนอก${row.supplier ? ` (${row.supplier})` : ''}${note ? ` · ${note}` : ''}`,
          p_by_name: fullName || null, p_ref_order: row.order_id,
        });
        if (error) {
          /* 🔴 สต็อกล้ม = ต้องคืนสถานะ ไม่งั้นแถวนี้ "รับแล้ว" ทั้งที่ของไม่เคยเข้าสต็อก
             🔴 **การคืนค่าเองก็ล้มได้** — ล้มแล้วเงียบ = แถวค้างสถานะผิดถาวร ไม่มีใครรู้
                ⇒ นับแถวที่คืนจริง ถ้าคืนไม่ได้ต้องบอกให้ชัดพร้อม id ให้คนตามแก้ */
          const undo = await supabaseDR.from('mtn_outsource_parts')
            .update({ back_at: null, back_by: null }).eq('id', row.id).select('id');
          setBusy(false);
          await load();
          if (undo.error || !(undo.data || []).length) {
            return toast.error(
              `เข้าสต็อกไม่สำเร็จ (${error.message}) — และคืนสถานะไม่สำเร็จด้วย! `
              + `รายการนี้จะขึ้นว่า "รับกลับแล้ว" ทั้งที่ของยังไม่เข้าสต็อก `
              + `· แจ้งแอดมินพร้อมรหัส ${row.id}`);
          }
          return toast.error(`เข้าสต็อกไม่สำเร็จ — คืนสถานะเป็น "ยังอยู่ข้างนอก" แล้ว: ${error.message}`);
        }
        toast.success(`รับ "${row.part_name}" กลับเข้าสต็อก ${q} แล้ว`);
        onStockChanged?.();
      }
      setBackFor(null); await load();
    } finally { setBusy(false); }
  };

  const cancel = async (row) => {
    const reason = window.prompt(`ยกเลิกรายการ "${row.part_name}" — เพราะอะไร? (ซ่อมไม่ได้ / ไม่เอากลับ)`);
    if (reason == null) return;
    if (!reason.trim()) return toast.error('ต้องใส่เหตุผล');
    const r = await supabaseDR.from('mtn_outsource_parts')
      .update({ cancelled_at: new Date().toISOString(), cancel_reason: reason.trim(), updated_at: new Date().toISOString(), updated_by_name: fullName || null })
      .eq('id', row.id).is('back_at', null).is('cancelled_at', null).select('id');
    if (checkWriteRows(r, 'ยกเลิกรายการส่งซ่อมนอก')) load();
  };

  if (!orderId) return null;

  return (
    <div style={{ marginBottom: 10, padding: '9px 11px', borderRadius: 'var(--r-md)', background: 'var(--bg2)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <b style={{ fontSize: 12.5 }}>{tr('🔧 ของที่ถอดออกมา ส่งซ่อมนอก')}</b>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: pending.length ? 'var(--amber)' : 'var(--muted)' }}>
          ยังอยู่ข้างนอก {pending.length}
        </span>
        {!!done.length && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr('· จบแล้ว')} {done.length}</span>}
        {canEdit && <button onClick={() => setAdding(v => !v)} style={{ ...btnGhost, marginLeft: 'auto' }}>{adding ? tr('ปิดฟอร์ม') : tr('+ ส่งของไปซ่อม')}</button>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 6 }}>
        ใส่อะไหล่สำรองเข้าเครื่องแล้วเครื่องเดินได้ = <b>{tr('ปิดใบ MO ได้เลย ไม่ต้องรอของ')}</b> ·
        ตัวที่ถอดออกมาส่งซ่อมแล้วบันทึกไว้ตรงนี้ · <b>กดรับของเข้า = เข้าสต็อกอะไหล่ให้อัตโนมัติ</b>
      </div>
      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 6 }}>{tr('⚠ โหลดรายการส่งซ่อมนอกไม่สำเร็จ:')} {err} {tr('— ตัวนับข้างบนอาจไม่ครบ')}</div>}

      {adding && canEdit && (
        <AddForm parts={parts} fullName={fullName} orderId={orderId}
          onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />
      )}

      {!rows.length && !err && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr('ยังไม่มีรายการส่งซ่อมนอกในใบนี้')}</div>}

      {rows.map(r => {
        const state = outsourceState(r);
        return (
          <div key={r.id} style={{ padding: '6px 9px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', borderLeft: `3px solid ${state.color}`, marginBottom: 5 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
              <b style={{ flex: 1, minWidth: 150 }}>{r.part_name}</b>
              <span style={{ color: 'var(--muted)' }}>× {r.qty}</span>
              <span style={{ color: state.color, fontWeight: 700 }}>{state.text}</span>
              {canEdit && isPending(r) && (
                <>
                  <button onClick={() => setBackFor(backFor === r.id ? null : r.id)} style={{ ...btnGhost, color: 'var(--green)', borderColor: 'var(--green)' }}>{tr('📥 รับของเข้า')}</button>
                  <button onClick={() => cancel(r)} style={{ ...btnGhost, color: 'var(--muted)' }}>{tr('✕ ยกเลิก')}</button>
                </>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {!r.part_id && <span style={{ color: 'var(--amber)' }}>{tr('ไม่ผูกอะไหล่ในทะเบียน (รับแล้วไม่เข้าสต็อก) ·')} </span>}
              ส่ง {fmtDateTime(r.sent_at)}{r.sent_by ? ` · ${r.sent_by}` : ''}
              {r.supplier ? ` · ร้าน ${r.supplier}` : ''}
              {r.pr_no ? ` · PR ${r.pr_no}` : ''}
              {r.repair_cost != null ? ` · ค่าซ่อม ${r.repair_cost}` : ''}
              {r.expected_at ? ` · นัดรับ ${r.expected_at}` : ' · ไม่ได้นัดวันรับ'}
              {r.back_at ? ` · รับกลับ ${fmtDateTime(r.back_at)}${r.back_by ? ` โดย ${r.back_by}` : ''}` : ''}
              {r.cancelled_at ? ` · ยกเลิก ${fmtDateTime(r.cancelled_at)}${r.cancel_reason ? ` — ${r.cancel_reason}` : ''}` : ''}
              {r.note ? ` · ${r.note}` : ''}
            </div>
            {backFor === r.id && canEdit && <BackForm row={r} busy={busy} onCancel={() => setBackFor(null)} onConfirm={receive} />}
          </div>
        );
      })}
    </div>
  );
}

/* ── ฟอร์มรับของกลับ = ด่านอยู่ในตัว (ต้องใส่จำนวน + กดยืนยัน) ⇒ ไม่ถามซ้ำอีกชั้น ── */
function BackForm({ row, busy, onCancel, onConfirm }) {
  const [q, setQ] = useState(String(row.qty ?? 1));
  const [note, setNote] = useState('');
  const short = num(q) != null && num(q) < Number(row.qty || 0);
  return (
    <div style={{ marginTop: 6, padding: '7px 9px', borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>{tr('รับกลับเข้าสต็อก —')} {row.part_name}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
        <label style={lbl}>{tr('จำนวนที่รับกลับ')}<input type="number" min="0" value={q} onChange={e => setQ(e.target.value)} style={inp} /></label>
        <label style={lbl}>{tr('หมายเหตุ')}<input value={note} onChange={e => setNote(e.target.value)} placeholder={tr('เช่น ซ่อมแล้วใช้ได้')} style={inp} /></label>
      </div>
      {short && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>{tr('⚠ น้อยกว่าที่ส่งไป (')}{row.qty}) — ส่วนที่ขาดจะไม่ถูกบันทึกเป็นค้างอีก ถ้ายังรอของให้รับทีหลังแทน</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button disabled={busy} onClick={() => onConfirm(row, q, note)} style={{ ...btnPri, opacity: busy ? 0.5 : 1 }}>{busy ? tr('กำลังบันทึก…') : tr('ยืนยันรับเข้าสต็อก')}</button>
        <button disabled={busy} onClick={onCancel} style={btnGhost}>{tr('ยกเลิก')}</button>
      </div>
    </div>
  );
}

/* ── ฟอร์มส่งของไปซ่อม ──────────────────────────────────────────────────────────── */
function AddForm({ parts, fullName, orderId, onCancel, onDone }) {
  const [f, setF] = useState({ part_id: '', part_name: '', qty: '1', supplier: '', pr_no: '', repair_cost: '', expected_at: '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));

  const partOpts = useMemo(() => (parts || []).map(p => ({
    id: p.id, title: p.name, code: p.code || p.mat_no || '',
    sub: `คงเหลือ ${p.stock_qty ?? 0} ${p.unit || ''}${p.shelf ? ` · ${p.shelf}` : ''}`,
    keywords: [p.code, p.mat_no, p.part_no, p.shelf].filter(Boolean).join(' '), label: p.name,
  })), [parts]);

  const save = async () => {
    const qty = num(f.qty);
    if (!f.part_name.trim()) return toast.error('เลือกหรือพิมพ์ชื่ออะไหล่');
    if (!qty || qty <= 0) return toast.error('ใส่จำนวนที่ส่งไปซ่อม');
    setBusy(true);
    const ok = checkWrite(await supabaseDR.from('mtn_outsource_parts').insert({
      order_id: orderId,
      part_id: f.part_id || null,
      part_name: f.part_name.trim(),
      qty,
      supplier: f.supplier.trim() || null,
      pr_no: f.pr_no.trim() || null,
      repair_cost: num(f.repair_cost),
      expected_at: f.expected_at || null,
      note: f.note.trim() || null,
      sent_by: fullName || null,
      updated_by_name: fullName || null,
    }), 'บันทึกของส่งซ่อมนอก');
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', marginBottom: 7 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
        อะไหล่ในทะเบียน (เลือก = รับกลับแล้วเข้าสต็อกให้เอง · พิมพ์เอง = ของนอกทะเบียน ไม่เข้าสต็อก)
      </div>
      <SearchSelect value={f.part_id} text={f.part_name} options={partOpts} allowFree freeHint="ไม่เข้าสต็อก"
        placeholder={tr('ค้นอะไหล่ — ชื่อ / รหัส / ชั้นวาง หรือพิมพ์เอง')}
        onChange={({ id, text }) => setF(o => ({ ...o, part_id: id || '', part_name: text || '' }))} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 6, marginTop: 6 }}>
        <label style={lbl}>{tr('จำนวน')}<input type="number" min="0" value={f.qty} onChange={e => set('qty', e.target.value)} style={inp} /></label>
        <label style={lbl}>{tr('เลข PR/PO งานซ่อม')}<input value={f.pr_no} onChange={e => set('pr_no', e.target.value)} placeholder={tr('ไม่รู้เว้นว่าง')} style={inp} /></label>
        <label style={lbl}>{tr('ค่าซ่อม/ชิ้น (บาท)')}<input type="number" min="0" value={f.repair_cost} onChange={e => set('repair_cost', e.target.value)} placeholder={tr('ยังไม่รู้ = ว่าง')} style={inp} /></label>
        <label style={lbl}>{tr('นัดรับกลับ')}<input type="date" value={f.expected_at} onChange={e => set('expected_at', e.target.value)} style={inp} /></label>
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={lbl}>{tr('ส่งไปร้านไหน')}</div>
        <SupplierSelect value={f.supplier} onChange={res => set('supplier', res.supplier || '')}
          placeholder={tr('ค้นชื่อร้าน/ผู้รับจ้าง — พิมพ์เองได้')} inputStyle={{ background: 'var(--bg)' }} />
      </div>
      <label style={{ ...lbl, display: 'block', marginTop: 6 }}>{tr('หมายเหตุ')}
        <input value={f.note} onChange={e => set('note', e.target.value)} placeholder={tr('เช่น อาการที่เสีย')} style={inp} />
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
        <button disabled={busy} onClick={save} style={{ ...btnPri, opacity: busy ? 0.5 : 1 }}>{busy ? tr('กำลังบันทึก…') : tr('บันทึกส่งซ่อม')}</button>
        <button disabled={busy} onClick={onCancel} style={btnGhost}>{tr('ยกเลิก')}</button>
      </div>
    </div>
  );
}
