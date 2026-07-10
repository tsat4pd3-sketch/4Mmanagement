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

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const remove = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  const dispatch = useCallback(({ type, msg }) => {
    const id = ++counter.current;
    setToasts(prev => [...prev, { id, type, msg }]);
    setTimeout(() => remove(id), DURATION[type] ?? 4000);
  }, [remove]);

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
          <span style={{ marginLeft: 'auto', opacity: 0.5, flexShrink: 0, paddingLeft: 6 }}>✕</span>
        </div>
      ))}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateY(12px) scale(0.95); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
    </div>
  );
}
