import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { toast } from '../components/Toast'

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
}
const monoStyle = { ...inputStyle, fontFamily: 'monospace' }

const CATEGORY_LABEL = {
  manpower: '🧑‍🏭 Manpower', production: '🏭 Production', quality: '🔍 Quality',
  maintenance: '🔧 Maintenance', pull: '🎴 Pull System', stock: '📦 Stock',
}

export default function NotificationConfig() {
  const [rooms, setRooms] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [newRoom, setNewRoom] = useState({ name: '', chat_id: '' })
  const [tokenStatus, setTokenStatus] = useState({ is_set: false, last4: null })
  const [tokenInput, setTokenInput] = useState('')

  const load = async () => {
    setLoading(true)
    const [{ data: rm }, { data: rl }, { data: ts }] = await Promise.all([
      supabase.from('telegram_channels').select('*').order('sort_order'),
      supabase.from('notification_rules').select('*').order('sort_order'),
      supabase.rpc('bot_token_status'),
    ])
    setRooms(rm ?? [])
    setRules(rl ?? [])
    if (ts) setTokenStatus(ts)
    setLoading(false)
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
