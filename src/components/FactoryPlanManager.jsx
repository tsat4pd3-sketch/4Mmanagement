import { useState, useEffect, useRef } from 'react'
import imageCompression from 'browser-image-compression'
import { supabaseDR } from '../supabaseClient'
import { toast } from './Toast'

// จัดการรูปผังโรงงาน (ฐานของ Org Map ฝั่ง MTN) จากหน้าตั้งค่าโปรแกรม (2026-07-16)
//   เก็บที่ pm_facility_areas (DR) เดียวกับที่ MTN /mtn-layout ใช้ — แก้ที่นี่หรือที่ MTN ก็ได้ (ข้อมูลชุดเดียว)
//   รูปบีบ 2560px/2.5MB q0.9 (ผัง — ต้องซูมอ่านได้ · ดู CLAUDE.md "Storage & รูปภาพ")
function publicUrl(path) { return path ? supabaseDR.storage.from('jig-images').getPublicUrl(path).data.publicUrl : null }

export default function FactoryPlanManager({ canEdit }) {
  const [open, setOpen] = useState(false)
  const [areas, setAreas] = useState([])
  const [busy, setBusy] = useState(null)
  const fileRefs = useRef({})

  const reload = async () => {
    const { data } = await supabaseDR.from('pm_facility_areas').select('id, name, image_path, sort_order').order('sort_order').order('created_at')
    setAreas(data || [])
  }
  useEffect(() => { if (open) reload() }, [open])

  const addArea = async () => {
    const name = window.prompt('ชื่อผัง (เช่น ผังโรงงานรวม, อาคาร A)')
    if (!name?.trim()) return
    const { error } = await supabaseDR.from('pm_facility_areas').insert({ name: name.trim(), sort_order: areas.length })
    if (error) return toast.error(error.message)
    reload()
  }
  const rename = async (a) => {
    const name = window.prompt('เปลี่ยนชื่อผัง', a.name)
    if (!name?.trim() || name === a.name) return
    await supabaseDR.from('pm_facility_areas').update({ name: name.trim() }).eq('id', a.id)
    reload()
  }
  const del = async (a) => {
    if (!window.confirm(`ลบผัง "${a.name}"? (node ไลน์ที่วางบนผังนี้จะถูกลบด้วย)`)) return
    const { error } = await supabaseDR.from('pm_facility_areas').delete().eq('id', a.id)
    if (error) return toast.error(error.message)
    if (a.image_path) supabaseDR.storage.from('jig-images').remove([a.image_path]).then(() => {}, () => {})
    reload()
  }
  const upload = async (a, e) => {
    const file = e.target.files?.[0]; if (!file) return
    setBusy(a.id)
    try {
      const compressed = await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9 })
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `facility/${a.id}.${ext}`
      const { error } = await supabaseDR.storage.from('jig-images').upload(path, compressed, { upsert: true })
      if (error) throw error
      await supabaseDR.from('pm_facility_areas').update({ image_path: path }).eq('id', a.id)
      const prev = a.image_path
      if (prev && prev !== path) supabaseDR.storage.from('jig-images').remove([prev]).then(() => {}, () => {})
      toast.success('อัปโหลดรูปผังแล้ว'); reload()
    } catch (err) { toast.error(err.message) } finally { setBusy(null); if (fileRefs.current[a.id]) fileRefs.current[a.id].value = '' }
  }

  if (!canEdit) return null
  return (
    <div style={{ flexShrink: 0, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)' }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>🗺️ ผังโรงงาน (ฐาน Org Map ฝั่ง MTN)</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{areas.length ? `${areas.length} ผัง` : ''}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: 0 }}>อัปโหลดรูปผังที่นี่ แล้วไปวาง node ไลน์ + ดูสถานะได้ที่ MTN → 🗺️ ภาพรวม (Org)</p>
          {areas.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)' }}>
              {a.image_path ? <img src={publicUrl(a.image_path)} alt="" style={{ width: 54, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border2)' }} /> : <div style={{ width: 54, height: 40, borderRadius: 4, border: '1px dashed var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>▫️</div>}
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 100 }}>{a.name}</span>
              <label style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>
                <input ref={el => { fileRefs.current[a.id] = el }} type="file" accept="image/*" hidden onChange={e => upload(a, e)} disabled={busy === a.id} />
                {busy === a.id ? 'อัปโหลด...' : a.image_path ? '🖼️ เปลี่ยนรูป' : '📷 อัปโหลดรูป'}
              </label>
              <button onClick={() => rename(a)} style={{ fontSize: 12, background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>เปลี่ยนชื่อ</button>
              <button onClick={() => del(a)} style={{ fontSize: 12, background: 'none', border: '1px solid rgba(224,92,74,0.4)', color: '#e05c4a', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>ลบ</button>
            </div>
          ))}
          <button onClick={addArea} style={{ alignSelf: 'flex-start', background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>+ เพิ่มผัง</button>
        </div>
      )}
    </div>
  )
}
