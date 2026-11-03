/* ── 📅 รายงาน AM รายเดือน — แท็บ `?sub=monthly` ของ /daily-checker?tab=pm (2026-11-03 · ประชุม 02/11 ข้อ C2) ──
   *"รายงาน AM ตอนนี้มีแค่รายวัน ต้องมีรายเดือนแบบ LPA"* — แถว = ไลน์ (กางเป็นรายเครื่องได้) · คอลัมน์ = วัน ·
   ช่อง = ตรวจแล้ว / ขาด / ไม่ได้ผลิต / ไม่มีแผน / ไม่รู้ · % ความครบ (ตัวหาร = ตรวจแล้ว + ขาด) · จำนวน NG

   · ข้อมูลทั้งหมดมาจาก `loadMonthlyAm()` (`lib/dailyAmBoard.js`) → `buildAmMonthly()` (`lib/amMonthly.js` · pure · มีเทส)
     **ห้ามคิวรี inspections / ตัดสินสถานะช่องเองในไฟล์นี้**
   · สัญลักษณ์สถานะวัน = `CHECK_DAY_META` · legend = `CHECK_DAY_LEGEND` (ห้ามแต่งเอง · UI §6.29)
     ผลตรวจในช่อง "ตรวจแล้ว" = `AM_RESULT_META` (OK/NG/!) — ตัวอักษรลอยไม่มีกรอบ ≠ สถานะวันที่เป็น chip มีกรอบ
   · อ่านอย่างเดียว ไม่มีทางเขียน DB ⇒ ไม่ต้องมีด่านขอบเขตชั้น ③ · ตัวกรองไลน์ = มุมมอง (ซ่อนแล้วบอกจำนวน)
   · Excel = ทะเบียน `/doc-forms` คีย์ `xlsx_am_monthly` (เลขฟอร์มอยู่ที่ชื่อไฟล์ · ห้ามแทรกแถวบนสุดของชีต) */
import { useEffect, useMemo, useState } from 'react'
import { toast } from './Toast'
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

// กะเป็น "ส่วนหนึ่งของคีย์" (AM ตรวจต้นกะ) ⇒ ไม่มีตัวเลือก "ทุกกะ" (filterLabels.js: ห้ามใช้ SHIFT_OPTIONS กับจอแบบนี้)
const AM_SHIFT_OPTIONS = [
  { value: 'day', label: '☀️ กะเช้า' },
  { value: 'night', label: '🌙 กะดึก' },
]
const VIEW_OPTIONS = [
  { value: 'line', label: 'รายไลน์' },
  { value: 'machine', label: 'รายเครื่อง' },
]
const norm = (v) => String(v ?? '').trim().toLowerCase()
const HOLIDAY_BG = 'rgba(46,125,50,0.25)'   // สีหัวคอลัมน์วันหยุด — ชุดเดียวกับตาราง LPA

const cell = { border: '1px solid var(--border)', textAlign: 'center', fontSize: 11, minWidth: 26, padding: '2px 1px', whiteSpace: 'nowrap' }
const stickyCol = { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, textAlign: 'left', minWidth: 190, maxWidth: 240, padding: '3px 6px' }

function StateChip({ state }) {
  const m = CHECK_DAY_META[state]
  if (!m?.mark) return null
  return <span style={{ display: 'inline-block', padding: '0 3px', borderRadius: 4, border: `1px solid ${m.color}`, color: m.color, fontWeight: 700, lineHeight: '14px', fontSize: 11 }}>{m.mark}</span>
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
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'AM รายเดือน')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), 'คำอธิบาย')
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
          เดือน <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
        </label>
        <Segmented label="กะ" value={shift} onChange={setShift} options={AM_SHIFT_OPTIONS} />
        <LineScopeSelect lines={scopedLines} section={scope.section} line={scope.line}
          onChange={(section, line, info) => setScope({ section, line, names: info?.lines?.length ? info.lines : (section || line ? [line || section] : null) })} />
        <Segmented label="แสดง" value={view} onChange={setView} options={VIEW_OPTIONS} />
        <span className="spacer" />
        {rep && <span className="filter-count">{shown.length} ไลน์ · {shown.reduce((a, r) => a + r.machines.length, 0)} เครื่อง</span>}
        <button type="button" onClick={exportXlsx} disabled={!rep || exporting || !shown.length}
          style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>
          {exporting ? '⏳ กำลังส่งออก…' : '📥 Excel'}
        </button>
      </FilterBar>

      {err && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)', color: 'var(--red)', fontSize: 12, fontWeight: 700 }}>
          ⚠ โหลดรายงาน AM ไม่สำเร็จ: {err} — ตารางไม่แสดง (ไม่ได้แปลว่าไม่มีใครตรวจ) · ลองเปลี่ยนเดือนหรือรีเฟรช
        </div>
      )}
      {loading && !rep && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>}

      {rep && (
        <div className="card" style={{ padding: 16, opacity: loading ? 0.6 : 1 }}>
          {/* 🔴 ตัวเลข "ตรวจแล้ว N" ลอยๆ ไม่พอ — ต้องมีตัวหาร (utils/dailyCheckDay.js) */}
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
            <span style={{ color: sum.missed ? 'var(--red)' : 'var(--text2)' }}>{checkDaysNote(sum)}</span>
            {pct != null && <> · ความครบ <b style={{ color: 'var(--text)' }}>{pct}%</b></>}
            {' · '}<span style={{ color: ngN ? '#e05c4a' : 'var(--muted)', fontWeight: ngN ? 800 : 500 }}>พบผิดปกติ (NG) {ngN} ครั้ง</span>
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
              <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--amber)' }}>❔ ไม่รู้ว่าผลิตหรือไม่ {unknownN} เครื่อง-วัน</div>
            )}
            {!cal && <div style={{ marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>ยังโหลดปฏิทินบริษัทไม่ได้ — ยังไม่ระบายวันหยุด</div>}
            {hiddenN > 0 && <div style={{ marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>ซ่อน {hiddenN} ไลน์ตามตัวกรอง</div>}
          </div>

          {/* คำอธิบาย 2 ชุดแยกกัน (แบบเดียวกับ LPA): ผลตรวจ = ไปตรวจแล้วเจออะไร · สถานะวัน = ต้องตรวจไหม/มีใครตรวจไหม */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
            <span>
              <b style={{ color: 'var(--text2)' }}>ผลตรวจในช่อง:</b>{' '}
              {Object.values(AM_RESULT_META).map(m => (
                <span key={m.mark} style={{ marginRight: 8 }}><b style={{ color: m.color }}>{m.mark}</b> {m.label}</span>
              ))}
              {view === 'line' && <span style={{ marginRight: 8 }}><b style={{ color: '#3dd65c' }}>n/n</b> ตรวจครบทุกเครื่อง</span>}
            </span>
            <span style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
              <b style={{ color: 'var(--text2)' }}>สถานะวัน:</b>{' '}
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
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>ไม่มีไลน์ที่ตรงกับตัวกรอง (ซ่อน {hiddenN} ไลน์)</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...cell, ...stickyCol, zIndex: 2 }}>{view === 'line' ? 'ไลน์' : 'ไลน์ / เครื่อง'}</th>
                    {rep.days.map(d => <th key={d} style={{ ...cell, background: holiday(d) ? HOLIDAY_BG : undefined }}>{Number(d.slice(8))}</th>)}
                    <th style={cell} title="ตรวจแล้ว / ต้องตรวจ (เครื่อง-วัน)">ตรวจ/ต้อง</th>
                    <th style={cell}>ขาด</th>
                    <th style={cell} title="ไม่ได้เปิดกะ/ไม่ได้ผลิต">NP</th>
                    <th style={cell}>%ครบ</th>
                    <th style={cell}>NG</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.flatMap(r => {
                    const lineRow = (
                      <tr key={r.line_name}>
                        <td style={{ ...cell, ...stickyCol, fontWeight: 800, fontSize: 12, color: 'var(--text)', background: view === 'machine' ? 'var(--bg3)' : 'var(--card)' }}>
                          {r.line_name === '—' ? '⚠ ยังไม่ระบุไลน์' : r.line_name}
                          <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 11 }}> · {r.machines.length} เครื่อง</span>
                        </td>
                        {r.cells.map(c => {
                          const m = CHECK_DAY_META[c.state]
                          return (
                            <td key={c.date} title={`${c.date} · ${m.label}${c.due ? ` · ตรวจ ${c.checked}/${c.due} เครื่อง` : ''}${c.ng ? ` · NG ${c.ng}` : ''}`}
                              style={{ ...cell, background: m.tint || undefined }}>
                              {c.state === CHECK_DAY.done
                                ? <b style={{ color: c.ng ? '#e05c4a' : '#3dd65c' }}>{c.ng ? `NG${c.ng > 1 ? c.ng : ''}` : `${c.checked}/${c.due}`}</b>
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
      <td style={{ ...cell, fontWeight: w, color: ngN ? '#e05c4a' : 'var(--muted)' }}>{ngN}</td>
    </>
  )
}
