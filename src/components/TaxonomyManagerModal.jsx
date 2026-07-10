import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabaseDR } from '../supabaseClient'
import { toast } from './Toast'

// Generic CRUD modal for a small taxonomy table (code + label + color|icon).
// Used for pm_checkpoint_categories and pm_checking_methods, but table-agnostic.
//
// props:
//   table    - DB table name (in PPM project)
//   title    - modal heading
//   extraField - 'color' | 'icon' | null  (the editable display attribute)
//   onClose  - close callback
//   onChanged- called after any successful create/update/delete so the parent can refetch

const EMOJI_SUGGESTIONS = ['👁', '👂', '✋', '📏', '📐', '🔧', '🔩', '⚙️', '🔍', '🧪', '🌡️', '⚡']

export default function TaxonomyManagerModal({ table, title, extraField = 'color', onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // row object or 'new'
  const blank = { code: '', label: '', color: '#3dd65c', icon: '🔍', sort_order: 0, is_active: true }
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)

  const fetchRows = async () => {
    setLoading(true)
    const { data } = await supabaseDR.from(table).select('*').order('sort_order').order('code')
    setRows(data ?? [])
    setLoading(false)
  }
  useEffect(() => { fetchRows() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setForm({ ...blank, sort_order: rows.length + 1 }); setEditing('new') }
  const openEdit = (r) => { setForm({ ...r }); setEditing(r.id) }

  const save = async () => {
    if (!form.code.trim() || !form.label.trim()) { toast.error('กรุณากรอก code และ label'); return }
    setSaving(true)
    try {
      const payload = {
        code: form.code.trim(), label: form.label.trim(),
        sort_order: Number(form.sort_order) || 0, is_active: form.is_active,
      }
      if (extraField === 'color') payload.color = form.color
      if (extraField === 'icon') payload.icon = form.icon
      const { error } = editing === 'new'
        ? await supabaseDR.from(table).insert(payload)
        : await supabaseDR.from(table).update(payload).eq('id', editing)
      if (error) throw error
      toast.success('บันทึกแล้ว')
      setEditing(null)
      await fetchRows()
      onChanged?.()
    } catch (err) {
      toast.error(err.message.includes('duplicate') ? 'code นี้มีอยู่แล้ว' : err.message)
    } finally { setSaving(false) }
  }

  const remove = async (r) => {
    if (!confirm(`ลบ "${r.label}" (${r.code}) ?\nจุดตรวจที่ใช้ค่านี้จะยังเก็บ code เดิมไว้`)) return
    const { error } = await supabaseDR.from(table).delete().eq('id', r.id)
    if (error) { toast.error(error.message); return }
    toast.success('ลบแล้ว')
    await fetchRows()
    onChanged?.()
  }

  const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13 }
  const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 480, maxHeight: '88vh', display: 'flex', flexDirection: 'column', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: 0, fontFamily: 'var(--font-display)' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>กำลังโหลด...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', opacity: r.is_active ? 1 : 0.5 }}>
                  {extraField === 'color' && <span style={{ width: 14, height: 14, borderRadius: '50%', background: r.color, flexShrink: 0 }} />}
                  {extraField === 'icon' && <span style={{ fontSize: 18, flexShrink: 0 }}>{r.icon}</span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{r.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{r.code}</span>
                    {!r.is_active && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>(ปิดใช้งาน)</span>}
                  </div>
                  <button onClick={() => openEdit(r)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }}>แก้ไข</button>
                  <button onClick={() => remove(r)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, border: '1px solid rgba(224,92,74,0.3)', background: 'rgba(224,92,74,0.1)', color: '#e05c4a', cursor: 'pointer' }}>ลบ</button>
                </div>
              ))}
              {rows.length === 0 && <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 20 }}>ยังไม่มีรายการ</p>}
            </div>
          )}

          {editing && (
            <div style={{ marginTop: 14, padding: 14, borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--bg3)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', margin: 0 }}>{editing === 'new' ? 'เพิ่มรายการใหม่' : 'แก้ไขรายการ'}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                <div><label style={lbl}>Code *</label><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="LP" style={inp} /></div>
                <div><label style={lbl}>Label *</label><input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Locator Pin" style={inp} /></div>
              </div>
              {extraField === 'color' && (
                <div><label style={lbl}>สี</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: 44, height: 32, borderRadius: 6, border: '1px solid var(--border2)', background: 'none', cursor: 'pointer' }} />
                    <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ ...inp, flex: 1 }} />
                  </div>
                </div>
              )}
              {extraField === 'icon' && (
                <div><label style={lbl}>ไอคอน</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} style={{ ...inp, width: 60, textAlign: 'center', fontSize: 18 }} />
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {EMOJI_SUGGESTIONS.map(em => (
                        <button key={em} onClick={() => setForm(f => ({ ...f, icon: em }))} style={{ width: 30, height: 30, borderRadius: 6, border: `1px solid ${form.icon === em ? 'var(--accent)' : 'var(--border)'}`, background: form.icon === em ? 'var(--accent-dim)' : 'var(--bg2)', fontSize: 15, cursor: 'pointer' }}>{em}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'end' }}>
                <div><label style={lbl}>ลำดับ</label><input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} style={inp} /></div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer', paddingBottom: 8 }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /> ใช้งาน
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditing(null)} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
                <button onClick={save} disabled={saving} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#071008', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'บันทึก...' : 'บันทึก'}</button>
              </div>
            </div>
          )}
        </div>

        {!editing && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
            <button onClick={openNew} style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#071008', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ เพิ่มรายการ</button>
          </div>
        )}
      </motion.div>
    </div>
  )
}
