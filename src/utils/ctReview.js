/*
  ทบทวน Cycle Time — "ระบบเสนอ วิศวกรตัดสิน"  (2026-09-18 · คำสั่ง user)
  ═══════════════════════════════════════════════════════════════════════════════════════

  user: *"ปกติก็ต้อง CT มาตรฐานนะ แต่ adaptive เอาไว้โชว์ให้เห็นว่า actual ที่ทำได้
          และอาจจะรอวิศวกรอนุมัติปรับ ก็จะกลายเป็น CT มาตรฐานใหม่"*

  🔴 สัญญาหลักของไฟล์นี้ — ผิดข้อไหนคือผิดทั้งหมด:
   1. **`ct_observed` ไม่เคยเข้าสูตร OEE** · `%P` หารด้วย `ct_standard` (`dr_products.cycle_time_sec`)
      เสมอ ไม่ว่าเลขนี้จะออกมาเท่าไหร่ — ไฟล์นี้ผลิต "ข้อเสนอ" ไม่ใช่ "ค่าที่ใช้"
   2. **ระบบไม่เขียน master เอง** — ต้องมีคนกดอนุมัติ (กติกาเดียวกับ `pe_master_proposals`)
   3. เสนอจาก **มัธยฐาน** ไม่ใช่ค่าเฉลี่ย — ค่าเฉลี่ยโดนใบเดียวที่เพี้ยนลากทั้งชุด

  ── ทำไมต้องกรองข้อมูลก่อน (บทเรียน 17/09) ─────────────────────────────────────────────
  "CT ตั้งช้า" กับ "ลง downtime เกินจริง" ให้อาการเหมือนกันเป๊ะ (%P ทะลุ 100 ทั้งคู่)
  ⇒ **ถ้าเอา actual จากกะที่ลง DT เกินจริงมาปรับ CT จะได้ CT ที่เร็วเกินจริง** แล้วเพี้ยนไปอีกทาง
     (ลง DT เกิน → เวลาที่ "เครื่องเดินจริง" หดผิด → ดูเหมือนทำงานเร็วมาก)
  ⇒ ต้องคัดใบที่เชื่อไม่ได้ออกก่อนเสมอ ดู `SAMPLE_RULES` ด้านล่าง
*/

import { breakIntervalsIn, overlapMinutesWith, clampWinToShift, shiftFrameOf, unionIv } from './oee.js';

/** เกณฑ์คัดใบผลิตเข้ากลุ่มตัวอย่าง — เปิดเป็นค่าคงที่ให้เห็นชัดและปรับได้ที่เดียว */
export const SAMPLE_RULES = {
  MIN_ORDERS: 10,        // น้อยกว่านี้ = สัญญาณไม่พอ ห้ามเสนอ
  MIN_QTY_PER_ORDER: 5,  // ใบที่ทำไม่กี่ชิ้น เวลาตั้งเครื่อง/เก็บงานกินสัดส่วนเยอะ ทำให้ CT เพี้ยน
  MIN_RATIO_OF_STD: 0.30,// ได้ CT เร็วกว่ามาตรฐานเกิน 3 เท่า = ข้อมูลผิด ไม่ใช่ฝีมือ
  MAX_RATIO_OF_STD: 5.0, // ช้ากว่ามาตรฐาน 5 เท่า = ใบนั้นมีอะไรผิดปกติ (ลืมปิดใบ ฯลฯ)
  BIG_GAP_PCT: 20,       // ต่างจากมาตรฐานเกินเท่านี้ = ขึ้นธงให้คนดูก่อน ไม่ใช่กดอนุมัติรวด
};

/** มัธยฐาน (ไม่ใช่ mean — ใบเดียวที่เพี้ยนลากค่าเฉลี่ยทั้งชุด) */
export function median(nums = []) {
  const a = nums.filter(n => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** เปอร์เซ็นไทล์แบบ nearest-rank — ใช้โชว์การกระจายตัวให้วิศวกรดูว่าข้อมูลนิ่งแค่ไหน */
export function percentile(nums = [], p = 0.5) {
  const a = nums.filter(n => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1));
  return a[i];
}

/**
 * CT ที่สังเกตได้จากใบผลิต 1 ใบ (วินาที/ชิ้น) — คืน null เมื่อวัดไม่ได้
 *   = (เวลาที่ใบนี้เปิดอยู่ − downtime ที่ทับ − พักตามนโยบาย) ÷ จำนวนชิ้น
 * ⚠️ ต้องรัดช่วงใบให้อยู่ในกะก่อนเสมอ — ใบที่ยืนยันย้อนหลังข้ามวันจะได้ CT ช้าเกินจริงมหาศาล
 *    (บั๊ก 17/09: window 24.5 ชม. · ดู oee.js §7)
 */
export function observedCtOfOrder(order, { session, downtimes = [], breakPolicies = [], processType = null }) {
  const qty = Number(order?.qty_ok ?? order?.qty ?? 0);
  if (!(qty >= SAMPLE_RULES.MIN_QTY_PER_ORDER)) return null;
  if (!order?.opened_at || !order?.confirmed_at) return null;

  const frame = shiftFrameOf(session);
  const { startMs, endMs } = clampWinToShift(
    new Date(order.opened_at).getTime(), new Date(order.confirmed_at).getTime(), frame);
  if (startMs == null || endMs == null || !(endMs > startMs)) return null;

  const brkIv = breakIntervalsIn({
    policies: breakPolicies, startMs, endMs,
    workDate: session?.work_date, shift: session?.shift || 'day', processType,
  });

  // นาที downtime ที่ทับช่วงใบนี้ — ตัดส่วนที่ทับเวลาพักออกก่อน ไม่งั้นหักซ้ำ (กฎเหล็ก oee.js §3.1)
  let dtMin = 0;
  for (const d of downtimes) {
    if (!d?.started_at) continue;
    const s0 = new Date(d.started_at).getTime();
    const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + (Number(d.duration_min) || 0) * 60000;
    const a = Math.max(s0, startMs), b = Math.min(e0, endMs);
    if (!(b > a)) continue;
    dtMin += Math.max(0, (b - a) / 60000 - overlapMinutesWith(a, b, brkIv));
  }

  const runMin = (endMs - startMs) / 60000
    - dtMin
    - brkIv.reduce((s, [a, b]) => s + (b - a) / 60000, 0);
  if (!(runMin > 0)) return null;
  return (runMin * 60) / qty;
}

/**
 * สรุป CT ที่สังเกตได้ต่อ MAT.NO จากใบผลิตหลายใบ
 *   rows: [{ order, session, downtimes }]  (downtimes = ของกะนั้น)
 * คืน { matNo, n, nDropped, p25, p50, p75, ctStd, gapPct, flags[] }
 */
export function summarizeObservedCt(matNo, rows = [], { ctStd = 0, breakPolicies = [], processType = null } = {}) {
  const samples = [];
  let nDropped = 0, nTooFast = 0, nTooSlow = 0;

  for (const r of rows) {
    const ct = observedCtOfOrder(r.order, {
      session: r.session, downtimes: r.downtimes || [], breakPolicies, processType,
    });
    if (ct == null) { nDropped++; continue; }
    if (ctStd > 0) {
      // ตัดใบที่ผลลัพธ์เป็นไปไม่ได้ทิ้ง — เกือบทั้งหมดคือข้อมูลผิด ไม่ใช่ฝีมือคน
      if (ct < ctStd * SAMPLE_RULES.MIN_RATIO_OF_STD) { nTooFast++; nDropped++; continue; }
      if (ct > ctStd * SAMPLE_RULES.MAX_RATIO_OF_STD) { nTooSlow++; nDropped++; continue; }
    }
    samples.push(ct);
  }

  const p50 = median(samples);
  const flags = [];
  if (samples.length < SAMPLE_RULES.MIN_ORDERS) flags.push('few_samples');
  if (nTooFast > 0) flags.push('dropped_impossible_fast');
  if (nTooSlow > 0) flags.push('dropped_impossible_slow');

  const gapPct = (ctStd > 0 && p50 != null) ? ((p50 - ctStd) / ctStd) * 100 : null;
  if (gapPct != null && Math.abs(gapPct) > SAMPLE_RULES.BIG_GAP_PCT) flags.push('big_gap');

  return {
    matNo,
    n: samples.length,
    nDropped, nTooFast, nTooSlow,
    p25: percentile(samples, 0.25),
    p50,
    p75: percentile(samples, 0.75),
    ctStd: ctStd || null,
    gapPct,
    flags,
    /** เสนอได้ก็ต่อเมื่อตัวอย่างพอ + มี CT มาตรฐานให้เทียบ + ตัวเลขต่างจริง */
    canPropose: samples.length >= SAMPLE_RULES.MIN_ORDERS && ctStd > 0 && p50 != null
                && Math.abs(p50 - ctStd) >= 0.5,
  };
}

/** ข้อความอธิบายธง — ให้จอกับเอกสารใช้ข้อความเดียวกัน ห้ามเขียนซ้ำในหน้า */
export const FLAG_TEXT = {
  few_samples:             'ตัวอย่างน้อยกว่า ' + SAMPLE_RULES.MIN_ORDERS + ' ใบ — ยังเสนอไม่ได้',
  dropped_impossible_fast: 'มีใบที่ได้ CT เร็วผิดปกติจนเป็นไปไม่ได้ ถูกตัดออก (มักมาจากลง downtime เกินจริง)',
  dropped_impossible_slow: 'มีใบที่ได้ CT ช้าผิดปกติ ถูกตัดออก (มักมาจากลืมปิดใบ)',
  big_gap:                 'ต่างจากมาตรฐานเกิน ' + SAMPLE_RULES.BIG_GAP_PCT + '% — ตรวจข้อมูลก่อนอนุมัติ ส่วนใหญ่เป็นข้อมูลผิดไม่ใช่ฝีมือ',
};
