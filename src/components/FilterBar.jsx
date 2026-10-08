/* ══ 🎛️ FilterBar — แถบกรองมาตรฐาน (2026-09-24 · UI-STANDARD.md §2) ═════════════════════
   ลำดับซ้าย→ขวา (ตามลำดับที่คนคิด): ขอบเขต (ส่วนงาน/ไลน์) → ช่วงเวลา → ตัวกรองอื่น → ค้นหา
   → `<span className="spacer" />` → สรุปจำนวน/ปุ่ม export/ปุ่มหลักชิดขวา
   • ช่องทุกช่องในแถบสูงเท่ากัน (--ctl-h 34px) ตัว 13px มุม 8px — **ห้ามใส่ width/padding/fontSize inline ที่ select/input**
     (inline ชนะ CSS ⇒ ทำแถบเพี้ยนกลับมา) · อยากให้ช่องยืด ใส่ className="grow"
   • select ในแถบนี้ `width:auto` เสมอ — แก้บั๊ก dropdown ยืดเต็มแถวจาก `select{width:100%}` ของธีม
   • หน้าที่มี <TimeRangeBar> ให้ส่งตัวกรองเข้าไปเป็น children ของมัน (แถบเดียว ไม่ใช่ 2 ชั้น)

   <FilterBar> <LineSelect …/> <Segmented …/> <SearchInput …/> <span className="spacer"/> <CsvBtn/> </FilterBar>
   ═══════════════════════════════════════════════════════════════════════════════════ */
export default function FilterBar({ bare, className = '', style, children }) {
  return (
    <div className={`filter-bar${bare ? ' bare' : ''}${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  );
}
