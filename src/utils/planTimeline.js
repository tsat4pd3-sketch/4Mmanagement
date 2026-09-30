/* ══ 🧲 ไทม์ไลน์จัดแผน — คำนวณ "ความยาวกล่อง" ของแต่ละล็อต (2026-09-30 · คำสั่ง user) ══════
   *"อยากได้แบบ UX/UI สามารถ interactive กับผู้วางแผนได้ ... พอเลือก order แล้วระบบคำนวณ
     ความยาวของ box order และ user ลาก จัดแผน เข้าไทม์ไลน์ สลับก่อนหลัง"*

   กล่อง 1 ใบ = 1 ล็อต · **ความยาว = เวลาที่ต้องใช้จริง** (qty × CT + เวลาเปลี่ยนรุ่นก่อนหน้า)
   เรียงต่อกันไปตามลำดับคิว — 1 ไลน์ทำได้ทีละใบ ⇒ **ตำแหน่งกล่องถูกคำนวณ ไม่ใช่ลากไปวางตรงไหนก็ได้**
   (ลากอิสระ = เปิดช่องว่างกลางกะโดยไม่มีเหตุผล แล้วแผนจะโกหกว่าจบเร็วกว่าจริง)
   ⇒ **ลาก = เปลี่ยน "ลำดับ"** ระบบคำนวณเวลาให้ใหม่ทุกครั้ง

   🔴 กติกาความซื่อสัตย์:
     · **ไม่มี CT = คำนวณความยาวไม่ได้** ⇒ กล่องยังต้องอยู่บนจอ (ลายทแยง + ป้ายบอก) **ห้ามซ่อน
       ห้ามให้ยาว 0 เงียบๆ** · และทุกกล่องหลังจากนั้น **เวลาเชื่อไม่ได้** (`afterUnknown`)
     · **เวลาเปลี่ยนรุ่นไม่รู้ = ช่องว่างลายจุด + ธง** ห้ามตีเป็น 0 (กฎเหล็ก pressSetup)
     · **ยืดข้ามเบรคด้วย `stretchOverBreaks` ของบอร์ดจริง** — ห้ามเขียนสูตรยืดเอง
       ไม่งั้นกล่องบนจอวางแผนยาวไม่เท่าแท่งบนบอร์ดไทม์ไลน์ แล้ว 2 จอเถียงกัน
     · **งานคู่ RH/LH ที่วางติดกัน = ปั๊มจังหวะเดียว** ⇒ ใบหลังกินเวลาเพิ่มแค่ส่วนที่เกิน
       (`max(0, runB − runA)`) ตามกฎ "ชิ้น ≠ shot" เดียวกับ `pairLoadTotal`
     · **ล้นปลายกะ ต้องเห็น** — ไม่ตัดกล่องทิ้ง ไม่บีบให้พอดี (`overflowMin`)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { stretchOverBreaks } from './heijunkaQueue.js';
import { setupMinutes } from './pressSetup.js';
import { lotRunMin, sortBySeq, ACTIVE_LOT } from './planLots.js';

/* กล่องที่คำนวณความยาวไม่ได้ ต้องกว้างพอให้คนกดถูก (px ขั้นต่ำแปลงเป็น % ที่ชั้นจอ) */
export const UNKNOWN_BOX_MIN_PCT = 4;

/* 🔴 ช่อง "นามธรรม" ของกล่องที่คำนวณเวลาไม่ได้ — **ไม่ใช่เวลาจริง** (2026-09-30 · เจอจากจอทดสอบ)
   ถ้าไม่เลื่อน cursor เลย กล่องที่ไม่มี CT **ทุกใบจะทับกันที่จุดเดียว** (วัดจริงใน harness:
   14 ใบซ้อนกันหมด อ่านไม่ออก กดไม่ได้ ลากไม่ได้) ⇒ แย่กว่าการยอมให้ตำแหน่งไม่ตรงเวลา
   ปลอดภัยเพราะทุกกล่องหลังจากนั้นติดธง `afterUnknown` และ `overflowMin` คืน `null` อยู่แล้ว
   ⇒ จอ**ต้อง**วาดลายทแยง + เขียนว่าเวลาหลังจากนี้เชื่อไม่ได้ (ห้ามวาดเหมือนกล่องปกติ) */
export const UNKNOWN_SLOT_MIN = 30;

/**
 * วางล็อตทั้งคิวลงบนกรอบเวลาของกะ
 * @returns {{ boxes, endMs, overflowMin, unknownCount, setupUnknownCount }}
 */
export function layoutLots({
  lots = [], ctOf = () => null, pairOf = () => null, dieOf = () => null, rule = null,
  startMs, endMs, breaks = [],
} = {}) {
  const active = sortBySeq(lots.filter(ACTIVE_LOT));
  const span = (endMs || 0) - (startMs || 0);
  const boxes = [];
  let cursor = startMs;
  let afterUnknown = false;          // มีกล่องที่คำนวณเวลาไม่ได้มาก่อน ⇒ เวลาหลังจากนี้เชื่อไม่ได้
  let unknownCount = 0, setupUnknownCount = 0;
  let prevLot = null;

  active.forEach((lot, i) => {
    /* ── ① เวลาเปลี่ยนรุ่นก่อนเริ่มล็อตนี้ ── */
    const fromDie = prevLot ? dieOf(prevLot) : null;
    const toDie = dieOf(lot);
    const su = setupMinutes({ fromDie, toDie, rule });
    const setupKnown = su.min != null;
    if (!setupKnown && i > 0) setupUnknownCount++;
    const setupMs = (su.min || 0) * 60000;
    const setupStart = cursor;
    cursor += setupMs;

    /* ── ② เวลาผลิตของล็อต ── */
    let runMin = lotRunMin(lot, ctOf);
    /* 👯 คู่ RH/LH ที่วางติดกัน = ปั๊มจังหวะเดียวกัน ⇒ ใบหลังกินเพิ่มแค่ส่วนที่เกิน */
    const pairedWithPrev = !!(prevLot && pairOf(lot.mat_no) && pairOf(lot.mat_no) === prevLot.mat_no);
    if (pairedWithPrev && runMin != null) {
      const prevRun = lotRunMin(prevLot, ctOf);
      runMin = prevRun == null ? runMin : Math.max(0, runMin - prevRun);
    }
    const noCt = runMin == null;
    if (noCt) unknownCount++;

    const boxStart = cursor;
    const boxEnd = noCt
      ? boxStart + UNKNOWN_SLOT_MIN * 60000          // ช่องนามธรรม กันกล่องทับกัน (ดูหมายเหตุที่ค่าคงที่)
      : stretchOverBreaks(boxStart, boxStart + runMin * 60000, breaks);
    cursor = boxEnd;
    /* 🔴 คำนวณไม่ได้แม้แต่กล่องเดียว = เวลาของ**ทุกกล่องถัดไป**เชื่อไม่ได้ ต้องติดธงต่อกันไป */
    if (noCt) afterUnknown = true;

    boxes.push({
      lot, seq: i + 1,
      setupStartMs: setupStart, setupMs, setupKnown, setupState: su.state,
      startMs: boxStart, endMs: boxEnd,
      runMin: noCt ? null : runMin,
      noCt, pairedWithPrev, afterUnknown,
      /* พิกัดบนราง (%) — กล่องที่คำนวณไม่ได้ให้ชั้นจอใส่ความกว้างขั้นต่ำเอง */
      leftPct: span > 0 ? ((boxStart - startMs) / span) * 100 : 0,
      /* 🔴 `widthPct: null` = "ความยาวนี้ไม่ได้สเกลกับเวลา" — จอต้องวาดต่างจากกล่องปกติ
         (`nominalPct` คือความกว้างของช่องนามธรรมไว้ให้จอใช้วางไม่ให้ทับกัน) */
      widthPct: span > 0 && !noCt ? ((boxEnd - boxStart) / span) * 100 : null,
      nominalPct: span > 0 ? ((boxEnd - boxStart) / span) * 100 : 0,
      setupLeftPct: span > 0 ? ((setupStart - startMs) / span) * 100 : 0,
      setupWidthPct: span > 0 && setupMs > 0 ? (setupMs / span) * 100 : 0,
    });
    prevLot = lot;
  });

  return {
    boxes,
    endMs: cursor,
    /* ล้นปลายกะกี่นาที — `null` เมื่อมีกล่องที่คำนวณไม่ได้ (ตอบไม่ได้ ห้ามบอก 0) */
    overflowMin: unknownCount > 0 ? null : Math.max(0, Math.round((cursor - endMs) / 60000)),
    unknownCount, setupUnknownCount,
  };
}

/* ── 🧲 ลากสลับลำดับ — ย้ายล็อต `dragId` ไปอยู่ตำแหน่งที่ `toIndex` (0-based) ──────────
   คืนลิสต์ใหม่ที่ `seq` ต่อเนื่องแล้ว · ไม่แตะของเดิม (immutable)
   ⚠️ `toIndex` คือตำแหน่งใน**ลิสต์ที่เอาตัวลากออกแล้ว** (semantics ของ insertion point) */
export function reorderTo(lots = [], dragId, toIndex) {
  const arr = sortBySeq(lots.filter(ACTIVE_LOT));
  const rest = lots.filter(l => !ACTIVE_LOT(l));
  const from = arr.findIndex(l => l.id === dragId);
  if (from < 0) return lots;
  const moved = arr[from];
  const without = arr.filter((_, i) => i !== from);
  const at = Math.max(0, Math.min(without.length, toIndex));
  const next = [...without.slice(0, at), moved, ...without.slice(at)];
  return [...next.map((l, i) => ({ ...l, seq: i + 1 })), ...rest];
}

/* ── ป้ายเวลาบนหัวราง (ทุก N ชั่วโมง) ─────────────────────────────────────────────
   คืน [{ ms, pct, label }] · ใช้เวลาไทยจากตัว Date โดยตรง (กรอบกะประกอบมาจากฝั่งหน้าแล้ว) */
export function hourTicks(startMs, endMs, everyHours = 1) {
  const out = [];
  if (!startMs || !endMs || endMs <= startMs) return out;
  const span = endMs - startMs;
  const step = everyHours * 3600000;
  const first = Math.ceil(startMs / step) * step;
  for (let ms = first; ms <= endMs; ms += step) {
    const d = new Date(ms);
    out.push({ ms, pct: ((ms - startMs) / span) * 100, label: `${String(d.getHours()).padStart(2, '0')}:00` });
  }
  return out;
}
