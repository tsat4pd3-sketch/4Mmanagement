import { useEffect, useState } from 'react';

/**
 * useObjectUrl(fileOrBlob) → blob: URL สำหรับพรีวิวรูปที่ผู้ใช้เพิ่งเลือก (ก่อนอัปโหลด)
 *
 * ⚠️ ห้ามเรียก `URL.createObjectURL(file)` ใน JSX/render ตรงๆ (บทเรียน 2026-09-08 — feedback "ลงรูปหลายรอบแล้วลงไม่ได้")
 *   ทุก re-render (ทุกตัวอักษรที่พิมพ์ในฟอร์ม) จะสร้าง blob URL ใหม่ที่ไม่มีใคร revoke → แต่ละ URL ตรึงไฟล์รูปหลาย MB
 *   ไว้ในหน่วยความจำจนกว่าจะรีเฟรชหน้า · บนมือถือสะสมไม่กี่รูปก็ชนเพดาน แล้วตัวแปลง/บีบรูปครั้งถัดไปล้ม
 *
 * hook นี้สร้าง URL ครั้งเดียวต่อไฟล์ และ revoke ให้เองเมื่อไฟล์เปลี่ยน/คอมโพเนนต์ปิด
 * ใช้: const src = useObjectUrl(file); <img src={src || fallbackUrl} />
 */
export function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) { setUrl(null); return undefined; }
    let u = null;
    try { u = URL.createObjectURL(file); } catch { u = null; }
    setUrl(u);
    return () => { if (u) { try { URL.revokeObjectURL(u); } catch { /* already revoked */ } } };
  }, [file]);
  return url;
}
