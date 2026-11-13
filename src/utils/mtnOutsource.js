/* ═══ 🔧 ของที่ถอดออกมาส่งซ่อมนอก — สูตร/กติกา (pure · ไม่มี dependency) ═══ 2026-11-09

   จอวาดที่ `src/components/MtnOutsource.jsx` · ตาราง `mtn_outsource_parts` (DR)
   🔴 สูตรอยู่ที่นี่ที่เดียว ห้ามก๊อปไปคิดในหน้า (กฎ `src/utils/` ของโปรเจค)
   🔴 ฟังก์ชันที่กินเวลาปัจจุบัน **ต้องรับ `now` เป็นพารามิเตอร์** — `npm test` รันรอบ
      "นาฬิกา +400 วัน" ด้วย ตัวที่อ่านนาฬิกาเองจะระเบิดในรอบนั้น                       */

/** ยังอยู่ข้างนอกไหม — รับกลับแล้ว/ยกเลิกแล้ว = จบ */
export const isOutsourcePending = (r) => !!r && !r.back_at && !r.cancelled_at;

const BKK_OFFSET_MS = 7 * 3600 * 1000;
/** เลขวันปฏิทิน **ตามเวลาไทย** จาก timestamp — ไม่พึ่ง timezone ของเครื่อง */
const bkkDayNo = (ms) => Math.floor((ms + BKK_OFFSET_MS) / 86400000);

/**
 * เลยนัดรับมากี่วัน — นับเป็น **วันปฏิทินไทย** (นัด 1 พ.ย. · วันนี้ 4 พ.ย. = เลย 3 วัน)
 *
 * 🔴 **ไม่ได้นัด / ยังไม่เลย / จบแล้ว = `null` ห้ามคืน 0** — 0 บนจอแปลว่า "ตรงเวลา"
 *    ซึ่งคนละความหมายกับ "ไม่รู้ว่าควรได้คืนวันไหน"
 * 🔴 **ห้ามนับเป็น "ครบ 24 ชม."** — `expected_at` เป็น `date` ไม่มีเวลา การนับชั่วโมง
 *    คือความละเอียดปลอม และได้เลขน้อยกว่าที่หน้างานอ่าน (= ตามของช้ากว่าที่ควร)
 * 🔴 **ต้องเป็นวันของไทย ไม่ใช่ UTC** — 1 พ.ย. 18:00Z = 2 พ.ย. 01:00 ไทย ⇒ เลยนัดแล้ว 1 วัน
 *    ถ้านับแบบ UTC จะยังบอกว่า "ตรงเวลา" (กฎ Date/Time ของโปรเจค)
 * @param {{expected_at?:string, back_at?:string, cancelled_at?:string}} row
 * @param {number} now เวลาปัจจุบัน (ms) — เทสตรึงค่าได้ (`npm test` รันรอบนาฬิกา +400 วัน)
 */
export function overdueDays(row, now = Date.now()) {
  if (!isOutsourcePending(row) || !row?.expected_at) return null;
  const [y, m, d] = String(row.expected_at).split('-').map(Number);
  if (!y || !m || !d) return null;
  const late = bkkDayNo(now) - Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return late > 0 ? late : null;
}

/** ป้ายสถานะของแถว — สีมาจาก token เท่านั้น (ห้าม hex ดิบ) */
export function outsourceState(row, now = Date.now()) {
  if (row?.cancelled_at) return { key: 'cancelled', text: 'ยกเลิก', color: 'var(--muted)' };
  if (row?.back_at) return { key: 'back', text: '✓ รับกลับแล้ว', color: 'var(--green)' };
  const late = overdueDays(row, now);
  return late
    ? { key: 'overdue', text: `⚠ เลยนัด ${late} วัน`, color: 'var(--red)', lateDays: late }
    : { key: 'out', text: '⏳ อยู่ข้างนอก', color: 'var(--amber)' };
}
