/* ── useLatestRequest — กัน "คำตอบเก่ามาทับคำตอบใหม่" (stale-response race · กฎเขียน DB ข้อ 4) ──

   ตัวโหลดที่ await หลายรอบแล้ว setState: ผู้ใช้เปลี่ยนวัน/ไลน์/ขอบเขตระหว่างทาง หรือ realtime ยิงซ้อน
   ⇒ คำขอเก่าตอบกลับทีหลัง แล้ว**วาดข้อมูลของตัวเลือกเดิมทับจอ** (จอบอกวันที่ใหม่ แต่ตัวเลขเป็นของวันเก่า)

   ใช้:
     const begin = useLatestRequest();
     const load = useCallback(async () => {
       const live = begin();                 // เริ่มคำขอใหม่ = คำขอก่อนหน้าหมดสิทธิ์ทันที
       const r = await …;
       if (!live()) return;                  // มีคำขอใหม่กว่า/หน้าถูกปิดแล้ว — ทิ้งคำตอบนี้
       setData(r);
     }, [begin, …]);
   `begin` identity คงที่ตลอดอายุ component (ใส่ใน deps ได้ ไม่ทำให้ยิงซ้ำ) */
import { useCallback, useEffect, useRef } from 'react';

/** แกนแบบ pure (เทสได้โดยไม่ต้องมี React) */
export function createLatestGate() {
  let cur = 0;
  return {
    begin() { const id = ++cur; return () => id === cur; },
    invalidate() { cur++; },
  };
}

export function useLatestRequest() {
  const ref = useRef(null);
  if (!ref.current) ref.current = createLatestGate();
  useEffect(() => () => ref.current.invalidate(), []);   // unmount = ทุกคำขอที่ค้างหมดสิทธิ์ set state
  return useCallback(() => ref.current.begin(), []);
}

export default useLatestRequest;
