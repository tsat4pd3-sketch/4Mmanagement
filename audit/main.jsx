import React, { Suspense, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { UserContext, Sidebar } from '../src/App'
import ScrollHint from '../src/components/ScrollHint'
import { ToastContainer } from '../src/components/Toast'
import '../src/index.css'

const mods = import.meta.glob('../src/pages/*.jsx')
const NAMES = Object.keys(mods).map(p => p.split('/').pop().replace('.jsx',''))

class EB extends React.Component {
  constructor(p){ super(p); this.state={e:null} }
  static getDerivedStateFromError(e){ return {e} }
  componentDidCatch(){ window.__crash = true }
  render(){ return this.state.e ? <div id="crash">CRASH: {String(this.state.e.message).slice(0,120)}</div> : this.props.children }
}

/* ?role=<role> — สลับ role ของ harness ได้ (2026-09-15)
   เดิมล็อก 'manager' ตายตัว ⇒ ปุ่ม/โมดัลที่ยิงผ่าน can() ของ role อื่น (เช่น Scan เปิด Order
   ที่ต้อง daily_report:record) **ไม่เคยถูก render ใน crashsweep เลย** — ตรวจตาไม่ได้ด้วย
   default ยังเป็น 'manager' เหมือนเดิม (ไม่กระทบผลตรวจเดิม) */
const ROLE = new URLSearchParams(location.search).get('role') || 'manager';
const CTX = { role:ROLE, lineId:1, team:'A', section:'PD1', sections:[], fullName:'ทดสอบ ระบบ',
  userId:'x', email:'a@b.c', position:'หัวหน้าส่วน', signatureUrl:null, avatarUrl:null,
  mtnTeams:[], isDeptAdmin:false, sidebarOpen:false }

/* ?p=__sidebar — วัด sidebar แบบ D (rail + แผงลอย) นอกแอปจริง · role=admin เพื่อให้เห็นเมนูครบ
   จำลอง marginLeft แบบเดียวกับ ProtectedLayout เพื่อวัดว่าเนื้อหาถูกบีบเมื่อไหร่ */
function SidebarLab(){
  const [pinned, setPinned] = useState(false)
  const [open, setOpen] = useState(true)
  window.__setPin = setPinned
  const marginLeft = open ? (pinned ? 'calc(var(--rail-w) + var(--sidebar-w))' : 'var(--rail-w)') : 0
  return (
    <MemoryRouter>
      <UserContext.Provider value={{ ...CTX, role:'admin' }}>
        <div style={{ display:'flex', minHeight:'100vh', background:'var(--bg)' }}>
          <Sidebar isOpen={open} onClose={()=>setOpen(false)} onLogout={()=>{}} theme="dark" onToggleTheme={()=>{}}
            userRole="admin" userLineId={null} userEmail="a@b.c" userFullName="ทดสอบ ระบบ" userSignatureUrl={null}
            userPosition="operator" userAvatarUrl={null} remoteCode={null} onToggleRemote={()=>{}}
            onOpenPalette={()=>{ window.__palette = (window.__palette||0)+1 }} pinned={pinned} onTogglePin={()=>setPinned(v=>!v)} />
          {!open && <button id="reopen" onClick={()=>setOpen(true)} style={{position:'fixed',top:10,left:14,zIndex:1100}}>☰</button>}
          <main id="mainbox" style={{ flex:1, marginLeft, minHeight:'100vh', paddingTop:14, background:'var(--bg)',
            overflowY:'auto', overflowX:'hidden', minWidth:0, transition:'margin-left 0.3s' }}>
            <div id="content" style={{ padding:20, color:'var(--text)' }}>พื้นที่เนื้อหาหลัก</div>
          </main>
        </div>
      </UserContext.Provider>
    </MemoryRouter>
  )
}

function App(){
  const [name, setName] = useState(new URLSearchParams(location.search).get('p') || NAMES[0])
  const [C, setC] = useState(null)
  useEffect(()=>{ window.__crash=false; setC(null)
    const key = `../src/pages/${name}.jsx`
    mods[key]().then(m => setC(()=>m.default)).catch(e => { window.__crash=true; console.error(e) })
  },[name])
  return (
    <MemoryRouter>
      <UserContext.Provider value={CTX}>
        {/* จำลองโครงเดียวกับ App จริง: main เลื่อนแนวตั้งอย่างเดียว */}
        <main id="mainbox" style={{ flex:1, minHeight:'100vh', paddingTop:14, background:'var(--bg)',
          overflowY:'auto', overflowX:'hidden', minWidth:0 }}>
          <ScrollHint/><EB><Suspense fallback={<div>loading</div>}>{C ? <C/> : null}</Suspense></EB>
        </main>
      </UserContext.Provider>
    </MemoryRouter>
  )
}
/* ?p=__feedback — โมดัล 💬 แจ้งปัญหา (2026-09-22)
   มันถูก render จาก App shell ไม่ใช่จากหน้าไหน ⇒ crashsweep ที่ไล่เปิดทีละ "หน้า" มองไม่เห็นเลย
   พอเพิ่มช่องแนบรูป (สิ่งที่พังได้จริง: preview/ถอดรูป/ล้นโมดัลบนมือถือ) เลยต้องมี harness ของตัวเอง */
const FeedbackLab = () => (
  <MemoryRouter>
    <UserContext.Provider value={{ ...CTX, role:'admin' }}>
      <EB><Suspense fallback={<div>loading</div>}>
        {React.createElement(React.lazy(() => import('../src/components/FeedbackModal')), { onClose(){} })}
      </Suspense></EB>
      {/* ⚠️ ต้องมี ToastContainer ใน harness ด้วย — ไม่งั้น `toast.error(...)` ไม่โผล่ที่ไหนเลย
          แล้วกฎ "ปฏิเสธไฟล์ต้องขึ้น toast บอกเหตุผล ห้ามเงียบ" จะตรวจอัตโนมัติไม่ได้
          (เจอ 22/09: เทสรายงานว่า 'ไม่มีข้อความเตือน' ทั้งที่โค้ดเรียก toast ถูกแล้ว) */}
      <ToastContainer/>
    </UserContext.Provider>
  </MemoryRouter>
)

window.__PAGES = NAMES
const only = new URLSearchParams(location.search).get('p')
createRoot(document.getElementById('root')).render(
  only === '__sidebar' ? <SidebarLab/> : only === '__feedback' ? <FeedbackLab/> : <App/>)
