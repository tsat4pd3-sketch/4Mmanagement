// ประเภทแรงงาน Direct/Indirect — ตั้งที่ผังองค์กร (org_nodes.labor_type) 2026-07-22
//   direct   = ฝ่ายผลิต (operator ที่ทำงานผลิตชิ้นงานโดยตรง)
//   indirect = สนับสนุน (ช่างซ่อมบำรุง MTN/JIG/DIE, QA, ธุรการ, ขาย, คลัง ฯลฯ)
// พนักงาน derive ประเภทจาก **แผนก (department) ก่อน แล้ว section** — คุมที่ผังองค์กร (OrgSetup)
//   ⚠️ ช่างส่วนใหญ่อยู่ระดับแผนก (department) ไม่ใช่ section → ต้องเช็คแผนกก่อนเสมอ
// ช่าง = พนักงานแผนก/ส่วน MTN/JIG/DIE (indirect) มี employee_skills เหมือน operator แค่คนละชุด

// heuristic fallback เมื่อ node ยังไม่ตั้ง labor_type ในผังองค์กร
const PROD_RE = /PD\s?\d|GOR|HYDRO|ASSY|ASSEMBLY|WELD|PRESS|LASER|BEND|LINE|FENDER|APRON|STAMP|SPOT/i;
const INDIRECT_RE = /MTN|MAINT|ซ่อม|JIG|DIE|\bQA\b|QC|STORE|สโตร์|คลัง|WAREHOUSE|RACK|LOGISTIC|โลจิสติก|PLAN|วางแผน|ADMIN|ธุรการ|SALE|ขาย|HR|บุคคล|ENG|วิศว/i;

export const LABOR_META = {
  direct:   { label: 'Direct (ผลิต)',      short: 'Direct',   icon: '🔧', color: '#22c55e' },
  indirect: { label: 'Indirect (สนับสนุน)', short: 'Indirect', icon: '🗂️', color: '#4d9fff' },
};

/** สร้าง Map<CODE/NAME_UPPER, 'direct'|'indirect'> จาก org_nodes (ทั้ง section + department) ที่ตั้งไว้ */
export function buildLaborMap(orgNodes) {
  const m = new Map();
  (orgNodes || []).forEach(n => {
    if ((n.kind === 'section' || n.kind === 'department') && n.labor_type) {
      m.set(String(n.code || n.name).trim().toUpperCase(), n.labor_type);
    }
  });
  return m;
}

/** ประเภทแรงงานของพนักงาน — เช็คแผนก (department) ก่อน แล้ว section · ค่าที่ตั้งในผังก่อน แล้ว fallback heuristic */
export function laborTypeOf(section, department, laborMap) {
  const dep = String(department || '').trim().toUpperCase();
  const sec = String(section || '').trim().toUpperCase();
  // 1) ค่าที่ตั้งไว้ในผังองค์กร — แผนกก่อน แล้ว section
  const set = (dep && laborMap?.get?.(dep)) || (sec && laborMap?.get?.(sec));
  if (set === 'direct' || set === 'indirect') return set;
  // 2) heuristic ตามชื่อ — แผนก/ส่วนที่เข้าเกณฑ์สนับสนุน = indirect ก่อน (ช่าง/QA/คลัง/ธุรการ)
  if (INDIRECT_RE.test(dep) || INDIRECT_RE.test(sec)) return 'indirect';
  // 3) ชื่อเข้าเกณฑ์ผลิต = direct
  if (PROD_RE.test(dep) || PROD_RE.test(sec)) return 'direct';
  return 'indirect';
}

/**
 * 🧭 ประเภทแรงงานของ **โหนดในผัง** — ไต่ขึ้นหาบรรพบุรุษที่ตั้งค่าไว้ตัวแรก (2026-09-24)
 *
 * ต่างจาก `laborTypeOf()` ที่รับ "ชื่อ" ของพนักงาน — ตัวนี้รับ `org_nodes.id` แล้วเดินตาม
 * `parent_id` ขึ้นไป เพราะ **กลุ่ม (kind='line') ไม่มีคอลัมน์ `labor_type` ของตัวเอง**
 * (ตั้งได้แค่ระดับ section/department — ลูกตกทอดจากแม่)
 *
 * ใช้ตอบว่า "ของใต้หน่วยนี้เป็นสายผลิตหรือสายสนับสนุน" เช่นตัดสินว่าฟอร์มควรถามอะไร
 * ⚠️ **ห้ามเอาไปตัดสินสิทธิ์/ผู้รับแจ้งเตือน** — แกนนี้มีไว้ตอบเรื่องต้นทุน/หัวคนเท่านั้น
 *    (docs/ORG-AXES-DECISION.md §5.4 · คนละแกนกับ `employees.staff_kind`)
 *
 * @returns {'direct'|'indirect'|null} null = ไม่มีบรรพบุรุษตัวไหนตั้งค่าไว้เลย (ห้ามเดาแทน)
 */
export function laborTypeOfNode(nodeId, nodes = []) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const seen = new Set();                       // กันผังที่ parent วนกลับมาหาตัวเอง (ข้อมูลเสีย)
  let cur = byId.get(nodeId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.labor_type === 'direct' || cur.labor_type === 'indirect') return cur.labor_type;
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return null;
}

export const laborMeta = (t) => LABOR_META[t] || LABOR_META.indirect;
