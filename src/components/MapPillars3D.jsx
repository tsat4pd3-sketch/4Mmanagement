/* ─────────────────────────────────────────────────────────────────────────────
   🧊 เสาสถานะบนผังโรงงานโหมด 3D (2.5D · 2026-10-14 · mockup)
   วาดเป็น "ลูก" ของผังที่ถูกเอียงด้วย MAP_3D_TRANSFORM — ใช้ CSS 3D transform ล้วน (ไม่มี WebGL)
   ⇒ ผ่านจอ TV Chromium 94 · ไม่ต้องมีโมเดลอาคาร/เครื่องจักร ใช้กรอบไลน์ที่ตีไว้แล้ว
   ⚠️ ป้ายบนหัวเสาต้อง "หมุนกลับ" ด้วยมุมเดียวกับผัง (MAP_TILT_X / MAP_ROT_Z) ไม่งั้นป้ายนอนราบอ่านไม่ออก
   🏢 15/10 (คำสั่ง user "กรอบที่เคยตีไว้น่าจะขึ้นเป็นกล่อง"): กรอบไลน์ = **กล่องโปร่งแสงยกจากรูปทรงกรอบจริง**
      (ผนังต่อขอบ 1 แผ่น + หลังคา clip-path ตามรูป polygon) · เสาผอมเหลือเฉพาะ "▣ กลุ่ม" (กรอบแม่อัตโนมัติ)
   ───────────────────────────────────────────────────────────────────────────── */
export const MAP_TILT_X = 48;   // องศาเอียงผังลง
export const MAP_ROT_Z = -28;   // หมุนผังให้เป็นมุมเฉียง
export const MAP_3D_SCALE = 0.72;
export const MAP_3D_TRANSFORM = `rotateX(${MAP_TILT_X}deg) rotateZ(${MAP_ROT_Z}deg) scale(${MAP_3D_SCALE})`;

const rgbOf = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const shade = (hex, f, a = 1) => {   // f < 1 = มืดลง · alpha แยก — ห้าม color-mix (Cr94)
  const c = rgbOf(hex).map(v => Math.max(0, Math.min(255, Math.round(v * f))));
  return a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
};
const LIGHT = rad(-135);   // แสงจากมุมซ้ายบนของผัง — ผนังหันหาแสงสว่างกว่า
function rad(d) { return d * Math.PI / 180; }

/** ป้ายลอยบนยอด (กล่อง/เสา) + เส้นโยงลงเมื่อถูกยกหลบ — หมุนกลับให้หันหน้าเข้าจอ */
function TopLabel({ it, H, lift, ok, x = 0, y = 0 }) {
  if (!ok) return null;   // ยกจนเพดานแล้วยังทับ = ไม่วาด (หัวผังนับให้เห็น · ชี้/แตะดูการ์ดได้)
  return (
    <>
      {lift > 0 && (
        <div style={{ position: 'absolute', left: x - 1, top: y - (lift + 6), width: 2, height: lift + 6, transformOrigin: 'bottom center',
          transform: `translateZ(${H}px) rotateX(-90deg)`, background: it.color, opacity: 0.85 }} />
      )}
      <div style={{ position: 'absolute', left: x, top: y, transform: `translateZ(${H + 6 + lift}px) rotateZ(${-MAP_ROT_Z}deg) rotateX(${-MAP_TILT_X}deg) translate(-50%, -100%)`, pointerEvents: 'auto' }}>
        <div style={{ background: 'rgba(8,10,16,0.88)', border: `${it.group ? '2px dashed' : '1px solid'} ${it.color}`, borderBottom: `3px ${it.group ? 'dashed' : 'solid'} ${it.color}`, borderRadius: 7, padding: '2px 8px 3px', textAlign: 'center', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-float)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', lineHeight: 1.25 }}>
            {it.blink && <span className="dt-alarm-icon" style={{ color: '#ef4444' }}>🔴 </span>}{it.group ? '▣ ' : ''}{it.name}
            {it.group && it.kids > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.62)', marginLeft: 5 }}>{it.kids} ไลน์</span>}
          </div>
          {it.text && <div style={{ fontSize: 11, fontWeight: 800, color: it.color, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>{it.text}</div>}
        </div>
      </div>
    </>
  );
}

/** ▣ เสากลุ่ม (กรอบแม่อัตโนมัติ) — หอสี่เหลี่ยม ป้ายขอบประ (กติกาเดียวกับป้ายกลุ่ม 2D) */
function Pillar({ it, H, W, lift, ok }) {
  return (
    <>
      <div style={{ position: 'absolute', left: -W * 0.9, top: -W * 0.9, width: W * 1.8, height: W * 1.8, borderRadius: '50%', background: 'radial-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)' }} />
      {[0, 1, 2, 3].map(k => (
        <div key={k} style={{
          position: 'absolute', left: -W / 2, top: -H, width: W, height: H, transformOrigin: 'bottom center',
          transform: `rotateZ(${k * 90}deg) translateY(${W / 2}px) rotateX(-90deg)`,
          background: `linear-gradient(0deg, ${shade(it.color, [0.55, 0.8, 0.45, 0.7][k])}, ${shade(it.color, [0.85, 1.05, 0.7, 0.95][k])})`,
          opacity: it.dim ? 0.55 : 0.95,
        }} />
      ))}
      <div className={it.blink ? 'dt-alarm-blink' : undefined}
        style={{ position: 'absolute', left: -W / 2, top: -W / 2, width: W, height: W, transform: `translateZ(${H}px)`, background: shade(it.color, 1.15), border: '1px solid rgba(255,255,255,0.35)', boxSizing: 'border-box' }} />
      <TopLabel it={it} H={H} lift={lift} ok={ok} />
    </>
  );
}

/** 🏢 กล่องจากกรอบไลน์ — ผนังโปร่งแสง 1 แผ่นต่อขอบ + หลังคาตามรูปทรงกรอบ (clip-path) · พิกัด px ของผังก่อนเอียง */
function Block({ it, H, lift, ok, wPx, hPx }) {
  const pts = it.pts.map(([x, y]) => [x / 100 * wPx, y / 100 * hPx]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), bw = Math.max(1, Math.max(...xs) - x0), bh = Math.max(1, Math.max(...ys) - y0);
  const cx = xs.reduce((a, v) => a + v, 0) / xs.length, cy = ys.reduce((a, v) => a + v, 0) / ys.length;
  const a = it.dim ? 0.5 : 1;
  return (
    <>
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 0.5) return null;
        const th = Math.atan2(q[1] - p[1], q[0] - p[0]);
        const f = 0.62 + 0.38 * Math.max(0, Math.cos(th - Math.PI / 2 - LIGHT));   // ทิศที่ผนังหันออก vs แสง
        return (
          <div key={i} style={{
            position: 'absolute', left: p[0], top: p[1] - H, width: L, height: H, transformOrigin: '0 100%',
            transform: `rotateZ(${th}rad) rotateX(-90deg)`,
            background: `linear-gradient(0deg, ${shade(it.color, f, 0.62 * a)}, ${shade(it.color, f, 0.16 * a)})`,
            borderTop: `2px solid ${shade(it.color, 1.15, 0.95 * a)}`, boxSizing: 'border-box',
          }} />
        );
      })}
      {/* หลังคา = รูปทรงกรอบจริง (clip-path polygon · Cr55+) ยกขึ้น H */}
      <div className={it.blink ? 'dt-alarm-blink' : undefined} style={{
        position: 'absolute', left: x0, top: y0, width: bw, height: bh, transform: `translateZ(${H}px)`,
        clipPath: `polygon(${pts.map(([x, y]) => `${((x - x0) / bw * 100).toFixed(2)}% ${((y - y0) / bh * 100).toFixed(2)}%`).join(', ')})`,
        background: shade(it.color, 1, 0.34 * a),
      }} />
      <TopLabel it={it} H={H} lift={lift} ok={ok} x={cx} y={cy} />
    </>
  );
}

/**
 * @param {{ items: Array<{key,name,x,y,color,h,blink,text,dim,group?,kids?,pts?}>, maxH:number, size:number,
 *           lifts:Map, wPx:number, hPx:number, onOpen:(name)=>void, onHover:(name|null, e?)=>void }} props
 * · `pts` (กรอบไลน์ · % ของผัง) = วาดเป็นกล่อง · ไม่มี `pts` (▣ กลุ่ม) = เสา
 * · lifts = ผล `liftLabels()` (คิดที่หน้าแม่ เพื่อให้หัวผังนับป้ายที่วางไม่ได้)
 */
export default function MapPillars3D({ items, maxH, size, lifts, wPx, hPx, onOpen, onHover }) {
  return items.map(it => {
    const { lift = 0, ok = true } = lifts?.get(it.key) || {};
    const H = Math.max(4, Math.round(it.h * maxH));
    const isBlock = Array.isArray(it.pts) && it.pts.length >= 3 && wPx > 0 && hPx > 0;
    return (
      <div key={it.key}
        style={isBlock
          ? { position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformStyle: 'preserve-3d', cursor: 'pointer' }
          : { position: 'absolute', left: `${it.x}%`, top: `${it.y}%`, width: 0, height: 0, transformStyle: 'preserve-3d', cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onOpen(it.name); }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover(it.name, e); }}
        onPointerMove={(e) => { if (e.pointerType === 'mouse') onHover(it.name, e); }}
        onPointerLeave={() => onHover(null)}>
        {isBlock
          ? <Block it={it} H={H} lift={lift} ok={ok} wPx={wPx} hPx={hPx} />
          : <Pillar it={it} H={H} W={it.group ? Math.round(size * 1.8) : size} lift={lift} ok={ok} />}
      </div>
    );
  });
}
