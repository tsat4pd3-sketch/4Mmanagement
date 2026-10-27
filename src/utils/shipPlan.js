/**
 * "แผน 862" ≠ "order ที่ต้องส่ง" สำหรับพาร์ทที่ลูกค้ายืนยันด้วย e-SMART (2026-10-27 · คำสั่ง user)
 * *"862 เห็นภาพรวมทั้งวันว่ามีส่งกี่รอบ ช่วงไหน แต่พอคอนเฟิร์มจะใช้ e-SMART คอนเฟิร์มรอบที่จะส่ง"*
 * *"หน้างานจะไม่ยุ่งกับข้อมูลที่ไม่ตรงรอบของ 862"* · *"วันที่จะโชว์ให้แขกมาดู แดงแบบนี้ไม่ได้"*
 *
 * เดิมใบ 862 ที่ e-SMART ยังไม่ยืนยันขึ้น 🔴 เลยเวลา เหมือน order จริง ⇒ AAT แดงทั้งแถวทุกวัน
 * ทั้งที่ไม่มีใครต้องส่งตามใบนั้น (เคสจริง 26/10: 27 รอบเลยเวลา · ส่วนใหญ่เป็นแผนที่ไม่เคยถูกเรียก)
 *
 * กติกา: ใบ **edi_862 · pending · ยังไม่มีไฟล์ e-SMART จอง** ของ (ship-to, MAT) ที่ **เคยถูก e-SMART ยืนยัน**
 * = "แผน" → จอวาดเทาเส้นประ ไม่นับเลยเวลา/ค้างส่ง · ยังโชว์และนับแยกให้เห็น (ห้ามซ่อน)
 * ⚠️ ขอบเขต = "พาร์ทที่เคยมาในไฟล์ e-SMART ของ ship-to นั้น" (user เลือก 21/10) — พาร์ทอื่นของ AAT
 *    ที่ไม่เคยมาใน e-SMART (เช่น 10100814 dock T6) ยังเป็น order ปกติ
 */
export const planKey = (customer, mat) => `${String(customer ?? '').trim()}|${String(mat ?? '').trim()}`;

/** ชุด (ship-to, MAT) ที่ e-SMART เคยยืนยัน — จากใบที่มี `pull_batch_id` */
export function buildEsmartManaged(rows) {
  const s = new Set();
  for (const r of rows || []) if (r?.customer && r?.mat_no) s.add(planKey(r.customer, r.mat_no));
  return s;
}

/** ใบนี้เป็น "แผน 862 รอ e-SMART ยืนยัน" ไหม (ไม่ใช่ order ที่หน้างานต้องส่ง) */
export function isEsmartPlanRow(o, managed) {
  return !!o && o.source === 'edi_862' && o.status === 'pending' && !o.pull_batch_id
    && !!managed?.has(planKey(o.customer, o.mat_no));
}
