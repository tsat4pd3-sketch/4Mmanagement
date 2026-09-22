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

/** ชื่อหัวคอลัมน์แบบเทียบได้ — ตัดช่องว่าง/ขีด/ตัวพิมพ์ทิ้ง (`Forecast_Time ` = `forecast time`)
 *  🔴 ต้องเก็บ **ตัวอักษรทุกภาษา** ไม่ใช่แค่ A-Z0-9 (แก้ 2026-09-22)
 *  เดิม `replace(/[^A-Z0-9]/g, '')` ทำให้หัวคอลัมน์ภาษาไทยกลายเป็น **สตริงว่างทั้งหมด**
 *  ⇒ "จำนวนสั่ง" = "กำหนดส่ง" = "" ⇒ จับคู่มั่วข้ามคอลัมน์ (ตัวแรกที่ว่างชนะ)
 *  ไม่เคยเป็นปัญหาเพราะไฟล์ Ford เป็น ASCII ล้วน — แต่พอเปิดให้ลงทะเบียนลูกค้าไทยได้ มันพังทันที
 *  ⚠️ ผลข้างเคียงที่ตั้งใจ: หัวคอลัมน์ปนไทย-อังกฤษ เช่น "จำนวน (Qty)" เดิมถูกลดรูปเหลือ "QTY"
 *     แล้วบังเอิญ match alias `Qty` · ตอนนี้ไม่ match แล้ว ⇒ ให้ลงทะเบียนชื่อเต็มตามไฟล์จริง
 *     (การ match โดยบังเอิญอันตรายกว่า — มันเดาความหมายคอลัมน์ให้เราโดยไม่มีใครตัดสินใจ) */
export const normHdr = (s) => String(s ?? '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');

/* ── 🧩 พจนานุกรมชื่อหัวคอลัมน์ — **ทะเบียน `customer_file_formats` ชนะค่าในโค้ด** (2026-09-22) ──
   ที่มา (audit 22/09 · user ยืนยัน): ลูกค้าเจ้าอื่น (TSRA · TSPK · ISUZU · GWM · TSESA)
   ส่ง **ไฟล์ Excel/CSV เหมือนกัน แต่คนละหน้าตากับ Ford** และวัดจริงพบว่า
   **72 จาก 115 พาร์ท active ไม่มีความต้องการในระบบเลย** เพราะไม่มีทางนำเข้า
   ⇒ ชื่อคอลัมน์ต้องเพิ่มได้จากหน้าจอ **ห้ามให้ "ลูกค้าใหม่ = แก้โค้ด + deploy" อีก**
   (ฝั่ง e-SMART ทำแบบนี้อยู่แล้วที่ `customer_pull_formats` — ตัวนี้คือขาเดียวกันของ order/forecast)

   วิธีรวม: alias ของ **ทุกลูกค้า รวมเป็นพจนานุกรมเดียว** (ไม่ได้แยกตามลูกค้า)
   เพราะไฟล์ 1 ไฟล์ไม่ได้บอกว่าเป็นของใครจนกว่าจะอ่านคอลัมน์ ship-to ข้างใน
   ⇒ ชื่อคอลัมน์ของเจ้าไหนก็อ่านออกหมด · การตัดสิน 830/862 ยังใช้สัญญาณเดิม (เวลา/ท่า/ช่วงวันที่) */

/** ค่าตั้งต้นในโค้ด (Ford 830/862) — ใช้เมื่อทะเบียนยังว่าง/โหลดไม่ได้ · จอต้องบอกเมื่อใช้ค่าสำรอง */
export const FALLBACK_EDI_DICT = {
  part:    ['Part Num', 'Part Number', 'PartNo', 'Part'],
  qty:     ['Forecast Net Qty', 'Net Qty', 'Forecast Qty', 'Quantity', 'Qty'],
  date:    ['Forecast Date', 'Date', 'Ship Date', 'Delivery Date'],
  time:    ['Forecast Time', 'Time', 'Ship Time', 'Delivery Time', 'Forecast Ship Time'],
  dock:    ['Dock Code', 'Dock', 'Market Row', 'Unload Point'],
  ship_to: ['Ship To GSDB Code', 'Ship To', 'GSDB', 'Ship To Code'],
  po:      ['Purchase Order Num', 'Purchase Order', 'PO Num', 'PO'],
};

/** ช่องที่ขาดไม่ได้ (ไม่มี 3 ตัวนี้ = ประกอบความต้องการไม่ได้เลย) — เรียงตามลำดับของ EDI_SIG เดิม */
export const REQUIRED_FIELDS = ['part', 'qty', 'date'];

/**
 * รวม alias จากทะเบียน (`customer_file_formats`) เข้ากับค่าตั้งต้น → พจนานุกรมเดียว
 * @param {Array<{col_map: object, is_active?: boolean}>} rows แถวทะเบียน (kind = order/forecast)
 * @returns {{dict: object, fromDb: number}} fromDb = จำนวนแถวทะเบียนที่ถูกใช้ (0 = ใช้ค่าสำรองล้วน)
 */
export function buildEdiDict(rows = []) {
  const dict = {};
  Object.entries(FALLBACK_EDI_DICT).forEach(([k, v]) => { dict[k] = [...v]; });
  let fromDb = 0;
  (rows || []).filter(r => r && r.is_active !== false).forEach(r => {
    const cm = r.col_map || {};
    let used = false;
    Object.entries(cm).forEach(([field, aliases]) => {
      if (!Array.isArray(aliases) || !aliases.length) return;
      const bag = dict[field] || (dict[field] = []);
      aliases.forEach(a => {
        const t = String(a || '').trim();
        // กันชื่อซ้ำแบบ normalize แล้ว (ทะเบียนพิมพ์ต่างกันนิดเดียวไม่ควรบวมพจนานุกรม)
        if (t && !bag.some(x => normHdr(x) === normHdr(t))) { bag.push(t); used = true; }
      });
    });
    if (used) fromDb++;
  });
  return { dict, fromDb };
}

/** แปลงพจนานุกรม → 3 กลุ่มคอลัมน์บังคับ (รูปแบบเดิมที่โค้ดเก่าใช้) */
export const sigOf = (dict = FALLBACK_EDI_DICT) => REQUIRED_FIELDS.map(f => dict[f] || []);

/** คอลัมน์ที่ต้องมีถึงจะเป็นไฟล์ EDI (ค่าตั้งต้น — จุดที่มีทะเบียนแล้วให้ส่ง dict เข้าไปแทน) */
export const EDI_SIG = sigOf(FALLBACK_EDI_DICT);

/** ชื่อที่นับว่าเป็น "คอลัมน์เวลา" = สัญญาณว่าไฟล์นี้เป็น 862 */
export const TIME_HDRS = FALLBACK_EDI_DICT.time;
export const DOCK_HDRS = FALLBACK_EDI_DICT.dock;

/** หา index ของคอลัมน์จากชื่อที่ยอมรับได้หลายแบบ (normalize แล้ว) · ไม่เจอ = -1 */
export function colIdx(headers, aliases) {
  const want = (Array.isArray(aliases) ? aliases : [aliases]).map(normHdr).filter(Boolean);
  const hs = (headers || []).map(normHdr);
  for (const w of want) { const i = hs.indexOf(w); if (i >= 0) return i; }
  return -1;
}

/** แถวนี้เป็นหัวตาราง EDI ไหม (ต้องเจอครบทุกช่องบังคับ) · `dict` = พจนานุกรมจากทะเบียน */
export const isEdiHeaderRow = (headers, dict = FALLBACK_EDI_DICT) =>
  sigOf(dict).every(g => g.length > 0 && colIdx(headers, g) >= 0);

/** จำนวนแถวหัวที่ยอมสแกน — พอร์ทัลชอบใส่แถวหัวเรื่อง/ meta นำหน้า
 *  ⚠️ เดิม 5 แถว · ไฟล์ e-SMART จริงมี meta 5 แถวก่อนหัวตารางแล้ว = เฉียดฉิว */
export const HEADER_SCAN_ROWS = 20;

/**
 * เป็น 862 (ใบสั่งส่งรายวัน) หรือ 830 (forecast) — เดาหลายทาง แล้ว**บอกเหตุผล**
 * @returns {{is862:boolean, reason:string, sure:boolean}}
 *   sure=false ⇒ จอต้องบังคับให้คนยืนยัน/เลือกเอง ห้ามนำเข้าเงียบ
 */
export function detectEdiKind(headers, rows = [], dict = FALLBACK_EDI_DICT) {
  const tIdx = colIdx(headers, dict.time || TIME_HDRS);
  if (tIdx >= 0) {
    // มีคอลัมน์เวลา แต่ว่างทั้งไฟล์ = หัวมีแต่ไม่มีค่า → ยังไม่ชัด
    const any = rows.some(r => String(r?.[tIdx] ?? '').trim() !== '');
    return any
      ? { is862: true, reason: `พบคอลัมน์เวลา "${headers[tIdx]}" และมีค่าจริง`, sure: true }
      : { is862: true, reason: `พบคอลัมน์เวลา "${headers[tIdx]}" แต่ว่างทุกแถว`, sure: false };
  }
  const dIdx = colIdx(headers, dict.dock || DOCK_HDRS);
  if (dIdx >= 0 && rows.some(r => String(r?.[dIdx] ?? '').trim() !== '')) {
    return { is862: true, reason: `ไม่มีคอลัมน์เวลา แต่มี "${headers[dIdx]}" (ใบส่งรายวันเท่านั้นที่ระบุท่า)`, sure: false };
  }
  /* ไม่มีเวลา/ท่าเลย → ดูระยะของวันที่: forecast ยิงยาวข้ามปี · ใบส่งอยู่ในไม่กี่สัปดาห์ */
  const dateIdx = colIdx(headers, (dict.date || FALLBACK_EDI_DICT.date));
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
