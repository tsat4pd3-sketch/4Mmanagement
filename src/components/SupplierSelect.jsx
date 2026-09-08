/* ══════════════════════════════════════════════════════════════════════════
   <SupplierSelect> — ช่อง "ผู้ขาย / ผู้รับจ้าง / แหล่งที่มา" ตัวกลาง  (2026-09-08)
   ทะเบียน DR `suppliers` (useSuppliers) · ค่าที่เก็บ = name (text) เหมือนเดิม
   allowFree เปิดเป็น default (ผู้ขายรายใหม่มีจริง — ติดป้าย "ไม่ได้อยู่ในทะเบียน") · `kinds` = ชนิดที่เกี่ยวข้องขึ้นก่อน
   ไม่ตัดชนิดอื่นทิ้ง (strict เมื่อต้องจำกัดจริง) · `history` = ค่าที่เคยบันทึกในคอลัมน์ปลายทาง
   value = name · onChange({ supplier, code, kind, known, opt })
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import useSuppliers, { SUPPLIER_KINDS } from '../utils/useSuppliers';
import { appendHistoryOptions } from '../utils/pickerOptions';

const up = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export default function SupplierSelect({
  value = '', onChange, kinds, strict = false, allowFree = true, history = [],
  placeholder = 'ค้นชื่อผู้ขาย / ผู้รับจ้าง…', freeHint = 'ผู้ขายรายใหม่ — เพิ่มเข้าทะเบียนได้ที่ /products แท็บ 🏭 Supplier',
  disabled, inputStyle, style,
}) {
  const rows = useSuppliers();
  const options = useMemo(() => {
    const pref = new Set(kinds || []);
    let list = rows.filter(r => r.is_active !== false || up(r.name) === up(value));
    if (strict && pref.size) list = list.filter(r => pref.has(r.kind));
    const tagged = list.map(r => ({
      id: r.code, key: up(r.name), label: r.name,
      sub: [SUPPLIER_KINDS[r.kind]?.label, r.contact, r.lead_time_days != null ? `LT ${r.lead_time_days} วัน` : null].filter(Boolean).join(' · '),
      keywords: `${r.kind || ''} ${r.contact || ''} ${r.note || ''}`,
      badge: r.is_active === false ? '⏸' : (SUPPLIER_KINDS[r.kind]?.icon || null),
      kind: r.kind, _pref: pref.size ? pref.has(r.kind) : false,
    }));
    tagged.sort((a, b) => (b._pref - a._pref) || a.label.localeCompare(b.label, 'th'));
    const base = tagged.map(o => ({ ...o, group: pref.size ? (o._pref ? '🎯 ชนิดที่เกี่ยวข้อง' : '🏷️ ชนิดอื่น') : undefined }));
    return appendHistoryOptions(base, { history, current: value, keyOf: up, make: (v) => ({ kind: null, code: null }) });
  }, [rows, kinds, strict, value, history]);
  const sel = useMemo(() => options.find(o => o.key === up(value)) || null, [options, value]);
  const emit = ({ text, opt }) => {
    if (opt) onChange?.({ supplier: opt.label, code: opt.history ? null : opt.id, kind: opt.kind || null, known: !opt.history, opt });
    else onChange?.({ supplier: text, code: null, kind: null, known: false, opt: null });
  };
  return (
    <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : (value || '')} options={options} onChange={emit}
      allowFree={allowFree} placeholder={placeholder} freeHint={freeHint} emptyText="ไม่พบผู้ขายในทะเบียน"
      disabled={disabled} inputStyle={inputStyle} style={style} />
  );
}
