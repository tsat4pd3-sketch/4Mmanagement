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

/** props ของ tick ที่อ่านออก — fontSize ไม่ต่ำกว่า 11 */
export const axisTick = (extra = {}) => ({ fill: 'var(--muted)', ...extra, fontSize: Math.max(AXIS_FS, extra.fontSize || AXIS_FS) });

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
