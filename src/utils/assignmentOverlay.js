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
 *   · หมดอายุคิดตอนอ่าน (`isGranting(row, today)`) — ไม่มี cron · `today` ต้องส่งเข้ามา (ด่าน +400 วัน)
 * 🔴 อ่านทะเบียน/ผังไม่ได้ = **ไม่ทับ** (คืนค่าเดิมเป๊ะ + ธง `failed`) ห้ามเดา · จอต้องเขียนบอก
 * 🔴 ไฟล์นี้ pure — ไม่แตะ DB (App.jsx โหลดแถวมาให้)
 */
import { isGranting } from './orgAssignments.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const keyOf = (n) => (n?.code || n?.name || '').toString().trim();

/** ส่วนงานของโหนด = section บนสุดในสาย · ไม่มี section = รากของสาย (แผนกขึ้นตรงฝ่าย) */
function sectionKeyOf(nodeId, byId) {
  const seen = new Set();
  let cur = byId.get(String(nodeId ?? '')), top = null;
  while (cur && !seen.has(String(cur.id))) {
    seen.add(String(cur.id));
    top = cur;
    if (cur.kind === 'section') break;
    cur = cur.parent_id == null ? null : byId.get(String(cur.parent_id));
  }
  return keyOf(top) || null;
}

/**
 * @param base        `{ sections, respCostCenters }` ค่าจาก profiles (sections ว่าง = ไม่จำกัด)
 * @param assignments แถว org_assignments ของบัญชีนี้
 * @param ctx         `{ nodes, ccIdx, today }` — ผังทั้งต้น · ดัชนี buildCcIndex · วันที่อ้างอิง
 * @returns `{ sections, respCostCenters, applied, failed, reason }`
 */
export function applyAssignments(base, assignments, { nodes, ccIdx, today } = {}) {
  const sections0 = Array.isArray(base?.sections) ? base.sections.filter(Boolean) : [];
  const ccs0 = Array.isArray(base?.respCostCenters) ? base.respCostCenters.filter(Boolean) : [];
  const same = (reason) => ({ sections: sections0, respCostCenters: ccs0, applied: [], failed: reason !== 'none', reason });

  const live = (assignments || []).filter((a) => a && a.org_node_id != null && isGranting(a, today));
  if (!live.length) return same('none');
  if (!nodes?.length || !ccIdx) return same('org_unreadable');

  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const secSet = new Set(sections0.map(norm));
  const sections = [...sections0];
  const ccs = [...ccs0];
  const applied = [];
  let unlimited = sections0.length === 0;

  live.forEach((a) => {
    const node = byId.get(String(a.org_node_id));
    if (!node) { applied.push({ id: a.id, kind: a.kind, nodeId: a.org_node_id, skipped: 'node_missing' }); return; }
    const sec = sectionKeyOf(node.id, byId);
    const cc = ccIdx.ccOfNode(node.id)?.cc || null;
    if (a.scope_depth === 'all') unlimited = true;
    else if (sec && !secSet.has(norm(sec))) { secSet.add(norm(sec)); sections.push(sec); }
    if (cc && !ccs.includes(cc)) ccs.push(cc);
    applied.push({ id: a.id, kind: a.kind, nodeId: node.id, nodeName: node.name, section: sec, cc, depth: a.scope_depth || null, ends_on: a.ends_on || null });
  });

  return {
    sections: unlimited ? [] : sections,     // ว่าง = ไม่จำกัด (ความหมายเดิมของ effectiveSections)
    respCostCenters: ccs,
    applied,
    failed: false,
    reason: 'applied',
  };
}
