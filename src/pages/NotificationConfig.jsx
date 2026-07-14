import { useState, useEffect, useMemo } from 'react'
import { supabase, supabaseDR } from '../supabaseClient'
import { toast } from '../components/Toast'

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
}
const monoStyle = { ...inputStyle, fontFamily: 'monospace' }

const CATEGORY_LABEL = {
  manpower: '🧑‍🏭 Manpower', production: '🏭 Production', quality: '🔍 Quality',
  maintenance: '🔧 Maintenance', pull: '🎴 Pull System', stock: '📦 Stock',
  logistic: '🚚 Logistic',
}

// Starting point shown when an admin first customizes a message. NULL template
// in the DB = the edge function keeps its rich built-in message.
const DEFAULT_TEMPLATES = {
  checkin_summary: '✅ เช็คชื่อเสร็จแล้ว\n🏭 ไลน์: {line_name} · {shift_label}\n📅 {work_date}\n👥 เข้างาน: {present}/{total} · OT {ot} · ลา {leave} · ขาด {absent}\n✍️ ตรวจโดย {checked_by}',
  downtime: '🚨 เครื่องจักร DOWNTIME\n⚙️ {machine_no} {machine_name}\n🏭 {line_name} · {shift_label} · 📅 {work_date}\n🛑 {type_name}\n⏱ {duration_min} นาที\n🔩 {mat_no}\n📝 {description}\n👤 {reported_by}',
  downtime_recovered: '✅ เครื่องกลับมารันได้แล้ว\n⚙️ {machine_no} {machine_name}\n🏭 {line_name} · {shift_label} · 📅 {work_date}\n⏱ หยุดรวม {duration_min} นาที\n👤 {reported_by}',
  downtime_call_mtn: '📞🔧 เรียกช่าง MTN เข้าหน้างานด่วน\n⚙️ {machine_no} {machine_name}\n🏭 {line_name} · {shift_label} · 📅 {work_date}\n🛑 {type_name}\n🕐 เริ่มหยุด {start_time}\n📝 {description}\n🙋 {reported_by}',
  downtime_open_15min: '🚨 เครื่องยังหยุด ยังไม่กลับมารัน — เกิน {open_min} นาที\n⚙️ {machine_no} {machine_name}\n🏭 {line_name} · {shift_label} · 📅 {work_date}\n🛑 {type_name}\n🕐 เริ่มหยุด {start_time}\n📝 {description}\n👤 {reported_by}',
  prod_close: '{title}\n🏭 {line_name} · {shift_label} · 📅 {work_date}\n📦 ผลิตรวม {total_qty} · ✅ {qty_ok} ❌ NG {qty_ng}\n📊 OEE {oee}%\n👤 {actor}',
  four_m_status: '🔔 {title}\n📅 {work_date} · 🏭 {line_name}\n📋 {category}\n📝 {description}\n🔖 {status_label}\n👤 {creator}',
  pm_daily_green: '🟢 ตรวจ Daily PM เรียบร้อย ทุกอย่างปกติ\n🏭 {line_name} · {shift_label}\n📅 {work_date}\n✅ ตรวจแล้ว {checked}/{total} เครื่อง',
  pm_daily_orange: '🟠 ยังตรวจ Daily PM ไม่ครบ (เกินเวลา)\n🏭 {line_name} · {shift_label}\n📅 {work_date}\n✅ ตรวจแล้ว {checked}/{total} · ⏳ ขาด: {missing}',
  pm_daily_red: '🔴 Daily PM พบความผิดปกติ\n🏭 {line_name} · {shift_label}\n📅 {work_date}\n⚠️ {ng}',
  edi_import: '📡 นำเข้า EDI {kind_label}\n🏭 Ship-to: {ship_tos}\n🧾 {rows} รายการ · 📄 {files} ไฟล์\n📅 {date_from} → {date_to}\n👤 {uploaded_by}',
  shipping_shipped: '🚚 ส่งงานลูกค้าแล้ว\n🕐 รอบ {ship_time} · 📅 {due_date}\n🏭 {customer} · Dock {dock_code}\n🔩 {mat_no} × {qty} ชิ้น\n👤 {shipped_by}',
  shipping_overdue: '🔴 รอบส่งเลยเวลา {count} รอบ — วันงาน {work_date}\n{items}',
  shipping_phase_alert: '🟠 หลุดเฟสงานส่ง {total} รายการ — วันงาน {work_date}\n{items}',
  morning_meeting: '🌅 สรุปประชุมแถวเช้า — {work_date}\n🏭 {scope_label}\n📦 ผลิตรวม {total_actual}/{total_target} ({achieve_pct}%)\n📊 OEE {oee_avg}% · ⏱️ DT {dt_total_min} นาที ({dt_count} ครั้ง) · ❌ NG {ng_total}\n📉 หลุดแผน {missed_count} รายการ\n{missed_list}\n📌 Action ค้าง {action_open}\n👤 {actor}',
}
const COMMON_PH = ['line_name', 'shift_label', 'work_date']
const PLACEHOLDERS = {
  checkin_summary: [...COMMON_PH, 'present', 'total', 'ot', 'leave', 'absent', 'checked_by', 'start_time'],
  downtime: [...COMMON_PH, 'machine_no', 'machine_name', 'type_name', 'duration_min', 'mat_no', 'description', 'reported_by', 'start_time', 'end_time'],
  downtime_recovered: [...COMMON_PH, 'machine_no', 'machine_name', 'type_name', 'duration_min', 'mat_no', 'description', 'reported_by', 'start_time', 'end_time'],
  downtime_call_mtn: [...COMMON_PH, 'machine_no', 'machine_name', 'type_name', 'description', 'reported_by', 'start_time'],
  downtime_open_15min: [...COMMON_PH, 'machine_no', 'machine_name', 'type_name', 'open_min', 'description', 'reported_by', 'start_time'],
  prod_close: [...COMMON_PH, 'title', 'total_qty', 'qty_ok', 'qty_ng', 'qty_suspect', 'qty_repair', 'oee', 'oee_a', 'oee_p', 'oee_q', 'start_time', 'end_time', 'shift_min', 'dt_count', 'dt_total_min', 'actor', 'requested_by'],
  four_m_status: [...COMMON_PH, 'title', 'category', 'description', 'status_label', 'creator', 'reject_reason'],
  pm_daily_green: [...COMMON_PH, 'checked', 'total'],
  pm_daily_orange: [...COMMON_PH, 'checked', 'total', 'missing'],
  pm_daily_red: [...COMMON_PH, 'checked', 'total', 'ng'],
  edi_import: ['kind_label', 'ship_tos', 'rows', 'files', 'date_from', 'date_to', 'unmatched', 'uploaded_by'],
  shipping_shipped: ['ship_time', 'due_date', 'customer', 'dock_code', 'mat_no', 'customer_part_no', 'part_name', 'qty', 'order_no', 'shipped_by'],
  shipping_overdue: ['work_date', 'count', 'items'],
  shipping_phase_alert: ['work_date', 'total', 'items'],
  morning_meeting: ['work_date', 'scope_label', 'total_actual', 'total_target', 'achieve_pct', 'oee_avg', 'dt_total_min', 'dt_count', 'ng_total', 'dt_top', 'missed_count', 'missed_list', 'action_open', 'actor'],
}
// sample values for the live preview only (not sent anywhere)
const SAMPLE = {
  line_name: 'HDF1', shift_label: 'กะเช้า', work_date: '2026-07-09', present: 18, total: 20,
  ot: 3, leave: 1, absent: 1, checked_by: 'สมชาย', start_time: '08:00', end_time: '08:25',
  machine_no: 'M-01', machine_name: '(Press 500T)', type_name: 'ไฟดับ', duration_min: 25,
  mat_no: 'PN-123', description: 'มอเตอร์ร้อนผิดปกติ', reported_by: 'สมหญิง', open_min: 22,
  title: '✅ ปิดกะสำเร็จ', total_qty: 1200, qty_ok: 1180, qty_ng: 20, qty_suspect: 0, qty_repair: 5,
  oee: 87, oee_a: 95, oee_p: 92, oee_q: 98, shift_min: 600, dt_count: 2, dt_total_min: 40,
  actor: 'สมชาย', requested_by: 'สมศักดิ์', category: 'Man', status_label: 'Approved ✅',
  creator: 'สมปอง', reject_reason: '-', checked: 8, missing: 'M-03, M-05', ng: 'M-02 — Press: น็อตหลวม',
  kind_label: '862 Shipping Schedule (รอบส่งงาน)', ship_tos: 'GRBNA, GBL9A', rows: 538, files: 6,
  date_from: '2026-07-06', date_to: '2026-07-18', unmatched: 2, uploaded_by: 'Sale A',
  ship_time: '09:00', due_date: '2026-07-09', customer: 'AAT (GRBNA)', dock_code: 'B5',
  customer_part_no: 'RB3B 16E060 BA', qty: 50, order_no: 'SGUCHF', shipped_by: 'Logistic B',
  count: 3, items: '08:00 · AAT · 10106790 × 50\n09:00 · AAT · 10100401 × 50',
  scope_label: 'PD3', total_actual: 2140, total_target: 2400, achieve_pct: 89, oee_avg: 84,
  ng_total: 32, dt_top: 'รอวัตถุดิบ 45น. · เปลี่ยน Die 20น.', missed_count: 2,
  missed_list: '• Line 60 · REINF FRT SD BDY: 270/360 (ขาด 90)', action_open: 3,
}
const renderPreview = (t) => String(t ?? '').replace(/\{(\w+)\}/g, (_m, k) => (SAMPLE[k] != null ? String(SAMPLE[k]) : ''))

export default function NotificationConfig() {
  const [rooms, setRooms] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [newRoom, setNewRoom] = useState({ name: '', chat_id: '' })
  const [tokenStatus, setTokenStatus] = useState({ is_set: false, last4: null })
  const [tokenInput, setTokenInput] = useState('')
  const [editingTpl, setEditingTpl] = useState(null) // event_key being edited
  const [tplDraft, setTplDraft] = useState('')
  const [openMin, setOpenMin] = useState('15')      // เกณฑ์ "เปิดค้างเกินกี่นาทีถึงแจ้ง" (dt_alert_config — DR project)

  const load = async () => {
    setLoading(true)
    // dt_alert_config อยู่ฝั่ง DR (supabaseDR = anon เสมอ) — แยก client จากตารางแจ้งเตือนฝั่ง Main
    const [{ data: rm }, { data: rl }, { data: ts }, { data: dcfg }] = await Promise.all([
      supabase.from('telegram_channels').select('*').order('sort_order'),
      supabase.from('notification_rules').select('*').order('sort_order'),
      supabase.rpc('bot_token_status'),
      supabaseDR.from('dt_alert_config').select('open_alert_min').eq('id', 1).maybeSingle(),
    ])
    setRooms(rm ?? [])
    setRules(rl ?? [])
    if (ts) setTokenStatus(ts)
    if (dcfg?.open_alert_min != null) setOpenMin(String(dcfg.open_alert_min))
    setLoading(false)
  }

  const saveOpenMin = async () => {
    const n = Math.round(Number(openMin))
    if (!Number.isFinite(n) || n < 1) return toast.error('ใส่จำนวนนาที (อย่างน้อย 1)')
    setBusy('openmin')
    const { error } = await supabaseDR.from('dt_alert_config')
      .upsert({ id: 1, open_alert_min: n, updated_at: new Date().toISOString() })
    setBusy(null)
    if (error) return toast.error(error.message)
    setOpenMin(String(n))
    toast.success(`ตั้งเกณฑ์แจ้งเตือนเครื่องเปิดค้าง = ${n} นาที`)
  }

  const saveToken = async () => {
    if (!tokenInput.trim()) return toast.error('วาง token ก่อน')
    setBusy('token')
    const { error } = await supabase.rpc('set_bot_token', { p_token: tokenInput.trim() })
    setBusy(null)
    if (error) return toast.error(error.message)
    setTokenInput('')
    const { data: ts } = await supabase.rpc('bot_token_status')
    if (ts) setTokenStatus(ts)
    toast.success('บันทึก Bot Token แล้ว')
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
  useEffect(() => { load() }, [])

  const rulesByCat = useMemo(() => {
    const m = {}
    rules.forEach(r => { (m[r.category] ||= []).push(r) })
    return m
  }, [rules])

  /* ── rooms ── */
  const patchRoom = (id, key, val) => setRooms(prev => prev.map(r => r.id === id ? { ...r, [key]: val } : r))

  const saveRoom = async (room) => {
    if (!room.name.trim()) return toast.error('ใส่ชื่อห้อง')
    setBusy(room.id)
    const { error } = await supabase.from('telegram_channels')
      .update({ name: room.name.trim(), chat_id: room.chat_id?.trim() || null, is_active: room.is_active })
      .eq('id', room.id)
    setBusy(null)
    if (error) return toast.error(error.message)
    toast.success('บันทึกห้องแล้ว')
  }

  const addRoom = async () => {
    if (!newRoom.name.trim()) return toast.error('ใส่ชื่อห้อง')
    setBusy('new')
    const { data, error } = await supabase.from('telegram_channels')
      .insert({ name: newRoom.name.trim(), chat_id: newRoom.chat_id.trim() || null, sort_order: rooms.length + 1 })
      .select().single()
    setBusy(null)
    if (error) return toast.error(error.message)
    setRooms(prev => [...prev, data])
    setNewRoom({ name: '', chat_id: '' })
    toast.success('เพิ่มห้องแล้ว')
  }

  const deleteRoom = async (room) => {
    if (!window.confirm(`ลบห้อง "${room.name}" ?\n\nรายการแจ้งเตือนที่ชี้ห้องนี้จะกลายเป็น "ไม่ส่ง" จนกว่าจะเลือกห้องใหม่`)) return
    const { error } = await supabase.from('telegram_channels').delete().eq('id', room.id)
    if (error) return toast.error(error.message)
    setRooms(prev => prev.filter(r => r.id !== room.id))
    setRules(prev => prev.map(r => r.channel_id === room.id ? { ...r, channel_id: null } : r))
    toast.success('ลบห้องแล้ว')
  }

  const testRoom = async (room) => {
    if (!room.chat_id?.trim()) return toast.error('ใส่ chat_id ก่อนทดสอบ')
    setBusy(`test-${room.id}`)
    try {
      const { data, error } = await supabase.functions.invoke('send-notification', {
        body: { event: 'test_channel', chat_id: room.chat_id.trim() },
      })
      if (error) throw error
      if (data?.sent) toast.success(`ส่งทดสอบไป "${room.name}" แล้ว — เช็คในกลุ่ม`)
      else toast.error(data?.reason || 'ส่งไม่สำเร็จ — ตรวจ chat_id / บอทอยู่ในกลุ่มหรือยัง')
    } catch (err) {
      toast.error(err.message || 'ส่งไม่สำเร็จ')
    } finally { setBusy(null) }
  }

  /* ── rules (auto-save on change) ── */
  const updateRule = async (event_key, patch) => {
    setRules(prev => prev.map(r => r.event_key === event_key ? { ...r, ...patch } : r))
    const { error } = await supabase.from('notification_rules')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('event_key', event_key)
    if (error) { toast.error(error.message); load() }
  }
  // toggle a room in/out of a rule's channel_ids (one event → many rooms)
  const toggleRuleRoom = (rule, roomId) => {
    const cur = Array.isArray(rule.channel_ids) ? rule.channel_ids : []
    const next = cur.includes(roomId) ? cur.filter(id => id !== roomId) : [...cur, roomId]
    updateRule(rule.event_key, { channel_ids: next })
  }

  /* ── template editor ── */
  const startEditTpl = (rule) => {
    setEditingTpl(rule.event_key)
    setTplDraft(rule.template ?? DEFAULT_TEMPLATES[rule.event_key] ?? '')
  }
  const saveTpl = async (rule) => {
    const val = tplDraft.trim() ? tplDraft : null
    await updateRule(rule.event_key, { template: val })
    setEditingTpl(null)
    toast.success(val ? 'บันทึกข้อความแล้ว' : 'กลับไปใช้ข้อความมาตรฐานของระบบ')
  }
  const resetTpl = async (rule) => {
    await updateRule(rule.event_key, { template: null })
    setEditingTpl(null)
    toast.info('กลับไปใช้ข้อความมาตรฐานของระบบ')
  }
  const insertPh = (ph) => setTplDraft(d => `${d}${d && !d.endsWith(' ') && !d.endsWith('\n') ? ' ' : ''}{${ph}}`)

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(96vw, 920px)', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
        🔔 ตั้งค่าระบบแจ้งเตือน (Telegram)
      </h1>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, marginBottom: 22 }}>
        1 บอทยิงได้หลายห้อง · สร้าง/ลบห้องได้เอง · เลือกได้ว่าเรื่องไหนเข้าห้องไหน · ห้องที่ยังไม่ใส่ chat_id จะไปเข้ากลุ่มเดิม (fallback)
      </div>

      {/* ── Bot token ── */}
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>Bot Token</div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 26, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: tokenStatus.is_set ? 'var(--accent)' : 'var(--accent2)', minWidth: 150 }}>
          {tokenStatus.is_set ? `✅ ตั้งค่าแล้ว (••••${tokenStatus.last4 ?? ''})` : '⚠️ ยังไม่ได้ตั้ง token'}
        </div>
        <input
          type="password" autoComplete="off"
          value={tokenInput} onChange={e => setTokenInput(e.target.value)}
          placeholder={tokenStatus.is_set ? 'วาง token ใหม่เพื่อเปลี่ยน' : 'วาง token จาก @BotFather'}
          style={{ ...monoStyle, flex: 1, minWidth: 220 }}
        />
        <button onClick={saveToken} disabled={busy === 'token'} style={{ background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {busy === 'token' ? 'บันทึก...' : 'บันทึก Token'}
        </button>
        <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--muted)' }}>
          🔒 token เก็บแบบเข้ารหัสฝั่ง server — บันทึกแล้วดูย้อนหลังไม่ได้ (โชว์แค่ 4 ตัวท้าย) · ถ้าไม่ตั้งที่นี่ ระบบใช้ token เดิมที่ตั้งไว้ในระบบ
        </div>
      </div>

      {/* ── Downtime open-alert threshold ── */}
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>เครื่องเปิดค้าง — เกณฑ์แจ้งเตือน</div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 26, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
          แจ้งเตือนเมื่อ Downtime เปิดค้าง (ยังไม่ปิดรายการ) เกิน
        </div>
        <input
          type="number" min={1} inputMode="numeric"
          value={openMin} onChange={e => setOpenMin(e.target.value)}
          style={{ width: 90, textAlign: 'center', fontSize: 14, fontWeight: 700, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }}
        />
        <div style={{ fontSize: 12.5, color: 'var(--text)' }}>นาที</div>
        <button onClick={saveOpenMin} disabled={busy === 'openmin'} style={{ background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {busy === 'openmin' ? 'บันทึก...' : 'บันทึก'}
        </button>
        <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--muted)' }}>
          บันทึก Downtime ใหม่จะ<b>ไม่แจ้งทันที</b> (ปิดรายการแล้ว→สรุปตอนปิดกะ) · ถ้ายังเปิดค้างนานเกินเวลานี้ ระบบจะส่งเข้า Telegram + เตือนเสียงหน้า Production · ปุ่ม “เรียกช่าง MTN” ในหน้า Daily Report แจ้งทันทีเสมอ (เตือนเสียงหน้า Maintenance)
        </div>
      </div>

      {/* ── Rooms ── */}
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>ห้องแจ้งเตือน</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {rooms.map(room => (
          <div key={room.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input value={room.name} onChange={e => patchRoom(room.id, 'name', e.target.value)} placeholder="ชื่อห้อง" style={{ ...inputStyle, width: 200, flex: '0 0 auto' }} />
            <input value={room.chat_id ?? ''} onChange={e => patchRoom(room.id, 'chat_id', e.target.value)} placeholder="chat_id เช่น -1001234567890" style={{ ...monoStyle, flex: 1, minWidth: 170, borderColor: (room.chat_id ?? '').trim() ? undefined : 'var(--accent2)' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={room.is_active} onChange={e => patchRoom(room.id, 'is_active', e.target.checked)} />เปิด
            </label>
            <button onClick={() => saveRoom(room)} disabled={busy === room.id} style={{ background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>บันทึก</button>
            <button onClick={() => testRoom(room)} disabled={busy === `test-${room.id}`} style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>📤 ทดสอบ</button>
            <button onClick={() => deleteRoom(room)} style={{ background: 'transparent', color: '#e05c4a', border: '1px solid rgba(224,92,74,0.4)', borderRadius: 8, padding: '8px 10px', fontSize: 12, cursor: 'pointer' }}>ลบ</button>
            {!(room.chat_id ?? '').trim() && (
              <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--accent2)' }}>
                ⚠️ ยังไม่ใส่ chat_id — รายการที่เลือกห้องนี้จะไปเข้า<b>กลุ่มเดิม (fallback)</b> ไม่ใช่ห้องนี้
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 26, flexWrap: 'wrap' }}>
        <input value={newRoom.name} onChange={e => setNewRoom(n => ({ ...n, name: e.target.value }))} placeholder="+ ชื่อห้องใหม่" style={{ ...inputStyle, width: 200 }} />
        <input value={newRoom.chat_id} onChange={e => setNewRoom(n => ({ ...n, chat_id: e.target.value }))} placeholder="chat_id (ใส่ทีหลังได้)" style={{ ...monoStyle, flex: 1, minWidth: 170 }} />
        <button onClick={addRoom} disabled={busy === 'new'} style={{ background: 'var(--accent2)', color: '#071008', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ เพิ่มห้อง</button>
      </div>

      {/* ── Rules ── */}
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>รายการแจ้งเตือน — เลือกว่าเรื่องไหนเข้าห้องไหน</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>กดเลือกห้องได้ <b>หลายห้อง</b> ต่อหนึ่งเรื่อง · ไม่เลือกห้องเลย = เข้ากลุ่มเดิม (fallback)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {Object.entries(rulesByCat).map(([cat, catRules]) => (
          <div key={cat}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{CATEGORY_LABEL[cat] ?? cat}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {catRules.map(rule => {
                const selected = Array.isArray(rule.channel_ids) ? rule.channel_ids : []
                const selectedRooms = rooms.filter(r => selected.includes(r.id))
                const allSelectedMissChat = selectedRooms.length > 0 && selectedRooms.every(r => !(r.chat_id ?? '').trim())
                return (
                <div key={rule.event_key} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: '10px 14px', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: '1 1 200px', minWidth: 150 }}>
                    <input type="checkbox" checked={rule.is_enabled} onChange={e => updateRule(rule.event_key, { is_enabled: e.target.checked })} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: rule.is_enabled ? 'var(--text)' : 'var(--muted)' }}>{rule.label}</span>
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', flex: '1 1 300px', minWidth: 0, opacity: rule.is_enabled ? 1 : 0.5 }}>
                    {rooms.map(room => {
                      const on = selected.includes(room.id)
                      const noChat = !(room.chat_id ?? '').trim()
                      return (
                        <label key={room.id} title={noChat ? 'ห้องนี้ยังไม่มี chat_id' : ''}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: rule.is_enabled ? 'pointer' : 'default',
                            background: on ? 'var(--bg2)' : 'transparent', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                            color: on ? 'var(--text)' : 'var(--muted)', borderRadius: 999, padding: '4px 10px', userSelect: 'none' }}>
                          <input type="checkbox" checked={on} disabled={!rule.is_enabled} onChange={() => toggleRuleRoom(rule, room.id)} style={{ flexShrink: 0 }} />
                          {room.name}{on && noChat ? ' ⚠️' : ''}
                        </label>
                      )
                    })}
                  </div>
                  {rule.is_enabled && selected.length === 0 && (
                    <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--muted)' }}>
                      ยังไม่เลือกห้อง → จะไปเข้า<b>กลุ่มเดิม (fallback)</b>
                    </div>
                  )}
                  {rule.is_enabled && allSelectedMissChat && (
                    <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--accent2)' }}>
                      ⚠️ ห้องที่เลือกยังไม่ใส่ chat_id → ตอนนี้จะไปเข้า<b>กลุ่มเดิม</b> ไม่ใช่ห้องนี้ (ไปเติม chat_id ที่ส่วน “ห้องแจ้งเตือน” ด้านบน)
                    </div>
                  )}

                  {/* ── message template editor ── */}
                  <div style={{ flexBasis: '100%', borderTop: '1px dashed var(--border)', paddingTop: 8, marginTop: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => editingTpl === rule.event_key ? setEditingTpl(null) : startEditTpl(rule)}
                        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                        ✏️ {editingTpl === rule.event_key ? 'ปิดตัวแก้ข้อความ' : 'ปรับข้อความ'}
                      </button>
                      <span style={{ fontSize: 11, color: rule.template ? 'var(--accent)' : 'var(--muted)' }}>
                        {rule.template ? '● ใช้ข้อความที่กำหนดเอง' : '○ ใช้ข้อความมาตรฐานของระบบ'}
                      </span>
                    </div>

                    {editingTpl === rule.event_key && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          คลิกตัวแปรเพื่อแทรก · รองรับ HTML tag ของ Telegram: <code>&lt;b&gt;ตัวหนา&lt;/b&gt;</code>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {(PLACEHOLDERS[rule.event_key] ?? []).map(ph => (
                            <button key={ph} onClick={() => insertPh(ph)}
                              style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 6, padding: '2px 7px', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer' }}>
                              {`{${ph}}`}
                            </button>
                          ))}
                        </div>
                        <textarea value={tplDraft} onChange={e => setTplDraft(e.target.value)} rows={6}
                          placeholder="พิมพ์ข้อความ… เว้นว่าง = กลับไปใช้ข้อความมาตรฐาน"
                          style={{ ...inputStyle, fontFamily: 'monospace', lineHeight: 1.5, resize: 'vertical' }} />
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ตัวอย่าง (ข้อมูลสมมติ):</div>
                          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                            dangerouslySetInnerHTML={{ __html: renderPreview(tplDraft) || '<span style="color:var(--muted)">— ว่าง (จะใช้ข้อความมาตรฐาน) —</span>' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={() => saveTpl(rule)}
                            style={{ background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>บันทึกข้อความ</button>
                          <button onClick={() => setTplDraft(DEFAULT_TEMPLATES[rule.event_key] ?? '')}
                            style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>โหลดแบบเริ่มต้น</button>
                          <button onClick={() => resetTpl(rule)}
                            style={{ background: 'transparent', color: '#e05c4a', border: '1px solid rgba(224,92,74,0.4)', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>ใช้ข้อความมาตรฐาน</button>
                          <button onClick={() => setEditingTpl(null)}
                            style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>ยกเลิก</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>วิธีเอา chat_id ของกลุ่ม</div>
        1. สร้างบอทที่ <b>@BotFather</b> → <code>/newbot</code> (บอทตัวเดียวใช้ได้ทุกห้อง — token เก็บเป็น secret ในระบบ)<br />
        2. สร้างกลุ่มแต่ละเรื่อง แล้ว <b>add บอท</b> เข้ากลุ่ม (เป็นสมาชิกก็พอ)<br />
        3. add <b>@getidsbot</b> เข้ากลุ่มชั่วคราว → บอก <code>Group ID: -100…</code> → copy ใส่ช่อง chat_id → บันทึก → ทดสอบ
      </div>
    </div>
  )
}
