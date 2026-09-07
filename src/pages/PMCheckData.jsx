import { useState, useEffect, useRef, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, supabaseDR } from '../supabaseClient'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { getSpcStatus, STATUS_COLOR } from '../lib/spc'
import { findChecklist, listChecklistsByDept } from '../lib/pmChecklists'
import { notifyDepartment, createNotification } from '../lib/pmNotify'
import { handleDailyPmSave } from '../lib/pmDailyAlarm'
import { exportInspectionExcel } from '../lib/pmExportExcel'
import { exportInspectionPDF, resolveSignatureDataUrl } from '../lib/pmExportPDF'
import { getDocForm } from '../utils/docForms'
import { fetchCategories, fetchCheckingMethods, categoryColor, indexByCode } from '../lib/pmTaxonomy'
import useImgBox from '../utils/useImgBox'
import CalloutPin from '../components/CalloutPin'
import { loadPmTeams, pmTeamsSync, teamKind, recordPermFor, isAmTeam } from '../utils/pmTeams'
import { MTN_TEAMS, deptNameOf, teamKeyOf, teamForEquipmentKind } from '../utils/mtnTeams'
import { checkWrite } from '../utils/dbWrite';

const DEPT_COLORS = {
  maintenance: '#fb923c', jig_maintenance: '#34d399', die_maintenance: '#4d9fff',
  production: '#3dd65c', qa: '#9b8de8',
}

function getPublicUrl(path) {
  if (!path) return null
  return supabaseDR.storage.from('jig-images').getPublicUrl(path).data.publicUrl
}
function fmt(v, digits = 3) {
  if (v === null || v === undefined || v === '') return '—'
  return Number(v).toFixed(digits).replace(/\.?0+$/, '')
}
function formatDate(iso) {
  return new Date(iso).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function computeAvg(v1, v2, v3) {
  if (v1 === '' || v2 === '' || v3 === '' || v1 == null || v2 == null || v3 == null) return null
  const a = Number(v1), b = Number(v2), c = Number(v3)
  if (isNaN(a) || isNaN(b) || isNaN(c)) return null
  return (a + b + c) / 3
}

const S = {
  /* ⚠️ ห้ามใส่ `overflow` ให้ `main`/`body` (2026-09-02 · user ทัก "ยิ่งหัวข้อเยอะ ข้อหลังๆ มองไม่เห็นรูป")
     หน้านี้ถูก embed ใน `PmHub` ซึ่งไม่ได้กำหนดความสูง → `height:100%` ตกเป็น `auto`
     ⇒ `main{overflow:hidden}` + `body{overflowY:auto}` กลายเป็น **scroll container ที่ไม่มีวันเลื่อน**
       (เนื้อหาสูงเท่าไหร่กล่องก็สูงตาม) แต่มันยัง "ขัง" `position:sticky` ของรูปเครื่องไว้ข้างใน
       → เอกสารเลื่อน รูปเลื่อนตามหายไป **sticky ไม่เคยทำงานเลยสักครั้ง**
     ตอนนี้ปล่อยให้ document เป็นตัวเลื่อน → sticky เกาะ viewport จริง
     (flex child ล้นแนวนอนใช้ `minWidth:0` แก้ ไม่ใช่ `overflow:hidden` ซึ่งเป็นตัวขัง sticky) */
  page: { display: 'flex', minHeight: '100%', background: 'var(--bg)' },
  sidebar: { width: 280, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarHead: { padding: '16px 16px 10px' },
  deptBar: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 16px 12px' },
  deptBtn: (active, color) => ({
    padding: '5px 10px', borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`,
    background: active ? `${color}18` : 'var(--bg3)', color: active ? color : 'var(--muted)',
  }),
  jigList: { flex: 1, overflowY: 'auto', padding: '0 10px 10px' },
  jigItem: (active, color) => ({
    padding: '10px 12px', borderRadius: 8, marginBottom: 6, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border)'}`,
    background: active ? `${color}12` : 'var(--card)',
  }),
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  header: { padding: '14px 52px 14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 },
  tabBar: { display: 'flex', gap: 4, padding: 4, borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)' },
  tabBtn: (active) => ({
    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
    background: active ? 'var(--card)' : 'transparent', color: active ? 'var(--text)' : 'var(--muted)',
  }),
  body: { flex: 1, minWidth: 0, padding: 20 },
  cpRow: (status) => ({
    display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${status ? STATUS_COLOR[status].border : 'var(--border)'}`,
    background: status ? STATUS_COLOR[status].bg : 'var(--card)', marginBottom: 8,
  }),
  input: { width: 70, textAlign: 'center', fontFamily: 'monospace' },
  saveBtn: {
    width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 700,
    background: 'var(--accent)', color: '#071008', border: 'none', cursor: 'pointer', marginTop: 12,
  },
}

// ค่าวัดเครื่องจักร (type 'measure') — อ่านค่าเดียวเทียบเกณฑ์ lsl(ต่ำสุด)/usl(สูงสุด) → pass/fail
// คืน 'pass' | 'fail' | null (ยังไม่กรอก) — comparator derive จากช่องที่ตั้ง (lsl only=≥, usl only=≤, ทั้งคู่=ช่วง)
function measureStatus(val, cp) {
  if (val === '' || val == null) return null
  const v = Number(val); if (isNaN(v)) return null
  if (cp.lsl != null && v < cp.lsl) return 'fail'
  if (cp.usl != null && v > cp.usl) return 'fail'
  return 'pass'
}
function measureStdText(cp) {
  const lo = cp.lsl != null, hi = cp.usl != null
  if (lo && hi) return `${fmt(cp.lsl)}–${fmt(cp.usl)}${cp.unit ? ' ' + cp.unit : ''}`
  if (lo) return `≥ ${fmt(cp.lsl)}${cp.unit ? ' ' + cp.unit : ''}`
  if (hi) return `≤ ${fmt(cp.usl)}${cp.unit ? ' ' + cp.unit : ''}`
  return '—'
}

// สีหมุด = สถานะการตรวจ (dynamic) — เขียวผ่าน / แดง NG / เหลืองเฝ้าระวัง / ยังไม่ตรวจ = สีหมวด
const PIN_STATUS_COLOR = { ok: '#3dd65c', ng: '#e05c4a', warning: '#f59a3f' }
function cpCheckStatus(cp, r) {
  if (!r) return null
  if (cp.type === 'variable') {
    if (r.v1 === '' || r.v2 === '' || r.v3 === '' || r.v1 == null || r.v2 == null || r.v3 == null) return null
    const s = getSpcStatus(computeAvg(r.v1, r.v2, r.v3), cp)
    return s === 'fail' ? 'ng' : s === 'warning' ? 'warning' : 'ok'
  }
  if (cp.type === 'measure') {
    const s = measureStatus(r.mval, cp)
    return s === 'fail' ? 'ng' : s === 'pass' ? 'ok' : null
  }
  return r.attr === 'ok' ? 'ok' : r.attr === 'ng' ? 'ng' : null
}

// รูป JIG (รองรับ 360° spin หลายเฟรม) + pin จุดตรวจที่ sync กับ checklist:
//   • ลากซ้าย/ขวา (หรือกดจุดใต้ภาพ) เพื่อหมุนดูรอบเครื่อง — pin โชว์เฉพาะเฟรมที่วางไว้ (image_id)
//   • สีหมุด = สถานะตรวจจริง (OK/NG) · คลิกหมุด → เลื่อน+ไฮไลต์แถวเช็คของจุดนั้น (activeCpId)
// pin สเกล/clamp อิง "กล่องรูปจริง" หัก letterbox (docs/UI-CONVENTIONS.md §5.1)
function JigSpinCheck({ frames, checkpoints, results, activeCpId, onPinClick, maxH = 300, compact = false }) {
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoomCp, setZoomCp] = useState(null)   // จุดที่กำลังเปิดรูปซูม (มี image_path)
  // เปลี่ยนอุปกรณ์ = รีเซ็ตทุกอย่าง รวมรูปซูมที่ค้างอยู่ (ไม่งั้นค้างรูปของเครื่องก่อนหน้า)
  useEffect(() => { setFrameIdx(0); setPlaying(false); setZoomCp(null) }, [frames])
  const boxRef = useRef(null)
  const drag = useRef(null) // { startX, startIdx, moved }
  const spin = frames.length >= 2
  const cur = frames[frameIdx] || frames[0] || null

  // auto-play หมุนวนอัตโนมัติ (Task A) — หยุดเมื่อผู้ใช้ลากเอง / เลือกจุด
  useEffect(() => {
    if (!playing || !spin) return
    const t = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), 650)
    return () => clearInterval(t)
  }, [playing, spin, frames.length])
  const { imgRef, imgBox, recalc } = useImgBox([cur?.url])
  useEffect(() => { frames.forEach(f => { if (f.url) { const im = new Image(); im.src = f.url } }) }, [frames])

  const firstId0 = frames[0]?.id
  // เลือกจุดจาก checklist → ถ้าเป็น spin ให้หมุนไปเฟรมที่จุดนั้นถูกวางไว้อัตโนมัติ
  useEffect(() => {
    if (!activeCpId) return
    const c = checkpoints.find(x => x.id === activeCpId)
    if (!c || c.x_pos == null) return
    const idx = frames.findIndex(f => f.id === (c.image_id ?? firstId0))
    if (idx >= 0) setFrameIdx(idx)
  }, [activeCpId]) // eslint-disable-line react-hooks/exhaustive-deps

  // สูตร balloon ต้องเท่ากับ PMSetup/SpinAnnotator เป๊ะ (docs §5.1 — WYSIWYG จอวางกับจอตรวจ)
  const PK = Math.round(Math.max(20, Math.min(36, (imgBox?.rw || 500) * 0.04)))
  const pkFont = Math.max(11, Math.round(PK * 0.42))
  const padX = imgBox ? (PK * 0.7 / imgBox.rw) * 100 : 0
  const padTop = imgBox ? ((PK + 4) / imgBox.rh) * 100 : 0
  const clampPct = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const cpIndex = {}; checkpoints.forEach((c, i) => { cpIndex[c.id] = i })
  const firstId = frames[0]?.id
  // pin ของเฟรมปัจจุบัน (image_id ว่าง = ผูกเฟรมแรก ตาม backfill)
  const framePins = checkpoints.filter(c => c.x_pos != null && c.y_pos != null && ((c.image_id ?? firstId) === cur?.id))

  const pointerDown = (e) => {
    if (!spin) return
    setPlaying(false) // ผู้ใช้ลากเอง → หยุด auto-play
    drag.current = { startX: e.clientX, startIdx: frameIdx, moved: false }
    const move = (ev) => {
      if (!drag.current) return
      const dx = ev.clientX - drag.current.startX
      if (Math.abs(dx) > 3) drag.current.moved = true
      const w = boxRef.current?.clientWidth || 300
      const step = Math.round((dx / w) * frames.length)
      let idx = (drag.current.startIdx - step) % frames.length
      if (idx < 0) idx += frames.length
      setFrameIdx(idx)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setTimeout(() => { drag.current = null }, 0) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  return (
    <div style={{ marginBottom: compact ? 0 : 16 }}>
      {/* container หุ้มรูปพอดี (fit-content) กึ่งกลาง — รูปแนวตั้ง (ถ่ายจากมือถือ) ไม่มีแถบเทาข้างเสียพื้นที่
         รูปสูงได้ถึง min(maxH, 76vh) เพื่อใช้พื้นที่แนวตั้งเต็ม โดยเฉพาะมือถือ (2026-07-24)
         ⚠️ `compact` = โหมดแถบติดบนจอแคบ — รูปเตี้ยลงและตัดบรรทัดอธิบายออก เพื่อไม่ให้กินจอ
            เกินครึ่ง (ที่เหลือต้องเป็นของรายการตรวจ) · คำอธิบายเดิมยังอยู่ครบในโหมดปกติ */}
      <div ref={boxRef} onPointerDown={pointerDown}
        style={{ position: 'relative', userSelect: 'none', touchAction: 'none', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', cursor: spin ? 'grab' : 'default', width: 'fit-content', maxWidth: '100%', margin: '0 auto', background: 'var(--bg2)' }}>
        <img ref={imgRef} src={cur?.url} alt="" draggable={false} onLoad={recalc} style={{ display: 'block', maxWidth: '100%', maxHeight: `min(${maxH}px, 76vh)`, objectFit: 'contain', background: 'var(--bg2)' }} />
        {/* layer = กล่องรูปจริง (หัก letterbox) — pin ใช้ % ของ layer นี้ */}
        {imgBox && (
          <div style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
            {framePins.map(c => {
              const st = cpCheckStatus(c, results[c.id])
              const col = st ? PIN_STATUS_COLOR[st] : categoryColor(c.category)
              const active = c.id === activeCpId
              return (
                <CalloutPin key={c.id} xPct={c.x_pos * 100} yPct={c.y_pos * 100} layerW={imgBox.rw} layerH={imgBox.rh} size={PK}
                  label={cpIndex[c.id] + 1} color={col} selected={active}
                  badge={c.image_path ? '🔍' : null}
                  title={`${cpIndex[c.id] + 1}. ${c.name}${st ? ` — ${st.toUpperCase()}` : ''}${c.image_path ? ' · แตะเพื่อดูรูปซูมจุดนี้' : ''}`}
                  onClick={e => {
                    e.stopPropagation()
                    onPinClick?.(c.id)
                    // 🔍 มีรูปเจาะจุด → เปิดซูมทันที (ตอบ feedback: รูปมุมแคบต้องรู้ว่าอยู่ตรงไหนของเครื่อง
                    //    → ภาพรวมเป็นแผนที่ · แตะหมุด = ซูมเข้าไปดูจุดนั้นชัดๆ)
                    if (c.image_path) setZoomCp(c)
                  }} />
              )
            })}
          </div>
        )}
        {spin && (
          <>
            <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 12, padding: '2px 9px', pointerEvents: 'none' }}>🔄 {frameIdx + 1}/{frames.length}</div>
            <button onClick={e => { e.stopPropagation(); setPlaying(p => !p) }} title={playing ? 'หยุดหมุน' : 'หมุนอัตโนมัติ'}
              style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 999, padding: '3px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {playing ? '⏸ หยุด' : '▶ หมุนเอง'}
            </button>
            <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, fontWeight: 600, borderRadius: 12, padding: '3px 12px', pointerEvents: 'none' }}>🔄 ลากซ้าย/ขวาเพื่อหมุนดูรอบเครื่อง</div>
          </>
        )}
      </div>
      {spin && (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginTop: compact ? 5 : 8, flexWrap: 'wrap' }}>
          {frames.map((f, i) => (
            <button key={f.id} onClick={() => setFrameIdx(i)} title={`เฟรม ${i + 1}`}
              style={{ width: 10, height: 10, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0, background: i === frameIdx ? 'var(--accent)' : 'var(--border2)' }} />
          ))}
        </div>
      )}
      {/* บอกให้รู้ว่าหมุดที่มี 🔍 กดดูรูปซูมได้ — ไม่งั้นไม่มีใครรู้ว่ากดได้ */}
      {!compact && framePins.some(c => c.image_path) && (
        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 6 }}>
          🔍 หมุดที่มีสัญลักษณ์แว่นขยาย = แตะเพื่อดูรูปซูมของจุดนั้น
        </div>
      )}
      {zoomCp && <CpZoom cp={zoomCp} idx={cpIndex[zoomCp.id]} onClose={() => setZoomCp(null)} />}
    </div>
  )
}

/* 🔍 รูปซูมของจุดตรวจ — เปิดในแอป (ไม่เด้งออกแท็บใหม่แบบเดิม เพราะหน้างานใช้มือถือ)
   ภาพรวม = แผนที่ว่าจุดอยู่ตรงไหน · ตัวนี้ = ซูมเข้าไปดูว่าต้องดูอะไรตรงนั้น */
function CpZoom({ cp, idx, onClose }) {
  const url = getPublicUrl(cp.image_path)
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div onClick={onClose} className="modal-scroll"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 3000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 12, gap: 10 }}>
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', maxWidth: '100%' }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: categoryColor(cp.category), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{(idx ?? 0) + 1}</span>
        <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cp.name}</span>
      </div>
      <img src={url} alt={cp.name} onClick={e => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '74vh', objectFit: 'contain', borderRadius: 10, border: '2px solid rgba(255,255,255,0.25)' }} />
      {cp.description && (
        <div onClick={e => e.stopPropagation()} style={{ color: '#e5e7eb', fontSize: 12.5, maxWidth: 'min(560px, 94vw)', textAlign: 'center', lineHeight: 1.6 }}>{cp.description}</div>
      )}
      <button onClick={onClose} style={{ padding: '9px 26px', borderRadius: 999, border: 'none', background: 'var(--accent)', color: '#071008', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>ปิด</button>
    </div>
  )
}

// รูปอ้างอิงต่อจุด (คอลัมน์ Picture ของฟอร์ม) — คลิกเปิดเต็มจอ
function CpImage({ cp }) {
  const [zoom, setZoom] = useState(false)
  if (!cp.image_path) return null
  const url = getPublicUrl(cp.image_path)
  return (
    <>
      {/* เปิดซูมในแอป — เดิม <a target="_blank"> ซึ่งบนมือถือ = เด้งออกจากใบตรวจที่กรอกค้างอยู่ */}
      <img src={url} alt="" title="แตะเพื่อดูรูปซูมของจุดนี้" onClick={() => setZoom(true)}
        style={{ height: 52, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', display: 'block', cursor: 'zoom-in' }} />
      {zoom && <CpZoom cp={cp} onClose={() => setZoom(false)} />}
    </>
  )
}

// ─── Variable Row ───────────────────────────────────────────────────────────
function VariableRow({ cp, idx, r, onChange, methodIndex }) {
  const avg = computeAvg(r.v1, r.v2, r.v3)
  const status = getSpcStatus(avg, cp)
  const c = status ? STATUS_COLOR[status] : null
  const method = methodIndex?.[cp.checking_method]
  return (
    <div style={S.cpRow(status)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {cp.x_pos != null && <span style={{ width: 18, height: 18, borderRadius: '50%', background: categoryColor(cp.category), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>}
        {method && <span title={method.label} style={{ fontSize: 13, flexShrink: 0 }}>{method.icon}</span>}
        <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}{cp.axis && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 4px' }}>{cp.axis}</span>}</p>
        <CpImage cp={cp} />
        {c && <span style={{ fontSize: 11, fontWeight: 700, color: c.text }}>{status === 'pass' ? '●' : status === 'warning' ? '⚠' : '✕'}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {['v1', 'v2', 'v3'].map((k, i) => (
          <div key={k}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginBottom: 2 }}>{['①', '②', '③'][i]}</div>
            <input type="number" value={r[k]} onChange={e => onChange({ ...r, [k]: e.target.value })} placeholder="—" style={S.input} />
          </div>
        ))}
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginBottom: 2 }}>Avg</div>
          <div style={{ ...S.input, padding: '6px 0', borderRadius: 6, border: `1px solid ${c?.border ?? 'var(--border)'}`, color: c?.text ?? 'var(--muted)', fontWeight: 700 }}>{avg != null ? fmt(avg) : '—'}</div>
        </div>
        {cp.unit && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cp.unit}</span>}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
          {cp.nominal != null && <>N:{fmt(cp.nominal)} </>}
          {cp.lsl != null && <span style={{ color: '#e05c4a' }}>L:{fmt(cp.lsl)} </span>}
          {cp.usl != null && <span style={{ color: '#e05c4a' }}>U:{fmt(cp.usl)}</span>}
        </span>
      </div>
    </div>
  )
}

// ─── Attribute / Note Row ────────────────────────────────────────────────────
function AttrRow({ cp, idx, value, note, onChangeAttr, onChangeNote, methodIndex }) {
  const method = methodIndex?.[cp.checking_method]
  return (
    <div style={S.cpRow(null)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {cp.x_pos != null && <span style={{ width: 18, height: 18, borderRadius: '50%', background: categoryColor(cp.category), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>}
        {method && <span title={method.label} style={{ fontSize: 13, flexShrink: 0 }}>{method.icon}</span>}
        <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}</p>
        <CpImage cp={cp} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['ok', 'ng'].map(v => (
            <button key={v} onClick={() => onChangeAttr(v === value ? '' : v)} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${value === v ? (v === 'ok' ? 'var(--accent)' : '#e05c4a') : 'var(--border)'}`,
              background: value === v ? (v === 'ok' ? 'var(--accent)' : '#e05c4a') : 'var(--bg3)',
              color: value === v ? '#fff' : 'var(--muted)',
            }}>{v.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {cp.description && (
        <p style={{ fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'pre-line', margin: '0 0 0 24px', lineHeight: 1.5 }}>
          📐 {cp.description}
        </p>
      )}
      {cp.type === 'note' && <input value={note} onChange={e => onChangeNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)..." />}
    </div>
  )
}

// ─── Measure Row (ค่าวัดเครื่องจักร — อ่านค่าเดียว auto OK/NG) ─────────────────
function MeasureRow({ cp, idx, r, onChange, methodIndex }) {
  const status = measureStatus(r.mval, cp) // 'pass'|'fail'|null
  const c = status ? STATUS_COLOR[status] : null
  const method = methodIndex?.[cp.checking_method]
  return (
    <div style={S.cpRow(status)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {cp.x_pos != null && <span style={{ width: 18, height: 18, borderRadius: '50%', background: categoryColor(cp.category), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>}
        {method && <span title={method.label} style={{ fontSize: 13, flexShrink: 0 }}>{method.icon}</span>}
        <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}</p>
        <CpImage cp={cp} />
        {c && <span style={{ fontSize: 11, fontWeight: 700, color: c.text }}>{status === 'pass' ? '● OK' : '✕ NG'}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="number" value={r.mval ?? ''} onChange={e => onChange({ ...r, mval: e.target.value })} placeholder="อ่านค่า"
          style={{ width: 110, textAlign: 'center', fontFamily: 'monospace', border: `1px solid ${c?.border ?? 'var(--border)'}` }} />
        {cp.unit && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cp.unit}</span>}
        <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto' }}>เกณฑ์: <b style={{ color: 'var(--text2)' }}>{measureStdText(cp)}</b></span>
      </div>
    </div>
  )
}

// ─── NG Recheck Panel ─────────────────────────────────────────────────────────
function NgRecheckPanel({ result, cp, onSaved }) {
  const [action, setAction] = useState(result.action_text ?? '')
  const [rv1, setRv1] = useState(result.recheck_value_1 ?? '')
  const [rv2, setRv2] = useState(result.recheck_value_2 ?? '')
  const [rv3, setRv3] = useState(result.recheck_value_3 ?? '')
  const [saving, setSaving] = useState(false)
  const done = result.recheck_at != null
  const recheckAvg = computeAvg(String(rv1), String(rv2), String(rv3))
  const finalStatus = recheckAvg != null ? (getSpcStatus(recheckAvg, cp) ?? 'pass') : null

  const submit = async () => {
    setSaving(true)
    try {
      const patch = { action_text: action.trim() || null, recheck_at: new Date().toISOString() }
      if (cp.type === 'variable' && rv1 !== '' && rv2 !== '' && rv3 !== '') {
        patch.recheck_value_1 = Number(rv1); patch.recheck_value_2 = Number(rv2); patch.recheck_value_3 = Number(rv3)
        patch.recheck_avg = recheckAvg; patch.final_status = finalStatus
      }
      const { error: wErr396 } = await supabaseDR.from('inspection_results').update(patch).eq('id', result.id);
      if (wErr396) throw wErr396;   // บันทึก recheck — supabase-js ไม่ throw ต้องโยนเองให้ catch เดิมเห็น
      onSaved()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  if (done) {
    return (
      <div style={{ marginTop: 6, borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', padding: '8px 12px' }}>
        <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>Action taken</p>
        {result.action_text && <p style={{ fontSize: 12, color: 'var(--text)', margin: '2px 0' }}>{result.action_text}</p>}
        {cp.type === 'variable' && result.recheck_avg != null && (
          <p style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'monospace', margin: 0 }}>
            Re-check: {fmt(result.recheck_value_1)} / {fmt(result.recheck_value_2)} / {fmt(result.recheck_value_3)} → Avg: <strong>{fmt(result.recheck_avg)}</strong>{' '}
            <span style={{ color: result.final_status === 'pass' ? 'var(--accent)' : '#e05c4a', fontWeight: 700 }}>{result.final_status?.toUpperCase()}</span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 6, borderRadius: 8, background: 'rgba(224,92,74,0.06)', border: '1px solid rgba(224,92,74,0.25)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{ fontSize: 11, color: '#e05c4a', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>NG — ต้องการ action</p>
      <textarea value={action} onChange={e => setAction(e.target.value)} rows={2} placeholder="อธิบายการแก้ไข..." />
      {cp.type === 'variable' && (
        <div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 4px' }}>วัดใหม่ 3 ครั้ง</p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[[rv1, setRv1, '①'], [rv2, setRv2, '②'], [rv3, setRv3, '③']].map(([v, set, label], i) => (
              <div key={i}><div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{label}</div>
                <input type="number" value={v} onChange={e => set(e.target.value)} placeholder="—" style={S.input} /></div>
            ))}
            <div><div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Avg</div>
              <div style={{ ...S.input, padding: '6px 0', color: finalStatus === 'pass' ? 'var(--accent)' : '#e05c4a', fontWeight: 700 }}>{recheckAvg != null ? fmt(recheckAvg) : '—'}</div></div>
          </div>
        </div>
      )}
      <button onClick={submit} disabled={saving || !action.trim()} style={{ padding: '6px 0', borderRadius: 6, fontSize: 12, fontWeight: 700, background: 'var(--accent)', color: '#071008', border: 'none', cursor: 'pointer', opacity: saving || !action.trim() ? 0.5 : 1 }}>
        {saving ? 'กำลังบันทึก...' : 'บันทึก Action'}
      </button>
    </div>
  )
}

// ─── History Detail Modal ─────────────────────────────────────────────────────
function HistoryModal({ inspection, checkpoints, jig, onClose, userId, userRole }) {
  const [results, setResults] = useState([])
  const [approving, setApproving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [insp, setInsp] = useState(inspection)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const fetchResults = () => supabaseDR.from('inspection_results').select('*').eq('inspection_id', inspection.id).then(({ data }) => setResults(data ?? []))
  useEffect(() => { fetchResults() }, [inspection.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cpMap = Object.fromEntries(checkpoints.map(c => [c.id, c]))
  const canApprove = can('pm', 'approve', userRole)

  const handleApprove = async () => {
    setApproving(true)
    const { data, error } = await supabaseDR.from('inspections').update({
      approval_status: 'approved', approved_by: userId, approved_at: new Date().toISOString(), reject_reason: null,
    }).eq('id', insp.id).select().single()
    if (!error && data) {
      setInsp(data)
      if (data.inspector_id !== userId) {
        createNotification(data.inspector_id, { title: 'ผลการตรวจได้รับการอนุมัติ', body: jig?.name ? `${jig.name} — ${formatDate(data.inspected_at)}` : undefined, type: 'success', refTable: 'inspections', refId: data.id }).catch(() => {})
      }
    }
    setApproving(false)
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    setApproving(true)
    const { data, error } = await supabaseDR.from('inspections').update({
      approval_status: 'rejected', approved_by: userId, approved_at: new Date().toISOString(), reject_reason: rejectReason.trim(),
    }).eq('id', insp.id).select().single()
    if (!error && data) {
      setInsp(data); setRejecting(false); setRejectReason('')
      if (data.inspector_id !== userId) {
        createNotification(data.inspector_id, { title: 'ผลการตรวจถูกตีกลับ', body: rejectReason.trim(), type: 'error', refTable: 'inspections', refId: data.id }).catch(() => {})
      }
    }
    setApproving(false)
  }

  const buildExportArgs = async (currentUserEmail) => {
    const resultMap = Object.fromEntries(results.map(r => [r.checkpoint_id, r]))
    const userIds = [insp.inspector_id, insp.approved_by, userId].filter(Boolean)
    /* 🔴 ห้าม select `email` — `profiles` ไม่มีคอลัมน์นี้ (มีแต่ notify_email ที่ไม่เคยถูกใช้ส่งอะไร)
       เดิม select('id, email, signature_url') = 42703 ทั้งคิวรี → profMap ว่าง
       → **ลายเซ็นผู้ตรวจ/ผู้อนุมัติหายจากใบพิมพ์ PM ทุกใบ** และชื่อกลายเป็น "Inspector"/"Approver"
       โดยไม่มี error เพราะรับแค่ `{ data }` (supabase-js คืน {data,error} ไม่ throw) — audit 2026-09-03
       คลาสเดียวกับ fn_audit ที่อ่าน coalesce(full_name, email) แล้วไม่บันทึกผู้แก้ทั้งระบบ */
    const { data: profs, error: profErr } = await supabase
      .from('profiles').select('id, full_name, signature_url').in('id', userIds)
    if (profErr) { console.warn('[buildExportArgs] profiles', profErr.message); toast.error('โหลดชื่อ/ลายเซ็นผู้ตรวจไม่สำเร็จ — ใบที่พิมพ์จะไม่มีลายเซ็น') }
    const profMap = Object.fromEntries((profs ?? []).map(p => [p.id, p]))
    const sigCache = {}
    const getSig = async (uid) => {
      if (!uid) return null
      if (sigCache[uid] !== undefined) return sigCache[uid]
      const url = profMap[uid]?.signature_url
      sigCache[uid] = url ? await resolveSignatureDataUrl(url) : null
      return sigCache[uid]
    }
    const inspector = { email: profMap[insp.inspector_id]?.full_name ?? 'Inspector', signature_data: await getSig(insp.inspector_id) }
    const approver = insp.approved_by ? { email: profMap[insp.approved_by]?.full_name ?? 'Approver', signature_data: await getSig(insp.approved_by) } : null
    const exporter = { email: currentUserEmail ?? 'Exporter', signature_data: await getSig(userId) }
    const categories = await fetchCategories({ includeInactive: true })
    // เลขฟอร์ม/Rev/Effective อ่านจาก Document Master กลาง (doc_control แก้ได้ที่ /doc-forms) · fallback ค่าเดิม
    const docForm = await getDocForm('pm_jig', { form_code: 'FM-JIG-003', rev: 'Rev.00', effective_date: '01/07/2020' })
    checkWrite(await supabaseDR.from('inspections').update({ exported_by: userId, exported_at: new Date().toISOString() }).eq('id', insp.id), 'บันทึกว่า export แล้ว');
    return { jig, inspection: insp, checkpoints, results: resultMap, inspector, approver, exporter, categories, docForm }
  }

  const handleExport = async (kind) => {
    setExporting(kind)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const args = await buildExportArgs(user?.email)
      if (kind === 'pdf') await exportInspectionPDF(args)
      else await exportInspectionExcel(args)
    } catch (err) { toast.error(err.message) }
    finally { setExporting(false) }
  }

  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* ตั้งใจไม่ปิดเมื่อคลิกพื้นหลัง — ข้างในมีฟอร์ม NG action/re-check กันเผลอกดแล้วหาย */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 700, color: 'var(--text)', margin: 0, fontSize: 14 }}>{formatDate(insp.inspected_at)}</p>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: insp.status === 'pass' ? 'var(--accent-dim)' : insp.status === 'fail' ? 'rgba(224,92,74,0.12)' : 'var(--bg3)', color: insp.status === 'pass' ? 'var(--accent)' : insp.status === 'fail' ? '#e05c4a' : 'var(--muted)' }}>{insp.status?.toUpperCase()}</span>
              {insp.approval_status === 'approved' && <span style={{ fontSize: 11, color: 'var(--accent)', border: '1px solid var(--accent)', padding: '2px 6px', borderRadius: 10 }}>✓ อนุมัติแล้ว</span>}
              {insp.approval_status === 'rejected' && <span style={{ fontSize: 11, color: '#e05c4a', border: '1px solid #e05c4a', padding: '2px 6px', borderRadius: 10 }}>✕ ตีกลับ</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map(r => {
            const cp = cpMap[r.checkpoint_id]
            if (!cp) return null
            const isNG = (cp.type === 'variable' || cp.type === 'measure') ? r.status === 'fail' : r.value_attribute === 'ng'
            const c = r.status ? STATUS_COLOR[r.status] : null
            return (
              <div key={r.id}>
                <div style={{ borderRadius: 8, border: `1px solid ${c?.border ?? 'var(--border)'}`, background: c?.bg ?? 'var(--card)', padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <p style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, margin: 0 }}>{cp.name}{cp.axis && <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 3px' }}>{cp.axis}</span>}</p>
                      {cp.type === 'variable' ? (
                        <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', margin: '2px 0 0' }}>
                          {fmt(r.value_1)} / {fmt(r.value_2)} / {fmt(r.value_3)}
                          {r.avg_value != null && <span style={{ color: 'var(--text2)' }}> → Avg: <strong>{fmt(r.avg_value)}</strong></span>}
                          {cp.unit && <span style={{ marginLeft: 4 }}>{cp.unit}</span>}
                        </p>
                      ) : cp.type === 'measure' ? (
                        <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', margin: '2px 0 0' }}>
                          อ่านค่า: <strong style={{ color: 'var(--text2)' }}>{fmt(r.value_1)}</strong>{cp.unit ? ` ${cp.unit}` : ''}
                          <span style={{ marginLeft: 6 }}>เกณฑ์ {measureStdText(cp)}</span>
                        </p>
                      ) : (
                        <>
                          {cp.description && <p style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-line', margin: '2px 0 0' }}>{cp.description}</p>}
                          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>{r.value_attribute?.toUpperCase()}</p>
                        </>
                      )}
                    </div>
                    {c && <span style={{ fontSize: 11, fontWeight: 700, color: c.text }}>{c.label}</span>}
                  </div>
                  {r.evidence_path && (
                    <a href={getPublicUrl(r.evidence_path)} target="_blank" rel="noreferrer" title="รูปหลักฐาน (สภาพจริงตอนพบผิดปกติ)" style={{ display: 'inline-block', marginTop: 6 }}>
                      <img src={getPublicUrl(r.evidence_path)} alt="" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 6, border: '1px solid rgba(224,92,74,0.4)', display: 'block' }} />
                      <span style={{ fontSize: 10.5, color: '#e05c4a', fontWeight: 700 }}>📎 หลักฐานสภาพจริง</span>
                    </a>
                  )}
                </div>
                {isNG && <NgRecheckPanel result={r} cp={cp} onSaved={fetchResults} />}
              </div>
            )
          })}
          {insp.notes && <div style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', padding: 10 }}><p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>หมายเหตุ</p><p style={{ fontSize: 13, color: 'var(--text)', margin: '2px 0 0' }}>{insp.notes}</p></div>}
          {insp.approval_status === 'rejected' && insp.reject_reason && <div style={{ borderRadius: 8, border: '1px solid rgba(224,92,74,0.3)', background: 'rgba(224,92,74,0.06)', padding: 10 }}><p style={{ fontSize: 11, color: '#e05c4a', margin: 0 }}>เหตุผลที่ตีกลับ</p><p style={{ fontSize: 13, color: 'var(--text)', margin: '2px 0 0' }}>{insp.reject_reason}</p></div>}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {canApprove && insp.approval_status === 'pending' && !rejecting && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleApprove} disabled={approving} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{approving ? 'กำลังอนุมัติ...' : 'อนุมัติ'}</button>
              <button onClick={() => setRejecting(true)} disabled={approving} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #e05c4a', background: 'rgba(224,92,74,0.08)', color: '#e05c4a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ตีกลับ</button>
            </div>
          )}
          {rejecting && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} placeholder="ระบุเหตุผลที่ตีกลับ..." />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setRejecting(false); setRejectReason('') }} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>ยกเลิก</button>
                <button onClick={handleReject} disabled={approving || !rejectReason.trim()} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: '1px solid #e05c4a', background: 'rgba(224,92,74,0.08)', color: '#e05c4a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{approving ? 'กำลังบันทึก...' : 'ยืนยันตีกลับ'}</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleExport('pdf')} disabled={!!exporting} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: '1px solid rgba(224,92,74,0.4)', background: 'rgba(224,92,74,0.1)', color: '#e05c4a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{exporting === 'pdf' ? 'กำลัง export...' : '⬇ PDF'}</button>
            <button onClick={() => handleExport('excel')} disabled={!!exporting} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#071008', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{exporting === 'excel' ? 'กำลัง export...' : '⬇ Excel'}</button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ─── PMCheckData (main) ───────────────────────────────────────────────────────
export default function PMCheckData() {
  const [searchParams, setSearchParams] = useSearchParams()
  const department = searchParams.get('dept') || 'maintenance'
  const equipParam = searchParams.get('equip')

  const [userId, setUserId] = useState(null)
  const [userRole, setUserRole] = useState(null)
  const [fullName, setFullName] = useState('')
  /* 🔧 เจอ NG → เปิดใบแจ้งซ่อม MO ต่อได้เลย (2026-09-02 · feedback หน้างาน)
     ⚠️ **ระบบเสนอ คนกดยืนยัน** ห้ามเปิดใบให้อัตโนมัติ (กฎเดิมทั้งโปรเจค) —
        ใบซ่อมเป็นงานที่มีคนต้องรับผิดชอบจริง ไม่ใช่ผลข้างเคียงของการกดบันทึก */
  const [moPrompt, setMoPrompt] = useState(null)   // { insp, ngTopics } หลังบันทึกเจอ NG
  const [moTeam, setMoTeam] = useState('maintenance')
  const [moSaving, setMoSaving] = useState(false)
  const [moByInsp, setMoByInsp] = useState({})     // inspection_id → { id, mo_no } (กันเปิดซ้ำ + โชว์ในประวัติ)
  // สิทธิ์บันทึกแยกแกน AM (พนักงานหน้างาน) / PM (ช่าง) ตามชนิดงานของทีมที่เปิดอยู่
  //   ห้าม hardcode 'pm' — ทีมไหนเป็น AM อ่านจาก mtn_teams.kind (ดู utils/pmTeams.js)
  const canRecord = useMemo(() => { const [res, act] = recordPermFor(department); return can(res, act, userRole) }, [department, userRole])
  const [jigs, setJigs] = useState([])
  const [selectedJig, setSelectedJig] = useState(null)
  const [checklistId, setChecklistId] = useState(null)
  const [checkpoints, setCheckpoints] = useState([])
  const [otherDepts, setOtherDepts] = useState([])   // แผนกอื่นที่ลงจุดตรวจของเครื่องนี้ไว้ (โชว์เมื่อแผนกปัจจุบันยังไม่มี)
  const [frames, setFrames] = useState([])          // jig_images (360° spin) ของอุปกรณ์ที่เลือก
  const [activeCpId, setActiveCpId] = useState(null) // จุดที่กำลังโฟกัส (sync รูป ↔ checklist)
  const rowRefs = useRef({})                          // แถวเช็คแต่ละจุด (เลื่อนหาเมื่อคลิกหมุด)
  /* 📌 รูปเครื่องเป็น "แถบติดบน" ตอนจอแคบ — พับเก็บได้ (จำต่อเครื่อง)
     ⚠️ ต้อง **วัดความสูงจริง** ไม่ใช่เดา เพราะเอาไปตั้ง `scrollMarginTop` ของแถวเช็ค
        (กฎ §6.8) — เดาแล้วตอนคลิกหมุด แถวจะถูกเลื่อนไปซ่อนใต้รูปพอดี */
  const [viewerOpen, setViewerOpen] = useState(() => {
    try { return localStorage.getItem('pm_viewer_open') !== '0' } catch { return true }
  })
  const toggleViewer = () => setViewerOpen(v => {
    try { localStorage.setItem('pm_viewer_open', v ? '0' : '1') } catch { /* private mode */ }
    return !v
  })
  const viewerRef = useRef(null)
  const [viewerH, setViewerH] = useState(0)
  // มือถือ/แท็บเล็ต: master-detail — โชว์ "ลิสต์อุปกรณ์" หรือ "ฟอร์มเช็ค" ทีละอัน (ไม่อัด 2 คอลัมน์)
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches)
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1180px)').matches)
  useEffect(() => {
    const mqN = window.matchMedia('(max-width: 860px)'), mqW = window.matchMedia('(min-width: 1180px)')
    const on = () => { setIsNarrow(mqN.matches); setIsWide(mqW.matches) }
    mqN.addEventListener('change', on); mqW.addEventListener('change', on)
    return () => { mqN.removeEventListener('change', on); mqW.removeEventListener('change', on) }
  }, [])
  const [tab, setTab] = useState('record')
  const [results, setResults] = useState({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [inspections, setInspections] = useState([])
  const [viewInspection, setViewInspection] = useState(null)
  const [methodIndex, setMethodIndex] = useState({})
  const [teams, setTeams] = useState(pmTeamsSync())      // ทีมช่าง data-driven (mtn_teams)
  const [clDeptByJig, setClDeptByJig] = useState({})     // jig_id → Set(department) — ยึด department เป็นหลัก

  useEffect(() => { loadPmTeams().then(setTeams) }, [])
  // แผนกของแต่ละ jig จาก checklist ที่มีอยู่ (ยึด department เป็นหลักตามที่ user ยืนยัน)
  useEffect(() => {
    supabaseDR.from('checklists').select('equipment_id, department').eq('module', 'mtn').then(({ data }) => {
      const m = {}; (data ?? []).forEach(c => { (m[c.equipment_id] ||= new Set()).add(c.department) }); setClDeptByJig(m)
    })
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id ?? null)
      if (data?.user?.id) supabase.from('profiles').select('role, full_name').eq('id', data.user.id).single()
        .then(({ data: p }) => { setUserRole(p?.role ?? null); setFullName(p?.full_name ?? '') })
    })
  }, [])

  useEffect(() => {
    supabaseDR.from('jigs').select('*').eq('module', 'mtn').order('name').then(({ data }) => setJigs(data ?? []))
    fetchCategories() // primes the category color cache used by categoryColor()
    fetchCheckingMethods().then(rows => setMethodIndex(indexByCode(rows)))
  }, [])

  // ── โหมดฝ่ายผลิต: รายการเครื่องซ้ายมือต้องเป็น "เครื่องที่ลงทะเบียน Daily PM" เท่านั้น ──
  // จัดกลุ่มตามไลน์ + สถานะว่ากะนี้ตรวจแล้วหรือยัง — ไม่ใช่เครื่องทุกตัวทุกแผนกแบบแท็บซ่อมบำรุง
  const [dailyLineByJig, setDailyLineByJig] = useState(null)   // jig_id -> [line_name] (null = แท็บอื่น)
  const [checkedThisShift, setCheckedThisShift] = useState({}) // jig_id -> 'pass' | 'fail'
  useEffect(() => {
    if (department !== 'production') { setDailyLineByJig(null); setCheckedThisShift({}); return }
    let cancelled = false
    ;(async () => {
      const [{ data: tg }, { data: prodCls }] = await Promise.all([
        supabaseDR.from('pm_daily_line_targets').select('jig_id, line_name').eq('is_active', true),
        supabaseDR.from('checklists').select('id').eq('module', 'mtn').eq('department', 'production'),
      ])
      // จุดเริ่มกะปัจจุบัน (เช้า 08:00 / ดึก 20:00, ก่อน 08:00 = กะดึกของวันก่อน)
      const now = new Date()
      const isDay = now.getHours() >= 8 && now.getHours() < 20
      const ws = new Date(now)
      if (now.getHours() < 8) ws.setDate(ws.getDate() - 1)
      ws.setHours(isDay ? 8 : 20, 0, 0, 0)
      const clIds = new Set((prodCls ?? []).map(c => c.id))
      const { data: insp } = await supabaseDR.from('inspections')
        .select('jig_id, status, checklist_id')
        .gte('inspected_at', ws.toISOString())
        .order('inspected_at', { ascending: false })
      if (cancelled) return
      const st = {}
      for (const i of insp ?? []) {
        if (!clIds.has(i.checklist_id)) continue
        if (!st[i.jig_id]) st[i.jig_id] = i.status // ล่าสุดชนะ (เรียง desc แล้ว)
      }
      const byJig = {}
      ;(tg ?? []).forEach(t => { (byJig[t.jig_id] ||= []).push(t.line_name) })
      setDailyLineByJig(byJig)
      setCheckedThisShift(st)
    })()
    return () => { cancelled = true }
  }, [department])

  useEffect(() => {
    if (!equipParam || jigs.length === 0) { setSelectedJig(null); return }
    setSelectedJig(jigs.find(j => j.id === equipParam) ?? null)
  }, [equipParam, jigs])

  // คง line filter (?line=) ไว้ตอนเลือกเครื่อง — มาจากปุ่ม "ไปหน้าตรวจ" ของ Daily PM รายไลน์
  const lineFilter = searchParams.get('line')
  const selectJig = (jig) => setSearchParams({ dept: department, equip: jig.id, ...(lineFilter ? { line: lineFilter } : {}) })
  const clearJig = () => setSearchParams({ dept: department, ...(lineFilter ? { line: lineFilter } : {}) }) // กลับไปลิสต์ (จอแคบ)
  const setDept = (d) => setSearchParams({ dept: d, ...(equipParam ? { equip: equipParam } : {}) })

  const fetchHistory = async (jigId) => {
    const { data } = await supabaseDR.from('inspections').select('*').eq('jig_id', jigId).order('inspected_at', { ascending: false }).limit(30)
    setInspections(data ?? [])
    /* ผลตรวจ NG ใบไหนเปิดใบซ่อมไปแล้วบ้าง — กันเปิดซ้ำ + ให้กลับมาเปิดทีหลังได้ถ้าตอนนั้นกด "ไว้ก่อน"
       (ไม่งั้นเป็นทางตัน: ข้ามครั้งเดียวแล้วไม่มีทางเปิดจากผลตรวจใบนั้นอีกเลย)
       ⚠️ tolerant กับ 42703 — ยังไม่ apply migration ต้องใช้หน้านี้ได้ตามปกติ */
    const failIds = (data ?? []).filter(i => i.status === 'fail').map(i => i.id)
    if (!failIds.length) { setMoByInsp({}); return }
    const { data: mos, error } = await supabaseDR.from('mtn_orders')
      .select('id, mo_no, status, source_inspection_id').in('source_inspection_id', failIds)
    if (error) { setMoByInsp({}); return }
    const m = {}; (mos ?? []).forEach(o => { m[o.source_inspection_id] = o })
    setMoByInsp(m)
  }

  /* ทีมช่างตั้งต้นของใบซ่อมที่จะเปิด
     ⚠️ AM = ผลิตตรวจเอง — เจอ NG แล้ว **ส่งกลับให้ผลิตซ่อมเองไม่ได้** ต้องเดาทีมช่างจากชนิดอุปกรณ์
        (jig → JIG MTN · die → DIE MTN · อื่น → MTN) แล้วให้คนเลือกทับได้เสมอ */
  const defaultMoTeam = () => (isAmTeam(department)
    ? (teamForEquipmentKind(selectedJig?.equipment_type) || 'maintenance')
    : (teamKeyOf(department) || 'maintenance'))

  const openMoPrompt = (insp, ngTopics) => { setMoTeam(defaultMoTeam()); setMoPrompt({ insp, ngTopics }) }

  // เปิดจากแท็บประวัติ (เคสกด "ไว้ก่อน" ตอนบันทึก) — ต้องไปหาชื่อจุดที่ไม่ผ่านของใบนั้นมาก่อน
  const openMoFromHistory = async (insp) => {
    const { data } = await supabaseDR.from('inspection_results')
      .select('checkpoint_id').eq('inspection_id', insp.id).eq('status', 'fail')
    const names = (data ?? []).map(r => checkpoints.find(c => c.id === r.checkpoint_id)?.name).filter(Boolean)
    // จุดตรวจถูกลบ/ย้ายแผนกไปแล้ว = หาชื่อไม่เจอ — ยังเปิดใบได้ แต่ต้องบอกตรงๆ ว่าดูรายละเอียดที่ผลตรวจ
    openMoPrompt(insp, names.length ? names : ['(ดูรายละเอียดในผลตรวจ)'])
  }

  const createMoFromInspection = async () => {
    if (!moPrompt || !selectedJig) return
    const { insp, ngTopics } = moPrompt
    setMoSaving(true)
    try {
      const now = new Date()
      // วันงาน (ตัด 08:00 ตามกะ) — ห้าม toISOString (UTC เพี้ยนช่วงเช้ามืด)
      const wd = new Date(now); if (wd.getHours() < 8) wd.setDate(wd.getDate() - 1)
      const workDate = `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`
      const payload = {
        status: 'pending', current_step: 1, report_at: now.toISOString(), work_date: workDate,
        repair_scope: 'in_line',
        line_name: selectedJig.line_name || null,
        mtn_dept: teamKeyOf(moTeam) || 'maintenance',
        machine_no: selectedJig.machine_no || selectedJig.jig_no || null,
        problem_characteristic: 'อื่นๆ',
        report_note: `[จากผลตรวจ ${isAmTeam(department) ? 'AM' : 'PM'}] ${selectedJig.name} — จุดที่ไม่ผ่าน: ${ngTopics.join(', ')}`,
        reporter_prod: fullName || null, reported_by_name: fullName || null,
        source_inspection_id: insp.id,
      }
      let { data, error } = await supabaseDR.from('mtn_orders').insert(payload).select().single()
      // ยังไม่ apply migration = ไม่มีคอลัมน์ผูกที่มา → เปิดใบได้ แต่ต้องบอกว่าผูกกลับผลตรวจไม่ได้
      if (error?.code === '42703') {
        const { source_inspection_id: _drop, ...slim } = payload // eslint-disable-line no-unused-vars
        ;({ data, error } = await supabaseDR.from('mtn_orders').insert(slim).select().single())
        if (!error) toast.info('เปิดใบซ่อมแล้ว แต่ยังผูกกลับผลตรวจไม่ได้ — ยังไม่ได้รัน migration 20260902_mtn_order_from_inspection (แจ้ง admin)')
      }
      if (error) {
        toast.error(error.code === '23505' ? 'ผลตรวจใบนี้มีใบแจ้งซ่อมอยู่แล้ว' : error.message)
        return
      }
      fetch('https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-mtn-notification', {
        // ส่ง "ชื่อทีม" ในข้อความแจ้งเตือน (DB เก็บรหัส) — เหตุผลเดียวกับ notifyMtn ใน MtnRepair.jsx
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'mtn_reported', mo: { ...data, mtn_dept: deptNameOf(data.mtn_dept) } }),
      }).catch(() => {})
      setMoByInsp(prev => ({ ...prev, [insp.id]: data }))
      setMoPrompt(null)
      toast.success(`📝 เปิดใบแจ้งซ่อมแล้ว → แจ้งถึงทีม ${deptNameOf(moTeam) || 'MTN'} — ติดตามต่อที่หน้าแจ้งซ่อม MTN`)
    } finally {
      setMoSaving(false)
    }
  }

  useEffect(() => {
    if (!selectedJig || !userId) return
    setResults({}); setNotes(''); setTab('record'); setActiveCpId(null)
    // เฟรมรูป 360° (ถ้าไม่มี jig_images → ใช้รูปหลัก image_path เป็นเฟรมเดียว)
    supabaseDR.from('jig_images').select('id, image_path, sort').eq('jig_id', selectedJig.id).order('sort').then(({ data }) => {
      let fr = (data ?? []).map(im => ({ id: im.id, url: getPublicUrl(im.image_path) }))
      if (!fr.length && selectedJig.image_path) fr = [{ id: 'legacy', url: getPublicUrl(selectedJig.image_path) }]
      setFrames(fr)
    })
    // ⚠️ อ่านอย่างเดียว — แค่เปิดดูเครื่องต้องไม่สร้าง checklist ของแผนกที่กำลังดูอยู่
    //    (เดิมใช้ getOrCreateChecklist ตรงนี้ → เกิด checklist เปล่าค้างในแท็บแผนกนั้นตลอดไป)
    //    ไม่มี checklist = ไม่มีจุดตรวจ → handleSave กันไว้แล้ว (checkpoints.length === 0 = บันทึกไม่ได้)
    findChecklist(selectedJig.id, 'mtn', department).then(async (cl) => {
      setChecklistId(cl?.id ?? null)
      const { data } = cl
        ? await supabaseDR.from('jig_checkpoints').select('*').eq('checklist_id', cl.id).order('sort_order')
        : { data: [] }
      const cps = data ?? []
      setCheckpoints(cps)
      const init = {}
      cps.forEach(c => { init[c.id] = { v1: '', v2: '', v3: '', attr: '', note: '', mval: '' } })
      setResults(init)
      // ไม่มีจุดตรวจของแผนกนี้ → หาให้เลยว่าแผนกอื่นลงไว้ไหม จะได้ไม่ต้องไล่กดทีละแท็บ
      if (!cps.length) {
        listChecklistsByDept(selectedJig.id, 'mtn')
          .then(rows => setOtherDepts(rows.filter(r => r.department !== department && r.checkpointCount > 0)))
          .catch(() => setOtherDepts([]))
      } else setOtherDepts([])
    })
    fetchHistory(selectedJig.id)
  }, [selectedJig, department, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* วัดความสูงจริงของแถบรูปที่ติดบน (จอแคบ) — เอาไปเว้น `scrollMarginTop` ให้แถวเช็ค
     ไม่วัด/เดาเลข = คลิกหมุดแล้วแถวถูกเลื่อนไปนอนใต้รูปพอดี มองไม่เห็นสิ่งที่เพิ่งกด */
  useEffect(() => {
    const el = viewerRef.current
    if (!el || typeof ResizeObserver === 'undefined') { setViewerH(0); return }
    const ro = new ResizeObserver(() => setViewerH(el.getBoundingClientRect().height))
    ro.observe(el)
    setViewerH(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [selectedJig, checkpoints, frames, viewerOpen, isNarrow, isWide])

  // คลิกหมุดบนรูป → เลื่อนไปแถวเช็คของจุดนั้น
  useEffect(() => {
    if (activeCpId && rowRefs.current[activeCpId]) rowRefs.current[activeCpId].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeCpId])

  const computeOverall = () => {
    let hasFail = false, hasEmpty = false
    for (const cp of checkpoints) {
      const r = results[cp.id]
      if (!r) { hasEmpty = true; continue }
      if (cp.type === 'variable') {
        if (r.v1 === '' || r.v2 === '' || r.v3 === '') { hasEmpty = true; continue }
        if (getSpcStatus(computeAvg(r.v1, r.v2, r.v3), cp) === 'fail') hasFail = true
      } else if (cp.type === 'measure') {
        const s = measureStatus(r.mval, cp)
        if (s == null) { hasEmpty = true; continue }
        if (s === 'fail') hasFail = true
      } else {
        if (!r.attr) { hasEmpty = true; continue }
        if (r.attr === 'ng') hasFail = true
      }
    }
    if (hasFail) return 'fail'
    if (hasEmpty) return 'pending'
    return 'pass'
  }

  const handleSave = async () => {
    if (checkpoints.length === 0) return
    setSaving(true)
    try {
      const overall = computeOverall()
      const { data: insp, error: e1 } = await supabaseDR.from('inspections').insert({
        jig_id: selectedJig.id, checklist_id: checklistId, inspector_id: userId, status: overall, notes: notes.trim() || null,
      }).select().single()
      if (e1) throw e1

      const rows = checkpoints.map(cp => {
        const r = results[cp.id] ?? {}
        if (cp.type === 'variable') {
          const v1 = r.v1 !== '' ? Number(r.v1) : null
          const v2 = r.v2 !== '' ? Number(r.v2) : null
          const v3 = r.v3 !== '' ? Number(r.v3) : null
          const avg = computeAvg(r.v1, r.v2, r.v3)
          return { inspection_id: insp.id, checkpoint_id: cp.id, value_1: v1, value_2: v2, value_3: v3, avg_value: avg, value_numeric: avg, status: getSpcStatus(avg, cp) ?? (avg != null ? 'pass' : null) }
        }
        if (cp.type === 'measure') {
          const mv = r.mval !== '' && r.mval != null ? Number(r.mval) : null
          return { inspection_id: insp.id, checkpoint_id: cp.id, value_1: mv, value_numeric: mv, status: measureStatus(r.mval, cp) }
        }
        return { inspection_id: insp.id, checkpoint_id: cp.id, value_attribute: r.attr || null, status: r.attr === 'ng' ? 'fail' : r.attr === 'ok' ? 'pass' : null }
      })
      const { error: e2 } = await supabaseDR.from('inspection_results').insert(rows)
      if (e2) throw e2

      if (overall === 'fail') {
        notifyDepartment(department, { title: 'พบผลตรวจไม่ผ่าน (NG)', body: `${selectedJig.name} — ${formatDate(insp.inspected_at)}`, type: 'error', refTable: 'inspections', refId: insp.id }, userId).catch(() => {})
      }

      // ⭐ แผน PM "วิ่งตามผลตรวจ" (feedback ทีมงาน 2026-08-17): ตรวจครบทุกจุด (pass/fail) = ทำ PM จริงแล้ว
      //   → stamp pm_plans.last_done_at + เลื่อน next_due_date (แผนตามรอบเวลา) — เดิมมีแค่ปิดแผนประสานงาน
      //   ที่ stamp ให้ ทำให้ PM Forecast/ผังเครื่องจักร/Dashboard เห็นแผนค้างทั้งที่ตรวจไปแล้ว
      //   'pending' (ตรวจไม่ครบ) ไม่นับว่าทำ PM จบ — ไม่เลื่อนรอบ · best-effort ห้ามทำ save หลักพัง แต่ห้ามเงียบ
      if (overall !== 'pending' && checklistId) {
        try {
          const { data: plans, error: pErr } = await supabaseDR.from('pm_plans')
            .select('id, plan_type, interval_days, last_done_at').eq('checklist_id', checklistId).eq('is_active', true)
          if (pErr) throw pErr
          const now = new Date()
          const done = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` // local — ห้าม toISOString
          for (const pl of (plans || [])) {
            if (pl.last_done_at && String(pl.last_done_at).slice(0, 10) >= done) continue // วันนี้ stamp ไปแล้ว (ตรวจซ้ำ/AM รายกะ) — ไม่เขียนซ้ำ
            const patch = { last_done_at: done }
            // ตามรอบเวลา (time/hybrid) → เลื่อน next_due = วันทำ + interval_days · usage → forecast คำนวณเองจาก last_done_at
            if (pl.plan_type !== 'usage' && Number(pl.interval_days) > 0) {
              const d = new Date(done + 'T00:00:00'); d.setDate(d.getDate() + Number(pl.interval_days))
              patch.next_due_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            }
            const { error: uErr } = await supabaseDR.from('pm_plans').update(patch).eq('id', pl.id)
            if (uErr) throw uErr
          }
        } catch (e) {
          toast.error('บันทึกผลตรวจสำเร็จ แต่เลื่อนรอบแผน PM ไม่สำเร็จ: ' + (e?.message || e))
        }
      }

      // Daily PM line alarm (green when the line is complete & all pass, red on NG).
      const ngTopics = checkpoints.filter(cp => {
        const r = results[cp.id]
        if (!r) return false
        return cp.type === 'variable' ? getSpcStatus(computeAvg(r.v1, r.v2, r.v3), cp) === 'fail'
          : cp.type === 'measure' ? measureStatus(r.mval, cp) === 'fail' : r.attr === 'ng'
      }).map(cp => cp.name)
      handleDailyPmSave({ jig: selectedJig, department, overall, ngTopics }).catch(() => {})
      // อัปเดตป้าย "ตรวจแล้ว/รอตรวจ" ในรายการซ้ายทันที ไม่ต้องรอโหลดใหม่
      if (department === 'production') setCheckedThisShift(prev => ({ ...prev, [selectedJig.id]: overall }))

      toast.success('บันทึกผลการตรวจสำเร็จ')
      const init = {}
      checkpoints.forEach(c => { init[c.id] = { v1: '', v2: '', v3: '', attr: '', note: '', mval: '' } })
      setResults(init); setNotes('')
      fetchHistory(selectedJig.id)
      setTab('history')
      /* 🔧 เจอ NG → เสนอเปิดใบแจ้งซ่อมทันที (ตอนนี้แหละที่คนยังอยู่หน้าเครื่องและรู้ว่าเสียยังไง)
         เสนอหลังบันทึกสำเร็จเท่านั้น — ต้องมี inspection id ก่อนถึงผูกที่มาได้
         ข้ามได้ ไม่บล็อก · กด "ไว้ก่อน" แล้วยังกลับมาเปิดจากแท็บประวัติได้ (ไม่เป็นทางตัน) */
      if (overall === 'fail' && ngTopics.length && can('mtn_repair', 'report', userRole)) {
        openMoPrompt(insp, ngTopics)
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isFormReady = checkpoints.length > 0 && checkpoints.every(cp => {
    const r = results[cp.id]
    if (!r) return false
    return cp.type === 'variable' ? (r.v1 !== '' && r.v2 !== '' && r.v3 !== '')
      : cp.type === 'measure' ? (r.mval !== '' && r.mval != null) : r.attr !== ''
  })

  const deptColor = teams.find(t => t.key === department)?.color || DEPT_COLORS[department] || '#3dd65c'
  const jigImg = selectedJig ? getPublicUrl(selectedJig.image_path) : null
  // กรองอุปกรณ์ตามทีม — ยึด "department (checklist)" เป็นหลัก (คำสั่ง user 2026-07-22):
  //   โผล่ใต้ทีม D ถ้า (ก) มี checklist ของทีม D อยู่แล้ว (ตรงกับหน้า PMSchedule) หรือ
  //   (ข) ประเภทอุปกรณ์ = ประเภท default ของทีม (ให้เริ่ม checklist ใหม่ได้) · ผลิต = ทุกชนิด
  const teamEquip = (teams.find(t => t.key === department) || {}).equip_type
  const deptJigs = department === 'production'
    ? jigs
    : jigs.filter(j => (teamEquip && (j.equipment_type || 'machine') === teamEquip) || clDeptByJig[j.id]?.has(department))

  // จอแคบ: โชว์ทีละคอลัมน์ (ยังไม่เลือก=ลิสต์ · เลือกแล้ว=ฟอร์ม) · desktop โชว์ทั้งคู่เหมือนเดิม
  const showSidebar = !isNarrow || !selectedJig
  const showMain = !isNarrow || !!selectedJig

  return (
    <div style={S.page}>
      {/* Sidebar (จอแคบ = เต็มความกว้าง) */}
      {showSidebar && (
      <div style={{ ...S.sidebar, ...(isNarrow ? { width: '100%', borderRight: 'none' } : null) }}>
        <div style={S.sidebarHead}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: 0, fontFamily: 'var(--font-display)' }}>บันทึกผลตรวจ PM</h2>
        </div>
        <div style={S.deptBar}>
          {teams.map(d => <button key={d.key} onClick={() => setDept(d.key)} style={S.deptBtn(department === d.key, d.color || DEPT_COLORS[d.key] || '#3dd65c')}>{d.icon ? `${d.icon} ` : ''}{d.label}</button>)}
        </div>
        {/* AM (ผลิตตรวจเอง) กับ PM (ช่าง) เป็นคนละงาน — บอกให้ชัดว่าแท็บที่เลือกอยู่คืออะไร */}
        <div style={{ padding: '0 16px 10px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          <b style={{ color: deptColor }}>{teamKind(department).short} · {teamKind(department).full}</b> — {teamKind(department).desc}
        </div>
        <div style={S.jigList}>
          {department === 'production' ? (() => {
            // แท็บฝ่ายผลิต: เฉพาะเครื่องที่ลงทะเบียน Daily PM จัดกลุ่มตามไลน์ + สถานะกะนี้
            if (dailyLineByJig == null) return <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 20 }}>กำลังโหลด...</p>
            const lineParam = searchParams.get('line')
            const byLine = {}
            jigs.forEach(j => {
              const lns = dailyLineByJig[j.id]
              if (!lns) return
              lns.forEach(ln => {
                if (lineParam && ln !== lineParam) return
                ;(byLine[ln] ||= []).push(j)
              })
            })
            const lineNames = Object.keys(byLine).sort()
            // ⚠️ ช่องว่างที่เคยทำให้ 2 หน้าไม่ตรงกัน: PM Setup ลิสต์เครื่องที่ "มีรายการตรวจ AM" (มี checklist
            //    department=production) แต่หน้านี้ลิสต์เฉพาะเครื่องที่ "ลงทะเบียน AM" (pm_daily_line_targets)
            //    → เครื่องที่ลงจุดตรวจไว้แล้วแต่ยังไม่ลงทะเบียน หายไปเงียบๆ (เจอจริง 21 จาก 27 เครื่อง)
            //    ไม่เดาลงทะเบียนให้เอง (เป็นการตัดสินใจว่าไลน์ไหนต้องตรวจอะไร) แต่ต้องไม่ซ่อน
            const pendingReg = jigs.filter(j => clDeptByJig[j.id]?.has('production') && !dailyLineByJig[j.id])
            const pendingBlock = pendingReg.length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, border: '1px dashed #f59e0b55', background: 'rgba(245,158,11,0.08)' }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: '#f59e0b' }}>⚠ มีรายการตรวจ AM แล้ว แต่ยังไม่ได้ลงทะเบียน · {pendingReg.length} เครื่อง</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', margin: '3px 0 6px', lineHeight: 1.5 }}>
                  ลงจุดตรวจไว้ที่ PM Setup แล้ว แต่ยังไม่ถูกติ๊กว่า “ต้องตรวจทุกต้นกะ” จึงยังไม่ขึ้นให้ตรวจที่นี่
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, maxHeight: 120, overflowY: 'auto' }}>
                  {pendingReg.map(j => <div key={j.id}>· {j.machine_no || j.name}{j.line_name ? ` (${j.line_name})` : ''}</div>)}
                </div>
                <Link to="/daily-checker?tab=pm" style={{ display: 'inline-block', marginTop: 6, fontSize: 11.5, color: '#f59e0b', fontWeight: 800 }}>
                  ไปลงทะเบียนที่แท็บ AM →
                </Link>
              </div>
            )
            if (!lineNames.length) return (<>
              <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
                {lineParam ? `ไลน์ ${lineParam} ยังไม่ได้ลงทะเบียนเครื่องตรวจ` : 'ยังไม่มีเครื่องที่ลงทะเบียน AM'}<br />
                <Link to="/daily-checker?tab=pm" style={{ color: 'var(--accent)', fontWeight: 700 }}>ไปลงทะเบียนที่แท็บ AM →</Link>
              </p>
              {pendingBlock}
            </>)
            return (<>
              {lineParam && (
                <div style={{ fontSize: 11, color: 'var(--muted)', padding: '0 4px 6px' }}>
                  กรองเฉพาะไลน์ {lineParam} · <span onClick={() => setSearchParams({ dept: department, ...(equipParam ? { equip: equipParam } : {}) })} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>ดูทุกไลน์</span>
                </div>
              )}
              {lineNames.map(ln => (
                <div key={ln} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: deptColor, padding: '2px 4px 4px' }}>🏭 {ln} <span style={{ fontWeight: 600, color: 'var(--muted)' }}>· ตรวจแล้ว {byLine[ln].filter(j => checkedThisShift[j.id]).length}/{byLine[ln].length}</span></div>
                  {byLine[ln].map(jig => {
                    const st = checkedThisShift[jig.id]
                    return (
                      <div key={`${ln}-${jig.id}`} onClick={() => selectJig(jig)} style={S.jigItem(selectedJig?.id === jig.id, deptColor)}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jig.name}</p>
                          <span style={{
                            flexShrink: 0, fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 20,
                            background: st === 'fail' ? 'rgba(224,92,74,0.15)' : st ? 'rgba(61,214,92,0.15)' : 'rgba(245,158,11,0.15)',
                            color: st === 'fail' ? '#e05c4a' : st ? '#3dd65c' : '#f59e0b',
                          }}>
                            {st === 'fail' ? '✗ NG' : st ? '✓ ตรวจแล้ว' : 'รอตรวจ'}
                          </span>
                        </div>
                        {jig.machine_no && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>{jig.machine_no}</p>}
                        {/* ลงทะเบียนไว้แต่ยังไม่มีจุดตรวจ AM — เปิดเข้าไปจะเจอฟอร์มเปล่า บอกไว้ตั้งแต่ในลิสต์ */}
                        {!clDeptByJig[jig.id]?.has('production') && (
                          <p style={{ fontSize: 10.5, color: '#f59e0b', fontWeight: 700, margin: '2px 0 0' }}>⚠ ยังไม่มีจุดตรวจ AM</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
              {pendingBlock}
            </>)
          })() : (<>
            {deptJigs.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>ยังไม่มีอุปกรณ์ในทีมนี้<br /><span style={{ fontSize: 11 }}>({(teams.find(d => d.key === department) || {}).label})</span></p>}
            {deptJigs.map(jig => (
              <div key={jig.id} onClick={() => selectJig(jig)} style={S.jigItem(selectedJig?.id === jig.id, deptColor)}>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{jig.name}</p>
                {jig.line_name && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>📍 {jig.line_name}</p>}
              </div>
            ))}
          </>)}
        </div>
      </div>
      )}

      {/* Main */}
      {showMain && (
      <div style={S.main}>
        {!selectedJig ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>เลือกอุปกรณ์จากรายการด้านซ้าย</p>
          </div>
        ) : (
          <>
            <div style={{ ...S.header, ...(isNarrow ? { padding: '10px 12px', flexWrap: 'wrap' } : null) }}>
              {isNarrow && (
                <button onClick={clearJig} title="กลับไปเลือกอุปกรณ์" style={{ flexShrink: 0, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>← อุปกรณ์</button>
              )}
              {jigImg && <img src={jigImg} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'contain', background: 'var(--bg2)', border: '1px solid var(--border)' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{selectedJig.name}</h1>
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>{selectedJig.jig_no && `No: ${selectedJig.jig_no}`}{selectedJig.process && ` · ${selectedJig.process}`}</p>
              </div>
              <div style={S.tabBar}>
                <button onClick={() => setTab('record')} style={S.tabBtn(tab === 'record')}>📋 บันทึก</button>
                <button onClick={() => setTab('history')} style={S.tabBtn(tab === 'history')}>🕐 ประวัติ ({inspections.length})</button>
              </div>
            </div>

            <div style={{ ...S.body, ...(isNarrow ? { padding: 12 } : null) }}>
              {tab === 'record' && (() => {
                /* ⚠️ ไม่มีจุดตรวจของแผนกนี้ = ห้ามโชว์รูปหมุน (2026-08-11 · user ทัก "ทำไมรูปยังค้างอยู่")
                   รูปหลายมุมเป็นของ "ตัวเครื่อง" (ของกลางทุกแผนก) แต่ "หมุดจุดตรวจ" ผูกกับ
                   checklist ของแต่ละแผนก และ**ปักอยู่คนละมุม (frame) กัน** — AM อาจตรวจด้านหน้า
                   MTN ตรวจในตู้ไฟ → โชว์รูปมุมที่ 1/8 เปล่าๆ ที่ไม่มีหมุดเลย ไม่ได้บอกอะไร
                   แถมดูเหมือนหน้าพร้อมใช้งาน ทั้งที่ยังไม่มีอะไรให้ตรวจ
                   (ตัวเครื่องยืนยันได้จาก thumbnail บนหัวเรื่องอยู่แล้ว) */
                const showPhoto = frames.length > 0 && selectedJig.layout_type !== 'list' && checkpoints.length > 0
                // จอกว้าง (≥1180px) + มีรูป → 2 คอลัมน์ (รูปซ้ายค้างไว้ · รายการเช็คขวา) ใช้พื้นที่เต็ม
                const twoCol = isWide && showPhoto
                /* จอแคบ = รูปอยู่ "บนหัว" ของรายการ → ต้องเตี้ยพอให้เหลือที่กรอกจริง
                   (480px บนมือถือ = กินเกือบทั้งจอ ตอบ feedback "ในมือถือก็เหมือนยังไม่เหมาะ") */
                const stackCompact = showPhoto && !twoCol
                const viewerNode = showPhoto
                  ? <JigSpinCheck frames={frames} checkpoints={checkpoints} results={results} activeCpId={activeCpId} onPinClick={setActiveCpId}
                      maxH={twoCol ? 560 : (isNarrow ? 190 : 260)} compact={stackCompact} />
                  : null

                const formNode = (
                  <>
                  {checkpoints.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 12px', lineHeight: 1.7 }}>
                      เครื่องนี้ยังไม่มีรายการตรวจของ <b style={{ color: deptColor }}>{(teams.find(t => t.key === department) || {}).label || department}</b>
                      <br />
                      <span style={{ fontSize: 12 }}>
                        1 เครื่องมีรายการตรวจแยกตามแผนกได้ (ผลิตเช็ครายวัน · ช่างเช็คตามรอบ)
                        <br />จุดตรวจของแต่ละแผนก<b>ปักอยู่คนละมุมของเครื่องได้</b> — จึงยังไม่แสดงรูปหมุนจนกว่าจะมีจุดตรวจของแผนกนี้
                      </span>
                      {otherDepts.length > 0 && (
                        <div style={{ marginTop: 16, padding: '12px 14px', display: 'inline-block', textAlign: 'left', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 7 }}>
                            🔎 เครื่องนี้มีจุดตรวจอยู่ใต้แผนกอื่น — กดเพื่อดู
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {otherDepts.map(d => {
                              const t = teams.find(x => x.key === d.department)
                              return (
                                <button key={d.department} onClick={() => setDept(d.department)}
                                  style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                    border: `1.5px solid ${t?.color || 'var(--border2)'}`, background: 'var(--card)', color: t?.color || 'var(--text)' }}>
                                  {t?.icon || ''} {t?.label || d.department} · {d.checkpointCount} จุด
                                </button>)
                            })}
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: 12, marginTop: 14 }}>
                        ยังไม่ได้ลงจุดตรวจของแผนกนี้จริง → ตั้งที่ <b>PM Setup</b> (ถ้าลงผิดแผนก ย้ายข้ามแผนกได้ที่นั่น)
                      </div>
                    </div>
                  ) : (
                    <>
                      {(() => {
                        // เลข Item ต่อกลุ่ม (group_name) — sort_order จาก PM Setup จัดกลุ่มมาให้ต่อเนื่องแล้ว
                        const groupNo = {}
                        let gN = 0
                        checkpoints.forEach(c => { const g = (c.group_name || '').trim(); if (g && groupNo[g] == null) groupNo[g] = ++gN })
                        return checkpoints.map((cp, idx) => {
                          const g = (cp.group_name || '').trim()
                          const prevG = ((checkpoints[idx - 1]?.group_name) || '').trim()
                          const header = g && g !== prevG ? (
                            <div style={{ padding: '7px 12px', borderRadius: 8, marginBottom: 8, background: 'var(--accent-dim)', border: '1px solid var(--border2)', fontSize: 12.5, fontWeight: 800, color: 'var(--accent)' }}>
                              Item {groupNo[g]} — {g}
                            </div>
                          ) : (!g && prevG ? (
                            <div style={{ padding: '7px 12px', borderRadius: 8, marginBottom: 8, background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 12.5, fontWeight: 800, color: 'var(--muted)' }}>
                              อื่นๆ
                            </div>
                          ) : null)
                          const row = cp.type === 'variable' ? (
                            <VariableRow cp={cp} idx={idx} r={results[cp.id] ?? { v1: '', v2: '', v3: '' }} onChange={v => setResults(prev => ({ ...prev, [cp.id]: v }))} methodIndex={methodIndex} />
                          ) : cp.type === 'measure' ? (
                            <MeasureRow cp={cp} idx={idx} r={results[cp.id] ?? { mval: '' }} onChange={v => setResults(prev => ({ ...prev, [cp.id]: v }))} methodIndex={methodIndex} />
                          ) : (
                            <AttrRow cp={cp} idx={idx} methodIndex={methodIndex}
                              value={results[cp.id]?.attr ?? ''} note={results[cp.id]?.note ?? ''}
                              onChangeAttr={v => setResults(prev => ({ ...prev, [cp.id]: { ...prev[cp.id], attr: v } }))}
                              onChangeNote={v => setResults(prev => ({ ...prev, [cp.id]: { ...prev[cp.id], note: v } }))} />
                          )
                          return (
                            <div key={cp.id}>
                              {header}
                              <div ref={el => { rowRefs.current[cp.id] = el }} onClick={() => setActiveCpId(cp.id)}
                                style={{ borderRadius: 10, outline: activeCpId === cp.id ? '2px solid var(--accent)' : '2px solid transparent', outlineOffset: 1, transition: 'outline-color .15s',
                                  scrollMarginTop: stackCompact ? viewerH + 12 : 12 }}>
                                {row}
                              </div>
                            </div>
                          )
                        })
                      })()}
                      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="หมายเหตุ (ถ้ามี)..." style={{ marginTop: 8 }} />
                      <button onClick={handleSave} disabled={saving || !canRecord} style={{ ...S.saveBtn, opacity: (saving || !canRecord) ? 0.6 : isFormReady ? 1 : 0.75 }}>
                        {saving ? 'กำลังบันทึก...' : !canRecord ? `🔒 ไม่มีสิทธิ์บันทึกผลตรวจ ${isAmTeam(department) ? 'AM' : 'PM'}` : isFormReady ? 'บันทึกผลการตรวจ' : `บันทึก (ยังไม่ครบ ${checkpoints.filter(cp => { const r = results[cp.id]; return cp.type === 'variable' ? !(r?.v1 !== '' && r?.v2 !== '' && r?.v3 !== '') : cp.type === 'measure' ? (r?.mval === '' || r?.mval == null) : !r?.attr }).length} จุด)`}
                      </button>
                    </>
                  )}
                  </>
                )

                return twoCol ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(min(360px, 100%), 1fr) minmax(420px, 640px)', gap: 24, alignItems: 'start', maxWidth: 1500, margin: '0 auto' }}>
                    <div style={{ position: 'sticky', top: 8 }}>{viewerNode}</div>
                    <div>{formNode}</div>
                  </div>
                ) : (
                  <div style={{ maxWidth: showPhoto ? 760 : 720, margin: '0 auto' }}>
                    {/* 📌 จอแคบ: รูป + หมุด **ติดอยู่บนหัวจอ** ตลอดที่ไล่เช็คลงไป
                        เดิมวางไว้เฉยๆ แล้วเลื่อนหายไปตั้งแต่ข้อ 3-4 → ข้อหลังๆ ไม่รู้ว่าจุดอยู่ตรงไหนของเครื่อง
                        พื้นหลังทึบบังคับ (ไม่งั้นรายการเลื่อนทะลุใต้รูป) · พับเก็บได้เมื่ออยากได้พื้นที่กรอกเต็ม */}
                    {stackCompact && (
                      <div ref={viewerRef} style={{
                        position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)',
                        paddingBottom: 8, marginBottom: 10, borderBottom: '1px solid var(--border)',
                      }}>
                        {viewerOpen && viewerNode}
                        <button onClick={toggleViewer} style={{
                          display: 'block', margin: '6px auto 0', padding: '3px 14px', borderRadius: 999, cursor: 'pointer',
                          fontSize: 11, fontWeight: 700, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)',
                        }}>
                          {/* พับแล้วต้องยังบอกว่าซ่อนอะไรไว้ + กางคืนได้ ห้ามหายเงียบ */}
                          {viewerOpen ? '▲ ซ่อนรูปเครื่อง' : '▼ แสดงรูปเครื่อง (ดูว่าจุดอยู่ตรงไหน)'}
                        </button>
                      </div>
                    )}
                    {!stackCompact && viewerNode}
                    {formNode}
                  </div>
                )
              })()}

              {tab === 'history' && (
                <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inspections.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>ยังไม่มีประวัติการตรวจ</p>
                  ) : inspections.map(insp => (
                    <div key={insp.id} onClick={() => setViewInspection(insp)} style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{formatDate(insp.inspected_at)}</p>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: insp.status === 'pass' ? 'var(--accent-dim)' : insp.status === 'fail' ? 'rgba(224,92,74,0.12)' : 'var(--bg3)', color: insp.status === 'pass' ? 'var(--accent)' : insp.status === 'fail' ? '#e05c4a' : 'var(--muted)' }}>{insp.status?.toUpperCase()}</span>
                          {insp.approval_status === 'approved' && <span style={{ fontSize: 11, color: 'var(--accent)' }}>✓ อนุมัติแล้ว</span>}
                          {insp.approval_status === 'rejected' && <span style={{ fontSize: 11, color: '#e05c4a' }}>✕ ตีกลับ</span>}
                          {insp.approval_status === 'pending' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>รออนุมัติ</span>}
                          {/* NG ใบนี้ถูกส่งซ่อมหรือยัง — ตอบคำถาม "ที่เจอเมื่อวาน แก้แล้วรึยัง" ได้จากตรงนี้เลย */}
                          {moByInsp[insp.id] && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#fb923c' }}>
                              🔧 ใบซ่อม {moByInsp[insp.id].mo_no || '(รอออกเลข)'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* กด "ไว้ก่อน" ตอนบันทึกแล้วต้องกลับมาเปิดได้ — ไม่งั้นข้ามครั้งเดียว = ทางตัน */}
                        {insp.status === 'fail' && !moByInsp[insp.id] && can('mtn_repair', 'report', userRole) && (
                          <button onClick={e => { e.stopPropagation(); openMoFromHistory(insp) }} style={{
                            padding: '5px 11px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                            border: '1px solid #fb923c', background: 'rgba(251,146,60,0.12)', color: '#fb923c',
                          }}>🔧 เปิดใบแจ้งซ่อม</button>
                        )}
                        <span style={{ color: 'var(--muted)' }}>›</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      )}

      <AnimatePresence>
        {viewInspection && (
          <HistoryModal inspection={viewInspection} checkpoints={checkpoints} jig={selectedJig}
            userId={userId} userRole={userRole}
            onClose={() => { setViewInspection(null); if (selectedJig) fetchHistory(selectedJig.id) }} />
        )}
      </AnimatePresence>

      {/* ── 🔧 เจอ NG → เปิดใบแจ้งซ่อม MO ต่อเลย ──────────────────────────────────
          ⚠️ ไม่ปิดจากการคลิกพื้นหลัง (UI-CONVENTIONS §5) — เผลอแตะแล้วปิด = เสียโอกาสเปิดใบ
             ตอนที่คนยังอยู่หน้าเครื่องและรู้ว่าเสียยังไง (ยังกลับมาเปิดจากประวัติได้ แต่คนละจังหวะ) */}
      {moPrompt && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 460, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#e05c4a' }}>⚠ พบผลตรวจไม่ผ่าน {moPrompt.ngTopics.length} จุด</div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>{selectedJig?.name}</div>
            </div>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, maxHeight: 130, overflowY: 'auto' }}>
              {moPrompt.ngTopics.map((n, i) => <div key={i}>• {n}</div>)}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>แจ้งถึงทีมช่าง</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {MTN_TEAMS.map(t => (
                  <button key={t} onClick={() => setMoTeam(t)} style={{
                    padding: '6px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: `1.5px solid ${moTeam === t ? 'var(--accent)' : 'var(--border2)'}`,
                    background: moTeam === t ? 'var(--accent-dim)' : 'var(--bg3)', color: moTeam === t ? 'var(--accent)' : 'var(--muted)',
                  }}>{deptNameOf(t)}</button>
                ))}
              </div>
              {/* AM เจอ NG ส่งกลับให้ผลิตซ่อมเองไม่ได้ — ต้องบอกว่าทีมตั้งต้นมาจากการเดา ให้เลือกทับได้ */}
              {isAmTeam(department) && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
                  ผลตรวจนี้เป็น AM (ผลิตตรวจเอง) — ระบบเดาทีมช่างจากชนิดอุปกรณ์ให้ก่อน เลือกใหม่ได้ถ้าไม่ตรง
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => setMoPrompt(null)} disabled={moSaving} style={{
                padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)',
              }}>ไว้ก่อน</button>
              <button onClick={createMoFromInspection} disabled={moSaving} style={{
                padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                border: 'none', background: 'var(--accent)', color: '#071008', opacity: moSaving ? 0.6 : 1,
              }}>{moSaving ? 'กำลังเปิดใบ...' : '🔧 เปิดใบแจ้งซ่อม'}</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
              กด “ไว้ก่อน” ได้ — เปิดทีหลังจากแท็บ 🕐 ประวัติ ของเครื่องนี้
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
