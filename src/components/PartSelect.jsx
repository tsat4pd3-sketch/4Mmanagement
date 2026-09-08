/* ══════════════════════════════════════════════════════════════════════════
   <PartSelect> — ช่อง "เลขพาร์ท (P/N ลูกค้า)" ตัวกลาง  (2026-09-07 · single-source audit)

   ต่างจาก <ProductSelect> ตรงกุญแจ: ตัวนี้เทียบค่าที่เก็บด้วย **part_no** (P/N ลูกค้า) ซึ่งเป็นกุญแจหา
   เอกสาร PE (matchDocSet) ใน CAPA / NCR / SPC / เคลม · ทะเบียน = pe_doc_sets ∪ qa_parts ∪ dr_products
   (usePartOptions) · allowFree เปิดเป็น default (พาร์ทที่ยังไม่มีชุดเอกสาร PE มีจริง) พร้อมป้าย
   เดิม PartPick ถูกเขียนซ้ำใน QualityControl + QaClaims — รวมที่นี่ ห้ามเขียนซ้ำ

   value = part_no · onChange({ part_no, part_name, mat_no, known, opt }) — part_name = null เมื่อพิมพ์เอง
   (ไม่ทับชื่อที่กรอกไว้) · ส่ง `options` เองได้เมื่อหน้าโหลดไว้แล้ว (ไม่ส่ง = ใช้ทะเบียนกลาง)
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import usePartOptions from '../utils/usePartOptions';
import { partKey } from '../utils/partOptions';
import { appendHistoryOptions } from '../utils/pickerOptions';

export default function PartSelect({
  value = '', onChange, options: given, disabled, allowFree = true,
  placeholder = 'ค้นเลขพาร์ท / MAT / ชื่อ / ลูกค้า…', freeHint = 'พาร์ทที่ยังไม่มีชุดเอกสาร PE — สะกดให้ตรง P/N ลูกค้า',
  history = [],          // เลขพาร์ทที่เคยบันทึกในคอลัมน์ปลายทาง — ทะเบียนไม่มีก็ยังเลือกได้ (กลุ่ม 📜)
  inputStyle, style,
}) {
  const loaded = usePartOptions();
  const options = useMemo(() => appendHistoryOptions(given || loaded, { history, current: value, keyOf: partKey, make: (v) => ({ part_no: v, part_name: '', mat_no: null }) }), [given, loaded, history, value]);
  const sel = useMemo(() => options.find(o => o.key === partKey(value)) || null, [options, value]);
  return (
    <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : (value || '')} options={options} disabled={disabled}
      allowFree={allowFree} freeHint={freeHint} placeholder={placeholder}
      emptyText="ไม่พบเลขพาร์ทในทะเบียน (ชุดเอกสาร PE / มาตรฐานตรวจ QA / Product Master)"
      inputStyle={{ fontFamily: 'monospace', ...inputStyle }} style={style}
      onChange={({ text, opt }) => onChange?.(opt
        ? { part_no: opt.part_no, part_name: opt.history ? null : (opt.part_name || ''), mat_no: opt.mat_no || null, known: !opt.history, opt }
        : { part_no: text, part_name: null, mat_no: null, known: false, opt: null })} />
  );
}
