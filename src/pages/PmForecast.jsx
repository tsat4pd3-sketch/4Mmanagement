import { useState, useEffect, useContext, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { inSectionScope } from '../utils/sectionScope'
import { getLineFamilyNames } from '../utils/lineHierarchy'
import { computePlanForecast } from '../lib/pmPredictive'
import { loadCompanyCalendar, countWorkingDaysInMonth } from '../utils/companyCalendar'
import { sumUsage, dailyRate } from '../utils/pmUsage'
import PageHeader from '../components/PageHeader'
import Page from '../components/Page'
import FilterBar from '../components/FilterBar'
import useTabParam from '../utils/useTabParam'
import PmUsageBoard from '../components/PmUsageBoard'

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
  const canCoord = can('pm_coord', 'manage', role)
  const navigate = useNavigate()
  // สร้าง "แผนประสานงาน PM" (แจ้ง Production) จากแถวนี้ — ส่ง prefill ผ่าน sessionStorage แล้วไปแท็บประสานงาน
  const toCoordination = (r) => {
    const d = r.projected
    const due = d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) : null
    sessionStorage.setItem('pmcoord_prefill', JSON.stringify({
      pm_plan_id: r.plan.id, machine_name: r.eqName, line_name: r.line, next_due_date: due,
      checklist_name: r.eqName, title: r.eqName ? `PM ${r.eqName}` : '',
    }))
    navigate('/pm?tab=coord')
  }
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [onlyWindow, setOnlyWindow] = useState(false)
  const [daily, setDaily] = useState([])      // ยอดผลิตรายไลน์รายวัน (RPC pm_usage_daily)
  const [lineObjs, setLineObjs] = useState([])
  /* ⚠️ param `fc` ไม่ใช่ `tab` — หน้านี้ถูก embed ใน /pm (PmHub ใช้ `?tab=forecast` อยู่แล้ว)
     เดิมใช้ `?tab=` ⇒ กดแท็บ "ยอดผลิตสะสม" แล้ว URL กลายเป็น ?tab=usage ที่ PmHub ไม่รู้จัก
     ⇒ เด้งกลับแท็บแรกของ /pm (ตรวจอุปกรณ์) · UI-CONVENTIONS §6.8 ข้อ 2.4 (แก้ 2026-09-23) */
  const [tab, setTab] = useTabParam(['due', 'usage'], 'due', 'fc')
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

      // ยอดผลิตจริง (confirmed) ย้อนหลัง 120 วัน — ใช้หายอดสะสมตั้งแต่ PM ล่าสุด + อัตรา/วัน
      /* 🔴 2026-09-15 — เดิมดึง **ใบผลิตดิบ** 120 วันมาคำนวณเองในเบราว์เซอร์:
             from('prod_orders').select(...).gte(work_date, -120d)
         ช่วง 120 วันมีใบ confirmed **13,073 ใบ** ⇒ ชนเพดาน 1000 แถว/คิวรี **เงียบๆ ไม่มี error**
         ได้ข้อมูลจริงแค่ ~7.6% ⇒ ยอดสะสม/อัตราต่อวัน/buffer ทั้งหน้าต่ำกว่าความจริงหลายเท่า
         (กฎเหล็กข้อ 5 ใน CLAUDE.md) · แก้ด้วยการรวมยอดฝั่ง server: (ไลน์ × วัน) = 575 แถว
         ⚠️ ห้ามกลับไปดึงใบดิบอีก — เพิ่ม limit ก็ยังชนอยู่ดีเมื่อข้อมูลโต */
      const { data: prodDaily, error: prodErr } = await supabaseDR.rpc('pm_usage_daily', { p_days: 120 })
      if (prodErr) console.warn('[pm-forecast] โหลดยอดผลิตไม่สำเร็จ:', prodErr.message)
      const prodArr = prodDaily || []
      setDaily(prodArr)
      setLineObjs(lineArr)
      /* mat ที่แต่ละไลน์ผลิต — อ่านจาก **ทะเบียนสินค้า** (dr_products) ไม่ใช่จากใบผลิตดิบ
         (RPC คืนยอดรวมรายไลน์/วัน ไม่มี mat_no · และการดึงใบดิบคือต้นเหตุเพดาน 1000 แถว) */
      const { data: prods } = await supabaseDR.from('dr_products').select('mat_no, line_name')
      const matsByLine = {}
      for (const pr of prods || []) {
        if (!pr.line_name || !pr.mat_no) continue
        ;(matsByLine[pr.line_name] ||= new Set()).add(pr.mat_no)
      }
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
        const famNames = getLineFamilyNames(lineArr, line)
        const fam = famNames?.length ? famNames : [line]
        /* ยอดสะสมตั้งแต่ PM ครั้งก่อน — สูตรเดียวของทั้งระบบอยู่ที่ `src/utils/pmUsage.js` (pure · มีเทส)
           ⚠️ ห้ามคิดเลขซ้ำที่นี่ · เดิมหน้านี้ใช้ `qty_ok ?? qty` + เทียบ work_date ส่วน SQL
              pm_refresh_plan ใช้ `qty` + confirmed_at ⇒ เลขบนจอกับวันครบกำหนดที่ DB เขียนไม่ตรงกัน */
        const lastDone = plan.last_done_at ? plan.last_done_at.slice(0, 10) : null
        const accumUsage = sumUsage(prodArr, { lines: fam, since: lastDone, until: todayStr }).qty
        // อัตรา/วัน: forecast ของ mat ที่ไลน์นี้ผลิต ÷ วันทำงาน · ไม่มี forecast → อัตราจริงจากวันที่เดินงาน
        const mats = [...new Set(fam.flatMap(n => [...(matsByLine[n] || [])]))]
        const monthFc = mats.reduce((s, m) => s + (fcByMat[m] || 0), 0)
        let dailyRateVal = monthFc > 0 ? monthFc / countWorkingDaysInMonth(todayStr.slice(0, 7), WORKING_DAYS_FALLBACK) : 0
        let rateSource = 'forecast'
        if (dailyRateVal <= 0) {
          dailyRateVal = dailyRate(prodArr, { lines: fam, days: 30, todayStr }).rate
          rateSource = 'actual'
        }
        const f = computePlanForecast(plan, { accumUsage, dailyRate: dailyRateVal, todayStr })
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
    <Page style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* หัวเพจมาตรฐาน + แท็บผูก URL (UI-CONVENTIONS §6.8 — ห้ามวาดหัวเรื่อง/แถบแท็บเอง) */}
      <PageHeader
        title="PM ล่วงหน้า (Planner)" icon="🔧"
        sub={tab === 'due'
          ? 'คาดวันที่จะต้อง PM ล่วงหน้า + buffer ที่ต้องผลิตเผื่อ ก่อนเครื่องหยุด · sync ให้วางแผน/ผลิตเตรียมตัว'
          : 'ยอดผลิตสะสมของอุปกรณ์แต่ละตัว — ฐานของ PM แบบนับยอดผลิต (condition-based) แทนรอบเวลา'}
        tabs={[{ key: 'due', label: '🗓 PM ที่จะครบกำหนด' }, { key: 'usage', label: '📊 ยอดผลิตสะสมรายอุปกรณ์' }]}
        tab={tab} onTab={setTab}
        actions={<button onClick={load} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>🔄 รีเฟรช</button>}
      />

      {tab === 'usage' ? (
        <PmUsageBoard daily={daily} lines={lineObjs} plans={rows} todayStr={todayStr} loading={loading} />
      ) : (<>
      <FilterBar>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyWindow} onChange={e => setOnlyWindow(e.target.checked)} />เฉพาะที่เข้า window แล้ว ({windowCount})
        </label>
        <span className="spacer" />
        {totalBuffer > 0 && <span className="filter-count" style={{ color: 'var(--accent2)', fontWeight: 700 }}>Σ buffer ที่ต้องเตรียม ≈ {totalBuffer.toLocaleString()} ชิ้น</span>}
      </FilterBar>

      {loading ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>กำลังคำนวณ...</div>
        : !shown.length ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>ยังไม่มีแผน PM ที่คำนวณได้ (ต้องตั้ง usage_threshold หรือรอบเวลา + มียอดผลิต/forecast)</div>
        : (
          <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860 }}>
              <thead>
                <tr style={{ background: 'var(--bg3)', color: 'var(--muted)', textAlign: 'left' }}>
                  {['ไลน์ / อุปกรณ์', 'ชนิด', 'ความคืบหน้า', 'คาดวัน PM', 'อีก', 'ระยะ PM (ชม.)', 'lead (วัน)', 'เผื่อ %', 'buffer (ชิ้น)', ...(canCoord ? ['ประสานงาน'] : [])].map(h => <th key={h} style={{ padding: '9px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}
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
                          ? <span style={{ fontFamily: 'monospace' }}>{Number(r.accumUsage).toLocaleString()}/{Number(p.usage_threshold).toLocaleString()}<div style={{ fontSize: 11, color: 'var(--muted)' }}>~{Math.round(r.dailyRate).toLocaleString()}/วัน ({r.rateSource === 'forecast' ? 'forecast' : 'จริง'})</div></span>
                          : <span style={{ color: 'var(--muted)' }}>รอบ {p.interval_days} วัน</span>}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: r.overdue ? '#ef4444' : r.inWindow ? '#f59a3f' : 'var(--text)', whiteSpace: 'nowrap' }}>{fmtThai(r.projected)}</td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: r.overdue ? '#ef4444' : r.inWindow ? '#f59a3f' : 'var(--muted)' }}>{r.daysTo == null ? '—' : r.overdue ? `เลย ${Math.abs(r.daysTo)} วัน` : `${r.daysTo} วัน`}</td>
                      <td style={{ padding: '8px 10px' }}>{canManage ? <input type="number" defaultValue={p.pm_duration_hours ?? ''} onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (p.pm_duration_hours ?? null)) saveCfg(p.id, { pm_duration_hours: v }) }} style={inp} placeholder="—" /> : (p.pm_duration_hours ?? '—')}</td>
                      <td style={{ padding: '8px 10px' }}>{canManage ? <input type="number" defaultValue={p.lead_time_days ?? 10} onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (p.lead_time_days ?? 10)) saveCfg(p.id, { lead_time_days: v }) }} style={inp} /> : (p.lead_time_days ?? 10)}</td>
                      <td style={{ padding: '8px 10px' }}>{canManage ? <input type="number" defaultValue={p.buffer_margin_pct ?? 15} onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (p.buffer_margin_pct ?? 15)) saveCfg(p.id, { buffer_margin_pct: v }) }} style={inp} /> : (p.buffer_margin_pct ?? 15)}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 800, color: r.inWindow && r.buffer ? 'var(--accent2)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{r.buffer ? r.buffer.toLocaleString() : (p.pm_duration_hours ? '0' : 'ตั้งระยะ PM')}</td>
                      {canCoord && <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}><button onClick={() => toCoordination(r)} title="สร้างแผนประสานงาน PM (แจ้ง Production)" style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>🗓️ แผนประสานงาน</button></td>}
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
      </>)}
    </Page>
  )
}
