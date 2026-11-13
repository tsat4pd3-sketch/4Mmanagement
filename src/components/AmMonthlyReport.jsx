/* ── 📅 รายงาน AM รายเดือน — แท็บ `?sub=monthly` ของ /daily-checker?tab=pm (2026-11-03 · ประชุม 02/11 ข้อ C2) ──
   *"รายงาน AM ตอนนี้มีแค่รายวัน ต้องมีรายเดือนแบบ LPA"* — แถว = ไลน์ (กางเป็นรายเครื่องได้) · คอลัมน์ = วัน ·
   ช่อง = ตรวจแล้ว / ขาด / ไม่ได้ผลิต / ไม่มีแผน / ไม่รู้ · % ความครบ (ตัวหาร = ตรวจแล้ว + ขาด) · จำนวน NG

   · ข้อมูลทั้งหมดมาจาก `loadMonthlyAm()` (`lib/dailyAmBoard.js`) → `buildAmMonthly()` (`lib/amMonthly.js` · pure · มีเทส)
     **ห้ามคิวรี inspections / ตัดสินสถานะช่องเองในไฟล์นี้**
   · สัญลักษณ์สถานะวัน = `CHECK_DAY_META` · legend = `CHECK_DAY_LEGEND` (ห้ามแต่งเอง · UI §6.29)
     ผลตรวจในช่อง "ตรวจแล้ว" = `AM_RESULT_META` (OK/NG/!) — ตัวอักษรลอยไม่มีกรอบ ≠ สถานะวันที่เป็น chip มีกรอบ
   · ตาราง/สรุป = อ่านอย่างเดียว · ตัวกรองไลน์ = มุมมอง (ซ่อนแล้วบอกจำนวน)
   · Excel = ทะเบียน `/doc-forms` คีย์ `xlsx_am_monthly` (เลขฟอร์มอยู่ที่ชื่อไฟล์ · ห้ามแทรกแถวบนสุดของชีต)
   · ✍️ แผง "ลงนามทบทวนรายเดือน" (ขั้น 3 ของสาย AM · 2026-11-03) = **ทางเขียน DB ทางเดียวของจอนี้**
     ตาราง `am_monthly_signoffs` (Main) ผ่าน `lib/amMonthlySignoff.js` · ด่าน: `canSeeded('am','monthly_signoff')` ②
     + `canWriteLine()` ③ + ตำแหน่ง/เดือนจบ `amMonthlySignoffVerdict()` — **คิดใหม่ตอนกด** ไม่ใช่แค่ซ่อนปุ่ม
     + ด่าน stale (`viewKey(month, shift)`) · snapshot ตอนลงนาม ≠ ตัวเลขสด = เขียนบนจอ (`amSignoffDrift`) */
import { useContext, useEffect, useMemo, useState } from 'react'
import { UserContext } from '../App'
import { supabase } from '../supabaseClient'
import { toast } from './Toast'
import { canSeeded, isSharedAccount } from '../utils/permissions'
import { positionRank, positionLabel } from '../utils/positions'
import { canWriteLine, writeBlockText } from '../utils/writeScope'
import { viewKey, isStale, staleBlockText } from '../utils/staleView'
import { amMonthlySignoffVerdict, amMonthlyRevokeVerdict, amMonthlySignoffText, amApprovalAssumptionText, AM_REVOKE_REASON_MIN } from '../utils/amApproval'
import { amMonthComplete, amSignoffSnapshot, amSignoffDrift, amSignoffDriftText, amSignoffAoa } from '../lib/amMonthly'
import { loadAmMonthlySignoffs, signoffsByLine, signAmMonthly, revokeAmMonthly } from '../lib/amMonthlySignoff'
import FilterBar from './FilterBar'
import Segmented from './Segmented'
import LineScopeSelect from './LineScopeSelect'
import { loadMonthlyAm } from '../lib/dailyAmBoard'
import { buildAmMonthly, amMonthlyAoa, amRowsSummary, AM_RESULT_META } from '../lib/amMonthly'
import { CHECK_DAY, CHECK_DAY_META, CHECK_DAY_LEGEND, checkDaysNote } from '../utils/dailyCheckDay'
import { loadCompanyCalendar } from '../utils/companyCalendar'
import { isWorkingDayFrom } from '../utils/workingDay'
import { getWorkDate } from '../utils/workDate'
import { loadDocForms } from '../utils/docForms'
import { xlsxDocName } from '../utils/csvDoc'

import { tr } from '../utils/i18n';
// กะเป็น "ส่วนหนึ่งของคีย์" (AM ตรวจต้นกะ) ⇒ ไม่มีตัวเลือก "ทุกกะ" (filterLabels.js: ห้ามใช้ SHIFT_OPTIONS กับจอแบบนี้)
const AM_SHIFT_OPTIONS = [
  { value: 'day', label: 'กะเช้า' },
  { value: 'night', label: 'กะดึก' },
]
const VIEW_OPTIONS = [
  { value: 'line', label: 'รายไลน์' },
  { value: 'machine', label: 'รายเครื่อง' },
]
const norm = (v) => String(v ?? '').trim().toLowerCase()
const HOLIDAY_BG = 'var(--green-dim)'   // สีหัวคอลัมน์วันหยุด — ชุดเดียวกับตาราง LPA
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

const cell = { border: '1px solid var(--border)', textAlign: 'center', fontSize: 11, minWidth: 26, padding: '2px 1px', whiteSpace: 'nowrap' }
const stickyCol = { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, textAlign: 'left', minWidth: 190, maxWidth: 240, padding: '3px 6px' }

function StateChip({ state }) {
  const m = CHECK_DAY_META[state]
  if (!m?.mark) return null
  return <span style={{ display: 'inline-block', padding: '0 3px', borderRadius: 'var(--r-xs)', border: `1px solid ${m.color}`, color: m.color, fontWeight: 700, lineHeight: '14px', fontSize: 11 }}>{m.mark}</span>
}

export default function AmMonthlyReport({ lines = [], scopedLines = [] }) {
  const [month, setMonth] = useState(() => getWorkDate().slice(0, 7))
  const [shift, setShift] = useState('day')
  const [view, setView] = useState('line')
  const [scope, setScope] = useState({ section: '', line: '', names: null })
  const [raw, setRaw] = useState(null)       // ผลของ loadMonthlyAm (ชุดล่าสุดที่ตรงกับเดือนที่เลือก)
  const [cal, setCal] = useState(null)       // Map ปฏิทินบริษัท · null = ยังไม่โหลด/โหลดไม่ได้
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => { loadDocForms().catch(() => {}) }, [])   // ชื่อไฟล์ Excel อ่านเลขฟอร์มแบบ sync — ต้อง warm cache เอง
  useEffect(() => {
    let alive = true
    loadCompanyCalendar().then(m => { if (alive) setCal(m) }).catch(() => { if (alive) setCal(null) })
    return () => { alive = false }
  }, [])

  // โหลดใหม่เมื่อเปลี่ยนเดือน (กะ/มุมมอง = คิดใหม่จากชุดเดิม ไม่ยิงฐาน) · คำตอบที่มาช้าของเดือนก่อนถูกทิ้ง
  useEffect(() => {
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-change มาตรฐาน (แบบเดียวกับ DailyPM) · มี guard alive
    setLoading(true); setErr('')
    loadMonthlyAm({ month, lines: lines.length ? lines : null }).then(res => {
      if (!alive) return
      if (!res.ok) { setErr(res.error?.message || String(res.error)); setRaw(null) }
      else setRaw(res)
      setLoading(false)
    }).catch(e => { if (alive) { setErr(e?.message || String(e)); setRaw(null); setLoading(false) } })
    return () => { alive = false }
    // lines = ทะเบียนจากหน้าแม่ (โหลดครั้งเดียว) — ใช้แค่ความยาวเป็นตัวบอกว่ามาแล้ว (กฎเขียน DB ข้อ 9: ห้าม array ใน deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, lines.length])

  const rep = useMemo(() => {
    if (!raw || raw.month !== month) return null
    return buildAmMonthly({
      month, shift, targets: raw.targets, jigs: raw.jigs, amEquipIds: raw.amEquipIds,
      inspections: raw.inspections, runsByKey: raw.runsByKey, lines: raw.lines,
      isWorkingDay: cal ? (d => isWorkingDayFrom(cal, d)) : null,
    })
  }, [raw, month, shift, cal])

  const shown = useMemo(() => {
    if (!rep) return []
    if (!scope.names?.length) return rep.rows
    const keep = new Set(scope.names.map(norm))
    return rep.rows.filter(r => keep.has(norm(r.line_name)))
  }, [rep, scope.names])
  const hiddenN = rep ? rep.rows.length - shown.length : 0
  const sum = useMemo(() => amRowsSummary(shown), [shown])
  const pct = sum.pct

  const holiday = (d) => (cal ? !isWorkingDayFrom(cal, d) : false)

  /* ── ✍️ ลงนามทบทวนรายเดือน (ขั้น 3) ─────────────────────────────────────────────────────── */
  const { role, section: homeSection, sections: scopeSecs = [], allUnits, respCostCenters, scopeIdx,
          fullName, position: myPosition, signatureUrl: mySignature } = useContext(UserContext)
  const [uid, setUid] = useState(null)
  const [sign, setSign] = useState({ key: '', ok: false, rows: [], missing: false, error: '' })
  const [signTick, setSignTick] = useState(0)
  const [signing, setSigning] = useState(null)    // { line } — โมดัลลงนาม
  const [revoking, setRevoking] = useState(null)  // แถวลายเซ็นที่จะเพิกถอน
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const curKey = viewKey(month, shift)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setUid(data?.session?.user?.id || null) }).catch(() => {})
    return () => { alive = false }
  }, [])
  useEffect(() => {
    let alive = true
    const key = viewKey(month, shift)
    loadAmMonthlySignoffs({ month, shift }).then(res => {
      if (!alive) return
      setSign({ key, ok: res.ok, rows: res.rows, missing: res.missing, error: res.error || '' })
    }).catch(e => { if (alive) setSign({ key, ok: false, rows: [], missing: false, error: e?.message || String(e) }) })
    return () => { alive = false }
  }, [month, shift, signTick])

  const signFresh = sign.key === curKey
  const byLine = useMemo(() => (sign.ok ? signoffsByLine(sign.rows) : null), [sign])
  const mc = amMonthComplete(month)
  const myRank = positionRank(myPosition)
  const permitted = canSeeded('am', 'monthly_signoff', role)
  const wCtx = { role, section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx }
  const lineWrite = (lineName) => canWriteLine(wCtx, lineName === '—' ? '' : lineName, lines, { unknownTarget: 'block' })
  const signVerdict = (lineName) => amMonthlySignoffVerdict({
    permitted, sharedAccount: isSharedAccount(), scopeOk: lineWrite(lineName).ok, signerRank: myRank,
    monthComplete: amMonthComplete(month).complete, alreadySigned: !!byLine?.get(lineName)?.active,
  })
  const revokeVerdict = (row, why) => amMonthlyRevokeVerdict({
    permitted, sharedAccount: isSharedAccount(), scopeOk: lineWrite(row.line_name).ok, revokerRank: myRank,
    signerRank: row.position_rank ?? null, isSigner: !!uid && row.signed_by === uid, reason: why,
  })

  const doSign = async () => {
    if (!signing) return
    // 🔴 ด่าน stale: ทะเบียนลงนาม/ตารางเดือนต้องเป็นของ เดือน+กะ ที่เลือกอยู่จริง
    if (isStale(sign.key, curKey) || !rep || raw?.month !== month) { toast.error(staleBlockText({ unitWord: tr('เดือน/กะ') })); return }
    const row = rep.rows.find(r => r.line_name === signing.line)
    const v = signVerdict(signing.line)   // คิดใหม่ตอนกด — ไม่ใช้ค่าตอน render
    setBusy(true)
    const ok = await signAmMonthly({
      verdict: v, opensOn: mc.opensOn, month, shift, lineName: signing.line,
      snapshot: amSignoffSnapshot(row, { month, shift }), userId: uid, fullName,
      position: myPosition, positionRank: myRank, signatureUrl: mySignature, note,
    })
    setBusy(false)
    if (!ok) return
    toast.success(`ลงนามทบทวน ${signing.line} เดือน ${month} แล้ว`)
    setSigning(null); setNote(''); setSignTick(t => t + 1)
  }
  const doRevoke = async () => {
    if (!revoking) return
    if (isStale(sign.key, curKey)) { toast.error(staleBlockText({ unitWord: tr('เดือน/กะ') })); return }
    const v = revokeVerdict(revoking, reason)
    setBusy(true)
    const ok = await revokeAmMonthly({ verdict: v, id: revoking.id, reason, userId: uid, fullName })
    setBusy(false)
    if (!ok) return
    toast.success('เพิกถอนลายเซ็นแล้ว — ลงนามใหม่ได้')
    setRevoking(null); setReason(''); setSignTick(t => t + 1)
  }

  const exportXlsx = async () => {
    if (!rep) return
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      const sub = { ...rep, rows: shown }
      const ws = XLSX.utils.aoa_to_sheet(amMonthlyAoa(sub, s => CHECK_DAY_META[s]))
      ws['!cols'] = [{ wch: 18 }, { wch: 26 }, { wch: 12 }, ...rep.days.map(() => ({ wch: 5 })), ...Array(7).fill({ wch: 9 })]
      // คำอธิบาย/ข้อจำกัดอยู่ชีตที่ 2 — ชีตแรกต้องเริ่มที่หัวตาราง (ตัวอ่านของผู้ใช้ยึดแถวแรก = หัว)
      const notes = [
        ['รายงาน AM รายเดือน', `${month} · ${shift === 'day' ? 'กะเช้า' : 'กะดึก'}`],
        ['สรุป', checkDaysNote(sum) + (sum.pct != null ? ` · ความครบ ${sum.pct}%` : '')],
        ['ความครบ (%)', 'เครื่อง-วันที่ตรวจแล้ว ÷ (ตรวจแล้ว + ขาด) — ไม่นับวันไม่ได้ผลิต/ไม่มีแผน/ไม่รู้'],
        [],
        ['ผลตรวจในช่อง', 'ความหมาย'],
        ...Object.values(AM_RESULT_META).map(m => [m.mark, m.label]),
        [],
        ['สถานะวัน', 'ความหมาย'],
        ...CHECK_DAY_LEGEND.map(k => [CHECK_DAY_META[k].mark, CHECK_DAY_META[k].label]),
        ['(ว่าง)', 'วันหยุดโรงงาน / ยังไม่ถึงกะ'],
        ...(raw?.runsError ? [[], ['⚠', `อ่านตารางเปิดกะไม่สำเร็จ (${raw.runsError}) — วันที่ไม่ได้ตรวจแสดงเป็น "?" ไม่ใช่ "ขาด"`]] : []),
        ...(hiddenN ? [[], ['ตัวกรอง', `ไฟล์นี้มีเฉพาะไลน์ที่เลือก — ซ่อน ${hiddenN} ไลน์`]] : []),
        [],
        ['ลงนามทบทวน', signFresh && sign.ok
          ? 'ชีต "ลงนามทบทวน" — ผู้ลงนาม/วันที่/ลายเซ็น (URL) ต่อไลน์ · ตัวเลข "ณ ตอนลงนาม" มาจากบันทึก ไม่ใช่ของสด'
          : (sign.missing ? 'ระบบลงนามรายเดือนยังไม่เปิดใช้ (ตารางยังไม่ถูกสร้าง) — ไฟล์นี้ไม่มีข้อมูลการลงนาม'
            : `อ่านทะเบียนลงนามไม่ได้${sign.error ? ` (${sign.error})` : ''} — ไฟล์นี้ไม่ได้บอกว่ามีใครลงนามหรือไม่`)],
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'AM รายเดือน')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), 'คำอธิบาย')
      const signWs = XLSX.utils.aoa_to_sheet(amSignoffAoa(shown, signFresh && sign.ok ? byLine : null, {
        positionLabel, fmt: fmtWhen,
        unreadable: sign.missing ? 'ระบบลงนามยังไม่เปิดใช้' : 'อ่านทะเบียนลงนามไม่ได้',
      }))
      signWs['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 40 }, { wch: 24 }, { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 6 }, { wch: 40 }, { wch: 10 }]
      XLSX.utils.book_append_sheet(wb, signWs, 'ลงนามทบทวน')
      XLSX.writeFile(wb, xlsxDocName('xlsx_am_monthly', `AM_Monthly_${month}_${shift}`))
    } catch (e) {
      toast.error(`ส่งออก Excel ไม่สำเร็จ: ${e?.message || e}`)
    } finally { setExporting(false) }
  }

  const ngN = shown.reduce((a, r) => a + r.ngN, 0)
  const unknownN = shown.reduce((a, r) => a + r.sum.unknown, 0)

  return (
    <div>
      <FilterBar style={{ marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          {tr('เดือน')} <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
        </label>
        <Segmented label={tr('กะ')} value={shift} onChange={setShift} options={AM_SHIFT_OPTIONS} />
        <LineScopeSelect lines={scopedLines} section={scope.section} line={scope.line}
          onChange={(section, line, info) => setScope({ section, line, names: info?.lines?.length ? info.lines : (section || line ? [line || section] : null) })} />
        <Segmented label={tr('แสดง')} value={view} onChange={setView} options={VIEW_OPTIONS} />
        <span className="spacer" />
        {rep && <span className="filter-count">{shown.length} {tr('ไลน์ ·')} {shown.reduce((a, r) => a + r.machines.length, 0)} {tr('เครื่อง')}</span>}
        <button type="button" onClick={exportXlsx} disabled={!rep || exporting || !shown.length}
          style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-md)', padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>
          {exporting ? tr('⏳ กำลังส่งออก…') : '📥 Excel'}
        </button>
      </FilterBar>

      {err && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 12, fontWeight: 700 }}>
          ⚠ โหลดรายงาน AM ไม่สำเร็จ: {err} — ตารางไม่แสดง (ไม่ได้แปลว่าไม่มีใครตรวจ) · ลองเปลี่ยนเดือนหรือรีเฟรช
        </div>
      )}
      {loading && !rep && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>{tr('กำลังโหลด...')}</div>}

      {rep && (
        <div className="card" style={{ padding: 16, opacity: loading ? 0.6 : 1 }}>
          {/* 🔴 ตัวเลข "ตรวจแล้ว N" ลอยๆ ไม่พอ — ต้องมีตัวหาร (utils/dailyCheckDay.js) */}
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
            <span style={{ color: sum.missed ? 'var(--red)' : 'var(--text2)' }}>{checkDaysNote(sum)}</span>
            {pct != null && <> {tr('· ความครบ')} <b style={{ color: 'var(--text)' }}>{pct}%</b></>}
            {' · '}<span style={{ color: ngN ? 'var(--red)' : 'var(--muted)', fontWeight: ngN ? 800 : 500 }}>{tr('พบผิดปกติ (NG)')} {ngN} {tr('ครั้ง')}</span>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
              นับเป็น "เครื่อง-วัน" · ความครบ = ตรวจแล้ว ÷ (ตรวจแล้ว + ขาด) — ไม่นับวันไม่ได้ผลิต/ไม่มีแผน/ไม่รู้ ·
              กะที่กำลังเดินอยู่ยังไม่ตัดสิน (ดูแท็บ 📊 สถานะวันนี้) · เครื่องที่เอาออกจากทะเบียนแล้วไม่แสดงย้อนหลัง
            </div>
            {raw?.runsError && (
              <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--amber)', fontWeight: 700 }}>
                ❔ อ่านตารางเปิดกะไม่สำเร็จ ({raw.runsError}) — วันที่ยังไม่ได้ตรวจแสดงเป็น “?” ไม่ใช่ “ขาด” · ตัวเลขขาดตรวจอาจต่ำกว่าจริง
              </div>
            )}
            {!raw?.runsError && unknownN > 0 && (
              <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--amber)' }}>{tr('❔ ไม่รู้ว่าผลิตหรือไม่')} {unknownN} {tr('เครื่อง-วัน')}</div>
            )}
            {!cal && <div style={{ marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>{tr('ยังโหลดปฏิทินบริษัทไม่ได้ — ยังไม่ระบายวันหยุด')}</div>}
            {hiddenN > 0 && <div style={{ marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>{tr('ซ่อน')} {hiddenN} {tr('ไลน์ตามตัวกรอง')}</div>}
          </div>

          {/* คำอธิบาย 2 ชุดแยกกัน (แบบเดียวกับ LPA): ผลตรวจ = ไปตรวจแล้วเจออะไร · สถานะวัน = ต้องตรวจไหม/มีใครตรวจไหม */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
            <span>
              <b style={{ color: 'var(--text2)' }}>{tr('ผลตรวจในช่อง:')}</b>{' '}
              {Object.values(AM_RESULT_META).map(m => (
                <span key={m.mark} style={{ marginRight: 8 }}><b style={{ color: m.color }}>{m.mark}</b> {m.label}</span>
              ))}
              {view === 'line' && <span style={{ marginRight: 8 }}><b style={{ color: 'var(--green)' }}>n/n</b> {tr('ตรวจครบทุกเครื่อง')}</span>}
            </span>
            <span style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
              <b style={{ color: 'var(--text2)' }}>{tr('สถานะวัน:')}</b>{' '}
              {CHECK_DAY_LEGEND.map(k => (
                <span key={k} style={{ marginRight: 8 }}><StateChip state={k} /> {CHECK_DAY_META[k].label}</span>
              ))}
              · <span style={{ display: 'inline-block', width: 11, height: 11, background: HOLIDAY_BG, border: '1px solid var(--border)', verticalAlign: -1 }} /> วันหยุดโรงงาน
            </span>
          </div>

          {rep.rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
              ยังไม่มีเครื่องที่ลงทะเบียนตรวจ AM {shift === 'day' ? 'กะเช้า' : 'กะดึก'} — ไปที่แท็บ “⚙️ ลงทะเบียนเครื่องตรวจ” ก่อน
            </div>
          ) : shown.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{tr('ไม่มีไลน์ที่ตรงกับตัวกรอง (ซ่อน')} {hiddenN} ไลน์)</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...cell, ...stickyCol, zIndex: 2 }}>{view === 'line' ? tr('ไลน์') : tr('ไลน์ / เครื่อง')}</th>
                    {rep.days.map(d => <th key={d} style={{ ...cell, background: holiday(d) ? HOLIDAY_BG : undefined }}>{Number(d.slice(8))}</th>)}
                    <th style={cell} title={tr('ตรวจแล้ว / ต้องตรวจ (เครื่อง-วัน)')}>{tr('ตรวจ/ต้อง')}</th>
                    <th style={cell}>{tr('ขาด')}</th>
                    <th style={cell} title={tr('ไม่ได้เปิดกะ/ไม่ได้ผลิต')}>NP</th>
                    <th style={cell}>{tr('%ครบ')}</th>
                    <th style={cell}>NG</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.flatMap(r => {
                    const lineRow = (
                      <tr key={r.line_name}>
                        <td style={{ ...cell, ...stickyCol, fontWeight: 800, fontSize: 12, color: 'var(--text)', background: view === 'machine' ? 'var(--bg3)' : 'var(--card)' }}>
                          {r.line_name === '—' ? '⚠ ยังไม่ระบุไลน์' : r.line_name}
                          <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 11 }}> · {r.machines.length} {tr('เครื่อง')}</span>
                        </td>
                        {r.cells.map(c => {
                          const m = CHECK_DAY_META[c.state]
                          return (
                            <td key={c.date} title={`${c.date} · ${m.label}${c.due ? ` · ตรวจ ${c.checked}/${c.due} เครื่อง` : ''}${c.ng ? ` · NG ${c.ng}` : ''}`}
                              style={{ ...cell, background: m.tint || undefined }}>
                              {c.state === CHECK_DAY.done
                                ? <b style={{ color: c.ng ? 'var(--red)' : 'var(--green)' }}>{c.ng ? `NG${c.ng > 1 ? c.ng : ''}` : `${c.checked}/${c.due}`}</b>
                                : <>
                                    <StateChip state={c.state} />
                                    {c.state === CHECK_DAY.missed && c.checked > 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.checked}/{c.due}</div>}
                                  </>}
                            </td>
                          )
                        })}
                        <SumTds s={r.sum} ngN={r.ngN} bold />
                      </tr>
                    )
                    if (view !== 'machine') return [lineRow]
                    return [lineRow, ...r.machines.map(mc => (
                      <tr key={`${r.line_name}::${mc.jig_id}`}>
                        <td style={{ ...cell, ...stickyCol, fontSize: 11, color: 'var(--text2)', paddingLeft: 16, whiteSpace: 'normal' }} title={mc.since ? `ลงทะเบียนตั้งแต่ ${mc.since}` : undefined}>
                          {mc.machine_no ? <b>{mc.machine_no} · </b> : null}{mc.name}
                        </td>
                        {mc.cells.map(c => {
                          const m = CHECK_DAY_META[c.state]
                          const res = c.state === CHECK_DAY.done ? AM_RESULT_META[c.result] : null
                          return (
                            <td key={c.date} title={`${c.date} · ${res ? res.label : m.label}`} style={{ ...cell, background: m.tint || undefined }}>
                              {c.state === CHECK_DAY.done
                                ? <b style={{ color: res?.color || 'var(--text)' }}>{res?.mark || 'OK'}</b>
                                : <StateChip state={c.state} />}
                            </td>
                          )
                        })}
                        <SumTds s={mc.sum} ngN={mc.ngN} />
                      </tr>
                    ))]
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ✍️ ขั้น 3 ของสาย AM — หัวหน้าแผนก/ส่วนทบทวนรายเดือน (ต่อไลน์ · เดือน+กะที่เลือก) */}
      {rep && shown.length > 0 && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('✍️ ลงนามทบทวนรายเดือน — หัวหน้าแผนก/ส่วน')}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, marginBottom: 8 }}>
            ขั้นที่ 3 ของสาย AM: พนักงานตรวจทุกต้นกะ → หัวหน้ากลุ่มรับทราบรายวัน → หัวหน้าแผนก/ส่วนทบทวนรายเดือน ·
            ลงนามต่อไลน์ของเดือน {month} {shift === 'day' ? 'กะเช้า' : 'กะดึก'} · ระบบเก็บสรุป ณ ตอนลงนามไว้เทียบภายหลัง
          </div>
          {!mc.complete && (
            <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>
              ⏳ เดือนนี้ยังไม่จบ — ลงนามได้ตั้งแต่ {mc.opensOn || 'หลังสิ้นเดือน'} (ก่อนนั้นตัวเลขยังขยับ ลายเซ็นจะไม่ตรงกับเดือนจริง)
            </div>
          )}
          {!signFresh ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('กำลังโหลดทะเบียนลงนาม…')}</div>
          ) : sign.missing ? (
            <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>
              ⚠ ระบบลงนามรายเดือนยังไม่เปิดใช้ — ตาราง am_monthly_signoffs ยังไม่ถูกสร้างบน Main (รอ admin apply migration) ·
              ยังลงนามไม่ได้ และจอนี้ยังบอกไม่ได้ว่าเคยมีใครลงนาม
            </div>
          ) : !sign.ok ? (
            <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>
              ⚠ อ่านทะเบียนลงนามไม่สำเร็จ: {sign.error} — ไม่ได้แปลว่ายังไม่มีใครลงนาม · รีเฟรชแล้วลองใหม่
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>
                ลงนามแล้ว {shown.filter(r => byLine?.get(r.line_name)?.active).length}/{shown.length} ไลน์
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {shown.map(r => {
                  const e = byLine?.get(r.line_name)
                  const a = e?.active
                  const lineLabel = r.line_name === '—' ? '⚠ ยังไม่ระบุไลน์' : r.line_name
                  const revN = e?.revoked?.length || 0
                  const revNote = revN ? (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }} title={e.revoked.map(x => `${fmtWhen(x.revoked_at)} ${x.revoked_by_name || ''}: ${x.revoke_reason || ''}`).join('\n')}>
                      · เคยเพิกถอน {revN} ครั้ง
                    </span>
                  ) : null
                  if (a) {
                    const drift = amSignoffDrift(a.snapshot, r)
                    const rv = revokeVerdict(a, 'x'.repeat(AM_REVOKE_REASON_MIN))
                    return (
                      <div key={r.line_name} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                        <b style={{ minWidth: 140, fontSize: 12, color: 'var(--text)' }}>{lineLabel}</b>
                        <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>{tr('✅ ลงนามแล้ว')}</span>
                        <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                          {a.signed_by_name || 'ไม่ทราบชื่อ'}{a.position ? ` · ${positionLabel(a.position)}` : ' · ไม่ทราบตำแหน่ง'} · {fmtWhen(a.signed_at)}
                        </span>
                        {a.signature_url
                          ? <img src={a.signature_url} alt="ลายเซ็น" style={{ height: 28, maxWidth: 110, objectFit: 'contain', background: '#fff', borderRadius: 4, padding: 2 }} />
                          : <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('(ไม่มีลายเซ็นในโปรไฟล์)')}</span>}
                        {a.note && <span style={{ fontSize: 11, color: 'var(--muted)' }}>“{a.note}”</span>}
                        {revNote}
                        <span style={{ flex: 1 }} />
                        {rv.ok && (
                          <button type="button" onClick={() => { setRevoking(a); setReason('') }}
                            style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-md)', padding: '4px 10px', fontSize: 12 }}>
                            {tr('↩ เพิกถอน')}
                          </button>
                        )}
                        {drift.length > 0 && (
                          <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>
                            ⚠ ตัวเลขตอนนี้ต่างจากที่ลงนามไว้ — {amSignoffDriftText(drift)} · ลายเซ็นนี้รับรองตัวเลข ณ ตอนลงนาม
                            (ตรวจ {a.snapshot?.sum?.done ?? '–'}/{a.snapshot?.sum?.due ?? '–'} {tr('· ขาด')} {a.snapshot?.sum?.missed ?? '–'} · NG {a.snapshot?.ngN ?? '–'})
                            {rv.ok ? ' — ถ้าต้องรับรองตัวเลขใหม่ ให้เพิกถอนแล้วลงนามใหม่' : ''}
                          </div>
                        )}
                      </div>
                    )
                  }
                  const v = signVerdict(r.line_name)
                  const w = lineWrite(r.line_name)
                  const why = v.code === 'scope' ? writeBlockText(w, { what: 'การลงนามของไลน์นี้', unit: r.line_name }) : amMonthlySignoffText(v, { opensOn: mc.opensOn })
                  return (
                    <div key={r.line_name} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 10px', border: '1px dashed var(--border)', borderRadius: 'var(--r-md)' }}>
                      <b style={{ minWidth: 140, fontSize: 12, color: 'var(--text)' }}>{lineLabel}</b>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ยังไม่ลงนาม')}</span>
                      {revNote}
                      <span style={{ flex: 1 }} />
                      {v.ok ? (
                        <button type="button" onClick={() => { setSigning({ line: r.line_name }); setNote('') }}
                          style={{ background: 'var(--accent)', border: 'none', color: 'var(--accent-ink)', borderRadius: 'var(--r-md)', padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>
                          ✍️ ลงนามทบทวน
                        </button>
                      ) : (
                        /* ปุ่มซ่อนได้ เหตุผลห้ามซ่อน — ยกเว้นคนที่ไม่มีสิทธิ์เลย (ไม่ใช่คนที่ต้องลงนาม) เขียนสั้นๆ */
                        <span style={{ fontSize: 11, color: v.code === 'no_perm' ? 'var(--muted)' : 'var(--amber)' }}>{v.code === 'no_perm' ? tr('รอหัวหน้าแผนก/ส่วนลงนาม') : why}</span>
                      )}
                    </div>
                  )
                })}
              </div>
              {permitted && myRank == null && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--amber)' }}>{amApprovalAssumptionText(['approver'])}</div>
              )}
            </>
          )}
        </div>
      )}

      {signing && (() => {
        const row = rep?.rows.find(r => r.line_name === signing.line)
        return (
          <div className="modal-scroll" onClick={() => { if (!busy && !note.trim()) setSigning(null) }}
            style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)', width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{tr('✍️ ลงนามทบทวน AM รายเดือน')}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                ไลน์ <b>{signing.line}</b> {tr('· เดือน')} {month} · {shift === 'day' ? 'กะเช้า' : 'กะดึก'}
              </div>
              {row && (
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 'var(--r-md)' }}>
                  {checkDaysNote(row.sum)}{row.sum.pct != null ? ` · ความครบ ${row.sum.pct}%` : ''} · NG {row.ngN} {tr('ครั้ง ·')} {row.machines.length} เครื่อง
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{tr('ตัวเลขชุดนี้จะถูกบันทึกไว้กับลายเซ็น — แก้ใบตรวจย้อนหลังทีหลัง จอจะเตือนว่าต่างจากที่ลงนาม')}</div>
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                ผู้ลงนาม: <b>{fullName || '—'}</b>{myPosition ? ` · ${positionLabel(myPosition)}` : ''}
              </div>
              {mySignature
                ? <img src={mySignature} alt="ลายเซ็นของคุณ" style={{ height: 40, maxWidth: 180, objectFit: 'contain', background: '#fff', borderRadius: 4, padding: 2, marginTop: 4 }} />
                : <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>{tr('บัญชีนี้ยังไม่มีลายเซ็นในโปรไฟล์ — บันทึกได้ แต่ Excel จะมีแค่ชื่อ (ตั้งลายเซ็นที่เมนูบัญชี)')}</div>}
              {myRank == null && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>{amApprovalAssumptionText(['approver'])}</div>}
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={tr('ความเห็น/ข้อสั่งการ (ถ้ามี)')}
                style={{ width: '100%', marginTop: 10, fontSize: 12, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="button" disabled={busy} onClick={() => setSigning(null)}
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-md)', padding: '6px 14px', fontSize: 12 }}>{tr('ยกเลิก')}</button>
                <button type="button" disabled={busy || !row} onClick={doSign}
                  style={{ background: 'var(--accent)', border: 'none', color: 'var(--accent-ink)', borderRadius: 'var(--r-md)', padding: '6px 14px', fontSize: 12, fontWeight: 700 }}>
                  {busy ? tr('⏳ กำลังบันทึก…') : tr('✍️ ยืนยันลงนาม')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {revoking && (
        <div className="modal-scroll" onClick={() => { if (!busy && !reason.trim()) setRevoking(null) }}
          style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)', width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{tr('↩ เพิกถอนลายเซ็นทบทวนรายเดือน')}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
              ไลน์ <b>{revoking.line_name}</b> · {month} {tr('· ลงนามโดย')} {revoking.signed_by_name || '—'} {tr('เมื่อ')} {fmtWhen(revoking.signed_at)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{tr('ลายเซ็นไม่ถูกลบ — เก็บไว้เป็นประวัติพร้อมเหตุผล แล้วลงนามใหม่ได้')}</div>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder={`เหตุผลการเพิกถอน (อย่างน้อย ${AM_REVOKE_REASON_MIN} ตัวอักษร)`}
              style={{ width: '100%', marginTop: 10, fontSize: 12, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button type="button" disabled={busy} onClick={() => setRevoking(null)}
                style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-md)', padding: '6px 14px', fontSize: 12 }}>{tr('ยกเลิก')}</button>
              <button type="button" disabled={busy || reason.trim().length < AM_REVOKE_REASON_MIN} onClick={doRevoke}
                style={{ background: 'var(--red)', border: 'none', color: '#fff', borderRadius: 'var(--r-md)', padding: '6px 14px', fontSize: 12, fontWeight: 700 }}>
                {busy ? tr('⏳ กำลังบันทึก…') : tr('ยืนยันเพิกถอน')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SumTds({ s, ngN, bold }) {
  const w = bold ? 800 : 600
  return (
    <>
      <td style={{ ...cell, fontWeight: w }}>{s.done}/{s.due}</td>
      <td style={{ ...cell, fontWeight: w, color: s.missed ? 'var(--red)' : 'var(--muted)' }}>{s.missed}</td>
      <td style={{ ...cell, color: 'var(--muted)' }}>{s.no_run}</td>
      {/* ไม่มีวันที่ต้องตรวจ = "–" ห้ามขึ้น 0% หรือ 100% */}
      <td style={{ ...cell, fontWeight: w }}>{s.pct == null ? '–' : `${s.pct}%`}</td>
      <td style={{ ...cell, fontWeight: w, color: ngN ? 'var(--red)' : 'var(--muted)' }}>{ngN}</td>
    </>
  )
}
