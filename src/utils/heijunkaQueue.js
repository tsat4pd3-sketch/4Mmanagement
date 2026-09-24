/* ══ คิวการ์ดบนบอร์ด Heijunka — single source of truth ═══════════════════════════════════
   จัดตำแหน่งการ์ดใบผลิตบนไทม์ไลน์ของ 1 เลน (sub-line) — "1 ไลน์ผลิตได้ทีละใบ ห้ามซ้อนทับ"

   ⚠️ เดิม copy-paste ไว้ใน Dashboard.jsx + Management.jsx แล้ว **drift กันจริง**
      (audit single source of truth 2026-08-19): Management ตัด `is_backfill` ออกจากการตีแดง
      แต่ Dashboard ไม่ตัด ⇒ ใบที่เปิดย้อนหลังขึ้นแดง "ดีเลย์" บนจอหนึ่งแต่ไม่ขึ้นอีกจอหนึ่ง
      ทั้งที่เป็นบอร์ดเดียวกันที่คนดูพร้อมกัน · **ยึดของ Management (ตัด backfill) เป็นตัวถูก**
      เพราะใบ backfill คนกรอกเวลาเอง เวลาเปิดไม่ใช่เวลาเริ่มผลิตจริง → ตัดสินดีเลย์จากมันไม่ได้

   ห้าม copy ฟังก์ชันนี้ไปไว้ในหน้าอีก — บอร์ดใหม่ให้ import ตัวนี้

   deps ที่ต้องส่งเข้ามา (มาจาก state/ค่าที่คำนวณในหน้า):
     breaks        [[startMs, endMs], ...] ช่วงพักทั้งวัน เรียงแล้ว
     ctByMat       { mat_no: cycle_time_sec }
     nowMs         เวลาปัจจุบัน (ms)
     roundIndexOf  (ms) => index ของรอบ (ช่องเวลาบนกริด)
     roundStartOf  (idx) => ms ของต้นรอบนั้น

   การ์ด (cards) ต้องมี: orderStartMs, orderEndMs, isDone, isCarry, is_backfill,
                        confirmed_at, mat_no, qty/qty_ok/qty_actual
   ═════════════════════════════════════════════════════════════════════════════════════════ */

const BATCH_GAP_MS = 5 * 60000;

export function computeQueuedPositionsFull(cards, { breaks, ctByMat = {}, nowMs, roundIndexOf, roundStartOf }) {
  const filtered = cards.filter(o => o.orderStartMs && o.orderEndMs);
  const byOpenTime = [...filtered].sort((a, b) => a.orderStartMs - b.orderStartMs);
  // คิวแสดงผลจริง: ใบที่ "ปิดแล้ว" (confirm) คือลำดับการผลิตที่เกิดขึ้นจริง ให้แทรกเข้าคิวก่อนตามเวลาปิดจริง
  // (confirmed_at) เสมอ — ใบที่ "ยังไม่ปิด" ถือว่ายังไม่ถึงตาที่ผลิตจริง ต้องถีบไปต่อท้ายคิวเสมอ ไม่ว่าจะ
  // เปิดมาก่อนนานแค่ไหนก็ตาม ผลคือถ้ามีใบ confirm มาแทรก จะดันใบที่ยังไม่ปิดถอยไปอยู่หลังสุด ไม่บังพื้นที่
  // ของใบที่ทำสำเร็จไปแล้วจริง ๆ — ทำให้เหลือใบแดง (ยังไม่ปิด) แค่เท่าที่จำเป็นจริง ๆ
  const doneCards = filtered.filter(o => o.isDone && o.confirmed_at)
    .sort((a, b) => new Date(a.confirmed_at).getTime() - new Date(b.confirmed_at).getTime() || a.orderStartMs - b.orderStartMs);
  const openCards = filtered.filter(o => !(o.isDone && o.confirmed_at))
    .sort((a, b) => a.orderStartMs - b.orderStartMs);
  const sorted = [...doneCards, ...openCards];

  // ── ชุดสแกนปิดรวด (batch confirm) ──────────────────────────────────────
  // เครื่องจักรยังไม่ส่งสัญญาณจบทีละใบ พนักงานจึงสแกนปิดทั้งล็อตรวดเดียว (เช่น 9 ใบติดกัน)
  // ถ้าตัดสิน "ปิดช้า" รายใบจาก confirmed_at ใบแรก ๆ ของชุดจะกลายเป็นส้มเกินจริงเสมอ
  // จึงจัดกลุ่มใบที่สแกนห่างกันไม่เกิน 5 นาทีเป็นชุดเดียว แล้วตัดสินความช้าที่ใบสุดท้ายของชุด
  const batchIdOf = new Map();
  let curBatchId = 0;
  doneCards.forEach((o, i) => {
    if (i > 0 && new Date(o.confirmed_at).getTime() - new Date(doneCards[i - 1].confirmed_at).getTime() > BATCH_GAP_MS) curBatchId++;
    batchIdOf.set(o, curBatchId);
  });
  const batchCount = new Map();
  doneCards.forEach(o => { const b = batchIdOf.get(o); batchCount.set(b, (batchCount.get(b) || 0) + 1); });
  const batchSeen = new Map();

  // เงื่อนไขผสม: ใบที่ยังไม่ปิด+เกินเวลาจะตีแดงก็ต่อเมื่อ "ยอดรวมจริงของแถวนี้ยังไม่ทันเป้าตามเวลา" ด้วย
  // ถ้ายอดรวมทันเป้าอยู่ (แค่สแกนปิดไม่ตรง FIFO) จะไม่ตีแดง เพราะงานยังผลิตได้ตามแผนจริง
  // pace เทียบเป็น std-time (Σ ยอด×CT ของแต่ละพาร์ท) — คิวหนึ่งอาจมีหลายพาร์ท CT ต่างกัน
  // (คิวคำนวณระดับ sub-line แล้ว ไม่ใช่ต่อพาร์ท — ห้ามใช้ CT ของใบแรกเหมาทั้งคิว)
  const rowActualStdSec = cards.reduce((a, c) => a + ((c.isDone ? (c.qty_ok ?? c.qty ?? 0) : (c.qty_actual ?? 0)) * (ctByMat[c.mat_no] || 0)), 0);
  const anyCt = cards.some(c => (ctByMat[c.mat_no] || 0) > 0);
  const firstStartMs = byOpenTime.length ? byOpenTime[0].orderStartMs : null;
  let expectedStdSec = Infinity;
  if (anyCt && firstStartMs) {
    let elapsedMs = Math.max(0, Math.min(nowMs, firstStartMs + 24 * 3600000) - firstStartMs);
    breaks.forEach(([bs, be]) => {
      const os = Math.max(bs, firstStartMs), oe = Math.min(be, nowMs);
      if (oe > os) elapsedMs -= (oe - os);
    });
    expectedStdSec = Math.max(0, elapsedMs) / 1000;
  }
  const rowBehindPace = rowActualStdSec < expectedStdSec;

  let queueEndMs = -Infinity;
  let curRoundIdx = null;
  return sorted.map(o => {
    const roundIdx = roundIndexOf(o.orderStartMs);
    // ห้ามให้ queueEndMs ถอยหลัง — ถ้าการ์ดก่อนหน้ายาวคร่อมเข้ารอบถัดไป (duration ยาวจาก qty×ct)
    // ต้องเดินคิวต่อจากที่มันจบจริง ไม่ใช่กระโดดกลับไปที่จุดเริ่มรอบใหม่ (จะทำให้ทับกัน)
    if (curRoundIdx === null || roundIdx !== curRoundIdx) {
      curRoundIdx = roundIdx;
      queueEndMs = Math.max(queueEndMs, roundStartOf(roundIdx));
    }
    const durationMs = Math.max(o.orderEndMs - o.orderStartMs, 0);
    const startMs = Math.max(o.orderStartMs, queueEndMs);
    let endMs = startMs + durationMs;
    // ถ้าช่วงเวลาผลิตของการ์ดนี้ทับเวลาพักเบรค ไม่เลื่อน startMs ไปหลังเบรค (เพราะจะทำให้
    // เวลาที่ "ว่าง" ก่อนเบรคเสียไปฟรี ๆ) แต่ให้ "ซอย" ทับเบรคแล้วยืดความยาวการ์ดออกแทน
    const consumedBreaks = new Set();
    let extended = true;
    while (extended) {
      extended = false;
      breaks.forEach(([bs, be], i) => {
        if (consumedBreaks.has(i)) return;
        if (bs < endMs && be > startMs) {
          consumedBreaks.add(i);
          endMs += (be - bs);
          extended = true;
        }
      });
    }
    // กฎตายตัว: ใบกัมบังห้ามซ้อนทับกันเอง และความกว้างต้องไม่สั้นกว่า durationMs (qty × ct) เด็ดขาด
    // ปิดเร็วกว่าทฤษฎี = ไม่บีบการ์ด (ใช้ confirmed_at แค่ตัดสินสี) · ปิดช้า = แสดง "หาง" แยก ไม่ขยับการ์ดหลัก
    let isLateDone = false;
    if (o.isDone && o.confirmed_at) {
      const bid = batchIdOf.get(o);
      const size = batchCount.get(bid) || 1;
      const seen = (batchSeen.get(bid) || 0) + 1;
      batchSeen.set(bid, seen);
      if (size === 1 || seen === size)
        isLateDone = new Date(o.confirmed_at).getTime() > endMs + (size > 1 ? BATCH_GAP_MS : 0);
    }
    let occupiedEndMs = endMs;
    if (isLateDone) {
      occupiedEndMs = new Date(o.confirmed_at).getTime();
    } else if (!o.isDone && !o.isCarry && nowMs > endMs) {
      occupiedEndMs = nowMs;
    }
    /* 🔴 เดินคิวด้วย `occupiedEndMs` เสมอ = "เวลาที่เลนนี้ว่างจริง" (2026-09-22 · คำสั่ง user)
       เดิมเขียน `isLateDone ? occupiedEndMs : endMs` ⇒ ใบที่ **ยังไม่ปิดและเลยกำหนด**
       เดินคิวจาก `endMs` (เวลาทฤษฎีที่ผ่านไปแล้ว) = **ดีเลย์ไม่ถูกส่งต่อให้ใบถัดไปเลย**
       ผลบนจอ: ใบต่อๆ ไปถูกวาดทับอยู่ในอดีต · หางแดงถูกตัดสั้น · ใบสุดท้ายยังจบที่เวลาทฤษฎี
       ⇒ หัวหน้าไลน์อ่านบอร์ดแล้ว **ตอบไม่ได้ว่างานจะไปจบกี่โมง และต้อง recover ยังไง**
       (user: "ถ้าใบแรกแดง ควรจะยืดดันใบที่ต่อท้ายออกไป เพื่อให้เห็นว่าจะ recovery ยังไง")
       ตอนนี้ใบค้าง 1 ใบดันทั้งแถวไปข้างหน้า → `endMs` ของใบสุดท้าย = **เวลาที่คาดว่าจะจบจริง**
       · ใบปกติ `occupiedEndMs === endMs` ⇒ พฤติกรรมเดิมเป๊ะ
       · ใบปิดช้า = confirmed_at ⇒ เหมือนเดิม
       ⚠️ ห้ามกลับไปใช้ `endMs` — คิวจะถอยกลับไปอดีตแล้วการ์ดซ้อนทับกันอีก */
    queueEndMs = occupiedEndMs;
    // ⚠️ `!o.is_backfill` — ใบเปิดย้อนหลังคนกรอกเวลาเอง เวลาเปิดไม่ใช่เวลาเริ่มผลิตจริง
    //    ตัดสิน "ดีเลย์" จากมันไม่ได้ (จุดที่ Dashboard เคยตกไป ทำให้ 2 จอไม่ตรงกัน)
    const isDelayed = !o.isDone && !o.isCarry && !o.is_backfill && endMs < nowMs && rowBehindPace;
    return { o, startMs, endMs, occupiedEndMs, isDelayed, isLateDone };
  });
  /* หมายเหตุ: เดิมมี pass ที่ 2 คอยตัดหางแดงไม่ให้ทับใบถัดไป — ไม่ต้องแล้วตั้งแต่เดินคิวด้วย
     `occupiedEndMs` เพราะใบถัดไปเริ่มที่จุดนั้นพอดี (pass นั้นคือตัวที่ "ซ่อน" ดีเลย์ไว้) */
}

/* ⏱️ เวลาที่คาดว่างานทั้งเลน/แถวจะจบ — ตอบคำถาม "แล้วใบสุดท้ายจะจบกี่โมง"
   นับเฉพาะใบที่ยัง**ไม่จบ** (ใบที่ปิดแล้วไม่ใช่ "งานที่เหลือ") · คืน null เมื่อไม่มีงานค้าง
   ⚠️ ต้องอ่านจากผลของ `computeQueuedPositionsFull` เท่านั้น — ค่านี้จะถูกต้องก็ต่อเมื่อคิวถูกดัน
   ด้วย `occupiedEndMs` (ดูคอมเมนต์ด้านบน) ห้ามคำนวณ `opened_at + qty×CT` เองในหน้า */
export function projectedFinishMs(positioned = []) {
  let last = null;
  const each = (item) => {
    if (!item || item.o?.isDone || item.o?.isCarry) return;
    const end = Math.max(item.endMs || 0, item.occupiedEndMs || 0);
    if (end > 0 && (last == null || end > last)) last = end;
  };
  if (typeof positioned.forEach === 'function') positioned.forEach(each);
  return last;
}

/* ── แบ่ง "เลน" ก่อนต่อคิว — 1 เลน = 1 เครื่องจริงที่ผลิตได้ทีละใบ ─────────────────────
   ⚠️ เดิม copy-paste ไว้ทั้ง Dashboard.jsx และ Management.jsx **เหมือนกันทุกบรรทัด**
      (diff 2026-09-16: ต่างแค่คอมเมนต์กับชื่อตัวแปร) แล้ว `totalDelayed` ของ 2 หน้าก็ยัง
      คำนวณคนละสูตรอยู่ดี ⇒ **บอร์ดเดียวกัน 2 จอ ขึ้น "ดีเลย์ N ใบ" คนละเลข**
      → ย้ายมาที่นี่ทั้งก้อน · **ห้าม copy กลับไปไว้ในหน้าอีก**

   กติกาแบ่งเลน (เรียงตามลำดับที่เช็ค):
     1. ไลน์ `flow_mode = 'parallel_machine'` (เครื่อง stand-alone ต่างคนต่างรัน)
        · ใบผูกเครื่องแล้ว (machine_no) → เลนของเครื่องนั้น
        · ยังไม่ผูก → กระจาย round-robin N เลน (N = parallel_stations หรือจำนวนเครื่องในทะเบียน)
     2. งานคู่ RH/LH (`pair_mat_no`) ที่มี**ทั้งสองพาร์ทอยู่ในไลน์เดียวกัน** = แม่พิมพ์คู่ ปั๊มพร้อมกัน
        → เลนของตัวเอง เริ่มพร้อมกัน แถบบนจอจึงตรงกัน (2026-07-21)
     3. นอกนั้น = 1 ไลน์ 1 เลน เรียงต่อคิวกัน
        (เคยพัง 2026-07-14: คำนวณคิวแยกต่อ "แถวพาร์ท" → พาร์ทที่สองถูกวาดเริ่ม 08:00 ซ้อนพาร์ทแรก
         ทั้งที่ไลน์ไม่ parallel) */
export function buildLanes(cards = [], { flowByLine = {}, machineCountByLine = {}, pairMatByMat = {} } = {}) {
  const matsInLine = {};                       // line → Set(mat_no) ที่มีการ์ดจริง
  cards.forEach(c => { (matsInLine[c.line_name || ''] ||= new Set()).add(c.mat_no); });
  const stationsOf = (line) => {
    const l = flowByLine[line];
    return (l && l.parallel_stations > 0 ? l.parallel_stations : 0) || machineCountByLine[line]?.size || 0;
  };
  const lanes = {};
  const rr = {};                               // round-robin ต่อไลน์ สำหรับใบที่ยังไม่ผูกเครื่อง
  cards.forEach(c => {
    const line = c.line_name || '';
    let key;
    if (flowByLine[line]?.flow_mode === 'parallel_machine') {
      if (c.machine_no) key = `${line}||M:${c.machine_no}`;
      else { const N = stationsOf(line); const i = (rr[line] = (rr[line] ?? -1) + 1); key = N > 0 ? `${line}||P:${i % N}` : `${line}||P:${i}`; }
    } else {
      const pm = pairMatByMat[c.mat_no];
      key = (pm && matsInLine[line]?.has(pm)) ? `${line}||${c.mat_no}` : line;
    }
    (lanes[key] ||= []).push(c);
  });
  return lanes;
}

/* คิวการ์ดทั้งบอร์ดของ 1 กลุ่มไลน์ — แบ่งเลนแล้วต่อคิวในแต่ละเลน คืน Map(คีย์ใบ → ตำแหน่ง)
   คีย์ใบ = `id ?? prod_no` (ต้องตรงกับที่หน้าใช้ค้น) */
export const orderKeyOf = (o) => o?.id ?? o?.prod_no;

export function positionAllCards(cards = [], opts = {}) {
  const { flowByLine, machineCountByLine, pairMatByMat, ...queueOpts } = opts;
  const out = new Map();
  Object.values(buildLanes(cards, { flowByLine, machineCountByLine, pairMatByMat })).forEach(laneCards => {
    computeQueuedPositionsFull(laneCards, queueOpts).forEach(item => out.set(orderKeyOf(item.o), item));
  });
  return out;
}

/* จำนวนใบที่ "ดีเลย์อยู่ตอนนี้" — ⚠️ อ่านว่า *ตอนนี้ค้างกี่ใบ* ไม่ใช่ *วันนี้ดีเลย์ไปแล้วกี่ใบ*
   (ใบที่ช้าแล้วปิดไปแล้ว = isLateDone ไม่ถูกนับ · ใบ backfill ถูกยกเว้นตั้งแต่ใน isDelayed)
   👉 ตัวเลขที่ตอบ "ต้อง recover เท่าไหร่" คือ `liveTimeSplit` ใน utils/oee.js (หน่วยนาที) */
export function delayedCountOf(positioned) {
  let n = 0;
  positioned.forEach(item => { if (item.isDelayed) n++; });
  return n;
}
