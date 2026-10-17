/* ccScope — ชั้นสิทธิ์ที่ 3 ด้วยแกน "Cost Center" (2026-10-16 · คำสั่ง user)

   ❓ โจทย์จาก user: "ใช้ cost center ในผังองค์กรเป็นคีย์หลักกำหนดการเข้าถึงข้อมูลของส่วนงาน
      แล้วเซ็ตได้ว่า user ไหนรับผิดชอบ cost center ไหน **ตามลำดับชั้น** — รับผิดชอบชั้นส่วนงาน
      ก็ได้ทั้งหมดลงไป"  ⇒ ทำได้ และดีกว่าคีย์เดิม (`profiles.section` ที่เป็นข้อความ)

   ✅ ทำไมใช้ CC ได้ (วัดฐานจริง 16/10 ก่อนตัดสิน · ฝั่ง Main):
     · `org_nodes.cost_center` **ไม่ซ้ำกันเลย** — 53 โหนดมีรหัส distinct ก็ 53 ⇒ เป็นคีย์ได้
       ส่วนงาน 9/9 · แผนก 21/22 · ไลน์ 23/27 · `production_lines` 29/37
     · เป็น **รหัส ไม่ใช่ข้อความ** ⇒ พ้นคลาสบั๊ก "ทะเบียนจับคู่ด้วยข้อความ" (เปลี่ยนชื่อ = หลุด)
     · **ตรง SAP** ⇒ ขยายไปสโตร์/พื้นที่ ใช้คีย์เดียวกับฝั่งบัญชี
     · พนักงาน active 246 คน **หา CC ได้ 241 (98%)** ผ่าน `org_node_id` + ตกทอดจากแม่
       ⇒ ไม่ต้องให้ HR กรอก CC ใหม่ทีละคน

   🔴 กับดัก 3 ข้อ (วัดจากข้อมูลจริง — ห้ามพลาดซ้ำ):
     ① **เลขรหัสไม่ได้บอกลำดับชั้น ห้ามไล่ด้วย prefix**
          PD1 (ส่วนงาน) = 2140461000 → ลูก BIG PRESS = 2140561001   (หลักที่ 5 เปลี่ยน 4→5)
          PD2           = 2140470000 → ลูก Assy A-GM  = 2140571000
          Maintenance   = 2140456000 → ลูก Electric   = 2140556100
        ⇒ `cost_center LIKE '21404%'` ได้ชุดผิด · ลำดับชั้นมาจาก `org_nodes.parent_id` เท่านั้น
     ② **ทีม 24 โหนดไม่มีรหัสเลยแม้แต่ตัวเดียว** ⇒ ตกทอดจากแผนกแม่ (คำสั่ง user 16/10)
        ไลน์/แผนกที่รหัสว่าง (5 ตัว) ใช้กฎเดียวกัน · ไล่ขึ้นจนสุดไม่เจอ = **fail-closed**
     ③ **ฝั่งช่าง (MTN) แกนเป็น "ทีม" ไม่ใช่ CC** — ช่างซ่อมข้ามไลน์เป็นงานปกติ
        ⇒ `canWriteTeam()` (`utils/mtnTeams.js`) ยังอยู่คู่กัน **ห้ามยุบเป็นแกนเดียว**

   🧩 ตัวนี้ไม่สร้างต้นไม้ใหม่ — ใช้ดัชนีเดิม `buildOrgScope()` (`utils/orgScope.js`) ที่มี
      `canonicalScope` (รหัส → หน่วยเจ้าของ) + `scopeCovers` (หน่วยนี้ครอบหน่วยนั้นไหม) อยู่แล้ว
      และคำนวณ CC ต่อโหนดจาก `org_nodes` ชุดเดียวกับที่ `useOrgScope` โหลด (ไม่ยิงคิวรีเพิ่ม) */
import { PLANT, isPlant, canonicalScope, scopeCovers } from './orgScope.js';   // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)

const norm = (s) => (s ?? '').toString().trim();

/* ── CC ต่อโหนดในผัง (ตกทอดจากแม่) ─────────────────────────────────────────────
   คืนตัวแก้ปัญหา 2 ฟังก์ชัน:
     `ccOfNode(id)`  → { cc, from, inherited }  · cc = null คือไล่ขึ้นจนสุดแล้วไม่เจอ (fail-closed)
     `catalog()`     → รายการรหัสทั้งหมด + เส้นทาง ให้จอตั้งสิทธิ์โชว์ว่าติ๊กแล้วครอบอะไร */
export function buildCcIndex(nodes = []) {
  const live = (nodes || []).filter(n => n && n.is_active !== false);
  const byId = new Map(live.map(n => [String(n.id), n]));
  const memo = new Map();

  /** CC ของโหนดนี้ — ตัวเอง → แม่ → ปู่ (กันวน 12 ชั้น) */
  const ccOfNode = (id) => {
    const k = String(id ?? '');
    if (!k) return { cc: null, from: null, inherited: false, reason: 'no_node' };
    if (memo.has(k)) return memo.get(k);
    let cur = byId.get(k), hops = 0, out = null;
    while (cur && hops < 12) {
      const cc = norm(cur.cost_center);
      if (cc) { out = { cc, from: cur, inherited: hops > 0, reason: hops > 0 ? 'inherited' : 'own' }; break; }
      cur = cur.parent_id == null ? null : byId.get(String(cur.parent_id));
      hops += 1;
    }
    /* 🔴 ไม่เจอรหัสทั้งสาย = "ไม่รู้" ไม่ใช่ "ไม่มีสิทธิ์เฉยๆ" — จอต้องเขียนบอกว่าผังยังไม่ผูกรหัส */
    const res = out || { cc: null, from: byId.get(k) || null, inherited: false, reason: byId.has(k) ? 'no_cc_in_chain' : 'node_missing' };
    memo.set(k, res);
    return res;
  };

  /** เส้นทางของโหนด (ราก → ตัวเอง) — ใช้โชว์บนจอ ไม่ใช้ตัดสินสิทธิ์ */
  const pathOfNode = (id) => {
    const out = [];
    let cur = byId.get(String(id ?? ''));
    for (let i = 0; cur && i < 12; i++) { out.unshift(cur); cur = cur.parent_id == null ? null : byId.get(String(cur.parent_id)); }
    return out;
  };

  /** ทะเบียนรหัสทั้งหมดในผัง + เส้นทาง · `orphan` = แม่ไม่ได้ใช้งานแล้ว (ผังขาด — ห้ามซ่อน) */
  const catalog = () => live
    .filter(n => norm(n.cost_center))
    .map((n) => {
      const path = pathOfNode(n.id);
      return {
        cc: norm(n.cost_center),
        nodeId: String(n.id),
        kind: n.kind || '',
        name: n.name || '',
        pathText: path.map(p => p.name).filter(Boolean).join(' › '),
        depth: Math.max(0, path.length - 1),
        orphan: n.parent_id != null && !byId.has(String(n.parent_id)),
      };
    });

  /** โหนดที่ถือรหัสนี้ (รหัสไม่ซ้ำ แต่คืน array เผื่อข้อมูลซ้ำในอนาคต) */
  const nodesOfCc = (cc) => {
    const k = norm(cc);
    return k ? live.filter(n => norm(n.cost_center) === k) : [];
  };

  return { ccOfNode, pathOfNode, catalog, nodesOfCc, size: live.length };
}

/* ── "ขอบเขตที่แก้ได้" ของบัญชีหนึ่ง ───────────────────────────────────────────
   🔴 ว่าง = **ถอยไปใช้ `profiles.section` เหมือนเดิม** (backward-compatible ระหว่างเปลี่ยนผ่าน)
      ⇒ 122 บัญชีที่มีอยู่พฤติกรรมไม่เปลี่ยนจนกว่าจะมีคนไปตั้งค่า
   🔴 `allUnits` (คีย์ `scope:all_units`) = ทั้งโรงงาน — ตรวจก่อนทุกอย่าง */
export function respScopesOf(index, { respCostCenters, section, allUnits, role } = {}) {
  if (role === 'admin' || allUnits === true) return [{ ...PLANT }];
  const ccs = (Array.isArray(respCostCenters) ? respCostCenters : []).map(norm).filter(Boolean);
  if (ccs.length) {
    /* รหัส → หน่วยเจ้าของในผัง (`canonicalScope`) ⇒ เทียบลำดับชั้นด้วยหน่วย ไม่ใช่ด้วยเลข */
    const out = ccs.map(cc => canonicalScope(index, { kind: 'cost_center', value: cc }));
    const seen = new Set();
    return out.filter((s) => {
      const k = `${s.kind}:${s.value}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const sec = norm(section);
  return sec ? [{ kind: 'section', value: sec }] : [];
}

/** รหัสที่กรอกไว้แต่ผังไม่รู้จัก — จอตั้งสิทธิ์ต้องเขียนบอก ห้ามกลืนเงียบ */
export function unknownRespCcs(index, respCostCenters = []) {
  const known = new Set((index?.catalog?.() || []).map(r => r.cc));
  return (Array.isArray(respCostCenters) ? respCostCenters : [])
    .map(norm).filter(cc => cc && !known.has(cc));
}

/**
 * แก้ "แถวที่อยู่ในขอบเขตนี้" ได้ไหม — ตอบเป็น `{ ok, code }` ไม่ใช่ boolean เปล่า
 * (จอต้องบอกเหตุผลได้ · กฎความซื่อสัตย์ของจอ)
 *
 * @param target ขอบเขตของแถว เช่น `{ kind:'section', value:'PD1' }` / `{ kind:'line', value:'LINE 9' }`
 *               / `{ kind:'cost_center', value:'2140461000' }` · null/plant = "ไม่รู้ว่าของหน่วยไหน"
 * @param unknownTarget `'block'` (ของกลาง fail-closed) | `'allow'`
 */
export function canWriteScope(index, ctx = {}, target, { unknownTarget = 'block' } = {}) {
  if (ctx.role === 'admin' || ctx.allUnits === true) return { ok: true, code: 'all_units' };
  const mine = respScopesOf(index, ctx);
  if (!mine.length) return { ok: false, code: 'no_home_unit' };
  if (mine.some(isPlant)) return { ok: true, code: 'all_units' };
  if (!target || isPlant(target)) {
    return unknownTarget === 'block'
      ? { ok: false, code: 'unknown_target' }
      : { ok: true, code: 'unknown_target' };
  }
  /* `scopeCovers(index, ของเรา, ของแถว)` = "หน่วยของเราครอบหน่วยของแถวไหม"
     ⇒ รับผิดชอบชั้นส่วนงาน แล้วแถวเป็นแผนก/ไลน์ใต้ส่วนงานนั้น = ครอบ (ตรงโจทย์ user) */
  return mine.some(s => scopeCovers(index, s, target))
    ? { ok: true, code: 'covered' }
    : { ok: false, code: 'other_unit' };
}

/** ข้อความบนจอ — ห้ามเป็น toast error (ของหน่วยอื่น = ขอบเขตสิทธิ์ปกติ ไม่ใช่ความผิดพลาด) */
export function ccBlockText(res, { what = 'ข้อมูลนี้', unitText = '' } = {}) {
  const tail = unitText ? ` (${unitText})` : '';
  switch (res?.code) {
    case 'no_home_unit':
      return `ยังตั้งไม่ได้ว่าคุณรับผิดชอบหน่วยงานไหน — แก้${what}ไม่ได้ · แจ้ง admin ให้ตั้ง "Cost Center ที่รับผิดชอบ" ที่จอจัดการผู้ใช้`;
    case 'unknown_target':
      return `ระบบยังระบุไม่ได้ว่า${what}${tail}เป็นของหน่วยงานไหน — จึงยังไม่ให้แก้ (ผังองค์กรยังไม่ผูกรหัส Cost Center ให้หน่วยนั้น)`;
    case 'other_unit':
      return `${what}${tail} เป็นของหน่วยงานอื่น — ดูได้ แต่แก้ไม่ได้`;
    default:
      return `แก้${what}${tail}ไม่ได้`;
  }
}

/** กรองแถวให้เหลือที่แก้ได้ + บอกว่าซ่อนไปกี่รายการ (🔴 "ไม่มีรายการ" ทั้งที่มี = จอโกหก) */
export function writableByScope(index, ctx = {}, rows = [], scopeOf, opts = {}) {
  const keep = [], hidden = [];
  (rows || []).forEach((r) => {
    (canWriteScope(index, ctx, scopeOf?.(r), opts).ok ? keep : hidden).push(r);
  });
  return { rows: keep, hiddenCount: hidden.length, hidden };
}
