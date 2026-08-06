import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

/* ── กันจอดำหลัง deploy เวอร์ชันใหม่ ──────────────────────────────────────
   ทุกหน้าเป็น lazy chunk ชื่อไฟล์มี hash — พอ deploy ใหม่ ไฟล์เวอร์ชันเก่าหายจาก server
   แท็บที่เปิดค้างไว้พอเปลี่ยนหน้า จะโหลด chunk ไม่ได้ → React ล่มทั้งต้น = จอดำเงียบๆ
   ทางแก้: reload อัตโนมัติ 1 ครั้งเพื่อดึงเวอร์ชันใหม่ (มี timestamp กันวน loop)
   และมี ErrorBoundary เป็นตาข่ายสุดท้าย — ไม่ว่า error อะไรก็ต้องเห็นปุ่มโหลดใหม่ ไม่ใช่จอดำ */

const RELOAD_KEY = 'esm_chunk_reload_at';
const canAutoReload = () => {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < 30000) return false; // เพิ่ง reload ไป — อย่าวน loop
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  return true;
};

// Vite ยิง event นี้เมื่อ preload dynamic import ล้มเหลว (ไฟล์ chunk หาย/เน็ตสะดุด)
window.addEventListener('vite:preloadError', (e) => {
  if (canAutoReload()) {
    e.preventDefault();
    window.location.reload();
  }
});

/* ── Version guard: แท็บที่ถือเวอร์ชันเก่า reload เป็นเวอร์ชันล่าสุดอัตโนมัติ ──
   เปิดแท็บใหม่ (ctrl+click) เบราว์เซอร์อาจหยิบ index.html เก่าจาก cache (heuristic caching
   เมื่อ server ไม่ส่ง Cache-Control ชัดเจน) → ได้แอปเวอร์ชันเก่าที่ chunk โดนลบไปแล้ว
   คลิกอะไรก็พังเงียบๆ — เทียบ build ตัวเอง (__BUILD_ID__) กับ version.json บน server
   (fetch แบบ no-store เสมอ ไม่โดน cache) ตอนเปิดแอป + ทุกครั้งที่กลับมาโฟกัสแท็บ */
const checkVersion = async () => {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return; // dev/ไฟล์ไม่มี — ข้าม
    const { build } = await res.json();
    if (build && build !== __BUILD_ID__ && canAutoReload()) window.location.reload();
  } catch { /* offline — ข้าม รอบหน้าค่อยเช็คใหม่ */ }
};
checkVersion();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });

/* ── PWA Service Worker (เฉพาะ Web Push — ไม่มี fetch handler ไม่ cache อะไร) ──
   register ตอน production เท่านั้น · ตัว SW (public/sw.js) แตะแค่ push/notificationclick
   จึงไม่ชน version-guard ข้างบน (ดูคอมเมนต์ใน sw.js) — ห้ามใส่ fetch/caching เข้าไป */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ไม่รองรับ — ข้าม */ });
  });
}

const isChunkError = (err) =>
  /dynamically imported module|Importing a module script failed|Loading chunk|error loading|Failed to fetch/i
    .test(err?.message || '');

class RootErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    if (isChunkError(error) && canAutoReload()) window.location.reload();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, background: 'var(--bg, #0d1512)', color: 'var(--text, #e8f0eb)',
        fontFamily: 'Sarabun, Tahoma, sans-serif', padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 40 }}>🔄</div>
        <div style={{ fontSize: 17, fontWeight: 700 }}>โปรแกรมมีการอัพเดทเวอร์ชันใหม่ หรือการโหลดหน้ามีปัญหา</div>
        <div style={{ fontSize: 13, opacity: 0.75 }}>กดปุ่มด้านล่างเพื่อโหลดหน้าใหม่ — ข้อมูลที่บันทึกไว้แล้วไม่หายไปไหน</div>
        <button
          onClick={() => { sessionStorage.removeItem(RELOAD_KEY); window.location.reload(); }}
          style={{
            padding: '12px 28px', borderRadius: 10, border: 'none', background: '#3dd65c',
            color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          โหลดหน้าใหม่
        </button>
        <div style={{ fontSize: 11, opacity: 0.5, maxWidth: 520, wordBreak: 'break-word' }}>
          {String(this.state.error?.message || this.state.error)}
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
