/* สถานะใบ NCR / เคลมลูกค้า — "ยังค้างไหม" ตัดสินที่นี่ที่เดียว (2026-10-19)
   🔴 `cancelled` = เปิดผิด/ใบซ้ำ ถูกยกเลิกพร้อมเหตุผล (เลขที่ยังอยู่ · ห้ามลบเอกสาร)
      ⇒ **ไม่ใช่งานค้าง และไม่ใช่ใบที่ปิดงานแล้ว** — ห้ามนับในตัวนับ "ยังไม่ปิด" / KPI / ตรวจเคลมซ้ำ
   · ตัวนับเดิมเขียน `status !== 'closed'` / `.neq('status','closed')` ⇒ ใบยกเลิกจะกลายเป็นงานค้างปลอม
     ใช้ `isOpenQaDoc()` / `QA_DONE_STATUSES` แทน (มีด่าน `qa-doc-cancelled-not-open`) */
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
