/* 🖼️ usePartImages — ทะเบียนรูปชิ้นงานสำหรับจอที่วาดการ์ดพาร์ท (2026-09-25)

   ทุกจอที่ใช้ `<PartCard>` ต้องส่ง `img` มาเอง (การ์ดไม่ยิง DB เอง — ไม่งั้นการ์ด 100 ใบ = 100 คิวรี)
   hook นี้โหลดทะเบียนครั้งเดียวต่อจอ แล้วคืน `imgOf(mat)` ให้ส่งต่อลงการ์ด
   · เบื้องหลังผ่าน `cachedMaster` (TTL 4 ชม. · ข้ามการเปิดแอป) ⇒ เปิดหลายจอก็ยิงจริงครั้งเดียว
   · โหลดไม่สำเร็จ = คืน map ว่าง (การ์ดขึ้นกล่อง "ยังไม่มีรูป") **ห้ามทำให้จอพัง** */
import { useEffect, useState, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { loadPartImages, partImageOf } from './partImages';

export default function usePartImages() {
  const [map, setMap] = useState({});
  useEffect(() => {
    let alive = true;
    loadPartImages(supabaseDR).then(({ map: m, error }) => {
      if (!alive) return;
      if (error) console.warn('[partImages] โหลดทะเบียนรูปไม่สำเร็จ:', error.message || error);
      setMap(m);
    });
    return () => { alive = false; };
  }, []);
  const imgOf = useCallback((mat) => partImageOf(map, mat), [map]);
  return imgOf;
}
