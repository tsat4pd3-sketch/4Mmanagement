/* ══ 🧩 wfSchema — กฎกลางของ e-Workflow (ใบงานที่ user สร้างเอง · 2026-11-13) ══════════════════
   📄 docs/E-WORKFLOW-DESIGN.md · docs/modules/e-workflow.md
   ไฟล์นี้ = ทะเบียนชนิดช่อง / ชนิดขั้น / กฎหาผู้อนุมัติ + ตัวตรวจ (pure · ไม่ยิง DB)
   🔴 ตัวตรวจฝั่งจอ = บอกผู้ใช้ทันที · ตัวตัดสินจริงอยู่ฝั่ง DB (`wf_check_data` / `wf_request_publish`)
      ⇒ แก้กฎที่นี่ต้องแก้ฟังก์ชัน SQL ให้ตรงกัน (migration 20261113b_e_workflow_phase1_main.sql)
   🔴 ช่องที่รับ "คน / เครื่อง / MAT / ไลน์" = picker กลางเท่านั้น (UI §5.1.2) — `picker` บอกหน้าว่าวาดด้วยตัวไหน
   🔴 ไม่มีชนิดช่อง "สูตร/สคริปต์" (สูตรเป็นของ utils กลาง · E-WORKFLOW-DESIGN §6.1)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

export const FIELD_TYPES = [
  { type: 'text',     label: 'ข้อความสั้น' },
  { type: 'textarea', label: 'ข้อความยาว' },
  { type: 'number',   label: 'ตัวเลข' },
  { type: 'date',     label: 'วันที่' },
  { type: 'yesno',    label: 'ใช่ / ไม่ใช่' },
  { type: 'select',   label: 'ตัวเลือก (เลือก 1)', hasOptions: true },
  { type: 'person',   label: 'ชื่อคน (ทะเบียน)',     picker: 'PersonSelect' },
  { type: 'machine',  label: 'เครื่องจักร (ทะเบียน)', picker: 'MachineSelect' },
  { type: 'mat',      label: 'MAT / พาร์ท (ทะเบียน)', picker: 'ProductSelect' },
  { type: 'line',     label: 'ไลน์ผลิต (ทะเบียน)',   picker: 'LineSelect' },
  { type: 'heading',  label: 'หัวข้อคั่น (ไม่เก็บค่า)', display: true },
];
export const FIELD_TYPE_MAP = Object.fromEntries(FIELD_TYPES.map(t => [t.type, t]));

export const STEP_KINDS = [
  { kind: 'approve', label: 'อนุมัติ (อนุมัติ/ตีกลับ/ส่งกลับแก้ได้)' },
  { kind: 'ack',     label: 'รับทราบ (กดรับทราบอย่างเดียว)' },
];

/* กฎหาผู้อนุมัติ — ต้องตรงกับ `wf_resolve()` ฝั่ง DB */
export const ASSIGNEE_RULES = [
  { rule: 'perm_in_unit', label: 'คนที่ถือสิทธิ์ (คีย์) ในส่วนงาน', hint: 'ทุกคนที่ถือคีย์นี้ในส่วนงานที่เลือก ได้งานพร้อมกัน — ใครกดก่อนก็ได้' },
  { rule: 'creator_head', label: 'หัวหน้าของผู้เปิดใบ (ตามผังองค์กร)', hint: 'ไล่ผังองค์กรขึ้นไปหาหัวหน้า/รักษาการ (ตั้งที่ /org-setup)' },
  { rule: 'person',       label: 'ระบุตัวคน', hint: 'คนย้ายงานแล้ว flow ค้าง — ใช้เท่าที่จำเป็น' },
  { rule: 'creator',      label: 'ผู้เปิดใบเอง (ขั้นรับทราบเท่านั้น)' },
];
export const RULE_LABEL = Object.fromEntries(ASSIGNEE_RULES.map(r => [r.rule, r.label]));

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const isBlank = (v) => v == null || String(v).trim() === '';

/** ตรวจคำตอบตามฟอร์ม — คืนข้อความผิดข้อแรก หรือ null (ตรรกะเดียวกับ `wf_check_data`) */
export function checkData(form, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'ข้อมูลฟอร์มไม่ถูกต้อง';
  for (const f of form?.fields || []) {
    if (FIELD_TYPE_MAP[f.type]?.display) continue;
    const raw = data[f.key];
    const v = isBlank(raw) ? null : String(raw).trim();
    const name = f.label || f.key;
    if (f.required && v == null) return `กรุณากรอก: ${name}`;
    if (v != null && f.type === 'number' && !/^-?[0-9]+(\.[0-9]+)?$/.test(v)) return `ต้องเป็นตัวเลข: ${name}`;
    if (v != null && f.type === 'select' && !(f.options || []).includes(v)) return `ค่าที่เลือกไม่อยู่ในตัวเลือก: ${name}`;
  }
  return null;
}

/** ตรวจนิยามก่อนส่งขอเผยแพร่ — คืน [ข้อความ] (ว่าง = ผ่าน) · ตรงกับด่านใน `wf_request_publish` + เพิ่มด่านที่จอเห็นก่อน */
export function validateDef({ key, name, ownerSection, form, flow, startRoles } = {}) {
  const errs = [];
  if (!KEY_RE.test(String(key || ''))) errs.push('รหัสใบงาน (key) ต้องเป็นอังกฤษตัวเล็ก/ตัวเลข/_ ขึ้นต้นด้วยตัวอักษร 2–40 ตัว');
  if (isBlank(name)) errs.push('ต้องตั้งชื่อใบงาน');
  if (isBlank(ownerSection)) errs.push('ต้องระบุส่วนงานเจ้าของใบ');
  const fields = form?.fields || [];
  if (!fields.filter(f => !FIELD_TYPE_MAP[f.type]?.display).length) errs.push('ฟอร์มยังไม่มีช่องกรอก');
  const seen = new Set();
  fields.forEach((f, i) => {
    const at = `ช่องที่ ${i + 1}`;
    if (!KEY_RE.test(String(f.key || ''))) errs.push(`${at}: รหัสช่องต้องเป็นอังกฤษตัวเล็ก/ตัวเลข/_`);
    else if (seen.has(f.key)) errs.push(`${at}: รหัสช่อง "${f.key}" ซ้ำ`);
    seen.add(f.key);
    if (!FIELD_TYPE_MAP[f.type]) errs.push(`${at}: ชนิดช่องไม่รู้จัก`);
    if (isBlank(f.label)) errs.push(`${at}: ต้องมีชื่อช่อง`);
    if (f.type === 'select' && !(f.options || []).filter(o => !isBlank(o)).length) errs.push(`${at}: ตัวเลือกยังว่าง`);
  });
  const steps = flow?.steps || [];
  if (!steps.length) errs.push('ต้องมีอย่างน้อย 1 ขั้น');
  const sk = new Set();
  steps.forEach((s, i) => {
    const at = `ขั้นที่ ${i + 1}`;
    if (!KEY_RE.test(String(s.key || ''))) errs.push(`${at}: รหัสขั้นต้องเป็นอังกฤษตัวเล็ก/ตัวเลข/_`);
    else if (sk.has(s.key)) errs.push(`${at}: รหัสขั้น "${s.key}" ซ้ำ`);
    sk.add(s.key);
    if (isBlank(s.label)) errs.push(`${at}: ต้องมีชื่อขั้น`);
    const a = s.assignee || {};
    if (!RULE_LABEL[a.rule]) errs.push(`${at}: ยังไม่ได้ตั้งผู้อนุมัติ`);
    if (a.rule === 'creator' && (s.kind || 'approve') === 'approve') errs.push(`${at}: ขั้นอนุมัติ ให้ผู้เปิดใบอนุมัติเองไม่ได้`);
    if (a.rule === 'perm_in_unit' && isBlank(a.perm)) errs.push(`${at}: ยังไม่ได้เลือกคีย์สิทธิ์`);
    if (a.rule === 'perm_in_unit' && isBlank(a.unit)) errs.push(`${at}: ยังไม่ได้เลือกส่วนงาน`);
    if (a.rule === 'person' && isBlank(a.profile_id)) errs.push(`${at}: ยังไม่ได้เลือกคน`);
  });
  if (!(startRoles || []).length) errs.push('ยังไม่ได้เลือกว่า role ไหนเปิดใบได้');
  return errs;
}

/** รหัสช่อง/ขั้นใหม่ที่ไม่ซ้ำ (f1, f2 …) */
export function nextKey(prefix, list) {
  const used = new Set((list || []).map(x => x.key));
  for (let i = 1; i < 1000; i += 1) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
  return `${prefix}${Date.now()}`;
}

/* 🧪 แม่แบบ "4M Change" (13/11 · user "ลองอย่าง flow ของ 4M") — ใบทดลองในตัวสร้าง **ไม่ใช่ใบ 4M จริง**
   (ใบ 4M จริงยังเดินที่ /report แบบเดิม · การเอา flow เดิมเข้าตัวสร้างต้องออกแบบแยก E-WORKFLOW-DESIGN §7.5)
   ขั้นอนุมัติใช้คีย์เดียวกับปุ่มอนุมัติ 4M จริง (four_m:approve_sv / approve_qa) */
export const TEMPLATE_4M = Object.freeze({
  name: 'ทดลอง 4M Change (แม่แบบ)',
  form: {
    fields: [
      { key: 'category', type: 'select', label: 'หมวด 4M', required: true, options: ['Man', 'Machine', 'Method', 'Material'] },
      { key: 'line', type: 'line', label: 'ไลน์', required: true },
      { key: 'mat', type: 'mat', label: 'พาร์ท (MAT)' },
      { key: 'detail', type: 'textarea', label: 'รายละเอียดการเปลี่ยนแปลง', required: true },
      { key: 'requires_qa_note', type: 'heading', label: 'ส่วน QA จะตรวจในขั้นที่ 2' },
    ],
  },
  flow: {
    onReturn: 'first',
    steps: [
      { key: 'sv', label: 'หัวหน้างานอนุมัติ', kind: 'approve', assignee: { rule: 'perm_in_unit', perm: 'four_m:approve_sv', unit: 'instance' } },
      { key: 'qa', label: 'QA อนุมัติ', kind: 'approve', assignee: { rule: 'perm_in_unit', perm: 'four_m:approve_qa', unit: 'QA' } },
    ],
  },
  startRoles: ['leader', 'supervisor'],
});
