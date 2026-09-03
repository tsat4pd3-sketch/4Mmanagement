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
    // เดินคิวต้องไม่ขยับมาก่อน endMs ของการ์ดนี้เด็ดขาด (ไม่งั้นใบถัดไปจะมาทับกล่องที่แสดงอยู่)
    queueEndMs = isLateDone ? occupiedEndMs : endMs;
    // ⚠️ `!o.is_backfill` — ใบเปิดย้อนหลังคนกรอกเวลาเอง เวลาเปิดไม่ใช่เวลาเริ่มผลิตจริง
    //    ตัดสิน "ดีเลย์" จากมันไม่ได้ (จุดที่ Dashboard เคยตกไป ทำให้ 2 จอไม่ตรงกัน)
    const isDelayed = !o.isDone && !o.isCarry && !o.is_backfill && endMs < nowMs && rowBehindPace;
    return { o, startMs, endMs, occupiedEndMs, isDelayed, isLateDone };
  }).map((item, i, arr) => {
    // ใบที่ยังไม่ปิด+เลยกำหนด หางสีแดงจะยืดไปถึง "ตอนนี้" เสมอ — แต่ถ้าใบถัดไปเริ่มทำงานไปแล้ว
    // ต้องตัดหางแดงให้สุดแค่จุดที่ใบถัดไปเริ่ม ไม่ให้ยืดไปทับใบถัดไป
    if (item.isDelayed && arr[i + 1]) {
      return { ...item, occupiedEndMs: Math.min(item.occupiedEndMs, arr[i + 1].startMs) };
    }
    return item;
  });
}
