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
import { legacyPatchOf } from '../utils/ppeRequirements';

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

/* ══ 🦺 PPE หลังเช็คชื่อ ═══════════════════════════════════════════════════════════════════
   (2026-11-10 · คำสั่ง user *"พอสแกนและกดว่ามาทำงาน ให้ถามต่อว่าใส่ PPE ครบมั้ย"*)

   🔴 ถาม**เฉพาะรายการที่หน่วยนั้นบังคับ** และเริ่มที่ "ยังไม่ติ๊ก" — ห้ามถามว่า "ครบมั้ย? [ครบ]"
   วัดจริง 12/10–10/11: 3 ช่องเดิมถูกติ๊กครบ 99.6% (ไม่ครบแค่ 17/4,080 แถว) = ตรายางไปแล้ว
   ถามแบบปุ่มเดียวอีก = ได้ตรายางอันที่ 2 ยิ่งหน้าประตูที่มีคนต่อคิว
   · **ข้ามได้** — ข้าม = ไม่เขียนแถวผลตรวจเลย ⇒ `ppeStatusOf` คืน `none` ("ยังไม่ได้ตรวจ")
     ซึ่งคนละเรื่องกับ "ตรวจแล้วขาด" · ห้ามเขียน ok=true ให้ตอนข้าม
   ════════════════════════════════════════════════════════════════════════════════════════ */

/** โหลดทะเบียน PPE (รายการ + ข้อกำหนด) · อ่านไม่ได้ = คืน `null` ให้จอเขียนบอก ห้ามคืน [] */
export async function loadPpeRegistry(sb) {
  const [it, rq] = await Promise.all([
    sb.from('ppe_items').select('id, code, name_th, icon, legacy_col, sort_order, is_active').order('sort_order'),
    sb.from('ppe_requirements').select('scope_kind, scope_key, item_id, required'),
  ]);
  if (it.error || rq.error) return null;
  return { items: it.data || [], reqs: rq.data || [] };
}

/** ผลตรวจ PPE ของคนหนึ่งในวันหนึ่ง · อ่านไม่ได้ = `null` (คนละอย่างกับ "ยังไม่เคยตรวจ" = []) */
export async function loadPpeChecks(sb, { employeeId, workDateStr }) {
  const { data, error } = await sb.from('ppe_check_items')
    .select('item_id, ok').eq('work_date', workDateStr).eq('employee_id', employeeId);
  return error ? null : (data || []);
}

/**
 * บันทึกผลตรวจ PPE ของคนเดียว
 * @param required  รายการที่หน่วยนั้นบังคับ (จาก `resolvePpe`)
 * @param okByItemId `{ [item_id]: boolean }` — ติ๊กแล้ว/ไม่ติ๊ก
 * @returns {{ ok:boolean, legacySynced:boolean }} legacySynced=false = แถวละเอียดบันทึกแล้ว
 *   แต่คอลัมน์เดิมใน `daily_production_logs` ยังไม่ตรง ⇒ จอต้องบอก ห้ามเงียบ
 */
export async function savePpeChecks(sb, { emp, workDateStr, required = [], okByItemId = {}, userId }) {
  if (!required.length) return { ok: true, legacySynced: true };
  const rows = required.map(it => ({
    work_date: workDateStr, employee_id: emp.id, item_id: it.id,
    ok: !!okByItemId[String(it.id)], checked_by: userId || null, checked_at: new Date().toISOString(),
  }));
  const wrote = checkWriteRows(await sb.from('ppe_check_items')
    .upsert(rows, { onConflict: 'work_date,employee_id,item_id' })
    .select('item_id'), 'บันทึกผลตรวจ PPE', { min: rows.length });
  if (!wrote) return { ok: false, legacySynced: false };

  // 🔁 ซิงก์ 3 คอลัมน์เดิม ไม่งั้นจอเช็คชื่อ/ชิป "PPE ไม่ครบ" กับจอนี้เถียงกัน
  const patch = legacyPatchOf(required, okByItemId);
  if (!Object.keys(patch).length) return { ok: true, legacySynced: true };
  const synced = checkWriteRows(await sb.from('daily_production_logs')
    .update(patch).eq('work_date', workDateStr).eq('employee_id', emp.id)
    .select('employee_id'), 'ซิงก์ PPE กับใบเช็คชื่อ');
  return { ok: true, legacySynced: !!synced };
}
