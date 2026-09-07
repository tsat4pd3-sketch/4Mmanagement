/* ══════════════════════════════════════════════════════════════════════════
   <InstrumentSelect> — ช่อง "เครื่องมือวัด / วิธีตรวจ" ตัวกลาง  (2026-09-07 · single-source audit)
   ทะเบียน Main qa_instruments (เก็บ code) — โยง SPC / จุดตรวจ กับสถานะสอบเทียบ
   allowFree เปิดเป็น default: วิธีตรวจที่ไม่ใช่เครื่องมือ (Visual / CF) และเครื่องมือที่ยังไม่ลงทะเบียน (ติดป้าย)
   เดิม InstrumentPick ซ้ำใน QualityControl + QAInspectionSetup — รวมที่นี่

   value = code/ข้อความ · onChange(string) — เลือกจากลิสต์ = code
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import useInstruments from '../utils/useInstruments';

const up = (v) => String(v ?? '').trim().toUpperCase();

export default function InstrumentSelect({
  value = '', onChange, instruments: given, disabled, allowFree = true,
  placeholder = 'ค้นรหัส / ชื่อเครื่องมือวัด…',
  freeHint = 'วิธีตรวจที่ไม่ใช่เครื่องมือ (Visual/CF) หรือเครื่องมือที่ยังไม่ลงทะเบียนที่ /qa แท็บ 📏',
  inputStyle, style,
}) {
  const loaded = useInstruments();
  const instruments = given?.length ? given : loaded;
  const options = useMemo(() => (instruments || []).filter(i => i?.code).map(i => ({
    id: i.id, label: i.code, key: up(i.code), sub: [i.name, i.inst_type, i.line_name].filter(Boolean).join(' · '),
    keywords: `${i.name || ''} ${i.inst_type || ''} ${i.line_name || ''} ${i.brand || ''}`,
    badge: i.status === 'retired' ? '⏸' : i.status === 'repair' ? '🔧' : null,
  })), [instruments]);
  const sel = useMemo(() => options.find(o => o.key === up(value)) || null, [options, value]);
  return (
    <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : (value || '')} options={options} disabled={disabled}
      allowFree={allowFree} freeHint={freeHint} placeholder={placeholder}
      emptyText="ไม่พบเครื่องมือวัดในทะเบียน — ลงทะเบียนได้ที่ /qa แท็บ 📏 เครื่องมือวัด"
      inputStyle={inputStyle} style={style}
      onChange={({ text, opt }) => onChange?.(opt ? opt.label : text)} />
  );
}
