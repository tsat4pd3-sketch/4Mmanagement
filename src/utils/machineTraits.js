/**
 * ลักษณะเครื่องจักร (machine traits) — data-driven master (DR · 2026-07-24)
 * คนละแกนกับ machine_type (กระบวนการ) — แก้/เพิ่มค่าเองได้ (ไม่ล็อก เผื่อโรงงานอื่นรูปแบบต่าง)
 *   automation_level : manual / semi_auto / auto        (ระดับอัตโนมัติ)
 *   operation_mode   : standalone / gang / inline        (ลักษณะการทำงาน)
 *   gang_count       : ชิ้น/จังหวะ สำหรับ gang machine (คอลัมน์บน machines)
 * fallback DEFAULT_* เสมอ — ตาราง/เน็ตล่ม หรือยังไม่ apply migration = ใช้ค่าตั้งต้น
 */
import { supabaseDR } from '../supabaseClient';

export const DEFAULT_AUTOMATION_LEVELS = [
  { key: 'manual',    label: 'Manual',    icon: '✋',   color: '#f59e0b', sort_order: 1, is_active: true },
  { key: 'semi_auto', label: 'Semi-Auto', icon: '🖐️', color: '#3b82f6', sort_order: 2, is_active: true },
  { key: 'auto',      label: 'Automatic', icon: '🤖',   color: '#22c55e', sort_order: 3, is_active: true },
];
export const DEFAULT_OPERATION_MODES = [
  { key: 'standalone', label: 'Standalone',          icon: '🔲',  color: '#6b7280', sort_order: 1, is_active: true },
  { key: 'gang',       label: 'Gang (multi/stroke)', icon: '🧩',  color: '#a855f7', sort_order: 2, is_active: true },
  { key: 'inline',     label: 'Inline (flow)',       icon: '➡️', color: '#0ea5e9', sort_order: 3, is_active: true },
];

let cAuto = null, cOp = null;

export async function loadMachineTraits(force = false) {
  if (cAuto && cOp && !force) return { automation: cAuto, operation: cOp };
  try {
    const [{ data: a }, { data: o }] = await Promise.all([
      supabaseDR.from('machine_automation_levels').select('*').order('sort_order'),
      supabaseDR.from('machine_operation_modes').select('*').order('sort_order'),
    ]);
    cAuto = (a && a.length) ? a : DEFAULT_AUTOMATION_LEVELS;
    cOp   = (o && o.length) ? o : DEFAULT_OPERATION_MODES;
  } catch {
    cAuto = cAuto || DEFAULT_AUTOMATION_LEVELS;
    cOp   = cOp   || DEFAULT_OPERATION_MODES;
  }
  return { automation: cAuto, operation: cOp };
}

export const automationLevelsSync = () => cAuto || DEFAULT_AUTOMATION_LEVELS;
export const operationModesSync   = () => cOp   || DEFAULT_OPERATION_MODES;
export const activeAutomationLevels = () => automationLevelsSync().filter(x => x.is_active !== false);
export const activeOperationModes   = () => operationModesSync().filter(x => x.is_active !== false);

export function automationDisplay(key) {
  if (!key) return null;
  const x = automationLevelsSync().find(a => a.key === key);
  return x ? `${x.icon || ''} ${x.label}`.trim() : key;
}
export function operationDisplay(key) {
  if (!key) return null;
  const x = operationModesSync().find(o => o.key === key);
  return x ? `${x.icon || ''} ${x.label}`.trim() : key;
}
export function traitColor(list, key, fallback = '#6b7280') {
  return list.find(x => x.key === key)?.color || fallback;
}
