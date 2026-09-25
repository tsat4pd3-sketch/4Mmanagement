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
   equipment_kind, known, opt }) — พิมพ์เอง (allowFree) = id null · allowFree=false = ค่านอกทะเบียนถูกล้างเมื่อปิดลิสต์
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import useMachines from '../utils/useMachines';
import { buildMachineKeyMap, snapMachineNo } from '../utils/machineNo';
import { machineOptions, appendHistoryOptions, pickerText } from '../utils/pickerOptions';

const up = (s) => String(s ?? '').trim().toUpperCase();
export { machineOptions };

export default function MachineSelect({
  value = '', onChange, machines: given, lines, kinds, strict = false, includeInactive = false, groupByLine = false,
  valueKey = 'machine_no', allowFree = false, placeholder = 'ค้นเลขเครื่อง / ชื่อ / ไลน์…', freeHint = '',
  history = [],          // เลขเครื่องที่เคยบันทึกในคอลัมน์ปลายทาง (useColumnHistory) — ทะเบียนไม่มีก็ยังเลือกได้ (กลุ่ม 📜)
  disabled, inputStyle, style, wrapRows = false, maxRows = 60,
}) {
  const { machines: loaded, failed } = useMachines();
  const machines = given?.length ? given : loaded;
  const options = useMemo(() => {
    const base = machineOptions(machines, { lines, kinds, strict, includeInactive, groupByLine, current: valueKey === 'machine_no' ? value : '' });
    // ค่าที่เคยบันทึก/ค่าปัจจุบันที่ไม่อยู่ในทะเบียน = ยังเลือกได้ พร้อมป้าย ⚠ (ไม่ล้าง ไม่บล็อก — คำสั่ง user 2026-09-07)
    return appendHistoryOptions(base, { history, current: valueKey === 'machine_no' ? value : '', make: (v) => ({ machine_no: v, name: null, line_name: null, equipment_kind: null }) });
  }, [machines, lines, kinds, strict, includeInactive, groupByLine, value, valueKey, history]);
  const sel = useMemo(() => (valueKey === 'id'
    ? options.find(o => o.id === value)
    : options.find(o => o.key === up(value))) || null, [options, value, valueKey]);
  // valueKey='id' = พาเรนต์เก็บแค่ id ไม่มีที่เก็บคำค้น → ต้องปล่อยให้ SearchSelect ถือเอง (pickerText คืน undefined)
  const text = pickerText({ selLabel: sel ? sel.label : null, value, storesText: valueKey !== 'id' });
  /* 🏷️ พิมพ์เองแล้ว "ต่างจากทะเบียนแค่รูปแบบ" (LS10 / RB 102 / sp78) → เก็บเป็นเลขตามทะเบียน
     ไม่งั้นเครื่องเดียวกันแตกเป็นคนละแท่งในทุกจอวิเคราะห์ (วัดจริง 24/09: 84 ค่า / 498 แถว)
     🔴 ดัดได้เฉพาะเรื่องรูปแบบ — ทับศัพท์/ชื่อย่อ (เลเซอร์04 · Laser4) ห้ามแตะ ดู utils/machineNo.js */
  const keyMap = useMemo(() => buildMachineKeyMap(machines), [machines]);
  const emit = ({ text: t, opt }) => {
    if (opt) { onChange?.({ machine_no: opt.machine_no, id: opt.history ? null : opt.id, name: opt.name, line_name: opt.line_name, equipment_kind: opt.equipment_kind, known: !opt.history, opt }); return; }
    const snapped = snapMachineNo(t, keyMap);
    const hit = snapped ? options.find(o => o.machine_no === snapped) : null;
    if (hit) { onChange?.({ machine_no: hit.machine_no, id: hit.history ? null : hit.id, name: hit.name, line_name: hit.line_name, equipment_kind: hit.equipment_kind, known: !hit.history, opt: hit }); return; }
    onChange?.({ machine_no: snapped || t, id: null, name: null, line_name: null, equipment_kind: null, known: false, opt: null });
  };
  return (
    <SearchSelect value={sel ? sel.id : ''} text={text} options={options} onChange={emit}
      allowFree={allowFree} placeholder={placeholder} freeHint={freeHint}
      emptyText={failed ? 'โหลดทะเบียนเครื่องไม่สำเร็จ' : 'ไม่พบเครื่องที่ค้นหา — เพิ่มได้ที่ /machines'}
      disabled={disabled} inputStyle={inputStyle} style={style} wrapRows={wrapRows} maxRows={maxRows} />
  );
}
