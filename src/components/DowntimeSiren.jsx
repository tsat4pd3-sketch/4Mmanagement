import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabaseDR } from '../supabaseClient'
import { visibleInterval } from '../utils/usePolling'
import { RATE, LIVE } from '../utils/refreshRates'
import { coalesce, makeIdleGate } from '../utils/liveRefresh'
import { isAlarmingDT, isOverDtThreshold, loadDtAlertMin, DT_OPEN_ALERT_MIN_DEFAULT } from '../utils/downtimeAlarm'
import { liveChannel } from '../utils/liveChannel'
import { checkWriteRows } from '../utils/dbWrite';
/* 🔊 เครื่องเสียง = ของกลาง `utils/useSiren.js` (แยกออกมา 24/10 ตอนทำไซเรนฝั่งสโตร์)
   ⚠️ กฎเหล็กของเครื่องเสียง (สร้าง AudioContext ตั้งแต่ mount · ปลดล็อก pointer+key ·
      รายงาน muted ตามจริง) ย้ายไปอยู่หัวไฟล์นั้น — อ่านก่อนแก้ ห้ามก๊อปกลับมาที่นี่ */
import useSiren, { SIREN_PATTERN_ALARM } from '../utils/useSiren';
/* ทีมที่ถูกเรียกเก็บเป็น key — แปลงเป็นชื่อผ่านของกลางเท่านั้น (utils/mtnTeams.js) */
import { teamKeyOf, deptNameOf } from '../utils/mtnTeams'

/* เสียง+แถบเตือน downtime บนเว็บ — แยกตามหน้า (คำสั่ง user 2026-07-14):
     mode='call_mtn'   → ดังหน้า Maintenance (มีคนกดปุ่ม "เรียกช่าง")
     mode='open_15min' → ดังหน้า Production  (เครื่องเปิดค้างเกินเกณฑ์นาที · scanner mark open_alerted_at)
     mode='all'        → ดังทั้งสองแบบในจอเดียว (ห้องที่นั่งรวมกัน เช่นออฟฟิศที่มีทั้ง ผจก.ผลิต + ช่าง JIG
                         · user 2026-08-27) — ป้าย/สี/ปุ่มรับทราบ แยกตามชนิดของแต่ละแถว

   ⚠️⚠️ ห้าม mount 2 ตัวเพื่อให้ได้เสียงทั้งสองแบบ — ทั้งแถบเตือนและชิป standby เป็น `position:fixed`
   ตำแหน่งเดียวกัน จะทับกันสนิท (เห็นอันเดียว) + เสียง 2 ลูปซ้อนกัน + ยิง DB 2 ชุด
   → ใช้ mode='all' ซึ่งรวมอยู่ใน component เดียว (query เดียว แถบเดียว ลูปเสียงเดียว)

   เสียงสร้างด้วย Web Audio (ไม่ต้องมีไฟล์) วนจนกด "รับทราบ" (set *_ack_at) แล้วดับ

   ⚠️⚠️ กฎเหล็ก — จอที่ "เปิดทิ้งไว้เฉยๆ" ต้องรู้ตัวว่าเสียงยังไม่พร้อม **ก่อน**เกิดเหตุ
   เบราว์เซอร์บล็อก autoplay จนกว่าจะมี user gesture → AudioContext เริ่มที่ state 'suspended'
   เดิมสร้าง AudioContext ตอนมี alert แล้วค่อยโชว์ "🔇 แตะเพื่อเปิดเสียง" **ในแถบ alert**
   ⇒ จอห้องช่างที่รีบูตกลางคืน (ไฟดับ/deploy ใหม่/เบราว์เซอร์ restart) จะไม่มีอะไรบอกเลย
      จนกระทั่งเครื่องหยุดจริง — แล้ว**เสียงแรกที่ควรดังที่สุดกลับเงียบ**
   → ตอนนี้สร้าง AudioContext ตั้งแต่ mount (suspended = ถูกต้อง ไม่เปลือง) + ฟัง statechange
     แล้วโชว์ชิปเล็กๆ สงบๆ ตลอดเวลาที่เสียงยังล็อก **แม้ยังไม่มี alert**
   ⚠️ ชิปนี้ **ห้ามกระพริบ/ห้ามใช้สีแดง** — เป็นสถานะความพร้อม ไม่ใช่ alarm (UI-CONVENTIONS §2) */
/* `team` = ทีมของ "ห้องนี้" (ชิป `?team=` บนบอร์ด Andon) — ใช้กรองเฉพาะเสียง "เรียกช่าง"
   🔴 กรองได้เฉพาะแกน "ใครไปซ่อม" เท่านั้น — เสียง "เครื่องหยุดเกินเกณฑ์" เป็นข้อเท็จจริงของ
      ฝ่ายผลิต **ห้ามกรองทีมเด็ดขาด** (กฎเดียวกับ MtnAndonBoard §ตัวกรองทีมห้ามกรองเครื่องหยุด)
   🔴 ใบที่ **ไม่ได้ระบุทีม = ดังทุกห้อง** (fail-open) — เงียบเพราะข้อมูลไม่ครบ คือความเสี่ยงที่
      แย่กว่าดังเกิน · ห้ามเปลี่ยนเป็น fail-closed */
export default function DowntimeSiren({ mode = 'open_15min', team = null }) {
  const [raw, setRaw] = useState([])       // แถวดิบที่ยังไม่รับทราบ (กะเปิดอยู่)
  const [thr, setThr] = useState(null)     // เกณฑ์นาที (dt_alert_config)
  const [loadErr, setLoadErr] = useState(false) // อ่านรายการเครื่องหยุดไม่ได้ — ห้ามเงียบ (จอ TV ไม่มีใครเฝ้า)
  const [, setTick] = useState(0)          // นาฬิกา — ให้ "ครบเกณฑ์" เกิดเองโดยไม่ต้องยิง DB

  /* ชนิดของแต่ละแถว — โหมด 'all' มีได้ทั้ง 2 ชนิดพร้อมกัน จึงตัดสินรายแถว ไม่ใช่ราย component
     "เรียกช่างแล้วยังไม่รับทราบ" ชนะเสมอ (ด่วนกว่า + ปุ่มรับทราบต้องไปลงช่องที่ถูก) */
  const kindOf = (d) => (d.call_mtn && !d.call_mtn_ack_at ? 'call' : 'open')
  const META = {
    call: { ackField: 'call_mtn_ack_at', label: '📞 เรียกช่าง MTN เข้าหน้างาน', color: '#e05c4a', icon: '🔧' },  // ป้ายจริงเติมชื่อทีมใน metaOf
    open: { ackField: 'open_ack_at',     label: '🚨 เครื่องหยุดเกินกำหนด',      color: '#f59a3f', icon: '🚨' },
  }
  /* 🔴 แถบเตือน "เรียกช่าง" ต้องบอกทีมที่ถูกเรียก (06/10 · ทีม MTN: "จะรู้ได้ยังไงว่าเค้าเรียกเรา")
     ไม่ระบุทีม = เขียนตรงๆ ว่าไม่ระบุ ห้ามเดาให้ */
  const metaOf = (d) => {
    const m = META[mode === 'call_mtn' ? 'call' : mode === 'open_15min' ? 'open' : kindOf(d)]
    if (m !== META.call) return m
    const ct = teamKeyOf(d?.call_mtn_team)
    return { ...m, label: ct ? `📞 เรียก ${deptNameOf(ct)} เข้าหน้างาน` : '📞 เรียกช่าง MTN เข้าหน้างาน (ไม่ระบุทีม)' }
  }

  const fetchAlerts = useCallback(async () => {
    let q = supabaseDR.from('downtime_logs')
      .select('id, machine_no, description, started_at, call_mtn, call_mtn_at, call_mtn_ack_at, call_mtn_team, open_alerted_at, open_ack_at, dr_downtime_types(name_th, category), production_sessions(line_name, status)')
      .is('duration_min', null).is('ended_at', null)
    // โหมด 'all' กรอง ack รายแถวตอนจัดชนิด (แถวเดียวมี 2 ช่อง ack) — downtime ที่เปิดค้างพร้อมกันมีไม่กี่แถว
    if (mode === 'call_mtn') q = q.eq('call_mtn', true).is('call_mtn_ack_at', null)
    else if (mode === 'open_15min') q = q.is('open_ack_at', null)
    const { data, error } = await q
    loadDtAlertMin().then(setThr)
    /* 🔴 โหลดไม่สำเร็จ ≠ "ไม่มีเครื่องหยุด" — ห้ามล้างลิสต์ทิ้ง
       เดิมรับแค่ `data` → query ล้ม (RLS/คอลัมน์เปลี่ยน/เน็ตสะดุด) = `setRaw([])`
       → alerts ว่าง → clearInterval → **ไซเรนหยุดดัง + แถบเตือนหายทั้งอัน** โดยไม่มีสัญญาณอะไรเลย
       และ poll ถัดไปคือ 15 นาที ถ้าล้มถาวรก็เงียบตลอดกาล ซึ่งขัดกับหน้าที่เดียวของ component นี้
       → คงลิสต์เดิมไว้ (ของที่ยังหยุดอยู่ก็ยังหยุดอยู่) + ตั้งธงให้จอบอกว่ากำลังอ่านไม่ได้ */
    if (error) { console.error('[DowntimeSiren] โหลดรายการเครื่องหยุดไม่สำเร็จ:', error); setLoadErr(true); return }
    setLoadErr(false)
    // เอาเฉพาะรายการของกะที่ยังเปิดอยู่ (เครื่องยังหยุดจริง)
    setRaw((data || []).filter(d => ['open', 'pending_close'].includes(d.production_sessions?.status)))
  }, [mode])

  /* 🔴 open_15min: ตัดสิน "เกินเกณฑ์" จาก **เวลาที่ผ่านไปจริง** ไม่ใช่ธง `open_alerted_at`
     (ธงนั้นคือตัวกันแจ้ง Telegram ซ้ำ — edge `downtime-open-scan` stamp ให้เฉพาะตอน POST สำเร็จ
      ⇒ Telegram ล่ม/ปิด rule = ธงไม่ถูกตั้ง → **ไซเรนบนจอไม่เคยดังเลย** · เจอจริง 2026-08-26)
     ⚠️ ต้องกรอง planned เองด้วย — เดิมพึ่งว่า scanner stamp เฉพาะนอกแผน
     ⚠️ คำนวณใหม่ทุกนาทีจากข้อมูลที่โหลดมาแล้ว (ไม่ยิง DB) — ไม่งั้นต้องรอรอบ poll ถัดไปถึงจะดัง */
  /* ใบ "เรียกช่าง" ใบนี้เป็นของห้องนี้ไหม — ไม่เลือกทีม หรือใบไม่ระบุทีม = ใช่เสมอ */
  const myCall = useCallback((d) => {
    const want = teamKeyOf(team); if (!want) return true
    const got = teamKeyOf(d?.call_mtn_team); if (!got) return true   // ไม่ระบุ = ดังทุกห้อง
    return got === want
  }, [team])

  const alerts = useMemo(() => {
    const overThr = (d) => isAlarmingDT(d) && isOverDtThreshold(d, thr ?? DT_OPEN_ALERT_MIN_DEFAULT)
    if (mode === 'call_mtn') return raw.filter(myCall)
    if (mode === 'open_15min') return raw.filter(overThr)
    // 'all' = เรียกช่างที่ยังไม่รับทราบ ∪ เครื่องหยุดเกินเกณฑ์ที่ยังไม่รับทราบ (แถวเดียวนับครั้งเดียว)
    //   ⚠️ ขาซ้ายกรองทีมได้ · ขาขวา (เครื่องหยุดเกินเกณฑ์) ห้ามกรอง — คนละแกนกัน
    return raw.filter(d => (d.call_mtn && !d.call_mtn_ack_at && myCall(d)) || (overThr(d) && !d.open_ack_at))
  }, [raw, mode, thr, myCall])

  useEffect(() => {
    fetchAlerts()
    /* 🔴 2026-09-15 — poll ตัวนี้เป็นแค่ "กันเหนียวเผื่อ realtime หลุด"
       idleGate: tick ที่ไม่มีอะไรเปลี่ยน = ไม่มี network เลยสักไบต์ (ดู src/utils/liveRefresh.js) */
    const g = makeIdleGate(LIVE.FLOOR)
    const stopPoll = visibleInterval(() => { if (g.shouldRun()) { g.loaded(); fetchAlerts() } }, RATE.BACKUP)
    // 🔴 2026-09-15 — เดิม `setTimeout(fetchAlerts, 400)` ต่อ event = ไม่ใช่ debounce
    //    (N event = โหลด N รอบ) → coalesce(LIVE.ALARM) ไวพอสำหรับไซเรน แต่มีเพดาน
    //    ⚠️ ไซเรน "ดัง" ไม่ได้พึ่งรอบนี้อย่างเดียว — เกณฑ์จริงคือ 15 นาที (dt_alert_config)
    const bump = coalesce(() => { g.loaded(); return fetchAlerts() }, LIVE.ALARM)
    const ch = liveChannel(supabaseDR, `dt-siren-${mode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' }, () => { g.touch(); bump() })
      .subscribe((st) => { if (st === 'SUBSCRIBED') g.touch() })
    // นาฬิกาอย่างเดียว ไม่ยิง DB — ให้รายการที่ "ครบเกณฑ์ระหว่างเปิดจออยู่" ดังเองภายใน 1 นาที
    const clk = setInterval(() => setTick(t => t + 1), 60000)
    return () => { stopPoll(); bump.cancel(); supabaseDR.removeChannel(ch); clearInterval(clk) }
  }, [mode, fetchAlerts])

  /* 🔊 เสียง + สถานะ "เบราว์เซอร์บล็อกเสียงอยู่ไหม" = ของกลาง (ลายเสียงเดิม: คู่โน้ตตก 880→660) */
  const { muted, unlockNow } = useSiren(alerts.length > 0, { pattern: SIREN_PATTERN_ALARM })

  const ack = async (a) => {
    setRaw(prev => prev.filter(x => x.id !== a.id))
    /* นับแถว — แถบ alert ถูกถอดจากจอไปแล้วบรรทัดบน ถ้าเขียนไม่ติดเสียงจะกลับมาดังรอบหน้า
       โดยที่คนกดคิดว่ารับทราบแล้ว (กฎเขียน DB ข้อ 2) */
    checkWriteRows(await supabaseDR.from('downtime_logs').update({ [metaOf(a).ackField]: new Date().toISOString() }).eq('id', a.id).select('id'), 'บันทึกรับทราบเสียงเตือน');
  }

  /* ยังไม่มีเหตุ แต่เสียงล็อกอยู่ = ต้องบอกตั้งแต่ตอนนี้ (จอห้องช่างที่เปิดทิ้งไว้)
     ชิปเล็ก มุมล่างขวา สีเหลืองนิ่ง ไม่กระพริบ — เป็นสถานะความพร้อม ไม่ใช่ alarm */
  if (!alerts.length) {
    /* อ่านรายการไม่ได้ ต้องขึ้นให้เห็น — "เงียบ" กับ "ไม่มีเครื่องหยุด" หน้าตาเหมือนกันจากข้างนอก
       จอ TV ไม่มีใครเฝ้า ถ้าไม่บอกก็จะเข้าใจว่าทุกอย่างปกติดี */
    if (loadErr) return (
      <div style={{ position: 'fixed', bottom: 'calc(12px + var(--mnav-h, 0px))', right: 12, zIndex: 4000,
                    display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(28,10,10,0.95)',
                    border: '1px solid rgba(239,68,68,0.6)', borderRadius: 10, padding: '7px 11px',
                    fontSize: 11.5, fontWeight: 800, color: '#f87171', boxShadow: 'var(--shadow-lg)' }}>
        ⚠️ อ่านรายการเครื่องหยุดไม่ได้ — ยังบอกไม่ได้ว่ามีเครื่องหยุดหรือไม่
      </div>
    )
    if (!muted) return null
    return (
      <div onClick={unlockNow} title="เบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ 1 ครั้ง — จอที่เปิดทิ้งไว้ต้องแตะทุกครั้งที่หน้าโหลดใหม่"
        style={{ position: 'fixed', bottom: 'calc(12px + var(--mnav-h, 0px))', right: 12, zIndex: 4000, cursor: 'pointer',
                 display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(20,16,6,0.94)',
                 border: '1px solid rgba(251,191,36,0.5)', borderRadius: 10, padding: '7px 11px',
                 fontSize: 11.5, fontWeight: 800, color: '#fbbf24', boxShadow: 'var(--shadow-lg)' }}>
        🔇 เสียงเตือนยังไม่พร้อม — แตะที่นี่ 1 ครั้ง
      </div>
    )
  }
  return (
    <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 4000, width: 'min(96vw, 620px)', display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {alerts.map(a => {
        const m = metaOf(a)
        return (
        <div key={a.id} className="dt-alarm-blink" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(20,10,10,0.96)', border: `2px solid ${m.color}`, borderRadius: 12, padding: '10px 14px', boxShadow: 'var(--shadow-float)' }}>
          <span style={{ fontSize: 22 }}>{m.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>{m.label}</div>
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
          <button onClick={() => ack(a)} style={{ flexShrink: 0, background: m.color, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>รับทราบ · หยุดเสียง</button>
        </div>
        )
      })}
    </div>
  )
}
