import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabaseDR } from '../supabaseClient'
import { visibleInterval } from '../utils/usePolling'
import { RATE } from '../utils/refreshRates'
import { isAlarmingDT, isOverDtThreshold, loadDtAlertMin, DT_OPEN_ALERT_MIN_DEFAULT } from '../utils/downtimeAlarm'
import { liveChannel } from '../utils/liveChannel'

/* เสียง+แถบเตือน downtime บนเว็บ — แยกตามหน้า (คำสั่ง user 2026-07-14):
     mode='call_mtn'   → ดังหน้า Maintenance (มีคนกดปุ่ม "เรียกช่าง")
     mode='open_15min' → ดังหน้า Production  (เครื่องเปิดค้างเกินเกณฑ์นาที · scanner mark open_alerted_at)
   เสียงสร้างด้วย Web Audio (ไม่ต้องมีไฟล์) วนจนกด "รับทราบ" (set *_ack_at) แล้วดับ

   ⚠️⚠️ กฎเหล็ก — จอที่ "เปิดทิ้งไว้เฉยๆ" ต้องรู้ตัวว่าเสียงยังไม่พร้อม **ก่อน**เกิดเหตุ
   เบราว์เซอร์บล็อก autoplay จนกว่าจะมี user gesture → AudioContext เริ่มที่ state 'suspended'
   เดิมสร้าง AudioContext ตอนมี alert แล้วค่อยโชว์ "🔇 แตะเพื่อเปิดเสียง" **ในแถบ alert**
   ⇒ จอห้องช่างที่รีบูตกลางคืน (ไฟดับ/deploy ใหม่/เบราว์เซอร์ restart) จะไม่มีอะไรบอกเลย
      จนกระทั่งเครื่องหยุดจริง — แล้ว**เสียงแรกที่ควรดังที่สุดกลับเงียบ**
   → ตอนนี้สร้าง AudioContext ตั้งแต่ mount (suspended = ถูกต้อง ไม่เปลือง) + ฟัง statechange
     แล้วโชว์ชิปเล็กๆ สงบๆ ตลอดเวลาที่เสียงยังล็อก **แม้ยังไม่มี alert**
   ⚠️ ชิปนี้ **ห้ามกระพริบ/ห้ามใช้สีแดง** — เป็นสถานะความพร้อม ไม่ใช่ alarm (UI-CONVENTIONS §2) */
export default function DowntimeSiren({ mode = 'open_15min' }) {
  const [raw, setRaw] = useState([])       // แถวดิบที่ยังไม่รับทราบ (กะเปิดอยู่)
  const [thr, setThr] = useState(null)     // เกณฑ์นาที (dt_alert_config)
  const [, setTick] = useState(0)          // นาฬิกา — ให้ "ครบเกณฑ์" เกิดเองโดยไม่ต้องยิง DB
  const [muted, setMuted] = useState(false) // เบราว์เซอร์บล็อกเสียงอยู่ (ยังไม่มีใครแตะจอ)
  const acRef = useRef(null)
  const loopRef = useRef(null)

  const ackField = mode === 'call_mtn' ? 'call_mtn_ack_at' : 'open_ack_at'
  const label = mode === 'call_mtn' ? '📞 เรียกช่าง MTN เข้าหน้างาน' : '🚨 เครื่องหยุดเกินกำหนด'
  const color = mode === 'call_mtn' ? '#e05c4a' : '#f59a3f'

  const fetchAlerts = useCallback(async () => {
    let q = supabaseDR.from('downtime_logs')
      .select('id, machine_no, description, started_at, call_mtn_at, open_alerted_at, dr_downtime_types(name_th, category), production_sessions(line_name, status)')
      .is('duration_min', null).is('ended_at', null).is(ackField, null)
    if (mode === 'call_mtn') q = q.eq('call_mtn', true)
    const { data } = await q
    loadDtAlertMin().then(setThr)
    // เอาเฉพาะรายการของกะที่ยังเปิดอยู่ (เครื่องยังหยุดจริง)
    setRaw((data || []).filter(d => ['open', 'pending_close'].includes(d.production_sessions?.status)))
  }, [mode, ackField])

  /* 🔴 open_15min: ตัดสิน "เกินเกณฑ์" จาก **เวลาที่ผ่านไปจริง** ไม่ใช่ธง `open_alerted_at`
     (ธงนั้นคือตัวกันแจ้ง Telegram ซ้ำ — edge `downtime-open-scan` stamp ให้เฉพาะตอน POST สำเร็จ
      ⇒ Telegram ล่ม/ปิด rule = ธงไม่ถูกตั้ง → **ไซเรนบนจอไม่เคยดังเลย** · เจอจริง 2026-08-26)
     ⚠️ ต้องกรอง planned เองด้วย — เดิมพึ่งว่า scanner stamp เฉพาะนอกแผน
     ⚠️ คำนวณใหม่ทุกนาทีจากข้อมูลที่โหลดมาแล้ว (ไม่ยิง DB) — ไม่งั้นต้องรอรอบ poll ถัดไปถึงจะดัง */
  const alerts = useMemo(() => (mode === 'call_mtn'
    ? raw
    : raw.filter(d => isAlarmingDT(d) && isOverDtThreshold(d, thr ?? DT_OPEN_ALERT_MIN_DEFAULT))
  ), [raw, mode, thr])

  useEffect(() => {
    fetchAlerts()
    const stopPoll = visibleInterval(fetchAlerts, RATE.BACKUP) // กันเหนียวเผื่อ realtime หลุด
    const ch = liveChannel(supabaseDR, `dt-siren-${mode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' }, () => setTimeout(fetchAlerts, 400))
      .subscribe()
    // นาฬิกาอย่างเดียว ไม่ยิง DB — ให้รายการที่ "ครบเกณฑ์ระหว่างเปิดจออยู่" ดังเองภายใน 1 นาที
    const clk = setInterval(() => setTick(t => t + 1), 60000)
    return () => { stopPoll(); supabaseDR.removeChannel(ch); clearInterval(clk) }
  }, [mode, fetchAlerts])

  /* เตรียม AudioContext ตั้งแต่ mount — ต้องรู้สถานะเสียง "ก่อน" มี alert (ดูกฎหัวไฟล์)
     ฟัง statechange เพื่อให้ชิปหายเองทันทีที่ปลดล็อกได้ ไม่ว่าจะปลดจากทางไหน */
  useEffect(() => {
    let ac = acRef.current
    if (!ac) {
      try { ac = acRef.current = new (window.AudioContext || window.webkitAudioContext)() } catch { ac = null }
    }
    if (!ac) { setMuted(true); return }   // เบราว์เซอร์ไม่มี Web Audio = ไม่มีทางมีเสียง ต้องบอก
    const sync = () => setMuted(ac.state !== 'running')
    sync()
    ac.addEventListener?.('statechange', sync)
    // ลอง resume ทันที — บนเครื่องที่เพิ่งคลิกมา (นำทางจากเมนู) มักผ่านเลย ชิปจะไม่ขึ้นกวน
    try { ac.resume().then(sync, sync) } catch { /* ignore */ }
    const unlock = () => { try { ac.resume().then(sync, () => {}) } catch { /* ignore */ } }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)   // รีโมท TV บางรุ่นส่ง key ไม่ใช่ pointer
    return () => {
      ac.removeEventListener?.('statechange', sync)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // เล่น/หยุดไซเรน ตามว่ามี alert ค้างไหม
  useEffect(() => {
    if (!alerts.length) { clearInterval(loopRef.current); loopRef.current = null; return }
    if (loopRef.current) return // เล่นอยู่แล้ว
    if (!acRef.current) { try { acRef.current = new (window.AudioContext || window.webkitAudioContext)() } catch { acRef.current = null } }
    const ac = acRef.current
    const beep = () => {
      if (!ac) return
      try { ac.resume() } catch { /* ignore */ }
      const now = ac.currentTime
      ;[[880, 0], [660, 0.18]].forEach(([f, dt]) => {
        const o = ac.createOscillator(), g = ac.createGain()
        o.type = 'square'; o.frequency.value = f
        g.gain.setValueAtTime(0.0001, now + dt)
        g.gain.exponentialRampToValueAtTime(0.25, now + dt + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, now + dt + 0.16)
        o.connect(g); g.connect(ac.destination)
        o.start(now + dt); o.stop(now + dt + 0.17)
      })
    }
    beep()
    /* จอ TV ที่ไม่มีใครแตะ = เบราว์เซอร์บล็อก autoplay → "เห็นแถบแต่ไม่มีเสียง"
       ห้ามเงียบ: บอกบนแถบเลยว่าต้องแตะจอ 1 ครั้ง (เจอจริง 2026-08-26 "เสียงก็ไม่มี") */
    setMuted(!ac || ac.state !== 'running')
    loopRef.current = setInterval(beep, 1300)
    return () => { clearInterval(loopRef.current); loopRef.current = null }
  }, [alerts.length])

  useEffect(() => () => { clearInterval(loopRef.current); try { acRef.current?.close() } catch { /* ignore */ } }, [])

  // ปลดล็อกเสียงด้วยการแตะ (ใช้ร่วมทั้งชิป standby และปุ่มในแถบ alert — อย่าเขียนซ้ำ)
  const unlockNow = useCallback(() => {
    const ac = acRef.current
    if (!ac) return
    try { ac.resume().then(() => setMuted(ac.state !== 'running'), () => {}) } catch { /* ignore */ }
  }, [])

  const ack = async (id) => {
    setRaw(prev => prev.filter(a => a.id !== id))
    await supabaseDR.from('downtime_logs').update({ [ackField]: new Date().toISOString() }).eq('id', id)
  }

  /* ยังไม่มีเหตุ แต่เสียงล็อกอยู่ = ต้องบอกตั้งแต่ตอนนี้ (จอห้องช่างที่เปิดทิ้งไว้)
     ชิปเล็ก มุมล่างขวา สีเหลืองนิ่ง ไม่กระพริบ — เป็นสถานะความพร้อม ไม่ใช่ alarm */
  if (!alerts.length) {
    if (!muted) return null
    return (
      <div onClick={unlockNow} title="เบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ 1 ครั้ง — จอที่เปิดทิ้งไว้ต้องแตะทุกครั้งที่หน้าโหลดใหม่"
        style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 4000, cursor: 'pointer',
                 display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(20,16,6,0.94)',
                 border: '1px solid rgba(251,191,36,0.5)', borderRadius: 10, padding: '7px 11px',
                 fontSize: 11.5, fontWeight: 800, color: '#fbbf24', boxShadow: 'var(--shadow-lg)' }}>
        🔇 เสียงเตือนยังไม่พร้อม — แตะที่นี่ 1 ครั้ง
      </div>
    )
  }
  return (
    <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 4000, width: 'min(96vw, 620px)', display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {alerts.map(a => (
        <div key={a.id} className="dt-alarm-blink" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(20,10,10,0.96)', border: `2px solid ${color}`, borderRadius: 12, padding: '10px 14px', boxShadow: '0 6px 28px rgba(0,0,0,0.6)' }}>
          <span style={{ fontSize: 22 }}>{mode === 'call_mtn' ? '🔧' : '🚨'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>{label}</div>
            <div style={{ fontSize: 12, color: '#f0c9c2' }}>
              <b>{a.production_sessions?.line_name || '—'}</b> · {a.machine_no || 'ไม่ระบุเครื่อง'} · {a.dr_downtime_types?.name_th || 'Downtime'}
              {a.description ? ` — ${a.description}` : ''}
            </div>
          </div>
          {muted && (
            <span onClick={unlockNow}
              title="เบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ" style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: '#fbbf24', cursor: 'pointer' }}>
              🔇 แตะเพื่อเปิดเสียง
            </span>
          )}
          <button onClick={() => ack(a.id)} style={{ flexShrink: 0, background: color, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>รับทราบ · หยุดเสียง</button>
        </div>
      ))}
    </div>
  )
}
