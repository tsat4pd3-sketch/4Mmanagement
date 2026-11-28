/* ══ 🏭 Smart Factory → Setting — คอลัมน์/ช่องของแต่ละส่วน (โครงการ · ทีม · แผนงาน) · ใช้ตาราง/ฟอร์มของกลางจาก 5S (Table5s / FormModal) ══
   ไฟล์ข้อมูลล้วน — ป้ายเป็นไทยล้วน แปลตอนวาด · ตัวเลือกที่ขึ้นกับข้อมูลปีนั้น (โครงการ · ข้อหลัก) ส่งเข้ามาทาง `sectionsFor(ctx)` */
import { tr } from '../../utils/i18n';
import { fmtDate } from '../../utils/dateFormat';
import { stamp } from '../activity5s/sections';
import { COMMITTEE_ROLES, STATUS, SUB_ROLES, TARGET_TYPES, TEAM_TYPES, labelOf, roleLabel, teamKey } from './labels.js';

const num = (v) => (v === '' || v == null ? null : Number(v));
const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const statusCell = (r) => tr(labelOf(STATUS, r.status));
const nextSort = (rows, pick = () => true) => Math.max(0, ...rows.filter(pick).map(r => Number(r.sort_no) || 0)) + 1;

/** @param {{ projects: {code:string, name:string}[], heads: {act_task:string, sort_no:number, title:string}[] }} ctx */
export function sectionsFor(ctx) {
  const projName = (code) => (code ? (ctx.projects.find(p => p.code === code)?.name || code) : '');
  const projectOpts = ctx.projects.map(p => ({ value: p.code, label: p.name }));
  return {
    project: {
      dbTable: 'act03_project', key: 'act_project', yearly: true,
      select: '*', order: [['sort_no', true], ['code', true]],
      columns: [
        { key: 'sort_no', label: 'ลำดับ', width: 60, align: 'right' },
        { key: 'code', label: 'รหัส', mono: true, width: 110 },
        { key: 'name', label: 'ชื่อโครงการ' },
        { key: 'team_type', label: 'รูปแบบ', render: (r) => tr(labelOf(TEAM_TYPES, r.team_type)) },
        { key: 'target_type', label: 'วัดผล', render: (r) => `${tr(labelOf(TARGET_TYPES, r.target_type))}${r.target_type === 'count' && r.target_count != null ? ` (${r.target_count})` : ''}` },
        { key: 'target_name', label: 'ตัวชี้วัด', render: (r) => [r.target_name, r.unit && `(${r.unit})`].filter(Boolean).join(' ') || '-' },
        { key: 'status', label: 'สถานะ', render: statusCell },
      ],
      fields: [
        { key: 'code', label: 'รหัสโครงการ', required: true, placeholder: 'a-z 0-9 เช่น oee', lockOnEdit: true },
        { key: 'name', label: 'ชื่อโครงการ', required: true },
        { key: 'sort_no', label: 'ลำดับ', type: 'number' },
        { key: 'team_type', label: 'รูปแบบ', type: 'select', options: TEAM_TYPES, required: true },
        { key: 'target_type', label: 'วัดผล', type: 'select', options: TARGET_TYPES, required: true },
        { key: 'target_count', label: 'เป้าจำนวนโครงการ', type: 'number', showIf: (f) => f.target_type === 'count', required: true },
        { key: 'target_name', label: 'ตัวชี้วัด (KPI)', placeholder: 'เช่น OEE' },
        { key: 'unit', label: 'หน่วย', placeholder: 'เช่น %' },
        { key: 'status', label: 'สถานะ', type: 'select', options: STATUS, required: true },
      ],
      blank: (year, rows) => ({ year, code: '', name: '', sort_no: String(nextSort(rows)), team_type: 'team', target_type: 'plan', target_count: '', target_name: '', unit: '', status: 'Active' }),
      toRow: (f) => ({
        year: Number(f.year), code: f.code.trim().toLowerCase(), name: f.name.trim(), sort_no: num(f.sort_no) ?? 1,
        team_type: f.team_type, target_type: f.target_type, target_count: f.target_type === 'count' ? num(f.target_count) : null,
        target_name: txt(f.target_name), unit: txt(f.unit), status: f.status,
      }),
      check: (f) => (/^[a-z0-9_-]{1,20}$/.test(f.code.trim().toLowerCase()) ? null : 'รหัสโครงการใช้ a-z 0-9 _ - ไม่เกิน 20 ตัว'),
      name: (r) => r.name,
      search: (r) => `${r.code} ${r.name} ${r.target_name || ''}`,
    },

    team: {
      dbTable: 'act03_team', key: 'act_team', yearly: true,
      select: '*', order: [['unit', true], ['role', true], ['employee_code', true]],
      columns: [
        { key: 'employee_code', label: 'รหัส', mono: true, width: 90 },
        { key: 'employee_name', label: 'ชื่อ', render: (r) => r.employee_name || '-' },
        { key: 'unit', label: 'ทีม', render: (r) => (r.unit ? projName(r.unit) : tr('คณะกรรมการ')) },
        { key: 'role', label: 'บทบาท', render: (r) => tr(roleLabel(r.role, r.unit)) },
        { key: 'department', label: 'หน่วยงาน', render: (r) => r.department || '-' },
        { key: 'status', label: 'สถานะ', render: statusCell },
      ],
      fields: [
        { key: 'employee_code', label: 'พนักงาน', type: 'person', required: true, wide: true },
        { key: 'unit', label: 'ทีม', type: 'select', required: true, allowEmpty: true, options: [{ value: '', label: 'คณะกรรมการ' }, ...projectOpts] },
        { key: 'role', label: 'บทบาท', type: 'select', required: true, options: (f) => (f.unit ? SUB_ROLES.map(r => ({ ...r, label: f.unit === 'workflow' && r.value === 'member' ? 'สมาชิกทีมรอง' : r.label })) : COMMITTEE_ROLES) },
        { key: 'department', label: 'หน่วยงาน', placeholder: 'เช่น PD1 / MTN' },
        { key: 'status', label: 'สถานะ', type: 'select', options: STATUS, required: true },
      ],
      blank: (year) => ({ year, employee_code: '', employee_name: '', unit: '', role: 'member', department: '', status: 'Active' }),
      toRow: (f) => {
        const row = { year: Number(f.year), employee_code: f.employee_code.trim(), employee_name: txt(f.employee_name), role: f.role, unit: txt(f.unit), department: txt(f.department), status: f.status };
        return { ...row, team_key: teamKey(row) };
      },
      check: (f) => {
        if (!/^\d{7}$/.test(f.employee_code.trim())) return 'เลือกพนักงานจากทะเบียน (รหัส 7 หลัก)';
        if (f.unit && !['chairman', 'vice', 'member'].includes(f.role)) return 'ทีมย่อยของโครงการมีแค่ หัวหน้าทีม · รองหัวหน้าทีม · ทีม SMF';
        return null;
      },
      name: (r) => `${r.employee_code} ${r.employee_name || ''}`.trim(),
      search: (r) => `${r.employee_code} ${r.employee_name || ''} ${projName(r.unit)} ${tr(roleLabel(r.role, r.unit))} ${r.department || ''}`,
    },

    plan: {
      dbTable: 'act03_task', key: 'act_task', yearly: true,
      select: '*', order: [['sort_no', true]],
      /* ตารางเรียงเป็นต้นไม้ (ข้อหลัก → ข้อย่อย) ที่หน้า (`arrange`) */
      arrange: (rows) => {
        const heads = rows.filter(r => !r.parent_id).sort((a, b) => a.sort_no - b.sort_no);
        return heads.flatMap(h => [h, ...rows.filter(r => r.parent_id === h.act_task).sort((a, b) => a.sort_no - b.sort_no)]);
      },
      columns: [
        { key: 'sort_no', label: 'ข้อ', width: 64, render: (r, c) => (r.parent_id ? `${c.headNo(r.parent_id)}.${r.sort_no}` : String(r.sort_no)) },
        { key: 'title', label: 'รายการ', render: (r) => (r.parent_id ? `↳ ${r.title}` : r.title) },
        { key: 'unit', label: 'โครงการ', render: (r) => (r.parent_id ? '' : projName(r.unit) || '-') },
        { key: 'owner_name', label: 'ผู้รับผิดชอบ', render: (r) => r.owner_name || r.owner_code || '-' },
        { key: 'start_date', label: 'ช่วงเวลา', render: (r) => (r.start_date ? `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` : '-') },
        { key: 'progress', label: '%', align: 'right', width: 60, render: (r) => `${r.progress ?? 0}%` },
      ],
      fields: [
        { key: 'title', label: 'รายการ', required: true, wide: true },
        { key: 'parent_id', label: 'อยู่ใต้ข้อหลัก', type: 'select', options: (f) => [{ value: '', label: '— เป็นข้อหลัก —' }, ...ctx.heads.filter(h => h.act_task !== f.act_task).map(h => ({ value: h.act_task, label: `${h.sort_no}. ${h.title}` }))], required: true, allowEmpty: true },   // ไม่ให้เลือกตัวเองเป็นข้อหลัก
        { key: 'unit', label: 'โครงการ', type: 'select', options: projectOpts, showIf: (f) => !f.parent_id },
        { key: 'sort_no', label: 'ลำดับ', type: 'number' },
        { key: 'start_date', label: 'วันเริ่ม', type: 'date' },
        { key: 'end_date', label: 'วันจบ', type: 'date' },
        { key: 'progress', label: 'ความคืบหน้า (%)', type: 'number' },
        { key: 'done_on', label: 'วันที่ทำเสร็จ', type: 'date', showIf: (f) => Number(f.progress) >= 100 },
        { key: 'owner_code', label: 'ผู้รับผิดชอบ', type: 'person', codeKey: 'owner_code', nameKey: 'owner_name', wide: true },
        { key: 'note', label: 'หมายเหตุ', wide: true },
      ],
      blank: (year, rows) => ({ year, title: '', parent_id: '', unit: '', sort_no: String(nextSort(rows, r => !r.parent_id)), start_date: '', end_date: '', progress: '0', done_on: '', owner_code: '', owner_name: '', note: '' }),
      toRow: (f) => ({
        year: Number(f.year), title: f.title.trim(), parent_id: f.parent_id || null, unit: f.parent_id ? null : txt(f.unit),
        sort_no: num(f.sort_no) ?? 1, start_date: f.start_date || null, end_date: f.end_date || null,
        progress: Math.max(0, Math.min(100, Math.round(num(f.progress) ?? 0))),
        done_on: Number(f.progress) >= 100 ? (f.done_on || null) : null,
        owner_code: txt(f.owner_code), owner_name: txt(f.owner_name), note: txt(f.note),
      }),
      check: (f) => {
        if (Boolean(f.start_date) !== Boolean(f.end_date)) return 'ระบุวันเริ่มและวันจบให้ครบ (หรือเว้นว่างทั้งคู่)';
        if (f.start_date && f.end_date < f.start_date) return 'วันจบต้องไม่ก่อนวันเริ่ม';
        if (f.parent_id && !f.start_date) return 'ข้อย่อยต้องมีวันเริ่มและวันจบ';
        const p = Number(f.progress);
        if (!(p >= 0 && p <= 100)) return 'ความคืบหน้า 0–100%';
        return null;
      },
      name: (r) => r.title,
      search: (r) => `${r.title} ${r.owner_name || ''} ${r.owner_code || ''} ${projName(r.unit)} ${r.note || ''}`,
    },
  };
}

export { stamp };
