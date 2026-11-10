/* ══ 🪪 checkinSave — "เขียนเช็คชื่อลง `daily_production_logs`" ของกลางชุดเดียวของระบบ ══════════
   (2026-11-10 · คำสั่ง user — เดิมสูตรแถวอยู่ในหน้า `Checkin.jsx` อย่างเดียว)

   ตอนนี้มี **2 ประตู** ที่เช็คชื่อได้ และทั้งคู่ต้องเขียนฟิลด์ชุดเดียวกันเป๊ะ:
     ① `/checkin` — ปุ่ม 💾 (ทั้งจอ) และกล้องยิงบัตรรัวในหน้านั้น
     ② `/scan`   — ยิงบัตรใบเดียวแล้วจบตรงนั้น (ไม่ต้องเปิดหน้าเช็คชื่อ)
   แยกสูตร = ประตูหนึ่งเขียนแถวที่ขาดฟิลด์ อีกประตูกดบันทึกทับทีหลังแล้วค่าเด้งกลับ

   🔴 กติกาที่ห้ามพัง:
   · **ห้ามทับของที่คนอื่นกรอกไว้แล้ว** — PPE/OT/ลา/หมายเหตุ ต้อง merge จากแถวเดิมเสมอ
     (ยิงบัตร = ยืนยันแค่ "มางาน" ไม่ได้แปลว่าใส่ PPE ครบ · หัวหน้าติ๊ก PPE ทีหลังที่หน้าเช็คชื่อ)
   · **มางานอยู่แล้ว = ไม่เขียนซ้ำ** (`already`) — เขียนซ้ำ = ทับ `checked_by` ของคนที่เช็คจริงคนแรก
     ⚠️ ยกเว้นในหน้า `/checkin` ที่ "มางาน" อาจเป็นแค่**ติ๊กค้างบนจอที่ยังไม่เคยลงฐาน**
       ⇒ หน้านั้นตัดสินเองจาก state ของมัน แล้วค่อยเรียก `upsertCheckin` (ดู `onBadgeScan`)
   · ทุกการเขียนผ่าน `checkWriteRows` + `.select()` — RLS ปฏิเสธ UPDATE = 0 แถว ไม่มี error
   · วันที่งาน/กะ มาจาก `getWorkDate()`/`getCurrentShift()` เท่านั้น (ห้าม `toISOString()`)
   ══════════════════════════════════════════════════════════════════════════════════ */
import { checkWriteRows } from '../utils/dbWrite';
import { markPresentRecord } from '../utils/badgeCheckin';

/** คอลัมน์ของแถวเช็คชื่อ (ใช้ตอนอ่านแถวเดิมมา merge) */
export const CHECKIN_COLS = 'id, shift, is_present, has_helmet, has_boots, has_gloves, has_ot, '
  + 'has_extended_ot, remark, leave_type, leave_duration, leave_period, leave_hours, checked_by';

/** 🧾 แถวที่เขียนลง `daily_production_logs` — **ของกลาง ห้ามประกอบซ้ำที่อื่น** */
export function checkinLogRow({ emp, rec = {}, workDateStr, shift, userId }) {
  return {
    employee_id:      emp.id,
    work_date:        workDateStr,
    shift,
    is_present:       !!rec.is_present,
    has_helmet:       !!rec.has_helmet,
    has_boots:        !!rec.has_boots,
    has_gloves:       !!rec.has_gloves,
    has_ot:           !!rec.has_ot,
    has_extended_ot:  !!rec.has_extended_ot,
    remark:           rec.remark || null,
    leave_type:       rec.leave_type     || null,
    leave_duration:   rec.leave_duration || null,
    leave_period:     rec.leave_period   || null,
    leave_hours:      rec.leave_hours    ? Number(rec.leave_hours) : null,
    checked_by:       userId,
  };
}

/** เขียน 1 แถว (upsert ตาม `work_date,employee_id`) · คืน true เมื่อ **มีแถวถูกเขียนจริง** */
export async function upsertCheckin(sb, row, label = 'เช็คชื่อด้วยบัตร') {
  return checkWriteRows(await sb.from('daily_production_logs')
    .upsert(row, { onConflict: 'work_date,employee_id' })
    .select('employee_id'), label);
}

/**
 * 🪪 ยิงบัตร 1 ใบ แล้วบันทึก "มางาน" ทันที — สำหรับประตูที่**ไม่มีรายชื่อบนจอ** (`/scan`)
 *
 * อ่านแถวเดิมก่อนเสมอ ⇒ รู้ว่า "เช็คไว้แล้วหรือยัง" และได้ของเดิมมา merge
 * @returns {{kind:'saved'|'already'|'read_failed'|'failed', shift?:string, row?:object}}
 *   saved = เขียนแล้ว · already = มางานอยู่แล้ว (ไม่เขียนซ้ำ) ·
 *   read_failed = อ่านแถวเดิมไม่ได้ ⇒ **ห้ามเขียน** (เขียนทั้งที่ไม่รู้ของเดิม = ทับ PPE/ลา ของคนอื่น) ·
 *   failed = เขียนไม่สำเร็จ (toast ขึ้นให้แล้ว)
 */
export async function checkinByBadge(sb, { emp, workDateStr, shift, userId }) {
  const { data, error } = await sb.from('daily_production_logs')
    .select(CHECKIN_COLS)
    .eq('work_date', workDateStr).eq('employee_id', emp.id).limit(1);
  if (error) return { kind: 'read_failed', msg: error.message };

  const cur = data?.[0] || null;
  if (cur?.is_present) return { kind: 'already', shift: cur.shift || shift, row: cur };

  // กะ: ของแถวเดิมชนะ (หัวหน้า/ตารางกะตั้งไว้แล้ว) — ไม่มีค่อยใช้กะปัจจุบัน
  const useShift = cur?.shift || shift;
  const rec = markPresentRecord(cur || {});   // ลาเต็มวัน = มาจริง ⇒ ล้างการลา · ลาครึ่งวันคงไว้
  const ok = await upsertCheckin(sb, checkinLogRow({ emp, rec, workDateStr, shift: useShift, userId }));
  return ok ? { kind: 'saved', shift: useShift, row: rec } : { kind: 'failed' };
}
