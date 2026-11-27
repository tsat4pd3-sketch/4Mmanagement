/* ══ 🎯 หมวด "กิจกรรม" — ทะเบียนหน้ากิจกรรม (2026-11-25 · คำสั่ง user) ══════════════════════════════
   9 กิจกรรม × โครงเดียวกัน 3 ส่วน (Dashboard · Edit Data · Setting) — หน้าเดียว `src/pages/Activity.jsx` วาดทุกตัว
   · โครง UI ตามภาพของ user: ① Main Bar ② Sub Bar (กิจกรรม + 3 ส่วนเป็นข้อย่อย) ④ Header (ชื่อ + breadcrumb)
     → Detail Bar (แถวเดียว ◀ ▶) + Tool Bar (ค้นหา · เพิ่ม · แก้ไข · ลบ ตำแหน่งตายตัว) → ③ Card Dashboard
     · เลื่อน Card Dashboard แล้ว Header + Detail Bar + Tool Bar ค้างบนจอทั้งก้อน (`FULL_STICKY_GROUPS` ใน App.jsx)
   · 🔴 **ยังไม่มีฐานข้อมูล** (user 25/11 "ยังไม่เพิ่มฐานข้อมูล") — Detail Bar = ตัวอย่าง XXX·YYY·ZZZ ·
     ปุ่ม Tool Bar กดได้แต่ขึ้นข้อความว่ายังไม่เชื่อมฐานข้อมูล · การ์ดเขียนบนจอว่ายังไม่มีข้อมูล (ห้ามโชว์ 0)
   · ไฟล์นี้ข้อมูลล้วน (App.jsx/navSubTabs.js import ตอนโหลดแอป)                                        */

export const ACTIVITY_GROUP = 'กิจกรรม';

/* path ต้องตรงกับ `to:` ใน NAV_ITEMS (App.jsx) + PAGE_GROUPS (/permissions) — มีด่าน activityPages.test.mjs */
export const ACTIVITIES = [
  { key: '100p',     path: '/activity-100p',     label: '100P' },
  { key: '5s',       path: '/activity-5s',       label: '5S' },
  { key: 'smart',    path: '/activity-smart',    label: 'Smart Factory' },
  { key: 'kyt',      path: '/activity-kyt',      label: 'KYT' },
  { key: 'kaizen',   path: '/activity-kaizen',   label: 'Kaizen' },   // คนละหน้ากับ /improvements เดิม (user เลือก 25/11 "หน้าใหม่ว่างแบบเดียวกัน")
  { key: 'qcc',      path: '/activity-qcc',      label: 'QCC' },
  { key: 'lean',     path: '/activity-lean',     label: 'Lean' },
  { key: 'cfo',      path: '/activity-cfo',      label: 'CFO' },
  { key: 'cfp',      path: '/activity-cfp',      label: 'CFP' },
];

/* 3 ส่วนของทุกกิจกรรม = ข้อย่อยใน Sub Bar (`?tab=`) — แท็บแรก = ค่าตั้งต้น */
export const ACTIVITY_TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'edit',      label: 'Edit Data' },
  { key: 'setting',   label: 'Setting' },
];

/* Detail Bar — ตัวอย่างวางโครง (user เลือก 25/11) · เปลี่ยนเป็นรายการจริงตอนทำฐานข้อมูล */
export const ACTIVITY_SAMPLE_SECTIONS = [
  { key: 'xxx', label: 'XXX' },
  { key: 'yyy', label: 'YYY' },
  { key: 'zzz', label: 'ZZZ' },
];

export const activityByPath = (path) => ACTIVITIES.find(a => a.path === path) || null;
