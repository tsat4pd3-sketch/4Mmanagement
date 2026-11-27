/* ── keepAwake — จอแขวน/ทีวีห้ามดับจอเอง (2026-11-27 · หน้างานส่งรูปทีวี LG ขึ้น
   "To turn the screen back on, please press any button except for the power button")
   🔴 user ปิดเมนูประหยัดพลังงาน/ปิดเครื่องอัตโนมัติของทีวีแล้ว **ก็ยังดับ** ⇒ ทีวีตัดสินเองว่า
      "ไม่มีคนกดรีโมท + ไม่มีสื่อเล่นอยู่" = ไม่มีคนดู แล้วปิดจอประหยัดไฟ
   ⇒ ทางที่ใช้กันทั่วไปกับจอ kiosk: **มีวิดีโอเล่นวนอยู่ (มองไม่เห็น)** ทีวีจะถือว่ากำลังเล่นสื่อ
      + ขอ Screen Wake Lock เมื่อเบราว์เซอร์รองรับ (Chromium 84+ — TV หน้างาน Cr94 มี API)
   ตัดสินที่ไฟล์นี้ที่เดียว · ตัววาด = `components/KeepScreenAwake.jsx` (mount ใน App.jsx)
   ⚠️ เปิดเฉพาะจอแขวน — เครื่องคนทำงานปกติห้ามโดน (กินไฟ/จอไม่ดับตามนโยบายเครื่อง) */

/** เบราว์เซอร์ของทีวี (LG webOS · Tizen · ทีวีทั่วไป) — ดูจาก user agent */
export const TV_UA_RE = /Web0S|webOS|SmartTV|SMART-TV|Tizen|NetCast|HbbTV|BRAVIA|AFT[A-Z]/i;

/** ต้องกันจอดับไหม — จอเปลือก TV · หน้า kiosk · หรือเปิดบนเบราว์เซอร์ทีวี (หน้าไหนก็ตาม) */
export function shouldKeepAwake({ tvShell = false, kiosk = false, ua = '' } = {}) {
  return !!tvShell || !!kiosk || TV_UA_RE.test(String(ua || ''));
}
