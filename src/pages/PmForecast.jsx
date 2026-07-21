import { useState, useEffect, useContext, useMemo } from 'react'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { inSectionScope } from '../utils/sectionScope'
import { getLineFamilyNames } from '../utils/lineHierarchy'
import { computePlanForecast } from '../lib/pmPredictive'
import { loadCompanyCalendar, countWorkingDaysInMonth } from '../utils/companyCalendar'

// PM ล่วงหน้า (Planner) — เห็นวันที่จะต้อง PM ล่วงหน้า 1-2 สัปดาห์ + buffer ที่ต้องผลิตเผื่อ
//   sync ให้วางแผน/ผลิตเตรียมตัวก่อนเครื่องหยุดทำ PM (ดู CLAUDE.md "PM Predictive & Planner Sync")
const WORKING_DAYS_FALLBACK = 22 // fallback เมื่อปฏิทินบริษัทว่าง — ปกติอ่านวันทำงานจริงจาก company_calendar (2026-07-21)

function todayBangkok() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return p // YYYY-MM-DD
}
function fmtThai(d) { return d ? d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: '2-digit' }) : '—' }

export default function PmForecast() {
  const { role, lineId, sections: scopeSecs } = useContext(UserContext)
  const canManage = can('pm', 'setup', role)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [onlyWindow, setOnlyWindow] = useState(false)
  const todayStr = todayBangkok()

  const load = async () => {
    await loadCompanyCalendar() // วันทำงานจริงจากปฏิทินบริษัท — ต้องโหลดก่อนคำนวณอัตรา/วัน

    setLoading(true)
    try {
      const [{ data: lines }, { data: plans }] = await Promise.all([
        supabase.from('production_lines').select('id, name, parent_line_name, section'),
        supabaseDR.from('pm_plans').select('id, checklist_id, plan_type, usage_metric, usage_threshold, usage_source_line, interval_days, next_due_date, last_done_at, pm_duration_hours, lead_time_days, buffer_margin_pct, is_active').eq('is_active', true),
      ])
      const lineArr = lines || []
      const clIds = [...new Set((plans || []).map(p => p.checklist_id).filter(Boolean))]
      const { data: cls } = clIds.length ? await supabaseDR.from('checklists').select('id, equipment_id, name').in('id', clIds) : { data: [] }
      const clById = Object.fromEntries((cls || []).map(c => [c.id, c]))
      const eqIds = [...new Set((cls || []).map(c => c.equipment_id).filter(Boolean))]
      const { data: jigs } = eqIds.length ? await supabaseDR.from('jigs').select('id, name, line_name').in('id', eqIds) : { data: [] }
      const jigById = Object.fromEntries((jigs || []).map(j => [j.id, j]))

      // ยอดผลิตจริง (confirmed) ย้อนหลัง 120 วัน — ใช้หา shot สะสม + fallback rate + mat ของไลน์
      const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const since = new Date(todayStr + 'T00:00:00'); since.setDate(since.getDate() - 120)
      const sinceStr = ymd(since)  // ใช้วันที่ local ไม่ใช่ toISOString (UTC เพี้ยนถอยไป 1 วัน)
      // ⚠️ prod_orders ไม่มีคอลัมน์ line_name/work_date — อยู่บน production_sessions (join ผ่าน session_id)
      // เดิม select ตรงจาก prod_orders → PostgREST error 42703 แต่ถูกกลืน (ดึงแค่ data) → prodArr ว่างเสมอ
      // → shot สะสม/rate/buffer เป็น 0 ทั้งหมดเงียบ ๆ (แก้ 2026-07-21)
      const { data: prod, error: prodErr } = await supabaseDR.from('prod_orders')
        .select('qty_ok, qty, mat_no, production_sessions!inner(line_name, work_date)')
        .eq('status', 'confirmed')
        .gte('production_sessions.work_date', sinceStr)
      if (prodErr) console.warn('[pm-forecast] โหลดยอดผลิตไม่สำเร็จ:', prodErr.message)
      const prodArr = (prod || []).map(r => ({
        qty_ok: r.qty_ok, qty: r.qty, mat_no: r.mat_no,
        line_name: r.production_sessions?.line_name,
        work_date: r.production_sessions?.work_date,
      }))
      // forecast เดือนปัจจุบัน (อัตรา/วันจาก order ลูกค้า)
      const curMonth = todayStr.slice(0, 7)
      const { data: fc } = await supabaseDR.from('customer_forecasts').select('mat_no, qty, period_month').eq('period_month', curMonth)
      const fcByMat = {}
      ;(fc || []).forEach(f => { if (f.mat_no) fcByMat[f.mat_no] = (fcByMat[f.mat_no] || 0) + Number(f.qty || 0) })

      const out = []
      for (const plan of (plans || [])) {
        const cl = clById[plan.checklist_id]
        const jig = cl ? jigById[cl.equipment_id] : null
        const line = plan.usage_source_line || jig?.line_name || null
        if (!line) continue
        const fam = new Set(getLineFamilyNames(lineArr, line))
        const famRows = prodArr.filter(r => r.line_name && fam.has(r.line_name))
        // shot สะสมตั้งแต่ PM ครั้งก่อน — ใช้ > (exclusive) ให้ตรงกับ SQL pm_refresh_plan
        // (confirmed_at > last_inspection) กันนับ production ของ "วัน PM" ก่อนทำ PM ซ้ำเข้ามา
        // ⚠️ ถ้าเริ่มใช้แผน usage จริง: ให้ mirror pm_refresh_plan (qty field / line scope) เป็น source เดียว
        const lastDone = plan.last_done_at ? plan.last_done_at.slice(0, 10) : null
        const accumUsage = famRows.filter(r => !lastDone || r.work_date > lastDone).reduce((s, r) => s + Number(r.qty_ok ?? r.qty ?? 0), 0)
        // อัตรา/วัน: forecast ของ mat ที่ไลน์นี้ผลิต ÷ วันทำงาน · ไม่มี forecast → เฉลี่ยจริง 30 วัน
        const mats = [...new Set(famRows.map(r => r.mat_no).filter(Boolean))]
        const monthFc = mats.reduce((s, m) => s + (fcByMat[m] || 0), 0)
        let dailyRate = monthFc > 0 ? monthFc / countWorkingDaysInMonth(todayStr.slice(0, 7), WORKING_DAYS_FALLBACK) : 0
        let rateSource = 'forecast'
        if (dailyRate <= 0) {
          const d30 = new Date(todayStr + 'T00:00:00'); d30.setDate(d30.getDate() - 30)
          const d30s = ymd(d30)
          const act = famRows.filter(r => r.work_date >= d30s).reduce((s, r) => s + Number(r.qty_ok ?? r.qty ?? 0), 0)
          dailyRate = act / 30; rateSource = 'actual'
        }
        const f = computePlanForecast(plan, { accumUsage, dailyRate, todayStr })
        out.push({ plan, line, section: lineArr.find(l => l.name === line)?.section || null, eqName: jig?.name || cl?.name || '-', rateSource, ...f })
      }
      // scope: leader = family ไลน์ตัวเอง · role อื่นตาม sections
      let scoped = out
      if (role === 'leader' && lineId) {
        const self = lineArr.find(l => l.id === lineId)
        const fam = self ? new Set(getLineFamilyNames(lineArr, self.name)) : new Set()
        scoped = out.filter(r => fam.has(r.line))
      } else if (scopeSecs?.length) {
        scoped = out.filter(r => !r.section || inSectionScope(scopeSecs, r.section))
      }
      scoped.sort((a, b) => (a.daysTo ?? 9999) - (b.daysTo ?? 9999))
      setRows(scoped)
    } catch (err) { toast.error(err.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveCfg = async (planId, patch) => {
    const { error } = await supabaseDR.from('pm_plans').update(patch).eq('id', planId)
    if (error) return toast.error(error.message)
    setRows(prev => prev.map(r => r.plan.id === planId ? { ...r, plan: { ...r.plan, ...patch } } : r))
    toast.success('บันทึกแล้ว')
  }

  const shown = useMemo(() => onlyWindow ? rows.filter(r => r.inWindow) : rows, [rows, onlyWindow])
  const windowCount = rows.filter(r => r.inWindow).length
  const totalBuffer = shown.reduce((s, r) => s + (r.inWindow ? r.buffer : 0), 0)

  const inp = { width: 64, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 12, textAlign: 'center' }

  return (
    <div style={{ padding: 'clamp(12px,3vw,24px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 }}>🔧 PM ล่วงหน้า (Planner)</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>คาดวันที่จะต้อง PM ล่วงหน้า + buffer ที่ต้องผลิตเผื่อ ก่อนเครื่องหยุด · sync ให้วางแผน/ผลิตเตรียมตัว</p>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyWindow} onChange={e => setOnlyWindow(e.target.checked)} />เฉพาะที่เข้า window แล้ว ({windowCount})
        </label>
        {totalBuffer > 0 && <span style={{ fontSize: 13, color: 'var(--accent2)', fontWeight: 700 }}>Σ buffer ที่ต้องเตรียม ≈ {totalBuffer.toLocaleString()} ชิ้น</span>}
        <button onClick={load} style={{ marginLeft: 'auto', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>🔄 รีเฟรช</button>
      </div>

      {loading ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>กำลังคำนวณ...</div>
        : !shown.length ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>ยังไม่มีแผน PM ที่คำนวณได้ (ต้องตั้ง usage_threshold หรือรอบเวลา + มียอดผลิต/forecast)</div>
        : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860 }}>
              <thead>
                <tr style={{ background: 'var(--bg3)', color: 'var(--muted)', textAlign: 'left' }}>
                  {['ไลน์ / อุปกรณ์', 'ชนิด', 'ความคืบหน้า', 'คาดวัน PM', 'อีก', 'ระยะ PM (ชม.)', 'lead (วัน)', 'เผื่อ %', 'buffer (ชิ้น)'].map(h => <th key={h} style={{ padding: '9px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const p = r.plan
                  const rowBg = r.overdue ? 'rgba(239,68,68,0.10)' : r.inWindow ? 'rgba(245,154,63,0.10)' : 'transparent'
                  return (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border)', background: rowBg }}>
                      <td style={{ padding: '8px 10px' }}><b style={{ color: 'var(--text)' }}>{r.line}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.eqName}</div></td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r.isUsage ? `📊 ${p.usage_metric || 'shot'}` : '🗓 เวลา'}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        {r.isUsage
                          ? <span style={{ fontFamily: 'monospace' }}>{Number(r.accumUsage).toLocaleString()}/{Number(p.usage_threshold).toLocaleString()}<div style={{ fontSize: 10.5, color: 'var(--muted)' }}>~{Math.round(r.dailyRate).toLocaleString()}/วัน ({r.rateSource === 'forecast' ? 'forecast' : 'จริง'})</div></span>
                          : <span style={{ color: 'var(--muted)' }}>รอบ {p.interval_days} วัน</span>}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: r.overdue ? '#ef4444' : r.inWindow ? '#f59a3f' : 'var(--text)', whiteSpace: 'nowrap' }}>{fmtThai(r.projected)}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: r.overdue ? '#ef4444' : r.inWindow ? '#f59a3f' : 'var(--muted)' }}>{r.daysTo == null ? '—' : r.overdue ? `เลย ${Math.abs(r.daysTo)} วัน` : `${r.daysTo} วัน`}</td>
                      <td style={{ padding: '8px 10px' }}>{canManage ? <input type="number" defaultValue={p.pm_duration_hours ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (p.pm_duration_hours ?? null)) saveCfg(p.id, { pm_duration_hours: v }) }} style={inp} placeholder="—" /> : (p.pm_duration_hours ?? '—')}</td>
                      <td style={{ padding: '8px 10px' }}>{canManage ? <input type="number" defaultValue={p.lead_time_days ?? 10} onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (p.lead_time_days ?? 10)) saveCfg(p.id, { lead_time_days: v }) }} style={inp} /> : (p.lead_time_days ?? 10)}</td>
                      <td style={{ padding: '8px 10px' }}>{canManage ? <input type="number" defaultValue={p.buffer_margin_pct ?? 15} onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (p.buffer_margin_pct ?? 15)) saveCfg(p.id, { buffer_margin_pct: v }) }} style={inp} /> : (p.buffer_margin_pct ?? 15)}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 800, color: r.inWindow && r.buffer ? 'var(--accent2)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{r.buffer ? r.buffer.toLocaleString() : (p.pm_duration_hours ? '0' : 'ตั้งระยะ PM')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
        * ตาม shot: คาดวัน PM = วันนี้ + (เกณฑ์ − shot สะสม) ÷ อัตราผลิต/วัน (จาก forecast ลูกค้าเดือนนี้ ÷ วันทำงานจริงจากปฏิทินบริษัท · ไม่มี forecast ใช้เฉลี่ยจริง 30 วัน) ·
        buffer = อัตรา/วัน × (ระยะ PM ÷ 16 ชม.) × (1 + เผื่อ%) · แถวส้ม = เข้า window (ใกล้ถึงภายใน lead time) · แถวแดง = เลยกำหนด
      </p>
    </div>
  )
}
