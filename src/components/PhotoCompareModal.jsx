import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from './Toast'

// PhotoCompareModal — "จับผิด" ตรวจสภาพเครื่องด้วยการเทียบรูป (2026-07-15 · เฟส2 auto-align 2026-07-16)
//   referenceUrl = รูปมาตรฐาน (จุดตรวจสภาพดี) · ผู้ตรวจถ่ายรูปสภาพปัจจุบันแล้วเทียบ
//   โหมดเทียบ: แบ่งซ้าย/ขวา (wipe) · ซ้อนจาง (fade) · ไฮไลต์จุดต่าง (diff) · กะพริบสลับ (blink comparator)
//   เฟส2: จัดตำแหน่ง/สเกลรูปปัจจุบันให้ตรงรูปมาตรฐานอัตโนมัติ (coarse-to-fine MSE ในเครื่อง ไม่พึ่ง dep)
//         → diff/blink/wipe แม่นขึ้นแม้ถ่ายมุมเบี้ยวเล็กน้อย · จูนมือ + ปรับความไวได้
//   ghost overlay ตอนถ่ายสด ช่วยเล็งมุมให้ตรงรูปมาตรฐาน
//   คืนค่า onResult({ verdict:'ok'|'ng', blob }) — เก็บ blob เฉพาะตอน NG (ผ่าน = ทิ้งพิกเซล)

const MAX_PX = 800
const QUALITY = 0.72
const AW = 80, AH = 60 // working grid สำหรับ align/diff (stretch ทั้งสองรูปมาที่นี่ → aspect เท่ากัน)

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

// ── auto-align (dependency-free) ─────────────────────────────────────────────
function grayOf(img) { // ยืดรูปเป็น AWxAH แล้วคืน luminance Float32 (throw ถ้า cross-origin taint)
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, AW, AH)
  const d = ctx.getImageData(0, 0, AW, AH).data
  const g = new Float32Array(AW * AH)
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  return g
}
function bilinear(g, x, y) {
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0
  const a = g[y0 * AW + x0], b = g[y0 * AW + x0 + 1], c = g[(y0 + 1) * AW + x0], e = g[(y0 + 1) * AW + x0 + 1]
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + e * fx * fy
}
// warp current → ref: cur ที่ ref-pixel (x,y) = cur( C + ((x,y)-C-t)/s )
function mseAt(refG, curG, s, tx, ty, step) {
  const cx = AW / 2, cy = AH / 2; let sum = 0, n = 0
  for (let y = 0; y < AH; y += step) for (let x = 0; x < AW; x += step) {
    const qx = cx + (x - cx - tx) / s, qy = cy + (y - cy - ty) / s
    if (qx < 0 || qy < 0 || qx >= AW - 1 || qy >= AH - 1) continue
    const d = refG[y * AW + x] - bilinear(curG, qx, qy); sum += d * d; n++
  }
  return n > AW ? sum / n : 1e12 // overlap น้อยเกิน = ไม่นับ
}
function alignImages(refG, curG) {
  let best = { s: 1, tx: 0, ty: 0, score: mseAt(refG, curG, 1, 0, 0, 2) }
  const scales = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.16]
  const R = Math.round(AW * 0.16)
  for (const s of scales) for (let ty = -R; ty <= R; ty += 3) for (let tx = -R; tx <= R; tx += 3) {
    const sc = mseAt(refG, curG, s, tx, ty, 2); if (sc < best.score) best = { s, tx, ty, score: sc }
  }
  const b = best
  for (let s = b.s - 0.04; s <= b.s + 0.041; s += 0.01)
    for (let ty = b.ty - 3; ty <= b.ty + 3; ty++) for (let tx = b.tx - 3; tx <= b.tx + 3; tx++) {
      const sc = mseAt(refG, curG, s, tx, ty, 2); if (sc < best.score) best = { s, tx, ty, score: sc }
    }
  // tx,ty → fraction ของกล่อง (AW,AH map เต็มกล่อง)
  return { s: best.s, txF: best.tx / AW, tyF: best.ty / AH, score: best.score }
}
const IDENTITY = { s: 1, txF: 0, tyF: 0, score: null }

export default function PhotoCompareModal({ referenceUrl, title, initialVerdict, onResult, onSetReference, onClose }) {
  const settingRef = !referenceUrl // ยังไม่มีรูปมาตรฐาน → โหมด "ตั้งรูปมาตรฐานครั้งแรก"
  const [captured, setCaptured] = useState(null) // { blob, url }
  const [mode, setMode] = useState('blink')       // wipe | fade | diff | blink (default = กะพริบ ง่ายสุด)
  const [showAdv, setShowAdv] = useState(false)   // ซ่อนโหมด/ตัวช่วยขั้นสูง ให้หน้าเรียบง่าย
  const [savingRef, setSavingRef] = useState(false)
  const [wipe, setWipe] = useState(50)
  const [fade, setFade] = useState(60)
  const [sens, setSens] = useState(34)            // เกณฑ์ diff (ต่ำ = ไวขึ้น)
  const [camOn, setCamOn] = useState(false)
  const [ghost, setGhost] = useState(35)
  const [verdict, setVerdict] = useState(initialVerdict === 'ng' ? 'ng' : initialVerdict === 'ok' ? 'ok' : null)
  const [align, setAlign] = useState(IDENTITY)    // { s, txF, tyF, score }
  const [autoAlign, setAutoAlign] = useState(true)
  const [aligning, setAligning] = useState(false)
  const [alignErr, setAlignErr] = useState(false) // อ่านพิกเซลรูปมาตรฐานไม่ได้ (cross-origin)
  const [blinkOn, setBlinkOn] = useState(true)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const diffCanvasRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => () => { if (captured?.url) URL.revokeObjectURL(captured.url) }, [captured])

  const stopCam = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    setCamOn(false)
  }, [])
  useEffect(() => () => stopCam(), [stopCam])

  const startCam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      streamRef.current = stream; setCamOn(true)
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) } })
    } catch { toast.error('เปิดกล้องไม่ได้ — ใช้ปุ่มเลือก/ถ่ายรูปแทนได้'); setCamOn(false) }
  }

  // เมื่อได้รูปใหม่ → รัน auto-align (ต้องอ่านพิกเซลรูปมาตรฐาน + รูปปัจจุบัน)
  const runAlign = useCallback((curUrl) => {
    setAligning(true); setAlignErr(false); setAlign(IDENTITY)
    const ref = new Image(); ref.crossOrigin = 'anonymous'
    const cur = new Image()
    let loaded = 0
    const go = () => {
      if (++loaded < 2) return
      try {
        const a = alignImages(grayOf(ref), grayOf(cur))
        setAlign(a)
      } catch { setAlignErr(true) } // cross-origin taint → จัดตำแหน่งเองไม่ได้
      finally { setAligning(false) }
    }
    ref.onload = go; cur.onload = go
    ref.onerror = () => { setAlignErr(true); setAligning(false) }
    ref.src = referenceUrl; cur.src = curUrl
  }, [referenceUrl])

  const accept = (shot) => { if (captured?.url) URL.revokeObjectURL(captured.url); setCaptured(shot); if (!settingRef) runAlign(shot.url) }

  const captureFromVideo = async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const shot = await shrinkToBlob(v, v.videoWidth, v.videoHeight)
    accept(shot); stopCam()
  }
  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    const img = new Image()
    img.onload = async () => { const shot = await shrinkToBlob(img, img.naturalWidth, img.naturalHeight); accept(shot); URL.revokeObjectURL(img.src) }
    img.src = URL.createObjectURL(f); e.target.value = ''
  }
  const retake = () => { if (captured?.url) URL.revokeObjectURL(captured.url); setCaptured(null); setMode('blink'); setWipe(50); setAlign(IDENTITY) }
  const saveReference = async () => { if (!captured?.blob) return; setSavingRef(true); try { await onSetReference?.(captured.blob) } finally { setSavingRef(false); retake() } }

  // transform ที่ใช้ทับรูปปัจจุบัน (aligned) — ใช้ทั้ง wipe/fade/blink
  const T = autoAlign && !alignErr ? align : IDENTITY
  const overlayTransform = `translate(${(T.txF * 100).toFixed(2)}%, ${(T.tyF * 100).toFixed(2)}%) scale(${T.s.toFixed(3)})`

  // นับ diff heatmap (aligned + ปรับความไว)
  useEffect(() => {
    if (mode !== 'diff' || !captured) return
    const cv = diffCanvasRef.current; if (!cv) return
    const bw = boxRef.current?.clientWidth || 320, bh = boxRef.current?.clientHeight || 240
    cv.width = bw; cv.height = bh
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    const ref = new Image(); ref.crossOrigin = 'anonymous'; const cur = new Image()
    let loaded = 0
    const draw = () => {
      if (++loaded < 2) return
      try {
        const off = document.createElement('canvas'); off.width = bw; off.height = bh
        const octx = off.getContext('2d', { willReadFrequently: true })
        octx.drawImage(ref, 0, 0, bw, bh); const A = octx.getImageData(0, 0, bw, bh).data
        // วาด cur แบบ aligned (center-scale + translate) ให้ตรงกับ overlay CSS
        octx.clearRect(0, 0, bw, bh); octx.save()
        octx.translate(bw / 2 + T.txF * bw, bh / 2 + T.tyF * bh); octx.scale(T.s, T.s); octx.translate(-bw / 2, -bh / 2)
        octx.drawImage(cur, 0, 0, bw, bh); octx.restore()
        const B = octx.getImageData(0, 0, bw, bh).data
        const out = ctx.createImageData(bw, bh); const o = out.data
        for (let i = 0; i < A.length; i += 4) {
          const la = 0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2]
          const lb = 0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2]
          const d = Math.abs(la - lb)
          if (d > sens) { o[i] = 255; o[i + 1] = 40; o[i + 2] = 40; o[i + 3] = Math.min(225, (d - sens) * 3 + 90) }
          else o[i + 3] = 0
        }
        ctx.clearRect(0, 0, bw, bh); ctx.putImageData(out, 0, 0)
      } catch { /* cross-origin ปิด diff เงียบๆ */ }
    }
    ref.onload = draw; cur.onload = draw
    ref.src = referenceUrl; cur.src = captured.url
  }, [mode, captured, referenceUrl, sens, T.s, T.txF, T.tyF])

  // blink comparator — สลับ ref/current อัตโนมัติ ให้จุดต่างกระพริบเข้าตา
  useEffect(() => {
    if (mode !== 'blink' || !captured) return
    const t = setInterval(() => setBlinkOn(v => !v), 520)
    return () => clearInterval(t)
  }, [mode, captured])

  const nudge = (dx, dy, ds) => { setAutoAlign(true); setAlignErr(false); setAlign(a => ({ ...a, txF: a.txF + dx, tyF: a.tyF + dy, s: Math.max(0.5, Math.min(2, a.s + ds)) })) }

  const confirm = () => {
    if (!verdict) { toast.error('เลือกผล ปกติ / ผิดปกติ ก่อน'); return }
    onResult({ verdict, blob: verdict === 'ng' ? captured?.blob ?? null : null })
  }

  const alignQuality = align.score == null ? null : align.score < 380 ? 'ดี' : align.score < 1100 ? 'พอใช้' : 'ต่ำ (มุม/แสงต่างมาก)'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 460, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ fontWeight: 800, color: 'var(--text)', margin: 0, fontSize: 13.5 }}>📷 เทียบรูปมาตรฐาน{title ? ` — ${title}` : ''}</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!captured && !camOn && (
            <>
              {settingRef ? (
                <div style={{ padding: '20px 14px', textAlign: 'center', borderRadius: 8, border: '1px dashed var(--accent)', background: 'var(--accent-dim)' }}>
                  <div style={{ fontSize: 30 }}>📷</div>
                  <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', margin: '6px 0 2px' }}>ตั้งรูปมาตรฐานครั้งแรก</p>
                  <p style={{ fontSize: 12, color: 'var(--text2)', margin: 0, lineHeight: 1.5 }}>ถ่าย/เลือกรูป "สภาพดี" ของจุดนี้ 1 รูป<br />ครั้งต่อไปจะเอามาเทียบให้อัตโนมัติ</p>
                </div>
              ) : (
                <>
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, margin: '0 0 4px' }}>รูปมาตรฐาน (สภาพดี)</p>
                    <img src={referenceUrl} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', display: 'block' }} />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text2)', margin: 0, textAlign: 'center', lineHeight: 1.5 }}>ถ่ายรูปจุดเดียวกันของเครื่อง แล้วเทียบกับรูปมาตรฐาน</p>
                </>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={startCam} style={btn('accent')}>📸 ถ่ายสด{settingRef ? '' : ' (ghost)'}</button>
                <label style={{ ...btn('plain'), cursor: 'pointer', textAlign: 'center' }}>
                  📁 เลือก/ถ่ายรูป
                  <input type="file" accept="image/*" capture="environment" onChange={onFile} style={{ display: 'none' }} />
                </label>
              </div>
            </>
          )}

          {camOn && (
            <>
              <div ref={boxRef} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#000' }}>
                <video ref={videoRef} playsInline muted style={{ width: '100%', maxHeight: 300, objectFit: 'contain', display: 'block' }} />
                {!settingRef && <img src={referenceUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: ghost / 100, pointerEvents: 'none' }} />}
                {!settingRef && <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 8px', pointerEvents: 'none' }}>👻 เล็งให้ตรงเงารูปมาตรฐาน</div>}
              </div>
              {!settingRef && (
                <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  เงารูปมาตรฐาน
                  <input type="range" min={0} max={80} value={ghost} onChange={e => setGhost(+e.target.value)} style={{ flex: 1, width: 'auto' }} />
                </label>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={stopCam} style={btn('plain')}>ยกเลิก</button>
                <button onClick={captureFromVideo} style={btn('accent')}>📸 ถ่าย</button>
              </div>
            </>
          )}

          {/* ครั้งแรก (ยังไม่มีรูปมาตรฐาน) — ถ่ายแล้วบันทึกเป็นมาตรฐานเลย */}
          {captured && settingRef && (
            <>
              <div>
                <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, margin: '0 0 4px' }}>รูปที่ถ่าย (จะตั้งเป็นมาตรฐาน)</p>
                <img src={captured.url} alt="" style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', display: 'block' }} />
              </div>
              <button onClick={retake} style={{ ...btn('plain'), padding: '7px 0', fontSize: 12 }}>↺ ถ่ายใหม่</button>
              <button onClick={saveReference} disabled={savingRef} style={{ ...btn('accent'), opacity: savingRef ? 0.6 : 1 }}>{savingRef ? 'กำลังบันทึก...' : '✅ บันทึกเป็นภาพมาตรฐาน'}</button>
            </>
          )}

          {captured && !settingRef && (
            <>
              {showAdv && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {[['wipe', '↔ แบ่ง'], ['fade', '◐ ซ้อนจาง'], ['diff', '🔍 จุดต่าง'], ['blink', '⚡ กะพริบ']].map(([k, lb]) => (
                    <button key={k} onClick={() => setMode(k)} style={chip(mode === k)}>{lb}</button>
                  ))}
                </div>
              )}

              <div ref={boxRef} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg3)', userSelect: 'none' }}>
                <img src={referenceUrl} alt="" draggable={false} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }} />
                {mode !== 'diff' && (
                  <img src={captured.url} alt="" draggable={false} style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block',
                    transformOrigin: 'center', transform: overlayTransform,
                    opacity: mode === 'fade' ? fade / 100 : mode === 'blink' ? (blinkOn ? 1 : 0) : 1,
                    clipPath: mode === 'wipe' ? `inset(0 0 0 ${wipe}%)` : 'none',
                    transition: mode === 'blink' ? 'none' : 'opacity .12s',
                  }} />
                )}
                {mode === 'wipe' && (
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe}%`, width: 2, background: 'var(--accent)', pointerEvents: 'none' }}>
                    <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: '#071008', fontSize: 10, fontWeight: 800, borderRadius: 8, padding: '1px 6px', whiteSpace: 'nowrap' }}>ปัจจุบัน →</span>
                  </div>
                )}
                {mode === 'diff' && <canvas ref={diffCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />}
                <div style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: '2px 7px', pointerEvents: 'none' }}>
                  {mode === 'wipe' ? 'ซ้าย=มาตรฐาน · ขวา=ปัจจุบัน' : mode === 'fade' ? 'ซ้อนปัจจุบันบนมาตรฐาน' : mode === 'diff' ? 'แดง = จุดที่ต่างจากมาตรฐาน' : 'กะพริบ: จุดต่างจะเด้งเข้าตา'}
                </div>
                {aligning && <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: '2px 7px' }}>⏳ กำลังจัดตำแหน่ง…</div>}
              </div>

              {showAdv && mode === 'wipe' && <input type="range" min={0} max={100} value={wipe} onChange={e => setWipe(+e.target.value)} style={{ width: '100%' }} />}
              {showAdv && mode === 'fade' && <input type="range" min={0} max={100} value={fade} onChange={e => setFade(+e.target.value)} style={{ width: '100%' }} />}
              {showAdv && mode === 'diff' && (
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  ความไว
                  <input type="range" min={12} max={80} value={90 - sens} onChange={e => setSens(90 - +e.target.value)} style={{ flex: 1, width: 'auto' }} />
                  <span style={{ color: 'var(--text2)', width: 40, textAlign: 'right' }}>{90 - sens > 60 ? 'สูง' : 90 - sens > 35 ? 'กลาง' : 'ต่ำ'}</span>
                </label>
              )}

              {/* ── ตัวช่วยขั้นสูง (auto-align + จูนมือ) ซ่อนไว้ให้หน้าเรียบง่าย ── */}
              {showAdv && (
                <div style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={autoAlign} onChange={e => setAutoAlign(e.target.checked)} style={{ width: 'auto' }} />🎯 จัดตำแหน่งอัตโนมัติ
                    </label>
                    {alignErr ? <span style={{ fontSize: 10.5, color: 'var(--accent2)' }}>จัดอัตโนมัติไม่ได้ — จูนมือด้านล่าง</span>
                      : alignQuality && <span style={{ fontSize: 10.5, color: alignQuality === 'ดี' ? 'var(--accent)' : alignQuality === 'พอใช้' ? 'var(--accent2)' : '#e05c4a', fontWeight: 700 }}>ความตรง: {alignQuality}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>จูนมือ:</span>
                    <button onClick={() => nudge(-0.012, 0, 0)} style={nb}>◀</button>
                    <button onClick={() => nudge(0.012, 0, 0)} style={nb}>▶</button>
                    <button onClick={() => nudge(0, -0.012, 0)} style={nb}>▲</button>
                    <button onClick={() => nudge(0, 0.012, 0)} style={nb}>▼</button>
                    <button onClick={() => nudge(0, 0, 0.02)} style={nb}>➕</button>
                    <button onClick={() => nudge(0, 0, -0.02)} style={nb}>➖</button>
                    <button onClick={() => setAlign(IDENTITY)} style={{ ...nb, width: 'auto', padding: '0 8px', fontSize: 10.5 }}>รีเซ็ต</button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={retake} style={{ ...btn('plain'), padding: '6px 0', fontSize: 12 }}>↺ ถ่ายใหม่</button>
                <button onClick={() => setShowAdv(v => !v)} style={{ ...btn('plain'), padding: '6px 0', fontSize: 12, color: showAdv ? 'var(--accent)' : 'var(--muted)', borderColor: showAdv ? 'var(--accent)' : 'var(--border2)' }}>{showAdv ? '▲ ซ่อนตัวช่วย' : '⚙️ ตัวช่วยเทียบเพิ่มเติม'}</button>
              </div>

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
          {!settingRef && <button onClick={confirm} disabled={!captured || !verdict} style={{ ...btn('accent'), opacity: (!captured || !verdict) ? 0.5 : 1 }}>ใช้ผลนี้</button>}
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
  flex: '1 1 auto', padding: '6px 4px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
  background: on ? 'var(--accent-dim)' : 'var(--bg3)', color: on ? 'var(--accent)' : 'var(--muted)',
})
const nb = {
  width: 26, height: 24, borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)',
  color: 'var(--text2)', fontSize: 11, fontWeight: 800, cursor: 'pointer', padding: 0,
}
const verBtn = (on, kind) => ({
  flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  border: `1px solid ${on ? (kind === 'ok' ? 'var(--accent)' : '#e05c4a') : 'var(--border2)'}`,
  background: on ? (kind === 'ok' ? 'var(--accent)' : '#e05c4a') : 'var(--bg3)',
  color: on ? '#fff' : 'var(--muted)',
})
