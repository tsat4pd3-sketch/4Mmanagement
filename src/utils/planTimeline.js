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
     · 🔗 **คิวไหลข้ามกะ/ข้ามวัน** (30/09 · คำสั่ง user *"เกินกะก็ต้องล้นไปกะดึก เกิน 1 วันก็ล้นไปอีกวัน"*)
       เครื่องที่เดินอยู่ตอน 20:00 ไม่ได้หยุด — เปลี่ยนแค่คนคุม ⇒ กรอบไม่ใช่ "กะเดียว" อีกต่อไป
       ขอบเขตมาจาก `buildHorizon()` (`utils/planHorizon.js`) · **วันที่โรงงานไม่เดิน = `closed`**
       ซึ่งกินเวลาแบบเดียวกับเวลาพัก (หยุดนับ ไม่ใช่วางงานทับ)
     · 🔴 **พิกัดผ่าน `scale` เมื่อมีวันถูกข้าม** — หาร `(ms-start)/span` ตรงๆ จะเพี้ยน
       เพราะแกน X เป็น "เวลาที่โรงงานเดินจริง" ไม่ใช่เวลานาฬิกา (ดู `makeScale`)
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

/* 🔴 ช่องนามธรรมต้องกว้าง **อย่างน้อยเท่าความกว้างขั้นต่ำที่จอใช้วาด** ไม่งั้นกล่องทับกัน
   (เจอจาก planlab 30/09 ตอนรางยาวขึ้นเป็นหลายกะ: 30 นาทีบนราง 12 ชม. = 4.17% พอดี แต่บนราง
    24 ชม. เหลือ 2.08% < ขั้นต่ำ 4% ⇒ จอถ่างกล่องให้กว้างขึ้นแต่ cursor เดินเท่าเดิม
    = ป้ายของ 2 ใบพิมพ์ทับกันจนอ่านไม่ออก · คลาสบั๊กเดียวกับ "14 ใบซ้อนกัน" ที่แก้ไปแล้ว)
   ⇒ คิดช่องนามธรรมเป็นสัดส่วนของรางเสมอ · เวลานี้ยัง**ไม่ใช่เวลาจริง** เหมือนเดิม
     (ทุกใบหลังจากนี้ติดธง `afterUnknown` · `overflowMin` = null · จอเขียน "คิวจบ —" อยู่แล้ว) */
const unknownSlotMs = (spanMs) =>
  Math.max(UNKNOWN_SLOT_MIN * 60000, (spanMs || 0) * (UNKNOWN_BOX_MIN_PCT / 100));

/* ⏭️ เวลาที่ "เปิดทำงาน" ถัดไป — ถ้า ms ตกอยู่กลางช่วงปิด (พัก/วันหยุดที่ข้าม) ให้ขยับไปที่ปลายช่วงนั้น
   🔴 ต้องมี ไม่งั้นกล่องจะถูกวาด**เริ่มกลางวันหยุด** (เวลาจบยังถูก เพราะ stretchOverBreaks ยืดให้แล้ว
      แต่ตำแหน่งบนจอโกหกว่าเริ่มทำตอนโรงงานปิด) · ปลอดภัยกับการยืด เพราะ `stretchOverBreaks`
      ใช้เงื่อนไข `be > startMs` แบบ strict ⇒ ช่วงที่ขยับพ้นมาแล้วจะไม่ถูกบวกซ้ำ */
export function nextOpenMs(ms, closed = []) {
  let out = ms, moved = true, guard = 0;
  while (moved && guard++ < 50) {
    moved = false;
    for (const [cs, ce] of closed) {
      if (out >= cs && out < ce) { out = ce; moved = true; }
    }
  }
  return out;
}

/**
 * วางล็อตทั้งคิวลงบนกรอบเวลา (กะเดียว หรือหลายกะต่อกันจาก `buildHorizon`)
 * @param {Array}    o.breaks   ช่วงพักตามนโยบาย
 * @param {Array}    o.closed   ช่วงที่โรงงานไม่เดินเลย (วันหยุดที่ขอบเขตข้ามไป) — กินเวลาเหมือนพัก
 * @param {object}   o.scale    `makeScale(segments)` — ใส่เมื่อมีวันถูกข้าม (แกน X ≠ เวลานาฬิกา)
 * @returns {{ boxes, endMs, overflowMin, unknownCount, setupUnknownCount }}
 */
export function layoutLots({
  lots = [], ctOf = () => null, pairOf = () => null, dieOf = () => null, rule = null,
  startMs, endMs, breaks = [], closed = [], scale = null,
} = {}) {
  const active = sortBySeq(lots.filter(ACTIVE_LOT));
  const span = (endMs || 0) - (startMs || 0);
  /* หยุดเดินเครื่องเพราะอะไรก็ตาม (พัก + วันหยุดที่ข้าม) = เวลาหยุดนับเหมือนกัน */
  const stops = closed.length ? [...breaks, ...closed] : breaks;
  /* พิกัด: มีสเกล piecewise ใช้สเกล · ไม่มี = เชิงเส้นบนกรอบเดียวเหมือนเดิม (พฤติกรรมเดิมเป๊ะ) */
  const pctOf = scale ? ((ms) => scale.pctOf(ms)) : ((ms) => (span > 0 ? ((ms - startMs) / span) * 100 : 0));
  /* ความยาวราง = เวลาที่โรงงานเดินจริง (มีสเกล) หรือกรอบเดียว (ไม่มี) */
  const slotMs = unknownSlotMs(scale ? scale.totalMs : span);
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
    /* ⏭️ ไม่เริ่มงานกลางวันหยุด/กลางเวลาพัก — ขยับไปที่เวลาเปิดถัดไปก่อนเสมอ */
    const setupStart = nextOpenMs(cursor, stops);
    cursor = setupStart + setupMs;

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

    const boxStart = nextOpenMs(cursor, stops);
    const boxEnd = noCt
      ? boxStart + slotMs                            // ช่องนามธรรม กันกล่องทับกัน (ดูหมายเหตุที่ค่าคงที่)
      : stretchOverBreaks(boxStart, boxStart + runMin * 60000, stops);
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
      leftPct: pctOf(boxStart),
      /* 🔴 `widthPct: null` = "ความยาวนี้ไม่ได้สเกลกับเวลา" — จอต้องวาดต่างจากกล่องปกติ
         (`nominalPct` คือความกว้างของช่องนามธรรมไว้ให้จอใช้วางไม่ให้ทับกัน) */
      widthPct: !noCt ? pctOf(boxEnd) - pctOf(boxStart) : null,
      nominalPct: pctOf(boxEnd) - pctOf(boxStart),
      setupLeftPct: pctOf(setupStart),
      setupWidthPct: setupMs > 0 ? pctOf(setupStart + setupMs) - pctOf(setupStart) : 0,
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
