/* ── 📅 PM ช่าง รายเดือน — สรุปผลตรวจ + ลงนามขั้น ③ / ④ (PM รอบ 2 · 2026-11-13 · คำสั่ง user) ──────────
   แท็บ `?tab=monthly` ของ /pm (PmHub) · piggyback สิทธิ์หน้า /pm-check
   สาย: ① ผู้ตรวจ (บัตร) → ② หัวหน้าผู้ตรวจยืนยันทีละใบ → ③ ผจก.ส่วนของผู้ตรวจ อนุมัติ (ต่อทีม) → ④ ผจก.ส่วนที่ถูกตรวจ รับทราบ (ต่อส่วนงาน)
   · สรุป/กฎ = `lib/pmMonthly.js` (pure · มีเทส) **ห้ามนับ/ตัดสินเองในไฟล์นี้**
   · ลายเซ็น = `lib/pmMonthlySignoff.js` → ตาราง `pm_monthly_signoffs` (Main) = ทางเขียน DB ทางเดียวของจอนี้
   · ด่าน ③: คีย์ `pm:monthly_approve` + ตำแหน่ง ≥ ผจก. + **ทีมนั้นอยู่ในช่อง "ทีมช่างซ่อม" ของบัญชี** + ใบของทีมผ่าน ② ครบ
   · ด่าน ④: คีย์ `pm:monthly_ack` + ตำแหน่ง ≥ ผจก. + ส่วนงานในขอบเขตแก้ (`canWriteUnit`) + ทุกทีมที่ตรวจส่วนงานนั้นผ่าน ③ แล้ว
   · ทั้งคู่: ไม่ใช่บัญชีกลาง · เดือนต้องจบแล้ว · verdict คิดใหม่ตอนกด + ด่าน stale (`viewKey(month)`) · ถามยืนยัน (`confirmSign`)
   · Excel = ทะเบียน `/doc-forms` คีย์ `xlsx_pm_monthly` */
import { useContext, useEffect, useMemo, useState } from 'react'
import { UserContext } from '../App'
import { supabase, supabaseDR } from '../supabaseClient'
import { toast } from './Toast'
import FilterBar from './FilterBar'
import { canSeeded, isSharedAccount } from '../utils/permissions'
import { positionRank } from '../utils/positions'
import { canWriteUnit } from '../utils/writeScope'
import { viewKey, isStale, staleBlockText } from '../utils/staleView'
import { confirmSign } from '../utils/signConfirm'
import { getWorkDate } from '../utils/workDate'
import { fetchByIds, fetchAllPages } from '../utils/fetchByIds'
import { useProductionLinesState } from '../utils/useProductionLines'
import { loadPmTeams, isAmTeam, teamLabel } from '../utils/pmTeams'
import { loadDocForms } from '../utils/docForms'
import { xlsxDocName } from '../utils/csvDoc'
import { buildPmMonthly, pmMonthComplete, pmMonthlyVerdict, pmMonthlyText, pmRevokeVerdict, pmSnapshot, pmSnapshotDrift, pmMonthlyAoa, UNKNOWN_SECTION } from '../lib/pmMonthly'
import { loadPmMonthlySignoffs, activeSignoffs, signPmMonthly, revokePmMonthly } from '../lib/pmMonthlySignoff'
import { tr } from '../utils/i18n'

const norm = (v) => String(v ?? '').trim().toLowerCase()
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const th = { textAlign: 'left', fontSize: 12, color: 'var(--muted)', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { fontSize: 12.5, padding: '6px 8px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const btn = (accent) => ({ padding: '4px 10px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${accent ? 'var(--accent)' : 'var(--border2)'}`, background: accent ? 'var(--accent-dim)' : 'var(--bg3)', color: accent ? 'var(--accent)' : 'var(--text2)' })

/** ช่วงเดือนตาม "วันทำงาน" (ก่อน 08:00 = วันก่อน) — ISO +07:00 ไม่พึ่ง timezone เครื่อง */
function monthWindow(month) {
  const [y, m] = month.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1
  return { from: `${month}-01T08:00:00+07:00`, to: `${ny}-${String(nm).padStart(2, '0')}-01T08:00:00+07:00` }
}

async function loadMonth(month) {
  await loadPmTeams()
  const cl = await fetchAllPages(() => supabaseDR.from('checklists').select('id, department').eq('module', 'mtn'))
  if (cl.error) return { error: `ทะเบียนแผนตรวจ: ${cl.error}` }
  const pmCls = cl.rows.filter(c => c.department && !isAmTeam(c.department))
  const teamOf = new Map(pmCls.map(c => [c.id, c.department]))
  const { from, to } = monthWindow(month)
  const ins = await fetchByIds(pmCls.map(c => c.id), (ids) => supabaseDR.from('inspections')
    .select('id, jig_id, checklist_id, status, approval_status, inspected_at')
    .in('checklist_id', ids).gte('inspected_at', from).lt('inspected_at', to))
  if (ins.error) return { error: `ใบตรวจ: ${ins.error}` }
  const jg = await fetchByIds([...new Set(ins.rows.map(r => r.jig_id))], (ids) => supabaseDR.from('jigs')
    .select('id, name, jig_no, machine_no, line_name').in('id', ids))
  if (jg.error) return { error: `ทะเบียนอุปกรณ์: ${jg.error}` }
  const jigOf = new Map(jg.rows.map(j => [j.id, j]))
  const rows = ins.rows.map(r => {
    const j = jigOf.get(r.jig_id) || {}
    return { id: r.id, team: teamOf.get(r.checklist_id), line_name: j.line_name || '', machine: j.machine_no || j.jig_no || j.name || r.jig_id,
      status: r.status, approval_status: r.approval_status }
  })
  return { month, rows, truncated: cl.truncated || ins.truncated || jg.truncated }
}

export default function PmMonthlyReport() {
  const { role, fullName, position: myPosition, signatureUrl: mySignature, mtnTeams = [], section: homeSection,
    sections: scopeSecs = [], allUnits, respCostCenters, scopeIdx } = useContext(UserContext)
  const { rows: lines = [], failed: linesFailed } = useProductionLinesState()
  const [month, setMonth] = useState(() => {
    const d = getWorkDate(); const [y, m] = d.slice(0, 7).split('-').map(Number)
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`   // ค่าเริ่ม = เดือนที่แล้ว (เดือนที่ลงนามได้)
  })
  const [raw, setRaw] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [sign, setSign] = useState({ key: '', ok: false, rows: [], missing: false, error: '' })
  const [tick, setTick] = useState(0)
  const [uid, setUid] = useState(null)
  const [busy, setBusy] = useState(false)
  const curKey = viewKey(month)

  useEffect(() => { loadDocForms().catch(() => {}) }, [])
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setUid(data?.session?.user?.id || null) }).catch(() => {})
    return () => { alive = false }
  }, [])
  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    loadMonth(month).then(r => {
      if (!alive) return
      if (r.error) { setErr(r.error); setRaw(null) } else setRaw(r)
    }).catch(e => { if (alive) { setErr(e?.message || String(e)); setRaw(null) } }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [month])
  useEffect(() => {
    let alive = true
    const key = viewKey(month)
    loadPmMonthlySignoffs(month).then(r => { if (alive) setSign({ key, ...r, error: r.error || '' }) })
      .catch(e => { if (alive) setSign({ key, ok: false, rows: [], missing: false, error: e?.message || String(e) }) })
    return () => { alive = false }
  }, [month, tick])

  const sectionOfLine = useMemo(() => new Map((lines || []).map(l => [norm(l.name), l.section || ''])), [lines])
  const summary = useMemo(() => (raw?.month === month ? buildPmMonthly(raw.rows, sectionOfLine) : null), [raw, month, sectionOfLine])
  const signs = useMemo(() => (sign.ok ? activeSignoffs(sign.rows) : new Map()), [sign])
  const signOf = (kind, key) => signs.get(`${kind}|${key}`)?.active || null
  const mc = pmMonthComplete(month, getWorkDate())
  const myRank = positionRank(myPosition)
  const wCtx = { role, section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx }
  const myTeams = (mtnTeams || []).map(norm)

  const verdictOf = (kind, row) => {
    if (kind === 'team_approve') {
      return pmMonthlyVerdict({ kind, permitted: canSeeded('pm', 'monthly_approve', role), sharedAccount: isSharedAccount(),
        signerRank: myRank, scopeOk: myTeams.includes(norm(row.team)), monthComplete: mc.complete,
        alreadySigned: !!signOf(kind, row.team), pendingConfirm: row.pending, total: row.total })
    }
    const waiting = (row.byTeam || []).map(t => t.team).filter(t => !signOf('team_approve', t))
    const scopeOk = row.section !== UNKNOWN_SECTION && canWriteUnit(wCtx, row.section, { unknownTarget: 'block' }).ok
    return pmMonthlyVerdict({ kind, permitted: canSeeded('pm', 'monthly_ack', role), sharedAccount: isSharedAccount(),
      signerRank: myRank, scopeOk, monthComplete: mc.complete, alreadySigned: !!signOf(kind, row.section),
      teamsWaiting: waiting, total: row.total })
  }

  const doSign = async (kind, row) => {
    if (isStale(sign.key, curKey) || raw?.month !== month) { toast.error(staleBlockText({ unitWord: tr('เดือน') })); return }
    const v = verdictOf(kind, row)   // คิดใหม่ตอนกด
    if (!v.ok) { toast.error(pmMonthlyText(v, { opensOn: mc.opensOn, kind, teamLabel })); return }
    const scopeKey = kind === 'team_approve' ? row.team : row.section
    if (!confirmSign({
      what: kind === 'team_approve' ? 'อนุมัติผลตรวจ PM รายเดือน (ขั้น 3)' : 'รับทราบผลตรวจ PM รายเดือน (ขั้น 4)',
      docLabel: 'สรุป PM', orderNo: `${month} · ${kind === 'team_approve' ? `ทีม ${teamLabel(row.team)}` : `ส่วนงาน ${row.section}`}`,
      actor: fullName || '—', as: kind === 'team_approve' ? 'ผจก.ส่วนของผู้ตรวจ' : 'ผจก.ส่วนที่ถูกตรวจ',
      effect: `${row.total} ใบ · ผ่าน ${row.pass} · ไม่ผ่าน ${row.fail}`,
    })) return
    setBusy(true)
    const ok = await signPmMonthly({ verdict: v, kind, month, scopeKey, snapshot: pmSnapshot(row, { month, kind }), userId: uid,
      fullName, position: myPosition, positionRank: myRank, signatureUrl: mySignature, opensOn: mc.opensOn })
    setBusy(false)
    if (!ok) return
    toast.success(kind === 'team_approve' ? 'อนุมัติแล้ว' : 'รับทราบแล้ว')
    setTick(t => t + 1)
  }
  const doRevoke = async (kind, s) => {
    const why = typeof window !== 'undefined' ? window.prompt(`เหตุผลการเพิกถอนลายเซ็นของ ${s.signed_by_name || '—'} (อย่างน้อย 5 ตัวอักษร)`) : ''
    if (why == null) return
    const v = pmRevokeVerdict({ permitted: canSeeded('pm', kind === 'team_approve' ? 'monthly_approve' : 'monthly_ack', role),
      sharedAccount: isSharedAccount(), revokerRank: myRank, isSigner: !!uid && s.signed_by === uid, reason: why })
    setBusy(true)
    const ok = await revokePmMonthly({ verdict: v, id: s.id, reason: why, userId: uid, fullName })
    setBusy(false)
    if (ok) { toast.success('เพิกถอนแล้ว'); setTick(t => t + 1) }
  }

  const exportExcel = async () => {
    if (!summary) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pmMonthlyAoa(summary, { month, teamLabel, signOf })), 'PM รายเดือน')
    XLSX.writeFile(wb, xlsxDocName('xlsx_pm_monthly', `PM_Monthly_${month}`))
  }

  const signCell = (kind, row) => {
    const key = kind === 'team_approve' ? row.team : row.section
    const s = signOf(kind, key)
    if (s) {
      const drift = pmSnapshotDrift(s.snapshot, row)
      return (
        <div>
          <b style={{ color: 'var(--accent)' }}>✔ {s.signed_by_name || '—'}</b> <span style={{ color: 'var(--muted)' }}>· {fmtWhen(s.signed_at)}</span>
          {drift && <div style={{ fontSize: 11, color: 'var(--amber)' }}>ตัวเลขตอนนี้ไม่ตรงกับตอนลงนาม (ตอนลงนาม {s.snapshot?.total} ใบ)</div>}
          {(uid && s.signed_by === uid || canSeeded('pm', kind === 'team_approve' ? 'monthly_approve' : 'monthly_ack', role)) &&
            <button disabled={busy} onClick={() => doRevoke(kind, s)} style={{ ...btn(false), marginTop: 3, fontSize: 11, padding: '2px 8px' }}>{tr('เพิกถอน')}</button>}
        </div>
      )
    }
    const v = verdictOf(kind, row)
    if (v.ok) {
      return (
        <div>
          <button disabled={busy} onClick={() => doSign(kind, row)} style={btn(true)}>{kind === 'team_approve' ? tr('✍️ อนุมัติ') : tr('✍️ รับทราบ')}</button>
          {v.assumed?.length > 0 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{tr('บัญชีนี้ยังไม่ได้ตั้งตำแหน่ง — ระบบไม่ได้ตรวจระดับ')}</div>}
        </div>
      )
    }
    return <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{pmMonthlyText(v, { opensOn: mc.opensOn, kind, teamLabel })}</span>
  }

  return (
    <div>
      <FilterBar style={{ marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          {tr('เดือน')} <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
        </label>
        <button onClick={exportExcel} disabled={!summary} style={btn(false)}>{tr('⬇ Excel')}</button>
      </FilterBar>

      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.7 }}>
        สาย PM ช่าง: ① ผู้ตรวจ (สแกนบัตร) → ② หัวหน้าผู้ตรวจยืนยันทีละใบ → <b>③ ผจก.ส่วนของผู้ตรวจ อนุมัติ (ต่อทีม)</b> → <b>④ ผจก.ส่วนที่ถูกตรวจ รับทราบ (ต่อส่วนงาน)</b>
        {!mc.complete && <div style={{ color: 'var(--amber)' }}>เดือนนี้ยังไม่จบ — ตัวเลขยังขยับได้ · ลงนามได้ตั้งแต่ {mc.opensOn}</div>}
      </div>

      {linesFailed && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8 }}>⚠️ อ่านทะเบียนไลน์ไม่ได้ — ใบที่หาส่วนงานไม่เจอจะไปอยู่ถัง "{UNKNOWN_SECTION}"</div>}
      {sign.missing && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8 }}>⚠️ ระบบลงนามรายเดือนยังไม่เปิดใช้ (ตาราง pm_monthly_signoffs ยังไม่ถูกสร้างบน Main) — ดูสรุปได้ แต่ยังลงนามไม่ได้</div>}
      {!sign.ok && !sign.missing && sign.error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>อ่านทะเบียนลงนามไม่ได้: {sign.error} — สถานะลงนามบนจอนี้ไม่น่าเชื่อถือ</div>}
      {raw?.truncated && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8 }}>⚠️ ใบตรวจเดือนนี้เยอะเกินเพดาน — โหลดได้ไม่ครบ</div>}

      {loading ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>{tr('กำลังโหลด...')}</div>
        : err ? <div style={{ padding: 20, color: 'var(--red)' }}>โหลดไม่สำเร็จ — {err}</div>
          : !summary?.total.total ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>เดือน {month} ไม่มีใบตรวจ PM ของช่าง</div>
            : (
              <>
                <h4 style={{ margin: '6px 0' }}>③ อนุมัติผลตรวจ — รายทีมช่าง (ผจก.ส่วนของผู้ตรวจ)</h4>
                <div style={{ overflowX: 'auto', marginBottom: 18 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['ทีมช่าง', 'ใบตรวจ', 'ผ่าน', 'ไม่ผ่าน', 'หัวหน้ายืนยันแล้ว', 'รอยืนยัน', 'ตีกลับ', 'เครื่อง', 'ส่วนงานที่ตรวจ', 'ผจก. อนุมัติ'].map(h => <th key={h} style={th}>{tr(h)}</th>)}</tr></thead>
                    <tbody>{summary.teams.map(t => (
                      <tr key={t.team}>
                        <td style={td}><b>{teamLabel(t.team)}</b></td>
                        <td style={num}>{t.total}</td><td style={num}>{t.pass}</td>
                        <td style={{ ...num, color: t.fail ? 'var(--red)' : undefined }}>{t.fail}</td>
                        <td style={num}>{t.confirmed}</td>
                        <td style={{ ...num, color: t.pending ? 'var(--amber)' : undefined }}>{t.pending}</td>
                        <td style={num}>{t.rejected}</td><td style={num}>{t.machines}</td>
                        <td style={td}>{t.sections.join(', ')}</td>
                        <td style={td}>{signCell('team_approve', t)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>

                <h4 style={{ margin: '6px 0' }}>④ รับทราบผลตรวจ — รายส่วนงานที่ถูกตรวจ (ผจก.ส่วนงานนั้น)</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['ส่วนงาน', 'ใบตรวจ', 'ผ่าน', 'ไม่ผ่าน', 'เครื่อง', 'แยกตามทีม', 'ผจก. รับทราบ'].map(h => <th key={h} style={th}>{tr(h)}</th>)}</tr></thead>
                    <tbody>{summary.sections.map(s => (
                      <tr key={s.section}>
                        <td style={td}><b>{s.section}</b></td>
                        <td style={num}>{s.total}</td><td style={num}>{s.pass}</td>
                        <td style={{ ...num, color: s.fail ? 'var(--red)' : undefined }}>{s.fail}</td>
                        <td style={num}>{s.machines}</td>
                        <td style={td}>{s.byTeam.map(t => (
                          <div key={t.team}>{teamLabel(t.team)}: {t.total} ใบ{t.fail ? ` · ไม่ผ่าน ${t.fail}` : ''} · {signOf('team_approve', t.team) ? '✔ ③' : 'รอ ③'}</div>
                        ))}</td>
                        <td style={td}>{s.section === UNKNOWN_SECTION
                          ? <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>เครื่องยังไม่ผูกไลน์/ไลน์ไม่มีส่วนงาน — แก้ทะเบียนก่อนจึงรับทราบได้</span>
                          : signCell('section_ack', s)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </>
            )}
    </div>
  )
}
