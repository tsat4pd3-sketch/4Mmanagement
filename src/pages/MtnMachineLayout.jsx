import { useState, useEffect, useMemo, useRef, useContext } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { dueStatus, STATUS_META, DEPT_LABEL, computeNextDue, daysUntilDue } from '../lib/pmSchedule'
import { loadPmTeams, pmTeamsSync } from '../utils/pmTeams'
import { toast } from '../components/Toast'
import MachineFloorMap from '../components/MachineFloorMap'
import DowntimeSiren from '../components/DowntimeSiren'
import FactoryMap from './FactoryMap'

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
  side: { width: 240, flexShrink: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, alignSelf: 'flex-start', maxHeight: 600, overflowY: 'auto' },
  rowBtn: (active, child) => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', marginLeft: child ? 12 : 0, fontSize: 13,
    border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`, background: active ? 'var(--accent-dim)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text2)', fontWeight: active ? 700 : 500,
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
  // เปิดหน้ามาเจอ "ภาพรวมทั้งโรงงาน" ก่อน (ฝัง FactoryMap display ตัวเดียวกับ /factory-map) แล้วค่อยเจาะไลน์
  const [view, setView] = useState(setupMode ? 'facility' : 'overview') // 'overview' | 'production' | 'facility'
  const [dept, setDept] = useState('all')
  const [teams, setTeams] = useState(pmTeamsSync()) // ทีมช่าง data-driven (mtn_teams)
  useEffect(() => { loadPmTeams().then(setTeams) }, [])
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
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    supabase.from('production_lines').select('id, name, parent_line_name').order('name').then(({ data }) => {
      setLines(data || []); if (data?.length && !selectedLine) setSelectedLine(data[0].name)
    })
    reloadAreas()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (view === 'production' && selectedLine) loadProduction() }, [selectedLine, view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'facility' && areaId) loadFacilityArea() }, [areaId, view]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (data?.length && !areaId) setAreaId(data[0].id)
  }
  const loadFacilityArea = async () => {
    setLoading(true); setSelId(null); setArmedJig(null)
    const area = areas.find(a => a.id === areaId)
    setFacImage(area?.image_path ? publicUrl(area.image_path) : null)
    const { data: pts } = await supabaseDR.from('pm_facility_points').select('id, jig_id, pos_top, pos_left').eq('area_id', areaId)
    setFacPoints(pts || [])
    // facility/utility equipment + PM status (all zones share the same equipment pool)
    const { data: jigs } = await supabaseDR.from('jigs').select('id, name, jig_no, equipment_category').eq('module', 'mtn').in('equipment_category', FACILITY_CATS)
    const pm = await loadPmForJigs((jigs || []).map(j => j.id))
    const info = {}
    ;(jigs || []).forEach(j => { info[j.id] = { name: j.name || '-', jig_no: j.jig_no || '', checklists: pm[j.id] || [] } })
    setJigInfo(info); setLoading(false)
  }

  const addArea = async () => {
    if (!canEdit) return
    const name = window.prompt('ชื่อโซน facility (เช่น ห้องปั๊มลม, โซน MDB, ระบบน้ำ RO)')
    if (!name?.trim()) return
    const { data, error } = await supabaseDR.from('pm_facility_areas').insert({ name: name.trim(), sort_order: areas.length }).select().single()
    if (error) return toast.error(error.message)
    await reloadAreas(); setAreaId(data.id)
  }
  const deleteArea = async (id) => {
    if (!canEdit) return
    if (!window.confirm('ลบโซนนี้? (อุปกรณ์ที่วางบนโซนนี้จะถูกเอาออกจากผัง แต่ตัวอุปกรณ์+ประวัติ PM ไม่หาย)')) return
    const oldPath = areas.find(a => a.id === id)?.image_path
    const { error } = await supabaseDR.from('pm_facility_areas').delete().eq('id', id)
    if (error) return toast.error(error.message)
    // ลบ row สำเร็จแล้วค่อยเก็บกวาดไฟล์รูปผังโซน กันไฟล์กำพร้าใน storage (best-effort)
    if (oldPath) supabaseDR.storage.from('jig-images').remove([oldPath]).then(() => {}, () => {})
    setAreaId(prev => prev === id ? null : prev); await reloadAreas()
  }
  const uploadImage = async (e) => {
    const file = e.target.files?.[0]; if (!file || !areaId || !canEdit) return
    setBusy(true)
    try {
      // รูปผัง/layout มีจำนวนน้อย (ไม่เกิน ~20 รูปทั้งระบบ) แต่ต้องซูมอ่านรายละเอียดได้ —
      // บีบเบากว่ารูปพนักงานมาก (2560px/2.5MB q0.9) อย่าลดกลับไป 1600px/0.5MB เคยเบลอจนใช้งานไม่ได้
      const compressed = await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9 })
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `facility/${areaId}.${ext}`
      const { error: upErr } = await supabaseDR.storage.from('jig-images').upload(path, compressed, { upsert: true })
      if (upErr) throw upErr
      await supabaseDR.from('pm_facility_areas').update({ image_path: path }).eq('id', areaId)
      // path ผูกกับนามสกุลไฟล์ — อัปโหลด .png ทับโซนที่เดิมเป็น .jpg จะไม่ทับไฟล์เดิม ต้องลบทิ้ง (best-effort)
      const prevPath = areas.find(a => a.id === areaId)?.image_path
      if (prevPath && prevPath !== path) supabaseDR.storage.from('jig-images').remove([prevPath]).then(() => {}, () => {})
      await reloadAreas()
      setFacImage(`${publicUrl(path)}?v=${file.size}`)
      toast.success('อัปโหลดรูปผังแล้ว')
    } catch (err) { toast.error(err.message) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const placeJig = async (pct) => {
    if (!armedJig || !areaId || !canEdit) return
    const { error } = await supabaseDR.from('pm_facility_points').insert({ area_id: areaId, jig_id: armedJig, pos_top: pct.top, pos_left: pct.left })
    if (error) return toast.error(error.message.includes('duplicate') ? 'อุปกรณ์นี้อยู่บนโซนนี้แล้ว' : error.message)
    setArmedJig(null); loadFacilityArea()
  }
  const movePoint = async (pointId, pct) => {
    if (!canEdit) return
    setFacPoints(prev => prev.map(p => p.id === pointId ? { ...p, pos_top: pct.top, pos_left: pct.left } : p))
    await supabaseDR.from('pm_facility_points').update({ pos_top: pct.top, pos_left: pct.left }).eq('id', pointId)
  }
  const removePoint = async (pointId) => {
    if (!canEdit) return
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

  const placedJigIds = new Set(facPoints.map(p => p.jig_id))
  const unplacedJigs = Object.entries(jigInfo).filter(([id]) => !placedJigIds.has(id))

  return (
    <div style={S.page}>
      <DowntimeSiren mode="call_mtn" />
      <div style={{ display: 'flex', paddingRight: 52, justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={S.h1}>🗺️ ผังเครื่องจักร (ซ่อมบำรุง)</h1>
          <p style={S.sub}>ดูสถานะ PM บนผังจริง · กรองตามผู้รับผิดชอบ</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
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
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color }} />{m.label}{counts[k] ? ` (${counts[k]})` : ''}
            </span>
          ))}
        </div>
      </div>

      {view === 'facility' && armedJig && (
        <div style={{ fontSize: 12, color: 'var(--accent2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          📍 คลิกบนผังเพื่อวาง <b>{jigInfo[armedJig]?.jig_no || jigInfo[armedJig]?.name}</b> · <span onClick={() => setArmedJig(null)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>ยกเลิก</span>
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
                editable={view === 'facility' && canEdit} armed={!!armedJig}
                height="clamp(360px, calc(100vh - 260px), 1100px)"
                onImageClick={placeJig} onMarkerDragEnd={movePoint} onMarkerRemove={removePoint} />}

          {sel && selInfo && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>⚙️ {selLabel}{selInfo.name && selInfo.name !== selLabel ? ` · ${selInfo.name}` : ''}</div>
                <button onClick={() => setSelId(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
              </div>
              {selChecklists.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีเช็คลิสต์ PM{dept !== 'all' ? ` ของแผนก ${DEPT_LABEL[dept]}` : ''} สำหรับรายการนี้</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selChecklists.map((c, i) => {
                    const m = STATUS_META[c.status] ?? STATUS_META.ok
                    const dd = c.nextDue ? daysUntilDue(c.nextDue) : null
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, borderTop: i ? '1px dashed var(--border)' : 'none', paddingTop: i ? 6 : 0 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{c.eqName ?? selInfo.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#4d9fff', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>{DEPT_ICON[c.dept]} {DEPT_LABEL[c.dept] ?? c.dept}</span>
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
              {canEdit && <button onClick={addArea} style={{ background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 6, padding: '3px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ โซน</button>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
              {areas.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div onClick={() => setAreaId(a.id)} style={{ ...S.rowBtn(areaId === a.id, false), flex: 1 }}>{a.image_path ? '🗺️' : '▫️'} {a.name}</div>
                  {canEdit && <button className="tbtn" onClick={() => deleteArea(a.id)} title="ลบโซน" style={{ background: 'transparent', border: 'none', color: '#e05c4a', cursor: 'pointer', fontSize: 12 }}>✕</button>}
                </div>
              ))}
              {!areas.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีโซน — กด “+ โซน” เพื่อเริ่ม</div>}
            </div>

            {areaId && (
              <>
                {canEdit && (
                  <label style={{ display: 'block', marginBottom: 12 }}>
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={uploadImage} disabled={busy} />
                    <span style={{ display: 'block', textAlign: 'center', background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 8, padding: '8px', fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
                      {busy ? 'อัปโหลด...' : facImage ? '🖼️ เปลี่ยนรูปผังโซน' : '📷 อัปโหลดรูปผังโซน'}
                    </span>
                  </label>
                )}
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>อุปกรณ์ที่ยังไม่วาง ({unplacedJigs.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {unplacedJigs.map(([id, info]) => {
                    const c = colorFor(info.checklists)
                    return (
                      <div key={id} onClick={() => { if (!canEdit) return; facImage ? setArmedJig(id) : toast.error('อัปโหลดรูปผังโซนก่อน') }}
                        title={!canEdit ? 'ไม่มีสิทธิ์แก้ผัง' : facImage ? 'คลิกแล้วไปคลิกบนผังเพื่อวาง' : 'อัปโหลดรูปผังก่อน'}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
                          border: `1px solid ${armedJig === id ? 'var(--accent)' : 'var(--border)'}`, background: armedJig === id ? 'var(--accent-dim)' : 'var(--bg3)' }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{info.jig_no || info.name}</span>
                        {info.jig_no && <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.name}</span>}
                      </div>
                    )
                  })}
                  {!unplacedJigs.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>วางครบแล้ว · อุปกรณ์ facility/utility เพิ่มได้ที่หน้า PM Setup</div>}
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
