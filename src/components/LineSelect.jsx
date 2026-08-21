/* ══════════════════════════════════════════════════════════════════════════
   <LineSelect> — dropdown "เลือกไลน์" ตัวกลางของทั้งระบบ  (2026-08-21)

   ที่มา (user ทัก): dropdown กรองไลน์ใน /line-stock เป็นลิสต์แบนเรียงตัวอักษร
   ปน FG WAREHOUSE / ไลน์ผลิต / ไลน์ test — ไม่มีลำดับชั้น ไม่กรอง scope
   ไล่ดูแล้วเจอ 26 จุดทั่วระบบที่เขียน `lines.map(l => <option>)` เองแบบเดียวกัน

   ⚠️ กฎ: หน้าไหนมี dropdown เลือก "ไลน์ผลิต" ให้ใช้ component นี้เท่านั้น
      ห้ามเขียน lines.map(...) เป็น <option> เองอีก — ไม่งั้นแต่ละหน้า drift กัน
      (บางหน้ามีลำดับชั้น บางหน้าไม่มี · บางหน้ากรอง scope บางหน้าไม่กรอง)

   สิ่งที่ component นี้รับประกันให้เหมือนกันทุกหน้า:
     1. **ลำดับชั้น** — ไลน์แม่ก่อน แล้วไลน์ลูก indent + ↳ (toHierarchicalOptions)
     2. **ปลดระวาง** — ไลน์ is_active=false ไม่โผล่ (แต่ค่าที่เลือกไว้แล้วยังโชว์
        พร้อมป้าย ⏸ ปลดระวาง — ห้ามให้ค่าเดิมหายเงียบจากฟอร์ม)
     3. **scope** — leader = ครอบครัวไลน์ตัวเอง · role อื่น = ตาม sections
     4. **ค่าที่ไม่รู้จัก** — ยังโชว์เป็น option ⚠ (ข้อมูลเก่า/ไลน์ถูกลบ) ไม่หายเงียบ

   ⚠️ query ที่ดึง production_lines มาป้อน component นี้ ต้อง select ให้ครบ:
      `id, name, parent_line_name, section, is_active`
      ขาด parent_line_name = ไม่มีลำดับชั้น · ขาด section = กรอง scope ไม่ได้
      (เป็นสาเหตุจริงของบั๊กเดิม — หลายหน้า select('name') อย่างเดียว)
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import { toHierarchicalOptions, getLineFamilyNames } from '../utils/lineHierarchy';
import { inSectionScope } from '../utils/sectionScope';

/** กรองไลน์ตาม scope มาตรฐาน — leader = ครอบครัวไลน์ตัวเอง · อื่น = ตาม sections
 *  คืน array เดิมเมื่อไม่ถูกจำกัด (admin / ไม่มี scope) */
export function scopeLines(lines, { role, lineId, sections } = {}) {
  if (!lines?.length) return [];
  if (role === 'leader' && lineId) {
    const fam = new Set(getLineFamilyNames(lines, Number(lineId)));
    // fam ว่าง = ยังโหลดไลน์ไม่ครบ/หาไลน์ไม่เจอ → ห้ามคืนลิสต์ว่าง (จอจะเลือกอะไรไม่ได้เลย)
    if (fam.size) return lines.filter(l => fam.has(l.name));
    return lines;
  }
  if (sections?.length) return lines.filter(l => inSectionScope(sections, l.section));
  return lines;
}

/** ตัวเลือกไลน์แบบพร้อมใช้ — [{ value, label, depth, retired }] เรียงตามลำดับชั้น
 *  @param current ค่าที่เลือกอยู่ (ชื่อไลน์) — ถ้าไม่อยู่ในลิสต์จะถูกเติมกลับเข้าไป */
export function lineOptions(lines, { role, lineId, sections, current, includeRetired = false, valueKey = 'name' } = {}) {
  const scoped = scopeLines(lines || [], { role, lineId, sections });
  const usable = includeRetired ? scoped : scoped.filter(l => l.is_active !== false);
  const out = toHierarchicalOptions(usable).map(({ line, depth }) => ({
    value: String(line[valueKey]), label: line.name, depth, retired: line.is_active === false,
  }));
  const cur = current == null || current === '' ? '' : String(current);
  if (cur && !out.some(o => o.value === cur)) {
    // ค่าที่เลือกไว้แล้วต้องไม่หายจาก dropdown — ไลน์อาจถูกปลดระวาง/นอก scope/ข้อมูลเก่า
    const known = (lines || []).find(l => String(l[valueKey]) === cur);
    const nm = known?.name || cur;
    out.unshift({
      value: cur, depth: 0, retired: known?.is_active === false,
      label: known ? `${nm} ${known.is_active === false ? '⏸ ปลดระวาง' : '(นอกขอบเขตของคุณ)'}` : `${nm} ⚠ ไม่มีในทะเบียนไลน์`,
    });
  }
  return out;
}

const indent = (o) => `${'  '.repeat(o.depth)}${o.depth ? '↳ ' : ''}${o.label}`;

/**
 * @param {Array}  lines       แถวจาก production_lines (ต้องมี id, name, parent_line_name, section, is_active)
 * @param {string} value       ชื่อไลน์ที่เลือกอยู่ ('' = ยังไม่เลือก)
 * @param {Function} onChange  (name) => void
 * @param {string} placeholder ข้อความ option แรก (null = ไม่มี option ว่าง)
 * @param {Array}  extraGroups กลุ่มพิเศษที่ไม่ใช่ไลน์ผลิต เช่นคลัง — [{ label, options: [{value,label}] }]
 */
export default function LineSelect({
  lines, value = '', onChange, placeholder = '— เลือกไลน์ —',
  role, lineId, sections, extraGroups = [], includeRetired = false,
  style, disabled, id, required, valueKey = 'name',
}) {
  const opts = useMemo(
    () => lineOptions(lines, { role, lineId, sections, current: value, includeRetired, valueKey }),
    [lines, role, lineId, sections, value, includeRetired, valueKey],
  );
  return (
    <select id={id} value={value} disabled={disabled} required={required} style={style}
      onChange={e => onChange?.(e.target.value)}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {extraGroups.filter(g => g.options?.length).map(g => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map(o => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
        </optgroup>
      ))}
      {opts.length > 0 && (
        extraGroups.some(g => g.options?.length)
          ? <optgroup label="🏭 ไลน์ผลิต">{opts.map(o => <option key={o.value} value={o.value}>{indent(o)}</option>)}</optgroup>
          : opts.map(o => <option key={o.value} value={o.value}>{indent(o)}</option>)
      )}
    </select>
  );
}
