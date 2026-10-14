/* ═══ 🧪 งานชุบภายนอก (outsource plating) — กฎกลางของแท็บ "งานชุบ" ใน /heijunka (2026-10-13 · คำสั่ง user) ═══

   หน้างาน (13/10): *"ผลิตคอนเฟิร์ม order เข้าสโตร์ → สโตร์กดรับยอด → สโตร์ส่งงานออกไปชุบ (เลือกงานหลังชุบ
   ส่งกี่ออเดอร์กี่ชิ้นก็ใส่) → การ์ดเด้งไปรอรับงานหลังชุบกลับ · มอนิเตอร์ยอดที่ร้านได้ → งานกลับมา สโตร์กดรับ
   ตามจำนวนจริง ไม่ครบใส่รายละเอียด ... ชุบทำหน้าที่คล้ายผลิต เปลี่ยน 2xx ก่อนชุบเป็น 2xx หลังชุบ
   แต่ไม่มีการคอนเฟิร์มยอดของร้านชุบ"* + *"ให้ user เข้าไป set เอง อย่า hard code"*

   🔴 "สินค้าหลังชุบ" = สินค้าบน **ไลน์ประเภทจ้างนอก** (`production_lines.line_type = 'outsource'` · user ตั้งที่ /line-setup)
      หรือที่ตั้งร้านไว้ (`dr_products.outsource_vendor`) — **ไม่มีชื่อร้าน/MAT/คำว่า "หลังชุบ" ในโค้ด**
      เลขก่อนชุบ = ลูกใน BOM (ตัวหลัก) · BOM ยังไม่ผูก = เสนอจาก P/N ตรงกัน แล้ว **ส่งครั้งแรกระบบผูก BOM ให้**
      ⇒ ส่ง = ก่อนชุบ · รับคืน = หลังชุบ · ส่งเข้า W/H = แม่ของ "หลังชุบ" ที่เป็น FG และ **มีลูกตัวเดียว**
        (FG ที่มีชิ้นอื่นด้วย = ต้องประกอบที่ไลน์ → ไหลตามใบผลิตปกติ ห้ามแปลงตรงที่คลัง · RPC กันซ้ำอีกชั้น)
   🔴 ร้านชุบ "ไม่ยืนยันยอด" — สโตร์หน้างานนับแล้วกดรับต่อใบ (เหมือนคิวรอรับเข้าของผลิต · ยอดไม่ครบต้องมีเหตุผล)
   🔴 ทุกปุ่มเขียนผ่าน RPC `plating_*` (DR · `20261013_plating_loop_dr.sql`) — ห้ามเขียน ledger เองจากจอ
   🔴 คลังต้นทาง/ปลายทางอ่านจากกฎรับเข้าคลัง (`inflowDestOf`) — ไม่มีกฎ = บอกบนจอ ห้ามเดา "STORE"

   pure ทั้งไฟล์ — ไม่แตะ supabase/react (เทส `__tests__/plating.test.mjs`)
   ═══════════════════════════════════════════════════════════════════════════════════ */

import { buildBomIndex, buildParentIndex } from './bomTree.js';
import { isFgMat, matDigit } from './matPrefix.js';

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

/** ประเภทไลน์ "จ้างนอก" (production_lines.line_type · ทะเบียน `utils/lineTypes.js`) — user ตั้งเองที่ /line-setup */
export const OUTSOURCE_LINE_TYPE = 'outsource';

const pnoKey = (s) => norm(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * สินค้า "หลังชุบ" = สินค้าที่อยู่บนไลน์ประเภทจ้างนอก **หรือ** ตั้งร้านไว้ (`outsource_vendor`)
 * 🔴 ไม่เดาจากชื่อ ("หลังชุบ") — user ตั้งประเภทไลน์เอง (คำสั่ง user "อย่า hard code")
 * @param {Array} products dr_products
 * @param {Array} lines    production_lines (ต้องมี name, line_type)
 */
export function platingProducts(products = [], lines = []) {
  const outLines = new Set((lines || []).filter(l => l?.line_type === OUTSOURCE_LINE_TYPE && l?.is_active !== false)
    .map(l => norm(l.name).toLowerCase()));
  return (products || [])
    .filter(p => norm(p?.mat_no) && !p?.is_operation
      && (norm(p.outsource_vendor) || outLines.has(norm(p.line_name).toLowerCase())))
    .sort((a, b) => norm(a.mat_no).localeCompare(norm(b.mat_no)));
}

/**
 * เลข "ก่อนชุบ" ของสินค้าหลังชุบ — เรียงจากน่าเชื่อสุด (ข้อเสนอ · คนเลือกได้เสมอ)
 *   ① ลูกใน BOM ที่ P/N ตรงกัน  ② ลูกใน BOM เลข 2xx  ③ สินค้า 2xx ที่ P/N ตรงกันเป๊ะ (BOM ยังไม่ผูก)
 * 🔴 "ลูกใน BOM" = **รวมทุกใบ** (ใบของสินค้าหลังชุบเอง + แถว `parent_mat` ในใบ FG) — นิยามเดียวกับ RPC
 *    `plating_bom_has_child` · ห้ามใช้ `bomOf()` ที่เลือกใบเดียว: วัดจริง 13/10 ใบของสินค้าหลังชุบหลายตัว
 *    (เช่น 20059852) ใส่ลูกของ "ก่อนชุบ" ตรงๆ ข้ามชั้น ส่วนใบ FG จัดชั้นถูก (20059852 → 20059853 ก่อนชุบ)
 *    ⇒ ใช้ใบเดียว = เสนอ MOUNTING PLATE แทนตัวก่อนชุบจริง · มี P/N ตรงกัน = ใช้เฉพาะกลุ่มนั้น
 * `linked` = มีขาใน BOM แล้ว (ส่งได้เลย) · false = ส่งครั้งแรกระบบจะผูก BOM ให้
 * @returns {Array<{ mat, name, line, linked, why }>}
 */
export function beforeCandidatesOf(after, { products = [], bomRows = [], platingSet } = {}) {
  const a = norm(after);
  if (!a) return [];
  const byMat = new Map((products || []).map(p => [norm(p?.mat_no), p]));
  const mop = matOfProductMap(products);
  const myPno = pnoKey(byMat.get(a)?.p_no);
  const isPlating = (m) => (platingSet ? platingSet.has(m) : false);
  const samePno = (p) => !!myPno && pnoKey(p?.p_no) === myPno;
  const kids = new Map();
  (bomRows || []).forEach(r => {
    if (r?.is_active === false) return;
    const parent = norm(r?.parent_mat) || norm(mop[r?.product_id]);
    const m = norm(r?.mat_no);
    if (parent !== a || !m || m === a || matDigit(m) !== '2' || kids.has(m)) return;
    const p = byMat.get(m);
    kids.set(m, { mat: m, name: p?.name || r.part_name || '', line: p?.line_name || '', linked: true, why: samePno(p) ? 'bom+pno' : 'bom' });
  });
  const kidList = [...kids.values()];
  const pnoKids = kidList.filter(k => k.why === 'bom+pno');
  const out = pnoKids.length ? pnoKids : kidList;
  if (!pnoKids.length && myPno) {
    (products || []).forEach(p => {
      const m = norm(p?.mat_no);
      if (!m || m === a || kids.has(m) || matDigit(m) !== '2' || p.is_operation || isPlating(m) || !samePno(p)) return;
      out.push({ mat: m, name: p.name || '', line: p.line_name || '', linked: false, why: 'pno' });
    });
  }
  // P/N ตรง (ยังไม่ผูก) มาก่อนลูก BOM ที่ P/N ไม่ตรง — เคสจริง 20059898: ลูก BOM = 20060001 (ชิ้นประกอบ)
  // แต่ตัวก่อนชุบจริง = 20059899 (P/N เดียวกัน) ⇒ ห้ามเลือกให้อัตโนมัติ (ดู `autoBeforeOf`)
  const rank = { 'bom+pno': 0, pno: 1, bom: 2 };
  return out.sort((x, y) => rank[x.why] - rank[y.why] || x.mat.localeCompare(y.mat));
}

/** เลือกเลขก่อนชุบให้อัตโนมัติ **เฉพาะตอนไม่กำกวม** — ลูก BOM ที่ P/N ตรงตัวเดียว หรือมีตัวเลือกตัวเดียว
 *  ไม่งั้นคืน null ⇒ จอให้คนเลือก (เลือกผิด = ตัดสต็อกผิดตัว + ผูก BOM ผิด) */
export function autoBeforeOf(cands = []) {
  const top = cands.filter(c => c.why === 'bom+pno');
  if (top.length === 1) return top[0];
  if (top.length > 1) return null;
  return cands.length === 1 ? cands[0] : null;
}

/** เส้นทางชุบที่ใช้อยู่ (ไว้โชว์ในแผงตั้งค่า) — สินค้าหลังชุบ + เลขก่อนชุบตัวแรก (ไม่มี = problem) */
export function platingRoutes(products = [], bomRows = [], lines = []) {
  const list = platingProducts(products, lines);
  const set = new Set(list.map(p => norm(p.mat_no)));
  return list.map(p => {
    const c = beforeCandidatesOf(p.mat_no, { products, bomRows, platingSet: set });
    const auto = autoBeforeOf(c);
    const linkedAuto = auto?.linked ? auto : null;
    return {
      after: norm(p.mat_no), afterName: p.name || '', afterActive: p.is_active !== false,
      vendor: norm(p.outsource_vendor) || null, line: p.line_name || '',
      before: linkedAuto ? linkedAuto.mat : null, candidates: c,
      problem: linkedAuto ? null
        : auto ? `BOM ยังไม่ผูก — ระบบเสนอ ${auto.mat} (P/N ตรง) ส่งครั้งแรกจะผูกให้`
        : c.length > 1 ? `มีเลขที่น่าจะใช่ ${c.length} ตัว — เลือกตอนส่ง หรือผูก BOM ที่นี่`
        : 'ยังไม่รู้เลขก่อนชุบ — เลือกเองตอนส่ง หรือผูก BOM ที่นี่',
    };
  });
}

/** ตรวจก่อนกดรับคืน (ต่อใบ) — null = ผ่าน
 *  ยอดไม่ครบต้องมีเหตุผล (เหมือนคิวรอรับเข้าของผลิต) · ปิดใบได้แม้รับ 0 (ร้านทำของหาย/เสียหมด) */
export function receiveBlockReason({ open, qty, reason, close }) {
  const q = Number(qty);
  if (qty === '' || qty == null || !Number.isFinite(q) || q < 0) return 'ใส่ยอดที่นับได้จริง';
  if (q > num(open)) return `รับเกินยอดที่ค้างในใบนี้ (${num(open)})`;
  if (q === 0 && !close) return 'ยอด 0 = ไม่มีอะไรเข้า — ถ้าของไม่กลับแล้วให้ติ๊ก "ปิดใบ"';
  if (q < num(open) && !norm(reason)) return 'ยอดไม่ครบ — ใส่รายละเอียด (เช่น ร้านทยอยส่ง / NG ที่ร้าน 5)';
  return null;
}

/** โซนของการ์ด: late = เกิน lead time · vendor = อยู่ที่ร้าน · closed = ปิดแล้ว */
export function orderZone(o, { now, leadDays } = {}) {
  if (o?.status !== 'open') return 'closed';
  const t = Date.parse(o?.sent_at);
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  if (leadDays != null && Number.isFinite(t) && (nowMs - t) / 86400000 > leadDays) return 'late';
  return 'vendor';
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
