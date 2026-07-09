import { useRef, useState, useEffect } from 'react'

/* Read-only factory floor-map with machine markers.
   Reuses the object-fit:contain letterbox math from LineSetup so markers (stored
   as % of the real image via pos_top/pos_left) stay pinned to the image at any
   viewport size. Presentation-only: the caller enriches each point with
   { color, dim, label, sub } and handles selection — this component just draws.

   props:
     imageUrl : background layout image url (or null → placeholder)
     points   : [{ id, pos_top, pos_left, label, sub, color, dim }]
     selectedId, onSelect(point)
*/
export default function MachineFloorMap({ imageUrl, points = [], selectedId, onSelect }) {
  const imgRef = useRef(null)
  const [imgBox, setImgBox] = useState(null)

  const recalc = () => {
    const img = imgRef.current
    if (!img || !img.naturalWidth) { setImgBox(null); return }
    const rect = img.getBoundingClientRect()
    const nW = img.naturalWidth, nH = img.naturalHeight
    const scale = Math.min(rect.width / nW, rect.height / nH)
    const rw = nW * scale, rh = nH * scale
    setImgBox({ ox: (rect.width - rw) / 2, oy: (rect.height - rh) / 2, rw, rh })
  }

  useEffect(() => {
    setImgBox(null)
    const img = imgRef.current
    if (!img) return
    const ro = new ResizeObserver(() => requestAnimationFrame(recalc))
    ro.observe(img)
    return () => ro.disconnect()
  }, [imageUrl])

  if (!imageUrl) {
    return (
      <div style={{ flex: 1, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 14, color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
        <div>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🗺️</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>ยังไม่มีรูปผังของไลน์นี้</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>อัปโหลดรูปผังได้ที่หน้า “ตั้งค่าผังไลน์”</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 320, background: '#0a0f0b', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <img ref={imgRef} src={imageUrl} onLoad={recalc} draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      {imgBox && (
        <div style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
          {points.map(p => {
            const sel = p.id === selectedId
            const color = p.color || '#9aa'
            return (
              <div key={p.id}
                onClick={() => onSelect?.(p)}
                title={p.label}
                style={{
                  position: 'absolute', top: p.pos_top, left: p.pos_left, transform: 'translate(-50%, -50%)',
                  width: 60, minHeight: 34, borderRadius: 7,
                  border: `2px solid ${sel ? 'var(--accent)' : color}`,
                  background: sel ? 'rgba(34,197,94,0.18)' : `${color}22`,
                  boxShadow: sel ? '0 0 10px rgba(61,214,92,0.6)' : `0 0 7px ${color}66`,
                  backdropFilter: 'blur(2px)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '3px 3px 2px', pointerEvents: 'auto', cursor: 'pointer',
                  opacity: p.dim ? 0.28 : 1, zIndex: sel ? 15 : 5,
                }}>
                <div style={{ fontSize: 8, fontWeight: 800, color: sel ? 'var(--accent)' : '#eaeaea', textAlign: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  ⚙️ {p.label}
                </div>
                {p.sub && (
                  <div style={{ fontSize: 7, color: '#b9c2ba', textAlign: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.sub}</div>
                )}
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, marginTop: 1, boxShadow: `0 0 4px ${color}` }} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
