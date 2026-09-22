/* ═══ สูตรกลางของกราฟพาเรโต (Pareto) — pure + มีเทส ═══════════════════════════════════
   (แยกออกจาก `components/ParetoAbcChart.jsx` เมื่อ 2026-09-15 เพื่อให้เทสได้จริง —
    ตัวรันเทสรับเฉพาะ .mjs/.js · สูตรที่ฝังใน .jsx ไม่เคยถูกเทสเลย)

   ── Pareto chart ที่ถูกต้องตามสากล (ASQ · Juran · IATF core tools) ต้องมีครบ 4 อย่าง ──
     1. แท่งเรียงจากมากไปน้อย                        ← มีอยู่แล้ว
     2. **เส้นสะสม % (cumulative line)** ไต่ตามแท่ง   ← `_cum` / `_cumPrev` ในไฟล์นี้
     3. **เส้น 80% cut-off** แยก vital few ออกจาก trivial many
     4. **แกน % กำกับ** ให้อ่านเส้นสะสมออกโดยไม่ต้อง hover (จอ TV ไม่มี hover)
   เดิมโค้ดคำนวณ `_cum` ไว้แล้วแต่ **โชว์แค่ใน tooltip/ตาราง ไม่เคยวาดลงกราฟ**
   ⇒ สิ่งที่เรียกว่า "พาเรโต" ทั้งระบบเป็นแค่ *ranked bar chart* (feedback user 2026-09-15)

   ⚠️ แกนของกราฟแท่งนอนมี **2 สเกล** (เหมือน Pareto แท่งตั้งที่มีแกนซ้าย/ขวา):
      · ความยาวแท่ง = ค่า ÷ ค่าสูงสุด  (เทียบรายการต่อรายการได้ถนัด)
      · เส้นสะสม    = % ของยอดรวม 0–100 บนความกว้างรางเดียวกัน
      ⇒ **ต้องมีแกน % กำกับเสมอ** ไม่งั้นคนอ่านจะนึกว่าเส้นกับแท่งใช้สเกลเดียวกัน   */

/** จัดกลุ่ม ABC + คำนวณ % และ % สะสม จากรายการที่ยังไม่เรียง
 *  คืนรายการที่ "เรียงมาก→น้อยแล้ว" พร้อมฟิลด์:
 *    `_val` ค่า · `_pct` % ของยอดรวม · `_cumPrev` % สะสมก่อนถึงรายการนี้ · `_cum` % สะสมถึงรายการนี้
 *    `_cls` กลุ่ม ABC — A = สะสมถึง 80% แรก · B = 80–95% · C = 5% สุดท้าย
 *  รายการแรกเป็น A เสมอ (กันเคสรายการเดียวกินเกิน 80% แล้วกลายเป็นไม่มีกลุ่ม A) */
export function classifyAbc(items, valueOf) {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const total = sorted.reduce((s, d) => s + (valueOf(d) || 0), 0);
  let run = 0;
  return sorted.map((d, i) => {
    const v = valueOf(d) || 0;
    const cumPrev = total > 0 ? (run / total) * 100 : 0;
    run += v;
    return {
      ...d,
      _val: v,
      _pct: total > 0 ? (v / total) * 100 : 0,
      _cumPrev: cumPrev,
      _cum: total > 0 ? (run / total) * 100 : 0,
      _cls: i === 0 || cumPrev < 80 ? 'A' : cumPrev < 95 ? 'B' : 'C',
    };
  });
}

/** ขีดแกน % สะสม — คงที่ทุกกราฟ เพื่อให้คนอ่านเทียบข้ามกราฟได้โดยไม่ต้องอ่านเลขใหม่ทุกครั้ง */
export const PARETO_TICKS = Object.freeze([0, 25, 50, 75, 100]);

/** เส้น cut-off มาตรฐานของ Pareto (กฎ 80/20) */
export const PARETO_CUTOFF = 80;

/** รายการสุดท้ายที่ยังอยู่ใน 80% แรก — ใช้ลากเส้น cut-off ให้ตรงรอยต่อ A→B
 *  คืน index (-1 = ไม่มีรายการเลย) */
export function cutoffIndex(rows, cutoff = PARETO_CUTOFF) {
  if (!rows?.length) return -1;
  const i = rows.findIndex(r => r._cum >= cutoff);
  return i === -1 ? rows.length - 1 : i;
}

/** สัดส่วนที่ "บอกอะไรไม่ได้" ในชุดข้อมูล (อื่นๆ / ไม่ระบุ / ว่าง)
 *  พาเรโตที่ 90% เป็นถังขยะ = ชี้เป้าไม่ได้ ต่อให้วาดสวยแค่ไหน ⇒ ต้องเตือนบนจอ
 *  (เคสจริง 2026-09-15: KPI ใบซ่อม MTN มี "ไม่ระบุกลุ่ม" 224 + "อื่นๆ" 89 จาก 319 ใบ = 98%) */
const VAGUE_RE = /^\s*$|อื่น\s*ๆ?|ไม่ระบุ|ไม่ทราบ|^n\/?a$|^-+$|^other?s?$|^etc\.?$|^unknown$/i;
export const isVagueLabel = (name) => VAGUE_RE.test(String(name ?? '').trim());

/** @returns {{ vagueVal:number, total:number, pct:number, names:string[] }} */
export function vagueShare(rows) {
  const total = (rows || []).reduce((s, r) => s + (r._val || 0), 0);
  const vague = (rows || []).filter(r => isVagueLabel(r.name));
  const vagueVal = vague.reduce((s, r) => s + (r._val || 0), 0);
  return {
    vagueVal,
    total,
    pct: total > 0 ? (vagueVal / total) * 100 : 0,
    names: vague.map(r => r.name),
  };
}

/* ═══ 📐 เรขาคณิตของ Pareto "แท่งตั้ง" ตามมาตรฐานสากล (2026-09-22 · คำสั่ง user) ═════════
   ที่มา: user เทียบกราฟของเรากับ Pareto มาตรฐาน (Excel · ASQ · QI Macros) แล้วบอกว่า
   *"ยังเทียบกันไม่ติดเลย ... แนวนอนไม่เวิค เป็นแนวตั้งและเอียง text เอา"*

   ── องค์ประกอบบังคับของ Pareto สากล (ครบทุกข้อ ขาดข้อใดข้อหนึ่ง = ไม่ใช่ Pareto) ──
     1. แท่ง**ตั้ง** เรียงมาก→น้อย
     2. **แท่งชิดกัน ไม่มีช่องว่าง** — จงใจ ต่างจาก bar chart ทั่วไปที่แท่งห่างกัน
        (แท่งชิด = สื่อว่าเป็น "การแบ่งส่วนของก้อนเดียวกัน" ไม่ใช่ของคนละเรื่องมาเทียบกัน)
     3. **แกนซ้าย = ค่า เริ่มที่ 0 เสมอ** (ตัดฐานไม่ได้ — สัดส่วนความสูงคือสาระของกราฟ)
     4. **แกนขวา = % สะสม 0–100** · เส้นสะสมเริ่มที่มุมล่างซ้าย (0%) แล้วปักหมุดที่
        **ขอบขวาของแต่ละแท่ง** → หมุดสุดท้ายแตะ 100% พอดีที่ขอบขวาของแท่งสุดท้าย
        (ปักกลางแท่งจะทำให้หมุดสุดท้ายไม่ถึง 100% = อ่านผิด)
     5. เส้น cut-off 80% แยก vital few / trivial many

   ⚠️ ฟังก์ชันนี้ **pure** — คืนพิกัดล้วนๆ ไม่แตะ DOM/React เพื่อให้เทสได้จริง
      (บทเรียนเดิมของไฟล์นี้: สูตรที่ฝังใน .jsx ไม่เคยถูกเทสเลย)                        */

import { charWidthEm } from '../lib/pptxFit.js';   // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)

/** ความกว้างข้อความเป็น px (รู้จักสระ/วรรณยุกต์ไทยที่ลอยบนตัวอื่น = กว้าง 0) */
export function labelWidthPx(text, fontPx) {
  let em = 0;
  for (const ch of String(text ?? '')) em += charWidthEm(ch);
  return em * fontPx;
}

/** ขั้นแกนที่ "อ่านสวย" — 1 / 2 / 2.5 / 5 × 10^k
 *  (สูตรเดียวกับ `qc7.niceStep` แต่ copy มาเพื่อไม่ให้ utils 2 ตัวผูกกัน — มีเทสคุมทั้งคู่) */
export function niceAxisStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** มุมเอียงป้ายแกน X ที่ "พอดี" กับพื้นที่ — 0 → -45 → -90
 *  user สั่ง: *"เอียง text เอา ให้ 90 องศาก็ได้นะ เอียงอ่านก็ยังได้"*
 *  ⇒ เอียงเมื่อแนวนอนไม่พอ **ห้ามย่อฟอนต์ต่ำกว่าเพดานจอ TV (11px) และห้ามตัดคำทิ้งเงียบๆ** */
export function pickLabelAngle(labels, barW, fontPx, { min = 11 } = {}) {
  const longest = Math.max(0, ...(labels || []).map(s => labelWidthPx(s, fontPx)));
  if (longest <= barW - 4) return 0;          // แนวนอนพอดี
  if (labels.length <= 14) return -45;        // เอียงอ่านยังสบาย
  return -90;                                  // แท่งเยอะ/ชื่อยาว → ตั้งฉาก
}

/** ความสูงที่ป้ายแกน X กินเมื่อเอียง `angle` องศา */
export function labelBandHeight(labels, angle, fontPx) {
  const longest = Math.max(0, ...(labels || []).map(s => labelWidthPx(s, fontPx)));
  if (!angle) return fontPx * 1.6 + 6;
  const rad = Math.abs(angle) * Math.PI / 180;
  return Math.min(longest, 240) * Math.sin(rad) + fontPx * 0.9 + 6;
}

/**
 * พิกัดทุกชิ้นของกราฟ Pareto แท่งตั้ง
 * @param {Array} rows  แถวที่ผ่าน `classifyAbc` แล้ว (เรียงมาก→น้อย · มี `_val`/`_cum`/`_cls`)
 * @returns bars · line (หมุด % สะสม) · leftTicks · rightTicks · cutoffY · cutoffX · base …
 */
export function paretoGeometry(rows, opts = {}) {
  const {
    width = 720, height = 320,
    padLeft = 56, padRight = 54, padTop = 26, padBottom = 90,
    cutoff = PARETO_CUTOFF, tickCount = 5,
  } = opts;
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = Math.max(10, height - padTop - padBottom);
  const base = padTop + plotH;
  const pctY = (p) => base - (Math.max(0, Math.min(100, p)) / 100) * plotH;
  const n = rows?.length || 0;

  if (!n) {
    return { bars: [], line: [], leftTicks: [], rightTicks: [], cutoffY: pctY(cutoff),
      cutoffX: padLeft, barW: 0, base, plotW, plotH, padLeft, padRight, padTop, padBottom, width, height, yMax: 0 };
  }

  // แกนซ้าย: เริ่ม 0 เสมอ · เพดานปัดขึ้นให้ลงตัวกับขั้นที่อ่านสวย
  const maxV = Math.max(0, ...rows.map(r => Number(r._val) || 0));
  const step = niceAxisStep((maxV || 1) / tickCount);
  const yMax = Math.max(step, Math.ceil((maxV || 1) / step) * step);

  const barW = plotW / n;
  const bars = rows.map((r, i) => {
    const v = Number(r._val) || 0;
    const h = yMax > 0 ? (v / yMax) * plotH : 0;
    return { i, row: r, cls: r._cls, value: v, x: padLeft + i * barW, w: barW, y: base - h, h };
  });

  /* เส้นสะสม: เริ่มมุมล่างซ้าย (0%) → หมุดที่ "ขอบขวา" ของแต่ละแท่ง
     ⇒ หมุดสุดท้าย = 100% ที่ขอบขวาสุดพอดี (ตรงกับ Excel/QI Macros) */
  const line = [{ x: padLeft, y: base, pct: 0, origin: true },
    ...rows.map((r, i) => ({ i, row: r, x: padLeft + (i + 1) * barW, y: pctY(r._cum), pct: r._cum }))];

  const leftTicks = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) leftTicks.push({ value: v, y: base - (v / yMax) * plotH });

  const ci = cutoffIndex(rows, cutoff);
  return {
    bars, line, leftTicks,
    rightTicks: PARETO_TICKS.map(p => ({ pct: p, y: pctY(p) })),
    cutoffY: pctY(cutoff),
    cutoffX: padLeft + (ci + 1) * barW,   // รอยต่อ A→B (ขอบขวาของแท่ง A ตัวสุดท้าย)
    cutoffIdx: ci,
    barW, base, plotW, plotH, padLeft, padRight, padTop, padBottom, width, height, yMax, step,
  };
}

/** ยุบหางยาวเป็นแท่งเดียว (แท่ง "Other" ตามมาตรฐาน) แล้วจัด ABC ใหม่
 *  ⚠️ ตั้งชื่อว่า "หางยาว (n)" **ห้ามใช้คำว่า "อื่นๆ"** — คำนั้นชนกับหมวด "อื่นๆ" ที่มาจากข้อมูลจริง
 *     ซึ่ง `isVagueLabel` ใช้จับว่าข้อมูลกำกวม ⇒ ใช้ซ้ำ = ตัวเตือน "ชี้เป้าไม่ได้" เพี้ยน */
export function collapseTail(rows, maxBars) {
  /* ⚠️ ยุบเฉพาะเมื่อ "คุ้ม" — หางเหลือ 1-2 รายการแล้วยุบ จะได้แท่งรวมที่**สูงกว่าแท่งก่อนหน้า**
     ทั้งที่ Pareto ต้องดูเรียงมาก→น้อย ⇒ คนอ่านนึกว่ากราฟไม่ได้เรียง (เจอจริง 22/09: หางยาว 2 = 27
     แต่แท่งก่อนหน้า 15-16) · ยุบ 1 แถวเพื่อได้ 1 แถวคืนก็ไม่ได้อะไรอยู่แล้ว */
  if (!rows?.length || !maxBars || rows.length <= maxBars + 1) return { rows: rows || [], tail: null };
  const head = rows.slice(0, maxBars - 1);
  const tail = rows.slice(maxBars - 1);
  const val = tail.reduce((s, r) => s + (Number(r._val) || 0), 0);
  const last = rows[rows.length - 1];
  return {
    rows: [...head, {
      name: `หางยาว (${tail.length})`, _val: val, _tail: true, _tailRows: tail,
      _pct: tail.reduce((s, r) => s + (r._pct || 0), 0),
      _cumPrev: head.length ? head[head.length - 1]._cum : 0,
      _cum: last?._cum ?? 100,
      _cls: 'C',
    }],
    tail,
  };
}
