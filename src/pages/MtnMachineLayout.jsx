import { useState, useEffect, useMemo } from 'react'
import { supabase, supabaseDR } from '../supabaseClient'
import { dueStatus, STATUS_META, DEPT_LABEL, computeNextDue, daysUntilDue } from '../lib/pmSchedule'
import MachineFloorMap from '../components/MachineFloorMap'

// 'YYYY-MM-DD' (from pm_plans.next_due_date) → local-midnight Date, so day math
// stays aligned with the Asia/Bangkok calendar (not UTC).
function parseLocalDate(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Maintenance departments this view can filter by (production/qa excluded — this
// is the maintenance POV). 'all' shows every responsibility together.
const MTN_DEPTS = ['maintenance', 'jig_maintenance', 'die_maintenance']
const DEPT_ICON = { maintenance: '🔧', jig_maintenance: '🧩', die_maintenance: '🗜️' }

// worst (most urgent) status wins for a machine that has several checklists
function worstStatus(statuses) {
  let best = null
  for (const s of statuses) {
    if (!best || (STATUS_META[s]?.order ?? 9) < (STATUS_META[best]?.order ?? 9)) best = s
  }
  return best
}

const S = {
  page: { padding: '24px 28px', minHeight: '100%', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 16 },
  h1: { fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 },
  sub: { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  chip: (active, color) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`,
    background: active ? `${color}18` : 'var(--bg3)', color: active ? color : 'var(--muted)',
  }),
  lineBtn: (active, child) => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
    marginLeft: child ? 12 : 0, fontSize: 13,
    border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
    background: active ? 'var(--accent-dim)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text2)', fontWeight: active ? 700 : 500,
  }),
}

export default function MtnMachineLayout() {
  const [lines, setLines] = useState([])
  const [selectedLine, setSelectedLine] = useState(null)
  const [dept, setDept] = useState('all')
  const [imageUrl, setImageUrl] = useState(null)
  const [points, setPoints] = useState([])          // machine_points (MAIN)
  const [machineInfo, setMachineInfo] = useState({}) // machine_no → { name, checklists:[{dept,status,nextDue,eqName,freq}] }
  const [loading, setLoading] = useState(false)
  const [selId, setSelId] = useState(null)

  useEffect(() => {
    supabase.from('production_lines').select('id, name, parent_line_name').order('name')
      .then(({ data }) => {
        setLines(data || [])
        if (data?.length && !selectedLine) setSelectedLine(data[0].name)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (selectedLine) load() }, [selectedLine]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true); setSelId(null)
    const lineObj = lines.find(l => l.name === selectedLine)

    // ── background image (MAIN) with parent-line fallback ──
    const { data: lay } = await supabase.from('line_layouts').select('image_url').eq('line_name', selectedLine).maybeSingle()
    let img = lay?.image_url ?? null
    if (!img && lineObj?.parent_line_name) {
      const { data: pl } = await supabase.from('line_layouts').select('image_url').eq('line_name', lineObj.parent_line_name).maybeSingle()
      img = pl?.image_url ?? null
    }
    setImageUrl(img)

    // ── machine markers (MAIN) ──
    const { data: mp } = await supabase.from('machine_points').select('id, machine_no, pos_top, pos_left').eq('line_name', selectedLine)
    const mpoints = mp || []
    setPoints(mpoints)
    const machineNos = [...new Set(mpoints.map(p => p.machine_no).filter(Boolean))]

    if (!machineNos.length) { setMachineInfo({}); setLoading(false); return }

    // ── machine registry + PM chain (DR), joined by machine_no ──
    const { data: machines } = await supabaseDR.from('machines').select('id, machine_no, machine_name').eq('line_name', selectedLine)
    const nameByNo = {}, noById = {}
    ;(machines || []).forEach(m => { if (m.machine_no) nameByNo[m.machine_no] = m.machine_name; if (m.id) noById[m.id] = m.machine_no })

    // equipment (jigs) whose machine (by machine_no, or via machine_id) sits on this line
    const { data: jigs } = await supabaseDR.from('jigs').select('id, name, machine_no, machine_id, equipment_type').eq('module', 'mtn')
    const jigOnMachine = (jigs || []).map(j => ({ ...j, _mno: j.machine_no || noById[j.machine_id] || null }))
      .filter(j => j._mno && machineNos.includes(j._mno))
    const jigById = Object.fromEntries(jigOnMachine.map(j => [j.id, j]))
    const jigIds = jigOnMachine.map(j => j.id)

    let checklists = [], plans = []
    if (jigIds.length) {
      const { data: cls } = await supabaseDR.from('checklists').select('id, equipment_id, department, frequency, name').eq('module', 'mtn').in('equipment_id', jigIds)
      checklists = cls || []
      const clIds = checklists.map(c => c.id)
      if (clIds.length) {
        const { data: pl } = await supabaseDR.from('pm_plans').select('checklist_id, next_due_date, last_done_at').in('checklist_id', clIds)
        plans = pl || []
      }
    }
    const planByCl = Object.fromEntries(plans.map(p => [p.checklist_id, p]))

    // fold checklists onto their machine
    const info = {}
    machineNos.forEach(no => { info[no] = { name: nameByNo[no] || '', checklists: [] } })
    for (const cl of checklists) {
      const jig = jigById[cl.equipment_id]
      if (!jig || !info[jig._mno]) continue
      const plan = planByCl[cl.id]
      const lastDone = plan?.last_done_at ?? null
      const nextDue = plan?.next_due_date ? parseLocalDate(plan.next_due_date) : computeNextDue(lastDone, cl.frequency)
      info[jig._mno].checklists.push({
        dept: cl.department, status: dueStatus(nextDue, cl.frequency), nextDue,
        eqName: jig.name || '-', freq: cl.frequency, clName: cl.name,
      })
    }
    setMachineInfo(info)
    setLoading(false)
  }

  // enrich markers with color/dim/label for the current department filter
  const enrichedPoints = useMemo(() => points.map(p => {
    const info = machineInfo[p.machine_no] || { name: '', checklists: [] }
    const relevant = dept === 'all' ? info.checklists : info.checklists.filter(c => c.dept === dept)
    const responsible = relevant.length > 0
    const worst = responsible ? worstStatus(relevant.map(c => c.status)) : null
    const color = responsible ? (STATUS_META[worst]?.color ?? '#556') : (info.checklists.length ? '#3a4a3d' : '#3a4a3d')
    return {
      id: p.id, pos_top: p.pos_top, pos_left: p.pos_left,
      label: p.machine_no, sub: info.name,
      color, dim: dept !== 'all' && !responsible,
    }
  }), [points, machineInfo, dept])

  // status counts (responsible machines only, for the current filter)
  const counts = useMemo(() => {
    const c = {}
    enrichedPoints.forEach(p => { if (!p.dim) { const st = Object.keys(STATUS_META).find(k => STATUS_META[k].color === p.color); if (st) c[st] = (c[st] ?? 0) + 1 } })
    return c
  }, [enrichedPoints])

  const orderedLines = useMemo(() => {
    const parents = lines.filter(l => !l.parent_line_name)
    const children = lines.filter(l => l.parent_line_name)
    const out = []
    parents.forEach(p => { out.push({ ...p }); children.filter(c => c.parent_line_name === p.name).forEach(c => out.push({ ...c, _child: true })) })
    children.filter(c => !parents.find(p => p.name === c.parent_line_name)).forEach(c => out.push({ ...c, _child: true }))
    return out
  }, [lines])

  const sel = selId ? points.find(p => p.id === selId) : null
  const selInfo = sel ? (machineInfo[sel.machine_no] || { name: '', checklists: [] }) : null
  const selChecklists = selInfo ? (dept === 'all' ? selInfo.checklists : selInfo.checklists.filter(c => c.dept === dept)) : []

  return (
    <div style={S.page}>
      <div>
        <h1 style={S.h1}>🗺️ ผังเครื่องจักร (ซ่อมบำรุง)</h1>
        <p style={S.sub}>ดูสถานะ PM ของเครื่องจักรบนผังจริง · กรองตามผู้รับผิดชอบ</p>
      </div>

      {/* department filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setDept('all')} style={S.chip(dept === 'all', 'var(--accent)')}>ทั้งหมด</button>
        {MTN_DEPTS.map(d => (
          <button key={d} onClick={() => setDept(d)} style={S.chip(dept === d, '#4d9fff')}>
            {DEPT_ICON[d]} {DEPT_LABEL[d]}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {/* legend */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color }} />
              {m.label}{counts[k] ? ` (${counts[k]})` : ''}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {/* map + detail */}
        <div style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading
            ? <div style={{ flex: 1, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14 }}>
                <div style={{ width: 30, height: 30, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              </div>
            : <MachineFloorMap imageUrl={imageUrl} points={enrichedPoints} selectedId={selId} onSelect={p => setSelId(p.id)} />}

          {sel && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>⚙️ {sel.machine_no}{selInfo.name ? ` · ${selInfo.name}` : ''}</div>
                <button onClick={() => setSelId(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
              </div>
              {selChecklists.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีเช็คลิสต์ PM{dept !== 'all' ? `ของแผนก ${DEPT_LABEL[dept]}` : ''} สำหรับเครื่องนี้</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selChecklists.map((c, i) => {
                    const m = STATUS_META[c.status] ?? STATUS_META.ok
                    const dd = c.nextDue ? daysUntilDue(c.nextDue) : null
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, borderTop: i ? '1px dashed var(--border)' : 'none', paddingTop: i ? 6 : 0 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{c.eqName}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#4d9fff', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>{DEPT_ICON[c.dept]} {DEPT_LABEL[c.dept] ?? c.dept}</span>
                        <span style={{ color: m.color, fontWeight: 700 }}>{m.label}</span>
                        <span style={{ color: 'var(--muted)' }}>
                          {c.nextDue ? `ครบ ${c.nextDue.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}${dd != null ? (dd < 0 ? ` (เกิน ${Math.abs(dd)} วัน)` : ` (อีก ${dd} วัน)`) : ''}` : 'ไม่มีรอบตายตัว'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* line tree */}
        <div style={{ width: 240, flexShrink: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, alignSelf: 'flex-start', maxHeight: 560, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>ไลน์ผลิต ({lines.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {orderedLines.map(l => (
              <div key={l.id} onClick={() => setSelectedLine(l.name)} style={S.lineBtn(selectedLine === l.name, l._child)}>
                {l._child ? '└ ' : ''}{l.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
