import { useRef, useState, useEffect, useCallback } from 'react'

/* useImgBox — วัด "กล่องรูปจริง" (letterbox) ของ <img objectFit:'contain'>
   (docs/UI-CONVENTIONS.md §5.1 · คณิตเดียวกับ MachineFloorMap.jsx)

   เมื่อรูปโดน maxHeight/สัดส่วน container บีบ จะเกิดแถบว่างซ้าย-ขวา/บน-ล่าง
   ทำให้ % ของ container ≠ % ของรูปจริง — marker ที่เก็บพิกัดเป็น % ของรูป
   ต้องวางบน layer ที่ตรงกับกล่องรูปจริงเท่านั้น

   คืน { imgRef, imgBox, recalc }
     imgRef  → ผูกกับ <img> (และใส่ onLoad={recalc} เสมอ — รูปโหลดเสร็จค่อยรู้ natural size)
     imgBox  → null จนกว่าจะวัดได้ | { ox, oy, rw, rh } = offset + ขนาดรูปที่ render จริง
                ภายใน element ของ <img> (img อยู่มุม 0,0 ของ container → ใช้เป็น
                left/top/width/height ของ layer marker ได้ตรงๆ)
   recalc อัตโนมัติเมื่อ element เปลี่ยนขนาด (ResizeObserver) · ส่ง deps
   (เช่น [imageUrl]) เพื่อ reset เมื่อเปลี่ยนรูป */
export default function useImgBox(deps = []) {
  const imgRef = useRef(null)
  const [imgBox, setImgBox] = useState(null)

  const recalc = useCallback(() => {
    const img = imgRef.current
    if (!img || !img.naturalWidth) { setImgBox(null); return }
    const rect = img.getBoundingClientRect()
    const nW = img.naturalWidth, nH = img.naturalHeight
    const scale = Math.min(rect.width / nW, rect.height / nH)
    const rw = nW * scale, rh = nH * scale
    setImgBox({ ox: (rect.width - rw) / 2, oy: (rect.height - rh) / 2, rw, rh })
  }, [])

  useEffect(() => {
    setImgBox(null)
    const img = imgRef.current
    if (!img) return
    const ro = new ResizeObserver(() => requestAnimationFrame(recalc))
    ro.observe(img)
    if (img.complete && img.naturalWidth) recalc() // รูป cache แล้ว onLoad อาจไม่ยิงซ้ำ
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { imgRef, imgBox, recalc }
}
