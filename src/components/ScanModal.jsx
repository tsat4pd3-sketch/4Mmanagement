/**
 * ScanModal — ตัวสแกน QR/บาร์โค้ดกลางของระบบ (2026-08-03)
 *
 * ใช้ได้ทั้ง 2 แบบที่หน้างานมีจริง:
 *   1. 📷 กล้องมือถือ/แท็บเล็ต — Android ใช้ `BarcodeDetector` ที่ติดมากับ Chrome (ฟรี ไม่ต้องโหลด lib)
 *      เครื่องที่ไม่มี (iPhone/Safari) fallback ไป `jsqr` ที่ **โหลดแบบ lazy เฉพาะตอนเปิดกล้อง**
 *      → bundle หลักไม่บวม (กฎเดียวกับ GestureCam)
 *   2. 🔫 เครื่องยิงบาร์โค้ด (keyboard-wedge) — ช่องกรอกโฟกัสรออยู่เสมอ ยิงแล้วต่อ Enter เอง
 *      (pattern เดียวกับ modal สแกนเปิด/ปิดใบผลิตใน DailyReport ที่ใช้จริงมาแล้ว)
 *      พิมพ์มือก็ได้ — เผื่อป้ายเลอะ/สแกนไม่ติด งานต้องเดินต่อได้เสมอ
 *
 * ผลลัพธ์ส่งกลับผ่าน onScan(parsed) โดย parsed มาจาก parseQrPayload()
 * หน้าเรียกเป็นคนตัดสินว่า resolve เป็นอะไร (resolveMachine/resolveJig/resolveProduct)
 *
 * กติกา UI: modal มีช่องกรอก → ห้ามปิดจาก backdrop (UI-CONVENTIONS §5) · zIndex ≥ 2000 (§7)
 * ความเป็นส่วนตัว: ภาพจากกล้องประมวลผลในเครื่องล้วน ไม่ส่งออกที่ไหน (เหมือน GestureCam)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { parseQrPayload } from '../utils/qrCode';
import useIsMobile from '../utils/useIsMobile';

const hasNativeDetector = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

export default function ScanModal({
  title = 'สแกน QR / บาร์โค้ด',
  hint = 'ส่องกล้องที่ป้าย QR หรือยิงด้วยเครื่องสแกน',
  footer = null,   // ของที่หน้าอยากโชว์ใต้ผลสแกน (เช่น ตัวนับ "เช็คแล้ว 12/20 คน")
  onScan,          // (parsed) => void | string | { ok } — string = ข้อความ error (เช่น "ไม่พบเครื่องนี้") · { ok } = ข้อความสำเร็จของหน้าเอง
  onClose,
  closeOnHit = true,
}) {
  const [typed, setTyped] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [okMsg, setOkMsg] = useState('');
  /* 📱 handheld (2026-10-20): ช่องรอสแกนไม่เด้งคีย์บอร์ดบนจอ (`inputMode="none"`) — คีย์บอร์ดกินจอ 360×640 ไปครึ่งหนึ่ง
     ทั้งที่เครื่องมีหัวสแกนในตัว · ป้ายเลอะ/สแกนไม่ติด → แตะ "⌨️ พิมพ์เอง" เปิดคีย์บอร์ด · จอคอมไม่เปลี่ยน */
  const isMobile = useIsMobile();
  const [kbd, setKbd] = useState(false);

  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const busyRef = useRef(false);      // กันยิงซ้ำระหว่างกำลังประมวลผลเฟรมเดียวกัน
  const lastHitRef = useRef({ raw: '', at: 0 });

  /* ── ส่งผลลัพธ์ให้หน้าที่เรียก ── */
  const emit = useCallback((raw) => {
    const parsed = parseQrPayload(raw);
    if (!parsed) return;
    // กันสแกนซ้ำรัวจากเฟรมติดกัน (กล้องอ่านได้ ~10 ครั้ง/วินาที)
    const now = Date.now();
    if (parsed.raw === lastHitRef.current.raw && now - lastHitRef.current.at < 1500) return;
    lastHitRef.current = { raw: parsed.raw, at: now };

    const problem = onScan?.(parsed);
    if (typeof problem === 'string' && problem) {
      setErr(problem); setOk(''); setOkMsg('');
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
      /* 🔴 คลุมข้อความเดิมไว้ (27/10) — ไม่งั้นรหัสถัดไปจากเครื่องสแกนไป "ต่อท้าย" ตัวที่ไม่ผ่าน (NOPE999 + 61004 = อ่านผิดทุกใบต่อจากนั้น)
         คลุมแทนล้าง: คนพิมพ์มือยังแก้ตัวเดิมได้ · ยิงใหม่ = แทนที่ทั้งช่อง */
      setTimeout(() => inputRef.current?.select(), 0);
      return;
    }
    // คืน { ok: 'ข้อความ' } = สำเร็จพร้อมข้อความของหน้าเอง (เช่น "✓ สมชาย — มางาน") — ใช้กับโหมดสแกนต่อเนื่อง
    setErr(''); setOk(parsed.raw); setOkMsg(problem && typeof problem === 'object' && problem.ok ? String(problem.ok) : '');
    if (navigator.vibrate) navigator.vibrate(60);
    setTyped('');
    if (closeOnHit) onClose?.();
  }, [onScan, onClose, closeOnHit]);

  /* ── กล้อง ── */
  const stopCam = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }, []);

  const startCam = useCallback(async () => {
    setCamErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
      streamRef.current = stream;
      setCamOn(true);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      let detector = null;
      let jsQR = null;
      if (hasNativeDetector()) {
        // Android/Chrome — รองรับทั้ง QR และบาร์โค้ด 1D ที่มีติดเครื่องอยู่เดิม
        // eslint-disable-next-line no-undef
        detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'itf'] });
      } else {
        const mod = await import('jsqr');           // lazy — โหลดเฉพาะเครื่องที่ไม่มี BarcodeDetector
        jsQR = mod.default || mod;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = async () => {
        rafRef.current = requestAnimationFrame(tick);
        if (busyRef.current || !video.videoWidth) return;
        busyRef.current = true;
        try {
          if (detector) {
            const found = await detector.detect(video);
            if (found?.length) emit(found[0].rawValue);
          } else if (jsQR) {
            const w = Math.min(video.videoWidth, 640);
            const h = Math.round(video.videoHeight * (w / video.videoWidth));
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (res?.data) emit(res.data);
          }
        } catch { /* เฟรมนี้อ่านไม่ออก — เฟรมถัดไปว่ากันใหม่ */ }
        busyRef.current = false;
      };
      tick();
    } catch (e) {
      setCamErr(e?.name === 'NotAllowedError'
        ? 'ไม่ได้รับสิทธิ์ใช้กล้อง — กดอนุญาตกล้องในเบราว์เซอร์ หรือใช้เครื่องยิง/พิมพ์รหัสแทน'
        : 'เปิดกล้องไม่ได้ — ใช้เครื่องยิงบาร์โค้ดหรือพิมพ์รหัสแทนได้');
      setCamOn(false);
    }
  }, [emit]);

  // โฟกัสช่องกรอกไว้เสมอ (เครื่องยิงจะได้ยิงเข้าทันทีโดยไม่ต้องแตะจอ) + ปิดกล้องตอน unmount
  useEffect(() => {
    inputRef.current?.focus();
    return () => stopCam();
  }, [stopCam]);

  // Esc = ปิด (ไม่ใช่การคลิกพื้นหลัง — ยังกันข้อมูลหายตามกฎ §5)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submitTyped = () => {
    const v = typed.trim();
    if (!v) return;
    emit(v);
    inputRef.current?.focus();
  };

  const box = {
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
    padding: 18, width: 'min(440px,96vw)', maxHeight: '92vh', overflowY: 'auto',
  };

  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, zIndex: 2400, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>📷 {title}</h3>
          <button onClick={onClose} className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>{hint}</div>

        {/* กล้อง */}
        <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: camOn ? 'block' : 'none' }} />
          {!camOn && (
            <button onClick={startCam} className="tbtn"
              style={{ padding: '12px 22px', borderRadius: 10, border: '1.5px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              📷 เปิดกล้องสแกน
            </button>
          )}
          {camOn && (
            <>
              {/* กรอบเล็ง */}
              <div style={{ position: 'absolute', inset: '18%', border: '3px solid rgba(52,211,153,0.9)', borderRadius: 12, pointerEvents: 'none' }} />
              <button onClick={stopCam} className="tbtn"
                style={{ position: 'absolute', right: 8, bottom: 8, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
                ปิดกล้อง
              </button>
            </>
          )}
        </div>
        {camErr && <div style={{ marginTop: 8, fontSize: 12, color: '#f59e0b' }}>⚠️ {camErr}</div>}

        {/* เครื่องยิง / พิมพ์เอง */}
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>
            🔫 ยิงด้วยเครื่องสแกน หรือพิมพ์รหัสเอง
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input
              ref={inputRef}
              value={typed}
              onChange={e => {
                const v = e.target.value;
                // เครื่องยิงต่อท้ายด้วย \n — เจอเมื่อไหร่ = ยิงจบ ส่งเลย (ไม่ต้องรอกดปุ่ม)
                if (/[\r\n]/.test(v)) { setTyped(''); emit(v); return; }
                setTyped(v);
              }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } }}
              placeholder={isMobile && !kbd ? 'กดปุ่มสแกนข้างเครื่องได้เลย' : 'เช่น RB-104 หรือ ESM:M:…'}
              inputMode={isMobile && !kbd ? 'none' : undefined}
              style={{ flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: isMobile ? 16 : 14 }}
            />
            {isMobile && !kbd && (
              <button type="button" className="tbtn" onClick={() => { inputRef.current?.blur(); setKbd(true); setTimeout(() => inputRef.current?.focus(), 30); }}
                style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', flexShrink: 0 }}>
                ⌨️ พิมพ์เอง
              </button>
            )}
            <button onClick={submitTyped} className="tbtn"
              style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', flexShrink: 0 }}>
              ตกลง
            </button>
          </div>
        </div>

        {err && <div style={{ marginTop: 10, fontSize: 13, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '8px 11px' }}>✕ {err}</div>}
        {footer}
        {ok && !err && (okMsg
          ? <div style={{ marginTop: 10, fontSize: 15, fontWeight: 800, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 8, padding: '8px 11px' }}>{okMsg}</div>
          : <div style={{ marginTop: 10, fontSize: 13, color: '#22c55e' }}>✓ อ่านได้: <span style={{ fontFamily: 'monospace' }}>{ok}</span></div>)}
      </div>
    </div>
  );
}
