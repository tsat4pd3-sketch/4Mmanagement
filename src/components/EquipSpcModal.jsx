/* 📈 หน้าต่างกราฟ SPC ของข้อเดียว — เปิดจากปุ่ม 📈 ในใบตรวจ AM/PM (26/11)
   เปิดในที่เดิม (ไม่พาไปหน้าอื่น) ⇒ พนักงาน AM ที่ไม่มีสิทธิ์เข้า PM hub ก็ดูกราฟข้อที่ตัวเองตรวจได้
   📄 docs/modules/equipment-spc.md */
import { useEffect, useState } from 'react'
import { tr } from '../utils/i18n'
import { loadSpcSeries } from '../lib/equipSpcLoad'
import { equipSpc } from '../utils/equipSpc'
import EquipSpcChart from './EquipSpcChart'

export default function EquipSpcModal({ cp, jigName = '', onClose }) {
  const [st, setSt] = useState({ id: null, loading: true, rows: [], err: '' })
  useEffect(() => {
    let alive = true
    setSt({ id: cp?.id, loading: true, rows: [], err: '' })
    loadSpcSeries(cp).then(r => { if (alive) setSt({ id: cp?.id, loading: false, rows: r.rows || [], err: r.ok ? '' : (r.error || 'error') }) })
    return () => { alive = false }
  }, [cp?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = st.id === cp?.id && !st.loading
  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)' }} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', borderRadius: 12, background: 'var(--bg2-surf)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)', padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text)' }}>📈 SPC · {cp?.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{jigName}{jigName ? ' · ' : ''}{tr('ย้อนหลัง 180 วัน')}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={tr('ปิด')} style={{ fontSize: 16, padding: '2px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer' }}>✕</button>
        </div>
        {!ready
          ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังโหลด…')}</div>
          : st.err
            ? <div style={{ padding: 20, color: 'var(--amber)', fontSize: 13 }}>⚠ {tr('อ่านค่าวัดไม่สำเร็จ')} ({st.err})</div>
            : <EquipSpcChart cp={cp} result={equipSpc(cp, st.rows)} />}
      </div>
    </div>
  )
}
