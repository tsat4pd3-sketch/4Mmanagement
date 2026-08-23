import { useState, useCallback, useEffect, useRef } from 'react';

/* ── Toast store (singleton outside React) ── */
let _dispatch = null;
export const toast = {
  success: (msg) => _dispatch?.({ type: 'success', msg }),
  error:   (msg) => _dispatch?.({ type: 'error',   msg }),
  info:    (msg) => _dispatch?.({ type: 'info',     msg }),
};

const ICONS   = { success: '✅', error: '❌', info: 'ℹ️' };
const COLORS  = { success: '#22c55e', error: '#ef4444', info: '#4d9fff' };
// error/info อยู่นานขึ้นเพราะมักมีข้อความยาวต้องอ่าน · success สั้นได้ · คลิกปิดเองได้ทุกอัน
const DURATION = { success: 3500, info: 6000, error: 9000 };

/* ⚠️ กันข้อความเดิมซ้อนกันจนบังทั้งหน้าจอ (เคสจริงบนมือถือ 2026-08-21:
   บันทึกใบซ่อมล้มเพราะรูป ช่างกดซ้ำ → toast "อ่านไฟล์รูปไม่ได้" 13 อัน (อันละ 9 วิ)
   ซ้อนกันจนฟอร์มทั้งใบมองไม่เห็น กดอะไรไม่ได้)
     · ข้อความเดิมซ้ำ = นับรวมเป็นอันเดียว "×N" แล้วรีเซ็ตเวลา ไม่เพิ่มอันใหม่
     · จำกัดจำนวนบนจอ MAX_TOASTS อันเก่าสุดถูกดันออก */
const MAX_TOASTS = 4;

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);
  const timers = useRef(new Map());

  const remove = useCallback((id) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts(prev => prev.filter(x => x.id !== id));
  }, []);

  const arm = useCallback((id, type) => {
    const old = timers.current.get(id);
    if (old) clearTimeout(old);
    timers.current.set(id, setTimeout(() => remove(id), DURATION[type] ?? 4000));
  }, [remove]);

  const dispatch = useCallback(({ type, msg }) => {
    setToasts(prev => {
      const same = prev.find(t => t.type === type && t.msg === msg);
      if (same) { arm(same.id, type); return prev.map(t => t.id === same.id ? { ...t, n: (t.n || 1) + 1 } : t); }
      const id = ++counter.current;
      arm(id, type);
      const next = [...prev, { id, type, msg, n: 1 }];
      // เกินเพดาน = ดันอันเก่าสุดออก (พร้อมเคลียร์ timer ของมัน)
      while (next.length > MAX_TOASTS) {
        const drop = next.shift();
        const t = timers.current.get(drop.id);
        if (t) { clearTimeout(t); timers.current.delete(drop.id); }
      }
      return next;
    });
  }, [arm]);

  // เก็บกวาด timer ตอน unmount — กัน setState หลัง component ตายแล้ว
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  useEffect(() => { _dispatch = dispatch; return () => { _dispatch = null; }; }, [dispatch]);

  if (!toasts.length) return null;

  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} title="คลิกเพื่อปิด" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 18px', borderRadius: 10,
          background: 'rgba(18,18,28,0.96)', border: `1px solid ${COLORS[t.type]}55`,
          borderLeft: `4px solid ${COLORS[t.type]}`,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          fontSize: 13, fontWeight: 600, color: '#f0f0f4',
          maxWidth: 'min(90vw, 560px)', cursor: 'pointer',
          animation: 'toastIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
          pointerEvents: 'auto',
        }}>
          <span style={{ flexShrink: 0 }}>{ICONS[t.type]}</span>
          <span>{t.msg}</span>
          {t.n > 1 && (
            <span style={{ flexShrink: 0, background: COLORS[t.type], color: '#0b0b12', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 800 }}>×{t.n}</span>
          )}
          <span style={{ marginLeft: 'auto', opacity: 0.5, flexShrink: 0, paddingLeft: 6 }}>✕</span>
        </div>
      ))}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateY(12px) scale(0.95); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
    </div>
  );
}
