/* ═══ 🧪 งานชุบภายนอก (outsource plating) — กฎกลางของแท็บ "งานชุบ" ใน /heijunka (2026-10-13 · คำสั่ง user) ═══

   หน้างาน: *"planner ส่งออกไปชุบโดยดูเลข MAT 2xx ก่อนชุบ · สโตร์รับกลับด้วยเลข 2xx หลังชุบ ·
   ส่งเข้า W/H ระบบแปลงเป็น 1xx เอง"* + *"ให้ user เข้าไป set เอง อย่า hard code"*

   🔴 เส้นทางชุบ = **Product Master + BOM เท่านั้น** (ไม่มีทะเบียนจับคู่แยก · ไม่มีชื่อร้าน/MAT ในโค้ด)
      สินค้า "หลังชุบ" มี `dr_products.outsource_vendor` + ใน BOM มีลูก = "ก่อนชุบ"
      ⇒ ส่ง = ลูก · รับคืน = ตัวแม่ · ส่งเข้า W/H = แม่ของ "หลังชุบ" ที่เป็น FG และ **มีลูกตัวเดียว**
        (FG ที่มีชิ้นอื่นด้วย = ต้องประกอบที่ไลน์ → ไหลตามใบผลิตปกติ ห้ามแปลงตรงที่คลัง · RPC กันซ้ำอีกชั้น)
   🔴 ทุกปุ่มเขียนผ่าน RPC `plating_*` (DR · `20261013_plating_loop_dr.sql`) — ห้ามเขียน ledger เองจากจอ
   🔴 คลังต้นทาง/ปลายทางอ่านจากกฎรับเข้าคลัง (`inflowDestOf`) — ไม่มีกฎ = บอกบนจอ ห้ามเดา "STORE"

   pure ทั้งไฟล์ — ไม่แตะ supabase/react (เทส `__tests__/plating.test.mjs`)
   ═══════════════════════════════════════════════════════════════════════════════════ */

import { buildBomIndex, buildParentIndex } from './bomTree.js';
import { isFgMat } from './matPrefix.js';

const norm = (s) => String(s ?? '').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** ที่เก็บเสมือนของร้านใน ledger — 🔴 ต้องตรงกับ RPC `plating_send` (`'ร้านชุบ · ' || vendor`) */
export const VENDOR_LOC_PREFIX = 'ร้านชุบ · ';
export const vendorLocOf = (vendor) => `${VENDOR_LOC_PREFIX}${norm(vendor)}`;

/** ยอดค้างร้านของใบ (ส่ง − รับแล้ว − ตัดยอด) */
export const openQtyOf = (o) => Math.max(0, num(o?.qty_sent) - num(o?.qty_received) - num(o?.qty_written_off));

/** product_id → mat_no (ใช้กับ buildBomIndex) */
export const matOfProductMap = (products = []) => {
  const m = {};
  (products || []).forEach(p => { if (p?.id && norm(p.mat_no)) m[p.id] = norm(p.mat_no); });
  return m;
};

/**
 * เส้นทางชุบที่ตั้งไว้แล้ว — 1 แถวต่อ (หลังชุบ, ก่อนชุบ)
 * สินค้าที่มีร้านแต่ BOM ยังไม่มีลูก ⇒ แถว `before: null` + `problem` (ต้องโชว์ ห้ามกลืน)
 * @returns {Array<{ after, afterName, afterActive, vendor, before, beforeName, problem }>}
 */
export function platingRoutes(products = [], bomRows = []) {
  const byMat = new Map((products || []).map(p => [norm(p?.mat_no), p]));
  const { bomOf } = buildBomIndex((bomRows || []).filter(r => r?.is_active !== false), matOfProductMap(products));
  const out = [];
  (products || []).forEach(p => {
    const vendor = norm(p?.outsource_vendor);
    const after = norm(p?.mat_no);
    if (!vendor || !after) return;
    const base = { after, afterName: p.name || '', afterActive: p.is_active !== false, vendor };
    const kids = bomOf(after).map(r => norm(r?.mat_no)).filter(Boolean);
    const uniq = [...new Set(kids)];
    if (!uniq.length) { out.push({ ...base, before: null, beforeName: '', problem: 'BOM ของสินค้าหลังชุบยังไม่มีลูก (ก่อนชุบ)' }); return; }
    uniq.forEach(b => out.push({ ...base, before: b, beforeName: byMat.get(b)?.name || '', problem: null }));
  });
  return out.sort((a, b) => a.vendor.localeCompare(b.vendor, 'th') || a.after.localeCompare(b.after));
}

/**
 * ยอดค้างร้าน จัดกลุ่ม ร้าน → สินค้าหลังชุบ
 * @param {Array} orders plating_orders (status open เท่านั้นที่นับ)
 * @param {{ now: Date, leadDaysOf?: (vendor)=>number|null }} opt
 *   leadDaysOf = lead time ของร้านจากทะเบียน suppliers (ไม่มี = null ⇒ ไม่ตัดสินว่าเกินกำหนด)
 */
export function outstandingByVendor(orders = [], { now, leadDaysOf } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const vendors = new Map();
  (orders || []).forEach(o => {
    if (o?.status !== 'open') return;
    const open = openQtyOf(o);
    if (open <= 0) return;
    const v = norm(o.vendor);
    const V = vendors.get(v) || { vendor: v, open: 0, orders: 0, items: new Map() };
    V.open += open; V.orders += 1;
    const k = norm(o.after_mat);
    const it = V.items.get(k) || { after: k, before: norm(o.before_mat), partName: o.part_name || '', open: 0, sent: 0, received: 0, orders: [], oldestMs: null };
    it.open += open; it.sent += num(o.qty_sent); it.received += num(o.qty_received);
    it.orders.push(o);
    const t = Date.parse(o.sent_at);
    if (Number.isFinite(t) && (it.oldestMs == null || t < it.oldestMs)) it.oldestMs = t;
    V.items.set(k, it);
    vendors.set(v, V);
  });
  return [...vendors.values()].map(V => {
    const lead = leadDaysOf ? leadDaysOf(V.vendor) : null;
    const items = [...V.items.values()].map(it => {
      const ageDays = it.oldestMs == null ? null : Math.floor((nowMs - it.oldestMs) / 86400000);
      return { ...it, ageDays, leadDays: lead ?? null, overdue: lead != null && ageDays != null ? ageDays > lead : null };
    }).sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
    return { vendor: V.vendor, open: V.open, orders: V.orders, items, leadDays: lead ?? null };
  }).sort((a, b) => a.vendor.localeCompare(b.vendor, 'th'));
}

/**
 * ส่งงานหลังชุบเข้า W/H ได้เป็น FG ตัวไหน
 * `direct` = FG มีลูกชั้นบนแค่ "หลังชุบ" ตัวนี้ ⇒ แปลงที่คลังได้ · ไม่ใช่ = ต้องประกอบที่ไลน์ (โชว์ชื่อไลน์)
 * @returns {Array<{ fg, name, line, direct, qpu, others: string[] }>}
 */
export function toWhTargets(after, { products = [], bomRows = [] } = {}) {
  const a = norm(after);
  if (!a) return [];
  const active = (bomRows || []).filter(r => r?.is_active !== false);
  const mop = matOfProductMap(products);
  const { bomOf } = buildBomIndex(active, mop);
  const up = buildParentIndex(active, mop);
  const byMat = new Map((products || []).map(p => [norm(p?.mat_no), p]));
  return [...(up.get(a) || [])]
    .filter(fg => isFgMat(fg) && byMat.has(fg))
    .map(fg => {
      const kids = bomOf(fg);
      const mine = kids.find(r => norm(r?.mat_no) === a);
      const others = [...new Set(kids.map(r => norm(r?.mat_no)).filter(m => m && m !== a))];
      const p = byMat.get(fg);
      return { fg, name: p?.name || '', line: p?.line_name || '', direct: !!mine && others.length === 0,
               qpu: num(mine?.qty_per_unit) > 0 ? num(mine.qty_per_unit) : 1, others, active: p?.is_active !== false };
    })
    .sort((x, y) => (y.direct - x.direct) || x.fg.localeCompare(y.fg));
}

/** สินค้าหลังชุบที่น่าจะใช่ — ตัวแม่ของ "ก่อนชุบ" ใน BOM ที่มีอยู่แล้ว (ข้อเสนอให้คนเลือก ไม่ตัดสินแทน) */
export function afterCandidates(before, { products = [], bomRows = [] } = {}) {
  const b = norm(before);
  if (!b) return [];
  const up = buildParentIndex((bomRows || []).filter(r => r?.is_active !== false), matOfProductMap(products));
  const byMat = new Map((products || []).map(p => [norm(p?.mat_no), p]));
  return [...(up.get(b) || [])]
    .filter(m => !isFgMat(m))           // FG = ตัวที่ใช้ก่อนชุบประกอบ ไม่ใช่ "หลังชุบ"
    .map(m => ({ mat: m, name: byMat.get(m)?.name || '', inMaster: byMat.has(m), vendor: norm(byMat.get(m)?.outsource_vendor) || null }))
    .sort((x, y) => x.mat.localeCompare(y.mat));
}

/**
 * บรรทัด BOM ที่ยังใช้ "ก่อนชุบ" ตรงๆ (ไม่ได้อยู่ใต้ "หลังชุบ") — ข้อเสนอให้กดแทรกชั้นหลังชุบ
 * ตัดบรรทัดในใบของสินค้าหลังชุบเอง (นั่นคือขาเส้นทางชุบ ไม่ใช่ผู้ใช้)
 * @returns {Array<{ row, parent, parentName }>}
 */
export function directUsesOfBefore(before, after, { products = [], bomRows = [] } = {}) {
  const b = norm(before), a = norm(after);
  if (!b || !a) return [];
  const mop = matOfProductMap(products);
  const { parentOf } = buildBomIndex(bomRows || [], mop);
  const byMat = new Map((products || []).map(p => [norm(p?.mat_no), p]));
  return (bomRows || [])
    .filter(r => r?.is_active !== false && norm(r?.mat_no) === b)
    .map(r => ({ row: r, parent: parentOf(r) }))
    .filter(x => x.parent && x.parent !== a)
    .map(x => ({ ...x, parentName: byMat.get(x.parent)?.name || '' }));
}

/** ตรวจก่อนกด "ส่งออกไปชุบ" — คืนข้อความที่ต้องโชว์ (null = ผ่าน)
 *  ⚠️ ยอดในคลังน้อยกว่าที่ส่ง **ไม่บล็อก** (ยอดระบบอาจยังไม่ตรงของจริง) — จอเตือนแยกด้วย `sendStockWarn` */
export function sendBlockReason({ route, qty, fromLoc }) {
  if (!route?.before) return 'เส้นทางนี้ยังไม่มีเลขก่อนชุบใน BOM';
  if (!(num(qty) > 0)) return 'ใส่จำนวนที่ส่ง';
  if (!norm(fromLoc)) return `ยังไม่มีกฎรับเข้าคลังของ ${route.before} — ไม่รู้ว่าต้องตัดของจากคลังไหน (ตั้งที่ /line-stock?tab=inflow)`;
  return null;
}

/** ยอดในคลังไม่พอ = เตือน (null = ไม่เตือน · ไม่รู้ยอด = ไม่เตือน แต่จอเขียนว่า "ไม่มีข้อมูลสต็อก") */
export function sendStockWarn({ qty, have, fromLoc }) {
  if (have == null || !(num(qty) > 0)) return null;
  return num(qty) > num(have) ? `ระบบเห็นใน ${fromLoc} แค่ ${num(have)} แต่จะส่ง ${num(qty)} — ส่งได้ แต่ยอดคลังจะติดลบ ควรตรวจนับ` : null;
}
