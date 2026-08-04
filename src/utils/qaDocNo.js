/**
 * เลขเอกสาร running ฝั่ง QA — เช่น NCR-202608-003
 *
 * แยกออกจาก QualityControl.jsx (2026-08-04) เพื่อให้แท็บใบตรวจ (QaCheckSheet)
 * เปิด NCR จากจุดที่ตรวจไม่ผ่านได้ โดยไม่ต้อง import ข้ามไป-กลับกับหน้า (circular import)
 */
import { supabase } from '../supabaseClient';

// วันงานตามกฎทั้งระบบ: ก่อน 08:00 นับเป็นวันก่อนหน้า (ห้าม toISOString — ดู CLAUDE.md)
function workDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** เลขถัดไปของเดือนนี้ — นับต่อจากเลขล่าสุดที่มีอยู่ของ prefix+เดือนเดียวกัน */
export async function nextDocNo(table, col, prefix) {
  const ym = workDate().slice(0, 7).replace('-', '');
  const full = `${prefix}-${ym}-`;
  const { data } = await supabase.from(table).select(col).like(col, `${full}%`).order(col, { ascending: false }).limit(1);
  const last = data?.[0]?.[col];
  const seq = last ? parseInt(last.slice(full.length), 10) + 1 : 1;
  return `${full}${String(seq).padStart(3, '0')}`;
}

export default nextDocNo;
