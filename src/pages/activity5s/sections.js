/* ══ ♻️ 5S → Setting — ค่าตั้งของแต่ละส่วน (คอลัมน์ · ช่องฟอร์ม · แปลงค่า) · ไฟล์นี้ไม่มีคอมโพเนนต์ ══ */
import { tr } from '../../utils/i18n';
import { monthsShort } from '../../utils/dateFormat';
import { actorFields } from '../../utils/actorStamp';
import {
  AREA_TYPES, AUDIT_TEAMS, ROLES, S_GROUPS, S_GROUP_LABEL, STATUS, UNITS, labelOf, teamKey, unitOfRole,
} from './labels';

/* ผู้แก้ล่าสุด (คอลัมน์ updated_by / updated_by_name ของตาราง act02_*) */
export function stamp() {
  const a = actorFields();
  return { ...(a.updated_by_name ? { updated_by_name: a.updated_by_name } : {}), ...(a.updated_by_uid ? { updated_by: a.updated_by_uid } : {}) };
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const statusCell = (r) => tr(labelOf(STATUS, r.status));

/* ── ค่าตั้งของแต่ละส่วน ─────────────────────────────────────────────────────────────── */
export const SECTIONS = {
  area: {
    table: 'act02_area', key: 'act_area', yearly: false,
    select: '*', order: [['area_code', true]],
    columns: [
      { key: 'area_code', label: 'รหัส', mono: true, width: 80 },
      { key: 'act_area_name', label: 'ชื่อพื้นที่' },
      { key: 'area_type', label: 'ประเภท', render: (r) => tr(labelOf(AREA_TYPES, r.area_type)) },
      { key: 'section', label: 'ส่วนงาน' },
      { key: 'status', label: 'สถานะ', render: statusCell },
    ],
    fields: [
      { key: 'area_code', label: 'รหัส', required: true, lockOnEdit: true, placeholder: 'A01' },
      { key: 'act_area_name', label: 'ชื่อพื้นที่', required: true },
      { key: 'area_type', label: 'ประเภท', type: 'select', options: AREA_TYPES, required: true },
      { key: 'section', label: 'ส่วนงาน' },
      { key: 'status', label: 'สถานะ', type: 'select', options: STATUS, required: true },
    ],
    blank: () => ({ area_code: '', act_area_name: '', area_type: 'factory', section: '', status: 'Active' }),
    toRow: (f) => ({ area_code: f.area_code.trim().toUpperCase(), act_area_name: f.act_area_name.trim(), area_type: f.area_type, section: f.section?.trim() || null, status: f.status }),
    check: (f) => (/^[A-Za-z0-9]{1,10}$/.test(f.area_code.trim()) ? null : 'รหัสพื้นที่ใช้ตัวอักษร/ตัวเลข ไม่เกิน 10 ตัว'),
    name: (r) => `${r.area_code} ${r.act_area_name}`,
    search: (r) => `${r.area_code} ${r.act_area_name} ${r.section || ''}`,
  },

  team: {
    table: 'act02_team', key: 'act_team', yearly: true,
    select: '*', order: [['role', true], ['team', true], ['employee_code', true]],
    columns: [
      { key: 'employee_code', label: 'รหัส', mono: true, width: 90 },
      { key: 'employee_name', label: 'ชื่อ', render: (r) => r.employee_name || '-' },
      { key: 'role', label: 'บทบาท', render: (r) => tr(labelOf(ROLES, r.role)) },
      { key: 'unit', label: 'หน่วยงาน', render: (r) => (r.unit ? tr(labelOf(UNITS, r.unit)) : '-') },
      { key: 'team', label: 'ทีมตรวจ', render: (r) => r.team || '-', width: 80 },
      { key: 'act_area', label: 'พื้นที่', render: (r, ctx) => ctx.areaName(r.act_area) },
      { key: 'status', label: 'สถานะ', render: statusCell },
    ],
    fields: [
      { key: 'employee_code', label: 'รหัสพนักงาน', required: true, placeholder: '7 หลัก', lookupName: true },
      { key: 'employee_name', label: 'ชื่อ - นามสกุล' },
      { key: 'role', label: 'บทบาท', type: 'select', options: ROLES, required: true },
      { key: 'unit', label: 'หน่วยงาน', type: 'select', options: UNITS, showIf: (f) => ['admin', 'chairman', 'vice'].includes(f.role) },
      { key: 'team', label: 'ทีมตรวจ', type: 'select', options: AUDIT_TEAMS.map(t => ({ value: t, label: t })), showIf: (f) => f.role === 'auditor', required: true },
      { key: 'act_area', label: 'พื้นที่', type: 'area', showIf: (f) => f.role === 'owner', required: true },
      { key: 'status', label: 'สถานะ', type: 'select', options: STATUS, required: true },
    ],
    blank: (year) => ({ year, employee_code: '', employee_name: '', role: 'auditor', unit: '', team: 'A', act_area: '', status: 'Active' }),
    toRow: (f) => {
      const row = {
        year: Number(f.year), employee_code: f.employee_code.trim(), employee_name: f.employee_name?.trim() || null, role: f.role,
        team: f.role === 'auditor' ? f.team : null, act_area: f.role === 'owner' ? f.act_area : null,
        unit: unitOfRole(f.role, f.unit || null), status: f.status,
      };
      return { ...row, team_key: teamKey(row) };
    },
    check: (f) => (/^\d{7}$/.test(f.employee_code.trim()) ? null : 'รหัสพนักงาน 7 หลัก'),
    name: (r) => `${r.employee_code} ${r.employee_name || ''}`.trim(),
    search: (r, ctx) => `${r.employee_code} ${r.employee_name || ''} ${tr(labelOf(ROLES, r.role))} ${r.team || ''} ${ctx.areaName(r.act_area)}`,
  },

  checklist: {
    table: 'act02_checklist', key: 'act_checklist', yearly: true,
    select: '*', order: [['item_no', true]],
    columns: [
      { key: 'item_no', label: 'ข้อ', width: 60, align: 'right' },
      { key: 's_group', label: 'หมวด', render: (r) => `${r.s_group} ${tr(S_GROUP_LABEL[r.s_group] || '')}`, width: 140 },
      { key: 'act_checklist_name', label: 'หัวข้อตรวจ' },
      { key: 'score_max', label: 'คะแนนเต็ม', align: 'right', width: 90 },
      { key: 'status', label: 'สถานะ', render: statusCell, width: 90 },
    ],
    fields: [
      { key: 'item_no', label: 'ข้อ', type: 'number', required: true },
      { key: 's_group', label: 'หมวด', type: 'select', options: S_GROUPS.map(g => ({ value: g, label: `${g} ${S_GROUP_LABEL[g]}` })), required: true },
      { key: 'act_checklist_name', label: 'หัวข้อตรวจ', required: true, wide: true },
      { key: 'score_max', label: 'คะแนนเต็ม', type: 'number', required: true },
      { key: 'status', label: 'สถานะ', type: 'select', options: STATUS, required: true },
    ],
    blank: (year, rows) => ({ year, item_no: String(Math.max(0, ...rows.map(r => r.item_no)) + 1), s_group: '1S', act_checklist_name: '', score_max: '5', status: 'Active' }),
    toRow: (f) => ({ year: Number(f.year), item_no: num(f.item_no), s_group: f.s_group, act_checklist_name: f.act_checklist_name.trim(), score_max: num(f.score_max), status: f.status }),
    check: (f) => (num(f.item_no) >= 1 && num(f.item_no) <= 50 ? (num(f.score_max) >= 1 && num(f.score_max) <= 5 ? null : 'คะแนนเต็ม 1–5') : 'ข้อ 1–50'),
    name: (r) => `${tr('ข้อ')} ${r.item_no}`,
    search: (r) => `${r.item_no} ${r.s_group} ${r.act_checklist_name}`,
  },

  plan: {
    table: 'act02_audit_plan', key: 'act_audit_plan', yearly: true,
    select: '*', order: [['month', true], ['week', true]],
    columns: [
      { key: 'round', label: 'รอบ', align: 'right', width: 60 },
      { key: 'month', label: 'เดือน', render: (r) => monthsShort()[r.month - 1], width: 80 },
      { key: 'week', label: 'สัปดาห์', align: 'right', width: 80 },
      { key: 'act_area', label: 'พื้นที่', render: (r, ctx) => ctx.areaName(r.act_area) },
      { key: 'team', label: 'ทีมตรวจ', width: 80 },
    ],
    fields: [
      { key: 'act_area', label: 'พื้นที่', type: 'area', required: true },
      { key: 'month', label: 'เดือน', type: 'month', required: true },
      { key: 'week', label: 'สัปดาห์', type: 'select', options: [1, 2, 3, 4].map(w => ({ value: String(w), label: String(w) })), required: true },
      { key: 'round', label: 'รอบ', type: 'select', options: [1, 2, 3, 4, 5, 6].map(w => ({ value: String(w), label: String(w) })), required: true },
      { key: 'team', label: 'ทีมตรวจ', type: 'select', options: AUDIT_TEAMS.map(t => ({ value: t, label: t })), required: true },
    ],
    blank: (year) => ({ year, act_area: '', month: '1', week: '1', round: '1', team: 'A' }),
    toRow: (f) => ({ year: Number(f.year), act_area: f.act_area, month: num(f.month), week: num(f.week), round: num(f.round), team: f.team }),
    check: () => null,
    name: (r, ctx) => `${ctx.areaName(r.act_area)} · ${monthsShort()[r.month - 1]} ${tr('สัปดาห์')} ${r.week}`,
    search: (r, ctx) => `${ctx.areaName(r.act_area)} ${r.team} ${monthsShort()[r.month - 1]}`,
  },
};

/* ช่องที่ต้องกรอกยังว่าง → ข้อความ · ครบ → null */
export function missingField(cfg, value) {
  const f = cfg.fields.filter(x => (!x.showIf || x.showIf(value)) && x.required).find(x => String(value[x.key] ?? '').trim() === '');
  return f ? `${tr('กรอก')} "${tr(f.label)}" ${tr('ก่อน')}` : null;
}

