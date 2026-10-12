/* ══════════════════════════════════════════════════════════════════════════
   📦 storeTvDemand — กฎของจอ TV สโตร์ (`/tv?dept=store`) · pure function ล้วน (2026-10-12)

   ที่มา (user 12/10): *"จอของแต่ละส่วนงานก็ควรจะแสดงผลของเรื่องที่เกี่ยวกับส่วนงานนั้นๆ
     เช่นสโตร์ ต้องแจ้งเตือนเมื่อมีความต้องการงานจากไลน์ผลิต บอกว่า ไลน์ไหน ต้องการอะไร
     โชว์การ์ดชิ้นงาน บอก รูป รหัส ชื่อ matsap จำนวน"*

   ไฟล์นี้ตอบ 2 คำถาม — โหลด/วาดอยู่ที่ `components/StoreWaitCards.jsx`
     ① **"ไลน์ไหนเรียกอะไรอยู่"** → `buildRequestCards()`
        แหล่ง = คิวเดียวกับบอร์ดสโตร์ `/heijunka` (ห้ามสร้างคิวที่ 2):
          · `wip_replenish_requests` (Main) — ไลน์กด "📦 เบิก" / สโตร์เปิดใบเอง
            🔴 เฉพาะ `pending`/`preparing` — `suggested`/`hold` ยังไม่ใช่คำสั่ง สโตร์ต้องมองไม่เห็น
               (กฎเหล็ก 1 ของลูปเรียกของ · demand-flow-tower.md) · `delivered` = ส่งแล้ว รอไลน์เซ็นรับ = ไม่ใช่งานสโตร์
          · `raw_withdrawal_requests` (DR) `pending` — ไลน์ child ขอวัตถุดิบ · ไลน์มาจากใบล็อตแม่ (`source_line`)
     ② **"พาร์ทจะขาดของส่วนงานนี้"** → `scopeShortMats()`
        เคส A ของ `v_store_abnormal` เป็นยอด**รวมทุกคลัง** (`line_name` ว่างทุกแถว) ⇒ เดิมจอทุกห้องขึ้นเลขเดียวกัน
        (12/10 จอ PD1 ขึ้น 106 = ทั้งโรงงาน) · ผูกพาร์ทเข้าไลน์ด้วย "ไลน์ที่มีแถวสต็อก/ตั้ง min ของพาร์ทนั้น"
        🔴 **ผูกไม่ได้ (มีของแต่ที่ STORE/FG) ห้ามทิ้งเงียบ** → คืน `unbound` ให้จอเขียนว่ามีอีกกี่พาร์ทที่ชี้ส่วนงานไม่ได้
   ══════════════════════════════════════════════════════════════════════════ */

/** สถานะคำขอบนจอ TV — เรียงแสดง: ไลน์เพิ่งเรียก (ยังไม่มีใครแตะ) ก่อน แล้วค่อยงานที่กำลังเตรียม
 *  ⚠️ ต่างจากบอร์ด `/heijunka` (งานในมือก่อน) โดยตั้งใจ: จอ TV มีหน้าที่ "เตือนว่ามีคนเรียก"
 *     ใบที่สแกนหยิบไปแล้วมีคนถืออยู่ ส่วนใบที่ยังไม่มีใครแตะคือสิ่งที่ห้องต้องเห็นก่อน */
export const REQ_STATUS = {
  pending:   { label: '🔔 ไลน์เรียก',    color: '#f59e0b', rank: 0 },
  preparing: { label: '🔧 กำลังเตรียม', color: '#0ea5e9', rank: 1 },
};

/** นาทีที่รอมาแล้ว · ไม่รู้เวลา = null (ห้ามคืน 0 — 0 แปลว่า "เพิ่งเรียก") */
export function waitMinOf(iso, nowMs) {
  if (!iso || !Number.isFinite(nowMs)) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 60000));
}

/** ป้ายเวลารอแบบอ่านจากไกล — "12 นาที" / "2 ชม. 5 นาที" / "3 วัน 4 ชม." · ไม่รู้ = null
 *  (เกินวัน ตัดนาทีทิ้ง — "1664 ชม. 53 นาที" อ่านจากอีกฝั่งห้องไม่ออก เห็นจริงใน harness 12/10) */
export function waitText(min) {
  if (min == null) return null;
  if (min < 60) return `${min} นาที`;
  if (min < 1440) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
  }
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60);
  return h ? `${d} วัน ${h} ชม.` : `${d} วัน`;
}

/**
 * รวมคำขอจาก 2 คิวเป็นการ์ดรูปเดียว
 * @param {object} p
 * @param {object[]} p.wip      แถว wip_replenish_requests (ควรกรองสถานะมาแล้ว — กรองซ้ำที่นี่กันพลาด)
 * @param {object[]} p.raw      แถว raw_withdrawal_requests สถานะ pending
 * @param {Object<string,object>} p.lotById  child_lot_requests ตาม id (หาไลน์ของใบเบิกวัตถุดิบ)
 * @param {(line:string)=>boolean} [p.inScope]
 * @param {number} p.nowMs
 * @returns {{cards: object[], noLine: number}} noLine = ใบที่ชี้ไลน์ไม่ได้ (โชว์ทุกจอ + ติดป้าย ห้ามทิ้ง)
 */
export function buildRequestCards({ wip = [], raw = [], lotById = {}, inScope, nowMs }) {
  const ok = (line) => !line || !inScope || inScope(line);
  const cards = [];
  let noLine = 0;
  for (const w of wip) {
    const st = REQ_STATUS[w.status];
    if (!st) continue;                         // suggested/hold/delivered/received — ไม่ใช่งานสโตร์บนจอนี้
    if (!ok(w.line_name)) continue;
    if (!w.line_name) noLine++;
    const since = w.status === 'preparing' ? (w.picked_at || w.requested_at) : w.requested_at;
    cards.push({
      key: `w:${w.id}`, kind: 'wip', status: w.status, mat: w.mat_no || '', name: w.part_name || '',
      qty: w.request_qty, line: w.line_name || null, since, waitMin: waitMinOf(w.requested_at, nowMs),
      source: w.source === 'store_forecast' ? 'store' : 'line',
      pickedQty: w.status === 'preparing' ? w.picked_qty : null,
      /* เลข 1xxx = FG ที่ไลน์ผลิตออก สโตร์ตัดจ่ายไม่ได้ (กฎเดียวกับการ์ดคิวใน /heijunka) — เตือน ไม่บล็อก */
      fgWarn: String(w.mat_no || '').trim().charAt(0) === '1',
    });
  }
  for (const r of raw) {
    if (r.status !== 'pending') continue;
    const lot = r.lot_request_id ? lotById[r.lot_request_id] : null;
    const line = lot?.source_line || null;
    if (!ok(line)) continue;
    if (!line) noLine++;
    cards.push({
      key: `r:${r.id}`, kind: 'raw', status: 'pending', mat: r.raw_mat_no || '', name: r.part_name || '',
      qty: r.qty, line, since: r.created_at, waitMin: waitMinOf(r.created_at, nowMs),
      source: 'line', useFor: lot?.child_mat_no || null, pickedQty: null, fgWarn: false,
    });
  }
  cards.sort((a, b) =>
    REQ_STATUS[a.status].rank - REQ_STATUS[b.status].rank
    || (b.waitMin ?? -1) - (a.waitMin ?? -1)          // รอนานสุดขึ้นก่อน · ไม่รู้เวลาไว้ท้าย
    || String(a.line || '').localeCompare(String(b.line || '')));
  return { cards, noLine };
}

/** สรุปรายไลน์ของคำขอ — ป้ายบนผัง + พาดหัว ("ไลน์ไหนเรียก กี่รายการ") */
export function requestLinesOf(cards = []) {
  const m = {};
  for (const c of cards) {
    if (!c.line) continue;
    const g = (m[c.line] = m[c.line] || { line: c.line, n: 0, pending: 0 });
    g.n++;
    if (c.status === 'pending') g.pending++;
  }
  return m;
}

/**
 * แผนที่ mat → ชุดไลน์ ที่พาร์ทนั้น "อยู่/ใช้" (แถวสต็อก + ทะเบียน min/max ต่อไลน์)
 * @param {{mat_no:string,line_name:string}[]} rows
 */
export function matLinesOf(...lists) {
  const m = new Map();
  for (const list of lists) for (const r of list || []) {
    if (!r?.mat_no || !r?.line_name) continue;
    if (!m.has(r.mat_no)) m.set(r.mat_no, new Set());
    m.get(r.mat_no).add(r.line_name);
  }
  return m;
}

/**
 * คัดพาร์ทต่ำกว่า Min (เคส A) ให้เหลือเฉพาะของส่วนงานบนจอ
 * @param {object[]} aRows       แถวเคส A จาก v_store_abnormal
 * @param {Map<string,Set<string>>} matLines  จาก matLinesOf()
 * @param {(line:string)=>boolean|null} inScope  null = จอนี้ไม่กรอง (ทุกไลน์)
 * @param {Set<string>} knownLines  ชื่อไลน์ผลิตในทะเบียน (STORE/FG WAREHOUSE ไม่อยู่ในนี้)
 * @returns {{rows: object[], unbound: number}}
 */
export function scopeShortMats(aRows = [], matLines = new Map(), inScope = null, knownLines = new Set()) {
  if (!inScope) return { rows: sortShort(aRows), unbound: 0 };
  const rows = [];
  let unbound = 0;
  for (const r of aRows) {
    const lines = [...(matLines.get(r.mat_no) || [])].filter(l => knownLines.has(l));
    if (!lines.length) { unbound++; continue; }      // ผูกไลน์ผลิตไม่ได้ — นับไว้บอกบนจอ
    if (lines.some(l => inScope(l))) rows.push({ ...r, lines: lines.filter(l => inScope(l)) });
  }
  return { rows: sortShort(rows), unbound };
}

/** หมดเกลี้ยงก่อน → ขาดจาก Min มากสุด (สัดส่วน) → รหัส */
function sortShort(rows) {
  const ratio = (r) => (Number(r.min_qty) > 0 && r.qty_on_hand != null ? Number(r.qty_on_hand) / Number(r.min_qty) : 1);
  return [...rows].sort((a, b) => (b.sev ?? 0) - (a.sev ?? 0) || ratio(a) - ratio(b) || String(a.mat_no).localeCompare(String(b.mat_no)));
}
