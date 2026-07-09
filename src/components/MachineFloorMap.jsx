import { useRef, useState, useEffect } from 'react'

/* Factory floor-map with equipment markers.
   Reuses the object-fit:contain letterbox math from LineSetup so markers (stored
   as % of the real image via pos_top/pos_left) stay pinned to the image at any
   viewport size. The caller enriches each point with { color, dim, label, sub }.

   Marker shape follows docs/UI-CONVENTIONS.md §1: circle (⚙️ inside) + name-pill
   underneath — NEVER a rectangular box. Size uses the shared MK formula scaled to
   the *rendered* map width (0.8×MK for machines), and the displayed position is
   edge-clamped so the circle+pill never fall off the image. The circle border
   carries the PM-status color (this page's whole purpose) instead of the plain
   amber used on production floor-maps — the one deliberate deviation from §1's
   colour column, kept because status is what this map communicates.

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

  // shared MK size formula (docs/UI-CONVENTIONS.md §1), scaled to the rendered map
  // width; machine markers = 0.8×MK. Falls back to a sane default until imgBox lands.
  const MK = imgBox ? Math.round(Math.max(34, Math.min(84, imgBox.rw * 0.055))) : 40
  const size = Math.round(MK * 0.8)
  const borderW = Math.max(2, Math.round(MK * 0.06))
  const pillFont = Math.max(11, Math.round(MK * 0.24))
  const subFont = Math.max(11, Math.round(MK * 0.2))
  const iconFont = Math.round(size * 0.44)

  // clamp the *displayed* position so circle+pill stay on the image (DB unchanged):
  // margin left/right/top = size*0.55, bottom = size*1.35 (pill hangs below).
  const clampPct = (topStr, leftStr) => {
    const t = parseFloat(topStr), l = parseFloat(leftStr)
    if (!imgBox) return { top: topStr, left: leftStr } // only reached before overlay renders
    const mL = (size * 0.55 / imgBox.rw) * 100
    const mT = (size * 0.55 / imgBox.rh) * 100
    const mB = (size * 1.35 / imgBox.rh) * 100
    return {
      top: `${Math.max(mT, Math.min(100 - mB, t)).toFixed(2)}%`,
      left: `${Math.max(mL, Math.min(100 - mL, l)).toFixed(2)}%`,
    }
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
            // while dragging show the raw cursor position (unclamped) for responsiveness;
            // otherwise clamp the stored position to keep the marker on the image.
            const pos = d ? { top: drag.top, left: drag.left } : clampPct(p.pos_top, p.pos_left)
            return (
              <div key={p.id}
                onMouseDown={(e) => startDrag(e, p)}
                onClick={(e) => { e.stopPropagation(); onSelect?.(p) }}
                title={p.label}
                style={{
                  position: 'absolute', top: pos.top, left: pos.left, transform: 'translate(-50%, -50%)',
                  width: size, height: size, borderRadius: '50%',
                  border: `${borderW}px solid ${sel ? 'var(--accent)' : color}`,
                  background: sel ? 'rgba(34,197,94,0.20)' : 'rgba(10,15,11,0.82)',
                  boxShadow: d ? '0 0 12px rgba(61,214,92,0.8)' : sel ? '0 0 10px rgba(61,214,92,0.6)' : `0 0 8px ${color}66`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'auto', cursor: editable ? (d ? 'grabbing' : 'grab') : 'pointer',
                  opacity: p.dim ? 0.28 : (d ? 0.92 : 1), zIndex: (sel || d) ? 15 : 5,
                }}>
                <span style={{ fontSize: iconFont, lineHeight: 1 }}>⚙️</span>

                {editable && (
                  <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMarkerRemove?.(p.id) }}
                    title="เอาออกจากผัง"
                    style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', background: '#e05c4a', color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>✕</div>
                )}

                {/* name pill(s) underneath the circle */}
                <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ maxWidth: size * 2, background: sel ? 'rgba(34,197,94,0.9)' : 'rgba(0,0,0,0.78)', color: '#fff', fontSize: pillFont, fontWeight: 800, lineHeight: 1.2, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.label}
                  </div>
                  {p.sub && (
                    <div style={{ maxWidth: size * 2, background: 'rgba(0,0,0,0.68)', color: '#cdd6ce', fontSize: subFont, fontWeight: 600, lineHeight: 1.2, padding: '0 5px', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.sub}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
