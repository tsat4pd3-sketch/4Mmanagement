/* ══ 🔍 SearchInput — ช่องค้นหาในรายการ (2026-09-24 · UI-STANDARD.md §4) ═══════════════
   เดิมมี ~60 แบบ: 🔍/🔎/ไม่มีไอคอน · "ค้นหา/ค้น/หา/พิมพ์" · "…"/"..."/"— … —" (audit 23/09)
   มาตรฐาน: ไอคอน 🔍 อยู่ในกรอบ (ไม่ใช่ในข้อความ) · placeholder = "ค้นหา <ช่องที่ค้นได้>"
   · `type="search"` (คีย์บอร์ดมือถือขึ้นปุ่มค้นหา) · ปุ่ม ✕ ล้างเมื่อมีข้อความ

   <SearchInput value={q} onChange={setQ} fields="MAT / ชื่อพาร์ท / P/N" />
   ⚠️ นี่คือช่อง "กรองรายการบนจอ" — ถ้าต้อง "เลือก 1 ค่าจากทะเบียน" ใช้ picker กลาง (SearchSelect ฯลฯ §5.1.2)
   ═══════════════════════════════════════════════════════════════════════════════════ */
/* 🔴 ที่ว่างของไอคอน 🔍 / ปุ่ม ✕ ต้องอยู่ที่ช่องเอง ห้ามพึ่ง class (2026-10-01 · user: "ทับตัวหนังสือ แทบทุกหน้า")
   กฎขนาดของแถบกรอง `.filter-bar :is(select, input:not(…)×5)` มี specificity (0,6,1) ⇒ ชนะ `.search-input input`
   (0,1,1) แล้วเขียน padding ซ้ายกลับเป็น 10px — วัดจริง 17 หน้า ไอคอนกินถึง 25px ตัวหนังสือเริ่ม 11px
   (เฉพาะช่องที่อยู่ในแถบกรอง ช่องนอกแถบไม่เป็น จึงหลุดตาตอนทำมาตรฐาน) · ตรวจซ้ำ `node audit/searchsweep.mjs` */
const ICON_PAD = { paddingLeft: 30, paddingRight: 28 };

export default function SearchInput({ value, onChange, fields, placeholder, grow = true, style, inputStyle, autoFocus, onKeyDown, ariaLabel }) {
  const ph = placeholder || (fields ? `ค้นหา ${fields}` : 'ค้นหา');
  return (
    <div className={`search-input${grow ? ' grow' : ''}`} style={style}>
      <span className="search-ico" aria-hidden="true">🔍</span>
      <input type="search" value={value ?? ''} placeholder={ph} aria-label={ariaLabel || ph}
        autoFocus={autoFocus} onKeyDown={onKeyDown}
        onChange={e => onChange && onChange(e.target.value)} style={{ ...ICON_PAD, ...inputStyle }} />
      {value ? (
        <button type="button" className="search-clear" aria-label="ล้างคำค้น" onClick={() => onChange && onChange('')}>✕</button>
      ) : null}
    </div>
  );
}
