// ── ชื่อชุดสิทธิ์ (role) ที่แสดงผลทั้งแอป — source of truth จุดเดียว (2026-07-13) ──
// หลักตั้งชื่อ: บอก "ขอบเขตสิทธิ์ในระบบ" ห้ามใช้คำตำแหน่งงานบริษัท (ผู้จัดการ/หัวหน้าส่วน/หัวหน้าไลน์ ฯลฯ)
// เพื่อไม่ชนกับตำแหน่งจริงใน profiles.position — role คือ "ชุดสิทธิ์" ไม่ใช่ตำแหน่ง (ดู CLAUDE.md "Role System")
// ⚠️ รหัส (key) คือค่าใน DB enum user_role — ห้ามเปลี่ยน key ที่นี่ เปลี่ยนได้เฉพาะ label/icon/desc
export const ROLE_META = {
  admin:            { icon: '🛡️', label: 'ผู้ดูแลระบบ',     en: 'System Admin',     color: 'var(--accent)', desc: 'ทุกอย่าง + จัดการผู้ใช้และสิทธิ์' },
  manager:          { icon: '🏭', label: 'สิทธิ์ทั้งฝ่าย',   en: 'Full Access',      color: '#f59e0b', desc: 'เห็นกว้างทุกโมดูล (จำกัดบางส่วนงานได้ด้วย Section)' },
  supervisor:       { icon: '🏢', label: 'สิทธิ์ระดับส่วน',  en: 'Section Scope',    color: '#4d9fff', desc: 'จัดการข้อมูลภายใน Section ที่รับผิดชอบ' },
  leader:           { icon: '👥', label: 'สิทธิ์ระดับไลน์',  en: 'Line/Team Scope',  color: '#22c55e', desc: 'เฉพาะไลน์ + ทีมที่รับผิดชอบ' },
  qa:               { icon: '✅', label: 'งานคุณภาพ',        en: 'Quality',          color: '#c084fc', desc: 'อนุมัติ 4M/CQI-15 + QA Center' },
  document_control: { icon: '🗂️', label: 'งานเอกสาร',        en: 'Document Control', color: '#fb923c', desc: 'ปฏิทินบริษัท + เอกสารควบคุม' },
  sale:             { icon: '🚚', label: 'ขาย-จัดส่ง',       en: 'Sales & Delivery', color: '#38bdf8', desc: 'Forecast, Delivery, Kanban' },
  mtn:              { icon: '🔧', label: 'ซ่อมบำรุง',        en: 'Maintenance',      color: '#fb7185', desc: 'PM, ผังเครื่องจักร, ฐานข้อมูลเครื่องจักร' },
  engineer:         { icon: '⚙️', label: 'งานวิศวกรรม',      en: 'Engineering',      color: '#2dd4bf', desc: 'อัพเดท BOM / EC / New Model (Product Master)' },
  planner_store:    { icon: '📦', label: 'แผนงาน-คลัง',      en: 'Planner & Store',  color: '#a3e635', desc: 'Store, Kanban, Rack, Rundown + อัพโหลด Forecast' },
  display:          { icon: '📺', label: 'จอแสดงผล',         en: 'View Only',        color: '#94a3b8', desc: 'ดูอย่างเดียว ไม่มี Auto-Logout (จอ TV/บอร์ด)' },
  // ⚠️ 'dept_admin' ไม่ใช่ base role — เป็น "bucket สิทธิ์" ของ flag แอดมินหน่วยงาน (profiles.is_dept_admin)
  //   ใช้เป็นคอลัมน์ใน /permissions ตั้งว่าแอดมินหน่วยงานทำ action อะไรได้ · ห้ามเลือกเป็น role ของ user
  //   (bucket:true → AddUser/ตัวเลือก role กรองออก) · ดู migration 20260803_dept_admin.sql
  dept_admin:       { icon: '🛡️', label: 'แอดมินหน่วยงาน',   en: 'Dept Admin (flag)', color: '#eab308', desc: 'ชุดสิทธิ์เพิ่มของ flag "เป็นแอดมินหน่วยงาน" — แก้/ตั้งค่า/อนุมัติ เฉพาะหน่วยงานตัวเอง', bucket: true },
};

// รายการสำหรับ dropdown/radio เลือก base role ของ user — ตัด bucket (dept_admin) ออก
export const ROLE_OPTIONS = Object.entries(ROLE_META).filter(([, m]) => !m.bucket).map(([value, m]) => ({ value, ...m }));
// รวม bucket ด้วย — ใช้เป็นคอลัมน์ในหน้าจัดการสิทธิ์ (/permissions)
export const PERMISSION_COLUMN_ROLES = Object.entries(ROLE_META).map(([value, m]) => ({ value, ...m }));

// ป้ายสั้นสำหรับชิป/หัวคอลัมน์ เช่น "🏭 สิทธิ์ทั้งฝ่าย" — role แปลกที่ไม่รู้จักคืน key เดิม
export const roleLabel = (role) => {
  const m = ROLE_META[role];
  return m ? `${m.icon} ${m.label}` : role;
};
