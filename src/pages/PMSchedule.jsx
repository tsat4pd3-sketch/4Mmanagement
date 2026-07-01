import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { FREQ_LABEL, DEPT_LABEL, dueStatus, STATUS_META, computeNextDue } from '../lib/pmSchedule'

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

const S = {
  page: { padding: '28px 32px', minHeight: '100%', background: 'var(--bg)' },
  h1: { fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 },
  sub: { fontSize: 13, color: 'var(--muted)', marginTop: 4, marginBottom: 20 },
  deptBar: { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  deptBtn: (active, color) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`,
    background: active ? `${color}18` : 'var(--bg3)',
    color: active ? color : 'var(--muted)',
  }),
  summaryBar: { display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' },
  summaryCard: (color) => ({
    background: 'var(--card)', border: `1px solid ${color}30`,
    borderRadius: 'var(--radius-lg)', padding: '12px 20px', minWidth: 120,
    textAlign: 'center',
  }),
  table: { width: '100%', borderCollapse: 'collapse', background: 'var(--card)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border)' },
  statusBadge: (status) => {
    const meta = STATUS_META[status] ?? STATUS_META.ok
    return {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
      background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30`,
    }
  },
  actionBtn: (color) => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: `1px solid ${color}30`, background: `${color}12`, color,
    cursor: 'pointer',
  }),
}

function statusDot(status) {
  const meta = STATUS_META[status] ?? STATUS_META.ok
  return { width: 8, height: 8, borderRadius: '50%', background: meta.color, display: 'inline-block', marginRight: 6 }
}

export default function PMSchedule() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const department = searchParams.get('dept') || 'maintenance'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const setDept = (d) => setSearchParams({ dept: d })

  const fetchData = async () => {
    setLoading(true)

    const { data: checklists } = await supabase
      .from('pm_checklists')
      .select('id, equipment_id, frequency, name')
      .eq('module', 'mtn')
      .eq('department', department)
      .eq('is_active', true)

    if (!checklists || checklists.length === 0) { setRows([]); setLoading(false); return }

    const clIds = checklists.map(c => c.id)
    const eqIds = [...new Set(checklists.map(c => c.equipment_id))]

    const [{ data: equipment }, { data: schedules }] = await Promise.all([
      supabase.from('pm_equipment').select('id, name, jig_no, line_name, machine_no, equipment_type').in('id', eqIds),
      supabase.from('pm_schedules').select('*').in('checklist_id', clIds),
    ])

    const equipMap = {}
    ;(equipment ?? []).forEach(e => { equipMap[e.id] = e })
    const schedMap = {}
    ;(schedules ?? []).forEach(s => { schedMap[s.checklist_id] = s })

    const built = checklists.map(cl => {
      const eq = equipMap[cl.equipment_id] ?? {}
      const sched = schedMap[cl.id] ?? null
      const lastDone = sched?.last_done_at ?? null
      const nextDue = sched?.next_due_date ? new Date(sched.next_due_date) : computeNextDue(lastDone, cl.frequency)
      const status = dueStatus(nextDue, cl.frequency)
      return { cl, eq, sched, nextDue, status }
    })

    // Sort: overdue first, then due_soon, then never, then ok, then periodic
    built.sort((a, b) => {
      const ORDER = { overdue: 0, due_soon: 1, never: 2, ok: 3, periodic: 4 }
      return (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5)
    })

    setRows(built)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [department]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  const deptColor = DEPT_COLORS[department] ?? '#3dd65c'

  return (
    <div style={S.page}>
      <div>
        <h1 style={S.h1}>แผน PM</h1>
        <p style={S.sub}>ตารางการตรวจสอบ · {DEPT_LABEL[department] ?? department}</p>
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

      {/* Summary cards */}
      {!loading && rows.length > 0 && (
        <div style={S.summaryBar}>
          {Object.entries(STATUS_META).map(([key, meta]) => {
            const cnt = counts[key] ?? 0
            if (cnt === 0) return null
            return (
              <div key={key} style={S.summaryCard(meta.color)}>
                <div style={{ fontSize: 22, fontWeight: 900, color: meta.color, fontFamily: 'var(--font-display)' }}>{cnt}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{meta.label}</div>
              </div>
            )
          })}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <div style={{ width: 32, height: 32, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 'var(--radius-lg)', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>ยังไม่มีแผน PM</p>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>ตั้งค่าอุปกรณ์ใน PM Setup ก่อน</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th>อุปกรณ์</th>
                <th>ไลน์</th>
                <th>ความถี่</th>
                <th>ตรวจล่าสุด</th>
                <th>ครบกำหนด</th>
                <th>สถานะ</th>
                <th style={{ textAlign: 'right' }}>ดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cl, eq, sched, nextDue, status }) => {
                const meta = STATUS_META[status] ?? STATUS_META.ok
                const isOverdue = status === 'overdue'
                return (
                  <tr key={cl.id} style={{ background: isOverdue ? 'rgba(224,92,74,0.04)' : undefined }}>
                    <td>
                      <p style={{ fontWeight: 700, color: 'var(--text)', margin: 0 }}>{eq.name ?? '—'}</p>
                      {eq.jig_no && <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>No. {eq.jig_no}</p>}
                    </td>
                    <td style={{ color: 'var(--text2)', fontSize: 13 }}>
                      {eq.line_name ?? '—'}
                      {eq.machine_no && <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {eq.machine_no}</span>}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--muted)' }}>{FREQ_LABEL[cl.frequency] ?? cl.frequency}</td>
                    <td style={{ fontSize: 13, color: 'var(--text2)' }}>
                      {sched?.last_done_at
                        ? new Date(sched.last_done_at).toLocaleDateString('th-TH')
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ fontSize: 13, color: isOverdue ? '#e05c4a' : 'var(--text2)', fontWeight: isOverdue ? 700 : 400 }}>
                      {nextDue
                        ? nextDue.toLocaleDateString('th-TH')
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                      {isOverdue && nextDue && (
                        <div style={{ fontSize: 11, color: '#e05c4a' }}>
                          เกิน {Math.abs(Math.floor((nextDue - new Date()) / 86400000))} วัน
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={S.statusBadge(status)}>
                        <span style={statusDot(status)} />
                        {meta.label}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => navigate(`/pm-check?dept=${department}&equip=${eq.id}`)}
                        style={S.actionBtn(deptColor)}
                      >
                        ✓ ตรวจ
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
