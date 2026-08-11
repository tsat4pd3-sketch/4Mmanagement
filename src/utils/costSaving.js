/* ═══ Cost Saving — สูตรกลางแปลงผล Improvement เป็นบาท (2026-08-11 · คำสั่ง user) ═══
   โมเดล: activity rate ต่อ cost center (DL/OH/DP บาท/ชม. — ตาราง cost_center_rates ฝั่ง Main
   ผูกกับผังองค์กร ตั้งที่ /org-setup) + ต้นทุนต่อชิ้นจาก parts_master (material_cost / standard_cost)

   กติกา (ตกลงกับ user 2026-08-11):
   - แสดง DL/OH/DP แยก 3 ก้อนเสมอ · ยอดรวมเลือกได้ว่านับก้อนไหน (default ทั้งหมด) —
     บางบริษัทไม่นับ DP เป็น saving (ค่าเสื่อมเป็น sunk cost)
   - ต้นทุนของเสีย/ชิ้น: standard_cost (บช. คำนวณ รวม mat+conversion แล้ว) ชนะเสมอ →
     ไม่มีค่อย derive = material_cost + conversion (rate ตามก้อนที่เลือก × CT/3600)
   - rate เลือกตาม effective_from (บช. ปรับรายปี) — ใช้แถวล่าสุดที่ ≤ วันอ้างอิง
   - ข้อมูลไม่ครบ (ไม่มี cost center / ไม่มี rate / พาร์ทไม่มีต้นทุน) = คืน null/ติดธง
     ให้จอบอกว่าขาดอะไร ห้ามเดาตัวเลขแทนผู้ใช้ */

export const RATE_COMPONENTS = [
  { key: 'dl', field: 'dl_rate', label: 'DL', full: 'Direct Labor' },
  { key: 'oh', field: 'oh_rate', label: 'OH', full: 'Overhead' },
  { key: 'dp', field: 'dp_rate', label: 'DP', full: 'Depreciation' },
];

const normCC = (c) => String(c || '').trim();

/* cost center ของไลน์ — ไลน์ลูกไม่ได้กรอก = ตกทอดจากไลน์แม่ (pattern เดียวกับ MtnRepair/ใบค่าฝีมือ) */
export function lineCostCenter(lines, lineName) {
  const line = (lines || []).find(l => l.name === lineName);
  if (!line) return null;
  if (normCC(line.cost_center)) return normCC(line.cost_center);
  const parent = (lines || []).find(l => l.name === line.parent_line_name);
  return normCC(parent?.cost_center) || null;
}

/* เลือกแถว rate ของ cost center ตามวันอ้างอิง: แถว effective_from ล่าสุดที่ ≤ refDate
   ไม่มีแถวที่ ≤ refDate (rate เริ่มบันทึกทีหลัง) = ใช้แถวเก่าสุดแทน (ดีกว่าไม่มี — ผู้ใช้เห็น effective บนจอ) */
export function rateFor(rates, costCenter, refDate) {
  const cc = normCC(costCenter);
  if (!cc) return null;
  const rows = (rates || []).filter(r => normCC(r.cost_center) === cc)
    .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)));
  if (!rows.length) return null;
  const usable = rows.filter(r => !refDate || String(r.effective_from) <= String(refDate));
  return usable.length ? usable[usable.length - 1] : rows[0];
}

/* บาท/ชม. ของ rate ตามก้อนที่เลือก (comps = ['dl','oh','dp']) */
export function ratePerHour(rateRow, comps) {
  if (!rateRow) return 0;
  return RATE_COMPONENTS.filter(c => comps.includes(c.key))
    .reduce((a, c) => a + (Number(rateRow[c.field]) || 0), 0);
}
export const fmtBaht = (n) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return abs >= 100 ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
};
