/**
 * materialRequest — ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01
 *
 * ⚠️ นิยามตัวเลือก/สถานะอยู่ที่นี่ที่เดียว — จอ (MaterialRequests.jsx), ใบพิมพ์ (materialRequestPrint.js)
 *    และตัวดึงเข้าใบ scrap (ScrapReport.jsx) อ่านชุดเดียวกัน **ห้ามพิมพ์ซ้ำในไฟล์อื่น**
 *
 * ถอดจากใบกระดาษที่ user ส่งมา 2026-08-24 — ช่องติ๊กบนใบมี 2 บล็อก (เบิก/คืน) คนละชุดตัวเลือก
 * ตัวเลขในวงเล็บคือ movement type ของ SAP ที่พิมพ์อยู่บนใบจริง (311/261/201/907/202/908)
 */

/** ประเภทของการเบิก (บล็อกบนของใบ) */
export const WITHDRAW_MOVES = [
  { code: 'prod', label: 'เบิกเพื่อการผลิต' },
  { code: '311', label: 'โอนย้ายไปยังพื้นที่การผลิต (311)', needs: 'dest' },
  { code: '261', label: 'จ่ายเข้า Production Order (261)', needs: 'order' },
  { code: '201', label: 'จ่ายเข้าศูนย์ต้นทุน (สำนักงาน-201)', needs: 'cc' },
  { code: '907', label: 'จ่ายเข้าศูนย์ต้นทุน (โรงงาน-907)', needs: 'cc' },
];

/** ประเภทของการคืน (บล็อกล่างของใบ) */
export const RETURN_MOVES = [
  { code: 'prod', label: 'คืนจากการผลิต' },
  { code: '311', label: 'โอนย้ายจากพื้นที่การผลิต (311)', needs: 'dest' },
  { code: '202', label: 'คืนจากศูนย์ต้นทุน (สำนักงาน-202)', needs: 'cc' },
  { code: '908', label: 'คืนจากศูนย์ต้นทุน (โรงงาน-908)', needs: 'cc' },
];

export const movesFor = (kind) => (kind === 'return' ? RETURN_MOVES : WITHDRAW_MOVES);
export const moveLabel = (kind, code) =>
  movesFor(kind).find(m => m.code === code)?.label || '';

/** ช่องข้างช่องติ๊กที่ต้องกรอกเมื่อเลือก move นั้น — ใช้ทั้งฟอร์มและตัว validate */
export const moveNeeds = (kind, code) => movesFor(kind).find(m => m.code === code)?.needs || null;

export const KIND_LABEL = { withdraw: 'เบิก', return: 'คืน' };

/**
 * สถานะใบ — ตามลำดับงานจริงบนใบกระดาษ
 *   draft → submitted (ส่งให้หัวหน้า) → approved (อนุมัติแล้ว) → issued (สโตร์จ่ายของแล้ว)
 * ⚠️ ดึงเข้าใบ scrap ได้ตั้งแต่ approved ขึ้นไป — ใบที่ยังไม่อนุมัติ = ยังไม่ได้ของ
 *    จะเอาไปรายงานว่าทำลายไปแล้วไม่ได้
 */
export const STATUS_META = {
  draft: { label: 'ร่าง', color: '#6b7280' },
  submitted: { label: 'รออนุมัติ', color: '#f59e0b' },
  approved: { label: 'อนุมัติแล้ว', color: '#3b82f6' },
  issued: { label: 'จ่ายของแล้ว', color: '#22c55e' },
  cancelled: { label: 'ยกเลิก', color: '#ef4444' },
};
export const statusMeta = (s) => STATUS_META[s] || { label: s || '—', color: '#6b7280' };

/** ใบที่ถือว่า "ได้ของไปแล้ว" — เกณฑ์เดียวที่ ScrapReport ใช้กรอง ห้ามเขียนซ้ำ */
export const PULLABLE = ['approved', 'issued'];
export const isPullable = (r) => PULLABLE.includes(r?.status);

/**
 * จำนวนที่ใช้เป็น "ของที่ถูกทำลาย" ตอนดึงเข้าใบ scrap
 * ⚠️ ยึด **จำนวนที่จ่ายจริง** ก่อนเสมอ — จำนวนที่ขอเบิกเป็นแค่คำขอ สโตร์อาจจ่ายไม่ครบ
 *    ไม่มีค่าที่จ่ายจริง (สโตร์ยังไม่กรอก) ค่อยถอยไปใช้จำนวนที่ขอ
 */
export const effQty = (it) => {
  const issued = Number(it?.qty_issued);
  if (Number.isFinite(issued) && issued > 0) return issued;
  const req = Number(it?.qty);
  return Number.isFinite(req) && req > 0 ? req : 0;
};

/** เลขที่เอกสารภายใน (running รายเดือน) — สโตร์อาจใส่เลข SAP จริงทับทีหลังที่ช่อง doc_no */
export const nextReqNo = (dateStr, countInMonth) => {
  const [y, m] = String(dateStr || '').split('-');
  if (!y || !m) return '';
  return `MR-${y.slice(2)}${m}-${String((countInMonth || 0) + 1).padStart(3, '0')}`;
};
