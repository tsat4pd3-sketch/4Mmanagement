import { useContext } from 'react'
import { Link } from 'react-router-dom'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import PageHeader from '../components/PageHeader'
import useTabParam from '../utils/useTabParam'
import FactoryMap from './FactoryMap'
import MtnMachineLayout from './MtnMachineLayout'
import LineSetup from './LineSetup'
import TransportMapEditor from '../components/TransportMapEditor'

// ตั้งค่าผัง/Floorplan รวมที่เดียว (หมวดตั้งค่าโปรแกรม) — แยก setup ออกจากหน้า display (2026-07-16)
//   หลักการ: หน้า display (/factory-map, dashboard) ดู+popup เท่านั้น · การตั้งค่าผังมารวมที่นี่ แยกแท็บตาม POV
//   เฟส1: แท็บภาพรวมโรงงาน (FactoryMap setupMode) · ผลิต/MTN ลิงก์ไปหน้าเดิม · Store/AMR = อนาคต
const TABS = [
  { key: 'factory', label: '🗺️ ภาพรวมโรงงาน', desc: 'รูปผังใหญ่ + วาดกรอบ (polygon) ต่อไลน์ — ฐานของหน้า “ผังรวมโรงงาน”' },
  { key: 'production', label: '🏭 ผลิต (ผังไลน์)', desc: 'ผังไลน์ + จุดงาน/เครื่องจักร/WIP ต่อไลน์' },
  { key: 'mtn', label: '🔧 ซ่อมบำรุง (MTN)', desc: 'ผัง Facility + วางเครื่องจักร/จุดตรวจของ MTN' },
  { key: 'store', label: '📦 Store / AMR', desc: 'วาดถนน/ทางเดินรถ (node/แยก/จุดจอด + เส้นเชื่อม) ทับผังใหญ่ — ฐานคำนวณเส้นทาง Teiki-bin/AMR' },
]

export default function LayoutSetup() {
  const { role } = useContext(UserContext)
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'factory')
  const cur = TABS.find(t => t.key === tab)

  return (
    <div style={{ padding: 'clamp(12px,3vw,24px)', display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' }}>
      <PageHeader
        title="ตั้งค่าผัง / Floorplan" icon="🗺️"
        sub="รวมการตั้งค่าผังทุกมุมมองไว้ที่เดียว — หน้าแสดงผล (ผังรวมโรงงาน/Dashboard) ดูอย่างเดียว การแก้ผังทำที่นี่"
        tabs={TABS} tab={tab} onTab={setTab}
      />
      {cur && <p style={{ fontSize: 12.5, color: 'var(--text2)', margin: 0 }}>{cur.desc}</p>}

      {tab === 'factory' && (
        can('factory_map', 'edit', role)
          ? <FactoryMap setupMode />
          : <div style={{ color: 'var(--muted)', padding: 30 }}>🔒 ไม่มีสิทธิ์แก้ผังภาพรวมโรงงาน (ต้องมีสิทธิ์ factory_map:edit)</div>
      )}
      {tab === 'production' && (
        can('line_setup', 'edit', role)
          ? <LineSetup embedded />
          : <div style={{ color: 'var(--muted)', padding: 30 }}>🔒 ไม่มีสิทธิ์แก้ผังไลน์ (ต้องมีสิทธิ์ line_setup:edit) — <Link to="/linesetup" style={{ color: 'var(--accent)' }}>เปิดหน้าดูอย่างเดียว</Link></div>
      )}
      {tab === 'mtn' && (
        can('pm', 'setup', role)
          ? <MtnMachineLayout setupMode />
          : <div style={{ color: 'var(--muted)', padding: 30 }}>🔒 ไม่มีสิทธิ์ตั้งค่าผัง MTN (ต้องมีสิทธิ์ pm:setup)</div>
      )}
      {tab === 'store' && <TransportMapEditor />}
    </div>
  )
}
