/* ══ 🔢 useCountUp — ตัวเลขวิ่งขึ้นสู่ค่าจริง (2026-11-24 · ของกลาง · รีล CRM Dashboard V10) ═══════
   · เล่น "ครั้งเดียวต่อสิ่งที่ดู" กติกาเดียวกับกราฟ (`chartAnim()` — หน้าต่าง 4 วิหลังเปลี่ยนหน้า/แท็บ) ⇒ รีเฟรชข้อมูลตามรอบ = เลขเปลี่ยนทันที ไม่วิ่งซ้ำ
   · นิ่งเมื่อ `motionOff()` (จอ TV role display / prefers-reduced-motion) — คืนค่าจริงทันที
   · รับเฉพาะตัวเลขจำกัด · `null`/สตริง = คืนตามเดิม (กฎความซื่อสัตย์ของจอ: "—" ต้องยังเป็น "—")
   · ใช้: `const shown = useCountUp(value); … {fmt(shown)}` — จัดรูป (ทศนิยม/คอมม่า) ที่ผู้เรียก เหมือนเดิม */
import { useEffect, useRef, useState } from 'react';
import { chartAnim, CHART_ANIM_MS } from './motion.js';

const ease = (t) => 1 - Math.pow(1 - t, 3);   // ease-out cubic — ช่วงท้ายช้าลง อ่านเลขสุดท้ายทัน

/** ค่าที่ hook "ควรคืน" ในเฟรมนี้ — pure เพื่อเทสได้ (25/11 · บั๊ก production: เปลี่ยน cost center แล้วจอ /obeya ล้ม)
 *  🔴 state `shown` ตามหลัง `target` 1 เฟรมเสมอ (อัปเดตใน effect) ⇒ แผ่นที่เมื่อกี้เป็น "—" (`null`) แล้วเพิ่งได้ตัวเลข
 *  เฟรมแรก state ยังเป็น `null` → ผู้เรียก `.toLocaleString()` บน null = TypeError ทั้งหน้า
 *  กติกา: target ไม่ใช่ตัวเลข = คืน target ทันที (ไม่ใช่ state ค้าง) · target เป็นตัวเลขแต่ state ยังไม่ใช่ = คืนจุดเริ่มวิ่ง (0 หรือค่าจริงเมื่อนิ่ง) */
export function countUpShown(target, state, active) {
  const num = typeof target === 'number' && Number.isFinite(target);
  if (!num) return target;
  if (typeof state === 'number' && Number.isFinite(state)) return state;
  return active ? 0 : target;
}

export default function useCountUp(target, { ms = CHART_ANIM_MS } = {}) {
  const num = typeof target === 'number' && Number.isFinite(target);
  const [shown, setShown] = useState(num ? (chartAnim().isAnimationActive ? 0 : target) : target);
  const fromRef = useRef(num ? 0 : target);
  useEffect(() => {
    if (!num) { setShown(target); fromRef.current = target; return undefined; }
    if (!chartAnim().isAnimationActive) { setShown(target); fromRef.current = target; return undefined; }
    const from = typeof fromRef.current === 'number' ? fromRef.current : 0;
    if (from === target) { setShown(target); return undefined; }
    let raf = 0; const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const v = from + (target - from) * ease(t);
      setShown(t >= 1 ? target : v);
      if (t < 1) raf = requestAnimationFrame(step); else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); fromRef.current = target; };
  }, [target, num, ms]);
  return countUpShown(target, shown, chartAnim().isAnimationActive);
}
