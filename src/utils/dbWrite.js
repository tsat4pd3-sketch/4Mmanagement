// ─── ตัวเช็คผลการเขียน DB จาก client ─────────────────────────────────────────
// supabase-js ไม่ throw — คืน { data, error } เสมอ ⇒ `await supabase.from(...).update(...)` เปล่าๆ
// = คิวรีล้มแล้วไม่มีใครรู้ (CLAUDE.md §กฎเหล็กการเขียน DB จาก client ข้อ 1)
import { toast } from '../components/Toast';

/**
 * เช็คว่า "คิวรีล้มไหม" — `checkWrite(await supabase.from('t').update(x).eq('id', id), 'บันทึกเวลา')`
 * → error: toast แดง "บันทึกเวลาไม่สำเร็จ: <สาเหตุ>" แล้วคืน `false` · ไม่ error คืน `true`
 *
 * ⚠️ **ไม่ได้นับแถว** — RLS ที่ปฏิเสธ UPDATE/DELETE คืน "สำเร็จ 0 แถว ไม่มี error"
 *    (มีแต่ INSERT ที่โยน 42501) ⇒ ปุ่มที่ผลลัพธ์สำคัญต้องใช้ `checkWriteRows` แทน
 */
export function checkWrite(res, label) {
  if (res?.error) {
    toast.error(`${label}ไม่สำเร็จ: ${res.error.message}`);
    return false;
  }
  return true;
}

/**
 * เช็คทั้ง "ล้มไหม" **และ "โดนกี่แถว"** — สำหรับ UPDATE/DELETE ที่ผลลัพธ์สำคัญ
 *
 * 🔴 ทำไมต้องมีตัวนี้ (กฎเหล็กข้อ 2 · QC audit 06/10):
 *    RLS ที่ปฏิเสธ UPDATE/DELETE **ไม่โยน error** — มันแค่ "ไม่เข้าเงื่อนไข WHERE"
 *    ⇒ `{ data: [], error: null }` ⇒ `checkWrite` คืน true ⇒ **toast เขียวทั้งที่ไม่มีอะไรถูกบันทึก**
 *    คนกดปุ่มเชื่อว่าบันทึกแล้ว ปิดหน้าไป แล้วค่อยรู้ทีหลังว่าข้อมูลไม่เปลี่ยน
 *
 *    สำรวจ 06/10 เจอ **7 จุด** ที่ผู้เขียนต่อ `.select('id')` ไว้แล้ว (= ตั้งใจจะนับแถว)
 *    แต่ส่งผลเข้า `checkWrite` ซึ่งไม่เคยอ่าน `data` ⇒ `.select('id')` นั้นเสียเปล่า
 *    ทั้ง 7 จุดคิดว่าตัวเองกันบั๊กคลาสนี้แล้ว — อันตรายกว่าไม่เช็คเลย
 *
 * 📌 **ต้องต่อ `.select(...)` ท้ายคิวรีเสมอ** ไม่งั้น supabase คืน `data: null` (นับไม่ได้)
 *    — มีด่าน `checkwriterows-needs-select` ใน build คุมให้
 *
 * @param res   ผลจาก `await supabase.from(...).update(...).eq(...).select('id')`
 * @param label ป้ายงานสำหรับ toast (เช่น `'ยืนยันรายการ'`)
 * @param min   จำนวนแถวต่ำสุดที่ถือว่าสำเร็จ (default 1)
 * @param zeroMsg ข้อความ toast ตอนโดน 0 แถว — ใส่เมื่อรู้สาเหตุที่เจาะจงกว่าข้อความกลาง
 *                (เช่น `'ไม่พบสินค้า X ใน Product Master'`)
 * @returns `true` = สำเร็จจริง · `false` = ล้ม หรือโดน 0 แถว (toast ขึ้นให้แล้ว)
 */
export function checkWriteRows(res, label, { min = 1, zeroMsg } = {}) {
  if (res?.error) {
    toast.error(`${label}ไม่สำเร็จ: ${res.error.message}`);
    return false;
  }
  if (!Array.isArray(res?.data)) {
    // ไม่ได้ต่อ .select() ⇒ นับแถวไม่ได้ · ถอยไปใช้พฤติกรรม checkWrite (ห้ามทำปุ่มพังเพราะเรื่องนี้)
    // แต่ **ห้ามเงียบ** — ด่าน checkwriterows-needs-select จะจับตอน build ไม่ให้หลุดมาถึงตรงนี้
    console.warn(`[checkWriteRows] "${label}" ไม่ได้ต่อ .select() — นับแถวไม่ได้ จึงเช็คได้แค่ error`);
    return true;
  }
  if (res.data.length < min) {
    toast.error(zeroMsg || (
      `${label}ไม่สำเร็จ: ระบบไม่ได้แก้แถวไหนเลย (0 แถว) — `
      + 'มักเกิดจากสิทธิ์ไม่พอ หรือแถวนั้นถูกลบ/แก้ไปแล้ว · รีเฟรชหน้าแล้วลองใหม่'
    ));
    return false;
  }
  return true;
}
