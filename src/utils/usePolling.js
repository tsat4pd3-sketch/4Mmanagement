import { useEffect, useRef } from 'react';

/* ── usePolling — ตัวจับเวลา refresh ที่ "หยุดยิง DB เมื่อไม่มีคนดู" ─────────────────
   แทน `useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t) }, [load])`

   ทำไมต้องมี (2026-08-19 · หลัง Supabase ขึ้นเตือนโควต้าหมด grace period):
   จอ TV / มือถือหัวหน้า / แท็บที่เปิดค้าง poll ทุก 30 วิ ตลอด 24 ชม. โดยไม่มีใครดู
   → egress ทะลุโควต้า Free (5 GB/เดือน) ทั้งที่ DB+Storage ใช้ไม่ถึง 25%
   วัดจากโค้ดจริง: FactoryMap จอเดียว ≈ 15 MB/ชม. = ~11 GB/เดือน (2 เท่าของโควต้าทั้งเดือน)

   พฤติกรรม:
   - แท็บถูกซ่อน (สลับแอป/ล็อกจอ/ย่อหน้าต่าง) → หยุดจับเวลา ไม่ยิง DB เลย
   - กลับมาเห็นจอ → ถ้าข้อมูลเก่าเกิน ms แล้ว รีเฟรชทันที (ไม่ต้องรอครบรอบ) แล้วเดินจับเวลาต่อ
   - จอ TV ที่เปิดค้างตลอด = visible ตลอด → พฤติกรรมเหมือนเดิมเป๊ะ ความสดไม่ลด

   ⚠️ `fn` อยู่ใน deps เหมือน setInterval เดิม → identity เปลี่ยน = โหลดใหม่ทันที (พฤติกรรมเดิม)
      ฉะนั้น `fn` ต้องเป็น useCallback ที่ deps นิ่ง ไม่งั้นจะยิงรัวทุก render (กฎเดิมของ setInterval)   */
export function usePolling(fn, ms, opts = {}) {
  const { enabled = true, immediate = true } = opts;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || !(ms > 0)) return;
    let timer = null, lastRun = 0, dead = false;

    const run = () => {
      if (dead) return;
      lastRun = Date.now();
      try { fnRef.current?.(); } catch (e) { console.error('[usePolling]', e); }
    };
    const stop  = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => { stop(); timer = setInterval(run, ms); };

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastRun >= ms) run();   // ข้อมูลเก่าแล้ว — อย่าให้คนดูเห็นของค้าง
        start();
      } else {
        stop();                                  // ไม่มีคนดู = ไม่ต้องจ่าย egress
      }
    };

    if (immediate) run();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [fn, ms, enabled, immediate]);
}

/* ── visibleInterval — เวอร์ชัน "ไม่ใช่ hook" สำหรับ effect ที่มีของอื่นปนอยู่แล้ว ─────────
   (realtime channel / debounce timer / flag alive ฯลฯ — พวกที่ยกมาเป็น usePolling ไม่ได้ตรงๆ)

   ใช้แทน `const t = setInterval(fn, ms)` → `const stopPoll = visibleInterval(fn, ms)`
   แล้วใน cleanup เรียก `stopPoll()` แทน `clearInterval(t)`

   ⚠️ ไม่ยิง fn ทันทีตอนเรียก (ผู้เรียกมักโหลดครั้งแรกเองอยู่แล้ว — จะได้ไม่ยิงซ้ำ)
   คืนฟังก์ชัน cleanup   */
export function visibleInterval(fn, ms) {
  let timer = null, lastRun = Date.now();
  const run   = () => { lastRun = Date.now(); try { fn(); } catch (e) { console.error('[visibleInterval]', e); } };
  const stop  = () => { if (timer) { clearInterval(timer); timer = null; } };
  const start = () => { stop(); timer = setInterval(run, ms); };
  const onVis = () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - lastRun >= ms) run();
      start();
    } else stop();
  };
  if (document.visibilityState === 'visible') start();
  document.addEventListener('visibilitychange', onVis);
  return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
}

export default usePolling;
