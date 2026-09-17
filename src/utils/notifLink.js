/* ── 🔔 ปลายทางของแจ้งเตือน "จุดเดียวของระบบ" — 2026-09-16 ─────────────────────
 *
 * feedback ทีมงานผ่าน user: "กระดิ่งบางอันกดเข้าไปในจุดที่แจ้งเตือนได้ แต่บางอันไม่ได้"
 * วัดจากฐานจริง 16/09 (notifications 60,272 แถว): **ref_table = null 6,873 แถว และยังเกิดใหม่ทุกวัน**
 *   หลุดเฟสงานส่ง 5,433 · เตือนรอบ PM 379 · ส่งงานลูกค้า 338 · เฝ้าระวังสโตร์ 326 · EDI 156 ·
 *   แผนประสานงาน PM 131 · 💬 mention ใต้ใบซ่อม ~70
 * ทั้งหมดกดแล้วไม่ไปไหน (ไม่มีลูกศร › แค่ mark อ่าน) ส่วนใบ MO/downtime/4M กดแล้วไปหน้ารวมได้
 * ⇒ ผู้ใช้เห็นพฤติกรรม "บางอันได้ บางอันไม่ได้" ตรงตามที่แจ้งมาเป๊ะ
 *
 * โมเดลปลายทาง 2 ชั้น (ห้ามสลับลำดับ):
 *   1. `link` (คอลัมน์ใหม่) = path ที่ผู้ส่งระบุมาเอง → **deep-link ได้** เช่น /mtn-repair?mo=PRO-BM-...
 *   2. `ref_table` → NOTIF_ROUTE (หน้ารวมของเรื่องนั้น) = ของเดิม ยังใช้ได้กับใบเก่าทั้งหมด
 *
 * 🔴 กติกาความปลอดภัยของ `link` (มาจาก DB = ข้อมูล ไม่ใช่โค้ด — ใครมีสิทธิ์ insert notifications ก็ใส่ได้):
 *   · ต้องเป็น path ภายในเท่านั้น: ขึ้นต้น '/' ตัวเดียว · ห้าม '//' (protocol-relative = เด้งออกนอกเว็บ)
 *     ห้ามมี ':' ก่อน '?' (javascript:/http:) · ห้าม backslash (เบราว์เซอร์บางตัวอ่านเป็น /)
 *   · ต้องผ่าน `canAccessPage()` เหมือน route ปกติ — ไม่มีสิทธิ์ = ไม่พาไป (กดแล้วแค่ mark อ่าน)
 *     ห้าม "พาไปก่อนแล้วให้โดนเด้ง" (จอเด้งกลับหน้าแรกอ่านเหมือนแอปพัง)
 */

/** ตัด query/hash ออกให้เหลือ path ล้วน (canAccessPage รับ path) */
export const pagePathOf = (target) => String(target || '').split('?')[0].split('#')[0];

/**
 * path ภายในที่ปลอดภัยพอจะ navigate ไหม — คืน string ที่ใช้ได้ หรือ null
 * (pure · ไม่แตะสิทธิ์ — สิทธิ์เช็คที่ notifTargetPath)
 */
export function safeInternalPath(link) {
  const s = String(link ?? '').trim();
  if (!s || s[0] !== '/') return null;          // ต้องเป็น path ภายใน
  if (s[1] === '/') return null;                // //evil.com = protocol-relative
  if (s.includes('\\')) return null;            // \ ถูกอ่านเป็น / ในบางเบราว์เซอร์
  const head = s.split(/[?#]/)[0];
  if (head.includes(':')) return null;          // กัน scheme แปลกปลอมทุกชนิด
  return s;
}

/**
 * ปลายทางของแจ้งเตือน 1 ใบ — คืน path หรือ null (null = กดได้แค่ mark อ่าน ไม่ต้องมีลูกศร)
 * @param {object} n            แถว notifications (ต้อง select `link, ref_table` มาด้วย)
 * @param {object} routeMap     NOTIF_ROUTE (ref_table → path)
 * @param {(path:string)=>boolean} allow  ตัวเช็คสิทธิ์ (ปกติ = p => canAccessPage(p, role))
 */
export function notifTargetPath(n, routeMap, allow = () => true) {
  const link = safeInternalPath(n?.link);
  const path = link || routeMap?.[n?.ref_table] || null;
  if (!path) return null;
  return allow(pagePathOf(path)) ? path : null;
}
