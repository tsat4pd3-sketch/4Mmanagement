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

/* ── เวลาผลิตของ 1 ล็อต (นาที) ── `null` = ไม่มี CT ⇒ ประเมินไม่ได้ (ห้ามอ่านเป็น 0) */
export function lotRunMin(lot, ctOf = () => null) {
  const qty = num(lot?.qty_plan);
  const ct = num(ctOf(lot?.mat_no));
  if (qty == null || qty <= 0 || ct == null || ct <= 0) return null;
  return (qty * ct) / 60;
}

/* ── ภาระเวลาผลิตรวมของกะ (นาที) ─────────────────────────────────────────────────────
   🔴 ยุบงานคู่ก่อนรวมเสมอ — RH+LH ปั๊มจังหวะเดียวกัน บวกสองข้าง = เวลามาตรฐาน 2 เท่า
   คืน `{ min, noCt }` · `min = null` เมื่อ**ทุกล็อต**ประเมินไม่ได้ (ไม่ใช่ 0)
   `noCt` = รายชื่อ mat ที่ไม่มี CT ⇒ จอต้องเขียนว่าเวลารวมนี้**ต่ำกว่าจริง** */
export function planRunMin(lots = [], ctOf = () => null, pairOf = () => null) {
  const active = lots.filter(ACTIVE_LOT);
  const byMat = {};
  const noCt = new Set();
  let anyCt = false;
  active.forEach(l => {
    const m = lotRunMin(l, ctOf);
    if (m == null) { if (l?.mat_no) noCt.add(l.mat_no); return; }
    anyCt = true;
    byMat[l.mat_no] = (byMat[l.mat_no] || 0) + m;
  });
  return {
    min: anyCt ? pairLoadTotal(byMat, pairOf) : null,
    noCt: [...noCt],
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

/* ── 🔍 เทียบแผน ↔ ของจริง ───────────────────────────────────────────────────────
   คืน 3 กอง **ห้ามยุบรวมกัน** — คนละคำถาม คนละคนต้องไปทำ:
     · `rows`               ล็อตในแผน + ใบจริงที่ผูกอยู่ (ถ้ามี) + ยอดที่ทำได้
     · `plannedNotStarted`  แผนมี แต่ยังไม่เริ่ม (ปลายกะ = งานหลุดแผน)
     · `startedNotPlanned`  หน้างานเปิดใบเอง**นอกแผน** — ต้องเห็น ห้ามซ่อน (ไม่ใช่ความผิด แต่วางแผนต้องรู้)
   จับคู่ด้วย `prod_order_id` เท่านั้น — **ห้ามเดาจาก mat_no** (พาร์ทเดียวกันวางหลายล็อตในกะเดียวได้) */
export function reconcilePlan(lots = [], orders = []) {
  const byId = new Map((orders || []).filter(o => o?.id).map(o => [o.id, o]));
  const linked = new Set();
  const rows = sortBySeq(lots.filter(ACTIVE_LOT)).map(l => {
    const o = l.prod_order_id ? byId.get(l.prod_order_id) || null : null;
    if (o) linked.add(o.id);
    const done = o ? (o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0)) : 0;
    return {
      lot: l, order: o, donePcs: o ? done : null,
      shortPcs: o ? Math.max(0, (num(l.qty_plan) || 0) - done) : null,
      started: !!o, closed: o?.status === 'confirmed',
    };
  });
  return {
    rows,
    plannedNotStarted: rows.filter(r => !r.started).map(r => r.lot),
    startedNotPlanned: (orders || []).filter(o => o?.id && !linked.has(o.id)),
  };
}

/* ── ตัวเลขสรุปหัวแผง (จอ TV อ่านบรรทัดเดียวจบ) ─────────────────────────────────
   🔴 ค่าที่ประเมินไม่ได้ต้องเป็น `null` — จอเขียน "—" ห้ามเขียน 0 */
export function planSummary({ lots = [], orders = [], ctOf, pairOf, dieOf, rule, netShiftMin } = {}) {
  const run = planRunMin(lots, ctOf, pairOf);
  const setup = planSetup(lots, dieOf, rule);
  const fit = shiftFit({ runMin: run.min, setupMin: setup.totalMin, netShiftMin });
  const rec = reconcilePlan(lots, orders);
  const active = lots.filter(ACTIVE_LOT);
  return {
    lotCount: active.length,
    qtyPlan: active.reduce((a, l) => a + (num(l.qty_plan) || 0), 0),   // ชิ้น — บวกทั้งคู่ RH/LH ตามปกติ
    runMin: run.min, noCtMats: run.noCt,
    setupMin: setup.totalMin, setupVarMin: setup.varMin, changeCount: setup.changeCount,
    setupUnknown: setup.noRule || setup.baseUnknown || setup.noDie, setupPartial: setup.unknownCount,
    setupNoDie: setup.noDie,
    fit,
    started: rec.rows.filter(r => r.started).length,
    closed: rec.rows.filter(r => r.closed).length,
    notStarted: rec.plannedNotStarted.length,
    offPlan: rec.startedNotPlanned.length,
  };
}
