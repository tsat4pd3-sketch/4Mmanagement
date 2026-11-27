/**
 * Centralised date formatting — DD/MM/YY(YY) zero-padded · ปีตามภาษา: ไทย = พ.ศ. · EN = ค.ศ. (คำสั่ง user 24/11 "เอาเลย")
 * ⚠️ ใบพิมพ์/Excel ที่สร้างขณะอยู่โหมด EN จึงออกเป็น ค.ศ. — ถ้าเอกสารไหนต้องยึด พ.ศ. เสมอ ให้ตรึง lang ที่จุดนั้น
 * Use these everywhere a date is DISPLAYED to users. Never use toLocaleDateString()
 * or toLocaleString() directly — they produce inconsistent output across OS locales.
 */
import { getWorkDate } from './workDate.js';
import { getLang } from './i18n.js';

const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  // "YYYY-MM-DD" string — parse as local midnight to avoid UTC offset shift
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

/**
 * วันที่ "วันนี้" ตามเครื่อง (local) รูปแบบ YYYY-MM-DD — สำหรับใส่ใน <input type="date">
 * หรือคอลัมน์ date ที่หมายถึงวันตามปฏิทิน (เช่น pe_doc_revisions.rev_date)
 *
 * ⚠️ ห้ามใช้ `new Date().toISOString().slice(0,10)` — นั่นคือ UTC ช่วง 00:00-06:59 ไทย
 *    จะได้วันที่ย้อนหลัง 1 วัน (เอกสารควบคุมลงวันที่ผิด)
 * ⚠️ คนละตัวกับ `getWorkDate()` ที่ตัด 08:00 ตามกะ — อันนั้นใช้กับ "วันงาน" เท่านั้น
 */
export const todayLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** DD MMM  e.g. 05 มิ.ย.  — compact label for charts / axis */
const MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const MONTHS_SHORT_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/* 🌐 ชื่อเดือนตามภาษา — ไทย = ตัวย่อไทย + ปี พ.ศ. · อังกฤษ = ตัวย่ออังกฤษ + ปี ค.ศ. (คำสั่ง user 24/11) */
/** ตัวย่อเดือนตามภาษาปัจจุบัน (index 0-11) — 🔴 ห้ามประกาศอาร์เรย์ 'ม.ค.' ซ้ำในหน้า ใช้ตัวนี้ (มีด่าน) */
export const monthsShort = () => (getLang() === 'th' ? MONTHS_SHORT : MONTHS_SHORT_EN);
export const MONTHS_SHORT_TH = MONTHS_SHORT;   // ใบพิมพ์ที่ยึดภาษาไทยเสมอ
/** ตัวย่อวันในสัปดาห์ตามภาษา (index 0 = อาทิตย์) — `weekdaysShort()` มีจุด · `weekdaysMin()` ไม่มีจุด */
const WD_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const WD_TH_MIN = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_EN_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const weekdaysShort = () => (getLang() === 'th' ? WD_TH : WD_EN);
export const weekdaysMin = () => (getLang() === 'th' ? WD_TH_MIN : WD_EN_MIN);
/** ปีสำหรับแสดงผล — ไทย = พ.ศ. (+543) · อังกฤษ = ค.ศ. (คำสั่ง user 24/11) · รับปี ค.ศ. เป็นตัวเลข */
export const yearDisplay = (ceYear) => Number(ceYear) + (getLang() === 'th' ? 543 : 0);
const monthShort = (d) => monthsShort()[d.getMonth()];
const yy2 = (d) => String(yearDisplay(d.getFullYear())).slice(-2);

/** DD/MM/YY  e.g. 05/06/69 (ไทย) · 05/06/26 (EN) */
export const fmtDate = (v) => {
  const d = toDate(v);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(yearDisplay(d.getFullYear())).slice(-2);
  return `${dd}/${mm}/${yy}`;
};

/** DD/MM/YYYY  e.g. 05/06/2569 (ไทย) · 05/06/2026 (EN) */
export const fmtDateFull = (v) => {
  const d = toDate(v);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${yearDisplay(d.getFullYear())}`;
};

/** DD/MM/YY HH:MM  e.g. 05/06/69 14:30 (ไทย) · 05/06/26 14:30 (EN) */
export const fmtDateTime = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(yearDisplay(d.getFullYear())).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
};

/** DD/MM/YYYY HH:MM:SS  e.g. 05/06/2026 14:30:00  — for CSV/PDF exports */
export const fmtDateTimeFull = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yearDisplay(d.getFullYear())} ${hh}:${mi}:${ss}`;
};

export const fmtDateLabel = (v) => {
  const d = toDate(v);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${monthShort(d)}`;
};

/** DD MMM YY  e.g. 05 มิ.ย. 69 (ไทย · พ.ศ.) / 05 Jun 26 (EN · ค.ศ.) — medium label */
export const fmtDateMedium = (v) => {
  const d = toDate(v);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${monthShort(d)} ${yy2(d)}`;
};

/**
 * HH:MM ถ้าเป็น "วันทำงานเดียวกับที่กำลังดู" · ไม่งั้น **DD/MM HH:MM**
 *
 * 🔴 กฎ (2026-11-18 · หัวหน้าแจ้ง *"วันที่ยังไม่มี มีแต่เวลาครับ"*):
 *    **เวลาที่อาจไม่ใช่วันเดียวกับกะที่เปิดดูอยู่ ห้ามโชว์แค่ HH:MM** — ใบที่ยกยอดข้ามวัน
 *    จะอ่านเหมือนเพิ่งเปิดเมื่อเช้านี้ (การ์ดขึ้น "เปิด 08:00" ทั้งที่เปิดมาตั้งแต่ 3 วันก่อน)
 *    ⇒ ไม่ใช่แค่ใบผลิต: ใช้กับทุกเวลาที่ข้ามวันได้ (เปิด/ปิดใบ · แจ้งซ่อม · อัพเดทยอด)
 *
 * @param v   timestamp
 * @param ref วันทำงานที่กำลังดู `'YYYY-MM-DD'` · ไม่ส่ง = วันทำงานตอนนี้
 * @param now เวลาอ้างอิง (ใส่เองได้เพื่อเทส)
 */
export const fmtTimeOn = (v, ref = null, now = new Date()) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const base = ref || getWorkDate(now);
  if (!base || getWorkDate(d) === base) return hhmm;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm}`;
};

/** HH:MM  from any timestamp */
export const fmtTime = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
