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
};

/** โหมดปัจจุบันของแถวกฎ */
export const inflowModeOf = (rule) =>
  !rule?.is_active ? 'off' : (rule.mode === 'confirm' ? 'confirm' : 'auto');

/** ค่าที่ต้องเขียนลงแถวกฎเมื่อเลือกโหมด (ปิด = คงโหมดเดิมไว้ เปิดกลับมาได้แบบเดิม) */
export const inflowPatchFor = (modeKey, rule) =>
  modeKey === 'off' ? { is_active: false, mode: rule?.mode === 'confirm' ? 'confirm' : 'auto' }
                    : { is_active: true, mode: modeKey === 'confirm' ? 'confirm' : 'auto' };

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
