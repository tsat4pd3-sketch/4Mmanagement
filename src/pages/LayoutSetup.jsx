import { useState, useContext } from 'react'
import { Link } from 'react-router-dom'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import FactoryMap from './FactoryMap'

// ตั้งค่าผัง/Floorplan รวมที่เดียว (หมวดตั้งค่าโปรแกรม) — แยก setup ออกจากหน้า display (2026-07-16)
//   หลักการ: หน้า display (/factory-map, dashboard) ดู+popup เท่านั้น · การตั้งค่าผังมารวมที่นี่ แยกแท็บตาม POV
//   เฟส1: แท็บภาพรวมโรงงาน (FactoryMap setupMode) · ผลิต/MTN ลิงก์ไปหน้าเดิม · Store/AMR = อนาคต
const TABS = [
  { key: 'factory', label: '🗺️ ภาพรวมโรงงาน', desc: 'รูปผังใหญ่ + วาดกรอบ (polygon) ต่อไลน์ — ฐานของหน้า “ผังรวมโรงงาน”' },
  { key: 'production', label: '🏭 ผลิต (ผังไลน์)', desc: 'ผังไลน์ + จุดงาน/เครื่องจักร/WIP ต่อไลน์' },
  { key: 'mtn', label: '🔧 ซ่อมบำรุง (MTN)', desc: 'ผัง Facility + วางเครื่องจักร/จุดตรวจของ MTN' },
  { key: 'store', label: '📦 Store / AMR', desc: 'ผังคลัง + เส้นทาง/จุดจอดหุ่น AMR (เร็วๆ นี้)' },
]

export default function LayoutSetup() {
  const { role } = useContext(UserContext)
  const [tab, setTab] = useState('factory')
  const cur = TABS.find(t => t.key === tab)

  const linkCard = (to, icon, title, sub) => (
    <Link to={to} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)', textDecoration: 'none', maxWidth: 560 }}>
      <span style={{ fontSize: 30 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{title} <span style={{ color: 'var(--accent)', fontSize: 13 }}>→ เปิดหน้าตั้งค่า</span></div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
      </div>
    </Link>
  )

  return (
    <div style={{ padding: 'clamp(12px,3vw,24px)', display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 }}>🗺️ ตั้งค่าผัง / Floorplan</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>รวมการตั้งค่าผังทุกมุมมองไว้ที่เดียว — หน้าแสดงผล (ผังรวมโรงงาน/Dashboard) ดูอย่างเดียว การแก้ผังทำที่นี่</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            border: `1.5px solid ${tab === t.key ? 'var(--accent)' : 'var(--border2)'}`,
            background: tab === t.key ? 'var(--accent-dim)' : 'var(--bg3)', color: tab === t.key ? 'var(--accent)' : 'var(--muted)',
          }}>{t.label}</button>
        ))}
      </div>
      {cur && <p style={{ fontSize: 12.5, color: 'var(--text2)', margin: 0 }}>{cur.desc}</p>}

      {tab === 'factory' && (
        can('factory_map', 'edit', role)
          ? <FactoryMap setupMode />
          : <div style={{ color: 'var(--muted)', padding: 30 }}>🔒 ไม่มีสิทธิ์แก้ผังภาพรวมโรงงาน (ต้องมีสิทธิ์ factory_map:edit)</div>
      )}
      {tab === 'production' && linkCard('/linesetup', '🏭', 'ตั้งค่าผังไลน์ (LineSetup)', 'ผังไลน์ + จุดงาน/เครื่องจักร/WIP — จัดการต่อไลน์')}
      {tab === 'mtn' && linkCard('/mtn-layout', '🔧', 'ผังเครื่องจักร (ซ่อมบำรุง)', 'แท็บ Facility/Utility — วางเครื่อง/จุดตรวจของ MTN')}
      {tab === 'store' && (
        <div style={{ padding: 30, borderRadius: 12, border: '1px dashed var(--border2)', background: 'var(--card)', color: 'var(--muted)', maxWidth: 560 }}>
          📦 <b style={{ color: 'var(--text2)' }}>Store / AMR</b> — เตรียมไว้สำหรับตั้งค่าผังคลัง + เส้นทาง/จุดจอดหุ่น AMR · จะเปิดใช้ตอนเริ่มระบบ AMR management
        </div>
      )}
    </div>
  )
}
