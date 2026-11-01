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
