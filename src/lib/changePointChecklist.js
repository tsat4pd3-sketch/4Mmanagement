/* 11 หัวข้อคงที่ของฟอร์ม "Changing Point Control Record" (FM-PD2-037) — **ตรงใบจริงทุกบรรทัด**
   ใช้ keyword matching กับ four_m_logs.description เพื่อจัดเข้าหัวข้อ
   โดยไม่ต้องเพิ่มฟิลด์ใหม่ตอนสร้าง log

   (2026-11-05 · คำสั่ง user "ให้ตรงใบจริง") — เดิมมีแถว "อื่นๆ" หมวดละ 1 แถว (15 แถว) ซึ่งใบจริงไม่มี
   ⇒ ถอดออกแล้ว · log ที่จัดเข้าหัวข้อไม่ได้ **ไม่กา X ในปฏิทิน** (กา X ผิดหัวข้อบนเอกสารทางการ = แย่กว่า)
   แต่ **ยังขึ้นในตาราง detail ด้านล่างของใบ + เขียนจำนวนบนใบเสมอ** (ห้ามหายเงียบ — `changePointSheet.js`)
   · ใบ Man ที่ระบบสร้างเอง ("<ชื่อ> ย้ายไปจุด <จุด>") = **พนักงานทดแทนชั่วคราว** (คำสั่ง user 05/11) */
export const CHECKLIST_ITEMS = [
  { id: 'man_new',        category: 'Man',      label: 'พนักงานใหม่ (ไม่ถึง 1 เดือน)',           keywords: ['พนักงานใหม่', 'เข้าใหม่', 'บรรจุใหม่', 'พนง.ใหม่'] },
  { id: 'man_temp',       category: 'Man',      label: 'พนักงานทดแทนชั่วคราว',                  keywords: ['ทดแทน', 'ชั่วคราว', 'สลับไลน์', 'ยืมคน', 'ดึงคน', 'ย้าย'] },
  { id: 'man_absent',     category: 'Man',      label: 'พนักงานขาดงาน',                          keywords: ['ขาดงาน', 'ลาป่วย', 'ลากิจ', 'ขาด'] },

  { id: 'machine_issue',  category: 'Machine',  label: 'เครื่องจักรเกิดปัญหา',                    keywords: ['เกิดปัญหา', 'เสีย', 'ขัดข้อง', 'breakdown', 'หยุดเครื่อง'] },
  { id: 'machine_cond',   category: 'Machine',  label: 'มีการเปลี่ยนแปลงเงื่อนไขเครื่องจักร, อุปกรณ์', keywords: ['เงื่อนไข', 'พารามิเตอร์', 'parameter', 'ปรับค่า'] },
  { id: 'machine_part',   category: 'Machine',  label: 'มีการแก้ไข/เปลี่ยนแปลงอุปกรณ์, เครื่องมือ',  keywords: ['เปลี่ยนอุปกรณ์', 'เปลี่ยนเครื่องมือ', 'แก้ไขอุปกรณ์', 'เปลี่ยนหัว', 'เปลี่ยนจิ๊ก', 'เปลี่ยนคอลเลท', 'collet'] },

  { id: 'method_process', category: 'Method',   label: 'มีการเปลี่ยนแปลงกระบวนการ',               keywords: ['เปลี่ยนกระบวนการ', 'ปรับกระบวนการ', 'ย้ายจุด', 'ย้ายไปจุด'] },
  { id: 'method_work',    category: 'Method',   label: 'มีการเปลี่ยนแปลงวิธีปฏิบัติงาน',          keywords: ['วิธีปฏิบัติงาน', 'วิธีทำงาน', 'work instruction'] },
  { id: 'method_check',   category: 'Method',   label: 'มีการเปลี่ยนแปลงวิธีการตรวจสอบ',          keywords: ['วิธีการตรวจสอบ', 'ตรวจสอบ', 'inspection'] },

  { id: 'material_part',  category: 'Material', label: 'มีการเปลี่ยนแปลงชิ้นส่วน/วัตถุดิบ',        keywords: ['เปลี่ยนชิ้นส่วน', 'เปลี่ยนวัตถุดิบ', 'เปลี่ยนล็อต', 'lot'] },
  { id: 'material_store', category: 'Material', label: 'มีการเปลี่ยนแปลงที่เก็บชิ้นส่วน/วัตถุดิบ',  keywords: ['ที่เก็บ', 'สถานที่เก็บ', 'ย้ายที่เก็บ', 'คลังเก็บ'] },
];

/* สีหมวดตามใบจริง (พื้น + ตัวอักษร) — Machine พื้นเหลือง ตัวน้ำเงิน */
export const CATEGORY_COLOR = {
  Man:      { bg: '#e11d1d', fg: '#ffffff' },
  Machine:  { bg: '#ffff00', fg: '#1f3fbf' },
  Method:   { bg: '#18a7e0', fg: '#ffffff' },
  Material: { bg: '#f03fd0', fg: '#ffffff' },
};

/* คืน checklist item ที่ตรงกับ log โดย match keyword ใน description
   ไม่ตรงเลย = `null` — **ห้าม fallback ไปหัวข้อใด** (กา X ผิดหัวข้อบนฟอร์มทางการ)
   ผู้เรียกต้องนับ/แสดงใบที่ได้ null เอง (ดู `buildChangePointSheet`) */
export function matchChecklistItem(log) {
  const desc = (log?.description || '').toLowerCase();
  for (const it of CHECKLIST_ITEMS) {
    if (it.category !== log?.category) continue;
    if (it.keywords.some(k => desc.includes(k.toLowerCase()))) return it;
  }
  return null;
}
