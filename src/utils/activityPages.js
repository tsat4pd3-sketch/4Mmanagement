/* ══ 🎯 หมวด "กิจกรรม" — ทะเบียนหน้ากิจกรรม (2026-11-25 · คำสั่ง user) ══════════════════════════════
   9 กิจกรรม × โครงเดียวกัน 3 ส่วน (Dashboard · Edit Data · Setting) — หน้าเดียว `src/pages/Activity.jsx` วาดทุกตัว
   · โครง UI ตามภาพของ user: ① Main Bar ② Sub Bar (กิจกรรม + 3 ส่วนเป็นข้อย่อย) ④ Header (ชื่อ + breadcrumb)
     → Detail Bar (แถวเดียว ◀ ▶) + Tool Bar (ค้นหา · เพิ่ม · แก้ไข · ลบ ตำแหน่งตายตัว) → ③ Card Dashboard
     · เลื่อน Card Dashboard แล้ว Header + Detail Bar + Tool Bar ค้างบนจอทั้งก้อน (`FULL_STICKY_GROUPS` ใน App.jsx)
   · 🔴 **ยังไม่มีฐานข้อมูล** (user 25/11 "ยังไม่เพิ่มฐานข้อมูล") — Detail Bar = ตัวอย่าง XXX·YYY·ZZZ ·
     ปุ่ม Tool Bar กดได้แต่ขึ้นข้อความว่ายังไม่เชื่อมฐานข้อมูล · การ์ดเขียนบนจอว่ายังไม่มีข้อมูล (ห้ามโชว์ 0)
   · ไฟล์นี้ข้อมูลล้วน (App.jsx/navSubTabs.js import ตอนโหลดแอป)                                        */

export const ACTIVITY_GROUP = 'กิจกรรม';

/* `code` = รหัสในตาราง `act_activity` (act01–act09 · คีย์ของ act_strategy ฯลฯ · 28/11)
   path ต้องตรงกับ `to:` ใน NAV_ITEMS (App.jsx) + PAGE_GROUPS (/permissions) — มีด่าน activityPages.test.mjs */
export const ACTIVITIES = [
  { key: '100p',     path: '/activity-100p',     code: 'act01', label: '100P' },
  { key: '5s',       path: '/activity-5s',       code: 'act02', label: '5S' },
  { key: 'smart',    path: '/activity-smart',    code: 'act03', label: 'Smart Factory' },
  { key: 'kyt',      path: '/activity-kyt',      code: 'act04', label: 'KYT' },
  { key: 'kaizen',   path: '/activity-kaizen',   code: 'act05', label: 'Kaizen' },   // คนละหน้ากับ /improvements เดิม (user เลือก 25/11 "หน้าใหม่ว่างแบบเดียวกัน")
  { key: 'qcc',      path: '/activity-qcc',      code: 'act06', label: 'QCC' },
  { key: 'lean',     path: '/activity-lean',     code: 'act07', label: 'Lean' },
  { key: 'cfo',      path: '/activity-cfo',      code: 'act08', label: 'CFO' },
  { key: 'cfp',      path: '/activity-cfp',      code: 'act09', label: 'CFP' },
];

/* 3 ส่วนของทุกกิจกรรม = ข้อย่อยใน Sub Bar (`?tab=`) — แท็บแรก = ค่าตั้งต้น */
export const ACTIVITY_TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'edit',      label: 'Edit Data' },
  { key: 'setting',   label: 'Setting' },
];

/* Detail Bar ของแต่ละส่วน (28/11 คำสั่ง user "กิจกรรมหน้าอื่นๆ จะมี 2 หน้าก่อน กลยุทธ์ ภาพรวม")
   Dashboard = กลยุทธ์ (PDF e-book) · ภาพรวม · Setting = กลยุทธ์ (อัปโหลด PDF) · Edit Data = ตัวอย่างวางโครงเดิม */
export const ACTIVITY_DASH_SECTIONS = [
  { key: 'strategy', label: 'กลยุทธ์' },
  { key: 'summary',  label: 'ภาพรวม' },
  { key: 'plan',     label: 'แผนงาน' },     // 28/11 Gantt (ตาราง act_task · ของกลาง PlanGantt)
];
export const ACTIVITY_SETTING_SECTIONS = [
  { key: 'strategy', label: 'กลยุทธ์' },
  { key: 'plan',     label: 'แผนงาน' },     // 28/11 เพิ่ม/แก้/ลบแผนงาน (ของกลาง usePlanSetting)
];

/* Edit Data — ตัวอย่างวางโครง (user เลือก 25/11) · เปลี่ยนเป็นรายการจริงตอนทำฐานข้อมูล */
export const ACTIVITY_SAMPLE_SECTIONS = [
  { key: 'xxx', label: 'XXX' },
  { key: 'yyy', label: 'YYY' },
  { key: 'zzz', label: 'ZZZ' },
];

export const activityByPath = (path) => ACTIVITIES.find(a => a.path === path) || null;
