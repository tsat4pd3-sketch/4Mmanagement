/* ═══ ผลิตเทียบกับความต้องการลูกค้า — Demand vs Supply ═══
   2026-08-19 · คำสั่ง user: "ดูยอดผลิตรายวันเทียบกับออเดอร์ลูกค้าไม่ได้เลย
   อยากเห็นว่าที่ผ่านมาผลิตได้ตรงตามความต้องการลูกค้ามั้ย เพียงพอรึป่าว
   และต้องชะลอหรือเร่งยอดผลิต เพื่อ cover ยอดความต้องการ"

   ⚠️ กฎเหล็กของไฟล์นี้
   1. **"ไม่รู้" ≠ "ไม่มีความต้องการ"** — พาร์ทที่จับคู่เลขไม่ได้ ต้องคืน `resolved:false`
      ห้ามคืน demand = 0 (จะอ่านเป็น "ลูกค้าไม่สั่ง" แล้วสั่งชะลอการผลิตผิดๆ)
   2. **order (คำสั่งซื้อจริง) ชนะ forecast เสมอในวันที่มีทั้งคู่** — forecast เป็นการคาดการณ์
      เอามาบวกทับ order = นับซ้ำ (หลักเดียวกับ "รวม forecast source เดียว" ใน kanban calc)
   3. **สต็อกที่มีอยู่คือส่วนหนึ่งของคำตอบ** — "ผลิตน้อยกว่าที่ลูกค้าสั่ง" ไม่ได้แปลว่าขาด
      ถ้าสต็อกยกมาพอ · ตัวชี้ขาดคือ **สต็อกจำลองติดลบวันไหน** ไม่ใช่ผลรวมผลิต vs สั่ง
   4. ทุกวันในช่วงต้องมีแถว (แกนวันต่อเนื่อง) — วันไม่ผลิต/ไม่มีส่ง = 0 ไม่ใช่ข้ามวัน */

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDay = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1, d); t.setDate(t.getDate() + n); return ymd(t); };
const norm = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** เลขทั้งหมดที่ "ออเดอร์ของสินค้าตัวนี้" อาจถูกบันทึกไว้ (เลข SAP + เลขลูกค้า) */
export function demandKeysOf(product) {
  const keys = new Set();
  [product?.mat_no, product?.p_no].forEach((v) => { const k = norm(v); if (k) keys.add(k); });
  return keys;
}

/** แถวออเดอร์/forecast ใบนี้เป็นของสินค้าตัวนี้ไหม (เทียบแบบ normalize ทั้ง 2 ช่อง) */
export const rowMatchesProduct = (row, keys) =>
  keys.has(norm(row?.mat_no)) || keys.has(norm(row?.customer_part_no));

/**
 * รวมความต้องการรายวัน
 * @param {Array} orders    customer_shipping_orders ที่กรองเป็นของสินค้านี้แล้ว
 * @param {Array} forecasts customer_forecasts ที่กรองแล้ว (period_month = วันต้นสัปดาห์ของ EDI 830)
 * @param {number} spreadDays กระจาย forecast 1 แถวออกกี่วัน (EDI 830 = ราย 7 วัน)
 * @returns {{ byDay: Object, orderDays: Set<string>, hasOrder: boolean, hasForecast: boolean }}
 */
export function demandByDay(orders, forecasts, spreadDays = 7) {
  const byDay = {};
  const orderDays = new Set();
  const add = (d, q, src) => {
    if (!d || !(q > 0)) return;
    byDay[d] = byDay[d] || { order: 0, forecast: 0 };
    byDay[d][src] += q;
  };
  (orders || []).forEach((o) => { add(o.due_date, Number(o.qty) || 0, 'order'); if (o.due_date) orderDays.add(o.due_date); });
  /* forecast ราย 7 วัน → เกลี่ยเป็นรายวัน เพื่อวาดบนแกนวันเดียวกับ order ได้
     (เกลี่ยเท่าๆ กัน ไม่เดาว่าวันไหนหนักกว่า — ระบบไม่รู้ตารางส่งจริงของสัปดาห์นั้น) */
  (forecasts || []).forEach((f) => {
    const q = Number(f.qty) || 0;
    if (!f.period_month || !(q > 0)) return;
    const per = q / spreadDays;
    for (let i = 0; i < spreadDays; i++) add(addDay(String(f.period_month).slice(0, 10), i), per, 'forecast');
  });
  return {
    byDay, orderDays,
    hasOrder: Object.values(byDay).some((v) => v.order > 0),
    hasForecast: Object.values(byDay).some((v) => v.forecast > 0),
  };
}

/** ความต้องการของวันนั้น — order ชนะ forecast (กฎข้อ 2: ห้ามบวกทับกัน = นับซ้ำ) */
export const demandOf = (v) => (v ? (v.order > 0 ? v.order : v.forecast) : 0);
export const demandSrcOf = (v) => (v && v.order > 0 ? 'order' : v && v.forecast > 0 ? 'forecast' : null);

/**
 * เดินสต็อกจำลองวันต่อวัน — ตัวชี้ขาดว่า "พอไหม / ต้องเร่งหรือชะลอ"
 * @param {string} from,to     ช่วงวัน (YYYY-MM-DD)
 * @param {Object} prodByDay   { 'YYYY-MM-DD': ผลิตได้ }  (อดีต = ของจริง)
 * @param {Object} demByDay    ผลจาก demandByDay().byDay
 * @param {number} openingStock สต็อกตั้งต้น ณ วัน `from`
 * @param {string} today       วันงานปัจจุบัน — วันหลังจากนี้ถือว่ายังไม่ผลิต (ไม่เดาว่าจะผลิตได้)
 */
export function simulate({ from, to, prodByDay = {}, demByDay = {}, openingStock = 0, today }) {
  const days = [];
  let stock = openingStock;
  let cumProd = 0, cumDem = 0, firstShort = null, minStock = openingStock;
  for (let d = from; d <= to; d = addDay(d, 1)) {
    const produced = Number(prodByDay[d]) || 0;
    const dv = demByDay[d];
    const demand = demandOf(dv);
    const future = today ? d > today : false;
    cumProd += produced; cumDem += demand;
    stock += produced - demand;
    if (stock < minStock) minStock = stock;
    if (stock < 0 && !firstShort) firstShort = d;
    days.push({
      d, produced, demand, src: demandSrcOf(dv), future,
      stock: Math.round(stock), cumProd: Math.round(cumProd), cumDem: Math.round(cumDem),
      gap: Math.round(cumProd - cumDem),
    });
    if (days.length > 400) break;   // cap เหมือนกราฟรายวัน กันช่วงยาวทำหน้าค้าง
  }
  return { days, endStock: Math.round(stock), minStock: Math.round(minStock), firstShort, cumProd: Math.round(cumProd), cumDem: Math.round(cumDem) };
}

/** อัตราผลิตต่อ "วันที่ผลิตจริง" — ใช้ประเมินว่าต้องใช้กี่วันถึงจะเติมส่วนที่ขาด
 *  ⚠️ หารด้วยวันที่ผลิตจริง ไม่ใช่วันปฏิทิน (ไลน์หยุดเสาร์-อาทิตย์ = อัตราต่ำเกินจริง) */
export function prodRate(prodByDay) {
  const vals = Object.values(prodByDay || {}).filter((v) => v > 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export const VERDICT = {
  short:  { label: 'ของจะขาด — ต้องเร่งผลิต',        color: '#ef4444', icon: '🔴' },
  tight:  { label: 'พอดีตัว — เฝ้าระวัง',            color: '#f59e0b', icon: '🟡' },
  ok:     { label: 'เพียงพอ',                       color: '#22c55e', icon: '🟢' },
  excess: { label: 'ของเกินความต้องการ — ชะลอได้',   color: '#4d9fff', icon: '🔵' },
  unknown:{ label: 'ยังเทียบไม่ได้',                 color: '#6b7280', icon: '❔' },
};

/**
 * สรุปว่าเร่งหรือชะลอ
 * @param {object} sim         ผลจาก simulate()
 * @param {number} rate        ผลิตต่อวันที่ผลิตจริง (จาก prodRate) — null = ไม่รู้
 * @param {number} coverDays   สต็อกปลายช่วงถือว่า "เกิน" เมื่อคุ้มความต้องการเกินกี่วัน
 */
export function advise(sim, rate, coverDays = 10) {
  if (!sim || !sim.days.length) return { key: 'unknown', ...VERDICT.unknown, text: 'ไม่มีข้อมูลความต้องการในช่วงนี้' };
  const dem = sim.days.filter((x) => x.demand > 0);
  if (!dem.length) return { key: 'unknown', ...VERDICT.unknown, text: 'ยังไม่มีออเดอร์/forecast ของสินค้านี้ในช่วงที่เลือก' };
  const perDay = sim.cumDem / dem.length;   // ความต้องการเฉลี่ยต่อวันที่มีการส่ง

  if (sim.firstShort) {
    const need = Math.abs(sim.minStock);
    const daysNeed = rate > 0 ? Math.ceil(need / rate) : null;
    return {
      key: 'short', ...VERDICT.short, need,
      text: `สต็อกจะติดลบวันที่ ${sim.firstShort} · ต้องผลิตเพิ่มอีก ${Math.ceil(need).toLocaleString()} ชิ้น`
        + (daysNeed ? ` ≈ ${daysNeed} วันผลิต (ที่อัตราเฉลี่ย ${Math.round(rate).toLocaleString()} ชิ้น/วัน)` : ' — ยังไม่รู้อัตราผลิตเฉลี่ย'),
    };
  }
  const coverEnd = perDay > 0 ? sim.endStock / perDay : null;
  if (coverEnd != null && coverEnd > coverDays) {
    return {
      key: 'excess', ...VERDICT.excess,
      text: `ปลายช่วงเหลือ ${sim.endStock.toLocaleString()} ชิ้น ≈ คุ้มความต้องการอีก ${Math.floor(coverEnd)} วัน — ชะลอได้ ไปเร่งพาร์ทที่ขาดแทน`,
    };
  }
  if (sim.minStock < perDay * 2) {
    return { key: 'tight', ...VERDICT.tight, text: `ต่ำสุดระหว่างทางเหลือ ${sim.minStock.toLocaleString()} ชิ้น (< 2 วันของการส่ง) — เดินตามแผนห้ามสะดุด` };
  }
  return {
    key: 'ok', ...VERDICT.ok,
    text: `ผลิตทันความต้องการ · ปลายช่วงเหลือ ${sim.endStock.toLocaleString()} ชิ้น`
      + (coverEnd != null ? ` ≈ คุ้มอีก ${Math.floor(coverEnd)} วัน` : ''),
  };
}
