import { useState } from 'react';

import { tr } from '../utils/i18n';
/* ══ RowFold — ลิสต์ยาวโชว์แค่ N แถวแรก ที่เหลือกดดู ═══════════════════════  2026-11-08
   คำสั่ง user (หลังดูจอมือถือหน้า 🔩 คลังอะไหล่):
     *"พวกรายการเกิน 10 row มันควรมี show/hide และ hide default ไม่ใช่โชว์ทุกอย่าง"*

   🔴 **ต้องเขียนบนจอว่าซ่อนอยู่กี่รายการ** — ตัดแถวออกแล้วเงียบ = จอโกหก
      (กฎเดียวกับ "กรองแถวออกแล้วต้องเขียนว่าซ่อนกี่รายการ" ใน CLAUDE.md)
   🔴 **ไม่ตัดข้อมูล แค่ไม่วาด** — กดดูทั้งหมดแล้วได้ครบทุกแถวเสมอ ห้ามเอาไปใช้แทน paging
      (ลิสต์ที่ยาวจริงๆ เป็นพันแถว ต้องแก้ที่คิวรี ไม่ใช่ซ่อนที่จอ)

   ⚠️ ตัวนี้ = **ภายใน section** (แถวในลิสต์) · พับทั้ง section ใช้ `CollapseCard`
      ของกลาง 2 ตัวนี้คนละชั้นกัน ซ้อนกันได้: CollapseCard ครอบ → RowFold อยู่ข้างใน

   📌 ยังมีหน้าที่ก๊อปสูตรนี้ไว้เองคนละเกณฑ์ (8 แถวบ้าง REQ_SHOW บ้าง) — QualityBins ·
      StorageZonePanel · StoreWaitCards · StoreLotQueue · MtnAndonBoard
      ย้ายมาใช้ตัวนี้ได้เมื่อแตะไฟล์นั้นรอบหน้า (ยังไม่กวาด เพื่อไม่ให้ commit นี้บวม) */

/** เกณฑ์มาตรฐาน — เกิน 10 แถวถึงพับ (ต่ำกว่านี้พับแล้วกวนกว่าเดิม) */
export const ROW_FOLD_MAX = 10;

/** @param colSpan  ตั้งเมื่อลูกเป็น <tr> — ปุ่มจะถูกห่อใน <tr><td colSpan> (ปุ่มเปล่าใน <tbody> = HTML ผิด
  *                 เบราว์เซอร์ย้ายออกนอกตารางให้เอง = ปุ่มไปโผล่เหนือตาราง) */
export default function RowFold({ rows = [], max = ROW_FOLD_MAX, unit = 'รายการ', colSpan = 0, children }) {
  const [all, setAll] = useState(false);
  const list = Array.isArray(rows) ? rows : [];
  const hidden = Math.max(0, list.length - max);
  const shown = all ? list : list.slice(0, max);
  const btn = hidden <= 0 ? null : (
    <button
      type="button"
      onClick={() => setAll(v => !v)}
      style={{
        display: 'block', width: '100%', marginTop: colSpan ? 0 : 4, padding: '5px 10px',
        fontSize: 11.5, fontWeight: 600, textAlign: 'center', cursor: 'pointer',
        color: 'var(--text2)', background: 'var(--bg3)',
        border: '1px dashed var(--border2)', borderRadius: 'var(--r-md)',
      }}
    >
      {all
        ? `▴ ย่อกลับเหลือ ${max} ${unit}แรก`
        : `▾ ดูทั้งหมด ${list.length} ${unit} — ซ่อนอยู่ ${hidden}`}
    </button>
  );
  return (
    <>
      {shown.map(children)}
      {btn && (colSpan ? <tr><td colSpan={colSpan} style={{ padding: '6px 8px' }}>{btn}</td></tr> : btn)}
    </>
  );
}
