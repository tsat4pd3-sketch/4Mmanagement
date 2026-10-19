/* 🔴 "แก้ / ย้ายโหนดผังนี้ได้ไหม" — ชั้นสิทธิ์ที่ 3 ของหน้า /org-setup (กฎชุดเดียวของทั้งหน้า)
   ปุ่มบนจอ · ลิสต์ "อยู่ภายใต้" · ด่านตอนกดบันทึก ต้องถามฟังก์ชันในไฟล์นี้ ห้ามเขียนเงื่อนไขซ้ำในหน้า

   🔴 ย้ายโหนด = เขียนลง "แม่ใหม่" ⇒ ต้องผ่านทั้ง **ต้นทาง** และ **ปลายทาง**
      (เดิมเช็คแค่ต้นทาง ⇒ ผู้ถือ org:manage_own_unit ย้ายกลุ่มของตัวเองไปแขวนใต้ส่วนงานอื่นได้
       = เขียนของหน่วยงานที่ไม่ใช่ของตัวเอง ทั้งที่ปุ่ม/ลิสต์ดูเหมือนปกติ)
   · ไล่สายไม่ครบ / แม่หาไม่เจอ / ชั้นแม่ผิด = **บล็อก (fail-closed)**
   · ชั้น section + department ที่ "ขึ้นตรงฝ่าย" (ไม่มีแม่) = admin เท่านั้น (โครงบริษัท)      */
import { ORG_KIND_TH } from './orgNodeRefs.js';

/** ชั้นแม่ที่ถูกต้องของแต่ละชั้น — ชั้นที่ไม่อยู่ในนี้ (section) = admin เท่านั้น */
export const ORG_PARENT_KIND = { department: 'section', line: 'department', team: 'line' };

const MAX_HOPS = 8;   // ผังจริงลึก 4 ชั้น — เผื่อไว้ กันลูปถ้าข้อมูลวน

/** ไต่ขึ้นหา id ของ section ที่โหนดนี้สังกัด · ไล่ไม่ถึง/แม่หาไม่เจอ = null (ไม่เดา) */
export function sectionOfOrgNode(node, nodes = []) {
  if (!node) return null;
  const byId = new Map((nodes || []).map(n => [String(n.id), n]));
  let cur = node;
  for (let i = 0; cur && i < MAX_HOPS; i++) {
    if (cur.kind === 'section') return cur.id;
    if (!cur.parent_id) return null;
    cur = byId.get(String(cur.parent_id)) || null;
  }
  return null;
}

/** ctx = { nodes, isAdmin, canOwn, mySecId } — mySecId มาจาก profiles.section (บ้านจริง) */
export function canEditOrgNode(node, ctx = {}) {
  const { nodes = [], isAdmin = false, canOwn = false, mySecId = null } = ctx;
  if (isAdmin) return true;
  if (!canOwn || !mySecId || !node) return false;
  if (!ORG_PARENT_KIND[node.kind]) return false;              // section / ชั้นที่ไม่รู้จัก
  return sectionOfOrgNode(node, nodes) === mySecId;
}

/** เพิ่ม/ย้าย "ชั้น kind" ไปไว้ใต้ parentId ได้ไหม (= ด่านของปลายทาง) */
export function canAddOrgNodeUnder(kind, parentId, ctx = {}) {
  const { nodes = [], isAdmin = false, canOwn = false, mySecId = null } = ctx;
  if (isAdmin) return true;
  if (!canOwn || !mySecId || !ORG_PARENT_KIND[kind]) return false;
  if (!parentId) return false;                                 // ไม่มีแม่ = ขึ้นตรงฝ่าย = admin เท่านั้น
  const parent = (nodes || []).find(n => String(n.id) === String(parentId));
  if (!parent || parent.kind !== ORG_PARENT_KIND[kind]) return false;
  return sectionOfOrgNode(parent, nodes) === mySecId;
}

/** เหตุผลที่บันทึกไม่ได้ (ข้อความไทยพร้อมโชว์) · ผ่าน = null
    form = { kind, parentId, editing } — editing = แถวเดิมที่โหลดมา (null = เพิ่มใหม่) */
export function orgSaveBlockReason(form = {}, ctx = {}) {
  const { kind, parentId, editing = null } = form;
  const th = ORG_KIND_TH[kind] || 'หน่วยงาน';
  if (ctx?.isAdmin) return null;
  if (editing) {
    if (!canEditOrgNode(editing, ctx)) return `ไม่มีสิทธิ์แก้${th}นี้ — ทำได้เฉพาะใต้ส่วนงานของคุณ`;
    const moved = String(editing.parent_id ?? '') !== String(parentId ?? '');
    if (moved && !canAddOrgNodeUnder(kind, parentId, ctx)) {
      return `ย้าย${th} "${editing.name || ''}" ไปไว้ใต้หน่วยงานอื่นไม่ได้ — ปลายทางต้องอยู่ใต้ส่วนงานของคุณ`;
    }
    return null;
  }
  if (!canAddOrgNodeUnder(kind, parentId, ctx)) return `ไม่มีสิทธิ์เพิ่ม${th}ตรงนี้ — ทำได้เฉพาะใต้ส่วนงานของคุณ`;
  return null;
}

/** กรองลิสต์ "อยู่ภายใต้" ด้วยกฎเดียวกับด่าน + คืนจำนวนที่ซ่อน (จอต้องเขียนว่าซ่อนกี่รายการ) */
export function filterParentOptions(kind, options = [], ctx = {}) {
  const rows = (options || []).filter(o => canAddOrgNodeUnder(kind, o?.id, ctx));
  return { rows, hidden: Math.max(0, (options || []).length - rows.length) };
}
