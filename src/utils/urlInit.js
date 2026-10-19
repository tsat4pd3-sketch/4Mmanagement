/* ══ ค่าเริ่มต้นของตัวกรองจากลิงก์ (?key=) — สำหรับจอวนหน้า / deep link ══════════════════
   2026-10-15 · user: "ยังไม่ครอบคลุม เรื่องการตั้งค่าเจาะแต่ละหน้า ฟิลเตอร์ เลือก tab"
   หลายหน้าเก็บตัวกรอง (metric · กะ · มุมมอง 2D/3D · ช่วงสัปดาห์/เดือน …) ไว้ใน state ล้วน
   ⇒ ตั้งจากหน้า /display-rotation ไม่ได้ · ตัวนี้ให้หน้า "อ่านค่าตั้งต้นจากลิงก์ครั้งเดียวตอนเปิด"
   โดยไม่ต้องเปลี่ยนวิธีจำค่าเดิมของหน้า (กดเปลี่ยนบนจอก็ทำงานเหมือนเดิม · ไม่เขียนกลับลงลิงก์)

   กติกา:
   · ค่าที่ไม่อยู่ในชุดที่อนุญาต = ไม่สนใจ ใช้ค่าเดิมของหน้า (ลิงก์พิมพ์ผิดต้องไม่ทำหน้าพัง)
   · คีย์ที่หน้าอ่าน ต้องลงทะเบียนใน DISPLAY_PAGE_PARAMS (utils/displayRotation.js) ด้วย ไม่งั้นตั้งจากจอไม่ได้
   · อ่านจาก window.location ตอน mount — ตัววน (DisplayRotator) บังคับ remount เมื่อเปลี่ยนแค่ query ของ path เดิม
     (ดู ROT_NAV_STATE) ไม่งั้นหน้าเดิมค้างค่าเก่า                                                          */

const sp = () => {
  try { return new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''); }
  catch { return new URLSearchParams(''); }
};

/** ค่าดิบ (ไม่มี = null) */
export function urlParam(key) {
  const v = sp().get(key);
  return v == null || v === '' ? null : v;
}

/** ค่าในชุดที่อนุญาต · ไม่ตรง = fallback */
export function urlPick(key, allowed, fallback) {
  const v = urlParam(key);
  return v != null && allowed.includes(v) ? v : fallback;
}

/** '1'/'true' = true · '0'/'false' = false · ไม่มี/อื่น = fallback */
export function urlBool(key, fallback) {
  const v = urlParam(key);
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return fallback;
}

/** ตัวเลขในช่วง · อ่านไม่ออก = fallback */
export function urlNum(key, lo, hi, fallback) {
  const n = Number(urlParam(key));
  if (urlParam(key) == null || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
