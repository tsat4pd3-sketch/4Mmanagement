import { useEffect, useState } from 'react'
import useIsMobile from '../../utils/useIsMobile'

/* 🔍 รูปโคลสอัพของจุดตรวจ — เปิดในแอป (ไม่เด้งออกแท็บใหม่ เพราะหน้างานใช้มือถือ)
   ภาพรวม = แผนที่ว่าจุดอยู่ตรงไหน · ตัวนี้ = ซูมเข้าไปดูว่าต้องดูอะไรตรงนั้น
   ของกลางของ "จอตรวจ" ทุกระบบ (PM `PMCheckData` · QA `QaCheckSheet`/`QaPieceStepper` · 15/10)
   📄 docs/modules/inspection-point-setup.md §ฝั่งตรวจ */
export default function PointZoom({ url, label, color = 'var(--accent)', name, description, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  if (!url) return null
  return (
    <div onClick={onClose} className="modal-scroll"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 3000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 12, gap: 10 }}>
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', maxWidth: '100%' }}>
        {label != null && label !== '' && (
          <span style={{ minWidth: 26, height: 26, padding: '0 6px', borderRadius: 'var(--r-pill)', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{label}</span>
        )}
        <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      </div>
      <img src={url} alt={name || ''} onClick={e => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '74vh', objectFit: 'contain', borderRadius: 10, border: '2px solid rgba(255,255,255,0.25)' }} />
      {description && (
        <div onClick={e => e.stopPropagation()} style={{ color: '#e5e7eb', fontSize: 12.5, maxWidth: 'min(560px, 94vw)', textAlign: 'center', lineHeight: 1.6 }}>{description}</div>
      )}
      <button onClick={onClose} style={{ padding: '9px 26px', borderRadius: 999, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>ปิด</button>
    </div>
  )
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
      <button type="button" title="แตะเพื่อดูรูปซูมของจุดนี้" aria-label="ดูรูปซูมของจุดนี้" onClick={() => setOpen(true)}
        style={{ width: Math.round(h * THUMB_RATIO), height: h, flex: '0 0 auto', alignSelf: 'center', padding: 0, borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--bg2)', overflow: 'hidden', cursor: 'zoom-in',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img loading="lazy" src={url} alt=""
          style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} />
      </button>
      {open && <PointZoom url={url} {...zoomProps} onClose={() => setOpen(false)} />}
    </>
  )
}
