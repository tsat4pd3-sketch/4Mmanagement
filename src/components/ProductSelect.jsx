/* ══════════════════════════════════════════════════════════════════════════
   <ProductSelect> — ช่อง "เลือกสินค้า/พาร์ท (MAT SAP)" ตัวกลาง  (2026-09-07 · single-source audit)

   ⚠️ กฎ: ช่องที่รับ mat_no (kanban_standards · die_sets · pe_doc_sets · npi_parts · line_part_levels ·
      customer_shipping_orders · scrap_report_items · quality_bin_records ฯลฯ) ต้องใช้ component นี้
      ห้าม <input> / datalist เอง — mat_no คือกุญแจ golden thread ที่ทุกโมดูล join กัน

   สิ่งที่รับประกัน: ค้นได้ mat_no / ชื่อ / P/N ลูกค้า / ลูกค้า / ไลน์ · สินค้าของไลน์ที่เลือกขึ้นก่อน
   (ไม่ตัดไลน์อื่น เว้นแต่ strict) · ตัดแถว OP (is_operation) เป็น default · ตัด is_active=false แต่
   ค่าที่เลือกไว้ยังโชว์ ⏸ · `extraOptions` สำหรับพาร์ทลูกจาก BOM/parts_master (กลุ่มแยก) ·
   allowFree ปิดเป็น default — เปิดเฉพาะจุดที่พาร์ทอาจยังไม่อยู่ใน Product Master จริง (NPI ก่อน SOP ·
   scrap ที่ master กรอกเลขเครื่อง) พร้อม freeHint

   value = mat_no · onChange({ mat_no, id, name, p_no, customer, line_name, known, opt })
   allowFree=false: SearchSelect ล้างข้อความที่ไม่ตรงทะเบียนเมื่อปิดลิสต์ — ค่านอกทะเบียนไม่ค้างในฟอร์ม
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import useProducts from '../utils/useProducts';
import { productOptions } from '../utils/pickerOptions';

const up = (s) => String(s ?? '').trim().toUpperCase();
export { productOptions };

export default function ProductSelect({
  value = '', onChange, products: given, lines, strict = false, includeOps = false, includeInactive = false,
  extraOptions, allowFree = false, placeholder = 'ค้น MAT / ชื่อ / P/N / ลูกค้า…', freeHint = '',
  disabled, inputStyle, style, wrapRows = false, maxRows = 60,
}) {
  const { products: loaded, failed } = useProducts();
  const products = given?.length ? given : loaded;
  const options = useMemo(
    () => productOptions(products, { lines, strict, includeOps, includeInactive, current: value, extraOptions }),
    [products, lines, strict, includeOps, includeInactive, value, extraOptions],
  );
  const sel = useMemo(() => options.find(o => o.key === up(value)) || null, [options, value]);
  const emit = ({ text, opt }) => {
    if (opt) onChange?.({ mat_no: opt.mat_no, id: opt.extra ? null : opt.id, name: opt.name, p_no: opt.p_no, customer: opt.customer, line_name: opt.line_name, known: true, opt });
    else onChange?.({ mat_no: up(text), id: null, name: null, p_no: null, customer: null, line_name: null, known: false, opt: null });
  };
  return (
    <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : (value || '')} options={options} onChange={emit}
      allowFree={allowFree} placeholder={placeholder} freeHint={freeHint}
      emptyText={failed ? 'โหลด Product Master ไม่สำเร็จ' : 'ไม่พบสินค้าที่ค้นหา — เพิ่มได้ที่ /products'}
      disabled={disabled} inputStyle={{ fontFamily: 'monospace', ...inputStyle }} style={style} wrapRows={wrapRows} maxRows={maxRows} />
  );
}
