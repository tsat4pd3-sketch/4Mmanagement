/**
 * 📍 DeliverScanModal — สโตร์ถึงไลน์แล้ว สแกน QR จุดส่ง ก่อนกด "จัดส่งแล้ว" (ลูปสโตร์เฟส 4 · ขั้น 7 · 2026-09-03)
 *
 * ใช้จาก /heijunka → 🔄 คิวเติม WIP (ใบ "จากไลน์" เท่านั้น — ใบจุด WIP ไม่ผ่านโมดัลนี้)
 * กฎอยู่ที่ src/utils/replenishGate.js ที่เดียว (docs/STORE-PULL-LOOP-DESIGN.md §4.6) — ที่นี่แค่วาดจอ:
 *   - หน้ายืนยันต้องโชว์ **พาร์ท + จำนวน + ปลายทาง** ไม่ใช่ถามลอยๆ ว่า "ยืนยัน?" (กันกดผิดใบในลิสต์)
 *   - ปุ่มยืนยัน **disabled จนกว่าจะสแกนผ่าน** หรือหัวหน้าปลดบล็อก (ไม่ใช่เตือนทีหลัง)
 *   - ไลน์ยังไม่ตั้งจุดส่ง = ตรวจไม่ได้ → ให้ผ่านแบบ `no_point` พร้อมบอกให้ไปตั้ง (ไม่รู้ = ห้ามบล็อก)
 *   - บล็อกทุกครั้ง + override ทุกครั้ง ถูกส่งออกทาง `onLogEvent` (เก็บลง line_replenish_scan_blocks)
 *   - override ต้องมีสิทธิ์ `wip_request:override` + เลือกเหตุผล · ไม่มีสิทธิ์ก็ต้องเห็นว่า "ใครปลดได้" (UI §6.9)
 *
 * กติกา UI: modal มีฟอร์ม → ไม่ปิดจาก backdrop (§5) · zIndex 2300 (ScanModal ซ้อนบนที่ 2400)
 */
import { useState, useMemo, useCallback } from 'react';
import ScanModal from './ScanModal';
import { resolveDeliveryPoint } from '../utils/qrCode';
import { pointsForLine, pointLabel, checkDeliveryPoint, buildDeliverPayload, validateDeliverPayload, overrideReasonOk, OVERRIDE_REASONS } from '../utils/replenishGate';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString());
const btn = (bg, color, border = 'transparent', disabled = false) => ({
  padding: '9px 16px', borderRadius: 8, border: `1px solid ${border}`, background: bg, color,
  fontSize: 13, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  fontFamily: 'var(--font-body)',
});

export default function DeliverScanModal({ request, points = [], canOverride = false, fullName, busy = false, onConfirm, onLogEvent, onClose }) {
  const [scanOpen, setScanOpen] = useState(false);
  const [result, setResult]     = useState(null);      // ผล checkDeliveryPoint ล่าสุด (ok หรือที่บล็อก)
  const [overriding, setOverriding] = useState(false);
  const [reasonKey, setReasonKey]   = useState('');
  const [reasonNote, setReasonNote] = useState('');

  const serving = useMemo(() => pointsForLine(points, request?.line_name), [points, request]);
  const noPoint = serving.length === 0;

  /* ScanModal เรียก onScan(parsed) — คืน string = โชว์ error ในตัวสแกน (สแกนต่อได้ทันที ไม่ต้องปิด-เปิดใหม่) */
  const onScan = useCallback((parsed) => {
    const point = resolveDeliveryPoint(parsed, points);
    const r = checkDeliveryPoint({ request, point, points, scannedRaw: parsed?.raw });
    setResult(r);
    if (r.block) {
      onLogEvent?.({ outcome: 'blocked', status_code: r.status, scanned_raw: parsed?.raw || null, expected: r.expected || null, actual: r.actual || null });
      return r.message;
    }
    setScanOpen(false);
    return undefined;
  }, [points, request, onLogEvent]);

  const confirmScanned = () => {
    if (!result || result.status !== 'ok') return;
    const payload = buildDeliverPayload({ gate: 'scanned', point: result.point });
    const bad = validateDeliverPayload(payload);
    if (bad) { setResult({ ...result, status: 'unknown', block: true, message: bad }); return; }
    onConfirm?.(payload, null);
  };
  const confirmNoPoint = () => onConfirm?.(buildDeliverPayload({ gate: 'no_point' }), null);
  const confirmOverride = () => {
    if (!canOverride || !overrideReasonOk(reasonKey, reasonNote)) return;
    const payload = buildDeliverPayload({ gate: 'override', point: result?.point || null, reasonKey, reasonNote, overrideBy: fullName });
    const bad = validateDeliverPayload(payload);
    if (bad) return;
    onConfirm?.(payload, { outcome: 'override', status_code: result?.status || null, scanned_raw: result?.actual || null,
      expected: serving.map(pointLabel).join(' / '), actual: result?.actual || null, reason: payload.delivered_override_reason });
  };

  const ok = result?.status === 'ok';
  const blocked = !!result?.block;

  return (
    <>
      {/* ไม่ปิดจาก backdrop — โมดัลมีช่องกรอกเหตุผล (UI-CONVENTIONS §5) */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div onClick={e => e.stopPropagation()} className="modal-scroll"
          style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(520px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>📍 ถึงไลน์แล้ว — สแกนจุดส่งก่อนปิดใบ</h3>
            <button onClick={onClose} className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>

          {/* ใบที่กำลังทำ — พาร์ท + จำนวน + ปลายทาง ต้องเห็นชัด (กันกดผิดใบในลิสต์) */}
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, alignItems: 'start' }}>
            <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>พาร์ท</div>
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

          {noPoint ? (
            /* ไม่รู้ = ห้ามบล็อก — ไลน์ยังไม่ตั้งจุดส่ง ปล่อยผ่านแต่ต้องบอกให้ไปตั้ง */
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '9px 12px' }}>
                ⚪ <b>{request?.line_name}</b> ยังไม่ตั้งจุดส่งงาน — ระบบตรวจไม่ได้ว่าวางถูกจุดไหม (ใบจะถูกมาร์ก "ไลน์ยังไม่ตั้งจุดส่ง")<br />
                <span style={{ color: 'var(--text2)' }}>ให้หัวหน้าไลน์ตั้งที่ ⚙️ ตั้งค่าผังไลน์ → 🎯 จุดส่งงาน แล้วพิมพ์ป้ายที่ 🏷️ พิมพ์ป้าย QR</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button onClick={onClose} disabled={busy} style={btn('transparent', 'var(--muted)', 'var(--border2)', busy)}>ยกเลิก</button>
                <button onClick={confirmNoPoint} disabled={busy} style={btn('#f59e0b', '#1a1200', 'transparent', busy)}>{busy ? '…' : '🚚 ส่งแล้ว (ตรวจจุดไม่ได้)'}</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                ใบนี้ต้องวางที่: {serving.map(p => (
                  <span key={p.id} style={{ display: 'inline-block', margin: '2px 4px 0 0', padding: '2px 8px', borderRadius: 10, background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700, fontSize: 12 }}>{pointLabel(p)}</span>
                ))}
              </div>

              {ok && (
                <div style={{ marginTop: 10, fontSize: 13, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 8, padding: '9px 12px', fontWeight: 700 }}>
                  {result.message}
                </div>
              )}
              {blocked && !ok && (
                <div style={{ marginTop: 10, fontSize: 13, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px' }}>
                  🔴 {result.message}
                </div>
              )}

              {!overriding && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={() => setScanOpen(true)} disabled={busy} style={btn('var(--accent)', '#08130c', 'transparent', busy)}>
                    📷 {ok ? 'สแกนใหม่' : 'สแกน QR จุดส่ง'}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button onClick={onClose} disabled={busy} style={btn('transparent', 'var(--muted)', 'var(--border2)', busy)}>ยกเลิก</button>
                  {/* ปุ่มยืนยัน disabled จนกว่าจะสแกนผ่าน — ไม่ใช่เตือนทีหลัง */}
                  <button onClick={confirmScanned} disabled={!ok || busy} style={btn(ok ? '#22c55e' : 'var(--bg3)', ok ? '#04140a' : 'var(--muted)', 'transparent', !ok || busy)}>
                    {busy ? '…' : '🚚 ยืนยันส่งแล้ว'}
                  </button>
                </div>
              )}

              {/* ทางออกเมื่อสแกนไม่ได้/ถูกบล็อก — ต้องมี ไม่งั้นคนเลี่ยงกลับไป LINE chat · แต่ต้องถูกบันทึก */}
              {!ok && (
                <div style={{ marginTop: 12, borderTop: '1px dashed var(--border2)', paddingTop: 10 }}>
                  {canOverride ? (
                    !overriding ? (
                      <button onClick={() => setOverriding(true)} disabled={busy}
                        style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                        🔓 สแกนไม่ได้ / ป้ายหาย → ปลดบล็อกโดยหัวหน้า (บันทึกชื่อ+เหตุผล)
                      </button>
                    ) : (
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#ef4444' }}>🔓 ปลดบล็อก — ระบุเหตุผล (ถูกบันทึกเป็นข้อมูล ไปแก้ต้นเหตุทีหลัง)</div>
                        <select value={reasonKey} onChange={e => setReasonKey(e.target.value)}
                          style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 }}>
                          <option value="">— เลือกเหตุผล —</option>
                          {OVERRIDE_REASONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                        <input value={reasonNote} onChange={e => setReasonNote(e.target.value)}
                          placeholder={reasonKey === 'other' ? 'ระบุเหตุผล (บังคับ)' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)'}
                          style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 }} />
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>ผู้ปลด: {fullName || '—'}</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                          <button onClick={() => setOverriding(false)} disabled={busy} style={btn('transparent', 'var(--muted)', 'var(--border2)', busy)}>กลับไปสแกน</button>
                          <button onClick={confirmOverride} disabled={busy || !overrideReasonOk(reasonKey, reasonNote)}
                            style={btn('#ef4444', '#fff', 'transparent', busy || !overrideReasonOk(reasonKey, reasonNote))}>
                            {busy ? '…' : '🔓 ปลดบล็อก + ส่งแล้ว'}
                          </button>
                        </div>
                      </div>
                    )
                  ) : (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      สแกนไม่ได้/ป้ายหาย → ให้หัวหน้าที่มีสิทธิ์ <code>wip_request:override</code> มาปลดบล็อก (admin เปิดสิทธิ์ให้ role อื่นได้ที่ /permissions)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {scanOpen && (
        <ScanModal title="สแกน QR จุดส่งงาน" hint={`ยิงป้าย 🎯 ที่ติดหน้าไลน์ ${request?.line_name || ''} — หรือพิมพ์รหัสสั้นบนป้าย`}
          onScan={onScan} onClose={() => setScanOpen(false)} closeOnHit={false} />
      )}
    </>
  );
}
