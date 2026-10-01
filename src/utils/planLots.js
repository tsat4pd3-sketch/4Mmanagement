/* ══ 📋 แผนสั่งงานรายล็อต — สูตรกลางของทีมวางแผน (2026-09-30 · คำสั่ง user) ═══════════════
   *"ต้องการหน้าที่เอาไว้ให้หน่วยงานวางแผน จัดแผนการผลิตให้กับฝ่ายผลิต สำหรับพวกงาน lot size
     ที่ไม่ได้ผลิตตาม KANBAN แบบ first come first serve ต้องมีการวิเคราะห์และจัดการโดยทีมวางแผน"*

   ⚠️ ไฟล์นี้เป็น **pure function ล้วน** — ห้ามเรียก supabase/DOM · ทุกจอที่แตะแผนล็อตต้องอ่านผ่านที่นี่
      (บทเรียนเดิม: บอร์ด 2 จอเคยคิดดีเลย์คนละสูตรแล้วขึ้นเลขคนละเลข — audit 2026-09-16)

   🔴 กติกาความซื่อสัตย์ของตัวเลขชุดนี้ (ห้ามผ่อนข้อไหนก็ตาม):
     · **ไม่มี CT = ประเมินเวลาไม่ได้ ⇒ `null` ห้ามคืน 0** — ล็อตที่ประเมินไม่ได้ต้องถูกนับแยกให้จอเขียนบอก
     · **เวลาเปลี่ยนรุ่นมาจาก `pressSetup.js` เท่านั้น** (ไม่มีกฎ/ไม่รู้เวลาฐาน = null ห้ามเดา 0)
     · **ภาระเวลา นับ "shot" · ยอดชิ้น นับ "ชิ้น"** — งานคู่ RH/LH ปั๊มทีเดียวได้ 2 ชิ้น
       ⇒ เวลาต้องยุบผ่าน `pairLoadTotal` (กฎเหล็ก "ชิ้น ≠ shot")
     · **เกินกำลัง = เตือน ห้ามบล็อก** — คนวางแผนอาจตั้งใจอัดงานแล้วไปแก้ด้วย OT/คนเพิ่ม
     · **ใบที่หน้างานเปิดเองนอกแผน ต้องโผล่ให้เห็น ห้ามซ่อน** (`startedNotPlanned`)
     · 🧪 **งานทดลอง (new model trial) กินเวลาเครื่องจริง ⇒ ต้องอยู่ในแผน** (01/10 · หน้างานแจ้ง)
       เวลามาจาก **`est_min` = "ที่ขอ"** ไม่ใช่ `qty×CT` (พาร์ทใหม่ยังไม่มี CT แน่ๆ) —
       🔴 **จอต้องเขียนว่าเวลานี้คนกรอก ไม่ใช่คำนวณ** (`lotRunInfo().from === 'est'`)
       🔴 **ใบทดลองไม่มี `mat_no` ⇒ ห้ามเอาไปจับคู่ยอดจริง** (ไม่มีพาร์ทให้จับ) = `state:'trial'`
          **ห้ามตีเป็น `pending`** ไม่งั้นจะค้าง "ยังไม่เริ่ม" ตลอดกาลบนจอ
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { pairLoadTotal } from './pairTotals.js';
import { sequenceSetup, orderByDieHeight } from './pressSetup.js';

export const LOT_STATUSES = ['planned', 'started', 'done', 'cancelled'];

/* 🔴 ตัวเลขที่อ่านไม่ได้ต้องขึ้น "—" **ห้ามพ่น `NaN` ออกจอ** (เจอจริงในจอทดสอบ 30/09 · 8 จุด)
   `Number(undefined).toLocaleString()` = "NaN" ซึ่งดูเหมือนระบบพัง ทั้งที่ความจริงคือข้อมูลไม่ครบ */
export const qtyText = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
};
/* ล็อตที่ "ยังกินเวลาในกะนี้อยู่" — cancelled ไม่กิน · done กินไปแล้วแต่ยังนับในภาระรวมของกะ */
export const ACTIVE_LOT = (l) => l?.status !== 'cancelled';

/* 🔴 `Number(null)` และ `Number('')` = **0** ⇒ ถ้าไม่กันไว้ ค่าว่างจะกลายเป็นเลข 0 ที่ดูน่าเชื่อ
   (เจอจากเทสจริง: ล็อตที่ยังไม่มีเลขลำดับถูกดันขึ้น**หัวคิว** แทนที่จะต่อท้าย)
   ตระกูลเดียวกับกฎ "ค่าว่าง ≠ 0" ทั้งระบบ — ว่าง/ไม่ใช่ตัวเลข = null เสมอ */
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 🧪 ใบจองเครื่องทดลองงานใหม่ (ยังไม่มีเลข MAT) — คนละชนิดกับล็อตผลิตจริง */
export const isTrialLot = (l) => l?.source === 'trial';

/* ป้ายชื่อของล็อตบนจอ — งานทดลองไม่มี `mat_no` ให้โชว์ ต้องตกไปใช้ Part No./ชื่อที่กรอกบนใบ
   🔴 **ห้ามปล่อยว่าง** (กล่องไม่มีชื่อ = คนหน้างานไม่รู้ว่าเครื่องถูกจองไปทำอะไร) */
export const lotKeyText = (l) => (isTrialLot(l)
  ? (String(l?.trial_part_no || '').trim() || String(l?.trial_part_name || '').trim() || 'งานทดลอง')
  : (String(l?.mat_no || '').trim() || '—'));

/**
 * ── เวลาของ 1 ล็อต (นาที) + **มาจากไหน** ─────────────────────────────────────────
 * 🔴 `from` สำคัญพอๆ กับตัวเลข — จอต้องแยกให้ออกว่า
 *    `'ct'`  = ระบบคำนวณจาก qty × cycle time (เชื่อถือได้ตามมาตรฐาน)
 *    `'est'` = **คนกรอกว่า "ขอเท่านี้"** (งานทดลอง — พาร์ทใหม่ยังไม่มี CT ⇒ คำนวณไม่ได้)
 *    `null`  = ประเมินไม่ได้เลย **ห้ามอ่านเป็น 0**
 * ⚠️ `est_min` **ชนะ CT เสมอเมื่อกรอก** (คนวางแผนรู้ดีกว่าสูตรว่างานนี้จะกินเครื่องกี่ชั่วโมง)
 *    และ**ไม่ถูกยุบคู่ RH/LH** เพราะมันคือ "เวลานาฬิกาที่ขอ" ไม่ใช่ภาระ shot ที่หักกลบกันได้
 */
export function lotRunInfo(lot, ctOf = () => null) {
  const est = num(lot?.est_min);
  if (est != null && est > 0) return { min: est, from: 'est' };
  const qty = num(lot?.qty_plan);
  const ct = num(ctOf(lot?.mat_no));
  if (qty == null || qty <= 0 || ct == null || ct <= 0) return { min: null, from: null };
  return { min: (qty * ct) / 60, from: 'ct' };
}

/* ── เวลาผลิตของ 1 ล็อต (นาที) ── `null` = ประเมินไม่ได้ (ห้ามอ่านเป็น 0) */
export function lotRunMin(lot, ctOf = () => null) {
  return lotRunInfo(lot, ctOf).min;
}

/* ── ภาระเวลาผลิตรวมของกะ (นาที) ─────────────────────────────────────────────────────
   🔴 ยุบงานคู่ก่อนรวมเสมอ — RH+LH ปั๊มจังหวะเดียวกัน บวกสองข้าง = เวลามาตรฐาน 2 เท่า
   คืน `{ min, noCt }` · `min = null` เมื่อ**ทุกล็อต**ประเมินไม่ได้ (ไม่ใช่ 0)
   `noCt` = รายชื่อ mat ที่ไม่มี CT ⇒ จอต้องเขียนว่าเวลารวมนี้**ต่ำกว่าจริง** */
export function planRunMin(lots = [], ctOf = () => null, pairOf = () => null) {
  const active = lots.filter(ACTIVE_LOT);
  const byMat = {};
  const noCt = new Set();
  let anyKnown = false, estMin = 0, noTimeLots = 0;
  active.forEach(l => {
    const { min, from } = lotRunInfo(l, ctOf);
    /* ⏱️ เวลาที่คนกรอก = เวลานาฬิกาที่ขอ **ไม่ยุบคู่ RH/LH** (ดู lotRunInfo) ⇒ บวกตรงๆ */
    if (from === 'est') { anyKnown = true; estMin += min; return; }
    if (min == null) {
      /* 🔴 ใบที่ไม่มี mat (งานทดลองที่ลืมกรอกเวลา) ต้องนับแยก — ไม่งั้นจอเขียนว่า
         "0 พาร์ทไม่มี CT" ทั้งที่มีงานที่ประเมินเวลาไม่ได้อยู่จริงในคิว */
      if (l?.mat_no) noCt.add(l.mat_no); else noTimeLots++;
      return;
    }
    anyKnown = true;
    byMat[l.mat_no] = (byMat[l.mat_no] || 0) + min;
  });
  return {
    min: anyKnown ? pairLoadTotal(byMat, pairOf) + estMin : null,
    noCt: [...noCt],
    noTimeLots,
    estMin,
    lots: active.length,
  };
}

/* ── เวลาเปลี่ยนรุ่นรวมตามลำดับที่วางไว้ (ผ่าน pressSetup เท่านั้น) ──────────────────
   dieOf(lot) → { id, die_height_mm } | null · ล็อตที่ไม่ระบุแม่พิมพ์ = ไม่มีของให้เทียบ
   ⚠️ คืนผลของ `sequenceSetup` ตรงๆ — `totalMin: null` แปลว่า "ตอบเวลารวมไม่ได้"
      แต่ `varMin` ยังใช้เทียบว่า*ลำดับไหนดีกว่า*ได้ (เวลาฐานหักกลบกัน) */
export function planSetup(lots = [], dieOf = () => null, rule = null) {
  const active = sortBySeq(lots.filter(ACTIVE_LOT));
  const dies = active.map(l => dieOf(l) || null).filter(Boolean);
  const r = sequenceSetup(dies, rule);
  /* 🔴 มีงานในแผนแต่**ไม่มีล็อตไหนระบุแม่พิมพ์เลย** = ตอบไม่ได้ ไม่ใช่ "ไม่ต้องเปลี่ยนรุ่น"
     `sequenceSetup([])` คืน 0 ตามนิยามของมัน (ไม่มีของให้เปลี่ยน = 0 ถูกแล้ว) แต่บนจอ
     "🔧 เปลี่ยนรุ่น 0 น." อ่านว่า *ไม่เสียเวลาเลย* ซึ่งเป็นคำโกหกที่ดูน่าเชื่อ —
     ของจริงวันนี้แม่พิมพ์ 262 ตัวยังไม่ได้กรอกความสูงสักตัว (วัด 2026-09-30)
     ⇒ ติดธง `noDie` ให้จอเขียนว่ายังระบุแม่พิมพ์ไม่ครบ · `totalMin` เป็น null */
  const noDie = active.length > 0 && dies.length === 0;
  return noDie ? { ...r, totalMin: null, varMin: null, noDie: true } : { ...r, noDie: false };
}

/* ── กะนี้ทำไหวไหม ────────────────────────────────────────────────────────────────
   🔴 `state: 'unknown'` เมื่อข้อมูลไม่พอ — **ห้ามตีเป็น 'ok'** (แผนที่ดูว่างเพราะไม่มีข้อมูล
      อันตรายกว่าแผนที่บอกว่าไม่รู้) · 'tight' = ใช้เกิน 90% ของเวลากะ */
export function shiftFit({ runMin = null, setupMin = null, netShiftMin = null } = {}) {
  if (runMin == null || netShiftMin == null || netShiftMin <= 0) {
    return { state: 'unknown', usedMin: null, freeMin: null, pct: null, setupKnown: setupMin != null };
  }
  const usedMin = runMin + (setupMin || 0);
  const pct = (usedMin / netShiftMin) * 100;
  return {
    state: pct > 100 ? 'over' : pct >= 90 ? 'tight' : 'ok',
    usedMin, freeMin: netShiftMin - usedMin, pct,
    /* setup ประเมินไม่ได้ = ตัวเลขนี้**ต่ำกว่าจริง** จอต้องเขียนกำกับ */
    setupKnown: setupMin != null,
  };
}

/* ── ลำดับ ─────────────────────────────────────────────────────────────────────── */
export const sortBySeq = (lots = []) =>
  [...lots].sort((a, b) => (num(a?.seq) ?? 9999) - (num(b?.seq) ?? 9999)
    || String(a?.mat_no || '').localeCompare(String(b?.mat_no || '')));

/* เติมเลขลำดับ 1..n ให้ต่อเนื่อง (เลขหายไป/ซ้ำ = คนลากแล้วเลขเพี้ยน — จอไม่ควรโชว์ 1,1,4) */
export function resequence(lots = []) {
  return sortBySeq(lots).map((l, i) => (num(l.seq) === i + 1 ? l : { ...l, seq: i + 1 }));
}

/* เลื่อนล็อตขึ้น/ลง 1 ขั้น · คืนลิสต์ใหม่ที่ seq ต่อเนื่องแล้ว (ไม่แตะของเดิม) */
export function moveLot(lots = [], id, dir = -1) {
  const arr = resequence(lots);
  const i = arr.findIndex(l => l.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out.map((l, k) => ({ ...l, seq: k + 1 }));
}

/* ── 💡 ระบบเสนอลำดับ — เรียงตามความสูงแม่พิมพ์ (1mm = 1sec ⇒ ไล่ทางเดียวคือน้อยสุด) ──
   🔴 **ระบบเสนอ คนตัดสิน** — คืนลิสต์ใหม่เฉยๆ ห้ามบันทึกเอง
   🔴 ล็อตที่ไม่รู้ความสูง/ไม่มีแม่พิมพ์ **ต่อท้าย ห้ามตัดทิ้ง** (งานหายจากแผนเพราะข้อมูลไม่ครบ = บาปหนักกว่า) */
export function suggestSequence(lots = [], dieOf = () => null) {
  const active = sortBySeq(lots.filter(ACTIVE_LOT));
  const withDie = [], noDie = [];
  active.forEach(l => (dieOf(l) ? withDie : noDie).push(l));
  const dieKey = new Map(withDie.map(l => [l.id, dieOf(l)]));
  const ordered = orderByDieHeight(withDie.map(l => ({ ...dieKey.get(l.id), _lot: l })));
  return [...ordered.map(d => d._lot), ...noDie].map((l, i) => ({ ...l, seq: i + 1 }));
}

/* ══ 🔀 แบ่งแผนของ "ไลน์+วันงาน" ตามมุมมองของกะที่เปิดอยู่ (2026-09-30 รอบ 2) ═══════════
   🔴🔴 เคสจริงที่ทำให้ต้องมี — วันงาน 30/09 LINE B: วางแผนไว้ **กะเช้า 6 ล็อต** แต่กะเช้าปิดไปแล้ว
        โดยไม่ได้เริ่มสักใบ · ตอนนี้ **กะดึกเปิดอยู่** ⇒ จอหน้างานเดิมกรอง `shift = กะที่เปิด`
        ได้ 0 แถว แล้ว **ไม่วาดอะไรเลย** ⇒ กะดึกไม่มีทางรู้เลยว่ามีแผนค้างอยู่ 6 ล็อต
        (ล้มเหลวเงียบ — "ไม่มีแผน" กับ "แผนอยู่คนละกะ" ต้องอ่านออกว่าคนละเรื่อง)

   ⇒ โหลดทั้งวันงานของไลน์นั้น แล้วแบ่งเป็น `mine` (กะนี้) / `other` (กะอื่นในวันเดียวกัน)
   🔴 **ตัวนี้ไม่ตัดสินว่า "ทำแล้วหรือยัง"** — เดิมเคยดู `status`/`prod_order_id` แต่ตั้งแต่ 01/10
      แผนเป็น**กรอบล้วน ไม่มีใครเขียน status กลับฐาน** (ดู `matchPlanToActual`) ⇒ ต้องตัดสินจาก
      **ยอดที่ทำได้จริง** ที่ชั้นจอ ไม่ใช่จากคอลัมน์ที่ไม่มีใครอัพเดท (ไม่งั้น "ค้าง" ตลอดกาล)
   ⚠️ ไม่มีทั้ง 2 กอง = ไม่มีแผนจริงๆ ⇒ จอไม่ต้องวาด (ไลน์คัมบังจะได้ไม่รก) */
export function splitPlanForSession(lots = [], session = null) {
  const shift = session?.shift ?? null;
  const active = lots.filter(ACTIVE_LOT);
  return {
    mine:  sortBySeq(active.filter(l => l.shift === shift)),
    other: sortBySeq(active.filter(l => l.shift !== shift)),
    hasAny: active.length > 0,
  };
}

/* ══ 🧩 Layer 1 (แผน) ↔ Layer 2 (ของจริง) — จับคู่จาก **ยอดรวมต่อพาร์ท** (2026-10-01) ══════
   แนวคิดจาก user: *"ระบบนี้จะเป็นเหมือนกรอบ เลเยอร์ 1 · ผลิตเปิดคัมบัง คอนเฟิร์มยอด เป็นเลเยอร์ 2"*

   🔴🔴 ทำไมต้องจับคู่ด้วย "ยอดรวม" ไม่ใช่ 1 ล็อต = 1 ใบ — **วัดจากฐานจริง วันงาน 25/09:**
     Line 60 · 10100384 · กะดึก = **40 ใบ** × 10 ชิ้น   |  LINE A · 10057226 = **14 ใบ** × 70
     Assy GOR · 20058498 = **32 ใบ** × 14             |  LINE C · 20058489 = **5 ใบ** × 300
     ⇒ **1 พาร์ท 1 กะ = ใบผลิตหลายใบเสมอ** (คัมบัง 1 ใบ = 1 กล่อง) · `manual = 0` ทุกแถว
       แม้แต่ไลน์ปั๊ม A/B/C ก็สแกนคัมบัง (30 วัน manual แค่ 1.4–3.3%)
   ⇒ ถ้าแผน "ออกใบให้" 1 ใบตามยอดล็อต แล้วหน้างานสแกนคัมบังตามปกติด้วย = **เป้าถูกนับซ้ำ**
     (วางแผน 1,000 + สแกนจริง 7 ใบ × 60 = เป้าในกะกลายเป็น 1,420)

   ⇒ **แผนไม่สร้างใบผลิตเลย** (คำสั่ง user 2026-10-01) — Layer 2 ทำงานเหมือนเดิมทุกอย่าง
     ระบบแค่เอายอดที่เกิดจริงมาเทียบกับกรอบ

   🔴 กติกาการปันยอด (ต้อง deterministic ไม่งั้นเลขเต้นทุกครั้งที่โหลด):
     · ปันต่อ **(ไลน์ + วันงาน + พาร์ท)** ข้ามกะ — ไม่ใช่แยกกะ เพราะล็อตที่กะเช้าทำไม่ทัน
       กะดึกทำต่อได้ (ดู `splitPlanForSession`) · แยกกะ = ยอดเดียวถูกนับ 2 รอบ
     · เติมตาม **ลำดับล็อต (seq)** จนเต็มยอดแล้วค่อยล้นไปใบถัดไป
     · 🔴 **ยอดที่เกินทุกล็อตของพาร์ทนั้น = `overPcs` ต้องโชว์ ห้ามกลืน** (ทำเกินแผนคือข้อมูล ไม่ใช่ error)
     · 🔴 **พาร์ทที่ผลิตจริงแต่ไม่มีในแผนเลย = `offPlan` ต้องโชว์** (หน้างานทำนอกแผน ไม่ใช่ความผิด แต่ต้องรู้)
     · 🔴 **ไม่ตัดสินแทนคน** (คำสั่ง user) — ไม่เขียน status กลับฐาน ไม่ปิดล็อตเอง · คำนวณสดทุกครั้ง   */

/** ยอดที่ทำได้จริงของใบผลิต 1 ใบ — ปิดแล้วใช้ qty_ok · ยังเปิดใช้ qty_actual */
export const orderDonePcs = (o) =>
  (o?.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0)) || 0;

export function matchPlanToActual(lots = [], orders = []) {
  const active = sortBySeq(lots.filter(ACTIVE_LOT));
  /* ยอดจริงรวมต่อพาร์ท + นับว่ามาจากกี่ใบ (จอต้องบอกได้ว่า "จาก 14 ใบคัมบัง") */
  const actual = new Map();
  (orders || []).forEach(o => {
    if (!o?.mat_no) return;
    const cur = actual.get(o.mat_no) || { pcs: 0, orders: 0 };
    cur.pcs += orderDonePcs(o); cur.orders += 1;
    actual.set(o.mat_no, cur);
  });

  /* ปันยอดตามลำดับล็อต */
  const left = new Map([...actual].map(([m, v]) => [m, v.pcs]));
  const rows = active.map(l => {
    /* 🧪 ใบจองเครื่องทดลอง = ไม่มีพาร์ทให้จับคู่ (SAP ยังไม่ออกเลข MAT)
       🔴 **ห้ามตีเป็น `pending`** — จะค้าง "ยังไม่เริ่ม" ตลอดกาล · `donePcs: null` = ตอบไม่ได้ ไม่ใช่ 0 */
    if (isTrialLot(l)) return { lot: l, donePcs: null, pct: null, state: 'trial', fromOrders: 0 };
    const plan = Number(l.qty_plan) || 0;
    const pool = left.get(l.mat_no);
    if (pool == null) return { lot: l, donePcs: 0, pct: 0, state: 'pending', fromOrders: 0 };
    const take = Math.min(pool, plan);
    left.set(l.mat_no, pool - take);
    return {
      lot: l, donePcs: take,
      pct: plan > 0 ? Math.round((take / plan) * 100) : null,
      state: take >= plan ? 'done' : take > 0 ? 'partial' : 'pending',
      fromOrders: actual.get(l.mat_no)?.orders || 0,
    };
  });

  /* เหลือหลังปันครบทุกล็อต = ทำเกินแผน · พาร์ทที่ไม่มีล็อตเลย = ทำนอกแผน */
  const planned = new Set(active.filter(l => !isTrialLot(l)).map(l => l.mat_no));
  const over = [], offPlan = [];
  left.forEach((pcs, mat) => {
    if (pcs <= 0) return;
    (planned.has(mat) ? over : offPlan).push({ mat_no: mat, pcs, orders: actual.get(mat)?.orders || 0 });
  });

  /* ยอดชิ้นของกรอบ — ใบทดลองไม่นับ (ยอดมันคือ "ลองกี่ชิ้น" ไม่ใช่ของส่งลูกค้า) */
  const planPcs = active.reduce((a, l) => a + (isTrialLot(l) ? 0 : Number(l.qty_plan) || 0), 0);
  const donePcs = rows.reduce((a, r) => a + (r.donePcs || 0), 0);
  return {
    rows, over, offPlan,
    planPcs, donePcs,
    pct: planPcs > 0 ? Math.round((donePcs / planPcs) * 100) : null,
    doneLots: rows.filter(r => r.state === 'done').length,
    startedLots: rows.filter(r => r.state !== 'pending').length,
  };
}

/* ── ตัวเลขสรุปหัวแผง (จอ TV อ่านบรรทัดเดียวจบ) ─────────────────────────────────
   🔴 ค่าที่ประเมินไม่ได้ต้องเป็น `null` — จอเขียน "—" ห้ามเขียน 0 */
export function planSummary({ lots = [], orders = [], ctOf, pairOf, dieOf, rule, netShiftMin } = {}) {
  const run = planRunMin(lots, ctOf, pairOf);
  const setup = planSetup(lots, dieOf, rule);
  const fit = shiftFit({ runMin: run.min, setupMin: setup.totalMin, netShiftMin });
  const rec = matchPlanToActual(lots, orders);
  const active = lots.filter(ACTIVE_LOT);
  return {
    lotCount: active.length,
    qtyPlan: active.reduce((a, l) => a + (isTrialLot(l) ? 0 : num(l.qty_plan) || 0), 0),  // ชิ้น — บวกทั้งคู่ RH/LH ตามปกติ · ใบทดลองไม่นับ
    /* 🧪 งานทดลองในคิวนี้ — จอต้องบอกแยก ไม่ใช่กลืนรวมกับงานผลิต (คนละเรื่อง คนละเจ้าของ) */
    trialCount: active.filter(isTrialLot).length,
    trialMin: run.estMin || 0,
    /* ล็อตที่ประเมินเวลาไม่ได้และไม่มี mat ให้บอกชื่อ (ทดลองที่ลืมกรอกเวลา) */
    noTimeLots: run.noTimeLots || 0,
    runMin: run.min, noCtMats: run.noCt,
    setupMin: setup.totalMin, setupVarMin: setup.varMin, changeCount: setup.changeCount,
    setupUnknown: setup.noRule || setup.baseUnknown || setup.noDie, setupPartial: setup.unknownCount,
    setupNoDie: setup.noDie,
    fit,
    /* ความคืบหน้าเทียบกรอบ — มาจากยอดรวมต่อพาร์ท ไม่ใช่ "กี่ใบถูกเปิด" (ดู matchPlanToActual) */
    started: rec.startedLots, closed: rec.doneLots,
    notStarted: rec.rows.filter(r => r.state === 'pending').length,
    donePcs: rec.donePcs, donePct: rec.pct,
    offPlan: rec.offPlan.length, overPlan: rec.over.length,
  };
}
