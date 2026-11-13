/* ⚠️ ผลต่างรับ-ส่ง — ยอด "รับไม่ครบ" ต้องไม่หาย (2026-11-05 · คำสั่ง user)
   user: *"ต้องไม่หาย เป็น report transaction ที่มีปัญหา ไว้เพื่อสรุปรายเดือน แก้ไขกันระหว่างผลิตกับสโตร์ ชนกันใน SAP"* ·
         *"ทางนี้เลย มีหน้าคลังพัก"* · *"ยืนยันคู่"*
   · ไลน์รับไม่ครบ ⇒ ส่วนที่ขาดย้าย ไลน์ → คลังพัก `SUSPENSE_LOC` (ledger 2 แถว) + เคส 1 แถวใน `stock_discrepancies` (DR)
   · เคลียร์ = ฝ่ายหนึ่ง "เสนอ" (คืน STORE / ตัดหาย) → **อีกฝ่าย คนละคน** "ยืนยัน" แล้วค่อยขยับ ledger ออกจากคลังพัก
     ฝ่าย: 'store' = `heijunka:operate` · 'line' = `wip_request:receive`
   🔴 ห้ามกลับไปตัดส่วนที่ขาดทิ้ง (consume ที่ไลน์อย่างเดียว) — ยอดจะหายจากทุกคลัง (เคสจริง 04/11 · 2 ใบ 100 ชิ้น)
   pure — เทส `__tests__/stockDiscrepancy.test.mjs` */
import { linearFlow } from './stepFlow.js';

export const SUSPENSE_LOC = 'ผลต่างรอเคลียร์';
export const RETURN_LOC = 'STORE';
export const SIDE_LABEL = { store: '🏬 สโตร์', line: '🏭 ผลิต' };
export const OUTCOME_LABEL = { returned: '↩️ คืน STORE', written_off: '🗑️ ตัดหาย' };
export const STATUS_LABEL = { open: '⏳ รอเคลียร์', proposed: '🤝 รออีกฝ่ายยืนยัน', returned: '↩️ คืน STORE แล้ว', written_off: '🗑️ ตัดหายแล้ว' };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** ledger ตอนรับไม่ครบ: ไลน์ − ส่วนที่ขาด · คลังพัก + ส่วนที่ขาด (ยอดรวมทั้งโรงงานเท่าเดิม) */
export function shortReceiptRows({ line, mat, part, short, workDate, by, ref }) {
  const q = num(short);
  if (!(q > 0) || !line || !mat) return [];
  const note = `ผลต่าง: รับไม่ครบ ${ref || ''}`.trim();
  const base = { mat_no: mat, part_name: part || null, qty: q, work_date: workDate, created_by: by || null, status: 'approved' };
  return [
    { ...base, line_name: line, type: 'consume', note: `${note} — ย้ายส่วนที่ขาดออกจากไลน์ไปคลังพัก` },
    { ...base, line_name: SUSPENSE_LOC, type: 'issue', note: `${note} — พักไว้รอผลิต+สโตร์เคลียร์ (จาก ${line})` },
  ];
}

/** ฝ่ายที่คนนี้กดในนามได้ */
export function sidesOf({ canStore, canLine }) {
  return [canStore && 'store', canLine && 'line'].filter(Boolean);
}

/** เสนอผลได้ไหม — null = ได้ · ข้อความ = เหตุผลที่ไม่ได้ */
export function proposeBlock(d, { side, sides = [], outcome }) {
  if (!d || d.status !== 'open') return 'เคสนี้ไม่อยู่ในสถานะรอเคลียร์แล้ว — รีเฟรช';
  if (!['returned', 'written_off'].includes(outcome)) return 'เลือกผล: คืน STORE หรือ ตัดหาย';
  if (!sides.includes(side)) return 'ไม่มีสิทธิ์เสนอในนามฝ่ายนี้';
  return null;
}

/** ยืนยันได้ไหม — 🔴 ต้องคนละฝ่าย และคนละคนกับผู้เสนอ */
export function confirmBlock(d, { side, sides = [], by }) {
  if (!d || d.status !== 'proposed') return 'เคสนี้ไม่ได้รอยืนยันแล้ว — รีเฟรช';
  if (!sides.includes(side)) return 'ไม่มีสิทธิ์ยืนยันในนามฝ่ายนี้';
  if (side === d.proposed_side) return `ต้องให้อีกฝ่ายยืนยัน (ผู้เสนอเป็นฝ่าย${SIDE_LABEL[d.proposed_side] || ''})`;
  if (by && d.proposed_by && String(by).trim() === String(d.proposed_by).trim()) return 'ผู้เสนอยืนยันเองไม่ได้ — ให้อีกคนของอีกฝ่ายยืนยัน';
  return null;
}

/** ledger ตอนยืนยันแล้ว — ยอดออกจากคลังพัก */
export function resolveLedgerRows(d, { outcome, by, workDate, sapDoc }) {
  const q = num(d?.short_qty);
  if (!(q > 0) || !d?.mat_no) return [];
  const tag = `ผลต่าง: ${d.line_name} ${d.mat_no}${sapDoc ? ` · SAP ${sapDoc}` : ''}`;
  const base = { mat_no: d.mat_no, part_name: d.part_name || null, qty: q, work_date: workDate, created_by: by || null, status: 'approved' };
  if (outcome === 'returned') return [
    { ...base, line_name: SUSPENSE_LOC, type: 'consume', note: `${tag} — เคลียร์: คืน STORE (ยืนยันคู่)` },
    { ...base, line_name: RETURN_LOC, type: 'issue', note: `${tag} — คืนจากคลังพัก (ส่งไม่ครบ ของยังอยู่สโตร์)` },
  ];
  if (outcome === 'written_off') return [
    { ...base, line_name: SUSPENSE_LOC, type: 'adjust', qty: -q, note: `${tag} — เคลียร์: ตัดหาย (ยืนยันคู่)` },
  ];
  return [];
}

/** สรุปรายเดือน (YYYY-MM จาก work_date) */
export function monthlySummary(rows = []) {
  const m = new Map();
  for (const r of rows || []) {
    const k = String(r?.work_date || '').slice(0, 7) || '—';
    const cur = m.get(k) || { month: k, cases: 0, qty: 0, openCases: 0, openQty: 0, returnedQty: 0, writtenOffQty: 0 };
    const q = num(r.short_qty);
    cur.cases++; cur.qty += q;
    if (r.status === 'open' || r.status === 'proposed') { cur.openCases++; cur.openQty += q; }
    if (r.status === 'returned') cur.returnedQty += q;
    if (r.status === 'written_off') cur.writtenOffQty += q;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/* แถบ "ถึงขั้นไหน" ผลต่างรับ-ส่ง (<StepFlow compact> · UI §6.30 · 12/11) — ฝ่ายหนึ่งเสนอ อีกฝ่ายยืนยัน */
export const discrepancyFlow = (r) => linearFlow({
  status: r?.status, row: r,
  steps: [
    { label: 'พบผลต่าง', who: 'สโตร์ หรือ ผลิต', action: 'เสนอทางเคลียร์ (คืน STORE / ตัดหาย)' },
    { label: 'เสนอทางเคลียร์', who: r?.proposed_side === 'store' ? 'ผลิต (อีกฝ่าย)' : r?.proposed_side === 'line' ? 'สโตร์ (อีกฝ่าย)' : 'อีกฝ่าย', action: 'ยืนยัน' },
    { label: 'เคลียร์แล้ว' },
  ],
  at: { open: 0, proposed: 1, returned: 3, written_off: 3 },
});
