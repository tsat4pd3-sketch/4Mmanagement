/* ═══════════════════════════════════════════════════════════════════════════
   Julian date (วันที่ปั๊ม/ยิงบนชิ้นงาน) ↔ วันที่ปฏิทิน — source of truth เดียว   2026-09-15

   ที่มา (คำขอ user): "ระบบสอบกลับ การค้นหา เพิ่มให้หาจาก julian date ด้วยได้มั้ย จะได้ง่ายขึ้น"
   หน้างานถือชิ้นงานที่มีป้าย/ตัวปั๊มเป็นเลข Julian อยู่ในมือ แล้วอยากรู้ว่า "ตัวนี้ผลิตใบไหน"
   — เดิมต้องแปลงวันเองก่อนแล้วค่อยตั้งช่วงวันที่ในหน้า /order-trace

   ⚠️ **ระบบไม่มีคอลัมน์ Julian ที่ไหนเลย** (ตรวจ DR ทั้งฐาน 2026-09-15: ไม่มี column ชื่อ julian/
   date_code) → Julian ที่แสดง/ค้น ทั้งหมด **derive จาก `production_sessions.work_date`** (วันที่ผลิต)
   ไม่ได้เก็บซ้ำ · ถ้าวันหลังมีการยิงเลข lot จริงลงชิ้นงาน (คนละตัวกับ work_date) ต้องเพิ่มคอลัมน์
   แล้วให้ตัวค้นหาเทียบคอลัมน์นั้นก่อน ค่อยถอยมา work_date

   ⚠️ **รองรับ 3 รูปแบบพร้อมกัน — แยกด้วยจำนวนหลัก ไม่ต้องให้คนเลือกโหมด**
   (โรงงานในกลุ่ม/ลูกค้าแต่ละรายใช้ไม่เหมือนกัน และ ณ วันที่เขียนยังไม่ยืนยันว่าที่นี่ใช้แบบไหน
    → **ห้าม hardcode แบบเดียว** และ **ต้องโชว์ให้เห็นว่าระบบตีความเป็นวันไหน** ห้ามแปลงเงียบ)
     3 หลัก  `258`    = วันที่ N ของปี — **ปีไม่ได้ระบุมา ต้องเดา** (ดู guessedYear)
     4 หลัก  `6258`   = หลักแรก = เลขท้ายปี ค.ศ. (6 → 2026) + วันที่ 258   ← แบบที่ค่ายรถใช้บ่อย
     5 หลัก  `26258`  = 2 หลักแรก = ปี ค.ศ. 2 ตัวท้าย (26 → 2026) + วันที่ 258
   ทุกแบบคืน `digits` กลับไปด้วย เพื่อให้จอแสดงผลด้วยจำนวนหลักเดียวกับที่คนพิมพ์มา

   ⚠️ ไฟล์นี้ต้อง pure — ห้าม import supabase/react (เทสตรงได้ · ดู __tests__/julianDate.test.mjs)
   ═══════════════════════════════════════════════════════════════════════════ */

/** ปีนี้เป็นปีอธิกสุรทินไหม (ค.ศ.) — 366 วันเฉพาะปีนี้เท่านั้น */
export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** จำนวนวันของปี (365/366) */
export const daysInYear = (y) => (isLeapYear(y) ? 366 : 365);

const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' ของวันนี้แบบ local (ไม่ใช้ toISOString — UTC ทำวันเพี้ยน ดูกฎใน CLAUDE.md) */
export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** วันที่ 'YYYY-MM-DD' → ลำดับวันในปี (1-366) · ค่าไม่ถูกต้อง = null */
export function dayOfYear(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;  // 31/02 ฯลฯ
  return Math.round((dt - new Date(y, 0, 1)) / 86400000) + 1;
}

/** ปี + ลำดับวันในปี → 'YYYY-MM-DD' · เกินจำนวนวันของปีนั้น = null */
export function fromDayOfYear(year, doy) {
  const y = Number(year); const n = Number(doy);
  if (!Number.isInteger(y) || !Number.isInteger(n) || n < 1 || n > daysInYear(y)) return null;
  const dt = new Date(y, 0, 1);
  dt.setDate(n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/**
 * วันที่ปฏิทิน → เลข Julian ตามจำนวนหลักที่ต้องการ (3/4/5)
 * ใช้โชว์คู่กับใบผลิต ให้หน้างานเทียบกับตัวปั๊มบนชิ้นงานได้ตรงๆ
 */
export function toJulian(iso, digits = 5) {
  const doy = dayOfYear(iso);
  if (doy == null) return '';
  const year = Number(String(iso).slice(0, 4));
  const ddd = String(doy).padStart(3, '0');
  if (digits === 3) return ddd;
  if (digits === 4) return `${year % 10}${ddd}`;
  return `${pad2(year % 100)}${ddd}`;
}

/**
 * คำที่พิมพ์ในช่องค้นหา → ตีความเป็น Julian date ได้ไหม
 *
 * คืน null เมื่อไม่ใช่ · คืน object เมื่อใช่:
 *   { doy, year, date, digits, guessedYear, candidates }
 *   - `guessedYear = true` → ปีมาจากการเดา (แบบ 3 หลัก) หรือคลี่จากเลขหลักเดียว (แบบ 4 หลัก)
 *     **จอต้องโชว์วันที่ที่ตีความได้เสมอ + ให้เลือกปีอื่นได้** (หลัก "ไม่รู้ ≠ เดาแล้วเงียบ")
 *   - `candidates` = ปีอื่นที่เป็นไปได้ (ใหม่→เก่า) ให้จอทำปุ่มสลับปี
 *
 * ⚠️ รับเฉพาะ "ตัวเลขล้วน 3-5 หลัก" เท่านั้น — กันชนกับการค้นด้วย MAT (เลข SAP 8 หลัก)
 *    และ prod_no (มีตัวอักษร/ขีด) · เว้นวรรค/ขีดหัวท้ายตัดทิ้งให้
 */
export function parseJulianTerm(term, today = todayISO()) {
  const raw = String(term ?? '').trim().replace(/^[-\s]+|[-\s]+$/g, '');
  if (!/^\d{3,5}$/.test(raw)) return null;

  const thisYear = Number(String(today).slice(0, 4));
  const todayDoy = dayOfYear(today) ?? 366;
  const digits = raw.length;
  const doy = Number(raw.slice(-3));
  if (doy < 1 || doy > 366) return null;

  let years = [];
  let guessedYear = true;
  if (digits === 3) {
    /* ปีไม่ได้บอกมา — เดา "ครั้งล่าสุดที่ผ่านมาแล้ว": วันที่ยังไม่ถึงในปีนี้ = ต้องเป็นปีก่อน
       (สอบกลับคือย้อนหลังเสมอ ไม่มีของที่ผลิตในอนาคต) */
    const base = doy <= todayDoy ? thisYear : thisYear - 1;
    years = [base, base - 1, base - 2];
  } else if (digits === 4) {
    // หลักแรก = เลขท้ายปี → คลี่เป็นปีจริงย้อนหลังไม่เกิน 10 ปี
    const last = Number(raw[0]);
    for (let y = thisYear; y > thisYear - 10; y--) if (y % 10 === last) years.push(y);
    // เลขท้ายตรงกันได้ทุก 10 ปี → เสนอรอบก่อนหน้าไว้ด้วย
    if (years.length) years.push(years[0] - 10);
  } else {
    // 5 หลัก = ปีระบุชัด ไม่ต้องเดา
    years = [2000 + Number(raw.slice(0, 2))];
    guessedYear = false;
  }

  const candidates = years.map(y => ({ year: y, date: fromDayOfYear(y, doy) })).filter(c => c.date);
  if (!candidates.length) return null;   // เช่น 366 ของปีที่ไม่ใช่อธิกสุรทิน

  return { doy, digits, guessedYear, year: candidates[0].year, date: candidates[0].date, candidates };
}

/** ป้ายอ่านง่ายสำหรับจอ — 'Julian 6258 = วันที่ 258 ของปี 2026' */
export const julianLabel = (j) =>
  j ? `Julian ${String(j.digits === 3 ? j.doy : j.digits === 4 ? `${j.year % 10}${String(j.doy).padStart(3, '0')}` : `${pad2(j.year % 100)}${String(j.doy).padStart(3, '0')}`).padStart(j.digits, '0')} = วันที่ ${j.doy} ของปี ${j.year}` : '';
