/* ══════════════════════════════════════════════════════════════════════════
   <StorageLocSelect> — ช่อง "รหัสคลัง (SAP Stor.Loc.)" ตัวกลาง  (2026-09-07)
   ทะเบียน DR `storage_locations` (migration 20260902) + helper รูปแบบใน utils/storageLoc.js
   allowFree เปิดเป็น default ตามที่ migration กำหนด (รหัสที่ยังไม่ลงทะเบียนยังบันทึกได้ พร้อมป้าย ⚠)
   แต่ต้องผ่าน slocValid() — value = code · onChange({ code, known, valid, opt })
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import useStorageLocations from '../utils/useStorageLocations';
import { slocLabel, slocValid, SLOC_KINDS } from '../utils/storageLoc';
import { appendHistoryOptions } from '../utils/pickerOptions';

export default function StorageLocSelect({ value = '', onChange, allowFree = true, placeholder = 'รหัสคลัง เช่น S401…', disabled, inputStyle, style, kinds, history = [] }) {
  const rows = useStorageLocations();
  const options = useMemo(() => rows
    .filter(r => r.is_active !== false || slocLabel(r.code) === slocLabel(value))
    .filter(r => !kinds?.length || kinds.includes(r.kind))
    .map(r => ({
      id: r.code, label: r.code, sub: r.name, keywords: `${r.name || ''} ${SLOC_KINDS[r.kind]?.label || ''}`,
      badge: r.is_active === false ? '⏸' : (SLOC_KINDS[r.kind]?.icon || null), kind: r.kind,
    })), [rows, value, kinds]);
  const optionsAll = useMemo(() => appendHistoryOptions(options, { history, current: value, keyOf: slocLabel, make: (v) => ({ id: v }) }), [options, history, value]);
  const sel = useMemo(() => optionsAll.find(o => o.key === slocLabel(value) || o.id === slocLabel(value)) || null, [optionsAll, value]);
  const emit = ({ text, opt }) => {
    const code = opt ? slocLabel(opt.label) : slocLabel(text);
    onChange?.({ code, known: !!opt && !opt.history, valid: slocValid(code), opt: opt || null });
  };
  const bad = value && !slocValid(value);
  return (
    <div style={style}>
      <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : (value || '')} options={optionsAll} onChange={emit}
        allowFree={allowFree} placeholder={placeholder} freeHint="รูปแบบ ตัวอักษร 1-3 + เลข 3 หลัก"
        emptyText="ไม่พบรหัสคลังนี้ในทะเบียน" disabled={disabled}
        inputStyle={{ fontFamily: 'monospace', textTransform: 'uppercase', ...(bad ? { borderColor: '#ef4444' } : {}), ...inputStyle }} />
      {bad && <div style={{ fontSize: 10.5, color: '#ef4444', marginTop: 2 }}>✗ รูปแบบรหัสคลังไม่ถูกต้อง (เช่น S401 / P402)</div>}
    </div>
  );
}
