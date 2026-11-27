/* 💬 AskBot — ปุ่มแชทลอย "ถามข้อมูลในระบบ" (2026-11-19 · คำสั่ง user · ขั้นที่ 1 ยังไม่มี AI)
   ทำอะไร: พิมพ์ถาม → `lib/askBotQuery.answerQuestion()` → คำตอบพร้อมบอกว่าดึงอะไรมา + ลิงก์หน้าเต็ม
   ใครเห็น: `canSeeded('askbot','use')` — ยังไม่ seed คีย์ = admin เท่านั้น (เปิดวงแคบก่อน · ENGINEERING §11)
   ตำแหน่ง: ขวาล่าง ยกเหนือชิปของ DowntimeSiren (bottom 12) · บวก --mnav-h ตามกฎ fixed ชิดล่าง
            จอคอม = กล่องลอย 360px · มือถือ = เต็มจอ (ชั้นเหนือไซเรน ⇒ หัวกล่องเขียนแถบเตือนแทน · แบบ ข)
   🔴 ห้ามซ่อนคำตอบ "อ่านไม่ได้" เป็น "ไม่มีข้อมูล" · ห้ามเดาเมื่อชื่อตรงหลายตัว (ให้กดเลือก)
   · ไม่ mount บนจอ TV (tvShell) — ไม่มีคนพิมพ์ และปุ่มบังข้อมูล
   📄 docs/modules/askbot.md */
import { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserContext } from '../App'
import useIsMobile from '../utils/useIsMobile'
import { tr } from '../utils/i18n'
import { getWorkDate, getCurrentShift } from '../utils/workDate'
import { canAccessPage } from '../utils/permissions'
import { HINT_CHIPS } from '../utils/askBot'
import { answerQuestion, logUnanswered } from '../lib/askBotQuery'
import { sirenCount, subscribeSiren } from '../utils/sirenBus'

export default function AskBot() {
  const ctx = useContext(UserContext)
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [msgs, setMsgs] = useState([])
  const [busy, setBusy] = useState(false)
  const [siren, setSiren] = useState(sirenCount())
  const listRef = useRef(null)
  const alive = useRef(true)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => subscribeSiren(setSiren), [])
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }, [msgs, busy, open])

  const ask = async (q, forced = null, shown = null) => {
    const s = String(q || '').trim()
    if (!s || busy) return
    setMsgs(m => [...m, { from: 'me', text: shown || s }])
    setText('')
    setBusy(true)
    let ans
    /* "กะนี้" ตัดสินจากนาฬิกาตอนกดส่ง — คู่กับวันทำงาน getWorkDate() (กะดึกหลังเที่ยงคืน = วันก่อนหน้า) */
    try { ans = await answerQuestion(s, ctx, getWorkDate(), forced, { shiftNow: getCurrentShift() }) }
    catch (e) { ans = { text: `⚠️ ${tr("ตอบไม่สำเร็จ")} — ${String(e?.message || e).slice(0, 120)}` } }
    /* ตอบไม่ได้ = เก็บคำถามไว้ดูว่าหน้างานพิมพ์อะไรจริง (ไม่รอ · ไม่กวนคนถาม) */
    if (ans?.unanswered) logUnanswered(s, ans.unanswered, ctx.role)
    if (!alive.current) return
    setMsgs(m => [...m, { from: 'bot', ...ans }])
    setBusy(false)
  }

  const fab = (
    <button onClick={() => setOpen(o => !o)} aria-label={tr('ถามข้อมูลในระบบ')} title={tr('ถามข้อมูลในระบบ')}
      style={{ position: 'fixed', right: 14, bottom: 'calc(56px + var(--mnav-h, 0px))', zIndex: 3990,
        width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 22,
        boxShadow: 'var(--shadow-float)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {open ? '✕' : '💬'}
    </button>
  )
  if (!open) return fab

  const panel = isMobile
    ? { position: 'fixed', inset: 0, bottom: 'var(--mnav-h, 0px)', zIndex: 4010, borderRadius: 0 }
    : { position: 'fixed', right: 14, bottom: 'calc(118px + var(--mnav-h, 0px))', zIndex: 3995,
        width: 360, height: 'min(520px, calc(100vh - 150px))', borderRadius: 'var(--r-lg)', border: '1px solid var(--border2)' }

  return (
    <>
      {!isMobile && fab}
      <div role="dialog" aria-label={tr('ถามข้อมูลในระบบ')} style={{ ...panel, background: 'var(--card)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', color: 'var(--text)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
          borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
          <span style={{ fontSize: 18 }}>💬</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{tr('ถามข้อมูลในระบบ')} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>🧪 {tr('ทดลอง')}</span></div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('ตอบจากข้อมูลจริงในระบบ · ไม่เข้าใจ = ไม่เดา')}</div>
          </div>
          {isMobile && <button onClick={() => setOpen(false)} aria-label={tr('ปิด')}
            style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 18, cursor: 'pointer' }}>✕</button>}
        </div>
        {/* 🚨 แบบ ข (คำสั่ง user 19/11): มือถือเปิดแชทเต็มจอบังแถบไซเรน ⇒ เขียนแทนที่หัวกล่อง · แดง = กระพริบตามกฎ Andon */}
        {isMobile && siren > 0 && (
          <button onClick={() => setOpen(false)} className="dt-alarm-banner"
            style={{ border: 'none', borderBottom: '1px solid var(--red-line)', background: 'var(--red-dim)', color: 'var(--red)', fontWeight: 800, fontSize: 12.5,
              padding: '7px 12px', textAlign: 'left', cursor: 'pointer' }}>
            🚨 {tr('มีเครื่องหยุด')} {siren} {tr('เครื่อง — แตะเพื่อปิดแชทไปดู')}
          </button>
        )}

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!msgs.length && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
              {tr('ถามได้: OEE ไลน์ · ไลน์ไหน OEE ต่ำสุด · downtime สูงสุด · เครื่องหยุดตอนนี้ · MO ค้าง · ของเสียสูงสุด · ใบสแครป · 4M ค้าง · มาทำงานกี่คน · ยอดผลิตของไลน์/พาร์ท')}<br />
              {tr('ระบุช่วงได้: วันนี้ · เมื่อวาน · สัปดาห์นี้ · เดือนนี้ · เดือน 10 · ต.ค. 2569 · กะเช้า · กะดึก · กะนี้ · เมื่อกี้')}
            </div>
          )}
          {msgs.map((m, i) => m.from === 'me' ? (
            <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '80%', background: 'var(--accent)',
              color: 'var(--accent-ink)', padding: '7px 11px', borderRadius: 12, fontSize: 13 }}>{m.text}</div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '92%', background: 'var(--bg2-surf)',
              border: '1px solid var(--border)', padding: '8px 11px', borderRadius: 12, fontSize: 13 }}>
              {m.source && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>📎 {m.source}</div>}
              <div style={{ whiteSpace: 'pre-line' }}>{m.text}</div>
              {!!m.notes?.length && <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'pre-line' }}>{m.notes.join('\n')}</div>}
              {m.choices && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {m.choices.map(c => (
                  <button key={`${c.kind}:${c.name || c.core}`} disabled={busy} onClick={() => ask(m.retext, c, `→ ${c.label}`)} style={chipBtn}>
                    {c.kind === 'line' ? '🏭' : '🔩'} {c.label}{c.p_no ? ` · ${c.p_no}` : ''}
                  </button>))}
                {m.more > 0 && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>+{m.more} {tr('รายการ — พิมพ์ให้เจาะจงขึ้น')}</span>}
              </div>}
              {m.hints && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {m.hints.map(h => <button key={h} disabled={busy} onClick={() => ask(h)} style={chipBtn}>{h}</button>)}</div>}
              {m.link && canAccessPage(m.link, ctx.role) && (
                <button onClick={() => { navigate(m.link); if (isMobile) setOpen(false) }}
                  style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>
                  {tr('ดูหน้าเต็ม')} → {m.link}
                </button>)}
            </div>
          ))}
          {busy && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('กำลังดึงข้อมูล…')}</div>}
        </div>

        <div style={{ padding: '8px 10px 4px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {HINT_CHIPS.map(h => <button key={h} onClick={() => setText(h)} style={chipBtn}>{tr(h)}</button>)}
        </div>
        <form onSubmit={e => { e.preventDefault(); ask(text) }} style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--border)' }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder={tr('พิมพ์คำถาม เช่น oee HDF1 วันนี้')}
            style={{ flex: 1, minWidth: 0, background: 'var(--bg2-surf)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)',
              color: 'var(--text)', padding: '8px 10px', fontSize: 13 }} />
          <button type="submit" disabled={busy || !text.trim()} style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none',
            borderRadius: 'var(--r-md)', padding: '0 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: busy || !text.trim() ? 0.5 : 1 }}>{tr('ส่ง')}</button>
        </form>
      </div>
    </>
  )
}

const chipBtn = { fontSize: 11.5, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--border2)',
  color: 'var(--text)', background: 'var(--card)', cursor: 'pointer' }
