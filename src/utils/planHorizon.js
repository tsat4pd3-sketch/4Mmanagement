/* ══ 🗓️ ขอบเขตเวลาของแผนสั่งงาน — กะเช้า → กะดึก → วันถัดไป ต่อกันเป็นเส้นเดียว ═════════════
   (2026-09-30 · คำสั่ง user)

   *"มันควรจะวางได้ทีเดียว ทั้ง 2 กะ ต่อกัน เห็น timeline ตามจำนวนงานที่ต้องผลิต
     ถ้าเกินกะก็ต้องล้นไปกะดึก ถ้าเกิน 1 วันก็ต้องล้นไปอีกวันนึงเลย"*

   ปัญหาเดิม (เห็นจากจอจริง 30/09): แผนผูกกับ **กะเดียว** ทั้งโครง — โหลด/บันทึก/ไทม์ไลน์
   ใช้ `work_date + shift` ตัวเดียว ⇒ ไลน์ B ที่มีงาน 12:24 ชม. ในกรอบกะ 12 ชม.
   ขึ้น "ใช้ 158% ของกะ · ล้นปลายกะ 2:34 ชม." แล้ว**จบแค่นั้น** — งานที่ล้นไม่ได้ไปอยู่กะดึกจริง
   (กะดึกของวันเดียวกันยังว่าง 0 ล็อต) ⇒ คนวางแผนต้องมาวางซ้ำเองอีกกะ และตัวเลข "158%"
   ก็ไม่ได้ตอบคำถามจริงว่า **"งานกองนี้จะเสร็จเมื่อไหร่"**

   🔴 กติกาของไฟล์นี้ (pure ล้วน — ห้ามเรียก supabase/DOM/Date.now()):
     · **กะ = ช่วง 12 ชม. ต่อกันสนิท** (เช้า 08:00–20:00 · ดึก 20:00–08:00 วันถัดไป)
       เครื่องที่เดินอยู่ตอน 20:00 **ไม่ได้หยุด** — งานไหลข้ามกะไปเลย (เปลี่ยนแค่คนคุม)
     · **วันที่โรงงานไม่เดินเครื่อง = ข้าม ไม่ใช่วางงานทับ** — ช่องว่างนั้นคืนออกมาเป็น `closed`
       ให้ตัววางกล่อง "หยุดนับเวลา" ตรงนั้น (กติกาเดียวกับเวลาพัก)
     · 🔴 **"วันหยุด" มี 2 ความหมาย ห้ามเช็ค `!== 'working'` แบบเหมา** (กฎเหล็ก CLAUDE.md) —
       `shutdown75` = โรงงานหยุดจริง · `ot15`/`ot2` = หยุดแต่**เรียก OT มาทำได้**
       ⇒ แยกเป็น `includeOtHoliday` ให้คนวางแผนตัดสิน **ระบบไม่เดาแทน**
     · 🔴 **ปฏิทินยังไม่โหลด = ไม่รู้ ห้ามเดาว่าเป็นวันทำงาน** — คืนธง `calendarUnknown`
       ให้จอเขียนว่ายังไม่ได้เช็ควันหยุด (ตกไปใช้กติกา จ-ศ ไปก่อนเพื่อไม่ให้จอว่างเปล่า)
     · **แกน X = เวลาที่โรงงานเดินจริง ไม่ใช่เวลานาฬิกา** — วันหยุดที่ข้ามไม่กินความกว้างบนจอ
       (ไม่งั้นเสาร์-อาทิตย์กินครึ่งราง แล้วกล่องงานเล็กจนอ่านไม่ออก) ⇒ `makeScale()` เป็น
       piecewise **ทุกพิกัดต้องผ่านมัน ห้ามหาร (ms-start)/span ตรงๆ อีก**

   ⏰ หมายเหตุ timezone: ประกอบเวลาด้วย `new Date('YYYY-MM-DDTHH:00:00')` = เวลาเครื่อง
      ซึ่งตรงกับที่ `ProdLotPlanner`/`PlanTimeline` ใช้แสดงผลอยู่แล้ว (เครื่องหน้างาน = ไทย)
      **จงใจให้เป็นชุดเดียวกันทั้งสาย** — ประกอบด้วยวิธีหนึ่งแล้วอ่านด้วยอีกวิธีคือที่มาของบั๊กเวลา
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** ชั่วโมงเริ่มของแต่ละกะ · ความยาวกะ = 12 ชม. (ครอบ OT — กรอบเดียวกับที่ ProdLotPlanner ใช้เดิม) */
export const SHIFT_START_H = { day: 8, night: 20 };
export const SEG_HOURS = 12;
export const SHIFT_LABEL = { day: '☀️ กะเช้า', night: '🌙 กะดึก' };

/** 'YYYY-MM-DD' + n วัน — คิดที่ตัวเลขวันที่ ไม่พึ่ง timezone เครื่อง */
export function addDays(dateStr, n = 1) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

const msAt = (dateStr, hour) => new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`).getTime();

/** กะถัดไปจาก (วัน, กะ) — ดึกจบแล้วขึ้นเช้าของ**วันถัดไป** */
export function nextShift(workDate, shift) {
  return shift === 'day'
    ? { workDate, shift: 'night' }
    : { workDate: addDays(workDate, 1), shift: 'day' };
}

/**
 * 🏭 วันนี้โรงงานเดินเครื่องไหม — กติกาเดียวกับ `countWorkingDaysInMonth` (companyCalendar.js)
 *   มาร์ค 'working'            → เดิน (รวมเสาร์-อาทิตย์ที่เรียกมาทำ)
 *   มาร์ค ot15/ot2             → หยุด **แต่เรียก OT มาทำได้** ⇒ ขึ้นกับ `includeOtHoliday`
 *   มาร์ค shutdown75           → หยุด (ม.75 — ไม่ใช่วันที่เรียกคนมาปกติ)
 *   ไม่มาร์ค + จันทร์-ศุกร์    → เดิน
 *   ไม่มาร์ค + เสาร์-อาทิตย์   → หยุด
 * @returns {{ run:boolean, dayType:string|null, reason:string }}
 */
export function runDay(dateStr, dayType, { includeOtHoliday = false } = {}) {
  const t = dayType || null;
  if (t === 'working') return { run: true, dayType: t, reason: 'มาร์คว่าทำงาน' };
  if (t === 'ot15' || t === 'ot2') {
    return includeOtHoliday
      ? { run: true, dayType: t, reason: 'วันหยุด — เปิด OT' }
      : { run: false, dayType: t, reason: 'วันหยุด (เปิด OT ได้)' };
  }
  if (t === 'shutdown75') return { run: false, dayType: t, reason: 'หยุดตาม ม.75' };
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  const dow = (y && m && d) ? new Date(y, m - 1, d).getDay() : 1;
  return dow === 0 || dow === 6
    ? { run: false, dayType: null, reason: 'เสาร์-อาทิตย์' }
    : { run: true, dayType: null, reason: '' };
}

/**
 * 🗓️ ต่อกะเป็นเส้นเดียวจากจุดเริ่มที่เลือก
 * @param {object}   o
 * @param {string}   o.startDate        'YYYY-MM-DD' — วันที่เริ่มวางแผน
 * @param {string}   o.startShift       'day' | 'night'
 * @param {number}   o.maxSegments      จำนวนกะสูงสุดที่ยอมต่อ (กันลูปไม่รู้จบ)
 * @param {Function} o.dayTypeOf        (dateStr) → day_type | null
 * @param {boolean}  o.includeOtHoliday นับวันหยุดแบบ OT เป็นวันเดินเครื่องด้วย
 * @param {boolean}  o.calendarLoaded   ปฏิทินโหลดมาแล้วจริงไหม (false = จอต้องเขียนว่ายังไม่ได้เช็ค)
 * @returns {{ segments, closed, skipped, calendarUnknown, startMs, endMs }}
 *   segments = [{ key, workDate, shift, startMs, endMs, dayType, label }] เรียงตามเวลา
 *   closed   = [[ms,ms]] ช่วงที่โรงงานไม่เดิน **ระหว่าง** กะที่เอามาใช้ (วันหยุดที่ข้าม)
 *   skipped  = [{ workDate, dayType, reason }] วันที่ถูกข้าม — จอต้องบอก ห้ามข้ามเงียบ
 */
export function buildHorizon({
  startDate, startShift = 'day', maxSegments = 8,
  dayTypeOf = () => null, includeOtHoliday = false, calendarLoaded = true,
} = {}) {
  const segments = [], closed = [], skipped = [];
  if (!startDate || maxSegments <= 0) {
    return { segments, closed, skipped, calendarUnknown: !calendarLoaded, startMs: null, endMs: null };
  }
  let cur = { workDate: startDate, shift: startShift };
  let guard = 0;
  /* เพดานรอบวน: แต่ละวันมี 2 กะ + เผื่อวันหยุดยาวติดกัน — ไม่ใช่ "จำนวนกะที่ได้" */
  const maxLoops = maxSegments * 2 + 40;
  const seenSkip = new Set();

  while (segments.length < maxSegments && guard++ < maxLoops) {
    const rd = runDay(cur.workDate, dayTypeOf(cur.workDate), { includeOtHoliday });
    if (!rd.run) {
      /* ข้ามทั้ง**วัน** (ทั้ง 2 กะ) — โรงงานหยุดคือหยุดทั้งวัน ไม่ใช่หยุดทีละกะ */
      if (!seenSkip.has(cur.workDate)) {
        seenSkip.add(cur.workDate);
        /* 🔴 ข้ามได้ แต่ต้องเห็น — วันหยุดที่ถูกข้ามเงียบ = คนวางแผนอ่านวันจบผิดโดยไม่รู้ตัว */
        if (segments.length > 0) skipped.push({ workDate: cur.workDate, dayType: rd.dayType, reason: rd.reason });
      }
      cur = { workDate: addDays(cur.workDate, 1), shift: 'day' };
      continue;
    }
    const startMs = msAt(cur.workDate, SHIFT_START_H[cur.shift]);
    const endMs = startMs + SEG_HOURS * 3600000;
    const prev = segments[segments.length - 1];
    /* ช่องว่างระหว่างกะที่เอามาใช้ = วันที่ถูกข้าม ⇒ เวลาหยุดนับ (ป้อนเป็น closed ให้ตัววางกล่อง) */
    if (prev && startMs > prev.endMs) closed.push([prev.endMs, startMs]);
    segments.push({
      key: `${cur.workDate}|${cur.shift}`,
      workDate: cur.workDate, shift: cur.shift, startMs, endMs,
      dayType: rd.dayType,
      label: `${SHIFT_LABEL[cur.shift]} ${cur.workDate.slice(8)}/${cur.workDate.slice(5, 7)}`,
    });
    cur = nextShift(cur.workDate, cur.shift);
  }
  return {
    segments, closed, skipped,
    calendarUnknown: !calendarLoaded,
    startMs: segments[0]?.startMs ?? null,
    endMs: segments[segments.length - 1]?.endMs ?? null,
  };
}

/**
 * 📐 สเกลแกน X = **เวลาที่โรงงานเดินจริง** (วันหยุดที่ข้ามไม่กินความกว้าง)
 * 🔴 ทุกพิกัดบนรางต้องผ่านตัวนี้ — หาร `(ms - start) / span` ตรงๆ จะเพี้ยนทันทีที่มีวันถูกข้าม
 * @returns {{ totalMs, pctOf(ms), spanPct(aMs,bMs) }}
 *   ms ก่อนกะแรก → 0 · ms ที่ตกในช่องว่าง → เกาะขอบกะก่อนหน้า · ms หลังกะสุดท้าย → เกิน 100 (ล้น ต้องเห็น)
 */
export function makeScale(segments = []) {
  const marks = [];
  let acc = 0;
  for (const s of segments) { marks.push({ s, base: acc }); acc += s.endMs - s.startMs; }
  const totalMs = acc;
  const pctOf = (ms) => {
    if (!totalMs || ms == null) return 0;
    if (ms <= marks[0].s.startMs) return 0;
    for (const { s, base } of marks) {
      if (ms <= s.endMs) return ((base + Math.max(0, ms - s.startMs)) / totalMs) * 100;
    }
    /* เลยกะสุดท้าย — เทียบเป็นเวลาเดินเครื่องต่อเนื่อง (ล้นออกนอกราง ห้ามหนีบให้พอดี) */
    const last = marks[marks.length - 1];
    return ((last.base + (last.s.endMs - last.s.startMs) + (ms - last.s.endMs)) / totalMs) * 100;
  };
  return { totalMs, pctOf, spanPct: (a, b) => pctOf(b) - pctOf(a) };
}

/**
 * 🎯 กล่องนี้ตกอยู่กะไหน — ผลลัพธ์ที่เอาไปเขียนลง `work_date` / `shift` ของล็อต
 * 🔴 `sure = false` เมื่อเวลาของกล่องนั้น**เชื่อไม่ได้** (ไม่มี CT หรือมีใบที่ไม่มี CT อยู่ก่อนหน้า)
 *    ⇒ **ห้ามบันทึกทับกะเดิม** — เดาแทนคนแล้วงานจะไปโผล่ผิดกะบนจอหน้างาน
 * @param {Array} boxes     ผลจาก layoutLots (ต้องมี startMs · noCt · afterUnknown)
 * @param {Array} segments  ผลจาก buildHorizon
 * @returns {Array<{ id, workDate, shift, segIndex, sure, overflow }>}
 *   overflow = true ⇒ งานล้นเลยกะสุดท้ายของขอบเขต (ยังหาที่ลงไม่ได้ ต้องยืดขอบเขตหรือลดงาน)
 */
export function assignShifts(boxes = [], segments = []) {
  return boxes.map(b => {
    const sure = !b.noCt && !b.afterUnknown;
    let idx = -1;
    for (let i = 0; i < segments.length; i++) {
      /* เริ่มก่อนกะแรก (กันเลขปัดเศษ) หรืออยู่ในกรอบกะนี้ */
      if (b.startMs < segments[i].endMs) { idx = i; break; }
    }
    const seg = idx >= 0 ? segments[idx] : null;
    return {
      id: b.lot?.id, segIndex: idx, sure,
      workDate: seg?.workDate ?? null, shift: seg?.shift ?? null,
      overflow: !seg,
    };
  });
}

/**
 * 📊 สรุปบรรทัดเดียว: "งานกองนี้กินกี่กะ จบเมื่อไหร่"
 * 🔴 ประเมินไม่ได้ = `null` ทุกช่อง **ห้ามคืน 0/กะแรก** (แผนที่ดูว่างเพราะข้อมูลไม่พอ อันตรายกว่าไม่รู้)
 */
export function horizonSummary({ boxes = [], segments = [], endMs = null, unknownCount = 0 } = {}) {
  const used = new Set();
  let overflow = 0;
  assignShifts(boxes, segments).forEach(a => {
    if (a.overflow) overflow++; else if (a.segIndex >= 0) used.add(a.segIndex);
  });
  const known = unknownCount === 0 && boxes.length > 0;
  const lastIdx = used.size ? Math.max(...used) : -1;
  return {
    shiftsUsed: used.size || null,
    /* กะสุดท้ายที่มีงานลง — ไว้เขียน "ยาวถึง 🌙 กะดึก 30/09" */
    lastSegment: lastIdx >= 0 ? segments[lastIdx] : null,
    /* 🔴 เวลาจบ = null เมื่อมีล็อตที่คำนวณไม่ได้ (ตอบไม่ได้ ห้ามเดา) */
    finishMs: known ? endMs : null,
    overflowLots: overflow,
  };
}

/**
 * 🕐 ป้ายชั่วโมงบนหัวราง — เดินทีละกะ แล้วแปลงพิกัดผ่าน `scale`
 * 🔴 ห้ามใช้ `hourTicks()` แบบเชิงเส้นกับขอบเขตหลายกะ — วันที่ถูกข้ามจะทำให้ป้ายเลื่อนหนีกล่อง
 * ระยะห่างป้ายปรับตามความยาวขอบเขต (48 ชม. ที่ 1 ป้าย/ชม. = ป้ายทับกันจนอ่านไม่ออก)
 */
export function tickStepHours(segCount) {
  if (segCount <= 1) return 1;
  if (segCount <= 2) return 2;
  if (segCount <= 4) return 3;
  return 6;
}

export function segmentTicks(segments = [], scale = null, everyHours = null) {
  if (!segments.length || !scale) return [];
  const step = (everyHours || tickStepHours(segments.length)) * 3600000;
  const out = [];
  for (const s of segments) {
    for (let ms = s.startMs; ms < s.endMs; ms += step) {
      const d = new Date(ms);
      out.push({ ms, pct: scale.pctOf(ms), label: `${String(d.getHours()).padStart(2, '0')}:00` });
    }
  }
  return out;
}

/** แถบหัวกะ (ชื่อกะ + ช่วงกว้างบนราง) — ให้จอวาดพื้น/เส้นแบ่งกะได้โดยไม่ต้องคิดพิกัดเอง */
export function segmentBands(segments = [], scale = null) {
  if (!scale) return [];
  return segments.map((s, i) => ({
    ...s, index: i,
    leftPct: scale.pctOf(s.startMs),
    widthPct: scale.pctOf(s.endMs) - scale.pctOf(s.startMs),
  }));
}

/**
 * 🔢 เรียงล็อตข้ามกะให้เป็น "คิวเดียว" — ตามลำดับกะในขอบเขต แล้วค่อย `seq` ในกะนั้น
 *
 * 🔴 ต้องมี ไม่งั้นคิวสลับมั่ว: `seq` เก็บเป็น **ลำดับภายในกะ** (กะเช้า 1,2,3 · กะดึก 1,2)
 *    ⇒ เรียงด้วย seq เฉยๆ จะได้ 1,1,2,2,3 = งานกะดึกแทรกกลางกะเช้า
 *    (เจอตอนเปลี่ยนมาโหลดทั้งขอบเขต 30/09 — ก่อนหน้านี้โหลดกะเดียวจึงไม่เคยชน)
 * · ล็อตที่กะของมันไม่อยู่ในขอบเขต (เช่นบันทึกไว้นอกช่วง) **ต่อท้าย ห้ามตัดทิ้ง**
 * @returns ลิสต์ใหม่ที่ `seq` เป็น 1..N ต่อเนื่องทั้งขอบเขต (ในหน่วยความจำเท่านั้น —
 *          ตอนบันทึกจะถูกนับใหม่รายกะอีกที)
 */
export function orderAcrossHorizon(lots = [], segments = []) {
  const rank = new Map(segments.map((s, i) => [`${s.workDate}|${s.shift}`, i]));
  const keyOf = (l) => rank.get(`${l?.work_date}|${l?.shift}`) ?? Number.MAX_SAFE_INTEGER;
  return [...lots]
    .sort((a, b) => keyOf(a) - keyOf(b)
      || (Number(a?.seq) || 9999) - (Number(b?.seq) || 9999)
      || String(a?.mat_no || '').localeCompare(String(b?.mat_no || '')))
    .map((l, i) => (l.seq === i + 1 ? l : { ...l, seq: i + 1 }));
}
