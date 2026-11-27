/**
 * pendingInput — "ตอนนี้มีของที่คนกรอกค้างอยู่บนจอไหม" (2026-11-27 · คำสั่ง user)
 *
 * เคสจริงที่ทำให้ต้องมี: หน้างานแจ้ง "จอชอบรีเฟรชระหว่างลงข้อมูล ต้องกรอกใหม่"
 * ต้นเหตุ = version guard ใน `src/main.jsx` — deploy เวอร์ชันใหม่แล้วแท็บที่เปิดค้างจะ
 * `location.reload()` ทันทีที่รู้ว่า build ไม่ตรง (รวมถึง**ตอนคนคลิกกลับเข้าแท็บ**)
 * ของที่กรอกค้างใน modal/ฟอร์มหายทั้งหมด โดยไม่มีอะไรเตือนเลย
 *
 * 🔴 ทำไมสแกน DOM ไม่ใช่ให้ modal ลงทะเบียนเอง:
 *    โปรเจคนี้**ไม่มี component modal กลาง** — มี *Modal.jsx แยก 30 ตัว + หน้าที่วาด
 *    overlay เองอีก 93 ไฟล์ ⇒ วิธี "ให้แต่ละ modal บอกว่ากำลังกรอก" ต้องแก้ 93 จุด
 *    และ modal ที่สร้างใหม่วันหลังจะลืมใส่เงียบๆ · สแกน DOM ครอบทุกหน้าในที่เดียว
 *    และครอบ**ฟอร์มที่ไม่ใช่ modal ด้วย** (ตารางกรอก Daily Report พิมพ์ในหน้าเลย)
 *
 * 🔴 ความผิดพลาด 2 ทางราคาไม่เท่ากัน — ตั้งใจเอนไปทาง "เลื่อนเกินจำเป็น":
 *    เลื่อนเกิน = ได้เวอร์ชันใหม่ช้าลง (หน้ายังทำงานปกติ ไม่มีใครเดือดร้อน)
 *    รีโหลดผิดจังหวะ = **ข้อมูลที่คนพิมพ์ไปแล้วหาย** ⇒ ช่องค้นหาที่พิมพ์ทิ้งไว้ก็นับว่าค้าง
 *
 * ⚠️ ห้าม import อะไรที่แตะ supabase/React — `main.jsx` เรียกตัวนี้ก่อน render
 *    และเทสรันในโหนด (ส่งเอกสารจำลองเข้ามาทาง argument ได้)
 */

/* ช่องที่ไม่ใช่ "ของที่พิมพ์" — ติ๊ก/เลือก/ปุ่ม ไม่ถือว่ากรอกค้าง
   (checkbox/radio ค่าเริ่มต้นต่างจากที่เห็นบ่อย ⇒ นับแล้วจะค้างทั้งระบบ) */
const SKIP_TYPES = new Set([
  'hidden', 'submit', 'button', 'reset', 'image',
  'checkbox', 'radio', 'range', 'color',
]);

/* `<select>` ไม่นับ — React ตั้ง value ให้ทุกตัวอยู่แล้ว ไม่มี defaultValue ให้เทียบ
   ⇒ นับ select = ทุกหน้าที่มี dropdown จะ "ค้าง" ตลอดเวลา เลื่อนรีโหลดไม่มีวันจบ */
const FIELD_SEL = 'input, textarea';

const isEditable = (el) => {
  const tag = el?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea';
};

/** มองเห็นอยู่จริงไหม — ใช้ getClientRects() เพราะถูกกว่า getComputedStyle หลายเท่า
 *  (ช่องใน modal ที่ปิดอยู่ / แท็บที่ไม่ได้เลือก จะไม่มี rect) */
const isLive = (el) => {
  if (!el || el.disabled || el.readOnly) return false;
  try { return el.getClientRects().length > 0; } catch { return false; }
};

/**
 * มีของกรอกค้างบนจอไหม
 *
 * นับว่า "ค้าง" เมื่อ:
 *   · ช่อง input/textarea ที่มองเห็นอยู่ มีค่าที่ไม่ว่างและต่างจาก `defaultValue` **หรือ**
 *   · cursor อยู่ในช่องกรอกอยู่ (ถึงช่องจะว่าง) — กันเคส "ล้างช่องเพื่อพิมพ์ใหม่"
 *     ซึ่งถ้าไม่นับ จะรีโหลดใส่ตอนคนลบค่าเก่าเสร็จพอดี
 *
 * เลี่ยงการนับรายจุดได้ด้วย `data-reload-safe="1"` บนช่องนั้น (ใช้เท่าที่จำเป็น)
 *
 * @param {Document} [doc] เอกสารที่จะสแกน (ว่าง = document ของหน้านี้ · เทสส่งตัวจำลองเข้ามา)
 * @returns {boolean} อ่าน DOM ไม่ได้ = `false` (ไม่ขัดขวางการรีโหลด — ตาข่ายกันจอดำสำคัญกว่า)
 */
export function hasPendingInput(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.querySelectorAll !== 'function') return false;

  /* cursor อยู่ในช่องกรอก = กำลังพิมพ์อยู่ ไม่ต้องดูค่าเลย */
  try {
    const a = d.activeElement;
    if (isEditable(a) && a.dataset?.reloadSafe !== '1'
        && !SKIP_TYPES.has(String(a.type || '').toLowerCase())) return true;
  } catch { /* ไม่มี activeElement — ข้ามไปดูค่าในช่อง */ }

  let nodes;
  try { nodes = d.querySelectorAll(FIELD_SEL); } catch { return false; }
  for (const el of nodes) {
    if (el?.dataset?.reloadSafe === '1') continue;
    if (SKIP_TYPES.has(String(el.type || '').toLowerCase())) continue;
    const v = el.value;
    if (typeof v !== 'string' || v.trim() === '') continue;
    if (v === el.defaultValue) continue;   // ค่าที่ระบบเติมมาให้ ไม่ใช่ของที่คนพิมพ์
    if (!isLive(el)) continue;             // เช็คท้ายสุด — แพงที่สุด
    return true;
  }
  return false;
}
