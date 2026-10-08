/* ═══ 🗑️ "ถังขยะ" ของจอวิเคราะห์ — อื่นๆ / ไม่ระบุ (2026-09-23 · คำสั่ง user) ═══════

   ที่มา: *"ไม่ระบุกับอื่นๆ มาอันดับ 1 กับ 2 การวิเคราะห์จะไม่มีประโยชน์เลย"*
   → *"ถ้าทำตรงนี้ได้ ขยายผลกับทุกกราฟการวิเคราะห์ input ที่พนักงานลงมาเลยนะ"*

   ── audit ทั้งระบบ 23/09 (วัดจากข้อมูลจริง 90 วัน) ──
     · ใบซ่อม MO      🔴 ไม่ระบุกลุ่ม 65% + อื่นๆ 33% = 98%  ← แก้แล้วรอบนี้
     · Downtime       🟡 ถังขยะ ~6.3% ของนาที (ไม่ขึ้น top3)
     · ของเสีย defect ✅ top8 ไม่มีถังขยะเลย · 85-95% มีข้อความประกอบ
     · 4M             ✅ กรอกรายละเอียดครบ 100%

   ── 🔴 กติกา 3 ชั้น (ชั้นบนแก้ได้เยอะสุด ชั้นล่างคือกันพลาด) ──
   ชั้น 1 **ต้นทาง — ห้ามเขียน "อื่นๆ" ทับค่าที่ระบบรู้อยู่แล้ว**
         นี่คือ 2 ใน 3 ของปัญหาทั้งหมด และไม่ต้องใช้อัลกอริทึมอะไรเลย
         เคสจริง: เปิดใบซ่อมจากดาวน์ไทม์ โค้ด hardcode `problem_characteristic:'อื่นๆ'`
         ทั้งที่ประเภทดาวน์ไทม์อยู่ในมือตั้งแต่ตอนกดปุ่ม (325 ใบ) — มีด่าน regressionGuards แล้ว
   ชั้น 2 **ทะเบียน — taxonomy ต้องครบและมีกลุ่ม**
         เคสจริง: ทีม production เปิด 89% ของใบ แต่ไม่มีอาการในทะเบียนเลยสักแถว
         ⇒ เลือกอะไรไม่ได้นอกจาก "อื่นๆ"
   ชั้น 3 **จอ — ที่เหลือจริงๆ ต้องบอกตรงๆ ว่าชี้เป้าไม่ได้ ห้ามปล่อยให้ดูเหมือนอันดับ 1**
         แยก "อื่นๆ ที่มีข้อความ" (จับกลุ่มต่อได้) ออกจาก "ไม่ระบุเลย" (ต้องไปแก้ที่การกรอก)

   ⚠️ pure — ห้าม import supabase (ต้องเทสได้ด้วย node --test ตรงๆ)                 */

/** ป้ายที่ "บอกอะไรไม่ได้" — ครอบทั้งไทย/อังกฤษ/ค่าว่าง
 *  ⚠️ ห้ามเอาไปใช้ตั้งชื่อแท่งที่ **ระบบสร้างเอง** (เช่นแท่งรวมหางยาวของพาเรโต)
 *     ไม่งั้นตัวเตือน "ข้อมูลชี้เป้าไม่ได้" จะนับของที่เราสร้างเองเข้าไปด้วย */
const VAGUE_RE = /^\s*$|อื่น\s*ๆ?|ไม่ระบุ|ไม่ทราบ|^n\/?a$|^-+$|^other?s?$|^etc\.?$|^unknown$/i;
export const isVague = (label) => VAGUE_RE.test(String(label ?? '').trim());

/** งานที่ "ไม่ใช่ปัญหา" — ตามแผน/ตามรอบ ⇒ ต้องไม่ถูกนับในพาเรโต *ปัญหา*
 *  (user 23/09 ตัดสิน: "เปลี่ยนตามรอบ PM" 54 ใบ = งานตามแผน แยกออก ไม่ใช่ปัญหา)
 *  **แยกออก ≠ ซ่อน** — จอต้องบอกว่ากันออกไปกี่ใบเสมอ */
export const PLANNED_GROUP = 'งานตามแผน (PM)';
export const isPlannedWork = (group) => String(group ?? '').trim() === PLANNED_GROUP;

/* ═══ ป้าย 2 ตัวที่เคยชนกันเป็น "อื่นๆ" ทั้งคู่ (2026-10-06 · user: "มั่ว ระบบ dropdown") ═══
   เดิมทะเบียน `mtn_problem_types` มีแถวจริงชื่อ "อื่นๆ" (ของกลาง) **และ** โค้ดฝั่งจอ
   ตั้งชื่อถังสังเคราะห์ของแถวที่ไม่มีกลุ่มว่า `NO_GROUP='อื่นๆ'` ⇒ dropdown เดียวมีป้าย
   ซ้ำ 2 ความหมาย เลือกแล้วไม่รู้ว่าได้อะไร · แยกเป็น 2 ค่าคนละตัว:                       */

/** กลุ่มของ "อาการที่คนเลือกว่าระบุไม่ได้" — เป็นกลุ่ม **จริงในทะเบียน** เก็บลง DB ได้
 *  ⚠️ ยังเข้าเงื่อนไข `isVague()` ⇒ จอวิเคราะห์ยังนับเป็น "ชี้เป้าไม่ได้" ตามกฎ ไม่ได้ซ่อน */
export const OTHER_GROUP = 'อื่นๆ / ยังระบุไม่ได้';

/** ถังสังเคราะห์ของแถวทะเบียนที่ **ยังไม่ได้ตั้งกลุ่ม** — ป้ายสำหรับโชว์บนจอเท่านั้น
 *  🔴 ห้ามเขียนค่านี้ลง DB (ไม่ใช่ taxonomy จริง เป็นอาการว่าทะเบียนยังไม่ครบ) */
export const UNGROUPED_LABEL = 'ยังไม่จัดกลุ่ม';

/**
 * แยกแถวเป็น 3 กอง เพื่อให้จอบอกความจริงได้ครบ
 * @param {Array} rows
 * @param {(r:any)=>string} labelOf  ป้ายหมวดที่ใช้จัดกลุ่ม
 * @param {(r:any)=>string} textOf   ข้อความอิสระที่พนักงานพิมพ์ (ถ้ามี)
 * @returns {{ ok:Array, vagueWithText:Array, blank:Array, planned:Array,
 *             total:number, vaguePct:number, actionablePct:number }}
 */
export function splitUnclassified(rows = [], { labelOf = (r) => r?.cat, textOf = (r) => r?.note } = {}) {
  const ok = [], vagueWithText = [], blank = [], planned = [];
  for (const r of rows) {
    const label = labelOf(r);
    if (isPlannedWork(label)) { planned.push(r); continue; }
    if (!isVague(label)) { ok.push(r); continue; }
    // "อื่นๆ" ที่มีข้อความ = ยังจับกลุ่มต่อได้ · ไม่มีข้อความ = จบ ต้องไปแก้ที่การกรอก
    (String(textOf(r) ?? '').trim() ? vagueWithText : blank).push(r);
  }
  const total = rows.length || 0;
  const vague = vagueWithText.length + blank.length;
  return {
    ok, vagueWithText, blank, planned, total,
    vaguePct: total ? (vague / total) * 100 : 0,
    actionablePct: total ? (ok.length / total) * 100 : 0,
  };
}

/** ข้อความสรุปสำหรับแสดงบนจอ — คืน null เมื่อไม่มีอะไรต้องเตือน
 *  (กฎความซื่อสัตย์ของจอ: ชี้เป้าไม่ได้เท่าไหร่ ต้องเขียนบนจอ ห้ามเงียบ) */
export function unclassifiedNote(split, { unit = 'รายการ', warnPct = 20 } = {}) {
  if (!split?.total) return null;
  const n = split.vagueWithText.length + split.blank.length;
  if (!n) return null;
  const parts = [];
  if (split.vagueWithText.length) parts.push(`${split.vagueWithText.length} ${unit}มีข้อความให้จับกลุ่มต่อได้`);
  if (split.blank.length) parts.push(`${split.blank.length} ${unit}ไม่กรอกอะไรเลย — ต้องแก้ที่ขั้นตอนกรอก`);
  return {
    level: split.vaguePct >= warnPct ? 'warn' : 'info',
    text: `ยังชี้เป้าไม่ได้ ${n} ${unit} (${split.vaguePct.toFixed(0)}%) — ${parts.join(' · ')}`,
    planned: split.planned.length,
  };
}
