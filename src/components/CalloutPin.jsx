/* CalloutPin — หมุดจุดตรวจแบบ "callout" (ป้ายเลขหลบจุด + เส้น/ลูกศรชี้จุดจริง)
   แก้ปัญหาเดิมที่วงเลขทับจุดที่จะตรวจ (คำสั่ง user 2026-07-14) — ใช้ร่วมกันทุกที่ที่มีหมุดจุดตรวจ
   (QA drawing · PM spin: SpinAnnotator/PMSetup/PMCheckData) เพื่อให้เหมือนกันทั้งโปรเจค
   ดู docs/UI-CONVENTIONS.md §5.1

   วางใน layer = "กล่องรูปจริง" (หัก letterbox ด้วย useImgBox) ขนาด layerW × layerH px
   props:
     xPct, yPct : ตำแหน่ง "จุดจริง" เป็น % ของกล่องรูป (0..100)
     layerW,H   : ขนาดกล่องรูป (px) — ใช้คิดเรขาคณิตเส้น/ลูกศร + ทิศ offset
     size       : เส้นผ่านศูนย์กลางวงเลข (px)
     label,color: เลข/สีวง
     selected,dim,title
     onClick,onPointerDown : ผูกกับ "วงเลข" (ตัวลาก/คลิก) — จุด+เส้น+ลูกศรไม่รับคลิก */
export default function CalloutPin({
  xPct, yPct, layerW = 0, layerH = 0, size = 26, label, color = 'var(--accent)',
  selected, dim, opacity = 1, title, onClick, onPointerDown,
  // 🔍 badge = สัญลักษณ์เล็กมุมวงเลข บอกว่าจุดนี้มี "รูปเจาะจุด" ให้กดดูซูมเข้าไปได้
  //    (feedback หน้างาน 2026-08-21: รูปมุมแคบดูไม่ออกว่าอยู่ตรงไหนของเครื่อง)
  badge,
}) {
  const clamp = (v) => Math.min(100, Math.max(0, v));
  // จุดจริง (px ในกล่องรูป)
  const px = (clamp(xPct) / 100) * layerW;
  const py = (clamp(yPct) / 100) * layerH;
  // ทิศ offset ของวงเลข — หลบขอบ: ใกล้ขวาไปซ้าย, ใกล้บนไปล่าง (default ขึ้นบน-ขวา)
  const off = size * 1.55;
  const dirX = xPct > 72 ? -1 : 1;
  const dirY = yPct < 22 ? 1 : -1;
  let bx = px + dirX * off, by = py + dirY * off;
  // clamp วงเลขไม่ให้หลุดกล่อง
  const m = size * 0.7;
  bx = Math.min(layerW - m, Math.max(m, bx));
  by = Math.min(layerH - m, Math.max(m, by));
  const len = Math.hypot(bx - px, by - py) || 1;
  // ลูกศรเล็กชี้ไปที่จุดจริง (apex = จุด)
  const ux = (px - bx) / len, uy = (py - by) / len;   // ทิศ วง → จุด
  const ah = Math.max(7, size * 0.5), aw = ah * 0.62;  // ความยาว/ครึ่งฐานลูกศร
  const bxA = px - ux * ah, byA = py - uy * ah;         // ฐานลูกศร
  const perpX = -uy, perpY = ux;
  const arrow = `${px.toFixed(1)},${py.toFixed(1)} ${(bxA + perpX * aw).toFixed(1)},${(byA + perpY * aw).toFixed(1)} ${(bxA - perpX * aw).toFixed(1)},${(byA - perpY * aw).toFixed(1)}`;
  const op = dim ? 0.18 : opacity;

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
      <button type="button" onClick={onClick} onPointerDown={onPointerDown} title={title}
        style={{ position: 'absolute', left: `${(bx / layerW) * 100}%`, top: `${(by / layerH) * 100}%`, transform: 'translate(-50%,-50%)', zIndex: 12, background: 'none', border: 'none', padding: 0, cursor: (onClick || onPointerDown) ? 'pointer' : 'default', pointerEvents: (onClick || onPointerDown) ? 'auto' : 'none', opacity: op, touchAction: 'none' }}>
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
