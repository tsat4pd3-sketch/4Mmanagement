// ⏱️ รูปแบบ "ช่วงเวลา" ของทั้งระบบ — ย้ายออกมาจาก utils/mtnMetrics.js (2026-10-06)
// ทำไมต้องมีไฟล์กลาง: จอหน้างานเขียน "เกินกำหนดมาแล้ว 91,098 นาที" ไม่ได้ คนอ่านไม่ออกว่านานแค่ไหน
// และสูตรแปลงนาที→ชม. ถูกก๊อปไว้หลายหน้าแล้ว (DailyReport · MtnRepair · OrderTrace) ซึ่ง drift กันได้
// ⚠️ ไฟล์นี้ import ได้แค่ `./i18n.js` (ชั้นภาษา · ไม่มี react/DB) — หน่วย "น./ชม./วัน" ต้องตามภาษาที่คนกดอยู่ (25/11)
//    ห้ามลากโมดูลอื่นเข้ามา — จอไหนก็หยิบไปใช้ได้
import { tr, unitDays } from './i18n.js';

/** นาที → "2 ชม. 15 น." อ่านง่ายบนจอหน้างาน · null = "—" (ไม่รู้ ไม่ใช่ 0) */
export function fmtDur(min) {
  if (min == null || Number.isNaN(min)) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} ${tr('น.')}`;
  const h = Math.floor(m / 60), rest = m % 60;
  if (h < 24) return rest ? `${h} ${tr('ชม.')} ${rest} ${tr('น.')}` : `${h} ${tr('ชม.')}`;
  const dd = Math.floor(h / 24), hh = h % 24;
  return hh ? `${dd} ${unitDays(dd)} ${hh} ${tr('ชม.')}` : `${dd} ${unitDays(dd)}`;
}
