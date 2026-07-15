import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

/* ═══ RemoteReceiver — โหมด "จอตาม" (รับรีโมทจากมือถือ) ═══════════════════════
   ฝังที่ระดับ App → ใช้ได้ทุกหน้า ไม่ใช่แค่โหมดประชุม
   จับคู่ด้วยรหัส 6 หลักผ่าน Supabase Realtime broadcast (channel: esm-remote-<code>)
   — infra เดิมของระบบ ไม่มีตาราง/เซิร์ฟเวอร์ใหม่ · จอเป็นฝ่าย opt-in เปิดรับเองเสมอ

   คำสั่งที่รับจากรีโมท (payload.type):
   - move   {dx,dy}   เลื่อน pointer เสมือน (สัดส่วนของ viewport)
   - click  {}        คลิกที่ตำแหน่ง pointer — elementFromPoint + .click()
                      (ปุ่ม/ลิงก์/input ของ React ตอบสนอง native click ปกติ)
   - scroll {dy}      เลื่อน scroll container ที่อยู่ใต้ pointer (เดินหา ancestor ที่ scroll ได้)
   - key    {key}     ยิง KeyboardEvent ลง window (◀ ▶ Esc — โหมดประชุมฟัง keydown อยู่แล้ว)
   - nav    {to}      เปลี่ยนหน้า (react-router) — RoleRoute ของจอคุมสิทธิ์เองตามปกติ
   - ping   {}        รีโมทเช็คว่าจอยังอยู่ → จอตอบ pong (โชว์สถานะเชื่อมต่อบนมือถือ)
   ═══════════════════════════════════════════════════════════════════════════ */

const POINTER_SIZE = 26;

export default function RemoteReceiver({ code, onStop }) {
  const navigate = useNavigate();
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [pointerSeen, setPointerSeen] = useState(false); // ยังไม่ขยับ = ซ่อน pointer
  const [ripple, setRipple] = useState(null);            // { x, y, id } เอฟเฟกต์ตอนคลิก
  const [connected, setConnected] = useState(false);     // มีรีโมทส่งคำสั่งเข้ามาแล้ว
  const posRef = useRef(pos);
  posRef.current = pos;

  const clickAt = useCallback((nx, ny) => {
    const x = nx * window.innerWidth, y = ny * window.innerHeight;
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    // คลิกที่ตัว interactive ใกล้สุด (จุดอาจโดน span/ไอคอนข้างในปุ่ม)
    const target = el.closest('button, a, [role="button"], input, select, textarea, label, summary') || el;
    if (target instanceof HTMLElement) {
      target.focus?.({ preventScroll: true });
      target.click?.();
    }
    setRipple({ x, y, id: Date.now() });
    setTimeout(() => setRipple(null), 450);
  }, []);

  const scrollAt = useCallback((nx, ny, dy) => {
    let el = document.elementFromPoint(nx * window.innerWidth, ny * window.innerHeight);
    // เดินขึ้นหา container ที่ scroll ได้จริง (หลายหน้าใช้ inner scroll ไม่ใช่ window)
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4) break;
      el = el.parentElement;
    }
    const scroller = el && el !== document.body ? el : (document.scrollingElement || document.body);
    scroller.scrollBy({ top: dy, behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (!code) return;
    const ch = supabase.channel(`esm-remote-${code}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'cmd' }, ({ payload: p }) => {
      if (!p?.type) return;
      setConnected(true);
      if (p.type === 'move') {
        setPointerSeen(true);
        setPos(prev => ({
          x: Math.min(1, Math.max(0, prev.x + (p.dx || 0))),
          y: Math.min(1, Math.max(0, prev.y + (p.dy || 0))),
        }));
      } else if (p.type === 'click') {
        clickAt(posRef.current.x, posRef.current.y);
      } else if (p.type === 'scroll') {
        scrollAt(posRef.current.x, posRef.current.y, p.dy || 0);
      } else if (p.type === 'key') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: p.key, bubbles: true }));
      } else if (p.type === 'nav' && typeof p.to === 'string' && p.to.startsWith('/')) {
        navigate(p.to);
      } else if (p.type === 'ping') {
        ch.send({ type: 'broadcast', event: 'cmd', payload: { type: 'pong' } });
      }
    });
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [code, navigate, clickAt, scrollAt]);

  return (
    <>
      {/* pointer เสมือน — จุดแดงเรืองแสง (pointerEvents none: ไม่บังการคลิกจริง) */}
      {pointerSeen && (
        <div style={{
          position: 'fixed', zIndex: 9999, pointerEvents: 'none',
          left: `calc(${pos.x * 100}% - ${POINTER_SIZE / 2}px)`, top: `calc(${pos.y * 100}% - ${POINTER_SIZE / 2}px)`,
          width: POINTER_SIZE, height: POINTER_SIZE, borderRadius: '50%',
          background: 'rgba(239,68,68,0.85)', border: '2.5px solid #fff',
          boxShadow: '0 0 14px rgba(239,68,68,0.9), 0 2px 6px rgba(0,0,0,0.5)',
          transition: 'left 0.03s linear, top 0.03s linear',
        }} />
      )}
      {ripple && (
        <div key={ripple.id} style={{
          position: 'fixed', zIndex: 9998, pointerEvents: 'none',
          left: ripple.x - 30, top: ripple.y - 30, width: 60, height: 60, borderRadius: '50%',
          border: '3px solid #4ade80', opacity: 0, transform: 'scale(1.15)',
          animation: 'none', transition: 'opacity 0.45s ease, transform 0.45s ease',
        }} ref={n => { if (n) requestAnimationFrame(() => { n.style.opacity = '1'; n.style.transform = 'scale(0.55)'; }); }} />
      )}
      {/* ป้ายสถานะ + รหัสห้อง — ต้องเห็นเสมอว่าจอนี้เปิดรับรีโมทอยู่ */}
      <div style={{
        position: 'fixed', left: 14, bottom: 14, zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--bg2)', border: `1px solid ${connected ? 'var(--accent)' : 'var(--border2)'}`,
        borderRadius: 12, padding: '8px 14px', boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
      }}>
        <span style={{ fontSize: 13 }}>📺</span>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
            รับรีโมทอยู่ {connected ? '· 🟢 เชื่อมต่อแล้ว' : '· รอมือถือใส่รหัส'}
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 4, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>{code}</div>
        </div>
        <button onClick={onStop} title="ปิดรับรีโมท"
          style={{ marginLeft: 4, background: 'none', border: '1px solid var(--border2)', borderRadius: 7, color: 'var(--muted)', fontSize: 12, padding: '4px 8px', cursor: 'pointer' }}>✕</button>
      </div>
    </>
  );
}
