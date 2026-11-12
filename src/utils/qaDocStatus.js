/* สถานะใบ NCR / เคลมลูกค้า — "ยังค้างไหม" ตัดสินที่นี่ที่เดียว (2026-10-19)
   🔴 `cancelled` = เปิดผิด/ใบซ้ำ ถูกยกเลิกพร้อมเหตุผล (เลขที่ยังอยู่ · ห้ามลบเอกสาร)
      ⇒ **ไม่ใช่งานค้าง และไม่ใช่ใบที่ปิดงานแล้ว** — ห้ามนับในตัวนับ "ยังไม่ปิด" / KPI / ตรวจเคลมซ้ำ
   · ตัวนับเดิมเขียน `status !== 'closed'` / `.neq('status','closed')` ⇒ ใบยกเลิกจะกลายเป็นงานค้างปลอม
     ใช้ `isOpenQaDoc()` / `QA_DONE_STATUSES` แทน (มีด่าน `qa-doc-cancelled-not-open`) */
import { linearFlow } from './stepFlow.js';
export const QA_CANCELLED = 'cancelled';
export const QA_DONE_STATUSES = ['closed', QA_CANCELLED];

export const isCancelledQaDoc = (s) => (typeof s === 'object' ? s?.status : s) === QA_CANCELLED;
export const isOpenQaDoc = (s) => !QA_DONE_STATUSES.includes(typeof s === 'object' ? s?.status : s);

/** ตัวกรอง Segmented ของรายการ (active/closed/cancelled/all) — คืน true ถ้าแถวนี้อยู่ในตัวกรอง */
export function qaDocInFilter(row, filter) {
  if (filter === 'all') return true;
  if (filter === 'closed') return row?.status === 'closed';
  if (filter === QA_CANCELLED) return row?.status === QA_CANCELLED;
  return isOpenQaDoc(row);
}

/** postgrest .not('status','in',…) สำหรับคิวรี "ยังค้าง" */
export const QA_DONE_IN = `(${QA_DONE_STATUSES.join(',')})`;

/* ── แถบ "ถึงขั้นไหน" ของใบ QA (<StepFlow> · UI §6.30 · 12/11) — ชุดสถานะเจ้าของยังอยู่ในหน้า
   (NCR_STATUS/CAPA_STATUS ใน QualityControl.jsx · STATUS ใน QaClaims.jsx) คีย์ที่นี่ต้องตรงกับที่นั่น */
export const ncrFlow = (r) => linearFlow({
  status: r?.status, row: r,
  steps: [
    { label: 'เปิด NCR', who: 'QA', action: 'กักกันของที่ไม่ตรงสเปค (containment)' },
    { label: 'กักกันแล้ว', who: 'QA', action: 'ตัดสินของ (disposition)' },
    { label: 'ตัดสินแล้ว', who: 'QA', action: 'ปิดรายการ' },
    { label: 'ปิดรายการ' },
  ],
  at: { open: 0, containment: 1, disposition: 2, closed: 4 },
  exits: { [QA_CANCELLED]: { tone: 'none', label: 'ยกเลิก (เปิดผิด)', at: 0 } },
});
export const capaFlow = (r) => linearFlow({
  status: r?.status, row: r,
  steps: [
    { label: 'เปิด 8D', who: 'QA', action: 'ตั้งทีม (D1) แล้วเริ่มดำเนินการ' },
    { label: 'ดำเนินการ D1–D5', who: 'ทีม 8D', action: 'ทำถึง D5 แล้วส่งตรวจประสิทธิผล' },
    { label: 'ตรวจประสิทธิผล', who: 'QA', action: 'ยืนยัน D6–D7 + ผล PE review แล้วปิด' },
    { label: 'ปิดแล้ว' },
  ],
  at: { open: 0, in_progress: 1, verify: 2, closed: 4 },
});
export const claimFlow = (r) => linearFlow({
  status: r?.status, row: r,
  steps: [
    { label: 'รับเรื่อง', who: 'QA', action: 'เริ่มสอบสวน (เปิด 8D ถ้าซ้ำ)' },
    { label: 'สอบสวน', who: 'QA / ทีม 8D', action: 'ตอบลูกค้า' },
    { label: 'ตอบลูกค้าแล้ว', who: 'QA', action: 'ปิดเคลมเมื่อลูกค้ายอมรับ' },
    { label: 'ปิดเคลม' },
  ],
  at: { open: 0, investigating: 1, replied: 2, closed: 4 },
  exits: { [QA_CANCELLED]: { tone: 'none', label: 'ยกเลิก (เปิดผิด)', at: 0 } },
});
