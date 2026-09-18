/* ═══ ตรวจจับไฟล์ EDI ของลูกค้า (Ford 830 Forecast / 862 Shipping Schedule) ═══════════
   🔴 ที่มา (2026-09-17 · user: *"ออเดอร์ AAT หายไปหมดเลย ทุกรายการ ไม่ขึ้นเลย
      ต้องอัพจาก e-SMART และ add order manual"*)

   ของเดิมตัดสินทุกอย่างด้วย **ชื่อคอลัมน์ตรงเป๊ะ** แล้ว**พังเงียบทั้ง 2 ทาง**:

   ① `EDI_SIG.every(k => hd.includes(k))` — เทียบตรงตัว + สแกนแค่ 5 แถวแรก
      ⇒ พอร์ทัลเพิ่มแถวหัวเรื่อง / เว้นวรรคเกิน / เปลี่ยนตัวพิมพ์ = **หาไม่เจอ**
      แล้ว**ตกไปทาง "ไฟล์ manual" เงียบๆ** (ขึ้นจอ map คอลัมน์เอง ไม่มีคำว่า EDI สักคำ)
   ② `is862 = col('Forecast Time') >= 0` — คอลัมน์เดียวตัดสิน เทียบตรงตัว
      ⇒ ชื่อเพี้ยนนิดเดียว = ถูกตีเป็น **830 forecast** ⇒ แถวลง `customer_forecasts`
      **ไม่เคยกลายเป็นใบส่งเลย** = หน้าจัดส่งว่างทั้งลูกค้า

   ⇒ กฎของไฟล์นี้: **normalize ก่อนเทียบเสมอ · เดาได้หลายทาง · และผลการเดาต้องขึ้นจอให้คนแก้ได้**
      (ตัวตัดสินที่คนมองไม่เห็น = บั๊กที่ไม่มีใครจับได้จนของหายไปเป็นสัปดาห์)
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** ชื่อหัวคอลัมน์แบบเทียบได้ — ตัดช่องว่าง/ขีด/ตัวพิมพ์ทิ้ง (`Forecast_Time ` = `forecast time`) */
export const normHdr = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** คอลัมน์ที่ต้องมีถึงจะเป็นไฟล์ EDI — แต่ละช่องใส่ชื่อที่ยอมรับได้หลายแบบ */
export const EDI_SIG = [
  ['Part Num', 'Part Number', 'PartNo', 'Part'],
  ['Forecast Net Qty', 'Net Qty', 'Forecast Qty', 'Quantity', 'Qty'],
  ['Forecast Date', 'Date', 'Ship Date', 'Delivery Date'],
];

/** ชื่อที่นับว่าเป็น "คอลัมน์เวลา" = สัญญาณว่าไฟล์นี้เป็น 862 */
export const TIME_HDRS = ['Forecast Time', 'Time', 'Ship Time', 'Delivery Time', 'Forecast Ship Time'];
export const DOCK_HDRS = ['Dock Code', 'Dock', 'Market Row', 'Unload Point'];

/** หา index ของคอลัมน์จากชื่อที่ยอมรับได้หลายแบบ (normalize แล้ว) · ไม่เจอ = -1 */
export function colIdx(headers, aliases) {
  const want = (Array.isArray(aliases) ? aliases : [aliases]).map(normHdr).filter(Boolean);
  const hs = (headers || []).map(normHdr);
  for (const w of want) { const i = hs.indexOf(w); if (i >= 0) return i; }
  return -1;
}

/** แถวนี้เป็นหัวตาราง EDI ไหม (ต้องเจอครบทุกช่องใน EDI_SIG) */
export const isEdiHeaderRow = (headers) => EDI_SIG.every(g => colIdx(headers, g) >= 0);

/** จำนวนแถวหัวที่ยอมสแกน — พอร์ทัลชอบใส่แถวหัวเรื่อง/ meta นำหน้า
 *  ⚠️ เดิม 5 แถว · ไฟล์ e-SMART จริงมี meta 5 แถวก่อนหัวตารางแล้ว = เฉียดฉิว */
export const HEADER_SCAN_ROWS = 20;

/**
 * เป็น 862 (ใบสั่งส่งรายวัน) หรือ 830 (forecast) — เดาหลายทาง แล้ว**บอกเหตุผล**
 * @returns {{is862:boolean, reason:string, sure:boolean}}
 *   sure=false ⇒ จอต้องบังคับให้คนยืนยัน/เลือกเอง ห้ามนำเข้าเงียบ
 */
export function detectEdiKind(headers, rows = []) {
  const tIdx = colIdx(headers, TIME_HDRS);
  if (tIdx >= 0) {
    // มีคอลัมน์เวลา แต่ว่างทั้งไฟล์ = หัวมีแต่ไม่มีค่า → ยังไม่ชัด
    const any = rows.some(r => String(r?.[tIdx] ?? '').trim() !== '');
    return any
      ? { is862: true, reason: `พบคอลัมน์เวลา "${headers[tIdx]}" และมีค่าจริง`, sure: true }
      : { is862: true, reason: `พบคอลัมน์เวลา "${headers[tIdx]}" แต่ว่างทุกแถว`, sure: false };
  }
  const dIdx = colIdx(headers, DOCK_HDRS);
  if (dIdx >= 0 && rows.some(r => String(r?.[dIdx] ?? '').trim() !== '')) {
    return { is862: true, reason: `ไม่มีคอลัมน์เวลา แต่มี "${headers[dIdx]}" (ใบส่งรายวันเท่านั้นที่ระบุท่า)`, sure: false };
  }
  /* ไม่มีเวลา/ท่าเลย → ดูระยะของวันที่: forecast ยิงยาวข้ามปี · ใบส่งอยู่ในไม่กี่สัปดาห์ */
  const dateIdx = colIdx(headers, EDI_SIG[2]);
  const days = dateSpanDays(rows, dateIdx);
  if (days != null && days > 120) {
    return { is862: false, reason: `ไม่มีคอลัมน์เวลา และวันที่กินช่วง ${days} วัน (ยาวเกินใบส่ง)`, sure: true };
  }
  return { is862: false, reason: 'ไม่พบคอลัมน์เวลา/ท่ารับ — เดาว่าเป็น 830 forecast', sure: false };
}

/** ช่วงวันที่ในไฟล์ (วัน) — อ่านได้ทั้ง Date object และข้อความ ISO/ค.ศ. · อ่านไม่ได้ = null */
export function dateSpanDays(rows, idx) {
  if (!(idx >= 0)) return null;
  let lo = null, hi = null;
  for (const r of rows || []) {
    const t = cellDateMs(r?.[idx]);
    if (t == null) continue;
    if (lo == null || t < lo) lo = t;
    if (hi == null || t > hi) hi = t;
  }
  return lo == null ? null : Math.round((hi - lo) / 86400000);
}

function cellDateMs(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return null;
}
