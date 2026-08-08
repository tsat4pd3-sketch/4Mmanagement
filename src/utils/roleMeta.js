// ── ชื่อชุดสิทธิ์ (role) ที่แสดงผลทั้งแอป — source of truth จุดเดียว (2026-07-13) ──
// หลักตั้งชื่อ: บอก "ขอบเขตสิทธิ์ในระบบ" ห้ามใช้คำตำแหน่งงานบริษัท (ผู้จัดการ/หัวหน้าส่วน/หัวหน้าไลน์ ฯลฯ)
// เพื่อไม่ชนกับตำแหน่งจริงใน profiles.position — role คือ "ชุดสิทธิ์" ไม่ใช่ตำแหน่ง (ดู CLAUDE.md "Role System")
// ⚠️ รหัส (key) คือค่าใน DB enum user_role — ห้ามเปลี่ยน key ที่นี่ เปลี่ยนได้เฉพาะ label/icon/desc
export const ROLE_META = {
  admin:            { icon: '🛡️', label: 'ผู้ดูแลระบบ',     en: 'System Admin',     color: 'var(--accent)', desc: 'ทุกอย่าง + จัดการผู้ใช้และสิทธิ์', axis: 'scope' },
  manager:          { icon: '🏭', label: 'สิทธิ์ทั้งฝ่าย',   en: 'Full Access',      color: '#f59e0b', desc: 'เห็นกว้างทุกโมดูล (จำกัดบางส่วนงานได้ด้วย Section)', axis: 'scope' },
  supervisor:       { icon: '🏢', label: 'สิทธิ์ระดับส่วน',  en: 'Section Scope',    color: '#4d9fff', desc: 'จัดการข้อมูลภายใน Section ที่รับผิดชอบ', axis: 'scope' },
  leader:           { icon: '👥', label: 'สิทธิ์ระดับไลน์',  en: 'Line/Team Scope',  color: '#22c55e', desc: 'เฉพาะไลน์ + ทีมที่รับผิดชอบ', axis: 'scope' },
  qa:               { icon: '✅', label: 'งานคุณภาพ',        en: 'Quality',          color: '#c084fc', desc: 'อนุมัติ 4M/CQI-15 + QA Center', axis: 'unit' },
  document_control: { icon: '🗂️', label: 'งานเอกสาร',        en: 'Document Control', color: '#fb923c', desc: 'ปฏิทินบริษัท + เอกสารควบคุม', axis: 'unit' },
  sale:             { icon: '🚚', label: 'ขาย-จัดส่ง',       en: 'Sales & Delivery', color: '#38bdf8', desc: 'Forecast, Delivery, Kanban', axis: 'unit' },
  mtn:              { icon: '🔧', label: 'ซ่อมบำรุง',        en: 'Maintenance',      color: '#fb7185', desc: 'PM, ผังเครื่องจักร, ฐานข้อมูลเครื่องจักร', axis: 'unit' },
  engineer:         { icon: '⚙️', label: 'ส่วนวิศวกรรม',     en: 'Process Engineering', color: '#2dd4bf', desc: 'หน่วยงานวิศวกรรมกระบวนการ — BOM / EC / New Model · ⚠️ ไม่ใช่ "ตำแหน่งวิศวกร" (วิศวกรแผนกช่างใช้ role ซ่อมบำรุง)', axis: 'unit' },
  planner_store:    { icon: '📦', label: 'แผนงาน-คลัง',      en: 'Planner & Store',  color: '#a3e635', desc: 'Store, Kanban, Rack, Rundown + อัพโหลด Forecast', axis: 'unit' },
  display:          { icon: '📺', label: 'จอแสดงผล',         en: 'View Only',        color: '#94a3b8', desc: 'ดูอย่างเดียว ไม่มี Auto-Logout (จอ TV/บอร์ด)', axis: 'device' },
  // ⚠️ 'dept_admin' ไม่ใช่ base role — เป็น "bucket สิทธิ์" ของ flag แอดมินหน่วยงาน (profiles.is_dept_admin)
  //   ใช้เป็นคอลัมน์ใน /permissions ตั้งว่าแอดมินหน่วยงานทำ action อะไรได้ · ห้ามเลือกเป็น role ของ user
  //   (bucket:true → AddUser/ตัวเลือก role กรองออก) · ดู migration 20260803_dept_admin.sql
  dept_admin:       { icon: '🛡️', label: 'แอดมินหน่วยงาน',   en: 'Dept Admin (flag)', color: '#eab308', desc: 'ชุดสิทธิ์เพิ่มของ flag "เป็นแอดมินหน่วยงาน" — แก้/ตั้งค่า/อนุมัติ เฉพาะหน่วยงานตัวเอง', bucket: true, axis: 'tier' },
};

// ── แกนของ role (2026-08-06) ────────────────────────────────────────────────
// ⚠️ `user_role` คอลัมน์เดียวถือ 3 เรื่องปนกัน ทำให้คนเข้าใจผิดซ้ำๆ ว่า role = ตำแหน่งงาน
//    (เคสจริง: "engineer" อ่านเหมือนตำแหน่งวิศวกร ทั้งที่หมายถึงหน่วยงานวิศวกรรม —
//     วิศวกรที่ทำ PM จริงสังกัดแผนก MTN จึงใช้ role 'mtn')
// แก้โดย "ติดป้ายแกน" แล้วให้หน้าจอจัดกลุ่มตามแกน — ไม่ต้องแตะ enum ใน DB (ดู CLAUDE.md "Role System")
//   scope  = ระดับสิทธิ์/ขอบเขตข้อมูล (เห็นกว้างแค่ไหน)
//   unit   = หน่วยงานที่สังกัด (ทำงานเรื่องอะไร)
//   device = อุปกรณ์ ไม่ใช่คน (จอ TV/บอร์ด)
//   tier   = ชั้นสิทธิ์เสริมที่ซ้อนบน role (bucket ของ flag — ไม่ใช่ base role)
// เพิ่ม role ใหม่ → ต้องระบุ axis ด้วยเสมอ (ไม่ระบุ = ตกไปกลุ่ม 'unit' ตาม default)
export const ROLE_AXES = [
  { key: 'scope',  label: 'ระดับสิทธิ์ / ขอบเขตข้อมูล', hint: 'เห็นและจัดการข้อมูลได้กว้างแค่ไหน' },
  { key: 'unit',   label: 'หน่วยงานที่สังกัด',          hint: 'ทำงานเรื่องอะไร — ไม่ใช่ตำแหน่งงาน (ตำแหน่งอยู่ที่ช่อง "ตำแหน่งงาน")' },
  { key: 'device', label: 'อุปกรณ์ (ไม่ใช่คน)',         hint: 'จอแสดงผลหน้าไลน์ — ดูอย่างเดียว' },
  { key: 'tier',   label: 'ชั้นสิทธิ์เสริม',            hint: 'ซ้อนบน role เดิม ไม่ใช่ role ของ user' },
];
export const axisOf = (role) => ROLE_META[role]?.axis || 'unit';
/** จัดกลุ่ม role ตามแกน — คืน [{ axis, label, hint, roles: [...] }] เฉพาะแกนที่มีสมาชิก */
export function groupRolesByAxis(roles) {
  return ROLE_AXES.map(a => ({ ...a, axis: a.key, roles: (roles || []).filter(r => axisOf(r.value ?? r) === a.key) }))
                  .filter(g => g.roles.length);
}

// รายการสำหรับ dropdown/radio เลือก base role ของ user — ตัด bucket (dept_admin) ออก
export const ROLE_OPTIONS = Object.entries(ROLE_META).filter(([, m]) => !m.bucket).map(([value, m]) => ({ value, ...m }));
// รวม bucket ด้วย — ใช้เป็นคอลัมน์ในหน้าจัดการสิทธิ์ (/permissions)
export const PERMISSION_COLUMN_ROLES = Object.entries(ROLE_META).map(([value, m]) => ({ value, ...m }));

// ป้ายสั้นสำหรับชิป/หัวคอลัมน์ เช่น "🏭 สิทธิ์ทั้งฝ่าย" — role แปลกที่ไม่รู้จักคืน key เดิม
export const roleLabel = (role) => {
  const m = ROLE_META[role];
  return m ? `${m.icon} ${m.label}` : role;
};
