import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../supabaseClient'
import { toast } from '../components/Toast'
import { FREQ_LABEL, DEPT_LABEL, EQUIP_TYPE_LABEL } from '../lib/pmSchedule'

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

async function getOrCreateChecklist(equipmentId, department, userId) {
  const { data: existing } = await supabase
    .from('pm_checklists')
    .select('id, frequency')
    .eq('equipment_id', equipmentId)
    .eq('module', 'mtn')
    .eq('department', department)
    .maybeSingle()
  if (existing) return existing

  const { data: created } = await supabase
    .from('pm_checklists')
    .insert({
      equipment_id: equipmentId,
      name: `Checklist ${DEPT_LABEL[department] ?? department}`,
      module: 'mtn',
      department,
      frequency: 'monthly',
      created_by: userId,
    })
    .select('id, frequency')
    .single()
  return created
}

function newCheckpoint() {
  return { _key: crypto.randomUUID(), name: '', type: 'attribute', unit: '', nominal: '', spec_min: '', spec_max: '' }
}

function inferEquipType(stationName) {
  const code = (stationName ?? '').split('-')[0].trim().toUpperCase()
  if (code.startsWith('J')) return 'jig'
  if (code.startsWith('RB')) return 'machine'
  if (code.startsWith('SP') || code.startsWith('SW') || code.startsWith('PANASONIC')) return 'machine'
  return 'machine'
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
    transition: 'all 0.18s',
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 },
  card: {
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    padding: 18, cursor: 'default', transition: 'border-color 0.2s',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 },
  tag: (color) => ({
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
    background: `${color}18`, color, border: `1px solid ${color}30`,
  }),
  meta: { fontSize: 12, color: 'var(--muted)' },
  actions: { display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 },
  btnSm: (color) => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: `1px solid ${color}30`, background: `${color}12`, color,
    cursor: 'pointer',
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
    width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)',
  },
  modalHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 24px', borderBottom: '1px solid var(--border)',
  },
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
  typeBtns: { display: 'flex', gap: 6 },
  typeBtn: (active, t) => {
    const colors = { variable: '#4d9fff', attribute: '#9b8de8', note: '#f59a3f' }
    const c = colors[t] ?? '#527855'
    return {
      flex: 1, padding: '7px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
      border: `1.5px solid ${active ? `${c}50` : 'var(--border)'}`,
      background: active ? `${c}15` : 'var(--bg3)',
      color: active ? c : 'var(--muted)',
    }
  },
  cpCard: { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 },
  cancelBtn: {
    flex: 1, padding: '9px 0', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600,
    background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', cursor: 'pointer',
  },
  saveBtn: {
    flex: 1, padding: '9px 0', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 700,
    background: 'var(--accent)', color: '#071008', border: 'none', cursor: 'pointer',
  },
  modeBtn: (active) => ({
    flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
    background: active ? 'var(--accent-dim)' : 'var(--bg3)',
    color: active ? 'var(--accent)' : 'var(--muted)',
    transition: 'all 0.15s',
  }),
}

const DEPT_COLORS = {
  maintenance:     '#fb923c',
  jig_maintenance: '#34d399',
  die_maintenance: '#4d9fff',
  production:      '#3dd65c',
  qa:              '#9b8de8',
}

const CATEGORY_META = {
  production: { label: 'Production', color: '#3dd65c', icon: '🏭' },
  facility:   { label: 'Facility',   color: '#f59a3f', icon: '🔧' },
  utility:    { label: 'Utility',    color: '#9b8de8', icon: '⚡' },
}

// ─── CheckpointCard ───────────────────────────────────────────────────────────
function CheckpointCard({ cp, index, onChange, onDelete }) {
  const isVar = cp.type === 'variable'
  return (
    <div style={S.cpCard}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>จุดตรวจที่ {index + 1}</span>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: '0 2px', cursor: 'pointer' }}>×</button>
      </div>
      <input
        value={cp.name}
        onChange={e => onChange({ name: e.target.value })}
        placeholder="ชื่อจุดตรวจสอบ เช่น Pin Diameter, Oil Level"
        style={{ marginBottom: 8 }}
      />
      <div style={{ ...S.typeBtns, marginBottom: isVar ? 10 : 0 }}>
        {['variable', 'attribute', 'note'].map(t => (
          <button key={t} onClick={() => onChange({ type: t })} style={S.typeBtn(cp.type === t, t)}>
            {t === 'variable' ? '📏 Variable' : t === 'attribute' ? '✅ OK/NG' : '📝 Note'}
          </button>
        ))}
      </div>
      {isVar && (
        <div style={S.inputRow}>
          <div>
            <label style={S.label}>Nominal</label>
            <input type="number" value={cp.nominal} onChange={e => onChange({ nominal: e.target.value })} placeholder="0" />
          </div>
          <div>
            <label style={S.label}>Unit</label>
            <input value={cp.unit} onChange={e => onChange({ unit: e.target.value })} placeholder="mm" />
          </div>
          <div>
            <label style={{ ...S.label, color: '#e05c4a' }}>Min (LSL)</label>
            <input type="number" value={cp.spec_min} onChange={e => onChange({ spec_min: e.target.value })} placeholder="—" />
          </div>
          <div>
            <label style={{ ...S.label, color: '#e05c4a' }}>Max (USL)</label>
            <input type="number" value={cp.spec_max} onChange={e => onChange({ spec_max: e.target.value })} placeholder="—" />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── EquipmentModal ───────────────────────────────────────────────────────────
function EquipmentModal({ onClose, onSaved, editEquip, department }) {
  const isEdit = !!editEquip
  const [userId, setUserId] = useState(null)

  // mode: 'workstation' = link to floor map | 'manual' = facility/utility
  const [addMode, setAddMode] = useState(isEdit ? 'manual' : 'workstation')

  // workstation picker
  const [workstationOptions, setWorkstationOptions] = useState([])
  const [workstationId, setWorkstationId] = useState(editEquip?.workstation_id ?? null)

  // equipment fields
  const [name, setName] = useState(editEquip?.name ?? '')
  const [jigNo, setJigNo] = useState(editEquip?.jig_no ?? '')
  const [process, setProcess] = useState(editEquip?.process ?? '')
  const [model, setModel] = useState(editEquip?.model ?? '')
  const [partName, setPartName] = useState(editEquip?.part_name ?? '')
  const [partNo, setPartNo] = useState(editEquip?.part_no ?? '')
  const [lineName, setLineName] = useState(editEquip?.line_name ?? '')
  const [machineNo, setMachineNo] = useState(editEquip?.machine_no ?? '')
  const [equipType, setEquipType] = useState(editEquip?.equipment_type ?? 'machine')
  const [equipCategory, setEquipCategory] = useState(editEquip?.equipment_category ?? 'production')

  // checklist fields
  const [frequency, setFrequency] = useState('monthly')
  const [checkpoints, setCheckpoints] = useState([newCheckpoint()])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getCurrentUserId().then(setUserId)
    // Load all workstations grouped by line for the dropdown
    supabase.from('workstations').select('id, station_name, line_name')
      .order('line_name').order('station_name')
      .then(({ data }) => setWorkstationOptions(data ?? []))
  }, [])

  useEffect(() => {
    if (!editEquip || !userId) return
    getOrCreateChecklist(editEquip.id, department, userId).then(async (cl) => {
      if (!cl) return
      setFrequency(cl.frequency)
      const { data: cps } = await supabase
        .from('pm_checkpoints').select('*')
        .eq('checklist_id', cl.id).order('sort_order')
      setCheckpoints((cps ?? []).map(c => ({
        _key: c.id, name: c.name, type: c.type,
        unit: c.unit ?? '', nominal: c.nominal ?? '', spec_min: c.spec_min ?? '', spec_max: c.spec_max ?? '',
      })))
    })
  }, [editEquip, department, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Group workstations by line for <optgroup>
  const wsGrouped = workstationOptions.reduce((acc, ws) => {
    const line = ws.line_name ?? 'ไม่ระบุไลน์'
    if (!acc[line]) acc[line] = []
    acc[line].push(ws)
    return acc
  }, {})

  const handleWorkstationSelect = (wsId) => {
    setWorkstationId(wsId)
    if (!wsId) { setName(''); setLineName(''); return }
    const ws = workstationOptions.find(w => w.id === wsId)
    if (!ws) return
    setName(ws.station_name)
    setLineName(ws.line_name ?? '')
    setEquipCategory('production')
    setEquipType(inferEquipType(ws.station_name))
  }

  const handleModeSwitch = (mode) => {
    setAddMode(mode)
    if (mode === 'workstation') {
      setEquipCategory('production')
      setWorkstationId(null)
      setName(''); setLineName('')
    } else {
      setWorkstationId(null)
      setEquipCategory('facility')
    }
  }

  const updateCp = (key, patch) =>
    setCheckpoints(prev => prev.map(c => c._key === key ? { ...c, ...patch } : c))

  const handleSave = async () => {
    if (!name.trim()) { setError('กรุณาใส่ชื่ออุปกรณ์'); return }
    if (addMode === 'workstation' && !workstationId) { setError('กรุณาเลือกเครื่องจักรจาก Floor Map'); return }
    if (checkpoints.some(c => !c.name.trim())) { setError('กรุณาใส่ชื่อทุกจุดตรวจสอบ'); return }
    setSaving(true); setError('')
    try {
      const equipId = editEquip?.id ?? crypto.randomUUID()
      const { error: equipErr } = await supabase.from('pm_equipment').upsert({
        id: equipId, name: name.trim(),
        jig_no: jigNo.trim() || null, process: process.trim() || null,
        model: model.trim() || null, part_name: partName.trim() || null,
        part_no: partNo.trim() || null, line_name: lineName || null,
        machine_no: machineNo.trim() || null,
        equipment_type: equipType, equipment_category: equipCategory,
        workstation_id: workstationId || null,
        module: 'mtn', layout_type: 'list',
        created_by: userId,
      })
      if (equipErr) throw equipErr

      const cl = await getOrCreateChecklist(equipId, department, userId)
      if (!cl) throw new Error('Failed to create checklist')
      const { error: freqErr } = await supabase.from('pm_checklists').update({ frequency }).eq('id', cl.id)
      if (freqErr) throw freqErr
      await supabase.from('pm_checkpoints').delete().eq('checklist_id', cl.id)
      if (checkpoints.length > 0) {
        const { error: cpErr } = await supabase.from('pm_checkpoints').insert(
          checkpoints.map((c, i) => ({
            checklist_id: cl.id, name: c.name.trim(), type: c.type,
            unit: c.unit || null,
            nominal: c.nominal !== '' && c.nominal !== null ? Number(c.nominal) : null,
            spec_min: c.spec_min !== '' && c.spec_min !== null ? Number(c.spec_min) : null,
            spec_max: c.spec_max !== '' && c.spec_max !== null ? Number(c.spec_max) : null,
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

  return (
    <div style={S.overlay}>
      <motion.div
        style={S.modal}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.18 }}
      >
        {/* Header */}
        <div style={S.modalHead}>
          <div>
            <h2 style={S.modalTitle}>{isEdit ? 'แก้ไขอุปกรณ์' : 'เพิ่มอุปกรณ์ใหม่'}</h2>
            <span style={{ fontSize: 12, color: deptColor }}>{DEPT_LABEL[department] ?? department}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={S.modalBody}>

          {/* Mode toggle (only for new equipment) */}
          {!isEdit && (
            <div>
              <label style={S.label}>ประเภทการเพิ่ม</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleModeSwitch('workstation')} style={S.modeBtn(addMode === 'workstation')}>
                  🏭 เลือกจาก Floor Map
                </button>
                <button onClick={() => handleModeSwitch('manual')} style={S.modeBtn(addMode === 'manual')}>
                  ➕ Facility / อื่นๆ
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                {addMode === 'workstation'
                  ? 'เลือกเครื่องจักรที่มีอยู่บน Floor Map (Production-critical)'
                  : 'เพิ่มเครื่องจักรที่ไม่ได้อยู่บน Floor Map เช่น Air Pump, Compressor'}
              </p>
            </div>
          )}

          {/* Floor map workstation picker */}
          {addMode === 'workstation' && !isEdit && (
            <div>
              <label style={S.label}>เลือกเครื่องจักร ({workstationOptions.length} ตัว)</label>
              <select
                value={workstationId ?? ''}
                onChange={e => handleWorkstationSelect(e.target.value || null)}
                style={{ width: '100%' }}
              >
                <option value="">— เลือกเครื่องจักร —</option>
                {Object.entries(wsGrouped).sort(([a], [b]) => a.localeCompare(b)).map(([line, stations]) => (
                  <optgroup key={line} label={`📍 ${line}`}>
                    {stations.map(ws => (
                      <option key={ws.id} value={ws.id}>{ws.station_name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {workstationId && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6, fontSize: 12, color: 'var(--text2)' }}>
                  ✅ <strong style={{ color: 'var(--text)' }}>{name}</strong>
                  {lineName && <span style={{ color: 'var(--muted)' }}> · {lineName}</span>}
                </div>
              )}
            </div>
          )}

          {/* Equipment type */}
          <div>
            <label style={S.label}>ประเภทอุปกรณ์</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(EQUIP_TYPE_LABEL).map(([k, v]) => (
                <button
                  key={k} onClick={() => setEquipType(k)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${equipType === k ? deptColor + '60' : 'var(--border2)'}`,
                    background: equipType === k ? deptColor + '18' : 'var(--bg3)',
                    color: equipType === k ? deptColor : 'var(--muted)',
                  }}
                >{v}</button>
              ))}
            </div>
          </div>

          {/* Category (manual mode only) */}
          {addMode === 'manual' && (
            <div>
              <label style={S.label}>หมวดหมู่เครื่องจักร</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {Object.entries(CATEGORY_META).map(([k, v]) => (
                  <button key={k} onClick={() => setEquipCategory(k)}
                    style={{
                      flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1.5px solid ${equipCategory === k ? v.color + '60' : 'var(--border2)'}`,
                      background: equipCategory === k ? v.color + '18' : 'var(--bg3)',
                      color: equipCategory === k ? v.color : 'var(--muted)',
                    }}>
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label style={S.label}>ชื่ออุปกรณ์ *</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="เช่น RB141 - Welding, Air Compressor #1"
              readOnly={addMode === 'workstation' && !!workstationId && !isEdit}
              style={{ opacity: (addMode === 'workstation' && !!workstationId && !isEdit) ? 0.7 : 1 }}
            />
          </div>

          {/* Metadata grid */}
          <div style={S.inputRow}>
            {[
              { label: 'No./รหัส', val: jigNo, set: setJigNo, ph: 'JIG-001' },
              { label: 'Process', val: process, set: setProcess, ph: 'Welding' },
              { label: 'Model', val: model, set: setModel, ph: 'Model A' },
              { label: 'Part Name', val: partName, set: setPartName, ph: 'Pin A' },
              { label: 'Part No.', val: partNo, set: setPartNo, ph: 'P-0001' },
              { label: 'Machine No.', val: machineNo, set: setMachineNo, ph: 'M-01' },
            ].map(({ label, val, set, ph }) => (
              <div key={label}>
                <label style={S.label}>{label}</label>
                <input value={val} onChange={e => set(e.target.value)} placeholder={ph} />
              </div>
            ))}
          </div>

          {/* Line selector (manual mode or edit mode) */}
          {(addMode === 'manual' || isEdit) && (
            <div>
              <label style={S.label}>ไลน์ / พื้นที่</label>
              <input
                value={lineName} onChange={e => setLineName(e.target.value)}
                placeholder="เช่น Line-A, Utility Room, Building 2"
              />
            </div>
          )}

          {/* Frequency */}
          <div>
            <label style={S.label}>ความถี่การตรวจ ({DEPT_LABEL[department]})</label>
            <div style={S.freqBtns}>
              {Object.entries(FREQ_LABEL).map(([v, lbl]) => (
                <button key={v} onClick={() => setFrequency(v)} style={S.freqBtn(frequency === v)}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* Checkpoints */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ ...S.label, marginBottom: 0 }}>จุดตรวจสอบ ({checkpoints.length})</label>
              <button
                onClick={() => setCheckpoints(p => [...p, newCheckpoint()])}
                style={{ ...S.btnSm('var(--accent)'), fontSize: 12 }}
              >+ เพิ่มจุดตรวจ</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {checkpoints.map((cp, i) => (
                <CheckpointCard
                  key={cp._key} cp={cp} index={i}
                  onChange={patch => updateCp(cp._key, patch)}
                  onDelete={() => setCheckpoints(p => p.filter(c => c._key !== cp._key))}
                />
              ))}
            </div>
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
        </div>

        {/* Footer */}
        <div style={S.modalFoot}>
          <button onClick={onClose} style={S.cancelBtn}>ยกเลิก</button>
          <button onClick={handleSave} disabled={saving} style={{ ...S.saveBtn, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── EquipmentCard ────────────────────────────────────────────────────────────
function EquipmentCard({ equip, cpCount, frequency, onEdit, onDelete }) {
  const typeColor = { jig: '#3dd65c', die: '#4d9fff', machine: '#f59a3f', fixture: '#9b8de8', tool: '#e05c4a' }
  const color = typeColor[equip.equipment_type] ?? '#527855'
  const catMeta = CATEGORY_META[equip.equipment_category] ?? CATEGORY_META.production
  return (
    <motion.div
      layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      style={{ ...S.card }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border2)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={S.cardTitle}>{equip.name}</h3>
        <div style={{ display: 'flex', gap: 4, flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={S.tag(color)}>{EQUIP_TYPE_LABEL[equip.equipment_type] ?? equip.equipment_type}</span>
          {equip.equipment_category && equip.equipment_category !== 'production' && (
            <span style={S.tag(catMeta.color)}>{catMeta.icon} {catMeta.label}</span>
          )}
        </div>
      </div>
      {equip.jig_no && <p style={S.meta}>No. {equip.jig_no}</p>}
      {equip.line_name && <p style={S.meta}>📍 {equip.line_name}{equip.machine_no ? ` · ${equip.machine_no}` : ''}</p>}
      {equip.part_name && <p style={S.meta}>🔩 {equip.part_name}{equip.part_no ? ` (${equip.part_no})` : ''}</p>}
      {equip.workstation_id && <p style={{ ...S.meta, color: 'var(--accent)' }}>🔗 เชื่อมกับ Floor Map</p>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{cpCount}</span> จุดตรวจ
          {frequency && frequency !== 'periodic' && (
            <span style={{ marginLeft: 8, color: 'var(--muted)' }}>· {FREQ_LABEL[frequency]}</span>
          )}
        </div>
        <div style={S.actions}>
          <button onClick={onEdit} style={S.btnSm('var(--accent)')}>แก้ไข</button>
          <button onClick={onDelete} style={S.btnSm('var(--red)')}>ลบ</button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── PMSetup (main) ───────────────────────────────────────────────────────────
export default function PMSetup() {
  const [searchParams, setSearchParams] = useSearchParams()
  const department = searchParams.get('dept') || 'maintenance'
  const [equipment, setEquipment] = useState([])
  const [cpCounts, setCpCounts] = useState({})
  const [frequencies, setFrequencies] = useState({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editEquip, setEditEquip] = useState(null)

  const setDept = (d) => setSearchParams({ dept: d })

  const fetchData = async () => {
    setLoading(true)
    const { data: equipData } = await supabase
      .from('pm_equipment').select('*').eq('module', 'mtn').eq('is_active', true)
      .order('created_at', { ascending: false })

    const { data: checklists } = await supabase
      .from('pm_checklists').select('id, equipment_id, frequency')
      .eq('module', 'mtn').eq('department', department)

    const clMap = {}
    const freqMap = {}
    ;(checklists ?? []).forEach(c => { clMap[c.equipment_id] = c.id; freqMap[c.equipment_id] = c.frequency })

    const clIds = Object.values(clMap)
    let counts = {}
    if (clIds.length > 0) {
      const { data: cps } = await supabase
        .from('pm_checkpoints').select('checklist_id')
        .in('checklist_id', clIds)
      ;(cps ?? []).forEach(c => {
        const eqId = Object.keys(clMap).find(k => clMap[k] === c.checklist_id)
        if (eqId) counts[eqId] = (counts[eqId] ?? 0) + 1
      })
    }

    setEquipment(equipData ?? [])
    setCpCounts(counts)
    setFrequencies(freqMap)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [department]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (eq) => {
    if (!confirm(`ลบ "${eq.name}" ?`)) return
    await supabase.from('pm_equipment').update({ is_active: false }).eq('id', eq.id)
    toast.success('ลบแล้ว')
    fetchData()
  }

  const openCreate = () => { setEditEquip(null); setShowModal(true) }
  const openEdit = (eq) => { setEditEquip(eq); setShowModal(true) }
  const handleSaved = () => { setShowModal(false); fetchData() }

  const DEPT_OPTIONS = [
    { key: 'maintenance', label: 'ซ่อมบำรุง' },
    { key: 'jig_maintenance', label: 'JIG Maintenance' },
    { key: 'die_maintenance', label: 'Die Maintenance' },
    { key: 'production', label: 'ฝ่ายผลิต' },
  ]

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>PM Setup — อุปกรณ์ & จุดตรวจ</h1>
          <p style={S.sub}>{equipment.length} อุปกรณ์ · แผนก {DEPT_LABEL[department] ?? department}</p>
        </div>
        <button onClick={openCreate} style={S.primaryBtn}>+ เพิ่มอุปกรณ์</button>
      </div>

      {/* Department tabs */}
      <div style={S.deptBar}>
        {DEPT_OPTIONS.map(d => (
          <button key={d.key} onClick={() => setDept(d.key)}
            style={S.deptBtn(department === d.key, DEPT_COLORS[d.key] ?? '#3dd65c')}>
            {d.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <div style={{ width: 32, height: 32, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : equipment.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔩</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>ยังไม่มีอุปกรณ์</p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>กดปุ่ม "เพิ่มอุปกรณ์" เพื่อเริ่มต้น</p>
          <button onClick={openCreate} style={S.primaryBtn}>+ เพิ่มอุปกรณ์</button>
        </div>
      ) : (
        <div style={S.grid}>
          {equipment.map(eq => (
            <EquipmentCard
              key={eq.id} equip={eq}
              cpCount={cpCounts[eq.id] ?? 0}
              frequency={frequencies[eq.id]}
              onEdit={() => openEdit(eq)}
              onDelete={() => handleDelete(eq)}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <EquipmentModal
            onClose={() => setShowModal(false)}
            onSaved={handleSaved}
            editEquip={editEquip}
            department={department}
          />
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
