/* ══ 📅 workDate — "วันทำงาน" จุดเดียวของทั้งระบบ (pure · 2026-09-23) ════════════════════
 *
 * กฎที่ CLAUDE.md เขียนไว้ตั้งแต่ต้นโปรเจค:
 *   · **ห้ามใช้ `new Date().toISOString()` หาวันที่งาน** — คืน UTC ซึ่งต่างจากไทย (UTC+7)
 *   · วันทำงาน = วันปฏิทิน แต่ **ก่อน 08:00 นับเป็นวันก่อนหน้า** (กะดึกข้ามเที่ยงคืน)
 *
 * ⚠️ แต่ **ไม่เคยมี util กลางจริง** — สำรวจ 23/09 เจอโค้ดชุดเดียวกันถูกก๊อปนิยามซ้ำ **27 ไฟล์**
 *    (`getWorkDate` · `getWorkDateStr` · อารมณ์เดียวกันแบบ inline arrow) ⇒ กฎอยู่ในเอกสาร
 *    แต่ของจริงกระจาย 27 ชุด · แก้กฎทีต้องไล่แก้ 27 ที่ = สักวันต้องมีที่ตกหล่น
 *    ไฟล์นี้คือ single source ที่ควรมีตั้งแต่แรก — **โค้ดใหม่ต้อง import จากที่นี่เท่านั้น**
 *    (ของเดิม 27 จุดยังไม่ย้าย — เป็นงานกวาดแยกต่างหาก ดู docs/modules/time-range-filter.md)
 *
 * ⚠️ รับ `now` เป็นพารามิเตอร์ได้เสมอ เพื่อให้เทสตรึงเวลาได้
 *    (กฎ CLAUDE.md: `npm test` รันรอบ "นาฬิกา +400 วัน" ด้วย — ฟังก์ชันที่กินเวลาปัจจุบัน
 *     แบบตรึงไม่ได้ = เทสระเบิดเวลา ที่ตกเองวันหลังโดยไม่มีใครแตะโค้ด)
 */

/** ชั่วโมงที่ถือว่า "ขึ้นวันทำงานใหม่" — ตรงกับกะเช้าที่เริ่ม 08:00 */
export const WORK_DAY_START_HOUR = 8;

/** `Date` → `'YYYY-MM-DD'` ตามเวลาเครื่อง (ไม่ใช่ UTC) */
export const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * วันทำงานปัจจุบัน `'YYYY-MM-DD'` — ก่อน 08:00 นับเป็นวันก่อนหน้า
 * @param now เวลาอ้างอิง (ใส่เองได้เพื่อเทส) · default = ตอนนี้
 */
export function getWorkDate(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < WORK_DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return localDateStr(d);
}

/** กะปัจจุบัน — เช้า 08:00–19:59 · ดึก 20:00–07:59 */
export function getCurrentShift(now = new Date()) {
  const h = new Date(now).getHours();
  return h >= WORK_DAY_START_HOUR && h < 20 ? 'day' : 'night';
}
