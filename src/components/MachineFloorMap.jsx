import { useRef, useState, useEffect } from 'react'

/* Factory floor-map with equipment markers.
   Reuses the object-fit:contain letterbox math from LineSetup so markers (stored
   as % of the real image via pos_top/pos_left) stay pinned to the image at any
   viewport size. The caller enriches each point with { color, dim, label, sub }.

   Read-only by default. Pass `editable` to allow:
     - click on the image (when `armed`) → onImageClick(pct)
     - drag a marker → onMarkerDragEnd(id, pct)
     - ✕ on a marker → onMarkerRemove(id)
   pct = { top: '42.10%', left: '31.00%' }

   props:
     imageUrl, points:[{id,pos_top,pos_left,label,sub,color,dim}], selectedId, onSelect
     editable, armed, onImageClick, onMarkerDragEnd, onMarkerRemove
*/
export default function MachineFloorMap({
  imageUrl, points = [], selectedId, onSelect,
  editable = false, armed = false, onImageClick, onMarkerDragEnd, onMarkerRemove,
}) {
  const imgRef = useRef(null)
  const overlayRef = useRef(null)
  const [imgBox, setImgBox] = useState(null)
  const [drag, setDrag] = useState(null) // { id, top, left }

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

  // clientX/Y → % of the real image (clamped to the image box)
  const toPct = (e) => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return null
    const l = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const t = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
    return { top: `${t.toFixed(2)}%`, left: `${l.toFixed(2)}%` }
  }

  const startDrag = (e, p) => {
    if (!editable) return
    e.preventDefault(); e.stopPropagation()
    const move = (ev) => { const pct = toPct(ev); if (pct) setDrag({ id: p.id, ...pct }) }
    const up = (ev) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      const pct = toPct(ev)
      setDrag(null)
      if (pct) onMarkerDragEnd?.(p.id, pct)
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  if (!imageUrl) {
    return (
      <div style={{ flex: 1, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 14, color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
        <div>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🗺️</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>ยังไม่มีรูปผัง</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{editable ? 'อัปโหลดรูปผังโซนก่อน' : 'อัปโหลดรูปผังได้ที่หน้า “ตั้งค่าผังไลน์”'}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 320, background: '#0a0f0b', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <img ref={imgRef} src={imageUrl} onLoad={recalc} draggable={false}
        onClick={(e) => { if (editable && armed) { const pct = toPct(e); if (pct) onImageClick?.(pct) } }}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: editable && armed ? 'crosshair' : 'default' }} />
      {imgBox && (
        <div ref={overlayRef} style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
          {points.map(p => {
            const sel = p.id === selectedId
            const color = p.color || '#9aa'
            const d = drag && drag.id === p.id
            const top = d ? drag.top : p.pos_top
            const left = d ? drag.left : p.pos_left
            return (
              <div key={p.id}
                onMouseDown={(e) => startDrag(e, p)}
                onClick={(e) => { e.stopPropagation(); if (!editable) onSelect?.(p); else onSelect?.(p) }}
                title={p.label}
                style={{
                  position: 'absolute', top, left, transform: 'translate(-50%, -50%)',
                  width: 60, minHeight: 34, borderRadius: 7,
                  border: `2px solid ${sel ? 'var(--accent)' : color}`,
                  background: sel ? 'rgba(34,197,94,0.18)' : `${color}22`,
                  boxShadow: (d ? '0 0 10px rgba(61,214,92,0.7)' : sel ? '0 0 10px rgba(61,214,92,0.6)' : `0 0 7px ${color}66`),
                  backdropFilter: 'blur(2px)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '3px 3px 2px', pointerEvents: 'auto',
                  cursor: editable ? (d ? 'grabbing' : 'grab') : 'pointer',
                  opacity: p.dim ? 0.28 : (d ? 0.9 : 1), zIndex: (sel || d) ? 15 : 5,
                }}>
                {editable && (
                  <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMarkerRemove?.(p.id) }}
                    title="เอาออกจากผัง"
                    style={{ position: 'absolute', top: -7, right: -7, width: 15, height: 15, borderRadius: '50%', background: '#e05c4a', color: '#fff', fontSize: 10, lineHeight: '15px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>✕</div>
                )}
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
