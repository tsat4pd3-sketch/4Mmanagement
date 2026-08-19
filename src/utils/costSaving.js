/* ═══ Cost Saving — สูตรกลางแปลงผล Improvement เป็นบาท (2026-08-11 · คำสั่ง user) ═══
   โมเดล: activity rate ต่อ cost center (DL/DP/IDP/OH บาท/ชม. — ตาราง cost_center_rates ฝั่ง Main
   ผูกกับผังองค์กร ตั้งที่ /org-setup) + ต้นทุนต่อชิ้นจาก parts_master (material_cost / standard_cost)

   ⚠️ 4 ก้อนตรงกับ activity type ใน SAP (user ยืนยัน 2026-08-19):
     DL  ACT_DLAB           ค่าแรง (Direct Labour)
     DP  ACT_DP_MAC_*       ค่าเสื่อมทางตรง (เครื่องจักร — แยกตามขนาดปั๊ม/Progressive/Other)
     IDP ACT_IDP_MAC        **ค่าเสื่อมทางอ้อม รวมค่าซ่อม** ← งานลด breakdown/ซ่อมบำรุงเข้าก้อนนี้
     OH  ACT_OH_OTH         ค่าโสหุ้ย
   ❌ ไม่เก็บ ACT_DP_DIE_* / Dep.Die&Mo (ค่าเสื่อมแม่พิมพ์) — user สั่งตัด และในข้อมูลจริงเป็น 0.01
      แทบทั้งหมด (รวมทั้งโรงงาน 72 บาท/ชม.) · ลงต้นทุนจริงเมื่อไหร่ค่อยเพิ่มคอลัมน์ die_rate

   กติกา (ตกลงกับ user 2026-08-11):
   - แสดงแยกทุกก้อนเสมอ · ยอดรวมเลือกได้ว่านับก้อนไหน (default ทั้งหมด) —
     บางบริษัทไม่นับ DP เป็น saving (ค่าเสื่อมเป็น sunk cost)
   - ต้นทุนของเสีย/ชิ้น: standard_cost (บช. คำนวณ รวม mat+conversion แล้ว) ชนะเสมอ →
     ไม่มีค่อย derive = material_cost + conversion (rate ตามก้อนที่เลือก × CT/3600)
   - rate เลือกตาม effective_from (บช. ปรับรายปี) — ใช้แถวล่าสุดที่ ≤ วันอ้างอิง
   - ข้อมูลไม่ครบ (ไม่มี cost center / ไม่มี rate / พาร์ทไม่มีต้นทุน) = คืน null/ติดธง
     ให้จอบอกว่าขาดอะไร ห้ามเดาตัวเลขแทนผู้ใช้ */

/* ⚠️ เพิ่มก้อนใหม่ = เพิ่ม entry ที่นี่ + คอลัมน์ใน cost_center_rates เท่านั้น
   จอ/สูตรทุกที่วนจาก array นี้ ห้าม hardcode ชื่อก้อนซ้ำที่อื่น */
export const RATE_COMPONENTS = [
  { key: 'dl',  field: 'dl_rate',  label: 'DL',  full: 'ค่าแรง (Direct Labour)',              act: 'ACT_DLAB' },
  { key: 'dp',  field: 'dp_rate',  label: 'DP',  full: 'ค่าเสื่อมทางตรง (เครื่องจักร)',        act: 'ACT_DP_MAC_*' },
  { key: 'idp', field: 'idp_rate', label: 'IDP', full: 'ค่าเสื่อมทางอ้อม (รวมค่าซ่อม)',        act: 'ACT_IDP_MAC' },
  { key: 'oh',  field: 'oh_rate',  label: 'OH',  full: 'ค่าโสหุ้ย (Overhead)',                 act: 'ACT_OH_OTH' },
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

/* บาท/ชม. ของ rate ตามก้อนที่เลือก (comps = ['dl','dp','idp','oh']) */
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

/* ต้นทุนของเสีย/ชิ้น — ใช้ร่วมทั้ง /improvements (saving) และ /oee-analytics (มูลค่าของเสีย)
   ลำดับตามที่ตกลงกับ user 2026-08-11:
     standard_cost (บช. คำนวณ รวม mat+conversion แล้ว) ชนะเสมอ
     → ไม่มีค่อย material_cost + conversion (rate บาท/ชม. × CT วินาที / 3600)
   ⚠️ ไม่รู้ต้นทุน = คืน null **ห้ามเดาเป็น 0** (0 จะทำให้ยอดรวมดูน้อยกว่าจริงแบบเงียบ) */
export function defectUnitCost(part, { ratePerHr = 0, ctSec = 0 } = {}) {
  const std = Number(part?.standard_cost);
  if (std > 0) return { unit: std, source: 'standard', convMissing: false };
  const mat = Number(part?.material_cost);
  if (mat > 0) {
    const hasConv = ratePerHr > 0 && ctSec > 0;
    return { unit: mat + (hasConv ? ratePerHr * (ctSec / 3600) : 0), source: 'derived', convMissing: !hasConv };
  }
  return { unit: null, source: 'none', convMissing: false };
}
