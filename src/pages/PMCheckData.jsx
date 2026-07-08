import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, supabaseDR } from '../supabaseClient'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { getSpcStatus, STATUS_COLOR } from '../lib/spc'
import { getOrCreateChecklist } from '../lib/pmChecklists'
import { notifyDepartment, createNotification } from '../lib/pmNotify'
import { handleDailyPmSave } from '../lib/pmDailyAlarm'
import { exportInspectionExcel } from '../lib/pmExportExcel'
import { exportInspectionPDF, resolveSignatureDataUrl } from '../lib/pmExportPDF'
import { fetchCategories, fetchCheckingMethods, categoryColor, indexByCode } from '../lib/pmTaxonomy'

const DEPT_COLORS = {
  maintenance: '#fb923c', jig_maintenance: '#34d399', die_maintenance: '#4d9fff',
  production: '#3dd65c', qa: '#9b8de8',
}
const DEPT_OPTIONS = [
  { key: 'maintenance', label: 'ซ่อมบำรุง' },
  { key: 'jig_maintenance', label: 'JIG Maintenance' },
  { key: 'die_maintenance', label: 'Die Maintenance' },
  { key: 'production', label: 'ฝ่ายผลิต' },
]

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
  page: { display: 'flex', height: '100%', background: 'var(--bg)' },
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
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 },
  tabBar: { display: 'flex', gap: 4, padding: 4, borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)' },
  tabBtn: (active) => ({
    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
    background: active ? 'var(--card)' : 'transparent', color: active ? 'var(--text)' : 'var(--muted)',
  }),
  body: { flex: 1, overflowY: 'auto', padding: 20 },
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

// ─── Variable Row ───────────────────────────────────────────────────────────
function VariableRow({ cp, idx, r, onChange, methodIndex }) {
  const avg = computeAvg(r.v1, r.v2, r.v3)
  const status = getSpcStatus(avg, cp)
  const c = status ? STATUS_COLOR[status] : null
  const method = methodIndex?.[cp.checking_method]
  return (
    <div style={S.cpRow(status)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {cp.x_pos != null && <span style={{ width: 16, height: 16, borderRadius: '50%', background: categoryColor(cp.category), color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>}
        {method && <span title={method.label} style={{ fontSize: 13, flexShrink: 0 }}>{method.icon}</span>}
        <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}{cp.axis && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 4px' }}>{cp.axis}</span>}</p>
        {c && <span style={{ fontSize: 10, fontWeight: 700, color: c.text }}>{status === 'pass' ? '●' : status === 'warning' ? '⚠' : '✕'}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {['v1', 'v2', 'v3'].map((k, i) => (
          <div key={k}>
            <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', marginBottom: 2 }}>{['①', '②', '③'][i]}</div>
            <input type="number" value={r[k]} onChange={e => onChange({ ...r, [k]: e.target.value })} placeholder="—" style={S.input} />
          </div>
        ))}
        <div>
          <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', marginBottom: 2 }}>Avg</div>
          <div style={{ ...S.input, padding: '6px 0', borderRadius: 6, border: `1px solid ${c?.border ?? 'var(--border)'}`, color: c?.text ?? 'var(--muted)', fontWeight: 700 }}>{avg != null ? fmt(avg) : '—'}</div>
        </div>
        {cp.unit && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cp.unit}</span>}
        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
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
        {cp.x_pos != null && <span style={{ width: 16, height: 16, borderRadius: '50%', background: categoryColor(cp.category), color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>}
        {method && <span title={method.label} style={{ fontSize: 13, flexShrink: 0 }}>{method.icon}</span>}
        <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}</p>
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
      {cp.type === 'note' && <input value={note} onChange={e => onChangeNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)..." />}
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
      await supabaseDR.from('inspection_results').update(patch).eq('id', result.id)
      onSaved()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  if (done) {
    return (
      <div style={{ marginTop: 6, borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)', padding: '8px 12px' }}>
        <p style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>Action taken</p>
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
      <p style={{ fontSize: 10, color: '#e05c4a', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>NG — ต้องการ action</p>
      <textarea value={action} onChange={e => setAction(e.target.value)} rows={2} placeholder="อธิบายการแก้ไข..." />
      {cp.type === 'variable' && (
        <div>
          <p style={{ fontSize: 10, color: 'var(--muted)', margin: '0 0 4px' }}>วัดใหม่ 3 ครั้ง</p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[[rv1, setRv1, '①'], [rv2, setRv2, '②'], [rv3, setRv3, '③']].map(([v, set, label], i) => (
              <div key={i}><div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>{label}</div>
                <input type="number" value={v} onChange={e => set(e.target.value)} placeholder="—" style={S.input} /></div>
            ))}
            <div><div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>Avg</div>
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
    const { data: profs } = await supabase.from('profiles').select('id, email, signature_url').in('id', userIds)
    const profMap = Object.fromEntries((profs ?? []).map(p => [p.id, p]))
    const sigCache = {}
    const getSig = async (uid) => {
      if (!uid) return null
      if (sigCache[uid] !== undefined) return sigCache[uid]
      const url = profMap[uid]?.signature_url
      sigCache[uid] = url ? await resolveSignatureDataUrl(url) : null
      return sigCache[uid]
    }
    const inspector = { email: profMap[insp.inspector_id]?.email ?? 'Inspector', signature_data: await getSig(insp.inspector_id) }
    const approver = insp.approved_by ? { email: profMap[insp.approved_by]?.email ?? 'Approver', signature_data: await getSig(insp.approved_by) } : null
    const exporter = { email: currentUserEmail ?? 'Exporter', signature_data: await getSig(userId) }
    const categories = await fetchCategories({ includeInactive: true })
    await supabaseDR.from('inspections').update({ exported_by: userId, exported_at: new Date().toISOString() }).eq('id', insp.id)
    return { jig, inspection: insp, checkpoints, results: resultMap, inspector, approver, exporter, categories }
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 700, color: 'var(--text)', margin: 0, fontSize: 14 }}>{formatDate(insp.inspected_at)}</p>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: insp.status === 'pass' ? 'var(--accent-dim)' : insp.status === 'fail' ? 'rgba(224,92,74,0.12)' : 'var(--bg3)', color: insp.status === 'pass' ? 'var(--accent)' : insp.status === 'fail' ? '#e05c4a' : 'var(--muted)' }}>{insp.status?.toUpperCase()}</span>
              {insp.approval_status === 'approved' && <span style={{ fontSize: 10, color: 'var(--accent)', border: '1px solid var(--accent)', padding: '2px 6px', borderRadius: 10 }}>✓ อนุมัติแล้ว</span>}
              {insp.approval_status === 'rejected' && <span style={{ fontSize: 10, color: '#e05c4a', border: '1px solid #e05c4a', padding: '2px 6px', borderRadius: 10 }}>✕ ตีกลับ</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map(r => {
            const cp = cpMap[r.checkpoint_id]
            if (!cp) return null
            const isNG = cp.type === 'variable' ? r.status === 'fail' : r.value_attribute === 'ng'
            const c = r.status ? STATUS_COLOR[r.status] : null
            return (
              <div key={r.id}>
                <div style={{ borderRadius: 8, border: `1px solid ${c?.border ?? 'var(--border)'}`, background: c?.bg ?? 'var(--card)', padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <p style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, margin: 0 }}>{cp.name}{cp.axis && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 3px' }}>{cp.axis}</span>}</p>
                      {cp.type === 'variable' ? (
                        <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', margin: '2px 0 0' }}>
                          {fmt(r.value_1)} / {fmt(r.value_2)} / {fmt(r.value_3)}
                          {r.avg_value != null && <span style={{ color: 'var(--text2)' }}> → Avg: <strong>{fmt(r.avg_value)}</strong></span>}
                          {cp.unit && <span style={{ marginLeft: 4 }}>{cp.unit}</span>}
                        </p>
                      ) : (
                        <>
                          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>{r.value_attribute?.toUpperCase()}</p>
                        </>
                      )}
                    </div>
                    {c && <span style={{ fontSize: 11, fontWeight: 700, color: c.text }}>{c.label}</span>}
                  </div>
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
  const [jigs, setJigs] = useState([])
  const [selectedJig, setSelectedJig] = useState(null)
  const [checklistId, setChecklistId] = useState(null)
  const [checkpoints, setCheckpoints] = useState([])
  const [tab, setTab] = useState('record')
  const [results, setResults] = useState({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [inspections, setInspections] = useState([])
  const [viewInspection, setViewInspection] = useState(null)
  const [methodIndex, setMethodIndex] = useState({})

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id ?? null)
      if (data?.user?.id) supabase.from('profiles').select('role').eq('id', data.user.id).single().then(({ data: p }) => setUserRole(p?.role ?? null))
    })
  }, [])

  useEffect(() => {
    supabaseDR.from('jigs').select('*').eq('module', 'mtn').order('name').then(({ data }) => setJigs(data ?? []))
    fetchCategories() // primes the category color cache used by categoryColor()
    fetchCheckingMethods().then(rows => setMethodIndex(indexByCode(rows)))
  }, [])

  useEffect(() => {
    if (!equipParam || jigs.length === 0) { setSelectedJig(null); return }
    setSelectedJig(jigs.find(j => j.id === equipParam) ?? null)
  }, [equipParam, jigs])

  const selectJig = (jig) => setSearchParams({ dept: department, equip: jig.id })
  const setDept = (d) => setSearchParams({ dept: d, ...(equipParam ? { equip: equipParam } : {}) })

  const fetchHistory = async (jigId) => {
    const { data } = await supabaseDR.from('inspections').select('*').eq('jig_id', jigId).order('inspected_at', { ascending: false }).limit(30)
    setInspections(data ?? [])
  }

  useEffect(() => {
    if (!selectedJig || !userId) return
    setResults({}); setNotes(''); setTab('record')
    getOrCreateChecklist(selectedJig.id, 'mtn', department, userId).then(async (cl) => {
      setChecklistId(cl.id)
      const { data } = await supabaseDR.from('jig_checkpoints').select('*').eq('checklist_id', cl.id).order('sort_order')
      const cps = data ?? []
      setCheckpoints(cps)
      const init = {}
      cps.forEach(c => { init[c.id] = { v1: '', v2: '', v3: '', attr: '', note: '' } })
      setResults(init)
    })
    fetchHistory(selectedJig.id)
  }, [selectedJig, department, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const computeOverall = () => {
    let hasFail = false, hasEmpty = false
    for (const cp of checkpoints) {
      const r = results[cp.id]
      if (!r) { hasEmpty = true; continue }
      if (cp.type === 'variable') {
        if (r.v1 === '' || r.v2 === '' || r.v3 === '') { hasEmpty = true; continue }
        if (getSpcStatus(computeAvg(r.v1, r.v2, r.v3), cp) === 'fail') hasFail = true
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
        return { inspection_id: insp.id, checkpoint_id: cp.id, value_attribute: r.attr || null, status: r.attr === 'ng' ? 'fail' : r.attr === 'ok' ? 'pass' : null }
      })
      const { error: e2 } = await supabaseDR.from('inspection_results').insert(rows)
      if (e2) throw e2

      if (overall === 'fail') {
        notifyDepartment(department, { title: 'พบผลตรวจไม่ผ่าน (NG)', body: `${selectedJig.name} — ${formatDate(insp.inspected_at)}`, type: 'error', refTable: 'inspections', refId: insp.id }, userId).catch(() => {})
      }

      // Daily PM line alarm (green when the line is complete & all pass, red on NG).
      const ngTopics = checkpoints.filter(cp => {
        const r = results[cp.id]
        if (!r) return false
        return cp.type === 'variable' ? getSpcStatus(computeAvg(r.v1, r.v2, r.v3), cp) === 'fail' : r.attr === 'ng'
      }).map(cp => cp.name)
      handleDailyPmSave({ jig: selectedJig, department, overall, ngTopics }).catch(() => {})

      toast.success('บันทึกผลการตรวจสำเร็จ')
      const init = {}
      checkpoints.forEach(c => { init[c.id] = { v1: '', v2: '', v3: '', attr: '', note: '' } })
      setResults(init); setNotes('')
      fetchHistory(selectedJig.id)
      setTab('history')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isFormReady = checkpoints.length > 0 && checkpoints.every(cp => {
    const r = results[cp.id]
    if (!r) return false
    return cp.type === 'variable' ? (r.v1 !== '' && r.v2 !== '' && r.v3 !== '') : r.attr !== ''
  })

  const deptColor = DEPT_COLORS[department] ?? '#3dd65c'
  const jigImg = selectedJig ? getPublicUrl(selectedJig.image_path) : null

  return (
    <div style={S.page}>
      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.sidebarHead}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: 0, fontFamily: 'var(--font-display)' }}>PM ตรวจสอบ</h2>
        </div>
        <div style={S.deptBar}>
          {DEPT_OPTIONS.map(d => <button key={d.key} onClick={() => setDept(d.key)} style={S.deptBtn(department === d.key, DEPT_COLORS[d.key] ?? '#3dd65c')}>{d.label}</button>)}
        </div>
        <div style={S.jigList}>
          {jigs.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 20 }}>ยังไม่มีอุปกรณ์</p>}
          {jigs.map(jig => (
            <div key={jig.id} onClick={() => selectJig(jig)} style={S.jigItem(selectedJig?.id === jig.id, deptColor)}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{jig.name}</p>
              {jig.line_name && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>📍 {jig.line_name}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div style={S.main}>
        {!selectedJig ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>เลือกอุปกรณ์จากรายการด้านซ้าย</p>
          </div>
        ) : (
          <>
            <div style={S.header}>
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

            <div style={S.body}>
              {tab === 'record' && (
                <div style={{ maxWidth: 680, margin: '0 auto' }}>
                  {jigImg && selectedJig.layout_type !== 'list' && (
                    <div style={{ position: 'relative', marginBottom: 16, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      <img src={jigImg} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', background: 'var(--bg2)', display: 'block' }} />
                      {checkpoints.map((c, i) => {
                        if (c.x_pos == null || c.y_pos == null) return null
                        return (
                          <div key={c.id} style={{ position: 'absolute', left: `${c.x_pos * 100}%`, top: `${c.y_pos * 100}%`, transform: 'translate(-50%,-100%)' }}>
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: categoryColor(c.category), color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }}>{i + 1}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {checkpoints.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>ยังไม่มีจุดตรวจสอบ — ไปตั้งค่าที่ PM Setup ก่อน</p>
                  ) : (
                    <>
                      {checkpoints.map((cp, idx) => cp.type === 'variable' ? (
                        <VariableRow key={cp.id} cp={cp} idx={idx} r={results[cp.id] ?? { v1: '', v2: '', v3: '' }} onChange={v => setResults(prev => ({ ...prev, [cp.id]: v }))} methodIndex={methodIndex} />
                      ) : (
                        <AttrRow key={cp.id} cp={cp} idx={idx} methodIndex={methodIndex}
                          value={results[cp.id]?.attr ?? ''} note={results[cp.id]?.note ?? ''}
                          onChangeAttr={v => setResults(prev => ({ ...prev, [cp.id]: { ...prev[cp.id], attr: v } }))}
                          onChangeNote={v => setResults(prev => ({ ...prev, [cp.id]: { ...prev[cp.id], note: v } }))} />
                      ))}
                      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="หมายเหตุ (ถ้ามี)..." style={{ marginTop: 8 }} />
                      <button onClick={handleSave} disabled={saving} style={{ ...S.saveBtn, opacity: saving ? 0.6 : isFormReady ? 1 : 0.75 }}>
                        {saving ? 'กำลังบันทึก...' : isFormReady ? 'บันทึกผลการตรวจ' : `บันทึก (ยังไม่ครบ ${checkpoints.filter(cp => { const r = results[cp.id]; return cp.type === 'variable' ? !(r?.v1 !== '' && r?.v2 !== '' && r?.v3 !== '') : !r?.attr }).length} จุด)`}
                      </button>
                    </>
                  )}
                </div>
              )}

              {tab === 'history' && (
                <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inspections.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>ยังไม่มีประวัติการตรวจ</p>
                  ) : inspections.map(insp => (
                    <div key={insp.id} onClick={() => setViewInspection(insp)} style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{formatDate(insp.inspected_at)}</p>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: insp.status === 'pass' ? 'var(--accent-dim)' : insp.status === 'fail' ? 'rgba(224,92,74,0.12)' : 'var(--bg3)', color: insp.status === 'pass' ? 'var(--accent)' : insp.status === 'fail' ? '#e05c4a' : 'var(--muted)' }}>{insp.status?.toUpperCase()}</span>
                          {insp.approval_status === 'approved' && <span style={{ fontSize: 10, color: 'var(--accent)' }}>✓ อนุมัติแล้ว</span>}
                          {insp.approval_status === 'rejected' && <span style={{ fontSize: 10, color: '#e05c4a' }}>✕ ตีกลับ</span>}
                          {insp.approval_status === 'pending' && <span style={{ fontSize: 10, color: 'var(--muted)' }}>รออนุมัติ</span>}
                        </div>
                      </div>
                      <span style={{ color: 'var(--muted)' }}>›</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {viewInspection && (
          <HistoryModal inspection={viewInspection} checkpoints={checkpoints} jig={selectedJig}
            userId={userId} userRole={userRole}
            onClose={() => { setViewInspection(null); if (selectedJig) fetchHistory(selectedJig.id) }} />
        )}
      </AnimatePresence>
    </div>
  )
}
