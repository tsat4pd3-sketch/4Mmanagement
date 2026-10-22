/* ═══ 📥 คิวรับเข้าคลังจากการปิดใบผลิต — กฎกลาง (2026-10-02 · คำสั่ง user)

   user: *"ระบบรับอัตโนมัติถ้าปิด คนรับจะต้องคอนเฟิมใช่มั้ย เช็คหน้างานจริงก่อนถ้าตรงค่อยกดรับ"*

   🔴 ต้นเหตุ: กฎ `stock_inflow_rules` มีแค่เปิด/ปิด · "ปิด" = trigger `return null` = **ของไม่เข้าคลังเลย**
      ไม่มีคิว ไม่มีแจ้งเตือน (เกิดจริง 02/10 ~120 ใบหายเงียบทั้งกะ)
   ⇒ กฎมี 3 ทาง: 🟢 รับอัตโนมัติ · 🟡 ต้องยืนยันรับ (เข้าคิว `stock_receipts`) · ⚫ ปิด (ไม่เข้าเลย)
   · กดรับ = RPC `stock_receipt_confirm` ธุรกรรมเดียว (ล็อกใบ → ลงสต็อก → ปิดใบ) **ห้ามเขียน 2 คำสั่งจาก client**
   · ยอดไม่ตรง = ต้องกรอกยอดที่นับได้ + เหตุผล (ฐานบังคับด้วย check constraint ด้วย)
   · ค้างเกิน `stale_after_min` ของกฎ = แดง

   pure — ไม่แตะ DB/React · เทส `__tests__/stockReceipts.test.mjs`
   ═══════════════════════════════════════════════════════════════════════════════ */

/** ค่าตั้งต้นถ้ากฎไม่ได้ส่ง `stale_after_min` มา (ตรงกับ default ของคอลัมน์ในฐาน) */
export const DEFAULT_STALE_MIN = 240;

/** โหมดของกฎรับเข้า — 3 ทาง (ตัดสินจาก is_active + mode ของแถวกฎ) */
export const INFLOW_MODES = {
  auto:    { key: 'auto',    label: '🟢 รับอัตโนมัติ', color: '#22c55e',
             hint: 'ปิดใบผลิตปุ๊บ สต็อกเข้าทันที ไม่มีคนนับ' },
  confirm: { key: 'confirm', label: '🟡 ต้องยืนยันรับ', color: '#f59e0b',
             hint: 'ปิดใบผลิตแล้วเข้าคิว "รอรับเข้า" · สต็อกเข้าตอนคนนับของจริงแล้วกดรับ' },
  off:     { key: 'off',     label: '⚫ ปิด', color: '#64748b',
             hint: 'ของที่ปิดใบผลิตจะไม่เข้าคลังนี้เลย และไม่มีคิวให้ใครรับ' },
  /* 🔧 19/10 (user เคาะ "ตั้งรายพาร์ทเอง") — แทนกฎเดิม "MAT ที่เคยมีใบล็อต = ข้ามทุกใบตลอดไป"
     ซึ่งทำให้ GOR 20058498 (เลิกเปิดล็อตตั้งแต่ 09/09) ยอดผลิตไม่เข้าคลังเลย 317 ใบ / 4,438 ชิ้น
     ใช้ได้กับกฎ **MAT ตรงตัว** เท่านั้น (prefix = ทั้งตระกูล 2xx หายเงียบ) · คลังปลายทางของโหมดนี้ไม่ถูกใช้ */
  lot:     { key: 'lot',     label: '🔧 ปิดล็อตที่สโตร์', color: '#a855f7', matOnly: true,
             hint: 'ปิดใบผลิตไม่ลงสต็อก · ยอดเข้าตอนสโตร์ปิดล็อตที่บอร์ดสโตร์ (ลงที่ไลน์ผลิตของล็อต)' },
};

/** โหมดปัจจุบันของแถวกฎ */
export const inflowModeOf = (rule) =>
  !rule?.is_active ? 'off' : (rule.mode === 'confirm' ? 'confirm' : rule.mode === 'lot' ? 'lot' : 'auto');

/** โหมดที่เลือกได้สำหรับแถวกฎนี้ — 🔧 ปิดล็อต เฉพาะกฎ MAT ตรงตัว */
export const inflowModesFor = (rule) =>
  Object.values(INFLOW_MODES).filter(m => !m.matOnly || rule?.match_type === 'mat');

const keepMode = (m) => (m === 'confirm' || m === 'lot' ? m : 'auto');

/** ค่าที่ต้องเขียนลงแถวกฎเมื่อเลือกโหมด (ปิด = คงโหมดเดิมไว้ เปิดกลับมาได้แบบเดิม) */
export const inflowPatchFor = (modeKey, rule) =>
  modeKey === 'off' ? { is_active: false, mode: keepMode(rule?.mode) }
                    : { is_active: true, mode: modeKey === 'confirm' || modeKey === 'lot' ? modeKey : 'auto' };

/** MAT ที่ยอดเข้าคลังทาง "ปิดล็อตที่สโตร์" (กฎ MAT · เปิดอยู่ · โหมด lot) — ตัวเดียวกับที่ trigger ใช้ข้าม
 *  🔴 ห้ามถามจาก `child_lot_requests` ตรงๆ อีก ("เคยมีล็อต" ≠ "ยอดเข้าทางล็อต" · บั๊ก GOR 19/10 · มีด่าน) */
export const lotMatsOf = (rules = []) => new Set((rules || [])
  .filter(r => r?.match_type === 'mat' && r?.is_active !== false && r?.mode === 'lot')
  .map(r => String(r.match_value ?? '').trim()).filter(Boolean));

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** อายุใบ (นาที) นับจากตอนปิดใบผลิต · อ่านเวลาไม่ได้ = null */
export function receiptAgeMin(r, now = Date.now()) {
  const t = Date.parse(r?.created_at ?? '');
  if (!Number.isFinite(t)) return null;
  const n = now instanceof Date ? now.getTime() : Number(now);
  return Math.max(0, Math.floor((n - t) / 60000));
}

/** ค้างเกินเกณฑ์ไหม (เฉพาะใบที่ยังรอรับ) */
export function isStaleReceipt(r, staleMin = DEFAULT_STALE_MIN, now = Date.now()) {
  if (r?.status !== 'pending') return false;
  const age = receiptAgeMin(r, now);
  return age != null && age > (num(staleMin) || DEFAULT_STALE_MIN);
}

/** "2 ชม. 15 น." — อายุใบสำหรับวางบนการ์ด */
export function ageText(min) {
  if (min == null) return '—';
  if (min < 60) return `${min} น.`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h} ชม. ${m} น.` : `${h} ชม.`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} วัน ${hh} ชม.` : `${d} วัน`;
}

/**
 * ตรวจก่อนกดรับ — ให้จอบอกเหตุผลได้ก่อนยิง RPC (ฐานตรวจซ้ำอีกชั้นเสมอ)
 * @returns {{ok:boolean, error?:string, diff:number|null}}
 */
export function validateReceive({ expected, qty, reason }) {
  const exp = num(expected), q = num(qty);
  if (q == null || String(qty ?? '').trim() === '') return { ok: false, error: 'กรอกจำนวนที่นับได้', diff: null };
  if (q < 0) return { ok: false, error: 'จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป', diff: null };
  const diff = exp == null ? null : q - exp;
  if (diff !== 0 && !String(reason ?? '').trim()) {
    return { ok: false, error: `ยอดที่นับได้ไม่ตรงกับใบ (${diff > 0 ? '+' : ''}${diff}) — ต้องใส่เหตุผล`, diff };
  }
  return { ok: true, diff };
}

/** สถานะสำหรับแบ่งโซนบนจอ — ใบรอรับที่เกินเกณฑ์แยกเป็น 'stale' */
export const receiptZoneStatus = (r, staleOf, now = Date.now()) =>
  r?.status === 'pending' && isStaleReceipt(r, staleOf?.(r), now) ? 'stale' : r?.status;

/** เรียงคิว: ค้างนานสุดขึ้นก่อน (ของรอรับ) · รับแล้วล่าสุดขึ้นก่อน */
export function sortReceipts(rows = []) {
  return [...rows].sort((a, b) => {
    if (a.status === 'pending' && b.status === 'pending') return String(a.created_at).localeCompare(String(b.created_at));
    return String(b.received_at || b.created_at).localeCompare(String(a.received_at || a.created_at));
  });
}

/* ═══ 🧺 ยุบใบเป็นกอง — "พาร์ทเดียวค้าง 169 ใบ ไม่มีใครไล่กดไหว" (2026-10-22 · คำสั่ง user) ═══
 *
 * ปิดใบผลิต 1 ใบ = เกิดใบรอรับ 1 ใบ ⇒ วัดจริง 22/10: `20058498` ค้าง **169 ใบ / 2,324 ชิ้น / 3 วัน**
 * ที่เส้นทางเดียวกันเป๊ะ (Assy GOR → STORE) · คิวทั้งโรงงาน 331 ใบ ⇒ จอการ์ดต่อใบ = คิวตาย
 *
 * 🔴 **ยุบเพื่อ "กด" เท่านั้น — ห้ามยุบการเก็บ** (user เคาะ 22/10 "เก็บรายใบไว้ กางดูได้")
 *   ทุกใบยังถูกปิดรายใบพร้อม `qty_received` ของตัวเอง ⇒ สอบกลับว่าชิ้นนี้มาจากออเดอร์ไหนได้เหมือนเดิม
 *
 * 🔴 **ยอดที่นับได้ไม่ตรง ต้องปันลงใบจริง ห้ามเฉลี่ยเป็นทศนิยม** — ของนับเป็นชิ้น
 *   กติกา = **ใบเก่าก่อน (FIFO)** ของที่ส่งมาก่อนย่อมถูกนับก่อน · ใบที่ยอดไม่พอถึงจะได้บางส่วน ·
 *   ที่เหลือได้ 0 (ยังมาไม่ถึง) · นับได้เกินใบ = ส่วนเกินลงใบใหม่สุด (ใบที่น่าจะนับขาดที่สุด)
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** คีย์ของกอง — เส้นทางต้องเหมือนกันทุกตัว ไม่งั้นลงบัญชีผิดไลน์ */
export const receiptGroupKey = (r) =>
  [r?.mat_no ?? '', r?.source_line ?? '', r?.dest_line_name ?? ''].join('\u0001');

/**
 * ยุบใบรอรับเป็นกอง (พาร์ท × ต้นทาง × ปลายทาง)
 * @returns [{ key, mat_no, part_name, source_line, dest_line_name, slips, count, expected, oldestAt }]
 *          เรียงกองที่ค้างนานสุดขึ้นก่อน · ในกองเรียงใบเก่าก่อน (ลำดับที่ FIFO ใช้)
 */
export function groupReceipts(rows = []) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || r.status !== 'pending') continue;
    const key = receiptGroupKey(r);
    const g = by.get(key) || {
      key, mat_no: r.mat_no || '', part_name: r.part_name || '',
      source_line: r.source_line || '', dest_line_name: r.dest_line_name || '',
      slips: [], count: 0, expected: 0, oldestAt: null,
    };
    g.slips.push(r);
    g.count += 1;
    g.expected += Number(r.qty_expected) || 0;
    const t = String(r.created_at || '');
    if (t && (g.oldestAt == null || t < g.oldestAt)) g.oldestAt = t;
    by.set(key, g);
  }
  const out = [...by.values()];
  for (const g of out) g.slips.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  /* กองที่ไม่รู้เวลา (อ่าน created_at ไม่ออก) ต่อท้าย — ห้ามหายจากจอ */
  return out.sort((a, b) => {
    if (a.oldestAt == null) return b.oldestAt == null ? 0 : 1;
    if (b.oldestAt == null) return -1;
    return a.oldestAt.localeCompare(b.oldestAt);
  });
}

/**
 * ปันยอดที่นับได้จริงลงใบรายตัว — ใบเก่าก่อน (FIFO)
 * @param {Array}  slips  ใบในกอง **เรียงเก่า→ใหม่แล้ว** (groupReceipts จัดให้)
 * @param {number} qty    ยอดที่นับได้จริงของทั้งกอง
 * @returns {{ parts:[{id,alloc,expected}], expected:number, got:number, diff:number, zeroed:number }}
 *          `zeroed` = จำนวนใบที่ได้ 0 (ของยังมาไม่ถึง) — จอต้องเขียนบอก
 */
export function allocateFifo(slips = [], qty) {
  const list = (slips || []).filter(Boolean);
  const expected = list.reduce((a, r) => a + (Number(r.qty_expected) || 0), 0);
  const q = Number(qty);
  const got = Number.isFinite(q) && q >= 0 ? Math.floor(q) : 0;
  let left = got;
  const parts = list.map((r) => {
    const exp = Number(r.qty_expected) || 0;
    const alloc = Math.min(exp, left);
    left -= alloc;
    return { id: r.id, alloc, expected: exp };
  });
  /* นับได้เกินยอดรวมของใบ — ส่วนเกินลงใบใหม่สุด (ไม่มีใบ = ทิ้งไว้ ให้ตัวเรียกเห็นจาก diff) */
  if (left > 0 && parts.length) parts[parts.length - 1].alloc += left;
  return {
    parts, expected, got, diff: got - expected,
    zeroed: parts.filter(p => p.alloc === 0).length,
  };
}
