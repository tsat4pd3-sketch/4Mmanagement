/* ══ 📺 storeTvBoard — กฎของจอทีวีสโตร์ (ส่งของเข้าไลน์ ↔ รับของเข้าคลัง · 2026-11-24 · คำสั่ง user) ══
   user เคาะ mockup: *"ใช้ 20 วิ เกณฑ์ตามที่ใส่มา"* ⇒
   · สลับหน้าทุก **20 วินาที** (`STORE_TV_FLIP_SEC`) · หน้าละ 8 ใบ (4×2 บนจอ 16:9) ใบเกิน = หน้าถัดไป
   · ใบไลน์เรียกของที่ยังไม่ส่ง (รอหยิบ/กำลังเตรียม): **เหลือง > 15 นาที · แดง > 30 นาที** (นับจากเวลาไลน์เรียก)
   · ส่งแล้วรอไลน์รับ = งานฝั่งไลน์ ⇒ ไม่ไล่สีเตือนสโตร์ (โชว์ว่าส่งมาแล้วนานเท่าไร)
   · ใบรอรับเข้าคลัง: ค้างเกินกฎของคลัง (`stock_inflow_rules.stale_after_min` · ไม่ตั้ง = DEFAULT_STALE_MIN) = แดง · ที่เหลือ = เหลือง
     ยุบเป็นกองแบบเดียวกับจอทำงาน (`groupReceipts`) — ปิดใบผลิต 1 ใบ = 1 แถว ⇒ การ์ดต่อใบล้นจอ
   🔴 อ่านไม่รู้เวลา = ไม่เดาสี (tone `none`) และนับว่า "ไม่รู้เวลา" ให้จอเขียนบอก
   ⚠️ ไฟล์นี้ไม่ยิง DB · ไม่อ่านนาฬิกาเอง (`now` ส่งเข้ามา — กฎเทสระเบิดเวลา) */
import { groupReceipts, receiptAgeMin, DEFAULT_STALE_MIN } from './stockReceipts.js';

export const STORE_TV_FLIP_SEC = 20;
export const STORE_TV_PER_PAGE = 8;
export const CALL_WARN_MIN = 15;
export const CALL_BAD_MIN = 30;

const minsSince = (iso, now) => {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60000));
};

/** สีของใบที่สโตร์ยังต้องลงมือ (รอหยิบ/กำลังเตรียม) */
export function callTone(min) {
  if (min == null) return 'none';
  if (min > CALL_BAD_MIN) return 'bad';
  if (min > CALL_WARN_MIN) return 'warn';
  return 'ok';
}

const SEND_LABEL = { pending: 'รอหยิบ', preparing: 'กำลังเตรียม', delivered: 'ส่งแล้ว รอไลน์รับ' };

/**
 * หน้า "ส่งของเข้าไลน์"
 * @param rows  wip_replenish_requests (status pending|preparing|delivered)
 * @param opt   { now(ms), inScope(lineName) }
 */
export function buildSendBoard(rows = [], { now = 0, inScope = () => true } = {}) {
  const kpi = { pending: 0, preparing: 0, delivered: 0, late: 0 };
  let hiddenScope = 0, unknownAge = 0;
  const work = [], done = [];
  for (const r of rows || []) {
    if (!r || !SEND_LABEL[r.status]) continue;
    if (!inScope(r.line_name)) { hiddenScope++; continue; }
    kpi[r.status]++;
    if (r.status === 'delivered') {
      const age = minsSince(r.delivered_at, now);
      done.push({ id: r.id, line: r.line_name, mat: r.mat_no, name: r.part_name, qty: r.request_qty, uom: r.uom,
        age, tone: 'done', status: SEND_LABEL.delivered, at: r.delivered_at || '' });
      continue;
    }
    const age = minsSince(r.requested_at, now);
    if (age == null) unknownAge++;
    const tone = callTone(age);
    if (tone === 'bad') kpi.late++;
    work.push({ id: r.id, line: r.line_name, mat: r.mat_no, name: r.part_name, qty: r.request_qty, uom: r.uom,
      age, tone, status: SEND_LABEL[r.status], at: r.requested_at || '' });
  }
  /* ใบที่รอนานสุดขึ้นก่อน · ไม่รู้เวลาต่อท้ายกลุ่ม (ห้ามหายจากจอ) · ส่งแล้วอยู่ท้ายสุด */
  const byAge = (a, b) => (a.age == null ? 1 : b.age == null ? -1 : b.age - a.age);
  work.sort(byAge); done.sort(byAge);
  return { cards: [...work, ...done], kpi, hiddenScope, unknownAge };
}

/**
 * หน้า "รับของเข้าคลัง"
 * @param rows  stock_receipts (status pending)
 * @param opt   { now(ms), staleOf(destName)→นาที, inScope(sourceLine), dest (กรองคลังของจอนี้ · ว่าง = ทุกคลัง) }
 */
export function buildRecvBoard(rows = [], { now = 0, staleOf = () => DEFAULT_STALE_MIN, inScope = () => true, dest = '' } = {}) {
  let hiddenScope = 0, hiddenDest = 0;
  const keep = [];
  for (const r of rows || []) {
    if (!r || r.status !== 'pending') continue;
    if (!inScope(r.source_line)) { hiddenScope++; continue; }
    if (dest && r.dest_line_name !== dest) { hiddenDest++; continue; }
    keep.push(r);
  }
  const byDest = new Map();
  let stale = 0, unknownAge = 0;
  for (const r of keep) {
    const k = r.dest_line_name || '—';
    byDest.set(k, (byDest.get(k) || 0) + 1);
    const age = receiptAgeMin(r, now);
    if (age == null) unknownAge++;
    else if (age > (Number(staleOf(r.dest_line_name)) || DEFAULT_STALE_MIN)) stale++;
  }
  const cards = groupReceipts(keep).map(g => {
    const age = receiptAgeMin(g.slips[0], now);
    const limit = Number(staleOf(g.dest_line_name)) || DEFAULT_STALE_MIN;
    return { id: g.key, line: `${g.source_line || '—'} → ${g.dest_line_name || '—'}`, mat: g.mat_no, name: g.part_name,
      qty: g.expected, count: g.count, age, tone: age == null ? 'none' : age > limit ? 'bad' : 'warn',
      status: age != null && age > limit ? 'ค้าง' : 'รอรับ' };
  });
  return {
    cards, hiddenScope, hiddenDest, unknownAge,
    kpi: { slips: keep.length, stale, byDest: [...byDest.entries()].sort((a, b) => b[1] - a[1]) },
  };
}

/** ลำดับหน้าที่หมุน: ส่งของทุกหน้า → รับของทุกหน้า (ไม่มีใบ = ยังมี 1 หน้าให้เห็นว่า "ไม่มีงานค้าง") */
export function storeTvSteps(nSend, nRecv, per = STORE_TV_PER_PAGE) {
  const pages = (n) => Math.max(1, Math.ceil((Number(n) || 0) / per));
  const out = [];
  const ps = pages(nSend), pr = pages(nRecv);
  for (let i = 0; i < ps; i++) out.push({ view: 'send', page: i, pages: ps });
  for (let i = 0; i < pr; i++) out.push({ view: 'recv', page: i, pages: pr });
  return out;
}
