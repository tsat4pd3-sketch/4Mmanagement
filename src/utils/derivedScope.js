/* 🧭 derivedScope — "สิทธิ์มองจาก ใครอยู่ตรงไหนของผัง แล้วค่อยดูเลเวล" (2026-10-30 · คำสั่ง user)
 *
 * คำพูด user: *"ชุดสิทธิ์กับตำแหน่งมันทับซ้อนกัน · สิทธิ์มันควรจะมองจาก ใครอยู่ตรงไหนของผังองค์กร
 *               และค่อยดูเลเวลของพนักงาน"*
 *
 * ┌ ชั้น 1 — โหนดที่ผูกอยู่ (`employees.org_node_id`) ตอบ 2 อย่างโดยไม่ต้องกรอกอะไรเพิ่ม
 * │    · **ฟังก์ชัน** = สายที่เราอยู่ (ไล่ parent_id ขึ้นไป) — ใต้ QA ⇒ งานคุณภาพ · ใต้ PD3 ⇒ งานผลิต
 * │    · **พื้นที่**  = กิ่งใต้ชั้นที่เลเวลเราคุม
 * └ ชั้น 2 — เลเวล (`employees.position`) ตอบว่า *คุมถึงชั้นไหน*
 *
 * 🔴 **ไม่ต้องย้ายใครในผัง** (วัดแล้ว 30/10) — หัวหน้าส่วนนั่งอยู่ "แผนกสำนักงาน" ใต้ส่วนงานเป็นเรื่องปกติ
 *    (พิชิต `section_head` ผูกกับ department `QA` ซึ่งอยู่ใต้ section `QA`)
 *    ⇒ กฎต้อง **ไต่ขึ้นหาชั้นที่เลเวลของคนนั้นคุม** ไม่ใช่บังคับให้คนไปผูกโหนดชั้นนั้น
 *    (ย้ายคนจริง = Cost Center เปลี่ยน · dept QA = 214055654 แต่ section QA = 2140441000)
 *
 * 🔴 **ไฟล์นี้ pure ล้วน** — ไม่อ่าน DB ไม่อ่านนาฬิกา ไม่ตัดสินใจแทนจอ
 *    **ยังไม่มีจอไหนเรียก** (ขั้น 1 ของ docs/ORG-SCALE-GLOBAL-DESIGN.md = "วัดก่อนใช้")
 *    เอาไปใช้จริงต้องผ่านขั้น 2 (ค่าที่ตั้งมือไว้ชนะเสมอ) — ห้ามข้าม
 */

import { depthForLevel } from './scopeDepth.js';

/** เลเวล → "คุมถึงโหนดชั้นไหน" · ไม่อยู่ในนี้ = สมาชิก ⇒ คุมแค่โหนดตัวเอง
 *  ⚠️ ชั้น `plant`/`business_group`/`company` ยังไม่มีในผังวันนี้ — เติมเข้ามาแล้วแก้ที่นี่ที่เดียว */
export const LEVEL_GOVERNS = {
  manager:      'section',      // ผจก.ฝ่าย — วันนี้ส่วนงานคือชั้นสูงสุดที่มี
  section_head: 'section',
  dept_head:    'department',
  line_leader:  'line',
};

/** เลเวลที่ "เป็นหัว" (มีสิทธิ์ทั้งกิ่ง ไม่ใช่แค่โหนดตัวเอง) */
export const isHeadLevel = (position) => Object.hasOwn(LEVEL_GOVERNS, String(position || ''));

const NO_SCOPE = Object.freeze({
  nodeId: null, scopeNodeId: null, scopeKind: null,
  climbed: 0, isHead: false, reason: 'no_node',
});

/**
 * หาว่าคนนี้คุมโหนดไหน
 * @param emp       `{ org_node_id, position }`
 * @param nodesById Map/object: id → `{ id, kind, parent_id, name }`
 * @returns `{ nodeId, scopeNodeId, scopeKind, climbed, isHead, reason }`
 *   · `reason` = `ok` | `no_node` | `node_missing` | `level_above_tree` | `member`
 *   🔴 `scopeNodeId = null` = **ตัดสินไม่ได้ ห้ามตีความว่า "ไม่มีสิทธิ์" หรือ "ทั้งโรงงาน"**
 */
export function derivedScope(emp, nodesById) {
  const startId = emp?.org_node_id;
  if (startId == null) return NO_SCOPE;

  const get = (id) => (nodesById instanceof Map ? nodesById.get(String(id)) : nodesById?.[String(id)]);
  const self = get(startId);
  if (!self) return { ...NO_SCOPE, nodeId: startId, reason: 'node_missing' };

  const want = LEVEL_GOVERNS[String(emp?.position || '')];
  if (!want) {
    // สมาชิก — คุมแค่โหนดที่ตัวเองสังกัด
    return { nodeId: startId, scopeNodeId: self.id, scopeKind: self.kind, climbed: 0, isHead: false, reason: 'member' };
  }

  // ไต่ขึ้นหาชั้นที่เลเวลนี้คุม (นับตัวเองด้วย) · กันวนลูปด้วย seen
  const seen = new Set([String(self.id)]);
  let cur = self, climbed = 0;
  while (cur) {
    if (cur.kind === want) {
      return { nodeId: startId, scopeNodeId: cur.id, scopeKind: cur.kind, climbed, isHead: true, reason: 'ok' };
    }
    const pid = cur.parent_id;
    if (pid == null || seen.has(String(pid))) break;
    seen.add(String(pid));
    cur = get(pid);
    climbed++;
    if (!cur) break;
  }
  /* ไล่ขึ้นจนสุดแล้วไม่เจอชั้นที่ควรคุม — เช่น ผจก.ระดับกลุ่มธุรกิจ แต่ผังยังไม่มีชั้นนั้น
     🔴 คืนโหนดตัวเองไว้ก่อน + ธงบอกว่าตัดสินไม่ครบ **ห้ามขยายให้เองเป็นทั้งโรงงาน** */
  return {
    nodeId: startId, scopeNodeId: self.id, scopeKind: self.kind,
    climbed, isHead: true, reason: 'level_above_tree',
  };
}

/** โหนดทั้งกิ่งใต้ `rootId` (รวมตัวเอง) — คืน Set ของ id เป็นสตริง */
export function subtreeIds(rootId, nodes) {
  const out = new Set();
  if (rootId == null) return out;
  const list = Array.isArray(nodes) ? nodes : [...(nodes instanceof Map ? nodes.values() : Object.values(nodes || {}))];
  const kids = new Map();
  list.forEach((n) => {
    const k = n?.parent_id == null ? '' : String(n.parent_id);
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(n);
  });
  const stack = [String(rootId)];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;          // กันวนลูป
    out.add(id);
    (kids.get(id) || []).forEach((c) => stack.push(String(c.id)));
  }
  return out;
}

/** สายจากโหนดขึ้นไปถึงราก (รวมตัวเอง) — ใช้ตอบ "อยู่ฟังก์ชันไหน" */
export function ancestorChain(nodeId, nodesById) {
  const out = [];
  const get = (id) => (nodesById instanceof Map ? nodesById.get(String(id)) : nodesById?.[String(id)]);
  const seen = new Set();
  let cur = nodeId == null ? null : get(nodeId);
  while (cur && !seen.has(String(cur.id))) {
    seen.add(String(cur.id));
    out.push(cur);
    cur = cur.parent_id == null ? null : get(cur.parent_id);
  }
  return out;
}

/** ฟังก์ชันของคนนี้ = ชื่อโหนดชั้น `section` ที่อยู่เหนือสุดในสาย · ไม่เจอ = `null` (ห้ามเดา) */
export function functionOf(nodeId, nodesById) {
  const chain = ancestorChain(nodeId, nodesById);
  const sec = chain.find((n) => n.kind === 'section');
  return sec ? (sec.code || sec.name || null) : null;
}


/* ── 🔭 ขั้น 2: แนะนำ `scope_depth` จาก "อยู่ตรงไหนของผัง × เลเวล" (2026-11-02 · user "ลุยต่อ") ──
 *  ใช้เป็น **คำแนะนำ** ในช่อง ② ของ /add-user เท่านั้น — ค่าที่คนตั้งมือยังชนะเสมอ (ขั้น 2 ของ DESIGN)
 *  กติกา:
 *   · ฟังก์ชันตัดขวาง (division ≠ production: ช่าง/วิศวกรรม/วางแผน-คลัง/สำนักงาน) → `all`
 *     (คำสั่ง user 30/10: "QA เห็นเรื่องคุณภาพได้ทั้งโรงงาน" · 19/08: "หน่วยงานช่างเห็นทั้งโรงงาน")
 *   · สายผลิต → หัว = `branch` (ทั้งกิ่งใต้ชั้นที่คุม) · สมาชิก = ตาม `depthForLevel(level)` (operator=self …)
 *  🔴 ไม่รู้ = `depth: null` + reason — **ห้ามเดาเป็น all** (ผังไม่รู้สาย · ไม่มีโหนด · เลเวลสูงกว่าผัง)
 *     ผู้เรียกถอยไปใช้ `depthForLevel()` เดิม ⇒ พฤติกรรมเดิมเป๊ะเมื่อผังตอบไม่ได้
 *  ⚠️ วัดจริง 02/11: section `QA` ยังไม่มี `division` ในผัง ⇒ QA ทั้ง 24 บัญชีตกเคส `division_unknown`
 *     (ต้องไปตั้งฝ่ายให้ QA ที่ /org-setup ก่อน ค่าแนะนำจึงจะเป็น all) — ไม่ใช่เรื่องโค้ด
 */
/** ฝ่ายของโหนด = ตัวเอง → แม่ → … ตัวแรกที่มี `division` (ความหมายเดียวกับ `divisionOfNode()` ใน orgDivisions.js
 *  — เขียนซ้ำที่นี่เพราะไฟล์นั้น import supabaseClient ทำให้ไฟล์ pure นี้เทสไม่ได้ · ผู้เรียกส่ง `divisionOf` ทับได้) */
const divisionViaChain = (nodeId, nodesById) =>
  ancestorChain(nodeId, nodesById).find((n) => n.division)?.division || null;

export function recommendScopeDepth(emp, nodesById, { level = null, divisionOf = null } = {}) {
  const r = derivedScope(emp, nodesById);
  if (!r.scopeNodeId) return { depth: null, reason: r.reason, scope: r };
  const division = (divisionOf ? divisionOf(r.nodeId) : divisionViaChain(r.nodeId, nodesById)) || null;
  if (!division) return { depth: null, reason: 'division_unknown', division, scope: r };
  if (division !== 'production') return { depth: 'all', reason: 'cross_cutting', division, scope: r };
  if (r.reason === 'level_above_tree') return { depth: null, reason: 'level_above_tree', division, scope: r };
  if (r.isHead) return { depth: 'branch', reason: 'production_head', division, scope: r };
  return { depth: depthForLevel(level), reason: 'production_member', division, scope: r };
}
