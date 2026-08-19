import React, { Suspense, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { UserContext, Sidebar } from '../src/App'
import ScrollHint from '../src/components/ScrollHint'
import '../src/index.css'

const mods = import.meta.glob('../src/pages/*.jsx')
const NAMES = Object.keys(mods).map(p => p.split('/').pop().replace('.jsx',''))

class EB extends React.Component {
  constructor(p){ super(p); this.state={e:null} }
  static getDerivedStateFromError(e){ return {e} }
  componentDidCatch(){ window.__crash = true }
  render(){ return this.state.e ? <div id="crash">CRASH: {String(this.state.e.message).slice(0,120)}</div> : this.props.children }
}

const CTX = { role:'manager', lineId:1, team:'A', section:'PD1', sections:[], fullName:'ทดสอบ ระบบ',
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
window.__PAGES = NAMES
const wantSidebar = new URLSearchParams(location.search).get('p') === '__sidebar'
createRoot(document.getElementById('root')).render(wantSidebar ? <SidebarLab/> : <App/>)
