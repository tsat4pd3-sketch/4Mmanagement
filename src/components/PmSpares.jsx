/* ═══════════════════════════════════════════════════════════════════════════
   🔩 อะไหล่ของแผน PM — UI (แท็บแผน PM ใน /pm · 2026-10-08)

   คำสั่ง user: "ทำเรื่องผูก Spare เข้ากับแผน PM ต่อเลย"
   ทีมช่าง: "เหลือส่วน PM กับ Spare ... จะกรอกเป็น Target Plan PM ที่จะถึง"

   <PlanSparesModal>   = PM 1 ใบ: ผูกอะไหล่ที่ใช้ต่อรอบ + ดูว่าของพอไหม + เบิกตามแผนปุ่มเดียว
   <SpareDemandBanner> = แถบสรุป "อะไหล่สำหรับ PM 30 วันข้างหน้า" + โมดัลตารางความต้องการรวม

   ⚠️ สิทธิ์ (ไม่มีคีย์ใหม่): แก้รายการ = can('pm','setup') (ตัวเดียวกับตั้งรอบ/เลื่อนแผน)
      · เบิก = can('mtn_repair','service') (ตัวเดียวกับเบิกในคลังอะไหล่/ใบ MO)
   ⚠️ เบิกผ่าน RPC `pm_issue_spares` เท่านั้น — ทั้งชุดหรือไม่เลย · ข้างในเรียก `mtn_stock_move` ตัวเดิม
      ห้ามแตะ `mtn_spare_parts.stock_qty` ตรงๆ (กฎเหล็กคลังอะไหล่)
   ⚠️ RLS ฝั่ง DR ปฏิเสธ UPDATE/DELETE = 0 แถวเงียบ ⇒ ทุกการเขียน `.select('id')` แล้วนับแถว
   ⚠️ สูตรอยู่ `src/utils/pmSpares.js` · ตัวโหลดอยู่ `src/lib/pmSpareData.js` — ห้ามคิดเลขในไฟล์นี้
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabaseDR } from '../supabaseClient'
import { toast } from './Toast'
import SearchSelect from './SearchSelect'
import { planReadiness, SPARE_HORIZON_DAYS } from '../utils/pmSpares'
import { loadSpareParts, loadPmSpareDemand } from '../lib/pmSpareData'

const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }))
const fmtYmd = (ymd) => {
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short' })
}
const inp = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }
const btn = (c, solid) => ({ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: solid ? 'none' : `1px solid ${c}55`, background: solid ? c : `${c}14`, color: solid ? '#fff' : c })
const th = { padding: '8px 9px', textAlign: 'left', fontSize: 12, fontWeight: 800, color: 'var(--muted)', whiteSpace: 'nowrap' }
const td = { padding: '7px 9px', fontSize: 12.5, borderTop: '1px solid var(--border)', verticalAlign: 'top' }
const Chip = ({ c, children }) => <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 12, fontSize: 11.5, fontWeight: 800, color: c, border: `1px solid ${c}66`, background: `${c}1a`, whiteSpace: 'nowrap' }}>{children}</span>

function Shell({ title, sub, onClose, children, width = 680 }) {
  return (
    // ฟอร์มมีข้อมูลที่กรอก — ไม่ปิดจาก backdrop (UI-CONVENTIONS §5) · modal-scroll = เลื่อนถึงปุ่มล่างได้
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: `min(${width}px, 96vw)`, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
            {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
          </div>
          <button onClick={onClose} aria-label="ปิด" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 9px', fontSize: 13, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ── PM 1 ใบ: อะไหล่ที่ใช้ต่อรอบ ─────────────────────────────────────────────── */
export function PlanSparesModal({ row, canEdit, canIssue, byName, byUid, onClose, onChanged }) {
  const clId = row.cl.id
  const eqLabel = [row.eq?.machine_no || row.eq?.jig_no, row.eq?.name || row.cl.name].filter(Boolean).join(' · ')
  const [lines, setLines] = useState([])
  const [parts, setParts] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [pick, setPick] = useState({ id: '', text: '' })
  const [pickQty, setPickQty] = useState('1')
  const [busy, setBusy] = useState(false)

  /* 🔴 stale-guard (กฎเหล็ก DB ข้อ 4 · QC audit 08/10) — โมดัลนี้เปลี่ยน `clId` ได้โดยไม่ unmount
     (กดข้ามแผนจากโมดัลความต้องการรวม) ⇒ ไม่มี guard = ตอบช้าของแผนเก่าทับตอบเร็วของแผนใหม่
     = เห็นอะไหล่ของแผนอื่น · แถบในไฟล์เดียวกันมี guard ถูกแล้ว ตัวนี้ขาด */
  const reqRef = useRef(0)
  const load = useCallback(async () => {
    const my = ++reqRef.current
    setLoading(true); setLoadErr('')
    const [ls, ps, hs] = await Promise.all([
      supabaseDR.from('pm_plan_spares').select('id, part_id, qty_per_pm, note').eq('checklist_id', clId).order('created_at'),
      loadSpareParts(),
      supabaseDR.from('mtn_stock_txns').select('id, part_id, qty, created_at, by_name').eq('ref_checklist_id', clId)
        .order('created_at', { ascending: false }).limit(20),
    ])
    if (my !== reqRef.current) return    // มีคำขอใหม่กว่าแล้ว — ทิ้งผลนี้ ห้าม setState
    const errs = [ls.error && 'รายการอะไหล่', ps.error && 'ทะเบียนอะไหล่', hs.error && 'ประวัติเบิก'].filter(Boolean)
    if (errs.length) setLoadErr(`โหลดไม่สำเร็จ: ${errs.join(' · ')}`)
    setLines(ls.data || []); setParts(ps.data || []); setHistory(hs.data || [])
    setLoading(false)
  }, [clId])
  useEffect(() => { load() }, [load])

  const partById = useMemo(() => new Map(parts.map(p => [p.id, p])), [parts])
  const ready = useMemo(() => planReadiness(lines, partById), [lines, partById])
  const options = useMemo(() => parts
    .filter(p => p.is_active !== false && !lines.some(l => l.part_id === p.id))
    .map(p => ({
      id: p.id, label: p.name, lead: p.code || undefined, title: p.name,
      sub: `คงเหลือ ${fmtN(p.stock_qty)} ${p.unit || ''}${p.shelf ? ` · ชั้น ${p.shelf}` : ''}`,
      keywords: [p.code, p.shelf, p.category].filter(Boolean).join(' '),
    })), [parts, lines])

  const audit = { updated_by_name: byName || null, updated_by_uid: byUid || null }
  const addLine = async () => {
    const q = Number(pickQty)
    if (!pick.id) return toast.error('เลือกอะไหล่จากทะเบียนก่อน')
    if (!(q > 0)) return toast.error('จำนวนต่อรอบต้องมากกว่า 0')
    setBusy(true)
    const { data, error } = await supabaseDR.from('pm_plan_spares')
      .insert({ checklist_id: clId, part_id: pick.id, qty_per_pm: q, ...audit }).select('id')
    setBusy(false)
    if (error) return toast.error(`เพิ่มอะไหล่ไม่สำเร็จ: ${error.message}`)
    if (!data?.length) return toast.error('เพิ่มอะไหล่ไม่สำเร็จ (บันทึกได้ 0 แถว)')
    setPick({ id: '', text: '' }); setPickQty('1'); await load(); onChanged?.()
  }
  const updQty = async (l, v) => {
    const q = Number(v)
    if (!(q > 0) || q === Number(l.qty_per_pm)) return
    const { data, error } = await supabaseDR.from('pm_plan_spares').update({ qty_per_pm: q, ...audit }).eq('id', l.id).select('id')
    if (error || !data?.length) { toast.error(`แก้จำนวนไม่สำเร็จ${error ? `: ${error.message}` : ' (0 แถว)'}`); return load() }
    await load(); onChanged?.()
  }
  const delLine = async (l) => {
    const p = partById.get(l.part_id)
    if (!confirm(`เอา "${p?.name || 'อะไหล่'}" ออกจากแผน PM นี้?`)) return
    const { data, error } = await supabaseDR.from('pm_plan_spares').delete().eq('id', l.id).select('id')
    if (error || !data?.length) return toast.error(`ลบไม่สำเร็จ${error ? `: ${error.message}` : ' (0 แถว)'}`)
    await load(); onChanged?.()
  }
  const issue = async () => {
    const items = ready.items.filter(i => i.part && i.qty > 0).map(i => ({ part_id: i.part.id, qty: i.qty }))
    if (!items.length) return
    const txt = ready.items.map(i => `• ${i.part?.name || '?'} × ${fmtN(i.qty)} ${i.part?.unit || ''}`).join('\n')
    if (!confirm(`เบิกอะไหล่ตามแผน PM "${eqLabel}"\n\n${txt}\n\nตัดสต็อกทั้งชุด (ถ้าตัวใดไม่พอ จะไม่ตัดเลยสักตัว)`)) return
    setBusy(true)
    const { error } = await supabaseDR.rpc('pm_issue_spares', {
      p_checklist_id: clId, p_items: items, p_by_name: byName || null, p_note: `เบิกตามแผน PM · ${eqLabel}`.slice(0, 200),
    })
    setBusy(false)
    if (error) return toast.error(`เบิกไม่สำเร็จ — ไม่มีการตัดสต็อก: ${error.message}`)
    toast.success(`เบิกอะไหล่ตามแผน PM แล้ว ${items.length} รายการ`)
    await load(); onChanged?.()
  }

  return (
    <Shell title="🔩 อะไหล่ที่ใช้ใน PM รอบหนึ่ง" onClose={onClose}
      sub={<>{eqLabel || '—'}{row.eq?.line_name ? ` · ${row.eq.line_name}` : ''} · รอบ: <b>{row.cycleText || '—'}</b>{row.nextDue ? ` · PM ครั้งถัดไป ${row.nextDue.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })}` : ''}</>}>
      {loadErr && <div style={{ color: '#ef4444', fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>⚠️ {loadErr}</div>}
      {loading ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด…</div> : (<>
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead><tr style={{ background: 'var(--bg3)' }}>
              {['อะไหล่', 'ใช้ต่อรอบ', 'คงเหลือ', 'สถานะ', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {!ready.items.length && (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 18 }}>
                  ยังไม่ได้ผูกอะไหล่ — เพิ่มอะไหล่ที่ใช้ใน PM รอบหนึ่งด้านล่าง แล้วระบบจะรวมความต้องการล่วงหน้าให้เอง
                </td></tr>
              )}
              {ready.items.map(i => (
                <tr key={i.line.id}>
                  <td style={td}>
                    <b style={{ color: 'var(--text)' }}>{i.part?.name || 'อะไหล่ถูกลบจากทะเบียน'}</b>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{[i.part?.code, i.part?.shelf && `ชั้น ${i.part.shelf}`].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td style={td}>
                    {canEdit
                      ? <input type="number" min="0" step="any" defaultValue={i.qty} onBlur={e => updQty(i.line, e.target.value)} style={{ ...inp, width: 80 }} aria-label="จำนวนต่อรอบ" />
                      : fmtN(i.qty)} <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{i.part?.unit || ''}</span>
                  </td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtN(i.stock)}</td>
                  <td style={td}>{i.missing ? <Chip c="#9aa3a0">ไม่อยู่ในทะเบียน</Chip> : i.ok ? <Chip c="#3dd65c">✓ พอ</Chip> : <Chip c="#ef4444">ขาด {fmtN(i.qty - (i.stock || 0))}</Chip>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{canEdit && <button onClick={() => delLine(i.line)} title="เอาออกจากแผน" style={{ ...btn('#8b8b96'), padding: '4px 9px', fontSize: 12 }}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 10 }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <SearchSelect value={pick.id} text={pick.text} options={options} onChange={({ id, text }) => setPick({ id: id || '', text: text || '' })}
                placeholder="🔎 ค้นอะไหล่จากคลัง (ชื่อ / รหัส / ชั้นวาง)" emptyText="ไม่พบในคลังอะไหล่ — เพิ่มอะไหล่ใหม่ที่ ทะเบียนอุปกรณ์ → คลังอะไหล่" />
            </div>
            <input type="number" min="0" step="any" value={pickQty} onChange={e => setPickQty(e.target.value)} style={{ ...inp, width: 80 }} aria-label="จำนวนต่อรอบ" />
            <button onClick={addLine} disabled={busy || !pick.id} style={{ ...btn('#3dd65c', true), opacity: pick.id ? 1 : 0.5 }}>+ เพิ่ม</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--bg3)' }}>
          <span style={{ flex: '1 1 240px', fontSize: 12.5, color: 'var(--text2)' }}>
            {ready.allOk == null ? 'ผูกอะไหล่ก่อน แล้วจึงเบิกตามแผนได้'
              : ready.allOk ? '✅ อะไหล่พร้อมสำหรับ PM รอบถัดไป'
                : <span style={{ color: '#ef4444', fontWeight: 700 }}>⚠️ ขาด {ready.shortCount} รายการ — เบิกทั้งชุดไม่ได้จนกว่าจะรับของเข้า</span>}
          </span>
          {canIssue
            ? <button onClick={issue} disabled={busy || !ready.allOk} title={ready.allOk ? 'ตัดสต็อกทุกรายการในครั้งเดียว' : 'มีอะไหล่ไม่พอ'}
                style={{ ...btn('#4a90e0', true), opacity: ready.allOk ? 1 : 0.45, cursor: ready.allOk ? 'pointer' : 'not-allowed' }}>📦 เบิกอะไหล่ตามแผน PM</button>
            : <span style={{ fontSize: 12, color: 'var(--muted)' }}>เบิกได้เฉพาะผู้มีสิทธิ์เบิกอะไหล่</span>}
        </div>

        {history.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text2)', marginBottom: 4 }}>ประวัติเบิกให้ PM ใบนี้</div>
            {history.slice(0, 8).map(h => (
              <div key={h.id} style={{ fontSize: 12, color: 'var(--muted)', padding: '3px 0', borderTop: '1px dashed var(--border)' }}>
                {new Date(h.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {' · '}{partById.get(h.part_id)?.name || 'อะไหล่'} × {fmtN(Math.abs(Number(h.qty)))}{h.by_name ? ` · ${h.by_name}` : ''}
              </div>
            ))}
          </div>
        )}
      </>)}
    </Shell>
  )
}

/* ── แถบสรุป + ตารางความต้องการรวม (ทั้งโรงงาน) ────────────────────────────── */
export function SpareDemandBanner({ todayStr, reloadKey = 0, onOpenPlan }) {
  const [state, setState] = useState({ loading: true, demand: null, error: null })
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true }))
    /* 🔴 ต้องมี catch (QC audit 08/10) — ถ้า spareDemand()/resolvePlanDue() โยน (ข้อมูลเพี้ยนแถวเดียวก็พอ)
       เดิมเป็น unhandled rejection ⇒ loading ค้าง true ตลอด ⇒ **แถบหายเงียบ**
       ซึ่งขัดคอมเมนต์ของตัวเองข้างล่าง ("ห้ามซ่อนทั้งแถบ — คนจะไม่รู้ว่ามีฟีเจอร์นี้") */
    loadPmSpareDemand({ todayStr })
      .then(r => { if (alive) setState({ loading: false, demand: r.demand, error: r.error }) })
      .catch(e => {
        if (!alive) return
        setState({
          loading: false,
          demand: { rows: [], noDue: [], summary: { horizonDays: 0, parts: 0, short: 0, belowMin: 0, noDuePlans: 0 } },
          error: `คิดความต้องการอะไหล่ไม่สำเร็จ: ${e?.message || e}`,
        })
      })
    return () => { alive = false }
  }, [todayStr, reloadKey])

  const d = state.demand
  if (state.loading || !d) return null
  // ยังไม่มีแผนไหนผูกอะไหล่ = บอกครั้งเดียวสั้นๆ (ห้ามซ่อนทั้งแถบ — คนจะไม่รู้ว่ามีฟีเจอร์นี้)
  const s = d.summary
  const bad = s.short > 0
  const c = bad ? '#ef4444' : s.belowMin ? '#f59a3f' : '#4a90e0'
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, borderRadius: 10, border: `1px solid ${c}55`, background: `${c}12` }}>
        <span style={{ fontSize: 13, color: 'var(--text)', flex: '1 1 280px' }}>
          🔩 <b>อะไหล่สำหรับ PM {s.horizonDays} วันข้างหน้า</b>{' '}
          {state.error ? <span style={{ color: '#ef4444' }}>— {state.error} (ตัวเลขไม่ครบ)</span>
            : !s.parts && !s.noDuePlans ? <span style={{ color: 'var(--muted)' }}>— ยังไม่มีแผน PM ไหนผูกอะไหล่ (กดปุ่ม 🔩 ในมุมมองตาราง)</span>
              : <span style={{ color: 'var(--muted)' }}>
                  — ต้องใช้ {s.parts} รายการ
                  {bad && <> · <b style={{ color: '#ef4444' }}>ขาด {s.short}</b></>}
                  {s.orderLate > 0 && <> · <b style={{ color: '#ef4444' }}>สั่งไม่ทัน leadtime {s.orderLate}</b></>}
                  {s.belowMin > 0 && <> · ต่ำกว่า safety {s.belowMin}</>}
                  {s.noDuePlans > 0 && <> · แผนที่ยังไม่มีวัน PM {s.noDuePlans} (คาดไม่ได้)</>}
                </span>}
        </span>
        {(s.parts > 0 || s.noDuePlans > 0) && <button onClick={() => setOpen(true)} style={btn(c)}>ดูรายการ</button>}
      </div>
      {open && <SpareDemandModal demand={d} error={state.error} onClose={() => setOpen(false)} onOpenPlan={onOpenPlan} />}
    </>
  )
}

function SpareDemandModal({ demand, error, onClose, onOpenPlan }) {
  const [openRow, setOpenRow] = useState(null)
  const s = demand.summary
  return (
    <Shell title={`🔩 อะไหล่ที่ PM ${s.horizonDays} วันข้างหน้าต้องใช้`} width={920} onClose={onClose}
      sub="รวมทุกครั้งที่ PM จะเกิดในช่วงนี้ (รายสัปดาห์ = หลายครั้ง) ทุกทีม เทียบสต็อกคงเหลือ · ขาด = ต้องสั่ง/รับของเข้าก่อนวันที่ระบุ">
      {error && <div style={{ color: '#ef4444', fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>⚠️ {error} — ตัวเลขด้านล่างไม่ครบ</div>}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr style={{ background: 'var(--bg3)' }}>
            {['อะไหล่', 'ต้องใช้', 'คงเหลือ', 'หลังใช้', 'ใช้ครั้งแรก', 'เริ่มขาด', 'ต้องสั่งภายใน', 'PM ที่ใช้'].map(h => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {demand.rows.map(r => (
              <tr key={r.part.id}>
                <td style={td}>
                  <b style={{ color: 'var(--text)' }}>{r.part.name}</b>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{[r.part.code, r.part.shelf && `ชั้น ${r.part.shelf}`].filter(Boolean).join(' · ') || '—'}</div>
                </td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.needQty)} {r.part.unit || ''}{r.estimate && <div style={{ fontSize: 11, color: 'var(--muted)' }}>≈ ประมาณเผื่อ (นับตามวันเดิน)</div>}</td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.stock)}</td>
                <td style={td}>
                  {r.shortQty > 0 ? <Chip c="#ef4444">ขาด {fmtN(r.shortQty)}</Chip>
                    : r.belowMin ? <Chip c="#f59a3f">เหลือ {fmtN(r.after)} · ต่ำกว่า safety</Chip>
                      : <Chip c="#3dd65c">เหลือ {fmtN(r.after)}</Chip>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtYmd(r.firstUseYmd)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: r.firstShortYmd ? '#ef4444' : 'var(--muted)' }}>{fmtYmd(r.firstShortYmd)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {!r.firstShortYmd ? <span style={{ color: 'var(--muted)' }}>—</span>
                    : r.orderByYmd == null ? <span style={{ color: '#f59a3f' }}>ไม่รู้ leadtime</span>
                      : r.orderLate ? <b style={{ color: '#ef4444' }}>เลยมาแล้ว ({fmtYmd(r.orderByYmd)})</b>
                        : <b>{fmtYmd(r.orderByYmd)}</b>}
                  {r.leadDays != null && r.firstShortYmd && <div style={{ fontSize: 11, color: 'var(--muted)' }}>leadtime {r.leadDays} วัน</div>}
                </td>
                <td style={td}>
                  <button onClick={() => setOpenRow(openRow === r.part.id ? null : r.part.id)} style={{ ...btn('#8b8b96'), padding: '3px 9px', fontSize: 12 }}>
                    {r.uses.length} ครั้ง {openRow === r.part.id ? '▴' : '▾'}
                  </button>
                  {openRow === r.part.id && (
                    <div style={{ marginTop: 4 }}>
                      {r.uses.map((u, i) => (
                        <div key={i} style={{ fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                          {fmtYmd(u.ymd)} · {onOpenPlan
                            ? <a href="#" onClick={e => { e.preventDefault(); onOpenPlan(u.checklistId) }} style={{ color: 'var(--accent)' }}>{u.name}</a>
                            : u.name} × {fmtN(u.qty)}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {demand.noDue.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #f59a3f55', background: '#f59a3f12', fontSize: 12.5, color: 'var(--text2)' }}>
          ⚠️ <b>{demand.noDue.length} แผนผูกอะไหล่แล้ว แต่ยังไม่มีวัน PM ครั้งถัดไป</b> — ระบบคาดความต้องการของแผนเหล่านี้ไม่ได้
          (ตั้งรอบ/วัน PM ที่ปุ่ม 📅): {demand.noDue.map(p => p.name).join(' · ')}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
        * PM ที่เลยกำหนดนับเป็นวันนี้ · "ต้องสั่งภายใน" = วันที่เริ่มขาด − leadtime ของอะไหล่ (ตั้งที่ทะเบียนอะไหล่) ·
        safety = จำนวนขั้นต่ำ (min) ตาม WI-JIG-010 · ใช้จริงจะตัดสต็อกเมื่อกด "เบิกอะไหล่ตามแผน PM" หรือเบิกในใบ MO
      </div>
    </Shell>
  )
}

/* ปุ่ม 🔩 ในแถวตาราง — บอกจำนวนอะไหล่ที่ผูก + ไฟพอ/ขาด (ไม่ต้องเปิดโมดัล) */
export function sparesCountByChecklist(lines = []) {
  const m = new Map()
  for (const l of lines) m.set(l.checklist_id, (m.get(l.checklist_id) || 0) + 1)
  return m
}

export { SPARE_HORIZON_DAYS }
