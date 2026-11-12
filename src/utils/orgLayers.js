/* 🏢 orgLayers — "ชั้นบน" ของผังองค์กร (company_group → spg → company → plant) vs "ชั้นหน่วย" (section → …) (2026-11-04)
 *
 * ที่มา: template Com Code + ไฟล์ Activity Rate 2027 ของกลุ่ม (03/11) ⇒ ผังจริงของกลุ่มคือ
 *   Group (TSG) → SPG (กลุ่มผลิตภัณฑ์ 1000–9000) → Company (SAP 4 หลัก) → Plant → ส่วนงาน …
 * วันนี้ `org_nodes` มีแต่ชั้นหน่วย (ราก = ส่วนงาน/แผนกขึ้นตรง) — ก่อนเติมโหนดชั้นบนได้ **ทุกจุดที่ถือว่า
 * "ราก = ส่วนงาน" ต้องถามไฟล์นี้แทน** ไม่งั้นเติม plant เหนือส่วนงานแล้วส่วนงานหายจาก picker/ผังทั้งระบบ
 * (docs/ORG-SCALE-GLOBAL-DESIGN.md §4 ขั้น 0 · บล็อกที่เคยอยู่ orgScope.js:159)
 *
 * 🔴 กฎ
 *   · "แม่ของหน่วย" (`unitParentId`) = แม่ที่เป็นชั้นหน่วยเท่านั้น — แม่เป็นชั้นบน = ถือว่าไม่มีแม่ (ขึ้นตรง)
 *   · รากของชั้นหน่วย (`unitRoots`) = ส่วนงาน/แผนกที่ไม่มีแม่เป็นหน่วย — ใช้แทน "parent_id ว่าง" ทุกที่
 *   · การไล่สายเพื่อตกทอด (CC · ส่วนงาน · ขอบเขต) **หยุดที่ชั้นบน** — รหัส/ขอบเขตของ plant/company ห้ามไหลลงหน่วย
 *   · แม่ที่ไม่อยู่ในลิสต์ที่ส่งมา = ถือว่าเป็นหน่วย (พฤติกรรมเดิมของจอที่โหลดแค่ section/department)
 *   · ไฟล์นี้ pure · ห้าม import supabase
 */

/** ชั้นบนของโรงงาน — ตามลำดับจากบนลงล่าง */
export const UPPER_KINDS = Object.freeze(['company_group', 'spg', 'company', 'plant']);
/** ชั้นหน่วยในโรงงาน (ของเดิมทั้งหมด) */
export const UNIT_KINDS = Object.freeze(['section', 'department', 'line', 'team']);
/** ชั้นที่เป็น "หน่วยบนสุด" ของโรงงาน — ส่วนงาน และแผนกที่ขึ้นตรง */
export const UNIT_ROOT_KINDS = Object.freeze(['section', 'department']);

export const isUpperKind = (kind) => UPPER_KINDS.includes(String(kind || ''));
export const isUnitKind = (kind) => UNIT_KINDS.includes(String(kind || ''));

/** ทำ Map id → node จาก array (รับ Map/Object ได้ด้วย) */
export function nodeMap(nodes) {
  if (nodes instanceof Map) return nodes;
  const list = Array.isArray(nodes) ? nodes : Object.values(nodes || {});
  return new Map(list.filter(Boolean).map((n) => [String(n.id), n]));
}

/**
 * id ของ "แม่ที่เป็นหน่วย" — null เมื่อไม่มีแม่ / แม่เป็นชั้นบน
 * แม่ที่ไม่อยู่ใน byId (จอโหลดมาไม่ครบ) = ถือว่าเป็นหน่วย (คืน parent_id เดิม) — ห้ามเดาว่าเป็นชั้นบน
 */
export function unitParentId(node, byId) {
  const pid = node?.parent_id;
  if (pid == null || pid === '') return null;
  const parent = nodeMap(byId).get(String(pid));
  if (parent && isUpperKind(parent.kind)) return null;
  return pid;
}

/** หน่วยนี้เป็นรากของชั้นหน่วยไหม (ส่วนงาน/แผนกที่ไม่มีแม่เป็นหน่วย) */
export function isUnitRoot(node, byId) {
  return !!node && UNIT_ROOT_KINDS.includes(node.kind) && unitParentId(node, byId) == null;
}

/** แผนกขึ้นตรง (ไม่มีส่วนงานครอบ) — ใช้แทน `kind === 'department' && !parent_id` */
export function isOrphanDept(node, byId) {
  return !!node && node.kind === 'department' && unitParentId(node, byId) == null;
}

/** รากของชั้นหน่วยทั้งหมด (ลำดับตาม array ที่ส่งมา — ผู้เรียก sort เอง) */
export function unitRoots(nodes) {
  const list = Array.isArray(nodes) ? nodes : [...nodeMap(nodes).values()];
  const byId = nodeMap(list);
  return list.filter((n) => n && n.is_active !== false && isUnitRoot(n, byId));
}

/** โหนดชั้นหน่วยเท่านั้น (ตัดชั้นบนออก) — ให้จอ/ใบพิมพ์ที่วาดผังโรงงานใช้ */
export function unitNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : [...nodeMap(nodes).values()]).filter((n) => n && isUnitKind(n.kind));
}

/**
 * ไต่สายขึ้นจากโหนด (รวมตัวเอง) **หยุดก่อนถึงชั้นบน** — ใช้กับทุกการตกทอด (CC / ส่วนงาน / ขอบเขต)
 * กันวน 12 ชั้น · แม่ที่หาไม่เจอ = จบสาย
 */
export function unitChain(nodeId, byId) {
  const map = nodeMap(byId);
  const out = [];
  const seen = new Set();
  let cur = nodeId == null ? null : map.get(String(nodeId));
  while (cur && !seen.has(String(cur.id)) && out.length < 12) {
    if (isUpperKind(cur.kind)) break;
    seen.add(String(cur.id));
    out.push(cur);
    const pid = unitParentId(cur, map);
    cur = pid == null ? null : map.get(String(pid));
  }
  return out;
}
