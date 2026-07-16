import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from './Toast'

// PhotoCompareModal — "จับผิด" ตรวจสภาพเครื่องด้วยการเทียบรูป (2026-07-15)
//   referenceUrl = รูปมาตรฐาน (จุดตรวจสภาพดี) · ผู้ตรวจถ่ายรูปสภาพปัจจุบันแล้วเทียบ
//   โหมดเทียบ: แบ่งซ้าย/ขวา (wipe) · ซ้อนจาง (fade) · ไฮไลต์จุดต่าง (diff heatmap)
//   ghost overlay ตอนถ่ายสด ช่วยเล็งมุมให้ตรงรูปมาตรฐาน
//   คืนค่า onResult({ verdict:'ok'|'ng', blob }) — blob = รูปที่ถ่าย (บีบแล้ว)
//     ผู้เรียกเก็บ blob เฉพาะตอน NG เท่านั้น (ผ่าน = ทิ้งพิกเซล ไม่เปลือง storage)

const MAX_PX = 800
const QUALITY = 0.72

// วาด element (img/video) ลง canvas ย่อขนาด แล้วคืน { blob, url }
function shrinkToBlob(source, sw, sh) {
  const scale = Math.min(1, MAX_PX / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  cv.getContext('2d').drawImage(source, 0, 0, w, h)
  return new Promise(resolve => {
    cv.toBlob(b => resolve({ blob: b, url: URL.createObjectURL(b) }), 'image/jpeg', QUALITY)
  })
}

export default function PhotoCompareModal({ referenceUrl, title, initialVerdict, onResult, onClose }) {
  const [captured, setCaptured] = useState(null) // { blob, url }
  const [mode, setMode] = useState('wipe')        // wipe | fade | diff
  const [wipe, setWipe] = useState(50)            // % เผยรูปปัจจุบัน
  const [fade, setFade] = useState(60)            // % ความทึบรูปปัจจุบัน
  const [camOn, setCamOn] = useState(false)
  const [ghost, setGhost] = useState(35)          // % ความทึบ ghost ตอนถ่ายสด
  const [verdict, setVerdict] = useState(initialVerdict === 'ng' ? 'ng' : initialVerdict === 'ok' ? 'ok' : null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const diffCanvasRef = useRef(null)
  const boxRef = useRef(null)

  // เลิกใช้ object URLs ตอนถอด
  useEffect(() => () => { if (captured?.url) URL.revokeObjectURL(captured.url) }, [captured])

  const stopCam = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    setCamOn(false)
  }, [])
  useEffect(() => () => stopCam(), [stopCam])

  const startCam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      streamRef.current = stream
      setCamOn(true)
      // ต่อ stream หลัง video element mount
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) } })
    } catch (err) {
      toast.error('เปิดกล้องไม่ได้ — ใช้ปุ่มเลือก/ถ่ายรูปแทนได้')
      setCamOn(false)
    }
  }

  const captureFromVideo = async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const shot = await shrinkToBlob(v, v.videoWidth, v.videoHeight)
    if (captured?.url) URL.revokeObjectURL(captured.url)
    setCaptured(shot)
    stopCam()
  }

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const img = new Image()
    img.onload = async () => {
      const shot = await shrinkToBlob(img, img.naturalWidth, img.naturalHeight)
      if (captured?.url) URL.revokeObjectURL(captured.url)
      setCaptured(shot)
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(f)
    e.target.value = ''
  }

  const retake = () => {
    if (captured?.url) URL.revokeObjectURL(captured.url)
    setCaptured(null); setMode('wipe'); setWipe(50)
  }

  // คำนวณ diff heatmap: ยืดทั้งสองรูปให้เต็ม canvas เท่ากัน แล้วระบายสีจุดที่ต่าง
  useEffect(() => {
    if (mode !== 'diff' || !captured || !referenceUrl) return
    const cv = diffCanvasRef.current
    if (!cv) return
    const W = 360, H = Math.round(W * ((boxRef.current?.clientHeight || 260) / (boxRef.current?.clientWidth || 360)))
    cv.width = W; cv.height = H
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    const ref = new Image(); ref.crossOrigin = 'anonymous'
    const cur = new Image()
    let loaded = 0
    const draw = () => {
      if (++loaded < 2) return
      try {
        const off = document.createElement('canvas'); off.width = W; off.height = H
        const octx = off.getContext('2d', { willReadFrequently: true })
        octx.drawImage(ref, 0, 0, W, H); const a = octx.getImageData(0, 0, W, H).data
        octx.clearRect(0, 0, W, H); octx.drawImage(cur, 0, 0, W, H); const b = octx.getImageData(0, 0, W, H).data
        const out = ctx.createImageData(W, H); const o = out.data
        for (let i = 0; i < a.length; i += 4) {
          const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]
          const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]
          const d = Math.abs(la - lb)
          if (d > 38) { o[i] = 255; o[i + 1] = 40; o[i + 2] = 40; o[i + 3] = Math.min(220, d * 2) }
          else { o[i + 3] = 0 }
        }
        ctx.clearRect(0, 0, W, H); ctx.putImageData(out, 0, 0)
      } catch { /* cross-origin ปิด diff เงียบๆ */ }
    }
    ref.onload = draw; cur.onload = draw
    ref.src = referenceUrl; cur.src = captured.url
  }, [mode, captured, referenceUrl])

  const confirm = () => {
    if (!verdict) { toast.error('เลือกผล ปกติ / ผิดปกติ ก่อน'); return }
    // เก็บ blob เฉพาะตอน NG — ผ่าน = ไม่ส่งพิกเซล (ประหยัด storage)
    onResult({ verdict, blob: verdict === 'ng' ? captured?.blob ?? null : null })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 460, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ fontWeight: 800, color: 'var(--text)', margin: 0, fontSize: 13.5 }}>📷 เทียบรูปมาตรฐาน{title ? ` — ${title}` : ''}</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ── ยังไม่ถ่าย: โชว์รูปมาตรฐาน + ปุ่มถ่าย/เลือก / กล้องสด ── */}
          {!captured && !camOn && (
            <>
              <div>
                <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, margin: '0 0 4px' }}>รูปมาตรฐาน (สภาพดี)</p>
                <img src={referenceUrl} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', display: 'block' }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text2)', margin: 0, textAlign: 'center', lineHeight: 1.5 }}>ถ่ายรูปจุดเดียวกันของเครื่อง แล้วเทียบกับรูปมาตรฐาน</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={startCam} style={btn('accent')}>📸 ถ่ายสด (ghost)</button>
                <label style={{ ...btn('plain'), cursor: 'pointer', textAlign: 'center' }}>
                  📁 เลือก/ถ่ายรูป
                  <input type="file" accept="image/*" capture="environment" onChange={onFile} style={{ display: 'none' }} />
                </label>
              </div>
            </>
          )}

          {/* ── กล้องสด + ghost overlay รูปมาตรฐาน ── */}
          {camOn && (
            <>
              <div ref={boxRef} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#000' }}>
                <video ref={videoRef} playsInline muted style={{ width: '100%', maxHeight: 300, objectFit: 'contain', display: 'block' }} />
                <img src={referenceUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: ghost / 100, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 8px', pointerEvents: 'none' }}>👻 เล็งให้ตรงเงารูปมาตรฐาน</div>
              </div>
              <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                เงารูปมาตรฐาน
                <input type="range" min={0} max={80} value={ghost} onChange={e => setGhost(+e.target.value)} style={{ flex: 1, width: 'auto' }} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={stopCam} style={btn('plain')}>ยกเลิก</button>
                <button onClick={captureFromVideo} style={btn('accent')}>📸 ถ่าย</button>
              </div>
            </>
          )}

          {/* ── ถ่ายแล้ว: เทียบ ── */}
          {captured && (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['wipe', '↔ แบ่งซ้าย/ขวา'], ['fade', '◐ ซ้อนจาง'], ['diff', '🔍 ไฮไลต์จุดต่าง']].map(([k, lb]) => (
                  <button key={k} onClick={() => setMode(k)} style={chip(mode === k)}>{lb}</button>
                ))}
              </div>

              <div ref={boxRef} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg3)', userSelect: 'none' }}>
                {/* ฐาน = รูปมาตรฐาน (กำหนดกรอบ) */}
                <img src={referenceUrl} alt="" draggable={false} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }} />
                {/* ทับ = รูปปัจจุบัน (ยืดเต็มกรอบเดียวกันเพื่อเทียบตำแหน่ง) */}
                {mode !== 'diff' && (
                  <img src={captured.url} alt="" draggable={false} style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block',
                    opacity: mode === 'fade' ? fade / 100 : 1,
                    clipPath: mode === 'wipe' ? `inset(0 0 0 ${wipe}%)` : 'none',
                  }} />
                )}
                {mode === 'wipe' && (
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe}%`, width: 2, background: 'var(--accent)', pointerEvents: 'none' }}>
                    <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: '#071008', fontSize: 10, fontWeight: 800, borderRadius: 8, padding: '1px 6px', whiteSpace: 'nowrap' }}>ปัจจุบัน →</span>
                  </div>
                )}
                {mode === 'diff' && <canvas ref={diffCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />}
                <div style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: '2px 7px', pointerEvents: 'none' }}>
                  {mode === 'wipe' ? 'ซ้าย=มาตรฐาน · ขวา=ปัจจุบัน' : mode === 'fade' ? 'ซ้อนรูปปัจจุบันบนมาตรฐาน' : 'แดง = จุดที่ต่างจากมาตรฐาน'}
                </div>
              </div>

              {mode === 'wipe' && <input type="range" min={0} max={100} value={wipe} onChange={e => setWipe(+e.target.value)} style={{ width: '100%' }} />}
              {mode === 'fade' && <input type="range" min={0} max={100} value={fade} onChange={e => setFade(+e.target.value)} style={{ width: '100%' }} />}
              {mode === 'diff' && <p style={{ fontSize: 10.5, color: 'var(--muted)', margin: 0, textAlign: 'center' }}>* ตัวช่วยดูคร่าวๆ — ถ้ามุม/แสงต่างกันมากจะไฮไลต์เงาด้วย ใช้ตาคนตัดสินอีกที</p>}

              <button onClick={retake} style={{ ...btn('plain'), padding: '6px 0', fontSize: 12 }}>↺ ถ่ายใหม่</button>

              {/* ── ตัดสินผล ── */}
              <div>
                <p style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700, margin: '0 0 6px' }}>ผลตรวจจุดนี้</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setVerdict('ok')} style={verBtn(verdict === 'ok', 'ok')}>✓ ปกติ</button>
                  <button onClick={() => setVerdict('ng')} style={verBtn(verdict === 'ng', 'ng')}>⚠ ผิดปกติ</button>
                </div>
                {verdict === 'ng' && <p style={{ fontSize: 11, color: '#e0a44a', margin: '6px 0 0' }}>📎 รูปนี้จะถูกเก็บเป็นหลักฐานตอนบันทึก</p>}
                {verdict === 'ok' && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>ผ่าน — ไม่เก็บรูป (ประหยัดพื้นที่)</p>}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={btn('plain')}>ปิด</button>
          <button onClick={confirm} disabled={!captured || !verdict} style={{ ...btn('accent'), opacity: (!captured || !verdict) ? 0.5 : 1 }}>ใช้ผลนี้</button>
        </div>
      </motion.div>
    </div>
  )
}

const btn = (kind) => ({
  flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  border: kind === 'accent' ? 'none' : '1px solid var(--border2)',
  background: kind === 'accent' ? 'var(--accent)' : 'var(--bg3)',
  color: kind === 'accent' ? '#071008' : 'var(--text2)',
})
const chip = (on) => ({
  flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
  background: on ? 'var(--accent-dim)' : 'var(--bg3)', color: on ? 'var(--accent)' : 'var(--muted)',
})
const verBtn = (on, kind) => ({
  flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  border: `1px solid ${on ? (kind === 'ok' ? 'var(--accent)' : '#e05c4a') : 'var(--border2)'}`,
  background: on ? (kind === 'ok' ? 'var(--accent)' : '#e05c4a') : 'var(--bg3)',
  color: on ? '#fff' : 'var(--muted)',
})
