/* ══════════════════════════════════════════════════════════════════════════
   <CustomerSelect> — ช่อง "ลูกค้า" ตัวกลาง  (2026-09-07 · single-source audit)

   ระบบยังไม่มีตาราง customers (ดู utils/useCustomers.js) — รายชื่อ derive จาก Product Master ∪
   ship_to_plants · ⚠️ กฎ: ช่อง "ลูกค้า" ทุกฟอร์มใช้ component นี้ ห้าม <input> เปล่า
   allowFree เปิดเป็น default (ลูกค้าใหม่มีจริง) แต่ติดป้าย "ไม่ได้อยู่ในทะเบียน" ให้เห็น
   และ **normalize เป็นสะกดหลัก** เมื่อพิมพ์ตรงกับที่มีอยู่ (ต่างแค่ตัวพิมพ์/ช่องว่าง)

   value = ชื่อลูกค้า (text) · onChange({ customer, known })
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import useCustomers, { customerKey } from '../utils/useCustomers';

export default function CustomerSelect({
  value = '', onChange, allowFree = true, placeholder = 'เลือก / ค้นลูกค้า…', freeHint = 'ลูกค้าใหม่ — ตรวจสะกดให้ตรงกับ Product Master',
  disabled, inputStyle, style, extra = [], history = [],   // history = ชื่อลูกค้าที่เคยบันทึกในคอลัมน์ปลายทาง (useColumnHistory)
}) {
  const customers = useCustomers();
  const options = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of [...customers, ...[...(extra || []), ...(history || [])].map(n => ({ name: n, n: 0 }))]) {
      const k = customerKey(c.name); if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ id: k, label: c.name, badge: c.n ? `${c.n} สินค้า` : null, keywords: k });
    }
    return out;
  }, [customers, extra, history]);
  const sel = useMemo(() => options.find(o => o.id === customerKey(value)) || null, [options, value]);
  const emit = ({ text, opt }) => {
    if (opt) onChange?.({ customer: opt.label, known: true });
    else onChange?.({ customer: text, known: false });
  };
  return (
    <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : (value || '')} options={options} onChange={emit}
      allowFree={allowFree} placeholder={placeholder} freeHint={freeHint} emptyText="ยังไม่มีลูกค้าชื่อนี้ใน Product Master"
      disabled={disabled} inputStyle={inputStyle} style={style} />
  );
}
