/* ══ 📏 แกนกราฟมาตรฐาน (2026-09-24 · UI-STANDARD §6 · audit/chartsweep.mjs) ═══════════════════
   ที่มา: user ส่งภาพจอ SQDCM — แกนตั้งเขียน "0", "5", "7" ทั้งที่ค่าจริง 100 / 75
   *"ตัวเลขของกราฟแกนแนวตั้ง ดูไม่ออกเลยเลขอะไร"* ⇒ ต้นเหตุ 2 อย่างที่ก๊อปต่อกันมาทั้งระบบ:
   1. `<YAxis width={34}>` ตายตัว — ตัวเลข "100" ที่ฟอนต์ 11–15px กว้าง 25–35px + ช่องไฟ ⇒ ไม่พอ
      (จอ TV สเกลฟอนต์ขึ้นแต่ความกว้างแกนไม่ขึ้นตาม)
   2. `margin={{ left: -22 }}` ติดลบ — ดึงกราฟไปทางซ้ายจนกินพื้นที่แกน ⇒ SVG ตัดหลักหน้าทิ้ง เหลือแต่หลักท้าย
   ⇒ **ตัวเลขที่อ่านผิด (100 เป็น 0) แย่กว่าไม่มีตัวเลข** — คนตัดสินใจจากเลขที่ผิด

   กติกา:
   • แกนตัวเลข: `width="auto"` (Recharts 3 วัดจากตัวเลขที่ยาวที่สุดเอง) — **ห้ามใส่ตัวเลขตายตัว**
   • margin ซ้าย ≥ 0 — **ห้ามติดลบ** (ใช้ `CHART_MARGIN`)
   • แกนหมวด (ชื่อไลน์/อาการ) ที่ยาว: ตัดด้วย `shortTick(n)` + ชื่อเต็มใน tooltip — ห้ามปล่อยให้ SVG ตัดเอง
   • ตัวเลขแกน ≥ 11px (UI §4)
   มีด่าน build: `chart-yaxis-fixed-width` · `chart-negative-margin` (regressionGuards)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
export const AXIS_FS = 11;

/* ══ 🖤 tooltip ตัวหนังสือดำบนการ์ดเข้ม (2026-09-30 · user ส่งภาพ "พื้นเขียวเข้ม text ดำ") ═══════
   Recharts เขียนบรรทัดค่าใน tooltip ด้วย "สีของ series" = prop `fill` ของ <Bar> — แท่งที่ระบายสีรายแท่ง
   ด้วย <Cell> (ไฟเขียว/เหลือง/แดงตามสถานะ) มักไม่ใส่ fill ที่ <Bar> ⇒ Recharts ตกไปใช้ `#000`
   = ดำบน var(--card) ธีมมืด อ่านไม่ออกบนจอ TV · เจอ 7 จุดใน 4 ไฟล์ (OBEYA KPI/SQDCM · Energy · QC)
   กติกา: <Bar> ที่ลูกเป็น <Cell> ต้องใส่ `fill={CELL_BAR_FILL}` (Cell ทับสีที่วาดอยู่แล้ว · fill นี้ไปโผล่แค่ใน tooltip)
   + <Tooltip {...tooltipProps(fs)}> · มีด่าน build (regressionGuards "แท่ง Cell ไม่มี fill")
   ═══════════════════════════════════════════════════════════════════════════════════════ */
export const CELL_BAR_FILL = 'var(--text)';

/** props ของ <Tooltip> มาตรฐาน — พื้นการ์ด · ตัวหนังสือสีธีม (ไม่บังคับ itemStyle: หลาย series ยังใช้สีของตัวเอง) ·
 *  cursor โปร่ง (default #ccc ทึบ → ใน popup ขยายกลายเป็นก้อนเทาบังแท่ง) */
export const tooltipProps = (fontSize = AXIS_FS) => ({
  contentStyle: { background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, fontSize: Math.max(AXIS_FS, fontSize), color: 'var(--text)' },
  labelStyle: { color: 'var(--text)', fontWeight: 600 },
  cursor: { fill: 'var(--text)', fillOpacity: 0.08 },
});

/** props ของ tick ที่อ่านออก — fontSize ไม่ต่ำกว่า 11 */
export const axisTick = (extra = {}) => ({ fill: 'var(--muted)', ...extra, fontSize: Math.max(AXIS_FS, extra.fontSize || AXIS_FS) });

/** ป้ายหน่วยเหนือแกน Y ("%" · "PPM" · "ครั้ง" · "บาท") + ระยะขอบบนที่ป้ายต้องใช้ — **คู่กันเสมอ** (05/10 · chartsweep)
 *  เดิมตั้ง margin top ตายตัว (fs(21)) ⇒ กล่องข้อความไทยสูงเกือบ 2 เท่าของ font-size (สระ/วรรณยุกต์บน)
 *  ⇒ "%"/"PPM" ยื่นเลยขอบบนของ SVG 4px · "ครั้ง" 6px แล้วถูกตัด (ป้ายหน่วยที่ถูกตัด = อ่านไม่ออกว่าหน่วยอะไร)
 *  ใช้: `margin={{ top: unit ? axisUnitTop(fs) : …}}` + `<YAxis label={axisUnitLabel(unit, { fontSize: fs })}>` */
export const axisUnitLabel = (unit, { fontSize = 11, lift = 6 } = {}) => (unit ? {
  value: unit, position: 'top', offset: 2, dy: -lift,
  fontSize, fill: 'var(--muted)', fontWeight: 700,
} : undefined);
/** margin top ที่ป้ายหน่วยต้องใช้: เผื่อกล่องข้อความไทย ~2×font-size + ระยะยก + offset */
export const axisUnitTop = (fontSize = 11, lift = 6) => Math.ceil(fontSize * 2 + lift + 4);

/** ขอบกราฟมาตรฐาน — ซ้ายไม่ติดลบ (แกน Y มีที่ของมันเอง) */
export const CHART_MARGIN = Object.freeze({ top: 8, right: 12, left: 4, bottom: 0 });

/** ตัดป้ายหมวดยาวด้วย "…" (ชื่อเต็มให้ tooltip แสดง) */
export const shortTick = (max = 12) => (v) => {
  const s = String(v ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** ตัวเลขบนแกนแบบย่อ — 1250000 → "1.25M" · 350000 → "350k" · 1500 → "1,500"
 *  (เลขหลักแสน/ล้านเต็มๆ บนแกนแคบ = ต้องนับหลักเอง อ่านผิดง่าย · ค่าเต็มยังอยู่ใน tooltip) */
export const fmtAxis = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  const a = Math.abs(n);
  const trim = (x) => String(Number(x.toFixed(2)));
  if (a >= 1e6) return `${trim(n / 1e6)}M`;
  if (a >= 1e4) return `${trim(n / 1e3)}k`;
  return Number.isInteger(n) ? n.toLocaleString('en-US') : String(Number(n.toFixed(2)));
};

/** ความกว้างแกน Y ร่วมของ "กราฟหลายใบที่ซ้อนแกน X เดียวกัน" (UI §6.19) — ใบละ auto จะเหลื่อมกัน
 *  คำนวณจากป้ายที่ยาวที่สุดของทุกใบ (+1 ตัวอักษรเผื่อค่าที่ Recharts ปัดขึ้นเป็นเลขกลม) */
export const alignedYWidth = (labels, fontSize = AXIS_FS) => {
  const longest = Math.max(1, ...labels.map(l => String(l ?? '').length));
  return Math.max(36, Math.ceil((longest + 1) * fontSize * 0.62 + 10));
};

/* ══ 🎯 โฟกัสช่วงค่า — ตัดที่ว่างใต้กราฟทิ้ง (2026-09-30 · user: "ขยายดูเป็นช่วงๆ ให้ gap Commitment–Target ห่างกันมากขึ้น
   พวกเลข 0 หรือต่ำๆ ที่ไม่มีนัยสำคัญไม่อยากดู") ═════════════════════════════════════════════════════════
   DL+OH 1.0–1.5 % บนแกน 0–1.6 = แท่งสูงเกือบเท่ากันหมด เส้น T 1.3042 กับ C 1.3445 ทับกันเป็นเส้นเดียว
   ⇒ ยกพื้นแกนขึ้นไปใกล้ค่าต่ำสุด แล้วขยายช่วงที่ค่ากระจุกอยู่
   🔴 กติกาความซื่อสัตย์: แกนที่ไม่เริ่ม 0 ทำให้ "แท่งสูง 2 เท่า ≠ ค่ามาก 2 เท่า" ⇒ (1) เป็นโหมดที่คนกดเอง default ปิด
   (2) จอต้องเขียนว่า "แกนเริ่ม X ไม่ใช่ 0" ทุกครั้งที่ lo > 0 (3) ทุกอย่างที่วาด (แท่ง · T · C · แผน) ต้องอยู่ในช่วง
   ห้ามให้เส้นเป้าหลุดออกนอกกราฟเงียบๆ (4) พาเรโตห้ามใช้ (UI §6.9 แกนเริ่ม 0 เสมอ)
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const niceStep = (span, n = 4) => {
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};
/** @returns {{ domain:[number,number], ticks:number[], truncated:boolean } | null}
 *  null = โฟกัสไม่ได้/ไม่มีประโยชน์ (ไม่มีค่า · ค่าติดลบ · ช่วงเริ่มที่ 0 อยู่แล้ว) — ให้ใช้แกนปกติ
 *  `max` = เพดานตามธรรมชาติ (เช่น 100 สำหรับ %) กันแกนขยายเกินความจริง */
export const focusDomain = (values, { max = null } = {}) => {
  const vs = (values || []).filter(v => v != null && v !== '').map(Number).filter(Number.isFinite);   // ⚠️ Number(null) = 0 — เดือนว่างต้องไม่ดึงพื้นแกนลง 0
  if (!vs.length) return null;
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (lo < 0) return null;                                  // ค่าติดลบ = แกนต้องเห็น 0 อยู่แล้ว
  if (hi === lo) { const pad = Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad; }
  const pad = (hi - lo) * 0.2;                              // เว้นหัว/ท้าย 20% ให้ตัวเลขบนแท่ง + เส้นเป้าไม่ชนขอบ
  const step = niceStep((hi - lo) + pad * 2);
  let dlo = Math.max(0, Math.floor((lo - pad) / step) * step);
  let dhi = Math.ceil((hi + pad) / step) * step;
  if (max != null && dhi > max) dhi = max;
  if (dhi <= dlo) return null;
  if (dlo <= 0) return null;                                // เริ่ม 0 อยู่แล้ว = ไม่ต่างจากแกนปกติ
  const fix = Math.max(0, -Math.floor(Math.log10(step)));   // กัน 0.30000000000000004
  const r = (x) => Number(x.toFixed(fix + 1));
  const ticks = [];
  for (let t = dlo; t <= dhi + step / 1e6; t += step) ticks.push(r(t));
  return { domain: [r(dlo), r(dhi)], ticks, truncated: true };
};
