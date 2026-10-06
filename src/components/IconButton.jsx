/* ══ 🔘 IconButton / DeleteButton — ปุ่มไอคอนในแถวรายการ (2026-10-06 · feedback user) ══════════
   *"รูปถังขยะสำหรับลบก็ดูไม่สมส่วน เล็กจนดูไม่ออก"* (ภาพ /org-setup บน Windows)
   ต้นเหตุ: ปุ่มลบเดิมเป็นอีโมจิ 🗑️ เปล่าๆ `fontSize 11–13` ไม่มีกรอบ ⇒
     · Windows วาด 🗑️ (Segoe UI Emoji) เป็นถังเส้นบางสีเทา — ตัวเล็กแล้วกลืนกับพื้นมืด มองไม่ออกว่าเป็นปุ่ม
     · `color: red` ใส่ให้อีโมจิไม่มีผล (อีโมจิมีสีของมันเอง) ⇒ "ปุ่มอันตราย" ไม่ได้ดูอันตรายเลย
     · ไม่มีกรอบ = พื้นที่กดเท่าตัวอักษร (เล็กกว่า 20px บนเมาส์)
   🔴 กติกา: ปุ่มที่เป็น "ไอคอนล้วน" ในแถว/ตาราง ใช้ตัวนี้ · **ปุ่มลบใช้ `<DeleteButton>` (SVG สีแดง)**
      ห้ามเขียนปุ่มที่ข้างในมีแค่อีโมจิถังขยะเปล่าๆ อีก — มีด่าน `icon-only-trash-emoji` ใน regressionGuards
   ขนาด: กล่อง 30×30 (สูงเท่าแถวรายการ) · จอทัชขยายด้วย `.tbtn` ตามเดิม
   ═══════════════════════════════════════════════════════════════════════════════════ */

export function IconButton({ children, danger = false, title, className = '', style, ...rest }) {
  return (
    <button type="button" title={title} aria-label={rest['aria-label'] || title}
      className={`icon-btn${danger ? ' danger' : ''} tbtn${className ? ` ${className}` : ''}`}
      style={style} {...rest}>
      {children}
    </button>
  );
}

/** ถังขยะเส้น (SVG) — สีตาม currentColor ⇒ แดงตามปุ่ม danger · คมทุกขนาด ไม่ขึ้นกับฟอนต์อีโมจิของเครื่อง */
export function TrashIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** ปุ่มลบมาตรฐาน — `title` ควรบอกว่าลบอะไร (เช่น "ลบไลน์") ไม่ใช่แค่ "ลบ" */
export function DeleteButton({ title = 'ลบ', ...rest }) {
  return <IconButton danger title={title} {...rest}><TrashIcon /></IconButton>;
}

export default IconButton;
