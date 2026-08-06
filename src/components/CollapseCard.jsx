import { useState } from 'react';

/*
  CollapseCard — section ย่อ/ขยายได้ตาม UI-CONVENTIONS
  หัวโชว์ชื่อ+จำนวนเสมอ · จำสถานะใน localStorage (key = `${storePrefix}_collapse_${id}`)
  default ขยาย ยกเว้น section ว่าง (ส่ง defaultOpen=false)
  ใช้แล้วที่: ProductHistory, OrderTrace — หน้าที่มีหลาย section ให้ reuse ตัวนี้
*/
export default function CollapseCard({ id, title, count, defaultOpen = true, storePrefix = 'cc', children }) {
  // เก็บเฉพาะ override ของ user — defaultOpen เป็นค่าสด (section ว่างตอน mount แล้วข้อมูลมาทีหลังจะกางเอง)
  const [override, setOverride] = useState(() => localStorage.getItem(`${storePrefix}_collapse_${id}`));
  const open = override == null ? defaultOpen : override === '1';
  const toggle = () => { const v = open ? '0' : '1'; localStorage.setItem(`${storePrefix}_collapse_${id}`, v); setOverride(v); };
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
      <div onClick={toggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{title}{count != null && <span style={{ color: 'var(--muted)', fontWeight: 600 }}> ({count})</span>}</div>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}
