/* 📅 สรุปใบ PM ของช่าง รายเดือน + ลงนาม ③ อนุมัติ / ④ รับทราบ — แท็บ `/pm?tab=monthly` (2026-11-19 · คำสั่ง user)
   กฎทั้งหมด = `utils/pmMonthly.js` (pure · มีเทส) · DB = `lib/pmMonthlySignoff.js`
   📄 docs/modules/pm-hub-check-setup.md §ใบ PM สายอนุมัติ 4 ขั้น — รอบ 2
   🔴 ด่านเซ็นคิดใหม่ตอนกด (ไม่ใช้ค่าตอน render) · ข้อมูลเดือนต้องตรงเดือนที่เลือก (`isStale`) ก่อนเขียน
   🔴 อ่านอะไรไม่ได้ต้องเขียนบนจอ — ห้ามโชว์ "ยังไม่มีใครลงนาม" ตอนอ่านทะเบียนลงนามไม่ได้ */
import { useContext, useEffect, useMemo, useState } from 'react'
import { UserContext } from '../App'
import { supabase } from '../supabaseClient'
import { toast } from './Toast'
import FilterBar from './FilterBar'
import NoticeBar from './NoticeBar'
import { can, isSharedAccount } from '../utils/permissions'
import { positionLabel } from '../utils/positions'
import { getWorkDate } from '../utils/workDate'
import { viewKey, isStale, staleBlockText } from '../utils/staleView'
import { confirmSign } from '../utils/signConfirm'
import { loadLinesRes } from '../utils/useProductionLines'
import { loadPmTeams, isAmTeam } from '../utils/pmTeams'
import { loadDocForms } from '../utils/docForms'
import { xlsxDocName } from '../utils/csvDoc'
import {
  summarizePmMonth, teamMonthReady, sectionNodeIdOf, coversNode, pmMonthlySignVerdict, pmMonthlySignText,
  pmSignSnapshot, pmSnapshotDrift, activeSignoffs, signKey, PM_SIGN_STEPS, PM_REVOKE_REASON_MIN, PERM_OF_STEP,
} from '../utils/pmMonthly'
import {
  loadPmMonthInspections, loadOrgForSign, loadPmMonthlySignoffs, signPmMonthly, revokePmMonthly,
} from '../lib/pmMonthlySignoff'
import { tr } from '../utils/i18n'
import { dateLocale } from '../utils/i18n';

const fmtWhen = (ts) => (ts ? new Date(ts).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '')

export default function PmMonthlyReport() {
  const { role, fullName, position: myPosition, signatureUrl: mySignature } = useContext(UserContext)
  /* คีย์ต่อขั้น (RLS เช็คตาม kind): ③ pm:monthly_approve · ④ pm:monthly_ack */
  const permitted = (step) => can(...PERM_OF_STEP[step], role)
  const [month, setMonth] = useState(() => getWorkDate().slice(0, 7))
  const [uid, setUid] = useState(null)
  const [teams, setTeams] = useState([])
  const [lines, setLines] = useState(null)       // null = ยังโหลด/อ่านไม่ได้
  const [data, setData] = useState(null)         // { key, ok, rows, lineOfJig, error }
  const [org, setOrg] = useState(null)           // { ok, nodes, assignments }
  const [sign, setSign] = useState(null)         // { key, ok, rows, missing, error }
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [revoking, setRevoking] = useState(null)
  const [reason, setReason] = useState('')
  const curKey = viewKey({ month })

  useEffect(() => {
    let alive = true
    supabase.auth.getUser().then(({ data: u }) => { if (alive) setUid(u?.user?.id || null) })
    loadPmTeams().then(t => { if (alive) setTeams((t || []).filter(x => !isAmTeam(x.key))) })
    loadLinesRes().then(({ data: l, error }) => { if (alive) setLines(error ? null : (l || [])) })
    loadDocForms()   // อุ่น cache ทะเบียนเลขฟอร์ม ให้ชื่อไฟล์ Excel ถูกตั้งแต่กดครั้งแรก
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!uid) return
    let alive = true
    loadOrgForSign(uid).then(r => { if (alive) setOrg(r) })
    return () => { alive = false }
  }, [uid])
  useEffect(() => {
    let alive = true
    const key = viewKey({ month })
    setData(null); setSign(null)
    loadPmMonthInspections(month).then(r => { if (alive) setData({ ...r, key }) })
    loadPmMonthlySignoffs(month).then(r => { if (alive) setSign({ ...r, key }) })
    return () => { alive = false }
  }, [month, tick])

  const sectionOfLine = useMemo(() => {
    const m = new Map((lines || []).map(l => [l.name, l.section || null]))
    return (name) => (name ? m.get(name) || null : null)
  }, [lines])
  const sum = useMemo(() => (data?.ok ? summarizePmMonth(data.rows, { lineOfJig: data.lineOfJig, sectionOfLine }) : new Map()), [data, sectionOfLine])
  const active = useMemo(() => (sign?.ok ? activeSignoffs(sign.rows) : new Map()), [sign])
  const teamLabel = (k) => teams.find(t => t.key === k)?.label || k
  const teamNode = (k) => teams.find(t => t.key === k)?.org_node_id || null
  const today = getWorkDate()

  /* ตัดสินด่าน — เรียกทั้งตอน render (โชว์ปุ่ม/เหตุผล) และ **ตอนกดอีกรอบ** */
  const verdictFor = (teamKey, step, section = null) => {
    const team = sum.get(teamKey)
    const target = step === 3 ? teamNode(teamKey) : sectionNodeIdOf(section, org?.nodes || [])
    return pmMonthlySignVerdict({
      step, permitted: permitted(step), sharedAccount: isSharedAccount(), orgReadable: !!org?.ok,
      targetNodeId: target, cover: coversNode(org?.assignments || [], target, org?.nodes || [], today),
      team, alreadySigned: active.has(signKey(teamKey, step, section)),
      step3Signed: active.has(signKey(teamKey, 3)), myUid: uid,
    })
  }

  const doSign = async (teamKey, step, section = null) => {
    if (busy) return
    if (isStale(data?.key, curKey) || isStale(sign?.key, curKey)) { toast.error(staleBlockText({ unitWord: tr('เดือน') })); return }
    if (!sign?.ok) { toast.error('อ่านทะเบียนลงนามไม่ได้ — ยังลงนามไม่ได้ (กันลงซ้ำ)'); return }
    const v = verdictFor(teamKey, step, section)     // 🔴 คิดใหม่ตอนกด
    if (!v.ok) { toast.error(pmMonthlySignText(v, { teamLabel: teamLabel(teamKey), section })); return }
    const st = PM_SIGN_STEPS[step]
    const ok0 = await confirmSign({
      what: `${st.short} — ${tr("สรุปใบตรวจ")} PM ${teamLabel(teamKey)}${section ? ` · ${tr("ส่วนงาน")} ${section}` : ''}`,
      orderNo: `${tr("เดือน")} ${month}`, docLabel: 'สรุปรายเดือน',
      actor: fullName, as: `${st.label}${v.via?.kind === 'acting' ? tr(' (รักษาการ)') : ''}`,
      effect: step === 3 ? 'ส่วนงานที่ถูกตรวจจะรับทราบได้ (ขั้น ④)' : 'ปิดสายลงนามของส่วนงานนี้',
      warn: 'แก้ไขภายหลังได้ด้วยการเพิกถอนพร้อมเหตุผล (ไม่ลบ — ประวัติยังอยู่)',
    })
    if (!ok0) return
    setBusy(true)
    const ok = await signPmMonthly({
      verdict: v, teamLabel: teamLabel(teamKey), month, teamKey, step, section,
      snapshot: pmSignSnapshot(sum.get(teamKey), section), userId: uid, fullName,
      position: myPosition, signatureUrl: mySignature,
    })
    setBusy(false)
    if (ok) { toast.success(`${st.short} ${teamLabel(teamKey)}${section ? ` · ${section}` : ''} ${tr("เดือน")} ${month} ${tr("แล้ว")}`); setTick(t => t + 1) }
  }
  const doRevoke = async () => {
    if (!revoking || busy) return
    if (!permitted(revoking.step) || isSharedAccount()) { toast.error('บัญชีนี้เพิกถอนไม่ได้'); return }
    setBusy(true)
    const ok = await revokePmMonthly({ row: revoking, reason, fullName })
    setBusy(false)
    if (ok) { toast.success('เพิกถอนแล้ว'); setRevoking(null); setReason(''); setTick(t => t + 1) }
  }

  const exportXlsx = async () => {
    if (!data?.ok) { toast.error('ยังไม่มีข้อมูลของเดือนนี้'); return }
    try {
      const XLSX = await import('xlsx')
      const head = ['ทีม', 'ส่วนงานที่ถูกตรวจ', 'ใบตรวจ', 'ผ่านขั้น ②', 'รอ ②', 'ตีกลับ', 'NG', tr("เครื่อง"),
        '③ ผู้อนุมัติ', '③ วันที่', '③ ได้สิทธิ์จาก', '④ ผู้รับทราบ', '④ วันที่', '④ ได้สิทธิ์จาก', 'ตัวเลขเปลี่ยนหลังลงนาม']
      const via = (r) => (r ? (r.snapshot?.via?.kind === 'acting' ? 'รักษาการ' : r.snapshot?.via ? 'หัวหน้า/ดูควบ' : '') : '')
      const aoa = [head]
      for (const t of sum.values()) {
        const s3 = active.get(signKey(t.team, 3))
        const secs = [...t.sections.values()]
        if (!secs.length) secs.push({ section: '', total: 0, ng: 0, machines: new Set() })
        for (const s of secs) {
          const s4 = s.section ? active.get(signKey(t.team, 4, s.section)) : null
          const drift = (s3 && pmSnapshotDrift(s3.snapshot, pmSignSnapshot(t))) || (s4 && pmSnapshotDrift(s4.snapshot, pmSignSnapshot(t, s.section)))
          aoa.push([teamLabel(t.team), s.section || '(หาส่วนงานไม่เจอ)', s.total, '', '', '', s.ng, s.machines.size,
            s3?.signed_by_name || '', fmtWhen(s3?.signed_at), via(s3), s4?.signed_by_name || '', fmtWhen(s4?.signed_at), via(s4), drift ? 'ใช่' : ''])
        }
        aoa.push([`${teamLabel(t.team)} (${tr("รวมทีม")})`, '', t.total, t.confirmed, t.waiting, t.rejected, t.ng, t.machines.size,
          '', '', '', '', '', '', t.noSection ? `${tr("หาส่วนงานไม่เจอ")} ${t.noSection} ${tr("ใบ")}` : ''])
      }
      const notes = [[tr("รายการ"), 'คำอธิบาย'], ['เดือน', month],
        ['ขั้น ②', 'หัวหน้าผู้ตรวจยืนยันทีละใบ — ขั้น ③ อนุมัติได้เมื่อทุกใบผ่าน ② แล้วเท่านั้น'],
        ['ขั้น ③', 'ผจก.ส่วนของผู้ตรวจ อนุมัติ (1 ลายเซ็นต่อทีม×เดือน) · ผู้มีสิทธิ์ = หัวหน้า/รักษาการในผังองค์กร'],
        ['ขั้น ④', 'ผจก.ส่วนที่ถูกตรวจ รับทราบ (ต่อทีม×ส่วนงาน×เดือน) · ทำได้หลัง ③'],
        ['ลงนาม', sign?.ok ? 'ข้อมูลลงนามจากทะเบียน (ไม่รวมที่เพิกถอนแล้ว)'
          : (sign?.missing ? 'ระบบลงนามยังไม่เปิดใช้ — ไฟล์นี้ไม่มีข้อมูลลงนาม' : 'อ่านทะเบียนลงนามไม่ได้ — ไฟล์นี้ไม่ได้บอกว่ามีใครลงนามหรือไม่')]]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'สรุป PM รายเดือน')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), 'คำอธิบาย')
      XLSX.writeFile(wb, xlsxDocName('xlsx_pm_monthly', `PM_Monthly_${month}`))
    } catch (e) { toast.error(`${tr("ส่งออก Excel ไม่สำเร็จ")}: ${e?.message || e}`) }
  }

  const SignCell = ({ teamKey, step, section = null }) => {
    const row = active.get(signKey(teamKey, step, section))
    if (row) {
      const live = pmSignSnapshot(sum.get(teamKey), section)
      return (
        <div style={{ fontSize: 12 }}>
          <div style={{ color: 'var(--green)', fontWeight: 800 }}>✓ {row.signed_by_name || '-'}{row.snapshot?.via?.kind === 'acting' ? tr(" (รักษาการ)") : ''}</div>
          <div style={{ color: 'var(--muted)' }}>{positionLabel(row.position) || ''} {fmtWhen(row.signed_at)}</div>
          {pmSnapshotDrift(row.snapshot, live) && <div style={{ color: 'var(--amber)', fontWeight: 700 }}>⚠ {tr("ตัวเลขเปลี่ยนหลังลงนาม")}</div>}
          {permitted(step) && <button type="button" className="pg-btn" style={{ marginTop: 4 }} onClick={() => { setRevoking(row); setReason('') }}>{tr('เพิกถอน')}</button>}
        </div>
      )
    }
    if (!sign?.ok) return <span style={{ fontSize: 12, color: 'var(--amber)' }}>{sign?.missing ? tr('ระบบลงนามยังไม่เปิดใช้') : tr('อ่านทะเบียนลงนามไม่ได้')}</span>
    const v = verdictFor(teamKey, step, section)
    return v.ok
      ? <button type="button" className="pg-btn primary" disabled={busy} onClick={() => doSign(teamKey, step, section)}>{tr(PM_SIGN_STEPS[step].short)}</button>
      : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pmMonthlySignText(v, { teamLabel: teamLabel(teamKey), section })}</span>
  }

  const teamList = [...sum.values()]
  const unmapped = teams.filter(t => !t.org_node_id)
  return (
    <div>
      <FilterBar style={{ marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          {tr('เดือน')} <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
        </label>
        <span className="spacer" />
        <button type="button" className="pg-btn" onClick={exportXlsx} disabled={!data?.ok}>{tr('Excel')}</button>
      </FilterBar>

      <NoticeBar tone="info" style={{ marginBottom: 10 }}>
        {tr("สาย: ① ผู้ตรวจสแกนบัตร → ② หัวหน้าผู้ตรวจยืนยันทีละใบ")} → <b>③ {tr("ผจก.ส่วนของผู้ตรวจ อนุมัติ (ต่อทีม")})</b> →
        <b> ④ {tr("ผจก.ส่วนที่ถูกตรวจ รับทราบ (ต่อส่วนงาน")})</b> · {tr("ผู้เซ็น ③④ = หัวหน้า/รักษาการตามผังองค์กร (ตั้งที่")} /org-setup)
      </NoticeBar>
      {data && !data.ok && <NoticeBar tone="bad" style={{ marginBottom: 10 }}>{tr('อ่านใบตรวจของเดือนไม่สำเร็จ')}: {data.error}</NoticeBar>}
      {lines === null && data && <NoticeBar tone="warn" style={{ marginBottom: 10 }}>{tr('อ่านทะเบียนไลน์ไม่สำเร็จ — แยกส่วนงานที่ถูกตรวจไม่ได้')}</NoticeBar>}
      {org && !org.ok && <NoticeBar tone="warn" style={{ marginBottom: 10 }}>{tr('อ่านผังองค์กร/การมอบหมายไม่สำเร็จ — ยังลงนามไม่ได้')} ({org.error})</NoticeBar>}
      {active.skipped > 0 && <NoticeBar tone="warn" style={{ marginBottom: 10 }}>
        {tr("มีลายเซ็น")} {active.skipped} {tr("รายการที่รูปแบบไม่ตรงกับหน้านี้ (บันทึกแบบเก่า) — ไม่ได้นำมาแสดง")}
      </NoticeBar>}
      {unmapped.length > 0 && <NoticeBar tone="warn" style={{ marginBottom: 10 }}>
        {tr("ทีมที่ยังไม่ผูกหน่วยในผังองค์กร (ขั้น ③ ยังเซ็นไม่ได้")}): {unmapped.map(t => t.label).join(', ')}
      </NoticeBar>}

      {!data ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>{tr('กำลังโหลด...')}</div>
        : data.ok && teamList.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>{tr('เดือนนี้ไม่มีใบตรวจ PM ของทีมช่าง')}</div>
        : teamList.map(t => (
          <div key={t.team} className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{teamLabel(t.team)}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                  {tr("ใบตรวจ")} {t.total} · {tr("ผ่าน")} ② {t.confirmed}
                  {t.waiting > 0 && <b style={{ color: 'var(--amber)' }}> · {tr("รอ")} ② {t.waiting}</b>}
                  {t.rejected > 0 && <b style={{ color: 'var(--red)' }}> · {tr("ตีกลับ")} {t.rejected}</b>}
                  {' '}· NG {t.ng} · {tr("เครื่อง")} {t.machines.size}
                  {t.noSection > 0 && <span style={{ color: 'var(--amber)' }}> · {tr("หาส่วนงานไม่เจอ")} {t.noSection} {tr("ใบ")}</span>}
                </div>
                {!teamMonthReady(t) && <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 2 }}>{tr('ขั้น ③ รอใบทุกใบผ่านขั้น ② ก่อน')}</div>}
              </div>
              <div style={{ minWidth: 220 }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{tr(PM_SIGN_STEPS[3].label)}</div><SignCell teamKey={t.team} step={3} /></div>
            </div>
            <table style={{ width: '100%', marginTop: 10, fontSize: 12 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>{tr('ส่วนงานที่ถูกตรวจ')}</th><th>{tr('ใบ')}</th><th>NG</th><th>{tr('เครื่อง')}</th><th style={{ textAlign: 'left' }}>{tr(PM_SIGN_STEPS[4].label)}</th></tr></thead>
              <tbody>
                {[...t.sections.values()].map(s => (
                  <tr key={s.section}>
                    <td>{s.section}</td><td style={{ textAlign: 'center' }}>{s.total}</td>
                    <td style={{ textAlign: 'center', color: s.ng ? 'var(--red)' : undefined }}>{s.ng}</td>
                    <td style={{ textAlign: 'center' }}>{s.machines.size}</td>
                    <td><SignCell teamKey={t.team} step={4} section={s.section} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {revoking && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18, width: 'min(96vw, 460px)', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{tr('เพิกถอนลายเซ็น')} — {teamLabel(revoking.team)} {revoking.section ? `· ${revoking.section}` : ''} ({tr(PM_SIGN_STEPS[revoking.step]?.short)})</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{tr('ไม่ลบประวัติ — ลายเซ็นเดิมเปลี่ยนเป็น "เพิกถอน" พร้อมเหตุผล')}</div>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} style={{ width: '100%' }}
              placeholder={`${tr("เหตุผล (อย่างน้อย")} ${PM_REVOKE_REASON_MIN} ${tr("ตัวอักษร")})`} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button type="button" className="pg-btn" onClick={() => setRevoking(null)}>{tr('ยกเลิก')}</button>
              <button type="button" className="pg-btn primary" disabled={busy || reason.trim().length < PM_REVOKE_REASON_MIN} onClick={doRevoke}>{tr('เพิกถอน')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
