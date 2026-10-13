/* ═══ 🔒 ขอปรับยอดคลัง — ช่องทางเดียวเมื่อช่อง IN บนบอร์ด Monitoring ถูกล็อก (2026-10-13 · คำสั่ง user)

   user: *"พาร์ทไหนที่เริ่มมีตัวเลขจากระบบเข้ามาแล้ว … จะไม่รับ IN manual ดีกว่า แต่จะต้องมีช่องทางให้ขอปรับยอด"*
   · กรอก "ยอดที่นับได้จริง" (ไม่ใช่ผลต่าง — ระบบคิดให้ด้วย `countDelta` ตัวเดียวกับแท็บตรวจนับ)
   · เขียนเป็น `adjust` สถานะ **pending** ที่คลังอ้างอิงของพาร์ท ⇒ เข้าคิวอนุมัติเดิมของ /line-stock
     (`line_stock:approve`) — **ไม่มีผลกับยอดจนกว่าจะอนุมัติ** · ห้ามเขียน approved จากจอนี้
   · เหตุผลบังคับ (ผู้อนุมัติต้องรู้ว่าทำไม) · ไม่รู้คลังอ้างอิง = ส่งไม่ได้ (ห้ามเดาคลัง)
   · ฟอร์มสั้น ⇒ ไม่ถามยืนยันตอนปิด แต่ **ไม่ปิดจาก backdrop** (UI §5)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { checkWriteRows } from '../utils/dbWrite';
import { countDelta } from '../utils/stockCount';
import { getWorkDate } from '../utils/workDate';
import { toast } from './Toast';

const fmt = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString());

export default function StockAdjustRequestModal({ req, by, onClose }) {
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!req) return null;
  const { mat, part_name: partName, loc, onHand } = req;
  const d = onHand === null || onHand === undefined ? null : countDelta(onHand, counted);
  const noBase = onHand === null || onHand === undefined;
  const canSend = !!loc && !busy && reason.trim().length > 0 && counted.trim() !== ''
    && (noBase ? Number.isFinite(Number(counted.replace(/,/g, ''))) : !!d);

  const submit = async () => {
    if (!canSend) return;
    const n = Number(counted.replace(/,/g, ''));
    /* ไม่มีแถวในคลัง = ยอดระบบ 0 ⇒ ผลต่าง = ยอดที่นับได้ทั้งก้อน */
    const delta = noBase ? n : d.delta;
    if (!delta) { toast.info('ยอดที่นับได้เท่ากับยอดในระบบ — ไม่ต้องปรับ'); return; }
    setBusy(true);
    const r = await supabaseDR.from('line_stock_transactions').insert({
      line_name: loc, mat_no: mat, part_name: partName || null, qty: delta,
      type: 'adjust', status: 'pending', work_date: getWorkDate(),
      note: `ขอปรับยอดจากบอร์ด Monitoring: ระบบ ${fmt(noBase ? 0 : onHand)} → นับได้ ${fmt(n)} · ${reason.trim()}`,
      created_by: by || null,
    }).select('id');
    setBusy(false);
    if (!checkWriteRows(r, 'ส่งคำขอปรับยอด')) return;
    toast.success(`ส่งคำขอปรับยอด ${mat} แล้ว — รออนุมัติที่ /line-stock (ยอดยังไม่เปลี่ยนจนกว่าจะอนุมัติ)`);
    onClose();
  };

  const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 };
  return (
    /* ไม่ปิดจาก backdrop — มีช่องกรอก (UI §5) */
    <div className="overlay">
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 94vw)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>🔒 ขอปรับยอดคลัง — {mat}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{partName || ' '}</div>
          </div>
          <button className="tbtn" onClick={onClose} aria-label="ปิด"
            style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 12 }}>
          ช่อง IN ของพาร์ทนี้ระบบเป็นเจ้าของแล้ว (คลังกดรับ / Daily Report ลงยอด) — แก้บนบอร์ดไม่ได้
          ถ้าของจริงไม่ตรง ให้ส่งยอดที่นับได้ เข้าคิวอนุมัติของคลัง
        </div>
        {!loc ? (
          <div style={{ fontSize: 12, color: '#f87171', marginBottom: 12 }}>
            ⚠️ ยังไม่รู้ว่าพาร์ทนี้อยู่คลังไหน (กฎรับเข้าคลัง/Product Master ยังไม่ครบ) — ส่งคำขอไม่ได้ ให้ตั้งที่ /products ก่อน
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13 }}>
              คลัง <b>{loc}</b> · ยอดในระบบ <b>{noBase ? 'ยังไม่มีแถว (ถือเป็น 0)' : fmt(onHand)}</b>
            </div>
            <div>
              <label style={lbl}>ยอดที่นับได้จริง (ชิ้น)</label>
              <input inputMode="decimal" value={counted} style={{ width: '100%' }} onChange={e => setCounted(e.target.value)} placeholder="เช่น 1200" />
              {d ? (
                <div style={{ fontSize: 12, marginTop: 4, color: d.dir === 'up' ? 'var(--green, #22c55e)' : '#f87171' }}>
                  ผลต่าง {d.delta > 0 ? '+' : ''}{fmt(d.delta)} ชิ้น
                </div>
              ) : null}
            </div>
            <div>
              <label style={lbl}>เหตุผล (บังคับ)</label>
              <input value={reason} style={{ width: '100%' }} onChange={e => setReason(e.target.value)} placeholder="เช่น นับจริงที่ชั้น A3 · ใบรับเข้าตกหล่น" />
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>
            ยกเลิก
          </button>
          <button type="button" onClick={submit} disabled={!canSend}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', fontWeight: 800, fontSize: 13,
              background: canSend ? 'var(--accent)' : 'var(--bg3)', color: canSend ? 'var(--accent-ink)' : 'var(--muted)',
              cursor: canSend ? 'pointer' : 'default' }}>
            {busy ? 'กำลังส่ง…' : 'ส่งคำขอ (รออนุมัติ)'}
          </button>
        </div>
      </div>
    </div>
  );
}
