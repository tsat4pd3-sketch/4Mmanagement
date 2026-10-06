import { useState, useEffect, useRef } from 'react';

/*
  CollapseCard — section ย่อ/ขยายได้ตาม UI-CONVENTIONS
  หัวโชว์ชื่อ+จำนวนเสมอ · จำสถานะใน localStorage (key = `${storePrefix}_collapse_${id}`)
  default ขยาย ยกเว้น section ว่าง (ส่ง defaultOpen=false)
  ใช้แล้วที่: ProductHistory, OrderTrace — หน้าที่มีหลาย section ให้ reuse ตัวนี้
*/
/* localStorage โยนได้จริงเมื่อ user บล็อกคุกกี้/โหมดส่วนตัว — ไม่ห่อ = ทั้งหน้าขาว
   (หน้าที่ใช้การ์ดนี้หลายใบยิ่งเสี่ยง · 2026-10-05) */
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function CollapseCard({ id, title, count, defaultOpen = true, storePrefix = 'cc', right, style, onOpenChange, children }) {
  // เก็บเฉพาะ override ของ user — defaultOpen เป็นค่าสด (section ว่างตอน mount แล้วข้อมูลมาทีหลังจะกางเอง)
  const [override, setOverride] = useState(() => lsGet(`${storePrefix}_collapse_${id}`));
  const open = override == null ? defaultOpen : override === '1';
  const toggle = () => { const v = open ? '0' : '1'; lsSet(`${storePrefix}_collapse_${id}`, v); setOverride(v); };

  /* บอกสถานะกาง/พับออกไปข้างนอก — แผงที่ "โหลดข้อมูลเฉพาะตอนกาง" (ประหยัด egress) ต้องรู้
     ref กัน callback ที่สร้างใหม่ทุก render ทำ effect วนไม่จบ · ยิงตอน mount ด้วย (ค่าอาจกางอยู่จาก localStorage) */
  const cbRef = useRef(onOpenChange);
  cbRef.current = onOpenChange;
  useEffect(() => { cbRef.current?.(open); }, [open]);
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div onClick={toggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{title}{count != null && <span style={{ color: 'var(--muted)', fontWeight: 600 }}> ({count})</span>}</div>
          {/* ลูกศรอยู่ขวาเหมือนเดิม — ย้ายตำแหน่ง = 5 หน้าที่ใช้อยู่หน้าตาเปลี่ยนโดยไม่มีใครขอ */}
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
        </div>
        {/* ปุ่ม/ป้ายที่ต้องเห็นแม้การ์ดพับอยู่ (เช่น "ยังไม่บันทึก") — ไม่ผูกกับ toggle */}
        {right}
      </div>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}
