import { useEffect, useRef, useState, useContext, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext, navItemsForGroups, NAV_GROUP_ORDER } from '../App';
import { toast } from '../components/Toast';

/* ═══ RemoteControl (🎮 รีโมทจอ) — มือถือคุมจอ TV/โปรเจคเตอร์ที่เปิด "รับรีโมท" ═══
   คู่กับ RemoteReceiver (ฝังระดับ App บนจอ) ผ่าน Supabase Realtime — ใช้ได้ทุกหน้า
   - 🖱️ Touchpad: ลาก 1 นิ้ว = เลื่อน pointer บนจอ · แตะ = คลิก · ลาก 2 นิ้ว = scroll
     (จอมือถือกลายเป็นเมาส์/พอยน์เตอร์ของจอใหญ่)
   - ◀ ▶ Esc: ยิงปุ่มลูกศรให้โหมดประชุมแถวเช้า (หรืออะไรก็ตามที่ฟัง keydown)
   - 🧭 เปลี่ยนหน้า: สั่งจอกระโดดไปหน้าไหนก็ได้ (เมนูชุดเดียวกับ sidebar)
   ═══════════════════════════════════════════════════════════════════════════ */

const SEND_INTERVAL_MS = 40;   // ~25Hz — ลื่นพอสำหรับ pointer และไม่ถล่ม realtime
const POINTER_SPEED = 1.25;    // ตัวคูณความไวเมาส์
const SCROLL_SPEED = 2.2;

export default function RemoteControl() {
  const { role } = useContext(UserContext);
  const [code, setCode] = useState(() => localStorage.getItem('esm-remote-last-code') || '');
  const [joined, setJoined] = useState(false);
  const [linkOk, setLinkOk] = useState(false); // จอตอบ pong แล้ว
  const chRef = useRef(null);
  const padRef = useRef(null);

  // ── ส่งคำสั่ง (pointer สะสม delta แล้ว flush เป็นจังหวะ กัน message ถี่เกิน) ──
  const acc = useRef({ dx: 0, dy: 0, scroll: 0 });
  const send = useCallback((payload) => {
    chRef.current?.send({ type: 'broadcast', event: 'cmd', payload });
  }, []);
  useEffect(() => {
    if (!joined) return;
    const t = setInterval(() => {
      const a = acc.current;
      if (a.dx || a.dy) { send({ type: 'move', dx: a.dx, dy: a.dy }); a.dx = 0; a.dy = 0; }
      if (a.scroll) { send({ type: 'scroll', dy: a.scroll }); a.scroll = 0; }
    }, SEND_INTERVAL_MS);
    return () => clearInterval(t);
  }, [joined, send]);

  const join = () => {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) return toast.error('ใส่รหัส 6 หลักที่โชว์บนจอ (ป้าย 📺 มุมล่างซ้าย)');
    localStorage.setItem('esm-remote-last-code', c);
    const ch = supabase.channel(`esm-remote-${c}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'cmd' }, ({ payload: p }) => { if (p?.type === 'pong') setLinkOk(true); });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setJoined(true);
        ch.send({ type: 'broadcast', event: 'cmd', payload: { type: 'ping' } });
      }
    });
    chRef.current = ch;
  };
  const leave = () => {
    if (chRef.current) supabase.removeChannel(chRef.current);
    chRef.current = null;
    setJoined(false); setLinkOk(false);
  };
  useEffect(() => () => { if (chRef.current) supabase.removeChannel(chRef.current); }, []);

  /* ── Touchpad: pointer events — 1 นิ้วเลื่อน pointer · 2 นิ้ว scroll · แตะสั้น = คลิก ── */
  const touch = useRef({ pts: new Map(), moved: 0, downAt: 0, lastX: 0, lastY: 0, lastY2: 0 });
  const onPadDown = (e) => {
    const t = touch.current;
    t.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (t.pts.size === 1) { t.moved = 0; t.downAt = performance.now(); t.lastX = e.clientX; t.lastY = e.clientY; }
    if (t.pts.size === 2) t.lastY2 = [...t.pts.values()].reduce((s, p) => s + p.y, 0) / 2;
    padRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onPadMove = (e) => {
    const t = touch.current;
    if (!t.pts.has(e.pointerId)) return;
    t.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (t.pts.size >= 2) {
      // 2 นิ้ว = scroll แนวตั้ง (เหมือน touchpad โน้ตบุ๊ค)
      const cy = [...t.pts.values()].reduce((s, p) => s + p.y, 0) / t.pts.size;
      acc.current.scroll += -(cy - t.lastY2) * SCROLL_SPEED; // ลากลง = ดูของด้านบน (ทิศ touchpad ธรรมชาติ)
      t.lastY2 = cy;
      t.moved = 99;
    } else {
      const dx = e.clientX - t.lastX, dy = e.clientY - t.lastY;
      t.moved += Math.abs(dx) + Math.abs(dy);
      acc.current.dx += (dx / rect.width) * POINTER_SPEED;
      acc.current.dy += (dy / rect.height) * POINTER_SPEED;
      t.lastX = e.clientX; t.lastY = e.clientY;
    }
  };
  const onPadUp = (e) => {
    const t = touch.current;
    t.pts.delete(e.pointerId);
    // แตะสั้นและแทบไม่ขยับ = คลิก
    if (t.pts.size === 0 && t.moved < 12 && performance.now() - t.downAt < 350) send({ type: 'click' });
  };

  const pages = navItemsForGroups(NAV_GROUP_ORDER, role);
  const btn = (extra = {}) => ({
    padding: '12px 10px', borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--bg2)',
    color: 'var(--text)', fontSize: 14, fontWeight: 800, cursor: 'pointer', ...extra,
  });

  return (
    <div style={{ padding: 16, maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 'clamp(17px, 2.2vw, 22px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
        🎮 รีโมทจอ (Remote)
      </h1>

      {!joined ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>
            1. บนจอ TV/คอม เปิดเมนู sidebar → กด <b>📺 รับรีโมทจอ</b> (ล่างสุด)<br />
            2. จอจะโชว์<b>รหัส 6 หลัก</b>ที่ป้ายมุมล่างซ้าย — เอามาใส่ที่นี่
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="รหัส 6 หลัก" inputMode="numeric"
              style={{ width: 150, fontSize: 22, fontWeight: 900, letterSpacing: 5, textAlign: 'center', padding: '10px 12px', borderRadius: 10 }} />
            <button onClick={join} style={btn({ background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)', flex: 1 })}>
              🔗 เชื่อมต่อ
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
            <span style={chipSt(linkOk ? '#22c55e' : '#f59e0b')}>{linkOk ? `🟢 เชื่อมกับจอ ${code}` : `🟡 ส่งหาห้อง ${code} (ยังไม่เห็นจอตอบ)`}</span>
            <button onClick={leave} style={{ marginLeft: 'auto', ...btn({ fontSize: 12, padding: '6px 12px' }) }}>ตัดการเชื่อมต่อ</button>
          </div>

          {/* ── Touchpad — มือถือเป็นเมาส์ของจอ ── */}
          <div ref={padRef}
            onPointerDown={onPadDown} onPointerMove={onPadMove} onPointerUp={onPadUp} onPointerCancel={onPadUp}
            style={{
              height: '44vh', minHeight: 240, borderRadius: 16, border: '2px dashed var(--border2)',
              background: 'var(--bg2)', touchAction: 'none', userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.8,
            }}>
            🖱️ ลาก 1 นิ้ว = เลื่อน pointer บนจอ<br />แตะ = คลิก · ลาก 2 นิ้ว = เลื่อนหน้า
          </div>

          {/* ── ปุ่มวาระ (โหมดประชุมแถวเช้า — ยิงปุ่มลูกศร) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <button onClick={() => send({ type: 'key', key: 'ArrowLeft' })} style={btn({ fontSize: 18 })}>◀ ก่อนหน้า</button>
            <button onClick={() => send({ type: 'key', key: 'ArrowRight' })} style={btn({ fontSize: 18 })}>ถัดไป ▶</button>
            <button onClick={() => send({ type: 'key', key: 'Escape' })} style={btn({ color: '#f59e0b' })}>Esc ออกโหมด</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button onClick={() => send({ type: 'scroll', dy: -Math.round(window.innerHeight * 0.5) })} style={btn()}>▲ เลื่อนขึ้น</button>
            <button onClick={() => send({ type: 'scroll', dy: Math.round(window.innerHeight * 0.5) })} style={btn()}>▼ เลื่อนลง</button>
          </div>

          {/* ── สั่งจอเปลี่ยนหน้า — เมนูชุดเดียวกับ sidebar (สิทธิ์เข้าหน้าคุมที่ฝั่งจอเอง) ── */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>🧭 สั่งจอไปหน้า…</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {pages.map(p => (
                <button key={p.to} onClick={() => send({ type: 'nav', to: p.to })}
                  style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer' }}>
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const chipSt = (color) => ({
  fontSize: 12, fontWeight: 800, color, background: `${color}1f`,
  border: `1px solid ${color}55`, borderRadius: 8, padding: '4px 10px',
});
