// ประเภทแรงงาน Direct/Indirect — ตั้งที่ผังองค์กร (org_nodes.labor_type ระดับ section) 2026-07-22
//   direct   = ฝ่ายผลิต (operator ที่ทำงานผลิตชิ้นงานโดยตรง)
//   indirect = สนับสนุน (ช่างซ่อมบำรุง MTN/JIG/DIE, QA, ธุรการ, ขาย, คลัง ฯลฯ)
// พนักงาน derive ประเภทจาก section ของตัวเอง — คุมที่ผังองค์กรจุดเดียว (OrgSetup)
// ช่าง = พนักงาน section MTN/JIG/DIE (indirect) มี employee_skills เหมือน operator แค่คนละชุด

// heuristic fallback เมื่อ section ยังไม่ตั้ง labor_type ในผังองค์กร (ชื่อเข้าเกณฑ์ผลิต = direct)
const PROD_RE = /PD\s?\d|GOR|HYDRO|ASSY|ASSEMBLY|WELD|PRESS|LASER|BEND|LINE|FENDER|APRON/i;

export const LABOR_META = {
  direct:   { label: 'Direct (ผลิต)',      short: 'Direct',   icon: '🔧', color: '#22c55e' },
  indirect: { label: 'Indirect (สนับสนุน)', short: 'Indirect', icon: '🗂️', color: '#4d9fff' },
};

/** สร้าง Map<SECTION_UPPER, 'direct'|'indirect'> จาก org_nodes ที่ตั้งไว้ (ระดับ section) */
export function buildLaborMap(orgNodes) {
  const m = new Map();
  (orgNodes || []).forEach(n => {
    if (n.kind === 'section' && n.labor_type) {
      m.set(String(n.code || n.name).trim().toUpperCase(), n.labor_type);
    }
  });
  return m;
}

/** ประเภทแรงงานของ section — ใช้ค่าที่ตั้งในผังองค์กรก่อน แล้ว fallback heuristic ตามชื่อ */
export function laborTypeOf(section, laborMap) {
  const key = String(section || '').trim().toUpperCase();
  if (!key) return 'indirect';
  const set = laborMap?.get?.(key);
  if (set === 'direct' || set === 'indirect') return set;
  return PROD_RE.test(key) ? 'direct' : 'indirect';
}

export const laborMeta = (t) => LABOR_META[t] || LABOR_META.indirect;
