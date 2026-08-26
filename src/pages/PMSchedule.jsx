import { useState, useEffect, useContext } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabaseDR } from '../supabaseClient'
import { FREQ_LABEL, DEPT_LABEL, dueStatus, dueStatusDefer, deferActive, STATUS_META, computeNextDue, daysUntilDue } from '../lib/pmSchedule'
import useIsMobile from '../utils/useIsMobile'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { loadPmTeams, pmTeamsSync } from '../utils/pmTeams'
import { inspMeta } from '../utils/inspectionStatus'

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
// 'YYYY-MM-DD' จากเวลา local — ห้ามใช้ toISOString() (คืน UTC → เที่ยงคืนไทยกลายเป็นวันก่อนหน้าเสมอ · ดู CLAUDE.md "Date/Time Utilities")
function ymd(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
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
  const [insps, setInsps] = useState([])   // ผลตรวจจริง (ใช้วาดชั้น "ทำจริง" บนปฏิทิน)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('timeline')
  const [deferFor, setDeferFor] = useState(null)   // แถวที่กำลังเลื่อนแผน
  const [teams, setTeams] = useState(pmTeamsSync()) // ทีมช่าง data-driven (mtn_teams)
  useEffect(() => { loadPmTeams().then(setTeams) }, [])

  const { role, fullName, uid } = useContext(UserContext)
  const canDefer = can('pm', 'setup', role)

  const setDept = (d) => setSearchParams({ dept: d })

  // ยกเลิกการเลื่อน (กลับไปใช้วันครบกำหนดเดิม)
  const cancelDefer = async (r) => {
    if (!r.plan?.id) return
    if (!confirm('ยกเลิกการเลื่อนแผน กลับไปวันครบกำหนดเดิม?')) return
    const { error } = await supabaseDR.from('pm_plans').update({ deferred_to: null, defer_reason: null, defer_agreed_with: null, deferred_by: null, deferred_at: null }).eq('id', r.plan.id)
    if (error) return toast.error(error.message)
    toast.success('ยกเลิกการเลื่อนแล้ว'); fetchData()
  }

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
      supabaseDR.from('inspections').select('id, checklist_id, inspected_at, status').in('checklist_id', clIds).neq('approval_status', 'rejected').order('inspected_at', { ascending: false }),
      // Server-materialized plan (pm_plans, Phase 1). If the table isn't there yet
      // the query just returns null and we fall back to computing due dates live.
      supabaseDR.from('pm_plans').select('id, checklist_id, next_due_date, next_due_reason, last_done_at, health_score, plan_type, deferred_to, defer_reason, defer_agreed_with, deferred_by, deferred_at, defer_count').in('checklist_id', clIds),
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
      const origDue = plan?.next_due_date ? parseLocalDate(plan.next_due_date) : computeNextDue(lastDone, cl.frequency)
      // การเลื่อนแผนที่ตกลงแล้ว (ถ้ายังไม่ถูกทำหลังเลื่อน) → ใช้วันเลื่อนแทน + สถานะ 'เลื่อนแผน'
      const isDeferred = deferActive(plan)
      const deferTo = isDeferred && plan?.deferred_to ? parseLocalDate(plan.deferred_to) : null
      const nextDue = deferTo || origDue
      const status = dueStatusDefer(origDue, cl.frequency, deferTo)
      return { cl, eq, lastDone, nextDue, status, reason: plan?.next_due_reason ?? 'time',
               planType: plan?.plan_type ?? 'time', health: plan?.health_score ?? null,
               plan, isDeferred, deferReason: plan?.defer_reason, deferBy: plan?.deferred_by, deferCount: plan?.defer_count ?? 0 }
    })

    built.sort((a, b) => {
      const ORDER = { overdue: 0, due_soon: 1, deferred: 1.5, never: 2, ok: 3, periodic: 4 }
      return (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5)
    })

    /* ⚠️ ผลตรวจจริงต้องย้อนกลับเข้า "แผน" ด้วย (feedback หน้างาน 2026-08-25:
       "เตือนแล้วไม่ทำ · ไม่มี input กลับมาว่าผลทำเป็นยังไง")
       เดิมดึง inspections มาแล้วใช้แค่ตัวล่าสุดต่อ checklist — ที่เหลือถูกทิ้ง
       ทำให้ปฏิทินเป็น "แผนล้วน" ไม่มีร่องรอยว่าวันไหนทำจริง/ผลเป็นยังไง */
    const eqNameByCl = {}
    checklists.forEach(c => { eqNameByCl[c.id] = jigMap[c.equipment_id]?.name ?? '—' })
    setInsps((inspections ?? []).map(i => ({ ...i, eqName: eqNameByCl[i.checklist_id] ?? '—' })))
    setRows(built)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [department]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  // สี/ป้ายทีม — data-driven จาก mtn_teams (teams) ก่อน แล้ว fallback map เดิม
  const teamMeta = teams.find(t => t.key === department)
  const deptColor = teamMeta?.color ?? DEPT_COLORS[department] ?? '#3dd65c'
  const today = atMidnight(new Date())
  const goCheck = (equipId) => navigate(`/pm-check?dept=${department}&equip=${equipId}`)

  return (
    <div style={S.page}>
      <div>
        <h1 style={S.h1}>แผน PM</h1>
        <p style={S.sub}>ตารางการตรวจสอบ · {teamMeta?.label ?? DEPT_LABEL[department] ?? department}</p>
      </div>

      <div style={S.deptBar}>
        {teams.map(d => (
          <button key={d.key} onClick={() => setDept(d.key)}
            style={S.deptBtn(department === d.key, d.color || DEPT_COLORS[d.key] || '#3dd65c')}>
            {d.icon ? `${d.icon} ` : ''}{d.label}
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
        <div className="table-sticky" style={{ overflowX: 'auto' }}>
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
              {rows.map((r) => {
                const { cl, eq, lastDone, nextDue, status, reason, planType, health, isDeferred, deferReason, deferBy, deferCount } = r
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
                    <td style={{ fontSize: 13, color: isOverdue ? '#e05c4a' : isDeferred ? '#4a90e0' : 'var(--text2)', fontWeight: (isOverdue || isDeferred) ? 700 : 400 }}>
                      {nextDue ? nextDue.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      {isOverdue && nextDue && (
                        <div style={{ fontSize: 11, color: '#e05c4a' }}>
                          เกิน {Math.abs(daysUntilDue(nextDue))} วัน
                        </div>
                      )}
                      {isDeferred && (
                        <div style={{ fontSize: 10.5, color: '#4a90e0', marginTop: 2 }}>
                          ⏭ เลื่อนแผน{deferReason ? ` · ${deferReason}` : ''}{deferCount > 1 ? ` · เลื่อนมา ${deferCount} ครั้ง` : ''}
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
                      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {canDefer && r.plan?.id && (isDeferred
                          ? <button onClick={() => cancelDefer(r)} style={{ ...S.actionBtn('#8b8b96') }} title="ยกเลิกการเลื่อน">✕ ยกเลิกเลื่อน</button>
                          : <button onClick={() => setDeferFor(r)} style={{ ...S.actionBtn('#4a90e0') }} title="เลื่อนแผน PM (คิวผลิตแน่น ฯลฯ)">⏭ เลื่อนแผน</button>)}
                        <button
                          onClick={() => navigate(`/pm-check?dept=${department}&equip=${cl.equipment_id}`)}
                          style={S.actionBtn(deptColor)}
                        >
                          ✓ ตรวจ
                        </button>
                      </div>
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
        <CalendarView rows={rows} insps={insps} today={today} onCheck={goCheck} />
      ) : (
        <BucketView rows={rows} today={today} onCheck={goCheck} />
      )}

      {deferFor && <DeferModal row={deferFor} byName={fullName} byUid={uid} onClose={() => setDeferFor(null)} onSaved={() => { setDeferFor(null); fetchData() }} />}
    </div>
  )
}

// ── Modal เลื่อนแผน PM (คิวผลิตแน่น/ตัดไฟไม่ได้ ฯลฯ) ──
function DeferModal({ row, byName, byUid, onClose, onSaved }) {
  const eqName = row.eq?.name ?? '—'
  const curDue = row.nextDue ? ymd(row.nextDue) : ''
  // ค่าเริ่มต้นวันเลื่อน = ครบกำหนดเดิม + 30 วัน
  const suggest = (() => { const d = row.nextDue ? new Date(row.nextDue) : new Date(); d.setDate(d.getDate() + 30); return ymd(d) })()
  const [toDue, setToDue] = useState(suggest)
  const [reason, setReason] = useState('')
  const [agreed, setAgreed] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!toDue) return toast.error('เลือกวันที่เลื่อนไป')
    if (!reason.trim()) return toast.error('กรอกเหตุผลการเลื่อน')
    if (!row.plan?.id) return toast.error('ยังไม่มีแผน (pm_plans) ของรายการนี้')
    setSaving(true)
    const nowIso = new Date().toISOString()
    const { error } = await supabaseDR.from('pm_plans').update({
      deferred_to: toDue, defer_reason: reason.trim(), defer_agreed_with: agreed.trim() || null,
      deferred_by: byName || null, deferred_at: nowIso, defer_count: (row.deferCount || 0) + 1,
    }).eq('id', row.plan.id)
    if (error) { setSaving(false); return toast.error(error.message) }
    // log ประวัติ
    await supabaseDR.from('pm_plan_deferrals').insert({
      plan_id: row.plan.id, checklist_id: row.cl.id, from_due: curDue || null, to_due: toDue,
      reason: reason.trim(), agreed_with: agreed.trim() || null, by_name: byName || null, by_uid: byUid || null,
    })
    // แจ้ง Telegram (best-effort ไม่บล็อก)
    try {
      await fetch('https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'pm_deferred', pm: {
          equip: `${row.eq?.machine_no ? row.eq.machine_no + ' ' : ''}${eqName}`.trim(),
          line_name: row.eq?.line_name || '', from_due: curDue, to_due: toDue,
          reason: reason.trim(), agreed_with: agreed.trim(), by_name: byName || '', defer_count: (row.deferCount || 0) + 1,
        } }),
      })
    } catch { /* เงียบ */ }
    setSaving(false); toast.success('บันทึกการเลื่อนแผนแล้ว'); onSaved()
  }

  const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 }
  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, width: 'min(440px,96vw)' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>⏭ เลื่อนแผน PM</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>{eqName}{row.eq?.line_name ? ` · ${row.eq.line_name}` : ''} · ครบกำหนดเดิม {curDue ? new Date(curDue).toLocaleDateString('th-TH') : '—'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>เลื่อนไปวันที่
            <input type="date" value={toDue} onChange={e => setToDue(e.target.value)} style={{ ...inp, marginTop: 4 }} />
            {toDue && <span style={{ fontSize: 11, color: 'var(--muted)' }}>= {new Date(toDue).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>เหตุผลการเลื่อน *
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น คิวผลิตแน่น ผลิตไม่หยุด / ตัดไฟไม่ได้ช่วงนี้" style={{ ...inp, marginTop: 4, minHeight: 54 }} />
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>ตกลงร่วมกับ (planner / production)
            <input value={agreed} onChange={e => setAgreed(e.target.value)} placeholder="ชื่อผู้ที่ตกลงเลื่อนด้วย" style={{ ...inp, marginTop: 4 }} />
          </label>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>* บันทึกประวัติการเลื่อนไว้ · รอบ PM ถัดไปยังนับจากวันที่ทำจริง</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
          <button onClick={save} disabled={saving} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#4a90e0', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>{saving ? 'บันทึก…' : 'บันทึกการเลื่อน'}</button>
        </div>
      </div>
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
function CalendarView({ rows, insps = [], today, onCheck }) {
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [daySel, setDaySel] = useState(null)
  const navBtn = { width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13, cursor: 'pointer', flexShrink: 0 }
  const byDay = {}
  rows.forEach(r => { if (r.nextDue) { const k = dayKey(r.nextDue); (byDay[k] ||= []).push(r) } })
  /* ชั้น "ทำจริง" — ผลตรวจที่เกิดขึ้นวันนั้น (คนละชั้นกับ "แผน" ที่ครบกำหนดวันนั้น)
     ⚠️ status เทียบตรงตัวผ่าน inspMeta เท่านั้น ห้าม regex (pending/warning จะติด /fail|ng/) */
  const doneByDay = {}
  insps.forEach(i => {
    if (!i.inspected_at) return
    const k = dayKey(new Date(i.inspected_at))
    ;(doneByDay[k] ||= []).push({ ...i, meta: inspMeta(i.status) })
  })
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
          const k = dayKey(date)
          const items = byDay[k] ?? []
          const done = doneByDay[k] ?? []
          const isToday = k === todayKey
          /* ⚠️ วันที่เลยมาแล้วแต่ยังไม่ได้ทำ ต้อง "แดงค้าง" ทั้งช่อง ไม่ใช่เทาไปเฉยๆ
             (feedback หน้างาน: "ในแผนที่ควรแดงค้างรึป่าว ไม่ใช่เทาไปเลย")
             เดิมทั้งช่องเป็นเทาเสมอ มีแค่ชิปเล็กๆ ข้างในเป็นสี — มองผ่านๆ ไม่เห็น */
          const missed = items.some(r => r.status === 'overdue')
          const bg = isToday ? 'var(--accent-dim)' : missed ? 'rgba(224,92,74,0.16)' : 'var(--bg3)'
          const bd = missed ? '#e05c4a' : isToday ? 'var(--accent)' : 'var(--border)'
          const clickable = items.length || done.length
          return (
            <div key={i} onClick={() => clickable && setDaySel({ label: fmtDay(date), items, done })}
              style={{ minHeight: 76, borderRadius: 8, border: `1px solid ${bd}`, borderWidth: missed ? 2 : 1, background: bg, padding: 5, cursor: clickable ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: missed ? '#e05c4a' : isToday ? 'var(--accent)' : 'var(--text2)' }}>{date.getDate()}</span>
                {/* ผลตรวจที่ "ทำจริง" วันนั้น — ✅ ปกติ / ⚠️ พบผิดปกติ / ⏳ ตรวจไม่ครบ */}
                {done.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800 }} title={`ตรวจจริง ${done.length} รายการ`}>
                    {[...new Set(done.map(x => x.meta.icon))].join('')}
                    <span style={{ color: 'var(--muted)', marginLeft: 2 }}>{done.length}</span>
                  </span>
                )}
              </div>
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: 'min(94vw, 460px)', maxHeight: '86vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>📅 {sel.label}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 9px', fontSize: 13, cursor: 'pointer' }}>✕</button>
        </div>
        {/* ── ① แผนที่ครบกำหนดวันนี้ ── */}
        {sel.items.length > 0 && (
          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--muted)', marginBottom: 6 }}>📋 แผนที่ครบกำหนดวันนี้</div>
        )}
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

        {/* ── ② ผลตรวจที่ "ทำจริง" วันนั้น — ปิดลูป แผน → เตือน → ทำ → ผล ── */}
        {(sel.done?.length ?? 0) > 0 && (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--muted)', margin: '14px 0 6px' }}>✅ ตรวจจริงวันนี้ ({sel.done.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sel.done.map(x => (
                <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 9, borderLeft: `3px solid ${x.meta.color}`, background: 'var(--bg3)', borderRadius: 8, padding: '7px 12px' }}>
                  <span style={{ fontSize: 14 }}>{x.meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.eqName}</div>
                    <div style={{ fontSize: 11, color: x.meta.color, fontWeight: 700 }}>{x.meta.label}</div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>
                    {new Date(x.inspected_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ⚠️ วันที่เลยมาแล้ว มีแผน แต่ไม่มีผลตรวจเลย = ตกไปจริงๆ ต้องพูดออกมา ห้ามเงียบ */}
        {sel.items.some(r => r.status === 'overdue') && (sel.done?.length ?? 0) === 0 && (
          <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 8, background: 'rgba(224,92,74,0.12)', border: '1px solid #e05c4a55', fontSize: 12, color: '#e05c4a', lineHeight: 1.6 }}>
            🔴 <b>ยังไม่มีผลตรวจของวันนี้</b> — แผนเลยกำหนดมาแล้วและไม่มีใครบันทึกว่าทำ
            <div style={{ color: 'var(--muted)', marginTop: 3 }}>ทำแล้วให้กด “✓ ตรวจ” เพื่อบันทึกผล · ทำไม่ได้ให้เลื่อนแผนพร้อมเหตุผล จะได้ไม่ค้างแดงไปเรื่อยๆ</div>
          </div>
        )}
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
