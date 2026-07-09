import { useState, useEffect, useRef, useContext } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import imageCompression from 'browser-image-compression'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { FREQ_LABEL, DEPT_LABEL, EQUIP_TYPE_LABEL } from '../lib/pmSchedule'
import { getOrCreateChecklist, setChecklistFrequency } from '../lib/pmChecklists'
import { fetchCategories, fetchCheckingMethods, categoryColor } from '../lib/pmTaxonomy'
import TaxonomyManagerModal from '../components/TaxonomyManagerModal'

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

function newCheckpoint() {
  return {
    _key: crypto.randomUUID(), name: '', type: 'variable',
    axis: null, category: null, checking_method: null, unit: '', nominal: '', lsl: '', usl: '', lcl: '', ucl: '',
    x_pos: null, y_pos: null,
  }
}

function getPublicUrl(path) {
  if (!path) return null
  return supabaseDR.storage.from('jig-images').getPublicUrl(path).data.publicUrl
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page: { padding: '28px 32px', minHeight: '100%', background: 'var(--bg)' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 },
  h1: { fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 },
  sub: { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  deptBar: { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  deptBtn: (active, color) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`,
    background: active ? `${color}18` : 'var(--bg3)',
    color: active ? color : 'var(--muted)',
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 },
  card: {
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'border-color 0.2s',
  },
  cardImg: { height: 130, background: 'var(--bg2)', position: 'relative', overflow: 'hidden' },
  cardBody: { padding: 14, display: 'flex', flexDirection: 'column', gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 },
  tag: (color) => ({
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
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
    zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modal: {
    background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12,
    width: '100%', maxWidth: 680, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
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

// ─── ImageAnnotator (upload + click-to-pin) ────────────────────────────────────
function ImageAnnotator({ imageUrl, checkpoints, activePinKey, onImageClick, onPinRemove }) {
  const containerRef = useRef(null)
  const handleClick = (e) => {
    if (!activePinKey) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    onImageClick(x, y)
  }
  return (
    <div ref={containerRef} onClick={handleClick} style={{
      position: 'relative', userSelect: 'none', borderRadius: 8, overflow: 'hidden',
      border: `2px solid ${activePinKey ? 'var(--accent)' : 'var(--border)'}`,
      cursor: activePinKey ? 'crosshair' : 'default',
    }}>
      <img src={imageUrl} alt="JIG" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', background: 'var(--bg2)', display: 'block' }} />
      {checkpoints.map((cp, i) => {
        if (cp.x_pos == null || cp.y_pos == null) return null
        const isActive = activePinKey === cp._key
        const col = isActive ? 'var(--accent)' : categoryColor(cp.category)
        return (
          <button key={cp._key}
            style={{ position: 'absolute', left: `${cp.x_pos * 100}%`, top: `${cp.y_pos * 100}%`, transform: 'translate(-50%,-100%)', zIndex: 10, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
            onClick={e => { e.stopPropagation(); onPinRemove(cp._key) }}
            title={`${cp.name || `จุด ${i + 1}`} — คลิกเพื่อลบ`}
          >
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: col, border: '2px solid #fff', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }}>{i + 1}</div>
          </button>
        )
      })}
      {activePinKey && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 8, pointerEvents: 'none' }}>
          <span style={{ padding: '5px 12px', borderRadius: 20, background: 'var(--accent)', color: '#071008', fontSize: 11, fontWeight: 700 }}>📍 คลิกที่รูปเพื่อวางตำแหน่ง</span>
        </div>
      )}
    </div>
  )
}

// ─── CheckpointCard ───────────────────────────────────────────────────────────
function CheckpointCard({ cp, index, onChange, onDelete, isPinning, onPinToggle, hasImage, categories, methods }) {
  const isVar = cp.type === 'variable'
  return (
    <div style={{ ...S.cpCard, borderColor: isPinning ? 'var(--accent)' : 'var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg3)', color: 'var(--muted)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{index + 1}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>จุดตรวจสอบ</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasImage && (
            <button onClick={onPinToggle} style={{
              padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${isPinning ? 'var(--accent)' : cp.x_pos != null ? 'var(--accent)' : 'var(--border2)'}`,
              background: isPinning ? 'var(--accent)' : cp.x_pos != null ? 'var(--accent-dim)' : 'var(--bg3)',
              color: isPinning ? '#071008' : cp.x_pos != null ? 'var(--accent)' : 'var(--muted)',
            }}>{cp.x_pos != null ? '📍 วางแล้ว' : '🔘 วางตำแหน่ง'}</button>
          )}
          <button onClick={onDelete} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: '0 2px', cursor: 'pointer' }}>×</button>
        </div>
      </div>

      <input value={cp.name} onChange={e => onChange({ name: e.target.value })} placeholder="ชื่อจุดตรวจสอบ เช่น Pin Diameter" style={{ marginBottom: 8 }} />

      <div style={S.inputRow}>
        <div style={{ marginBottom: 10 }}>
          <label style={S.label}>ประเภท (Category)</label>
          <select value={cp.category ?? ''} onChange={e => onChange({ category: e.target.value || null })}>
            <option value="">— ไม่ระบุ —</option>
            {(categories ?? []).map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
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

      <div style={{ display: 'flex', gap: 6, marginBottom: isVar ? 10 : 0 }}>
        {['variable', 'attribute', 'note'].map(t => {
          const colors = { variable: '#4d9fff', attribute: '#9b8de8', note: '#f59a3f' }
          return (
            <button key={t} onClick={() => onChange({ type: t })} style={S.typeBtn(cp.type === t, colors[t])}>
              {t === 'variable' ? '📏 Variable' : t === 'attribute' ? '✅ OK/NG' : '📝 Note'}
            </button>
          )
        })}
      </div>

      {isVar && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4, textTransform: 'uppercase' }}>Axis</span>
            {[null, 'X', 'Y'].map(a => (
              <button key={String(a)} onClick={() => onChange({ axis: a })} style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${cp.axis === a ? 'var(--accent)' : 'var(--border)'}`,
                background: cp.axis === a ? 'var(--accent-dim)' : 'var(--bg3)',
                color: cp.axis === a ? 'var(--accent)' : 'var(--muted)',
              }}>{a === null ? '—' : a}</button>
            ))}
          </div>
          <div style={S.inputRow}>
            <div><label style={S.label}>Nominal</label><input type="number" value={cp.nominal} onChange={e => onChange({ nominal: e.target.value })} placeholder="0" /></div>
            <div><label style={S.label}>Unit</label><input value={cp.unit} onChange={e => onChange({ unit: e.target.value })} placeholder="mm" /></div>
          </div>
          <div style={S.inputRow}>
            <div><label style={{ ...S.label, color: '#e05c4a' }}>LSL</label><input type="number" value={cp.lsl} onChange={e => onChange({ lsl: e.target.value })} placeholder="—" /></div>
            <div><label style={{ ...S.label, color: '#e05c4a' }}>USL</label><input type="number" value={cp.usl} onChange={e => onChange({ usl: e.target.value })} placeholder="—" /></div>
          </div>
          <div style={S.inputRow}>
            <div><label style={{ ...S.label, color: '#f59a3f' }}>LCL</label><input type="number" value={cp.lcl} onChange={e => onChange({ lcl: e.target.value })} placeholder="—" /></div>
            <div><label style={{ ...S.label, color: '#f59a3f' }}>UCL</label><input type="number" value={cp.ucl} onChange={e => onChange({ ucl: e.target.value })} placeholder="—" /></div>
          </div>
        </div>
      )}

      {!isVar && (
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <span style={{ padding: '3px 10px', borderRadius: 6, background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, border: '1px solid var(--accent)' }}>OK</span>
          <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(224,92,74,0.1)', color: '#e05c4a', fontSize: 11, fontWeight: 700, border: '1px solid rgba(224,92,74,0.3)' }}>NG</span>
          {cp.type === 'note' && <span style={{ padding: '3px 10px', borderRadius: 6, background: 'var(--bg3)', color: 'var(--muted)', fontSize: 11, border: '1px solid var(--border)' }}>+ ข้อความ</span>}
        </div>
      )}
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
  const [checkpoints, setCheckpoints] = useState([])
  const [layoutType, setLayoutType] = useState(editJig?.layout_type ?? 'image_pin')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(editJig?.image_path ? getPublicUrl(editJig.image_path) : null)
  const [activePinKey, setActivePinKey] = useState(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getCurrentUserId().then(setUserId)
    supabaseDR.from('machines').select('id, line_name, machine_no, machine_name').order('line_name').order('sort_order')
      .then(({ data }) => setMachineOptions(data ?? []))
  }, [])

  useEffect(() => {
    if (!editJig || !userId) return
    getOrCreateChecklist(editJig.id, 'mtn', department, userId).then(async (cl) => {
      if (!cl) return
      setFrequency(cl.frequency)
      const { data: cps } = await supabaseDR.from('jig_checkpoints').select('*').eq('checklist_id', cl.id).order('sort_order')
      setCheckpoints((cps ?? []).map(c => ({ ...c, _key: c.id })))
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

  const handleImage = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const compressed = await imageCompression(file, { maxSizeMB: 0.3, maxWidthOrHeight: 1200 })
    setImageFile(compressed)
    setImagePreview(URL.createObjectURL(compressed))
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('กรุณาใส่ชื่ออุปกรณ์'); return }
    if (addMode === 'workstation' && !isEdit && !machineId) { setError('กรุณาเลือกเครื่องจักรจาก Floor Map'); return }
    if (checkpoints.some(c => !c.name.trim())) { setError('กรุณาใส่ชื่อทุกจุดตรวจสอบ'); return }
    setSaving(true); setError('')
    try {
      const jigId = editJig?.id ?? crypto.randomUUID()
      let imagePath = layoutType === 'list' ? null : (editJig?.image_path ?? null)

      if (layoutType === 'image_pin' && imageFile) {
        const ext = imageFile.name.split('.').pop()
        imagePath = `jigs/${jigId}/jig.${ext}`
        const { error: uploadErr } = await supabaseDR.storage.from('jig-images').upload(imagePath, imageFile, { upsert: true })
        if (uploadErr) throw uploadErr
      }

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

      const cl = await getOrCreateChecklist(jigId, 'mtn', department, userId)
      if (!cl) throw new Error('Failed to create checklist')
      await setChecklistFrequency(cl.id, frequency)
      await supabaseDR.from('jig_checkpoints').delete().eq('checklist_id', cl.id)
      if (checkpoints.length > 0) {
        const { error: cpErr } = await supabaseDR.from('jig_checkpoints').insert(
          checkpoints.map((c, i) => ({
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
            sort_order: i,
          }))
        )
        if (cpErr) throw cpErr
      }
      toast.success('บันทึกสำเร็จ')
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const deptColor = DEPT_COLORS[department] ?? '#3dd65c'
  const pinnedCount = checkpoints.filter(c => c.x_pos != null).length

  return (
    <div style={S.overlay}>
      <motion.div style={S.modal} onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ duration: 0.18 }}>
        {/* Header */}
        <div style={S.modalHead}>
          <div>
            <h2 style={S.modalTitle}>{isEdit ? 'แก้ไขอุปกรณ์' : 'เพิ่มอุปกรณ์ใหม่'}</h2>
            <span style={{ fontSize: 12, color: deptColor }}>{DEPT_LABEL[department] ?? department}</span>
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

          <div style={S.inputRow}>
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
            <label style={S.label}>ความถี่การตรวจ ({DEPT_LABEL[department]})</label>
            <div style={S.freqBtns}>
              {Object.entries(FREQ_LABEL).map(([v, lbl]) => <button key={v} onClick={() => setFrequency(v)} style={S.freqBtn(frequency === v)}>{lbl}</button>)}
            </div>
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
                <label style={{ ...S.label, marginBottom: 0 }}>รูป JIG</label>
                {imagePreview && pinnedCount > 0 && <span style={{ fontSize: 11, color: 'var(--accent)' }}>📍 {pinnedCount}/{checkpoints.length} จุดวางแล้ว</span>}
              </div>
              {!imagePreview ? (
                <label style={{ display: 'block', cursor: 'pointer' }}>
                  <input type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
                  <div style={{ borderRadius: 8, border: '2px dashed var(--border2)', height: 110, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--muted)' }}>
                    <span style={{ fontSize: 24 }}>📷</span>
                    <span style={{ fontSize: 13 }}>คลิกเพื่ออัพโหลดรูป JIG</span>
                  </div>
                </label>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <ImageAnnotator imageUrl={imagePreview} checkpoints={checkpoints} activePinKey={activePinKey}
                    onImageClick={(x, y) => { updateCp(activePinKey, { x_pos: x, y_pos: y }); setActivePinKey(null) }}
                    onPinRemove={(key) => { updateCp(key, { x_pos: null, y_pos: null }); if (activePinKey === key) setActivePinKey(null) }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>{activePinKey ? '✦ คลิกที่รูปเพื่อวางหมายเลข' : 'กดปุ่ม "วางตำแหน่ง" ที่จุดตรวจด้านล่าง'}</p>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <label style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}><input type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />เปลี่ยนรูป</label>
                      <button onClick={() => { setImageFile(null); setImagePreview(null); setActivePinKey(null) }} style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}>ลบรูป</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ ...S.label, marginBottom: 0 }}>จุดตรวจสอบ ({checkpoints.length})</label>
              <button onClick={addCp} style={{ ...S.btnSm('var(--accent)'), fontSize: 12 }}>+ เพิ่มจุดตรวจ</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {checkpoints.map((cp, i) => (
                <CheckpointCard key={cp._key} cp={cp} index={i}
                  onChange={patch => updateCp(cp._key, patch)} onDelete={() => deleteCp(cp._key)}
                  isPinning={activePinKey === cp._key} onPinToggle={() => togglePin(cp._key)} hasImage={!!imagePreview}
                  categories={categories} methods={methods} />
              ))}
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
              <button onClick={onDelete} style={S.btnSm('var(--red)')}>ลบ</button>
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

    setJigs(jigData ?? [])
    setCpCounts(counts)
    setPinFlags(pins)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [department]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (jig) => {
    if (!confirm(`ลบ "${jig.name}" ?`)) return
    if (jig.image_path) await supabaseDR.storage.from('jig-images').remove([jig.image_path])
    await supabaseDR.from('jigs').delete().eq('id', jig.id)
    toast.success('ลบแล้ว')
    fetchData()
  }

  const openCreate = () => { setEditJig(null); setShowModal(true) }
  const openEdit = (jig) => { setEditJig(jig); setShowModal(true) }
  const handleSaved = () => { setShowModal(false); fetchData() }

  const DEPT_OPTIONS = [
    { key: 'maintenance', label: 'ซ่อมบำรุง' },
    { key: 'jig_maintenance', label: 'JIG Maintenance' },
    { key: 'die_maintenance', label: 'Die Maintenance' },
    { key: 'production', label: 'ฝ่ายผลิต' },
  ]

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>PM Setup — อุปกรณ์ & จุดตรวจ</h1>
          <p style={S.sub}>{jigs.length} อุปกรณ์ · แผนก {DEPT_LABEL[department] ?? department}</p>
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
        {DEPT_OPTIONS.map(d => <button key={d.key} onClick={() => setDept(d.key)} style={S.deptBtn(department === d.key, DEPT_COLORS[d.key] ?? '#3dd65c')}>{d.label}</button>)}
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
          <TaxonomyManagerModal table="pm_checkpoint_categories" title="จัดการประเภทจุดตรวจ (Category)" extraField="color"
            onClose={() => setTaxModal(null)} onChanged={loadTaxonomy} />
        )}
        {taxModal === 'method' && (
          <TaxonomyManagerModal table="pm_checking_methods" title="จัดการวิธีการตรวจสอบ" extraField="icon"
            onClose={() => setTaxModal(null)} onChanged={loadTaxonomy} />
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
