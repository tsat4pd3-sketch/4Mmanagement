/* ─────────────────────────────────────────────────────────────────────────────
   🔄 มุมกล้องผังโรงงานโหมด 3D — ลากหมุน · ปุ่มหมุนทีละ 15° (ไม่เกิน ±45°) · ทัวร์หมุนเอง (15/10 · คำสั่ง user)
   · ลากซ้าย-ขวา = หมุนรอบโรงงาน · ขึ้น-ลง = ก้ม/เงย (สูตรใน `utils/mapPillar.js`)
   · ขยับเกิน DRAG_SLOP px = "ลาก" ⇒ กลืนคลิกที่ตามมา (ไม่งั้นปล่อยเมาส์บนกล่อง = เปิดไลน์เอง)
   · 🔴 หมุนรอบแกนตั้งอย่างเดียว และไม่ครบรอบ — ±45° จากมุมเริ่ม (`clampRot`) · ก้ม/เงย 25–70°
   · ทัวร์อัตโนมัติ = แกว่งไป-กลับทีละ 22.5° ทุก 8 วิ พร้อม transition — **ห้าม rAF ทุกเฟรม**
     (ทุกเฟรม = render หน้าผังทั้งหน้า 60 ครั้ง/วิ จอ TV webOS ค้าง)
   · มุมที่ตั้งไว้จำต่อเครื่อง (localStorage — ความชอบรายเครื่อง ไม่ใช่ข้อมูลที่ต้องแชร์)
   🔍 ซูม/เลื่อน (19/10): ล้อเมาส์ = ซูมเข้าหาจุดที่ชี้ · 2 นิ้ว = ถ่าง/เลื่อน · Shift/ปุ่มขวา/ปุ่มกลางลาก = เลื่อน · ปุ่ม ＋ －
     · ซูมไม่จำ (เปิดหน้าใหม่ = พอดีกรอบ) · wheel ต้องผูก native `{ passive:false }` — onWheel ของ React เป็น passive
       preventDefault ไม่ได้ = ทั้งหน้าเลื่อนตามไปด้วย
   ───────────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ORBIT_DEFAULT, clampTilt, clampRot, orbitFromDrag, tourNext, DRAG_SLOP, VIEW_DEFAULT, zoomAt, clampPan } from '../utils/mapPillar';

const LS_KEY = 'fm_orbit';
const AUTO_EVERY_MS = 8000;
const loadSaved = () => {
  try {
    const o = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (o && Number.isFinite(o.rot) && Number.isFinite(o.tilt)) return { rot: clampRot(o.rot), tilt: clampTilt(o.tilt) };
  } catch { /* ไม่มี/อ่านไม่ได้ = ใช้ค่าเริ่ม */ }
  return { ...ORBIT_DEFAULT };
};
const save = (o) => { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* ignore */ } };

/** จุดกลางกรอบผัง "ก่อนแปลง" บนจอ (= transform-origin) — rect ของตัวที่ถูกแปลงเชื่อไม่ได้ ใช้ offset ที่ไม่สนใจ transform */
function originOf(el) {
  const par = el?.offsetParent;
  if (!el || !par) return null;
  const r = par.getBoundingClientRect();
  return { x: r.left + par.clientLeft + el.offsetLeft + el.offsetWidth / 2, y: r.top + par.clientTop + el.offsetTop + el.offsetHeight / 2, W: el.offsetWidth, H: el.offsetHeight };
}

/** @param wrapRef กรอบผังที่ถูกแปลง (ใช้หาจุดกลาง/ขนาดตอนซูม) */
export default function useMapOrbit(enabled, wrapRef) {
  const [cam, setCam] = useState(loadSaved);
  const [dragging, setDragging] = useState(false);
  const [auto, setAuto] = useState(false);
  const [animSlow, setAnimSlow] = useState(false);   // ก้าวของทัวร์ = transition ยาว
  const [view, setView] = useState(VIEW_DEFAULT);    // { zoom, px, py } — ไม่จำข้ามการเปิดหน้า
  const [fast, setFast] = useState(false);           // ล้อเมาส์ = transition สั้น (ยาวไป = รู้สึกหน่วง)
  const viewRef = useRef(view); viewRef.current = view;
  const pts = useRef(new Map());   // นิ้ว/เมาส์ที่กดอยู่ — 2 จุด = ถ่างซูม
  const pinch = useRef(null);      // { d, mx, my, start }
  const pendingView = useRef(null);
  const rootEl = useRef(null);
  const tourDir = useRef(1);
  const drag = useRef(null);        // { x, y, start, moved, id }
  const swallowClick = useRef(false);
  const raf = useRef(0);
  const pending = useRef(null);

  const commit = useCallback((next) => { setCam(next); save(next); }, []);
  const step = useCallback((deg) => { setAnimSlow(false); setCam(c => { const n = { ...c, rot: clampRot(c.rot + deg) }; save(n); return n; }); }, []);
  const tiltBy = useCallback((d) => { setAnimSlow(false); setCam(c => { const n = { ...c, tilt: clampTilt(c.tilt + d) }; save(n); return n; }); }, []);
  const reset = useCallback(() => { setAnimSlow(false); setFast(false); setAuto(false); setView(VIEW_DEFAULT); commit({ ...ORBIT_DEFAULT }); }, [commit]);
  /** ซูมคูณ k รอบจุดบนจอ (cx,cy) — ไม่ส่ง = รอบกลางผัง */
  const zoomBy = useCallback((k, cx, cy, quick = false) => {
    const o = originOf(wrapRef?.current);
    setAnimSlow(false); setFast(quick);
    setView(v => zoomAt(v, k, o && cx != null ? cx - o.x : 0, o && cy != null ? cy - o.y : 0, o?.W, o?.H));
  }, [wrapRef]);
  const scheduleView = (v) => {
    pendingView.current = v;
    if (!raf.current) raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (pending.current) setCam(pending.current);
      if (pendingView.current) setView(pendingView.current);
    });
  };

  // ทัวร์ — แกว่งไป-กลับทีละ 22.5° (render ทุก 8 วิ ไม่ใช่ทุกเฟรม)
  useEffect(() => {
    if (!enabled || !auto) return undefined;
    const t = setInterval(() => {
      if (drag.current) return;                     // กำลังลากอยู่ = ไม่แย่งมุม
      setAnimSlow(true);
      setCam(c => { const t = tourNext(c.rot, tourDir.current); tourDir.current = t.dir; return { ...c, rot: t.rot }; });   // ทัวร์ไม่เขียน localStorage
    }, AUTO_EVERY_MS);
    return () => clearInterval(t);
  }, [enabled, auto]);

  /* 🔁 สลับ 2D ⇄ 3D = เปลี่ยนภาพทันที ห้ามมี transition (19/10 · user "จอค่อยๆ วูมเอ้าตอนสลับ 3D/2D")
     ทรานสิชันมีไว้ให้ "กล้องขยับใน 3D" ลื่น · แต่ตอนสลับโหมด transform ทั้งก้อน (เอียง+ย่อพอดีกรอบ) โผล่/หายในเฟรมเดียว
     ⇒ .45s ease เล่นเป็นภาพ "ค่อยๆ ซูมออก" (เข้า 3D) / "ค่อยๆ ซูมเข้า" (กลับ 2D) ทุกครั้งที่กด
     `switching` = render ที่ enabled เพิ่งเปลี่ยน → transition:none · 2 เฟรมถัดไปค่อยคืนค่า (transform ไม่เปลี่ยนแล้ว = ไม่มีอะไรเล่น) */
  const [settledFor, setSettledFor] = useState(enabled);
  const switching = settledFor !== enabled;
  useEffect(() => {
    if (!switching) return undefined;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => setSettledFor(enabled)); });
    return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2); };
  }, [switching, enabled]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { if (!enabled) { setView(VIEW_DEFAULT); pts.current.clear(); pinch.current = null; } }, [enabled]);

  // 🔍 ล้อเมาส์ — native listener (passive:false) ไม่งั้น preventDefault ไม่ได้ ทั้งหน้าเลื่อนตาม
  const [rootNode, setRootNode] = useState(null);
  const rootRef = useCallback((el) => { rootEl.current = el; setRootNode(el); }, []);
  useEffect(() => {
    if (!enabled || !rootNode) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey && Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;   // Firefox ส่งเป็นบรรทัด
      zoomBy(Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0015), e.clientX, e.clientY, true);
    };
    rootNode.addEventListener('wheel', onWheel, { passive: false });
    return () => rootNode.removeEventListener('wheel', onWheel);
  }, [enabled, rootNode, zoomBy]);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    // ถ่างได้เฉพาะนิ้ว/ปากกา — เมาส์ปล่อยนอกกรอบแล้วไม่มี pointerup จะค้างในชุดนี้ = นับเป็น "2 นิ้ว" ผิดๆ
    if (e.pointerType !== 'mouse') pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {   // นิ้วที่ 2 = เลิกหมุน เริ่มถ่างซูม/เลื่อน
      const [a, b] = [...pts.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, start: viewRef.current };
      if (drag.current?.moved) swallowClick.current = true;
      drag.current = null; pending.current = null;
      setDragging(true); setAuto(false); setAnimSlow(false); setFast(false);
      return;
    }
    if (pts.current.size > 2) return;
    // Shift / ปุ่มกลาง / ปุ่มขวา = เลื่อนผัง · ปุ่มซ้าย/นิ้วเดียว = หมุน
    const pan = e.pointerType === 'mouse' && (e.shiftKey || e.button === 1 || e.button === 2);
    if (e.pointerType === 'mouse' && e.button !== 0 && !pan) return;
    if (e.button === 1) e.preventDefault();   // ปุ่มกลาง = ไม่ให้เบราว์เซอร์เข้าโหมดเลื่อนอัตโนมัติ
    drag.current = { x: e.clientX, y: e.clientY, start: cam, startView: viewRef.current, pan, moved: false, id: e.pointerId, el: e.currentTarget };
  }, [enabled, cam]);

  const onPointerMove = useCallback((e) => {
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const o = originOf(wrapRef?.current);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const z = zoomAt(pz.start, Math.hypot(a.x - b.x, a.y - b.y) / pz.d, o ? pz.mx - o.x : 0, o ? pz.my - o.y : 0, o?.W, o?.H);
      scheduleView(clampPan({ ...z, px: z.px + mx - pz.mx, py: z.py + my - pz.my }, o?.W, o?.H));
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      setDragging(true); setAuto(false); setAnimSlow(false);
      try { d.el.setPointerCapture(e.pointerId); } catch { /* บางเบราว์เซอร์ไม่รองรับ — ลากต่อได้ตราบที่เมาส์ยังอยู่ในกรอบ */ }
    }
    if (d.pan) {
      const o = originOf(wrapRef?.current);
      scheduleView(clampPan({ ...d.startView, px: d.startView.px + dx, py: d.startView.py + dy }, o?.W, o?.H));
      return;
    }
    pending.current = orbitFromDrag(d.start, dx, dy);
    scheduleView(null);
  }, [wrapRef]);

  const endDrag = useCallback((e) => {
    if (e) pts.current.delete(e.pointerId);
    if (pinch.current) {
      if (pts.current.size < 2) { pinch.current = null; swallowClick.current = true; setDragging(false); drag.current = null; }
      return;
    }
    const d = drag.current;
    if (!d || (e && d.id !== e.pointerId)) return;
    drag.current = null;
    if (d.moved) {
      swallowClick.current = true;
      setDragging(false);
      if (pending.current) { commit(pending.current); pending.current = null; }
    }
  }, [commit]);
  // ปุ่มขวาลากเลื่อนผัง = ห้ามเด้งเมนูคลิกขวา
  const onContextMenu = useCallback((e) => { e.preventDefault(); }, []);

  // คลิกที่ตามหลังการลาก = ไม่ใช่คลิกจริง ⇒ กลืนในเฟส capture ก่อนถึงกล่อง/กรอบ
  const onClickCapture = useCallback((e) => {
    if (swallowClick.current) { swallowClick.current = false; e.stopPropagation(); e.preventDefault(); }
  }, []);

  return {
    rot: cam.rot, tilt: cam.tilt, dragging, auto, setAuto, step, tiltBy, reset,
    zoom: view.zoom, px: view.px, py: view.py, zoomBy, rootRef,
    transition: dragging || switching ? 'none' : animSlow ? 'transform 2.4s ease-in-out' : fast ? 'transform .12s ease-out' : 'transform .45s ease',
    handlers: enabled ? { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onClickCapture, onContextMenu } : {},
  };
}
