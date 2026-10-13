/* ══ 📉 monitorSystem — "แถวไหนระบบรู้เอง" ของบอร์ด Monitoring (pure · 2026-10-01) ═══════
   เหตุผลที่โมดูลนี้มีอยู่: ในไฟล์ Excel เดิม ทีมวางแผน**พิมพ์มือ 6 แถวต่อพาร์ทต่อวัน** แต่
   4 ใน 6 แถวนั้นระบบรู้อยู่แล้ว (วัดจริง 01/10) ⇒ งานพิมพ์ที่เหลือจริงๆ คือแถว PLAN

     แถว      ที่มาในระบบ
     IN       ใบผลิตที่ปิดแล้ว (prod_orders ⋈ production_sessions.work_date)
     OUT      ของออกจาก "คลังอ้างอิง" ของพาร์ท (line_stock_transactions: consume + return) — แก้ 12/10
     BALANCE@วันนี้  = ยอดคงเหลือจริงใน ledger (`line_stock_summary`) ที่คลังอ้างอิง — ทับสูตร (anchor)
     MIN      ระดับขั้นต่ำต่อไลน์ (line_part_levels.min_qty)
     BALANCE  คำนวณจาก IN/OUT (monitorGrid.RECUR.stock_run)

   🔴 กฎที่ห้ามพลาด
   1. **ค่าที่คนกรอกชนะค่าที่ระบบรู้เสมอ** — จัดการใน `buildGrid` แล้ว (ไฟล์นี้แค่ "เสนอ")
      หน้างานเห็นของจริงที่ระบบยังไม่รู้ · ระบบห้ามลบของที่คนยืนยัน
   2. **ไม่รู้ = `undefined` ห้ามคืน 0** — "ไม่มีใบผลิตของพาร์ทนี้" กับ "ผลิตได้ 0 ชิ้น"
      ต่างกันสิ้นเชิง · วัดจริง: 106 พาร์ทในไฟล์ **มีประวัติผลิตในระบบแค่ 26 ตัว (25%)**
      ถ้าคืน 0 ให้อีก 80 ตัว จอจะดูเหมือนพัง ทั้งที่ความจริงคือยังไม่มีใครเปิดใบผลิตพาร์ทนั้น
   3. **MIN เป็นแถว const** ⇒ ใส่ค่าที่ "คอลัมน์ยอดยกมา" ช่องเดียว แล้วปล่อยให้ไหลไปขวาเอง
      (ใส่ทุกช่องก็ได้ค่าเดียวกัน แต่เปลืองและทำให้ "คนแก้ค่าเองกลางทาง" ใช้ไม่ได้)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

import { addDaysStr } from './workDate.js';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `${mat}|${date}` → ผลรวม · ใช้ทำดัชนีจากแถวดิบที่ดึงมาจาก DR */
export function sumByMatDate(rows = [], { mat = 'mat_no', date = 'work_date', qty = 'qty', keep } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    if (typeof keep === 'function' && !keep(r)) continue;
    const mt = String(r?.[mat] ?? '').trim();
    const dt = String(r?.[date] ?? '').slice(0, 10);
    const q = num(r?.[qty]);
    if (!mt || !dt || q === null) continue;
    const k = `${mt}|${dt}`;
    m.set(k, (m.get(k) || 0) + q);
  }
  return m;
}

/** `mat` → ค่าเดียว (เช่น min_qty) · ซ้ำกัน = ตัวแรกชนะ (ทะเบียนมี unique อยู่แล้ว) */
export function firstByMat(rows = [], { mat = 'mat_no', value = 'min_qty' } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    const mt = String(r?.[mat] ?? '').trim();
    if (!mt || m.has(mt)) continue;
    const v = num(r?.[value]);
    if (v !== null) m.set(mt, v);
  }
  return m;
}

/**
 * สร้างฟังก์ชัน `system(partId, rowKey, periodKey)` ให้ `buildGrid`
 * @param {object} a
 * @param {Map}    a.partMat   partId → mat_no
 * @param {Map}    [a.inIdx]   `mat|date` → ยอดผลิตเข้า
 * @param {Map}    [a.outIdx]  `mat|date` → ยอดจ่ายออก
 * @param {Map}    [a.orderIdx] `mat|date` → ยอดลูกค้าสั่ง (EDI 862/830 · บอร์ด FG)
 * @param {Map}    [a.seedBalance] mat → ยอดยกมาของแถว balance (บอร์ด FG = ของพร้อมส่งในคลัง FG)
 * @param {Map}    [a.minByMat] mat → min_qty
 * @param {string} [a.seedKey] คอลัมน์แรก (ที่ใส่ค่า MIN)
 * @returns {Function} คืน `undefined` เมื่อระบบไม่รู้ (ห้ามคืน 0)
 */
export function makeSystemLookup({ partMat, inIdx, outIdx, orderIdx, minByMat, seedBalance, seedKey } = {}) {
  return (partId, rowKey, periodKey) => {
    const mat = partMat?.get?.(partId);
    if (!mat) return undefined;
    if (rowKey === 'in' && inIdx) return inIdx.get(`${mat}|${periodKey}`);
    if (rowKey === 'out' && outIdx) return outIdx.get(`${mat}|${periodKey}`);
    if (rowKey === 'order' && orderIdx) return orderIdx.get(`${mat}|${periodKey}`);
    /* ยอดยกมาของ balance — บอร์ด FG เอา "ของพร้อมส่งในคลัง FG" มาตั้งต้นให้
       🔴 ช่องเดียว (คอลัมน์แรก) เท่านั้น ที่เหลือเป็นหน้าที่ของสูตร — ใส่ทุกช่อง = ทับผลคำนวณ */
    if (rowKey === 'balance' && seedBalance && periodKey === seedKey) return seedBalance.get(mat);
    /* MIN ใส่ช่องยอดยกมาช่องเดียว แล้ว RECUR 'carry' พาไปขวาเอง */
    if (rowKey === 'min' && minByMat && periodKey === seedKey) return minByMat.get(mat);
    return undefined;
  };
}

/** ชนิดธุรกรรมที่นับเป็น "ของออก" จากคลังอ้างอิงของพาร์ท (บอร์ดไลน์)
 *  ⚠️ `adjust` ไม่นับ — เป็นการแก้ยอดให้ตรงของจริง ไม่ใช่การจ่ายออก (และติดลบได้)
 *     วัดจริง 01/10: adjust 249 แถว ติดลบ 155 แถว ต่ำสุด −312,120 ⇒ รวมเข้าไป OUT เพี้ยนหนัก
 *  🔴 12/10 (audit SSOT ยอดสต็อก): เดิมเป็น `['issue','consume']` ที่ "ชื่อไลน์ผลิต" ⇒ ผิดทิศ
 *     `issue` ที่ไลน์ผลิต = **ของเข้า** (ปิดล็อตสโตร์ลง `auto: รับ child เข้าสโตร์`) ไม่ใช่ของออก
 *     ⇒ ยอดผลิตถูกบวกเข้า IN แล้วหักออกเท่ากันใน OUT (เคสจริง 20059863: ผลิต 7,200 · OUT 7,200
 *     บอร์ดค้างที่ยอดยกมา 3,600 ขณะที่ ledger ทั้งระบบ −18,504) · บอร์ดไลน์กับ ledger ห่างกันถึง 14,550 ชิ้น/พาร์ท
 *     ⇒ OUT = `consume` + `return` ที่ **คลังอ้างอิง** (`refStockOf` — ตัวเดียวกับจุดเรียกเติม/ตัวนำเข้า) */
export const OUT_TXN_TYPES = ['consume', 'return'];

/**
 * ยอดคงเหลือจริงต่อ MAT ที่ "คลังอ้างอิง" ของมัน — อ่านจาก `line_stock_summary` (view Σ ledger)
 * 🔴 ไม่มีแถวที่คลังนั้น = **ไม่ใส่ใน Map** (ไม่รู้ ≠ 0) — ผู้เรียกต้องเขียนบนจอว่ากี่พาร์ทเช็คไม่ได้
 * @param {Array<{line_name,mat_no,qty_on_hand}>} rows
 * @param {(mat:string)=>string|null} locOf  คลังอ้างอิงของ MAT
 * @returns {Map<string, number>}
 */
export function onHandAtRef(rows = [], locOf = () => null) {
  const m = new Map();
  for (const r of rows || []) {
    const mt = String(r?.mat_no ?? '').trim();
    const loc = mt ? locOf(mt) : null;
    if (!loc || String(r?.line_name ?? '').trim() !== String(loc).trim()) continue;
    const q = num(r?.qty_on_hand);
    if (q === null) continue;
    m.set(mt, (m.get(mt) || 0) + q);
  }
  return m;
}

/** ของออกต่อวันจากคลังอ้างอิง (`mat|work_date` → Σ) — เฉพาะ `approved` + OUT_TXN_TYPES */
export function outAtRef(rows = [], locOf = () => null) {
  return sumByMatDate(rows, {
    keep: (r) => {
      if (!OUT_TXN_TYPES.includes(r?.type)) return false;
      if (r?.status !== undefined && r.status !== 'approved') return false;   // pending/rejected ยังไม่มีผลกับยอด (ตรงกับ view)
      const loc = locOf(String(r?.mat_no ?? '').trim());
      return !!loc && String(r?.line_name ?? '').trim() === String(loc).trim();
    },
  });
}

/* 📥 IN = ของที่ **คลังกดรับเข้าแล้ว** ไม่ใช่ "ผลิตคอนเฟิร์มแล้ว" (user 12/10)
 *  ผลิตคอนเฟิร์ม → ออกใบรอรับ (`stock_receipts` pending) → สโตร์/คลัง FG นับแล้วกด "รับ" → ledger `issue` ที่คลังปลายทาง
 *  เดิมนับจาก `prod_orders` confirmed ⇒ ยอดวิ่งเข้าตารางทันทีทั้งที่ของยังไม่ถึงคลัง (ค้างรับ 171 ใบเกินกำหนด 12/10)
 *  · พาร์ทล็อตสโตร์ = ปิดล็อตที่บอร์ดสโตร์ลง `issue` ที่ไลน์ผลิต (คลังอ้างอิงของมัน) — ตัวเดียวกัน */
export const IN_TXN_TYPES = ['issue'];

/** ของเข้าต่อวันที่คลังอ้างอิง (`mat|work_date` → Σ) — เฉพาะ `approved` + IN_TXN_TYPES */
export function inAtRef(rows = [], locOf = () => null) {
  return sumByMatDate(rows, {
    keep: (r) => {
      if (!IN_TXN_TYPES.includes(r?.type)) return false;
      if (r?.status !== undefined && r.status !== 'approved') return false;
      const loc = locOf(String(r?.mat_no ?? '').trim());
      return !!loc && String(r?.line_name ?? '').trim() === String(loc).trim();
    },
  });
}

/**
 * 🚚 ช่อง ORDER ของบอร์ดรายแร็ค (ชีทลูกค้า) → ใบส่งของ `customer_shipping_orders` (user 12/10)
 * คนพิมพ์ยอดลงบอร์ดแล้วไม่ขึ้น Shipping Time Chart ⇒ ต้องไปเพิ่มมืออีกรอบที่ /delivery
 * กติกา: ใบที่ยังไม่ส่ง (`pending` · source `monitoring` — ชุดเดียวกับที่ตัวนำเข้าเขียน/ล้าง) ของ
 *   (ลูกค้า, MAT, วันส่ง) ต้องรวมได้ = ยอดในช่อง − `covered`
 *   · covered = ส่งไปแล้ว (ทุก source) + ใบรอส่งที่มาจากทางอื่น (เพิ่มมือที่ /delivery · EDI) — กันออเดอร์ซ้อน 2 ใบ
 *   · ส่งแล้ว/ยกเลิก/ใบจากทางอื่น **ห้ามแตะ** — แก้ได้เฉพาะใบ source `monitoring` ที่ยังไม่ส่ง
 * @param {{ qty:number|null, covered:number, pending:Array<{id,qty}> }} a  qty = null/≤0 คือล้างช่อง
 * @returns {{ update?:{id,qty}, insertQty?:number, deleteIds:string[] }}
 */
export function rackOrderSyncPlan({ qty, covered = 0, pending = [] } = {}) {
  const want = Math.max(0, (num(qty) ?? 0) - (num(covered) ?? 0));
  const rows = (pending || []).filter(r => r?.id);
  if (!(want > 0)) return { deleteIds: rows.map(r => r.id) };
  if (!rows.length) return { insertQty: want, deleteIds: [] };
  const [first, ...rest] = rows;
  return {
    ...(num(first.qty) !== want ? { update: { id: first.id, qty: want } } : {}),
    deleteIds: rest.map(r => r.id),
  };
}

/**
 * ยอด FG "ของพอส่งไหม" ณ วันนี้ — จุดยึด (anchor) ของบอร์ด FG
 *   = ของในคลัง FG ตอนนี้ − ใบที่ถึงกำหนด (≤ วันนี้) แต่ยังไม่ส่ง + ใบที่ส่งล่วงหน้าแล้วแต่กำหนด > วันนี้
 * 🔴 ทำไมต้องบวกใบส่งล่วงหน้ากลับ: ตอนกด "ส่งแล้ว" ระบบหักคลังไปแล้ว แต่คอลัมน์ข้างหน้ายังหัก ORDER ตามวันกำหนด
 *    อีกรอบ (`DEMAND_SKIP_STATUS` นับ shipped) ⇒ ไม่บวกกลับ = หักซ้ำ
 * @param {{ onHand: Map<string,number>, orders: Array<{mat_no,qty,due_date,status}>, today: string }} a
 * @returns {Map<string, number>} เฉพาะ MAT ที่รู้ยอดคลัง (ไม่รู้ = ไม่ใส่)
 */
export function fgAnchorBalance({ onHand, orders = [], today } = {}) {
  const out = new Map();
  if (!(onHand instanceof Map) || !today) return out;
  for (const [mt, q] of onHand) out.set(mt, q);
  for (const o of orders || []) {
    const mt = String(o?.mat_no ?? '').trim();
    if (!out.has(mt)) continue;
    const q = num(o?.qty);
    const due = String(o?.due_date ?? '').slice(0, 10);
    if (q === null || !due || o?.status === 'cancelled') continue;
    if (o?.status === 'shipped') { if (due > today) out.set(mt, out.get(mt) + q); continue; }
    if (due <= today) out.set(mt, out.get(mt) - q);
  }
  return out;
}

/**
 * ฟังก์ชัน `anchor(partId, rowKey, periodKey)` ให้ `buildGrid` — ยึดแถว BALANCE ของคอลัมน์ "วันนี้"
 * กับยอดจริงจาก ledger (single source of truth ของยอดสต็อก) · คอลัมน์ถัดไปเดินสูตรต่อจากค่านี้
 * คืน `undefined` เมื่อไม่รู้ ⇒ buildGrid ถอยไปใช้สูตรเดิม (ไม่เดา 0)
 */
export function makeAnchorLookup({ partMat, balByMat, anchorKey, rowKey = 'balance' } = {}) {
  return (partId, rk, pk) => {
    if (!anchorKey || rk !== rowKey || pk !== anchorKey) return undefined;
    const mat = partMat?.get?.(partId);
    if (!mat || !(balByMat instanceof Map) || !balByMat.has(mat)) return undefined;
    return balByMat.get(mat);
  };
}

/** ใบผลิตที่ถือว่า "ผลิตเข้าแล้ว" — ต้องคอนเฟิร์มยอดแล้วเท่านั้น
 *  🔴 วัดจริงจาก DR 01/10 — ระบบ**ไม่มีสถานะ `closed`** (เคยเขียนไว้ตอนแรก = กรองไม่ติดเงียบๆ):
 *     confirmed 16,217 (มี qty_ok 15,999) · imported 912 · open 93 · cancelled 53 · carry_over 5
 *  · `imported` = ใบที่ยกเข้าระบบย้อนหลัง **ยังไม่มีใครคอนเฟิร์มยอด** (qty_ok ว่างทั้ง 912 ใบ) ⇒ ไม่นับ
 *  · `open` = ใบที่ยังเดินอยู่ ของยังไม่เข้าคลัง ⇒ ไม่นับ · `cancelled` ⇒ ไม่นับแน่นอน */
export const IN_ORDER_STATUS = ['confirmed'];

/** ยอดที่ผลิตได้จริงของใบ — `qty_ok` ก่อน ไม่มีค่อยถอยไป `qty_actual`
 *  🔴 ห้ามถอยไป `qty` (= เป้าของใบ ไม่ใช่ของที่ทำได้) — จะได้ IN เท่าเป้าเสมอ ซึ่งไม่เคยจริง */
export function orderInQty(o) {
  const ok = num(o?.qty_ok);
  if (ok !== null) return ok;
  return num(o?.qty_actual);
}

/** ออเดอร์ลูกค้าที่ยัง "นับเป็นความต้องการ" — ยกเลิกแล้วไม่นับ
 *  🔴 ส่งแล้ว (`shipped`) **ยังนับ** เพราะบอร์ด FG หักยอดตามวันส่งที่ลูกค้าขอ
 *     (ของออกไปแล้วก็ต้องหายจากสต๊อก — ไม่ใช่ว่าหายไปจากความต้องการ) */
export const DEMAND_SKIP_STATUS = ['cancelled'];

/**
 * ย้ายดัชนี `mat|วันที่` ไปเป็น `mat|คีย์คอลัมน์` ของบอร์ดรายสัปดาห์ (Argen · 13/10)
 * วันที่ตกคอลัมน์ไหน = คอลัมน์ล่าสุดที่เริ่ม ≤ วันที่นั้น และยังไม่เกิน 7 วัน · นอกช่วงบอร์ด = ทิ้ง (ไม่ยัดเข้าคอลัมน์ขอบ)
 * @param {Map<string, number>} idx  ผลจาก sumByMatDate
 * @param {Array<{key:string,date:string}>} periods  เรียงจากเก่าไปใหม่
 */
export function rebucketToWeeks(idx, periods = []) {
  const out = new Map();
  if (!(idx instanceof Map) || !periods.length) return out;
  const ps = periods.map((p) => ({ key: p.key, t: Date.parse(`${String(p.date).slice(0, 10)}T00:00:00Z`) }));
  const WEEK = 7 * 86400000;
  for (const [k, v] of idx) {
    const cut = k.lastIndexOf('|');
    const mat = k.slice(0, cut);
    const t = Date.parse(`${k.slice(cut + 1)}T00:00:00Z`);
    if (!Number.isFinite(t)) continue;
    let hit = null;
    for (const p of ps) { if (p.t <= t && t < p.t + WEEK) hit = p.key; }
    if (!hit) continue;
    const nk = `${mat}|${hit}`;
    out.set(nk, (out.get(nk) || 0) + v);
  }
  return out;
}

/* ═══ 🔒 ล็อกช่อง IN เมื่อระบบเริ่มมีตัวเลขของพาร์ทนั้นแล้ว (13/10 · คำสั่ง user) ═══════════════
   *"พาร์ทไหนที่เริ่มมีตัวเลขจากระบบเข้ามาแล้ว หรือมีใน product master แล้ว daily report เริ่มลงยอดแล้ว
     จะไม่รับ IN manual ดีกว่า แต่จะต้องมีช่องทางให้ขอปรับยอด"*
   · ล็อกตั้งแต่ "วันแรกที่ระบบมีตัวเลข" = วันแรกที่คลังอ้างอิงรับเข้า (ledger `issue`) หรือวันแรกที่ใบผลิต
     ของ MAT นั้นคอนเฟิร์มยอด (Daily Report) — แล้วแต่อันไหนมาก่อน
   · 🔴 ก่อนวันนั้น = ประวัติจาก Excel ที่ระบบไม่มีตัวแทน ⇒ **ไม่ล็อก ไม่ทิ้ง** (ลบ = ประวัติหาย)
   · 🔴 ล็อกเฉพาะคอลัมน์ที่เริ่ม ≤ วันนี้ (ของจริง) · คอลัมน์อนาคตยังกรอกได้ (= คาดการณ์ ระบบยังไม่มีอะไรให้)
   · ช่องที่ล็อกแต่ระบบไม่มีรายการ = **0** (ระบบติดตามพาร์ทนี้อยู่ ไม่มีรับเข้า = ไม่มีของเข้า) ไม่ใช่ "ไม่รู้"
   · ยอดไม่ตรงของจริง ⇒ "ขอปรับยอด" = ใบ `adjust` สถานะ pending เข้าคิวอนุมัติเดิมของ /line-stock (ห้ามพิมพ์ทับบนบอร์ด) */
const d10 = (v) => String(v ?? '').slice(0, 10);

/** MAT → วันแรกที่ระบบมีตัวเลข (YYYY-MM-DD) · ไม่มีหลักฐานเลย = ไม่ใส่ (ไม่ล็อก กรอกเองได้) */
export function lockFromByMat({ inRows = [], prodRows = [], locOf = () => null } = {}) {
  const m = new Map();
  const take = (mt, d) => {
    if (!mt || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    if (!m.has(mt) || d < m.get(mt)) m.set(mt, d);
  };
  for (const r of inRows || []) {
    const mt = String(r?.mat_no ?? '').trim();
    if (!IN_TXN_TYPES.includes(r?.type)) continue;
    if (r?.status !== undefined && r.status !== 'approved') continue;
    const loc = locOf(mt);
    if (!loc || String(r?.line_name ?? '').trim() !== String(loc).trim()) continue;
    take(mt, d10(r?.work_date));
  }
  for (const r of prodRows || []) take(String(r?.mat_no ?? '').trim(), d10(r?.work_date));
  return m;
}

/** คอลัมน์นี้ล็อกไหม — ต้อง (ก) ครอบ/อยู่หลังวันแรกที่ระบบมีตัวเลข และ (ข) เริ่มไม่เกินวันนี้ */
export function isLockedPeriod(periodDate, { kind = 'day', lockFrom, today } = {}) {
  const p = d10(periodDate);
  if (!p || !lockFrom || !today || p > today) return false;
  if (kind !== 'week') return p >= lockFrom;
  const end = addDaysStr(p, 6) || p;   // บวกวันด้วยของกลาง (กฎ no-utc-workdate)
  return end >= lockFrom;
}

/** ฟังก์ชัน `locked(partId, rowKey, periodKey)` ให้ `buildGrid` — ล็อกเฉพาะแถวใน `rows` (ค่าเริ่ม IN) */
export function makeLockLookup({ partMat, lockFrom, periods = [], kind = 'day', today, rows = ['in'] } = {}) {
  const dateOf = new Map((periods || []).map((p) => [p.key, p.date]));
  return (partId, rk, pk) => {
    if (!rows.includes(rk) || !(lockFrom instanceof Map)) return false;
    const mat = partMat?.get?.(partId);
    if (!mat || !lockFrom.has(mat)) return false;
    return isLockedPeriod(dateOf.get(pk) ?? pk, { kind, lockFrom: lockFrom.get(mat), today });
  };
}
