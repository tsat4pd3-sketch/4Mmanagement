/* ══════════════════════════════════════════════════════════════════════════
   <MachineSelect> — ช่อง "เลือกเครื่อง/แม่พิมพ์/จิ๊ก" ตัวกลาง  (2026-09-07 · single-source audit)

   ⚠️ กฎ: ช่องที่รับ "หมายเลขเครื่อง" (mtn_orders.machine_no · jigs.machine_no ·
      pm_coordination_plans.machine_no · pe_processes.machine_no · part_routings.machine_no ฯลฯ)
      ต้องใช้ component นี้ ห้าม <input list=datalist> เอง — machine_no เป็น text join key
      ที่ Andon/DieRegistry/PmCoordination/improvements/OrderTrace เทียบกันด้วย normNo()

   สิ่งที่รับประกัน: ค้นได้ทั้งเลขเครื่อง/ชื่อ/ไลน์ · เครื่องในครอบครัวไลน์ที่เลือกขึ้นก่อน (ไม่ตัดไลน์อื่น
   เว้นแต่ strict) · กรองชนิด (kinds) · เครื่อง is_active=false ไม่โผล่แต่ค่าที่เลือกไว้แล้วยังโชว์ ⏸ ·
   allowFree ปิดเป็น default (เครื่องที่ยังไม่ลงทะเบียนให้ไปเพิ่มที่ /machines) — เปิดได้พร้อมป้าย

   value = machine_no (หรือ id เมื่อ valueKey='id') · onChange({ machine_no, id, name, line_name,
   equipment_kind, opt }) — พิมพ์เอง (allowFree) = id null
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import useMachines from '../utils/useMachines';
import { machineOptions } from '../utils/pickerOptions';

const up = (s) => String(s ?? '').trim().toUpperCase();
export { machineOptions };

export default function MachineSelect({
  value = '', onChange, machines: given, lines, kinds, strict = false, includeInactive = false,
  valueKey = 'machine_no', allowFree = false, placeholder = 'ค้นเลขเครื่อง / ชื่อ / ไลน์…', freeHint = '',
  disabled, inputStyle, style, wrapRows = false, maxRows = 60,
}) {
  const { machines: loaded, failed } = useMachines();
  const machines = given?.length ? given : loaded;
  const options = useMemo(
    () => machineOptions(machines, { lines, kinds, strict, includeInactive, current: valueKey === 'machine_no' ? value : '' }),
    [machines, lines, kinds, strict, includeInactive, value, valueKey],
  );
  const sel = useMemo(() => (valueKey === 'id'
    ? options.find(o => o.id === value)
    : options.find(o => o.key === up(value))) || null, [options, value, valueKey]);
  const text = sel ? sel.label : (valueKey === 'id' ? '' : (value || ''));
  const emit = ({ text: t, opt }) => {
    if (opt) onChange?.({ machine_no: opt.machine_no, id: opt.id, name: opt.name, line_name: opt.line_name, equipment_kind: opt.equipment_kind, opt });
    else onChange?.({ machine_no: t, id: null, name: null, line_name: null, equipment_kind: null, opt: null });
  };
  return (
    <SearchSelect value={sel ? sel.id : ''} text={text} options={options} onChange={emit}
      allowFree={allowFree} placeholder={placeholder} freeHint={freeHint}
      emptyText={failed ? 'โหลดทะเบียนเครื่องไม่สำเร็จ' : 'ไม่พบเครื่องที่ค้นหา — เพิ่มได้ที่ /machines'}
      disabled={disabled} inputStyle={inputStyle} style={style} wrapRows={wrapRows} maxRows={maxRows} />
  );
}
