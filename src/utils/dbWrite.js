// ─── ตัวเช็คผลการเขียน DB จาก client ─────────────────────────────────────────
// supabase-js ไม่ throw — คืน { data, error } เสมอ ⇒ `await supabase.from(...).update(...)` เปล่าๆ
// = คิวรีล้มแล้วไม่มีใครรู้ (CLAUDE.md §กฎเหล็กการเขียน DB จาก client ข้อ 1)
// ใช้: checkWrite(await supabase.from('t').update(x).eq('id', id), 'บันทึกเวลา')
//   → error: toast แดง "บันทึกเวลาไม่สำเร็จ: <สาเหตุ>" แล้วคืน false · สำเร็จคืน true
// ⚠️ ไม่ได้นับแถว — ตารางฝั่ง Main ที่ RLS ปฏิเสธ UPDATE/DELETE จะ "0 แถว ไม่มี error" (กฎข้อ 2)
//    จุดที่ผลลัพธ์สำคัญให้ .select('id') แล้วนับเอง (ดูตัวอย่างใน LineSetup / Management)
import { toast } from '../components/Toast';

export function checkWrite(res, label) {
  if (res?.error) {
    toast.error(`${label}ไม่สำเร็จ: ${res.error.message}`);
    return false;
  }
  return true;
}
