/* ══════════════════════════════════════════════════════════════════════════
   <CustomerSelect> — ช่อง "ลูกค้า" ตัวกลาง  (2026-09-07 · single-source audit)

   ทะเบียน DR `customers` (2026-09-08 — ดู utils/useCustomers.js · fallback derive จาก Product Master เมื่อตารางว่าง)
   ⚠️ กฎ: ช่อง "ลูกค้า" ทุกฟอร์มใช้ component นี้ ห้าม <input> เปล่า · alias ในทะเบียนแม็ปเข้าสะกดหลักให้
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
    for (const c of [...customers, ...[...(extra || []), ...(history || [])].map(n => ({ name: n, n: 0, aliases: [], history: true }))]) {
      const k = customerKey(c.name); if (!k || seen.has(k)) continue;
      // alias ที่เคยเจอ (เช่น "MYANMAR" ของ "Myanmar") ไม่แยกเป็นอีก option — แม็ปเข้าสะกดหลัก
      if (!c.history && (c.aliases || []).some(a => seen.has(customerKey(a)))) continue;
      seen.add(k); (c.aliases || []).forEach(a => seen.add(customerKey(a)));
      if (c.is_active === false && customerKey(value) !== k) continue;
      out.push({
        id: k, label: c.name, aliases: (c.aliases || []).map(customerKey),
        badge: c.is_active === false ? '⏸' : (c.n ? `${c.n} สินค้า` : (c.history ? '⚠ นอกทะเบียน' : null)),
        badgeColor: c.history ? 'var(--accent2)' : undefined,
        sub: c.note || ((c.aliases || []).length ? `สะกดอื่น: ${c.aliases.join(', ')}` : ''),
        keywords: `${k} ${(c.aliases || []).join(' ')}`, group: c.history ? '📜 เคยบันทึกไว้ (ไม่มีในทะเบียน)' : undefined,
      });
    }
    return out;
  }, [customers, extra, history, value]);
  // ค่าที่เก็บอยู่ตรง name หลัก หรือ alias ก็ถือว่าเลือกแล้ว (ค่าเก่าสะกดต่างไม่ถูกตีเป็น "พิมพ์เอง")
  const sel = useMemo(() => { const k = customerKey(value); return options.find(o => o.id === k || o.aliases?.includes(k)) || null; }, [options, value]);
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
