/* ─────────────────────────────────────────────────────────────────────────────
   🔄 มุมกล้องผังโรงงานโหมด 3D — ลากหมุน · ปุ่มหมุนทีละ 45° · ทัวร์หมุนเอง (15/10 · คำสั่ง user)
   · ลากซ้าย-ขวา = หมุนรอบโรงงาน · ขึ้น-ลง = ก้ม/เงย (สูตรใน `utils/mapPillar.js`)
   · ขยับเกิน DRAG_SLOP px = "ลาก" ⇒ กลืนคลิกที่ตามมา (ไม่งั้นปล่อยเมาส์บนกล่อง = เปิดไลน์เอง)
   · ทัวร์อัตโนมัติ = ขยับทีละ 45° ทุก 8 วิ พร้อม transition — **ห้าม rAF ทุกเฟรม**
     (ทุกเฟรม = render หน้าผังทั้งหน้า 60 ครั้ง/วิ จอ TV webOS ค้าง)
   · มุมที่ตั้งไว้จำต่อเครื่อง (localStorage — ความชอบรายเครื่อง ไม่ใช่ข้อมูลที่ต้องแชร์)
   ───────────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ORBIT_DEFAULT, clampTilt, normDeg, orbitFromDrag, DRAG_SLOP } from '../utils/mapPillar';

const LS_KEY = 'fm_orbit';
const AUTO_EVERY_MS = 8000;
const loadSaved = () => {
  try {
    const o = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (o && Number.isFinite(o.rot) && Number.isFinite(o.tilt)) return { rot: normDeg(o.rot), tilt: clampTilt(o.tilt) };
  } catch { /* ไม่มี/อ่านไม่ได้ = ใช้ค่าเริ่ม */ }
  return { ...ORBIT_DEFAULT };
};
const save = (o) => { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* ignore */ } };

export default function useMapOrbit(enabled) {
  const [cam, setCam] = useState(loadSaved);
  const [dragging, setDragging] = useState(false);
  const [auto, setAuto] = useState(false);
  const [animSlow, setAnimSlow] = useState(false);   // ก้าวของทัวร์ = transition ยาว
  const drag = useRef(null);        // { x, y, start, moved, id }
  const swallowClick = useRef(false);
  const raf = useRef(0);
  const pending = useRef(null);

  const commit = useCallback((next) => { setCam(next); save(next); }, []);
  const step = useCallback((deg) => { setAnimSlow(false); setCam(c => { const n = { ...c, rot: normDeg(c.rot + deg) }; save(n); return n; }); }, []);
  const tiltBy = useCallback((d) => { setAnimSlow(false); setCam(c => { const n = { ...c, tilt: clampTilt(c.tilt + d) }; save(n); return n; }); }, []);
  const reset = useCallback(() => { setAnimSlow(false); setAuto(false); commit({ ...ORBIT_DEFAULT }); }, [commit]);

  // ทัวร์หมุนเอง — ขยับทีละ 45° (render ทุก 8 วิ ไม่ใช่ทุกเฟรม)
  useEffect(() => {
    if (!enabled || !auto) return undefined;
    const t = setInterval(() => {
      if (drag.current) return;                     // กำลังลากอยู่ = ไม่แย่งมุม
      setAnimSlow(true);
      setCam(c => ({ ...c, rot: normDeg(c.rot + 45) }));   // ทัวร์ไม่เขียน localStorage (ปิดแล้วกลับมุมที่ตั้งไว้)
    }, AUTO_EVERY_MS);
    return () => clearInterval(t);
  }, [enabled, auto]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onPointerDown = useCallback((e) => {
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { x: e.clientX, y: e.clientY, start: cam, moved: false, id: e.pointerId, el: e.currentTarget };
  }, [enabled, cam]);

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      setDragging(true); setAuto(false); setAnimSlow(false);
      try { d.el.setPointerCapture(e.pointerId); } catch { /* บางเบราว์เซอร์ไม่รองรับ — ลากต่อได้ตราบที่เมาส์ยังอยู่ในกรอบ */ }
    }
    pending.current = orbitFromDrag(d.start, dx, dy);
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; if (pending.current) setCam(pending.current); });
  }, []);

  const endDrag = useCallback((e) => {
    const d = drag.current;
    if (!d || (e && d.id !== e.pointerId)) return;
    drag.current = null;
    if (d.moved) {
      swallowClick.current = true;
      setDragging(false);
      if (pending.current) { commit(pending.current); pending.current = null; }
    }
  }, [commit]);

  // คลิกที่ตามหลังการลาก = ไม่ใช่คลิกจริง ⇒ กลืนในเฟส capture ก่อนถึงกล่อง/กรอบ
  const onClickCapture = useCallback((e) => {
    if (swallowClick.current) { swallowClick.current = false; e.stopPropagation(); e.preventDefault(); }
  }, []);

  return {
    rot: cam.rot, tilt: cam.tilt, dragging, auto, setAuto, step, tiltBy, reset,
    transition: dragging ? 'none' : animSlow ? 'transform 2.4s ease-in-out' : 'transform .45s ease',
    handlers: enabled ? { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onClickCapture } : {},
  };
}
