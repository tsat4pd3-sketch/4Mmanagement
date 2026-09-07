/**
 * 🔍 PickScanModal — สโตร์เริ่มเตรียมของ: สแกนยืนยันพาร์ท + จำนวน ก่อนใบเป็น "กำลังเตรียม" (ขั้น 5 · 2026-09-07)
 *
 * ที่มา: Smart Withdraw Kanban (pptx ที่ user ส่ง 2026-09-07) ฝั่ง Area Store:
 *   Store prepare item as ordered → Scan confirm order → matching "Order Request = Order scan"
 *   → ไม่ตรง: Alert → Check part and Quantity → Fix error → กลับไปเตรียม
 *   → ตรง: Scan for SAP update (Deduct stock) → TP Man transfer parts to PD
 *   + user: "เรื่องการเตรียม ก็ต้อง scan verify ว่างานที่เตรียมถูกต้องด้วย"
 *
 * กฎอยู่ที่ src/utils/replenishGate.js (`checkPickPart` / `checkPickQty` / `buildPickPayload`) — ที่นี่แค่วาดจอ:
 *   - หน้ายืนยันโชว์ พาร์ท + จำนวน + ปลายทาง (กันกดผิดใบ)
 *   - ยิงบาร์โค้ดพาร์ท (ESM:P:<mat> / เลข mat บนบัตร) → ต้องตรง mat_no บนใบ · ผิด = 🔴 บล็อก บอกว่าใบต้องการอะไร
 *   - จำนวนที่หยิบ: เกิน = บล็อก · ขาด = เตือน + ต้องติ๊กยืนยัน (ไลน์จะเห็นตอนรับของ) · ห้ามบล็อกเพราะข้อมูลเราไม่ครบ
 *   - ปุ่มยืนยัน disabled จนกว่าสแกนผ่าน + จำนวนผ่าน · ปลดบล็อก = สิทธิ์ `wip_request:override` + เหตุผล
 *   - บล็อก/override ส่งออกทาง onLogEvent (เก็บ line_replenish_scan_blocks step='pick')
 *   - ยืนยันแล้ว **ตัดสต็อกให้เลย** (STORE −qty · ไลน์ +qty) — ทำที่ HeijunkaKanban ไม่ใช่ที่นี่
 *
 * กติกา UI: modal มีช่องกรอก → ไม่ปิดจาก backdrop (§5) · zIndex 2300 (ScanModal ซ้อนบน 2400)
 */
import { useState, useCallback } from 'react';
import ScanModal from './ScanModal';
import { checkPickPart, checkPickQty, buildPickPayload, validatePickPayload, overrideReasonOk, OVERRIDE_REASONS } from '../utils/replenishGate';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString());
const btn = (bg, color, border = 'transparent', disabled = false) => ({
  padding: '9px 16px', borderRadius: 8, border: `1px solid ${border}`, background: bg, color,
  fontSize: 13, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  fontFamily: 'var(--font-body)',
});

export default function PickScanModal({ request, canOverride = false, fullName, busy = false, onConfirm, onLogEvent, onClose }) {
  const [scanOpen, setScanOpen] = useState(false);
  const [part, setPart]         = useState(null);      // ผล checkPickPart ล่าสุด
  const [qty, setQty]           = useState(String(request?.request_qty ?? ''));
  const [shortOk, setShortOk]   = useState(false);     // ติ๊กยืนยันว่าส่งไม่ครบ
  const [overriding, setOverriding] = useState(false);
  const [reasonKey, setReasonKey]   = useState('');
  const [reasonNote, setReasonNote] = useState('');

  const qtyCheck = checkPickQty({ request, qty });

  const onScan = useCallback((parsed) => {
    const r = checkPickPart({ request, scan: parsed });
    setPart(r);
    if (r.block) {
      onLogEvent?.({ outcome: 'blocked', status_code: r.status, scanned_raw: parsed?.raw || null, expected: r.expected, actual: r.actual });
      return r.message;
    }
    setScanOpen(false);
    return undefined;
  }, [request, onLogEvent]);

  const partOk = part?.status === 'ok';
  const qtyOk  = qtyCheck.status === 'ok' || (qtyCheck.status === 'under' && shortOk);
  const canConfirm = partOk && qtyOk && !busy;

  const confirmScanned = () => {
    if (!canConfirm) return;
    const payload = buildPickPayload({ gate: 'scanned', qty, scanRaw: part.actual });
    if (validatePickPayload(payload)) return;
    onConfirm?.(payload, null, qtyCheck);
  };
  const confirmOverride = () => {
    if (!canOverride || !overrideReasonOk(reasonKey, reasonNote) || !qtyOk || busy) return;
    const payload = buildPickPayload({ gate: 'override', qty, scanRaw: part?.actual || null, reasonKey, reasonNote, overrideBy: fullName });
    if (validatePickPayload(payload)) return;
    onConfirm?.(payload, { outcome: 'override', status_code: part?.status || 'no_scan', scanned_raw: part?.actual || null,
      expected: request?.mat_no || null, actual: part?.actual || null, reason: payload.picked_override_reason }, qtyCheck);
  };

  const inputSt = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 };

  return (
    <>
      {/* ไม่ปิดจาก backdrop — มีช่องกรอกจำนวน/เหตุผล (UI-CONVENTIONS §5) */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div onClick={e => e.stopPropagation()} className="modal-scroll"
          style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(520px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>🔍 เริ่มเตรียม — สแกนยืนยันของที่หยิบ</h3>
            <button onClick={onClose} className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, alignItems: 'start' }}>
            <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>ใบต้องการพาร์ท</div>
              <div style={{ fontSize: 15, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', wordBreak: 'break-all' }}>{request?.mat_no || '—'}</div>
              {request?.part_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{request.part_name}</div>}
            </div>
            <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>จำนวนที่ขอ</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)' }}>{fmt(request?.request_qty)}</div>
            </div>
            <div style={{ background: 'rgba(59,130,246,0.12)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: '#3b82f6' }}>ปลายทาง</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#3b82f6' }}>➜ {request?.line_name || '—'}</div>
            </div>
          </div>

          {/* ① พาร์ท */}
          <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 800, color: 'var(--text2)' }}>① ยิงบาร์โค้ดพาร์ทที่หยิบมา</div>
          {partOk && (
            <div style={{ marginTop: 6, fontSize: 13, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>
              {part.message}{part.loose ? <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}> · บาร์โค้ดมีเลขต่อท้าย — ระบบเทียบเฉพาะส่วนที่เป็น MAT</span> : null}
            </div>
          )}
          {part?.block && (
            <div style={{ marginTop: 6, fontSize: 13, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '8px 12px' }}>
              🔴 {part.message}
            </div>
          )}
          {!overriding && (
            <button onClick={() => setScanOpen(true)} disabled={busy} style={{ ...btn('var(--accent)', '#08130c', 'transparent', busy), marginTop: 8 }}>
              📷 {partOk ? 'สแกนใหม่' : 'สแกนพาร์ท'}
            </button>
          )}

          {/* ② จำนวน */}
          <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 800, color: 'var(--text2)' }}>② จำนวนที่หยิบได้จริง</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <input type="number" min="0" value={qty} onChange={e => { setQty(e.target.value); setShortOk(false); }}
              style={{ ...inputSt, width: 140, fontSize: 16, fontWeight: 800 }} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>/ {fmt(request?.request_qty)} ชิ้น</span>
            {qtyCheck.status !== 'ok' && (
              <span style={{ fontSize: 12, fontWeight: 700, color: qtyCheck.block ? '#ef4444' : '#f59e0b', flex: '1 1 100%' }}>
                {qtyCheck.block ? '🔴' : '🟡'} {qtyCheck.message}
              </span>
            )}
          </div>
          {qtyCheck.status === 'under' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 12.5, color: 'var(--text)' }}>
              <input type="checkbox" checked={shortOk} onChange={e => setShortOk(e.target.checked)} style={{ width: 'auto' }} />
              ยืนยันว่าส่งไม่ครบ {fmt(-qtyCheck.diff)} ชิ้น — ไลน์จะเห็นตอนกดรับของ
            </label>
          )}

          <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--muted)', background: 'var(--bg3)', borderRadius: 8, padding: '7px 10px' }}>
            💾 กดยืนยัน = ระบบ<b>ตัดสต็อกให้เลย</b> (คลัง STORE −{fmt(Number(qty) || 0)} · ไลน์ {request?.line_name} +{fmt(Number(qty) || 0)}) ตามขั้น "Scan for SAP update" — ไม่ต้องไปบันทึกจ่ายที่ Line Stock ซ้ำ
          </div>

          {!overriding && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button onClick={onClose} disabled={busy} style={btn('transparent', 'var(--muted)', 'var(--border2)', busy)}>ยกเลิก</button>
              <button onClick={confirmScanned} disabled={!canConfirm} style={btn(canConfirm ? '#22c55e' : 'var(--bg3)', canConfirm ? '#04140a' : 'var(--muted)', 'transparent', !canConfirm)}>
                {busy ? '…' : '🔧 ยืนยัน · เริ่มเตรียม'}
              </button>
            </div>
          )}

          {!partOk && (
            <div style={{ marginTop: 12, borderTop: '1px dashed var(--border2)', paddingTop: 10 }}>
              {canOverride ? (
                !overriding ? (
                  <button onClick={() => setOverriding(true)} disabled={busy}
                    style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                    🔓 สแกนไม่ได้ / ป้ายพาร์ทหาย → ปลดบล็อกโดยหัวหน้า (บันทึกชื่อ+เหตุผล)
                  </button>
                ) : (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#ef4444' }}>🔓 ปลดบล็อก — ระบุเหตุผล (ถูกบันทึกเป็นข้อมูล)</div>
                    <select value={reasonKey} onChange={e => setReasonKey(e.target.value)} style={{ ...inputSt, marginTop: 6 }}>
                      <option value="">— เลือกเหตุผล —</option>
                      {OVERRIDE_REASONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                    <input value={reasonNote} onChange={e => setReasonNote(e.target.value)}
                      placeholder={reasonKey === 'other' ? 'ระบุเหตุผล (บังคับ)' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)'} style={{ ...inputSt, marginTop: 6 }} />
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>ผู้ปลด: {fullName || '—'}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                      <button onClick={() => setOverriding(false)} disabled={busy} style={btn('transparent', 'var(--muted)', 'var(--border2)', busy)}>กลับไปสแกน</button>
                      <button onClick={confirmOverride} disabled={busy || !qtyOk || !overrideReasonOk(reasonKey, reasonNote)}
                        style={btn('#ef4444', '#fff', 'transparent', busy || !qtyOk || !overrideReasonOk(reasonKey, reasonNote))}>
                        {busy ? '…' : '🔓 ปลดบล็อก + เริ่มเตรียม'}
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  สแกนไม่ได้/ป้ายหาย → ให้หัวหน้าที่มีสิทธิ์ <code>wip_request:override</code> มาปลดบล็อก
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {scanOpen && (
        <ScanModal title="สแกนพาร์ทที่หยิบ" hint={`ยิงป้าย/บาร์โค้ดบนกล่องหรือบัตร — ใบนี้ต้องการ ${request?.mat_no || ''}`}
          onScan={onScan} onClose={() => setScanOpen(false)} closeOnHit={false} />
      )}
    </>
  );
}
