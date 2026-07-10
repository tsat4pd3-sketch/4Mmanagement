import { useRef, useEffect } from 'react'
import useImgBox from '../utils/useImgBox'

/* 360° spin annotator for PM equipment setup.
   Multiple photo frames of one piece of equipment; drag left/right to rotate
   (change frame). Pins are placed on the frame you're viewing and only show on
   that frame — the parent passes `pins` already filtered to the current frame.

   props:
     frames   : [{ _key, _preview }]  (ordered; 1 = single image, ≥2 = spin set)
     frameIdx : number                current frame index
     setFrameIdx(idx)
     pins     : [{ key, x, y, label, color }]  (0..1 coords, current frame only)
     arming   : boolean               a checkpoint is waiting for a position
     onPlace(x, y) / onRemovePin(key)
     onAddFrames(FileList) / onRemoveFrame(frameKey) / busy
*/
export default function SpinAnnotator({
  frames = [], frameIdx = 0, setFrameIdx, pins = [], arming,
  onPlace, onRemovePin, onAddFrames, onRemoveFrame, busy,
}) {
  const boxRef = useRef(null)
  const layerRef = useRef(null)
  const drag = useRef(null) // { startX, startIdx, moved }
  const spin = frames.length >= 2
  const cur = frames[frameIdx] || frames[0] || null

  // pin สเกล/clamp/วางตำแหน่ง อิง "กล่องรูปจริง" หัก letterbox ของ objectFit:contain
  // (docs/UI-CONVENTIONS.md §5.1 — pattern เดียวกับ MachineFloorMap)
  const { imgRef, imgBox, recalc } = useImgBox([cur?._preview])
  const PK = Math.round(Math.max(20, Math.min(36, (imgBox?.rw || 500) * 0.04)))
  const pkFont = Math.max(11, Math.round(PK * 0.45))
  const padX = imgBox ? (PK * 0.7 / imgBox.rw) * 100 : 0
  const padTop = imgBox ? ((PK + 4) / imgBox.rh) * 100 : 0 // anchor ห้อยลง (translate -100%) เผื่อหัวบน
  const clampPct = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  // preload every frame so rotation is instant
  useEffect(() => { frames.forEach(f => { if (f._preview) { const im = new Image(); im.src = f._preview } }) }, [frames])

  const pointerDown = (e) => {
    if (arming) return // arming: a click places a pin, don't spin
    if (!spin) return
    drag.current = { startX: e.clientX, startIdx: frameIdx, moved: false }
    const move = (ev) => {
      if (!drag.current) return
      const dx = ev.clientX - drag.current.startX
      if (Math.abs(dx) > 3) drag.current.moved = true
      const w = boxRef.current?.clientWidth || 300
      const step = Math.round((dx / w) * frames.length)      // full width drag = full turn
      let idx = (drag.current.startIdx - step) % frames.length
      if (idx < 0) idx += frames.length
      setFrameIdx(idx)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setTimeout(() => { drag.current = null }, 0) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  // แปลงตำแหน่งคลิก → 0..1 ของ "รูปจริง" (หัก letterbox) — วัดจาก layer เดียวกับที่วาด pin
  const click = (e) => {
    if (drag.current?.moved) return
    if (!arming || !layerRef.current) return
    const r = layerRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    onPlace?.(x, y)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div ref={boxRef} onPointerDown={pointerDown} onClick={click}
        style={{ position: 'relative', userSelect: 'none', touchAction: 'none', borderRadius: 8, overflow: 'hidden',
          border: `2px solid ${arming ? 'var(--accent)' : 'var(--border)'}`, cursor: arming ? 'crosshair' : spin ? 'grab' : 'default' }}>
        {cur
          ? <img ref={imgRef} src={cur._preview} alt="frame" draggable={false} onLoad={recalc} style={{ width: '100%', maxHeight: 300, objectFit: 'contain', background: 'var(--bg2)', display: 'block' }} />
          : <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg2)', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีรูป — อัปโหลดเฟรมด้านล่าง</div>}

        {/* layer = กล่องรูปจริง (หัก letterbox) — pin ใช้ % ของ layer นี้ ไม่ใช่ % ของ container */}
        {imgBox && (
          <div ref={layerRef} style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
            {pins.map(p => (
              <button key={p.key} onClick={e => { e.stopPropagation(); onRemovePin?.(p.key) }} title={`${p.label} — คลิกเพื่อลบ`}
                style={{ position: 'absolute', left: `${clampPct(p.x * 100, padX, 100 - padX)}%`, top: `${clampPct(p.y * 100, padTop, 100)}%`, transform: 'translate(-50%,-100%)', zIndex: 10, cursor: 'pointer', background: 'none', border: 'none', padding: 0, pointerEvents: 'auto' }}>
                <div style={{ minWidth: PK, height: PK, padding: `0 ${Math.round(PK * 0.15)}px`, borderRadius: 999, background: p.color || 'var(--accent)', border: '2px solid #fff', color: '#fff', fontSize: pkFont, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>{p.label}</div>
              </button>
            ))}
          </div>
        )}

        {spin && (
          <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 12, padding: '2px 9px', pointerEvents: 'none' }}>
            🔄 {frameIdx + 1}/{frames.length}
          </div>
        )}
        {arming && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 8, pointerEvents: 'none' }}>
            <span style={{ padding: '5px 12px', borderRadius: 20, background: 'var(--accent)', color: '#071008', fontSize: 11, fontWeight: 700 }}>📍 คลิกที่รูปเพื่อวางตำแหน่ง (เฟรม {frameIdx + 1})</span>
          </div>
        )}
      </div>

      {/* frame strip */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {frames.map((f, i) => (
          <div key={f._key} onClick={() => setFrameIdx(i)} title={`เฟรม ${i + 1}`}
            style={{ position: 'relative', width: 46, height: 40, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', flexShrink: 0,
              border: `2px solid ${i === frameIdx ? 'var(--accent)' : 'var(--border)'}` }}>
            <img src={f._preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button onClick={e => { e.stopPropagation(); onRemoveFrame?.(f._key) }} title="ลบเฟรม"
              style={{ position: 'absolute', top: -1, right: -1, width: 16, height: 16, borderRadius: '0 0 0 5px', background: '#e05c4a', color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center', border: 'none', cursor: 'pointer' }}>✕</button>
            <span style={{ position: 'absolute', bottom: 0, left: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '0 4px', borderRadius: '0 4px 0 0' }}>{i + 1}</span>
          </div>
        ))}
        <label style={{ width: 46, height: 40, borderRadius: 6, border: '2px dashed var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'default' : 'pointer', color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>
          <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={e => { if (e.target.files?.length) onAddFrames?.(e.target.files); e.target.value = '' }} />
          {busy ? '…' : '+'}
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        {spin ? '🔄 หลายมุม — ลากรูปซ้าย/ขวาปัดดูรอบเครื่อง · pin ผูกกับเฟรมที่วาง (ยิ่งเยอะยิ่งลื่น)' : frames.length === 1 ? '🖼️ รูปเดียว — เพิ่มรูป (+) หลายมุมเพื่อปัดดูรอบเครื่องได้ (ไม่บังคับจำนวน)' : 'เพิ่มรูปหลายมุม (+) — 1 รูป = ปกติ, ตั้งแต่ 2 รูปปัดดูรอบเครื่องได้'}
      </div>
    </div>
  )
}
