import { useState, useEffect, useRef, useMemo, useContext } from 'react'
import { lineNameCompare } from '../utils/lineHierarchy';
import { MoreMark } from '../components/InfoMore';
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useMergeParams } from '../utils/useTabParam'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, supabaseDR } from '../supabaseClient'
import { loadDeptFrames } from '../utils/jigFrames'   // รูปเครื่องแยกตามแผนก (26/11)
import { UserContext } from '../App'
import { lineScope } from '../utils/sectionScope'   // 🔒 แท็บ AM เห็นเฉพาะไลน์ของตัวเอง (11/11)
import { can, isActionSeeded } from '../utils/permissions'
import { positionRank } from '../utils/positions'
// ✍️ B2 (02/11) — สายอนุมัติ AM ตามลำดับชั้น · B3 — ป้าย MO / เหตุผลที่ไม่เปิดใบ
import { amApprovalVerdict, amApprovalText, amApprovalAssumptionText, amApproveAllowed, amNextApprover, amBadgeGate, amOnSiteApproval, amInspectorIdentity, pmConfirmVerdict, pmConfirmText, PM_HEAD_STEP } from '../utils/amApproval'
import { findByBadge, normBadgeCode } from '../utils/badgeCheckin'   // 🪪 B4 — รหัสบัตร → พนักงาน (ตรงเป๊ะ · ซ้ำ = ไม่เดา)
import { moStatusLabel } from '../utils/mtnStepPerm'
import { amWaiverReasonValid, AM_WAIVER_MIN_LEN } from '../lib/pmDailyStatus'
import { toast } from '../components/Toast'
import { getSpcStatus, STATUS_COLOR } from '../lib/spc'
import { calcOf, calcFormula, pmCalcResults } from '../utils/inspectCalc'
import { findChecklist, listChecklistsByDept } from '../lib/pmChecklists'
import { notifyDepartment, createNotification } from '../lib/pmNotify'
import { handleDailyPmSave } from '../lib/pmDailyAlarm'
import { exportInspectionExcel } from '../lib/pmExportExcel'
import { exportInspectionPDF, resolveSignatureDataUrl } from '../lib/pmExportPDF'
import { getDocForm } from '../utils/docForms'
import { fetchCategories, fetchCheckingMethods, categoryColor, indexByCode } from '../lib/pmTaxonomy'
import PointZoom, { PointThumb } from '../components/inspect/PointZoom'
import useImgBox from '../utils/useImgBox'
import CalloutPin from '../components/CalloutPin'
import { loadPmTeams, pmTeamsSync, teamKind, recordPermFor, isAmTeam, splitInspByTeam, inspTeamLabel } from '../utils/pmTeams'
import { carryNgReason, ngReasonCheck, okWhileMoOpen } from '../utils/ngReason'   // 🚩 NG ต้องมีเหตุผล (19/11)
import { loadNgHistory } from '../lib/ngHistory'
import { buildStationIndex } from '../utils/amStations'   // 🧩 สถานี AM (23/11)
import { canWriteLine, writeBlockText } from '../utils/writeScope'   // 🔐 A4 (24/11): อนุมัติใบ AM = ไลน์ในขอบเขตตัวเอง
import { MTN_TEAMS, deptNameOf, teamKeyOf, teamForEquipmentKind, teamsForUser, canWriteTeam, teamBlockText } from '../utils/mtnTeams'
import { checkWriteRows } from '../utils/dbWrite';
import NoticeBar from '../components/NoticeBar';
import EquipSpcModal from '../components/EquipSpcModal'   // 📈 SPC อุปกรณ์ (26/11)
import { tr, dateLocale } from '../utils/i18n';
import { getWorkDate } from '../utils/workDate'
import { amShiftInfo, AM_MO_COLS, loadAmCpLastDone } from '../lib/dailyAmBoard'
import { splitDueCps, AM_FREQ_META } from '../utils/amCheckFreq'   // 🗓️ รอบตรวจรายหัวข้อ AM (26/11)
import { amSlotOf } from '../lib/amMonthly'
import { DEFAULT_POINT_KINDS, pointDueStatus, pointPin, shimStack, deriveShimAction } from '../utils/fixturePoints'
import { recordShimEvent } from '../utils/fixtureShimApi'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import SearchInput from '../components/SearchInput'
import ScanModal from '../components/ScanModal'
import { resolveJig } from '../utils/qrCode'
import LineScopeSelect from '../components/LineScopeSelect'
import { useProductionLinesState } from '../utils/useProductionLines'
import { lineKnownSet, groupEquipRowsByLine } from '../utils/pmEquipList'
import { filterPlanRows } from '../utils/pmPlanFilter'
import useIsMobile from '../utils/useIsMobile'
import { useDraftAutosave, loadDraft, clearDraft } from '../utils/formDraft'   // 📝 ร่างในเครื่อง (มือถือ · 22/10)
import DraftRestoreBar from '../components/DraftRestoreBar'
import { loadEmployeeSigners, signatureOfPerson, resolveEmployeeSigner, inspectorForExport } from '../utils/employeeSignature'
import InspectorCodeField from '../components/InspectorCodeField'   // ✍️ รหัสผู้ตรวจจริง (C1 · 05/11)   // ✍️ ลายเซ็นในฐานพนักงาน (C1 · 03/11)
import { tint } from '../utils/statusTone';   // สี token ต่อ alpha-hex ไม่ได้ ⇒ ย่อยเป็น -dim/-line (UI §6.17)
import { askConfirm } from '../utils/askConfirm';
import { confirmSign } from '../utils/signConfirm';

/* 🔩 จุดชิมของ fixture บนใบตรวจ PM (2026-09-08 · คำสั่ง user "shim record กับการตรวจใช้กลไกเดียวกัน")
   ข้อมูลแยกตาราง (fixture_points/fixture_shim_events) แต่ "รูป + หมุด" ชุดเดียวกับจุดตรวจ PM:
   หมุดม่วงบนรูปเดียวกัน + แถวกรอก "ค่าชิมรวมที่วัดได้" ท้ายใบ · บันทึกผ่าน recordShimEvent ผูก inspection_id
   ไม่บังคับกรอก (จุดชิมมีความถี่ของตัวเอง — กฎเหล็ก 1 ของโมดูล fixture) · ไม่นับใน isFormReady */
const SHIM_PIN_COLOR = 'var(--blue)'
// ชิปข้อที่ยังไม่ตรวจในแถบความคืบหน้า — เกินนี้พับไว้หลังปุ่ม "+N ▾" (แถบติดบน ห้ามกินจอมือถือ)
const CHIP_CAP = 20
// คอลัมน์ jigs ที่หน้านี้ใช้จริง (ลิสต์ · หัวฟอร์ม · resolveJig · ใบซ่อม · Daily PM) — เพิ่มฟิลด์ใหม่ต้องเติมที่นี่
const JIG_COLS = 'id, name, jig_no, machine_no, machine_id, line_name, equipment_type, image_path, process'

const DEPT_COLORS = {
  maintenance: '#fb923c', jig_maintenance: '#34d399', die_maintenance: '#4d9fff',
  production: '#3dd65c', qa: '#9b8de8',
}

function getPublicUrl(path) {
  if (!path) return null
  return supabaseDR.storage.from('jig-images').getPublicUrl(path).data.publicUrl
}
function fmt(v, digits = 3) {
  if (v === null || v === undefined || v === '') return '—'
  return Number(v).toFixed(digits).replace(/\.?0+$/, '')
}
function formatDate(iso) {
  return new Date(iso).toLocaleString(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function computeAvg(v1, v2, v3) {
  if (v1 === '' || v2 === '' || v3 === '' || v1 == null || v2 == null || v3 == null) return null
  const a = Number(v1), b = Number(v2), c = Number(v3)
  if (isNaN(a) || isNaN(b) || isNaN(c)) return null
  return (a + b + c) / 3
}

const S = {
  /* ⚠️ ห้ามใส่ `overflow` ให้ `main`/`body` (2026-09-02 · user ทัก "ยิ่งหัวข้อเยอะ ข้อหลังๆ มองไม่เห็นรูป")
     หน้านี้ถูก embed ใน `PmHub` ซึ่งไม่ได้กำหนดความสูง → `height:100%` ตกเป็น `auto`
     ⇒ `main{overflow:hidden}` + `body{overflowY:auto}` กลายเป็น **scroll container ที่ไม่มีวันเลื่อน**
       (เนื้อหาสูงเท่าไหร่กล่องก็สูงตาม) แต่มันยัง "ขัง" `position:sticky` ของรูปเครื่องไว้ข้างใน
       → เอกสารเลื่อน รูปเลื่อนตามหายไป **sticky ไม่เคยทำงานเลยสักครั้ง**
     ตอนนี้ปล่อยให้ document เป็นตัวเลื่อน → sticky เกาะ viewport จริง
     (flex child ล้นแนวนอนใช้ `minWidth:0` แก้ ไม่ใช่ `overflow:hidden` ซึ่งเป็นตัวขัง sticky)
     🔴 2026-09-08: แก้ตรงนี้แล้ว "ยังหาย" อยู่ดี (วิดีโอ user) — ต้นเหตุชั้นบนกว่า: `<main>` ใน App.jsx
     มี overflowY:auto ขัง sticky ไว้อีกชั้น (ทุกหน้า) → แก้ที่ App.jsx เป็น overflowX:'clip' แล้ว
     ห้ามคิดว่า sticky ในหน้านี้ทำงานเพราะโค้ดหน้านี้อย่างเดียว */
  page: { display: 'flex', minHeight: '100%', background: 'var(--bg)' },
  // จอกว้าง: ลิสต์เครื่องเกาะจอ + เลื่อนในตัวเอง (เดิมยาวตามหน้า เลื่อนเช็คข้อล่างๆ แล้วลิสต์หายไปทั้งแถบ)
  sidebar: { width: 280, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh' },
  sidebarHead: { padding: '16px 16px 10px' },
  deptBar: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 16px 12px' },
  deptBtn: (active, color) => ({
    padding: '5px 10px', borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`,
    background: active ? `${tint(color, 'dim')}` : 'var(--bg3)', color: active ? color : 'var(--muted)',
  }),
  jigList: { flex: 1, overflowY: 'auto', padding: '0 10px 10px' },
  jigItem: (active, color) => ({
    padding: '10px 12px', borderRadius: 8, marginBottom: 6, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border)'}`,
    background: active ? `${tint(color, 'dim')}` : 'var(--card)',
  }),
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  header: { padding: '14px 52px 14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 },
  tabBar: { display: 'flex', gap: 4, padding: 4, borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)' },
  tabBtn: (active) => ({
    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
    background: active ? 'var(--card)' : 'transparent', color: active ? 'var(--text)' : 'var(--muted)',
  }),
  body: { flex: 1, minWidth: 0, padding: 20 },
  cpRow: (status) => ({
    display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${status ? STATUS_COLOR[status].border : 'var(--border)'}`,
    background: status ? STATUS_COLOR[status].bg : 'var(--card)', marginBottom: 8,
  }),
  input: { width: 70, textAlign: 'center', fontFamily: 'monospace' },
  navBtn: (off) => ({ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
    cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.45 : 1,
    border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)' }),
  saveBtn: {
    width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 700,
    background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', cursor: 'pointer', marginTop: 12,
  },
}

// ค่าวัดเครื่องจักร (type 'measure') — อ่านค่าเดียวเทียบเกณฑ์ lsl(ต่ำสุด)/usl(สูงสุด) → pass/fail
// คืน 'pass' | 'fail' | null (ยังไม่กรอก) — comparator derive จากช่องที่ตั้ง (lsl only=≥, usl only=≤, ทั้งคู่=ช่วง)
function measureStatus(val, cp) {
  if (val === '' || val == null) return null
  const v = Number(val); if (isNaN(v)) return null
  if (cp.lsl != null && v < cp.lsl) return 'fail'
  if (cp.usl != null && v > cp.usl) return 'fail'
  return 'pass'
}
function measureStdText(cp) {
  const lo = cp.lsl != null, hi = cp.usl != null
  if (lo && hi) return `${fmt(cp.lsl)}–${fmt(cp.usl)}${cp.unit ? ' ' + cp.unit : ''}`
  if (lo) return `≥ ${fmt(cp.lsl)}${cp.unit ? ' ' + cp.unit : ''}`
  if (hi) return `≤ ${fmt(cp.usl)}${cp.unit ? ' ' + cp.unit : ''}`
  return '—'
}

// สีหมุด = สถานะการตรวจ (dynamic) — เขียวผ่าน / แดง NG / เหลืองเฝ้าระวัง / ยังไม่ตรวจ = สีหมวด
const PIN_STATUS_COLOR = { ok: '#3dd65c', ng: '#e05c4a', warning: '#f59a3f' }
/* 🔴 "ยังไม่ตรวจ" ต้องดูออกจาก "ตรวจแล้ว" ทันที (user 23/09) — เดิมใช้ **สีประเภทจุดตรวจ**
   ซึ่งตั้งเองได้ที่ทะเบียน ⇒ ประเภทที่ตั้งเป็นเขียวจะหน้าตาเหมือนจุดที่ตรวจผ่านแล้วเป๊ะ
   ⇒ ใช้สีกลาง + **วงโปร่งเส้นประ** (ต่างที่รูปทรงด้วย ไม่ใช่แค่สี) · ตรวจแล้ว = วงทึบ เขียว/แดง
   ประเภทจุดตรวจยังอ่านได้จากแถวรายการ/tooltip เหมือนเดิม */
const PIN_TODO_COLOR = '#9aa8b4'
function cpCheckStatus(cp, r) {
  if (!r) return null
  if (cp.type === 'variable') {
    if (r.v1 === '' || r.v2 === '' || r.v3 === '' || r.v1 == null || r.v2 == null || r.v3 == null) return null
    const s = getSpcStatus(computeAvg(r.v1, r.v2, r.v3), cp)
    return s === 'fail' ? 'ng' : s === 'warning' ? 'warning' : 'ok'
  }
  if (cp.type === 'measure') {
    const s = measureStatus(r.mval, cp)
    return s === 'fail' ? 'ng' : s === 'pass' ? 'ok' : null
  }
  return r.attr === 'ok' ? 'ok' : r.attr === 'ng' ? 'ng' : null
}

// รูป JIG (รองรับ 360° spin หลายเฟรม) + pin จุดตรวจที่ sync กับ checklist:
//   • ลากซ้าย/ขวา (หรือกดจุดใต้ภาพ) เพื่อหมุนดูรอบเครื่อง — pin โชว์เฉพาะเฟรมที่วางไว้ (image_id)
//   • สีหมุด = สถานะตรวจจริง (OK/NG) · คลิกหมุด → เลื่อน+ไฮไลต์แถวเช็คของจุดนั้น (activeCpId)
// pin สเกล/clamp อิง "กล่องรูปจริง" หัก letterbox (docs/UI-CONVENTIONS.md §5.1)
function JigSpinCheck({ frames, checkpoints, results, activeCpId, onPinClick, shimPins = [], onShimPinClick, maxH = 300, compact = false }) {
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoomCp, setZoomCp] = useState(null)   // จุดที่กำลังเปิดรูปซูม (มี image_path)
  // เปลี่ยนอุปกรณ์ = รีเซ็ตทุกอย่าง รวมรูปซูมที่ค้างอยู่ (ไม่งั้นค้างรูปของเครื่องก่อนหน้า)
  useEffect(() => { setFrameIdx(0); setPlaying(false); setZoomCp(null) }, [frames])
  const boxRef = useRef(null)
  const drag = useRef(null) // { startX, startIdx, moved }
  const spin = frames.length >= 2
  const cur = frames[frameIdx] || frames[0] || null

  // auto-play หมุนวนอัตโนมัติ (Task A) — หยุดเมื่อผู้ใช้ลากเอง / เลือกจุด
  useEffect(() => {
    if (!playing || !spin) return
    const t = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), 650)
    return () => clearInterval(t)
  }, [playing, spin, frames.length])

  /* 🔍 รูปของ "จุดตรวจ" ขึ้นจอใหญ่  (2026-11-10 · feedback หน้างาน)
     เดิมรูปเล็กในช่องรายการเป็นทางเดียวที่จะเห็นรูปของจุดนั้น (ต้องกดเปิด overlay)
     และรูปใหญ่ **ค้างอยู่ที่เฟรมแรกของเครื่องเสมอ** เมื่อจุดนั้นยังไม่ได้ปักหมุด
     (เอฟเฟกต์ด้านล่าง return ทิ้งเมื่อ `x_pos == null`) ⇒ เลือกข้อไหนรูปก็ไม่เปลี่ยน
     🔴 **ห้ามวาดหมุดทับรูปของจุดตรวจ** — พิกัดหมุดเป็น % ของ "รูปเครื่อง" คนละรูปกัน
        (กฎ §5.1 UI-CONVENTIONS: balloon ต้องผูกกับรูปที่มันถูกวาง `image_id`) */
  const activeCp = checkpoints.find(c => c.id === activeCpId) || null
  const cpPhotoUrl = activeCp?.image_path ? getPublicUrl(activeCp.image_path) : null
  const cpPinned = activeCp?.x_pos != null && activeCp?.y_pos != null
  const [showCpPhoto, setShowCpPhoto] = useState(false)
  /* ปักหมุดแล้ว = โชว์รูปเครื่องก่อน (ได้เห็นว่าจุดอยู่ตรงไหน) · ยังไม่ปัก = โชว์รูปของจุดเลย
     (ไม่งั้นรูปใหญ่ไม่มีอะไรเกี่ยวกับข้อที่กำลังตรวจ) · ไม่มีรูปของจุด = รูปเครื่องเหมือนเดิม */
  useEffect(() => { setShowCpPhoto(!!cpPhotoUrl && !cpPinned) }, [activeCpId, cpPhotoUrl, cpPinned])
  const onCpPhoto = !!(showCpPhoto && cpPhotoUrl)
  const shownUrl = onCpPhoto ? cpPhotoUrl : cur?.url

  const { imgRef, imgBox, recalc } = useImgBox([shownUrl])
  useEffect(() => { frames.forEach(f => { if (f.url) { const im = new Image(); im.src = f.url } }) }, [frames])

  const firstId0 = frames[0]?.id
  // เลือกจุดจาก checklist → ถ้าเป็น spin ให้หมุนไปเฟรมที่จุดนั้นถูกวางไว้อัตโนมัติ
  useEffect(() => {
    if (!activeCpId) return
    const c = checkpoints.find(x => x.id === activeCpId)
    if (!c || c.x_pos == null) return
    const idx = frames.findIndex(f => f.id === (c.image_id ?? firstId0))
    if (idx >= 0) setFrameIdx(idx)
  }, [activeCpId]) // eslint-disable-line react-hooks/exhaustive-deps

  // สูตร balloon ต้องเท่ากับ PMSetup/SpinAnnotator เป๊ะ (docs §5.1 — WYSIWYG จอวางกับจอตรวจ)
  const PK = Math.round(Math.max(20, Math.min(36, (imgBox?.rw || 500) * 0.04)))
  const pkFont = Math.max(11, Math.round(PK * 0.42))
  const padX = imgBox ? (PK * 0.7 / imgBox.rw) * 100 : 0
  const padTop = imgBox ? ((PK + 4) / imgBox.rh) * 100 : 0
  const clampPct = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const cpIndex = {}; checkpoints.forEach((c, i) => { cpIndex[c.id] = i })
  const firstId = frames[0]?.id
  // pin ของเฟรมปัจจุบัน (image_id ว่าง = ผูกเฟรมแรก ตาม backfill)
  const framePins = checkpoints.filter(c => c.x_pos != null && c.y_pos != null && ((c.image_id ?? firstId) === cur?.id))
  // หมุดจุดชิม (ม่วง) ของเฟรมนี้ — ตำแหน่งมาจาก pointPin() (ของตัวเอง หรือยืมจากจุดตรวจ PM ที่ผูกไว้)
  const frameShimPins = shimPins.filter(sp => (sp.pin.imageId ?? firstId) === cur?.id)

  const pointerDown = (e) => {
    if (!spin || onCpPhoto) return      // กำลังดูรูปของจุดตรวจ — ลากแล้วหมุนเฟรมที่มองไม่เห็นอยู่ = งง
    setPlaying(false) // ผู้ใช้ลากเอง → หยุด auto-play
    drag.current = { startX: e.clientX, startIdx: frameIdx, moved: false }
    const move = (ev) => {
      if (!drag.current) return
      const dx = ev.clientX - drag.current.startX
      if (Math.abs(dx) > 3) drag.current.moved = true
      const w = boxRef.current?.clientWidth || 300
      const step = Math.round((dx / w) * frames.length)
      let idx = (drag.current.startIdx - step) % frames.length
      if (idx < 0) idx += frames.length
      setFrameIdx(idx)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setTimeout(() => { drag.current = null }, 0) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  return (
    <div style={{ marginBottom: compact ? 0 : 16 }}>
      {/* container หุ้มรูปพอดี (fit-content) กึ่งกลาง — รูปแนวตั้ง (ถ่ายจากมือถือ) ไม่มีแถบเทาข้างเสียพื้นที่
         รูปสูงได้ถึง min(maxH, 76vh) เพื่อใช้พื้นที่แนวตั้งเต็ม โดยเฉพาะมือถือ (2026-07-24)
         ⚠️ `compact` = โหมดแถบติดบนจอแคบ — รูปเตี้ยลงและตัดบรรทัดอธิบายออก เพื่อไม่ให้กินจอ
            เกินครึ่ง (ที่เหลือต้องเป็นของรายการตรวจ) · คำอธิบายเดิมยังอยู่ครบในโหมดปกติ */}
      <div ref={boxRef} onPointerDown={pointerDown}
        style={{ position: 'relative', userSelect: 'none', touchAction: 'none', borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--border)', cursor: spin ? 'grab' : 'default', width: 'fit-content', maxWidth: '100%', margin: '0 auto', background: 'var(--bg2-surf)' }}>
        <img ref={imgRef} src={shownUrl} alt="" draggable={false} onLoad={recalc} style={{ display: 'block', maxWidth: '100%', maxHeight: `min(${maxH}px, 76vh)`, objectFit: 'contain', background: 'var(--bg2)' }} />
        {/* ป้ายบอกว่ากำลังดูรูปอะไรอยู่ + ทางกลับ — ไม่งั้นคนแยกไม่ออกว่ารูปนี้ของเครื่องหรือของจุด */}
        {onCpPhoto && (
          <div style={{ position: 'absolute', left: 8, top: 8, display: 'flex', gap: 6, alignItems: 'center', zIndex: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999,
                           background: 'var(--accent)', color: 'var(--accent-ink)' }}>
              🔍 {tr("รูปของข้อ")} {(cpIndex[activeCp.id] ?? 0) + 1}
            </span>
            {frames.length > 0 && (
              <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => setShowCpPhoto(false)}
                style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                         border: '1px solid var(--border2)', background: 'var(--card)', color: 'var(--text2)' }}>
                {tr('ดูรูปเครื่อง')}
              </button>
            )}
          </div>
        )}
        {!onCpPhoto && cpPhotoUrl && (
          <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => setShowCpPhoto(true)}
            style={{ position: 'absolute', left: 8, top: 8, zIndex: 3, fontSize: 11, fontWeight: 700, padding: '3px 9px',
                     borderRadius: 999, cursor: 'pointer', border: '1px solid var(--accent)',
                     background: 'var(--card)', color: 'var(--accent)' }}>
            {tr('🔍 ดูรูปของข้อ')} {(cpIndex[activeCp.id] ?? 0) + 1}
          </button>
        )}
        {/* layer = กล่องรูปจริง (หัก letterbox) — pin ใช้ % ของ layer นี้
            🔴 ตอนโชว์รูปของจุดตรวจ ห้ามวาดหมุด (พิกัดเป็นของรูปเครื่อง คนละรูป) */}
        {imgBox && !onCpPhoto && (
          <div style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
            {framePins.map(c => {
              const st = cpCheckStatus(c, results[c.id])
              const col = st ? PIN_STATUS_COLOR[st] : PIN_TODO_COLOR
              const active = c.id === activeCpId
              return (
                <CalloutPin key={c.id} xPct={c.x_pos * 100} yPct={c.y_pos * 100} layerW={imgBox.rw} layerH={imgBox.rh} size={PK}
                  offX={c.label_dx} offY={c.label_dy}
                  label={cpIndex[c.id] + 1} color={col} selected={active} hollow={!st}
                  badge={c.image_path ? '🔍' : null}
                  title={`${cpIndex[c.id] + 1}. ${c.name} — ${st ? st.toUpperCase() : tr('ยังไม่ตรวจ')}${c.image_path ? tr(' · แตะเพื่อดูรูปซูมจุดนี้') : ''}`}
                  onClick={e => {
                    e.stopPropagation()
                    onPinClick?.(c.id)
                    // 🔍 มีรูปเจาะจุด → เปิดซูมทันที (ตอบ feedback: รูปมุมแคบต้องรู้ว่าอยู่ตรงไหนของเครื่อง
                    //    → ภาพรวมเป็นแผนที่ · แตะหมุด = ซูมเข้าไปดูจุดนั้นชัดๆ)
                    if (c.image_path) setZoomCp(c)
                  }} />
              )
            })}
            {frameShimPins.map(sp => (
              <CalloutPin key={`shim-${sp.point.id}`} xPct={sp.pin.x * 100} yPct={sp.pin.y * 100} layerW={imgBox.rw} layerH={imgBox.rh} size={PK}
                label={sp.point.point_no} color={SHIM_PIN_COLOR} selected={false} hollow={!sp.done}
                title={`${tr("จุดชิม")} ${sp.point.point_no}${sp.point.name ? ` · ${sp.point.name}` : ''} — ${sp.done ? tr('กรอกค่าแล้ว') : tr('ยังไม่วัด')}${sp.point.current_shim_mm != null ? ` · ${tr("ชิมรวม")} ${sp.point.current_shim_mm} mm` : ''}`}
                onClick={e => { e.stopPropagation(); onShimPinClick?.(sp.point.id) }} />
            ))}
          </div>
        )}
      </div>
      {/* 🔴 แถบคุมรูปต้องอยู่ **ใต้รูป ไม่ทับรูป** (user 23/09 "ไม่บังรูปได้มั้ย")
          เดิมวางทับบนรูป 3 จุด (▶ หมุนเอง · 3/7 · ป้าย "ลากซ้าย/ขวา") — บนมือถือรูปเล็กอยู่แล้ว
          ป้ายพวกนี้กินพื้นที่รูปไปเกือบครึ่ง แล้วบังจุดที่ต้องตรวจพอดี (จุดตรวจอยู่กลางรูปบ่อย) */}
      {spin && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginTop: compact ? 6 : 8 }}>
          <button onClick={e => { e.stopPropagation(); setShowCpPhoto(false); setPlaying(p => !p) }} title={playing ? tr('หยุดหมุน') : tr('หมุนอัตโนมัติ')}
            style={{ background: 'var(--bg3-surf)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)', padding: '3px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {playing ? tr('หยุด') : tr('หมุนเอง')}
          </button>
          <div style={{ display: 'flex', gap: 5 }}>
            {frames.map((f, i) => (
              <button key={f.id} onClick={() => { setShowCpPhoto(false); setFrameIdx(i) }} title={`${tr("เฟรม")} ${i + 1}`}
                style={{ width: 10, height: 10, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0, background: i === frameIdx ? 'var(--accent)' : 'var(--border2)' }} />
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {onCpPhoto
              ? tr("กำลังดูรูปของข้อที่เลือก — กดจุดด้านบนเพื่อกลับไปรูปเครื่อง")
              : `${frameIdx + 1}/${frames.length} · ${tr("ลากซ้าย-ขวาบนรูปเพื่อหมุน")}`}
          </span>
        </div>
      )}
      {/* 🔑 คำอธิบายสัญลักษณ์ — หมุดต่างกันที่ "ทรง + สี" ต้องบอกบนจอ ไม่งั้นคนเดาเอาเอง */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
        {[{ c: PIN_TODO_COLOR, hollow: true, t: 'ยังไม่ตรวจ' },
          { c: PIN_STATUS_COLOR.ok, hollow: false, t: 'ตรวจแล้ว ปกติ' },
          { c: PIN_STATUS_COLOR.ng, hollow: false, t: 'ตรวจแล้ว ผิดปกติ' }].map(x => (
          <span key={x.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 13, height: 13, borderRadius: '50%',
              background: x.hollow ? 'rgba(12,18,15,0.82)' : x.c,
              border: x.hollow ? `2px dashed ${x.c}` : '2px solid #fff' }} />
            {x.t}
          </span>
        ))}
      </div>
      {/* บอกให้รู้ว่าหมุดที่มี 🔍 กดดูรูปซูมได้ — ไม่งั้นไม่มีใครรู้ว่ากดได้ */}
      {!compact && framePins.some(c => c.image_path) && (
        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 6 }}>
          {tr("หมุดที่มีสัญลักษณ์แว่นขยาย = แตะเพื่อดูรูปซูมของจุดนั้น")}
        </div>
      )}
      {zoomCp && <CpZoom cp={zoomCp} idx={cpIndex[zoomCp.id]} onClose={() => setZoomCp(null)} />}
    </div>
  )
}

/* 🔍 รูปซูม/รูปย่อของจุดตรวจ = ของกลาง `components/inspect/PointZoom` (ใช้ร่วมกับจอตรวจ QA · 15/10) */
function CpZoom({ cp, idx, onClose }) {
  return <PointZoom url={getPublicUrl(cp.image_path)} label={(idx ?? 0) + 1} color={categoryColor(cp.category)}
    name={cp.name} description={cp.description} onClose={onClose} />
}
function CpImage({ cp }) {
  return <PointThumb url={cp.image_path ? getPublicUrl(cp.image_path) : null} label={null} color={categoryColor(cp.category)}
    name={cp.name} description={cp.description} />
}

// ─── Variable Row ───────────────────────────────────────────────────────────
function VariableRow({ cp, idx, r, onChange, methodIndex, calcText, onSpc = null }) {
  const avg = computeAvg(r.v1, r.v2, r.v3)
  const status = getSpcStatus(avg, cp)
  const c = status ? STATUS_COLOR[status] : null
  const method = methodIndex?.[cp.checking_method]
  return (
    <div style={S.cpRow(status)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* 🔢 เลขข้อต้องขึ้นเสมอ (2026-11-10) — เดิมผูกกับ `x_pos` ⇒ เครื่องที่ยังไม่ปักหมุด
            ทุกแถวไม่มีเลขเลย ทั้งที่ชิป "ยังไม่ตรวจ" ด้านบน · สูตรคำนวณ ("ข้อ N") · ปุ่มข้อก่อน/ถัดไป
            อ้างเลขนี้ทั้งหมด ⇒ จับคู่ไม่ได้ว่าแถวไหนคือข้อไหน (user: "เห็นปนกันไปหมด")
            หมุดบนรูปเป็นคนละเรื่อง — ไม่ปักก็ยังเป็นข้อที่ N ของใบอยู่ดี */}
        <span style={{ width: 18, height: 18, borderRadius: '50%', background: categoryColor(cp.category), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>
        {method && <span title={tr(method.label)} style={{ fontSize: 13, flexShrink: 0 }}>{method.icon}</span>}
        <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}{cp.axis && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--r-xs)', padding: '0 4px' }}>{cp.axis}</span>}</p>
        <CpImage cp={cp} />
        {onSpc && cp.spc_enabled !== false && <button type="button" onClick={onSpc} title={tr('ดูกราฟ SPC ของข้อนี้')} aria-label={tr('ดูกราฟ SPC ของข้อนี้')} style={{ fontSize: 13, padding: '1px 6px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}>📈</button>}
        {c && <span style={{ fontSize: 11, fontWeight: 700, color: c.text }}>{status === 'pass' ? '●' : status === 'warning' ? '⚠' : '✕'}</span>}
      </div>
      {calcText && (
        <div style={{ fontSize: 11.5, color: 'var(--blue)', fontWeight: 700 }}>{tr("ค่า")} = {calcText} {tr('· ระบบคิดให้จากค่าที่วัด ไม่ต้องกรอก')}</div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {['v1', 'v2', 'v3'].map((k, i) => (
          <div key={k}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginBottom: 2 }}>{['①', '②', '③'][i]}</div>
            {/* จุดคำนวณ = อ่านอย่างเดียว (ค่ามาจากจุด A − B) */}
            <input type="number" value={r[k]} readOnly={!!calcText} tabIndex={calcText ? -1 : undefined}
              onChange={e => { if (!calcText) onChange({ ...r, [k]: e.target.value }) }} placeholder={calcText ? '…' : '—'}
              style={calcText ? { ...S.input, borderStyle: 'dashed', color: 'var(--text2)' } : S.input} />
          </div>
        ))}
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginBottom: 2 }}>Avg</div>
          <div style={{ ...S.input, padding: '6px 0', borderRadius: 'var(--r-md)', border: `1px solid ${c?.border ?? 'var(--border)'}`, color: c?.text ?? 'var(--muted)', fontWeight: 700 }}>{avg != null ? fmt(avg) : '—'}</div>
        </div>
        {cp.unit && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cp.unit}</span>}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
          {cp.nominal != null && <>N:{fmt(cp.nominal)} </>}
          {cp.lsl != null && <span style={{ color: 'var(--red)' }}>L:{fmt(cp.lsl)} </span>}
          {cp.usl != null && <span style={{ color: 'var(--red)' }}>U:{fmt(cp.usl)}</span>}
        </span>
      </div>
    </div>
  )
}

// ─── Attribute / Note Row ────────────────────────────────────────────────────
function AttrRow({ cp, idx, value, note, onChangeAttr, onChangeNote, methodIndex,
  /* 🚩 19/11 — NG ต้องมีเหตุผล · `carry` = ของเก่าที่ยกมาได้ (null = ไม่มี) */
  reason = '', onChangeReason, carry = null, accepted = false, onAccept, okWarn = null }) {
  const method = methodIndex?.[cp.checking_method]
  // 📱 มือถือ: แตะปุ่มเดิมซ้ำ (ถุงมือแตะเบิ้ล) = ล้างคำตอบเงียบๆ ⇒ ถามก่อน · จอคอมเหมือนเดิม (2026-10-20)
  const isMobile = useIsMobile()
  const pickAttr = async (v) => {
    if (v === value) { if (isMobile && !await askConfirm(`${tr("ล้างคำตอบ")} ${v.toUpperCase()} ${tr("ของข้อนี้")}?`)) return; onChangeAttr(''); return }
    onChangeAttr(v)
  }
  return (
    <div style={S.cpRow(null)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* 🔢 เลขข้อต้องขึ้นเสมอ (2026-11-10) — เดิมผูกกับ `x_pos` ⇒ เครื่องที่ยังไม่ปักหมุด
            ทุกแถวไม่มีเลขเลย ทั้งที่ชิป "ยังไม่ตรวจ" ด้านบน · สูตรคำนวณ ("ข้อ N") · ปุ่มข้อก่อน/ถัดไป
            อ้างเลขนี้ทั้งหมด ⇒ จับคู่ไม่ได้ว่าแถวไหนคือข้อไหน (user: "เห็นปนกันไปหมด")
            หมุดบนรูปเป็นคนละเรื่อง — ไม่ปักก็ยังเป็นข้อที่ N ของใบอยู่ดี */}
        <span style={{ width: 18, height: 18, borderRadius: '50%', background: categoryColor(cp.category), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>
        {method && <span title={tr(method.label)} style={{ fontSize: 13, flexShrink: 0 }}>{method.icon}</span>}
        <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}</p>
        <CpImage cp={cp} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['ok', 'ng'].map(v => (
            <button key={v} onClick={async () => await pickAttr(v)} style={{
              padding: '3px 10px', borderRadius: 'var(--r-md)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              // 📱 มือถือ: ปุ่ม OK/NG = คำตอบหลักของใบตรวจ → ใหญ่พอใส่ถุงมือกด (เดิมสูง ~22px · 22/10) · จอคอมเท่าเดิม
              ...(isMobile ? { minHeight: 44, minWidth: 58, fontSize: 14, borderRadius: 'var(--r-md)' } : null),
              border: `1px solid ${value === v ? (v === 'ok' ? 'var(--accent)' : '#e05c4a') : 'var(--border)'}`,
              background: value === v ? (v === 'ok' ? 'var(--accent)' : '#e05c4a') : 'var(--bg3)',
              color: value === v ? '#fff' : 'var(--muted)',
            }}>{v.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {cp.description && (
        <p style={{ fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'pre-line', margin: '0 0 0 24px', lineHeight: 1.5 }}>
          {cp.description}
        </p>
      )}
      {cp.type === 'note' && <input value={note} onChange={e => onChangeNote(e.target.value)} placeholder={tr('หมายเหตุ (ถ้ามี)...')} />}
      {/* 🚩 ติ๊ก NG ต้องมีเหตุผล (19/11 · คำสั่ง user "เกิดการกดผิดและพนักงานไม่รู้ตัว")
          วัดจริง 90 วัน: NG 43 จุด มีเหตุผลแค่ 8 ⇒ 81% ไม่มีเหตุผลเลย
          🔴 ของที่ยกมา **ต้องกดยืนยัน** ห้ามเติมเงียบ — เติมเงียบ = คนกดผิดได้เหตุผลติดมาเอง
             ดูเหมือนตั้งใจ ซึ่งแย่กว่าไม่มีเหตุผล (ตัดสินที่ `utils/ngReason.js`) */}
      {value === 'ng' && (
        <div style={{ margin: '4px 0 0 24px' }}>
          {carry && !accepted && !reason.trim() && (
            <div style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 3, lineHeight: 1.6 }}>
              ↩️ {tr(carry.why)}
              <button type="button" onClick={onAccept}
                style={{ marginLeft: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                         borderRadius: 'var(--r-xs)', border: '1px solid var(--amber)', background: 'var(--amber-dim)', color: 'var(--amber)' }}>
                {tr('ใช้เหตุผลเดิม')}: {carry.text}
              </button>
            </div>
          )}
          <input value={reason} onChange={e => onChangeReason(e.target.value)}
            placeholder={tr('เหตุผลที่ NG (บังคับ) — เจออะไร/ผิดปกติยังไง')}
            style={{ width: '100%', borderColor: (reason.trim() || accepted) ? undefined : 'var(--amber)' }} />
        </div>
      )}
      {/* 🔴 ติ๊ก OK ทั้งที่ใบซ่อมยังไม่เสร็จ = **เตือน ไม่บล็อก** (ช่างอาจเพิ่งแก้เสร็จแต่ยังไม่ปิดใบ) */}
      {value === 'ok' && okWarn && (
        <div data-warn="1" style={{ margin: '4px 0 0 24px', fontSize: 11.5, color: 'var(--amber)', lineHeight: 1.6 }}>⚠ {tr(okWarn)}</div>
      )}
    </div>
  )
}

// ─── Measure Row (ค่าวัดเครื่องจักร — อ่านค่าเดียว auto OK/NG) ─────────────────
function MeasureRow({ cp, idx, r, onChange, methodIndex, onSpc = null }) {
  const status = measureStatus(r.mval, cp) // 'pass'|'fail'|null
  const c = status ? STATUS_COLOR[status] : null
  const method = methodIndex?.[cp.checking_method]
  return (
    <div style={S.cpRow(status)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* 🔢 เลขข้อต้องขึ้นเสมอ (2026-11-10) — เดิมผูกกับ `x_pos` ⇒ เครื่องที่ยังไม่ปักหมุด
            ทุกแถวไม่มีเลขเลย ทั้งที่ชิป "ยังไม่ตรวจ" ด้านบน · สูตรคำนวณ ("ข้อ N") · ปุ่มข้อก่อน/ถัดไป
            อ้างเลขนี้ทั้งหมด ⇒ จับคู่ไม่ได้ว่าแถวไหนคือข้อไหน (user: "เห็นปนกันไปหมด")
            หมุดบนรูปเป็นคนละเรื่อง — ไม่ปักก็ยังเป็นข้อที่ N ของใบอยู่ดี */}
        <span style={{ width: 18, height: 18, borderRadius: '50%', background: categoryColor(cp.category), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>
        {method && <span title={tr(method.label)} style={{ fontSize: 13, flexShrink: 0 }}>{method.icon}</span>}
        <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{cp.name}</p>
        <CpImage cp={cp} />
        {onSpc && cp.spc_enabled !== false && <button type="button" onClick={onSpc} title={tr('ดูกราฟ SPC ของข้อนี้')} aria-label={tr('ดูกราฟ SPC ของข้อนี้')} style={{ fontSize: 13, padding: '1px 6px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}>📈</button>}
        {c && <span style={{ fontSize: 11, fontWeight: 700, color: c.text }}>{status === 'pass' ? '● OK' : '✕ NG'}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="number" value={r.mval ?? ''} onChange={e => onChange({ ...r, mval: e.target.value })} placeholder={tr('อ่านค่า')}
          style={{ width: 110, textAlign: 'center', fontFamily: 'monospace', border: `1px solid ${c?.border ?? 'var(--border)'}` }} />
        {cp.unit && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cp.unit}</span>}
        <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto' }}>{tr('เกณฑ์:')} <b style={{ color: 'var(--text2)' }}>{measureStdText(cp)}</b></span>
      </div>
    </div>
  )
}

/* ─── NG Recheck Panel ────────────────────────────────────────────────────────
   🔐 แผงนี้เขียน `inspection_results` (action ที่แก้ไข + ค่าวัดใหม่ + final_status)
      = ผลตรวจของ **ทีมนั้น** ⇒ ต้องผ่านด่านเดียวกับการลงผลตรวจ (`canRecord` จากหน้าแม่
      = สิทธิ์ตามชนิดงาน AM/PM **และ** แกนทีม `canWriteTeam`) — เดิมไม่มีด่านเลย
      ใครเปิดประวัติของทีมอื่นได้ ก็เขียน action ทับได้ (audit ข้อ 5 · 19/10)
   🔴 ซ่อนฟอร์มได้ ห้ามซ่อนความจริงว่า "ใบนี้ NG และยังไม่มี action" (UI §6.9) */
function NgRecheckPanel({ result, cp, onSaved, canRecord = false, deptWrite = null }) {
  const [action, setAction] = useState(result.action_text ?? '')
  const [rv1, setRv1] = useState(result.recheck_value_1 ?? '')
  const [rv2, setRv2] = useState(result.recheck_value_2 ?? '')
  const [rv3, setRv3] = useState(result.recheck_value_3 ?? '')
  const [saving, setSaving] = useState(false)
  const done = result.recheck_at != null
  const recheckAvg = computeAvg(String(rv1), String(rv2), String(rv3))
  const finalStatus = recheckAvg != null ? (getSpcStatus(recheckAvg, cp) ?? 'pass') : null

  const submit = async () => {
    // ด่านชั้น 2 — ปุ่มถูกซ่อนอยู่แล้ว แต่โมดัลอาจเปิดค้างไว้ตอนสลับทีม/สิทธิ์เปลี่ยน (fail-closed)
    if (!canRecord) {
      return toast.info(deptWrite && !deptWrite.ok
        ? teamBlockText(deptWrite, 'ผลตรวจของทีมนี้')
        : 'ไม่มีสิทธิ์บันทึก action / ค่าวัดใหม่ของผลตรวจนี้')
    }
    setSaving(true)
    try {
      const patch = { action_text: action.trim() || null, recheck_at: new Date().toISOString() }
      if (cp.type === 'variable' && rv1 !== '' && rv2 !== '' && rv3 !== '') {
        patch.recheck_value_1 = Number(rv1); patch.recheck_value_2 = Number(rv2); patch.recheck_value_3 = Number(rv3)
        patch.recheck_avg = recheckAvg; patch.final_status = finalStatus
      }
      // นับแถวที่เขียนจริง (กฎเขียน DB ข้อ 2) — เขียน 0 แถวแล้วขึ้นสำเร็จ = action หายทั้งที่คนกรอกแล้ว
      const ok = checkWriteRows(await supabaseDR.from('inspection_results').update(patch).eq('id', result.id).select('id'), 'บันทึก action / ค่าวัดใหม่')
      if (!ok) return
      onSaved()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  if (done) {
    return (
      <div style={{ marginTop: 6, borderRadius: 'var(--r-md)', background: 'var(--bg3-surf)', border: '1px solid var(--border)', padding: '8px 12px' }}>
        <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>Action taken</p>
        {result.action_text && <p style={{ fontSize: 12, color: 'var(--text)', margin: '2px 0' }}>{result.action_text}</p>}
        {cp.type === 'variable' && result.recheck_avg != null && (
          <p style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'monospace', margin: 0 }}>
            Re-check: {fmt(result.recheck_value_1)} / {fmt(result.recheck_value_2)} / {fmt(result.recheck_value_3)} → Avg: <strong>{fmt(result.recheck_avg)}</strong>{' '}
            <span style={{ color: result.final_status === 'pass' ? 'var(--accent)' : '#e05c4a', fontWeight: 700 }}>{result.final_status?.toUpperCase()}</span>
          </p>
        )}
      </div>
    )
  }

  if (!canRecord) {
    return (
      <div style={{ marginTop: 6, borderRadius: 'var(--r-md)', background: 'rgba(224,92,74,0.06)', border: '1px solid rgba(224,92,74,0.25)', padding: '8px 12px' }}>
        <p style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>{tr('NG — ยังไม่มี action')}</p>
        <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '2px 0 0', lineHeight: 1.45 }}>
          {deptWrite && !deptWrite.ok
            ? teamBlockText(deptWrite, 'ผลตรวจของทีมนี้')
            : tr("บันทึก action / ค่าวัดใหม่ได้เฉพาะผู้มีสิทธิ์ลงผลตรวจของทีมนี้")}
        </p>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 6, borderRadius: 'var(--r-md)', background: 'rgba(224,92,74,0.06)', border: '1px solid rgba(224,92,74,0.25)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>{tr('NG — ต้องการ action')}</p>
      <textarea value={action} onChange={e => setAction(e.target.value)} rows={2} placeholder={tr('อธิบายการแก้ไข...')} />
      {cp.type === 'variable' && (
        <div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 4px' }}>{tr('วัดใหม่ 3 ครั้ง')}</p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[[rv1, setRv1, '①'], [rv2, setRv2, '②'], [rv3, setRv3, '③']].map(([v, set, label], i) => (
              <div key={i}><div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{label}</div>
                <input type="number" value={v} onChange={e => set(e.target.value)} placeholder="—" style={S.input} /></div>
            ))}
            <div><div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Avg</div>
              <div style={{ ...S.input, padding: '6px 0', color: finalStatus === 'pass' ? 'var(--accent)' : '#e05c4a', fontWeight: 700 }}>{recheckAvg != null ? fmt(recheckAvg) : '—'}</div></div>
          </div>
        </div>
      )}
      <button onClick={submit} disabled={saving || !action.trim()} style={{ padding: '6px 0', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 700, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', cursor: 'pointer', opacity: saving || !action.trim() ? 0.5 : 1 }}>
        {saving ? tr('กำลังบันทึก...') : tr('บันทึก Action')}
      </button>
    </div>
  )
}

// ─── History Detail Modal ─────────────────────────────────────────────────────
/* ═══ ของกลางของการบันทึกใบตรวจ (23/11 · ยกออกจาก handleSave ให้ "ใบรวมสถานี AM" ใช้สูตรเดียวกัน) ═══
   🔴 ห้ามแตกสูตรชุดที่ 2 ในใบสถานี — ใบเดี่ยวกับใบรวมต้องตัดสิน/เขียนแถวเหมือนกันเป๊ะ */
/** ข้อนี้กรอกครบหรือยัง (เกณฑ์เดียวกับปุ่มบันทึก + แถบความคืบหน้า) */
/** ตัวอักษรบนปุ่มบันทึกสีเหลือง (ยังไม่ครบ) — ใช้ร่วมใบเดี่ยว/ใบสถานี */
const SAVE_WARN_INK = '#1a1a1a'
function cpFilledOf(cp, r) {
  if (cp.type === 'variable') return r?.v1 !== '' && r?.v2 !== '' && r?.v3 !== '' && r?.v1 != null
  if (cp.type === 'measure') return r?.mval !== '' && r?.mval != null
  return !!r?.attr
}
/** ผลรวมของใบ: 'fail' (มี NG) · 'pending' (ไม่ครบ) · 'pass' */
function overallOf(checkpoints, results) {
  let hasFail = false, hasEmpty = false
  for (const cp of checkpoints) {
    const r = results[cp.id]
    if (!r) { hasEmpty = true; continue }
    if (cp.type === 'variable') {
      if (r.v1 === '' || r.v2 === '' || r.v3 === '') { hasEmpty = true; continue }
      if (getSpcStatus(computeAvg(r.v1, r.v2, r.v3), cp) === 'fail') hasFail = true
    } else if (cp.type === 'measure') {
      const st = measureStatus(r.mval, cp)
      if (st == null) { hasEmpty = true; continue }
      if (st === 'fail') hasFail = true
    } else {
      if (!r.attr) { hasEmpty = true; continue }
      if (r.attr === 'ng') hasFail = true
    }
  }
  if (hasFail) return 'fail'
  if (hasEmpty) return 'pending'
  return 'pass'
}
/** แถว inspection_results ของใบ · carryTextOf(cpId) = เหตุผลเดิมที่ยกมา (กดยืนยันแล้ว) */
function buildResultRows(inspectionId, checkpoints, results, carryTextOf = () => '') {
  return checkpoints.map(cp => {
    const r = results[cp.id] ?? {}
    if (cp.type === 'variable') {
      const v1 = r.v1 !== '' ? Number(r.v1) : null
      const v2 = r.v2 !== '' ? Number(r.v2) : null
      const v3 = r.v3 !== '' ? Number(r.v3) : null
      const avg = computeAvg(r.v1, r.v2, r.v3)
      return { inspection_id: inspectionId, checkpoint_id: cp.id, value_1: v1, value_2: v2, value_3: v3, avg_value: avg, value_numeric: avg, status: getSpcStatus(avg, cp) ?? (avg != null ? 'pass' : null) }
    }
    if (cp.type === 'measure') {
      const mv = r.mval !== '' && r.mval != null ? Number(r.mval) : null
      return { inspection_id: inspectionId, checkpoint_id: cp.id, value_1: mv, value_numeric: mv, status: measureStatus(r.mval, cp) }
    }
    /* 🚩 เหตุผลที่ NG ลง `action_text` · ยกของเก่ามาแล้วกดยืนยัน = เก็บข้อความเดิมลงไปจริง */
    const ngText = r.attr === 'ng'
      ? (String(r.reason || '').trim() || (r.reasonAccepted ? (carryTextOf(cp.id) || '') : ''))
      : null
    return { inspection_id: inspectionId, checkpoint_id: cp.id, value_attribute: r.attr || null, action_text: ngText || null, status: r.attr === 'ng' ? 'fail' : r.attr === 'ok' ? 'pass' : null }
  })
}
/** ชื่อจุดที่ไม่ผ่าน (ใช้เปิดใบซ่อม/แจ้งเตือน) */
function ngTopicsOf(checkpoints, results) {
  return checkpoints.filter(cp => {
    const r = results[cp.id]
    if (!r) return false
    return cp.type === 'variable' ? getSpcStatus(computeAvg(r.v1, r.v2, r.v3), cp) === 'fail'
      : cp.type === 'measure' ? measureStatus(r.mval, cp) === 'fail' : r.attr === 'ng'
  }).map(cp => cp.name)
}

/** ⭐ แผน PM "วิ่งตามผลตรวจ" (2026-08-17) — ตรวจครบ (pass/fail) = ทำจริงแล้ว ⇒ stamp last_done_at + เลื่อน next_due_date
 *  run_day ข้าม (trigger pm_refresh_plan ดูแล · 08/10) · วันนี้ stamp แล้วข้าม · วันที่ = วันทำงาน (getWorkDate)
 *  @returns {Promise<string|null>} ข้อความผิด (best-effort — ผู้เรียกต้องบอกบนจอ ห้ามเงียบ) */
async function stampPlansAfterCheck(checklistId) {
  try {
    const { data: plans, error: pErr } = await supabaseDR.from('pm_plans')
      .select('id, plan_type, interval_days, last_done_at, cycle_basis').eq('checklist_id', checklistId).eq('is_active', true)
    if (pErr) throw pErr
    const done = getWorkDate()
    for (const pl of (plans || [])) {
      if (pl.cycle_basis === 'run_day') continue
      if (pl.last_done_at && String(pl.last_done_at).slice(0, 10) >= done) continue
      const patch = { last_done_at: done }
      if (pl.plan_type !== 'usage' && Number(pl.interval_days) > 0) {
        const d = new Date(done + 'T00:00:00'); d.setDate(d.getDate() + Number(pl.interval_days))
        patch.next_due_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      const { error: uErr } = await supabaseDR.from('pm_plans').update(patch).eq('id', pl.id)
      if (uErr) throw uErr
    }
    return null
  } catch (e) { return e?.message || String(e) }
}

/* 🔔 ลิงก์ของแจ้งเตือนใบตรวจ (20/11 · คำสั่ง user "แจ้งเตือนใบ AM ยังพาไปหน้า PM ช่าง")
   ใบ AM → หน้าบันทึกผลตรวจ AM ใน Daily Checker · ใบ PM → หน้าตรวจของช่าง · เปิดเครื่องนั้นให้เลย (?equip=)
   แยกด้วย isAmTeam() (mtn_teams.kind) เท่านั้น · ไม่รู้ทีม = ไม่ส่ง link (ถอยไป map ref_table เดิม) */
export function inspNotifLink(dept, jigId) {
  if (!dept) return undefined
  const q = new URLSearchParams({ dept: String(dept) })
  if (jigId) q.set('equip', String(jigId))
  return isAmTeam(dept) ? `/daily-checker?tab=amcheck&${q.toString()}` : `/pm?tab=check&${q.toString()}`
}

function HistoryModal({ inspection, checkpoints: cpsFromPage, jig, onClose, userId, userRole, deptWrite, lineWrite = null, canRecord = false,
  isAm = false, deptKey = null, inspectorPosition = null, myPosition = null, inspectorIsSelf = null, isShared = false }) {
  const [results, setResults] = useState([])
  const [approving, setApproving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [insp, setInsp] = useState(inspection)
  const { fullName: myFullName } = useContext(UserContext)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const fetchResults = () => supabaseDR.from('inspection_results').select('*').eq('inspection_id', inspection.id).then(({ data }) => setResults(data ?? []))
  useEffect(() => { fetchResults() }, [inspection.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /* 🔴 จุดตรวจของ "ใบนี้" ต้องโหลดจากผลตรวจของใบเอง (20/10 · user: PDF PM JIG ออกมาไม่มีตารางเลย)
     เดิมใช้ checkpoints ของหน้าแม่ = รายการของ "ทีมที่กำลังเปิดดูอยู่" — เปิดประวัติจากแท็บทีมอื่น
     (ใบตรวจของ production แต่หน้าเปิดแท็บช่าง) ⇒ จับคู่ไม่ได้สักจุด ⇒ ใบพิมพ์/Excel ไม่มีตาราง + จอขึ้นแต่ id
     ⇒ โหลดตาม checkpoint_id ที่ใบนี้บันทึกไว้จริง · ล้ม = ถอยไปใช้ของหน้าแม่ + บอกบนจอ */
  const [ownCps, setOwnCps] = useState(null)
  const cpIdsKey = results.map(r => r.checkpoint_id).filter(Boolean).sort().join(',')
  useEffect(() => {
    if (!cpIdsKey) return undefined
    let alive = true
    supabaseDR.from('jig_checkpoints').select('*').in('id', cpIdsKey.split(',')).order('sort_order').then(({ data, error }) => {
      if (!alive) return
      if (error) { toast.error('โหลดจุดตรวจของใบนี้ไม่สำเร็จ — ใช้รายการของหน้าที่เปิดอยู่แทน (อาจไม่ครบ)'); setOwnCps(null); return }
      setOwnCps(data ?? [])
    })
    return () => { alive = false }
  }, [cpIdsKey])
  const checkpoints = ownCps && ownCps.length ? ownCps : cpsFromPage
  const cpMap = Object.fromEntries(checkpoints.map(c => [c.id, c]))
  /* 🔐 อนุมัติ/ตีกลับผลตรวจ = ตัดสินงานของทีมนั้น ⇒ ต้องเป็นทีมของเรา (ส่งมาจากหน้าแม่) */
  /* ✍️ B2 (02/11) — ใบ AM: ผู้อนุมัติ = ชั้นถัดไปเหนือคนตรวจเท่านั้น (ห้ามข้ามไปผู้จัดการ) · กฎอยู่ `utils/amApproval.js`
     ใบ PM ของช่าง = พฤติกรรมเดิม (`pm:approve` + ทีม) */
  /* ✍️ 11/11 — ใบ PM ของช่าง: ขั้น 2 "หัวหน้าผู้ตรวจ ตรวจสอบและยืนยัน" (`pmConfirmVerdict` · utils/amApproval.js)
     ใช้ตัวแปร `amVerdict` ชุดเดียวกัน (ด่านซ้ำตอนเขียนจริงใน handleApprove/handleReject ทำงานทั้ง 2 สาย)
     `amApprovalText`/`amApprovalAssumptionText` ของใบ PM ใช้ `pmConfirmText` แทน (ดู verdictText) */
  const verdictArgs = {
    inspectorRank: positionRank(inspectorPosition), approverRank: positionRank(myPosition),
    // 🪪 B4 — ใบที่มีรหัสบัตร: "ใบตัวเอง" = บัตรเป็นของเรา (หน้าแม่คิดผ่าน amInspectorIdentity) ไม่ใช่บัญชีที่บันทึก
    isSelf: inspectorIsSelf ?? (!!userId && insp.inspector_id === userId),
  }
  const amVerdict = isAm ? amApprovalVerdict(verdictArgs) : pmConfirmVerdict({ ...verdictArgs, isShared })
  const verdictText = (v) => (isAm ? amApprovalText(v) : pmConfirmText(v))
  const canApprove = (isAm
    ? amApproveAllowed({ can: (r, a) => can(r, a, userRole), isSeeded: isActionSeeded }) && !!amVerdict?.ok
    : can('pm', 'approve', userRole) && !!amVerdict?.ok) && (deptWrite?.ok !== false) && (lineWrite?.ok !== false)

  /** หลัง CAS ไม่ผ่าน — ดึงสถานะจริงของใบมาแสดง (อ่านไม่ได้ = บอก ไม่เงียบ) */
  const reloadInspStatus = async () => {
    const { data, error } = await supabaseDR.from('inspections').select('*').eq('id', insp.id).maybeSingle()
    if (error) { toast.error((tr('โหลดสถานะใบล่าสุดไม่สำเร็จ') + ': ') + error.message); return }
    if (data) setInsp(data)
  }

  const handleApprove = async () => {
    if (deptWrite && !deptWrite.ok) { toast.info(teamBlockText(deptWrite, 'ผลตรวจของทีมนี้')); return }
    if (lineWrite && !lineWrite.ok) { toast.info(writeBlockText(lineWrite, { what: `ใบตรวจ AM ของไลน์ ${jig?.line_name || ''}` })); return }   // A4
    if (amVerdict && !amVerdict.ok) { toast.info(verdictText(amVerdict)); return }   // ด่านซ้ำตอนเขียนจริง (ปุ่มซ่อนอย่างเดียวไม่พอ)
    /* 🔴 A2 (23/11): อนุมัติ = เซ็นรับ ⇒ ถามยืนยันผ่านของกลางก่อนเขียน DB (CLAUDE.md §4M · signConfirm.js)
       ตีกลับไม่ต้องถาม — มีด่าน "ต้องพิมพ์เหตุผล" อยู่แล้ว (ห้ามถามพร่ำเพรื่อ) */
    if (!await confirmSign({
      what: isAm ? 'อนุมัติผลตรวจ AM' : 'ยืนยันผลตรวจ',
      docLabel: 'ใบตรวจ', orderNo: [jig?.name, formatDate(insp.inspected_at)].filter(Boolean).join(' — '),
      actor: myFullName, as: isAm ? 'ผู้อนุมัติ' : 'หัวหน้าผู้ยืนยัน',
      effect: 'ใบเปลี่ยนเป็น "อนุมัติแล้ว" · ลายเซ็นคุณขึ้นช่องผู้อนุมัติในใบพิมพ์',
      warn: '⚠️ อนุมัติแล้ว ยกเลิกหรือเปลี่ยนเป็นตีกลับในระบบไม่ได้',
    })) return
    setApproving(true)
    /* 🔴 A3 (23/11): compare-and-swap — เขียนได้เฉพาะใบที่ยัง "รออนุมัติ" อยู่จริง
       (อีกคนตีกลับ/อนุมัติไปแล้วระหว่างที่จอนี้เปิดค้าง = 0 แถว ⇒ ไม่ทับผลของเขา แล้วโหลดสถานะจริงมาโชว์) */
    const { data, error } = await supabaseDR.from('inspections').update({
      approval_status: 'approved', approved_by: userId, approved_at: new Date().toISOString(), reject_reason: null,
    }).eq('id', insp.id).eq('approval_status', 'pending').select().maybeSingle()
    if (!error && !data) { toast.error(tr('ใบนี้ถูกอนุมัติหรือตีกลับไปแล้วโดยคนอื่น — โหลดสถานะล่าสุดให้แล้ว')); await reloadInspStatus(); setApproving(false); return }
    if (error) toast.error((tr('อนุมัติไม่สำเร็จ') + ': ') + error.message)
    if (!error && data) {
      setInsp(data)
      if (data.inspector_id !== userId) {
        createNotification(data.inspector_id, { title: 'ผลการตรวจได้รับการอนุมัติ', body: jig?.name ? `${jig.name} — ${formatDate(data.inspected_at)}` : undefined, type: 'success', refTable: 'inspections', refId: data.id, link: inspNotifLink(deptKey, jig?.id) }).catch(() => {})
      }
    }
    setApproving(false)
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    if (deptWrite && !deptWrite.ok) { toast.info(teamBlockText(deptWrite, 'ผลตรวจของทีมนี้')); return }
    if (lineWrite && !lineWrite.ok) { toast.info(writeBlockText(lineWrite, { what: `ใบตรวจ AM ของไลน์ ${jig?.line_name || ''}` })); return }   // A4
    if (amVerdict && !amVerdict.ok) { toast.info(verdictText(amVerdict)); return }
    setApproving(true)
    const { data, error } = await supabaseDR.from('inspections').update({
      approval_status: 'rejected', approved_by: userId, approved_at: new Date().toISOString(), reject_reason: rejectReason.trim(),
    }).eq('id', insp.id).eq('approval_status', 'pending').select().maybeSingle()   // A3: CAS เหมือนปุ่มอนุมัติ
    if (!error && !data) { toast.error(tr('ใบนี้ถูกอนุมัติหรือตีกลับไปแล้วโดยคนอื่น — โหลดสถานะล่าสุดให้แล้ว')); setRejecting(false); await reloadInspStatus(); setApproving(false); return }
    if (error) toast.error((tr('ตีกลับไม่สำเร็จ') + ': ') + error.message)
    if (!error && data) {
      setInsp(data); setRejecting(false); setRejectReason('')
      if (data.inspector_id !== userId) {
        createNotification(data.inspector_id, { title: 'ผลการตรวจถูกตีกลับ', body: rejectReason.trim(), type: 'error', refTable: 'inspections', refId: data.id, link: inspNotifLink(deptKey, jig?.id) }).catch(() => {})
      }
    }
    setApproving(false)
  }

  const buildExportArgs = async (currentUserEmail) => {
    const resultMap = Object.fromEntries(results.map(r => [r.checkpoint_id, r]))
    const userIds = [insp.inspector_id, insp.approved_by, userId].filter(Boolean)
    /* 🔴 ห้าม select `email` — `profiles` ไม่มีคอลัมน์นี้ (มีแต่ notify_email ที่ไม่เคยถูกใช้ส่งอะไร)
       เดิม select('id, email, signature_url') = 42703 ทั้งคิวรี → profMap ว่าง
       → **ลายเซ็นผู้ตรวจ/ผู้อนุมัติหายจากใบพิมพ์ PM ทุกใบ** และชื่อกลายเป็น "Inspector"/"Approver"
       โดยไม่มี error เพราะรับแค่ `{ data }` (supabase-js คืน {data,error} ไม่ throw) — audit 2026-09-03
       คลาสเดียวกับ fn_audit ที่อ่าน coalesce(full_name, email) แล้วไม่บันทึกผู้แก้ทั้งระบบ */
    const { data: profs, error: profErr } = await supabase
      .from('profiles').select('id, full_name, signature_url, employee_id').in('id', userIds)
    if (profErr) { console.warn('[buildExportArgs] profiles', profErr.message); toast.error('โหลดชื่อ/ลายเซ็นผู้ตรวจไม่สำเร็จ — ใบที่พิมพ์จะไม่มีลายเซ็น') }
    const profMap = Object.fromEntries((profs ?? []).map(p => [p.id, p]))
    /* ✍️ C1 (03/11): บัญชีที่ยังไม่ตั้งลายเซ็นในโปรไฟล์ → ถอยไปใช้ลายเซ็นในฐานพนักงานที่ผูกไว้
       (ลำดับอยู่ที่ signatureOfPerson() ที่เดียว · โปรไฟล์ชนะเสมอ) · อ่านไม่ได้ = บอก ไม่เงียบ */
    const needEmp = (profs ?? []).filter(p => !p.signature_url && p.employee_id).map(p => p.employee_id)
    const empSig = {}
    if (needEmp.length) {
      const er = await loadEmployeeSigners(supabase, { ids: needEmp })
      if (er.error) toast.error(`${tr("โหลดลายเซ็นจากฐานพนักงานไม่สำเร็จ — ช่องที่ไม่มีลายเซ็นโปรไฟล์จะเว้นว่าง")} (${er.error})`)
      else if (er.sigColumnMissing) toast.info('ฐานพนักงานยังไม่เปิดช่องลายเซ็น — ผู้ที่ไม่มีลายเซ็นในโปรไฟล์จะเว้นช่องให้เซ็นมือ')
      for (const e of er.rows) empSig[e.id] = e.signature_url || null
    }
    const sigCache = {}
    const getSig = async (uid) => {
      if (!uid) return null
      if (sigCache[uid] !== undefined) return sigCache[uid]
      const p = profMap[uid]
      const url = signatureOfPerson({ profileSig: p?.signature_url, employeeSig: p?.employee_id ? empSig[p.employee_id] : null })
      sigCache[uid] = url ? await resolveSignatureDataUrl(url) : null
      return sigCache[uid]
    }
    /* ✍️ C1 (05/11): ใบที่บันทึกรหัสผู้ตรวจไว้ = คนตามรหัสเซ็น (เครื่องหน้างานใช้บัญชีกลาง)
       หาลายเซ็นไม่ได้ = เว้นช่อง + บอกเหตุผล · ห้ามถอยไปใช้ลายเซ็นบัญชีที่ login (inspectorForExport) */
    let inspector
    if (insp.inspector_code) {
      const signer = await resolveEmployeeSigner(supabase, insp.inspector_code)
      const who = inspectorForExport({ code: insp.inspector_code, signer })
      if (who.note) toast.info(`${tr("ผู้ตรวจรหัส")} ${insp.inspector_code}: ${who.note}`)
      inspector = { email: who.name ?? 'Inspector', signature_data: who.signatureUrl ? await resolveSignatureDataUrl(who.signatureUrl) : null }
    } else {
      inspector = { email: profMap[insp.inspector_id]?.full_name ?? 'Inspector', signature_data: await getSig(insp.inspector_id) }
    }
    /* 🔴 A1 (23/11): `approved_by` ถูกเขียนทั้งตอนอนุมัติและตอน "ตีกลับ" (= คนที่ตีกลับ)
       ⇒ ช่องผู้อนุมัติในใบพิมพ์ต้องดูสถานะด้วย — ใบตีกลับ/รออนุมัติ ห้ามมีลายเซ็นผู้อนุมัติ */
    const approver = (insp.approval_status === 'approved' && insp.approved_by) ? { email: profMap[insp.approved_by]?.full_name ?? 'Approver', signature_data: await getSig(insp.approved_by) } : null
    // ชื่อใต้ลายเซ็น = ชื่อจริง (profiles.full_name) ไม่ใช่อีเมล — เดิมช่อง APPROVED ขึ้น "tsat4pd3" (20/10)
    const exporter = { email: profMap[userId]?.full_name ?? currentUserEmail ?? 'Exporter', signature_data: await getSig(userId) }
    const categories = await fetchCategories({ includeInactive: true })
    // วิธีตรวจ (มอง/สัมผัส/วัด) → ป้ายในคอลัมน์ Checking ของใบพิมพ์ (เดิมช่องนี้ว่างทุกแถว · 20/10)
    const methods = Object.fromEntries((await fetchCheckingMethods({ includeInactive: true })).map(m => [m.code, m.label || m.code]))
    // เลขฟอร์ม/Rev/Effective อ่านจาก Document Master กลาง (doc_control แก้ได้ที่ /doc-forms) · fallback ค่าเดิม
    const docForm = await getDocForm('pm_jig', { form_code: 'FM-JIG-003', rev: 'Rev.00', effective_date: '01/07/2020' })
    checkWriteRows(await supabaseDR.from('inspections').update({ exported_by: userId, exported_at: new Date().toISOString() }).eq('id', insp.id).select('id'), 'บันทึกว่า export แล้ว');
    // 🔴 ใบที่มีผลตรวจแต่จับคู่จุดตรวจไม่ได้เลย = ใบพิมพ์ไม่มีตาราง — หยุดแล้วบอก ห้ามออกใบเปล่าเงียบๆ
    if (results.length && !checkpoints.some(c => resultMap[c.id])) throw new Error('ยังโหลดจุดตรวจของใบนี้ไม่เสร็จ/ไม่พบ — รอสักครู่แล้วกด export อีกครั้ง')
    return { jig, inspection: insp, checkpoints, results: resultMap, inspector, approver, exporter, categories, docForm, methods }
  }

  const handleExport = async (kind) => {
    setExporting(kind)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const args = await buildExportArgs(user?.email)
      if (kind === 'pdf') await exportInspectionPDF(args)
      else await exportInspectionExcel(args)
    } catch (err) { toast.error(err.message) }
    finally { setExporting(false) }
  }

  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* ตั้งใจไม่ปิดเมื่อคลิกพื้นหลัง — ข้างในมีฟอร์ม NG action/re-check กันเผลอกดแล้วหาย */}
      <div style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)' }} />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 12, background: 'var(--bg2-surf)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 700, color: 'var(--text)', margin: 0, fontSize: 14 }}>{formatDate(insp.inspected_at)}</p>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-md)', background: insp.status === 'pass' ? 'var(--accent-dim)' : insp.status === 'fail' ? 'rgba(224,92,74,0.12)' : 'var(--bg3)', color: insp.status === 'pass' ? 'var(--accent)' : insp.status === 'fail' ? '#e05c4a' : 'var(--muted)' }}>{insp.status?.toUpperCase()}</span>
              {insp.approval_status === 'approved' && <span style={{ fontSize: 11, color: 'var(--accent)', border: '1px solid var(--accent)', padding: '2px 6px', borderRadius: 'var(--r-md)' }}>{tr('✓ อนุมัติแล้ว')}</span>}
              {insp.approval_status === 'rejected' && <span style={{ fontSize: 11, color: 'var(--red)', border: '1px solid #e05c4a', padding: '2px 6px', borderRadius: 'var(--r-md)' }}>{tr('✕ ตีกลับ')}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map(r => {
            const cp = cpMap[r.checkpoint_id]
            if (!cp) return null
            const isNG = (cp.type === 'variable' || cp.type === 'measure') ? r.status === 'fail' : r.value_attribute === 'ng'
            const c = r.status ? STATUS_COLOR[r.status] : null
            return (
              <div key={r.id}>
                <div style={{ borderRadius: 'var(--r-md)', border: `1px solid ${c?.border ?? 'var(--border)'}`, background: c?.bg ?? 'var(--card)', padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <p style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, margin: 0 }}>{cp.name}{cp.axis && <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--r-xs)', padding: '0 3px' }}>{cp.axis}</span>}</p>
                      {cp.type === 'variable' ? (
                        <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', margin: '2px 0 0' }}>
                          {fmt(r.value_1)} / {fmt(r.value_2)} / {fmt(r.value_3)}
                          {r.avg_value != null && <span style={{ color: 'var(--text2)' }}> → Avg: <strong>{fmt(r.avg_value)}</strong></span>}
                          {cp.unit && <span style={{ marginLeft: 4 }}>{cp.unit}</span>}
                        </p>
                      ) : cp.type === 'measure' ? (
                        <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', margin: '2px 0 0' }}>
                          {tr("อ่านค่า")}: <strong style={{ color: 'var(--text2)' }}>{fmt(r.value_1)}</strong>{cp.unit ? ` ${cp.unit}` : ''}
                          <span style={{ marginLeft: 6 }}>{tr('เกณฑ์')} {measureStdText(cp)}</span>
                        </p>
                      ) : (
                        <>
                          {cp.description && <p style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-line', margin: '2px 0 0' }}>{cp.description}</p>}
                          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>{r.value_attribute?.toUpperCase()}</p>
                        </>
                      )}
                    </div>
                    {c && <span style={{ fontSize: 11, fontWeight: 700, color: c.text }}>{tr(c.label)}</span>}
                  </div>
                  {/* 📎 รูปหลักฐาน — แตะ = ซูมในแอป (A7 · 03/11) · เดิม <a target=_blank> เด้งออกจากใบที่เปิดอยู่
                      และรูปกว้างเต็มแถว (maxWidth 100%) ⇒ ใช้กล่องรูปย่อของกลางแบบเดียวกับรูปจุดตรวจ */}
                  {r.evidence_path && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <PointThumb url={getPublicUrl(r.evidence_path)} height={90} mobileMax={90} label={null} color="var(--red)"
                        name={`${tr("หลักฐานสภาพจริง")} · ${cp.name}`} />
                      <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>{tr('หลักฐานสภาพจริง (แตะเพื่อซูม)')}</span>
                    </div>
                  )}
                </div>
                {isNG && <NgRecheckPanel result={r} cp={cp} onSaved={fetchResults} canRecord={canRecord} deptWrite={deptWrite} />}
              </div>
            )
          })}
          {insp.notes && <div style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--card-surf)', padding: 10 }}><p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>{tr('หมายเหตุ')}</p><p style={{ fontSize: 13, color: 'var(--text)', margin: '2px 0 0' }}>{insp.notes}</p></div>}
          {insp.approval_status === 'rejected' && insp.reject_reason && <div style={{ borderRadius: 'var(--r-md)', border: '1px solid rgba(224,92,74,0.3)', background: 'rgba(224,92,74,0.06)', padding: 10 }}><p style={{ fontSize: 11, color: 'var(--red)', margin: 0 }}>{tr('เหตุผลที่ตีกลับ')}</p><p style={{ fontSize: 13, color: 'var(--text)', margin: '2px 0 0' }}>{insp.reject_reason}</p></div>}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* ✍️ B2 — ใบ AM ต้องบอกว่ารอใคร + ทำไมคุณกดไม่ได้ (ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล) */}
          {insp.approval_status === 'pending' && amVerdict && (
            <div style={{ fontSize: 12, color: amVerdict.ok ? 'var(--text2)' : 'var(--amber)', lineHeight: 1.6 }}>
              {amVerdict.need ? <>{tr('รอ')} <b>{tr(amVerdict.need.label)}</b> {amVerdict.need.action}</> : tr("รอผู้จัดการรับทราบ")}
              {!amVerdict.ok && <div>{verdictText(amVerdict)}</div>}
              {amApprovalAssumptionText(amVerdict.assumed) && <div style={{ color: 'var(--amber)' }}>{amApprovalAssumptionText(amVerdict.assumed)}</div>}
            </div>
          )}
          {canApprove && insp.approval_status === 'pending' && !rejecting && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleApprove} disabled={approving} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--r-md)', border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{approving ? tr('กำลังบันทึก...') : (isAm ? tr('อนุมัติ') : tr('ยืนยันผลตรวจ'))}</button>
              <button onClick={() => setRejecting(true)} disabled={approving} style={{ padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px solid #e05c4a', background: 'rgba(224,92,74,0.08)', color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{tr('ตีกลับ')}</button>
            </div>
          )}
          {rejecting && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} placeholder={tr('ระบุเหตุผลที่ตีกลับ...')} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setRejecting(false); setRejectReason('') }} style={{ padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>{tr('ยกเลิก')}</button>
                <button onClick={handleReject} disabled={approving || !rejectReason.trim()} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--r-md)', border: '1px solid #e05c4a', background: 'rgba(224,92,74,0.08)', color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{approving ? tr('กำลังบันทึก...') : tr('ยืนยันตีกลับ')}</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleExport('pdf')} disabled={!!exporting} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--r-md)', border: '1px solid rgba(224,92,74,0.4)', background: 'rgba(224,92,74,0.1)', color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{exporting === 'pdf' ? tr('กำลัง export...') : 'PDF'}</button>
            <button onClick={() => handleExport('excel')} disabled={!!exporting} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{exporting === 'excel' ? tr('กำลัง export...') : 'Excel'}</button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* 🗓️ แถบ "ข้อที่ยังไม่ถึงรอบ" ของใบ AM (26/11 · utils/amCheckFreq.js) — ใช้ทั้งใบเดี่ยวและใบรวมสถานี
   notDue = [{ cp, freq, lastDate }] · err = อ่านประวัติไม่ได้ (ทุกข้อถึงรอบ) · กดกาง = ตรวจข้อพวกนี้เพิ่มในใบนี้ได้ (กลายเป็นข้อที่ต้องกรอก) */
function AmNotDueBar({ notDue = [], err = '', shown = false, onToggle }) {
  if (err) return <NoticeBar tone="warn" style={{ marginBottom: 8 }}>{tr('อ่านประวัติรอบตรวจไม่ได้ — แสดงทุกข้อให้ตรวจ (ข้อรายสัปดาห์/รายเดือนอาจซ้ำ)')} ({err})</NoticeBar>
  if (!notDue.length) return null
  const fmt = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '7px 12px', marginBottom: 8, borderRadius: 'var(--r-md)', background: 'var(--bg3-surf)', border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text2)' }}>
      <span>🗓️ <b>{tr('ยังไม่ถึงรอบ')} {notDue.length} {tr('ข้อ')}</b> — {notDue.slice(0, 4).map(x => `${x.cp.name} (${tr(AM_FREQ_META[x.freq]?.label || x.freq)} · ${tr('ตรวจแล้ว')} ${fmt(x.lastDate)})`).join(' · ')}{notDue.length > 4 ? ' …' : ''}</span>
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onToggle} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--card)', color: 'var(--text)', cursor: 'pointer' }}>
        {shown ? tr('ซ่อนข้อที่ยังไม่ถึงรอบ') : tr('แสดงเพื่อตรวจเพิ่ม')}
      </button>
    </div>
  )
}

/* 🔩 แถวกรอกค่าชิม (Shim Record) — ชิ้นเดียวใช้ร่วม ใบเดี่ยว + ใบรวมสถานี AM (26/11 แยกออกมาจากใบเดี่ยว ไม่เปลี่ยนหน้าตา)
   points = ทุกจุดของเครื่อง (นับหัว/ถึงรอบ) · shown = จุดที่โชว์แถว · pinnedIds = จุดที่ปักบนรูปแล้ว */
function ShimRecordSection({ points, shown, shimKinds, shimVals, setShimVals, canShim, pinnedIds, rowRefs, scrollMarginTop = 0, readOnlyNote = null }) {
  const kindOf = (code) => shimKinds.find(k => k.code === code) || { icon: '🔩', label: code || '—' }
  const dueN = points.filter(pt => pointDueStatus(pt, { currentShot: null }).due).length
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ padding: '7px 12px', borderRadius: 'var(--r-md)', marginBottom: 8, background: 'var(--blue-dim)', border: '1px solid var(--blue-line)', fontSize: 12.5, fontWeight: 800, color: SHIM_PIN_COLOR }}>
        {tr("จุดชิม")} (Shim Record) · {points.length} {tr('จุด')}{dueN ? <span style={{ color: 'var(--red)' }}> {tr('· ถึงรอบ')} {dueN}</span> : null}
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginTop: 2 }}>
          {tr("วัดค่าชิมรวมตอนนี้แล้วกรอกเป็น mm — บันทึกพร้อมใบตรวจนี้ลงประวัติชิมของจุด (ไม่บังคับ · จุดที่ไม่กรอก = ไม่แตะ")})
          {pinnedIds.size < points.length && <span> · {points.length - pinnedIds.size} {tr('จุดยังไม่ปักบนรูป — ปักที่ /fixture แท็บทะเบียนจุด')}</span>}
        </div>
      </div>
      {!canShim && (
        <NoticeBar tone="warn" style={{ marginBottom: 8 }}>
          {readOnlyNote || <>{tr("บัญชีนี้ดูค่าชิมได้แต่บันทึกไม่ได้ — ต้องมีสิทธิ์ fixture_shim:record (admin เปิดให้ที่")} /permissions)</>}
        </NoticeBar>
      )}
      {shown.map(pt => {
        const st = shimStack(pt)
        const due = pointDueStatus(pt, { currentShot: null })
        const v = shimVals[pt.id] ?? { mm: '', note: '' }
        const mm = v.mm === '' ? null : Number(v.mm)
        const act = deriveShimAction(pt.current_shim_mm, mm)
        const pinned = pinnedIds.has(pt.id)
        const overMax = mm != null && pt.max_shim_mm != null && mm > Number(pt.max_shim_mm)
        const k = kindOf(pt.kind_code)
        return (
          <div key={pt.id} ref={el => { rowRefs.current[`shim:${pt.id}`] = el }}
            style={{ ...S.cpRow(null), borderColor: overMax ? 'var(--red)' : mm != null ? SHIM_PIN_COLOR : 'var(--border)', scrollMarginTop }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ minWidth: 22, height: 18, padding: '0 5px', borderRadius: 'var(--r-md)', background: pinned ? SHIM_PIN_COLOR : 'var(--border2)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} title={pinned ? tr('ปักบนรูปแล้ว') : tr('ยังไม่ปักบนรูป')}>{pt.point_no}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{k.icon} {tr(k.label)}{pt.name ? <span style={{ fontWeight: 500, color: 'var(--muted)' }}> · {pt.name}</span> : null}</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto' }}>
                {tr("ชิมรวม")} <b style={{ color: st.level === 'over' ? 'var(--red)' : st.level === 'warn' ? 'var(--amber)' : 'var(--text)' }}>{st.current ?? '—'}</b> {tr('/ เพดาน')} {pt.max_shim_mm ?? tr("ไม่ตั้ง")} mm
                {due.level !== 'unset' && <span style={{ marginLeft: 8, color: due.due ? 'var(--red)' : due.level === 'soon' ? 'var(--amber)' : 'var(--muted)' }}>· {due.text}</span>}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {tr('ค่าชิมรวมที่วัดได้')}
                <input type="number" step="0.01" inputMode="decimal" value={v.mm} disabled={!canShim} placeholder="mm"
                  onChange={e => setShimVals(prev => ({ ...prev, [pt.id]: { ...v, mm: e.target.value } }))}
                  style={{ width: 84, textAlign: 'center', fontFamily: 'monospace' }} />
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>mm</span>
              </label>
              <input value={v.note} disabled={!canShim} placeholder={tr('หมายเหตุ (แผ่นที่ซ้อน/เหตุผล)')}
                onChange={e => setShimVals(prev => ({ ...prev, [pt.id]: { ...v, note: e.target.value } }))}
                style={{ flex: '1 1 160px', minWidth: 120 }} />
              {mm != null && (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: overMax ? 'var(--red)' : SHIM_PIN_COLOR }}>
                  {act === 'check' ? tr("→ ยืนยันเท่าเดิม") : act === 'add' ? `→ ${tr("เพิ่ม")} +${(mm - Number(pt.current_shim_mm)).toFixed(2)} mm` : `→ ${tr("ลด")} ${(mm - Number(pt.current_shim_mm)).toFixed(2)} mm`}
                  {overMax && ' · เกินเพดาน — ควรเปิดใบซ่อมเปลี่ยนชิ้นส่วน'}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── PMCheckData (main) ───────────────────────────────────────────────────────
/** มีช่องไหนในใบตรวจถูกกรอกไหม (ร่างในเครื่อง) — ค่าว่างทั้งใบ = ไม่ต้องเก็บ/ไม่ต้องถามกู้คืน */
const pmHasInput = (results, notes) => !!(notes && String(notes).trim())
  || Object.values(results || {}).some(r => r && ['v1', 'v2', 'v3', 'attr', 'note', 'mval'].some(f => r[f] !== '' && r[f] != null))

/* ═══ 🧩 ใบตรวจ AM แบบสถานี — อุปกรณ์ที่ติดตั้งคู่กันตรวจในใบเดียว กดบันทึกครั้งเดียว (2026-11-23 · คำสั่ง user) ═══
   user: "robot + gripper (+ stationary + nut feeder) PM แยกทีม แต่ AM ที่ผลิตดูทั้งชุด — ไม่อยากเปิดทีละใบ"
   · จุดตรวจ = ใบ AM รายอุปกรณ์เดิม (ตั้งที่ PM Setup แท็บฝ่ายผลิต) ดึงมาเรียงเป็นหัวข้อต่ออุปกรณ์
   · บันทึก = 1 แถว inspections ต่ออุปกรณ์ (ตารางเดิม) ⇒ ประวัติ/รายงานรายเดือน/บอร์ด ใช้ของเดิมทั้งหมด
   · กฎเดียวกับใบเดี่ยวทุกข้อ: ตรวจไม่ครบ = บันทึกไม่ได้ + เด้งไปข้อที่ขาด · NG ต้องมีเหตุผล · บัตรผู้ตรวจ (สแกนครั้งเดียว) ·
     หัวหน้าบันทึกเอง = รับทราบรายวัน (B4) · NG → คิวเปิดใบซ่อมไป "ทีมเจ้าของ PM ของตัวนั้น" (B3)
   · สูตรตัดสิน/เขียนแถวใช้ของกลางชุดเดียวกับใบเดี่ยว (overallOf · buildResultRows · ngTopicsOf · stampPlansAfterCheck)
   · บันทึกล้มกลางทาง = ตัวที่บันทึกแล้วไม่บันทึกซ้ำ (savedIds) + บอกบนจอว่าล้มที่ตัวไหน
   📄 docs/modules/pm-hub-check-setup.md §🧩 สถานี AM */
function AmStationSheet({ station, memberJigs, amDept, methodIndex, canRecord, deptWrite, amLineWrite = null, userId, userRole, fullName, myPosition,
  myEmployeeId, isSharedAccount, inspectorCode, setInspectorCode, checkedThisShift, ownerTeamOf, onSavedJig, onQueueMo, onOpenSingle, isMobileView = false }) {
  const [sec, setSec] = useState({ key: '', status: 'loading', list: [], err: '' })   // list: [{ jig, checklistId, cps, ngHist }]
  const [results, setResults] = useState({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedIds, setSavedIds] = useState(() => new Set())
  const rowRefs = useRef({})
  /* 🖼️ รูปเครื่อง + หมุดจุดตรวจ ต่อเครื่อง (25/11 · feedback หน้างาน "ใบรวมมองไม่เห็นรูปที่จะตรวจ")
     ตัววาดตัวเดียวกับใบเดี่ยว `JigSpinCheck` · เฟรม = jig_images (ไม่มี → image_path เป็นเฟรมเดียว)
     อ่านรูปไม่ได้ = ใบยังตรวจ/บันทึกได้ + เขียนบอกบนจอ (ไม่ล้มทั้งใบ) */
  const [framesByJig, setFramesByJig] = useState({ key: '', map: {}, err: '' })
  const [activeCp, setActiveCp] = useState(null)
  const [showNdJig, setShowNdJig] = useState(() => new Set())
  const [spcCp, setSpcCp] = useState(null)   // 📈 หน้าต่างกราฟ SPC ของข้อ (26/11)   // 🗓️ เครื่องที่กางข้อ "ยังไม่ถึงรอบ" มาตรวจเพิ่ม
  /* 🚫 ใบรวมสถานี = งาน AM ล้วน — ไม่มีจุดชิม (Shim Record) ไม่แตะ PM (26/11 · คำสั่ง user
     "สถานีจะใช้แค่กับ am ไม่ยุ่งกับ pm/shim record เพราะ shim record เป็นงานของส่วนช่าง") · ห้ามเติมกลับ (มีด่าน) */
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1180px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1180px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const memberKey = memberJigs.map(j => j.id).join(',')
  const loadKey = `${station.id}|${memberKey}|${amDept}`
  /* 📝 ร่างในเครื่อง (มือถือ · 23/11 · ชุดเดียวกับใบเดี่ยว utils/formDraft.js) — คีย์ = สถานี|สมาชิก|ทีม|คนกรอก
     เก็บ savedIds ด้วย: บันทึกได้บางเครื่องแล้วแอปปิด → กู้คืนแล้วตัวที่บันทึกแล้วไม่บันทึกซ้ำ
     จอคอมไม่โหลด/ไม่วาดแถบ (pendingDraft ตั้งเฉพาะมือถือ) */
  const [pendingDraft, setPendingDraft] = useState(null)
  const draftKey = isMobileView && userId ? `amst:${loadKey}:${userId}` : null

  useEffect(() => {
    let alive = true
    setSec({ key: loadKey, status: 'loading', list: [], err: '' }); setResults({}); setSavedIds(new Set()); setShowNdJig(new Set())
    ;(async () => {
      try {
        const list = []
        for (const jig of memberJigs) {
          const cl = await findChecklist(jig.id, 'mtn', amDept)
          const { data, error } = cl
            ? await supabaseDR.from('jig_checkpoints').select('*').eq('checklist_id', cl.id).order('sort_order')
            : { data: [], error: null }
          if (error) throw error
          const ngHist = await loadNgHistory(jig).catch(e => ({ byCp: {}, machine: null, error: String(e?.message || e) }))
          // 🗓️ รอบตรวจรายหัวข้อ AM (26/11) — cps = ข้อที่ถึงรอบกะนี้ · allCps = ทั้งใบ · อ่านประวัติไม่ได้ = ทุกข้อถึงรอบ + บอก
          const all = data ?? []
          const ld = all.length ? await loadAmCpLastDone(all) : { map: new Map(), error: null }
          const sp = splitDueCps(all, amSlotOf(new Date()), ld.map)
          list.push({ jig, checklistId: cl?.id ?? null, cps: sp.due, allCps: all, notDue: sp.notDue, freqErr: ld.error ? String(ld.error) : '', ngHist })
        }
        // รูปแยกตามแผนก (26/11 · utils/jigFrames.js) — เห็นเฉพาะชุดรูปของทีม AM นี้
        const imgRes = await loadDeptFrames(memberJigs.map(j => j.id), amDept)
        if (!alive) return
        const fmap = {}
        for (const j of memberJigs) {
          let fr = (imgRes.rows ?? []).filter(im => im.jig_id === j.id).map(im => ({ id: im.id, url: getPublicUrl(im.image_path) }))
          if (!fr.length && j.image_path) fr = [{ id: 'legacy', url: getPublicUrl(j.image_path) }]
          fmap[j.id] = fr
        }
        setFramesByJig({ key: loadKey, map: fmap, err: imgRes.error ? (imgRes.error.message || String(imgRes.error)) : '' })
        const init = {}
        list.forEach(m => m.allCps.forEach(c => { init[c.id] = { v1: '', v2: '', v3: '', attr: '', note: '', mval: '', reason: '', reasonAccepted: false } }))
        setResults(init)
        setSec({ key: loadKey, status: 'ok', list, err: '' })
        const dr = draftKey ? loadDraft(draftKey) : null
        setPendingDraft(dr && (pmHasInput(dr.data?.results, dr.data?.notes) || dr.data?.savedIds?.length) ? dr : null)
      } catch (e) {
        if (alive) setSec({ key: loadKey, status: 'error', list: [], err: e?.message || String(e) })   // อ่านไม่ได้ ≠ ไม่มีจุดตรวจ
      }
    })()
    return () => { alive = false }
  }, [loadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const carryOf = (m, cpId) => { const h = m.ngHist?.byCp?.[cpId]; return h ? carryNgReason({ prev: h.prev, mo: h.mo, machine: m.ngHist.machine }) : null }
  const okWarnOf = (m, cpId) => { const h = m.ngHist?.byCp?.[cpId]; return h ? okWhileMoOpen({ attr: 'ok', mo: h.mo, machine: m.ngHist.machine }) : null }
  const secList = sec.list.map(m => (showNdJig.has(m.jig.id) ? { ...m, cps: m.allCps } : m))   // 🗓️ กางข้อที่ยังไม่ถึงรอบ = ตรวจเพิ่ม
  const pendingAll = secList.filter(m => !savedIds.has(m.jig.id))
  const pending = pendingAll.filter(m => m.cps.length > 0)            // เครื่องที่ไม่มีข้อถึงรอบกะนี้ = ไม่ต้องบันทึกใบ
  const allCps = pending.flatMap(m => m.cps)
  const calcRes = pmCalcResults(allCps, results)
  const missingList = pending.flatMap(m => m.cps.map((cp, i) => (!cpFilledOf(cp, calcRes[cp.id]) ? { m, cp, no: i + 1 } : null)).filter(Boolean))
  const noCl = pendingAll.filter(m => !m.allCps.length)

  const allSavedNow = secList.length > 0 && pending.length === 0 && noCl.length === 0
  const liveDraftKey = draftKey && sec.status === 'ok' && sec.key === loadKey ? draftKey : null
  const stDirty = !!liveDraftKey && !pendingDraft && !allSavedNow && (pmHasInput(results, notes) || savedIds.size > 0)
  useDraftAutosave(liveDraftKey, { results, notes, savedIds: [...savedIds] }, stDirty)
  const restoreDraft = () => {
    const d = pendingDraft?.data; if (!d) return
    // เติมเฉพาะจุดตรวจที่ยังมีอยู่ (จุดที่ถูกลบออกจากเช็คลิสต์ทีหลังไม่เอากลับ) · savedIds เฉพาะสมาชิกปัจจุบัน
    setResults(prev => { const n = { ...prev }; Object.entries(d.results || {}).forEach(([k, v]) => { if (k in n) n[k] = { ...n[k], ...v } }); return n })
    if (d.notes) setNotes(d.notes)
    const ids = new Set(secList.map(m => m.jig.id))
    const sv = (d.savedIds || []).filter(id => ids.has(id))
    if (sv.length) setSavedIds(new Set(sv))
    setPendingDraft(null)
  }
  const discardDraft = () => { if (draftKey) clearDraft(draftKey); setPendingDraft(null) }

  const jumpTo = (cpId) => { const el = rowRefs.current[cpId]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
  const shortName = (jig) => jig.machine_no || jig.jig_no || jig.name

  const save = async () => {
    if (sec.status !== 'ok' || sec.key !== loadKey) { toast.error('ข้อมูลจุดตรวจยังโหลดไม่เสร็จ — รอสักครู่แล้วกดบันทึกใหม่'); return }
    if (!canRecord) { toast.error('ไม่มีสิทธิ์บันทึกผลตรวจ AM'); return }
    if (deptWrite && !deptWrite.ok) { toast.info(teamBlockText(deptWrite, 'งานตรวจของทีมนี้')); return }
    if (noCl.length) { toast.error(`บันทึกไม่ได้ — ${noCl.map(m => m.jig.name).join(', ')} ยังไม่มีจุดตรวจ AM (ตั้งที่ PM Setup แท็บฝ่ายผลิต)`); return }
    if (missingList.length) {
      const txt = missingList.slice(0, 8).map(x => `${shortName(x.m.jig)} ข้อ ${x.no}`).join(', ')
      toast.error(`บันทึกไม่ได้ — ยังไม่ได้ตรวจ ${missingList.length} จุด (${txt}${missingList.length > 8 ? ' …' : ''}) — ตรวจให้ครบทุกข้อก่อน`)
      jumpTo(missingList[0].cp.id); return
    }
    {
      const bad = []
      pending.forEach(m => m.cps.forEach((cp, i) => {
        if (cp.type === 'variable' || cp.type === 'measure') return
        const r = calcRes[cp.id] ?? {}
        const chk = ngReasonCheck({ attr: r.attr, text: r.reason, carry: carryOf(m, cp.id), accepted: !!r.reasonAccepted })
        if (!chk.ok) bad.push({ cp, txt: `${shortName(m.jig)} ข้อ ${i + 1} ${cp.name}: ${chk.blockText}` })
      }))
      if (bad.length) { toast.error(`${tr('ยังบันทึกไม่ได้')} — ${bad.length} ${tr('ข้อที่ติ๊ก NG ไม่มีเหตุผล')}\n${bad.slice(0, 3).map(b => b.txt).join('\n')}`); jumpTo(bad[0].cp.id); return }
    }
    setSaving(true)
    try {
      // 🪪 บัตรผู้ตรวจ — สแกนครั้งเดียวใช้ทั้งใบ (กฎตัดสินชุดเดียวกับใบเดี่ยว `amBadgeGate`)
      const raw = inspectorCode.trim()
      let hits = 0, loadError = false, badgeEmp = null
      if (normBadgeCode(raw)) {
        const { data: rows, error: eEmp } = await supabase.from('employees')
          .select('id, employee_id_code, name, position').in('employee_id_code', [...new Set([raw, normBadgeCode(raw)])])
        loadError = !!eEmp
        hits = (rows ?? []).filter(e => normBadgeCode(e.employee_id_code) === normBadgeCode(raw)).length
        badgeEmp = findByBadge(rows ?? [], raw)
      }
      const gate = amBadgeGate({ code: raw, employee: badgeEmp, hits, loadError, kind: 'AM' })
      if (!gate.ok) { toast.error(gate.text); return }
      const onSite = amOnSiteApproval({
        inspectorRank: positionRank(badgeEmp.position), approverRank: positionRank(myPosition),
        isSelf: myEmployeeId === undefined ? null : (!!myEmployeeId && badgeEmp.id === myEmployeeId),
        canApprove: amApproveAllowed({ can: (r, a) => can(r, a, userRole), isSeeded: isActionSeeded }) && deptWrite?.ok !== false && amLineWrite?.ok !== false,
        isShared: !!isSharedAccount,
      })
      const approvalPatch = onSite.approve ? { approval_status: 'approved', approved_by: userId, approved_at: new Date().toISOString() } : {}

      const done = []          // [{ m, insp, overall, ngTopics }]
      let failMsg = ''
      for (const m of pending) {
        const overall = overallOf(m.cps, calcRes)
        const { data: insp, error: e1 } = await supabaseDR.from('inspections').insert({
          jig_id: m.jig.id, checklist_id: m.checklistId, inspector_id: userId, status: overall,
          notes: [notes.trim(), `[สถานี AM: ${station.name}]`].filter(Boolean).join(' '),
          inspector_code: raw || null, ...approvalPatch,
        }).select().single()
        if (e1) { failMsg = `${m.jig.name}: ${e1.message}`; break }
        const { error: e2 } = await supabaseDR.from('inspection_results').insert(buildResultRows(insp.id, m.cps, calcRes, (id) => carryOf(m, id)?.text || ''))
        if (e2) {
          const { data: gone, error: eDel } = await supabaseDR.from('inspections').delete().eq('id', insp.id).select('id')
          failMsg = `${m.jig.name}: บันทึกผลรายจุดไม่สำเร็จ ${e2.message}${(eDel || !gone?.length) ? ' — ⚠️ และลบหัวใบค้างไม่สำเร็จ แจ้ง admin' : ''}`
          break
        }
        done.push({ m, insp, overall, ngTopics: ngTopicsOf(m.cps, calcRes) })
      }

      // ผลข้างเคียงรายอุปกรณ์ที่บันทึกสำเร็จ (ชุดเดียวกับใบเดี่ยว)
      const planErrs = []
      for (const d of done) {
        if (d.overall === 'fail') {
          notifyDepartment(amDept, {
            event: 'am_inspection_ng', title: 'พบผลตรวจไม่ผ่าน (NG)', body: `${d.m.jig.name} — ${formatDate(d.insp.inspected_at)} · สถานี ${station.name}`,
            type: 'error', refTable: 'inspections', refId: d.insp.id, link: inspNotifLink(amDept, d.m.jig.id), lineName: d.m.jig.line_name || null,
          }).catch(() => {})
        }
        if (d.overall !== 'pending' && d.m.checklistId) {
          const pe = await stampPlansAfterCheck(d.m.checklistId)
          if (pe) planErrs.push(`${shortName(d.m.jig)}: ${pe}`)
        }
        handleDailyPmSave({ jig: d.m.jig, department: amDept, overall: d.overall, ngTopics: d.ngTopics }).catch(() => {})
        onSavedJig?.(d.m.jig.id, d.overall)
      }
      if (planErrs.length) toast.error(`${tr('บันทึกผลตรวจสำเร็จ แต่เลื่อนรอบแผนไม่สำเร็จ')}: ${planErrs.join(' · ')}`)
      setSavedIds(prev => { const n = new Set(prev); done.forEach(d => n.add(d.m.jig.id)); return n })

      if (failMsg) {
        toast.error(`${tr('บันทึกแล้ว')} ${done.length}/${pending.length} ${tr('เครื่อง · ล้มที่')} ${failMsg} — ${tr('กดบันทึกอีกครั้งเพื่อบันทึกตัวที่เหลือ (ตัวที่บันทึกแล้วไม่ซ้ำ)')}`)
      } else {
        toast.success(onSite.approve
          ? `${tr('บันทึกสถานี')} ${station.name} ${tr('ครบ')} ${done.length} ${tr('เครื่อง — ผู้ตรวจ')} ${badgeEmp?.name || raw} · ${fullName || tr('คุณ')} ${tr('ทวนสอบ/รับทราบแล้ว')}`
          : `${tr('บันทึกสถานี')} ${station.name} ${tr('ครบ')} ${done.length} ${tr('เครื่อง — ผู้ตรวจ')} ${badgeEmp?.name || raw}`)
        if (!onSite.approve && onSite.text) toast.info(onSite.text)
        setNotes('')
        if (draftKey) clearDraft(draftKey)
      }
      // 🔧 B3 — NG ทุกตัว ⇒ คิวเปิดใบซ่อม (หรือเขียนเหตุผล) ไปทีมเจ้าของ PM ของตัวนั้น
      const ngItems = done.filter(d => d.overall === 'fail' && d.ngTopics.length)
        .map(d => ({ insp: d.insp, ngTopics: d.ngTopics, jig: d.m.jig, team: ownerTeamOf(d.m.jig) }))
      if (ngItems.length) onQueueMo?.(ngItems)
    } catch (err) {
      toast.error(err?.message || String(err))
    } finally { setSaving(false) }
  }

  if (sec.status === 'loading' || sec.key !== loadKey) return <div style={{ padding: 24, color: 'var(--muted)', textAlign: 'center' }}>{tr('กำลังโหลดจุดตรวจของสถานี…')}</div>
  if (sec.status === 'error') return <div style={{ padding: 16, color: 'var(--amber)' }}>{tr('อ่านจุดตรวจของสถานีไม่ได้')}: {sec.err}</div>

  const totalCps = allCps.length
  const doneCps = totalCps - missingList.length
  const allSaved = secList.length > 0 && pending.length === 0 && noCl.length === 0
  return (
    <div>
      {spcCp && <EquipSpcModal cp={spcCp.cp} jigName={spcCp.jigName} onClose={() => setSpcCp(null)} />}
      <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'var(--accent-dim)', border: '1px solid var(--border2)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>🧩 {tr('สถานี')} {station.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
          {station.line_name} · {secList.length} {tr('เครื่อง ตรวจในใบเดียว กดบันทึกครั้งเดียว — ระบบแยกเก็บผลรายเครื่อง')}
        </div>
      </div>
      <DraftRestoreBar draft={pendingDraft} what={`${tr('ใบสถานี')} ${station.name}`} onRestore={restoreDraft} onDiscard={discardDraft} />
      {framesByJig.key === loadKey && framesByJig.err && (
        <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8 }}>⚠ {tr('โหลดรูปเครื่องไม่สำเร็จ — ตรวจตามรายการได้ตามปกติ')} ({framesByJig.err})</div>
      )}
      {!allSaved && (
        <div style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--card)', padding: '6px 0', marginBottom: 8, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>{tr('ตรวจแล้ว')} {doneCps}/{totalCps}</b>
          {missingList.length > 0 && <span style={{ color: 'var(--amber)' }}>· {tr('เหลือ')} {missingList.length}</span>}
          {missingList.slice(0, 10).map(x => (
            <button key={x.cp.id} type="button" onClick={() => jumpTo(x.cp.id)} title={x.cp.name}
              style={{ height: 22, padding: '0 8px', borderRadius: 11, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {shortName(x.m.jig)} · {x.no}
            </button>
          ))}
        </div>
      )}
      {secList.map((m, mi) => {
        const saved = savedIds.has(m.jig.id)
        const shift = checkedThisShift?.[m.jig.id]
        const owner = ownerTeamOf(m.jig)
        return (
          <section key={m.jig.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--r-md)', background: 'var(--bg3-surf)', border: '1px solid var(--border)', marginBottom: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 13.5, color: 'var(--text)' }}>{mi + 1}. {m.jig.name}</b>
              {owner && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {tr('PM โดย')} {deptNameOf(owner) || owner}</span>}
              {shift && <span style={{ fontSize: 11, fontWeight: 700, color: shift === 'fail' ? 'var(--red)' : shift === 'pass' ? 'var(--green)' : 'var(--amber)' }}>· {tr('กะนี้')} {shift === 'fail' ? 'NG' : shift === 'pass' ? tr('ตรวจแล้ว') : tr('ไม่ครบ')}</span>}
              <span style={{ flex: 1 }} />
              {saved && <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)' }}>✓ {tr('บันทึกแล้ว')}</span>}
              <button type="button" onClick={() => onOpenSingle?.(m.jig.id)} style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer' }}>{tr('ประวัติเครื่องนี้')}</button>
            </div>
            {m.ngHist?.error && <div style={{ fontSize: 11.5, color: 'var(--amber)', margin: '0 0 6px' }}>⚠ {tr('อ่านประวัติการตรวจครั้งก่อนไม่ได้ — ต้องพิมพ์เหตุผล NG เอง')}</div>}
            {!saved && !m.allCps.length && <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>{tr('เครื่องนี้ยังไม่มีจุดตรวจ AM — ตั้งที่ PM Setup แท็บฝ่ายผลิต')}</div>}
            {!saved && (m.notDue.length > 0 || m.freqErr) && (
              <AmNotDueBar notDue={m.notDue} err={m.freqErr} shown={showNdJig.has(m.jig.id)}
                onToggle={() => setShowNdJig(prev => { const n = new Set(prev); n.has(m.jig.id) ? n.delete(m.jig.id) : n.add(m.jig.id); return n })} />
            )}
            {!saved && m.allCps.length > 0 && !m.cps.length && <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 6px' }}>{tr('กะนี้ไม่มีข้อที่ถึงรอบตรวจของเครื่องนี้ — ไม่ต้องบันทึก')}</div>}
            {(() => {
            const frames = framesByJig.key === loadKey ? (framesByJig.map[m.jig.id] || []) : []
            const showPhoto = !saved && m.cps.length > 0 && frames.length > 0
            const rowsOnly = !saved && m.cps.map((cp, idx) => {
              const r = results[cp.id] ?? {}
              const row = cp.type === 'variable' ? (
                <VariableRow cp={cp} idx={idx} r={calcRes[cp.id] ?? { v1: '', v2: '', v3: '' }} onChange={v => setResults(p => ({ ...p, [cp.id]: v }))} methodIndex={methodIndex} onSpc={() => setSpcCp({ cp, jigName: m.jig.name })}
                  calcText={calcOf(cp) ? calcFormula(calcOf(cp), id => { const k = m.cps.findIndex(c => c.id === id); return k < 0 ? '?' : `${tr('ข้อ')} ${k + 1}` }) : null} />
              ) : cp.type === 'measure' ? (
                <MeasureRow cp={cp} idx={idx} r={r.mval !== undefined ? r : { mval: '' }} onChange={v => setResults(p => ({ ...p, [cp.id]: v }))} methodIndex={methodIndex} onSpc={() => setSpcCp({ cp, jigName: m.jig.name })} />
              ) : (
                <AttrRow cp={cp} idx={idx} methodIndex={methodIndex} value={r.attr ?? ''} note={r.note ?? ''}
                  onChangeAttr={v => setResults(p => ({ ...p, [cp.id]: { ...p[cp.id], attr: v } }))}
                  onChangeNote={v => setResults(p => ({ ...p, [cp.id]: { ...p[cp.id], note: v } }))}
                  reason={r.reason ?? ''} onChangeReason={v => setResults(p => ({ ...p, [cp.id]: { ...p[cp.id], reason: v } }))}
                  carry={carryOf(m, cp.id)} accepted={!!r.reasonAccepted}
                  onAccept={() => setResults(p => ({ ...p, [cp.id]: { ...p[cp.id], reasonAccepted: true, reason: carryOf(m, cp.id)?.text || '' } }))}
                  okWarn={okWarnOf(m, cp.id)} />
              )
              return <div key={cp.id} ref={el => { rowRefs.current[cp.id] = el }} onClickCapture={() => setActiveCp(cp.id)} style={{ scrollMarginTop: 60 }}>{row}</div>
            })
            const rows = rowsOnly
            if (!showPhoto) return rows
            const mine = activeCp && m.cps.some(c => c.id === activeCp) ? activeCp : null
            const viewer = (
              <JigSpinCheck frames={frames} checkpoints={m.cps} results={calcRes} activeCpId={mine}
                onPinClick={(id) => { setActiveCp(id); jumpTo(id) }} maxH={wide ? 480 : 300} compact={!wide} />
            )
            /* จอกว้าง = รูปซ้ายค้างไว้ระหว่างเลื่อนรายการของเครื่องนั้น · จอแคบ = รูปอยู่บนหัวรายการ (แบบใบเดี่ยว) */
            return wide ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 6fr)', gap: 14, alignItems: 'start' }}>
                <div style={{ position: 'sticky', top: 44 }}>{viewer}</div>
                <div>{rows}</div>
              </div>
            ) : <>{viewer}{rows}</>
            })()}
          </section>
        )
      })}
      {allSaved ? (
        <div style={{ padding: 14, textAlign: 'center', color: 'var(--green)', fontWeight: 800 }}>✓ {tr('บันทึกครบทุกเครื่องในสถานีแล้ว')}</div>
      ) : (<>
        <InspectorCodeField value={inspectorCode} onChange={setInspectorCode} required style={{ marginTop: 8 }} />
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={tr('หมายเหตุ (ถ้ามี)...')} style={{ marginTop: 8 }} />
        <button onClick={save} disabled={saving || !canRecord}
          style={{ ...S.saveBtn, background: missingList.length ? 'var(--accent2)' : 'var(--accent)', color: missingList.length ? SAVE_WARN_INK : 'var(--accent-ink)', opacity: (saving || !canRecord) ? 0.6 : 1 }}>
          {saving ? tr('กำลังบันทึก...') : !canRecord ? tr('ไม่มีสิทธิ์บันทึกผลตรวจ AM')
            : missingList.length ? `${tr('ยังบันทึกไม่ได้ — ยังไม่ตรวจ')} ${missingList.length} ${tr('จุด')}` : `${tr('บันทึกทั้งสถานี')} (${pending.length} ${tr('เครื่อง')})`}
        </button>
      </>)}
    </div>
  )
}

/* 🧭 mode (19/11 · คำสั่ง user "AM ต้องมีหน้าบันทึกของตัวเอง · ปนกับ PM ของช่าง")
   'pm' (ค่าเริ่ม · /pm?tab=check) = เฉพาะทีมช่าง — เปิดด้วยทีม AM จะถูกพาไป /daily-checker?tab=amcheck
   'am' (/daily-checker?tab=amcheck) = เฉพาะทีม AM — ?dept= ที่ไม่ใช่ทีม AM ถูกแทนด้วยทีม AM ตัวแรก
   แยกด้วย `isAmTeam()` (mtn_teams.kind) เท่านั้น ห้าม hardcode 'production' */
export default function PMCheckData({ mode = 'pm' }) {
  const amMode = mode === 'am'
  const [searchParams] = useSearchParams()
  const setParams = useMergeParams()
  const rawDept = searchParams.get('dept')
  const firstAmTeam = pmTeamsSync().find(t => isAmTeam(t.key))?.key
  const department = amMode
    ? ((rawDept && isAmTeam(rawDept)) ? rawDept : (firstAmTeam || rawDept || 'maintenance'))
    : (rawDept || 'maintenance')
  const equipParam = searchParams.get('equip')

  const [userId, setUserId] = useState(null)
  /* 🔐 role/ชื่อ ต้องมาจาก `UserContext` เท่านั้น (QC audit รอบ 4 · 2026-10-09)
     เดิมหน้านี้ยิง `profiles` ของตัวเองซ้ำจาก DB — **ไฟล์เดียวในโปรเจคที่ทำ** ⇒ ผลเสีย 2 ข้อ:
       (ก) ได้แต่ `role` ดิบ **ไม่ได้ `sections`/`isDeptAdmin`** ที่ `effectiveSections()` ตีความให้
       (ข) 🎭 **โหมด "ดูแทน role อื่น" ไม่มีผลบนหน้านี้** — admin สวมเป็น mtn เพื่อทดสอบ
           แต่ `can()` ที่นี่ยังอ่าน role จริงจากฐาน ⇒ เห็นปุ่มครบ แล้วสรุปผลทดสอบผิด
     🔴 `userId` ยังต้องเป็น **auth uid จริง** เสมอ (คนตรวจ/คนอนุมัติ/คนสั่ง export ในใบ)
        ห้ามเอา role ที่ถูกสวมไปปนกับตัวตนคนเซ็น */
  const { role: userRole, fullName, mtnTeams: myMtnTeams, sections: mySections, allUnits, position: myPosition, isSharedAccount, lineId: myLineId, scopeIdx, section: homeSection, respCostCenters, writeUnits } = useContext(UserContext)
  /* ══ 🔐 "ทีมที่เปิดอยู่ (?dept=) เป็นทีมของเราไหม" (15/10 · คำสั่ง user) ══════════════════
     เดิมคีย์ที่ใช้ตัดสินมาจาก `?dept=` ตรงๆ ⇒ ช่างทีมหนึ่งสลับ URL ไปอีกทีม แล้วลงผลตรวจ /
     อนุมัติ / **เลื่อนรอบ PM** ของอุปกรณ์ทีมนั้นได้ (audit 15/10 · ระดับ A)
     🔴 ฝั่งช่างใช้ "ทีม" เป็นแกน ไม่ใช่ส่วนงาน — ช่างซ่อมข้ามไลน์เป็นงานปกติ
     🔴 ไม่ผูกทีม = ไม่บล็อก (ไม่รู้ ≠ ปฏิเสธ) — วัด 15/10 ช่าง 16/16 ตั้งทีมแล้ว ด่านกัดจริง */
  const myTeams = useMemo(() => teamsForUser(myMtnTeams, mySections), [myMtnTeams, mySections])
  const deptWrite = useMemo(() => canWriteTeam(myTeams, department, { allUnits, role: userRole, respCostCenters, scopeIdx }),   // แกนทีม (CC ไม่ใช้ในด่านนี้ — ส่ง ctx ชุดเดียวกับด่านไลน์)
    [myTeams, department, allUnits, userRole, respCostCenters, scopeIdx])
  /* 🔴 A4 (24/11 · คำสั่ง user "อนุมัติ AM ต้องอยู่ในไลน์/ส่วนงานตัวเอง"): ใบ AM เป็นของ "ไลน์" ไม่ใช่ทีมช่าง
     ⇒ แกนทีม (`canWriteTeam`) ปล่อยหัวหน้าฝ่ายผลิตที่ไม่มีทีม (no_team_anchor = ok) อนุมัติได้ทุกไลน์
     ⇒ ชั้น ③ ของใบ AM = `canWriteLine` (ctx ครบ 2 แกน respCostCenters + scopeIdx) · ไม่รู้ไลน์ = บล็อก
     · วัด 24/11: ใบ AM อนุมัติแล้ว 790 ใบ ผู้อนุมัติ 7 คน — ทุกใบอยู่ไลน์ในส่วนงานของผู้อนุมัติ (ไม่มีใครถูกตัด) */
  const amLineCtx = useMemo(() => ({ role: userRole, section: homeSection, sections: mySections, allUnits, respCostCenters, scopeIdx, writeUnits }),
    [userRole, homeSection, mySections, allUnits, respCostCenters, scopeIdx, writeUnits])
  /* 🔧 เจอ NG → เปิดใบแจ้งซ่อม MO ต่อได้เลย (2026-09-02 · feedback หน้างาน)
     ⚠️ **ระบบเสนอ คนกดยืนยัน** ห้ามเปิดใบให้อัตโนมัติ (กฎเดิมทั้งโปรเจค) —
        ใบซ่อมเป็นงานที่มีคนต้องรับผิดชอบจริง ไม่ใช่ผลข้างเคียงของการกดบันทึก */
  const [moPrompt, setMoPrompt] = useState(null)   // { insp, ngTopics } หลังบันทึกเจอ NG
  const [moTeam, setMoTeam] = useState('maintenance')
  const [moSaving, setMoSaving] = useState(false)
  const [moByInsp, setMoByInsp] = useState({})     // inspection_id → { id, mo_no } (กันเปิดซ้ำ + โชว์ในประวัติ)
  // 🔧 B3 — AM เจอ NG: "ไว้ก่อน" ต้องมีเหตุผล (เก็บที่ inspections.mo_waived_reason) — ห้ามปิดหน้าต่างเปล่าๆ
  const [moWaiving, setMoWaiving] = useState(false)
  const [moWaiveReason, setMoWaiveReason] = useState('')
  // ✍️ B2 — ใบในประวัติเป็นของทีม AM ไหม (ตาม checklist ของใบ ไม่ใช่แท็บที่เปิด) + ตำแหน่งคนตรวจ (สายอนุมัติ)
  const [clDeptById, setClDeptById] = useState({})
  /* 🔀 ประวัติของอุปกรณ์ที่ตรวจหลายทีม — ดู src/utils/pmTeams.js §1 อุปกรณ์ ตรวจได้หลายทีม */
  const [histOther, setHistOther] = useState([])       // ใบของทีมอื่นบนเครื่องเดียวกัน (โหลดเมื่อกดดู)
  const [histMeta, setHistMeta] = useState(null)       // { otherN, unknownN, otherTeams, teamsKnown }
  const [showOther, setShowOther] = useState(false)
  const [inspPosById, setInspPosById] = useState({})   // inspector_id → position · ไม่มีคีย์ = ไม่รู้
  // 🪪 B4 — ใบที่มีรหัสบัตร: ผู้ตรวจ = คนตามบัตร (normBadgeCode → { id, position }) · พนักงานของบัญชีที่ login (ใบตัวเอง)
  const [inspEmpByCode, setInspEmpByCode] = useState({})
  const [myEmployeeId, setMyEmployeeId] = useState(undefined)   // undefined = ยังไม่รู้ · null = บัญชีนี้ไม่ผูกพนักงาน
  // สิทธิ์บันทึกแยกแกน AM (พนักงานหน้างาน) / PM (ช่าง) ตามชนิดงานของทีมที่เปิดอยู่
  //   ห้าม hardcode 'pm' — ทีมไหนเป็น AM อ่านจาก mtn_teams.kind (ดู utils/pmTeams.js)
  const canRecord = useMemo(() => {
    const [res, act] = recordPermFor(department)
    return can(res, act, userRole) && deptWrite.ok
  }, [department, userRole, deptWrite])
  const [jigs, setJigs] = useState([])
  const [listErr, setListErr] = useState('')         // โหลดลิสต์ไม่ครบ — โชว์แถบเตือนเหนือรายการ
  const [selectedJig, setSelectedJig] = useState(null)
  const [checklistId, setChecklistId] = useState(null)
  const [loadedCps, setCheckpoints] = useState([])   // จุดตรวจทั้งใบที่โหลดมา
  /* 🗓️ รอบตรวจรายหัวข้อ AM (26/11 · utils/amCheckFreq.js) — ข้อรายวัน/สัปดาห์/เดือนที่ "ตรวจในรอบนี้แล้ว" ซ่อนไว้ + บอกจำนวน
     `checkpoints` ข้างล่าง = ข้อที่ต้องตรวจกะนี้ (ตัวตั้งของ "ครบ/ขาด" · แถวผลตรวจ · หมุด) · ใบ PM ของช่างไม่ใช้ (notDue ว่างเสมอ) */
  const [freqInfo, setFreqInfo] = useState({ key: '', notDue: new Map(), err: '' })
  const [showNotDue, setShowNotDue] = useState(false)
  const [spcCp, setSpcCp] = useState(null)   // 📈 หน้าต่างกราฟ SPC ของข้อ (26/11)
  const checkpoints = useMemo(() => (showNotDue || !freqInfo.notDue.size ? loadedCps : loadedCps.filter(c => !freqInfo.notDue.has(c.id))),
    [loadedCps, freqInfo, showNotDue])
  const [otherDepts, setOtherDepts] = useState([])   // แผนกอื่นที่ลงจุดตรวจของเครื่องนี้ไว้ (โชว์เมื่อแผนกปัจจุบันยังไม่มี)
  /* 🔴 กันคำตอบเก่าทับเครื่องใหม่ (stale-response · 2026-10-19 audit PM)
     สลับเครื่องเร็วๆ = คิวรีของเครื่องก่อนตอบทีหลัง แล้วเขียน checklistId/จุดตรวจ/รูป ของเครื่องเก่าทับ
     ⇒ กดบันทึก = ผลตรวจลงผิดใบ (jig_id เครื่องใหม่ + checklist_id เครื่องเก่า) · หมุดขึ้นบนรูปผิดเครื่อง
     ทุก callback ต้องเทียบ `loadReqRef` · บันทึกได้เฉพาะเมื่อ `cpLoad` เป็นของเครื่อง+แผนกที่เปิดอยู่ */
  const loadReqRef = useRef(0)
  const curJigRef = useRef(null)
  const [cpLoad, setCpLoad] = useState({ key: null, status: 'idle', msg: '' }) // status: loading | ok | error
  /* 🚩 ประวัติ NG รายจุด + ใบซ่อม + สถานะเครื่อง (19/11) — ป้อนให้กฎ `carryNgReason()`
     🔴 อ่านไม่ได้ = ไม่ยก (fail-closed) แต่ต้องเขียนบนจอ ห้ามกลืนเป็น "ไม่เคย NG" */
  const [ngHist, setNgHist] = useState({ byCp: {}, machine: null, error: '' })
  const [cpReload, setCpReload] = useState(0)
  const [frames, setFrames] = useState([])          // jig_images (360° spin) ของอุปกรณ์ที่เลือก
  const [activeCpId, setActiveCpId] = useState(null) // จุดที่กำลังโฟกัส (sync รูป ↔ checklist)
  const [activeShimId, setActiveShimId] = useState(null) // จุดชิมที่กำลังโฟกัส (โหมดจิ้มหมุด)
  /* 📍 โหมดจิ้มหมุด (2026-09-23 · user: "ให้ขึ้นแค่ข้อที่จิ้มจุดนั้นเพื่อตรวจ ก็ดีนะ
     ได้ไม่รก ไม่ต้องเลื่อนหา") — แตะหมุดบนรูป = โชว์เฉพาะข้อนั้นข้างใต้ ไม่ต้องเลื่อนหา
     🔴 ซ่อนข้ออื่น "ได้เฉพาะเมื่อจอยังบอกความจริง" — แถบบนต้องบอกตลอดว่าตรวจไปกี่ข้อ
        เหลือกี่ข้อ + มีชิปข้อที่ยังไม่ตรวจให้กดข้าม และสลับกลับ "ดูทุกข้อ" ได้ตลอด
        (กฎความซื่อสัตย์ของจอ — ซ่อนแล้วคนลืมตรวจ = ใบตรวจผ่านทั้งที่ยังไม่ได้ตรวจ) */
  const [pinFocus, setPinFocus] = useState(true)
  const rowRefs = useRef({})                          // แถวเช็คแต่ละจุด (เลื่อนหาเมื่อคลิกหมุด)
  /* 📌 รูปเครื่องเป็น "แถบติดบน" ตอนจอแคบ — พับเก็บได้ (จำต่อเครื่อง)
     ⚠️ ต้อง **วัดความสูงจริง** ไม่ใช่เดา เพราะเอาไปตั้ง `scrollMarginTop` ของแถวเช็ค
        (กฎ §6.8) — เดาแล้วตอนคลิกหมุด แถวจะถูกเลื่อนไปซ่อนใต้รูปพอดี */
  const [viewerOpen, setViewerOpen] = useState(() => {
    try { return localStorage.getItem('pm_viewer_open') !== '0' } catch { return true }
  })
  const toggleViewer = () => setViewerOpen(v => {
    try { localStorage.setItem('pm_viewer_open', v ? '0' : '1') } catch { /* private mode */ }
    return !v
  })
  const viewerRef = useRef(null)
  const [viewerH, setViewerH] = useState(0)
  // ความสูงจริงของแถบความคืบหน้าที่ติดบน — บวกเข้า scrollMarginTop ของแถว (ไม่งั้นแถวที่เลื่อนไปหาจะนอนใต้แถบ)
  const progRef = useRef(null)
  const [progH, setProgH] = useState(0)
  // มือถือ/แท็บเล็ต: master-detail — โชว์ "ลิสต์อุปกรณ์" หรือ "ฟอร์มเช็ค" ทีละอัน (ไม่อัด 2 คอลัมน์)
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches)
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1180px)').matches)
  useEffect(() => {
    const mqN = window.matchMedia('(max-width: 860px)'), mqW = window.matchMedia('(min-width: 1180px)')
    const on = () => { setIsNarrow(mqN.matches); setIsWide(mqW.matches) }
    mqN.addEventListener('change', on); mqW.addEventListener('change', on)
    return () => { mqN.removeEventListener('change', on); mqW.removeEventListener('change', on) }
  }, [])
  const [tab, setTab] = useState('record')
  // 🔩 จุดชิมของ fixture ตัวที่เลือก (machines.id = jigs.machine_id) + ค่าที่กรอกในใบนี้ {pointId: {mm, note}}
  const [shimPoints, setShimPoints] = useState([])
  const [shimVals, setShimVals] = useState({})
  const [shimKinds, setShimKinds] = useState(DEFAULT_POINT_KINDS)
  /* 🔩 ใบ AM = ดูค่าชิมได้อย่างเดียว (26/11 · คำสั่ง user "shim record เป็นงานของส่วนช่าง")
     บันทึกค่าชิมได้เฉพาะใบ PM ของทีมช่าง — กันฝั่งผลิตไปแก้ค่าชิมในทะเบียนจุดชิมของ JIG MTN (คลาสเดียวกับบั๊กรูปปน 26/11) */
  const shimAmReadOnly = isAmTeam(department)
  const canShim = can('fixture_shim', 'record', userRole) && !shimAmReadOnly
  // 🔎 ค้นในลิสต์เครื่อง (feedback 2026-09-08: JIG MTN มี 60+ เครื่อง ไล่เลื่อนหาเอง) — เทียบเลขเครื่อง/ชื่อ/ไลน์
  const [jigQuery, setJigQuery] = useState('')
  /* 🗂️ ลิสต์ซ้ายแท็บช่าง (PM) — จัดกลุ่มตามไลน์ + กรองขอบเขตไลน์ (20/10 audit หน้า PM ข้อ 6)
     ⚠️ กรองการดูเท่านั้น ไม่ตัดตามส่วนงานของผู้ใช้ — ช่างซ่อมข้ามไลน์เป็นงานปกติ (แกนสิทธิ์ช่าง = ทีม) */
  const { rows: lineRows } = useProductionLinesState()
  const amLineWriteOf = (lineName) => canWriteLine(amLineCtx, lineName, lineRows, { unknownTarget: 'block' })
  const scopeLines = useMemo(() => {   // ชื่อไลน์ซ้ำในทะเบียน = key ซ้ำในตัวเลือก ⇒ ยุบด้วยชื่อ
    const seen = new Set()
    return (lineRows || []).filter(l => l?.name && !seen.has(l.name) && seen.add(l.name))
  }, [lineRows])
  const [jigScope, setJigScope] = useState({ section: '', line: '', names: null })
  /* 🔒 แท็บ AM (ผลิตตรวจเอง) = เห็นเฉพาะไลน์ของตัวเอง (11/11 · คำสั่ง user "ล็อกเห็นเฉพาะไลน์ตัวเอง")
     เดิมลิสต์ทุกไลน์ที่ลงทะเบียน AM ทั้งโรงงาน ⇒ พนักงานเห็นเครื่องข้ามไลน์ปนกัน
     แกนเดียวของ "บัญชีนี้เห็นไลน์ไหน" = `lineScope()` (utils/sectionScope.js) ห้ามคิดเองในหน้า
     · unlimited (admin / ขอบเขตไม่จำกัด) = เห็นทั้งโรงงานเหมือนเดิม · unsure = เขียนบนจอ
     · แท็บช่าง (PM) ไม่ล็อก — ช่างซ่อมข้ามไลน์เป็นงานปกติ (แกนสิทธิ์ช่าง = ทีม) */
  const amScope = useMemo(() => lineScope({ role: userRole, lineId: myLineId, sections: mySections, lines: scopeLines, scopeIdx }),
    [userRole, myLineId, mySections, scopeLines, scopeIdx])
  const amScopeSet = useMemo(() => (amScope.unlimited ? null : new Set(amScope.names)), [amScope])
  const [chipsAll, setChipsAll] = useState(false)   // ชิปข้อที่ยังไม่ตรวจ: เกิน CHIP_CAP พับไว้ กดขยายได้
  const [scanOpen, setScanOpen] = useState(false)   // 📷 สแกนป้ายเครื่อง → เลือกอุปกรณ์
  const [rawResults, setResults] = useState({})   // ที่คนกรอก
  /* 🧮 จุดคำนวณ (A − B) เติมค่า ①②③ จากจุด A/B ให้เอง — ทุกที่ที่อ่าน `results` (ตัดสิน/นับครบ/บันทึก) เห็นค่าชุดเดียวกัน */
  const results = useMemo(() => pmCalcResults(checkpoints, rawResults), [checkpoints, rawResults])
  const [notes, setNotes] = useState('')
  /* ✍️ รหัสผู้ตรวจจริง — คงค่าข้ามเครื่องในแท็บนี้ (คนเดียวไล่ตรวจหลายเครื่องติดกัน) · ล้างเมื่อปิดแท็บ */
  const [inspectorCode, setInspectorCodeRaw] = useState(() => { try { return sessionStorage.getItem('pm:inspector_code') || '' } catch { return '' } })
  const setInspectorCode = (v) => { setInspectorCodeRaw(v); try { v ? sessionStorage.setItem('pm:inspector_code', v) : sessionStorage.removeItem('pm:inspector_code') } catch { /* ไม่มี storage = จำไม่ได้ ไม่พัง */ } }
  /* 🪪 B4 (10/11) — ใบ AM: เปลี่ยนเครื่อง = ล้างรหัสบัตร · หัวหน้าเดินไล่ทีละเครื่องทีละคน
     จำข้ามเครื่อง = ลืมสแกนเครื่องถัดไปแล้วชื่อคนก่อนหน้าติดไปทั้งไลน์ (ชื่อผิดคน) · ใบ PM ช่าง = จำต่อเหมือนเดิม */
  useEffect(() => {
    if (isAmTeam(department)) setInspectorCode('')
  }, [selectedJig?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  /* ผู้ตรวจตัวจริงของใบในประวัติ — มีรหัสบัตร = คนตามบัตร (กฎใน amInspectorIdentity) */
  const inspectorOf = (insp) => amInspectorIdentity(insp, { empByCode: inspEmpByCode, posByUid: inspPosById, myUid: userId, myEmployeeId: myEmployeeId ?? null })
  const [saving, setSaving] = useState(false)
  /* 📝 ร่างในเครื่อง (มือถือ · 22/10 · audit handheld ข้อ 4) — ผลตรวจบันทึกทีเดียวตอนท้าย และ "เปลี่ยน/สแกนเครื่องอื่น"
     ล้างทุกช่องที่กรอกทันที ⇒ เก็บร่างต่อ เครื่อง|แผนก|คนกรอก แล้วถามกู้คืนเมื่อกลับมาเครื่องเดิม (utils/formDraft.js) */
  const isMobileView = useIsMobile()
  const [pendingDraft, setPendingDraft] = useState(null)
  const [inspections, setInspections] = useState([])
  const [viewInspection, setViewInspection] = useState(null)
  const [methodIndex, setMethodIndex] = useState({})
  const [teams, setTeams] = useState(pmTeamsSync())      // ทีมช่าง data-driven (mtn_teams)
  const [clDeptByJig, setClDeptByJig] = useState({})     // jig_id → Set(department) — ยึด department เป็นหลัก

  useEffect(() => { loadPmTeams().then(setTeams) }, [])
  // แผนกของแต่ละ jig จาก checklist ที่มีอยู่ (ยึด department เป็นหลักตามที่ user ยืนยัน)
  useEffect(() => {
    supabaseDR.from('checklists').select('equipment_id, department').eq('module', 'mtn').then(({ data, error }) => {
      if (error) setListErr(e => e || `${tr("รายการตรวจของแต่ละเครื่อง")}: ${error.message}`)
      const m = {}; (data ?? []).forEach(c => { (m[c.equipment_id] ||= new Set()).add(c.department) }); setClDeptByJig(m)
    })
  }, [])

  // ตัวตนคนกด (uid) — role/ชื่อ อ่านจาก context ข้างบนแล้ว ไม่ยิง `profiles` ซ้ำ
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id ?? null))
  }, [])
  // 🪪 B4 — บัญชีนี้ผูกพนักงานคนไหน (ตัดสิน "สแกนบัตรตัวเอง = ใบตัวเอง") · อ่านไม่ได้ = undefined (ไม่รู้ ห้ามเดาว่าไม่ใช่)
  useEffect(() => {
    if (!userId) return undefined
    let alive = true
    supabase.from('profiles').select('employee_id').eq('id', userId).maybeSingle().then(({ data, error }) => {
      if (alive) setMyEmployeeId(error ? undefined : (data?.employee_id ?? null))
    })
    return () => { alive = false }
  }, [userId])

  useEffect(() => {
    // เลือกเฉพาะคอลัมน์ที่จอใช้ (กฎ egress ข้อ 11) · อ่านไม่ได้ต้องบอก ห้ามขึ้น "ยังไม่มีอุปกรณ์"
    supabaseDR.from('jigs').select(JIG_COLS).eq('module', 'mtn').order('name').then(({ data, error }) => {
      if (error) setListErr(e => e || `${tr("ทะเบียนอุปกรณ์")}: ${error.message}`)
      setJigs(data ?? [])
    })
    fetchCategories() // primes the category color cache used by categoryColor()
    supabaseDR.from('fixture_point_kinds').select('*').eq('is_active', true).order('sort_order').then(({ data }) => { if (data?.length) setShimKinds(data) })
    fetchCheckingMethods().then(rows => setMethodIndex(indexByCode(rows)))
  }, [])

  // ── โหมดฝ่ายผลิต: รายการเครื่องซ้ายมือต้องเป็น "เครื่องที่ลงทะเบียน Daily PM" เท่านั้น ──
  // จัดกลุ่มตามไลน์ + สถานะว่ากะนี้ตรวจแล้วหรือยัง — ไม่ใช่เครื่องทุกตัวทุกแผนกแบบแท็บซ่อมบำรุง
  const [dailyLineByJig, setDailyLineByJig] = useState(null)   // jig_id -> [line_name] (null = แท็บอื่น)
  const [checkedThisShift, setCheckedThisShift] = useState({}) // jig_id -> 'pass' | 'fail'
  useEffect(() => {
    // 🔗 ทีม AM = `isAmTeam` (ห้าม hardcode 'production') · กะ/เวลาเริ่มกะ = `amShiftInfo` ชุดเดียวกับจอ AM/ผังรวมโรงงาน (08/10)
    if (!isAmTeam(department)) { setDailyLineByJig(null); setCheckedThisShift({}); return }
    let cancelled = false
    ;(async () => {
      const [{ data: tg, error: eTg }, { data: amCls, error: eCl }] = await Promise.all([
        supabaseDR.from('pm_daily_line_targets').select('jig_id, line_name').eq('is_active', true),
        supabaseDR.from('checklists').select('id, department').eq('module', 'mtn'),
      ])
      const ws = amShiftInfo().shiftStart
      const clIds = new Set((amCls ?? []).filter(c => isAmTeam(c.department)).map(c => c.id))
      const { data: insp, error: eIn } = await supabaseDR.from('inspections')
        .select('jig_id, status, checklist_id')
        .gte('inspected_at', ws.toISOString())
        .order('inspected_at', { ascending: false })
      if (cancelled) return
      // อ่านไม่ได้ = ป้าย "รอตรวจ/ยังไม่ลงทะเบียน" ในลิสต์ไม่จริง — ต้องเขียนบอก
      const eAm = eTg || eCl || eIn
      if (eAm) setListErr(e => e || `${tr("สถานะตรวจกะนี้")}: ${eAm.message}`)
      const st = {}
      for (const i of insp ?? []) {
        if (!clIds.has(i.checklist_id)) continue
        if (!st[i.jig_id]) st[i.jig_id] = i.status // ล่าสุดชนะ (เรียง desc แล้ว)
      }
      const byJig = {}
      ;(tg ?? []).forEach(t => { (byJig[t.jig_id] ||= []).push(t.line_name) })
      setDailyLineByJig(byJig)
      setCheckedThisShift(st)
    })()
    return () => { cancelled = true }
  }, [department])

  useEffect(() => {
    if (!equipParam || jigs.length === 0) { setSelectedJig(null); return }
    setSelectedJig(jigs.find(j => j.id === equipParam) ?? null)
  }, [equipParam, jigs])

  // คง line filter (?line=) ไว้ตอนเลือกเครื่อง — มาจากปุ่ม "ไปหน้าตรวจ" ของ Daily PM รายไลน์
  const lineFilter = searchParams.get('line')
  /* ⚠️ ทุกตัวต้อง merge param เดิม — เขียน setSearchParams({...}) ตรงๆ จะล้าง ?tab= ของ PmHub
     แล้วจอเด้งออกจากแท็บที่ใช้อยู่ (บั๊กจริง 2026-09-16) · ล้าง param ตั้งใจด้วยค่า null */
  const pmDraftKey = isMobileView && selectedJig && userId && cpLoad.status === 'ok' && cpLoad.key === `${selectedJig.id}|${department}`
    ? `pm:${cpLoad.key}:${userId}` : null
  const pmDirty = !!pmDraftKey && !pendingDraft && pmHasInput(rawResults, notes)
  useDraftAutosave(pmDraftKey, { results: rawResults, notes }, pmDirty)
  const restorePmDraft = () => {
    const d = pendingDraft?.data; if (!d) return
    // เติมเฉพาะจุดตรวจที่ยังมีอยู่ในใบตอนนี้ (จุดที่ถูกลบออกจากเช็คลิสต์ทีหลัง ไม่เอากลับมา)
    setResults(prev => { const n = { ...prev }; Object.entries(d.results || {}).forEach(([k, v]) => { if (k in n) n[k] = { ...n[k], ...v } }); return n })
    if (d.notes) setNotes(d.notes)
    setPendingDraft(null)
  }
  const selectJigRaw = (jig) => setParams({ equip: jig.id })
  // มือถือ: เปลี่ยนเครื่องกลางฟอร์ม = บอกว่าเก็บร่างไว้แล้ว (เดิมล้างทุกช่องเงียบๆ) · ไม่ถาม/ไม่บล็อก — กลับมาเครื่องเดิมกู้คืนได้
  const selectJig = (jig) => {
    if (pmDirty && jig?.id !== selectedJig?.id) toast.info(`📝 ${tr("เก็บร่างผลตรวจ")} ${selectedJig?.name || ''} ${tr("ไว้ในเครื่องแล้ว — กลับมาเลือกเครื่องนี้เพื่อกู้คืน")}`)
    selectJigRaw(jig)
  }
  const clearJig = () => setParams({ equip: null })            // กลับไปลิสต์ (จอแคบ)
  const setDept = (d) => setParams({ dept: d, line: null })    // เปลี่ยนแผนก = ล้างตัวกรองไลน์ (พฤติกรรมเดิม)

  /* 📜 ประวัติการตรวจของเครื่องนี้ — **ของทีมที่กำลังดูเท่านั้น**  (แก้ 2026-11-10 · คำสั่ง user)

     🔴 เดิมดึงด้วย `.eq('jig_id', jigId)` ล้วน + `limit(30)` ⇒ เครื่องที่มี checklist ทั้ง AM และ PM
        (วัดจริง DR 6 เครื่อง / 112 ใบ) ได้ใบของทั้ง 2 ทีม **ปนกันในลิสต์เดียวโดยไม่มีอะไรบอกว่าใบไหนของใคร**
        และโควตา 30 ใบถูกใช้ร่วมกัน ⇒ ทีมที่ตรวจถี่กว่ากินช่องจนใบของอีกทีมหลุดหาย
        (PF-H101: AM 22 ใบ · DIE MTN 1 ใบ — ใบช่างมีสิทธิ์ไม่โผล่เลย)
     🔑 ลำดับสำคัญ: **ถามทีมของ checklist ก่อน แล้วจึงดึงใบ** — รู้ทีหลังแก้โควตาที่ถูกกินไปแล้วไม่ได้
     🔴 อ่านทีมไม่ได้ = ถอยไปพฤติกรรมเดิม (ดึงด้วย jig_id) + `teamsKnown:false` ให้จอเขียนว่าอาจปนทีม
        **ห้ามโชว์ลิสต์ว่างเงียบๆ** · ใบที่ชี้ทีมไม่ได้นับเป็น `unknownN` เขียนบนจอ ไม่กลืน   */
  const fetchHistory = async (jigId) => {
    setShowOther(false); setHistOther([])
    /* ① ทีมเจ้าของทุก checklist ของเครื่องนี้ (ไม่ใช่แค่ของใบที่ดึงมา) */
    const clRes = await supabaseDR.from('checklists').select('id, department').eq('equipment_id', jigId).eq('module', 'mtn')
    if (curJigRef.current !== jigId) return // เปลี่ยนเครื่องไปแล้ว — คำตอบนี้เป็นของเครื่องก่อน
    const teamsKnown = !clRes.error
    if (clRes.error) toast.error(`${tr("อ่านทีมของใบตรวจไม่สำเร็จ — ประวัติอาจปนทีมอื่น")}: ${clRes.error.message}`)
    const clRows = clRes.data ?? []
    setClDeptById(Object.fromEntries(clRows.map(c => [c.id, c.department])))
    const mineIds = clRows.filter(c => c.department === department).map(c => c.id)
    const otherIds = clRows.filter(c => c.department !== department).map(c => c.id)

    /* ② ใบของทีมนี้ (โควตา 30 ใบเป็นของทีมนี้คนเดียว) · อ่านทีมไม่ได้ = ถอยไปดึงทั้งเครื่องแบบเดิม */
    const base = () => supabaseDR.from('inspections').select('*').order('inspected_at', { ascending: false }).limit(30)
    let data = [], eH = null
    if (!teamsKnown) ({ data, error: eH } = await base().eq('jig_id', jigId))
    else if (mineIds.length) ({ data, error: eH } = await base().in('checklist_id', mineIds))
    if (curJigRef.current !== jigId) return
    if (eH) toast.error(`${tr("โหลดประวัติการตรวจไม่สำเร็จ")}: ${eH.message}`)
    setInspections(data ?? [])

    /* ③ นับใบของทีมอื่น + ใบที่ชี้ทีมไม่ได้ (ไม่ดึงเนื้อถ้าไม่กดดู) — ตัวเลขต้องขึ้นจอ ห้ามเงียบ
       นับไม่ได้ = `null` ให้จอเขียนว่าไม่รู้ **ห้ามแสดงเป็น 0** (0 = "ไม่มีใบของทีมอื่น" คนละเรื่อง) */
    if (!teamsKnown) setHistMeta({ otherN: null, unknownN: null, otherTeams: [], teamsKnown: false })
    else {
      const headCount = (ids) => (ids.length
        ? supabaseDR.from('inspections').select('id', { count: 'exact', head: true }).in('checklist_id', ids)
        : Promise.resolve({ count: 0, error: null }))
      const [oRes, mRes, allRes] = await Promise.all([
        headCount(otherIds), headCount(mineIds),
        supabaseDR.from('inspections').select('id', { count: 'exact', head: true }).eq('jig_id', jigId),
      ])
      if (curJigRef.current !== jigId) return
      const otherN = oRes.error ? null : (oRes.count ?? 0)
      const mineN = mRes.error ? null : (mRes.count ?? 0)
      /* ใบของเครื่องนี้ที่ไม่ได้ผูก checklist ของเครื่องนี้เลย = ชี้ทีมไม่ได้ (วัดจริง 10/11 = 0 ใบ) */
      const unknownN = (allRes.error || otherN === null || mineN === null)
        ? null : Math.max(0, (allRes.count ?? 0) - otherN - mineN)
      const oTeams = [...new Set(clRows.filter(c => c.department !== department).map(c => c.department).filter(Boolean))]
      setHistMeta({ otherN, unknownN, otherTeams: oTeams, otherIds, teamsKnown: true })
    }

    /* ✍️ B2 — ตำแหน่งคนตรวจ (Main) · อ่านไม่ได้ = ไม่รู้ ⇒ สายอนุมัติไม่บล็อกแต่เขียนบนจอ */
    const uids = [...new Set((data ?? []).map(i => i.inspector_id).filter(Boolean))]
    // 🪪 B4 — ใบที่มีรหัสบัตร ตำแหน่งผู้ตรวจ = ของคนตามบัตร (ค้นทั้งค่าดิบ + ค่าที่ปรับรูป แล้วตัดสินด้วย findByBadge)
    const codes = [...new Set((data ?? []).flatMap(i => i.inspector_code ? [i.inspector_code, normBadgeCode(i.inspector_code)] : []))]
    const [pRes, eRes] = await Promise.all([
      uids.length ? supabase.from('profiles').select('id, position').in('id', uids) : Promise.resolve({ data: [] }),
      codes.length ? supabase.from('employees').select('id, employee_id_code, position').in('employee_id_code', codes) : Promise.resolve({ data: [] }),
    ])
    if (curJigRef.current !== jigId) return
    if (pRes.error) toast.error(`${tr("อ่านตำแหน่งคนตรวจไม่สำเร็จ — ลำดับขั้นอนุมัติ AM จะไม่ถูกตรวจ")}: ${pRes.error.message}`)
    setInspPosById(Object.fromEntries((pRes.data ?? []).filter(p => p.position).map(p => [p.id, p.position])))
    if (eRes.error) toast.error(`${tr("อ่านตำแหน่งผู้ตรวจตามบัตรไม่สำเร็จ — ลำดับขั้นอนุมัติ AM จะไม่ถูกตรวจ")}: ${eRes.error.message}`)
    setInspEmpByCode(Object.fromEntries((data ?? []).filter(i => i.inspector_code).map(i => {
      const e = findByBadge(eRes.data ?? [], i.inspector_code)
      return [normBadgeCode(i.inspector_code), e ? { id: e.id, position: e.position || null } : null]
    }).filter(([, v]) => v)))
    /* ผลตรวจ NG ใบไหนเปิดใบซ่อมไปแล้วบ้าง — กันเปิดซ้ำ + ให้กลับมาเปิดทีหลังได้ถ้าตอนนั้นกด "ไว้ก่อน"
       (ไม่งั้นเป็นทางตัน: ข้ามครั้งเดียวแล้วไม่มีทางเปิดจากผลตรวจใบนั้นอีกเลย)
       ⚠️ tolerant กับ 42703 — ยังไม่ apply migration ต้องใช้หน้านี้ได้ตามปกติ */
    const failIds = (data ?? []).filter(i => i.status === 'fail').map(i => i.id)
    if (!failIds.length) { setMoByInsp({}); return }
    const { data: mos, error } = await supabaseDR.from('mtn_orders')
      .select(AM_MO_COLS).in('source_inspection_id', failIds)   // คอลัมน์ครบให้ moStatusLabel() ตัดสินได้
    if (curJigRef.current !== jigId) return
    if (error) { setMoByInsp({}); return }
    const m = {}; (mos ?? []).forEach(o => { m[o.source_inspection_id] = o })
    setMoByInsp(m)
  }

  /* 👀 กดดูใบของทีมอื่นบนเครื่องเดียวกัน — โหลดตอนกด ไม่ดึงมาเปล่าๆ (egress · กฎเขียน DB ข้อ 11)
     ปิดแล้วเปิดใหม่ไม่ดึงซ้ำ · ล้างทุกครั้งที่เปลี่ยนเครื่อง (fetchHistory) */
  const toggleOtherHist = async () => {
    if (showOther) { setShowOther(false); return }
    const ids = histMeta?.otherIds ?? []
    if (!ids.length) { setShowOther(true); return }
    if (histOther.length) { setShowOther(true); return }
    const jigId = curJigRef.current
    const { data, error } = await supabaseDR.from('inspections').select('*')
      .in('checklist_id', ids).order('inspected_at', { ascending: false }).limit(30)
    if (curJigRef.current !== jigId) return
    if (error) { toast.error(`${tr("โหลดใบของทีมอื่นไม่สำเร็จ")}: ${error.message}`); return }
    setHistOther(data ?? [])
    setShowOther(true)
  }

  /* ทีมช่างตั้งต้นของใบซ่อมที่จะเปิด
     ⚠️ AM = ผลิตตรวจเอง — เจอ NG แล้ว **ส่งกลับให้ผลิตซ่อมเองไม่ได้** ต้องเดาทีมช่างจากชนิดอุปกรณ์
        (jig → JIG MTN · die → DIE MTN · อื่น → MTN) แล้วให้คนเลือกทับได้เสมอ */
  const defaultMoTeam = () => (isAmTeam(department)
    ? (teamForEquipmentKind(selectedJig?.equipment_type) || 'maintenance')
    : (teamKeyOf(department) || 'maintenance'))

  /* 🧩 23/11 สถานี AM: ใบรวมบันทึกหลายอุปกรณ์ทีเดียว ⇒ prompt ต้องรู้ "อุปกรณ์ของใบนี้" (ไม่ใช่ selectedJig เสมอ)
     + ทีมเจ้าของ PM ของตัวนั้น (gripper → JIG MTN · robot → MTN) · NG หลายตัว = ต่อคิวเปิดทีละใบ */
  const [moQueue, setMoQueue] = useState([])
  /* 🧩 สถานี AM (23/11) — โหมด AM เท่านั้น · อ่านไม่ได้ = ใช้ใบเดี่ยวเหมือนเดิม + บอกบนจอ (ไม่บล็อกการตรวจ) */
  const [amSt, setAmSt] = useState({ stations: [], members: [], err: '' })
  const [singleJigId, setSingleJigId] = useState(null)   // กด "ประวัติเครื่องนี้" จากใบสถานี = ดูใบเดี่ยวของเครื่องนั้น
  useEffect(() => {
    if (!amMode) return undefined
    let alive = true
    Promise.all([
      supabaseDR.from('am_stations').select('id, name, line_name, is_active, sort_order').eq('is_active', true),
      supabaseDR.from('am_station_members').select('station_id, jig_id, sort_order'),
    ]).then(([a, b]) => {
      if (!alive) return
      if (a.error || b.error) { setAmSt(p => ({ ...p, err: (a.error || b.error).message })); return }
      setAmSt({ stations: a.data || [], members: b.data || [], err: '' })
    })
    return () => { alive = false }
  }, [amMode])
  const stationIx = useMemo(() => buildStationIndex(amSt.stations, amSt.members), [amSt])
  const station = (amMode && selectedJig && singleJigId !== selectedJig.id) ? (stationIx.byJig.get(selectedJig.id) || null) : null
  const stationJigs = useMemo(() => (station ? stationIx.membersOf(station.id).map(id => jigs.find(j => j.id === id)).filter(Boolean) : []),
    [station, stationIx, jigs])
  /** ทีมเจ้าของ PM ของอุปกรณ์ (ทีมช่างที่มีใบตรวจของตัวนี้) — ใบซ่อมจาก NG ในใบสถานีวิ่งไปทีมนี้ (gripper → JIG MTN) */
  const ownerTeamOf = (jig) => [...(clDeptByJig[jig?.id] || [])].find(d => !isAmTeam(d))
    || teamForEquipmentKind(jig?.equipment_type) || 'maintenance'
  const openMoPrompt = (insp, ngTopics, jig = null, team = null) => {
    setMoTeam(team || defaultMoTeam()); setMoWaiving(false); setMoWaiveReason('')
    setMoPrompt({ insp, ngTopics, jig: jig || selectedJig })
  }
  useEffect(() => {
    if (moPrompt || !moQueue.length) return
    const [next, ...rest] = moQueue
    setMoQueue(rest)
    openMoPrompt(next.insp, next.ngTopics, next.jig, next.team)
  }, [moPrompt, moQueue]) // eslint-disable-line react-hooks/exhaustive-deps

  /* 🔧 B3 (02/11) — AM เจอผิดปกติ ⇒ ต้องเปิด MO **หรือ** เขียนเหตุผลว่าทำไมไม่เปิด (บอร์ด AM เห็นทั้งคู่)
     🔴 ยังไม่ apply migration (ไม่มีคอลัมน์ mo_waived_reason) = ข้ามไม่ได้ ต้องเปิด MO (fail-closed + บอกบนจอ) */
  const isAmPrompt = moPrompt ? isAmTeam(clDeptById[moPrompt.insp?.checklist_id] ?? department) : false
  const waiveMo = async () => {
    if (!moPrompt) return
    const reason = moWaiveReason.trim()
    if (!amWaiverReasonValid(reason)) { toast.error(`${tr("เขียนเหตุผลอย่างน้อย")} ${AM_WAIVER_MIN_LEN} ${tr("ตัวอักษร")}`); return }
    setMoSaving(true)
    try {
      const res = await supabaseDR.from('inspections')
        .update({ mo_waived_reason: reason, mo_waived_by: userId || null, mo_waived_at: new Date().toISOString() })
        .eq('id', moPrompt.insp.id).select('id')
      if (res.error?.code === '42703' || res.error?.code === 'PGRST204') {
        toast.error('ยังบันทึกเหตุผล "ไม่เปิดใบซ่อม" ไม่ได้ — ยังไม่ได้ apply migration 20261102_am_ng_mo_waiver_dr (แจ้ง admin) · ตอนนี้ต้องเปิดใบแจ้งซ่อม')
        return
      }
      if (!checkWriteRows(res, 'บันทึกเหตุผลที่ไม่เปิดใบซ่อม')) return
      setInspections(prev => prev.map(i => (i.id === moPrompt.insp.id ? { ...i, mo_waived_reason: reason } : i)))
      setMoPrompt(null)
      toast.success('บันทึกเหตุผลแล้ว — บอร์ด AM จะแสดงเหตุผลนี้แทนใบซ่อม')
    } finally { setMoSaving(false) }
  }

  // เปิดจากแท็บประวัติ (เคสกด "ไว้ก่อน" ตอนบันทึก) — ต้องไปหาชื่อจุดที่ไม่ผ่านของใบนั้นมาก่อน
  const openMoFromHistory = async (insp) => {
    const { data } = await supabaseDR.from('inspection_results')
      .select('checkpoint_id').eq('inspection_id', insp.id).eq('status', 'fail')
    const names = (data ?? []).map(r => checkpoints.find(c => c.id === r.checkpoint_id)?.name).filter(Boolean)
    // จุดตรวจถูกลบ/ย้ายแผนกไปแล้ว = หาชื่อไม่เจอ — ยังเปิดใบได้ แต่ต้องบอกตรงๆ ว่าดูรายละเอียดที่ผลตรวจ
    openMoPrompt(insp, names.length ? names : ['(ดูรายละเอียดในผลตรวจ)'])
  }

  const createMoFromInspection = async () => {
    const moJig = moPrompt?.jig || selectedJig   // 🧩 ใบสถานี: อุปกรณ์ของใบนี้ ไม่ใช่ตัวที่เปิดอยู่
    if (!moPrompt || !moJig) return
    const { insp, ngTopics } = moPrompt
    setMoSaving(true)
    try {
      const now = new Date()
      // วันงาน (ตัด 08:00 ตามกะ) — ห้าม toISOString (UTC เพี้ยนช่วงเช้ามืด)
      const wd = new Date(now); if (wd.getHours() < 8) wd.setDate(wd.getDate() - 1)
      const workDate = `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`
      const payload = {
        status: 'pending', current_step: 1, report_at: now.toISOString(), work_date: workDate,
        repair_scope: 'in_line',
        line_name: moJig.line_name || null,
        mtn_dept: teamKeyOf(moTeam) || 'maintenance',
        machine_no: moJig.machine_no || moJig.jig_no || null,
        /* 🔴 อาการ/กลุ่ม = หัวข้อที่ตรวจไม่ผ่านจริง **ห้าม hardcode 'อื่นๆ'** (แก้ 2026-09-23)
           บั๊กคลาสเดียวกับใบที่เปิดจากดาวน์ไทม์ — เขียน 'อื่นๆ' ทับทั้งที่ `ngTopics`
           บอกอยู่แล้วว่าไม่ผ่านข้อไหน ⇒ ใบพวกนี้ไปกองรวมในถังขยะของพาเรโต
           มีด่าน regressionGuards กฎ no-hardcoded-other-category */
        problem_characteristic: ngTopics[0] || 'อื่นๆ',
        problem_group: 'ผลตรวจ PM/AM ไม่ผ่าน',
        report_note: `[${tr("จากผลตรวจ")} ${isAmTeam(department) ? 'AM' : 'PM'}] ${moJig.name} — ${tr("จุดที่ไม่ผ่าน")}: ${ngTopics.join(', ')}`,
        // reported_by_uid: ให้ edge แจ้งกลับ "ผู้แจ้ง" ได้ทุกขั้น — เดิมหน้านี้ไม่เคยส่ง ⇒ ใบที่เปิดจากผลตรวจ PM/AM
        //   ไม่มีใครถูกเด้งตอนใบถึงคิวตัวเอง (เหตุผลเดียวกับที่ MtnRepair แก้ไปแล้ว 2026-09-14)
        reporter_prod: fullName || null, reported_by_name: fullName || null, reported_by_uid: userId || null,
        source_inspection_id: insp.id,
      }
      let { data, error } = await supabaseDR.from('mtn_orders').insert(payload).select().single()
      // ยังไม่ apply migration = ไม่มีคอลัมน์ผูกที่มา → เปิดใบได้ แต่ต้องบอกว่าผูกกลับผลตรวจไม่ได้
      if (error?.code === '42703') {
        const { source_inspection_id: _drop, ...slim } = payload // eslint-disable-line no-unused-vars
        ;({ data, error } = await supabaseDR.from('mtn_orders').insert(slim).select().single())
        if (!error) toast.info('เปิดใบซ่อมแล้ว แต่ยังผูกกลับผลตรวจไม่ได้ — ยังไม่ได้รัน migration 20260902_mtn_order_from_inspection (แจ้ง admin)')
      }
      if (error) {
        toast.error(error.code === '23505' ? 'ผลตรวจใบนี้มีใบแจ้งซ่อมอยู่แล้ว' : error.message)
        return
      }
      fetch('https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-mtn-notification', {
        // ส่ง "ชื่อทีม" ในข้อความแจ้งเตือน (DB เก็บรหัส) — เหตุผลเดียวกับ notifyMtn ใน MtnRepair.jsx
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'mtn_reported', mo: { ...data, mtn_dept: deptNameOf(data.mtn_dept) } }),
      }).catch(() => {})
      setMoByInsp(prev => ({ ...prev, [insp.id]: data }))
      setMoPrompt(null)
      toast.success(`📝 ${tr("เปิดใบแจ้งซ่อมแล้ว → แจ้งถึงทีม")} ${deptNameOf(moTeam) || 'MTN'} — ${tr("ติดตามต่อที่หน้าแจ้งซ่อม")} MTN`)
    } finally {
      setMoSaving(false)
    }
  }

  useEffect(() => {
    curJigRef.current = selectedJig?.id ?? null
    if (!selectedJig || !userId) return
    const req = ++loadReqRef.current
    const live = () => req === loadReqRef.current
    const key = `${selectedJig.id}|${department}`
    setResults({}); setNotes(''); setTab('record'); setActiveCpId(null); setPendingDraft(null)
    setShimVals({})
    // ล้างของเครื่องก่อนทันที — ระหว่างโหลดห้ามโชว์/บันทึกด้วยจุดตรวจของเครื่องเก่า
    setChecklistId(null); setCheckpoints([]); setFrames([]); setOtherDepts([]); setInspections([]); setMoByInsp({})
    setCpLoad({ key, status: 'loading', msg: '' })
    // จุดชิมของ fixture นี้ (ทะเบียน /fixture) — ไม่มี machine_id = ไม่ใช่ fixture ที่ผูกกับ machines → ไม่มีจุด
    if (selectedJig.machine_id) {
      supabaseDR.from('fixture_points').select('*').eq('machine_id', selectedJig.machine_id).eq('is_active', true).order('sort_order')
        .then(({ data, error }) => { if (!live()) return; if (error) toast.error(`${tr("โหลดจุดชิมไม่สำเร็จ")}: ${error.message}`); setShimPoints(data ?? []) })
    } else setShimPoints([])
    // เฟรมรูป 360° (ถ้าไม่มี jig_images → ใช้รูปหลัก image_path เป็นเฟรมเดียว)
    // รูปแยกตามแผนก (26/11 · utils/jigFrames.js) — เห็นเฉพาะชุดรูปของแผนกที่กำลังตรวจ
    loadDeptFrames([selectedJig.id], department).then(({ rows: data, error }) => {
      if (!live()) return
      if (error) toast.error(`${tr("โหลดรูปเครื่องไม่สำเร็จ")}: ${error.message}`)
      let fr = (data ?? []).map(im => ({ id: im.id, url: getPublicUrl(im.image_path) }))
      if (!fr.length && selectedJig.image_path) fr = [{ id: 'legacy', url: getPublicUrl(selectedJig.image_path) }]
      setFrames(fr)
    })
    // ⚠️ อ่านอย่างเดียว — แค่เปิดดูเครื่องต้องไม่สร้าง checklist ของแผนกที่กำลังดูอยู่
    //    (เดิมใช้ getOrCreateChecklist ตรงนี้ → เกิด checklist เปล่าค้างในแท็บแผนกนั้นตลอดไป)
    //    ไม่มี checklist = ไม่มีจุดตรวจ → handleSave กันไว้แล้ว (checkpoints.length === 0 = บันทึกไม่ได้)
    ;(async () => {
      let cl, cps
      try {
        cl = await findChecklist(selectedJig.id, 'mtn', department)
        const { data, error } = cl
          ? await supabaseDR.from('jig_checkpoints').select('*').eq('checklist_id', cl.id).order('sort_order')
          : { data: [], error: null }
        if (error) throw error
        cps = data ?? []
      } catch (e) {
        // อ่านไม่ได้ ≠ "ยังไม่มีรายการตรวจ" — ต้องบอกตรงๆ ให้กดลองใหม่ (กฎความซื่อสัตย์ของจอ)
        if (live()) setCpLoad({ key, status: 'error', msg: e?.message || String(e) })
        return
      }
      // 🗓️ ใบ AM: ข้อไหนถึงรอบกะนี้ (อ่านประวัติไม่ได้ = ทุกข้อถึงรอบ + เขียนบอก)
      let fInfo = { key, notDue: new Map(), err: '' }
      if (isAmTeam(department) && cps.length) {
        const ld = await loadAmCpLastDone(cps)
        const sp = splitDueCps(cps, amSlotOf(new Date()), ld.map)
        fInfo = { key, notDue: new Map(sp.notDue.map(x => [x.cp.id, x])), err: ld.error ? String(ld.error) : '' }
      }
      if (!live()) return
      setFreqInfo(fInfo); setShowNotDue(false)
      setChecklistId(cl?.id ?? null)
      setCheckpoints(cps)
      setCpLoad({ key, status: 'ok', msg: '' })
      const init = {}
      cps.forEach(c => { init[c.id] = { v1: '', v2: '', v3: '', attr: '', note: '', mval: '', reason: '', reasonAccepted: false } })
      setResults(init)
      const saved = isMobileView ? loadDraft(`pm:${key}:${userId}`) : null
      setPendingDraft(saved && pmHasInput(saved.data?.results, saved.data?.notes) ? saved : null)
      // ไม่มีจุดตรวจของแผนกนี้ → หาให้เลยว่าแผนกอื่นลงไว้ไหม จะได้ไม่ต้องไล่กดทีละแท็บ
      if (!cps.length) {
        listChecklistsByDept(selectedJig.id, 'mtn')
          .then(rows => { if (live()) setOtherDepts(rows.filter(r => r.department !== department && r.checkpointCount > 0)) })
          .catch(() => { if (live()) setOtherDepts([]) })
      }
    })()
    fetchHistory(selectedJig.id)
  }, [selectedJig, department, userId, cpReload]) // eslint-disable-line react-hooks/exhaustive-deps

  /* วัดความสูงจริงของแถบรูปที่ติดบน (จอแคบ) — เอาไปเว้น `scrollMarginTop` ให้แถวเช็ค
     ไม่วัด/เดาเลข = คลิกหมุดแล้วแถวถูกเลื่อนไปนอนใต้รูปพอดี มองไม่เห็นสิ่งที่เพิ่งกด */
  useEffect(() => {
    const el = viewerRef.current
    if (!el || typeof ResizeObserver === 'undefined') { setViewerH(0); return }
    const ro = new ResizeObserver(() => setViewerH(el.getBoundingClientRect().height))
    ro.observe(el)
    setViewerH(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [selectedJig, checkpoints, frames, viewerOpen, isNarrow, isWide])
  useEffect(() => {
    const el = progRef.current
    if (!el || typeof ResizeObserver === 'undefined') { setProgH(0); return }
    const ro = new ResizeObserver(() => setProgH(el.getBoundingClientRect().height))
    ro.observe(el)
    setProgH(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [selectedJig, checkpoints, cpLoad.status, frames, isNarrow, isWide])

  // คลิกหมุดบนรูป → เลื่อนไปแถวเช็คของจุดนั้น (โหมดจิ้มหมุดไม่ต้องเลื่อน — ข้อโผล่ใต้รูปอยู่แล้ว)
  /* 🔴 เทียบ "โหมดจิ้มหมุดเปิดจริง" ไม่ใช่แค่ `pinFocus` (20/10) — pinFocus ค่าเริ่ม = true แม้เครื่องไม่มีรูป/ปักไม่ครบ
     ⇒ เดิมกดชิป/หมุดแล้วไม่เลื่อนไปแถวเลย · เงื่อนไขต้องตรงกับ `focusOn` ในส่วนวาด */
  const focusOnNow = pinFocus && frames.length > 0 && checkpoints.length > 0   // ต้องตรงกับ `focusOn` ในแท็บบันทึก
  useEffect(() => {
    if (focusOnNow) return
    if (activeCpId && rowRefs.current[activeCpId]) rowRefs.current[activeCpId].scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activeCpId, focusOnNow])
  useEffect(() => { setChipsAll(false) }, [selectedJig?.id])

  /* ข้อนี้กรอกครบหรือยัง — เกณฑ์เดียวกับที่ปุ่มบันทึกใช้นับ "ยังไม่ครบกี่จุด"
     ⚠️ แก้ที่นี่ต้องแก้ปุ่มบันทึกด้วย ไม่งั้นแถบความคืบหน้ากับปุ่มตอบคนละเลข */
  const cpFilled = (cp) => cpFilledOf(cp, results[cp.id])

  const computeOverall = () => overallOf(checkpoints, results)

  /* 🔴 ตรวจไม่ครบ = บันทึกไม่ได้ (19/11) — บอกเลขข้อที่ขาด (ลำดับเดียวกับชิป "ยังไม่ตรวจ") + พาไปข้อแรก */
  const blockIncomplete = () => {
    const miss = checkpoints.filter(cp => !cpFilled(cp))
    if (!miss.length) return false
    const nos = miss.map(cp => checkpoints.indexOf(cp) + 1)
    toast.error(`${tr("บันทึกไม่ได้ — ยังไม่ได้ตรวจ")} ${miss.length} ${tr("จุด (ข้อ")} ${nos.slice(0, 10).join(', ')}${nos.length > 10 ? ' …' : ''}) — ${tr("ตรวจให้ครบทุกข้อก่อน")}`)
    setActiveShimId(null); setActiveCpId(miss[0].id)
    return true
  }

  /* 🚩 โหลดประวัติ NG ของเครื่องที่เลือก — guard กัน stale (กฎเขียน DB ข้อ 4) */
  useEffect(() => {
    let alive = true
    if (!selectedJig?.id) { setNgHist({ byCp: {}, machine: null, error: '' }); return undefined }
    loadNgHistory(selectedJig).then(r => { if (alive) setNgHist(r) })
      .catch(e => { if (alive) setNgHist({ byCp: {}, machine: null, error: String(e?.message || e) }) })
    return () => { alive = false }
  }, [selectedJig?.id, selectedJig?.machine_id, selectedJig?.machine_no])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ของเก่าที่ "ยกมาได้" ของจุดนี้ — null = ต้องพิมพ์เอง (กฎทั้งหมดอยู่ utils/ngReason.js) */
  const ngCarryOf = (cpId) => {
    const h = ngHist.byCp?.[cpId]
    return h ? carryNgReason({ prev: h.prev, mo: h.mo, machine: ngHist.machine }) : null
  }
  const okWarnOf = (cpId) => {
    const h = ngHist.byCp?.[cpId]
    return h ? okWhileMoOpen({ attr: 'ok', mo: h.mo, machine: ngHist.machine }) : null
  }

  const handleSave = async () => {
    if (checkpoints.length === 0) return
    if (blockIncomplete()) return   // ด่านซ้ำ — ปุ่มเช็คแล้วแต่ห้ามพึ่งปุ่มอย่างเดียว
    // 🔴 จุดตรวจ/ใบตรวจต้องเป็นของเครื่อง+แผนกที่เปิดอยู่จริง (กันคำตอบเก่าทับ — ดู loadReqRef)
    //    checklistId + checkpoints ถูก set คู่กันใน callback เดียวที่ผ่าน live() แล้ว ⇒ เช็ค key พอ
    if (cpLoad.status !== 'ok' || cpLoad.key !== `${selectedJig?.id}|${department}`) {
      toast.error('ข้อมูลจุดตรวจยังโหลดไม่เสร็จหรือไม่ตรงกับเครื่องที่เปิดอยู่ — รอสักครู่แล้วกดบันทึกใหม่')
      return
    }
    /* 🚩 ด่าน "NG ต้องมีเหตุผล" (19/11 · คำสั่ง user) — ตัดสินที่ `ngReasonCheck()` ที่เดียว
       🔴 เช็ค**ตอนกดบันทึกจริง** ไม่ใช่แค่ซ่อนปุ่ม — ช่องเหตุผลเป็นของรายจุด คนเลื่อนข้ามได้ */
    {
      const bad = []
      checkpoints.forEach((cp, i) => {
        if (cp.type === 'variable' || cp.type === 'measure') return   // ค่าที่วัดมา ตัวเลขคือคำอธิบาย
        const r = results[cp.id] ?? {}
        const chk = ngReasonCheck({ attr: r.attr, text: r.reason, carry: ngCarryOf(cp.id), accepted: !!r.reasonAccepted })
        if (!chk.ok) bad.push(`${tr("ข้อ")} ${i + 1} ${cp.name}: ${chk.blockText}`)
      })
      if (bad.length) { toast.error(`${tr("ยังบันทึกไม่ได้")} — ${bad.length} ${tr("ข้อที่ติ๊ก NG ไม่มีเหตุผล")}\n${bad.slice(0, 3).join('\n')}`); return }
    }
    setSaving(true)
    try {
      const overall = computeOverall()
      /* 🪪 B4 (10/11 · user) — ใบ AM: ต้องสแกนบัตรผู้ตรวจทุกใบ (มาตรฐานเดียว) + คนที่บันทึก = ผู้ทวนสอบหน้าเครื่อง
         ⇒ ผ่านสายอนุมัติ = "หัวหน้ากลุ่มรับทราบรายวัน" ไปพร้อมกันในแถวเดียว · กฎทั้งหมดอยู่ utils/amApproval.js
         อ่านพนักงาน "ตอนกด" (ไม่ใช่ค่าที่ช่องโชว์ไว้ก่อนหน้า) — ด่านตอนเขียนจริง */
      let approvalPatch = {}, onSite = null, badgeEmp = null
      /* 🪪 11/11 (คำสั่ง user "ใบ PM ของช่าง บังคับสแกนบัตรก่อน") — ด่านบัตรใช้กับ **ทุกใบ** ทั้ง AM และ PM
         กฎตัดสินบัตรตัวเดียวกัน (`amBadgeGate`) · ส่วน "บันทึกหน้าเครื่อง = รับทราบรายวัน" ยังเป็นของใบ AM เท่านั้น
         (ใบ PM อนุมัติขั้นเดียวเหมือนเดิม — ไม่แตะ) */
      {
        const raw = inspectorCode.trim()
        let hits = 0, loadError = false
        if (normBadgeCode(raw)) {
          const { data: rows, error: eEmp } = await supabase.from('employees')
            .select('id, employee_id_code, name, position').in('employee_id_code', [...new Set([raw, normBadgeCode(raw)])])
          loadError = !!eEmp
          hits = (rows ?? []).filter(e => normBadgeCode(e.employee_id_code) === normBadgeCode(raw)).length
          badgeEmp = findByBadge(rows ?? [], raw)
        }
        const gate = amBadgeGate({ code: raw, employee: badgeEmp, hits, loadError, kind: isAmTeam(department) ? 'AM' : 'PM' })
        if (!gate.ok) { toast.error(gate.text); return }
      }
      if (isAmTeam(department)) {
        onSite = amOnSiteApproval({
          inspectorRank: positionRank(badgeEmp.position), approverRank: positionRank(myPosition),
          isSelf: myEmployeeId === undefined ? null : (!!myEmployeeId && badgeEmp.id === myEmployeeId),
          canApprove: amApproveAllowed({ can: (r, a) => can(r, a, userRole), isSeeded: isActionSeeded }) && deptWrite?.ok !== false
            && amLineWriteOf(selectedJig?.line_name).ok,   // A4: อนุมัติหน้าเครื่อง = ไลน์ในขอบเขตเท่านั้น (ไม่ผ่าน = บันทึกเป็นรออนุมัติ)
          isShared: !!isSharedAccount,
        })
        if (onSite.approve) approvalPatch = { approval_status: 'approved', approved_by: userId, approved_at: new Date().toISOString() }
      }
      const { data: insp, error: e1 } = await supabaseDR.from('inspections').insert({
        jig_id: selectedJig.id, checklist_id: checklistId, inspector_id: userId, status: overall, notes: notes.trim() || null,
        inspector_code: inspectorCode.trim() || null,
        ...approvalPatch,
      }).select().single()
      if (e1) throw e1

      const rows = buildResultRows(insp.id, checkpoints, results, (id) => ngCarryOf(id)?.text || '')
      const { error: e2 } = await supabaseDR.from('inspection_results').insert(rows)
      if (e2) {
        /* 🔴 หัวใบตรวจถูกสร้างไปแล้วแต่ผลรายจุดเข้าไม่ได้ ⇒ ลบหัวใบทิ้ง (QC 05/10)
           ไม่ลบ = มีแถว inspections ที่ไม่มีผลสักจุด แต่ถูกนับว่า "ตรวจแล้ว" ในประวัติ/สรุปรายกะ/Dashboard
           ลบไม่ได้ต้องบอกบนจอ ห้ามเงียบ */
        const { data: gone, error: eDel } = await supabaseDR.from('inspections').delete().eq('id', insp.id).select('id')
        const orphan = eDel || !gone?.length
        throw new Error(`บันทึกผลรายจุดไม่สำเร็จ: ${e2.message}${orphan ? ' — ⚠️ และลบหัวใบตรวจที่สร้างค้างไม่สำเร็จ ใบนี้จะขึ้นในประวัติโดยไม่มีผล แจ้ง admin' : ' (ยกเลิกใบนี้แล้ว กดบันทึกใหม่ได้)'}`)
      }

      // 🔩 ค่าชิมที่กรอกมาด้วย → ประวัติชิมของจุด (ผูก inspection_id) — ล้มต้องบอก ห้ามให้ใบตรวจหลักล้มตาม
      const shimEntries = shimPoints.map(pt => [pt, shimVals[pt.id]]).filter(([, v]) => v && v.mm !== '' && v.mm != null && !Number.isNaN(Number(v.mm)))
      if (shimEntries.length) {
        if (!canShim) toast.error('ค่าชิมไม่ถูกบันทึก — บัญชีนี้ไม่มีสิทธิ์ fixture_shim:record')
        else {
          let okN = 0; const warns = []
          for (const [pt, v] of shimEntries) {
            const res = await recordShimEvent({ point: pt, afterMm: Number(v.mm), action: deriveShimAction(pt.current_shim_mm, Number(v.mm)), reason: 'wear', note: v.note, byName: fullName, shotAtEvent: null, inspectionId: insp.id })
            if (res.ok) okN++; else warns.push(`${pt.point_no}: ${res.error}`)
            if (res.warn) warns.push(res.warn)
          }
          if (okN) toast.success(`${tr("บันทึกค่าชิม")} ${okN} ${tr("จุดลงประวัติแล้ว")}`)
          if (warns.length) toast.error(`${tr("ชิมบางจุดไม่สำเร็จ")}: ${[...new Set(warns)].join(' · ')}`)
        }
      }

      if (overall === 'fail') {
        /* 🔕 ผู้รับ = ทีมเจ้าของอุปกรณ์ + หัวหน้าส่วนงานนั้น (09/11 · คำสั่ง user)
           เดิมยิง 83 คนข้าม 12 ส่วนงาน · คนกดเองถูกตัดออกที่ edge แล้ว (actor_id) ไม่ต้องส่ง excludeUserId
           🔴 ทีมใหญ่เกิน 20 คน = รายชื่อช่างถูกตัด ⇒ ต้องเขียนบนจอ ห้ามเงียบ */
        notifyDepartment(department, {
          /* 🔔 25/11 (คำสั่ง user "เพิ่ม leader ในการ์ด AM แดง"): ใบ AM แยกกติกาเป็น `am_inspection_ng`
             (ผู้รับ + leader) ⇒ ใบ PM ของช่างยังใช้ `pm_inspection_ng` ผู้รับเดิมเป๊ะ — ปรับ 2 เรื่องแยกกันได้ที่ /notification-config */
          event: isAmTeam(department) ? 'am_inspection_ng' : 'pm_inspection_ng',
          title: 'พบผลตรวจไม่ผ่าน (NG)',
          body: `${selectedJig.name} — ${formatDate(insp.inspected_at)}`,
          type: 'error', refTable: 'inspections', refId: insp.id,
          link: inspNotifLink(department, selectedJig.id),   // 🔔 20/11: ใบ AM → หน้า AM · ใบ PM → หน้าช่าง
          lineName: selectedJig.line_name || null,
        }).then(r => { if (r?.ownersCapped) toast.error(`⚠ ${tr("ทีม")} ${deptNameOf(department)} ${tr("มีช่าง")} ${r.owners} ${tr("คน — แจ้งเตือนส่งถึงได้ 20 คนแรกเท่านั้น")}`) })
          .catch(() => {})
      }

      // ⭐ แผน PM "วิ่งตามผลตรวจ" (feedback ทีมงาน 2026-08-17): ตรวจครบทุกจุด (pass/fail) = ทำ PM จริงแล้ว
      //   → stamp pm_plans.last_done_at + เลื่อน next_due_date (แผนตามรอบเวลา) — เดิมมีแค่ปิดแผนประสานงาน
      //   ที่ stamp ให้ ทำให้ PM Forecast/ผังเครื่องจักร/Dashboard เห็นแผนค้างทั้งที่ตรวจไปแล้ว
      //   'pending' (ตรวจไม่ครบ) ไม่นับว่าทำ PM จบ — ไม่เลื่อนรอบ · best-effort ห้ามทำ save หลักพัง แต่ห้ามเงียบ
      if (overall !== 'pending' && checklistId) {
        const pErr = await stampPlansAfterCheck(checklistId)
        if (pErr) toast.error((tr('บันทึกผลตรวจสำเร็จ แต่เลื่อนรอบแผน PM ไม่สำเร็จ') + ': ') + pErr)
      }

      // Daily PM line alarm (green when the line is complete & all pass, red on NG).
      const ngTopics = ngTopicsOf(checkpoints, results)
      handleDailyPmSave({ jig: selectedJig, department, overall, ngTopics }).catch(() => {})
      // อัปเดตป้าย "ตรวจแล้ว/รอตรวจ" ในรายการซ้ายทันที ไม่ต้องรอโหลดใหม่
      if (isAmTeam(department)) setCheckedThisShift(prev => ({ ...prev, [selectedJig.id]: overall }))

      if (onSite?.approve) {
        toast.success(`${tr("บันทึกแล้ว — ผู้ตรวจ")} ${badgeEmp?.name || inspectorCode.trim()} · ${fullName || tr('คุณ')} ${tr("ทวนสอบ/รับทราบแล้ว")}`)
        const note = amApprovalAssumptionText(onSite.verdict?.assumed)
        if (note) toast.info(note)
      } else {
        toast.success(badgeEmp ? `${tr("บันทึกผลการตรวจสำเร็จ — ผู้ตรวจ")} ${badgeEmp.name}` : 'บันทึกผลการตรวจสำเร็จ')
        if (onSite) toast.info(onSite.text)
      }
      if (pmDraftKey) clearDraft(pmDraftKey)
      const init = {}
      checkpoints.forEach(c => { init[c.id] = { v1: '', v2: '', v3: '', attr: '', note: '', mval: '', reason: '', reasonAccepted: false } })
      setResults(init); setNotes('')
      fetchHistory(selectedJig.id)
      setTab('history')
      /* 🔧 เจอ NG → เสนอเปิดใบแจ้งซ่อมทันที (ตอนนี้แหละที่คนยังอยู่หน้าเครื่องและรู้ว่าเสียยังไง)
         เสนอหลังบันทึกสำเร็จเท่านั้น — ต้องมี inspection id ก่อนถึงผูกที่มาได้
         ข้ามได้ ไม่บล็อก · กด "ไว้ก่อน" แล้วยังกลับมาเปิดจากแท็บประวัติได้ (ไม่เป็นทางตัน) */
      // 🔧 B3 — ใบ AM: เด้งเสมอ (คนที่ไม่มีสิทธิ์เปิด MO ก็ต้องเขียนเหตุผล/ส่งต่อหัวหน้า) · ใบ PM = เดิม
      if (overall === 'fail' && ngTopics.length && (can('mtn_repair', 'report', userRole) || isAmTeam(department))) {
        openMoPrompt(insp, ngTopics)
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  /* 🔴 เกณฑ์ "กรอกครบ" ต้องมาจาก `cpFilled()` ตัวเดียว (06/10) — เดิมเขียนไว้ 3 ที่
     (cpFilled · isFormReady · นิพจน์ยาวในปุ่มบันทึก) และ **ตัวนี้เคยไม่ตรงกับอีก 2 ตัว**:
     ใช้ `r.attr !== ''` ⇒ จุดที่ยังไม่มีค่า `attr` เลย (undefined) นับว่า "ครบ"
     ⇒ แถบความคืบหน้าบอก "ยังไม่ตรวจ" แต่ปุ่มขึ้น "บันทึกผลการตรวจ" (เขียว) พร้อมกัน */
  const nMissing = checkpoints.filter(cp => !cpFilled(cp)).length
  const isFormReady = checkpoints.length > 0 && nMissing === 0

  const deptColor = teams.find(t => t.key === department)?.color || DEPT_COLORS[department] || '#3dd65c'
  const jigImg = selectedJig ? getPublicUrl(selectedJig.image_path) : null
  // กรองอุปกรณ์ตามทีม — ยึด "department (checklist)" เป็นหลัก (คำสั่ง user 2026-07-22):
  //   โผล่ใต้ทีม D ถ้า (ก) มี checklist ของทีม D อยู่แล้ว (ตรงกับหน้า PMSchedule) หรือ
  //   (ข) ประเภทอุปกรณ์ = ประเภท default ของทีม (ให้เริ่ม checklist ใหม่ได้) · ผลิต = ทุกชนิด
  const teamEquip = (teams.find(t => t.key === department) || {}).equip_type
  const hasAmChecklist = (jigId) => [...(clDeptByJig[jigId] || [])].some(isAmTeam)
  const deptJigsAll = isAmTeam(department)
    ? jigs
    : jigs.filter(j => (teamEquip && (j.equipment_type || 'machine') === teamEquip) || clDeptByJig[j.id]?.has(department))
  // คำค้นแยกเป็นคำ ทุกคำต้องเจอ (เช่น "laser 789" · "jhyd08") — เทียบกับ เลขเครื่อง+ชื่อ+ไลน์ รวมกัน
  const qWords = jigQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matchJig = (j) => {
    if (!qWords.length) return true
    const hay = `${j.machine_no || ''} ${j.name || ''} ${j.line_name || ''}`.toLowerCase()
    return qWords.every(w => hay.includes(w))
  }
  const deptJigsQ = deptJigsAll.filter(matchJig)
  const amTab = isAmTeam(department)
  const { rows: deptJigs, droppedNoLine: jigDropped } = amTab
    ? { rows: deptJigsQ, droppedNoLine: 0 }
    : filterPlanRows(deptJigsQ, { scopeNames: jigScope.names, known: lineKnownSet(scopeLines), getLine: j => j.line_name })
  const jigGroups = amTab ? [] : groupEquipRowsByLine(deptJigs.map(j => ({ jig: j })), scopeLines)

  // จอแคบ: โชว์ทีละคอลัมน์ (ยังไม่เลือก=ลิสต์ · เลือกแล้ว=ฟอร์ม) · desktop โชว์ทั้งคู่เหมือนเดิม
  const showSidebar = !isNarrow || !selectedJig
  const showMain = !isNarrow || !!selectedJig

  /* 🧭 หน้าช่าง (mode pm) ถูกเปิดด้วยทีม AM (ลิงก์เก่า/ป้าย QR/แจ้งเตือน) → พาไปหน้าบันทึก AM ของตัวเอง */
  if (!amMode && isAmTeam(department)) {
    const q = new URLSearchParams({ tab: 'amcheck', dept: department })
    if (equipParam) q.set('equip', equipParam)
    if (searchParams.get('line')) q.set('line', searchParams.get('line'))
    return <Navigate to={`/daily-checker?${q.toString()}`} replace />
  }
  /* ปุ่มเลือกทีม = เฉพาะทีมของโหมดนี้ (AM ไม่ปนกับทีมช่าง) */
  const modeTeams = teams.filter(t => isAmTeam(t.key) === amMode)

  return (
    <Page width="full">
    {/* UI-STANDARD 2026-09-24 — หัวเพจมาตรฐาน (ใน PmHub/DailyChecker ชื่อถูกซ่อน เหลือหัวของ hub ชั้นเดียว) */}
    <PageHeader title={tr(amMode ? 'บันทึกผลตรวจ AM' : 'บันทึกผลตรวจ PM')} icon="✅" />
    {/* 🔐 เปิดทีมอื่นอยู่ — ดูได้ แต่ลงผล/อนุมัติ/เลื่อนรอบไม่ได้ (ต้องเขียนบอก ห้ามปุ่มเทาเฉยๆ) */}
    {!deptWrite.ok && (
      <div style={{ margin: '0 0 10px', padding: '8px 10px', borderLeft: '4px solid var(--amber)',
        background: 'var(--card)', borderRadius: 'var(--r-md)', fontSize: 12.5 }}>
        {teamBlockText(deptWrite, `${tr("งานตรวจของทีม")} "${deptNameOf(department) || department}"`)}
      </div>
    )}
    <div style={S.page}>
      {/* Sidebar (จอแคบ = เต็มความกว้าง) */}
      {showSidebar && (
      <div style={{ ...S.sidebar, ...(isNarrow ? { width: '100%', borderRight: 'none', position: 'static', height: 'auto' } : null) }}>
        {modeTeams.length > 1 && <div style={{ ...S.deptBar, paddingTop: 12 }}>
          {modeTeams.map(d => <button key={d.key} onClick={() => setDept(d.key)} style={S.deptBtn(department === d.key, d.color || DEPT_COLORS[d.key] || '#3dd65c')}>{d.icon ? `${d.icon} ` : ''}{tr(d.label)}</button>)}
        </div>}
        {/* AM (ผลิตตรวจเอง) กับ PM (ช่าง) เป็นคนละงาน — บอกให้ชัดว่าแท็บที่เลือกอยู่คืออะไร */}
        <div style={{ padding: modeTeams.length > 1 ? '0 16px 10px' : '12px 16px 10px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          {/* ชื่อแท็บที่เลือกอยู่ต้องเห็นเสมอ · คำอธิบายว่าต่างจาก AM ยังไง → ⓘ (อ่านรอบเดียวพอ) · 19/11 */}
          <b style={{ color: deptColor }}>{teamKind(department).short} · {teamKind(department).full}</b>{' '}
          <MoreMark text={tr(teamKind(department).desc)} />
        </div>
        <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <SearchInput value={jigQuery} onChange={setJigQuery} fields={tr("เลขเครื่อง / ชื่อ / ไลน์")} ariaLabel={tr("ค้นหาเครื่อง")}
            style={{ flex: 1, minWidth: 0 }} />
          {/* 📷 สแกนป้ายที่ติดเครื่อง → เปิดใบตรวจของเครื่องนั้นเลย (2026-10-02 · คำสั่ง user)
              เดิมหน้าพิมพ์ป้ายโฆษณาว่า "สแกนเลือกอุปกรณ์ได้ทันทีใน … ตรวจ PM" แต่หน้านี้ไม่มีปุ่มสแกน
              ⚠️ ป้ายเครื่องจักรเข้ารหัสด้วย machines.id — resolveJig เด้งไป "แถวเงา" ใน jigs ให้เอง */}
          <button onClick={() => setScanOpen(true)} title={tr('สแกน QR ที่ติดเครื่อง')}
            style={{ minWidth: 44, minHeight: 44, padding: 0, fontSize: 18, borderRadius: 'var(--r-md)',
              background: 'var(--bg3-surf)', border: '1px solid var(--border2)', cursor: 'pointer' }}>📷</button>
        </div>
        {!amTab && (
          <div style={{ padding: '0 16px 8px' }}>
            <LineScopeSelect lines={scopeLines} section={jigScope.section} line={jigScope.line}
              onChange={(section, line, info) => setJigScope({ section, line, names: info?.lines?.length ? info.lines : (section || line ? [line || section] : null) })} />
          </div>
        )}
        {!amTab && (qWords.length > 0 || jigScope.names?.length) && (
          <div style={{ padding: '0 16px 6px', fontSize: 11, color: 'var(--muted)' }}>
            {tr("พบ")} {deptJigs.length} {tr('จาก')} {deptJigsAll.length} {tr("เครื่อง")}
            {jigDropped > 0 && <span style={{ color: 'var(--amber)' }}> {tr('· อีก')} {jigDropped} {tr('เครื่องไลน์ไม่ตรงทะเบียน (กรองตามไลน์ไม่ได้)')}</span>}
          </div>
        )}
        {listErr && (
          <div role="alert" style={{ margin: '0 16px 8px', padding: '8px 10px', borderRadius: 'var(--r-md)', fontSize: 12, lineHeight: 1.5,
            background: 'rgba(224,92,74,0.12)', border: '1px solid rgba(224,92,74,0.4)', color: 'var(--text)' }}>
            ⚠️ {tr("โหลดข้อมูลไม่ครบ — รายการ/ป้ายสถานะด้านล่างอาจไม่จริง")}<br />
            <span style={{ color: 'var(--muted)' }}>{listErr}</span>{' '}
            <span onClick={() => window.location.reload()} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>{tr('โหลดใหม่')}</span>
          </div>
        )}
        <div style={S.jigList}>
          {isAmTeam(department) ? (() => {
            // แท็บฝ่ายผลิต: เฉพาะเครื่องที่ลงทะเบียน Daily PM จัดกลุ่มตามไลน์ + สถานะกะนี้
            if (dailyLineByJig == null) return <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 20 }}>{tr('กำลังโหลด...')}</p>
            const lineParam = searchParams.get('line')
            const byLine = {}
            const hiddenLines = new Set()   // ไลน์ที่ลงทะเบียน AM แต่อยู่นอกขอบเขตของบัญชีนี้ — ต้องเขียนบนจอว่าซ่อนกี่ไลน์
            jigs.forEach(j => {
              const lns = dailyLineByJig[j.id]
              if (!lns || !matchJig(j)) return
              lns.forEach(ln => {
                if (amScopeSet && !amScopeSet.has(ln)) { hiddenLines.add(ln); return }
                if (lineParam && ln !== lineParam) return
                ;(byLine[ln] ||= []).push(j)
              })
            })
            const scopeNote = (amScopeSet || amScope.unsure) && (
              <div style={{ padding: '0 4px 6px', fontSize: 11, color: amScope.unsure ? 'var(--amber)' : 'var(--muted)', lineHeight: 1.5 }}>
                {amScope.unsure
                  ? tr("⚠ ตัดขอบเขตไลน์ของบัญชีนี้ไม่ได้ (ไลน์/ส่วนงานในโปรไฟล์ไม่ตรงทะเบียน) — ตรวจโปรไฟล์ที่ /add-user")
                  : `${tr("เฉพาะไลน์ในขอบเขตของคุณ")}${hiddenLines.size ? ` · ${tr("ซ่อนอีก")} ${hiddenLines.size} ${tr("ไลน์")}` : ''}`}
              </div>
            )
            const lineNames = Object.keys(byLine).sort(lineNameCompare)
            // ⚠️ ช่องว่างที่เคยทำให้ 2 หน้าไม่ตรงกัน: PM Setup ลิสต์เครื่องที่ "มีรายการตรวจ AM" (มี checklist
            //    department=production) แต่หน้านี้ลิสต์เฉพาะเครื่องที่ "ลงทะเบียน AM" (pm_daily_line_targets)
            //    → เครื่องที่ลงจุดตรวจไว้แล้วแต่ยังไม่ลงทะเบียน หายไปเงียบๆ (เจอจริง 21 จาก 27 เครื่อง)
            //    ไม่เดาลงทะเบียนให้เอง (เป็นการตัดสินใจว่าไลน์ไหนต้องตรวจอะไร) แต่ต้องไม่ซ่อน
            const pendingReg = jigs.filter(j => hasAmChecklist(j.id) && !dailyLineByJig[j.id])
            const pendingBlock = pendingReg.length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 'var(--r-md)', border: '1px dashed var(--amber)55', background: 'var(--amber-dim)' }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--amber)' }}>{tr('⚠ มีรายการตรวจ AM แล้ว แต่ยังไม่ได้ลงทะเบียน ·')} {pendingReg.length} {tr('เครื่อง')}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', margin: '3px 0 6px', lineHeight: 1.5 }}>
                  {tr("ลงจุดตรวจไว้ที่ PM Setup แล้ว แต่ยังไม่ถูกติ๊กว่า “ต้องตรวจทุกต้นกะ” จึงยังไม่ขึ้นให้ตรวจที่นี่")}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, maxHeight: 120, overflowY: 'auto' }}>
                  {pendingReg.map(j => <div key={j.id}>· {j.machine_no || j.name}{j.line_name ? ` (${j.line_name})` : ''}</div>)}
                </div>
                <Link to="/daily-checker?tab=pm" style={{ display: 'inline-block', marginTop: 6, fontSize: 11.5, color: 'var(--amber)', fontWeight: 800 }}>
                  {tr("ไปลงทะเบียนที่แท็บ")} AM →
                </Link>
              </div>
            )
            if (!lineNames.length) return (<>
              {scopeNote}
              <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
                {lineParam ? `${tr("ไลน์")} ${lineParam} ${tr("ยังไม่ได้ลงทะเบียนเครื่องตรวจ")}${amScopeSet && !amScopeSet.has(lineParam) ? tr(' (หรืออยู่นอกขอบเขตของคุณ)') : ''}`
                  : hiddenLines.size ? tr("ไลน์ในขอบเขตของคุณยังไม่มีเครื่องที่ลงทะเบียน AM") : tr("ยังไม่มีเครื่องที่ลงทะเบียน AM")}<br />
                <Link to="/daily-checker?tab=pm" style={{ color: 'var(--accent)', fontWeight: 700 }}>{tr('ไปลงทะเบียนที่แท็บ AM →')}</Link>
              </p>
              {pendingBlock}
            </>)
            return (<>
              {scopeNote}
              {lineParam && (
                <div style={{ fontSize: 11, color: 'var(--muted)', padding: '0 4px 6px' }}>
                  {tr("กรองเฉพาะไลน์")} {lineParam} · <span onClick={() => setParams({ line: null })} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>{tr('ดูทุกไลน์')}</span>
                </div>
              )}
              {lineNames.map(ln => (
                <div key={ln} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: deptColor, padding: '2px 4px 4px' }}>{ln} <span style={{ fontWeight: 600, color: 'var(--muted)' }}>{tr('· ตรวจแล้ว')} {byLine[ln].filter(j => checkedThisShift[j.id]).length}/{byLine[ln].length}</span></div>
                  {byLine[ln].map(jig => {
                    const st = checkedThisShift[jig.id]
                    return (
                      <div key={`${ln}-${jig.id}`} onClick={() => selectJig(jig)} style={S.jigItem(selectedJig?.id === jig.id, deptColor)}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jig.name}</p>
                          <span style={{
                            flexShrink: 0, fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 'var(--r-pill)',
                            background: st === 'fail' ? 'rgba(224,92,74,0.15)' : st ? 'rgba(61,214,92,0.15)' : 'var(--amber-dim)',
                            color: st === 'fail' ? '#e05c4a' : st ? '#3dd65c' : '#f59e0b',
                          }}>
                            {st === 'fail' ? '✗ NG' : st ? tr("✓ ตรวจแล้ว") : tr("รอตรวจ")}
                          </span>
                        </div>
                        {jig.machine_no && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>{jig.machine_no}</p>}
                        {/* 🧩 อยู่สถานี AM — กดตัวไหนก็ได้ = ใบรวมทั้งชุด (23/11) */}
                        {stationIx.byJig.get(jig.id) && (
                          <p style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, margin: '2px 0 0' }}>🧩 {tr('สถานี')} {stationIx.byJig.get(jig.id).name}</p>
                        )}
                        {/* ลงทะเบียนไว้แต่ยังไม่มีจุดตรวจ AM — เปิดเข้าไปจะเจอฟอร์มเปล่า บอกไว้ตั้งแต่ในลิสต์ */}
                        {!hasAmChecklist(jig.id) && (
                          <p style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700, margin: '2px 0 0' }}>{tr('⚠ ยังไม่มีจุดตรวจ AM')}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
              {pendingBlock}
            </>)
          })() : (<>
            {deptJigs.length === 0 && ((qWords.length || jigScope.names?.length)
              ? <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>{tr('ไม่พบเครื่องที่ตรงกับ')}{jigQuery.trim() ? ` “${jigQuery.trim()}”` : tr("ตัวกรอง")}<br /><span onClick={() => { setJigQuery(''); setJigScope({ section: '', line: '', names: null }) }} style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>{tr('ล้างตัวกรอง')}</span></p>
              : <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>{tr('ยังไม่มีอุปกรณ์ในทีมนี้')}<br /><span style={{ fontSize: 11 }}>({(teams.find(d => d.key === department) || {}).label})</span></p>)}
            {/* จัดกลุ่มตามไลน์ (ทะเบียน ส่วนงาน→แม่→ลูก · ไม่ระบุไลน์ท้ายสุด) — เดิมเรียงตามชื่อยาวเหยียดเป็นแถวเดียว */}
            {jigGroups.map(g => (
              <div key={g.key}>
                <div style={{ fontSize: 11, fontWeight: 800, color: g.known ? 'var(--text2)' : 'var(--amber)', margin: '8px 2px 5px', lineHeight: 1.4 }}>
                  {tr(g.label)} <span style={{ fontWeight: 600, color: 'var(--muted)' }}>· {g.rows.length}</span>
                </div>
                {g.rows.map(({ jig }) => (
                  <div key={jig.id} onClick={() => selectJig(jig)} style={S.jigItem(selectedJig?.id === jig.id, deptColor)}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{jig.name}</p>
                    {(jig.machine_no || jig.jig_no) && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>{[jig.machine_no, jig.jig_no].filter(Boolean).join(' · ')}</p>}
                  </div>
                ))}
              </div>
            ))}
          </>)}
        </div>
      </div>
      )}

      {/* Main */}
      {showMain && (
      <div style={S.main}>
        {!selectedJig ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{tr('เลือกอุปกรณ์จากรายการด้านซ้าย')}</p>
          </div>
        ) : (
          <>
            <div style={{ ...S.header, ...(isNarrow ? { padding: '10px 12px', flexWrap: 'wrap' } : null) }}>
              {isNarrow && (
                <button onClick={clearJig} title={tr('กลับไปเลือกอุปกรณ์')} style={{ flexShrink: 0, background: 'var(--bg3-surf)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r-md)', padding: '6px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{tr('อุปกรณ์')}</button>
              )}
              {jigImg && <img loading="lazy" src={jigImg} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'contain', background: 'var(--bg2-surf)', border: '1px solid var(--border)' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{selectedJig.name}</h1>
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>{selectedJig.jig_no && `No: ${selectedJig.jig_no}`}{selectedJig.process && ` · ${selectedJig.process}`}</p>
              </div>
              <div style={S.tabBar}>
                <button onClick={() => setTab('record')} style={S.tabBtn(tab === 'record')}>{tr('บันทึก')}</button>
                <button onClick={() => setTab('history')} style={S.tabBtn(tab === 'history')}>
                  {/* 🔀 นับ "ของทีมนี้" เท่านั้น · มีของทีมอื่นบนเครื่องเดียวกัน = ติดจุดไว้ให้รู้ (กดเข้าไปอ่านได้) */}
                  {tr('ประวัติ (')}{inspections.length}{histMeta?.otherN ? '+' : ''})
                </button>
              </div>
            </div>

            <div style={{ ...S.body, ...(isNarrow ? { padding: 12 } : null) }}>
              {/* 🧩 สถานี AM — อุปกรณ์นี้อยู่ในสถานี ⇒ ใบรวมทั้งชุด (23/11) */}
              {tab === 'record' && station && (
                <AmStationSheet station={station} memberJigs={stationJigs} amDept={department} methodIndex={methodIndex}
                  canRecord={canRecord} deptWrite={deptWrite} amLineWrite={amLineWriteOf(station.line_name)} userId={userId} userRole={userRole} fullName={fullName}
                  myPosition={myPosition} myEmployeeId={myEmployeeId} isSharedAccount={isSharedAccount}
                  inspectorCode={inspectorCode} setInspectorCode={setInspectorCode} checkedThisShift={checkedThisShift}
                  ownerTeamOf={ownerTeamOf} isMobileView={isMobileView}
                  onSavedJig={(id, overall) => setCheckedThisShift(prev => ({ ...prev, [id]: overall }))}
                  onQueueMo={(items) => setMoQueue(prev => [...prev, ...items])}
                  onOpenSingle={(id) => { setSingleJigId(id); setParams({ equip: id }); setTab('history') }} />
              )}
              {/* ดูใบเดี่ยวของเครื่องในสถานีอยู่ — บอกทางกลับ */}
              {amMode && selectedJig && singleJigId === selectedJig.id && stationIx.byJig.get(selectedJig.id) && (
                <div style={{ marginBottom: 10, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--muted)' }}>{tr('เครื่องนี้อยู่สถานี')} "{stationIx.byJig.get(selectedJig.id).name}"</span>
                  <button type="button" className="tbtn" onClick={() => { setSingleJigId(null); setTab('record') }} style={{ padding: '3px 10px', fontSize: 12 }}>🧩 {tr('กลับไปใบสถานี')}</button>
                </div>
              )}
              {amMode && amSt.err && <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--amber)' }}>{tr('อ่านรายการสถานี AM ไม่ได้ — ตรวจทีละเครื่องตามปกติ')} ({amSt.err})</div>}
              {tab === 'record' && !station && (
                <DraftRestoreBar draft={pendingDraft} what={`${tr("ใบตรวจ")} ${selectedJig?.name || tr('เครื่องนี้')}`} onRestore={restorePmDraft}
                  onDiscard={() => { if (pmDraftKey) clearDraft(pmDraftKey); setPendingDraft(null) }} />
              )}
              {tab === 'record' && !station && (() => {
                /* ⚠️ ไม่มีจุดตรวจของแผนกนี้ = ห้ามโชว์รูปหมุน (2026-08-11 · user ทัก "ทำไมรูปยังค้างอยู่")
                   รูปหลายมุมเป็นของ "ตัวเครื่อง" (ของกลางทุกแผนก) แต่ "หมุดจุดตรวจ" ผูกกับ
                   checklist ของแต่ละแผนก และ**ปักอยู่คนละมุม (frame) กัน** — AM อาจตรวจด้านหน้า
                   MTN ตรวจในตู้ไฟ → โชว์รูปมุมที่ 1/8 เปล่าๆ ที่ไม่มีหมุดเลย ไม่ได้บอกอะไร
                   แถมดูเหมือนหน้าพร้อมใช้งาน ทั้งที่ยังไม่มีอะไรให้ตรวจ
                   (ตัวเครื่องยืนยันได้จาก thumbnail บนหัวเรื่องอยู่แล้ว) */
                const showPhoto = frames.length > 0 && selectedJig.layout_type !== 'list' && checkpoints.length > 0
                // จอกว้าง (≥1180px) + มีรูป → 2 คอลัมน์ (รูปซ้ายค้างไว้ · รายการเช็คขวา) ใช้พื้นที่เต็ม
                const twoCol = isWide && showPhoto
                /* จอแคบ = รูปอยู่ "บนหัว" ของรายการ → ต้องเตี้ยพอให้เหลือที่กรอกจริง
                   (480px บนมือถือ = กินเกือบทั้งจอ ตอบ feedback "ในมือถือก็เหมือนยังไม่เหมาะ") */
                const stackCompact = showPhoto && !twoCol
                const cpById = Object.fromEntries(checkpoints.map(c => [c.id, c]))
                /* 📍 โหมดจิ้มหมุด — ใช้ได้ก็ต่อเมื่อ "จุดตรวจถูกปักบนรูปแล้ว" เท่านั้น
                   จุดที่ยังไม่ปัก (x_pos = null) แตะจากรูปไม่ได้ ⇒ ถ้าซ่อนไปจะตรวจไม่ถึงตลอดกาล
                   ⇒ โหมดนี้เปิดเฉพาะตอนปักครบ · ปักไม่ครบ = โชว์ทุกข้อเหมือนเดิม + บอกเหตุผล */
                const pinnedCps = checkpoints.filter(c => c.x_pos != null)
                const allPinned = checkpoints.length > 0 && pinnedCps.length === checkpoints.length
                /* 🧩 แพทเทินเดียวกันทุกเครื่อง (2026-11-10 · user: "ทำไมแพทเทินไม่เหมือนกัน")
                   เดิมโหมด "ทีละข้อ" เปิดได้เฉพาะเครื่องที่ **ปักหมุดครบทุกข้อ** ⇒ เครื่องที่ยังไม่ปัก
                   (เช่น RB-109 ปัก 0/11) ตกไปใช้ลิสต์ยาวทุกข้อแทน = คนละหน้าตากับเครื่องข้างๆ
                   🔑 การปักหมุดจำเป็นแค่กับ "การแตะหมุดบนรูปเพื่อเลือกข้อ" — ไม่ใช่กับตัวโหมดทีละข้อ
                      (เลือกข้อด้วยชิปเลข/ข้อก่อน-ข้อถัดไปได้อยู่แล้ว) ⇒ ปลดออกจากกัน */
                const focusOn = showPhoto && pinFocus && checkpoints.length > 0
                const doneN = checkpoints.filter(cpFilled).length
                const todo = checkpoints.filter(c => !cpFilled(c))
                /* `done` = กรอกค่าชิมในใบนี้แล้วหรือยัง — ใช้ตัดสินสีหมุด (ยังไม่วัด = วงโปร่ง) */
                const shimPins = shimPoints
                  .map(pt => ({ point: pt, pin: pointPin(pt, cpById), done: String(shimVals[pt.id]?.mm ?? '') !== '' }))
                  .filter(x => x.pin)
                const scrollToShim = (id) => {
                  setActiveCpId(null); setActiveShimId(id)
                  if (!pinFocus) rowRefs.current[`shim:${id}`]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
                const viewerNode = showPhoto
                  ? <JigSpinCheck frames={frames} checkpoints={checkpoints} results={results} activeCpId={activeCpId} onPinClick={setActiveCpId}
                      shimPins={shimPins} onShimPinClick={scrollToShim}
                      /* 🔴 ตัวที่จำกัดขนาดรูปคือ **ความสูง** ไม่ใช่ความกว้าง (วัดจริงที่ 390px · 23/09)
                         cap 190px: รูปแนวนอน 4:3 ได้แค่ 253px เหลือที่ว่างข้าง 137px · 16:9 เหลือ 52px
                         cap 300px: 4:3 และ 16:9 **เต็มความกว้างพอดี** (390px)
                         (รูปแนวตั้งไม่มีทางเต็มความกว้าง เว้นแต่จะครอป ซึ่งทำไม่ได้ — หมุดจะเพี้ยน) */
                      maxH={twoCol ? 560 : (isNarrow ? 300 : 320)} compact={stackCompact} />
                  : null

                const notDueN = freqInfo.key === `${selectedJig.id}|${department}` ? freqInfo.notDue.size : 0
                const freqBanner = cpLoad.status === 'ok' && freqInfo.key === `${selectedJig.id}|${department}` && (notDueN > 0 || freqInfo.err) ? (
                  <AmNotDueBar notDue={[...freqInfo.notDue.values()]} err={freqInfo.err} shown={showNotDue} onToggle={() => setShowNotDue(v => !v)} />
                ) : null
                const formNode = (
                  <>
                  {freqBanner}
                  {cpLoad.status === 'loading' ? (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 12px' }}>{tr('กำลังโหลดรายการตรวจ…')}</div>
                  ) : cpLoad.status === 'error' ? (
                    <div style={{ textAlign: 'center', color: 'var(--red)', fontSize: 13, padding: '32px 12px', lineHeight: 1.7 }}>
                      ⚠️ {tr("โหลดรายการตรวจไม่สำเร็จ — ยังไม่รู้ว่าเครื่องนี้มีจุดตรวจหรือไม่")}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{cpLoad.msg}</div>
                      <button onClick={() => setCpReload(n => n + 1)} style={{ marginTop: 10, padding: '6px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>{tr('ลองใหม่')}</button>
                    </div>
                  ) : checkpoints.length === 0 && notDueN > 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 12px' }}>{tr('กะนี้ไม่มีข้อที่ถึงรอบตรวจ — ข้อรายวัน/รายสัปดาห์/รายเดือนตรวจในรอบนี้ไปแล้ว')}</div>
                  ) : checkpoints.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 12px', lineHeight: 1.7 }}>
                      {tr("เครื่องนี้ยังไม่มีรายการตรวจของ")} <b style={{ color: deptColor }}>{(teams.find(t => t.key === department) || {}).label || department}</b>
                      <br />
                      <span style={{ fontSize: 12 }}>
                        1 {tr("เครื่องมีรายการตรวจแยกตามแผนกได้ (ผลิตเช็ครายวัน · ช่างเช็คตามรอบ")})
                        <br />{tr('จุดตรวจของแต่ละแผนก')}<b>{tr('ปักอยู่คนละมุมของเครื่องได้')}</b> — {tr("จึงยังไม่แสดงรูปหมุนจนกว่าจะมีจุดตรวจของแผนกนี้")}
                      </span>
                      {otherDepts.length > 0 && (
                        <div style={{ marginTop: 16, padding: '12px 14px', display: 'inline-block', textAlign: 'left', background: 'var(--bg3-surf)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 7 }}>
                            {tr("เครื่องนี้มีจุดตรวจอยู่ใต้แผนกอื่น — กดเพื่อดู")}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {otherDepts.map(d => {
                              const t = teams.find(x => x.key === d.department)
                              return (
                                <button key={d.department} onClick={() => setDept(d.department)}
                                  style={{ padding: '6px 12px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                    border: `1.5px solid ${t?.color || 'var(--border2)'}`, background: 'var(--card)', color: t?.color || 'var(--text)' }}>
                                  {t?.icon || ''} {tr(t?.label) || d.department} · {d.checkpointCount} {tr("จุด")}
                                </button>)
                            })}
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: 12, marginTop: 14 }}>
                        {tr("ยังไม่ได้ลงจุดตรวจของแผนกนี้จริง → ตั้งที่")} <b>PM Setup</b> ({tr("ถ้าลงผิดแผนก ย้ายข้ามแผนกได้ที่นั่น")})
                      </div>
                      {/* จิ๊กที่มีจุดชิมแต่ยังไม่มีจุดตรวจ PM (เช่น JHYD12-01) — ค่าชิมบันทึกที่ /fixture ได้เลย ไม่ต้องรอใบตรวจ */}
                      {shimPoints.length > 0 && (
                        <div style={{ fontSize: 12, marginTop: 10, color: SHIM_PIN_COLOR }}>
                          {tr("เครื่องนี้มีจุดชิม")} {shimPoints.length} {tr('จุดในทะเบียน — ยังบันทึกค่าชิมได้ที่')}{' '}
                          <Link to="/equipment?tab=jig&fx=shim" style={{ color: SHIM_PIN_COLOR, fontWeight: 700 }}>{tr('ทะเบียนจิ๊ก → 🔧 บันทึกชิม')}</Link>
                          {' '}({tr("ตั้งจุดตรวจ PM แล้ว จะกรอกค่าชิมพร้อมใบตรวจได้ที่นี่")})
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* ── 📍 แถบคุมโหมดจิ้มหมุด (user 23/09 "ขึ้นแค่ข้อที่จิ้มจุดนั้น ไม่รก ไม่ต้องเลื่อนหา")
                          🔴 ซ่อนข้ออื่นได้ ก็ต่อเมื่อแถบนี้บอกความจริงครบ: ตรวจไปกี่ข้อ · เหลือข้อไหน ·
                             กดข้ามไปข้อที่ยังไม่ตรวจได้ · สลับกลับ "ทุกข้อ" ได้ตลอด ── */}
                      {/* แถบความคืบหน้า + ชิปข้อที่ยังไม่ตรวจ — โชว์ทั้งโหมดมีรูปและโหมดรายการ (20/10 · เดิมโหมดรายการไม่มีเลย
                          เครื่อง 81 จุดต้องเลื่อนไล่หาข้อที่ลืมเอง) · กดชิป = เลื่อนไปแถวนั้น / ขึ้นข้อนั้นในโหมดจิ้มหมุด */}
                      {checkpoints.length > 1 && (
                        <div ref={progRef} style={{ position: 'sticky', top: stackCompact ? viewerH : 0, zIndex: 4, background: 'var(--bg)',
                          borderBottom: '1px solid var(--border)', padding: '7px 0 8px', marginBottom: 8,
                          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: doneN === checkpoints.length ? 'var(--accent)' : 'var(--text2)' }}>
                            {tr("ตรวจแล้ว")} {doneN}/{checkpoints.length}
                            {todo.length > 0 && <span style={{ color: 'var(--amber)', fontWeight: 700 }}> {tr('· เหลือ')} {todo.length}</span>}
                          </span>
                          {!showPhoto ? null : (
                            <>
                              <button onClick={() => { setPinFocus(v => !v); setActiveShimId(null) }}
                                title={pinFocus ? tr('สลับเป็นไล่ดูทุกข้อในหน้าเดียว') : (allPinned ? tr('สลับเป็นแตะหมุดบนรูปแล้วขึ้นเฉพาะข้อนั้น') : tr('สลับเป็นตรวจทีละข้อ'))}
                                style={{ padding: '4px 12px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 11.5, fontWeight: 700,
                                  border: `1px solid ${pinFocus ? 'var(--accent)' : 'var(--border2)'}`,
                                  background: pinFocus ? 'var(--accent-dim)' : 'var(--bg3)', color: pinFocus ? 'var(--accent)' : 'var(--text2)' }}>
                                {pinFocus ? (allPinned ? tr("เฉพาะจุดที่แตะ") : tr("ทีละข้อ")) : tr("ทุกข้อ")}
                              </button>
                              {/* ปักไม่ครบ = ยังใช้โหมดทีละข้อได้ แค่แตะหมุดบนรูปเลือกข้อไม่ได้ — บอกตามจริง ห้ามเงียบ */}
                              {!allPinned && (
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                                  ({tr("ปักหมุดบนรูปแล้ว")} {pinnedCps.length}/{checkpoints.length} — {tr("ปักครบจะแตะหมุดเลือกข้อได้ · ปักที่")} PM Setup)
                                </span>
                              )}
                            </>
                          )}
                          {(
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{todo.length ? tr('ยังไม่ตรวจ:') : tr('ครบแล้ว 🎉')}</span>
                              {(chipsAll ? todo : todo.slice(0, CHIP_CAP)).map(c => (
                                <button key={c.id} onClick={() => { setActiveShimId(null); setActiveCpId(c.id) }}
                                  title={c.name}
                                  style={{ minWidth: 22, height: 22, borderRadius: 11, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                                    border: `1px solid ${activeCpId === c.id ? 'var(--accent)' : 'var(--border2)'}`,
                                    background: activeCpId === c.id ? 'var(--accent)' : 'var(--bg3)',
                                    color: activeCpId === c.id ? '#071008' : 'var(--text2)' }}>
                                  {checkpoints.indexOf(c) + 1}
                                </button>
                              ))}
                              {/* เกินเพดาน = ปุ่มขยาย (เดิมเขียนแค่ "+N" แล้วกดไปข้อที่ 13+ ไม่ได้เลย) */}
                              {todo.length > CHIP_CAP && (
                                <button onClick={() => setChipsAll(v => !v)}
                                  style={{ height: 22, padding: '0 8px', borderRadius: 11, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                                    border: '1px dashed var(--border2)', background: 'transparent', color: 'var(--text2)' }}>
                                  {chipsAll ? tr("ย่อ ▴") : `+${todo.length - CHIP_CAP} `}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {/* ยังไม่ได้แตะหมุด = บอกให้แตะ + ปุ่มลัดไปข้อแรกที่ยังไม่ตรวจ (ห้ามปล่อยจอว่างเฉยๆ) */}
                      {focusOn && !activeCpId && !activeShimId && (
                        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '22px 12px', lineHeight: 1.8,
                          border: '1px dashed var(--border2)', borderRadius: 'var(--r-lg)', background: 'var(--bg3-surf)' }}>
                          {allPinned ? tr("แตะหมุดบนรูปเพื่อตรวจจุดนั้น") : tr("เลือกข้อที่จะตรวจจากชิปเลขด้านบน")}
                          <div style={{ fontSize: 11.5, marginTop: 2 }}>
                            {tr("ขึ้นทีละข้อ ไม่ต้องเลื่อนหา · อยากเห็นทุกข้อพร้อมกันกดปุ่ม")} “{allPinned ? tr("เฉพาะจุดที่แตะ") : tr("ทีละข้อ")}” {tr("เพื่อสลับ")}
                          </div>
                          {todo.length > 0 && (
                            <button onClick={() => setActiveCpId(todo[0].id)}
                              style={{ marginTop: 10, padding: '7px 18px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 12.5, fontWeight: 800,
                                border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)' }}>
                              {tr('เริ่มที่ข้อ')} {checkpoints.indexOf(todo[0]) + 1} — {todo[0].name}
                            </button>
                          )}
                        </div>
                      )}
                      {/* 🚩 อ่านประวัติ NG ไม่ได้ = ยกเหตุผลเก่าให้ไม่ได้ → ต้องเขียนบนจอ
                          (กฎความซื่อสัตย์ของจอ — ห้ามกลืนเป็น "ไม่เคย NG" แล้วให้คนงงว่าทำไมไม่มีปุ่มยก) */}
                      {ngHist.error && (
                        <div style={{ margin: '0 0 8px', padding: '6px 10px', borderRadius: 'var(--r-md)', fontSize: 11.5, lineHeight: 1.6,
                          border: '1px solid var(--amber-line)', background: 'var(--amber-dim)', color: 'var(--amber)' }}>
                          ⚠ {tr('อ่านประวัติการตรวจครั้งก่อนไม่ได้ — ปุ่ม "ใช้เหตุผลเดิม" จะไม่ขึ้น ต้องพิมพ์เหตุผลเอง')} ({ngHist.error})
                        </div>
                      )}
                      {(() => {
                        // เลข Item ต่อกลุ่ม (group_name) — sort_order จาก PM Setup จัดกลุ่มมาให้ต่อเนื่องแล้ว
                        const groupNo = {}
                        let gN = 0
                        checkpoints.forEach(c => { const g = (c.group_name || '').trim(); if (g && groupNo[g] == null) groupNo[g] = ++gN })
                        /* โหมดจิ้มหมุด = โชว์เฉพาะข้อที่แตะบนรูป (ข้อเดียว ⇒ ไม่ต้องมีหัวกลุ่ม) */
                        const visibleCps = focusOn ? checkpoints.filter(c => c.id === activeCpId) : checkpoints
                        return visibleCps.map((cp) => {
                          const idx = checkpoints.indexOf(cp)
                          const g = (cp.group_name || '').trim()
                          const prevG = ((checkpoints[idx - 1]?.group_name) || '').trim()
                          const header = focusOn ? null : (g && g !== prevG ? (
                            <div style={{ padding: '7px 12px', borderRadius: 'var(--r-md)', marginBottom: 8, background: 'var(--accent-dim)', border: '1px solid var(--border2)', fontSize: 12.5, fontWeight: 800, color: 'var(--accent)' }}>
                              Item {groupNo[g]} — {g}
                            </div>
                          ) : (!g && prevG ? (
                            <div style={{ padding: '7px 12px', borderRadius: 'var(--r-md)', marginBottom: 8, background: 'var(--bg3-surf)', border: '1px solid var(--border)', fontSize: 12.5, fontWeight: 800, color: 'var(--muted)' }}>
                              {tr("อื่นๆ")}
                            </div>
                          ) : null))
                          const row = cp.type === 'variable' ? (
                            <VariableRow cp={cp} idx={idx} r={results[cp.id] ?? { v1: '', v2: '', v3: '' }} onChange={v => setResults(prev => ({ ...prev, [cp.id]: v }))} methodIndex={methodIndex} onSpc={() => setSpcCp({ cp, jigName: selectedJig?.name || '' })}
                              calcText={calcOf(cp) ? calcFormula(calcOf(cp), id => { const k = checkpoints.findIndex(c => c.id === id); return k < 0 ? '?' : `${tr("ข้อ")} ${k + 1}` }) : null} />
                          ) : cp.type === 'measure' ? (
                            <MeasureRow cp={cp} idx={idx} r={results[cp.id] ?? { mval: '' }} onChange={v => setResults(prev => ({ ...prev, [cp.id]: v }))} methodIndex={methodIndex} onSpc={() => setSpcCp({ cp, jigName: selectedJig?.name || '' })} />
                          ) : (
                            <AttrRow cp={cp} idx={idx} methodIndex={methodIndex}
                              value={results[cp.id]?.attr ?? ''} note={results[cp.id]?.note ?? ''}
                              onChangeAttr={v => setResults(prev => ({ ...prev, [cp.id]: { ...prev[cp.id], attr: v } }))}
                              onChangeNote={v => setResults(prev => ({ ...prev, [cp.id]: { ...prev[cp.id], note: v } }))}
                              /* 🚩 NG ต้องมีเหตุผล (19/11) — ของเก่ายกมาได้แต่ต้องกดยืนยัน */
                              reason={results[cp.id]?.reason ?? ''}
                              onChangeReason={v => setResults(prev => ({ ...prev, [cp.id]: { ...prev[cp.id], reason: v } }))}
                              carry={ngCarryOf(cp.id)} accepted={!!results[cp.id]?.reasonAccepted}
                              onAccept={() => setResults(prev => ({ ...prev, [cp.id]: { ...prev[cp.id], reasonAccepted: true, reason: ngCarryOf(cp.id)?.text || '' } }))}
                              okWarn={okWarnOf(cp.id)} />
                          )
                          return (
                            <div key={cp.id}>
                              {header}
                              <div ref={el => { rowRefs.current[cp.id] = el }} onClick={() => setActiveCpId(cp.id)}
                                style={{ borderRadius: 'var(--r-md)', outline: activeCpId === cp.id ? '2px solid var(--accent)' : '2px solid transparent', outlineOffset: 1, transition: 'outline-color .15s',
                                  scrollMarginTop: (stackCompact ? viewerH : 0) + progH + 12 }}>
                                {row}
                              </div>
                            </div>
                          )
                        })
                      })()}
                      {/* ปุ่มเดินหน้า-ถอยหลังในโหมดจิ้มหมุด — ตรวจต่อเนื่องได้โดยไม่ต้องกลับไปจิ้มรูปทุกครั้ง */}
                      {focusOn && activeCpId && (() => {
                        const i = checkpoints.findIndex(c => c.id === activeCpId)
                        const go = (d) => { const n = checkpoints[i + d]; if (n) setActiveCpId(n.id) }
                        const nextTodo = todo.find(c => checkpoints.indexOf(c) > i) || todo.find(c => c.id !== activeCpId)
                        return (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                            <button onClick={() => go(-1)} disabled={i <= 0} style={S.navBtn(i <= 0)}>{tr('ข้อก่อน')}</button>
                            <button onClick={() => go(1)} disabled={i >= checkpoints.length - 1} style={S.navBtn(i >= checkpoints.length - 1)}>{tr('ข้อถัดไป ▶')}</button>
                            {nextTodo && (
                              <button onClick={() => setActiveCpId(nextTodo.id)} style={{ ...S.navBtn(false), borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                                {tr('ข้อที่ยังไม่ตรวจ (')}{checkpoints.indexOf(nextTodo) + 1})
                              </button>
                            )}
                            <button onClick={() => setActiveCpId(null)} style={{ ...S.navBtn(false), marginLeft: 'auto' }}>{tr('ปิดข้อนี้')}</button>
                          </div>
                        )
                      })()}
                      {shimPoints.length > 0 && (!focusOn || activeShimId) && (
                        <ShimRecordSection points={shimPoints} shown={shimPoints.filter(pt => !focusOn || pt.id === activeShimId)}
                          shimKinds={shimKinds} shimVals={shimVals} setShimVals={setShimVals} canShim={canShim}
                          pinnedIds={new Set(shimPins.map(x => x.point.id))} rowRefs={rowRefs}
                          scrollMarginTop={(stackCompact ? viewerH : 0) + progH + 12}
                          readOnlyNote={shimAmReadOnly ? tr('ใบ AM ดูค่าชิมได้อย่างเดียว — บันทึกค่าชิมเป็นงานของทีมช่าง (ใบ PM)') : null} />
                      )}
                      <InspectorCodeField value={inspectorCode} onChange={setInspectorCode} required style={{ marginTop: 8 }} />
                      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={tr('หมายเหตุ (ถ้ามี)...')} style={{ marginTop: 8 }} />
                      {/* 🔴 ตรวจไม่ครบ = บันทึกไม่ได้ (19/11 · คำสั่ง user — มาตรฐานเดียวกับใบตรวจ QA)
                          เดิม (06/10) "เตือน + ถามยืนยัน แล้วบันทึกค้างเป็น pending" — user เลือกให้ทุกระบบตรวจ (QA/PM/AM) บล็อกเหมือนกัน
                          · ปุ่มยังกดได้เพื่อบอกเหตุ: ขึ้นเลขข้อที่ยังไม่ตรวจ (เลขเดียวกับชิป "ยังไม่ตรวจ") + พาไปข้อแรกที่ขาด
                          · ปุ่มยังเหลือง + บอกจำนวนที่ขาด (สีตรงกับความจริง · คอมเมนต์ทีม MTN 06/10) · ด่านซ้ำใน handleSave */}
                      <button onClick={() => {
                        if (!isFormReady) { blockIncomplete(); return }
                        handleSave()
                      }} disabled={saving || !canRecord}
                        style={{ ...S.saveBtn,
                          background: isFormReady ? 'var(--accent)' : 'var(--accent2)',
                          color: isFormReady ? 'var(--accent-ink)' : SAVE_WARN_INK,
                          opacity: (saving || !canRecord) ? 0.6 : 1 }}>
                        {saving ? tr("กำลังบันทึก...") : !canRecord ? `${tr("ไม่มีสิทธิ์บันทึกผลตรวจ")} ${isAmTeam(department) ? 'AM' : 'PM'}` : isFormReady ? tr("บันทึกผลการตรวจ") : `${tr("ยังบันทึกไม่ได้ — ยังไม่ตรวจ")} ${nMissing} ${tr("จุด")}`}
                      </button>
                    </>
                  )}
                  </>
                )

                return twoCol ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(min(360px, 100%), 1fr) minmax(420px, 640px)', gap: 24, alignItems: 'start', maxWidth: 1500, margin: '0 auto' }}>
                    <div style={{ position: 'sticky', top: 8 }}>{viewerNode}</div>
                    <div>{formNode}</div>
                  </div>
                ) : (
                  <div style={{ maxWidth: showPhoto ? 760 : 720, margin: '0 auto' }}>
                    {/* 📌 จอแคบ: รูป + หมุด **ติดอยู่บนหัวจอ** ตลอดที่ไล่เช็คลงไป
                        เดิมวางไว้เฉยๆ แล้วเลื่อนหายไปตั้งแต่ข้อ 3-4 → ข้อหลังๆ ไม่รู้ว่าจุดอยู่ตรงไหนของเครื่อง
                        พื้นหลังทึบบังคับ (ไม่งั้นรายการเลื่อนทะลุใต้รูป) · พับเก็บได้เมื่ออยากได้พื้นที่กรอกเต็ม */}
                    {stackCompact && (
                      <div ref={viewerRef} style={{
                        position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)',
                        paddingBottom: 8, marginBottom: 10, borderBottom: '1px solid var(--border)',
                      }}>
                        {viewerOpen && viewerNode}
                        <button onClick={toggleViewer} style={{
                          display: 'block', margin: '6px auto 0', padding: '3px 14px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                          fontSize: 11, fontWeight: 700, border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text2)',
                        }}>
                          {/* พับแล้วต้องยังบอกว่าซ่อนอะไรไว้ + กางคืนได้ ห้ามหายเงียบ */}
                          {viewerOpen ? tr("ซ่อนรูปเครื่อง") : tr("แสดงรูปเครื่อง (ดูว่าจุดอยู่ตรงไหน)")}
                        </button>
                      </div>
                    )}
                    {!stackCompact && viewerNode}
                    {formNode}
                  </div>
                )
              })()}

              {tab === 'history' && (() => {
                /* 🔀 เครื่องเดียวตรวจได้หลายทีม — จัดกลุ่มตาม "เจ้าของใบ" ห้ามปนในลิสต์เดียว
                   (ของกลาง `splitInspByTeam` · เหตุผล+ตัวเลขใน src/utils/pmTeams.js)
                   ใบของทีมอื่น/ชี้ทีมไม่ได้ ต้อง **เขียนบนจอ** ไม่ใช่กรองทิ้งเงียบ */
                const grp = splitInspByTeam([...inspections, ...(showOther ? histOther : [])], { clDeptById, team: department })
                const otherN = histMeta?.otherN
                return (
                <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {histMeta && !histMeta.teamsKnown && (
                    <p style={{ margin: 0, padding: '8px 10px', borderRadius: 'var(--r-md)', fontSize: 11.5, fontWeight: 600,
                                border: '1px solid var(--amber)', background: 'var(--bg3-surf)', color: 'var(--amber)' }}>
                      ⚠️ {tr("อ่านทีมเจ้าของใบไม่ได้ — ลิสต์นี้เป็นใบ")}<b>{tr('ทุกทีม')}</b>{tr("ของเครื่องนี้ปนกัน และบอกไม่ได้ว่าใบไหนของใคร")}
                    </p>
                  )}
                  {histMeta?.teamsKnown && otherN === null && (
                    <p style={{ margin: 0, fontSize: 11.5, color: 'var(--amber)' }}>
                      ⚠️ {tr("นับใบของทีมอื่นไม่ได้ — อาจมีใบของทีมอื่นบนเครื่องนี้ที่ยังไม่ได้แสดง")}
                    </p>
                  )}
                  {!!otherN && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text2)' }}>
                      <span>{tr('🔀 เครื่องนี้มีใบของทีมอื่นอีก')} <b>{otherN}</b> {tr('ใบ (')}{(histMeta.otherTeams || []).map(inspTeamLabel).join(' · ')})</span>
                      <button type="button" onClick={toggleOtherHist} style={{
                        padding: '3px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                        border: '1px dashed var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text2)',
                      }}>{showOther ? tr('ซ่อนใบของทีมอื่น') : tr('ดูใบของทีมอื่นด้วย')}</button>
                    </div>
                  )}
                  {!!histMeta?.unknownN && (
                    <p style={{ margin: 0, fontSize: 11.5, color: 'var(--amber)' }}>
                      ⚠️ {tr("อีก")} <b>{histMeta.unknownN}</b> {tr("ใบของเครื่องนี้ชี้ทีมเจ้าของไม่ได้ (ใบไม่ผูกจุดตรวจของเครื่องนี้) — ไม่ได้แสดงในลิสต์")}
                    </p>
                  )}
                  {grp.mine.length === 0 && grp.others.length === 0 && grp.unknown.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>
                      {otherN ? tr("ทีมนี้ยังไม่เคยตรวจเครื่องนี้ — มีแต่ใบของทีมอื่น (กดดูได้ด้านบน)") : tr("ยังไม่มีประวัติการตรวจ")}
                    </p>
                  ) : [...grp.mine, ...grp.others, ...grp.unknown].map(insp => (
                    <div key={insp.id} onClick={() => setViewInspection(insp)} style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--card-surf)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{formatDate(insp.inspected_at)}</p>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-md)', background: insp.status === 'pass' ? 'var(--accent-dim)' : insp.status === 'fail' ? 'rgba(224,92,74,0.12)' : 'var(--bg3)', color: insp.status === 'pass' ? 'var(--accent)' : insp.status === 'fail' ? '#e05c4a' : 'var(--muted)' }}>{insp.status?.toUpperCase()}</span>
                          {/* 🔀 ใบที่ไม่ใช่ของทีมที่กำลังดู ต้องติดป้ายว่าของใคร — ไม่งั้นปนกันแล้วแยกไม่ออก */}
                          {(clDeptById[insp.checklist_id] ?? null) !== department && (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-md)',
                                           border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text2)' }}>
                              {inspTeamLabel(clDeptById[insp.checklist_id])}
                            </span>
                          )}
                          {insp.approval_status === 'approved' && <span style={{ fontSize: 11, color: 'var(--accent)' }}>{isAmTeam(clDeptById[insp.checklist_id] ?? department) ? tr('✓ อนุมัติแล้ว') : tr('✓ หัวหน้ายืนยันแล้ว')}</span>}
                          {insp.approval_status === 'rejected' && <span style={{ fontSize: 11, color: 'var(--red)' }}>{tr('✕ ตีกลับ')}</span>}
                          {insp.approval_status === 'pending' && (() => {
                            // ✍️ B2 — ใบ AM บอกว่ารอใคร (ชั้นถัดไปเหนือคนตรวจ) · ใบช่าง = ป้ายเดิม
                            const am = isAmTeam(clDeptById[insp.checklist_id] ?? department)
                            const nx = am ? amNextApprover(positionRank(inspectorOf(insp).position)) : null
                            // ใบช่าง (PM) = รอหัวหน้าผู้ตรวจยืนยัน (ขั้น 2 · 11/11)
                            return <span style={{ fontSize: 11, color: 'var(--muted)' }}>{nx ? (nx.step ? `${tr("รอ")}${nx.step.label}` : tr("รอผู้จัดการรับทราบ")) : `${tr("รอ")}${tr(PM_HEAD_STEP.label)}${tr("ยืนยัน")}`}</span>
                          })()}
                          {/* NG ใบนี้ถูกส่งซ่อมหรือยัง — ตอบคำถาม "ที่เจอเมื่อวาน แก้แล้วรึยัง" ได้จากตรงนี้เลย */}
                          {moByInsp[insp.id] && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#fb923c' }}>
                              {tr("ใบซ่อม")} {moByInsp[insp.id].mo_no || tr("(รอออกเลข)")} · {moStatusLabel(moByInsp[insp.id])}
                            </span>
                          )}
                          {insp.status === 'fail' && !moByInsp[insp.id] && insp.mo_waived_reason && (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('ไม่เปิดใบซ่อม:')} {insp.mo_waived_reason}</span>
                          )}
                          {insp.status === 'fail' && !moByInsp[insp.id] && !insp.mo_waived_reason && isAmTeam(clDeptById[insp.checklist_id] ?? department) && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>{tr('⚠ ยังไม่เปิดใบซ่อม / ไม่ระบุเหตุผล')}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* กด "ไว้ก่อน" ตอนบันทึกแล้วต้องกลับมาเปิดได้ — ไม่งั้นข้ามครั้งเดียว = ทางตัน */}
                        {insp.status === 'fail' && !moByInsp[insp.id] && !insp.mo_waived_reason && (can('mtn_repair', 'report', userRole) || isAmTeam(clDeptById[insp.checklist_id] ?? department)) && (
                          <button onClick={e => { e.stopPropagation(); openMoFromHistory(insp) }} style={{
                            padding: '5px 11px', borderRadius: 'var(--r-md)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                            border: '1px solid #fb923c', background: 'rgba(251,146,60,0.12)', color: '#fb923c',
                          }}>{tr('เปิดใบแจ้งซ่อม')}</button>
                        )}
                        <span style={{ color: 'var(--muted)' }}>›</span>
                      </div>
                    </div>
                  ))}
                </div>
                )
              })()}
            </div>
          </>
        )}
      </div>
      )}

      {spcCp && <EquipSpcModal cp={spcCp.cp} jigName={spcCp.jigName} onClose={() => setSpcCp(null)} />}
      <AnimatePresence>
        {viewInspection && (
          <HistoryModal inspection={viewInspection} checkpoints={loadedCps} jig={selectedJig}
            userId={userId} userRole={userRole} deptWrite={deptWrite} canRecord={canRecord}
            isAm={isAmTeam(clDeptById[viewInspection.checklist_id] ?? department)}
            lineWrite={isAmTeam(clDeptById[viewInspection.checklist_id] ?? department) ? amLineWriteOf(selectedJig?.line_name) : null}
            deptKey={clDeptById[viewInspection.checklist_id] ?? department}
            inspectorPosition={inspectorOf(viewInspection).position} inspectorIsSelf={inspectorOf(viewInspection).isSelf} myPosition={myPosition}
            isShared={!!isSharedAccount}
            onClose={() => { setViewInspection(null); if (selectedJig) fetchHistory(selectedJig.id) }} />
        )}
      </AnimatePresence>

      {/* ── 🔧 เจอ NG → เปิดใบแจ้งซ่อม MO ต่อเลย ──────────────────────────────────
          ⚠️ ไม่ปิดจากการคลิกพื้นหลัง (UI-CONVENTIONS §5) — เผลอแตะแล้วปิด = เสียโอกาสเปิดใบ
             ตอนที่คนยังอยู่หน้าเครื่องและรู้ว่าเสียยังไง (ยังกลับมาเปิดจากประวัติได้ แต่คนละจังหวะ) */}
      {moPrompt && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 460, background: 'var(--bg2-surf)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--red)' }}>{tr('⚠ พบผลตรวจไม่ผ่าน')} {moPrompt.ngTopics.length} {tr('จุด')}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>{(moPrompt.jig || selectedJig)?.name}{moQueue.length ? ` · ${tr('ต่อคิวอีก')} ${moQueue.length} ${tr('เครื่อง')}` : ''}</div>
            </div>
            <div style={{ background: 'var(--bg3-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, maxHeight: 130, overflowY: 'auto' }}>
              {moPrompt.ngTopics.map((n, i) => <div key={i}>• {n}</div>)}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>{tr('แจ้งถึงทีมช่าง')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {MTN_TEAMS.map(t => (
                  <button key={t} onClick={() => setMoTeam(t)} style={{
                    padding: '6px 13px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: `1.5px solid ${moTeam === t ? 'var(--accent)' : 'var(--border2)'}`,
                    background: moTeam === t ? 'var(--accent-dim)' : 'var(--bg3)', color: moTeam === t ? 'var(--accent)' : 'var(--muted)',
                  }}>{deptNameOf(t)}</button>
                ))}
              </div>
              {/* AM เจอ NG ส่งกลับให้ผลิตซ่อมเองไม่ได้ — ต้องบอกว่าทีมตั้งต้นมาจากการเดา ให้เลือกทับได้ */}
              {isAmTeam(department) && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
                  {tr("ผลตรวจนี้เป็น AM (ผลิตตรวจเอง) — ระบบเดาทีมช่างจากชนิดอุปกรณ์ให้ก่อน เลือกใหม่ได้ถ้าไม่ตรง")}
                </div>
              )}
            </div>
            {/* 🔧 B3 — ใบ AM: ข้ามได้เฉพาะเมื่อเขียนเหตุผล (บันทึกลงผลตรวจ · บอร์ด AM เห็น) */}
            {isAmPrompt && moWaiving && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>{tr('เหตุผลที่ไม่เปิดใบแจ้งซ่อม')}</div>
                <textarea value={moWaiveReason} onChange={e => setMoWaiveReason(e.target.value)} rows={2}
                  placeholder={tr('เช่น แก้ไขเองหน้างานแล้ว / แจ้งหัวหน้าให้เปิดใบแล้ว')} style={{ width: '100%' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {!isAmPrompt && (
                <button onClick={() => setMoPrompt(null)} disabled={moSaving} style={{
                  padding: '9px 18px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text2)',
                }}>{tr('ไว้ก่อน')}</button>
              )}
              {isAmPrompt && !moWaiving && (
                <button onClick={() => setMoWaiving(true)} disabled={moSaving} style={{
                  padding: '9px 18px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text2)',
                }}>{tr('ไม่เปิดใบ (ระบุเหตุผล)')}</button>
              )}
              {isAmPrompt && moWaiving && (<>
                <button onClick={() => setMoWaiving(false)} disabled={moSaving} style={{
                  padding: '9px 14px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--muted)',
                }}>{tr('กลับ')}</button>
                <button onClick={waiveMo} disabled={moSaving || !amWaiverReasonValid(moWaiveReason)} style={{
                  padding: '9px 18px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid var(--amber)', background: 'var(--amber-dim)', color: 'var(--amber)',
                  opacity: moSaving || !amWaiverReasonValid(moWaiveReason) ? 0.5 : 1,
                }}>{tr('บันทึกเหตุผล')}</button>
              </>)}
              {can('mtn_repair', 'report', userRole) && !moWaiving && (
                <button onClick={createMoFromInspection} disabled={moSaving} style={{
                  padding: '9px 20px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                  border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', opacity: moSaving ? 0.6 : 1,
                }}>{moSaving ? tr('กำลังเปิดใบ...') : tr('เปิดใบแจ้งซ่อม')}</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
              {isAmPrompt
                ? (can('mtn_repair', 'report', userRole)
                  ? tr("ผลตรวจ AM ที่ผิดปกติต้องเปิดใบแจ้งซ่อม หรือระบุเหตุผลที่ไม่เปิด — บอร์ด AM จะติดตามใบซ่อมจนกว่าจะปิด")
                  : tr("บัญชีนี้เปิดใบแจ้งซ่อมไม่ได้ — ระบุเหตุผล (เช่น แจ้งหัวหน้าแล้ว) หรือให้หัวหน้าเปิดจากแท็บ 🕐 ประวัติ"))
                : tr("กด “ไว้ก่อน” ได้ — เปิดทีหลังจากแท็บ 🕐 ประวัติ ของเครื่องนี้")}
            </div>
            {/* ปิดหน้าต่างได้ (ไม่ขังคนไว้ในโมดัล) แต่รายการ "ยังไม่จบ" — ค้างเป็น ⚠ บนบอร์ด AM + แท็บประวัติจนกว่าจะเปิดใบ/ให้เหตุผล */}
            {isAmPrompt && (
              <button type="button" onClick={() => setMoPrompt(null)} disabled={moSaving}
                style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: 'var(--muted)', textAlign: 'center', textDecoration: 'underline' }}>
                {tr('ปิดหน้าต่าง — รายการนี้จะค้าง “⚠ ยังไม่เปิดใบแจ้งซ่อม” บนบอร์ด AM จนกว่าจะเปิดใบหรือระบุเหตุผล')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>

    {/* 📷 สแกนป้ายเครื่อง → เลือกอุปกรณ์นั้นให้เลย (คืน string = ข้อความ error ให้โชว์ในโมดัล)
        🔴 ไม่พบ/ไม่อยู่ในแผนกนี้ ต้องบอกเหตุผล ห้ามปิดเงียบแล้วไม่เกิดอะไรขึ้น */}
    {scanOpen && (
      <ScanModal title={tr('สแกนป้ายเครื่อง')} hint={tr('ส่องป้าย QR ที่ติดเครื่อง หรือยิงด้วยเครื่องสแกน')}
        onScan={(parsed) => {
          const j = resolveJig(parsed, jigs)
          if (!j) return 'ไม่พบอุปกรณ์นี้ในทะเบียน PM — ลงทะเบียนที่แท็บ ⚙️ ตั้งค่าจุดตรวจก่อน'
          if (!deptJigsAll.some(x => x.id === j.id)) return `${j.jig_no || j.name || tr('อุปกรณ์นี้')} ${tr("อยู่คนละแผนกกับแท็บที่เปิดอยู่ — สลับแผนกด้านบนก่อน")}`
          selectJig(j)
          setScanOpen(false)
        }}
        onClose={() => setScanOpen(false)} />
    )}
    </Page>
  )
}
