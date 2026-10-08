import { createContext } from 'react';

/* ══ 📐 Page — กรอบหน้ามาตรฐาน (2026-09-24 · UI-STANDARD.md §1) ═══════════════════════
   เดิมแต่ละหน้าตั้ง padding/maxWidth เอง ได้ระยะขอบ 20+ แบบ · ความกว้างสูงสุด 12 ค่า
   ⇒ กดเปลี่ยนหน้าแล้วชื่อหน้า/แถบแท็บ "กระโดด" ซ้าย-ขวา 0–78px (audit 23/09)
   หลักการ: Nielsen heuristic #4 Consistency & Standards — ตำแหน่งเดียวกันทุกหน้า

   <Page>            กว้างมาตรฐาน (max 1800px) — หน้าทั่วไป / รายการ / dashboard
   <Page width="form">   ฟอร์ม/ตั้งค่าที่อ่านเป็นคอลัมน์เดียว (max 960px)
   <Page width="narrow"> กล่องเล็กกลางจอ (max 640px)
   <Page width="full">   ผัง/บอร์ดที่ต้องใช้เต็มจอ (ไม่จำกัดความกว้าง)

   • ระยะขอบอยู่ใน index.css (`.page-content`) ปรับตามจอ มือถือ/แท็บเล็ต/TV ให้แล้ว — ห้ามใส่ padding เองที่ราก
   • Page ซ้อน Page (หน้าที่ถูกฝังเป็นแท็บใน hub) = ชั้นในไม่เพิ่มขอบ (CSS `.page-content .page-content`)

   <Hub> — ครอบ "หน้าลูก" ที่ hub ฝังไว้เป็นแท็บ (PmHub/DailyChecker/EquipmentHub/LayoutSetup)
   ⇒ `PageHeader` ของหน้าลูกรู้ตัวว่าอยู่ใน hub แล้ว**ไม่วาดชื่อหน้า/breadcrumb ซ้ำ** (หัวซ้อน 2 ชั้น)
     เหลือแค่คำอธิบาย + ปุ่ม + แท็บย่อยของตัวเอง  (1 หน้า = 1 หัวเรื่องหลัก — WCAG 1.3.1 / 2.4.6)
   ════════════════════════════════════════════════════════════════════════════════════ */
export const HubContext = createContext(false);

export function Hub({ children }) {
  return <HubContext.Provider value>{children}</HubContext.Provider>;
}

const WIDTHS = { wide: '', form: ' page-form', narrow: ' page-narrow', full: ' page-full' };

export default function Page({ width = 'wide', className = '', style, children }) {
  /* หน้าที่ตั้ง `gap` ที่ราก (flex column) ⇒ ระยะใต้ PageHeader = marginBottom 12 + gap = ซ้อน 2 ชั้น
     แถบกรองลงมาต่ำกว่าหน้าอื่น 12–15px (stdsweep 24/09) ⇒ ให้ gap เป็นตัวเว้นระยะตัวเดียว */
  const st = style && style.gap != null ? { '--ph-mb': '0px', ...style } : style;
  return (
    <div className={`page-content${WIDTHS[width] ?? ''}${className ? ` ${className}` : ''}`} style={st}>
      {children}
    </div>
  );
}
