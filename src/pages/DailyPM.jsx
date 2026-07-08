import { useState, useEffect, useContext, useCallback, useMemo } from 'react'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { toast } from '../components/Toast'
import { computeDailyPmStatus, DAILY_PM_STATUS_META, DAILY_PM_WINDOW_MIN } from '../lib/pmDailyStatus'
import { fmtTime } from '../utils/dateFormat'

/* ── date / shift (local, Asia/Bangkok = deployment local) ── */
const toLocalDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Current shift + the timestamp at which that shift began, so we can scope
// "checked this shift". Day 08:00–19:59, night otherwise; before 08:00 belongs
// to the previous day's night shift.
function getShiftInfo(now = new Date()) {
  const h = now.getHours()
  const totalMin = h * 60 + now.getMinutes()
  const isDay = totalMin >= 8 * 60 && totalMin < 20 * 60
  const workDate = new Date(now)
  if (h < 8) workDate.setDate(workDate.getDate() - 1)
  const shiftStart = new Date(workDate)
  shiftStart.setHours(isDay ? 8 : 20, 0, 0, 0)
  return {
    shift: isDay ? 'day' : 'night',
    workDateStr: toLocalDateStr(workDate),
    label: isDay ? '☀️ กะเช้า' : '🌙 กะดึก',
    shiftStart,
  }
}

const canManageRoles = ['admin', 'manager', 'supervisor']

export default function DailyPM() {
  const { role } = useContext(UserContext)
  const canManage = canManageRoles.includes(role)

  const [tab, setTab] = useState('status')
  const [userId, setUserId] = useState(null)
  const [jigs, setJigs] = useState([])
  const [targets, setTargets] = useState([])
  const [resultByJig, setResultByJig] = useState({})   // jig_id -> { status }
  const [firstOrderByLine, setFirstOrderByLine] = useState({})  // line_name -> ISO
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())

  const shiftInfo = useMemo(() => getShiftInfo(now), [now])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id ?? null))
  }, [])

  // keep the "window elapsed" logic honest without a manual refresh
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const si = getShiftInfo()
    const startISO = si.shiftStart.toISOString()

    const [{ data: jigRows }, { data: targetRows }, { data: prodChecklists }] = await Promise.all([
      supabaseDR.from('jigs').select('id, name, machine_no, line_name, jig_no').eq('module', 'mtn').order('line_name').order('name'),
      supabaseDR.from('pm_daily_line_targets').select('*').eq('is_active', true),
      supabaseDR.from('checklists').select('id').eq('module', 'mtn').eq('department', 'production'),
    ])
    setJigs(jigRows ?? [])
    setTargets(targetRows ?? [])

    // "checked this shift" = a production-department inspection since the shift start
    const prodClIds = new Set((prodChecklists ?? []).map(c => c.id))
    const resMap = {}
    if (prodClIds.size > 0) {
      const { data: insp } = await supabaseDR
        .from('inspections')
        .select('jig_id, status, checklist_id, inspected_at')
        .gte('inspected_at', startISO)
        .order('inspected_at', { ascending: false })
      for (const i of insp ?? []) {
        if (!prodClIds.has(i.checklist_id)) continue
        if (!resMap[i.jig_id]) resMap[i.jig_id] = { status: i.status }  // latest wins (ordered desc)
      }
    }
    setResultByJig(resMap)

    // first confirmed order per line this shift → starts the 1h clock
    const { data: sessions } = await supabaseDR
      .from('production_sessions')
      .select('id, line_name')
      .eq('work_date', si.workDateStr)
      .eq('shift', si.shift)
    const sessionLine = {}
    ;(sessions ?? []).forEach(s => { sessionLine[s.id] = s.line_name })
    const firstOrder = {}
    if (sessions && sessions.length > 0) {
      const { data: orders } = await supabaseDR
        .from('prod_orders')
        .select('session_id, confirmed_at')
        .in('session_id', sessions.map(s => s.id))
        .not('confirmed_at', 'is', null)
        .order('confirmed_at', { ascending: true })
      for (const o of orders ?? []) {
        const line = sessionLine[o.session_id]
        if (line && !firstOrder[line]) firstOrder[line] = o.confirmed_at
      }
    }
    setFirstOrderByLine(firstOrder)
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount (load is useCallback([]))
  useEffect(() => { load() }, [load])

  const jigsByLine = useMemo(() => {
    const m = {}
    jigs.forEach(j => { (m[j.line_name || '—'] ||= []).push(j) })
    return m
  }, [jigs])

  // build a dashboard row per line that has registered targets
  const dashboard = useMemo(() => {
    const jigById = Object.fromEntries(jigs.map(j => [j.id, j]))
    const byLine = {}
    for (const t of targets) {
      if (t.shift && t.shift !== shiftInfo.shift) continue   // shift-specific target for another shift
      const j = jigById[t.jig_id]
      if (!j) continue
      ;(byLine[t.line_name] ||= []).push({ jig_id: j.id, name: j.name, machine_no: j.machine_no })
    }
    return Object.entries(byLine)
      .map(([line_name, tg]) => ({
        line_name,
        ...computeDailyPmStatus({
          targets: tg,
          results: resultByJig,
          firstOrderAt: firstOrderByLine[line_name] ?? null,
          now,
        }),
      }))
      .sort((a, b) => {
        const ord = { red: 0, orange: 1, pending: 2, idle: 3, green: 4, none: 5 }
        return (ord[a.status] ?? 9) - (ord[b.status] ?? 9)
      })
  }, [targets, jigs, resultByJig, firstOrderByLine, shiftInfo.shift, now])

  const registeredKey = useMemo(() => {
    const s = new Set()
    targets.forEach(t => s.add(`${t.line_name}::${t.jig_id}`))
    return s
  }, [targets])

  const toggleTarget = async (line_name, jig) => {
    if (!canManage) return
    const key = `${line_name}::${jig.id}`
    const isOn = registeredKey.has(key)
    if (isOn) {
      const row = targets.find(t => t.line_name === line_name && t.jig_id === jig.id && !t.shift)
      if (row) {
        const { error } = await supabaseDR.from('pm_daily_line_targets').delete().eq('id', row.id)
        if (error) return toast.error(error.message)
        setTargets(prev => prev.filter(t => t.id !== row.id))
      }
    } else {
      const { data, error } = await supabaseDR.from('pm_daily_line_targets')
        .insert({ line_name, jig_id: jig.id, shift: null, created_by: userId })
        .select().single()
      if (error) return toast.error(error.message)
      setTargets(prev => [...prev, data])
    }
  }

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(96vw, 1400px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            ✅ Daily PM ฝ่ายผลิต
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            ตรวจความพร้อมเครื่องจักร/อุปกรณ์/POKA-YOKE ต้นกะ · {shiftInfo.label} · {shiftInfo.workDateStr}
            {' · '}เตือนเมื่อเกิน {DAILY_PM_WINDOW_MIN} นาทีหลังยืนยันออร์เดอร์แรก
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)' }}>
          {[['status', '📊 สถานะวันนี้'], ['registry', '⚙️ ลงทะเบียนเครื่องตรวจ']].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: tab === k ? 'var(--card)' : 'transparent', color: tab === k ? 'var(--text)' : 'var(--muted)',
            }}>{lbl}</button>
          ))}
        </div>
      </div>

      {tab === 'status' && (
        dashboard.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', border: '1px dashed var(--border2)', borderRadius: 12 }}>
            ยังไม่มีไลน์ที่ลงทะเบียนเครื่องตรวจ — ไปที่แท็บ “ลงทะเบียนเครื่องตรวจ” ก่อน
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {dashboard.map(row => {
              const meta = DAILY_PM_STATUS_META[row.status] ?? DAILY_PM_STATUS_META.none
              return (
                <div key={row.line_name} style={{ background: 'var(--card)', border: `1px solid ${meta.color}40`, borderLeft: `4px solid ${meta.color}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{row.line_name}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}40` }}>
                      {meta.label}
                    </span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text2)' }}>
                    ตรวจแล้ว <b style={{ color: meta.color }}>{row.checked}/{row.total}</b> เครื่อง
                    {row.firstOrderAt && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>· ออร์เดอร์แรก {fmtTime(row.firstOrderAt)}</span>}
                  </div>
                  {row.ng.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: '#e05c4a', fontWeight: 700 }}>⚠ ผิดปกติ</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                        {row.ng.map(n => <span key={n.jig_id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(224,92,74,0.12)', color: '#e05c4a' }}>{n.machine_no ? `${n.machine_no} · ` : ''}{n.name}</span>)}
                      </div>
                    </div>
                  )}
                  {row.missing.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>ยังไม่ตรวจ ({row.missing.length})</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                        {row.missing.map(m => <span key={m.jig_id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--bg3)', color: 'var(--muted)' }}>{m.machine_no ? `${m.machine_no} · ` : ''}{m.name}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'registry' && (
        <div>
          {!canManage && <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--accent2)' }}>* ดูได้อย่างเดียว — เฉพาะ admin/manager/supervisor แก้ไขได้</div>}
          {Object.keys(jigsByLine).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>ยังไม่มีอุปกรณ์ในระบบ</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Object.entries(jigsByLine).map(([line, lineJigs]) => {
                const regCount = lineJigs.filter(j => registeredKey.has(`${line}::${j.id}`)).length
                return (
                  <div key={line} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>
                      {line} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>· ลงทะเบียน {regCount}/{lineJigs.length}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                      {lineJigs.map(j => {
                        const on = registeredKey.has(`${line}::${j.id}`)
                        return (
                          <label key={j.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: canManage ? 'pointer' : 'default',
                            border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-dim)' : 'var(--bg3)',
                          }}>
                            <input type="checkbox" checked={on} disabled={!canManage} onChange={() => toggleTarget(line, j)} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
                              {j.machine_no && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{j.machine_no}</div>}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
