/* ══════════════════════════════════════════════════════════════════════════
   <BomChildSelect> — ช่อง "พาร์ทลูกของ MAT นี้" ตัวกลาง  (2026-11-16)

   ที่มา (user 16/11): *"จาก daily report การลงของเสีย ต้องเลือก child part ได้
   บางทีไม่เสียทั้ง FG"* ⇒ ช่องเลือกที่ลิสต์ **มาจาก BOM ของ MAT แม่เท่านั้น**

   ⚠️ ทำไมไม่ใช้ `<ProductSelect extraOptions>` : ตัวนั้นเอา **Product Master ทั้งทะเบียน**
      มาเป็นกลุ่มหลัก (168 แถว) แล้ว `extraOptions` จะถูกข้ามเมื่อ mat นั้นมีใน master อยู่แล้ว
      ⇒ ช่องนี้จะเลือก "พาร์ทอะไรก็ได้ในโรงงาน" เป็นลูกของ FG ได้ = ข้อมูลเพี้ยนแบบดูไม่ออก
      ที่นี่จึงต่อ `<SearchSelect>` ตรง (ตามข้อยกเว้นใน UI-CONVENTIONS §5.1.2 —
      "จุดที่มีกลุ่ม/badge เฉพาะใช้ `<SearchSelect>` ตรง") โดย option สร้างจาก
      `bomChildOptions()` (pure · `utils/pickerOptions.js`) ที่รับแถวจาก
      `bomChildCandidates()` (ต้นไม้ผ่าน `buildBomIndex` ตามกฎ)

   🔴 กติกาที่ห้ามถอด:
     1. **ไม่มีลูก / โหลด BOM ไม่สำเร็จ = ยังต้องลงของเสียระดับ MAT แม่ได้** (fail-open)
        ⇒ component นี้ไม่เคยเป็นช่องบังคับ และ "ว่าง" ต้องเขียนบนจอว่าเพราะอะไร
     2. **`allowFree` ปิดตาย** — พาร์ทลูกที่ไม่อยู่ใน BOM พิมพ์เองไม่ได้ (ต้องไปเพิ่มชั้น BOM
        ที่ `/products` แท็บ BOM ก่อน) ไม่งั้น mat ที่ไม่มีจริงหลุดเข้าฐานแล้วทุกจอ join ไม่เจอ
     3. ค่าเดิมในใบที่ไม่อยู่ในลิสต์ **ต้องยังโชว์** (`bomChildOptions` เติมให้ · ป้าย ⚠ นอกลิสต์)

   value = mat_no ของลูก (''/null = ไม่ได้เลือก) · onChange(opt|null) — opt = แถวที่เลือก
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import { bomChildOptions, pickerText } from '../utils/pickerOptions';
import { tr } from '../utils/i18n';

export default function BomChildSelect({
  value = '', rows = [], onChange, disabled, loadFail = '',
  placeholder = 'ไม่ได้เลือก = เสียที่ชิ้นงานหลัก', inputStyle, style, maxRows = 60, scan,
}) {
  const options = useMemo(() => bomChildOptions(rows, { current: value }), [rows, value]);
  const sel = useMemo(() => {
    const k = String(value ?? '').trim().toUpperCase();
    return k ? (options.find(o => o.key === k) || null) : null;
  }, [options, value]);
  /* 🔴 `text` ต้องผ่าน `pickerText` + `storesText:false` — พาเรนต์ตัวนี้เก็บเฉพาะ "ค่าที่เลือกแล้ว"
     ไม่มีที่เก็บคำค้น ⇒ ส่ง `''` ตรงๆ = controlled ด้วยค่าว่าง ⇒ **พิมพ์ค้นไม่ได้เลย**
     (บั๊กจริง /pm-setup 08/09 · UI-CONVENTIONS §5.1.2 "text='' กับ undefined ไม่เหมือนกัน")
     ค่าที่เลือกไว้ยังโชว์ได้เสมอ เพราะ `bomChildOptions` เติม option ของค่าเดิมให้แม้ไม่อยู่ใน BOM */
  const text = pickerText({ selLabel: sel ? sel.label : null, value, storesText: false });
  return (
    <SearchSelect
      value={sel ? sel.id : ''} text={text} options={options}
      /* 🔴 no-op เมื่อค่าไม่เปลี่ยน — SearchSelect ยิง onChange ทุก keystroke ที่พิมพ์ค้น
         (ไม่กัน = ฟอร์มถูก set ใหม่ทุกตัวอักษร · กับดักเดียวกับ PMSetup · UI §5.1.2) */
      onChange={({ opt }) => {
        const next = opt?.mat_no || '';
        if (next === (value || '')) return;
        onChange?.(opt || null);
      }}
      allowFree={false} placeholder={tr(placeholder)}
      scan={scan === false ? undefined : (scan || tr("พาร์ทลูก (MAT / Part No.)"))}
      emptyText={loadFail || tr('MAT นี้ยังไม่มีพาร์ทย่อยใน BOM — เพิ่มชั้น BOM ได้ที่ /products แท็บ BOM')}
      loadFail={loadFail}
      disabled={disabled} inputStyle={{ fontFamily: 'monospace', ...inputStyle }} style={style} maxRows={maxRows} />
  );
}
