/* ─────────────────────────────────────────────────────────────────────────────
   🧊 เสาสถานะบนผังโรงงานโหมด 3D (2.5D · 2026-10-14 · mockup)
   วาดเป็น "ลูก" ของผังที่ถูกเอียงด้วย MAP_3D_TRANSFORM — ใช้ CSS 3D transform ล้วน (ไม่มี WebGL)
   ⇒ ผ่านจอ TV Chromium 94 · ไม่ต้องมีโมเดลอาคาร/เครื่องจักร ใช้กรอบไลน์ที่ตีไว้แล้ว
   ⚠️ ป้ายบนหัวเสาต้อง "หมุนกลับ" ด้วยมุมเดียวกับผัง (MAP_TILT_X / MAP_ROT_Z) ไม่งั้นป้ายนอนราบอ่านไม่ออก
   ───────────────────────────────────────────────────────────────────────────── */
export const MAP_TILT_X = 48;   // องศาเอียงผังลง
export const MAP_ROT_Z = -28;   // หมุนผังให้เป็นมุมเฉียง
export const MAP_3D_SCALE = 0.72;
export const MAP_3D_TRANSFORM = `rotateX(${MAP_TILT_X}deg) rotateZ(${MAP_ROT_Z}deg) scale(${MAP_3D_SCALE})`;

const shade = (hex, f) => {   // f < 1 = มืดลง (ด้านข้างเสา) — alpha-hex ห้าม color-mix (Cr94)
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

/**
 * @param {{ items: Array<{key,name,x,y,color,h,blink,text,dim}>, maxH:number, size:number,
 *           onOpen:(name)=>void, onHover:(name|null, e?)=>void }} props
 */
export default function MapPillars3D({ items, maxH, size, onOpen, onHover }) {
  const W = size;
  return items.map(it => {
    const H = Math.max(4, Math.round(it.h * maxH));
    const faces = [0, 1, 2, 3].map(k => (
      <div key={k} style={{
        position: 'absolute', left: -W / 2, top: -H, width: W, height: H,
        transformOrigin: 'bottom center',
        transform: `rotateZ(${k * 90}deg) translateY(${W / 2}px) rotateX(-90deg)`,
        background: `linear-gradient(0deg, ${shade(it.color, [0.55, 0.8, 0.45, 0.7][k])}, ${shade(it.color, [0.85, 1.05, 0.7, 0.95][k])})`,
        opacity: it.dim ? 0.55 : 0.95,
      }} />
    ));
    return (
      <div key={it.key}
        style={{ position: 'absolute', left: `${it.x}%`, top: `${it.y}%`, width: 0, height: 0, transformStyle: 'preserve-3d', cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onOpen(it.name); }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover(it.name, e); }}
        onPointerMove={(e) => { if (e.pointerType === 'mouse') onHover(it.name, e); }}
        onPointerLeave={() => onHover(null)}>
        {/* เงาบนพื้น */}
        <div style={{ position: 'absolute', left: -W * 0.9, top: -W * 0.9, width: W * 1.8, height: W * 1.8, borderRadius: '50%', background: 'radial-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)' }} />
        {faces}
        {/* ฝาบน */}
        <div className={it.blink ? 'dt-alarm-blink' : undefined}
          style={{ position: 'absolute', left: -W / 2, top: -W / 2, width: W, height: W, transform: `translateZ(${H}px)`, background: shade(it.color, 1.15), border: '1px solid rgba(255,255,255,0.35)', boxSizing: 'border-box' }} />
        {/* ป้ายหัวเสา — หมุนกลับให้หันหน้าเข้าจอ */}
        <div style={{ position: 'absolute', left: 0, top: 0, transform: `translateZ(${H + 6}px) rotateZ(${-MAP_ROT_Z}deg) rotateX(${-MAP_TILT_X}deg) translate(-50%, -100%)`, pointerEvents: 'auto' }}>
          <div style={{ background: 'rgba(8,10,16,0.88)', border: `1px solid ${it.color}`, borderBottom: `3px solid ${it.color}`, borderRadius: 7, padding: '2px 8px 3px', textAlign: 'center', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-float)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', lineHeight: 1.25 }}>
              {it.blink && <span className="dt-alarm-icon" style={{ color: '#ef4444' }}>🔴 </span>}{it.name}
            </div>
            {it.text && <div style={{ fontSize: 11, fontWeight: 800, color: it.color, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>{it.text}</div>}
          </div>
        </div>
      </div>
    );
  });
}
