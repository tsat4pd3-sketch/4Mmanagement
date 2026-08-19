/* ══ ช่วงการตรวจคุณภาพ (stage) — single source of truth ══════════════════════════════════
   ค่าที่เก็บใน `qa_inspection_items.stage` และ `qa_inspection_sheets.stage`
   (check constraint ฝั่ง DB: incoming / setup_first / inprocess / final / patrol)

   เดิมนิยามซ้ำ 2 ที่ (QAInspectionSetup.jsx + QaCheckSheet.jsx) แล้ว **drift กันแล้วจริง** —
   ตั้ง stage ที่ /qa-setup เห็น "รับเข้า (Incoming)" แต่ในใบตรวจเห็น "รับเข้า"
   (audit single source of truth 2026-08-19) · เพิ่ม stage ใหม่ให้แก้ที่นี่ที่เดียว
   ⚠️ เพิ่มค่าใหม่ต้องแก้ check constraint ฝั่ง DB ด้วย ไม่งั้นบันทึกไม่ผ่านแบบเงียบๆ

   FME_SHEET_STAGE = สเตจของคิวเรียกตรวจ (first/middle/end) → stage ของใบตรวจ
   ⚠️ ตัวเดียวกันนี้มีสำเนาใน edge function `qa-fme-scan` (คนละ runtime แชร์ไฟล์ไม่ได้)
      แก้ที่นี่ต้องไปแก้ที่นั่นด้วย — มีคอมเมนต์กำกับไว้ทั้ง 2 ฝั่ง
   ═════════════════════════════════════════════════════════════════════════════════════════ */
export const QA_STAGES = {
  incoming:    { label: 'รับเข้า (Incoming)',     color: '#a78bfa' },
  setup_first: { label: 'ชิ้นแรกหลังตั้งเครื่อง',   color: '#f59e0b' },
  inprocess:   { label: 'ในกระบวนการ',            color: '#4d9fff' },
  final:       { label: 'ตรวจสุดท้าย (Final)',     color: '#22c55e' },
  patrol:      { label: 'Patrol / รายกะ',         color: '#fb923c' },
};

export const stageLabel = (k) => QA_STAGES[k]?.label || k || '';
export const stageColor = (k) => QA_STAGES[k]?.color || '#6b7280';

/* สเตจคิวเรียกตรวจ FME → stage ของใบตรวจ */
export const FME_SHEET_STAGE = { first: 'setup_first', middle: 'inprocess', end: 'final' };
