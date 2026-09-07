/* ═══ NPI — พาร์ทใหม่ APQP / PPAP / ECI / Tooling — กฎ/สูตรกลาง (pure · ไม่ผูก UI/DB) ═══
   2026-09-07 · แบบเต็ม: docs/modules/npi-apqp.md

   จุดเดียวที่เป็นเจ้าของ:
     · ป้าย/สี/ลำดับสถานะทุกชนิด (เอกสารส่งมอบ · เฟส · PPAP · ECI · tooling · งาน)
     · ไฟสีเขียว/เหลือง/แดง — **ไม่เก็บใน DB** คำนวณจาก due/status ที่นี่เสมอ (ทุกจอตรงกัน)
     · การ instantiate พาร์ทจากแม่แบบ (snapshot + sync เติมเฉพาะที่ขาด)
     · สูตรตำแหน่งแท่ง Gantt · เช็คขาที่ ECI ยังไม่ผูกของจริง
   จุดใหม่ที่ทำเรื่องพวกนี้ให้เรียกไฟล์นี้ ห้ามเขียนเอง

   "วันนี้" รับเป็น 'YYYY-MM-DD' (จาก todayLocal — ห้าม toISOString) เทียบเป็น string ได้เลย */

export const DUE_SOON_DAYS = 7;   // เหลือ ≤ 7 วัน = เหลือง (1 สัปดาห์พอให้ตามงานทัน — เกณฑ์เดียวกับ PM forecast)

/* ── สถานะ ─────────────────────────────────────────────────────────────── */
export const DELIV_STATUS = {
  not_required: { label: 'ไม่ต้องใช้',   color: '#94a3b8', order: 0 },
  not_started:  { label: 'ยังไม่เริ่ม',  color: '#94a3b8', order: 1 },
  in_progress:  { label: 'กำลังทำ',      color: '#f59e0b', order: 2 },
  submitted:    { label: 'ส่งแล้ว/รออนุมัติ', color: '#3b82f6', order: 3 },
  approved:     { label: 'อนุมัติแล้ว',  color: '#22c55e', order: 4 },
  rejected:     { label: 'ถูกตีกลับ',    color: '#ef4444', order: 5 },
};
export const PHASE_STATUS = {
  not_started: { label: 'ยังไม่เริ่ม', color: '#94a3b8' },
  in_progress: { label: 'กำลังทำ',     color: '#f59e0b' },
  completed:   { label: 'เสร็จ',       color: '#22c55e' },
  skipped:     { label: 'ข้าม',        color: '#64748b' },
};
export const PPAP_STATUS = {
  not_started: { label: 'ยังไม่เริ่ม',     color: '#94a3b8' },
  in_progress: { label: 'กำลังรวบรวม',    color: '#f59e0b' },
  submitted:   { label: 'ส่งลูกค้าแล้ว',  color: '#3b82f6' },
  approved:    { label: 'ลูกค้าอนุมัติ',  color: '#22c55e' },
  interim:     { label: 'Interim approval', color: '#a855f7' },
  rejected:    { label: 'ลูกค้าตีกลับ',   color: '#ef4444' },
};
export const PROJECT_STATUS = {
  planning:  { label: 'วางแผน',   color: '#3b82f6' },
  active:    { label: 'กำลังทำ',  color: '#f59e0b' },
  on_hold:   { label: 'พัก',      color: '#94a3b8' },
  completed: { label: 'SOP แล้ว', color: '#22c55e' },
  cancelled: { label: 'ยกเลิก',   color: '#64748b' },
};
export const PART_STATUS = {
  active:    { label: 'กำลังทำ', color: '#f59e0b' },
  on_hold:   { label: 'พัก',     color: '#94a3b8' },
  completed: { label: 'เสร็จ',   color: '#22c55e' },
  cancelled: { label: 'ยกเลิก',  color: '#64748b' },
};
export const ECI_STATUS = {
  open:        { label: 'รับเรื่อง',    color: '#3b82f6' },
  evaluating:  { label: 'ประเมินผลกระทบ', color: '#f59e0b' },
  approved:    { label: 'อนุมัติ',      color: '#a855f7' },
  implemented: { label: 'ทำแล้ว (ปิด)', color: '#22c55e' },
  rejected:    { label: 'ปฏิเสธ',       color: '#ef4444' },
};
export const TOOL_STATUS = {
  planned:     { label: 'วางแผน',    color: '#94a3b8' },
  in_progress: { label: 'กำลังทำ',   color: '#f59e0b' },
  tryout:      { label: 'Tryout',    color: '#3b82f6' },
  completed:   { label: 'ส่งมอบแล้ว', color: '#22c55e' },
  cancelled:   { label: 'ยกเลิก',    color: '#64748b' },
};
export const STEP_STATUS = {
  not_started: { label: 'ยังไม่เริ่ม', color: '#94a3b8' },
  in_progress: { label: 'กำลังทำ',     color: '#f59e0b' },
  completed:   { label: 'เสร็จ',       color: '#22c55e' },
};
export const TASK_STATUS = {
  open:      { label: 'เปิด',    color: '#3b82f6' },
  doing:     { label: 'กำลังทำ', color: '#f59e0b' },
  done:      { label: 'เสร็จ',   color: '#22c55e' },
  cancelled: { label: 'ยกเลิก',  color: '#64748b' },
};
export const DOC_KIND = {
  pfc:        { icon: '🗺️', label: 'Process Flow' },
  fmea:       { icon: '⚠️', label: 'PFMEA' },
  cp:         { icon: '📋', label: 'Control Plan' },
  drawing:    { icon: '📐', label: 'แบบ/Drawing' },
  ppap:       { icon: '📦', label: 'PPAP' },
  tooling:    { icon: '🔧', label: 'Tooling' },
  inspection: { icon: '🔍', label: 'ตรวจสอบ/วัด' },
  capacity:   { icon: '📈', label: 'Capacity' },
  packaging:  { icon: '📦', label: 'บรรจุ' },
  other:      { icon: '📄', label: 'อื่นๆ' },
};
export const TOOL_KIND = {
  die:              { icon: '🧱', label: 'แม่พิมพ์ (Die)' },
  jig:              { icon: '🧩', label: 'จิ๊ก/ฟิกเจอร์' },
  checking_fixture: { icon: '📐', label: 'Checking Fixture' },
  gauge:            { icon: '📏', label: 'เกจ/เครื่องมือวัด' },
  mold:             { icon: '🫙', label: 'Mold' },
  other:            { icon: '🔩', label: 'อื่นๆ' },
};
export const OWNER_ROLE = {
  engineer:   'วิศวกรรม (PE)',
  qa:         'QA',
  production: 'ฝ่ายผลิต',
  planning:   'แพลนนิ่ง/สโตร์',
  sales:      'ขาย',
  purchasing: 'จัดซื้อ',
  mtn:        'ซ่อมบำรุง/JIG/DIE',
  manager:    'ผู้จัดการ',
};
export const REF_KIND = {
  pe_set:  'ชุด PFC/FMEA/CP',
  drawing: 'แบบ (revision)',
  tooling: 'แผน tooling',
  qa_part: 'มาตรฐานตรวจ QA',
  file:    'ไฟล์แนบ',
  url:     'ลิงก์',
  other:   'อื่นๆ',
};

/* ── ไฟสี (Andon) — ห้ามคิดสูตรใหม่ที่หน้า ─────────────────────────────── */
export const LIGHT = {
  green: { label: 'ตามแผน/เสร็จ', color: '#22c55e' },
  amber: { label: 'ใกล้กำหนด/รอ', color: '#f59e0b' },
  red:   { label: 'เลยกำหนด/ตีกลับ', color: '#ef4444' },
  grey:  { label: 'ยังไม่เริ่ม',    color: '#94a3b8' },
};

/** จำนวนวันจาก a → b (string 'YYYY-MM-DD') · null ถ้าขาดค่า */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86400000);
}
export function addDays(ymd, n) {
  if (!ymd) return null;
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + (n || 0)));
  return d.toISOString().slice(0, 10);   // UTC ล้วนทั้งขาเข้า-ออก → ไม่เพี้ยน timezone (ไม่ใช่ "วันนี้")
}

/** ไฟสีของเอกสารส่งมอบ 1 รายการ */
export function deliverableLight(d, today) {
  if (!d) return 'grey';
  if (d.status === 'not_required') return 'grey';
  if (d.status === 'approved') return 'green';
  if (d.status === 'rejected') return 'red';
  if (d.due_date && today && d.due_date < today) return 'red';          // เลยกำหนด
  if (d.status === 'submitted') return 'amber';                          // รออนุมัติ
  if (d.due_date && today) {
    const left = daysBetween(today, d.due_date);
    if (left != null && left <= DUE_SOON_DAYS) return 'amber';
  }
  if (d.status === 'in_progress') return 'amber';
  return 'grey';
}
const worst = (lights) => (lights.includes('red') ? 'red' : lights.includes('amber') ? 'amber'
  : lights.length && lights.every(l => l === 'green') ? 'green' : lights.includes('green') ? 'amber' : 'grey');

/** สรุปเฟส 1 เฟสของพาร์ท จากเอกสารส่งมอบในเฟสนั้น */
export function phaseRollup(phase, delivs, today) {
  const rows = (delivs || []).filter(d => d.phase_code === phase?.phase_code && d.status !== 'not_required');
  const done = rows.filter(d => d.status === 'approved').length;
  const total = rows.length;
  const overdue = rows.filter(d => deliverableLight(d, today) === 'red').length;
  const lights = rows.map(d => deliverableLight(d, today));
  let light;
  if (phase?.status === 'completed' || phase?.status === 'skipped') light = 'green';
  else if (total === 0) light = phase?.status === 'in_progress' ? 'amber' : 'grey';
  else light = worst(lights);
  // เฟสเลยวันแผนโดยยังไม่ปิด = แดง ไม่ว่าเอกสารจะเป็นยังไง (timing คือสัญญากับลูกค้า)
  if (phase && phase.status !== 'completed' && phase.status !== 'skipped' && phase.plan_end && today && phase.plan_end < today) light = 'red';
  return { total, done, pct: total ? Math.round(done * 100 / total) : (light === 'green' ? 100 : 0), overdue, light };
}

/** สรุปพาร์ท: เฟสปัจจุบัน (เฟสแรกที่ยังไม่ปิด) + % รวม + ไฟรวม + PPAP */
export function partRollup(part, phases, delivs, today) {
  const ph = [...(phases || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const rolls = ph.map(p => ({ phase: p, ...phaseRollup(p, delivs, today) }));
  const current = ph.find(p => p.status !== 'completed' && p.status !== 'skipped') || ph[ph.length - 1] || null;
  const total = rolls.reduce((s, r) => s + r.total, 0);
  const done = rolls.reduce((s, r) => s + r.done, 0);
  const overdue = rolls.reduce((s, r) => s + r.overdue, 0);
  const lights = rolls.map(r => r.light);
  let light = worst(lights);
  if (part?.status === 'completed') light = 'green';
  if (part?.ppap_status === 'rejected') light = 'red';
  return { current, rolls, total, done, pct: total ? Math.round(done * 100 / total) : 0, overdue, light, ppap: ppapProgress(delivs) };
}

/** ความคืบหน้าชุด PPAP (เฉพาะรายการที่ติ๊ก ppap_element) */
export function ppapProgress(delivs) {
  const rows = (delivs || []).filter(d => d.ppap_element && d.status !== 'not_required');
  const done = rows.filter(d => d.status === 'approved').length;
  return { total: rows.length, done, pct: rows.length ? Math.round(done * 100 / rows.length) : 0 };
}

/** สรุปโปรเจคจาก rollup ของทุกพาร์ท */
export function projectRollup(partRolls) {
  const rs = partRolls || [];
  const total = rs.reduce((s, r) => s + r.total, 0);
  const done = rs.reduce((s, r) => s + r.done, 0);
  const overdue = rs.reduce((s, r) => s + r.overdue, 0);
  const red = rs.filter(r => r.light === 'red').length;
  const amber = rs.filter(r => r.light === 'amber').length;
  const green = rs.filter(r => r.light === 'green').length;
  return { parts: rs.length, total, done, pct: total ? Math.round(done * 100 / total) : 0, overdue, red, amber, green,
    light: red ? 'red' : amber ? 'amber' : rs.length && green === rs.length ? 'green' : 'grey' };
}

/* ── instantiate จากแม่แบบ ─────────────────────────────────────────────────
   snapshot: แม่แบบเปลี่ยนทีหลังไม่ย้อนแก้พาร์ทที่กำลังวิ่ง · sync = เติมเฉพาะ code ที่ยังไม่มี
   วันแผน: ถ้ารู้ sop_date จะกระจายเฟสถอยหลังเท่าๆ กัน (เสนอ — คนแก้ได้) · ไม่รู้ = ว่าง */
export function buildPartRows({ partId, templatePhases, templateDelivs, existingPhases = [], existingDelivs = [], sopDate = null, kickoffDate = null }) {
  const ph = [...(templatePhases || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const havePh = new Set(existingPhases.map(p => p.phase_code));
  const haveDv = new Set(existingDelivs.map(d => d.code));
  // กระจายวันแผน: kickoff → sop แบ่งเท่ากันตามจำนวนเฟส (เฟสสุดท้ายจบวัน SOP)
  const span = (kickoffDate && sopDate) ? daysBetween(kickoffDate, sopDate) : null;
  const per = (span != null && span > 0 && ph.length) ? span / ph.length : null;
  const phaseRows = ph.filter(p => !havePh.has(p.code)).map((p, i0) => {
    const i = ph.indexOf(p);
    const plan_start = per != null ? addDays(kickoffDate, Math.round(per * i)) : null;
    const plan_end = per != null ? (i === ph.length - 1 ? sopDate : addDays(kickoffDate, Math.round(per * (i + 1)))) : null;
    return { part_id: partId, phase_code: p.code, label: p.label, seq: p.seq ?? i0, plan_start, plan_end, status: 'not_started' };
  });
  const planEndOf = (code) => {
    const row = phaseRows.find(r => r.phase_code === code) || existingPhases.find(r => r.phase_code === code);
    return row?.plan_end || null;
  };
  const delivRows = (templateDelivs || []).filter(d => d.is_active !== false && !haveDv.has(d.code)).map(d => ({
    part_id: partId, template_deliverable_id: d.id ?? null, phase_code: d.phase_code, seq: d.seq ?? 0,
    code: d.code, label: d.label, doc_kind: d.doc_kind || 'other', required: d.required !== false,
    ppap_element: !!d.ppap_element, status: d.required === false ? 'not_required' : 'not_started',
    due_date: planEndOf(d.phase_code), owner_role: d.owner_role || null,
  }));
  return { phaseRows, delivRows };
}

/* ── ECI: ขาที่ติ๊กว่ากระทบแต่ยังไม่ผูกของจริง (ต้องครบก่อนปิด implemented — DB check ซ้ำอีกชั้น) ── */
export const ECI_LEGS = [
  { flag: 'affects_drawing', link: 'drawing_revision_id',  label: 'แบบ/Drawing rev ใหม่' },
  { flag: 'affects_pe',      link: 'pe_change_request_id', label: 'คำขอแก้ PFC/PFMEA/CP' },
  { flag: 'affects_process', link: 'four_m_log_id',        label: 'ใบ 4M (Method)' },
  { flag: 'affects_tooling', link: 'tooling_plan_id',      label: 'แผน tooling' },
];
export function eciMissingLinks(eci) {
  if (!eci) return [];
  return ECI_LEGS.filter(l => eci[l.flag] && !eci[l.link]).map(l => l.label);
}

/* ── Gantt ──────────────────────────────────────────────────────────────── */
/** ช่วงวันรวมของขั้นงานทั้งหมด (+ วันนี้) — คืน { start, end, days } · ไม่มีวันเลย = null */
export function ganttRange(rows, today) {
  const ds = [];
  (rows || []).forEach(r => ['plan_start', 'plan_end', 'actual_start', 'actual_end'].forEach(k => { if (r?.[k]) ds.push(r[k]); }));
  if (today) ds.push(today);
  if (!ds.length) return null;
  ds.sort();
  const start = addDays(ds[0], -2), end = addDays(ds[ds.length - 1], 2);
  return { start, end, days: Math.max(1, daysBetween(start, end)) };
}
/** ตำแหน่งแท่งเป็น % ของความกว้าง · null ถ้าขาดวัน */
export function barPos(from, to, range) {
  if (!range || !from) return null;
  const a = daysBetween(range.start, from);
  const b = daysBetween(range.start, to || from);
  if (a == null || b == null) return null;
  const left = Math.max(0, a) * 100 / range.days;
  const width = Math.max(0.8, (Math.max(b, a) - Math.max(0, a) + 1) * 100 / range.days);
  return { left: Math.min(100, left), width: Math.min(100 - Math.min(100, left), width) };
}
/** ไฟสีขั้นงาน/แผน tooling: เสร็จ=เขียว · เลยแผน=แดง · ใกล้ครบ/กำลังทำ=เหลือง */
export function stepLight(step, today) {
  if (!step) return 'grey';
  if (step.status === 'completed' || step.progress_pct >= 100) return 'green';
  if (step.plan_end && today && step.plan_end < today) return 'red';
  if (step.plan_end && today) {
    const left = daysBetween(today, step.plan_end);
    if (left != null && left <= DUE_SOON_DAYS) return 'amber';
  }
  if (step.status === 'in_progress' || (step.progress_pct || 0) > 0) return 'amber';
  return 'grey';
}
export function toolingRollup(plan, steps, today) {
  const rows = steps || [];
  const pct = rows.length ? Math.round(rows.reduce((s, r) => s + (r.progress_pct || 0), 0) / rows.length) : 0;
  let light = worst(rows.map(s => stepLight(s, today)));
  if (plan?.status === 'completed') light = 'green';
  else if (plan?.status === 'cancelled') light = 'grey';
  else if (plan?.plan_end && today && plan.plan_end < today) light = 'red';
  const delayed = rows.filter(s => stepLight(s, today) === 'red').length;
  return { pct, light, delayed, total: rows.length, done: rows.filter(s => s.status === 'completed' || s.progress_pct >= 100).length };
}
/** เสนอวันแผนขั้นงานจากแม่แบบ (ต่อเนื่องกันจากวันเริ่ม) — คนแก้ได้ */
export function proposeSteps(templates, toolKind, planStart) {
  const rows = (templates || []).filter(t => t.tool_kind === toolKind && t.is_active !== false).sort((a, b) => a.seq - b.seq);
  let cursor = planStart || null;
  return rows.map(t => {
    const plan_start = cursor;
    const plan_end = cursor && t.default_days ? addDays(cursor, Math.max(0, t.default_days - 1)) : cursor;
    cursor = plan_end ? addDays(plan_end, 1) : cursor;
    return { seq: t.seq, name: t.name, plan_start, plan_end, progress_pct: 0, status: 'not_started' };
  });
}

/* ── รหัสเอกสาร ──────────────────────────────────────────────────────── */
/** NPI-YYYY-### จากรหัสที่มีอยู่ (ปีเดียวกัน) */
export function nextProjectCode(existingCodes, today) {
  const y = (today || '').slice(0, 4) || String(new Date().getFullYear());
  const re = new RegExp(`^NPI-${y}-(\\d{3,})$`);
  const max = (existingCodes || []).reduce((m, c) => { const x = re.exec(c || ''); return x ? Math.max(m, +x[1]) : m; }, 0);
  return `NPI-${y}-${String(max + 1).padStart(3, '0')}`;
}
/** ECI-YYYYMM-### ภายใน (ลูกค้าให้เลขมาก็ใช้ของลูกค้า) */
export function nextEciCode(existingCodes, today) {
  const ym = (today || '').slice(0, 7).replace('-', '');
  const re = new RegExp(`^ECI-${ym}-(\\d{3,})$`);
  const max = (existingCodes || []).reduce((m, c) => { const x = re.exec(c || ''); return x ? Math.max(m, +x[1]) : m; }, 0);
  return `ECI-${ym}-${String(max + 1).padStart(3, '0')}`;
}

/** จัดกลุ่มเอกสารส่งมอบตามเฟส เรียงตาม seq */
export function groupByPhase(delivs, phases) {
  const ph = [...(phases || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const known = new Set(ph.map(p => p.phase_code));
  const groups = ph.map(p => ({ phase: p, rows: (delivs || []).filter(d => d.phase_code === p.phase_code).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)) }));
  const orphan = (delivs || []).filter(d => !known.has(d.phase_code));
  if (orphan.length) groups.push({ phase: { phase_code: '_orphan', label: 'ไม่อยู่ในเฟสของแม่แบบ', seq: 999 }, rows: orphan });
  return groups;
}
