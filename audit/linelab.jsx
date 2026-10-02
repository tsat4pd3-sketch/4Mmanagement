/* lab: dropdown ไลน์ด้วยทะเบียนจริง (MAIN · 01/10/2026) — ดูลำดับ/หัวกลุ่มส่วนงานบนจอจริง
   เปิด `npx vite --config audit/vite.audit.mjs --port 5199` แล้วเข้า /audit/linelab.html */
import React from 'react'
import { createRoot } from 'react-dom/client'
import LineSelect from '../src/components/LineSelect'
import LineScopeSelect from '../src/components/LineScopeSelect'
import '../src/index.css'
const RAW = [['Assy  LWR','LWR BAR','PD4'],['Assy GOR','GOR','PD4'],['BENDING E50','HYDROFORM','PD3'],['BENDING EXPORT','HYDROFORM','PD3'],['GOR',null,'PD4'],['HDF1','HYDROFORM','PD3'],['HDF2','HYDROFORM','PD3'],['HYDROFORM',null,'PD3'],['LASER E50','HYDROFORM','PD3'],['LASER EXPORT','HYDROFORM','PD3'],['Laser GOR','GOR','PD4'],['Laser LWR','LWR BAR','PD4'],['LASER-345','HYDROFORM','PD3'],['LASER-789','HYDROFORM','PD3'],['Line 60','LINE APRON ASSY','PD3'],['Line 61','LINE APRON ASSY','PD3'],['LINE A ( 800 Ton )',null,'PD1'],['LINE APRON ASSY',null,'PD3'],['LINE ASSY FORD UP375',null,'PD2'],['LINE ASSY TSRA',null,'PD2'],['LINE B ( 600 Ton )',null,'PD1'],['LINE C ( 200&250 Ton )',null,'PD1'],['LINE D ( 110&300 Ton )',null,'PD1'],['LINE GWM','LINE ASSY TSRA','PD2'],['LINE MAIN TSRA-1','LINE ASSY TSRA','PD2'],['LINE MAIN TSRA-2','LINE ASSY TSRA','PD2'],['LINE SUB-STATIONARY','LINE ASSY TSRA','PD2'],['LWR BAR',null,'PD4'],['Office PD4',null,'PD4'],['Rework - PD1',null,'PD1'],['SUB APRON','LINE APRON ASSY','PD3']]
const LINES = RAW.map(([name, parent_line_name, section], id) => ({ id, name, parent_line_name, section, is_active: true }))
const pd3 = LINES.filter(l => l.section === 'PD3')
function Scope() {
  const [st, setSt] = React.useState({ sec: '', ln: '', root: '' })
  return <div><LineScopeSelect id="scope" lines={LINES} sections={['PD1', 'PD2', 'PD3', 'PD4', 'Planning&Store']} section={st.sec} line={st.ln}
    pickDept unit={st.unit || ""} onChange={(sec, ln, { root, unit, lines }) => setSt({ sec, ln, root, unit, n: (lines || []).length })} /><div id="scopeval" style={{ color: '#fff' }}>{JSON.stringify(st)}</div></div>
}
createRoot(document.getElementById('root')).render(<div style={{ padding: 20, display: 'flex', gap: 20 }}>
  <Scope />
  <LineSelect id="all" lines={LINES} placeholder="ทุกไลน์" />
  <LineSelect id="pd3" lines={pd3} placeholder="ทุกไลน์" />
  <LineSelect id="extra" lines={LINES} value="FG WAREHOUSE" placeholder="ทุกไลน์" extraGroups={[{ label: '🏬 คลัง', options: [{ value: 'FG WAREHOUSE' }] }]} />
  <LineSelect id="tail" lines={pd3} value="" extraAt="end" placeholder="ทุกไลน์" extraGroups={[{ label: '⚠ ไม่อยู่ในทะเบียนไลน์', options: [{ value: 'OLD LINE' }] }]} />
</div>)
