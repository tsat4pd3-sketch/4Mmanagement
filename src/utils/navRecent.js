/* ══ navRecent — จำ "หน้าที่ใช้บ่อย/เข้าล่าสุด" ต่อเครื่อง (localStorage) ═══════════════
   เมนูมี 51 รายการใน 8 หมวด แต่คนหน้างานส่วนใหญ่วนอยู่ 3-5 หน้าเดิมทั้งวัน
   → เก็บสถิติการเข้าหน้าไว้ในเครื่อง แล้วยกขึ้นมาไว้บนสุด (sidebar + command palette)

   เก็บในเครื่องเท่านั้น (ไม่แตะ DB · ไม่ส่งออก) — เป็นความสะดวกส่วนตัวของเครื่องนั้น
   ไม่ใช่ข้อมูลองค์กร และเครื่องกลางหน้าไลน์ที่หลายคนใช้ร่วมกันก็ไม่ได้เปิดเผยอะไร
   นอกจากรายชื่อ "หน้า" ที่ทุกคนเห็นในเมนูอยู่แล้ว

   คะแนน = จำนวนครั้ง แต่ decay ตามเวลา (ครึ่งชีวิต 14 วัน) → หน้าที่เลิกใช้แล้วค่อยๆ ตกลง
   ไม่ค้างอยู่บนสุดเพราะเคยกดรัวๆ เมื่อเดือนก่อน
   ═════════════════════════════════════════════════════════════════════════════════════════ */
const KEY = 'nav_recent_v1';
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 40;

const now = () => Date.now();

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }          // private mode / ค่าเสีย → ทำเหมือนไม่เคยมีสถิติ
}

function write(rows) {
  try { localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX_ROWS))); } catch { /* private mode */ }
}

/** คะแนนตอนนี้ของแถว (decay ตั้งแต่ครั้งล่าสุดที่แตะ) */
function scoreOf(r, t = now()) {
  const age = Math.max(0, t - (r.at || 0));
  return (r.n || 0) * Math.pow(0.5, age / HALF_LIFE_MS);
}

/** บันทึกว่าเพิ่งเข้าหน้านี้ — เรียกจากที่เดียว (ProtectedLayout ตอน pathname เปลี่ยน) */
export function trackVisit(path) {
  if (!path || path === '/' || path === '/login') return;   // hub/login ไม่ต้องนับ (ไม่ใช่ปลายทางที่คนอยากลัดไป)
  const t = now();
  const rows = read();
  const hit = rows.find(r => r.to === path);
  if (hit) {
    hit.n = scoreOf(hit, t) + 1;   // decay ของเก่าก่อนแล้วค่อย +1 (ไม่งั้นนับสะสมแบบไม่มีวันลืม)
    hit.at = t;
  } else {
    rows.push({ to: path, n: 1, at: t });
  }
  rows.sort((a, b) => scoreOf(b, t) - scoreOf(a, t));
  write(rows);
}

/** path ที่ใช้บ่อยสุด (เรียงมากไปน้อย) — คืนเฉพาะ path ให้ผู้เรียกไป map กับเมนูที่มีสิทธิ์เอง */
export function topPaths(limit = 5) {
  const t = now();
  return read()
    .sort((a, b) => scoreOf(b, t) - scoreOf(a, t))
    .slice(0, limit)
    .map(r => r.to);
}
