import { useEffect, useState } from 'react';

// Hook กลางตรวจจอมือถือ (default ≤768px ตาม breakpoint ของโปรเจค) — อัพเดทเมื่อหมุนจอ/resize
// ใช้สำหรับ branch layout แบบ additive เท่านั้น: จอ > maxWidth ต้องได้ false และ render เหมือนโค้ดเดิมเป๊ะ
// (ก่อนหน้านี้แต่ละหน้าเขียน isMobile เอง บางที่ไม่มี listener — หน้าใหม่/แก้ใหม่ให้ใช้ hook นี้แทน)
export default function useIsMobile(maxWidth = 768) {
  const query = `(max-width:${maxWidth}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = e => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return isMobile;
}
