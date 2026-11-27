/* 📺 KeepScreenAwake — กันทีวี/จอแขวนดับจอเอง (กติกา + เหตุผล → src/utils/keepAwake.js)
   2 ชั้น: (1) วิดีโอดำ 16px วนไม่มีเสียง (ทีวีไม่ปิดจอระหว่างเล่นสื่อ) (2) Screen Wake Lock ถ้ามี
   ⚠️ ห้าม `display:none` — เบราว์เซอร์หยุดเล่นวิดีโอที่ไม่ถูกวาด ⇒ ใช้ 1px โปร่งใสเกือบสุดแทน
   ⚠️ autoplay ได้เพราะ `muted` + `playsInline` · เล่นไม่ได้ก็เงียบ (ไม่ใช่ error ที่คนดูต้องรู้)
   ⚠️ Wake Lock ถูกปล่อยเองเมื่อแท็บซ่อน ⇒ ขอใหม่ตอนกลับมา (visibilitychange) */
import { useEffect, useRef } from 'react';

export default function KeepScreenAwake() {
  const vidRef = useRef(null);
  useEffect(() => {
    let lock = null;
    let alive = true;
    const askLock = async () => {
      try {
        if (!alive || document.visibilityState !== 'visible' || !navigator.wakeLock?.request) return;
        lock = await navigator.wakeLock.request('screen');
      } catch { /* ไม่รองรับ/ไม่อนุญาต — ยังมีชั้นวิดีโอ */ }
    };
    const kick = () => { vidRef.current?.play?.()?.catch?.(() => {}); };
    const onVis = () => { if (document.visibilityState === 'visible') { askLock(); kick(); } };
    askLock(); kick();
    document.addEventListener('visibilitychange', onVis);
    // บางเครื่องหยุดวิดีโอเงียบๆ หลังเน็ตสะดุด/สลับแอป — สะกิดทุก 5 นาที (ไม่ยิงอะไรออกนอกเครื่อง)
    const t = setInterval(() => { if (vidRef.current?.paused) kick(); }, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      try { lock?.release?.(); } catch { /* ปล่อยไม่ได้ก็ไม่เป็นไร */ }
    };
  }, []);
  return (
    <video ref={vidRef} muted loop playsInline autoPlay aria-hidden="true" tabIndex={-1}
      style={{ position: 'fixed', left: 0, bottom: 0, width: 1, height: 1, opacity: 0.01, pointerEvents: 'none', zIndex: -1 }}>
      <source src="/keep-awake.webm" type="video/webm" />
      <source src="/keep-awake.mp4" type="video/mp4" />
    </video>
  );
}
