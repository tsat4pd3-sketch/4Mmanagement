import { useRef, useEffect, useState } from 'react'
import useImgBox from '../utils/useImgBox'
import CalloutPin from './CalloutPin'
import { acceptImageFile } from '../utils/acceptImageFile';

/* 📍 ตัวปักหมุดจุดตรวจบนรูปอ้างอิง — **ตัวกลางของ "ตั้งค่าจุดตรวจ" ทุกระบบ**
   (2026-10-15 · คำสั่ง user: *"ใช้หลักการเดียวกันในการสร้าง — ต่างกันแค่อุปกรณ์ vs ชิ้นงาน
    กับรายละเอียดที่ต้องตรวจ · user เรียนระบบเดียวแล้วทำเป็นทั้งคู่"*)
   ใช้ที่: PM `/pm?tab=setup` (รูปอุปกรณ์ หลายมุม) · QA `/qa-setup` (Drawing ชิ้นงาน หลายแผ่น) ·
           `/equipment?tab=jig` (readOnlyFrames — รูปเป็นของ PM)
   📄 กติกาเต็ม → docs/modules/inspection-point-setup.md · UI §5.1

   รูปหลายภาพต่อ 1 สิ่งที่ตรวจ ("เฟรม") · หมุดผูกกับเฟรมที่วาง — parent ส่ง `pins` ที่กรองเฉพาะเฟรมนี้มา
   · `spinnable` (default true) = ≥2 เฟรมลากซ้าย/ขวาหมุนดูรอบเครื่อง · QA ส่ง false (แผ่นแบบไม่ใช่มุมหมุน)
   · ซูม 100–400% มีในตัว (เดิม PM ไม่มี · QA มีเฉพาะหน้าตัวเอง) — ซูมอยู่ = ปิดการลากหมุน ใช้รูปย่อแทน
   · เฟรม PDF (`isPdf`) = แสดงอย่างเดียว ปักหมุดไม่ได้ (บอกบนจอ)

   props:
     frames   : [{ _key, _preview, title?, isPdf? }]
     frameIdx / setFrameIdx
     pins     : [{ key, x, y, label, label_dx, label_dy, color, selected?, hollow? }]  (0..1 · เฉพาะเฟรมนี้)
     arming   : มีจุดรอวางตำแหน่ง → แตะรูป = onPlace(x, y)
     onPinClick(key) — ส่งมา = แตะหมุด "ไปที่การ์ดจุดนั้น" · ไม่ส่ง = แตะหมุด = onRemovePin (Fixture)
     onLabelMove(key, dx, dy) — ลากป้ายเลขหลบกัน · ไม่ส่ง = อ่านอย่างเดียว
     onAddFrames(File[]) / onRemoveFrame(key) / onRenameFrame(key) / onReplaceFrame(key, File)
     acceptPdf · subject ('equipment' | 'part') = ข้อความแนะนำ · frameCounts { key: จำนวนหมุด }
     pinHasDetail { key: true } = จุดนี้มีรูปโคลสอัพ (หมุดขึ้น 🔍)
     readOnlyFrames — ห้ามเพิ่ม/ลบ/แก้เฟรมจากที่นี่ */
// ความสูงสูงสุดของกรอบรูปที่ซูม 100% — ค่าเดิมของ PM (WYSIWYG กับจอตรวจมาจาก useImgBox ไม่ใช่ค่านี้)
const VIEW_MAX_H = 'min(520px, 72vh)'
const ZOOM_MAX = 4

const tinyBtn = {
  padding: '3px 9px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)',
}

export default function SpinAnnotator({
  frames = [], frameIdx = 0, setFrameIdx, pins = [], arming,
  onPlace, onRemovePin, onAddFrames, onRemoveFrame, onRenameFrame, onReplaceFrame, busy, onPinClick,
  onLabelMove,
  pinHasDetail = {},
  // true = ใช้เป็น "ผังวางหมุด" อย่างเดียว (เช่น จุดชิมที่ /fixture) — รูปเป็นของ PM Setup ห้ามเพิ่ม/ลบจากที่นี่
  readOnlyFrames = false,
  spinnable = true,
  acceptPdf = false,
  subject = 'equipment',
  frameCounts,
}) {
  const boxRef = useRef(null)
  const layerRef = useRef(null)
  const replaceRef = useRef(null)
  const drag = useRef(null) // { startX, startIdx, moved }
  const cur = frames[frameIdx] || frames[0] || null
  const isPdf = !!cur?.isPdf
  const [zoom, setZoom] = useState(1)
  // ขนาดรูปตอนซูม 100% (พอดีกรอบ) — ใช้เป็นฐานของการซูม และล็อกขนาดกรอบไม่ให้กระโดดตอนซูม
  const [fit, setFit] = useState(null)
  const spin = spinnable && frames.length >= 2 && zoom === 1

  // pin สเกล/clamp/วางตำแหน่ง อิง "กล่องรูปจริง" หัก letterbox ของ objectFit:contain
  // (docs/UI-CONVENTIONS.md §5.1 — pattern เดียวกับ MachineFloorMap)
  const { imgRef, imgBox, recalc } = useImgBox([cur?._preview, zoom])
  // ขนาดหมุดคิดจาก "ขนาดพอดีกรอบ" ไม่ใช่ขนาดตอนซูม — ซูมแล้วหมุดไม่บวมตาม (เล็งจุดเล็กได้)
  const PK = Math.round(Math.max(20, Math.min(36, (fit?.w || imgBox?.rw || 500) * 0.04)))

  useEffect(() => { setZoom(1); setFit(null) }, [cur?._preview])
  useEffect(() => {
    if (zoom === 1 && imgBox?.rw) setFit({ w: imgBox.rw, h: imgBox.rh })
  }, [zoom, imgBox?.rw, imgBox?.rh])

  // preload every frame so rotation is instant
  useEffect(() => { frames.forEach(f => { if (f._preview && !f.isPdf) { const im = new Image(); im.src = f._preview } }) }, [frames])

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
    if (!arming || isPdf || !layerRef.current) return
    const r = layerRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    onPlace?.(x, y)
  }

  const zoomed = zoom > 1 && fit
  const imgStyle = zoomed
    ? { display: 'block', width: Math.round(fit.w * zoom), height: 'auto', maxWidth: 'none', maxHeight: 'none' }
    : { display: 'block', maxWidth: '100%', maxHeight: VIEW_MAX_H, objectFit: 'contain' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* กรอบรูป — ซูม 100%: หุ้มรูปพอดี (fit-content) · ซูม >100%: ล็อกขนาดเท่าตอนพอดีกรอบแล้วเลื่อนดูข้างใน */}
      <div ref={boxRef} onPointerDown={pointerDown} onClick={click}
        style={{ position: 'relative', userSelect: 'none', touchAction: zoomed ? 'auto' : 'none', borderRadius: 8,
          overflow: zoomed ? 'auto' : 'hidden',
          border: `2px solid ${arming && !isPdf ? 'var(--accent)' : 'var(--border)'}`,
          cursor: arming && !isPdf ? 'crosshair' : spin ? 'grab' : 'default',
          width: zoomed ? Math.round(fit.w) + 4 : (isPdf ? '100%' : 'fit-content'),
          height: zoomed ? Math.round(fit.h) + 4 : undefined,
          maxWidth: '100%', margin: '0 auto', background: 'var(--bg2)' }}>
        {!cur ? (
          <div style={{ width: 'min(360px, 80vw)', height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg2)', color: 'var(--muted)', fontSize: 13 }}>
            {subject === 'part' ? 'ยังไม่มี Drawing — กด + เพิ่มแผ่น' : 'ยังไม่มีรูป — อัปโหลดด้านล่าง'}
          </div>
        ) : isPdf ? (
          <iframe src={cur._preview} title={cur.title || 'PDF'} style={{ display: 'block', width: '100%', height: 'min(520px, 72vh)', border: 'none', background: '#fff' }} />
        ) : (
          <div style={{ position: 'relative', width: 'fit-content' }}>
            <img ref={imgRef} src={cur._preview} alt={cur.title || 'frame'} draggable={false} onLoad={recalc} style={{ ...imgStyle, background: 'var(--bg2)' }} />
            {/* layer = กล่องรูปจริง (หัก letterbox) — pin ใช้ % ของ layer นี้ ไม่ใช่ % ของ container */}
            {imgBox && (
              <div ref={layerRef} style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
                {pins.map(p => (
                  <CalloutPin key={p.key} xPct={p.x * 100} yPct={p.y * 100} layerW={imgBox.rw} layerH={imgBox.rh} size={PK}
                    offX={p.label_dx} offY={p.label_dy}
                    label={p.label} color={p.color || 'var(--accent)'} badge={pinHasDetail[p.key] ? '🔍' : null}
                    /* 🔴 "หมุดที่กำลังเลือก" ต้องต่างที่ **วงไฮไลต์** ไม่ใช่แค่เปลี่ยนสี (23/09 · audit หมุดทั้งโปรเจค)
                       สีประเภทจุดตรวจตั้งเองได้ในทะเบียน — ประเภทสีเขียวจะหน้าตาเหมือนหมุดที่กำลังวางเป๊ะ */
                    selected={p.selected} hollow={p.hollow}
                    title={`${p.label} — ${onPinClick ? 'คลิกเพื่อไปที่จุดนี้ในรายการ' : 'คลิกเพื่อลบ'}${onLabelMove ? ' · ลากป้ายเลขเพื่อหลบไม่ให้ลูกศรทับกัน' : ''}`}
                    onLabelMove={onLabelMove ? ((dx, dy) => onLabelMove(p.key, dx, dy)) : undefined}
                    onClick={e => { e.stopPropagation(); if (onPinClick) onPinClick(p.key); else onRemovePin?.(p.key) }} />
                ))}
              </div>
            )}
          </div>
        )}

        {spin && (
          <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 12, padding: '2px 9px', pointerEvents: 'none' }}>
            🔄 {frameIdx + 1}/{frames.length}
          </div>
        )}
        {/* ซูมอยู่ = กรอบเป็นตัวเลื่อน ป้ายลอยจะเลื่อนหนีไปกับรูป ⇒ ย้ายไปเขียนใต้กรอบแทน */}
        {arming && !isPdf && cur && !zoomed && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 8, pointerEvents: 'none' }}>
            <span style={{ padding: '5px 12px', borderRadius: 20, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 11, fontWeight: 700 }}>📍 แตะที่รูปเพื่อวางตำแหน่ง</span>
          </div>
        )}
      </div>

      {/* แถบซูม — ทุกจอที่ปักหมุดได้ซูมแบบเดียวกัน (เดิม PM ไม่มี) */}
      {cur && !isPdf && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" style={tinyBtn} onClick={() => setZoom(z => Math.max(1, +(z - 0.5).toFixed(2)))} disabled={zoom <= 1} title="ซูมออก" aria-label="ซูมออก">➖</button>
          <span style={{ fontSize: 12, fontWeight: 800, minWidth: 46, textAlign: 'center', color: 'var(--text)' }}>{Math.round(zoom * 100)}%</span>
          <button type="button" style={tinyBtn} onClick={() => setZoom(z => Math.min(ZOOM_MAX, +(z + 0.5).toFixed(2)))} disabled={zoom >= ZOOM_MAX || !fit} title="ซูมเข้า" aria-label="ซูมเข้า">➕</button>
          {zoom > 1 && <button type="button" style={tinyBtn} onClick={() => setZoom(1)}>↺ พอดีกรอบ</button>}
          <span style={{ fontSize: 11, color: arming && zoom > 1 ? 'var(--accent)' : 'var(--muted)', fontWeight: arming && zoom > 1 ? 700 : 400 }}>
            {arming && zoom > 1 ? '📍 แตะที่รูปเพื่อวางตำแหน่ง' : zoom > 1 ? 'เลื่อนดูส่วนอื่นในกรอบได้' : 'ซูมเข้าเพื่อวางจุดเล็กๆ ให้แม่น'}
          </span>
        </div>
      )}

      {/* แถบเฟรม/แผ่น — รูปย่อ + ชื่อ (ถ้ามี) · แตะ = สลับ */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {frames.map((f, i) => {
          const active = i === frameIdx
          const cnt = frameCounts?.[f._key]
          return (
            <div key={f._key} onClick={() => setFrameIdx(i)} title={f.title || `เฟรม ${i + 1}`}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', flexShrink: 0, maxWidth: f.title ? 92 : 46 }}>
              <div style={{ position: 'relative', width: 46, height: 40, borderRadius: 6, overflow: 'hidden',
                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}` }}>
                {f.isPdf
                  ? <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg3)', fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}>PDF</div>
                  : <img src={f._preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                {!readOnlyFrames && onRemoveFrame && <button onClick={e => { e.stopPropagation(); onRemoveFrame(f._key) }} title="ลบรูปนี้" aria-label="ลบรูปนี้"
                  style={{ position: 'absolute', top: -1, right: -1, width: 16, height: 16, borderRadius: '0 0 0 5px', background: '#e05c4a', color: '#fff', fontSize: 11, lineHeight: '16px', textAlign: 'center', border: 'none', cursor: 'pointer', padding: 0 }}>×</button>}
                <span style={{ position: 'absolute', bottom: 0, left: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '0 4px', borderRadius: '0 4px 0 0' }}>{cnt ? `${i + 1}·${cnt}📍` : i + 1}</span>
              </div>
              {f.title && <span style={{ fontSize: 11, fontWeight: active ? 800 : 600, color: active ? 'var(--accent)' : 'var(--muted)', maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>}
            </div>
          )
        })}
        {!readOnlyFrames && onAddFrames && <label title={subject === 'part' ? 'เพิ่มแผ่น Drawing' : 'เพิ่มรูป'} style={{ width: 46, height: 40, borderRadius: 6, border: '2px dashed var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'default' : 'pointer', color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>
          <input type="file" accept={acceptPdf ? 'image/*,application/pdf' : 'image/*'} multiple hidden disabled={busy} onChange={async e => {
            const picked = [...(e.target.files || [])];
            e.target.value = '';
            /* ด่านรับรูปจุดเดียว — HEIC จากมือถือแปลงเป็น JPEG · ตัวที่ไม่ผ่านถูก toast แล้วคัดออก
               (ไฟล์ดีที่เลือกมาพร้อมกันยังเข้าได้ — ห้ามทิ้งทั้งชุดเพราะมีตัวเสีย 1 ตัว) · PDF ผ่านตรง */
            const ok = (await Promise.all(picked.map(f => (acceptPdf && f.type === 'application/pdf') ? f : acceptImageFile(f)))).filter(Boolean);
            if (ok.length) onAddFrames(ok);
          }} />
          {busy ? '…' : '+'}
        </label>}
      </div>

      {/* เครื่องมือของรูปที่เปิดอยู่ — เปลี่ยนชื่อ/เปลี่ยนรูป (หมุดอยู่ที่เดิม) */}
      {!readOnlyFrames && cur && (onRenameFrame || onReplaceFrame) && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>🖼 {cur.title || `รูปที่ ${frameIdx + 1}`}</span>
          {onRenameFrame && <button type="button" style={tinyBtn} onClick={() => onRenameFrame(cur._key)}>✏️ ตั้งชื่อ</button>}
          {onReplaceFrame && (
            <>
              <input ref={replaceRef} type="file" hidden accept={acceptPdf ? 'image/*,application/pdf' : 'image/*'} onChange={async e => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (!f) return
                const ok = (acceptPdf && f.type === 'application/pdf') ? f : await acceptImageFile(f)
                if (ok) onReplaceFrame(cur._key, ok)
              }} />
              <button type="button" style={tinyBtn} disabled={busy} onClick={() => replaceRef.current?.click()}
                title="เปลี่ยนไฟล์รูป (เช่น Drawing Rev ใหม่) — หมุดอยู่ตำแหน่งเดิม">🔄 เปลี่ยนรูป</button>
            </>
          )}
        </div>
      )}
      {isPdf && <div style={{ fontSize: 11.5, color: '#f59a3f', fontWeight: 700 }}>⚠️ แผ่น PDF ปักหมุดไม่ได้ — ถ้าต้องการหมุดให้อัปเป็นรูปภาพ (PNG/JPG)</div>}

      {!readOnlyFrames && <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        {spinnable
          ? (spin ? '🔄 หลายมุม — ลากรูปซ้าย/ขวาปัดดูรอบเครื่อง · หมุดผูกกับรูปที่วาง' : frames.length === 1 ? '🖼️ รูปเดียว — เพิ่มรูป (+) หลายมุมเพื่อปัดดูรอบเครื่องได้ (ไม่บังคับจำนวน)' : 'เพิ่มรูปหลายมุม (+) — 1 รูป = ปกติ, ตั้งแต่ 2 รูปปัดดูรอบเครื่องได้')
          : '🖼️ หลายแผ่น/มุมมอง — แตะรูปย่อเพื่อสลับ · หมุดผูกกับแผ่นที่วาง'}
      </div>}
      {/* ⚠️ วิธีใช้ที่ถูก (feedback หน้างาน 2026-08-21) — รูปมุมแคบอย่าอัปเป็นเฟรมแยก
         เพราะคนตรวจจะไม่รู้ว่ามันอยู่ตรงไหนของเครื่อง */}
      {!readOnlyFrames && <div style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', lineHeight: 1.65 }}>
        💡 <b>รูปตรงนี้ = “แผนที่” ให้เห็น{subject === 'part' ? 'ทั้งชิ้นงาน' : 'ทั้งเครื่อง'}แล้วปักหมุด</b> — ส่วนรูปโคลสอัพของแต่ละจุด
        ให้แนบที่ช่อง <b>📷 รูปจุด</b> ในการ์ดจุดตรวจ (หมุดจะขึ้น 🔍 · คนตรวจแตะหมุดแล้วซูมเข้าไปดูจุดนั้นได้)
        {subject !== 'part' && <div style={{ marginTop: 3, opacity: 0.85 }}>อัปรูปโคลสอัพเป็นเฟรมแยกตรงนี้ = คนตรวจไม่รู้ว่าอยู่ตรงไหนของเครื่อง</div>}
        {/* 📐 บอกตรงจุดอัป (user 23/09) — คนอัปคือคนเดียวที่แก้เรื่องนี้ได้ ตอนถ่ายเท่านั้น
            ตัวจำกัดขนาดรูปบนมือถือคือ "ความสูง" ⇒ แนวนอน 4:3/16:9 เต็มความกว้างพอดี */}
        <div style={{ marginTop: 3, opacity: 0.85 }}>📐 {subject === 'part' ? 'จัดแผ่น/ถ่ายรูปชิ้นงาน' : 'ถ่าย/จัดกรอบ'}เป็น <b>แนวนอน</b> รูปจะเต็มความกว้างจอมือถือตอนตรวจ — แนวตั้งจะเหลือขอบว่างข้างละครึ่งจอ</div>
      </div>}
    </div>
  )
}
