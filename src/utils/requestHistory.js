/* ═══ 🧾 ประวัติเบิก-ส่ง (ไลน์ขอ ↔ สโตร์ส่ง) — กฎสรุปที่เดียว (2026-11-27 · คำสั่ง user) ═══════
   user: *"ฝ่ายผลิตอยากเห็น dashboard transaction ว่ากดเบิกอะไรไปบ้าง สโตร์ส่งอะไรมาบ้าง"*
   แหล่งข้อมูล = `wip_replenish_requests` (Main) — อ่านอย่างเดียว ไม่เขียนกลับ
   จอ = `/line-stock?tab=reqlog` (`components/LineRequestHistory.jsx`)

   ผลของใบ (`reqOutcome`):
     `full`      รับแล้ว ยอดรับ ≥ ยอดขอ (สโตร์ส่งเกินตามกล่อง = ครบ)
     `short`     รับแล้ว ยอดรับ < ยอดขอ
     `recv_noqty` รับแล้วแต่ไม่มียอดรับ → 🔴 ตัดสินครบ/ไม่ครบไม่ได้ ต้องนับแยก ห้ามเดาว่าครบ
     `awaiting`  สโตร์ส่งแล้ว ไลน์ยังไม่กดรับ
     `open`      ยังไม่ส่ง (รอสโตร์ / กำลังเตรียม)
     `cancelled` ยกเลิก
     `other`     สถานะที่ไม่รู้จัก → 🔴 ต้องโชว์ ห้ามทิ้ง
   ══════════════════════════════════════════════════════════════════════════ */
import { addDaysStr, WORK_DAY_START_HOUR } from './workDate.js';

export const OUTCOME_META = {
  full:       { label: 'รับครบ',             tone: 'ok'   },
  short:      { label: 'รับไม่ครบ',          tone: 'bad'  },
  recv_noqty: { label: 'รับแล้ว (ไม่มียอดรับ)', tone: 'warn' },
  awaiting:   { label: 'ส่งแล้ว รอไลน์รับ',   tone: 'info' },
  open:       { label: 'ยังไม่ส่ง',           tone: 'warn' },
  cancelled:  { label: 'ยกเลิก',             tone: 'mute' },
  other:      { label: 'สถานะอื่น',          tone: 'mute' },
};

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ผลของใบ 1 ใบ — ดูหัวไฟล์ */
export function reqOutcome(r) {
  const s = String(r?.status ?? '').trim();
  if (s === 'cancelled') return 'cancelled';
  if (s === 'pending' || s === 'preparing') return 'open';
  if (s === 'delivered') return 'awaiting';
  if (s === 'received') {
    const got = num(r?.received_qty), want = num(r?.request_qty);
    if (got == null || want == null) return 'recv_noqty';
    return got + 1e-9 >= want ? 'full' : 'short';
  }
  return 'other';
}

/** นาทีจากขอ → ไลน์รับ · อ่านเวลาไม่ได้/ยังไม่รับ = null (ห้ามคืน 0) */
export function leadMinOf(r) {
  if (!r?.received_at || !r?.requested_at) return null;
  const a = Date.parse(r.requested_at), b = Date.parse(r.received_at);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60000);
}

/** ส่วนต่าง รับ − ขอ (เฉพาะใบที่รับแล้วและมียอดทั้งคู่) · อย่างอื่น = null */
export function qtyDiffOf(r) {
  if (String(r?.status ?? '').trim() !== 'received') return null;
  const got = num(r?.received_qty), want = num(r?.request_qty);
  if (got == null || want == null) return null;
  return Math.round((got - want) * 1000) / 1000;
}

/**
 * สรุปตัวเลขบนการ์ด
 * @returns {{ total, active, byOutcome, pending, avgLeadMin, leadN }}
 *   total = ทุกใบในช่วง (รวมยกเลิก) · active = ไม่นับยกเลิก
 *   pending = ค้าง (ยังไม่ส่ง + ส่งแล้วรอรับ) · avgLeadMin = null เมื่อไม่มีใบที่รับแล้วพร้อมเวลา
 */
export function summarizeRequests(rows = []) {
  const byOutcome = Object.fromEntries(Object.keys(OUTCOME_META).map(k => [k, 0]));
  let leadSum = 0, leadN = 0;
  for (const r of rows) {
    byOutcome[reqOutcome(r)]++;
    const m = leadMinOf(r);
    if (m != null) { leadSum += m; leadN++; }
  }
  return {
    total: rows.length,
    active: rows.length - byOutcome.cancelled,
    byOutcome,
    pending: byOutcome.open + byOutcome.awaiting,
    avgLeadMin: leadN ? Math.round(leadSum / leadN) : null,
    leadN,
  };
}

/** ช่วงวันทำงาน (from/to 'YYYY-MM-DD') → ขอบเวลาจริงสำหรับคิวรี `requested_at`
 *  วันทำงานเริ่ม 08:00 ไทย ⇒ [from 08:00, (to+1) 08:00) · แกะวันไม่ออก = null */
export function workRangeToTs(from, to) {
  const end = addDaysStr(to, 1);
  if (!addDaysStr(from, 0) || !end) return null;
  const hh = String(WORK_DAY_START_HOUR).padStart(2, '0');
  return { gte: `${from}T${hh}:00:00+07:00`, lt: `${end}T${hh}:00:00+07:00` };
}
