/* 📺 TvFitBox — กล่องที่ "ต้องอ่านครบโดยไม่มีใครเลื่อน" บนจอ TV (2026-10-20 · คำสั่ง user)
   จอ TV = เปิดดูอย่างเดียว ไม่มีเมาส์/ทัช ⇒ กล่องที่ล้นแล้วต้อง scroll = ข้อมูลส่วนล่าง "ไม่มีใครเคยเห็น"
   · `enabled=false` (จอคอม/มือถือ) = `<aside style={style}>` เดิมเป๊ะ ไม่มีอะไรเปลี่ยน
   · `enabled=true` (กรอบจอ TV) = สูงพอดีที่ว่างถึงขอบล่างจอ แล้วย่อ/ขยายเนื้อในด้วย transform ให้พอดี
     (ไม่ใหญ่กว่า `maxScale` · ไม่เล็กกว่า `minScale`) · ย่อถึงพื้นแล้วยังล้น = เลื่อนขึ้นลงเองช้าๆ (ห้ามตัดทิ้งเงียบ)
   · ใช้ transform ไม่ใช่ CSS zoom — Cr94 (webOS) คิดค่าที่วัดได้ใต้ zoom ไม่ตรงกับ Chromium ใหม่ ⇒ วัด layout ล้วน
   · หน้าที่ใช้ต้องติด `data-tv-nofit` (ตัววนจอไม่ย่อทั้งหน้าซ้อนอีกชั้น) — UI §6.33 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const SCROLL_PX_PER_SEC = 28;
const HOLD_MS = 5000;

export default function TvFitBox({ enabled, style, tvStyle, innerStyle, maxScale = 1.45, minScale = 1, bottomGap = 16, children }) {
  const boxRef = useRef(null);
  const innerRef = useRef(null);
  const [fit, setFit] = useState({ h: null, w: null, s: maxScale, over: 0 });

  const measure = useCallback(() => {
    const box = boxRef.current, inner = innerRef.current;
    if (!box || !inner) return;
    const H = Math.max(200, Math.floor(window.innerHeight - box.getBoundingClientRect().top - bottomGap));
    const W = box.clientWidth;
    if (!W) return;
    // ความกว้างเนื้อใน = W/s ⇒ ตัดบรรทัดเปลี่ยนตาม s · วนสั้นๆ จนนิ่ง
    let s = maxScale;
    for (let i = 0; i < 4; i++) {
      inner.style.width = `${W / s}px`;
      const next = Math.max(minScale, Math.min(maxScale, H / Math.max(1, inner.offsetHeight)));
      if (Math.abs(next - s) < 0.005) { s = next; break; }
      s = next;
    }
    inner.style.width = `${W / s}px`;
    const raw = inner.offsetHeight * s - H;
    const over = raw > 2 ? Math.ceil(raw) : 0;   // เศษพิกเซลจากการปัด ≠ ล้นจริง
    setFit(f => (f.h === H && f.w === W && Math.abs(f.s - s) < 0.005 && f.over === over ? f : { h: H, w: W, s, over }));
  }, [maxScale, minScale, bottomGap]);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    measure();
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null;
    if (ro && innerRef.current) ro.observe(innerRef.current);
    const t = setTimeout(measure, 600);   // แถบ/ผังด้านบนที่โหลดทีหลังดันกล่องลง
    window.addEventListener('resize', later);
    return () => { ro?.disconnect(); clearTimeout(t); cancelAnimationFrame(raf); window.removeEventListener('resize', later); };
  }, [enabled, measure]);

  // ล้นทั้งที่ย่อถึงพื้นแล้ว ⇒ ค้างบนสุด → เลื่อนลงช้าๆ → ค้างล่างสุด → กลับขึ้น (วนตลอด)
  const [off, setOff] = useState(0);
  useEffect(() => {
    if (!enabled || !fit.over) { setOff(0); return undefined; }
    let alive = true, t = 0;
    const travel = (fit.over / SCROLL_PX_PER_SEC) * 1000;
    const down = () => { if (!alive) return; setOff(-fit.over); t = setTimeout(up, travel + HOLD_MS); };
    const up = () => { if (!alive) return; setOff(0); t = setTimeout(down, travel + HOLD_MS); };
    t = setTimeout(down, HOLD_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [enabled, fit.over]);

  if (!enabled) return <aside style={style}>{children}</aside>;
  const travelMs = fit.over ? Math.round((fit.over / SCROLL_PX_PER_SEC) * 1000) : 0;
  return (
    <aside ref={boxRef} data-tv-fit-scale={fit.s.toFixed(2)} data-tv-fit-over={fit.over || undefined}
      style={{ ...tvStyle, position: 'relative', overflow: 'hidden', height: fit.h ?? undefined }}>
      <div ref={innerRef} style={{ ...innerStyle, width: fit.w ? fit.w / fit.s : undefined, transformOrigin: '0 0',
        transform: `translateY(${off}px) scale(${fit.s})`, transition: travelMs ? `transform ${travelMs}ms linear` : undefined }}>
        {children}
      </div>
    </aside>
  );
}
