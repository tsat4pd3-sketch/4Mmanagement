import { useState, useEffect, useMemo, useRef, useContext } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import imageCompression from 'browser-image-compression'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { dueStatus, STATUS_META, DEPT_LABEL, computeNextDue, daysUntilDue } from '../lib/pmSchedule'
import { loadPmTeams, pmTeamsSync } from '../utils/pmTeams'
import { toast } from '../components/Toast'
import useUndoHistory, { undoBtnStyle } from '../utils/useUndoHistory'
import MachineFloorMap from '../components/MachineFloorMap'
import DowntimeSiren from '../components/DowntimeSiren'
import FactoryMap from './FactoryMap'
import { jigEquipTypeOf } from '../utils/equipmentKinds'
import useTabParam from '../utils/useTabParam'
import { monthKeyOf, monthRange, shiftMonth, monthLabel, fmtKwh, fmtBaht, deltaPct } from '../utils/energy'

// 'YYYY-MM-DD' (from pm_plans.next_due_date) → local-midnight Date, so day math
// stays aligned with the Asia/Bangkok calendar (not UTC).
function parseLocalDate(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function publicUrl(path) {
  if (!path) return null
  return supabaseDR.storage.from('jig-images').getPublicUrl(path).data.publicUrl
}

// ไอคอน fallback ต่อ department (ตัวจริงมาจากตาราง mtn_teams · data-driven)
const DEPT_ICON = { maintenance: '🔧', jig_maintenance: '🧩', die_maintenance: '🗜️', production: '🏭' }
const FACILITY_CATS = ['facility', 'utility']

function worstStatus(statuses) {
  let best = null
  for (const s of statuses) if (!best || (STATUS_META[s]?.order ?? 9) < (STATUS_META[best]?.order ?? 9)) best = s
  return best
}

// per-jig PM checklist statuses (module mtn) — shared by both views
async function loadPmForJigs(jigIds) {
  const out = {}
  jigIds.forEach(id => { out[id] = [] })
  if (!jigIds.length) return out
  const { data: cls } = await supabaseDR.from('checklists').select('id, equipment_id, department, frequency, name').eq('module', 'mtn').in('equipment_id', jigIds)
  const clIds = (cls || []).map(c => c.id)
  let plans = []
  if (clIds.length) { const { data } = await supabaseDR.from('pm_plans').select('checklist_id, next_due_date, last_done_at').in('checklist_id', clIds); plans = data || [] }
  const planBy = Object.fromEntries(plans.map(p => [p.checklist_id, p]))
  for (const cl of (cls || [])) {
    const plan = planBy[cl.id]
    const lastDone = plan?.last_done_at ?? null
    const nextDue = plan?.next_due_date ? parseLocalDate(plan.next_due_date) : computeNextDue(lastDone, cl.frequency)
    ;(out[cl.equipment_id] ||= []).push({ dept: cl.department, status: dueStatus(nextDue, cl.frequency), nextDue, freq: cl.frequency, clName: cl.name })
  }
  return out
}

const S = {
  page: { padding: 'clamp(12px,3vw,24px) clamp(14px,3.5vw,28px)', minHeight: '100%', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 14 },
  h1: { fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 },
  sub: { fontSize: 13, color: 'var(--muted)', marginTop: 4 },
  chip: (active, color) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`, background: active ? `${color}18` : 'var(--bg3)', color: active ? color : 'var(--muted)',
  }),
  viewBtn: (active) => ({
    padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border2)'}`, background: active ? 'var(--accent-dim)' : 'var(--bg3)', color: active ? 'var(--accent)' : 'var(--muted)',
  }),
  side: { width: 272, flexShrink: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, alignSelf: 'flex-start', maxHeight: 600, overflowY: 'auto' },
  rowBtn: (active, child) => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', marginLeft: child ? 12 : 0, fontSize: 13,
    border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`, background: active ? 'var(--accent-dim)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text2)', fontWeight: active ? 700 : 500,
  }),
  // แถวอุปกรณ์ที่ยังไม่วาง — 2 บรรทัด (เลข+ปุ่มวาง / ชื่อ) กันข้อความบี้ตัดบรรทัดในแถบแคบ
  unplacedRow: { display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 12 },
  unplacedTop: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  unplacedNo: { fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  unplacedSub: { fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 15 },
  // ชิป "วางจุด" ท้ายแถวอุปกรณ์ที่ยังไม่วาง — armed แล้วเปลี่ยนเป็น "คลิกบนผัง"
  placeChip: (armed) => ({
    marginLeft: 'auto', flexShrink: 0, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
    padding: '2px 7px', borderRadius: 20,
    border: `1px solid ${armed ? 'var(--accent)' : 'var(--border2)'}`,
    background: armed ? 'var(--accent-dim)' : 'var(--bg2)',
    color: armed ? 'var(--accent)' : 'var(--text2)',
  }),
}

// setupMode=false (default, /mtn-layout) = display-only (facility ดูอย่างเดียว ไม่มีปุ่มแก้)
// setupMode=true (/layout-setup แท็บ MTN) = ตั้งค่า facility ได้ (เพิ่มโซน/อัปรูป/วางจุด)
export default function MtnMachineLayout({ setupMode = false }) {
  const { role } = useContext(UserContext)
  // แก้ผัง facility (เพิ่ม/ลบโซน อัปโหลดผัง วาง/ย้ายจุด) = งานของทีม MTN เอง → ใช้สิทธิ์ pm:setup
  // (mtn/admin/manager/supervisor) ได้ทั้งบน /mtn-layout และ /layout-setup — facility เป็น domain ของช่าง
  // ไม่ผูกกับ setupMode เพราะ mtn เข้า /layout-setup ไม่ได้ แต่ต้องตั้งค่า facility ของตัวเองได้ (2026-07-22)
  const canEdit = can('pm', 'setup', role)
  /* ⚠️ facility เปิดมาเป็น "โหมดดูสถานะ" เสมอ — เครื่องมือจัดผัง (＋โซน/ลบ/อัปรูป/วางจุด/Undo)
     ต้องกด "✏️ แก้ผังโซน" เองก่อนถึงโผล่ (2026-08-26 · user ทัก "ผู้บริหารคลิกโซนจากผังรวม
     แล้วกลายเป็นหน้า setup แผนผังเฉยเลย — ควรเห็นแผนผังจริง + การ์ดสถานะ PM/ไฟฟ้าแบบ energy") */
  const [facEdit, setFacEdit] = useState(false)
  const editMode = canEdit && facEdit
  // เปิดหน้ามาเจอ "ภาพรวมทั้งโรงงาน" ก่อน (ฝัง FactoryMap display ตัวเดียวกับ /factory-map) แล้วค่อยเจาะไลน์
  // deep-link จากผังรวมโรงงาน: ?view=facility&zone=<ชื่อโซน>&from=factory-map → เปิดแท็บ Facility ที่โซนนั้นเลย
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const deepZone = searchParams.get('zone')
  const cameFrom = searchParams.get('from')
  // ?view= เป็น deep-link มาแต่เดิม (จากผังรวมโรงงาน) — ตอนนี้ "เขียนกลับ" ด้วย: กดสลับมุมมองแล้วลิงก์เปลี่ยน
  // default ต่างกันตามบริบท: โหมดตั้งค่า (/layout-setup) เริ่มที่ facility · หน้าดูปกติเริ่มที่ overview
  const [viewRaw, setView] = useTabParam(['overview', 'production', 'facility'], setupMode ? 'facility' : 'overview', 'view')
  // โหมดตั้งค่าไม่มีปุ่ม "ภาพรวมทั้งโรงงาน" (แท็บนั้นอยู่ที่ /layout-setup อยู่แล้ว) — ลิงก์ ?view=overview จึงตกกลับ facility
  const view = setupMode && viewRaw === 'overview' ? 'facility' : viewRaw
  const [dept, setDept] = useState('all')
  const [teams, setTeams] = useState(pmTeamsSync()) // ทีมช่าง data-driven (mtn_teams)
  useEffect(() => { loadPmTeams().then(setTeams) }, [])
  // ป้าย/ไอคอนทีม — data-driven จาก teams ก่อน แล้ว fallback map เดิม
  const deptIconOf = (k) => teams.find(t => t.key === k)?.icon ?? DEPT_ICON[k] ?? ''
  const deptLabelOf = (k) => teams.find(t => t.key === k)?.label ?? DEPT_LABEL[k] ?? k
  const [selId, setSelId] = useState(null)
  const [loading, setLoading] = useState(false)

  // production
  const [lines, setLines] = useState([])
  const [selectedLine, setSelectedLine] = useState(null)
  const [prodImage, setProdImage] = useState(null)
  const [prodPoints, setProdPoints] = useState([])
  const [machineInfo, setMachineInfo] = useState({})

  // facility
  const [areas, setAreas] = useState([])
  const [areaId, setAreaId] = useState(null)
  const [facImage, setFacImage] = useState(null)
  const [facPoints, setFacPoints] = useState([])
  const [jigInfo, setJigInfo] = useState({})   // jig_id → { name, jig_no, checklists }
  const [armedJig, setArmedJig] = useState(null)
  const [facMachines, setFacMachines] = useState([])   // facility/utility จากฐานเครื่องจักร (ยังไม่มี shadow jig)
  const [placedAnyZone, setPlacedAnyZone] = useState(() => new Set()) // jig_id ที่ถูกวางไว้แล้ว "ทุกโซน" — ลิสต์ยังไม่วางต้องซ่อนของที่วางโซนอื่นแล้ว
  const [armedMachine, setArmedMachine] = useState(null) // machine ที่กำลังจะวาง (สร้าง shadow jig ตอนวาง)
  // สถานะโซน (โหมดดู) — ใบซ่อม MO ค้างของเครื่องในโซน + พลังงานไฟฟ้าเดือนล่าสุดของโซน
  const [zoneMo, setZoneMo] = useState([])
  const [zonePm, setZonePm] = useState(null)          // { rows:[{name, status, nextDue, dept, placed}], equipCount, unplaced }
  const [zoneEnergy, setZoneEnergy] = useState(null)   // { qty, prev, cost, month } | null
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const detailRef = useRef(null)

  // ─── Undo/Redo — เฉพาะจุดอุปกรณ์บนผังโซนปัจจุบัน (pm_facility_points) ───
  // เพิ่ม/ลบโซน + อัปโหลดรูป ไม่เข้า history (มีไฟล์ใน storage ย้อนคืนไม่ได้ — ใช้ confirm dialog กันพลาดแทน)
  const facPointsRef = useRef([])
  useEffect(() => { facPointsRef.current = facPoints }, [facPoints])
  const areaIdRef = useRef(null)
  useEffect(() => { areaIdRef.current = areaId }, [areaId])
  const pointSnap = () => ({ areaId: areaIdRef.current, points: facPointsRef.current.map(p => ({ ...p })) })
  const applyPointSnapshot = async (snap) => {
    if (snap.areaId !== areaIdRef.current) return false   // สลับโซนไปแล้ว (กันลบจุดโซนอื่น — history ถูก clear ตอนสลับอยู่แล้ว)
    const cur = facPointsRef.current
    const sM = new Map(snap.points.map(p => [p.id, p])), cM = new Map(cur.map(p => [p.id, p]))
    const del = cur.filter(p => !sM.has(p.id)).map(p => p.id)
    const ins = snap.points.filter(p => !cM.has(p.id)).map(p => ({ id: p.id, area_id: snap.areaId, jig_id: p.jig_id, pos_top: p.pos_top, pos_left: p.pos_left }))
    const upd = snap.points.filter(p => { const c = cM.get(p.id); return c && (c.pos_top !== p.pos_top || c.pos_left !== p.pos_left) })
    try {
      if (del.length) { const { error } = await supabaseDR.from('pm_facility_points').delete().in('id', del); if (error) throw error }
      if (ins.length) { const { error } = await supabaseDR.from('pm_facility_points').insert(ins); if (error) throw error }
      for (const p of upd) { const { error } = await supabaseDR.from('pm_facility_points').update({ pos_top: p.pos_top, pos_left: p.pos_left }).eq('id', p.id); if (error) throw error }
    } catch (err) { toast.error('ย้อนไม่สำเร็จ: ' + err.message); return false }
    facPointsRef.current = snap.points
    setFacPoints(snap.points)
    return true
  }
  const hist = useUndoHistory({ snapOf: pointSnap, applySnapshot: applyPointSnapshot, enabled: editMode && view === 'facility' })
  useEffect(() => { hist.clear() }, [areaId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.from('production_lines').select('id, name, parent_line_name').order('name').then(({ data }) => {
      setLines(data || []); if (data?.length && !selectedLine) setSelectedLine(data[0].name)
    })
    reloadAreas()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (view === 'production' && selectedLine) loadProduction() }, [selectedLine, view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'facility' && areaId) loadFacilityArea() }, [areaId, view]) // eslint-disable-line react-hooks/exhaustive-deps
  // เลือกหมุดแล้วต้อง "เห็น" รายละเอียด — ผังสูงเกือบเต็มจอ แผงข้างล่างจึงอยู่ใต้ field of view
  useEffect(() => { if (selId) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [selId])

  /* ── production (read-only, uses production's machine_points) ── */
  const loadProduction = async () => {
    setLoading(true); setSelId(null)
    const lineObj = lines.find(l => l.name === selectedLine)
    const { data: lay } = await supabase.from('line_layouts').select('image_url').eq('line_name', selectedLine).maybeSingle()
    let img = lay?.image_url ?? null
    if (!img && lineObj?.parent_line_name) {
      const { data: pl } = await supabase.from('line_layouts').select('image_url').eq('line_name', lineObj.parent_line_name).maybeSingle()
      img = pl?.image_url ?? null
    }
    setProdImage(img)
    const { data: mp } = await supabase.from('machine_points').select('id, machine_no, pos_top, pos_left').eq('line_name', selectedLine)
    const mpoints = mp || []; setProdPoints(mpoints)
    const machineNos = [...new Set(mpoints.map(p => p.machine_no).filter(Boolean))]
    if (!machineNos.length) { setMachineInfo({}); setLoading(false); return }

    // จับด้วย machine_no ที่อยู่บนผังจริง (ไม่ผูก line ตรงเป๊ะ) — ไลน์ใหญ่ที่วางเครื่องของลูกบนผัง parent
    // จะได้ชื่อ/รายละเอียดครบ ไม่มีหมุดไร้ชื่อ
    const { data: machines } = await supabaseDR.from('machines').select('id, machine_no, machine_name').in('machine_no', machineNos)
    const nameByNo = {}, noById = {}
    ;(machines || []).forEach(m => { if (m.machine_no) nameByNo[m.machine_no] = m.machine_name; if (m.id) noById[m.id] = m.machine_no })
    const { data: jigs } = await supabaseDR.from('jigs').select('id, name, machine_no, machine_id').eq('module', 'mtn')
    const jigOnMachine = (jigs || []).map(j => ({ ...j, _mno: j.machine_no || noById[j.machine_id] || null })).filter(j => j._mno && machineNos.includes(j._mno))
    const jigById = Object.fromEntries(jigOnMachine.map(j => [j.id, j]))
    const pm = await loadPmForJigs(jigOnMachine.map(j => j.id))

    const info = {}
    machineNos.forEach(no => { info[no] = { name: nameByNo[no] || '', checklists: [] } })
    for (const [jid, cls] of Object.entries(pm)) {
      const jig = jigById[jid]; if (!jig || !info[jig._mno]) continue
      cls.forEach(c => info[jig._mno].checklists.push({ ...c, eqName: jig.name || '-' }))
    }
    setMachineInfo(info); setLoading(false)
  }

  /* ── facility (MTN-owned zones + placement) ── */
  const reloadAreas = async () => {
    const { data } = await supabaseDR.from('pm_facility_areas').select('id, name, image_path, sort_order').order('sort_order').order('created_at')
    setAreas(data || [])
    // deep-link ?zone=<ชื่อโซน> → เลือกโซนนั้นเลย (เทียบชื่อแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย)
    if (data?.length && deepZone) {
      const key = String(deepZone).trim().toLowerCase()
      const hit = data.find(a => String(a.name || '').trim().toLowerCase() === key)
      if (hit) { setAreaId(hit.id); return }
    }
    if (data?.length && !areaId) setAreaId(data[0].id)
  }
  const loadFacilityArea = async () => {
    setLoading(true); setSelId(null); setArmedJig(null)
    const area = areas.find(a => a.id === areaId)
    setFacImage(area?.image_path ? publicUrl(area.image_path) : null)
    const { data: pts } = await supabaseDR.from('pm_facility_points').select('id, jig_id, pos_top, pos_left').eq('area_id', areaId)
    setFacPoints(pts || [])
    // จุดของ "ทุกโซน" — ใช้ซ่อนอุปกรณ์ที่วางโซนอื่นไปแล้วออกจากลิสต์ "ยังไม่วาง" (กันวางซ้ำ/สับสน)
    const { data: allPts } = await supabaseDR.from('pm_facility_points').select('jig_id')
    setPlacedAnyZone(new Set((allPts || []).map(p => p.jig_id)))
    // facility/utility equipment + PM status (all zones share the same equipment pool)
    /* ⚠️ ดึง jigs ของโมดูล mtn ทั้งหมด (ตารางนี้เล็ก คิวรีเดียวพอ) แล้วค่อยแยกใช้ 2 วัตถุประสงค์:
         · `jigs` (กรอง facility/utility) = pool ให้ "ลากมาวางบนผัง"
         · `zoneJigs` (จับด้วยชื่อโซน/หมุด **ไม่กรอง category**) = ใช้ตอบ "โซนนี้มี PM อะไรค้าง"
       🔴 เดิมใช้ pool ที่กรอง category ตอบทั้ง 2 เรื่อง → อุปกรณ์ที่มีแผน PM แต่ `equipment_category`
          ไม่ใช่ facility/utility ถูกกรองทิ้งตั้งแต่ต้น ⇒ การ์ดบอก "ยังไม่มีเช็คลิสต์ PM ในโซนนี้"
          ขณะที่ผังรวมโรงงาน (loadPM ไม่กรอง category) บอก "PM ใกล้ครบ 2" = **จอขัดกันเอง**
          (user เจอจริงที่โซน Airbooster 26/08: "บอกมีแผนจะต้อง PM แต่กดเข้าไปไม่มีอะไรบอกเลย") */
    const { data: allJigs } = await supabaseDR.from('jigs').select('id, name, jig_no, equipment_category, machine_id, line_name').eq('module', 'mtn')
    const jigs = (allJigs || []).filter(j => FACILITY_CATS.includes(j.equipment_category))
    const zNameKey = String(area?.name || '').trim().toLowerCase()
    const pinIds = new Set((pts || []).map(p => p.jig_id))
    const zoneJigs = (allJigs || []).filter(j =>
      (zNameKey && String(j.line_name || '').trim().toLowerCase() === zNameKey) || pinIds.has(j.id))
    const pm = await loadPmForJigs([...new Set([...jigs.map(j => j.id), ...zoneJigs.map(j => j.id)])])
    const info = {}
    ;(jigs || []).forEach(j => { info[j.id] = { name: j.name || '-', jig_no: j.jig_no || '', checklists: pm[j.id] || [] } })
    setJigInfo(info)
    // bridge: facility/utility จากฐานเครื่องจักร (machines) ที่ยังไม่มี shadow jig → ให้ดึงมาวางได้
    // (คำสั่ง user — ลงทะเบียนที่ฐานเครื่องจักรที่เดียว ไม่ต้องคีย์ซ้ำ PM Setup) · วางแล้วสร้าง jig เงาผูก machine_id
    const linkedMachineIds = new Set((jigs || []).map(j => j.machine_id).filter(Boolean))
    const { data: fm } = await supabaseDR.from('machines').select('id, machine_no, machine_name, line_name, equipment_category, equipment_kind').eq('is_active', true).in('equipment_category', FACILITY_CATS)
    setFacMachines((fm || []).filter(m => !linkedMachineIds.has(m.id)))
    setLoading(false)

    /* ── สถานะโซนสำหรับการ์ดโหมดดู (best-effort — พลาดแล้วผัง/PM ยังใช้ได้ปกติ) ──
       ใบซ่อมค้าง: จับคู่ mtn_orders.machine_no กับเลขเครื่องของอุปกรณ์ที่วางในโซนนี้ (jig_no ของ shadow jig)
       พลังงาน: energy_monthly ราย "จุดวัด" — ชื่อจุดวัดต้องตรงชื่อโซน (trim+lowercase · กติกาเดียวกับ /factory-map) */
    const zName = zNameKey

    /* 🛠️ "เครื่องไหนกำลังจะถึงคิว PM" (2026-08-26 · user ทัก "กดเข้ามาไม่เห็นมีเลย")
       ⚠️ ต้องนับจาก **อุปกรณ์ที่สังกัดโซน** (`jigs.line_name` = ชื่อโซน) ไม่ใช่แค่ "หมุดที่วางบนผัง"
          — ผังรวมโรงงานนับแบบแรก (loadPM group ตาม jigs.line_name) การ์ดนี้เคยนับแบบหลัง
          ⇒ ผังบอก "PM ใกล้ครบ 2" แต่การ์ดบอก "ยังไม่มีเช็คลิสต์ PM ในโซนนี้" = จอเดียวกันขัดกันเอง
       อุปกรณ์ที่มีแผนแต่ยังไม่วางบนผัง **ห้ามซ่อน** — ติดป้ายบอกให้ไปวาง */
    const ptIds = pinIds
    const pmRows = []
    zoneJigs.forEach(j => (pm[j.id] || []).forEach(c => pmRows.push({
      jigId: j.id, name: j.jig_no || j.name || '-', sub: j.jig_no && j.name && j.jig_no !== j.name ? j.name : '',
      placed: ptIds.has(j.id), ...c,
    })))
    pmRows.sort((a, b) => (STATUS_META[a.status]?.order ?? 9) - (STATUS_META[b.status]?.order ?? 9)
      || (a.nextDue?.getTime() ?? 9e15) - (b.nextDue?.getTime() ?? 9e15))
    setZonePm({ rows: pmRows, equipCount: zoneJigs.length, unplaced: zoneJigs.filter(j => !ptIds.has(j.id)).length })

    const zoneNos = new Set(zoneJigs.map(j => String(j.jig_no || '').trim().toUpperCase()).filter(Boolean))
    const { data: mos, error: moErr } = await supabaseDR.from('mtn_orders')
      .select('id, mo_no, machine_no, status, report_at')
      .not('status', 'in', '("closed","rejected")')
    setZoneMo(moErr ? [] : (mos || [])
      .filter(o => zoneNos.has(String(o.machine_no || '').trim().toUpperCase()))
      .sort((a, b) => String(a.report_at || '').localeCompare(String(b.report_at || ''))))
    const win = monthRange(monthKeyOf(), 7)   // ถอยหาเดือนล่าสุดที่มีข้อมูลจริง — บิลไฟมาช้าเป็นสัปดาห์ (กติกา /factory-map)
    const { data: en, error: enErr } = await supabaseDR.from('energy_monthly')
      .select('scope_kind, scope_name, month_key, qty, cost').eq('utility', 'electric')
      .neq('scope_kind', 'plant').gte('month_key', win[0]).lte('month_key', win[win.length - 1])
    if (enErr) { setZoneEnergy(null) } else {
      const mine = (en || []).filter(r => String(r.scope_name || '').trim().toLowerCase() === zName && r.qty != null)
      const mk = [...win].reverse().find(m => mine.some(r => r.month_key === m))
      if (!mk) { setZoneEnergy(null) } else {
        const cur = mine.find(r => r.month_key === mk)
        const prevRow = mine.find(r => r.month_key === shiftMonth(mk, -1))
        setZoneEnergy({ qty: Number(cur.qty) || 0, cost: Number(cur.cost) || 0, prev: prevRow ? (Number(prevRow.qty) || 0) : null, month: mk })
      }
    }
  }

  const addArea = async () => {
    if (!editMode) return
    const name = window.prompt('ชื่อโซน facility (เช่น ห้องปั๊มลม, โซน MDB, ระบบน้ำ RO)')
    if (!name?.trim()) return
    const { data, error } = await supabaseDR.from('pm_facility_areas').insert({ name: name.trim(), sort_order: areas.length }).select().single()
    if (error) return toast.error(error.message)
    await reloadAreas(); setAreaId(data.id)
  }
  const deleteArea = async (id) => {
    if (!editMode) return
    if (!window.confirm('ลบโซนนี้? (อุปกรณ์ที่วางบนโซนนี้จะถูกเอาออกจากผัง แต่ตัวอุปกรณ์+ประวัติ PM ไม่หาย)')) return
    const oldPath = areas.find(a => a.id === id)?.image_path
    const { error } = await supabaseDR.from('pm_facility_areas').delete().eq('id', id)
    if (error) return toast.error(error.message)
    // ลบ row สำเร็จแล้วค่อยเก็บกวาดไฟล์รูปผังโซน กันไฟล์กำพร้าใน storage (best-effort)
    if (oldPath) supabaseDR.storage.from('jig-images').remove([oldPath]).then(() => {}, () => {})
    setAreaId(prev => prev === id ? null : prev); await reloadAreas()
  }
  const uploadImage = async (e) => {
    const file = e.target.files?.[0]; if (!file || !areaId || !editMode) return
    setBusy(true)
    try {
      // รูปผัง/layout มีจำนวนน้อย (ไม่เกิน ~20 รูปทั้งระบบ) แต่ต้องซูมอ่านรายละเอียดได้ —
      // บีบเบากว่ารูปพนักงานมาก (2560px/2.5MB q0.9) อย่าลดกลับไป 1600px/0.5MB เคยเบลอจนใช้งานไม่ได้
      const compressed = await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9 })
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `facility/${areaId}.${ext}`
      const { error: upErr } = await supabaseDR.storage.from('jig-images').upload(path, compressed, { upsert: true })
      if (upErr) throw upErr
      // ⚠️ เช็ค error ก่อนลบไฟล์เก่าเสมอ (supabase-js คืน { error } ไม่ throw) —
      // ไม่เช็คแล้วลบต่อ = update พลาด แต่ไฟล์ผังเดิมหายไปแล้ว ⇒ โซนนั้นรูปเสียถาวร
      // (deleteArea บรรทัดบนทำถูกอยู่แล้ว ใช้เป็นแบบ)
      const { error: dbErr } = await supabaseDR.from('pm_facility_areas').update({ image_path: path }).eq('id', areaId)
      if (dbErr) throw dbErr
      // path ผูกกับนามสกุลไฟล์ — อัปโหลด .png ทับโซนที่เดิมเป็น .jpg จะไม่ทับไฟล์เดิม ต้องลบทิ้ง (best-effort)
      const prevPath = areas.find(a => a.id === areaId)?.image_path
      if (prevPath && prevPath !== path) supabaseDR.storage.from('jig-images').remove([prevPath]).then(() => {}, () => {})
      await reloadAreas()
      setFacImage(`${publicUrl(path)}?v=${file.size}`)
      toast.success('อัปโหลดรูปผังแล้ว')
    } catch (err) { toast.error(err.message) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const placeJig = async (pct) => {
    if (!areaId || !editMode) return
    let jigId = armedJig
    // วาง machine จากฐานเครื่องจักร → สร้าง shadow jig (ผูก machine_id) ก่อน แล้วค่อยวาง
    if (!jigId && armedMachine) {
      const m = facMachines.find(x => x.id === armedMachine); if (!m) return
      const { data: jig, error: je } = await supabaseDR.from('jigs').insert({
        name: m.machine_name || m.machine_no, jig_no: m.machine_no || null,
        module: 'mtn', equipment_category: m.equipment_category || 'facility',
        // แถวเงา = สำเนาของเครื่องจริง — ชนิดต้องตามเครื่องเสมอ ห้ามปล่อยให้ default
        equipment_type: jigEquipTypeOf(m.equipment_kind),
        machine_id: m.id, machine_no: m.machine_no || null, line_name: m.line_name || null,
      }).select('id').single()
      if (je) return toast.error('สร้างอุปกรณ์ PM ไม่สำเร็จ: ' + je.message)
      jigId = jig.id
    }
    if (!jigId) return
    hist.pushHistory()
    const { error } = await supabaseDR.from('pm_facility_points').insert({ area_id: areaId, jig_id: jigId, pos_top: pct.top, pos_left: pct.left })
    if (error) return toast.error(error.message.includes('duplicate') ? 'อุปกรณ์นี้อยู่บนโซนนี้แล้ว' : error.message)
    setArmedJig(null); setArmedMachine(null); loadFacilityArea()
  }
  const movePoint = async (pointId, pct) => {
    if (!editMode) return
    hist.pushHistory()
    setFacPoints(prev => prev.map(p => p.id === pointId ? { ...p, pos_top: pct.top, pos_left: pct.left } : p))
    await supabaseDR.from('pm_facility_points').update({ pos_top: pct.top, pos_left: pct.left }).eq('id', pointId)
  }
  const removePoint = async (pointId) => {
    if (!editMode) return
    hist.pushHistory()
    setFacPoints(prev => prev.filter(p => p.id !== pointId))
    await supabaseDR.from('pm_facility_points').delete().eq('id', pointId)
  }

  /* ── enrich markers for the current view + department filter ── */
  const colorFor = (checklists) => {
    const relevant = dept === 'all' ? checklists : checklists.filter(c => c.dept === dept)
    const responsible = relevant.length > 0
    const worst = responsible ? worstStatus(relevant.map(c => c.status)) : null
    return { color: responsible ? (STATUS_META[worst]?.color ?? '#556') : '#3a4a3d', dim: dept !== 'all' && !responsible, worst }
  }
  const enrichedPoints = useMemo(() => {
    if (view === 'production') {
      return prodPoints.map(p => {
        const info = machineInfo[p.machine_no] || { name: '', checklists: [] }
        const c = colorFor(info.checklists)
        return { id: p.id, pos_top: p.pos_top, pos_left: p.pos_left, label: p.machine_no, sub: info.name, color: c.color, dim: c.dim, alwaysLabel: c.worst === 'overdue' }
      })
    }
    return facPoints.map(p => {
      const info = jigInfo[p.jig_id] || { name: '', jig_no: '', checklists: [] }
      const c = colorFor(info.checklists)
      return { id: p.id, pos_top: p.pos_top, pos_left: p.pos_left, label: info.jig_no || info.name, sub: info.jig_no ? info.name : '', color: c.color, dim: c.dim, alwaysLabel: c.worst === 'overdue' }
    })
  }, [view, prodPoints, machineInfo, facPoints, jigInfo, dept])

  const counts = useMemo(() => {
    const c = {}
    enrichedPoints.forEach(p => { if (!p.dim) { const st = Object.keys(STATUS_META).find(k => STATUS_META[k].color === p.color); if (st) c[st] = (c[st] ?? 0) + 1 } })
    return c
  }, [enrichedPoints])


  const orderedLines = useMemo(() => {
    const parents = lines.filter(l => !l.parent_line_name), children = lines.filter(l => l.parent_line_name), out = []
    parents.forEach(p => { out.push({ ...p }); children.filter(c => c.parent_line_name === p.name).forEach(c => out.push({ ...c, _child: true })) })
    children.filter(c => !parents.find(p => p.name === c.parent_line_name)).forEach(c => out.push({ ...c, _child: true }))
    return out
  }, [lines])

  // detail panel target
  const sel = selId ? (view === 'production' ? prodPoints.find(p => p.id === selId) : facPoints.find(p => p.id === selId)) : null
  const selInfo = sel ? (view === 'production' ? (machineInfo[sel.machine_no] || null) : (jigInfo[sel.jig_id] || null)) : null
  const selLabel = sel ? (view === 'production' ? sel.machine_no : (selInfo?.jig_no || selInfo?.name)) : ''
  const selChecklists = selInfo ? (dept === 'all' ? selInfo.checklists : selInfo.checklists.filter(c => c.dept === dept)) : []

  // ลิสต์ "ยังไม่วาง" = ไม่ถูกวางในโซนไหนเลย (วางโซนอื่นแล้ว = ซ่อน กันวางซ้ำ · คำสั่ง user 2026-08-03)
  const unplacedJigs = Object.entries(jigInfo).filter(([id]) => !placedAnyZone.has(id))

  return (
    <div style={S.page}>
      <DowntimeSiren mode="call_mtn" />
      <div style={{ display: 'flex', paddingRight: 52, justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={S.h1}>🗺️ ผังเครื่องจักร (ซ่อมบำรุง)</h1>
          <p style={S.sub}>ดูสถานะ PM บนผังจริง · กรองตามผู้รับผิดชอบ</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* มาจากผังรวมโรงงาน (คลิกโซน facility) → ปุ่มกลับไปที่เดิม */}
          {cameFrom === 'factory-map' && (
            <button onClick={() => navigate('/factory-map')} style={S.viewBtn(false)}>← กลับผังรวมโรงงาน</button>
          )}
          {!setupMode && <button onClick={() => { setView('overview'); setSelId(null) }} style={S.viewBtn(view === 'overview')}>🗺️ ภาพรวมทั้งโรงงาน</button>}
          <button onClick={() => { setView('production'); setSelId(null) }} style={S.viewBtn(view === 'production')}>🏭 ไลน์ผลิต</button>
          <button onClick={() => { setView('facility'); setSelId(null) }} style={S.viewBtn(view === 'facility')}>🔌 Facility / Utility</button>
        </div>
      </div>

      {view === 'overview' ? (
        <FactoryMap />
      ) : (
      <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setDept('all')} style={S.chip(dept === 'all', 'var(--accent)')}>ทั้งหมด</button>
        {teams.map(t => <button key={t.key} onClick={() => setDept(t.key)} style={S.chip(dept === t.key, t.color || '#4d9fff')}>{t.icon || DEPT_ICON[t.key] || ''} {t.label || DEPT_LABEL[t.key]}</button>)}
        {view === 'facility' && canEdit && (
          <button onClick={() => setFacEdit(v => { if (v) { setArmedJig(null); setArmedMachine(null) } return !v })}
            style={S.viewBtn(facEdit)} title={facEdit ? 'กลับสู่โหมดดูสถานะ' : 'เปิดเครื่องมือจัดผัง (เพิ่มโซน/อัปรูป/วางจุด)'}>
            {facEdit ? '✓ เสร็จสิ้นการแก้ผัง' : '✏️ แก้ผังโซน'}
          </button>
        )}
        {view === 'facility' && editMode && (
          <>
            <button onClick={hist.undo} disabled={!hist.canUndo || hist.busy} style={undoBtnStyle(hist.canUndo && !hist.busy)} title="ย้อนกลับ — จุดบนผังโซนนี้ (Ctrl+Z)">↩️ Undo</button>
            <button onClick={hist.redo} disabled={!hist.canRedo || hist.busy} style={undoBtnStyle(hist.canRedo && !hist.busy)} title="ทำซ้ำ (Ctrl+Y)">↪️ Redo</button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color }} />{m.label}{counts[k] ? ` (${counts[k]})` : ''}
            </span>
          ))}
        </div>
      </div>

      {view === 'facility' && (armedJig || armedMachine) && (
        <div style={{ fontSize: 12, color: 'var(--accent2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          📍 คลิกบนผังเพื่อวาง <b>{armedJig ? (jigInfo[armedJig]?.jig_no || jigInfo[armedJig]?.name) : (facMachines.find(m => m.id === armedMachine)?.machine_no)}</b>{armedMachine ? ' (ดึงจากฐานเครื่องจักร)' : ''} · <span onClick={() => { setArmedJig(null); setArmedMachine(null) }} style={{ cursor: 'pointer', textDecoration: 'underline' }}>ยกเลิก</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading
            ? <div style={{ flex: 1, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14 }}>
                <div style={{ width: 30, height: 30, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              </div>
            : <MachineFloorMap
                imageUrl={view === 'production' ? prodImage : facImage}
                points={enrichedPoints} selectedId={selId} onSelect={p => setSelId(p.id)}
                editable={view === 'facility' && editMode} armed={!!armedJig || !!armedMachine}
                height="clamp(360px, calc(100vh - 260px), 1100px)"
                onImageClick={placeJig} onMarkerDragEnd={movePoint} onMarkerRemove={removePoint} />}

          {sel && selInfo && (
            /* ⚠️ ผังสูงเกือบเต็มจอ → แผงรายละเอียดอยู่ใต้ fold: คลิกหมุดแล้ว "เหมือนคลิกได้เฉยๆ ไม่มีอะไรขึ้น"
               (user ทัก 2026-08-26) → เลื่อนมาให้เห็นเองทุกครั้งที่เลือกหมุด */
            <div ref={detailRef} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>⚙️ {selLabel}{selInfo.name && selInfo.name !== selLabel ? ` · ${selInfo.name}` : ''}</div>
                <button onClick={() => setSelId(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
              </div>
              {selChecklists.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีเช็คลิสต์ PM{dept !== 'all' ? ` ของแผนก ${deptLabelOf(dept)}` : ''} สำหรับรายการนี้</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selChecklists.map((c, i) => {
                    const m = STATUS_META[c.status] ?? STATUS_META.ok
                    const dd = c.nextDue ? daysUntilDue(c.nextDue) : null
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, borderTop: i ? '1px dashed var(--border)' : 'none', paddingTop: i ? 6 : 0 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{c.eqName ?? selInfo.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#4d9fff', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>{deptIconOf(c.dept)} {deptLabelOf(c.dept)}</span>
                        <span style={{ color: m.color, fontWeight: 700 }}>{m.label}</span>
                        <span style={{ color: 'var(--muted)' }}>{c.nextDue ? `ครบ ${c.nextDue.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}${dd != null ? (dd < 0 ? ` (เกิน ${Math.abs(dd)} วัน)` : ` (อีก ${dd} วัน)`) : ''}` : 'ไม่มีรอบตายตัว'}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* right sidebar — production: line tree · facility: zones + equipment */}
        {view === 'production' ? (
          <div style={S.side}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>ไลน์ผลิต ({lines.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {orderedLines.map(l => <div key={l.id} onClick={() => setSelectedLine(l.name)} style={S.rowBtn(selectedLine === l.name, l._child)}>{l._child ? '└ ' : ''}{l.name}</div>)}
            </div>
          </div>
        ) : (
          <div style={S.side}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>โซน Facility ({areas.length})</span>
              {editMode && <button onClick={addArea} style={{ background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 6, padding: '3px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ โซน</button>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
              {areas.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div onClick={() => setAreaId(a.id)} style={{ ...S.rowBtn(areaId === a.id, false), flex: 1 }}>{a.image_path ? '🗺️' : '▫️'} {a.name}</div>
                  {editMode && <button className="tbtn" onClick={() => deleteArea(a.id)} title="ลบโซน" style={{ background: 'transparent', border: 'none', color: '#e05c4a', cursor: 'pointer', fontSize: 12 }}>✕</button>}
                </div>
              ))}
              {!areas.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{canEdit ? 'ยังไม่มีโซน — กด “✏️ แก้ผังโซน” แล้ว “+ โซน” เพื่อเริ่ม' : 'ยังไม่มีโซน — ให้ทีมช่างตั้งค่าก่อน'}</div>}
            </div>

            {/* ── โหมดดู (default): การ์ดสถานะโซน — PM / ใบซ่อมค้าง / พลังงาน (สไตล์การ์ด energy)
                   ผู้บริหารคลิกโซนจากผังรวมต้องเจอ "สถานะ" ไม่ใช่เครื่องมือ setup (2026-08-26) ── */}
            {areaId && !editMode && (() => {
              const d = zoneEnergy?.prev != null ? deltaPct(zoneEnergy.qty, zoneEnergy.prev) : null
              const dCol = d == null ? 'var(--muted)' : d <= -5 ? '#22c55e' : d > 10 ? '#ef4444' : 'var(--text2)'
              return (
                <div style={{ border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)', borderRadius: 10, padding: '10px 12px', background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>📊 สถานะโซนนี้</div>
                  {/* 🛠️ PM — นับจากอุปกรณ์ที่สังกัดโซน (เกณฑ์เดียวกับผังรวมโรงงาน) ไม่ใช่แค่หมุดบนผัง */}
                  {(() => {
                    const rows = (zonePm?.rows || []).filter(r => dept === 'all' || r.dept === dept)
                    const cnt = {}; rows.forEach(r => { cnt[r.status] = (cnt[r.status] || 0) + 1 })
                    const due = rows.filter(r => r.status === 'overdue' || r.status === 'due_soon' || r.status === 'never')
                    return (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                          🛠️ PM อุปกรณ์ · {zonePm?.equipCount ?? 0} ตัวในโซน{facPoints.length ? ` · ${facPoints.length} จุดบนผัง` : ''}
                        </div>
                        {!rows.length ? (
                          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                            ยังไม่มีเช็คลิสต์ PM{dept !== 'all' ? ` ของ ${deptLabelOf(dept)}` : ''} ในโซนนี้ —{' '}
                            <Link to="/pm?tab=setup" style={{ color: 'var(--accent)', fontWeight: 700 }}>ตั้งจุดตรวจที่ ศูนย์ PM → ตั้งค่าจุดตรวจ</Link>
                          </div>
                        ) : (<>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 4 }}>
                            {Object.entries(STATUS_META).filter(([k]) => cnt[k]).map(([k, m]) => (
                              <span key={k} style={{ fontSize: 12, fontWeight: 800, color: m.color }}>{m.label} {cnt[k]}</span>
                            ))}
                          </div>
                          {/* ⭐ ตัวที่ user ถามหา: "เครื่องไหนจะถึงคิว PM" — บอกชื่อ+วันครบ ไม่ใช่แค่ตัวเลขรวม */}
                          {due.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                              {due.slice(0, 6).map((r, i) => {
                                const m = STATUS_META[r.status] ?? STATUS_META.ok
                                const dd = r.nextDue ? daysUntilDue(r.nextDue) : null
                                return (
                                  <div key={`${r.jigId}-${i}`} onClick={() => { const p = facPoints.find(p => p.jig_id === r.jigId); if (p) setSelId(p.id) }}
                                    title={r.clName || ''} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: r.placed ? 'pointer' : 'default' }}>
                                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                                    <span style={{ fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                                    <span style={{ marginLeft: 'auto', flexShrink: 0, color: m.color, fontWeight: 700 }}>
                                      {dd == null ? m.label : dd < 0 ? `เกิน ${Math.abs(dd)} วัน` : dd === 0 ? 'ครบวันนี้' : `อีก ${dd} วัน`}
                                    </span>
                                    {/* ปิดลูป: เห็นว่าถึงคิวแล้วกดไปตรวจได้เลย ไม่ต้องไปไล่หาเองในหน้า PM */}
                                    <Link to={`/pm?tab=check&dept=${r.dept || 'maintenance'}&equip=${r.jigId}`}
                                      onClick={e => e.stopPropagation()} title="ไปบันทึกผลตรวจของเครื่องนี้"
                                      style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>✓ ตรวจ</Link>
                                  </div>
                                )
                              })}
                              {due.length > 6 && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>+ อีก {due.length - 6} รายการ</div>}
                              {/* ทางออกไปหน้าที่ทำงานจริง — จอนี้อ่านอย่างเดียว */}
                              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                                <Link to="/pm?tab=plan" style={{ fontSize: 10.5, color: 'var(--accent)', textDecoration: 'none' }}>📅 แผน PM ทั้งหมด</Link>
                                <Link to="/pm?tab=coord" style={{ fontSize: 10.5, color: 'var(--accent)', textDecoration: 'none' }}>🗓️ นัดประสานงาน</Link>
                              </div>
                            </div>
                          )}
                          {/* มีแผน PM แต่ยังไม่ได้วางบนผัง = หาไม่เจอบนจอ ห้ามซ่อน */}
                          {zonePm?.unplaced > 0 && (
                            <div style={{ fontSize: 10.5, color: 'var(--accent2)', marginTop: 5 }}>
                              ⚠ อุปกรณ์ในโซนนี้ {zonePm.unplaced} ตัวยังไม่ได้วางบนผัง — กด “✏️ แก้ผังโซน” เพื่อวาง
                            </div>
                          )}
                        </>)}
                      </div>
                    )
                  })()}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>🔧 ใบซ่อม MO ค้างของโซนนี้</div>
                    <div style={{ fontSize: zoneMo.length ? 17 : 12, fontWeight: 900, color: zoneMo.length ? '#f59e0b' : '#22c55e', marginTop: 3 }}>
                      {zoneMo.length ? `${zoneMo.length} ใบ` : '✅ ไม่มีใบค้าง'}
                    </div>
                    {zoneMo.slice(0, 3).map(o => (
                      <div key={o.id} onClick={() => navigate('/mtn-repair')} style={{ fontSize: 11, color: 'var(--text2)', cursor: 'pointer', marginTop: 2 }}>
                        {o.mo_no || '⏳ รอออกเลข'} · {o.machine_no}
                      </div>
                    ))}
                    {zoneMo.length > 3 && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>+ อีก {zoneMo.length - 3} ใบ — ดูที่ใบแจ้งซ่อม</div>}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>⚡ พลังงานไฟฟ้า{zoneEnergy ? ` · ${monthLabel(zoneEnergy.month)}` : ''}</div>
                    {zoneEnergy ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 2 }}>
                          <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtKwh(zoneEnergy.qty)}</span>
                          <span style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.9 }}>kWh</span>
                          {d != null && <span style={{ fontSize: 11.5, fontWeight: 800, color: dCol, lineHeight: 1.8 }}>{d > 0 ? '+' : ''}{d}% เทียบเดือนก่อน</span>}
                        </div>
                        {zoneEnergy.cost > 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>≈ {fmtBaht(zoneEnergy.cost)} บาท</div>}
                      </>
                    ) : (
                      /* "ไม่มีข้อมูล" ≠ 0 — บอกตรงๆ ว่ายังไม่กรอก + กรอกที่ไหน (ห้ามเงียบ) */
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>ยังไม่กรอกของโซนนี้ — กรอกที่หน้า ⚡ พลังงาน (ชื่อจุดวัดต้องตรงชื่อโซน)</div>
                    )}
                  </div>
                  {/* ⚠️ ห้ามเขียนว่า uptime/online — ยังไม่มีสัญญาณรายเครื่อง (กฎ SCADA) */}
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, borderTop: '1px dashed var(--border)', paddingTop: 7 }}>
                    ⏱ Uptime รายเครื่องยังไม่มีสัญญาณ (ต้องต่อ SCADA/มิเตอร์ก่อน) — สีบนผังมาจากรอบ PM ที่คนบันทึก
                  </div>
                </div>
              )
            })()}

            {areaId && editMode && (
              <>
                {editMode && (
                  <label style={{ display: 'block', marginBottom: 12 }}>
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={uploadImage} disabled={busy} />
                    <span style={{ display: 'block', textAlign: 'center', background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 8, padding: '8px', fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
                      {busy ? 'อัปโหลด...' : facImage ? '🖼️ เปลี่ยนรูปผังโซน' : '📷 อัปโหลดรูปผังโซน'}
                    </span>
                  </label>
                )}
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>อุปกรณ์ที่ยังไม่วาง ({unplacedJigs.length + facMachines.length})</div>
                {/* บอกวิธีวางให้เห็นชัด — เดิมมีแต่ tooltip คนหาไม่เจอว่าต้องกดยังไง (2026-08-03) */}
                {canEdit && (unplacedJigs.length + facMachines.length) > 0 && (
                  <div style={{ fontSize: 11, color: facImage ? 'var(--accent)' : 'var(--accent2)', background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 7, padding: '5px 8px', marginBottom: 7, lineHeight: 1.5 }}>
                    {facImage
                      ? <>วิธีวาง: <b>① กดปุ่ม 📍 วาง</b> ที่อุปกรณ์ → <b>② คลิกตำแหน่งบนผัง</b></>
                      : <>⚠️ ต้อง <b>อัปโหลดรูปผังโซน</b> ก่อน ถึงจะวางอุปกรณ์ได้</>}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {unplacedJigs.map(([id, info]) => {
                    const c = colorFor(info.checklists)
                    return (
                      <div key={id} onClick={() => { if (!canEdit) return; facImage ? (setArmedJig(id), setArmedMachine(null)) : toast.error('อัปโหลดรูปผังโซนก่อน') }}
                        title={!canEdit ? 'ไม่มีสิทธิ์แก้ผัง' : facImage ? 'คลิกแล้วไปคลิกบนผังเพื่อวาง' : 'อัปโหลดรูปผังก่อน'}
                        style={{ ...S.unplacedRow, border: `1px solid ${armedJig === id ? 'var(--accent)' : 'var(--border)'}`, background: armedJig === id ? 'var(--accent-dim)' : 'var(--bg3)' }}>
                        <div style={S.unplacedTop}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                          <span style={S.unplacedNo}>{info.jig_no || info.name}</span>
                          {canEdit && <span style={S.placeChip(armedJig === id)}>{armedJig === id ? '👆 คลิกบนผัง' : '📍 วาง'}</span>}
                        </div>
                        {info.jig_no && info.name && <div style={S.unplacedSub}>{info.name}</div>}
                      </div>
                    )
                  })}
                  {/* bridge: facility/utility จากฐานเครื่องจักร — คลิกแล้ววาง = สร้าง shadow jig อัตโนมัติ */}
                  {facMachines.map(m => (
                    <div key={`m-${m.id}`} onClick={() => { if (!canEdit) return; facImage ? (setArmedMachine(m.id), setArmedJig(null)) : toast.error('อัปโหลดรูปผังโซนก่อน') }}
                      title={!canEdit ? 'ไม่มีสิทธิ์แก้ผัง' : facImage ? 'ดึงจากฐานเครื่องจักร — คลิกแล้ววางบนผัง' : 'อัปโหลดรูปผังก่อน'}
                      style={{ ...S.unplacedRow, border: `1px dashed ${armedMachine === m.id ? 'var(--accent)' : 'var(--border2)'}`, background: armedMachine === m.id ? 'var(--accent-dim)' : 'var(--bg2)' }}>
                      <div style={S.unplacedTop}>
                        <span style={{ fontSize: 11, flexShrink: 0 }}>{m.equipment_category === 'utility' ? '⚡' : '🔧'}</span>
                        <span style={S.unplacedNo}>{m.machine_no}</span>
                        {canEdit && <span style={S.placeChip(armedMachine === m.id)}>{armedMachine === m.id ? '👆 คลิกบนผัง' : '📍 วาง'}</span>}
                      </div>
                      <div style={S.unplacedSub}>
                        {m.machine_name || m.line_name || ''}<span style={{ color: 'var(--accent2)' }}> · ฐานเครื่องจักร</span>
                      </div>
                    </div>
                  ))}
                  {!unplacedJigs.length && !facMachines.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>วางครบแล้ว · เพิ่ม facility/utility ที่ <b>ฐานข้อมูลเครื่องจักร</b> (เลือกหมวด Facility/Utility) แล้วจะมาโผล่ที่นี่ให้วาง</div>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  )
}
