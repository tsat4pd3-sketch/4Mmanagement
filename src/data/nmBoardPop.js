/* ══ 📋 POP template + กติกาสี — ถอดจาก work flow ที่ IEC ส่งมาเอง ═══════════════════
   ที่มา: `Obeya_E_Board-V2.pptx` (IEC ส่ง 2026-09-24) — 4 สไลด์ บอกลำดับการเจาะบอร์ด
   ⚠️ ไฟล์นี้เป็น **แม่แบบ (template)** ไม่ใช่ข้อมูลของรุ่นใดรุ่นหนึ่ง
      IEC เขียนไว้ชัดว่า *"จำนวนข้อสามารถเปลี่ยนแปลงได้แล้วแต่ Model"* ⇒ รุ่นหนึ่งอาจมี
      sub KPI มากกว่า/น้อยกว่านี้ · แม่แบบนี้คือ "โครงที่ทุกรุ่นมีเหมือนกัน" เท่านั้น
   🔴 ห้าม hardcode จำนวนหัวข้อในหน้าจอ — ให้นับจากข้อมูลจริงของรุ่นนั้นเสมอ
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** 7.1 Engineering document — ทีมวิศวกรรมเข้ามาอัปเดตเอง (สไลด์ 4) */
export const ENG_DOC_TOPICS = [
  'SE & CAE result', 'DWG & 3D update', 'CPM & Risk', 'ECI control list', 'ECI modify status',
  'PPC', 'Tooling schedule', 'Production trial', 'Order update', 'Packing Std.',
  'KADAI status', 'Milestone KPI',
  'SPTT#1 document', 'SPTT#2 document', 'SPTT#3 document', 'SPTT#4 document', 'SOP document',
];

/** 7.2 QA document — ทีมคุณภาพเข้ามาอัปเดตเอง (สไลด์ 4) */
export const QA_DOC_TOPICS = [
  'Part Quality status', 'CF concept status', 'CF making schedule', 'WI CF Lv.3', 'IMDS',
  'SHUKEN + QBI', 'PFUS', 'Q-point', 'PCP', 'MCS / MICS', 'PPAP',
];

/** 🔴 POP = Main KPI **14 หัวข้อ** (IEC ระบุตัวเลขนี้เอง) · แถวขาวใต้แต่ละอันคือ sub KPI */
export const POP_TEMPLATE = [
  { no: '1',  key: 'kickoff',        label: 'Kick off' },
  { no: '2',  key: 'tdr',            label: 'Technical data review' },
  { no: '3',  key: 'tooling',        label: 'Tooling', subs: [
    { no: '3.1', key: 'stamping-die', label: 'Stamping die' },
    { no: '3.2', key: 'assembly-jig', label: 'Assembly jig' },
    { no: '3.3', key: 'checking-fixture', label: 'Checking fixture / Inspection jig' },
  ] },
  { no: '4',  key: 'packaging',      label: 'Packaging' },
  { no: '5',  key: 'construction',   label: 'Construction & Area renovation' },
  { no: '6',  key: 'prod-planning',  label: 'Production planning' },
  { no: '7',  key: 'document',       label: 'Document', subs: [
    { no: '7.1', key: 'eng-doc',  label: 'Engineering document',        topics: ENG_DOC_TOPICS, owner: 'วิศวกรรม' },
    { no: '7.2', key: 'qa-doc',   label: 'QA document',                 topics: QA_DOC_TOPICS,  owner: 'คุณภาพ' },
    { no: '7.3', key: 'line-doc', label: 'Production line document',    owner: 'ผลิต' },
    { no: '7.4', key: 'wh-doc',   label: 'Warehouse & Delivery document', owner: 'คลัง/จัดส่ง' },
  ] },
  { no: '8',  key: 'part-quality',   label: 'Part Quality' },
  { no: '9',  key: 'sptt',           label: 'SPTT Milestones', subs: [
    { no: '9.1', key: 'sptt1', label: 'SPTT#1 (Preparation)' },
    { no: '9.2', key: 'sptt2', label: 'SPTT#2 (Off tools stage)' },
    { no: '9.3', key: 'sptt3', label: 'SPTT#3 (LVPT)' },
    { no: '9.4', key: 'sptt4', label: 'SPTT#4 (HVPT)' },
  ] },
  { no: '10', key: 'part-delivery',  label: 'Part delivery (Each stage)' },
  { no: '11', key: 'sop-readiness',  label: 'SOP readiness' },
  { no: '12', key: 'sop',            label: 'SOP' },
  { no: '13', key: 'initial-sop',    label: 'Initial SOP' },
  { no: '14', key: 'project-review', label: 'Project Review' },
];

/** ล็อตส่งงาน 8 ขั้น + เงื่อนไขที่ต้องผ่านของแต่ละขั้น (สไลด์ 2 — PART DELIVERY / PART Quality)
 *  ⚠️ แม่แบบเท่านั้น — บางรุ่นใช้ชื่อล็อตต่างไป (D02D บนบอร์ดจริงมี "NS Lot" แทน "SKK X") */
export const LOT_TEMPLATE = [
  { no: 1, key: 'cv-ks',  label: 'CV / KS',    cond: 'OT · Q 90%' },
  { no: 2, key: 'skk-a',  label: 'SKK A LOT',  cond: 'OT · Q 90%' },
  { no: 3, key: 'skk-b',  label: 'SKK B LOT',  cond: 'OT · Q 95%' },
  { no: 4, key: 'skk-x',  label: 'SKK X LOT',  cond: 'OT · Q 100%' },
  { no: 5, key: 'acs',    label: 'ACS',        cond: 'OT/OTOP · Q 100%' },
  { no: 6, key: '1a',     label: '1A',         cond: 'OTOP · Q 100%' },
  { no: 7, key: 'mpt',    label: 'MPT',        cond: 'OTOP · Q 100%' },
  { no: 8, key: 'qcs',    label: 'QCS',        cond: 'OTOP · Q 100%' },
];

/** ตำแหน่งใน Responsible (แผง ④) — บอร์ดโชว์ 3 ระดับนี้เสมอ */
export const RESPONSIBLE_ROLES = ['Act-GM (IEC)', 'Manager PE', 'Sr. Engineer (Project Leader, PE)'];
