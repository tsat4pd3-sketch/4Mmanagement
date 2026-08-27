/* ── 🔔 notifyEvent — ตัวยิงแจ้งเตือน "ทั่วไป" ตัวเดียวของฝั่งเว็บ (2026-08-25) ──
 *
 * ทำไมต้องมี (คำสั่ง user "upgrade ทั้งระบบ telegram กับ ใน app ต้องสอดคล้องตรงกัน"):
 *   เดิมการแจ้งเตือนแต่ละเรื่องต้องไปเขียน branch ใน edge `send-notification` (ไฟล์ 47KB)
 *   คนจึงเลี่ยงไม่เขียน → **16 เรื่องที่พนักงานกรอกแล้วเงียบสนิท** (ไม่มีทั้ง Telegram และในแอป)
 *   ตัวนี้ยิงเข้า edge กลาง `send-event-notification` ซึ่ง:
 *     Telegram + ในแอป (กระดิ่ง/เสียง/Web Push) มาจาก **กติกาแถวเดียวกัน** ใน `notification_rules`
 *
 * ⚠️ กติกาของเรื่องใหม่ (ห้ามข้าม):
 *   1. ต้องมีแถวใน `notification_rules` ก่อน (event_key ตรงกัน) — ไม่มี = edge ตอบ 400 ไม่ส่งอะไร
 *   2. ผู้รับในแอปตั้งที่ `/notification-config` (role × ส่วนงาน × แผนก) — **ห้ามฮาร์ดโค้ดผู้รับ**
 *   3. fire-and-forget เสมอ — แจ้งเตือนล้มเหลว **ห้าม**ทำให้การบันทึกของผู้ใช้พัง
 *
 * ⚠️ ส่ง `line_name` หรือ `section` มาด้วยทุกครั้งที่รู้ — เรื่องที่ตั้ง `inapp_match_section`
 *    จะได้แจ้งเฉพาะหัวหน้าส่วนงานนั้น ไม่ใช่ทั้งโรงงาน (ไม่ส่ง = แจ้งทุกคนตาม role ไม่เงียบ)
 */

const FN_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-event-notification';

/**
 * @param {object} p
 * @param {string}   p.event      คีย์เรื่อง (ต้องมีใน notification_rules)
 * @param {string[]} p.lines      เนื้อความ บรรทัดละรายการ
 * @param {string}  [p.title]     หัวข้อ (ไม่ส่ง = ใช้ label ในทะเบียน)
 * @param {string}  [p.line_name] ไลน์ที่เกี่ยวข้อง — edge หา section ให้เอง
 * @param {string}  [p.section]   ส่วนงานของเหตุการณ์ (ถ้ารู้ตรงๆ)
 * @param {string}  [p.actor]     ชื่อผู้กระทำ
 * @param {string}  [p.type]      'info' | 'success' | 'error'
 * @param {string}  [p.ref_table] ตารางต้นทาง (ให้กระดิ่งลิงก์กลับได้ในอนาคต)
 * @param {string|number} [p.ref_id]
 * @param {object}  [p.vars]      ตัวแปรเสริมสำหรับ template ที่ admin เขียนเอง
 */
export function notifyEvent(p) {
  if (!p?.event) return;
  try {
    fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({
        ...p,
        lines: (p.lines || []).filter(Boolean).map(String),
      }),
    }).catch(() => {});
  } catch { /* แจ้งเตือนพลาด ห้ามลากงานหลักล้ม */ }
}

export default notifyEvent;
