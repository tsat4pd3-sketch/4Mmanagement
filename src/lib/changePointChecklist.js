/* 15 รายการ checklist คงที่ของฟอร์ม "Changing Point Control Record"
   ใช้ keyword matching กับ four_m_logs.description เพื่อจัดเข้าหัวข้อย่อย
   โดยไม่ต้องเพิ่มฟิลด์ใหม่ตอนสร้าง log — log ที่ไม่ตรง keyword ไหนเลย
   จะตกเป็นรายการ "อื่นๆ" (รายการสุดท้าย) ของหมวดนั้น เพื่อไม่ให้ข้อมูลหายไปจากตาราง
   (QC 2026-07-14: เดิมไม่มีรายการ "อื่นๆ" จริง — fallback ไปรายการแรกของหมวด ทำให้
    log ที่ไม่ match ถูกกา X ผิดหัวข้อบนเอกสารทางการ เช่น "ปรับเวลาพัก" กลายเป็น "พนักงานใหม่") */
export const CHECKLIST_ITEMS = [
  { id: 'man_new',        category: 'Man',      label: 'พนักงานใหม่ (ไม่ถึง 1 เดือน)',           keywords: ['พนักงานใหม่', 'เข้าใหม่', 'บรรจุใหม่', 'พนง.ใหม่'] },
  { id: 'man_temp',       category: 'Man',      label: 'พนักงานทดแทนชั่วคราว',                  keywords: ['ทดแทน', 'ชั่วคราว', 'สลับไลน์', 'ยืมคน', 'ดึงคน'] },
  { id: 'man_absent',     category: 'Man',      label: 'พนักงานขาดงาน',                          keywords: ['ขาดงาน', 'ลาป่วย', 'ลากิจ', 'ขาด'] },
  { id: 'man_other',      category: 'Man',      label: 'อื่นๆ (Man)',                            keywords: [] },

  { id: 'machine_issue',  category: 'Machine',  label: 'เครื่องจักรเกิดปัญหา',                    keywords: ['เกิดปัญหา', 'เสีย', 'ขัดข้อง', 'breakdown', 'หยุดเครื่อง'] },
  { id: 'machine_cond',   category: 'Machine',  label: 'มีการเปลี่ยนแปลงเงื่อนไขเครื่องจักร, อุปกรณ์', keywords: ['เงื่อนไข', 'พารามิเตอร์', 'parameter', 'ปรับค่า'] },
  { id: 'machine_part',   category: 'Machine',  label: 'มีการแก้ไข/เปลี่ยนแปลงอุปกรณ์, เครื่องมือ',  keywords: ['เปลี่ยนอุปกรณ์', 'เปลี่ยนเครื่องมือ', 'แก้ไขอุปกรณ์', 'เปลี่ยนหัว', 'เปลี่ยนจิ๊ก', 'เปลี่ยนคอลเลท', 'collet'] },
  { id: 'machine_other',  category: 'Machine',  label: 'อื่นๆ (Machine)',                        keywords: [] },

  { id: 'method_process', category: 'Method',   label: 'มีการเปลี่ยนแปลงกระบวนการ',               keywords: ['เปลี่ยนกระบวนการ', 'ปรับกระบวนการ', 'ย้ายจุด', 'ย้ายไปจุด'] },
  { id: 'method_work',    category: 'Method',   label: 'มีการเปลี่ยนแปลงวิธีปฏิบัติงาน',          keywords: ['วิธีปฏิบัติงาน', 'วิธีทำงาน', 'work instruction'] },
  { id: 'method_check',   category: 'Method',   label: 'มีการเปลี่ยนแปลงวิธีการตรวจสอบ',          keywords: ['วิธีการตรวจสอบ', 'ตรวจสอบ', 'inspection'] },
  { id: 'method_other',   category: 'Method',   label: 'อื่นๆ (Method)',                         keywords: [] },

  { id: 'material_part',  category: 'Material', label: 'มีการเปลี่ยนแปลงชิ้นส่วน/วัตถุดิบ',        keywords: ['เปลี่ยนชิ้นส่วน', 'เปลี่ยนวัตถุดิบ', 'เปลี่ยนล็อต', 'lot'] },
  { id: 'material_store', category: 'Material', label: 'มีการเปลี่ยนแปลงที่เก็บชิ้นส่วน/วัตถุดิบ',  keywords: ['ที่เก็บ', 'สถานที่เก็บ', 'ย้ายที่เก็บ', 'คลังเก็บ'] },
  { id: 'material_other', category: 'Material', label: 'อื่นๆ (Material)',                       keywords: [] },
];

export const CATEGORY_COLOR = { Man: '#b5482f', Machine: '#1f6fa8', Method: '#3b6fc4', Material: '#a13d77' };

/* คืน checklist item ที่ตรงกับ log โดย match keyword ใน description ก่อน
   ถ้าไม่ตรงเลย fallback เป็นรายการ "อื่นๆ" (รายการสุดท้ายของหมวด) — ห้าม fallback
   ไปรายการแรก เพราะเท่ากับกา X ผิดหัวข้อบนฟอร์มทางการ */
export function matchChecklistItem(log) {
  const desc = (log.description || '').toLowerCase();
  const itemsInCat = CHECKLIST_ITEMS.filter(it => it.category === log.category);
  for (const it of itemsInCat) {
    if (it.keywords.length && it.keywords.some(k => desc.includes(k.toLowerCase()))) return it;
  }
  return itemsInCat[itemsInCat.length - 1] || null;
}
