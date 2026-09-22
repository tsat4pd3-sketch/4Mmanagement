/* ═══════════════════════════════════════════════════════════════════════════
   QC 7 Tools — สูตรกลาง (pure ล้วน · มีเทส)                         2026-09-22

   ที่มา (คำสั่ง user): *"หมวด mtn ยังไม่มีพวก dashboard ปัญหา เครื่องจักร/แม่พิมพ์/jig fixture
   เลย สรุปปัญหา ระบบวิเคราะห์ qc7tools ยังไม่เห็น"*

   เครื่องมือ QC 7 อย่างตามสากล (JUSE / ASQ / IATF core tools) กับสถานะในระบบ:
     ① ใบตรวจสอบ (Check sheet)      → `checkSheet()`    ที่นี่
     ② พาเรโต (Pareto)              → `components/ParetoAbcChart.jsx` + `utils/pareto.js` (มีอยู่แล้ว)
     ③ ผังก้างปลา (Cause & Effect)   → `fishbone()`      ที่นี่ (แกน 4M/6M)
     ④ ฮิสโตแกรม (Histogram)         → `histogram()`     ที่นี่
     ⑤ ผังกระจาย (Scatter)           → `scatter()`       ที่นี่ (+ สหสัมพันธ์ r)
     ⑥ กราฟควบคุม (Control chart)    → `controlChartXmR()` ที่นี่ (XmR / Individuals-MR)
     ⑦ กราฟ/เลเยอร์ (Graph·Stratify) → `runChart()` · `stratify()` ที่นี่

   🔴 กติกาที่ต้องรักษาทั้งไฟล์ (กฎความซื่อสัตย์ของจอ — CLAUDE.md):
      · **ข้อมูลไม่พอ ต้องคืน `null` พร้อม `reason` ห้ามคืน 0 หรือกราฟเปล่า**
        (0 = "วัดแล้วได้ศูนย์" ซึ่งคนละเรื่องกับ "ยังวัดไม่ได้" — ผู้ตรวจสอบอ่านผิดทันที)
      · ทุกฟังก์ชันคืนจำนวนตัวอย่าง `n` เสมอ เพื่อให้จอบอกได้ว่าตัดสินจากกี่จุด
      · ห้าม import อะไรที่แตะ supabase — ไฟล์นี้ต้อง import ได้จาก `node --test` ตรงๆ
   ═══════════════════════════════════════════════════════════════════════════ */

/* ⚠️ กับดัก: พารามิเตอร์ตัวดึงค่าชื่อ `valOf` **ห้ามตั้งชื่อว่า `valueOf`** —
   `valueOf`/`toString` เป็นเมธอดของ `Object.prototype` ⇒ destructure ที่มี default
   (`function f(x, { valueOf = v => v } = {})`) จะได้ **เมธอดที่สืบทอดมา** ไม่ใช่ default
   แล้วพังด้วย "Cannot convert undefined or null to object" ตอนเรียก .map(valueOf)
   (เจอจริงตอนเขียนไฟล์นี้ 22/09 — เทส 16 เคสตกพร้อมกัน) */

/** ตัวเลขที่ "ใช้ได้จริง" — '' / null / NaN / Infinity = ไม่รู้ (ไม่ใช่ 0) */
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const nums = (arr, valOf = (x) => x) =>
  (arr || []).map(valOf).map(num).filter(v => v !== null);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const quantile = (sorted, p) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
/** ปัดขอบถังให้เป็นเลขที่คนอ่านออก (1 / 2 / 2.5 / 5 × 10^k) — ถังกว้าง 7.3194 นาที ไม่มีใครอ่าน
 *  ⚠️ ต้องมีขั้น **2.5** ในบันได ไม่งั้นความกว้างแถวๆ 2.3 จะกระโดดไป 5 แล้วข้อมูลที่ช่วงแคบ
 *     (เช่นใบซ่อมปกติ 10-17 นาที) เหลือแค่ 2 ถัง = ดูการกระจายไม่ออก */
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/* ═══ ④ ฮิสโตแกรม ═══════════════════════════════════════════════════════════
   ความกว้างถัง = Freedman–Diaconis (2·IQR/∛n) ซึ่งทนค่าสุดโต่งกว่า Sturges
   ⇒ สำคัญมากกับข้อมูลซ่อมบำรุง: MTTR มีหางยาว (ใบเดียว 313 ชม. จากการรอ supplier)
     ถ้าใช้ Sturges ถังจะกว้างจนใบปกติกองอยู่ถังเดียว อ่านการกระจายไม่ออก
   IQR = 0 (ค่าซ้ำกันหมด) → ถอยไป Sturges · ยังไม่ได้อีก → ถังเดียว           */
export function histogram(values, { valOf = (x) => x, minN = 5, maxBins = 30 } = {}) {
  const xs = nums(values, valOf).sort((a, b) => a - b);
  const n = xs.length;
  if (n < minN) return { ok: false, n, reason: `ต้องมีอย่างน้อย ${minN} จุดจึงจะดูการกระจายได้ (มี ${n})` };
  const lo = xs[0], hi = xs[n - 1];
  if (hi === lo) return { ok: false, n, reason: `ทุกค่าเท่ากันหมด (${lo}) — ไม่มีการกระจายให้ดู` };

  const iqr = quantile(xs, 0.75) - quantile(xs, 0.25);
  const fd = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : 0;
  const sturges = (hi - lo) / (Math.ceil(Math.log2(n)) + 1);
  const step = niceStep(fd > 0 ? fd : sturges);

  /* 🔴 ค่าสุดโต่งห้ามทำให้ถังกว้างจนอ่านไม่ออก — เคสจริงของงานซ่อม: ใบเดียวรอ supplier 313 ชม.
     ท่ามกลางใบปกติ 10-20 นาที · ถ้าขยายถังให้คลุมถึง 18,000 นาที ใบปกติทั้งหมดจะกองอยู่ถังเดียว
     = ฮิสโตแกรมบอกอะไรไม่ได้เลย ⇒ ตัดแกนที่ `maxBins` ถัง แล้วเก็บส่วนเกินไว้ใน **ถังล้น**
     ที่ต้องวาดและนับให้เห็น (`overflow: true`) — **ห้ามทิ้งเงียบ** ค่าสุดโต่งคือสิ่งที่ต้องไปตามต่อ */
  const start = Math.floor(lo / step) * step;
  const maxEdge = start + step * maxBins;
  const bins = [];
  for (let b = start; b < Math.min(hi, maxEdge) + step / 2 && bins.length < maxBins; b += step) {
    bins.push({ from: b, to: b + step, count: 0, values: [], overflow: false });
  }
  const over = { from: bins.length ? bins[bins.length - 1].to : maxEdge, to: hi, count: 0, values: [], overflow: true };
  xs.forEach(x => {
    if (x >= over.from) { over.count++; over.values.push(x); return; }
    let i = Math.floor((x - start) / step);
    if (i < 0) i = 0;
    if (i >= bins.length) i = bins.length - 1;
    bins[i].count++; bins[i].values.push(x);
  });
  // ตัดถังว่างหัว-ท้ายทิ้ง (ไม่ต้องลากรางเปล่ายาวๆ) — ถังว่าง "ตรงกลาง" ต้องเหลือไว้ นั่นคือช่องว่างจริง
  while (bins.length && bins[bins.length - 1].count === 0) bins.pop();
  while (bins.length && bins[0].count === 0) bins.shift();
  if (over.count) bins.push(over);

  const m = mean(xs);
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : null;
  return {
    ok: true, n, bins, step, min: lo, max: hi, mean: m, sd,
    median: quantile(xs, 0.5), p95: quantile(xs, 0.95),
    peak: Math.max(...bins.map(b => b.count)),
    outliers: over.count,      // จำนวนที่ตกถังล้น — จอต้องบอกว่ามีกี่ตัวและสูงสุดเท่าไหร่
  };
}

/* ═══ ⑥ กราฟควบคุม — XmR (Individuals & Moving Range) ════════════════════════
   ทำไม XmR ไม่ใช่ X̄-R: ข้อมูลซ่อมบำรุงเป็น "เหตุการณ์เดี่ยว" (1 ใบ = 1 ค่า)
   ไม่มี subgroup ให้เฉลี่ย ⇒ X̄-R ใช้ไม่ได้ · XmR เป็นมาตรฐานสำหรับ n=1
     CL  = X̄
     UCL = X̄ + 2.66·mR̄      (2.66 = 3/d2 เมื่อ d2 = 1.128 ที่ n=2)
     LCL = X̄ − 2.66·mR̄      (ตัดที่ 0 เมื่อค่าที่วัดเป็นลบไม่ได้ เช่น "นาที"/"จำนวนครั้ง")
   🔴 LCL ติดลบกับข้อมูลที่ติดลบไม่ได้ **ต้อง clamp เป็น 0 และบอกบนจอว่า clamp**
      ไม่งั้นคนอ่านว่า "ยังมีที่ให้ลดอีก −30 นาที" ซึ่งไม่มีความหมาย
   สัญญาณที่จับ (Nelson rule ชุดย่อที่ใช้ได้จริงกับ n น้อย):
     1 จุดหลุด UCL/LCL · 7 จุดติดกันอยู่ข้างเดียวของเส้นกลาง · 7 จุดติดกันไต่ทางเดียว */
export const XMR_E2 = 2.66;
export const RUN_LEN = 7;

export function controlChartXmR(points, { valOf = (p) => p.value, labelOf = (p) => p.label, minN = 8, nonNegative = true } = {}) {
  const rows = (points || []).map(p => ({ label: labelOf(p), value: num(valOf(p)), raw: p }))
    .filter(r => r.value !== null);
  const n = rows.length;
  if (n < minN) return { ok: false, n, reason: `กราฟควบคุมต้องมีอย่างน้อย ${minN} จุดจึงจะตั้งขีดจำกัดได้ (มี ${n})` };

  const xs = rows.map(r => r.value);
  const cl = mean(xs);
  const mrs = xs.slice(1).map((x, i) => Math.abs(x - xs[i]));
  const mrBar = mean(mrs);
  if (!(mrBar > 0)) return { ok: false, n, reason: 'ทุกช่วงเวลาได้ค่าเท่ากันหมด — ยังไม่มีความผันแปรให้คุม' };

  const rawLcl = cl - XMR_E2 * mrBar;
  const lclClamped = nonNegative && rawLcl < 0;
  const lcl = lclClamped ? 0 : rawLcl;
  const ucl = cl + XMR_E2 * mrBar;

  const signals = [];
  rows.forEach((r, i) => {
    if (r.value > ucl) signals.push({ i, kind: 'above', text: `${r.label}: สูงกว่าขีดควบคุมบน` });
    else if (!lclClamped && r.value < lcl) signals.push({ i, kind: 'below', text: `${r.label}: ต่ำกว่าขีดควบคุมล่าง` });
  });
  // 7 จุดติดกันข้างเดียวของเส้นกลาง
  let side = 0, sideRun = 0;
  rows.forEach((r, i) => {
    const s = r.value > cl ? 1 : r.value < cl ? -1 : 0;
    if (s !== 0 && s === side) sideRun++; else { side = s; sideRun = s === 0 ? 0 : 1; }
    if (sideRun >= RUN_LEN) signals.push({ i, kind: 'shift', text: `${r.label}: ${RUN_LEN} จุดติดกันอยู่${side > 0 ? 'เหนือ' : 'ใต้'}เส้นกลาง (แนวโน้มเปลี่ยนระดับ)` });
  });
  // 7 จุดติดกันไต่ทางเดียว
  let dir = 0, dirRun = 1;
  for (let i = 1; i < rows.length; i++) {
    const d = Math.sign(rows[i].value - rows[i - 1].value);
    if (d !== 0 && d === dir) dirRun++; else { dir = d; dirRun = d === 0 ? 1 : 2; }
    if (dirRun >= RUN_LEN) signals.push({ i, kind: 'trend', text: `${rows[i].label}: ไต่${dir > 0 ? 'ขึ้น' : 'ลง'}ติดกัน ${RUN_LEN} จุด` });
  }
  return { ok: true, n, rows, cl, ucl, lcl, lclClamped, mrBar, signals, inControl: signals.length === 0 };
}

/* ═══ ⑤ ผังกระจาย + สหสัมพันธ์ ══════════════════════════════════════════════
   r = Pearson · คืน null เมื่อแกนใดแกนหนึ่งไม่มีความผันแปร (หารศูนย์)
   ⚠️ **r ไม่ใช่เหตุผล** — จอที่โชว์ต้องเขียนกำกับว่าเป็นความสัมพันธ์ ไม่ใช่สาเหตุ */
export function pearson(pairs) {
  const ps = (pairs || []).filter(p => num(p.x) !== null && num(p.y) !== null)
    .map(p => ({ x: Number(p.x), y: Number(p.y) }));
  const n = ps.length;
  if (n < 3) return null;
  const mx = mean(ps.map(p => p.x)), my = mean(ps.map(p => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  ps.forEach(p => { const dx = p.x - mx, dy = p.y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; });
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** ความแรงของ r เป็นคำพูด — จอต้องพูดเหมือนกันทุกที่ */
export function corrLabel(r) {
  if (r == null) return 'ประเมินไม่ได้';
  const a = Math.abs(r);
  const dir = r > 0 ? 'ทางเดียวกัน' : 'ทางตรงข้าม';
  if (a < 0.3) return 'แทบไม่สัมพันธ์กัน';
  if (a < 0.5) return `สัมพันธ์กันเล็กน้อย (${dir})`;
  if (a < 0.7) return `สัมพันธ์กันปานกลาง (${dir})`;
  return `สัมพันธ์กันสูง (${dir})`;
}

export function scatter(records, { xOf, yOf, labelOf = () => '', minN = 5 } = {}) {
  const pts = (records || []).map(r => ({ x: num(xOf(r)), y: num(yOf(r)), label: labelOf(r), raw: r }))
    .filter(p => p.x !== null && p.y !== null);
  const n = pts.length;
  if (n < minN) return { ok: false, n, reason: `ผังกระจายต้องมีอย่างน้อย ${minN} จุด (มี ${n})` };
  const r = pearson(pts);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return {
    ok: true, n, points: pts, r, rText: corrLabel(r),
    xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys),
  };
}

/* ═══ ③ ผังก้างปลา — แกน 4M (+E, +Measurement = 6M) ═════════════════════════
   🔴 ทำไมต้องเดาแกนจากข้อความ: ฐานจริง 22/09/2026 มี `cause_category` แค่ **5 จาก 473 ใบ**
      (1%) ⇒ ก้างปลาที่ปั้นจากช่องนั้นอย่างเดียวจะว่างเปล่าทั้งผัง = จอโกหกว่า "ไม่มีปัญหา"
   ⇒ ลำดับ: ① ใช้ `cause_category` ที่คนเลือกไว้จริงก่อนเสมอ (ข้อเท็จจริง)
            ② ไม่มี → เดาจากคำในข้อความสาเหตุ/อาการ (`guessBone`)
            ③ เดาไม่ออก → ลงกระดูก `unknown` **ที่ต้องโชว์บนผัง ห้ามซ่อน**
      แถวที่ "เดามา" ถูกนับแยก (`guessed`) ให้จอบอกได้ว่าผังนี้เชื่อได้แค่ไหน */
export const BONES = [
  { key: 'man',      label: 'คน (Man)',            icon: '🧑‍🏭' },
  { key: 'machine',  label: 'เครื่องจักร (Machine)', icon: '⚙️' },
  { key: 'material', label: 'วัสดุ/อะไหล่ (Material)', icon: '📦' },
  { key: 'method',   label: 'วิธีการ (Method)',      icon: '📋' },
  { key: 'measure',  label: 'การวัด (Measurement)',  icon: '📏' },
  { key: 'env',      label: 'สภาพแวดล้อม (Environment)', icon: '🌤' },
  { key: 'unknown',  label: 'ยังระบุไม่ได้',          icon: '❓' },
];
export const BONE_KEYS = BONES.map(b => b.key);

/* คำที่ใช้เดาแกน — **ลำดับสำคัญ** ตรวจจากแกนที่คำเฉพาะเจาะจงที่สุดไปหากว้างที่สุด
   measure → man → method → material → env → machine
   เหตุผลของลำดับนี้ (เจอตอนเขียนเทส): คำกว้างของแกนหลังจะกลืนประโยคของแกนหน้า เช่น
     · "ขาด" (material) กลืน "ขาดทักษะ" ที่ควรเป็น man  ⇒ man ต้องมาก่อน material
     · "ช่าง" (คนซ่อม) ปนกับ man ⇒ ย้ายไปท้ายสุดใน machine (ประโยคที่พูดถึงช่างมักเล่าอาการเครื่อง)
     · "ไม่ได้ทำ" เป็นเรื่องของ **วิธีทำงาน/แผน** ไม่ใช่ตัวคน ⇒ อยู่ method
   ⚠️ เป็นการ **เดา** ไม่ใช่การตัดสิน · เพิ่มคำได้ตามศัพท์หน้างาน แต่ห้ามเอาไปใช้เขียนลง DB */
const BONE_WORDS = [
  ['measure',  ['เกจ', 'gauge', 'คาลิเบร', 'calibrat', 'สอบเทียบ', 'วัดค่า', 'เซนเซอร์', 'sensor', 'เกินสเปค', 'ค่าเพี้ยน']],
  ['man',      ['พนักงาน', 'ผู้ปฏิบัติ', 'operator', 'ลืม', 'ทำผิด', 'ประมาท', 'ขาดทักษะ', 'ไม่ชำนาญ', 'มือใหม่', 'ตั้งผิด', 'ใส่ผิด', 'ประกอบผิด']],
  ['method',   ['วิธี', 'ขั้นตอน', ' wi', 'sop', 'มาตรฐาน', 'setup', 'เซ็ตอัพ', 'ปรับตั้ง', 'แผน', 'pm', 'บำรุงรักษา', 'ไม่ได้ตรวจ', 'ไม่ได้ทำ']],
  ['material', ['อะไหล่', 'ชิ้นส่วน', 'วัสดุ', 'ลูกปืน', 'bearing', 'สายพาน', 'belt', 'ซีล', 'seal', 'น้ำมัน', 'จาระบี', 'หมดอายุ', 'สึกหรอ', 'สึก', 'ขาด', 'แตก', 'หัก', 'ฉีก', 'รั่ว']],
  ['env',      ['ฝุ่น', 'ความชื้น', 'ชื้น', 'อุณหภูมิ', 'ร้อน', 'น้ำท่วม', 'ไฟดับ', 'ไฟตก', 'แรงดันไฟ', 'สภาพแวดล้อม', 'สกปรก']],
  ['machine',  ['เครื่อง', 'มอเตอร์', 'motor', 'ไฮดรอลิ', 'hydraulic', 'นิวเมติก', 'ลม', 'วาล์ว', 'valve', 'ปั๊ม', 'pump', 'แม่พิมพ์', 'die', 'จิ๊ก', 'jig', 'fixture', 'เกียร์', 'โซ่', 'chain', 'ไฟฟ้า', 'electric', 'plc', 'เบรก', 'สวิตช์', 'ช่าง']],
];

/** เดาแกนก้างปลาจากข้อความ — คืน key ของแกน หรือ 'unknown' */
export function guessBone(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return 'unknown';
  for (const [bone, words] of BONE_WORDS) if (words.some(w => s.includes(w))) return bone;
  return 'unknown';
}

/** ใช้ค่าที่คนเลือกไว้ก่อนเสมอ แล้วค่อยเดา — `category` = mtn_orders.cause_category */
export function boneOf(category, text) {
  const c = String(category || '').trim().toLowerCase();
  if (c === 'man') return { bone: 'man', guessed: false };
  if (c === 'method') return { bone: 'method', guessed: false };
  if (c === 'part_life') return { bone: 'material', guessed: false };
  // 'other' = คนเลือกแล้วว่า "อื่นๆ" แต่ยังไม่บอกว่าอะไร ⇒ ยังเดาจากข้อความต่อได้ (ไม่ใช่คำตอบสุดท้าย)
  const g = guessBone(text);
  return { bone: g, guessed: true };
}

/**
 * ผังก้างปลา — จัดแถวเข้าแกน 4M/6M
 * @returns {{ bones: Array<{key,label,icon,count,value,guessed,items}>, n, guessed, guessRate }}
 */
export function fishbone(records, { categoryOf = (r) => r.cause_category, textOf = (r) => r.text, valOf = () => 1, labelOf = (r) => r.label } = {}) {
  const map = Object.fromEntries(BONES.map(b => [b.key, { ...b, count: 0, value: 0, guessed: 0, items: [] }]));
  let guessed = 0;
  (records || []).forEach(r => {
    const { bone, guessed: g } = boneOf(categoryOf(r), textOf(r));
    const slot = map[bone] || map.unknown;
    slot.count++;
    slot.value += num(valOf(r)) || 0;
    if (g) { slot.guessed++; guessed++; }
    slot.items.push({ label: labelOf(r), text: textOf(r), value: num(valOf(r)), guessed: g, raw: r });
  });
  const n = (records || []).length;
  return {
    n, guessed, guessRate: n ? guessed / n : null,
    bones: BONES.map(b => map[b.key]),
  };
}

/* ═══ ① ใบตรวจสอบ (Check sheet) — ตารางนับไขว้ 2 แกน ════════════════════════
   ใบตรวจสอบของ QC7 = "นับของที่เกิดจริง ลงช่องที่เตรียมไว้" ⇒ ตารางไขว้ + ผลรวมขอบ
   คืน `rows`/`cols` ที่เรียงตามยอดรวม (มากก่อน) เพื่อให้มุมซ้ายบนคือจุดที่ต้องดูก่อน */
export function checkSheet(records, { rowOf, colOf, valOf = () => 1, maxRows = 25, maxCols = 12 } = {}) {
  const cell = {}, rowTot = {}, colTot = {};
  let total = 0;
  (records || []).forEach(r => {
    const rk = String(rowOf(r) ?? '').trim() || '(ไม่ระบุ)';
    const ck = String(colOf(r) ?? '').trim() || '(ไม่ระบุ)';
    const v = num(valOf(r)) || 0;
    cell[rk] = cell[rk] || {};
    cell[rk][ck] = (cell[rk][ck] || 0) + v;
    rowTot[rk] = (rowTot[rk] || 0) + v;
    colTot[ck] = (colTot[ck] || 0) + v;
    total += v;
  });
  const byTot = (t) => (a, b) => t[b] - t[a] || String(a).localeCompare(String(b), 'th');
  const allRows = Object.keys(rowTot).sort(byTot(rowTot));
  const allCols = Object.keys(colTot).sort(byTot(colTot));
  const rows = allRows.slice(0, maxRows), cols = allCols.slice(0, maxCols);
  return {
    n: (records || []).length, total, rows, cols, cell, rowTot, colTot,
    // จอต้องบอกว่าตัดหางไปเท่าไหร่ — ตัดเงียบ = ตารางโกหกยอดรวม
    hiddenRows: allRows.length - rows.length,
    hiddenCols: allCols.length - cols.length,
  };
}

/* ═══ ⑦ กราฟแนวโน้ม (Run chart) + การแบ่งชั้น (Stratification) ═══════════════ */

/** รวมค่าเป็นช่วงเวลา (คีย์ที่ผู้เรียกทำมาให้ เช่น 'YYYY-WW' / 'YYYY-MM')
 *  `keys` = ลิสต์ช่วงเวลาที่ "ต้องมี" ทั้งหมด (รวมช่วงที่ไม่มีเหตุการณ์)
 *  🔴 ช่วงที่ไม่มีเหตุการณ์ = **0 จริง** (ไม่มีใบซ่อมเลย) ต่างจาก "ไม่มีข้อมูล" —
 *     ผู้เรียกต้องส่ง `keys` มาให้ครบ ไม่งั้นกราฟจะข้ามสัปดาห์ที่เงียบ แล้วแนวโน้มเพี้ยน */
export function runChart(records, { keyOf, valOf = () => 1, keys = null } = {}) {
  const agg = {};
  (records || []).forEach(r => {
    const k = String(keyOf(r) ?? '').trim();
    if (!k) return;
    agg[k] = (agg[k] || 0) + (num(valOf(r)) || 0);
  });
  const ks = keys && keys.length ? keys : Object.keys(agg).sort();
  const points = ks.map(k => ({ label: k, value: agg[k] || 0 }));
  const vs = points.map(p => p.value);
  return { points, n: points.length, total: vs.reduce((a, b) => a + b, 0), mean: mean(vs), max: vs.length ? Math.max(...vs) : null };
}

/** แบ่งชั้น — จัดกลุ่มแล้วเรียงมาก→น้อย พร้อม % ของยอดรวม */
export function stratify(records, { keyOf, valOf = () => 1, top = 0 } = {}) {
  const agg = {};
  let total = 0;
  (records || []).forEach(r => {
    const k = String(keyOf(r) ?? '').trim() || '(ไม่ระบุ)';
    const v = num(valOf(r)) || 0;
    const g = agg[k] || (agg[k] = { name: k, value: 0, count: 0, recs: [] });
    g.value += v; g.count++; g.recs.push(r);
    total += v;
  });
  let list = Object.values(agg).sort((a, b) => b.value - a.value || b.count - a.count);
  const hidden = top > 0 && list.length > top ? list.length - top : 0;
  if (hidden) list = list.slice(0, top);
  return { list: list.map(g => ({ ...g, pct: total > 0 ? (g.value / total) * 100 : null })), total, hidden, groups: Object.keys(agg).length };
}

/* ═══ แกนชนิดสินทรัพย์ — เครื่องจักร / แม่พิมพ์ / JIG-Fixture ══════════════════
   🔴 **ห้ามแยกด้วย `mtn_orders.mtn_dept`** — วัดจริง 22/09/2026: 422 จาก 473 ใบเป็นทีม
      `production` (ช่างประจำไลน์) ซึ่งซ่อมทั้งเครื่อง/จิ๊ก/แม่พิมพ์ปนกันในทีมเดียว
      ⇒ แยกด้วยทีม = ตะกร้าเดียวกิน 89% ของใบ แล้ว dashboard แม่พิมพ์/JIG ว่างทั้งที่มีงานจริง
   ลำดับตัดสิน: ① `machines.equipment_kind` ของเลขเครื่องในใบ (ข้อเท็จจริงจากทะเบียน)
                ② ไม่พบในทะเบียน → เดาจาก `item_type` แล้ว `machine_no`
                ③ เดาไม่ออก → 'other' **ต้องมีตะกร้ารับเสมอ ห้ามให้ใบหายจากจอ**
      (กฎเดียวกับ `line_type` ที่ว่างแล้วต้องไปอยู่ท้ายลิสต์ ไม่ใช่หายไป) */
export const ASSET_CLASSES = [
  { key: 'machine', icon: '🏭', label: 'เครื่องจักร', kinds: ['machine', 'facility'] },
  { key: 'die',     icon: '🔨', label: 'แม่พิมพ์ (DIE)', kinds: ['die'] },
  { key: 'jig',     icon: '📐', label: 'JIG / Fixture', kinds: ['jig'] },
  { key: 'other',   icon: '❓', label: 'ยังแยกชนิดไม่ได้', kinds: [] },
];
export const ASSET_KEYS = ASSET_CLASSES.map(a => a.key);

const KIND_TO_CLASS = (() => {
  const m = {};
  ASSET_CLASSES.forEach(a => a.kinds.forEach(k => { m[k] = a.key; }));
  return m;
})();

/** ชนิดสินทรัพย์จาก `machines.equipment_kind` — ค่าที่ไม่รู้จัก = 'other' (ห้ามเดาเป็นเครื่องจักร) */
export const assetClassOfKind = (kind) => KIND_TO_CLASS[String(kind || '').trim().toLowerCase()] || 'other';

/** เดาชนิดจากชื่อ/ชนิดอุปกรณ์ที่คนพิมพ์ — ใช้เมื่อไม่พบเลขเครื่องในทะเบียนเท่านั้น */
export function guessAssetClass(...texts) {
  const s = texts.map(t => String(t || '')).join(' ').toUpperCase();
  if (!s.trim()) return 'other';
  if (/\bJIG\b|FIXTURE|จิ๊ก|แคลมป์|CLAMP/.test(s)) return 'jig';
  if (/\bDIE\b|แม่พิมพ์|MOLD|PUNCH|PROGRESSIVE/.test(s)) return 'die';
  if (/PRESS|ROBOT|WELD|LASER|CONVEYOR|COMPRESSOR|MOTOR|HYDROFORM|STATIONARY|เครื่อง|ระบบ/.test(s)) return 'machine';
  return 'other';
}

/**
 * ชนิดสินทรัพย์ของใบซ่อม/แถว downtime
 * @param row            แถวที่มี machine_no / item_type
 * @param kindByMachineNo map เลขเครื่อง (UPPER, trim) → equipment_kind — จาก `machines`
 * @returns {{ cls:string, known:boolean }} `known=false` = เดามา (จอต้องบอก)
 */
export function assetClassOf(row, kindByMachineNo = {}) {
  const mc = String(row?.machine_no || '').trim().toUpperCase();
  if (mc && kindByMachineNo[mc]) return { cls: assetClassOfKind(kindByMachineNo[mc]), known: true };
  return { cls: guessAssetClass(row?.item_type, mc), known: false };
}
