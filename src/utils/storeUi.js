/* 🖐 storeUi — ขนาด/หน้าตาของ "ปุ่มลงมือ" ในโมดูลสโตร์ (2026-09-25 · feedback หน้างาน)

   *"อยากให้ review UX ของระบบสโตร์ด่วน ตอนนี้ไม่เหมาะกับการใช้งานหน้างานเลย
     รูปเล็ก การ์ดเล็ก จุดที่ user ต้อง interactive ด้วยก็ดูบาง หายาก"*

   วัดจริงก่อนแก้ (25/09 · 1500×900 · 5 มุมมองของ /heijunka):
   | มุมมอง | ปุ่ม/ช่องที่เล็กกว่า 40px | เล็กกว่า 28px | ฟอนต์ < 12px |
   |---|---|---|---|
   | ตู้ Kanban รวม | 33 / 39 | 1 | 0 |
   | Store Time Chart | **94 / 94** | 2 | **43** |
   | Store Board | 46 / 46 | 2 | 29 |
   | Pull / ใบสั่งผลิต | 69 / 69 | **39** | 10 |
   ตัวอย่างที่แย่ที่สุด: `จ่าย` (ปุ่มที่ **ตัดวัตถุดิบออกจากคลังจริง**) = **39×26**

   🔴 กฎ: **ปุ่มที่ทำให้ข้อมูลเปลี่ยนในโมดูลสโตร์ ต้องสูง ≥ 44px และใช้ตัวนี้เท่านั้น**
   - `primary`   = พื้น `--accent` ทึบ + `--accent-ink` — "อันนี้คือปุ่มที่ต้องกด" หาเจอทันที
     **ห้ามใช้พื้น `statusBg` (alpha .10) เป็นปุ่มหลัก** — บนพื้นเข้มคอนทราสต์ต่ำจนดูเป็นข้อความ
     และ **ห้ามใช้ `statusColor` เป็นพื้น** — สถานะ "⬜ รอ" สีเป็น `var(--border2)` (เขียวเข้ม)
     ⇒ ตัวหนังสือเข้มบนพื้นเข้ม อ่านไม่ออก (เจอตอนทำจริง)
   - `secondary` = พื้น `--bg2` + ขอบ `--border2` ชัด (ทางเลือกรอง เช่น "รับไม่ครบ")
   - 44px มาจากหน้างานใส่ถุงมือ (WCAG 2.2 AA ขั้นต่ำ 24px · Apple HIG 44 · Material 48)

   ⚠️ ไม่ใช่ปุ่มทุกตัวในหน้า — แถบกรอง/แท็บใช้ token `--ctl-*` ตามมาตรฐานหน้า (UI-STANDARD)
      ตัวนี้ใช้กับ **ปุ่มลงมือ** (ยืนยัน/จ่าย/รับ/เลื่อนสถานะ/สร้างใบ) เท่านั้น */
export const STORE_HIT = 44;

export function storeBtn(kind = 'primary', extra = {}) {
  return {
    minHeight: STORE_HIT, padding: '10px 16px', borderRadius: 'var(--radius)',
    fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
    fontFamily: 'var(--font-body)', lineHeight: 1.25,
    ...(kind === 'primary'
      ? { background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }
      : { background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)' }),
    ...extra,
  };
}

export default storeBtn;
