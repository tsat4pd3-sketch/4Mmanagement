/* 🔄 assignmentOverlay — "รักษาการ / รับผิดชอบเพิ่ม" ทับขอบเขตจริงตอน login (2026-11-02)
 *
 * คำสั่ง user: *"ตำแหน่งจริงของ HR เป็นพื้นฐาน และเพิ่มความรับผิดชอบงานที่อาจจะรักษาการแทนตำแหน่งนั้น"*
 *               → *"ลุยต่อ ให้ขอบเขตจริงอ่าน org_assignments เลย"*
 *
 * ทะเบียน `org_assignments` (profile_id · org_node_id · kind head/acting · scope_depth · starts_on/ends_on)
 * มีจอมาตั้งแต่ 24/09 แต่ runtime ไม่เคยอ่าน ⇒ ไฟล์นี้คือตัวเชื่อม **จุดเดียว**
 *
 * 🔴 กฎเหล็ก — **ทับได้ทาง "กว้างขึ้น" เท่านั้น** ไม่มีทางที่มอบหมายทำให้ใครแคบลง
 *   · `sections` (เห็น) : ว่าง = ไม่จำกัดอยู่แล้ว → คงว่าง · มีค่า → ∪ ส่วนงานของหน่วยที่ได้รับมอบ
 *                        · มอบหมาย `scope_depth='all'` → ไม่จำกัด (ว่าง)
 *   · `respCostCenters` (แก้) : ∪ CC ของหน่วยที่ได้รับมอบ (ตกทอดจากแม่ได้ · ccScope.ccOfNode)
 *   · `writeUnits` (แก้ · 13/11) : บ้าน `profiles.section` ∪ ส่วนงานของหน่วยที่ได้รับมอบ — **ไม่ใช่ `sections`**
 *   · `allUnits` (แก้ · 13/11) : `profiles.all_units` หรือมอบหมาย `scope_depth='all'` ⇒ ใบผ่านข้ามหน่วย
 *   · หมดอายุคิดตอนอ่าน (`isGranting(row, today)`) — ไม่มี cron · `today` ต้องส่งเข้ามา (ด่าน +400 วัน)
 * 🔴 อ่านทะเบียน/ผังไม่ได้ = **ไม่ทับ** (คืนค่าเดิมเป๊ะ + ธง `failed`) ห้ามเดา · จอต้องเขียนบอก
 * 🔴 ไฟล์นี้ pure — ไม่แตะ DB (App.jsx โหลดแถวมาให้)
 */
import { isGranting } from './orgAssignments.js';
import { unitParentId, isUpperKind } from './orgLayers.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const keyOf = (n) => (n?.code || n?.name || '').toString().trim();

/** ส่วนงานของโหนด = section บนสุดในสาย · ไม่มี section = รากของสาย (แผนกขึ้นตรงฝ่าย) */
function sectionKeyOf(nodeId, byId) {
  const seen = new Set();
  let cur = byId.get(String(nodeId ?? '')), top = null;
  while (cur && !seen.has(String(cur.id)) && !isUpperKind(cur.kind)) {
    seen.add(String(cur.id));
    top = cur;
    if (cur.kind === 'section') break;
    const pid = unitParentId(cur, byId);   // 🏢 แม่เป็น plant/company = จบสาย (หน่วยขึ้นตรงใช้ตัวเองเป็นส่วนงาน)
    cur = pid == null ? null : byId.get(String(pid));
  }
  return keyOf(top) || null;
}

/** หน่วยที่ "แก้ได้" ตั้งต้น = บ้านจริงตัวเดียว (ไม่ใช่ `sections` ที่เป็นขอบเขตการมองเห็น — 13/11) */
const baseWriteUnits = (base) => {
  const home = String(base?.section ?? '').trim();
  return home ? [home] : [];
};

/**
 * @param base        `{ section, sections, respCostCenters, allUnits }` ค่าจาก profiles (sections ว่าง = ไม่จำกัด)
 * @param assignments แถว org_assignments ของบัญชีนี้
 * @param ctx         `{ nodes, ccIdx, today }` — ผังทั้งต้น · ดัชนี buildCcIndex · วันที่อ้างอิง
 * @returns `{ sections, respCostCenters, writeUnits, allUnits, applied, failed, reason }`
 *   · `writeUnits` = บ้าน ∪ ส่วนงานของหน่วยที่ได้รับมอบ (= ขอบเขตที่ **แก้ได้** · `writeScope.writeUnitsOf`)
 *   · `allUnits`   = ใบผ่านข้ามหน่วย: `base.allUnits` หรือมอบหมาย `scope_depth='all'` ที่มีผล
 */
export function applyAssignments(base, assignments, { nodes, ccIdx, today } = {}) {
  const sections0 = Array.isArray(base?.sections) ? base.sections.filter(Boolean) : [];
  const ccs0 = Array.isArray(base?.respCostCenters) ? base.respCostCenters.filter(Boolean) : [];
  const write0 = baseWriteUnits(base);
  const all0 = base?.allUnits === true;
  const same = (reason) => ({ sections: sections0, respCostCenters: ccs0, writeUnits: write0, allUnits: all0, applied: [], failed: reason !== 'none', reason });

  const live = (assignments || []).filter((a) => a && a.org_node_id != null && isGranting(a, today));
  if (!live.length) return same('none');
  if (!nodes?.length || !ccIdx) return same('org_unreadable');

  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const secSet = new Set(sections0.map(norm));
  const sections = [...sections0];
  const ccs = [...ccs0];
  const writeSet = new Set(write0.map(norm));
  const writeUnits = [...write0];
  const applied = [];
  let unlimited = sections0.length === 0;
  let allUnits = all0;

  live.forEach((a) => {
    const node = byId.get(String(a.org_node_id));
    if (!node) { applied.push({ id: a.id, kind: a.kind, nodeId: a.org_node_id, skipped: 'node_missing' }); return; }
    const sec = sectionKeyOf(node.id, byId);
    const cc = ccIdx.ccOfNode(node.id)?.cc || null;
    if (a.scope_depth === 'all') { unlimited = true; allUnits = true; }   // รักษาการทั้งโรงงาน = ใบผ่านข้ามหน่วยชั่วคราว
    else if (sec && !secSet.has(norm(sec))) { secSet.add(norm(sec)); sections.push(sec); }
    if (sec && !writeSet.has(norm(sec))) { writeSet.add(norm(sec)); writeUnits.push(sec); }   // แก้ได้ = บ้าน ∪ หน่วยที่ได้รับมอบ
    if (cc && !ccs.includes(cc)) ccs.push(cc);
    applied.push({ id: a.id, kind: a.kind, nodeId: node.id, nodeName: node.name, section: sec, cc, depth: a.scope_depth || null, ends_on: a.ends_on || null });
  });

  return {
    sections: unlimited ? [] : sections,     // ว่าง = ไม่จำกัด (ความหมายเดิมของ effectiveSections)
    respCostCenters: ccs,
    writeUnits,
    allUnits,
    applied,
    failed: false,
    reason: 'applied',
  };
}
