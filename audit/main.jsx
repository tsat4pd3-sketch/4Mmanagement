import React, { Suspense, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { UserContext } from '../src/App'
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
createRoot(document.getElementById('root')).render(<App/>)
