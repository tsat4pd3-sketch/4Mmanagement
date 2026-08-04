import { useState, useEffect, useRef, useContext } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import imageCompression from 'browser-image-compression'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { FREQ_LABEL, DEPT_LABEL, EQUIP_TYPE_LABEL } from '../lib/pmSchedule'
import { loadPmTeams, pmTeamsSync } from '../utils/pmTeams'
import { getOrCreateChecklist, setChecklistFrequency } from '../lib/pmChecklists'
import { fetchCategories, fetchCheckingMethods, categoryColor } from '../lib/pmTaxonomy'
import TaxonomyManagerModal from '../components/TaxonomyManagerModal'
import SpinAnnotator from '../components/SpinAnnotator'
import cropPortrait from '../utils/cropPortrait'
import useImgBox from '../utils/useImgBox'
import CalloutPin from '../components/CalloutPin'

const DEPT_COLORS = {
  maintenance:     '#fb923c',
  jig_maintenance: '#34d399',
  die_maintenance: '#4d9fff',
  production:      '#3dd65c',
  qa:              '#9b8de8',
}

const CATEGORY_TYPE_META = {
  production: { label: 'Production', color: '#3dd65c', icon: '🏭' },
  facility:   { label: 'Facility',   color: '#f59a3f', icon: '🔧' },
  utility:    { label: 'Utility',    color: '#9b8de8', icon: '⚡' },
}

async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

function inferEquipType(stationCode) {
  const code = (stationCode ?? '').split('-')[0].trim().toUpperCase()
  if (code.startsWith('J')) return 'jig'
  return 'machine'
}

function newCheckpoint(extra = {}) {
  return {
    _key: crypto.randomUUID(), name: '', type: 'variable',
    axis: null, category: null, checking_method: null, unit: '', nominal: '', lsl: '', usl: '', lcl: '', ucl: '',
    x_pos: null, y_pos: null, _frameKey: null,
    group_name: '', description: '', image_path: null, _imgFile: null, _imgPreview: null,
    ...extra,
  }
}

/* จัดกลุ่มตาม group_name (Item 1 "Locate Pin" → LP1..): กลุ่มที่ตั้งชื่อมาก่อน
   ตามลำดับที่พบ, จุดที่ไม่มีกลุ่มต่อท้าย — ใช้ทั้งตอน render และตอน save (sort_order) */
function groupCheckpoints(cps) {
  const named = [], map = {}, ungrouped = []
  for (const cp of cps) {
    const g = (cp.group_name || '').trim()
    if (!g) { ungrouped.push(cp); continue }
    if (!map[g]) { map[g] = { name: g, items: [] }; named.push(map[g]) }
    map[g].items.push(cp)
  }
  return { named, ungrouped, ordered: [...named.flatMap(g => g.items), ...ungrouped] }
}

function getPublicUrl(path) {
  if (!path) return null
  return supabaseDR.storage.from('jig-images').getPublicUrl(path).data.publicUrl
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page: { padding: 'clamp(12px,3vw,28px) clamp(14px,3.5vw,32px)', minHeight: '100%', background: 'var(--bg)' },
  header: { display: 'flex', paddingRight: 52, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 },
  h1: { fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 },
  sub: { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  deptBar: { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  deptBtn: (active, color) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`,
    background: active ? `${color}18` : 'var(--bg3)',
    color: active ? color : 'var(--muted)',
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 16 },
  card: {
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'border-color 0.2s',
  },
  cardImg: { height: 130, background: 'var(--bg2)', position: 'relative', overflow: 'hidden' },
  cardBody: { padding: 14, display: 'flex', flexDirection: 'column', gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 },
  tag: (color) => ({
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700,
    background: `${color}18`, color, border: `1px solid ${color}30`,
  }),
  meta: { fontSize: 11, color: 'var(--muted)', margin: 0 },
  actions: { display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 },
  btnSm: (color) => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: `1px solid ${color}30`, background: `${color}12`, color, cursor: 'pointer',
  }),
  primaryBtn: {
    padding: '9px 18px', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 700,
    background: 'var(--accent)', color: '#071008', border: 'none', cursor: 'pointer',
  },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '60px 24px', textAlign: 'center',
    background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 'var(--radius-lg)',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modal: {
    background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12,
    width: '100%', maxWidth: 1000, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)',
  },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border)' },
  modalTitle: { fontSize: 17, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 },
  modalBody: { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 },
  modalFoot: { padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 },
  inputRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  freqBtns: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  freqBtn: (active) => ({
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
    background: active ? 'var(--accent-dim)' : 'var(--bg3)',
    color: active ? 'var(--accent)' : 'var(--muted)',
  }),
  typeBtn: (active, color) => ({
    flex: 1, padding: '7px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? `${color}50` : 'var(--border)'}`,
    background: active ? `${color}15` : 'var(--bg3)',
    color: active ? color : 'var(--muted)',
  }),
  cpCard: { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 },
  cancelBtn: { flex: 1, padding: '9px 0', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', cursor: 'pointer' },
  saveBtn: { flex: 1, padding: '9px 0', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 700, background: 'var(--accent)', color: '#071008', border: 'none', cursor: 'pointer' },
  modeBtn: (active) => ({
    flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
    background: active ? 'var(--accent-dim)' : 'var(--bg3)',
    color: active ? 'var(--accent)' : 'var(--muted)',
  }),
}

// ความสูงกรอบดูรูปในหน้าตั้งค่า ≈ 46% ของจอ — เหลือที่ให้ลิสต์จุดตรวจเห็นในจอเดียว (UI-CONVENTIONS §5.1)
const calcAnnoViewH = () => Math.round(Math.min(620, Math.max(260, (typeof window === 'undefined' ? 900 : window.innerHeight) * 0.46)))

// ─── ImageAnnotator (upload + click-to-pin) ────────────────────────────────────
function ImageAnnotator({ imageUrl, checkpoints, labels, activePinKey, onImageClick, onPinRemove }) {
  const layerRef = useRef(null)
  // pin สเกล/clamp/วางตำแหน่ง อิง "กล่องรูปจริง" หัก letterbox ของ objectFit:contain
  // (docs/UI-CONVENTIONS.md §5.1 — pattern เดียวกับ MachineFloorMap)
  const { imgRef, imgBox, recalc } = useImgBox([imageUrl])
  // ซูม: 1 = พอดีกรอบทั้ง 2 แกน (contain) ไม่ใช่ขนาดไฟล์/เต็มความกว้าง — สูตรเดียวกับ QAInspectionSetup
  // (UI-CONVENTIONS §5.1 · รูป PM ถูกครอปเป็นแนวตั้ง 3:4 ถ้าเต็มความกว้างจะสูงจนเช็คลิสต์ตกจอ)
  const boxRef = useRef(null)
  const [boxW, setBoxW] = useState(0)
  const [natSize, setNatSize] = useState({ w: 0, h: 0 })
  const [viewH, setViewH] = useState(() => calcAnnoViewH())
  const [zoom, setZoom] = useState(1)
  useEffect(() => { setZoom(1); setNatSize({ w: 0, h: 0 }) }, [imageUrl])   // เปลี่ยนรูป → รีเซ็ตซูม/ขนาดไฟล์
  useEffect(() => {
    const on = () => setViewH(calcAnnoViewH())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  // วัดความกว้างจาก div นอกที่ไม่ scroll — วัดจากกรอบ scroll เองจะหดตอน scrollbar โผล่ = ขนาดรูปแกว่ง
  useEffect(() => {
    const el = boxRef.current
    if (!el) { setBoxW(0); return }
    const measure = () => setBoxW(el.clientWidth || 0)
    const ro = new ResizeObserver(measure)
    ro.observe(el); measure()
    return () => ro.disconnect()
  }, [imageUrl])
  const fitScale = (natSize.w && natSize.h && boxW) ? Math.min(boxW / natSize.w, viewH / natSize.h) : 0
  const imgW = fitScale ? Math.round(natSize.w * fitScale * zoom) : 0
  const PK = Math.round(Math.max(20, Math.min(36, (imgBox?.rw || 500) * 0.04)))
  const pkFont = Math.max(11, Math.round(PK * 0.45))
  const padX = imgBox ? (PK * 0.7 / imgBox.rw) * 100 : 0
  const padTop = imgBox ? ((PK + 4) / imgBox.rh) * 100 : 0 // anchor ห้อยลง (translate -100%) เผื่อหัวบน
  const clampPct = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  // แปลงตำแหน่งคลิก → 0..1 ของ "รูปจริง" (หัก letterbox) — วัดจาก layer เดียวกับที่วาด pin
  const handleClick = (e) => {
    if (!activePinKey || !layerRef.current) return
    const rect = layerRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    onImageClick(x, y)
  }
  const zBtn = {
    padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border2)',
    background: 'var(--bg3)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  }
  return (
    <div>
      {/* ซูมสำหรับวางจุดแม่นๆ — 100% = พอดีกรอบทั้ง 2 แกน (UI-CONVENTIONS §5.1) */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <button type="button" style={zBtn} onClick={() => setZoom(z => Math.max(1, +(z - 0.5).toFixed(2)))} disabled={zoom <= 1} title="ซูมออก">➖</button>
        <span style={{ fontSize: 12, fontWeight: 800, minWidth: 46, textAlign: 'center', color: 'var(--text)' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" style={zBtn} onClick={() => setZoom(z => Math.min(4, +(z + 0.5).toFixed(2)))} disabled={zoom >= 4} title="ซูมเข้า">➕</button>
        {zoom > 1 && <button type="button" style={zBtn} onClick={() => setZoom(1)}>↺ พอดีกรอบ</button>}
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{zoom > 1 ? 'เลื่อนดูส่วนอื่นของรูปได้ในกรอบ' : 'เห็นรูปเต็มพอดีกรอบ — ซูมเข้าเพื่อวางจุดละเอียดขึ้น'}</span>
      </div>
      {/* div นอก = ตัววัดความกว้างที่ใช้ได้ (ไม่ scroll) · div ใน = กรอบดู สูงไม่เกิน viewH
          · wrapper รูป width:fit-content + margin auto = จัดกลางโดยไม่โดนตัดขอบซ้ายตอนซูมเกินกรอบ */}
      <div ref={boxRef}>
      <div style={{
        maxHeight: viewH, overflow: 'auto', borderRadius: 8,
        border: `2px solid ${activePinKey ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg2)',
      }}>
        <div onClick={handleClick} style={{
          position: 'relative', userSelect: 'none', width: 'fit-content', margin: '0 auto',
          cursor: activePinKey ? 'crosshair' : 'default',
        }}>
          <img src={imageUrl} alt="JIG"
            // รูปจาก cache บางที onLoad ไม่ยิง → ref อ่าน naturalWidth ให้ด้วย (ไม่งั้น render ที่ขนาดไฟล์ = ล้นกรอบ)
            // ref เดียวกันต้องส่งต่อให้ useImgBox (imgRef) เพื่อวัดกล่องรูปจริงของ layer หมุด
            ref={el => {
              imgRef.current = el
              if (el?.complete && el.naturalWidth && !natSize.w) setNatSize({ w: el.naturalWidth, h: el.naturalHeight })
            }}
            onLoad={e => {
              const el = e.currentTarget
              setNatSize({ w: el.naturalWidth || 0, h: el.naturalHeight || 0 })
              recalc()
            }}
            style={{
              display: 'block', height: 'auto',
              // fallback ระหว่างยังไม่รู้ขนาดไฟล์: contain ในกรอบไว้ก่อน (px ไม่ใช้ % — wrapper เป็น fit-content)
              width: imgW ? `${imgW}px` : 'auto',
              maxWidth: imgW ? 'none' : (boxW ? `${boxW}px` : '100%'),
              maxHeight: imgW ? 'none' : viewH,
            }} />
          {/* layer = กล่องรูปจริง (หัก letterbox) — pin ใช้ % ของ layer นี้ ไม่ใช่ % ของ container */}
          {imgBox && (
            <div ref={layerRef} style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
              {checkpoints.map((cp, i) => {
                if (cp.x_pos == null || cp.y_pos == null) return null
                const isActive = activePinKey === cp._key
                const col = isActive ? 'var(--accent)' : categoryColor(cp.category)
                return (
                  <CalloutPin key={cp._key} xPct={cp.x_pos * 100} yPct={cp.y_pos * 100} layerW={imgBox.rw} layerH={imgBox.rh} size={PK}
                    label={labels?.[i] ?? i + 1} color={col} selected={isActive}
                    title={`${cp.name || `จุด ${i + 1}`} — คลิกเพื่อลบ`}
                    onClick={e => { e.stopPropagation(); onPinRemove(cp._key) }} />
                )
              })}
            </div>
          )}
          {activePinKey && (
            <div style={{ position: 'sticky', bottom: 8, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ padding: '5px 12px', borderRadius: 20, background: 'var(--accent)', color: '#071008', fontSize: 11, fontWeight: 700 }}>📍 คลิกที่รูปเพื่อวางตำแหน่ง</span>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

// ─── CheckpointCard ───────────────────────────────────────────────────────────
function CheckpointCard({ cp, label, onChange, onDelete, onDuplicate, onCpImage, isPinning, onPinToggle, hasImage, categories, allCategories, methods }) {
  const isVar = cp.type === 'variable'
  // ถ้าหมวดที่เลือกไว้เดิมไม่อยู่ในลิสต์ที่กรองแล้ว (เช่น jig เก่า) ยังต้องโชว์ไม่ให้หาย
  const catOpts = cp.category && !(categories ?? []).some(c => c.code === cp.category)
    ? [...(categories ?? []), (allCategories ?? []).find(c => c.code === cp.category)].filter(Boolean)
    : (categories ?? [])
  return (
    <div style={{ ...S.cpCard, borderColor: isPinning ? 'var(--accent)' : 'var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 20, height: 20, padding: '0 4px', borderRadius: 10, background: 'var(--bg3)', color: 'var(--muted)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{label}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>จุดตรวจสอบ</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isVar && (
            <button onClick={onDuplicate} title="ทำสำเนาจุดนี้เป็นอีกแกน (X↔Y) — copy ชื่อ/tool ให้ กรอกแค่ spec"
              style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)' }}>
              ⧉ อีกแกน
            </button>
          )}
          {hasImage && (
            <button onClick={onPinToggle} style={{
              padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${isPinning ? 'var(--accent)' : cp.x_pos != null ? 'var(--accent)' : 'var(--border2)'}`,
              background: isPinning ? 'var(--accent)' : cp.x_pos != null ? 'var(--accent-dim)' : 'var(--bg3)',
              color: isPinning ? '#071008' : cp.x_pos != null ? 'var(--accent)' : 'var(--muted)',
            }}>{cp.x_pos != null ? '📍 วางแล้ว' : '🔘 วางตำแหน่ง'}</button>
          )}
          <button className="tbtn" onClick={onDelete} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: '0 2px', cursor: 'pointer' }}>×</button>
        </div>
      </div>

      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input value={cp.name} onChange={e => onChange({ name: e.target.value })} placeholder="ชื่อจุดตรวจสอบ เช่น LP1" />
        <input value={cp.group_name ?? ''} onChange={e => onChange({ group_name: e.target.value })}
          placeholder="กลุ่ม/หัวข้อ (Item) เช่น Locate Pin" list="cp-group-options" />
      </div>

      <div className="mgrid" style={S.inputRow}>
        <div style={{ marginBottom: 10 }}>
          <label style={S.label}>ประเภท (Category)</label>
          <select value={cp.category ?? ''} onChange={e => onChange({ category: e.target.value || null })}>
            <option value="">— ไม่ระบุ —</option>
            {catOpts.map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={S.label}>วิธีการตรวจสอบ</label>
          <select value={cp.checking_method ?? ''} onChange={e => onChange({ checking_method: e.target.value || null })}>
            <option value="">— ไม่ระบุ —</option>
            {(methods ?? []).map(m => <option key={m.code} value={m.code}>{m.icon} {m.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: (isVar || cp.type === 'measure') ? 10 : 0, flexWrap: 'wrap' }}>
        {['variable', 'measure', 'attribute', 'note'].map(t => {
          const colors = { variable: '#4d9fff', measure: '#22c55e', attribute: '#9b8de8', note: '#f59a3f' }
          const lbl = { variable: '📏 Variable', measure: '📊 ค่าวัด', attribute: '✅ OK/NG', note: '📝 Note' }
          return (
            <button key={t} onClick={() => onChange({ type: t })} style={S.typeBtn(cp.type === t, colors[t])}>{lbl[t]}</button>
          )
        })}
      </div>

      {cp.type === 'measure' && (() => {
        const has = v => v !== '' && v != null
        const mMode = (has(cp.lsl) && has(cp.usl)) ? 'between' : has(cp.usl) && !has(cp.lsl) ? 'lte' : 'gte'
        const setMode = m => onChange(m === 'gte' ? { usl: '' } : m === 'lte' ? { lsl: '' } : {})
        const modeBtn = (m, t) => (
          <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
            border: `1.5px solid ${mMode === m ? '#22c55e' : 'var(--border)'}`, background: mMode === m ? 'rgba(34,197,94,0.12)' : 'var(--bg3)', color: mMode === m ? '#22c55e' : 'var(--muted)' }}>{t}</button>
        )
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>{modeBtn('gte', '≥ ต่ำสุด')}{modeBtn('lte', '≤ สูงสุด')}{modeBtn('between', 'ช่วง min–max')}</div>
            <div className="mgrid" style={S.inputRow}>
              {mMode !== 'lte' && <div><label style={{ ...S.label, color: '#22c55e' }}>{mMode === 'between' ? 'ค่าต่ำสุด (min)' : 'ค่าต่ำสุด (≥)'}</label><input type="number" value={cp.lsl} onChange={e => onChange({ lsl: e.target.value })} placeholder="0.45" /></div>}
              {mMode !== 'gte' && <div><label style={{ ...S.label, color: '#22c55e' }}>{mMode === 'between' ? 'ค่าสูงสุด (max)' : 'ค่าสูงสุด (≤)'}</label><input type="number" value={cp.usl} onChange={e => onChange({ usl: e.target.value })} placeholder="—" /></div>}
              <div><label style={S.label}>หน่วย</label><input value={cp.unit} onChange={e => onChange({ unit: e.target.value })} placeholder="Mpa" /></div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>อ่านค่าครั้งเดียว → ระบบเทียบเกณฑ์ ขึ้น OK/NG ให้อัตโนมัติ</p>
          </div>
        )
      })()}

      {isVar && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4, textTransform: 'uppercase' }}>Axis</span>
            {[null, 'X', 'Y'].map(a => (
              <button key={String(a)} onClick={() => onChange({ axis: a })} style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${cp.axis === a ? 'var(--accent)' : 'var(--border)'}`,
                background: cp.axis === a ? 'var(--accent-dim)' : 'var(--bg3)',
                color: cp.axis === a ? 'var(--accent)' : 'var(--muted)',
              }}>{a === null ? '—' : a}</button>
            ))}
          </div>
          <div className="mgrid" style={S.inputRow}>
            <div><label style={S.label}>Nominal</label><input type="number" value={cp.nominal} onChange={e => onChange({ nominal: e.target.value })} placeholder="0" /></div>
            <div><label style={S.label}>Unit</label><input value={cp.unit} onChange={e => onChange({ unit: e.target.value })} placeholder="mm" /></div>
          </div>
          <div className="mgrid" style={S.inputRow}>
            <div><label style={{ ...S.label, color: '#e05c4a' }}>LSL</label><input type="number" value={cp.lsl} onChange={e => onChange({ lsl: e.target.value })} placeholder="—" /></div>
            <div><label style={{ ...S.label, color: '#e05c4a' }}>USL</label><input type="number" value={cp.usl} onChange={e => onChange({ usl: e.target.value })} placeholder="—" /></div>
          </div>
          <div className="mgrid" style={S.inputRow}>
            <div><label style={{ ...S.label, color: '#f59a3f' }}>LCL</label><input type="number" value={cp.lcl} onChange={e => onChange({ lcl: e.target.value })} placeholder="—" /></div>
            <div><label style={{ ...S.label, color: '#f59a3f' }}>UCL</label><input type="number" value={cp.ucl} onChange={e => onChange({ ucl: e.target.value })} placeholder="—" /></div>
          </div>
        </div>
      )}

      {!isVar && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ padding: '3px 10px', borderRadius: 6, background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, border: '1px solid var(--accent)' }}>OK</span>
            <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(224,92,74,0.1)', color: '#e05c4a', fontSize: 11, fontWeight: 700, border: '1px solid rgba(224,92,74,0.3)' }}>NG</span>
            {cp.type === 'note' && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'var(--bg3)', color: 'var(--muted)', fontSize: 11, border: '1px solid var(--border)' }}>+ ข้อความ</span>}
          </div>
          <div>
            <label style={S.label}>เกณฑ์ตัดสิน (Standard) — ขึ้นบรรทัดใหม่ได้</label>
            <textarea rows={2} value={cp.description ?? ''} onChange={e => onChange({ description: e.target.value })}
              placeholder={'เช่น กดชิ้นงานแน่น ไม่หลวมคลอน\nไม่เกิดการรั่วซึมบริเวณซิล, Fitting'} />
          </div>
        </div>
      )}

      {/* รูปอ้างอิงต่อจุด (คอลัมน์ Picture ของฟอร์ม) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {cp._imgPreview ? (
          <>
            <img src={cp._imgPreview} alt="" style={{ height: 44, borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg2)' }} />
            <label style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}>
              <input type="file" accept="image/*" onChange={onCpImage} style={{ display: 'none' }} />เปลี่ยนรูป
            </label>
            <button onClick={() => onChange({ _imgFile: null, _imgPreview: null, image_path: null })}
              style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}>ลบรูป</button>
          </>
        ) : (
          <label style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="file" accept="image/*" onChange={onCpImage} style={{ display: 'none' }} />
            🖼 แนบรูปอ้างอิง (Picture)
          </label>
        )}
      </div>
    </div>
  )
}

// ─── EquipmentModal ───────────────────────────────────────────────────────────
function EquipmentModal({ onClose, onSaved, editJig, department, categories, methods }) {
  const isEdit = !!editJig
  const [userId, setUserId] = useState(null)

  const [addMode, setAddMode] = useState(isEdit ? 'manual' : 'workstation')
  const [machineOptions, setMachineOptions] = useState([])
  const [machineId, setMachineId] = useState(editJig?.machine_id ?? null)

  const [name, setName] = useState(editJig?.name ?? '')
  const [description, setDescription] = useState(editJig?.description ?? '')
  const [jigNo, setJigNo] = useState(editJig?.jig_no ?? '')
  const [process, setProcess] = useState(editJig?.process ?? '')
  const [model, setModel] = useState(editJig?.model ?? '')
  const [partName, setPartName] = useState(editJig?.part_name ?? '')
  const [partNo, setPartNo] = useState(editJig?.part_no ?? '')
  const [lineName, setLineName] = useState(editJig?.line_name ?? '')
  const [machineNo, setMachineNo] = useState(editJig?.machine_no ?? '')
  const [equipType, setEquipType] = useState(editJig?.equipment_type ?? 'machine')
  const [equipCategory, setEquipCategory] = useState(editJig?.equipment_category ?? 'production')

  const [frequency, setFrequency] = useState('periodic')
  // Phase 2 — plan type (time | usage | hybrid) + usage-based predictive fields
  const [planType, setPlanType] = useState('time')
  const [usageThreshold, setUsageThreshold] = useState('')
  const [usageLine, setUsageLine] = useState('')
  const [checkpoints, setCheckpoints] = useState([])
  const [layoutType, setLayoutType] = useState(editJig?.layout_type ?? 'image_pin')
  // รูปหลายมุมต่ออุปกรณ์ (1 รูป = ปกติ, ≥2 รูป = ปัดดูรอบเครื่อง — ไม่บังคับจำนวน)
  const [frames, setFrames] = useState([])   // [{ _key, id?, image_path?, _file?, _preview, title }]
  const initialImagePathsRef = useRef(new Set()) // path รูปตอนเปิดแก้ไข — ใช้เก็บกวาดไฟล์ที่ถูกถอดตอน save
  const [frameIdx, setFrameIdx] = useState(0)
  const [imgBusy, setImgBusy] = useState(false)
  // โมเดล 3D (ถ้ามี) — { path, format } = ของเดิม · _glb = ไฟล์ใหม่ที่แปลงเป็น GLB แล้ว รอ upload
  const [activePinKey, setActivePinKey] = useState(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [lineOptions, setLineOptions] = useState([])
  useEffect(() => {
    getCurrentUserId().then(setUserId)
    supabaseDR.from('machines').select('id, line_name, machine_no, machine_name').order('line_name').order('sort_order')
      .then(({ data }) => setMachineOptions(data ?? []))
    // production lines (MAIN project) for the usage "นับยอดจากไลน์" dropdown
    supabase.from('production_lines').select('name').order('name')
      .then(({ data }) => setLineOptions((data ?? []).map(l => l.name).filter(Boolean)))
  }, [])

  useEffect(() => {
    if (!editJig || !userId) return
    getOrCreateChecklist(editJig.id, 'mtn', department, userId).then(async (cl) => {
      if (!cl) return
      setFrequency(cl.frequency)
      // load spin frames (jig_images); fall back to jigs.image_path as one frame
      const { data: imgs } = await supabaseDR.from('jig_images').select('*').eq('jig_id', editJig.id).order('sort')
      let fr = (imgs ?? []).map(im => ({ _key: im.id, id: im.id, image_path: im.image_path, _preview: getPublicUrl(im.image_path), title: im.title }))
      if (!fr.length && editJig.image_path) fr = [{ _key: 'legacy', image_path: editJig.image_path, _preview: getPublicUrl(editJig.image_path), title: null }]
      setFrames(fr); setFrameIdx(0)
      const frameKeyById = Object.fromEntries(fr.filter(f => f.id).map(f => [f.id, f._key]))
      const { data: cps } = await supabaseDR.from('jig_checkpoints').select('*').eq('checklist_id', cl.id).order('sort_order')
      setCheckpoints((cps ?? []).map(c => ({
        ...c, _key: c.id,
        group_name: c.group_name ?? '', description: c.description ?? '',
        _frameKey: (c.image_id && frameKeyById[c.image_id]) || fr[0]?._key || null,
        _imgFile: null, _imgPreview: c.image_path ? getPublicUrl(c.image_path) : null,
      })))
      // จำ path รูปทั้งหมดตอนเปิดแก้ไข — ตอน save จะเทียบหาไฟล์ที่ถูกถอด (เฟรม/รูปจุดตรวจ) แล้วลบจาก storage
      initialImagePathsRef.current = new Set([
        ...fr.map(f => f.image_path),
        ...(cps ?? []).map(c => c.image_path),
      ].filter(Boolean))
      const { data: plan } = await supabaseDR.from('pm_plans').select('plan_type, usage_threshold, usage_source_line').eq('checklist_id', cl.id).maybeSingle()
      if (plan) {
        setPlanType(plan.plan_type ?? 'time')
        setUsageThreshold(plan.usage_threshold != null ? String(plan.usage_threshold) : '')
        setUsageLine(plan.usage_source_line ?? '')
      }
    })
  }, [editJig, department, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isEdit) setCheckpoints([newCheckpoint()])
  }, [isEdit])

  const machinesByLine = machineOptions.reduce((acc, m) => {
    const line = m.line_name ?? 'ไม่ระบุไลน์'
    if (!acc[line]) acc[line] = []
    acc[line].push(m)
    return acc
  }, {})

  const handleMachineSelect = (id) => {
    setMachineId(id)
    if (!id) { setName(''); setLineName(''); setMachineNo(''); return }
    const m = machineOptions.find(x => x.id === id)
    if (!m) return
    setName(m.machine_name ? `${m.machine_no} - ${m.machine_name}` : m.machine_no)
    setLineName(m.line_name ?? '')
    setMachineNo(m.machine_no ?? '')
    setEquipCategory('production')
    setEquipType(inferEquipType(m.machine_no))
  }

  const handleModeSwitch = (mode) => {
    setAddMode(mode)
    if (mode === 'workstation') {
      setEquipCategory('production'); setMachineId(null); setName(''); setLineName(''); setMachineNo('')
    } else {
      setMachineId(null); setEquipCategory('facility')
    }
  }

  const updateCp = (key, patch) => setCheckpoints(prev => prev.map(c => c._key === key ? { ...c, ...patch } : c))
  const addCp = () => setCheckpoints(prev => [...prev, newCheckpoint()])
  const deleteCp = (key) => {
    setCheckpoints(prev => prev.filter(c => c._key !== key))
    if (activePinKey === key) setActivePinKey(null)
  }
  const togglePin = (key) => setActivePinKey(prev => prev === key ? null : key)

  // TASK 4: ทำสำเนาจุด variable เป็นอีกแกน (X↔Y) — copy ชื่อ/tool/กลุ่ม ให้กรอกแค่ spec
  const duplicateCp = (key) => setCheckpoints(prev => {
    const i = prev.findIndex(c => c._key === key)
    if (i < 0) return prev
    const src = prev[i]
    const copy = newCheckpoint({
      name: src.name, type: src.type, category: src.category, checking_method: src.checking_method,
      unit: src.unit, group_name: src.group_name, axis: src.axis === 'Y' ? 'X' : 'Y',
      x_pos: src.x_pos, y_pos: src.y_pos, _frameKey: src._frameKey,
      image_path: src.image_path, _imgPreview: src._imgPreview,
    })
    return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)]
  })

  // TASK 3: รูปอ้างอิงต่อ checkpoint — บีบอัดตอนเลือก อัพโหลดจริงตอน save
  const handleCpImage = async (key, e) => {
    const file = e.target.files[0]
    if (!file) return
    const compressed = await imageCompression(file, { maxSizeMB: 0.2, maxWidthOrHeight: 900 })
    updateCp(key, { _imgFile: compressed, _imgPreview: URL.createObjectURL(compressed) })
  }

  // spin frames — บังคับ crop แนวตั้ง 3:4 + ลดขนาด ตอนเลือกรูป (upload ตอน save)
  //   normalize EXIF orientation ด้วย imageCompression ก่อน แล้ว center-crop เป็นแนวตั้ง (cropPortrait)
  const addFrames = async (fileList) => {
    setImgBusy(true)
    try {
      const added = []
      for (const file of Array.from(fileList)) {
        const norm = await imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1600 }) // ปรับ orientation + ลดเบื้องต้น
        const cropped = await cropPortrait(norm, { ratio: 3 / 4, maxLongSide: 1200, quality: 0.82 })
        added.push({ _key: crypto.randomUUID(), _file: cropped, _preview: URL.createObjectURL(cropped), title: null })
      }
      setFrames(prev => [...prev, ...added])
    } finally { setImgBusy(false) }
  }
  const removeFrame = (key) => {
    setFrames(prev => {
      const next = prev.filter(f => f._key !== key)
      setFrameIdx(fi => Math.max(0, Math.min(fi, next.length - 1)))
      return next
    })
    // unpin any checkpoint that lived on the removed frame
    setCheckpoints(prev => prev.map(c => c._frameKey === key ? { ...c, x_pos: null, y_pos: null, _frameKey: null } : c))
    if (activePinKey) setActivePinKey(null)
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('กรุณาใส่ชื่ออุปกรณ์'); return }
    if (addMode === 'workstation' && !isEdit && !machineId) { setError('กรุณาเลือกเครื่องจักรจาก Floor Map'); return }
    if (checkpoints.some(c => !c.name.trim())) { setError('กรุณาใส่ชื่อทุกจุดตรวจสอบ'); return }
    // รูปหลายมุมได้ตั้งแต่ 1 รูปขึ้นไป ไม่บังคับจำนวน — 2 รูปขึ้นไปปัดดูรอบเครื่องได้ ยิ่งเยอะยิ่งลื่น
    setSaving(true); setError('')
    try {
      const jigId = editJig?.id ?? crypto.randomUUID()

      // ── resolve spin frames: upload new files, keep existing paths ──
      const spinMode = layoutType === 'image_pin' && frames.length >= 2
      const resolvedFrames = []
      if (layoutType === 'image_pin') {
        for (const f of frames) {
          let path = f.image_path ?? null
          if (f._file) {
            const ext = (f._file.name?.split('.').pop() || 'jpg').toLowerCase()
            path = `jigs/${jigId}/frame-${f._key}.${ext}`
            const { error: upErr } = await supabaseDR.storage.from('jig-images').upload(path, f._file, { upsert: true })
            if (upErr) throw upErr
          }
          if (path) resolvedFrames.push({ key: f._key, path, title: f.title ?? null })
        }
      }
      const imagePath = layoutType === 'list' ? null : (resolvedFrames[0]?.path ?? null)

      const { error: jigErr } = await supabaseDR.from('jigs').upsert({
        id: jigId, name: name.trim(), description: description.trim() || null,
        image_path: imagePath,
        created_by: userId, module: editJig?.module ?? 'mtn',
        jig_no: jigNo.trim() || null, process: process.trim() || null,
        model: model.trim() || null, part_name: partName.trim() || null,
        part_no: partNo.trim() || null, line_name: lineName || null,
        machine_no: machineNo || null, machine_id: machineId || null,
        equipment_type: equipType, equipment_category: equipCategory,
      })
      if (jigErr) throw jigErr

      // ── replace jig_images (spin frames) → map each frameKey to its new row id ──
      const frameIdByKey = {}
      await supabaseDR.from('jig_images').delete().eq('jig_id', jigId)
      if (resolvedFrames.length) {
        const { data: insImgs, error: imgErr } = await supabaseDR.from('jig_images')
          .insert(resolvedFrames.map((f, i) => ({ jig_id: jigId, image_path: f.path, sort: i, is_spin_frame: spinMode, title: f.title })))
          .select('id, image_path')
        if (imgErr) throw imgErr
        const idByPath = Object.fromEntries((insImgs ?? []).map(r => [r.image_path, r.id]))
        resolvedFrames.forEach(f => { frameIdByKey[f.key] = idByPath[f.path] })
      }

      const cl = await getOrCreateChecklist(jigId, 'mtn', department, userId)
      if (!cl) throw new Error('Failed to create checklist')
      await setChecklistFrequency(cl.id, frequency)

      // Phase 2 — persist the plan type + usage rule (row exists via trigger; upsert on checklist_id)
      {
        const uses = planType === 'usage' || planType === 'hybrid'
        const thr = usageThreshold !== '' && usageThreshold != null ? Number(usageThreshold) : null
        await supabaseDR.from('pm_plans').upsert({
          checklist_id: cl.id,
          plan_type: planType,
          usage_metric: uses ? 'produced_qty' : null,
          usage_threshold: uses ? thr : null,
          usage_source_line: uses ? (usageLine.trim() || lineName || null) : null,
        }, { onConflict: 'checklist_id' })
      }

      // อัพโหลดรูปอ้างอิงต่อจุด (ที่เพิ่งแนบใหม่) ก่อน insert
      const cpImagePaths = {}
      for (const c of checkpoints) {
        if (!c._imgFile) continue
        const ext = (c._imgFile.name?.split('.').pop() || 'jpg').toLowerCase()
        const p = `jigs/${jigId}/cp-${c._key}.${ext}`
        const { error: imgErr } = await supabaseDR.storage.from('jig-images').upload(p, c._imgFile, { upsert: true })
        if (imgErr) throw imgErr
        cpImagePaths[c._key] = p
      }

      // save ตามลำดับกลุ่ม (Item) → sort_order สอดคล้องกับหน้า execution/export
      const { named, ordered } = groupCheckpoints(checkpoints)
      const groupOrderMap = Object.fromEntries(named.map((g, i) => [g.name, i]))

      await supabaseDR.from('jig_checkpoints').delete().eq('checklist_id', cl.id)
      if (ordered.length > 0) {
        const { error: cpErr } = await supabaseDR.from('jig_checkpoints').insert(
          ordered.map((c, i) => ({
            checklist_id: cl.id, jig_id: jigId, name: c.name.trim(), type: c.type,
            axis: c.type === 'variable' ? (c.axis ?? null) : null,
            category: c.category ?? null, checking_method: c.checking_method ?? null, unit: c.unit || null,
            nominal: c.nominal !== '' && c.nominal != null ? Number(c.nominal) : null,
            lsl: c.lsl !== '' && c.lsl != null ? Number(c.lsl) : null,
            usl: c.usl !== '' && c.usl != null ? Number(c.usl) : null,
            lcl: c.lcl !== '' && c.lcl != null ? Number(c.lcl) : null,
            ucl: c.ucl !== '' && c.ucl != null ? Number(c.ucl) : null,
            x_pos: layoutType === 'list' ? null : (c.x_pos ?? null),
            y_pos: layoutType === 'list' ? null : (c.y_pos ?? null),
            image_id: layoutType === 'list' ? null : (frameIdByKey[c._frameKey] ?? frameIdByKey[resolvedFrames[0]?.key] ?? null),
            sort_order: i,
            group_name: (c.group_name || '').trim() || null,
            group_order: groupOrderMap[(c.group_name || '').trim()] ?? null,
            description: (c.description || '').trim() || null,
            image_path: cpImagePaths[c._key] ?? c.image_path ?? null,
          }))
        )
        if (cpErr) throw cpErr
      }
      // เก็บกวาดไฟล์เฟรม/รูปจุดตรวจที่ถูกถอดออกในรอบแก้ไขนี้ — ลบหลัง DB สำเร็จเท่านั้น (best-effort, กติกา CLAUDE.md)
      {
        const finalPaths = new Set([
          ...resolvedFrames.map(f => f.path),
          ...checkpoints.map(c => cpImagePaths[c._key] ?? c.image_path).filter(Boolean),
        ])
        const stale = [...initialImagePathsRef.current].filter(p => !finalPaths.has(p) && p.startsWith('jigs/'))
        if (stale.length) supabaseDR.storage.from('jig-images').remove(stale).catch(() => {})
        initialImagePathsRef.current = finalPaths
      }
      toast.success('บันทึกสำเร็จ')
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const deptColor = pmTeamsSync().find(t => t.key === department)?.color || DEPT_COLORS[department] || '#3dd65c'
  const deptLabel = pmTeamsSync().find(t => t.key === department)?.label ?? DEPT_LABEL[department] ?? department
  const pinnedCount = checkpoints.filter(c => c.x_pos != null).length

  // จัดกลุ่มสำหรับ render + label "Item.sub" (เช่น 1.3) ให้การ์ดกับ pin ตรงกัน
  const grouped = groupCheckpoints(checkpoints)
  const cpLabels = {}
  grouped.named.forEach((g, gi) => g.items.forEach((c, j) => { cpLabels[c._key] = `${gi + 1}.${j + 1}` }))
  {
    const namedCount = grouped.named.reduce((s, g) => s + g.items.length, 0)
    grouped.ungrouped.forEach((c, k) => { cpLabels[c._key] = String(namedCount + k + 1) })
  }
  const groupHeaderStyle = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6,
    background: 'var(--accent-dim)', border: '1px solid var(--border2)',
    fontSize: 12, fontWeight: 800, color: 'var(--accent)',
  }
  // กรองหมวดตามชนิดอุปกรณ์ที่กำลังตั้ง (facility/utility → 'facility', ไม่งั้นใช้ equipment_type)
  // equip_types ว่าง/null = หมวดกลาง โชว์ทุกชนิด
  const catScopeKey = (equipCategory === 'facility' || equipCategory === 'utility') ? 'facility' : equipType
  const scopedCategories = (categories ?? []).filter(c => !c.equip_types?.length || c.equip_types.includes(catScopeKey))
  const renderCard = (cp) => (
    <CheckpointCard key={cp._key} cp={cp} label={cpLabels[cp._key]}
      onChange={patch => updateCp(cp._key, patch)} onDelete={() => deleteCp(cp._key)}
      onDuplicate={() => duplicateCp(cp._key)} onCpImage={e => handleCpImage(cp._key, e)}
      isPinning={activePinKey === cp._key} onPinToggle={() => togglePin(cp._key)} hasImage={frames.length > 0}
      categories={scopedCategories} allCategories={categories} methods={methods} />
  )

  return (
    <div style={S.overlay}>
      <motion.div style={S.modal} onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ duration: 0.18 }}>
        {/* Header */}
        <div style={S.modalHead}>
          <div>
            <h2 style={S.modalTitle}>{isEdit ? 'แก้ไขอุปกรณ์' : 'เพิ่มอุปกรณ์ใหม่'}</h2>
            <span style={{ fontSize: 12, color: deptColor }}>{deptLabel}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={S.modalBody}>
          {!isEdit && (
            <div>
              <label style={S.label}>ประเภทการเพิ่ม</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleModeSwitch('workstation')} style={S.modeBtn(addMode === 'workstation')}>🏭 เลือกจาก Floor Map</button>
                <button onClick={() => handleModeSwitch('manual')} style={S.modeBtn(addMode === 'manual')}>➕ Facility / อื่นๆ</button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                {addMode === 'workstation' ? 'เลือกเครื่องจักรจริงจาก Daily Report Machine Master' : 'เพิ่มเครื่องจักร/JIG ที่ไม่ได้อยู่ใน Machine Master เช่น Air Pump, Compressor'}
              </p>
            </div>
          )}

          {addMode === 'workstation' && !isEdit && (
            <div>
              <label style={S.label}>เลือกเครื่องจักร ({machineOptions.length} ตัว)</label>
              <select value={machineId ?? ''} onChange={e => handleMachineSelect(e.target.value || null)} style={{ width: '100%' }}>
                <option value="">— เลือกเครื่องจักร —</option>
                {Object.entries(machinesByLine).sort(([a], [b]) => a.localeCompare(b)).map(([line, ms]) => (
                  <optgroup key={line} label={`📍 ${line}`}>
                    {ms.map(m => <option key={m.id} value={m.id}>{m.machine_no}{m.machine_name ? ` — ${m.machine_name}` : ''}</option>)}
                  </optgroup>
                ))}
              </select>
              {machineId && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6, fontSize: 12, color: 'var(--text2)' }}>
                  ✅ <strong style={{ color: 'var(--text)' }}>{name}</strong>{lineName && <span style={{ color: 'var(--muted)' }}> · {lineName}</span>}
                </div>
              )}
            </div>
          )}

          <div>
            <label style={S.label}>ประเภทอุปกรณ์</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(EQUIP_TYPE_LABEL).map(([k, v]) => (
                <button key={k} onClick={() => setEquipType(k)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${equipType === k ? deptColor + '60' : 'var(--border2)'}`,
                  background: equipType === k ? deptColor + '18' : 'var(--bg3)',
                  color: equipType === k ? deptColor : 'var(--muted)',
                }}>{v}</button>
              ))}
            </div>
          </div>

          {addMode === 'manual' && (
            <div>
              <label style={S.label}>หมวดหมู่เครื่องจักร</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {Object.entries(CATEGORY_TYPE_META).map(([k, v]) => (
                  <button key={k} onClick={() => setEquipCategory(k)} style={{
                    flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${equipCategory === k ? v.color + '60' : 'var(--border2)'}`,
                    background: equipCategory === k ? v.color + '18' : 'var(--bg3)',
                    color: equipCategory === k ? v.color : 'var(--muted)',
                  }}>{v.icon} {v.label}</button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label style={S.label}>ชื่ออุปกรณ์ *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="เช่น JIG-001 ตรวจ Pin Diameter"
              readOnly={addMode === 'workstation' && !!machineId && !isEdit}
              style={{ opacity: (addMode === 'workstation' && !!machineId && !isEdit) ? 0.7 : 1 }} />
          </div>

          <div>
            <label style={S.label}>รายละเอียด (ไม่บังคับ)</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="คำอธิบายเพิ่มเติม" />
          </div>

          <div className="mgrid" style={S.inputRow}>
            {[
              { label: 'No./รหัส', val: jigNo, set: setJigNo, ph: 'JIG-001' },
              { label: 'Process', val: process, set: setProcess, ph: 'Welding' },
              { label: 'Model', val: model, set: setModel, ph: 'Model A' },
              { label: 'Part Name', val: partName, set: setPartName, ph: 'Pin A' },
              { label: 'Part No.', val: partNo, set: setPartNo, ph: 'P-0001' },
              { label: 'Machine No.', val: machineNo, set: setMachineNo, ph: 'M-01' },
            ].map(({ label, val, set, ph }) => (
              <div key={label}><label style={S.label}>{label}</label><input value={val} onChange={e => set(e.target.value)} placeholder={ph} /></div>
            ))}
          </div>

          {(addMode === 'manual' || isEdit) && (
            <div><label style={S.label}>ไลน์ / พื้นที่</label><input value={lineName} onChange={e => setLineName(e.target.value)} placeholder="เช่น Line-A, Utility Room" /></div>
          )}

          <div>
            <label style={S.label}>ความถี่การตรวจ ({deptLabel})</label>
            <div style={S.freqBtns}>
              {Object.entries(FREQ_LABEL).map(([v, lbl]) => <button key={v} onClick={() => setFrequency(v)} style={S.freqBtn(frequency === v)}>{lbl}</button>)}
            </div>
          </div>

          {/* Phase 2 — plan type: time / usage / hybrid */}
          <div>
            <label style={S.label}>รูปแบบแผน PM</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { v: 'time', label: '🗓️ ตามเวลา', hint: 'ครบรอบตามความถี่' },
                { v: 'usage', label: '📈 ตามการใช้งาน', hint: 'ครบเมื่อผลิตถึงยอด' },
                { v: 'hybrid', label: '⚖️ ผสม', hint: 'อันไหนถึงก่อนใช้อันนั้น' },
              ].map(({ v, label, hint }) => (
                <button key={v} onClick={() => setPlanType(v)} title={hint} style={S.modeBtn(planType === v)}>{label}</button>
              ))}
            </div>
            {(planType === 'time' || planType === 'hybrid') && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                🗓️ <b>ตามเวลา</b> = ใช้รอบจาก “ความถี่การตรวจ” ด้านบน (ตอนนี้: <b style={{ color: 'var(--accent)' }}>{FREQ_LABEL[frequency] ?? frequency}</b>) → ครบกำหนด = วันตรวจล่าสุด + รอบนั้น
              </div>
            )}
            {(planType === 'usage' || planType === 'hybrid') && (
              <div className="mgrid" style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={S.label}>ครบเมื่อผลิตถึง (ชิ้น)</label>
                  <input type="number" min="1" value={usageThreshold} onChange={e => setUsageThreshold(e.target.value)} placeholder="เช่น 50000" />
                </div>
                <div>
                  <label style={S.label}>นับยอดจากไลน์</label>
                  <select value={usageLine} onChange={e => setUsageLine(e.target.value)}>
                    <option value="">— ใช้ไลน์ของอุปกรณ์{lineName ? ` (${lineName})` : ''} —</option>
                    {(usageLine && !lineOptions.includes(usageLine) ? [usageLine, ...lineOptions] : lineOptions).map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)' }}>
                  ระบบนับ prod_orders.qty ของไลน์นี้ตั้งแต่ PM ครั้งก่อน เทียบ threshold → คำนวณวันครบ + health score · เลือกไลน์จากฐานข้อมูลไลน์ผลิต (เว้นว่าง = ใช้ไลน์ของอุปกรณ์)
                </div>
              </div>
            )}
          </div>

          <div>
            <label style={S.label}>รูปแบบ Check Sheet</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ v: 'image_pin', label: '📍 รูป + จุดตรวจ' }, { v: 'list', label: '📋 รายการหัวข้อ' }].map(({ v, label }) => (
                <button key={v} onClick={() => setLayoutType(v)} style={S.modeBtn(layoutType === v)}>{label}</button>
              ))}
            </div>
          </div>

          {layoutType === 'image_pin' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ ...S.label, marginBottom: 0 }}>รูปอุปกรณ์ (หลายมุม) + จุดตรวจ</label>
                {frames.length > 0 && pinnedCount > 0 && <span style={{ fontSize: 11, color: 'var(--accent)' }}>📍 {pinnedCount}/{checkpoints.length} จุดวางแล้ว</span>}
              </div>
              <SpinAnnotator
                frames={frames} frameIdx={frameIdx} setFrameIdx={setFrameIdx}
                arming={!!activePinKey} busy={imgBusy}
                pins={grouped.ordered
                  .filter(c => c.x_pos != null && ((c._frameKey ?? frames[0]?._key) === frames[frameIdx]?._key))
                  .map(c => ({ key: c._key, x: c.x_pos, y: c.y_pos, label: cpLabels[c._key],
                    color: activePinKey === c._key ? 'var(--accent)' : categoryColor(c.category) }))}
                onPlace={(x, y) => { updateCp(activePinKey, { x_pos: x, y_pos: y, _frameKey: frames[frameIdx]?._key ?? null }); setActivePinKey(null) }}
                onRemovePin={(key) => { updateCp(key, { x_pos: null, y_pos: null }); if (activePinKey === key) setActivePinKey(null) }}
                onAddFrames={addFrames} onRemoveFrame={removeFrame} />
              {activePinKey && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>✦ หมุนไปเฟรมที่เห็นจุดชัด แล้วคลิกวางตำแหน่ง</p>}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ ...S.label, marginBottom: 0 }}>จุดตรวจสอบ ({checkpoints.length})</label>
              <button onClick={addCp} style={{ ...S.btnSm('var(--accent)'), fontSize: 12 }}>+ เพิ่มจุดตรวจ</button>
            </div>
            <datalist id="cp-group-options">
              {[...new Set(checkpoints.map(c => (c.group_name || '').trim()).filter(Boolean))].map(g => <option key={g} value={g} />)}
            </datalist>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grouped.named.map((g, gi) => (
                <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={groupHeaderStyle}>Item {gi + 1} — {g.name} <span style={{ fontWeight: 600, color: 'var(--muted)' }}>({g.items.length} จุด)</span></div>
                  {g.items.map(renderCard)}
                </div>
              ))}
              {grouped.named.length > 0 && grouped.ungrouped.length > 0 && (
                <div style={{ ...groupHeaderStyle, background: 'var(--bg3)', color: 'var(--muted)' }}>ไม่ระบุกลุ่ม</div>
              )}
              {grouped.ungrouped.map(renderCard)}
            </div>
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
        </div>

        <div style={S.modalFoot}>
          <button onClick={onClose} style={S.cancelBtn}>ยกเลิก</button>
          <button onClick={handleSave} disabled={saving} style={{ ...S.saveBtn, opacity: saving ? 0.6 : 1 }}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── EquipmentCard ────────────────────────────────────────────────────────────
function EquipmentCard({ jig, cpCount, hasPins, onEdit, onDelete, canSetup }) {
  const typeColor = { jig: '#3dd65c', die: '#4d9fff', machine: '#f59a3f', fixture: '#9b8de8', tool: '#e05c4a' }
  const color = typeColor[jig.equipment_type] ?? '#527855'
  const catMeta = CATEGORY_TYPE_META[jig.equipment_category] ?? CATEGORY_TYPE_META.production
  const imgUrl = getPublicUrl(jig.image_path)
  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={S.card}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border2)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
      <div style={S.cardImg}>
        {imgUrl ? <img src={imgUrl} alt={jig.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, opacity: 0.3 }}>{jig.layout_type === 'list' ? '📋' : '🔩'}</div>
        )}
      </div>
      <div style={S.cardBody}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={S.cardTitle}>{jig.name}</h3>
          <div style={{ display: 'flex', gap: 4, flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={S.tag(color)}>{EQUIP_TYPE_LABEL[jig.equipment_type] ?? jig.equipment_type}</span>
            {jig.equipment_category && jig.equipment_category !== 'production' && <span style={S.tag(catMeta.color)}>{catMeta.icon} {catMeta.label}</span>}
          </div>
        </div>
        {jig.jig_no && <p style={S.meta}>No. {jig.jig_no}</p>}
        {jig.line_name && <p style={S.meta}>📍 {jig.line_name}{jig.machine_no ? ` · ${jig.machine_no}` : ''}</p>}
        {jig.machine_id && <p style={{ ...S.meta, color: 'var(--accent)' }}>🔗 เชื่อมกับ Machine Master</p>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{cpCount}</span> จุดตรวจ
            {hasPins && <span style={{ marginLeft: 6 }}>📍</span>}
          </div>
          {canSetup && (
            <div style={S.actions}>
              <button onClick={onEdit} style={S.btnSm('var(--accent)')}>แก้ไข</button>
              <button className="tbtn" onClick={onDelete} style={S.btnSm('var(--red)')}>ลบ</button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─── PMSetup (main) ───────────────────────────────────────────────────────────
export default function PMSetup() {
  const { role } = useContext(UserContext)
  const canSetup = can('pm', 'setup', role)
  const [searchParams, setSearchParams] = useSearchParams()
  const department = searchParams.get('dept') || 'maintenance'
  const [jigs, setJigs] = useState([])
  const [cpCounts, setCpCounts] = useState({})
  const [pinFlags, setPinFlags] = useState({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editJig, setEditJig] = useState(null)
  const [categories, setCategories] = useState([])
  const [methods, setMethods] = useState([])
  const [taxModal, setTaxModal] = useState(null) // 'category' | 'method' | null
  const [teams, setTeams] = useState(pmTeamsSync()) // ทีมช่าง data-driven (mtn_teams)
  useEffect(() => { loadPmTeams().then(setTeams) }, [])

  const loadTaxonomy = () => {
    fetchCategories().then(setCategories)
    fetchCheckingMethods().then(setMethods)
  }
  useEffect(() => { loadTaxonomy() }, [])

  const setDept = (d) => setSearchParams({ dept: d })

  const fetchData = async () => {
    setLoading(true)
    const { data: jigData } = await supabaseDR.from('jigs').select('*').eq('module', 'mtn').order('created_at', { ascending: false })

    const { data: checklists } = await supabaseDR.from('checklists').select('id, equipment_id').eq('module', 'mtn').eq('department', department)
    const clMap = {}
    ;(checklists ?? []).forEach(c => { clMap[c.equipment_id] = c.id })
    const clIds = Object.values(clMap)

    let counts = {}, pins = {}
    if (clIds.length > 0) {
      const { data: cps } = await supabaseDR.from('jig_checkpoints').select('checklist_id, x_pos').in('checklist_id', clIds)
      ;(cps ?? []).forEach(c => {
        const eqId = Object.keys(clMap).find(k => clMap[k] === c.checklist_id)
        if (!eqId) return
        counts[eqId] = (counts[eqId] ?? 0) + 1
        if (c.x_pos != null) pins[eqId] = true
      })
    }

    // show only equipment that has a checklist in the selected department
    // (each dept tab = its own responsibility; equipment "belongs" via its checklist)
    setJigs((jigData ?? []).filter(j => clMap[j.id]))
    setCpCounts(counts)
    setPinFlags(pins)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [department]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (jig) => {
    if (!confirm(`ลบ "${jig.name}" ?`)) return
    const { error } = await supabaseDR.from('jigs').delete().eq('id', jig.id)
    if (error) { toast.error(error.message); return }
    // ลบ jig สำเร็จแล้ว เก็บกวาดรูปทั้งชุดของ jig นี้ (frame-*/cp-* อยู่ใต้ jigs/<id>/) กันไฟล์กำพร้าใน storage (best-effort)
    try {
      const folder = `jigs/${jig.id}`
      const { data: files } = await supabaseDR.storage.from('jig-images').list(folder, { limit: 1000 })
      const paths = (files ?? []).map(f => `${folder}/${f.name}`)
      if (jig.image_path && !paths.includes(jig.image_path)) paths.push(jig.image_path) // เผื่อ path เก่านอกโฟลเดอร์ (legacy)
      if (jig.model_path && !paths.includes(jig.model_path)) paths.push(jig.model_path) // โมเดล 3D อยู่ที่ models/<id>.glb (นอกโฟลเดอร์ jigs/)
      if (paths.length) await supabaseDR.storage.from('jig-images').remove(paths)
    } catch { /* ลบรูปพลาดไม่ต้องกระทบ flow หลัก */ }
    toast.success('ลบแล้ว')
    fetchData()
  }

  const openCreate = () => { setEditJig(null); setShowModal(true) }
  const openEdit = (jig) => { setEditJig(jig); setShowModal(true) }
  const handleSaved = () => { setShowModal(false); fetchData() }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>PM Setup — อุปกรณ์ & จุดตรวจ</h1>
          <p style={S.sub}>{jigs.length} อุปกรณ์ · แผนก {teams.find(t => t.key === department)?.label ?? DEPT_LABEL[department] ?? department}</p>
        </div>
        {canSetup && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setTaxModal('category')} style={S.btnSm('var(--muted)')}>⚙ ประเภท</button>
            <button onClick={() => setTaxModal('method')} style={S.btnSm('var(--muted)')}>⚙ วิธีตรวจ</button>
            <button onClick={openCreate} style={S.primaryBtn}>+ เพิ่มอุปกรณ์</button>
          </div>
        )}
      </div>

      <div style={S.deptBar}>
        {teams.map(d => <button key={d.key} onClick={() => setDept(d.key)} style={S.deptBtn(department === d.key, d.color || DEPT_COLORS[d.key] || '#3dd65c')}>{d.icon ? `${d.icon} ` : ''}{d.label}</button>)}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <div style={{ width: 32, height: 32, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : jigs.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔩</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>ยังไม่มีอุปกรณ์</p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>กดปุ่ม "เพิ่มอุปกรณ์" เพื่อเริ่มต้น</p>
          {canSetup && <button onClick={openCreate} style={S.primaryBtn}>+ เพิ่มอุปกรณ์</button>}
        </div>
      ) : (
        <div style={S.grid}>
          {jigs.map(jig => (
            <EquipmentCard key={jig.id} jig={jig} canSetup={canSetup} cpCount={cpCounts[jig.id] ?? 0} hasPins={!!pinFlags[jig.id]}
              onEdit={() => openEdit(jig)} onDelete={() => handleDelete(jig)} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showModal && <EquipmentModal onClose={() => setShowModal(false)} onSaved={handleSaved} editJig={editJig} department={department} categories={categories} methods={methods} />}
        {taxModal === 'category' && (
          <TaxonomyManagerModal table="pm_checkpoint_categories" title="จัดการประเภทจุดตรวจ (Category)" extraField="color" withEquipTypes
            onClose={() => setTaxModal(null)} onChanged={loadTaxonomy} />
        )}
        {taxModal === 'method' && (
          <TaxonomyManagerModal table="pm_checking_methods" title="จัดการวิธีการตรวจสอบ" extraField="icon"
            onClose={() => setTaxModal(null)} onChanged={loadTaxonomy} />
        )}
      </AnimatePresence>

    </div>
  )
}
