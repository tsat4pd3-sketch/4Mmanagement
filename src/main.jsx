import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { LangProvider } from './utils/useLang.js'   // 🌐 ปุ่มสลับ ไทย/English (utils/i18n.js)
import { onMasterLoadFail } from './utils/masterCache.js'
import { hasPendingInput } from './utils/pendingInput.js'
import { toast } from './components/Toast'

/* 🔴 โหลดทะเบียน (master) ไม่สำเร็จ = ต้องเห็นบนจอ ห้ามเงียบ (2026-10-04)
   เคส 30/09: คิวรีล้มเงียบ → ลิสต์ว่างถูก cache ทับ 4 ชม. → หน้างานนึกว่าข้อมูลหาย
   ส่วน "ไม่เขียนทับของเดิม + รอบหน้าลองใหม่" ทำใน masterCache แล้ว
   ⚠️ รวบเป็นข้อความเดียวต่อ 10 วิ — หน้าโหลดทะเบียน 7 ตัวพร้อมกัน เน็ตหลุด = 7 toast ซ้อน */
let lastFailAt = 0;
onMasterLoadFail((key, err, { hadFallback }) => {
  if (Date.now() - lastFailAt < 10_000) return;
  lastFailAt = Date.now();
  toast.error(hadFallback
    ? 'โหลดข้อมูลทะเบียนไม่สำเร็จ — กำลังแสดงของเดิมที่เก็บไว้ อาจไม่ใช่ล่าสุด (กดรีเฟรชอีกครั้ง)'
    : 'โหลดข้อมูลทะเบียนไม่สำเร็จ — บางรายการอาจยังไม่ขึ้น กรุณากดรีเฟรช (Ctrl+Shift+R)');
  console.warn('[masterLoadFail]', key, err);
});

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
/* ── 🔴 ของที่คนกรอกค้าง ชนะการรีโหลดเสมอ (2026-11-27 · คำสั่ง user) ──────────
   หน้างานแจ้ง: "จอชอบรีเฟรชระหว่างลงข้อมูล ทำให้ต้องกรอกใหม่"
   ต้นเหตุคือ version guard ตัวนี้เอง — เด้งทันทีที่รู้ว่า build ไม่ตรง รวมถึง
   **ตอนคนคลิกกลับเข้าแท็บ** (สลับไปเปิดโปรแกรมอื่นแล้วกลับมา = รีโหลดใส่เลย)

   กฎใหม่: เจอเวอร์ชันใหม่ตอนมีของกรอกค้าง ⇒ **ไม่รีโหลด** ขึ้นแถบบอกแล้วรอจอว่าง
   · ตัวตัดสิน "มีของกรอกค้างไหม" = `utils/pendingInput.js` ที่เดียว (ห้ามเขียนกฎซ้ำที่นี่)
   · จอว่าง = รีโหลดเองเหมือนเดิมเป๊ะ ⇒ **จอ TV ไม่มีช่องกรอก ไม่กระทบ**
     (ห้ามถอยกลับไปเป็นปัญหา 19/08 ที่จอ TV รันโค้ดเก่าค้างข้ามกะ)

   🔴 เลื่อนได้แค่การรีโหลด "เชิงป้องกัน" ตัวนี้ — **ห้ามเลื่อน `vite:preloadError`
      และ chunk error ใน ErrorBoundary** เพราะ 2 ตัวนั้นหน้าพังไปแล้ว (React ล่ม)
      เลื่อนเท่ากับได้จอดำ ซึ่งคือปัญหาที่กลไกนี้ถูกสร้างมาแก้ตั้งแต่ต้น            */

let newBuildSeen = false;   // เจอเวอร์ชันใหม่บน server แล้ว (ยังไม่ได้รีโหลด)
let heldOnce = false;       // เคยเลื่อนเพราะมีของกรอกค้างมาแล้ว
let cleanTicks = 0;         // จอว่างมากี่รอบติด
let barEl = null;

let leavingOnPurpose = false;
const forceReload = () => { leavingOnPurpose = true; window.location.reload(); };

/* แถบบอกว่ามีเวอร์ชันใหม่ — DOM ล้วน ไม่พึ่ง React (ต้องขึ้นได้แม้ React กำลังมีปัญหา)
   วางบนสุดของจอ: ของที่ fixed ชิดล่างต้องบวก --mnav-h ตามกฎมือถือ ตัวนี้เลยอยู่ด้านบน */
const showUpdateBar = () => {
  if (barEl || typeof document === 'undefined') return;
  barEl = document.createElement('div');
  barEl.setAttribute('role', 'status');
  barEl.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:10002',
    'display:flex', 'align-items:center', 'justify-content:center',
    'gap:10px', 'flex-wrap:wrap', 'padding:7px 12px',
    'background:var(--amber-dim, rgba(227,162,58,0.12))',
    'borderBottom:1px solid var(--amber-line, rgba(227,162,58,0.40))',
    'color:var(--text, #e8f0eb)', 'font-size:12.5px', 'font-weight:600',
    'font-family:Sarabun, Tahoma, sans-serif',
    'box-shadow:var(--shadow-float, 0 6px 18px rgba(0,0,0,0.35))',
    'border-bottom:1px solid var(--amber-line, rgba(227,162,58,0.40))',
  ].join(';');

  const msg = document.createElement('span');
  msg.textContent = '🔄 มีเวอร์ชันใหม่ — กรอกให้เสร็จแล้วกดบันทึกก่อน ระบบจะโหลดหน้าใหม่ให้เองเมื่อพร้อม';
  const now = document.createElement('button');
  now.type = 'button';
  now.textContent = 'โหลดเลย';
  now.style.cssText = [
    'padding:4px 12px', 'border-radius:7px', 'border:none', 'cursor:pointer',
    'background:var(--accent, #2fbf63)', 'color:var(--accent-ink, #fff)',
    'font-size:12px', 'font-weight:800', 'font-family:inherit',
  ].join(';');
  /* 🔴 กดเองคือเจตนาของคน — ข้าม `canAutoReload()` (ตัวกันวน loop ของการรีโหลดอัตโนมัติ)
     ไม่งั้นกดแล้วไม่เกิดอะไรขึ้นถ้าเพิ่งมีการรีโหลดไปใน 30 วิ
     🔴 **ตั้งใจไม่ตั้ง `leavingOnPurpose`** — ถ้ายังมีของกรอกค้าง ให้ `beforeunload` ข้างล่าง
        ถามยืนยันตามปกติ (กดปุ่มนี้พลาดตอนกรอกค้าง = ของหายเหมือนกัน) */
  now.onclick = () => {
    try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* โหมดส่วนตัว */ }
    window.location.reload();
  };
  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'ซ่อนแถบนี้';
  later.style.cssText = [
    'padding:4px 10px', 'border-radius:7px', 'cursor:pointer', 'background:transparent',
    'color:inherit', 'border:1px solid currentColor', 'opacity:0.65',
    'font-size:12px', 'font-weight:700', 'font-family:inherit',
  ].join(';');
  /* ซ่อนแค่แถบ — ไม่ยกเลิกการรอ พอจอว่างก็ยังรีโหลดเองตามปกติ (ข้อมูลปลอดภัยแล้วตอนนั้น) */
  later.onclick = () => { try { barEl?.remove(); } catch { /* ถูกถอดไปแล้ว */ } };

  barEl.append(msg, now, later);
  try { document.body.appendChild(barEl); } catch { barEl = null; }
};

/** จะรีโหลดเพราะเจอเวอร์ชันใหม่ — ผ่านด่าน "มีของกรอกค้างไหม" ก่อนเสมอ */
const reloadForNewBuild = () => {
  if (!newBuildSeen) return;
  if (hasPendingInput()) { heldOnce = true; cleanTicks = 0; showUpdateBar(); return; }
  /* เคยเลื่อนมาแล้ว ⇒ ต้องว่าง 2 รอบติดก่อน กันรีโหลดใส่จังหวะที่คนเพิ่งล้างช่องเพื่อพิมพ์ใหม่
     (ยังไม่เคยเลื่อน = เส้นทางเดิมเป๊ะ รีโหลดทันที ไม่มีแถบ ไม่มีดีเลย์) */
  if (heldOnce && ++cleanTicks < 2) return;
  if (canAutoReload()) forceReload();
};

const checkVersion = async () => {
  if (newBuildSeen) { reloadForNewBuild(); return; }   // รู้แล้ว ไม่ต้องยิงซ้ำ
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return; // dev/ไฟล์ไม่มี — ข้าม
    const { build } = await res.json();
    if (!build || build === __BUILD_ID__) return;
    newBuildSeen = true;
    reloadForNewBuild();
  } catch { /* offline — ข้าม รอบหน้าค่อยเช็คใหม่ */ }
};
checkVersion();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });

/* รอจอว่างระหว่างที่เลื่อนไว้ — ถี่กว่ารอบเช็คเวอร์ชันเพราะตรงนี้ไม่ยิงเน็ตเลย
   (เป็นการอ่าน DOM ล้วน) · ไม่มีอะไรค้าง = ไม่ทำอะไร ไม่กินแรงเครื่อง */
const HELD_RECHECK_MS = 15 * 1000;
setInterval(() => { if (newBuildSeen) reloadForNewBuild(); }, HELD_RECHECK_MS);

/* 🔴 กด F5 / ปิดแท็บเองตอนมีของกรอกค้าง = เตือนก่อน (เดิมไม่มีด่านนี้เลยทั้งแอป)
   เปลี่ยนหน้าในแอป (SPA) ไม่ยิง event นี้ ⇒ เตือนเฉพาะตอนจะออกจากหน้าจริงๆ */
window.addEventListener('beforeunload', (e) => {
  if (leavingOnPurpose || !hasPendingInput()) return;
  e.preventDefault();
  e.returnValue = '';   // เบราว์เซอร์เลือกข้อความเอง กำหนดไม่ได้
});
/* ⚠️ จอ TV ที่เปิดค้าง 24/7 = visible ตลอด → **ไม่มี visibilitychange เลย** → ไม่มีวันรู้ว่ามีเวอร์ชันใหม่
   (พบ 2026-08-19: แก้ egress แล้ว deploy ไป แต่จอ TV ยังรันโค้ดเก่าจนกว่าจะมีคนไปกด F5
    — bug fix ทุกตัวที่ผ่านมาก็ไปไม่ถึงจอ TV ด้วยเหตุผลเดียวกัน)

   ── ทำไม 2 ชม. ─────────────────────────────────────────────────────────────
   ต้นทุน ≈ 0 และ **ไม่เกี่ยวกับโควต้า Supabase เลย** — `/version.json` (25 bytes) เสิร์ฟจาก
   Render static site คนละที่กับ DB · 15 จอ ทุก 2 ชม. ≈ 4 MB/เดือน จาก Render free 100 GB

   **การ "เช็ค" ไม่ได้แปลว่า "reload"** — reload เกิดต่อเมื่อ build ไม่ตรงเท่านั้น
   วันที่ไม่ได้ deploy จอไม่ขยับเลย ฉะนั้นถี่แค่ไหนก็ไม่รบกวนคนหน้างาน

   ตัวแปรจริงคือ "deploy fix แล้วจอรับช้าแค่ไหน" — 24 ชม. = จอแสดงของเสียต่ออีกเต็มกะ
   จึงเลือก 2 ชม. เป็นจุดกลาง · จะยืด/หดแก้ที่ค่าเดียวข้างล่างนี้                              */
const VERSION_CHECK_MS = 2 * 60 * 60 * 1000;
setInterval(checkVersion, VERSION_CHECK_MS);

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
  state = { error: null, stack: '' };
  static getDerivedStateFromError(error) { return { error }; }
  /* 🔴 เก็บ stack + componentStack ไว้ให้หน้างาน "คัดลอกส่งมาได้" (26/10)
     เคสจริง: หน้างานแจ้ง "เข้า /morning-meeting ไม่ได้" พร้อมข้อความ `Cannot access 'V' before initialization`
     ซึ่งเป็นชื่อที่ถูก minify แล้ว ⇒ **ตามหาต้นเหตุจากข้อความอย่างเดียวไม่ได้เลย**
     (เทสโหลดทุก chunk + เรนเดอร์ทุกหน้าใน harness ผ่านหมด = ต้องได้ stack จากเครื่องจริงเท่านั้น) */
  componentDidCatch(error, info) {
    this.setState({ stack: [error?.stack || '', info?.componentStack || ''].filter(Boolean).join('\n') });
    if (isChunkError(error) && canAutoReload()) window.location.reload();
  }
  details() {
    return [`หน้า: ${window.location.pathname}${window.location.search}`,
      String(this.state.error?.message || this.state.error), this.state.stack].filter(Boolean).join('\n');
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
        {/* รายละเอียดสำหรับแจ้งผู้ดูแล — ย่อไว้ ไม่รบกวนคนที่แค่อยากกดโหลดใหม่ */}
        <details style={{ maxWidth: 640, width: '100%', textAlign: 'left' }}>
          <summary style={{ fontSize: 11.5, opacity: 0.6, cursor: 'pointer' }}>รายละเอียดสำหรับแจ้งผู้ดูแล</summary>
          <pre style={{ fontSize: 11, opacity: 0.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 220, overflow: 'auto', marginTop: 8 }}>{this.details()}</pre>
          <button onClick={() => { try { navigator.clipboard.writeText(this.details()); } catch { /* ไม่มีสิทธิ์คลิปบอร์ด */ } }}
            style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
              background: 'transparent', color: 'inherit', border: '1px solid currentColor', opacity: 0.7, fontFamily: 'inherit' }}>
            📋 คัดลอกรายละเอียด
          </button>
        </details>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
      <LangProvider><App /></LangProvider>
    </RootErrorBoundary>
  </StrictMode>,
)

/* 🔴 บอกตาข่ายใน index.html ว่า "โปรแกรมขึ้นแล้ว" — ไม่ตั้งธงนี้ = ขึ้นจอ "เปิดโปรแกรมไม่สำเร็จ"
   ทับของจริงหลัง 15 วินาที · ตั้งหลัง render() เสมอ (ถึงตรงนี้ = โมดูลโหลดครบและ React เริ่มแล้ว) */
window.__ESM_MOUNTED = true;
try { document.getElementById('boot-fallback')?.remove(); } catch { /* ไม่มีตาข่าย (dev) */ }
