import { useEffect, useState } from 'react';
import { onConnChange, connState, connRetryNow } from '../utils/connGuard';

/* ── ConnBanner — "ตอนนี้เชื่อมต่อฐานข้อมูลไม่ได้" (2026-10-21 · เหตุการณ์จริง) ──────────
   🔴 ที่มา: 21/10 20:20–20:44 ฐานข้อมูลตอบ 503 ทุกคำขอ แต่หน้าจอขึ้นแค่ "กำลังโหลด..." ค้าง
      ⇒ หน้างานไม่รู้ว่าพัง นึกว่าเน็ตตัวเองช้า เลย**กดรีเฟรชซ้ำ** = ยิงใหม่ทั้งหน้า
      ⇒ โหลดยิ่งพุ่งตอนที่ฐานข้อมูลอ่อนแรงที่สุด (ENGINEERING-PRINCIPLES: ห้ามล้มเหลวเงียบ)
   ⇒ ต้องเขียนบนจอตรงๆ ว่าต่อไม่ได้ + บอกว่าจะลองใหม่เมื่อไหร่ + ให้กดลองเองได้

   · วาดเฉพาะตอนพักจริง — ปกติคืน null (ไม่กินพื้นที่ ไม่เปลี่ยนหน้าตาจอคอมแม้แต่พิกเซลเดียว)
   · วางบนสุดแบบ fixed — **ห้ามย้ายไปชิดล่าง** จะชนแถบเมนูมือถือ (`--mnav-h`)               */
export default function ConnBanner() {
  const [st, setSt] = useState(connState);
  const [left, setLeft] = useState(0);

  useEffect(() => onConnChange(setSt), []);

  // นับถอยหลังให้คนเห็นว่าไม่ได้ค้าง — เดินเฉพาะตอนพักอยู่ (ไม่ตั้ง timer ทิ้งไว้เปล่าๆ)
  useEffect(() => {
    if (!st?.paused) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, Math.ceil((st.until - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [st?.paused, st?.until]);

  if (!st?.paused) return null;

  return (
    <div role="status" aria-live="polite" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#7f1d1d', color: '#fff',
      padding: '7px 12px', fontSize: 12, fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap',
      boxShadow: 'var(--shadow-float)',
    }}>
      <span>⚠️ เชื่อมต่อฐานข้อมูลไม่ได้ — ข้อมูลบนจอตอนนี้อาจไม่ใช่ล่าสุด</span>
      <span style={{ opacity: 0.85, fontWeight: 500 }}>
        {left > 0 ? `ระบบจะลองใหม่ให้เองใน ${left} วิ` : 'กำลังลองใหม่…'}
      </span>
      <button onClick={connRetryNow} style={{
        background: '#fff', color: '#7f1d1d', border: 'none', borderRadius: 6,
        padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}>ลองใหม่เดี๋ยวนี้</button>
      <span style={{ opacity: 0.8, fontWeight: 500, fontSize: 11 }}>
        · อย่ากดรีเฟรชซ้ำๆ จะยิ่งช้า · ปิดจอที่ไม่ได้ใช้ช่วยได้
      </span>
    </div>
  );
}
