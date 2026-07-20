import { useRef, useState, useEffect } from 'react'
import { markerScale } from '../utils/markerScale'

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
  height, // จำกัดความสูงผังให้ fit จอเดียว (เช่น 'calc(100vh - 260px)') — ไม่ส่ง = สูงตามรูปแบบเดิม
}) {
  const imgRef = useRef(null)
  const overlayRef = useRef(null)
  const [imgBox, setImgBox] = useState(null)
  const [drag, setDrag] = useState(null) // { id, top, left }
  const [showPills, setShowPills] = useState(true) // 🏷️ โชว์/ซ่อนป้ายชื่อทุกหมุด (behavior เดียวกับ Management/LineSetup — UI-CONVENTIONS §1)

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

  // pointer events (แทน mouse events) — ลากได้ทั้งเมาส์และจอทัช (2026-07-11)
  // desktop พฤติกรรมเดิมเป๊ะ: pointerdown/move/up ครอบ mouse อยู่แล้ว · touch ต้องคู่กับ touchAction:'none' ที่ marker
  const startDrag = (e, p) => {
    if (!editable) return
    e.preventDefault(); e.stopPropagation()
    const move = (ev) => { const pct = toPct(ev); if (pct) setDrag({ id: p.id, ...pct }) }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    const up = (ev) => {
      cleanup()
      const pct = toPct(ev)
      setDrag(null)
      if (pct) onMarkerDragEnd?.(p.id, pct)
    }
    const cancel = () => { cleanup(); setDrag(null) } // ระบบยกเลิก gesture (เช่น จอหมุน) — ไม่ commit ตำแหน่ง
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
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

  // ขนาดจาก util กลาง (docs/UI-CONVENTIONS.md §1) — density-aware: ผังที่เครื่องเยอะ หมุดย่อลง
  const { SUB, subRing, subPillFont, subPillMaxW } = markerScale(imgBox?.rw, { machineCount: points.length })
  const size = SUB
  const borderW = subRing
  const pillFont = subPillFont
  const subFont = Math.max(11, Math.round(size * 0.26))
  const iconFont = Math.round(size * 0.44)
  const pillsOn = showPills

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
    // height prop ต้องปิด flex-grow ด้วย — flex:1 (basis 0%) ใน column จะชนะ height ทำให้ผังสูงตามรูปจนล้นจอ
    <div style={{ position: 'relative', flex: height ? '0 0 auto' : 1, minHeight: 320, height: height || undefined, background: '#0a0f0b', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
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
                className={p.blink ? 'dt-alarm-blink' : ''}
                onPointerDown={(e) => startDrag(e, p)}
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
                  touchAction: editable ? 'none' : undefined, // โหมดแก้ไข: กันหน้าจอ scroll ระหว่างลากหมุดบนจอทัช
                  // dim (ไม่เข้าฟิลเตอร์แผนก) ต้องจางจนเห็นชัดว่าถูกกรองออก — 0.28 เดิมแยกไม่ออกจากจุดปกติ
                  opacity: p.dim ? 0.1 : (d ? 0.92 : 1), zIndex: (sel || d) ? 15 : 5,
                }}>
                <span style={{ fontSize: iconFont, lineHeight: 1 }}>{p.icon || '⚙️'}</span>

                {editable && (
                  <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMarkerRemove?.(p.id) }}
                    title="เอาออกจากผัง"
                    style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', background: '#e05c4a', color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>✕</div>
                )}

                {/* name pill(s) underneath the circle — ซ่อนเมื่อผังแน่น ยกเว้นถูกเลือก/ลาก/จุดที่ caller บังคับ (เช่น PM เกินกำหนด) */}
                {!p.dim && (pillsOn || sel || d || p.alwaysLabel) && (
                <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ maxWidth: subPillMaxW, background: sel ? 'rgba(34,197,94,0.9)' : 'rgba(0,0,0,0.78)', color: '#fff', fontSize: pillFont, fontWeight: 800, lineHeight: 1.2, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.label}
                  </div>
                  {p.sub && (
                    <div style={{ maxWidth: subPillMaxW, background: 'rgba(0,0,0,0.68)', color: '#cdd6ce', fontSize: subFont, fontWeight: 600, lineHeight: 1.2, padding: '0 5px', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.sub}
                    </div>
                  )}
                </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {/* 🏷️ โชว์/ซ่อนป้ายชื่อทุกหมุด — label บอก action ที่จะเกิดเมื่อกด (หมุดที่เลือก/PM เกินกำหนดโชว์ป้ายเสมอ) */}
      <button onClick={() => setShowPills(v => !v)}
        title="แสดง/ซ่อนป้ายชื่อทุกหมุดบนผัง (ชื่อยังดูได้จากการชี้/คลิกหมุด — หมุดที่เลือก/PM เกินกำหนดโชว์ป้ายเสมอ)"
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 20,
          padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer',
          background: showPills ? 'var(--accent-dim)' : 'rgba(10,15,11,0.85)',
          color: showPills ? 'var(--accent)' : '#cdd6ce',
          border: `1.5px solid ${showPills ? 'var(--accent)' : 'var(--border2)'}`,
        }}>
        {showPills ? '🏷️ ซ่อนป้าย' : '🏷️ โชว์ป้าย'}
      </button>
    </div>
  )
}
