import { useEffect, useState } from 'react'

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
          <span style={{ minWidth: 26, height: 26, padding: '0 6px', borderRadius: 999, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{label}</span>
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

/* รูปย่อของจุดในแถวรายการตรวจ — แตะ = เปิด PointZoom (เดิม PM ใช้ <a target="_blank"> = เด้งออกจากใบที่กรอกค้าง) */
export function PointThumb({ url, height = 52, ...zoomProps }) {
  const [open, setOpen] = useState(false)
  if (!url) return null
  return (
    <>
      <img loading="lazy" src={url} alt="" title="แตะเพื่อดูรูปซูมของจุดนี้" onClick={() => setOpen(true)}
        style={{ height, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', display: 'block', cursor: 'zoom-in', flexShrink: 0 }} />
      {open && <PointZoom url={url} {...zoomProps} onClose={() => setOpen(false)} />}
    </>
  )
}
