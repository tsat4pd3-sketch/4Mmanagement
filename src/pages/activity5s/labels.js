/* ══ ♻️ 5S — ป้าย/ค่าคงที่ (ยกจากระบบ Core 27/11 · ไฟล์ข้อมูลล้วน — แปล tr() ตอนวาดเท่านั้น) ══ */

export const ACT_CODE = 'act02';
export const PERM = ['act_5s', 'manage'];        // has_perm('act_5s:manage') ฝั่ง RLS ชุดเดียวกัน

export const AREA_TYPES = [
  { value: 'factory', label: 'โรงงาน' },
  { value: 'office',  label: 'สำนักงาน' },
];

export const ROLES = [
  { value: 'admin',    label: 'ผู้ดูแล' },
  { value: 'chairman', label: 'ประธาน' },
  { value: 'vice',     label: 'รองประธาน' },
  { value: 'standard', label: 'ทีมมาตรฐาน' },
  { value: 'academic', label: 'ทีมวิชาการ' },
  { value: 'auditor',  label: 'ทีมตรวจ' },
  { value: 'pr',       label: 'ประชาสัมพันธ์' },
  { value: 'owner',    label: 'ผู้รับผิดชอบพื้นที่' },
];

export const UNITS = [
  { value: 'standard', label: 'ทีมมาตรฐาน' },
  { value: 'academic', label: 'ทีมวิชาการ' },
  { value: 'pr',       label: 'ประชาสัมพันธ์' },
  { value: 'audit',    label: 'ทีมตรวจ' },
];

export const STATUS = [
  { value: 'Active',   label: 'ใช้งาน' },
  { value: 'Inactive', label: 'ปิด' },
];

export const S_GROUPS = ['1S', '2S', '3S', '4S', '5S'];
export const S_GROUP_LABEL = { '1S': 'สะสาง', '2S': 'สะดวก', '3S': 'สะอาด', '4S': 'สร้างมาตรฐาน', '5S': 'สร้างวินัย' };
export const AUDIT_TEAMS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

/* Detail Bar ของแต่ละส่วน (Sub Bar ?tab=) — Setting รอบ 1 · Dashboard รอบ 2 (27/11) · Edit Data รอบถัดไป */
export const DASH_SECTIONS = [
  { key: 'strategy', label: 'กลยุทธ์' },
  { key: 'summary',  label: 'ภาพรวม' },
  { key: 'ranking',  label: 'อันดับ' },
  { key: 'auditor',  label: 'ผู้ตรวจ' },
  { key: 'schedule', label: 'แผนงาน' },
  { key: 'team',     label: 'ทีม' },
];
/* 28/11 (คำสั่ง user "เกณฑ์ผ่าน เปลี่ยนเป็น กลยุทธ์"): กลยุทธ์ = อัปโหลด PDF 16:9 ≤ 5 หน้า (ของกลาง useStrategySetting) · อยู่หน้าแรกแบบ Dashboard
   · เกณฑ์ผ่าน (act02_setting pass_self/pass_committee) ยังอยู่ในฐาน — Dashboard อ่านค่าเดิม แต่ไม่มีหน้าแก้แล้ว */
export const SETTING_SECTIONS = [
  { key: 'strategy',  label: 'กลยุทธ์' },
  { key: 'area',      label: 'พื้นที่' },
  { key: 'team',      label: 'ทีม' },
  { key: 'checklist', label: 'หัวข้อตรวจ' },
  { key: 'plan',      label: 'แผนตรวจ' },
  { key: 'task',      label: 'แผนงาน' },     // 28/11 แผนงานกิจกรรม (act02_task · Gantt ที่ Dashboard) — คนละอันกับแผนตรวจ
];

export const labelOf = (list, v) => list.find(x => x.value === v)?.label ?? v ?? '';

/* team_key = act02|ปี|รหัส|บทบาท|ทีม|พื้นที่ (ไม่ซ้ำ — คนเดียวกันมีได้หลายบทบาท) */
export const teamKey = (r) => ['act02', r.year, r.employee_code, r.role, r.team || '-', r.act_area || '-'].join('|');

/* หน่วยงานย่อยตามบทบาท (กติกาเดิมของ Core) · ประธาน/รอง/ผู้ดูแล เลือกเอง */
export const unitOfRole = (role, picked) =>
  ['standard', 'academic', 'pr'].includes(role) ? role : ['auditor', 'owner'].includes(role) ? 'audit' : (picked || null);
