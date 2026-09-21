/* CalloutPin — หมุดจุดตรวจแบบ "callout" (ป้ายเลขหลบจุด + เส้น/ลูกศรชี้จุดจริง)
   แก้ปัญหาเดิมที่วงเลขทับจุดที่จะตรวจ (คำสั่ง user 2026-07-14) — ใช้ร่วมกันทุกที่ที่มีหมุดจุดตรวจ
   (QA drawing · PM spin: SpinAnnotator/PMSetup/PMCheckData) เพื่อให้เหมือนกันทั้งโปรเจค
   ดู docs/UI-CONVENTIONS.md §5.1

   🆕 2026-09-21 — **ลากป้ายเลขปรับทิศลูกศรเองได้** (feedback หน้างาน: จุดที่อยู่ใกล้กัน
   ได้ทิศอัตโนมัติเหมือนกันหมด ป้าย/ลูกศรเลยทับกันจนอ่านไม่ออก)
     · `offX/offY` = offset ของป้ายจากจุดจริง เป็น **% ของกล่องรูป** · null = ทิศอัตโนมัติแบบเดิมเป๊ะ
     · ส่ง `onLabelMove(dx, dy)` มาด้วย = เปิดโหมดลาก (ไม่ส่ง = อ่านอย่างเดียว เหมือนเดิมทุกหน้า)
     · เรขาคณิตอยู่ `src/utils/calloutGeom.js` จุดเดียว (pure · มีเทส) — ห้ามคำนวณซ้ำในหน้า

   วางใน layer = "กล่องรูปจริง" (หัก letterbox ด้วย useImgBox) ขนาด layerW × layerH px
   props:
     xPct, yPct : ตำแหน่ง "จุดจริง" เป็น % ของกล่องรูป (0..100)
     layerW,H   : ขนาดกล่องรูป (px) — ใช้คิดเรขาคณิตเส้น/ลูกศร + ทิศ offset
     size       : เส้นผ่านศูนย์กลางวงเลข (px)
     label,color: เลข/สีวง
     offX,offY  : ตำแหน่งป้ายที่คนตั้งเอง (% ของกล่องรูป · null = อัตโนมัติ)
     onLabelMove(dx,dy) : เรียกตอนปล่อยเมาส์หลังลากป้าย (dx,dy = % ของกล่องรูป)
     selected,dim,title
     onClick,onPointerDown : ผูกกับ "วงเลข" (ตัวคลิก) — จุด+เส้น+ลูกศรไม่รับคลิก */
import { useRef, useState } from 'react';
import { calloutLayout, offsetPctFromPx, movedEnough } from '../utils/calloutGeom';

export default function CalloutPin({
  xPct, yPct, layerW = 0, layerH = 0, size = 26, label, color = 'var(--accent)',
  selected, dim, opacity = 1, title, onClick, onPointerDown,
  offX = null, offY = null, onLabelMove,
  // 🔍 badge = สัญลักษณ์เล็กมุมวงเลข บอกว่าจุดนี้มี "รูปเจาะจุด" ให้กดดูซูมเข้าไปได้
  //    (feedback หน้างาน 2026-08-21: รูปมุมแคบดูไม่ออกว่าอยู่ตรงไหนของเครื่อง)
  badge,
}) {
  /* ตำแหน่งระหว่างลาก — เก็บใน state เพื่อให้เส้น/ลูกศรขยับตามนิ้วแบบสด
     (ถ้ารอ commit ตอนปล่อย คนจะไม่เห็นว่าลากไปไหน = เล็งไม่ได้) */
  const [drag, setDrag] = useState(null);   // { dx, dy } px ระหว่างลาก
  const dragRef = useRef(null);             // { x0, y0, base:{dx,dy}, moved }
  const canDrag = typeof onLabelMove === 'function';

  const geo = calloutLayout({ xPct, yPct, layerW, layerH, size, offX, offY });
  const { px, py } = geo;
  // ระหว่างลากใช้ตำแหน่งสด (clamp ด้วยสูตรเดียวกันผ่าน calloutLayout ไม่ให้ป้ายหลุดกล่อง)
  //   ⚠️ ต้องตั้งต้นจากตำแหน่งป้ายปัจจุบัน (geo.bx/by) ไม่ใช่จากจุดจริง — ไม่งั้นพอเริ่มลาก
  //      ป้ายจะกระโดดไปทับจุดก่อนแล้วค่อยขยับตามนิ้ว (เล็งไม่ได้)
  const live = drag
    ? calloutLayout({ xPct, yPct, layerW, layerH, size,
        offX: ((geo.bx + drag.dx - px) / (layerW || 1)) * 100,
        offY: ((geo.by + drag.dy - py) / (layerH || 1)) * 100 })
    : geo;
  const { bx, by } = live;

  const len = Math.hypot(bx - px, by - py) || 1;
  // ลูกศรเล็กชี้ไปที่จุดจริง (apex = จุด)
  const ux = (px - bx) / len, uy = (py - by) / len;   // ทิศ วง → จุด
  const ah = Math.max(7, size * 0.5), aw = ah * 0.62;  // ความยาว/ครึ่งฐานลูกศร
  const bxA = px - ux * ah, byA = py - uy * ah;         // ฐานลูกศร
  const perpX = -uy, perpY = ux;
  const arrow = `${px.toFixed(1)},${py.toFixed(1)} ${(bxA + perpX * aw).toFixed(1)},${(byA + perpY * aw).toFixed(1)} ${(bxA - perpX * aw).toFixed(1)},${(byA - perpY * aw).toFixed(1)}`;
  const op = dim ? 0.18 : opacity;

  const startDrag = (e) => {
    if (!canDrag) return;
    dragRef.current = { x0: e.clientX, y0: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && !movedEnough(dx, dy)) return;      // ยังไม่เกิน slop = ถือเป็นคลิก
    d.moved = true;
    setDrag({ dx, dy });
  };
  const endDrag = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d.moved) { setDrag(null); return; }           // แค่คลิก — ปล่อยให้ onClick ทำงานตามเดิม
    const off = offsetPctFromPx(px, py, bx, by, layerW, layerH);
    setDrag(null);
    if (off) onLabelMove(off.dx, off.dy);
  };

  return (
    <>
      {/* เส้น + ลูกศร (SVG ต่อหมุด — ครอบกล่องรูป, ไม่รับคลิก)
         มี "halo" มืดใต้เส้น + drop-shadow ให้เด้งบนพื้นหลังทุกสี (กันลูกศรจมกับภาพ — 2026-07-24) */}
      <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 9, opacity: op, filter: 'drop-shadow(0 1px 2.5px rgba(0,0,0,0.9))' }}>
        {/* เส้นเชื่อม: หัวลูกศร (จุดจริง) → วงเลข (ปลายเส้นลอดใต้วงเลขที่วาดทับ) · casing มืดใต้เส้นให้เด่นทุกพื้นหลัง */}
        <line x1={px} y1={py} x2={bx} y2={by} stroke="rgba(0,0,0,0.55)" strokeWidth={Math.max(4, size * 0.07 + 3)} strokeLinecap="round" />
        <line x1={px} y1={py} x2={bx} y2={by} stroke={color} strokeWidth={Math.max(2, size * 0.09)} strokeLinecap="round" />
        <polygon points={arrow} fill={color} stroke="#fff" strokeWidth={Math.max(1.6, size * 0.09)} strokeLinejoin="round" />
      </svg>
      {/* วงเลข (ตัวคลิก/ลาก) — หลบจากจุด */}
      <button type="button" title={title}
        onClick={e => {
          // ลากเสร็จแล้วเบราว์เซอร์ยังยิง click ต่อ — ต้องกลืนทิ้ง ไม่งั้น "ลากป้าย" = ลบหมุด/เปิด modal
          if (dragRef.current?.moved) { e.stopPropagation(); return; }
          onClick?.(e);
        }}
        onPointerDown={e => { startDrag(e); onPointerDown?.(e); }}
        onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        style={{ position: 'absolute', left: `${(bx / (layerW || 1)) * 100}%`, top: `${(by / (layerH || 1)) * 100}%`, transform: 'translate(-50%,-50%)', zIndex: drag ? 20 : 12, background: 'none', border: 'none', padding: 0, cursor: canDrag ? (drag ? 'grabbing' : 'grab') : ((onClick || onPointerDown) ? 'pointer' : 'default'), pointerEvents: (canDrag || onClick || onPointerDown) ? 'auto' : 'none', opacity: op, touchAction: 'none' }}>
        <div style={{ position: 'relative', minWidth: size, height: size, padding: `0 ${Math.round(size * 0.15)}px`, borderRadius: 999, background: color, border: `${selected ? 3 : 2}px solid #fff`, color: '#fff', fontSize: Math.max(11, Math.round(size * 0.45)), fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: selected ? '0 0 0 2px var(--accent), 0 2px 6px rgba(0,0,0,0.5)' : '0 2px 6px rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>
          {label}
          {badge && (
            <span style={{ position: 'absolute', right: -size * 0.18, bottom: -size * 0.18, width: size * 0.52, height: size * 0.52, borderRadius: '50%', background: '#fff', color: '#111', fontSize: Math.max(8, Math.round(size * 0.3)), lineHeight: `${size * 0.52}px`, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{badge}</span>
          )}
        </div>
      </button>
    </>
  );
}
