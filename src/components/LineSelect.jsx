/* ══════════════════════════════════════════════════════════════════════════
   <LineSelect> — dropdown "เลือกไลน์" ตัวกลางของทั้งระบบ  (2026-08-21)

   ที่มา (user ทัก): dropdown กรองไลน์ใน /line-stock เป็นลิสต์แบนเรียงตัวอักษร
   ปน FG WAREHOUSE / ไลน์ผลิต / ไลน์ test — ไม่มีลำดับชั้น ไม่กรอง scope
   ไล่ดูแล้วเจอ 26 จุดทั่วระบบที่เขียน `lines.map(l => <option>)` เองแบบเดียวกัน

   ⚠️ กฎ: หน้าไหนมี dropdown เลือก "ไลน์ผลิต" ให้ใช้ component นี้เท่านั้น
      ห้ามเขียน lines.map(...) เป็น <option> เองอีก — ไม่งั้นแต่ละหน้า drift กัน
      (บางหน้ามีลำดับชั้น บางหน้าไม่มี · บางหน้ากรอง scope บางหน้าไม่กรอง)

   สิ่งที่ component นี้รับประกันให้เหมือนกันทุกหน้า:
     1. **ลำดับชั้น + ลำดับมาตรฐาน** — ส่วนงาน (หัวกลุ่ม 🏭 PD1…) → ไลน์แม่ → ไลน์ลูก indent + ↳
        เรียงธรรมชาติไม่ขึ้นกับลำดับที่หน้า query มา (toHierarchicalOptions · 2026-10-01)
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
import { ALL } from '../utils/filterLabels';

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
  if (sections?.length) {
    const inScope = lines.filter(l => inSectionScope(sections, l.section));
    /* 🔴 ส่วนงานที่ "ไม่มีไลน์ผลิตสังกัดอยู่เลย" ต้องไม่ถูกล็อกจนเลือกอะไรไม่ได้ (2026-08-24)
       เคสจริง: แอดมินหน่วยงานฝั่งคลัง (section `Planning&Store`) เปิดฟอร์มเพิ่มรอบจัดส่ง
       แล้ว dropdown ไลน์ **ว่างเปล่า** — เพราะ production_lines ไม่มีแถวไหน section = Planning&Store
       (ตรวจแล้ว = 0 แถว) เช่นเดียวกับ QA / MTN / JIG / DIE ที่เป็นหน่วยงานสนับสนุน
       ⇒ หน่วยงานพวกนี้ทำงาน "ให้ทุกไลน์" อยู่แล้ว การกรองด้วย section จึงไม่มีความหมาย
         และการคืนลิสต์ว่างคือ fail-closed ที่ทำให้ใช้ฟีเจอร์ไม่ได้ทั้งหน้า
       หลักเดียวกับ branch ของ leader ข้างบน: **กรองแล้วไม่เหลืออะไร = ไม่กรอง**
       (ไลน์ผลิตจริงของ supervisor/leader ยังถูกกรองตามปกติ เพราะส่วนงานเขามีไลน์อยู่แล้ว) */
    if (inScope.length) return inScope;
    return lines;
  }
  return lines;
}

/** ตัวเลือกไลน์แบบพร้อมใช้ — [{ value, label, depth, retired }] เรียงตามลำดับชั้น
 *  @param current ค่าที่เลือกอยู่ (ชื่อไลน์) — ถ้าไม่อยู่ในลิสต์จะถูกเติมกลับเข้าไป */
export function lineOptions(lines, { role, lineId, sections, current, includeRetired = false, valueKey = 'name' } = {}) {
  const scoped = scopeLines(lines || [], { role, lineId, sections });
  const usable = includeRetired ? scoped : scoped.filter(l => l.is_active !== false);
  const out = toHierarchicalOptions(usable).map(({ line, depth, section }) => ({
    value: String(line[valueKey]), label: line.name, depth, retired: line.is_active === false, section,
  }));
  const cur = current == null || current === '' ? '' : String(current);
  if (cur && !out.some(o => o.value === cur)) {
    // ค่าที่เลือกไว้แล้วต้องไม่หายจาก dropdown — ไลน์อาจถูกปลดระวาง/นอก scope/ข้อมูลเก่า
    const known = (lines || []).find(l => String(l[valueKey]) === cur);
    const nm = known?.name || cur;
    out.unshift({
      value: cur, depth: 0, retired: known?.is_active === false, pinned: true,
      label: known ? `${nm} ${known.is_active === false ? '⏸ ปลดระวาง' : '(นอกขอบเขตของคุณ)'}` : `${nm} ⚠ ไม่มีในทะเบียนไลน์`,
    });
  }
  return out;
}

/** ป้ายของ option ตัวหนึ่ง (เยื้องตามชั้น + ↳) — **จุดเดียวของทั้งระบบ**
 *  หน้าที่ต้องวาด <option> เองเพราะ onChange ทำอย่างอื่นต่อ (เช่น Register ที่ set lineId ด้วย)
 *  ให้ import ตัวนี้ไปใช้ ห้ามก๊อปสูตรเยื้อง — ไม่งั้นแต่ละหน้าเยื้องไม่เท่ากัน (มีด่าน regressionGuards) */
export const lineOptionLabel = (o) => `${'  '.repeat(o.depth)}${o.depth ? '↳ ' : ''}${o.label}`;
const indent = lineOptionLabel;

export const NO_SECTION_LABEL = 'ไม่ระบุส่วนงาน';
/** แบ่ง option เป็นกลุ่มตามส่วนงาน (หัวกลุ่มบนจอ) — **จุดเดียวของทั้งระบบ** (2026-10-01)
 *  คืน `{ pinned, groups:[{ label, options }] }` · ค่าที่ต้องปักไว้บนสุด (ค่าเดิมที่ไม่อยู่ในลิสต์) อยู่ใน `pinned`
 *  มีส่วนงานเดียว (leader / หน้าที่กรองแล้ว) = กลุ่มเดียวไม่มีหัว (`label: null`) — หัวกลุ่มที่บอกสิ่งที่รู้อยู่แล้ว = รก */
export function groupLineOptions(opts) {
  const pinned = opts.filter(o => o.pinned);
  const groups = [];
  for (const o of opts) {
    if (o.pinned) continue;
    const key = o.section || NO_SECTION_LABEL;
    const g = groups[groups.length - 1];
    if (g && g.label === key) g.options.push(o); else groups.push({ label: key, options: [o] });
  }
  if (groups.length === 1 && groups[0].label !== NO_SECTION_LABEL) groups[0].label = null;
  return { pinned, groups };
}

/**
 * @param {Array}  lines       แถวจาก production_lines (ต้องมี id, name, parent_line_name, section, is_active)
 * @param {string} value       ชื่อไลน์ที่เลือกอยู่ ('' = ยังไม่เลือก)
 * @param {Function} onChange  (name) => void
 * @param {string} placeholder ข้อความ option แรก (null = ไม่มี option ว่าง)
 * @param {Array}  extraGroups กลุ่มพิเศษที่ไม่ใช่ไลน์ผลิต เช่นคลัง — [{ label, options: [{value,label}] }]
 * @param {'start'|'end'} extraAt ตำแหน่งกลุ่มพิเศษ — 'end' ใช้กับ "ตะกร้ารับท้าย" (ชื่อที่ไม่อยู่ในทะเบียน)
 */
export default function LineSelect({
  lines, value = '', onChange, placeholder = '— เลือกไลน์ —',
  role, lineId, sections, extraGroups = [], extraAt = 'start', includeRetired = false,
  style, disabled, id, required, valueKey = 'name',
}) {
  // ค่าที่เลือกอยู่ในกลุ่มพิเศษ (คลัง / ชื่อนอกทะเบียน) = มี option อยู่แล้ว ห้ามปักซ้ำเป็น "⚠ ไม่มีในทะเบียน"
  const inExtra = extraGroups.some(g => g.options?.some(o => String(o.value) === String(value)));
  const opts = useMemo(
    () => lineOptions(lines, { role, lineId, sections, current: inExtra ? '' : value, includeRetired, valueKey }),
    [lines, role, lineId, sections, value, inExtra, includeRetired, valueKey],
  );
  const grouped = useMemo(() => groupLineOptions(opts), [opts]);
  const hasExtra = extraGroups.some(g => g.options?.length);
  const extraEls = extraGroups.filter(g => g.options?.length).map(g => (
    <optgroup key={g.label} label={g.label}>
      {g.options.map(o => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
    </optgroup>
  ));
  return (
    <select id={id} value={value} disabled={disabled} required={required} style={style}
      onChange={e => onChange?.(e.target.value)}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {extraAt !== 'end' && extraEls}
      {grouped.pinned.map(o => <option key={o.value} value={o.value}>{indent(o)}</option>)}
      {grouped.groups.map(g => {
        const items = g.options.map(o => <option key={o.value} value={o.value}>{indent(o)}</option>);
        // หัวกลุ่ม = ส่วนงาน · มีกลุ่มพิเศษ (คลัง ฯลฯ) แต่ส่วนงานเดียว ⇒ ยังต้องมีหัว "ไลน์ผลิต" กั้นจากกลุ่มพิเศษ
        const label = g.label ? `🏭 ${g.label}` : (hasExtra ? '🏭 ไลน์ผลิต' : null);
        return label ? <optgroup key={label} label={label}>{items}</optgroup> : items;
      })}
      {extraAt === 'end' && extraEls}
    </select>
  );
}

/* ══ <LineScopeSelect> — "ขอบเขต" ช่องเดียว: ทั้งโรงงาน → ส่วนงาน → กลุ่มไลน์ → ไลน์ลูก (2026-10-02 · คำสั่ง user) ══
   ที่มา: *"ระบบ dropdown ทำงานไม่เหมือนกันในบางหน้า — หน้าวางแผนมี 2 ช่องให้เลือก · หน้าจัดการไลน์เป็นต้นไม้ ·
   หน้า OEE แยกส่วนงานกับแผนก แต่เจาะไลน์ไม่ได้ — เอาให้เป็นมาตรฐาน"*
   วัดก่อนแก้: ตัวกรองขอบเขตไลน์มี 3 ทรง — (ก) ส่วนงาน + ไลน์ 2 ช่อง (Report 5 แท็บ) (ข) ส่วนงาน + แผนก + ไลน์ที่โผล่
   เฉพาะตอนเลือกกลุ่มที่มีลูก 3 ช่อง (OEE) (ค) ไลน์อย่างเดียวเรียงตัวอักษรแบน (แผนล็อต)
   ⇒ **ตัวกรอง "ดูข้อมูลของไลน์ไหน" = ช่องนี้ช่องเดียว** หน้าตาต้นไม้เดียวกับแถบไลน์ของ /management:
        ทุกไลน์ · 🏭 PD1 ทั้งส่วนงาน · ไลน์แม่ (= ทั้งกลุ่ม) · ↳ ไลน์ลูก   — เลือกได้ทุกชั้น
   · ช่องที่ต้องได้ "ไลน์เดียว" (ฟอร์มบันทึก/วางคิว) ยังใช้ `<LineSelect>` (ส่วนงานเป็นหัวกลุ่ม เลือกไม่ได้)
   · หน้ายังเก็บ state เดิม 2 ตัว (section, line) — ช่องนี้แค่ตั้งทั้งคู่พร้อมกัน ⇒ คิวรีเดิมไม่ต้องแก้
     เลือกไลน์ = ตั้ง section เป็นส่วนงานของไลน์นั้นด้วย (ไลน์อยู่ในส่วนงานนั้นอยู่แล้ว ผลไม่เปลี่ยน)
   · `sections` = ลำดับ/รายการส่วนงานของหน้า (ตามผัง + ขอบเขตสิทธิ์) — ส่วนงานที่ไม่มีไลน์ (คลัง/QA) ก็เลือกได้
     เพราะหน้าที่กรอง "คน" ต้องใช้ · ไม่ส่ง = ส่วนงานที่มีไลน์เท่านั้น */
const SEC = 'sec:';
const LIN = 'line:';

/** ตัวเลือกของ LineScopeSelect (pure · มีเทส) — [{ value, label, kind:'section'|'line'|'head', section, line, depth, root }] */
export function lineScopeOptions(lines, { sections, role, lineId, current, includeRetired = false, valueKey = 'name', scopeSections } = {}) {
  const opts = lineOptions(lines, { role, lineId, sections: scopeSections, current, includeRetired, valueKey });
  const byName = new Map((lines || []).map(l => [String(l[valueKey]), l]));
  const rootOf = (o) => {
    let l = byName.get(o.value); const seen = new Set();
    while (l?.parent_line_name && !seen.has(l.name)) {
      seen.add(l.name);
      const p = (lines || []).find(x => x.name === l.parent_line_name);
      if (!p) break; l = p;
    }
    return l ? String(l[valueKey]) : o.value;
  };
  const secList = sections?.length ? [...sections] : [];
  for (const o of opts) if (o.section && !secList.includes(o.section)) secList.push(o.section);
  const out = [];
  for (const o of opts.filter(x => x.pinned)) out.push({ value: LIN + o.value, label: lineOptionLabel(o), kind: 'line', section: byName.get(o.value)?.section || '', line: o.value, depth: 0, root: o.value });
  const push = (o) => out.push({ value: LIN + o.value, label: `   ${lineOptionLabel(o)}`, kind: 'line', section: o.section || '', line: o.value, depth: o.depth, root: rootOf(o) });
  for (const sec of secList) {
    out.push({ value: SEC + sec, label: `🏭 ${sec} · ทั้งส่วนงาน`, kind: 'section', section: sec, line: '', depth: -1, root: '' });
    opts.filter(o => !o.pinned && o.section === sec).forEach(push);
  }
  const loose = opts.filter(o => !o.pinned && !o.section);
  if (loose.length) {
    out.push({ value: 'head:none', label: `── ${NO_SECTION_LABEL} ──`, kind: 'head', section: '', line: '', depth: -1, root: '' });
    loose.forEach(push);
  }
  return out;
}

/**
 * @param section/line  state เดิมของหน้า ('' = ไม่กรอง) · line เก็บตาม valueKey (name หรือ id)
 * @param onChange      (section, line, info) => void · info = { kind, root } — root = ไลน์แม่บนสุด (หน้าที่ต้องรู้ "กลุ่ม" เช่น OEE)
 */
export function LineScopeSelect({
  lines, section = '', line = '', onChange, sections, placeholder = ALL.line,
  role, lineId, scopeSections, includeRetired = false, valueKey = 'name', style, disabled, id,
}) {
  const opts = useMemo(
    () => lineScopeOptions(lines, { sections, role, lineId, scopeSections, current: line, includeRetired, valueKey }),
    [lines, sections, role, lineId, scopeSections, line, includeRetired, valueKey],
  );
  const value = line ? LIN + String(line) : (section ? SEC + section : '');
  const hasValue = !value || opts.some(o => o.value === value);
  return (
    <select id={id} value={hasValue ? value : ''} disabled={disabled} style={style} aria-label="ขอบเขต: ส่วนงาน / กลุ่มไลน์ / ไลน์"
      onChange={(e) => {
        const o = opts.find(x => x.value === e.target.value);
        if (!o) { onChange?.('', '', { kind: 'all', root: '' }); return; }
        onChange?.(o.section, o.line, { kind: o.kind, root: o.root });
      }}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {!hasValue && section && <option value={SEC + section}>🏭 {section} · ทั้งส่วนงาน</option>}
      {opts.map(o => <option key={o.value} value={o.value} disabled={o.kind === 'head'}>{o.label}</option>)}
    </select>
  );
}
