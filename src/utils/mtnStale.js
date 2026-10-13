/* ═══════════════════════════════════════════════════════════════════════════
   ใบ MO ที่ "ค้างขั้นเดิม" นานเกินเกณฑ์ — pure (2026-10-13 · user อนุมัติ 12/10)

   ที่มา (วัดจริง 13/10 · DR `mtn_orders` · ใบที่ยังไม่ปิด 391 ใบ):
     ค้างขั้นเดิม ≥ 7 วัน **293 ใบ** · ≥ 15 วัน 212 · ≥ 30 วัน 21 · เก่าสุด **47 วัน**
     กองใหญ่สุด: `checked` ทีม production รอ QA/รับมอบ 230 ใบ (เกิน 7 วัน 188)
     · `pending` ทีม JIG MTN 28 ใบ (เกิน 7 วัน 26 · เกิน 30 วัน 12 — ยังไม่มีใครกดรับเลย)
   แนวโน้ม 4 วัน (09→13/10): ของเก่าข้ามเส้นเร็วกว่าที่ปิดได้ และ **ไม่มีจอไหนบอกใครเลย**
   (สรุปเช้า `mtn-daily-summary` มีชั้นอายุอยู่แล้ว แต่ไปทาง Telegram/กระดิ่ง — ไม่มีบนจอ)

   ─── 🔴 กฎที่ไฟล์นี้ยึด (ละเมิดข้อไหน = จอโกหกคนหน้างาน) ─────────────────────
   1. **"ค้างกี่วัน" = นับจากเวลาที่ใบ *เข้าขั้นปัจจุบัน* ไม่ใช่วันแจ้ง** (user เคาะ 13/10)
      วันแจ้งตอบได้แค่ "ใบนี้เก่า" — ใบที่เพิ่งถูกเลื่อนขั้นเมื่อวานก็ยังขึ้นแดงเพราะแจ้งมา 40 วัน
      ⚠️ สรุปเช้าฝั่ง edge นับจาก `report_at` ⇒ **2 ที่ตอบคนละเลขโดยเจตนา** (293 vs 305 เมื่อ 13/10)
         จอต้องเขียนกำกับว่านับจากอะไร ห้ามปล่อยให้คนเทียบกันเองแล้วคิดว่าเลขใดเลขหนึ่งผิด
   2. **แตกขั้นด้วย `stage` ไม่ใช่เลขขั้น** — เลขขั้นเดียวกันคนละความหมายระหว่างฟอร์ม
      JIG/DIE/PD (7 ขั้น) กับฟอร์มทีม MTN (8 ขั้น ไม่มี QA) **และด่านอนุมัติก่อนเริ่มงาน
      (`approve_first`) ไม่มีเลขขั้นเลย** ⇒ ถาม `moWaitMeta(order)` ของ `mtnStepPerm.js` ที่เดียว
      (คืน `{ stage, step, meta }` ครบ) — **ห้ามถามเลขขั้นเองที่นี่**
      (ด่าน `mo-step-branch-via-stage` + `mo-wait-stage-via-mowaitmeta`)
   3. **"ใบยังเปิดอยู่ไหม" ใช้ `isMoOpen`** ห้ามเขียนลิสต์สถานะเอง (`transferred` เคยตกหล่น)
   4. **รับ `now` เป็นพารามิเตอร์** — `npm test` รันรอบ "นาฬิกา +400 วัน" อ่าน `Date.now()` เอง = เทสระเบิดเวลา
   5. 🔴 **ไม่รู้ = ไม่เดา** — ไม่มีเวลาเข้าขั้น (ไม่ได้ select มา / ว่างจริง) ⇒ ถอยไปนับจากวันแจ้ง
      แล้วติดธง `exact:false` **และนับยอดไว้ให้จอเขียนบอก** · ไม่มีแม้วันแจ้ง ⇒ `days: null`
      **ห้ามคืน 0** (0 = "เพิ่งเข้าขั้น" ซึ่งโกหกในทางที่อันตรายที่สุด = ใบหลุดจากจอเตือน)
   6. **ใบที่ไม่อยู่ในลูปขั้น (`returned` · `waiting_vendor`) ห้ามหาย** — `moWaitMeta` คืน stage null
      ให้ 2 สถานะนี้โดยเจตนา (ตีกลับ = รอผู้แจ้งแก้แผนกแล้วส่งใหม่ · ส่งซ่อมนอก = นาฬิกาอยู่กับ
      supplier) ⇒ เก็บเป็นถัง `status:<สถานะ>` แยก ไม่ยุบรวมกับขั้นอื่น และไม่ตัดทิ้ง
   7. **สีมาจาก tone ไม่ใช่ hex** — คืน `'warn'`/`'bad'` ให้จอแปลงผ่าน `statusTone.js`
      (ด่าน `status-palette-single-source` · เกิน 7 วัน = warn เพราะสายยังเดิน · เกิน 30 วัน = bad
       — 13/10 มี 21 ใบ ⇒ แดงยังเป็นของหายาก ถ้าทำ 293 ใบเป็นแดงหมด คนเลิกมองทั้งจอ)
   ═══════════════════════════════════════════════════════════════════════════ */
import { isMoOpen, moWaitMeta, MO_STATUS_LABEL } from './mtnStepPerm.js';
/* ⚠️ `daysOpen` มีเจ้าของอยู่แล้วที่ `mtnDuplicate.js` (ทำไว้ตอนกล่องเตือนใบซ้ำ 30/09)
   — import มาใช้ ห้ามเขียนสูตรวันซ้ำ (มี 2 ตัว = พอปัดเศษคนละแบบ 2 จอตอบคนละเลข) */
import { daysOpen } from './mtnDuplicate.js';

/** เกณฑ์ "ค้างนาน" — 7 วันตามที่ user สั่ง · เท่ากับ `STUCK_DAYS` ของสรุปเช้า (เกณฑ์เดียวกันทั้งระบบ) */
export const STALE_DAYS = 7;
/** ชั้นที่ 2 "เลยเถิด" — 30 วัน (13/10 มี 21 ใบ) ⇒ แดงยังชี้เป้าได้ ไม่ใช่แดงทั้งจอ */
export const STALE_HARD_DAYS = 30;

/* ── stage → "ใบเข้าขั้นนี้เมื่อไหร่" ───────────────────────────────────────────
   ไล่ตามลำดับ: ตัวแรกที่มีค่าชนะ · ทุกตัวคือ "เวลาที่ขั้น**ก่อนหน้า**ถูกเซ็นจบ" = เวลาที่ใบมากอง
   รอขั้นนี้จริงๆ · 🔴 เพิ่มคอลัมน์ที่นี่ = **ต้องเติมใน `MO_LIST_COLS` ของ MtnRepair.jsx ด้วย**
   (ไม่ได้ select มา = ค่า undefined = ถอยไปนับจากวันแจ้งเงียบๆ · มีด่าน `mo-stale-since-cols`) */
const STAGE_SINCE = {
  /* 🔒 ด่านอนุมัติก่อนเริ่มงาน (ใบ improve/build · **ไม่มีเลขขั้น**) — รอตั้งแต่วันเปิดใบ
     ตามนิยามของ `isApprovalBlocked` คือ "ยังไม่มีลายเซ็น" ⇒ ไม่มีเวลาอื่นให้ยึดนอกจากวันแจ้ง */
  approve_first:  ['report_at'],
  assign:         ['report_at'],                              // เปิดใบแล้ว ยังไม่มีช่างกดรับ
  service:        ['repair_start_at', 'accept_at'],            // ช่างรับงานแล้ว (repair_start_at กรอกน้อย ⇒ ถอยไป accept_at)
  accept_work:    ['repair_done_at'],                          // ช่างซ่อมเสร็จ รอผู้แจ้งตรวจรับ
  qa:             ['check_at'],                                // ผู้แจ้งตรวจรับแล้ว รอ QA (ฟอร์ม JIG/DIE)
  handover:       ['qa_at', 'qa_skipped_at', 'check_at'],      // ผ่าน QA / QA กดข้าม / ฟอร์ม MTN ที่ไม่มี QA
  close:          ['ho_at'],                                   // รับมอบแล้ว รออนุมัติปิด (ฟอร์ม JIG/DIE ขั้น 7)
  mtn_head:       ['ho_at'],                                   // รับมอบแล้ว รอหัวหน้าแผนกช่างตรวจ (MTN ขั้น 6)
  mtn_approve:    ['mtn_head_at'],                             // หัวหน้าแผนกช่างเซ็นแล้ว รอ ผจก.ช่าง (MTN ขั้น 7)
  cost_mgr_close: ['approve_at'],                              // ผจก.ช่างเซ็นแล้ว รอ ผจก.ฝ่ายที่แจ้งปิดใบ (MTN ขั้น 8)
};
/** ใบที่ `moWaitMeta` คืน stage null โดยเจตนา — ยังเปิดอยู่แต่ไม่ได้รออยู่ใน "ลูปขั้น" (กฎข้อ 6) */
const STATUS_SINCE = {
  returned:       ['returned_at'],                             // ตีกลับ — รอผู้แจ้งแก้แผนกแล้วส่งใหม่
  waiting_vendor: ['vendor_sent_at'],                          // ของอยู่กับผู้รับจ้างภายนอก
};

/** ทุกคอลัมน์เวลาที่ไฟล์นี้อ่าน — ด่านใช้เทียบกับชุดคอลัมน์ที่หน้าลิสต์ select มา */
export const STALE_SINCE_COLS = Object.freeze([...new Set([
  ...Object.values(STAGE_SINCE).flat(), ...Object.values(STATUS_SINCE).flat(),
])]);

/**
 * ใบนี้ "เข้าขั้นปัจจุบัน" เมื่อไหร่
 * @returns {{ iso: string|null, field: string|null, exact: boolean }}
 *   `exact:false` = ไม่มีเวลาเข้าขั้นให้อ่าน จึงถอยไปใช้วันแจ้ง (= ตัวเลขจะ**เก่ากว่าความจริง**)
 */
export function stageSinceOf(order = {}) {
  const { stage } = moWaitMeta(order);
  const fields = (stage && STAGE_SINCE[stage]) || STATUS_SINCE[String(order?.status || '').trim()] || [];
  for (const f of fields) {
    if (order[f]) return { iso: order[f], field: f, exact: true };
  }
  // ถอยไปวันแจ้ง — ยังมีประโยชน์ (ใบเก่าแน่ๆ) แต่ต้องบอกจอว่าเป็นค่าประมาณ ห้ามเนียนเป็นของจริง
  if (order?.report_at) return { iso: order.report_at, field: 'report_at', exact: fields[0] === 'report_at' };
  return { iso: null, field: null, exact: false };
}

/**
 * อายุของการค้างที่ขั้นปัจจุบัน
 * @param {object} order แถว `mtn_orders` (ต้อง select คอลัมน์ใน `STALE_SINCE_COLS` + status มาด้วย)
 * @param {number} now   เวลาอ้างอิง (ms) — **ต้องส่งมาจากผู้เรียก** ดูกฎข้อ 4
 * @returns {{ stage: string|null, days: number|null, exact: boolean, since: string|null, field: string|null,
 *            title: string, icon: string }}  `days:null` = ตัดสินไม่ได้ (ห้ามแสดงเป็น 0)
 */
export function stageAgeOf(order = {}, now = Date.now()) {
  const { stage, meta } = moWaitMeta(order);
  const { iso, field, exact } = stageSinceOf(order);
  return {
    stage, days: daysOpen(iso, now), exact, since: iso, field,
    // ป้ายขั้นมาจาก `moWaitMeta().meta` เสมอ · ใบนอกลูปขั้นใช้ป้ายรวมของสถานะ (ไม่มีขั้นให้อ้าง)
    title: meta?.title || MO_STATUS_LABEL[String(order?.status || '').trim()] || 'ตัดสินไม่ได้',
    icon: meta?.icon || '•',
  };
}

/** ชั้นสีของอายุ — คืน tone ให้จอแปลงผ่าน `statusTone.js` ห้ามคืน hex (กฎข้อ 7) */
export function staleTone(days, { days: lim = STALE_DAYS, hardDays = STALE_HARD_DAYS } = {}) {
  if (days == null) return 'none';            // ตัดสินไม่ได้ = เทา ไม่ใช่เขียว
  if (days >= hardDays) return 'bad';
  if (days >= lim) return 'warn';
  return 'none';                              // ยังไม่ถึงเกณฑ์ = ไม่ใช่ "ดี" ที่ต้องทาเขียว เป็นแค่ปกติ
}

/** คีย์ถังของใบ — ขั้นที่รออยู่ · ใบนอกลูปขั้นแยกเป็น `status:<สถานะ>` (กฎข้อ 6) */
const bucketKeyOf = (o, stage) => stage || `status:${String(o?.status || '').trim() || 'unknown'}`;

/**
 * สรุป "ใบค้างขั้นเดิม" ของชุดใบที่ส่งมา
 *
 * ⚠️ ผู้เรียกต้องกรอง **ขอบเขตของผู้ใช้** (scope ส่วนงาน/ไลน์) มาก่อน แต่ **ห้ามกรองช่วงวันที่**
 *    — ใบค้างคือใบเก่าโดยนิยาม กรองวันที่ก่อนนับ = ยอดหายไปตามตัวกรองที่คนไม่ได้ตั้งใจ
 *    (กฎเดียวกับ "ของค้างเกินอายุแท็ก" ใน QualityBins · QC 05/10)
 *
 * @param {Array} orders ใบที่หน้าโหลดไว้แล้ว — **ไม่ยิงคิวรีเพิ่ม** (egress 0)
 * @param {object} opts  { now, days, hardDays, teamOf }
 *   · `teamOf(order)` = ตัวแปลงใบ → คีย์ทีมช่าง (ค่าเริ่มต้น `mtn_dept`) — ส่งเข้ามาเพื่อให้ไฟล์นี้
 *     ไม่ต้องรู้จักทะเบียนทีม (pure · เทสได้ตรงๆ)
 * @returns {object} ดู `byStage` / `byTeam` / `rows` ด้านล่าง
 */
export function buildMoStaleBoard(orders, {
  now = Date.now(), days = STALE_DAYS, hardDays = STALE_HARD_DAYS,
  teamOf = (o) => String(o?.mtn_dept || '').trim(),
} = {}) {
  const open = (Array.isArray(orders) ? orders : []).filter(o => o && isMoOpen(o));
  const stages = new Map(), teams = new Map();
  const rows = [];
  let stale = 0, hard = 0, approx = 0, unknown = 0, oldest = null;

  for (const o of open) {
    const age = stageAgeOf(o, now);
    const d = age.days;
    if (d == null) unknown += 1;
    else if (!age.exact) approx += 1;
    if (d != null && (oldest == null || d > oldest)) oldest = d;

    const isStale = d != null && d >= days;
    const isHard = d != null && d >= hardDays;
    if (isStale) { stale += 1; rows.push({ ...o, _stale: age, _tone: staleTone(d, { days, hardDays }) }); }
    if (isHard) hard += 1;

    const bump = (map, key, seed) => {
      const cur = map.get(key) || { ...seed, n: 0, stale: 0, hard: 0, unknown: 0, oldest: null };
      cur.n += 1;
      if (isStale) cur.stale += 1;
      if (isHard) cur.hard += 1;
      if (d == null) cur.unknown += 1;
      else if (cur.oldest == null || d > cur.oldest) cur.oldest = d;
      map.set(key, cur);
      return cur;
    };
    bump(stages, bucketKeyOf(o, age.stage), { stage: age.stage, key: bucketKeyOf(o, age.stage), title: age.title, icon: age.icon });
    bump(teams, teamOf(o) || '', { dept: teamOf(o) || '' });
  }

  /* เรียง "ค้างเยอะก่อน" แล้วค่อยยอดรวม — กองที่ต้องไปจัดการอยู่บนสุดเสมอ
     🔴 ใบที่นับวันไม่ได้ (`unknown`) ยังอยู่ใน `n` ของถัง — ตัดออกจากยอดรวมคือการซ่อนปัญหา */
  const bySize = (a, b) => (b.stale - a.stale) || (b.n - a.n);
  return {
    days, hardDays,
    open: open.length, stale, hard, approx, unknown, oldest,
    byStage: [...stages.values()].sort(bySize),
    byTeam: [...teams.values()].sort(bySize),
    // ใบค้างนานสุดขึ้นก่อน · ใบที่นับวันไม่ได้ไม่เข้า rows (ไม่รู้ว่าเกินเกณฑ์ไหม) แต่ถูกนับใน `unknown`
    rows: rows.sort((a, b) => (b._stale.days - a._stale.days) || String(a.mo_no || '').localeCompare(String(b.mo_no || ''))),
  };
}
