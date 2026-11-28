/* ══ 🏭 Smart Factory (act03) — ป้าย/ค่าคงที่ (ยกจากเว็บ TSAT4 Activity "SMF" 28/11 · ไฟล์ข้อมูลล้วน — แปล tr() ตอนวาดเท่านั้น) ══ */

export const ACT_CODE = 'act03';
export const PERM = ['act_smf', 'manage'];      // has_perm('act_smf:manage') ฝั่ง RLS ชุดเดียวกัน

/* ทีม (docs ของเว็บเดิม act-teams.md): คณะกรรมการ = unit ว่าง · ทีมย่อยของโครงการ = unit รหัสโครงการ */
export const COMMITTEE_ROLES = [
  { value: 'chairman', label: 'ประธาน' },
  { value: 'vice',     label: 'รองประธาน' },
  { value: 'advisor',  label: 'ที่ปรึกษา' },
  { value: 'admin',    label: 'ผู้ประสานงาน' },
  { value: 'member',   label: 'สมาชิกหลัก' },
];
export const SUB_ROLES = [
  { value: 'chairman', label: 'หัวหน้าทีม' },
  { value: 'vice',     label: 'รองหัวหน้าทีม' },
  { value: 'member',   label: 'ทีม SMF' },
];
/** ป้ายบทบาท: ทีมย่อย Work Flow = "สมาชิกทีมรอง" (กติกาเว็บเดิม) */
export const roleLabel = (role, unit) => {
  if (!unit) return COMMITTEE_ROLES.find(r => r.value === role)?.label || role;
  if (role === 'member' && unit === 'workflow') return 'สมาชิกทีมรอง';
  return SUB_ROLES.find(r => r.value === role)?.label || role;
};

export const STATUS = [
  { value: 'Active',   label: 'ใช้งาน' },
  { value: 'Inactive', label: 'ปิด' },
];
export const TEAM_TYPES = [
  { value: 'team',       label: 'ทำเป็นทีม' },
  { value: 'individual', label: 'ทำเดี่ยว' },
];
export const TARGET_TYPES = [
  { value: 'plan',  label: 'วัดตามแผนงาน' },
  { value: 'count', label: 'วัดตามจำนวนโครงการ' },
];

/* Detail Bar ของแต่ละส่วน (Sub Bar ?tab=) */
export const DASH_SECTIONS = [
  { key: 'strategy', label: 'กลยุทธ์' },
  { key: 'summary',  label: 'ภาพรวม' },
  { key: 'plan',     label: 'แผนงาน' },
  { key: 'team',     label: 'ทีม' },
];
export const SETTING_SECTIONS = [
  { key: 'strategy', label: 'กลยุทธ์' },
  { key: 'project',  label: 'โครงการ' },
  { key: 'team',     label: 'ทีม' },
  { key: 'plan',     label: 'แผนงาน' },
];

export const labelOf = (list, v) => list.find(x => x.value === v)?.label ?? v ?? '';

/* team_key = act03|ปี|รหัส|บทบาท|unit (ไม่ซ้ำ — คนเดียวกันมีได้หลายบทบาท/หลายโครงการ) */
export const teamKey = (r) => ['act03', r.year, r.employee_code, r.role, r.unit || '-'].join('|');

/* ── Edit Data (รอบ 2 · 28/11) ── */
export const EDIT_SECTIONS = [
  { key: 'month',    label: 'ผลงานรายเดือน' },
  { key: 'workflow', label: 'Work Flow Automation' },
];

/* Work Flow Automation — ตัวเลือกชุดเดียวกับเว็บเดิม (act-workflow.js) · ค่าที่เก็บ = ภาษาอังกฤษ (ข้อมูลที่ย้ายมาใช้ค่านี้) */
export const WF_STATUS = [
  { value: 'Idea',        label: 'Idea (แนวคิด)',             tone: 'muted' },
  { value: 'Prototype',   label: 'Prototype (ต้นแบบ)',        tone: 'amber' },
  { value: 'Testing',     label: 'Testing (ทดสอบ)',           tone: 'blue' },
  { value: 'Implemented', label: 'Implemented (ใช้งานจริง)', tone: 'green' },
];
export const WF_BENEFITS = [
  { value: 'Reduce Paper',                  label: 'ลดการใช้กระดาษ' },
  { value: 'Reduce Working Time',           label: 'ลดเวลาการทำงาน' },
  { value: 'Reduce Process Steps',          label: 'ลดขั้นตอนการทำงาน' },
  { value: 'Reduce Manpower',               label: 'ลดกำลังคน' },
  { value: 'Reduce Human Error',            label: 'ลดความผิดพลาด' },
  { value: 'Reduce Waiting Time',           label: 'ลดเวลารอคอย' },
  { value: 'Improve Data Accessibility',    label: 'เข้าถึงข้อมูลได้ง่ายขึ้น' },
  { value: 'Improve Tracking & Monitoring', label: 'ติดตามสถานะได้ดีขึ้น' },
];
export const WF_FREQUENCY = ['ทุกวัน (Daily)', 'หลายครั้งต่อวัน', 'ทุกสัปดาห์ (Weekly)', 'ทุกเดือน (Monthly)', 'อื่นๆ'];
export const WF_DIFFICULTY = ['Easy', 'Medium', 'Hard'];
export const WF_BUDGET = ['Free', 'Low', 'Medium', 'High'];
const TECH_COMMON = ['Web Application', 'Mobile Application', 'Digital Form', 'QR Code', 'Workflow Approval', 'Auto Notification', 'Dashboard', 'AI / OCR', 'IoT', 'Other'];
/** เทคโนโลยีตามโครงการ (เว็บเดิมแยก oee / vision / อื่น) */
export const wfTechOptions = (code) => (code === 'oee'
  ? ['Smart OEE System', 'IoT Sensors & Gateway', 'PLC / Machine Data Logging', 'Real-time OEE Dashboard', 'Auto Downtime Alert / Line Notify', 'Digital Checklist & Maintenance Form', 'Web Application', 'Mobile Application', 'Other']
  : code === 'vision'
    ? ['Vision Inspection Camera', 'AI / Deep Learning Object Detection', 'OCR / Barcode / 2D DataMatrix Scanner', 'Defect Sorting & Auto Reject System', 'Edge Computing Box', 'Real-time Inspection Dashboard', 'Web Application', 'Other']
    : TECH_COMMON);
