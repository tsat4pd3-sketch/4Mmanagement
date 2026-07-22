/* ประเภทไลน์ผลิต — source of truth เดียว (คอลัมน์ production_lines.line_type · Main project)
   ตั้งค่าที่หน้า ⚙️ ตั้งค่าผังไลน์ (LineSetup — แผง Standard Manpower)
   ใช้กับ: จัดกลุ่มกำลังผลิตตามกระบวนการ (Production Plan), ผูกกับที่มา MAT เบอร์ 200
   (พาร์ทย่อยผลิตเองส่วนใหญ่มาจากไลน์ปั๊ม) — ดู CLAUDE.md "รหัส MAT SAP"
   หมายเหตุ: คนละตัวกับ process_type (dr_products/machines ฝั่ง DR: metal_forming/welding_assembly/common)
   ซึ่งใช้กรองประเภท downtime/ของเสีย — line_type คือป้ายประเภทของ "ตัวไลน์" ที่หัวหน้ากำหนดเอง */
export const LINE_TYPES = [
  { value: 'stamping',         label: '🔩 ปั๊ม / Stamping' },
  { value: 'hydroform',        label: '💧 ไฮโดรฟอร์ม' },
  { value: 'laser',            label: '✂️ เลเซอร์' },
  { value: 'welding_assembly', label: '🔥 เชื่อมประกอบ' },
  { value: 'other',            label: '📦 อื่นๆ' },
];

export const lineTypeLabel = (v) => LINE_TYPES.find(t => t.value === v)?.label || null;
