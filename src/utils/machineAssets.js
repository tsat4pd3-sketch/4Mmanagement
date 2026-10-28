/**
 * machineAssets — "แถวไหนในทะเบียน `machines` คือเครื่องจักรจริง" (2026-10-27)
 *
 * ⚠️ ไฟล์นี้ต้อง **ไม่ import supabaseClient** — เป็น util บริสุทธิ์เพื่อให้มีเทสครอบได้
 *    (ตัวโหลดทะเบียนอยู่ `src/utils/useMachines.js` · ป้าย/สีของกระบวนการอยู่ `processTypes.js`)
 */

export const ASSET_KIND_MACHINE = 'machine';

/**
 * 🔴 กฎเหล็ก — ตาราง `machines` ฝั่ง DR เก็บ **สินทรัพย์ทุกชนิด** ไม่ใช่แค่เครื่องจักร
 * (วัดจริง 2026-10-27: เครื่องจักร 226 · แม่พิมพ์ 268 · จิ๊ก 190 · facility 44)
 * และ `process_type` ของแม่พิมพ์/จิ๊ก/facility แทบทั้งหมดเป็น **ค่า default ที่ไม่มีใครแก้**
 * (674/728 แถวเป็น `welding_assembly`)
 *
 * ⇒ "ไลน์นี้เป็นกระบวนการอะไร" ถ้านับรวมทุกชนิด = **แม่พิมพ์กับจิ๊กโหวตชนะเครื่องจักร**
 *   วัดจริง: HDF1 · HDF2 · LASER-345 · LASER-789 ได้ `welding_assembly`
 *   ทั้งที่เครื่องจักรของไลน์เป็น `metal_forming` ทั้งหมด
 *   · และ Airbooster / Utility Hydrofroming / UTLITY STEEL **ไม่มีแถวเครื่องจักรเลย** มีแต่จิ๊ก/facility โหวต
 *   ผลที่ตามมาไม่ใช่แค่ป้ายผิด — `sessionProcessType()` ใน DailyReport เป็นตัวเลือก
 *   **นโยบายเวลาพัก** ⇒ หักเวลาพักผิดชุด ⇒ `shift_min` ผิด ⇒ **%A/%P ผิดทั้งกะ**
 *
 * 🔴 ห้ามนับ/โหวต `process_type` จากตาราง `machines` โดยไม่กรองผ่านฟังก์ชันนี้ (มีด่าน)
 * · ไม่รู้ชนิด (`equipment_kind` เป็น null ทุกแถว = ทะเบียนยังไม่ apply migration หรือ loader
 *   ถอยไปคอลัมน์พื้นฐานใน `useMachines.js`) ⇒ **คืนของเดิมทั้งชุด = พฤติกรรมเดิมเป๊ะ ไม่เปลี่ยนเงียบ**
 * · เหลือ 0 แถวหลังกรอง = **ถูกต้องแล้ว** ให้ผู้เรียกถอยไปดู "สินค้าที่กำลังผลิต" ตามลูกโซ่เดิม
 *   **ห้ามถอยกลับไปนับแม่พิมพ์/จิ๊ก** (= กลับไปเป็นบั๊กเดิม)
 */
export function machineAssetsOnly(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const kindKnown = list.some(m => m.equipment_kind != null);
  if (!kindKnown) return list;
  return list.filter(m => m.equipment_kind === ASSET_KIND_MACHINE);
}

/**
 * 🔴 "ไลน์เครื่องขนานนี้มีกี่เลน" เมื่อไม่ได้ตั้ง `parallel_stations` ไว้ (2026-10-27 · บั๊กจริง)
 *
 * ค่านี้เป็น **ตัวหาร** ของเวลา downtime (`laneWeightFn()` ใน `utils/oee.js`) —
 * ไลน์เครื่องขนานบันทึก DT รายเครื่อง ⇒ ต้องหารจำนวนเลนก่อนหักจากเวลากะ
 * ⇒ **นับเลนเกินจริง = หักเวลาเสียน้อยกว่าจริง = %A/OEE สูงเกินจริง** (ไม่ใช่ต่ำเกิน)
 *
 * วัดจริง 27/10 — ไลน์ `parallel_machine` ที่ไม่ได้ตั้ง `parallel_stations`:
 *   Line D1 - GWM 9 → **4** · Line D3 - STAMPED 8 → **4** · Line D5 - BRK RR BMPR 8 → **5**
 *   · Line D4 - BRK FRT BMPR 5 → **3** (ส่วนเกินคือ **จิ๊ก** ที่ลงทะเบียนใต้ไลน์เดียวกัน)
 *
 * 🔴 ผู้เรียกเป็นคนตัด `is_active` เอง (แต่ละจอมีกติกาไม่เหมือนกันอยู่แล้ว) —
 *   ฟังก์ชันนี้รับผิดชอบเรื่อง **ชนิดสินทรัพย์** อย่างเดียว
 * · นับ `machine_no` แบบไม่ซ้ำ (ทะเบียนมีแถวซ้ำเลขเดียวกันได้)
 */
export function machineLaneCount(rows) {
  return new Set(machineAssetsOnly(rows).map(m => m.machine_no).filter(Boolean)).size;
}

/**
 * 🔴 ตรงข้ามกับ `machineAssetsOnly()` — **"dropdown ควรมีตัวเลือกอะไร" ต้องใจกว้าง ห้ามกรอง**
 *   (2026-10-27 · เกือบพลาดตอนแก้บั๊กโหวต)
 *
 * ฟังก์ชันนี้**คืนของเดิมทั้งชุดโดยเจตนา** มีไว้เพื่อให้ "การไม่กรอง" เป็นสิ่งที่เห็นในโค้ด
 * ไม่ใช่สิ่งที่ดูเหมือนลืมกรอง (ไม่งั้น session ถัดไปจะมา "แก้" ให้กรอง แล้วพังเงียบ)
 *
 * ทำไมต้องไม่กรอง: ความผิด 2 ทางไม่เท่ากัน
 * · โชว์ประเภทเกินมา = **เสียงรบกวน** คนหน้างานเลื่อนผ่าน
 * · ซ่อนประเภทที่ต้องใช้ = **บันทึกปัญหาจริงไม่ได้** ⇒ ปัญหานั้นหายจากพาเรโตทั้งใบ
 *
 * หลักฐานจากของจริง (ทำไมถึงห้ามกรองจุดนี้):
 * · `Line 60` — เครื่องจักรในทะเบียนเป็น `welding_assembly` เท่านั้น ส่วน `metal_forming`
 *   มาจาก**แม่พิมพ์/จิ๊ก** · แต่ไลน์นี้ลง downtime ประเภท `metal_forming` ไปแล้ว **10 ใบจริง**
 *   ⇒ กรองจิ๊กออก = ตัวเลือกที่ใช้อยู่หายไป 24 รายการ
 * · `Airbooster` · `Utility Hydrofroming` · `UTLITY STEEL` — ไม่มีแถวเครื่องจักรเลย
 *   กรองแล้วเหลือศูนย์ = dropdown ว่าง
 *
 * ⇒ กฎ: **โหวต/สรุปเป็นคำตอบเดียว → `machineAssetsOnly()` · รวมเป็นตัวเลือก → `processUnionRows()`**
 */
export function processUnionRows(rows) {
  return Array.isArray(rows) ? rows.filter(Boolean) : [];
}
