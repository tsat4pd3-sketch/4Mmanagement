/* ══════════════════════════════════════════════════════════════════════════
   <CostCenterSelect> — ช่อง "Cost Center" ตัวกลาง  (2026-09-08)
   ทะเบียน Main `cost_centers` (useCostCenters) · ค่าที่เก็บ = code (text) เหมือนเดิม
   allowFree ปิด (รหัสใหม่ต้องตั้งที่ /org-setup แผง 💰 Cost Center ก่อน — บัญชีเป็นเจ้าของรหัส) ·
   ค่าเดิมที่ไม่อยู่ในทะเบียน/ที่เคยบันทึก (history) ยังเลือกได้ กลุ่ม 📜 + ป้าย ⚠
   value = code · onChange({ code, name, section, known, opt })
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import useCostCenters from '../utils/useCostCenters';
import { appendHistoryOptions } from '../utils/pickerOptions';

const norm = (s) => String(s ?? '').trim();

export default function CostCenterSelect({
  value = '', onChange, history = [], allowFree = false, placeholder = 'ค้นรหัส / ชื่อ cost center…',
  disabled, inputStyle, style, section,
}) {
  const rows = useCostCenters();
  const options = useMemo(() => {
    const pref = norm(section).toUpperCase();
    const tagged = rows.filter(r => r.is_active !== false || norm(r.code) === norm(value)).map(r => ({
      id: r.code, key: norm(r.code), label: r.code, sub: [r.name, r.section].filter(Boolean).join(' · '),
      keywords: `${r.name || ''} ${r.section || ''} ${r.note || ''}`,
      badge: r.is_active === false ? '⏸' : null, name: r.name || '', section: r.section || null,
      _pref: pref ? norm(r.section).toUpperCase() === pref : false,
    }));
    tagged.sort((a, b) => (b._pref - a._pref) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    const base = tagged.map(o => ({ ...o, group: pref ? (o._pref ? '🎯 ส่วนงานนี้' : '🏢 ส่วนงานอื่น') : undefined }));
    return appendHistoryOptions(base, { history, current: value, keyOf: norm, make: (v) => ({ name: '', section: null }) });
  }, [rows, value, history, section]);
  const sel = useMemo(() => options.find(o => o.key === norm(value)) || null, [options, value]);
  const emit = ({ text, opt }) => {
    if (opt) onChange?.({ code: opt.label, name: opt.name || '', section: opt.section || null, known: !opt.history, opt });
    else onChange?.({ code: norm(text), name: '', section: null, known: false, opt: null });
  };
  return (
    <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : (value || '')} options={options} onChange={emit}
      allowFree={allowFree} placeholder={placeholder} emptyText="ไม่พบรหัสในทะเบียน — เพิ่มได้ที่ /org-setup แผง 💰 Cost Center"
      disabled={disabled} inputStyle={{ fontFamily: 'monospace', ...inputStyle }} style={style} />
  );
}
