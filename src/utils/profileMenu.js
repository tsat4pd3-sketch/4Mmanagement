/**
 * เมนูโปรไฟล์ — "มีรายการอะไรบ้าง" นิยามที่ไฟล์นี้ที่เดียว (2026-08-21)
 *
 * ที่มา: เมนูโปรไฟล์ถูกเขียนแยกกัน 2 ชุด — `profileActions` ใน Sidebar (หน้าใช้งานปกติ)
 * กับ dropdown มุมขวาบนของ `DeptHub` (หน้า Home) — แล้ว **drift กันจริง**: หน้า Home
 * ไม่มี 💬 แจ้งปัญหา / 🎭 จำลองมุมมอง / รีโมทจอ ส่วน Sidebar ไม่มี 📷 เปลี่ยนรูปโปรไฟล์
 * (user ทัก 2026-08-21 ว่า "รายละเอียด user ไม่เหมือนกับ sidebar")
 *
 * ⚠️ กติกา: **เพิ่ม/แก้รายการเมนูโปรไฟล์ ให้แก้ที่ไฟล์นี้ที่เดียว ห้ามเติมปุ่มตรงในหน้า**
 * ทั้ง 2 ที่ map จาก descriptor เดียวกัน แล้ววาดด้วยสไตล์ของตัวเอง (layout ต่างกันโดยตั้งใจ:
 * sidebar = แถวเต็มความกว้าง · hub = dropdown ใต้ avatar)
 *
 * descriptor 1 ตัว = { key, icon, label, color?, to?, onClick?, kind?, on?, danger? }
 *   - `to`     → ให้ host วาดเป็นลิงก์ (react-router)
 *   - `kind: 'toggle'` → มีสวิตช์ท้ายแถว (ธีม) · `on` = สถานะสวิตช์
 *   - รายการที่ host ไม่ได้ส่ง handler มาให้ (เช่นหน้าไหนยังไม่รองรับ) จะถูกตัดออกเอง
 */

export function buildProfileMenu({ realRole, canRemote = false, remoteCode = null, theme = 'dark', on = {} } = {}) {
  const items = [];
  // ไม่มี handler และไม่ใช่ลิงก์ = host นั้นยังไม่รองรับ → ไม่ต้องโชว์ (กันปุ่มกดแล้วไม่มีอะไรเกิดขึ้น)
  const push = (it) => { if (it.onClick || it.to) items.push(it); };

  push({ key: 'avatar',    icon: '📷', label: 'เปลี่ยนรูปโปรไฟล์',      onClick: on.avatar });
  push({ key: 'signature', icon: '✍️', label: 'ลายเซ็น',                onClick: on.signature });
  push({ key: 'password',  icon: '🔐', label: 'เปลี่ยนรหัสผ่าน',        onClick: on.password });
  push({ key: 'feedback',  icon: '💬', label: 'แจ้งปัญหา / ข้อเสนอแนะ', onClick: on.feedback });

  // 🎭 จำลองมุมมอง role — ยึด "role จริง" เสมอ (อยู่ในโหมดจำลองแล้วยังต้องสลับ/ออกได้)
  if (realRole === 'admin') {
    push({ key: 'viewAs', icon: '🎭', label: 'จำลองมุมมอง role (ทดสอบ)', color: '#c084fc', onClick: on.viewAs });
  }

  // รีโมทจอ (คู่กัน) — เห็นเฉพาะ role ที่มีสิทธิ์ page:/remote · 🎮 คุมจากมือถือ · 📺 จอนี้เป็นจอตาม
  if (canRemote) {
    push({ key: 'remoteLink', icon: '🎮', label: 'รีโมทจอ (คุมจากมือถือ)', to: '/remote' });
    push({
      key: 'remoteRecv', icon: '📺',
      label: remoteCode ? `รับรีโมทอยู่ · ${remoteCode}` : 'รับรีโมทจอ (จอตาม)',
      color: remoteCode ? 'var(--accent)' : undefined,
      onClick: on.toggleRemote,
    });
  }

  push({
    key: 'theme', kind: 'toggle', icon: theme === 'dark' ? '☀️' : '🌙',
    label: theme === 'dark' ? 'Light Mode' : 'Dark Mode',
    on: theme === 'dark', onClick: on.toggleTheme,
  });
  push({ key: 'logout', icon: '🚪', label: 'ออกจากระบบ', color: '#ff6b6b', danger: true, onClick: on.logout });

  return items;
}
