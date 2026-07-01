import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../supabaseClient'
import { toast } from '../components/Toast'
import { FREQ_LABEL, DEPT_LABEL, computeNextDue } from '../lib/pmSchedule'

async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

function fmt(v, d = 3) {
  if (v === null || v === undefined || v === '') return '—'
  return Number(v).toFixed(d).replace(/\.?0+$/, '')
}

function getStatus(value, cp) {
  if (value === '' || value === null || value === undefined) return null
  const v = Number(value)
  if ((cp.spec_min !== null && v < cp.spec_min) || (cp.spec_max !== null && v > cp.spec_max)) return 'fail'
  return 'pass'
}

const STATUS_STYLE = {
  pass: { color: '#3dd65c', bg: 'rgba(61,214,92,0.08)', border: 'rgba(61,214,92,0.25)' },
  fail: { color: '#e05c4a', bg: 'rgba(224,92,74,0.08)', border: 'rgba(224,92,74,0.25)' },
}

const DEPT_COLORS = {
  maintenance: '#fb923c', jig_maintenance: '#34d399', die_maintenance: '#4d9fff',
  production: '#3dd65c', qa: '#9b8de8',
}

const S = {
  page: { padding: '28px 32px', minHeight: '100%', background: 'var(--bg)' },
  h1: { fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 },
  sub: { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  deptBar: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  deptBtn: (active, color) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`,
    background: active ? `${color}18` : 'var(--bg3)',
    color: active ? color : 'var(--muted)',
  }),
  card: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 },
  equipBtn: (selected) => ({
    padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
    border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    background: selected ? 'var(--accent-dim)' : 'var(--card)',
    marginBottom: 6, width: '100%',
  }),
  cpRow: (status) => ({
    background: status ? STATUS_STYLE[status].bg : 'var(--bg3)',
    border: `1px solid ${status ? STATUS_STYLE[status].border : 'var(--border)'}`,
    borderRadius: 8, padding: 14, marginBottom: 8,
  }),
  okNgBtn: (active, ok) => ({
    flex: 1, padding: '8px 0', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer',
    border: `1.5px solid ${active ? (ok ? 'rgba(61,214,92,0.5)' : 'rgba(224,92,74,0.5)') : 'var(--border2)'}`,
    background: active ? (ok ? 'rgba(61,214,92,0.15)' : 'rgba(224,92,74,0.15)') : 'var(--bg3)',
    color: active ? (ok ? '#3dd65c' : '#e05c4a') : 'var(--muted)',
  }),
  primaryBtn: {
    padding: '10px 24px', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 700,
    background: 'var(--accent)', color: '#071008', border: 'none', cursor: 'pointer',
  },
}

const DEPT_OPTIONS = [
  { key: 'maintenance', label: 'ซ่อมบำรุง' },
  { key: 'jig_maintenance', label: 'JIG Maintenance' },
  { key: 'die_maintenance', label: 'Die Maintenance' },
  { key: 'production', label: 'ฝ่ายผลิต' },
]

// ─── VariableInput ────────────────────────────────────────────────────────────
function VariableInput({ cp, result, onChange }) {
  const status = getStatus(result.value_num, cp)
  const ss = status ? STATUS_STYLE[status] : null
  return (
    <div style={S.cpRow(status)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}</p>
          {(cp.spec_min !== null || cp.spec_max !== null || cp.nominal !== null) && (
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
              {cp.nominal !== null ? `Nominal: ${fmt(cp.nominal)} ${cp.unit ?? ''}` : ''}
              {cp.spec_min !== null ? ` | Min: ${fmt(cp.spec_min)}` : ''}
              {cp.spec_max !== null ? ` | Max: ${fmt(cp.spec_max)}` : ''}
            </p>
          )}
        </div>
        {status && (
          <span style={{ fontSize: 11, fontWeight: 800, color: ss.color, padding: '2px 8px', borderRadius: 12, border: `1px solid ${ss.border}`, background: ss.bg }}>
            {status === 'pass' ? '✓ PASS' : '✕ FAIL'}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="number" step="any"
          value={result.value_num ?? ''}
          onChange={e => onChange({ value_num: e.target.value })}
          placeholder={`ใส่ค่า ${cp.unit ?? ''}`}
          style={{ flex: 1 }}
        />
        {cp.unit && <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{cp.unit}</span>}
      </div>
      <input
        value={result.notes ?? ''}
        onChange={e => onChange({ notes: e.target.value })}
        placeholder="หมายเหตุ (ไม่บังคับ)"
        style={{ marginTop: 6, fontSize: 13 }}
      />
    </div>
  )
}

// ─── AttributeInput ───────────────────────────────────────────────────────────
function AttributeInput({ cp, result, onChange, withNote }) {
  return (
    <div style={S.cpRow(result.is_ok === null ? null : result.is_ok ? 'pass' : 'fail')}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>{cp.name}</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={S.okNgBtn(result.is_ok === true, true)} onClick={() => onChange({ is_ok: true })}>✓ OK</button>
        <button style={S.okNgBtn(result.is_ok === false, false)} onClick={() => onChange({ is_ok: false })}>✕ NG</button>
      </div>
      {(withNote || result.is_ok === false) && (
        <input
          value={result.notes ?? ''}
          onChange={e => onChange({ notes: e.target.value })}
          placeholder={result.is_ok === false ? 'ระบุสาเหตุที่ NG *' : 'หมายเหตุ (ไม่บังคับ)'}
          style={{ fontSize: 13 }}
        />
      )}
    </div>
  )
}

// ─── PMCheckData (main) ───────────────────────────────────────────────────────
export default function PMCheckData() {
  const [searchParams, setSearchParams] = useSearchParams()
  const department = searchParams.get('dept') || 'maintenance'
  const preselectedEquipId = searchParams.get('equip')

  const [userId, setUserId] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [selectedEquip, setSelectedEquip] = useState(null)
  const [checklist, setChecklist] = useState(null)
  const [checkpoints, setCheckpoints] = useState([])
  const [results, setResults] = useState({})
  const [overallNotes, setOverallNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lastInspection, setLastInspection] = useState(null)
  const [loadingCps, setLoadingCps] = useState(false)

  const setDept = (d) => { setSearchParams({ dept: d }); setSelectedEquip(null) }

  useEffect(() => {
    getCurrentUserId().then(setUserId)
  }, [])

  useEffect(() => {
    supabase.from('pm_equipment').select('*').eq('module', 'mtn').eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        setEquipment(data ?? [])
        if (preselectedEquipId && data) {
          const eq = data.find(e => e.id === preselectedEquipId)
          if (eq) setSelectedEquip(eq)
        }
      })
  }, [department]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedEquip) { setCheckpoints([]); setChecklist(null); return }
    setLoadingCps(true)
    supabase.from('pm_checklists').select('*')
      .eq('equipment_id', selectedEquip.id).eq('module', 'mtn').eq('department', department)
      .maybeSingle()
      .then(async ({ data: cl }) => {
        setChecklist(cl)
        if (!cl) { setCheckpoints([]); setLoadingCps(false); return }

        const [{ data: cps }, { data: lastInsp }] = await Promise.all([
          supabase.from('pm_checkpoints').select('*').eq('checklist_id', cl.id).order('sort_order'),
          supabase.from('pm_inspections').select('*')
            .eq('checklist_id', cl.id).order('inspected_at', { ascending: false }).limit(1).maybeSingle(),
        ])
        setCheckpoints(cps ?? [])
        setLastInspection(lastInsp ?? null)
        const initResults = {}
        ;(cps ?? []).forEach(cp => {
          initResults[cp.id] = { value_num: '', is_ok: null, notes: '' }
        })
        setResults(initResults)
        setLoadingCps(false)
      })
  }, [selectedEquip, department])

  const updateResult = (cpId, patch) =>
    setResults(prev => ({ ...prev, [cpId]: { ...prev[cpId], ...patch } }))

  const handleSubmit = async () => {
    if (!selectedEquip || !checklist) return
    const hasEmpty = checkpoints.some(cp => {
      const r = results[cp.id] ?? {}
      if (cp.type === 'variable') return r.value_num === '' || r.value_num === null
      if (cp.type === 'attribute' || cp.type === 'note') return r.is_ok === null
      return false
    })
    if (hasEmpty && !confirm('บางจุดตรวจยังไม่ได้กรอก ต้องการบันทึกต่อไปหรือไม่?')) return

    setSubmitting(true)
    try {
      const anyFail = checkpoints.some(cp => {
        const r = results[cp.id] ?? {}
        if (cp.type === 'variable') return getStatus(r.value_num, cp) === 'fail'
        return r.is_ok === false
      })

      const now = new Date().toISOString()
      const { data: insp, error: inspErr } = await supabase.from('pm_inspections').insert({
        checklist_id: checklist.id,
        inspector_id: userId,
        inspected_at: now,
        status: anyFail ? 'fail' : 'pass',
        approval_status: 'pending',
        notes: overallNotes || null,
      }).select('id').single()
      if (inspErr) throw inspErr

      const resultRows = checkpoints.map(cp => {
        const r = results[cp.id] ?? {}
        return {
          inspection_id: insp.id, checkpoint_id: cp.id,
          value_num: cp.type === 'variable' ? (r.value_num !== '' ? Number(r.value_num) : null) : null,
          is_ok: cp.type === 'attribute' || cp.type === 'note' ? r.is_ok : (getStatus(r.value_num, cp) === 'pass'),
          notes: r.notes || null,
        }
      })
      const { error: resErr } = await supabase.from('pm_inspection_results').insert(resultRows)
      if (resErr) throw resErr

      // Update schedule
      const nextDue = computeNextDue(now, checklist.frequency)
      await supabase.from('pm_schedules').upsert({
        checklist_id: checklist.id,
        last_done_at: now,
        next_due_date: nextDue ? nextDue.toISOString().slice(0, 10) : null,
        last_inspection_id: insp.id,
      }, { onConflict: 'checklist_id' })

      toast.success(anyFail ? 'บันทึกแล้ว — พบ NG' : 'ตรวจสอบสำเร็จ ✓')
      // reset form
      const initResults = {}
      checkpoints.forEach(cp => { initResults[cp.id] = { value_num: '', is_ok: null, notes: '' } })
      setResults(initResults)
      setOverallNotes('')
      setLastInspection({ id: insp.id, inspected_at: now, status: anyFail ? 'fail' : 'pass' })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const deptColor = DEPT_COLORS[department] ?? '#3dd65c'
  const nextDue = lastInspection ? computeNextDue(lastInspection.inspected_at, checklist?.frequency) : null

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={S.h1}>PM ตรวจสอบ</h1>
        <p style={S.sub}>บันทึกผลการตรวจสอบ · {DEPT_LABEL[department] ?? department}</p>
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

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Equipment list */}
        <div style={S.card}>
          <label style={S.label}>เลือกอุปกรณ์</label>
          {equipment.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>ไม่มีอุปกรณ์</p>
          ) : (
            equipment.map(eq => (
              <button
                key={eq.id}
                onClick={() => setSelectedEquip(eq)}
                style={S.equipBtn(selectedEquip?.id === eq.id)}
              >
                <p style={{ fontSize: 13, fontWeight: 700, color: selectedEquip?.id === eq.id ? 'var(--accent)' : 'var(--text)', margin: 0 }}>{eq.name}</p>
                {eq.jig_no && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>No. {eq.jig_no}</p>}
              </button>
            ))
          )}
        </div>

        {/* Inspection form */}
        <div>
          {!selectedEquip ? (
            <div style={{ ...S.card, textAlign: 'center', padding: '48px 24px' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>👈</div>
              <p style={{ fontSize: 15, color: 'var(--text2)', fontWeight: 600 }}>เลือกอุปกรณ์ที่ต้องการตรวจ</p>
            </div>
          ) : loadingCps ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <div style={{ width: 28, height: 28, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : !checklist ? (
            <div style={{ ...S.card, textAlign: 'center', padding: '32px 24px' }}>
              <p style={{ fontSize: 15, color: 'var(--text2)', fontWeight: 600 }}>ยังไม่มี Checklist</p>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
                ไปที่ <strong>PM Setup</strong> เพื่อสร้าง Checklist สำหรับอุปกรณ์นี้ก่อน
              </p>
            </div>
          ) : (
            <div>
              {/* Equipment info */}
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: 0 }}>{selectedEquip.name}</h2>
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
                      {FREQ_LABEL[checklist.frequency]} · {checkpoints.length} จุดตรวจ
                    </p>
                  </div>
                  {lastInspection && (
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>ตรวจล่าสุด</p>
                      <p style={{ fontSize: 12, color: 'var(--text2)', margin: '2px 0 0' }}>
                        {new Date(lastInspection.inspected_at).toLocaleDateString('th-TH')}
                      </p>
                      {nextDue && (
                        <p style={{ fontSize: 11, margin: '2px 0 0', color: nextDue < new Date() ? '#e05c4a' : '#f59a3f' }}>
                          ครบกำหนด: {nextDue.toLocaleDateString('th-TH')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Checkpoints */}
              {checkpoints.length === 0 ? (
                <div style={{ ...S.card, textAlign: 'center', padding: '32px', color: 'var(--muted)' }}>
                  ยังไม่มีจุดตรวจสอบ — เพิ่มใน PM Setup ก่อน
                </div>
              ) : (
                <div>
                  {checkpoints.map(cp => {
                    const r = results[cp.id] ?? {}
                    return cp.type === 'variable' ? (
                      <VariableInput key={cp.id} cp={cp} result={r} onChange={patch => updateResult(cp.id, patch)} />
                    ) : (
                      <AttributeInput key={cp.id} cp={cp} result={r} onChange={patch => updateResult(cp.id, patch)} withNote={cp.type === 'note'} />
                    )
                  })}

                  {/* Overall notes */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={S.label}>หมายเหตุรวม</label>
                    <textarea value={overallNotes} onChange={e => setOverallNotes(e.target.value)}
                      rows={2} placeholder="หมายเหตุเพิ่มเติม (ไม่บังคับ)"
                      style={{ resize: 'vertical' }} />
                  </div>

                  <button onClick={handleSubmit} disabled={submitting} style={{ ...S.primaryBtn, width: '100%', opacity: submitting ? 0.6 : 1 }}>
                    {submitting ? 'กำลังบันทึก...' : '✓ บันทึกผลการตรวจ'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
