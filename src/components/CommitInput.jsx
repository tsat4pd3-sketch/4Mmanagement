/* ══════════════════════════════════════════════════════════════════════════
   <CommitInput> — ช่องพิมพ์ที่ "ยังไม่ส่งค่าออกจนกว่าจะพิมพ์เสร็จ"  (2026-10-02)

   🔴 ใช้เมื่อ **ค่าที่พิมพ์ = ตัวที่ใช้จัดกลุ่ม / จัดลำดับ / เป็น key ของลิสต์**
   เคสจริงที่ทำให้ต้องมี: `/pm-setup` ช่อง "กลุ่ม/หัวข้อ (Item)" — จุดตรวจถูกจัดกลุ่ม
   ตาม `group_name` แล้ววาดใน `<div key={g.name}>` ⇒ พิมพ์ "L" การ์ดย้ายจากกอง
   "ไม่ระบุกลุ่ม" ไปกลุ่มใหม่ · พิมพ์ "o" ต่อ key เปลี่ยนเป็น "Lo" = กล่องเดิมถูก
   unmount ⇒ **ช่องหลุดโฟกัสทุกตัวอักษร ต้องคลิกกลับเข้าไปใหม่ทุกครั้ง**
   (React ไม่ได้ "เด้ง" เอง — DOM node ที่ถือ focus ถูกถอดแล้วสร้างใหม่)

   วิธีแก้: เก็บสิ่งที่พิมพ์ไว้ในตัวเอง แล้ว `onCommit` ตอน **blur / Enter** เท่านั้น
   ⇒ ระหว่างพิมพ์ ลิสต์ไม่ขยับเลย · พอพิมพ์เสร็จค่อยจัดกลุ่มใหม่ทีเดียว

   🔴 ห้าม sync ค่าจาก prop ทับขณะช่องยังโฟกัสอยู่ — พ่อ re-render ระหว่างพิมพ์
   (realtime/โหลดเสร็จ/พี่น้องขยับ) จะลบสิ่งที่พิมพ์ค้างไว้ทิ้งเงียบๆ
   Esc = คืนค่าเดิม · Enter = ยืนยัน (blur ให้เอง)

   ⚠️ ไม่ใช่ตัวแทนของ `<input>` ทุกช่อง — ช่องธรรมดาที่พิมพ์แล้วลิสต์ไม่ขยับ
   ใช้ `<input>` ตามเดิม (ค่าสดทุกตัวอักษร = ถูกต้องกว่า)
   ══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react';

export default function CommitInput({ value, onCommit, as = 'input', ...rest }) {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);
  // ค่าจากข้างนอกเปลี่ยน (โหลดเสร็จ / ทำสำเนา / ล้างฟอร์ม) — รับได้เฉพาะตอนไม่ได้พิมพ์อยู่
  useEffect(() => { if (!focused.current) setDraft(value ?? ''); }, [value]);

  const commit = () => {
    focused.current = false;
    const next = String(draft ?? '').trim();
    if (next !== String(value ?? '').trim()) onCommit?.(next);
    setDraft(next);
  };
  const Tag = as;
  return (
    <Tag {...rest} value={draft}
      onFocus={e => { focused.current = true; rest.onFocus?.(e); }}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => { commit(); rest.onBlur?.(e); }}
      onKeyDown={e => {
        if (e.key === 'Enter' && as === 'input') e.currentTarget.blur();
        else if (e.key === 'Escape') { setDraft(value ?? ''); focused.current = false; e.currentTarget.blur(); }
        rest.onKeyDown?.(e);
      }} />
  );
}
