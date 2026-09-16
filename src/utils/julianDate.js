/* ═══════════════════════════════════════════════════════════════════════════
   Julian date (วันที่ปั๊ม/ยิงบนชิ้นงาน) ↔ วันที่ปฏิทิน — source of truth เดียว   2026-09-15

   ที่มา (คำขอ user): "ระบบสอบกลับ การค้นหา เพิ่มให้หาจาก julian date ด้วยได้มั้ย จะได้ง่ายขึ้น"
   หน้างานถือชิ้นงานที่มีป้าย/ตัวปั๊มเป็นเลข Julian อยู่ในมือ แล้วอยากรู้ว่า "ตัวนี้ผลิตใบไหน"

   ══ รูปแบบจริงของโรงงานนี้ (user ยืนยัน 2026-09-15) ══════════════════════
     `24726A`  =  วันที่ **247** ของปี **26** (= 2026-09-04) · กะ **A**
                  └┬─┘└┬┘└┬┘
                 DDD   YY  กะ
     · **`DDD` มาก่อน `YY`** — ห้ามสลับ
     · **กะ A = กลางวัน · B = กลางคืน** (ตัวอักษรท้าย มีหรือไม่มีก็ได้)
     · ย่อเหลือ `247` (วันอย่างเดียว ไม่บอกปี) ก็รับ — ระบบเดาปีให้แล้วโชว์ว่าเดาเป็นปีไหน

   ⚠️ **เคยเข้าใจผิดเป็น `YYDDD` (26258) ในรอบแรก แก้แล้ว 2026-09-15 วันเดียวกัน**
      ถ้าอ่านสลับ เลขอย่าง `10026` (วัน 100 ปี 26) จะถูกอ่านเป็น "ปี 2010 วันที่ 26"
      = **ได้วันที่ผิดแบบเงียบๆ** ซึ่งอันตรายกว่าอ่านไม่ออก → ตัวที่ตีความไม่ได้ให้คืน null เสมอ
      **ห้ามเติมรูปแบบอื่นกลับเข้ามาโดยไม่มีคนยืนยันว่าโรงงานนั้นใช้จริง**
      (โรงงานอื่นในกลุ่มใช้คนละแบบได้ — ถึงตอนนั้นค่อยทำเป็น master ตั้งค่าต่อโรงงาน ไม่ใช่เดาเพิ่ม)

   ⚠️ **ระบบไม่มีคอลัมน์ Julian ที่ไหนเลย** (ตรวจ DR ทั้งฐาน 2026-09-15) → Julian ที่แสดง/ค้น
   ทั้งหมด **derive จาก `production_sessions.work_date` + `.shift`** ไม่ได้เก็บซ้ำ

   ⚠️ ไฟล์นี้ต้อง pure — ห้าม import supabase/react (เทสตรงได้ · ดู __tests__/julianDate.test.mjs)
   ═══════════════════════════════════════════════════════════════════════════ */

/** ตัวอักษรกะบนชิ้นงาน ↔ ค่ากะในระบบ (`production_sessions.shift`) */
export const SHIFT_LETTER = { day: 'A', night: 'B' };
export const SHIFT_OF_LETTER = { A: 'day', B: 'night' };
export const shiftLetterLabel = (L) => (L === 'A' ? 'กะกลางวัน' : L === 'B' ? 'กะกลางคืน' : '');

/** ปีนี้เป็นปีอธิกสุรทินไหม (ค.ศ.) — 366 วันเฉพาะปีนี้เท่านั้น */
export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** จำนวนวันของปี (365/366) */
export const daysInYear = (y) => (isLeapYear(y) ? 366 : 365);

const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');

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
 * วันที่ปฏิทิน (+ กะ) → เลขแบบที่ปั๊มบนชิ้นงาน `DDDYY` หรือ `DDDYYA`
 * ใช้โชว์คู่กับใบผลิต ให้หน้างานเทียบกับตัวปั๊มได้ตรงๆ
 */
export function toJulian(iso, shift) {
  const doy = dayOfYear(iso);
  if (doy == null) return '';
  const yy = pad2(Number(String(iso).slice(0, 4)) % 100);
  return `${pad3(doy)}${yy}${SHIFT_LETTER[shift] || ''}`;
}

/**
 * คำที่พิมพ์ในช่องค้นหา → ตีความเป็นเลข Julian บนชิ้นงานได้ไหม
 *
 * รับ 2 แบบ (+ ตัวอักษรกะท้าย A/B จะมีหรือไม่มีก็ได้):
 *   `24726` / `24726A`  → วัน 247 ปี 2026  (DDDYY — แบบที่โรงงานนี้ใช้จริง)
 *   `247`   / `247A`    → วัน 247 **ปีไม่ได้บอกมา ต้องเดา** (ดู guessedYear/candidates)
 *
 * คืน null เมื่อไม่ใช่ · คืน object เมื่อใช่:
 *   { doy, year, date, shift, shiftLetter, digits, guessedYear, candidates }
 *   - `shift` = 'day' | 'night' | null (ไม่ได้ระบุตัวอักษรกะมา)
 *   - `guessedYear = true` → ปีมาจากการเดา (แบบ 3 หลัก) ⇒ **จอต้องโชว์วันที่ที่ตีความได้ + ให้เลือกปีอื่น**
 *   - `candidates` = ปีที่เป็นไปได้ (ใหม่→เก่า) ให้จอทำปุ่มสลับปี
 *
 * ⚠️ รับเฉพาะ "ตัวเลข 3 หรือ 5 หลัก (+A/B)" — กันชนกับการค้นด้วย MAT (เลข SAP 8 หลัก) และ
 *    prod_no (มีตัวอักษร/ขีด) · **4 หลักถือว่าไม่ใช่ Julian** (ไม่มีรูปแบบไหนของที่นี่ยาว 4)
 */
export function parseJulianTerm(term, today = todayISO()) {
  const raw = String(term ?? '').trim().replace(/^[-\s]+|[-\s]+$/g, '').toUpperCase();
  const m = /^(\d{3})(\d{2})?([AB])?$/.exec(raw);
  if (!m) return null;

  const doy = Number(m[1]);
  const yy = m[2];
  const shiftLetter = m[3] || null;
  if (doy < 1 || doy > 366) return null;

  const thisYear = Number(String(today).slice(0, 4));
  const todayDoy = dayOfYear(today) ?? 366;

  let years; let guessedYear;
  if (yy != null) {
    years = [2000 + Number(yy)];      // ปีระบุชัด ไม่ต้องเดา
    guessedYear = false;
  } else {
    /* ปีไม่ได้บอกมา — เดา "ครั้งล่าสุดที่ผ่านมาแล้ว": วันที่ยังไม่ถึงในปีนี้ = ต้องเป็นปีก่อน
       (สอบกลับคือย้อนหลังเสมอ ไม่มีของที่ผลิตในอนาคต) */
    const base = doy <= todayDoy ? thisYear : thisYear - 1;
    years = [base, base - 1, base - 2];
    guessedYear = true;
  }

  const candidates = years.map(y => ({ year: y, date: fromDayOfYear(y, doy) })).filter(c => c.date);
  if (!candidates.length) return null;   // เช่น 366 ของปีที่ไม่ใช่อธิกสุรทิน

  return {
    doy, digits: raw.length, guessedYear, candidates,
    year: candidates[0].year, date: candidates[0].date,
    shiftLetter, shift: shiftLetter ? SHIFT_OF_LETTER[shiftLetter] : null,
  };
}

/** ป้ายอ่านง่ายสำหรับจอ — 'Julian 24726A = วันที่ 247 ปี 2026 · กะกลางวัน' */
export function julianLabel(j) {
  if (!j) return '';
  const code = `${pad3(j.doy)}${j.guessedYear ? '' : pad2(j.year % 100)}${j.shiftLetter || ''}`;
  return `Julian ${code} = วันที่ ${j.doy} ปี ${j.year}${j.shiftLetter ? ` · ${shiftLetterLabel(j.shiftLetter)}` : ''}`;
}
