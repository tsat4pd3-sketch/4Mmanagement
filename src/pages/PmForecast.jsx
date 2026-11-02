import { useState, useEffect, useContext, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, supabaseDR } from '../supabaseClient'
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { inSectionScope } from '../utils/sectionScope'
import { getLineFamilyNames } from '../utils/lineHierarchy'
import { computePlanForecast } from '../lib/pmPredictive'
import { loadCompanyCalendar, countWorkingDaysInMonth } from '../utils/companyCalendar'
import { sumUsage, dailyRate } from '../utils/pmUsage'
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds'   // 🔴 เพดาน 1000 แถว + URL ยาว (กฎเหล็ก DB ข้อ 5)
import PageHeader from '../components/PageHeader'
import Page from '../components/Page'
import FilterBar from '../components/FilterBar'
import LineScopeSelect from '../components/LineScopeSelect'
import SearchInput from '../components/SearchInput'
import { lineKnownSet } from '../utils/pmEquipList'
import { filterPlanRows } from '../utils/pmPlanFilter'
import useTabParam from '../utils/useTabParam'
import PmUsageBoard from '../components/PmUsageBoard'
import { urlParam, urlPick } from '../utils/urlInit'

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
  const [onlyWindow, setOnlyWindow] = useState(() => urlPick('fcst', ['overdue', 'window', 'later'], ''))   // ตัวกรองสถานะ: '' | overdue | window | later · ?fcst= (จอวนหน้า)
  const [daily, setDaily] = useState([])      // ยอดผลิตรายไลน์รายวัน (RPC pm_usage_daily)
  const [lineObjs, setLineObjs] = useState([])
  /* ยอดผลิตโหลดไม่ได้ = ยอดสะสม/อัตรา/buffer ทั้งหน้าเป็น 0 ⇒ ต้องเขียนบนจอ ห้ามแค่ console.warn (QC 05/10) */
  const [prodErr, setProdErr] = useState('')
  /* 🔴 โหลดแผน/ทะเบียนไม่ได้ ≠ "ยังไม่มีแผน PM" (19/10 audit PM) — เดิมไม่อ่าน error เลย ⇒ จอว่างแบบไม่ฟ้อง */
  const [loadErr, setLoadErr] = useState('')
  const [partErr, setPartErr] = useState('')   // ส่วนเสริม (forecast/ทะเบียนสินค้า) ไม่ครบ — ตัวเลขอัตรายังคิดได้แต่ถอยไปใช้ยอดจริง
  const [noLineN, setNoLineN] = useState(0)    // แผนที่หาไลน์ไม่ได้ (คิดยอดผลิตไม่ได้) — ต้องเขียนบนจอ ห้ามหายเงียบ
  const reqRef = useRef(0)
  /* ⚠️ param `fc` ไม่ใช่ `tab` — หน้านี้ถูก embed ใน /pm (PmHub ใช้ `?tab=forecast` อยู่แล้ว)
     เดิมใช้ `?tab=` ⇒ กดแท็บ "ยอดผลิตสะสม" แล้ว URL กลายเป็น ?tab=usage ที่ PmHub ไม่รู้จัก
     ⇒ เด้งกลับแท็บแรกของ /pm (ตรวจอุปกรณ์) · UI-CONVENTIONS §6.8 ข้อ 2.4 (แก้ 2026-09-23) */
  const [tab, setTab] = useTabParam(['due', 'usage'], 'due', 'fc')
  const todayStr = todayBangkok()

  const load = async () => {
    await loadCompanyCalendar() // วันทำงานจริงจากปฏิทินบริษัท — ต้องโหลดก่อนคำนวณอัตรา/วัน

    const req = ++reqRef.current
    const live = () => req === reqRef.current   // กดรีเฟรชซ้อน = คำตอบรอบเก่าห้ามทับ
    setLoading(true)
    try {
      const [linesRes, planRes] = await Promise.all([
        loadLinesRes(),
        fetchAllPages(() => supabaseDR.from('pm_plans').select('id, checklist_id, plan_type, usage_metric, usage_threshold, usage_source_line, interval_days, next_due_date, last_done_at, pm_duration_hours, lead_time_days, buffer_margin_pct, is_active').eq('is_active', true)),
      ])
      /* 🔴 30/10 — อ่านทะเบียนไลน์ไม่สำเร็จ ต้องแยกออกจาก "ไม่มีไลน์" (เดิมแกะแค่ `{ data }` = เงียบ) */
      const lineArr = linesRes?.error ? [] : (linesRes.data || [])
      const plans = planRes.rows
      const clIds = [...new Set(plans.map(p => p.checklist_id).filter(Boolean))]
      const clRes = await fetchByIds(clIds, ids => supabaseDR.from('checklists').select('id, equipment_id, name').in('id', ids))
      const cls = clRes.rows
      const clById = Object.fromEntries(cls.map(c => [c.id, c]))
      const eqIds = [...new Set(cls.map(c => c.equipment_id).filter(Boolean))]
      const jigRes = await fetchByIds(eqIds, ids => supabaseDR.from('jigs').select('id, name, line_name').in('id', ids))
      const jigs = jigRes.rows
      if (!live()) return
      const mainErr = [['แผน PM', planRes], ['รายการตรวจ', clRes], ['ทะเบียนเครื่อง', jigRes]]
        .map(([lb, r]) => r.error ? `${lb}: ${r.error}` : r.truncated ? `${lb}: อ่านได้ไม่ครบ` : null).filter(Boolean)
      setLoadErr(mainErr.join(' · '))
      if (mainErr.length) { setRows([]); setNoLineN(0); return }
      const jigById = Object.fromEntries((jigs || []).map(j => [j.id, j]))

      // ยอดผลิตจริง (confirmed) ย้อนหลัง 120 วัน — ใช้หายอดสะสมตั้งแต่ PM ล่าสุด + อัตรา/วัน
      /* 🔴 2026-09-15 — เดิมดึง **ใบผลิตดิบ** 120 วันมาคำนวณเองในเบราว์เซอร์:
             from('prod_orders').select(...).gte(work_date, -120d)
         ช่วง 120 วันมีใบ confirmed **13,073 ใบ** ⇒ ชนเพดาน 1000 แถว/คิวรี **เงียบๆ ไม่มี error**
         ได้ข้อมูลจริงแค่ ~7.6% ⇒ ยอดสะสม/อัตราต่อวัน/buffer ทั้งหน้าต่ำกว่าความจริงหลายเท่า
         (กฎเหล็กข้อ 5 ใน CLAUDE.md) · แก้ด้วยการรวมยอดฝั่ง server: (ไลน์ × วัน) = 575 แถว
         ⚠️ ห้ามกลับไปดึงใบดิบอีก — เพิ่ม limit ก็ยังชนอยู่ดีเมื่อข้อมูลโต */
      const { data: prodDaily, error: eProd } = await supabaseDR.rpc('pm_usage_daily', { p_days: 120 })
      setProdErr(eProd ? eProd.message : '')
      const prodArr = prodDaily || []
      setDaily(prodArr)
      setLineObjs(lineArr)
      /* mat ที่แต่ละไลน์ผลิต — อ่านจาก **ทะเบียนสินค้า** (dr_products) ไม่ใช่จากใบผลิตดิบ
         (RPC คืนยอดรวมรายไลน์/วัน ไม่มี mat_no · และการดึงใบดิบคือต้นเหตุเพดาน 1000 แถว) */
      const prodRes = await fetchAllPages(() => supabaseDR.from('dr_products').select('id, mat_no, line_name'))
      const matsByLine = {}
      for (const pr of prodRes.rows) {
        if (!pr.line_name || !pr.mat_no) continue
        ;(matsByLine[pr.line_name] ||= new Set()).add(pr.mat_no)
      }
      // forecast เดือนปัจจุบัน (อัตรา/วันจาก order ลูกค้า)
      const curMonth = todayStr.slice(0, 7)
      const fcRes = await fetchAllPages(() => supabaseDR.from('customer_forecasts').select('id, mat_no, qty, period_month').eq('period_month', curMonth))
      if (!live()) return
      // forecast/ทะเบียนสินค้าอ่านไม่ได้ = อัตรา/วันถอยไปใช้ยอดจริง 30 วันทุกแถว — ต้องบอก ไม่งั้นคนเชื่อว่าเป็นอัตรา forecast
      setPartErr([['ทะเบียนสินค้า', prodRes], ['forecast เดือนนี้', fcRes]]
        .map(([lb, r]) => r.error ? `${lb}: ${r.error}` : r.truncated ? `${lb}: อ่านได้ไม่ครบ` : null).filter(Boolean).join(' · '))
      const fcByMat = {}
      ;(fcRes.rows).forEach(f => { if (f.mat_no) fcByMat[f.mat_no] = (fcByMat[f.mat_no] || 0) + Number(f.qty || 0) })

      const out = []
      let noLine = 0
      for (const plan of plans) {
        const cl = clById[plan.checklist_id]
        const jig = cl ? jigById[cl.equipment_id] : null
        const line = plan.usage_source_line || jig?.line_name || null
        if (!line) { noLine++; continue }
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
      setNoLineN(noLine)
    } catch (err) { if (live()) { toast.error(err.message); setLoadErr(err.message) } } finally { if (live()) setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveCfg = async (planId, patch) => {
    const { error } = await supabaseDR.from('pm_plans').update(patch).eq('id', planId)
    if (error) return toast.error(error.message)
    setRows(prev => prev.map(r => r.plan.id === planId ? { ...r, plan: { ...r.plan, ...patch } } : r))
    toast.success('บันทึกแล้ว')
  }

  /* 🗂️ ตัวกรอง (19/10 audit หน้า PM) — ขอบเขตไลน์ (รวมไลน์ลูก) · สถานะ · ค้นหา · กติกา `utils/pmPlanFilter.js`
     แทน checkbox "เฉพาะที่เข้า window" เดิม (เป็นตัวเลือกหนึ่งของสถานะแล้ว) */
  /* ?fcsec= (ชื่อส่วนงาน) / ?fcline= (ชื่อไลน์) จากจอวนหน้า — ตั้ง section/line ตอนเปิด แล้วกางชุดไลน์ (`names`)
     ครั้งเดียวเมื่อทะเบียนไลน์มาถึง (ต้องรู้ไลน์ลูกก่อนถึงกรองได้) · ไม่มีพารามิเตอร์ = ค่าเดิมเป๊ะ */
  const [fScope, setFScope] = useState(() => ({ section: urlParam('fcsec') || '', line: urlParam('fcline') || '', names: null }))
  const seedScopePending = useRef(!!(urlParam('fcsec') || urlParam('fcline')))
  const [fQ, setFQ] = useState('')
  const scopeLines = useMemo(() => {   // ชื่อไลน์ซ้ำในทะเบียน = key ซ้ำในตัวเลือก ⇒ ยุบด้วยชื่อ
    const seen = new Set()
    return (lineObjs || []).filter(l => l?.name && !seen.has(l.name) && seen.add(l.name))
  }, [lineObjs])
  const known = useMemo(() => lineKnownSet(scopeLines), [scopeLines])
  useEffect(() => {
    if (!seedScopePending.current || !scopeLines.length) return
    seedScopePending.current = false
    setFScope(f => {
      if (f.names) return f   // คนกดเปลี่ยนเองไปแล้ว
      const names = f.line ? getLineFamilyNames(scopeLines, f.line)
        : f.section ? scopeLines.filter(l => l.section === f.section).map(l => l.name) : []
      return { ...f, names: names.length ? names : [f.line || f.section] }
    })
  }, [scopeLines])
  const STATUS_KEEP = { overdue: r => r.overdue, window: r => r.inWindow, later: r => !r.overdue && !r.inWindow }
  const { rows: shown, droppedNoLine } = useMemo(() => filterPlanRows(rows, {
    q: fQ, scopeNames: fScope.names, known, keep: STATUS_KEEP[onlyWindow] || null,
    getLine: r => r.line, getText: r => [r.line, r.eqName],
  }), [rows, fQ, fScope, known, onlyWindow]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = !!(fQ.trim() || fScope.names?.length || onlyWindow)
  const clearFilters = () => { setFQ(''); setFScope({ section: '', line: '', names: null }); setOnlyWindow('') }
  const windowCount = rows.filter(r => r.inWindow).length
  const overdueCount = rows.filter(r => r.overdue).length
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

      {prodErr && (
        <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ef4444', color: '#ef4444', fontSize: 12.5, fontWeight: 700 }}>
          ⚠️ โหลดยอดผลิตย้อนหลังไม่สำเร็จ ({prodErr}) — ยอดสะสม / อัตราต่อวัน / buffer ด้านล่างไม่ใช่ค่าจริง (ต่ำกว่าจริง) กด 🔄 รีเฟรช
        </div>
      )}
      {loadErr && (
        <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ef4444', color: '#ef4444', fontSize: 12.5, fontWeight: 700 }}>
          ⚠️ โหลดแผน PM ไม่สำเร็จ ({loadErr}) — <u>ไม่ได้แปลว่าไม่มีแผน</u> ตารางว่างเพราะอ่านข้อมูลไม่ได้ กด 🔄 รีเฟรช
        </div>
      )}
      {partErr && !loadErr && (
        <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #f59a3f', color: '#f59a3f', fontSize: 12.5, fontWeight: 700 }}>
          ⚠️ โหลด {partErr} ไม่สำเร็จ — อัตรา/วันทุกแถวถอยไปใช้ยอดผลิตจริง 30 วันแทน forecast
        </div>
      )}
      {tab === 'usage' ? (
        <PmUsageBoard daily={daily} lines={lineObjs} plans={rows} todayStr={todayStr} loading={loading} />
      ) : (<>
      <FilterBar>
        <LineScopeSelect lines={scopeLines} section={fScope.section} line={fScope.line}
          onChange={(section, line, info) => setFScope({ section, line, names: info?.lines?.length ? info.lines : (section || line ? [line || section] : null) })} />
        <select value={onlyWindow} onChange={e => setOnlyWindow(e.target.value)} aria-label="สถานะ">
          <option value="">ทุกสถานะ ({rows.length})</option>
          <option value="overdue">เลยกำหนด ({overdueCount})</option>
          <option value="window">เข้า window แล้ว ({windowCount})</option>
          <option value="later">ยังไม่ถึง window ({rows.filter(STATUS_KEEP.later).length})</option>
        </select>
        <SearchInput value={fQ} onChange={setFQ} fields="ไลน์ / อุปกรณ์" />
        <span className="filter-count">แสดง {shown.length} จาก {rows.length}</span>
        {droppedNoLine > 0 && <span className="filter-count" style={{ color: '#f59a3f' }} title="ชื่อไลน์ของแผนไม่ตรงทะเบียนไลน์ผลิต — กรองตามไลน์ไม่ได้">⚠ อีก {droppedNoLine} แผนไลน์ไม่ตรงทะเบียน</span>}
        {filtered && <button type="button" onClick={clearFilters} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>✕ ล้างตัวกรอง</button>}
        <span className="spacer" />
        {noLineN > 0 && <span className="filter-count" title="แผนที่ทั้งตัวแผน (usage_source_line) และเครื่อง (line_name) ไม่มีไลน์ — คิดยอดผลิต/วัน PM ไม่ได้ ไปตั้งไลน์ให้เครื่องที่ทะเบียนอุปกรณ์" style={{ color: '#f59a3f', fontWeight: 700 }}>⚠ {noLineN} แผนไม่มีไลน์ — ไม่แสดง</span>}
        {totalBuffer > 0 && <span className="filter-count" style={{ color: 'var(--accent2)', fontWeight: 700 }}>Σ buffer ที่ต้องเตรียม ≈ {totalBuffer.toLocaleString()} ชิ้น</span>}
      </FilterBar>

      {loading ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>กำลังคำนวณ...</div>
        : (!shown.length && rows.length) ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>ไม่มีแผนที่ตรงกับตัวกรอง{droppedNoLine ? ` · อีก ${droppedNoLine} แผนไลน์ไม่ตรงทะเบียน กรองตามไลน์ไม่ได้` : ''}</div>
        : loadErr ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>อ่านข้อมูลไม่ได้ — ดูแถบแดงด้านบน</div>
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
