import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabaseDR } from '../supabaseClient'
import { FREQ_LABEL, DEPT_LABEL, dueStatus, STATUS_META, computeNextDue, daysUntilDue } from '../lib/pmSchedule'
import useIsMobile from '../utils/useIsMobile'

const DEPT_COLORS = {
  maintenance: '#fb923c', jig_maintenance: '#34d399', die_maintenance: '#4d9fff',
  production: '#3dd65c', qa: '#9b8de8',
}

// Parse a 'YYYY-MM-DD' date (from pm_plans.next_due_date) as local midnight, not
// UTC, so the day-based due-status math stays aligned with the local calendar.
function parseLocalDate(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const DEPT_OPTIONS = [
  { key: 'maintenance', label: 'ซ่อมบำรุง' },
  { key: 'jig_maintenance', label: 'JIG Maintenance' },
  { key: 'die_maintenance', label: 'Die Maintenance' },
  { key: 'production', label: 'ฝ่ายผลิต' },
]

const VIEW_OPTIONS = [
  { key: 'timeline', label: '📊 Timeline' },
  { key: 'calendar', label: '📅 ปฏิทิน' },
  { key: 'buckets', label: '🗂️ การ์ด' },
  { key: 'table', label: '📋 ตาราง' },
]
const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

function atMidnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function daysBetween(from, to) { return Math.round((atMidnight(to).getTime() - atMidnight(from).getTime()) / 86400000) }
function dayKey(d) { const x = atMidnight(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}` }
const fmtDay = (d) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })

const S = {
  page: { padding: 'clamp(12px,3vw,28px) clamp(14px,3.5vw,32px)', minHeight: '100%', background: 'var(--bg)' },
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
  const [view, setView] = useState('timeline')

  const setDept = (d) => setSearchParams({ dept: d })

  const fetchData = async () => {
    setLoading(true)

    const { data: checklists } = await supabaseDR
      .from('checklists')
      .select('id, equipment_id, frequency, name')
      .eq('module', 'mtn')
      .eq('department', department)

    if (!checklists || checklists.length === 0) { setRows([]); setLoading(false); return }

    const clIds = checklists.map(c => c.id)
    const eqIds = [...new Set(checklists.map(c => c.equipment_id))]

    const [{ data: jigs }, { data: inspections }, { data: plans }] = await Promise.all([
      supabaseDR.from('jigs').select('id, name, jig_no, line_name, machine_no, equipment_type').in('id', eqIds),
      supabaseDR.from('inspections').select('checklist_id, inspected_at').in('checklist_id', clIds).neq('approval_status', 'rejected').order('inspected_at', { ascending: false }),
      // Server-materialized plan (pm_plans, Phase 1). If the table isn't there yet
      // the query just returns null and we fall back to computing due dates live.
      supabaseDR.from('pm_plans').select('checklist_id, next_due_date, next_due_reason, last_done_at, health_score, plan_type').in('checklist_id', clIds),
    ])

    const jigMap = {}
    ;(jigs ?? []).forEach(j => { jigMap[j.id] = j })
    // most recent inspection per checklist (inspections already ordered desc)
    const lastInspMap = {}
    ;(inspections ?? []).forEach(i => { if (!lastInspMap[i.checklist_id]) lastInspMap[i.checklist_id] = i.inspected_at })
    const planMap = {}
    ;(plans ?? []).forEach(p => { planMap[p.checklist_id] = p })

    const built = checklists.map(cl => {
      const eq = jigMap[cl.equipment_id] ?? {}
      const plan = planMap[cl.id]
      const lastDone = plan?.last_done_at ?? lastInspMap[cl.id] ?? null
      // Prefer the server-materialized next_due_date; fall back to live compute
      // when there's no plan row (or the migration hasn't run yet).
      const nextDue = plan?.next_due_date ? parseLocalDate(plan.next_due_date) : computeNextDue(lastDone, cl.frequency)
      const status = dueStatus(nextDue, cl.frequency)
      return { cl, eq, lastDone, nextDue, status, reason: plan?.next_due_reason ?? 'time',
               planType: plan?.plan_type ?? 'time', health: plan?.health_score ?? null }
    })

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
  const today = atMidnight(new Date())
  const goCheck = (equipId) => navigate(`/pm-check?dept=${department}&equip=${equipId}`)

  return (
    <div style={S.page}>
      <div>
        <h1 style={S.h1}>แผน PM</h1>
        <p style={S.sub}>ตารางการตรวจสอบ · {DEPT_LABEL[department] ?? department}</p>
      </div>

      <div style={S.deptBar}>
        {DEPT_OPTIONS.map(d => (
          <button key={d.key} onClick={() => setDept(d.key)}
            style={S.deptBtn(department === d.key, DEPT_COLORS[d.key] ?? '#3dd65c')}>
            {d.label}
          </button>
        ))}
      </div>

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

      {!loading && rows.length > 0 && (
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10, background: 'var(--bg3)', border: '1px solid var(--border)', marginBottom: 16 }}>
          {VIEW_OPTIONS.map(v => (
            <button key={v.key} onClick={() => setView(v.key)} style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: view === v.key ? 'var(--card)' : 'transparent', color: view === v.key ? 'var(--text)' : 'var(--muted)',
              boxShadow: view === v.key ? '0 1px 3px rgba(0,0,0,0.25)' : 'none',
            }}>{v.label}</button>
          ))}
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
      ) : view === 'table' ? (
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
              {rows.map(({ cl, eq, lastDone, nextDue, status, reason, planType, health }) => {
                const meta = STATUS_META[status] ?? STATUS_META.ok
                const isOverdue = status === 'overdue'
                const isUsage = planType === 'usage' || planType === 'hybrid'
                const healthColor = health == null ? 'var(--muted)' : health >= 60 ? '#3dd65c' : health >= 30 ? '#e0b34a' : '#e05c4a'
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
                      {lastDone ? new Date(lastDone).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }) : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ fontSize: 13, color: isOverdue ? '#e05c4a' : 'var(--text2)', fontWeight: isOverdue ? 700 : 400 }}>
                      {nextDue ? nextDue.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      {isOverdue && nextDue && (
                        <div style={{ fontSize: 11, color: '#e05c4a' }}>
                          เกิน {Math.abs(daysUntilDue(nextDue))} วัน
                        </div>
                      )}
                      {isUsage && (
                        <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: reason === 'usage' ? '#4aa3e0' : 'var(--muted)', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>
                            {reason === 'usage' ? '📈 ตามการใช้งาน' : '🗓️ ตามเวลา'}
                          </span>
                          {health != null && (
                            <span title="สุขภาพ (ยิ่งต่ำยิ่งใกล้ครบตามยอดผลิต)" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ width: 44, height: 5, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden', display: 'inline-block' }}>
                                <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, health))}%`, background: healthColor }} />
                              </span>
                              <span style={{ fontSize: 11, color: healthColor }}>{Math.round(health)}%</span>
                            </span>
                          )}
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
                        onClick={() => navigate(`/pm-check?dept=${department}&equip=${cl.equipment_id}`)}
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
      ) : view === 'timeline' ? (
        <TimelineView rows={rows} today={today} onCheck={goCheck} />
      ) : view === 'calendar' ? (
        <CalendarView rows={rows} today={today} onCheck={goCheck} />
      ) : (
        <BucketView rows={rows} today={today} onCheck={goCheck} />
      )}

    </div>
  )
}

// ── Timeline (Gantt-style: 1 แถว/อุปกรณ์, บาร์นับถอยหลัง + หมุดวันครบกำหนด) ──
function TimelineView({ rows, today, onCheck }) {
  const RANGE = 90
  const marks = [0, 30, 60, 90]
  const isMobile = useIsMobile()
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
     {/* จอมือถือ: บอร์ด Gantt กว้างเกินจอ → เลื่อนแนวนอนได้ (label 200 + timeline 320 = 520px) desktop เหมือนเดิม */}
     <div style={{ overflowX: isMobile ? 'auto' : undefined, WebkitOverflowScrolling: 'touch' }}>
      <div style={{ minWidth: isMobile ? 540 : undefined }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
        <div style={{ width: 200, flexShrink: 0, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>อุปกรณ์ / ไลน์</div>
        <div style={{ flex: 1, position: 'relative', height: 34, minWidth: 320 }}>
          {marks.map(m => (
            <div key={m} style={{ position: 'absolute', left: `${(m / RANGE) * 100}%`, top: 0, bottom: 0, borderLeft: '1px dashed var(--border2)', paddingLeft: 4, display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: m === 0 ? 'var(--accent)' : 'var(--muted)', fontWeight: m === 0 ? 700 : 400, whiteSpace: 'nowrap' }}>{m === 0 ? '📍 วันนี้' : `+${m} วัน`}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
        {rows.map(r => {
          const meta = STATUS_META[r.status] ?? STATUS_META.ok
          const days = r.nextDue ? daysBetween(today, r.nextDue) : null
          const x = days == null ? null : Math.max(0, Math.min(100, (days / RANGE) * 100))
          const labelLeft = x != null && x <= 60
          const labelTxt = days == null ? '' : `${fmtDay(r.nextDue)} · ${days === 0 ? 'วันนี้' : `อีก ${days} วัน`}`
          return (
            <div key={r.cl.id} onClick={() => onCheck(r.cl.equipment_id)}
              style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: r.status === 'overdue' ? 'rgba(224,92,74,0.05)' : undefined }}>
              <div style={{ width: 200, flexShrink: 0, padding: '7px 12px', borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.eq.name ?? '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.eq.line_name ?? '—'} · {FREQ_LABEL[r.cl.frequency] ?? r.cl.frequency}</div>
              </div>
              <div style={{ flex: 1, position: 'relative', minHeight: 40, minWidth: 320 }}>
                {marks.map(m => <div key={m} style={{ position: 'absolute', left: `${(m / RANGE) * 100}%`, top: 0, bottom: 0, borderLeft: '1px dashed var(--border)' }} />)}
                {days == null ? (
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--muted)' }}>— ไม่มีรอบตายตัว</span>
                ) : days < 0 ? (
                  <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 13, height: 13, borderRadius: '50%', background: meta.color, boxShadow: `0 0 6px ${meta.color}aa` }} />
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: meta.color }}>เกินกำหนด {Math.abs(days)} วัน</span>
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'absolute', left: 0, width: `${x}%`, top: '50%', height: 4, transform: 'translateY(-50%)', background: `${meta.color}40`, borderRadius: 2 }} />
                    <div style={{ position: 'absolute', left: `${x}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 14, height: 14, borderRadius: '50%', background: meta.color, border: '2px solid var(--card)', boxShadow: `0 0 0 1.5px ${meta.color}` }} />
                    <span style={labelLeft
                      ? { position: 'absolute', left: `calc(${x}% + 13px)`, top: '50%', transform: 'translateY(-50%)', fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap' }
                      : { position: 'absolute', right: `calc(${100 - x}% + 13px)`, top: '50%', transform: 'translateY(-50%)', fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap', textAlign: 'right' }}>{labelTxt}</span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      </div>
     </div>
    </div>
  )
}

// ── ปฏิทินรายเดือน ──
function CalendarView({ rows, today, onCheck }) {
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [daySel, setDaySel] = useState(null)
  const navBtn = { width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, cursor: 'pointer', flexShrink: 0 }
  const byDay = {}
  rows.forEach(r => { if (r.nextDue) { const k = dayKey(r.nextDue); (byDay[k] ||= []).push(r) } })
  const overdue = rows.filter(r => r.nextDue && daysBetween(today, r.nextDue) < 0)
  const y = cursor.getFullYear(), mo = cursor.getMonth()
  const startPad = new Date(y, mo, 1).getDay()
  const daysInMonth = new Date(y, mo + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, mo, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const todayKey = dayKey(today)
  return (
    <div>
      {overdue.length > 0 && (
        <div onClick={() => setDaySel({ label: `เกินกำหนด (${overdue.length} รายการ)`, items: overdue })}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(224,92,74,0.1)', border: '1px solid #e05c4a55', borderRadius: 10, padding: '8px 14px', marginBottom: 12, cursor: 'pointer' }}>
          <span style={{ fontSize: 15 }}>🔴</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e05c4a' }}>เกินกำหนดแล้ว {overdue.length} รายการ</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>คลิกดูรายการ →</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => setCursor(new Date(y, mo - 1, 1))} style={navBtn}>◀</button>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', minWidth: 170, textAlign: 'center' }}>{MONTHS_TH[mo]} {y + 543}</div>
        <button onClick={() => setCursor(new Date(y, mo + 1, 1))} style={navBtn}>▶</button>
        <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} style={{ ...navBtn, width: 'auto', padding: '0 14px', fontSize: 12, fontWeight: 700 }}>วันนี้</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 10 }}>
        {DOW_TH.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--muted)', padding: '2px 0' }}>{d}</div>)}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />
          const items = byDay[dayKey(date)] ?? []
          const isToday = dayKey(date) === todayKey
          return (
            <div key={i} onClick={() => items.length && setDaySel({ label: fmtDay(date), items })}
              style={{ minHeight: 76, borderRadius: 8, border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}`, background: isToday ? 'var(--accent-dim)' : 'var(--bg3)', padding: 5, cursor: items.length ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: isToday ? 'var(--accent)' : 'var(--text2)' }}>{date.getDate()}</div>
              {items.slice(0, 3).map(r => {
                const meta = STATUS_META[r.status] ?? STATUS_META.ok
                return <div key={r.cl.id} title={r.eq.name} style={{ fontSize: 11, color: '#fff', background: meta.color, borderRadius: 4, padding: '0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.eq.name}</div>
              })}
              {items.length > 3 && <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>+{items.length - 3} รายการ</div>}
            </div>
          )
        })}
      </div>
      {daySel && <DayModal sel={daySel} onClose={() => setDaySel(null)} onCheck={onCheck} />}
    </div>
  )
}

// popup รายการอุปกรณ์ครบกำหนดในวันนั้น (display-only → ปิดจากคลิกนอก/✕ ได้)
function DayModal({ sel, onClose, onCheck }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: 'min(94vw, 460px)', maxHeight: '86vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>📅 {sel.label}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 9px', fontSize: 13, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sel.items.map(r => {
            const meta = STATUS_META[r.status] ?? STATUS_META.ok
            return (
              <div key={r.cl.id} style={{ display: 'flex', alignItems: 'center', gap: 10, borderLeft: `3px solid ${meta.color}`, background: 'var(--bg3)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{r.eq.name ?? '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.eq.line_name ?? '—'} · {FREQ_LABEL[r.cl.frequency] ?? r.cl.frequency} · <span style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span></div>
                </div>
                <button onClick={() => onCheck(r.cl.equipment_id)} style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: 'none', background: 'var(--accent)', color: '#071008', cursor: 'pointer' }}>✓ ตรวจ</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── การ์ดจัดกลุ่มตามช่วงเวลา (Kanban by due window) ──
function BucketView({ rows, today, onCheck }) {
  const b = { overdue: [], week: [], month: [], later: [], none: [] }
  rows.forEach(r => {
    if (!r.nextDue) return b.none.push(r)
    const d = daysBetween(today, r.nextDue)
    if (d < 0) b.overdue.push(r)
    else if (d <= 7) b.week.push(r)
    else if (d <= 30) b.month.push(r)
    else b.later.push(r)
  })
  const cols = [
    { key: 'overdue', label: '🔴 เกินกำหนด', color: '#e05c4a' },
    { key: 'week', label: '🟠 ครบใน 7 วัน', color: '#f59a3f' },
    { key: 'month', label: '🟡 ครบในเดือนนี้', color: '#e0b34a' },
    { key: 'later', label: '🟢 ถัดไป', color: '#3dd65c' },
    { key: 'none', label: '⚪ ไม่มีรอบ/ยังไม่ตรวจ', color: '#9b8de8' },
  ]
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'stretch', paddingBottom: 8 }}>
      {cols.map(c => (
        <div key={c.key} style={{ flex: '1 1 240px', minWidth: 240, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 320px)' }}>
          <div style={{ padding: '10px 12px', borderBottom: `2px solid ${c.color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{c.label}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: c.color, background: `${c.color}18`, borderRadius: 10, padding: '1px 8px' }}>{b[c.key].length}</span>
          </div>
          <div style={{ overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {b[c.key].length === 0
              ? <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>—</div>
              : b[c.key].map(r => {
                const meta = STATUS_META[r.status] ?? STATUS_META.ok
                const d = r.nextDue ? daysBetween(today, r.nextDue) : null
                return (
                  <div key={r.cl.id} onClick={() => onCheck(r.cl.equipment_id)}
                    style={{ borderLeft: `3px solid ${meta.color}`, background: 'var(--bg3)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.eq.name ?? '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{r.eq.line_name ?? '—'} · {FREQ_LABEL[r.cl.frequency] ?? r.cl.frequency}</div>
                    <div style={{ fontSize: 11, color: meta.color, fontWeight: 700, marginTop: 3 }}>
                      {d == null ? meta.label : d < 0 ? `เกิน ${Math.abs(d)} วัน` : d === 0 ? 'ครบวันนี้' : `อีก ${d} วัน · ${fmtDay(r.nextDue)}`}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
