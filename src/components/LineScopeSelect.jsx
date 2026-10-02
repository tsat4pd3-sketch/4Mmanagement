/* ══ <LineScopeSelect> — ตัวกรอง "ดูข้อมูลของไลน์ไหน" ช่องเดียว (2026-10-02 · คำสั่ง user) ══════════════
   ที่มา: *"ระบบ dropdown ทำงานไม่เหมือนกันในบางหน้า"* แล้วตามด้วยภาพ OBEYA *"นี่ก็อีกแบบ"*
   วัดก่อนแก้: ช่องขอบเขตมี 5 ทรง — ส่วนงาน+ไลน์ 2 ช่อง (Report) · ส่วนงาน+แผนก+ไลน์ที่โผล่ทีหลัง (OEE) ·
   ปุ่มส่วนงาน 14 ปุ่ม (เช็คชื่อ) · ไลน์แบนเรียงตัวอักษร (แผนล็อต) · ต้นไม้ผังองค์กร (OBEYA `<OrgScopePicker>`)
   ⇒ **ทุกช่องขอบเขตวาดด้วย `<OrgScopePicker>` ตัวเดียว** — ต้นไม้ / ไอคอน / ย่อหน้า / ลำดับ เหมือนกันทุกจอ:
        🏭 ทั้งโรงงาน › 🏢 ฝ่าย › 📁 ส่วนงาน › 📂 แผนก › 🔗 กลุ่มไลน์ › ➖ ไลน์
   · ไฟล์นี้เป็นแค่ "ตัวแปลง" สำหรับหน้าที่เก็บ state เป็น `section` + `line` (Report · OEE · เช็คชื่อ) —
     คิวรีของหน้าไม่ต้องแก้ · ชนิดที่หน้ากรองไม่ได้ (ฝ่าย/แผนก) โชว์เป็นหัวต้นไม้สีเทา **ไม่ตัดทิ้ง**
     (ตัดทิ้ง = ต้นไม้ไม่เหมือนจอ OBEYA อีก) · หน้าที่กรองได้ทุกมิติ (OBEYA/KPI) ใช้ `<OrgScopePicker>` ตรงๆ
   · ช่องที่ต้องได้ "ไลน์เดียว" (ฟอร์ม/วางคิว) = `<LineSelect>` (ไอคอนส่วนงาน 📁 ชุดเดียวกัน)
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import OrgScopePicker from './OrgScopePicker';
import useOrgScope from '../utils/useOrgScope';
import { PLANT } from '../utils/orgScope';

const PICKABLE = ['section', 'line_group', 'line'];

/**
 * @param lines     ทะเบียนไลน์ที่หน้านี้ให้เห็น (scope แล้ว) — ต้องมี id, name, section, parent_line_name
 * @param section/line  state เดิมของหน้า ('' = ไม่กรอง) · line เก็บตาม valueKey (name หรือ id)
 * @param sections  ส่วนงานที่ user เห็นได้ (จำกัดตัวเลือก) — ไม่ส่ง = ไม่จำกัด
 * @param onChange  (section, line, { kind, root, lines }) — root = ไลน์แม่บนสุด · lines = ชื่อไลน์ทั้งหมดในขอบเขตที่เลือก
 */
export default function LineScopeSelect({
  lines = [], section = '', line = '', onChange, sections = [], valueKey = 'name', disabled, id, style, width = 260,
}) {
  const { index } = useOrgScope(lines);
  const byKey = useMemo(() => new Map(lines.map(l => [String(l[valueKey]), l])), [lines, valueKey]);
  const byName = useMemo(() => new Map(lines.map(l => [l.name, l])), [lines]);
  const scopeSet = useMemo(() => new Set(lines.map(l => l.name)), [lines]);

  const rootOf = (name) => {
    let l = byName.get(name); const seen = new Set();
    while (l?.parent_line_name && byName.has(l.parent_line_name) && !seen.has(l.name)) { seen.add(l.name); l = byName.get(l.parent_line_name); }
    return l?.name || name;
  };

  const value = useMemo(() => {
    if (line) {
      const nm = byKey.get(String(line))?.name || String(line);
      return { kind: index?.has?.('line_group', nm) ? 'line_group' : 'line', value: nm };
    }
    return section ? { kind: 'section', value: section } : PLANT;
  }, [line, section, byKey, index]);

  const emit = (sc) => {
    if (!sc || !sc.kind || sc.kind === 'plant') { onChange?.('', '', { kind: 'all', root: '', lines: [] }); return; }
    const names = index ? index.lineNamesOf(sc.kind, sc.value) : [];
    if (sc.kind === 'section') { onChange?.(sc.value, '', { kind: 'section', root: '', lines: names }); return; }
    if (sc.kind === 'line_group' || sc.kind === 'line') {
      const l = byName.get(sc.value);
      const sec = l?.section || index?.sectionOf?.(sc.kind, sc.value) || '';
      onChange?.(sec, l ? String(l[valueKey]) : sc.value, { kind: sc.kind, root: rootOf(sc.value), lines: names });
    }
  };

  return (
    <OrgScopePicker index={index} value={value} onChange={emit} scopeSet={scopeSet} sections={sections}
      costCenter={false} pickable={PICKABLE} disabled={disabled} id={id} style={style} width={width}
      title="ขอบเขต: ส่วนงาน / กลุ่มไลน์ / ไลน์ (หัวสีเทา = ฝ่าย/แผนก ดูได้ที่จอ OBEYA)" />
  );
}
