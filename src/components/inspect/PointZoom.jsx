import { useState } from 'react'
import useIsMobile from '../../utils/useIsMobile'
/* 🔍 ฉากดูรูปเต็มจอ = ของกลางตัวเดียวของทั้งแอป (`components/ImageLightbox.jsx` · 16/11)
   เดิมไฟล์นี้วาดฉากเอง แล้วหน้าอื่นที่อยากได้ (ใบ MO · รูปหลักฐานของเสีย · KPI note) ก๊อปไม่ได้
   ⇒ ยุบเหลือ "ตัวแปลงพารามิเตอร์ของจุดตรวจ → items ของ ImageLightbox" **ห้ามวาดฉากซ้ำที่นี่อีก** */
import ImageLightbox from '../ImageLightbox'

import { tr } from '../../utils/i18n';
/* 🔍 รูปโคลสอัพของจุดตรวจ — เปิดในแอป (ไม่เด้งออกแท็บใหม่ เพราะหน้างานใช้มือถือ)
   ภาพรวม = แผนที่ว่าจุดอยู่ตรงไหน · ตัวนี้ = ซูมเข้าไปดูว่าต้องดูอะไรตรงนั้น
   ของกลางของ "จอตรวจ" ทุกระบบ (PM `PMCheckData` · QA `QaCheckSheet`/`QaPieceStepper` · 15/10)
   📄 docs/modules/inspection-point-setup.md §ฝั่งตรวจ */
export default function PointZoom({ url, label, color = 'var(--accent)', name, description, onClose }) {
  if (!url) return null
  return <ImageLightbox onClose={onClose}
    items={[{ url, title: name, caption: description, badge: label, badgeColor: color }]} />
}

/* รูปย่อของจุดในแถวรายการตรวจ — แตะ = เปิด PointZoom (เดิม PM ใช้ <a target="_blank"> = เด้งออกจากใบที่กรอกค้าง)
   📐 กล่องขนาดคงที่ (สูง `height` × กว้าง 4:3) + รูป contain ข้างใน (A7 · ประชุม 02/11 · 03/11)
      เดิมตั้งแค่ `height` ⇒ กว้างตามสัดส่วนไฟล์: รูปพาโนรามา/แนวนอนจัดกว้างได้หลายร้อย px
      ดันชื่อจุด+ปุ่ม OK/NG จนแถวเพี้ยน และรูปเล็กถูกขยายเกินจริง ⇒ "รูปใหญ่ผิดขนาด อยู่ผิดที่"
      · รูปไม่ถูกขยายเกินขนาดไฟล์ (max-width/height 100% ไม่ใช่ width/height) · ไม่ครอป (เห็นทั้งรูป)
      · `alignSelf:center` กันถูกยืดเมื่ออยู่ใน flex คอลัมน์ · 📱 มือถือเพดานสูง 44 (แถวมีปุ่ม OK/NG 44px อยู่แล้ว) */
export const THUMB_RATIO = 4 / 3
export function PointThumb({ url, height = 52, mobileMax = 44, ...zoomProps }) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  if (!url) return null
  const h = isMobile ? Math.min(height, mobileMax) : height
  return (
    <>
      <button type="button" title={tr('แตะเพื่อดูรูปซูมของจุดนี้')} aria-label={tr('ดูรูปซูมของจุดนี้')} onClick={() => setOpen(true)}
        style={{ width: Math.round(h * THUMB_RATIO), height: h, flex: '0 0 auto', alignSelf: 'center', padding: 0, borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--bg2-surf)', overflow: 'hidden', cursor: 'zoom-in',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img loading="lazy" src={url} alt=""
          style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} />
      </button>
      {open && <PointZoom url={url} {...zoomProps} onClose={() => setOpen(false)} />}
    </>
  )
}
