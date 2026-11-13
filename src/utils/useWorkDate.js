/* ══ 📅 useWorkDate — "วันงานของจอที่เปิดค้างทั้งวัน" ════════════════  2026-11-12
   บั๊กจริงที่หน้างานแจ้ง (ทีม MTN + DIE MTN · สังเกตมา 3-4 วัน):
     *"โหมดจอแขวนของทีมซัพพอต ถ้าเปิดทิ้งไว้เหมือนมันไม่ดึงข้อมูลขึ้นมา จะไม่เห็น Status
      เลยว่าไลน์ไหนเปิดหรือปิด มันจะเป็นสีเทาหมดเหมือนไม่มีการเปิดผลิตทุกไลน์
      กด refresh ก็ไม่หาย ต้องออก browser แล้วเข้าใหม่"*

   ── ต้นเหตุ ───────────────────────────────────────────────────────────────
   จอแขวนเขียน `const workDate = getWorkDate()` **ในตัว component** ⇒ ค่าถูกคิดใหม่
   เฉพาะตอน re-render · จอที่เปิดค้างและไม่มีใครแตะ **ไม่มีอะไรสั่ง re-render**
   ⇒ พอเลย 08:00 (ขึ้นวันงานใหม่) จอยังถาม `production_sessions` ด้วยวันงาน**เมื่อวาน**
     ซึ่งกะปิดหมดแล้ว ⇒ "ไม่มีไลน์เปิด" = เทาทั้งจอ ทั้งที่ไลน์เดินอยู่จริง
   ตัวกันเหนียวที่มี (poll + idle gate) floor อยู่ที่ **2 ชม.** และหยุดเดินเมื่อ
   `document.visibilityState` ไม่ใช่ `visible` ⇒ เบราว์เซอร์ทีวีที่พักหน้าจอแล้วไม่ยิง
   `visibilitychange` กลับมา = ค้างถาวรจนกว่าจะปิดเบราว์เซอร์ (ตรงกับที่หน้างานเจอ)

   ── 🔴 กฎของ hook นี้ ──────────────────────────────────────────────────────
   1. **คืนค่าเดิมเป๊ะเมื่อวันงานยังไม่เปลี่ยน** (`setState` ด้วยฟังก์ชันที่คืน `prev`)
      ⇒ React bail out ไม่ re-render ⇒ **ไม่มี egress เพิ่มแม้แต่ไบต์เดียว**
      (จอ TV ต้องไม่เสียค่า network จากนาฬิกา — กฎ egress ข้อ 11)
   2. **ตัวจับเวลาที่นี่ไม่ยิง DB เลย** แค่เทียบสตริงวันที่ ⇒ ใช้ `setInterval` ตรงๆ ได้
      (กฎ "ห้าม setTimeout เอง" ของ CLAUDE.md คุมเรื่อง **refresh ข้อมูล** ต้องผ่าน
       `coalesce(fn, LIVE.x)` — ไม่ใช่นาฬิกา · แพทเทิร์นเดียวกับ clock tick ใน MtnAndonBoard)
   3. **ตื่นแล้วเช็คทันที** — `visibilitychange` / `focus` / `online` ยิง sync ทันที
      ไม่รอรอบถัดไป (จอที่เพิ่งกลับมาจาก screensaver ต้องถูกทันที ไม่ใช่รออีก 1 นาที)
   4. **รับ `now` ไม่ได้โดยตั้งใจ** — เป็น hook ของจอจริง · ตรรกะวันงานที่ต้องเทส
      อยู่ที่ `getWorkDate(now)` ใน `utils/workDate.js` (pure · เทสตรึงเวลาได้)         */
import { useState, useEffect } from 'react';
import { getWorkDate } from './workDate';

/** เช็คทุก 1 นาที — ความคลาดเคลื่อนสูงสุดของ "ขึ้นวันงานใหม่" คือ 1 นาที (ไม่ยิง DB) */
export const WORK_DATE_TICK_MS = 60_000;

/**
 * วันงานปัจจุบันที่ **อัปเดตเองเมื่อข้ามวัน** — ใช้กับจอที่เปิดค้างทั้งวัน (จอแขวน/TV/บอร์ด)
 * @param {number} [tickMs] จังหวะเช็ค (เทสส่งสั้นได้)
 * @returns {string} `'YYYY-MM-DD'`
 */
export function useWorkDate(tickMs = WORK_DATE_TICK_MS) {
  const [wd, setWd] = useState(getWorkDate);

  useEffect(() => {
    /* คืน `prev` เมื่อค่าเท่าเดิม = React ไม่ re-render (กฎข้อ 1) */
    const sync = () => setWd(prev => (getWorkDate() === prev ? prev : getWorkDate()));
    const t = setInterval(sync, tickMs);
    /* จอทีวีพักหน้าจอ/กลับมา — ต้องเช็คทันที ไม่รอรอบถัดไป */
    const onWake = () => sync();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [tickMs]);

  return wd;
}

export default useWorkDate;
