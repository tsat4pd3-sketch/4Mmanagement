/* ═══ ใบขอซื้อ (PR) ของงานช่าง · รหัส GL · เส้นทางงานซ่อม · จ่ายงานหลายช่าง ═══════════════════
   2026-10-14 · MTN REQUEST (ผ่าน user):
     · "flow งานซ่อมของใบ MO MTN ที่ซ่อมได้ แยกเป็น ต้องเปิด PR (สั่งซื้ออะไหล่) กับไม่เปิด PR ·
        ซ่อมไม่ได้ ต้องส่งภายนอก และไปเข้า flow เปิด PR หยุด MTTR แต่ไม่หยุด machine breakdown"
     · "MO หนึ่งรองรับได้หลายเลข PR — PR เดียวใส่ช่องเลขข้างบน ถ้ามากกว่านั้นไปใส่ช่องรายละเอียด"
     · "spare part ถ้าติด min ต้องเปิดใบสั่งซื้อ พอของเข้าก็กดรับ — loop คล้ายสโตร์ purchase part"
     · "เพิ่มรหัส GL — งานบริการ GL อะไร · อะไหล่โรงงาน GL อะไร"

   ตาราง (DR): `mtn_purchase_requests` · `mtn_pr_seq` · `mtn_gl_codes` — migration `20261014_mtn_pr_gl_io_dr.sql`
   RPC: `mtn_assign_pr_no(id)` ออกเลข · `mtn_pr_receive(id, qty, by)` รับของ + เข้าสต็อกในทรานแซกชันเดียว

   🔴 กฎ:
     · ยกเลิก PR = `cancelled` + เหตุผล **ห้าม delete** (RLS ไม่เปิด DELETE อยู่แล้ว)
     · รับของ = RPC เท่านั้น ห้าม update สถานะ + `mtn_stock_move` แยก 2 คำสั่งจาก client
     · "ส่งภายนอก" ใช้สถานะ `waiting_vendor` เดิม (`mtnVendor.js`) — MTTR ของช่างหักช่วงนั้นออก
       แต่ downtime/machine breakdown **นับเต็ม** (กฎเหล็กเดิม ห้ามสลับ)
     · ไฟล์นี้ pure (ไม่ import supabase) ⇒ เทสเรียกตรงได้
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/** สถานะใบขอซื้อ — สีตาม Andon (เหลือง = รอ · ฟ้า = กำลังมา · เขียว = จบ · เทา = ยกเลิก) */
export const PR_STATUS_META = {
  requested: { label: '📝 ขอซื้อแล้ว (รอสั่ง)', short: 'รอสั่ง', color: '#f59e0b' },
  ordered:   { label: '🚚 สั่งแล้ว (รอของเข้า)', short: 'รอของ', color: '#0ea5e9' },
  received:  { label: '✅ รับของแล้ว',          short: 'รับแล้ว', color: '#22c55e' },
  cancelled: { label: '✖ ยกเลิก',              short: 'ยกเลิก', color: '#94a3b8' },
};
export const PR_OPEN_STATUSES = ['requested', 'ordered'];
export const prStatusMeta = (s) => PR_STATUS_META[s] || { label: s || '—', short: s || '—', color: '#94a3b8' };
export const isPrOpen = (pr) => PR_OPEN_STATUSES.includes(pr?.status);

/** ที่มาของใบขอซื้อ */
export const PR_SOURCE_LABEL = { mo: '🔧 จากใบ MO', spare_min: '🔩 อะไหล่ต่ำกว่า Min', manual: '✍️ เปิดเอง' };

/** เส้นทางงานซ่อม (`mtn_orders.repair_path`) — null = ยังไม่ระบุ (ใบเก่า · ไม่เดาให้) */
export const REPAIR_PATHS = [
  { key: 'inhouse',    label: '🔧 ซ่อมเอง — ไม่ต้องเปิด PR',          needsPr: false, outsource: false },
  { key: 'inhouse_pr', label: '🛒 ซ่อมเอง — ต้องเปิด PR สั่งอะไหล่',   needsPr: true,  outsource: false },
  { key: 'outsource',  label: '📤 ซ่อมไม่ได้ — ส่งซ่อมภายนอก (+PR)',   needsPr: true,  outsource: true },
];
export const repairPathMeta = (k) => REPAIR_PATHS.find(p => p.key === k) || null;

/** หมวด GL — คีย์คงที่ 2 ตัวที่ระบบรู้จัก · หมวดอื่นที่ทะเบียนเพิ่มเองยังใช้ได้ (ข้อความอิสระ) */
export const GL_CATEGORIES = [
  { key: 'service',    label: '🧑‍🔧 งานบริการ (จ้างภายนอก)' },
  { key: 'spare_part', label: '🔩 อะไหล่โรงงาน' },
];
export const glCategoryLabel = (k) => GL_CATEGORIES.find(c => c.key === k)?.label || k || '—';

/** หมวด GL ตั้งต้นของใบขอซื้อ — ผูกอะไหล่ในทะเบียน = อะไหล่ · ใบที่ส่งซ่อมภายนอกแต่ไม่ผูกอะไหล่ = งานบริการ */
export function glCategoryForPr({ partId, repairPath } = {}) {
  if (partId) return 'spare_part';
  if (repairPath === 'outsource') return 'service';
  return 'spare_part';
}

/** รหัส GL ตั้งต้นของหมวด — แถวที่ติ๊ก `is_default` ก่อน · มีแถวเดียวในหมวดใช้แถวนั้น · ไม่รู้ = null (ห้ามเดา) */
export function defaultGlFor(category, glCodes = []) {
  const rows = (glCodes || []).filter(g => g && g.is_active !== false && g.category === category);
  const def = rows.find(g => g.is_default);
  if (def) return def;
  return rows.length === 1 ? rows[0] : null;
}

/* ── อะไหล่ต่ำกว่า Min → ต้องเปิด PR ─────────────────────────────────────────────── */
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** อะไหล่ตัวนี้ "ติด Min" ไหม — `min_qty` ว่าง/0 = ไม่ได้ตั้ง ⇒ **ไม่ใช่** (ไม่รู้ ≠ ขาด) */
export function isBelowMin(part) {
  const min = num(part?.min_qty), stock = num(part?.stock_qty);
  if (min == null || min <= 0) return false;
  return (stock ?? 0) <= min;
}

/** จำนวนที่เสนอให้สั่ง — เติมถึง Max ถ้าตั้งไว้ (Max > Min) · ไม่ตั้ง Max = เติมถึง 2×Min · ขั้นต่ำ 1
 *  หักยอดที่ "เปิด PR ค้างอยู่แล้ว" ออก กันสั่งซ้ำ · คืน 0 = มีใบค้างครอบแล้ว ไม่ต้องสั่งเพิ่ม */
export function suggestReorderQty(part, openQty = 0) {
  if (!isBelowMin(part)) return 0;
  const min = num(part.min_qty), max = num(part.max_qty), stock = num(part.stock_qty) ?? 0;
  const target = max != null && max > min ? max : min * 2;
  return Math.max(0, Math.ceil(target - stock - (num(openQty) ?? 0)));
}

/** ยอดที่เปิด PR ค้างไว้ต่ออะไหล่ (requested + ordered) → { [part_id]: qty } */
export function openPrQtyByPart(prs = []) {
  const out = {};
  for (const p of prs || []) {
    if (!p?.part_id || !isPrOpen(p)) continue;
    out[p.part_id] = (out[p.part_id] || 0) + (num(p.qty) ?? 0);
  }
  return out;
}

/* ── เลข PR บนใบ MO (ใบพิมพ์ FM-MTN-006) ─────────────────────────────────────────── */
/** รวมเลข PR ของใบ — ใบขอซื้อที่ผูกใบนี้ (ไม่นับที่ยกเลิก) + ช่อง `pr_no` ที่กรอกมือเดิม · ตัดซ้ำ คงลำดับ */
export function prNumbersOf(order, prs = []) {
  const list = [];
  const add = (v) => { const s = String(v || '').trim(); if (s && !list.includes(s)) list.push(s); };
  add(order?.pr_no);
  for (const p of prs || []) if (p && p.status !== 'cancelled' && (!order?.id || p.order_id === order.id)) add(p.pr_no);
  return list;
}

/** วางเลข PR ลงฟอร์ม — คำสั่ง user: **PR เดียว → ช่องเลขข้างบน · มากกว่านั้น → ช่องรายละเอียด**
 *  คืน `{ header, detail }` · header = null เมื่อหลายใบ (ช่องบนว่าง ไม่ยัดใบแรกไปหลอกว่ามีใบเดียว) */
export function prPlacement(order, prs = []) {
  const all = prNumbersOf(order, prs);
  if (all.length <= 1) return { header: all[0] || null, detail: [] };
  return { header: null, detail: all };
}

/* ── จ่ายงานหลายช่าง ─────────────────────────────────────────────────────────────── */
/** ช่างที่ได้รับมอบหมายของใบ — `assigned_techs` (ใหม่) ชนะ · ใบเก่าถอยไปแยก `assigned_to` ด้วย "," */
export function assignedTechsOf(order) {
  const arr = Array.isArray(order?.assigned_techs) ? order.assigned_techs : null;
  const src = arr && arr.length ? arr : String(order?.assigned_to || '').split(/\s*,\s*/);
  const out = [];
  for (const n of src) { const s = String(n || '').trim(); if (s && !out.includes(s)) out.push(s); }
  return out;
}
/** ข้อความรวมสำหรับ `assigned_to` (ผู้อ่านเดิม: ใบพิมพ์/Excel/edge แจ้งเตือน) */
export const joinTechs = (names = []) => (names || []).map(s => String(s || '').trim()).filter(Boolean).join(', ');
