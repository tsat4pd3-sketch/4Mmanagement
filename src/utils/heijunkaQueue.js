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

/* 🔴 "ตอนนี้" ต้องไม่หลุดกรอบวันงานที่กำลังดู (2026-09-30 · เจอจาก harness)
   ดูบอร์ดของ **วันย้อนหลัง** ที่มีใบไม่เคยถูกปิด: ของเดิมเอา `Date.now()` จริงไปดันคิว
   ⇒ หางแดงยาว 57 วัน · "คาดจบ" = เวลาปัจจุบัน · แถบหลุดแผนขึ้น **"ช้ากว่าแผน 1368:00 ชม."**
   ซึ่งเป็นตัวเลขขยะที่ทำให้คนเลิกเชื่อจอทั้งบอร์ด · ความจริงของวันนั้นคือ "ใบนี้ไม่เคยถูกปิด"
   ⇒ หน้าที่วาดบอร์ดต้องส่ง `frameEndMs` (= 08:00 ของวันถัดไป) มาด้วยเสมอเมื่อดูวันที่ระบุ
   (ดูวันนี้ = now < frameEnd ⇒ ไม่มีผลอะไร พฤติกรรมเดิมเป๊ะ) */
function clampNow(nowMs, frameEndMs) {
  return frameEndMs && nowMs > frameEndMs ? frameEndMs : nowMs;
}

/* "วันงานที่กำลังดูจบไปแล้วหรือยัง" — ใช้ทั้ง planStatusOf และ dayDelaySummaryOf
   ⚠️ เคยคิดซ้ำ 2 ที่แล้วจอขึ้น 2 เลขขัดกัน (ดูหมายเหตุใน dayDelaySummaryOf) ⇒ ที่เดียวเท่านั้น */
export function isDayOver(frameEndMs, nowMs) {
  return !!(frameEndMs && nowMs && nowMs >= frameEndMs);
}

/* การ์ดที่คร่อมเวลาพัก — ไม่เลื่อน start (เสียเวลาว่างก่อนเบรคฟรีๆ) แต่ "ยืด" ปลายออกเท่าเวลาพักที่คร่อม
   ⚠️ ใช้ทั้งคิวจริงและคิว "ตามแผน" ⇒ ต้องเป็นฟังก์ชันเดียว (เดิม inline · ก๊อป 2 ที่แล้วดริฟท์แน่)
   📤 export ตั้งแต่ 2026-09-30 — ไทม์ไลน์จัดแผน (`utils/planTimeline.js`) ต้องยืดข้ามเบรค
      ด้วยกฎ**เดียวกับบอร์ดจริง** ไม่งั้นกล่องบนจอวางแผนกับแท่งบนบอร์ดยาวไม่เท่ากัน */
export function stretchOverBreaks(startMs, endMs, breaks = []) {
  const used = new Set();
  let out = endMs, again = true;
  while (again) {
    again = false;
    breaks.forEach(([bs, be], i) => {
      if (used.has(i)) return;
      if (bs < out && be > startMs) { used.add(i); out += (be - bs); again = true; }
    });
  }
  return out;
}

/* ── จังหวะงานของแถว (pace) — "ควรได้เท่าไหร่แล้ว vs ได้จริงเท่าไหร่" ในหน่วย std-second ────
   std-second = ยอด × CT ของพาร์ทนั้น ⇒ รวมข้ามพาร์ทที่ CT ต่างกันได้ (ห้ามใช้ CT ใบแรกเหมาทั้งคิว)
   🔴 เป็น **สูตรเดียว** ที่ทั้งการตีสีใบ (isDelayed) และแถบสถานะบนจอใช้ร่วมกัน — ห้ามคิดใหม่ในหน้า
   · `anyCt = false` (ไม่มี CT เลย) = **ประเมินไม่ได้** ⇒ `behindSec: null` ห้ามอ่านเป็น 0
     (ของเดิมตั้ง expectedStdSec = Infinity เพื่อให้ตีสีตามเวลาเปิด-ปิดล้วน — คงพฤติกรรมนั้นไว้) */
export function rowPace(cards = [], { breaks = [], ctByMat = {}, nowMs: rawNow, frameEndMs = null } = {}) {
  const nowMs = clampNow(rawNow, frameEndMs);
  const withTime = cards.filter(o => o.orderStartMs && o.orderEndMs);
  const doneStdSec = cards.reduce((a, c) =>
    a + ((c.isDone ? (c.qty_ok ?? c.qty ?? 0) : (c.qty_actual ?? 0)) * (ctByMat[c.mat_no] || 0)), 0);
  const anyCt = cards.some(c => (ctByMat[c.mat_no] || 0) > 0);
  const firstStartMs = withTime.length ? Math.min(...withTime.map(o => o.orderStartMs)) : null;
  if (!anyCt || !firstStartMs) {
    return { doneStdSec, expectedStdSec: Infinity, behindSec: null, anyCt, firstStartMs };
  }
  let elapsedMs = Math.max(0, Math.min(nowMs, firstStartMs + 24 * 3600000) - firstStartMs);
  breaks.forEach(([bs, be]) => {
    const os = Math.max(bs, firstStartMs), oe = Math.min(be, nowMs);
    if (oe > os) elapsedMs -= (oe - os);
  });
  const expectedStdSec = Math.max(0, elapsedMs) / 1000;
  return { doneStdSec, expectedStdSec, behindSec: expectedStdSec - doneStdSec, anyCt, firstStartMs };
}

export function computeQueuedPositionsFull(cards, { breaks, ctByMat = {}, nowMs: rawNow, frameEndMs = null, roundIndexOf, roundStartOf }) {
  const nowMs = clampNow(rawNow, frameEndMs);
  const filtered = cards.filter(o => o.orderStartMs && o.orderEndMs);
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
  const pace = rowPace(cards, { breaks, ctByMat, nowMs });   // nowMs clamp แล้ว
  const rowBehindPace = pace.doneStdSec < pace.expectedStdSec;

  let queueEndMs = -Infinity;
  /* 🅿️ cursor ที่ 2 = คิว "ตามแผน" — เดินด้วยเวลาทฤษฎีล้วน **ไม่ถูกดันด้วยของค้าง/ปิดช้า**
     มีไว้เพื่อตอบ "ช้ากว่าแผนกี่นาที" = (คาดจบจริง − ควรจบตามแผน) ⇒ ตัวเลขที่หน้างานถามหา
     (บอร์ดที่การ์ดต่อกันไปเรื่อยๆ ทำให้ดูไม่ออกว่าส่วนไหนคือ "หลุดแผน" — เลขนี้ตอบแทนตา) */
  let planEndMs = -Infinity;
  let curRoundIdx = null;
  return sorted.map(o => {
    const roundIdx = roundIndexOf(o.orderStartMs);
    // ห้ามให้ queueEndMs ถอยหลัง — ถ้าการ์ดก่อนหน้ายาวคร่อมเข้ารอบถัดไป (duration ยาวจาก qty×ct)
    // ต้องเดินคิวต่อจากที่มันจบจริง ไม่ใช่กระโดดกลับไปที่จุดเริ่มรอบใหม่ (จะทำให้ทับกัน)
    if (curRoundIdx === null || roundIdx !== curRoundIdx) {
      curRoundIdx = roundIdx;
      queueEndMs = Math.max(queueEndMs, roundStartOf(roundIdx));
      planEndMs = Math.max(planEndMs, roundStartOf(roundIdx));
    }
    const durationMs = Math.max(o.orderEndMs - o.orderStartMs, 0);
    /* คิวตามแผน: เริ่มได้ไม่ก่อนใบก่อนหน้า "ควร" จบ (ไม่นับเวลาที่เสียไปจริง) */
    const planStartMs = Math.max(o.orderStartMs, planEndMs);
    const plannedEndMs = stretchOverBreaks(planStartMs, planStartMs + durationMs, breaks);
    planEndMs = plannedEndMs;
    const startMs = Math.max(o.orderStartMs, queueEndMs);
    let endMs = startMs + durationMs;
    // ถ้าช่วงเวลาผลิตของการ์ดนี้ทับเวลาพักเบรค ไม่เลื่อน startMs ไปหลังเบรค (เพราะจะทำให้
    // เวลาที่ "ว่าง" ก่อนเบรคเสียไปฟรี ๆ) แต่ให้ "ซอย" ทับเบรคแล้วยืดความยาวการ์ดออกแทน
    endMs = stretchOverBreaks(startMs, endMs, breaks);
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
    return { o, startMs, endMs, occupiedEndMs, isDelayed, isLateDone, planStartMs, plannedEndMs };
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
     2. นอกนั้น = 1 ไลน์ 1 เลน เรียงต่อคิวกัน — **รวมงานคู่ RH/LH ด้วย** (04/11 · คำสั่ง user)
        งานคู่ = แม่พิมพ์คู่บนแท่นเดียวกัน ⇒ ต้องกินคิวของแท่นนั้น ไม่ใช่เลนแยก
        (เดิม 2026-07-21 แยกเลนต่อ MAT ⇒ แถบ R/L ตรงกันก็จริง แต่ **งานเดี่ยวที่ตามมาไม่ถูกดันต่อท้ายงานคู่**
         งานคู่ช้า = จอวาดแท่นทำ 2 อย่างพร้อมกัน + ดีเลย์ไม่ส่งต่อ + "ใครพาลใคร" ไม่ชี้งานคู่)
        ⇒ จับคู่ R↔L ใน `pairSlots()` แล้ว **ต่อคิวเฉพาะใบนำ** ใบตามได้ตำแหน่งเดียวกับใบนำ (`isPairFollower`)
        (เคยพัง 2026-07-14: คำนวณคิวแยกต่อ "แถวพาร์ท" → พาร์ทที่สองถูกวาดเริ่ม 08:00 ซ้อนพาร์ทแรก
         ทั้งที่ไลน์ไม่ parallel) */
export function buildLanes(cards = [], { flowByLine = {}, machineCountByLine = {}, pairMatByMat = {} } = {}) {
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
      key = line;                              // งานคู่อยู่เลนเดียวกับไลน์ — จับคู่ทีหลังใน pairSlots()
    }
    (lanes[key] ||= []).push(c);
  });
  return lanes;
}

/* 👯 จับคู่ใบ R↔L ในเลนเดียวกัน ⇒ 1 คู่ = 1 ช่องคิว (แท่นปั๊มครั้งเดียวได้ 2 ข้าง)
   · มี `paired_order_id` = ใช้ตามนั้น · ไม่มี = ไล่ตามลำดับเวลาเปิด (FIFO — ตรงกับที่สแกนผูกคู่)
   · ใบนำ = ใบที่ยังไม่ปิด (ช่องยังไม่ว่าง) › ปิดทีหลัง › ยาวกว่า · ใบที่ไม่มีคู่ = ใบเดี่ยวตามเดิม
   คืน { lead: [ใบที่เข้าคิว], followerOf: Map(ใบตาม → ใบนำ) } */
export function pairSlots(cards = [], pairMatByMat = {}) {
  const followerOf = new Map();
  const byMat = {};
  cards.forEach(c => { (byMat[c.mat_no] ||= []).push(c); });
  const byId = new Map(cards.filter(c => c.id != null).map(c => [c.id, c]));
  const used = new Set();
  const dur = (c) => (c.orderEndMs || 0) - (c.orderStartMs || 0);
  const pickLead = (a, b) => {
    if (!a.isDone !== !b.isDone) return a.isDone ? b : a;
    if (a.isDone && b.isDone) return (Date.parse(b.confirmed_at || 0) || 0) > (Date.parse(a.confirmed_at || 0) || 0) ? b : a;
    return dur(b) > dur(a) ? b : a;
  };
  const link = (a, b) => {
    const lead = pickLead(a, b), fol = lead === a ? b : a;
    followerOf.set(fol, lead); used.add(a); used.add(b);
  };
  // 1) ผูกไว้จริงใน DB
  cards.forEach(c => {
    if (used.has(c) || c.paired_order_id == null) return;
    const p = byId.get(c.paired_order_id);
    if (p && p !== c && !used.has(p) && pairMatByMat[c.mat_no] === p.mat_no) link(c, p);
  });
  // 2) ที่เหลือ ไล่ FIFO ต่อคู่ MAT
  const byStart = (x, y) => (x.orderStartMs || 0) - (y.orderStartMs || 0);
  Object.keys(byMat).forEach(m => {
    const pm = pairMatByMat[m];
    if (!pm || !byMat[pm] || !(m < pm)) return;
    const A = byMat[m].filter(c => !used.has(c)).sort(byStart);
    const B = byMat[pm].filter(c => !used.has(c)).sort(byStart);
    for (let i = 0; i < Math.min(A.length, B.length); i++) link(A[i], B[i]);
  });
  return { lead: cards.filter(c => !followerOf.has(c)), followerOf };
}

/* คิวการ์ดทั้งบอร์ดของ 1 กลุ่มไลน์ — แบ่งเลนแล้วต่อคิวในแต่ละเลน คืน Map(คีย์ใบ → ตำแหน่ง)
   คีย์ใบ = `id ?? prod_no` (ต้องตรงกับที่หน้าใช้ค้น) */
export const orderKeyOf = (o) => o?.id ?? o?.prod_no;

export function positionAllCards(cards = [], opts = {}) {
  const { flowByLine, machineCountByLine, pairMatByMat, ...queueOpts } = opts;
  const out = new Map();
  /* ติด `laneKey`/`laneSeq` ไว้ด้วย — จำเป็นต่อการไล่ "ใครถีบใคร" (`pushChainOf`)
     เพราะการถีบเกิดได้เฉพาะภายในเลนเดียวกัน (1 เลน = 1 เครื่องจริง ทำได้ทีละใบ) */
  Object.entries(buildLanes(cards, { flowByLine, machineCountByLine, pairMatByMat })).forEach(([laneKey, laneCards]) => {
    const { lead, followerOf } = pairSlots(laneCards, pairMatByMat || {});
    const posOfLead = new Map();
    computeQueuedPositionsFull(lead, queueOpts).forEach((item, laneSeq) => {
      const it = { ...item, laneKey, laneSeq };
      posOfLead.set(item.o, it);
      out.set(orderKeyOf(item.o), it);
    });
    /* ใบตามของงานคู่ = ช่องเดียวกับใบนำ (เวลาเริ่ม/จบ/ดีเลย์เดียวกัน) · ไม่เข้า pushChainOf ซ้ำ */
    followerOf.forEach((leadCard, fol) => {
      const lp = posOfLead.get(leadCard);
      if (lp) out.set(orderKeyOf(fol), { ...lp, o: fol, isPairFollower: true, pairLeadKey: orderKeyOf(leadCard) });
    });
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

/* ══ 📋 "หลุดแผนไปแค่ไหน" — ตัวเลขชุดเดียวที่ทุกบอร์ดใช้ (2026-09-30 · feedback หน้างาน) ═══════
   คอมเมนต์ที่ได้มา: *"ไม่รู้ว่าดีเลย์หรือหลุดแผนไปแค่ไหน เพราะการ์ดใหม่จะต่อไปเรื่อยๆ"*
   ⇒ บอร์ดที่การ์ดต่อกันไปทางขวาเรื่อยๆ **ตาแยกไม่ออก**ว่าส่วนไหน "ค้าง" ส่วนไหน "ยังไม่ถึงตา"
     และ "⚠️ ดีเลย์ N ใบ" ก็ไม่บอกขนาด (ค้าง 1 ใบ 3 ชม. กับ 3 ใบ 5 นาที ขึ้นเลขไม่ต่างกันเลย)
   ⇒ ต้องตอบเป็น **เวลา + ยอด** (คำสั่ง user 2026-09-30: "เอาทั้งสอง เวลา+ยอด ในแถบเดียว")

   🔴 กฎของตัวเลขชุดนี้:
     · **ช้ากว่าแผน = คาดจบจริง − ควรจบตามแผน** (cursor 2 เส้นในคิวเดียว) ไม่ใช่ "now − เวลาเปิด"
     · **ขาดกี่ชิ้น คิดจาก pace เดียวกับที่ใช้ตีสีใบ** (`rowPace`) ห้ามคิดสูตรที่ 2
     · **ไม่มี CT = ประเมินไม่ได้ ⇒ null ทุกตัวที่เกี่ยวกับเวลา/ชิ้น ห้ามคืน 0** (จอต้องเขียนว่าไม่รู้)
     · **หลายพาร์ท CT ไม่เท่ากัน = บอกเป็นชิ้นไม่ได้ ⇒ `behindPcs: null`** (บอกเป็นนาทีแทน)
     · `overShiftMin`/`lateCards` ต้องส่ง `shiftEndMs` เข้ามา — ไม่ส่ง = null (ไม่เดาปลายกะแทนหน้า)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
export function planStatusOf({ positioned, cards = [], breaks = [], ctByMat = {}, nowMs, frameEndMs = null, shiftEndMs = null } = {}) {
  const items = [];
  if (positioned && typeof positioned.forEach === 'function') positioned.forEach(it => items.push(it));

  const open = items.filter(it => it?.o && !it.o.isDone && !it.o.isCarry);
  const finishMs = projectedFinishMs(items);
  let planFinishMs = null;
  open.forEach(it => {
    const e = it.plannedEndMs;
    if (e > 0 && (planFinishMs == null || e > planFinishMs)) planFinishMs = e;
  });

  const slipMin = (finishMs != null && planFinishMs != null)
    ? Math.max(0, Math.round((finishMs - planFinishMs) / 60000)) : null;

  /* จังหวะงาน (pace) — ช้ากว่าที่ควรได้กี่นาที/กี่ชิ้น */
  const pace = rowPace(cards, { breaks, ctByMat, nowMs, frameEndMs });
  const behindMin = pace.behindSec == null ? null : Math.round(Math.max(0, pace.behindSec) / 60);
  /* แปลงเป็น "ชิ้น" ได้เฉพาะเมื่อพาร์ทที่ยังมีงานเหลืออยู่ CT เท่ากันหมด (ไม่งั้นเป็นการเดา) */
  const ctsLeft = [...new Set(open.map(it => ctByMat[it.o.mat_no] || 0).filter(v => v > 0))];
  const behindPcs = (pace.behindSec != null && ctsLeft.length === 1 && pace.behindSec > 0)
    ? Math.round(pace.behindSec / ctsLeft[0]) : null;

  const overShiftMin = (shiftEndMs && finishMs != null)
    ? Math.max(0, Math.round((finishMs - shiftEndMs) / 60000)) : null;
  const lateCards = shiftEndMs
    ? open.filter(it => Math.max(it.endMs || 0, it.occupiedEndMs || 0) > shiftEndMs).length : null;

  /* 🔴 ดูวันย้อนหลังที่มีใบเปิดค้าง = ความจริงคือ "ใบนี้ไม่เคยถูกปิด" ไม่ใช่ "ช้ากว่าแผน N ชม."
     (วัดกับข้อมูลจริง 2026-09-30 · วันงาน 25/09: LINE A เหลือ 14 ใบไม่เคยปิด ⇒ slipMin = 1249 น.
      จอจะขึ้น "ช้ากว่าแผน 20:49 ชม." ซึ่งคนหน้างานอ่านแล้วตีว่าจอพัง — เพดาน "ค้างข้ามวัน" ที่
      1440 น. ไม่ครอบเคสนี้) ⇒ ส่งธงให้จอเปลี่ยนคำ **ห้ามซ่อนเลข ห้ามดัดเลข** */
  const dayOver = isDayOver(frameEndMs, nowMs);
  return {
    delayed: items.filter(it => it.isDelayed).length,
    remainCards: open.length,
    finishMs, planFinishMs, slipMin,
    behindMin, behindPcs, pcsCt: ctsLeft.length === 1 ? ctsLeft[0] : null,
    overShiftMin, lateCards,
    noCt: !pace.anyCt,
    dayOver, neverClosed: dayOver ? open.length : 0,
  };
}

/* ══ 🔗 "หลุดมาจากตัวไหน พาลไปโดนตัวไหน" — สายการถีบของคิว (2026-09-30 · ทีมปั๊ม) ═══════════
   คำขอ: *"งานดีเลย์ มันก็จะถีบออกไปเรื่อยๆ ... อยากเห็นว่ามันหลุดมาจากตัวไหน พาลไปโดนตัวไหนบ้าง"*

   🔴🔴 กับดักที่ต้องระวังที่สุด — **"ใบเริ่มช้ากว่าเวลาเปิด" ≠ "ใบถูกดีเลย์ถีบ"**
   หน้างานสแกนเปิดใบรวดเดียวทั้งล็อตตอนต้นกะ ⇒ `orderStartMs` ของ **ทุกใบ** ≈ 08:00 เท่ากันหมด
   ⇒ ใบที่ 2-10 จึง "เริ่มช้ากว่าเวลาเปิด" เป็นชั่วโมงๆ **ทั้งที่งานเดินปกติดีทุกอย่าง** (นั่นคือการเข้าคิว
     ตามธรรมชาติ ไม่ใช่ความเสียหาย) — ถ้านับแบบนั้นจอจะโทษทุกใบในกะ แล้วเลขจะไร้ความหมายทันที
   ⇒ **กฎ: นับเป็น "ถูกพาล" เฉพาะใบที่ต่อท้าย "ต้นเหตุ" ที่ตัวมันเองช้าจริง** (`isDelayed`/`isLateDone`)
     และโทษได้ไม่เกินเวลาที่ต้นเหตุกินเกินไปจริง (`min(ถูกดันกี่นาที, ต้นเหตุกินเกินกี่นาที)`)

   ต้นเหตุ (root) = ใบที่ **กินเวลาเกินกรอบของตัวเอง** — `occupiedEndMs − endMs`
     · ยังไม่ปิด+เลยกำหนด ⇒ ยังกินอยู่ (ถึงตอนนี้) · ปิดช้า ⇒ กินไปถึง `confirmed_at`
   ผู้ถูกพาล (victims) = ใบที่อยู่**หลังต้นเหตุในเลนเดียวกัน** และถูกเลื่อนเริ่มออกไปจริง (ติดกันเป็นสาย)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
const PUSH_MIN_MS = 2 * 60000;          // เลื่อนไม่ถึง 2 นาที = เศษเวลา ไม่นับว่าถูกถีบ

export function pushChainOf(positioned) {
  const items = [];
  if (positioned && typeof positioned.forEach === 'function') positioned.forEach(it => items.push(it));

  /* จัดเป็นเลน แล้วเรียงตามลำดับที่คิวจัดไว้จริง */
  const lanes = new Map();
  items.forEach(it => {
    if (it.isPairFollower) return;             // งานคู่: ใบตามกินช่องเดียวกับใบนำ ห้ามนับซ้ำเป็นต้นเหตุ/ผู้ถูกพาล
    const k = it.laneKey ?? it.o?.line_name ?? '';
    (lanes.get(k) || lanes.set(k, []).get(k)).push(it);
  });
  const chains = [];
  lanes.forEach(lane => {
    lane.sort((a, b) => (a.startMs - b.startMs) || ((a.laneSeq ?? 0) - (b.laneSeq ?? 0)));
    lane.forEach((it, i) => {
      const ownLateMs = Math.max(0, (it.occupiedEndMs || 0) - (it.endMs || 0));
      if (ownLateMs < PUSH_MIN_MS) return;                       // ไม่ได้กินเกิน = ไม่ใช่ต้นเหตุ
      if (!(it.isDelayed || it.isLateDone)) return;               // กินเกินแต่ระบบไม่ถือว่าช้า (backfill ฯลฯ)
      const victims = [];
      for (let j = i + 1; j < lane.length; j++) {
        const v = lane[j];
        const pushedMs = (v.startMs || 0) - (v.o?.orderStartMs || 0);
        if (pushedMs < PUSH_MIN_MS) break;                        // สายขาด — ใบนี้เริ่มได้ตามเวลาของมัน
        victims.push({
          key: orderKeyOf(v.o), o: v.o,
          pushedMin: Math.round(pushedMs / 60000),
          /* โทษได้ไม่เกินเวลาที่ต้นเหตุกินเกินจริง — ส่วนที่เหลือคือการเข้าคิวปกติ ไม่ใช่ความเสียหาย */
          blameMin: Math.round(Math.min(pushedMs, ownLateMs) / 60000),
        });
      }
      chains.push({
        rootKey: orderKeyOf(it.o), root: it.o, laneKey: it.laneKey ?? null,
        ownLateMin: Math.round(ownLateMs / 60000),
        victims, victimCount: victims.length,
        /* ความเสียหายรวมที่ใบนี้ก่อ = Σ นาทีที่โทษได้ของผู้ถูกพาลทุกใบ (ตัวจัดอันดับตัวจริง) */
        blameTotalMin: victims.reduce((a, v) => a + v.blameMin, 0),
        /* 🔴 ใบที่ยังไม่ถูกปิด: `ownLateMin` = "ถึงตอนที่เลิกนับ" ไม่ใช่เวลาที่กินไปจริง
           (ยังไม่ปิด = ไม่มีใครรู้ว่าจบเมื่อไหร่ · ดูวันย้อนหลังจะถูก clamp ที่ปลายวัน ⇒ เห็น
            "กินเวลาเกิน 1 วัน 7 ชม." ซึ่งจริงๆ แปลว่า "ไม่เคยถูกปิด") ⇒ จอต้องเขียน `≥` กำกับ
           **ห้ามรายงานเป็นเวลาปิดจริง** (เจอจาก screenshot harness 2026-09-30) */
        rootUnclosed: !it.o?.isDone,
      });
    });
  });
  /* 🔴🔴 เรียงตาม "ก่อความเสียหายให้ใบอื่นเท่าไหร่" ก่อน **ห้ามเรียงด้วย ownLateMin ล้วน**
     (วัดกับข้อมูลจริง 2026-09-30 · วันงาน 25/09 ทั้งโรงงาน: chain ที่พาลคนอื่นจริง 27 ตัว
      **ถูกบังไม่ขึ้นจอ 22 ตัว** เพราะใบที่ "กินเกินเยอะแต่ไม่พาลใคร" ชนะการเรียงทุกครั้ง —
      ใบ manual/ใบที่เปิดคลุมทั้งกะกินเกิน 270–806 น. โดยไม่มีใบต่อท้ายเลย · ไลน์ GOR มีตัวจริง
      4 ตัว ขึ้นจอ 0 ตัว) ⇒ จอตอบคำถาม "พาลไปโดนตัวไหนบ้าง" ไม่ได้เลยทั้งที่คำนวณถูก
     ลำดับ: (1) มีผู้ถูกพาล ชนะ ไม่มี (2) ความเสียหายรวมมากกว่า ชนะ (3) กินเกินนานกว่า ชนะ */
  return chains.sort((a, b) =>
    (b.victimCount > 0 ? 1 : 0) - (a.victimCount > 0 ? 1 : 0)
    || b.blameTotalMin - a.blameTotalMin
    || b.ownLateMin - a.ownLateMin);
}

/* ══ 📆 สรุป "วันนี้" — ดีเลย์ไปกี่งาน / ต้องยกยอดกี่ใบ (2026-09-30 · ทีมปั๊ม) ══════════════
   🔴 **คนละคำถามกับ `delayedCountOf`** ซึ่งตอบ "ตอนนี้ค้างกี่ใบ" (หลังคิวถูกดัน เหลือใบเดียวต่อเลน)
      อันนี้ตอบ "วันนี้มีงานหลุดกรอบเวลาไปกี่งาน" = รวมใบที่**ปิดไปแล้วแต่ปิดช้า** ด้วย
      (ใบที่ช้าแล้วปิดได้ ไม่ควรหายไปจากสรุปวัน — มันคือเหตุที่ทำให้ใบอื่นถูกพาล)
   · `willCarry` = ใบที่คิวดันไปจบ **เลยกรอบวันงาน** ⇒ ของจริงคือต้องยกยอดไปวันถัดไป
   · `carriedIn` = ใบที่ยกยอด**มา**จากกะ/วันก่อน (`carry_over_from_session_id`) — บอกว่าหนี้เก่ามีเท่าไหร่ */
export function dayDelaySummaryOf(positioned, { frameEndMs = null, nowMs = null } = {}) {
  const items = [];
  if (positioned && typeof positioned.forEach === 'function') positioned.forEach(it => items.push(it));
  const lateDone  = items.filter(it => it.isLateDone).length;
  const stillLate = items.filter(it => it.isDelayed).length;
  const openItems = items.filter(it => it.o && !it.o.isDone && !it.o.isCarry);
  /* 🔴 วันงานจบไปแล้ว (ดูย้อนหลัง) = คำถามเปลี่ยน: ไม่ใช่ "จะล้นไหม" แต่เป็น "ปิดไม่ได้กี่ใบ"
     ⇒ ใบที่ยังเปิดค้างอยู่ทุกใบ = ไม่จบในวันงานนั้น (ของจริงคือถูกยกยอด)
     ถ้าใช้สูตร "คาดจบ > ปลายวัน" กับวันที่จบแล้ว จะนับต่ำกว่าจริง เพราะเวลาถูก clamp ไว้ที่ปลายวันพอดี
     ⇒ เคยทำให้ **จอเดียวกันขึ้น 2 เลขขัดกัน** (ชิป PLANNER "งานไม่จบในกะ 2 ใบ" vs สรุปวัน "1 ใบ") */
  const dayOver = isDayOver(frameEndMs, nowMs);
  const willCarry = !frameEndMs ? null
    : dayOver ? openItems.length
    : openItems.filter(it => Math.max(it.endMs || 0, it.occupiedEndMs || 0) > frameEndMs).length;
  const carriedIn = items.filter(it => it.o?.carry_over_from_session_id).length;
  return {
    lateJobs: lateDone + stillLate,      // "วันนี้ดีเลย์ไปกี่งาน"
    lateDone, stillLate, willCarry, carriedIn, dayOver,
    totalJobs: items.length,
  };
}

/* ═══ 🖼️ กรอบ "คิวตามอุดมคติ" ของใบ — พิกัดบนราง (2026-11-13) ═══════════════════════
 *
 * 🔴 **ชื่อ "กรอบแผน" บนจอหมายถึงของ 2 อย่าง — ตัวนี้คือตัวที่ระบบคิดเอง ไม่ใช่แผนของแพลนนิ่ง**
 *   · แผนของแพลนนิ่ง = `production_plan_lots` → วาดที่แถว `<PlanFrameRow>` (เส้นประ**ม่วง**)
 *   · ตัวนี้ = `planStartMs`/`plannedEndMs` จาก `computeQueuedPositionsFull` =
 *     "ถ้าไล่ใบที่**เปิดไว้แล้ว**ชนกันรวดเดียวไม่มีสะดุด ใบนี้ควรตกช่วงไหน"
 *     ⇒ **ไม่มีข้อมูลใหม่** นอกจากใบที่ถูกเปิดไปแล้ว · ตอบ "ช้ากว่าที่ควรกี่นาที" ได้
 *       ตอบ "ต้องผลิตอีกเท่าไหร่" **ไม่ได้**
 *
 * เดิมสูตรนี้ถูกก๊อปไว้ 2 หน้า (`Management.jsx` · `Dashboard.jsx`) แล้ว**สีเพี้ยนกัน** —
 * Management ฮาร์ดโค้ด `#e5e7eb` (= สีตัวหนังสือของธีม**มืด**) ⇒ บนจอธีมสว่างที่หน้างานใช้
 * กรอบของใบที่ **หลุดแผน** แทบมองไม่เห็น ส่วนใบที่ตรงแผน (เทา) กลับเห็นชัด = **กลับหัวกัน**
 * ⇒ ย้ายมาที่เดียว + วาดด้วย `<PlanSlipFrame>` ตัวเดียว (มีด่าน `plan-slip-frame-single-entry`)
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** เผื่อให้ ±2 นาที ถึงจะนับว่า "หลุดกรอบ" (กันเศษวินาทีจากการปัดเวลา) */
export const PLAN_SLIP_TOLERANCE_MS = 2 * 60000;

/**
 * พิกัดกรอบคิวตามอุดมคติของใบนี้บนราง
 * @param item   หนึ่งรายการจาก `computeQueuedPositionsFull`
 * @param hs     เวลาเริ่มราง (ms)
 * @param pctPerMs  % ต่อ 1 ms ของราง
 * @returns {{planLeftPct:number, planWidthPct:number, planSlipped:boolean}}
 *          `planWidthPct = 0` = ไม่มีอะไรให้วาด (ไม่รู้กรอบ หรือกรอบอยู่นอกราง)
 */
export function planFramePct(item, hs, pctPerMs) {
  const none = { planLeftPct: 0, planWidthPct: 0, planSlipped: false };
  if (!item || item.planStartMs == null || item.plannedEndMs == null) return none;
  const pl = Math.max(0, Math.min(100, (item.planStartMs - hs) * pctPerMs));
  const pr = Math.max(0, Math.min(100, (item.plannedEndMs - hs) * pctPerMs));
  /* หลุดกรอบ = เริ่มช้ากว่าที่ควร **หรือ** กินรางยาวกว่าที่ควร (ครองไลน์ถึง occupiedEndMs) */
  const planSlipped = (item.startMs - item.planStartMs) > PLAN_SLIP_TOLERANCE_MS
    || (Math.max(item.endMs, item.occupiedEndMs) - item.plannedEndMs) > PLAN_SLIP_TOLERANCE_MS;
  return pr > pl
    ? { planLeftPct: pl, planWidthPct: pr - pl, planSlipped }
    : { ...none, planSlipped };
}
