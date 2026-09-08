/* ── 🤝 คนที่ถูก "ยืมตัว" มาช่วยไลน์ใน scope (ตาราง line_helpers · Main) ─────────────────────
   ทำอะไร: หน้าไหนที่กรองรายชื่อพนักงานด้วย scope (ไลน์/ส่วนงานสังกัดเดิม) แล้วมี "งานที่หัวหน้า
     ไลน์ปลายทางต้องทำให้คนที่ยืมมา" ต้องเอาคนยืมมาต่อท้ายรายชื่อด้วย ไม่งั้นคนที่ยืมข้ามส่วนงาน
     จะหายไปจากจอทั้งที่ยืนทำงานอยู่ในไลน์นั้นจริงๆ

   ใครใช้: /ojt-training (picker ผู้เข้าอบรม) · /operator (ทะเบียน+คะแนนทักษะ) ·
     /report แท็บ Skill Matrix (ใบประเมินทักษะรายบุคคล F-PRS-P1-119)

   ทำไมต้องเป็นไฟล์นี้: กฎเดียวกันถูกใช้ ≥3 หน้า — เขียนซ้ำในหน้าแล้วดริฟท์แน่นอน
     (ENGINEERING-PRINCIPLES §"ค่า/สูตร/รายการเดียวกันใช้มากกว่า 1 ที่ ต้องมีจุดเดียวที่เป็นเจ้าของ")

   ข้อจำกัดที่ต้องรู้:
   - การยืมผูกกับ work_date + shift → **หมดกะหลุดเอง ไม่ต้องกดคืน** ⇒ ฟังก์ชันนี้ตอบว่า
     "ตอนนี้ใครถูกยืมมา" ไม่ใช่ "เคยถูกยืมมา" · หน้าที่ทำงานย้อนหลังต้องส่ง workDate/shift เอง
   - แถวที่ได้ติดป้าย `_isHelper` / `_helperFrom` / `_helperTo` — หน้าที่แสดงผลต้องบอกผู้ใช้ว่าเป็นคนยืม
     ไม่งั้นหัวหน้าเข้าใจว่าคนนี้ย้ายสังกัดมาแล้ว (employees.line_id ไม่เคยถูกแตะ — การยืมเป็นเรื่องรายวัน)
   - **ห้ามใช้เพื่อขยายสิทธิ์เขียน** — ใช้เติม "รายชื่อที่มองเห็น" เท่านั้น ส่วนปุ่มแก้ไขยังคุมด้วย can() เหมือนเดิม  */

import { inSectionScope } from './sectionScope.js';

/* ⚠️ supabaseClient ถูก import แบบ dynamic ในฟังก์ชัน ไม่ใช่บนหัวไฟล์ — **ห้ามเปลี่ยนเป็น static import**
   supabaseClient.js อ่าน `import.meta.env` ซึ่งพังนอก Vite ⇒ ไฟล์ util ที่ static import มัน
   จะ import ใน `node --test` ไม่ได้เลย (แพทเทิร์นเดียวกับหมายเหตุใน mtnStepPerm.js / downtimeRules.js)
   ทำแบบนี้แล้วส่วน pure ของไฟล์นี้ยังมีเทสล็อกไว้ได้ โดยไม่ต้องแตกเป็น 2 ไฟล์ */

/** วัน+กะปัจจุบันตามกฎโรงงาน: work date ตัด 08:00 (กะดึกข้ามวันนับเป็นวันก่อน) · กะเช้า 08:00–19:59
 *  (กฎเดียวกับ getShiftInfo() ใน Checkin.jsx — ที่นี่เป็นเวอร์ชันไม่มี label สำหรับใช้ query) */
export function currentWorkShift(now = new Date()) {
  const d = new Date(now);
  if (now.getHours() < 8) d.setDate(d.getDate() - 1);
  const workDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { workDate, shift: (now.getHours() >= 8 && now.getHours() < 20) ? 'day' : 'night' };
}

/** pure — ไลน์ปลายทางที่ยืมไป อยู่ใน scope ของผู้ใช้คนนี้ไหม
 *  @param lineIds  Set|Array ของ line id ที่ผู้ใช้ดูแล (leader = ครอบครัวไลน์) · null/undefined = ไม่จำกัดด้วยไลน์
 *  @param scopeSecs ส่วนงานที่ผู้ใช้ดูแล · [] = ไม่จำกัด (admin/manager)
 *  @param lineById  { [id]: { section } } สำหรับหา section ของไลน์ปลายทาง  */
export function isBorrowIntoScope(lineIds, scopeSecs, lineById, toLineId) {
  if (lineIds) {
    const arr = Array.isArray(lineIds) ? lineIds : [...lineIds];
    // ไม่มีไลน์ใน scope เลย = ไม่ควรเห็นคนยืมของใคร (fail-closed — ดีกว่าเปิดหมด)
    return arr.some(id => Number(id) === Number(toLineId));
  }
  return inSectionScope(scopeSecs, lineById?.[toLineId]?.section);
}

/**
 * ต่อท้ายรายชื่อ `list` ด้วยคนที่ถูกยืมมาไลน์ใน scope (ตัดคนที่มีอยู่แล้วออก)
 * @param {Array}  list      รายชื่อที่หน้านั้นโหลดมาแล้ว (scope เดิม)
 * @param {Object} opts
 *   - lines      ทะเบียนไลน์ (ต้องมี id, name, section) — ใช้ทำป้าย "ยืมจาก X มาช่วย Y"
 *   - lineIds    Set|Array line id ใน scope (leader) · null = ใช้ scopeSecs แทน
 *   - scopeSecs  ส่วนงานใน scope · [] = ไม่จำกัด
 *   - columns    คอลัมน์ที่จะ select ให้เหมือนกับที่หน้านั้นใช้ (ไม่งั้นแถวคนยืมขาดฟิลด์แล้วจอพัง)
 *   - workDate/shift  ระบุเองเมื่อทำงานย้อนหลัง · ไม่ส่ง = กะปัจจุบัน
 *   - activeOnly เอาเฉพาะพนักงาน is_active (default true)
 * @returns {Promise<Array>} list เดิม + คนยืม (ติดป้าย _isHelper/_helperFrom/_helperTo)
 *
 * อ่านไม่ได้ (ตารางหาย / RLS / เน็ตล่ม) = คืน list เดิมเป๊ะ + console.warn
 * เจตนา: ฟีเจอร์นี้ "เติมคน" อย่างเดียว พังแล้วต้องไม่ทำให้รายชื่อหลักหาย
 */
export async function mergeBorrowedEmployees(list, opts = {}) {
  const { lines = [], lineIds = null, scopeSecs = [], columns = '*',
          workDate, shift, activeOnly = true } = opts;
  const ws = (workDate && shift) ? { workDate, shift } : currentWorkShift();

  const { supabase } = await import('../supabaseClient');
  const { data: helpers, error } = await supabase.from('line_helpers')
    .select('employee_id, to_line_id')
    .eq('work_date', ws.workDate).eq('shift', ws.shift);
  if (error) {
    console.warn('[line_helpers] อ่านรายชื่อคนยืมตัวไม่สำเร็จ — แสดงเฉพาะคนในสังกัด:', error.message);
    return list;
  }
  if (!helpers?.length) return list;

  const lineById = Object.fromEntries((lines || []).map(l => [l.id, l]));
  const have = new Set((list || []).map(e => e.id));
  const wanted = helpers.filter(h => !have.has(h.employee_id)
    && isBorrowIntoScope(lineIds, scopeSecs, lineById, h.to_line_id));
  if (!wanted.length) return list;

  let q = supabase.from('employees').select(columns).in('id', wanted.map(h => h.employee_id));
  if (activeOnly) q = q.eq('is_active', true);
  const { data: extra, error: e2 } = await q;
  if (e2) {
    console.warn('[line_helpers] โหลดข้อมูลคนยืมตัวไม่สำเร็จ:', e2.message);
    return list;
  }
  const toLineOf = Object.fromEntries(wanted.map(h => [h.employee_id, h.to_line_id]));
  return [...(list || []), ...(extra || []).map(e => ({
    ...e,
    _isHelper:   true,
    _helperFrom: lineById[e.line_id]?.name || e.section || 'ไลน์อื่น',
    _helperTo:   lineById[toLineOf[e.id]]?.name || '',
  }))];
}
