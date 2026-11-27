import React, { Suspense, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { UserContext, Sidebar, NAV_ITEMS, NAV_GROUP_ORDER, NAV_GROUP_META, NotificationBell } from '../src/App'
import { motion } from 'framer-motion'
import { railPill } from '../src/utils/motion'
import Icon from '../src/components/Icon'
import { markView } from '../src/utils/motion'
import TabBody from '../src/components/TabBody'
import Skeleton from '../src/components/Skeleton'
/* 📈 harness ไม่ได้ผ่าน App.jsx (ตัวเรียก markView ตอนเปลี่ยน URL) ⇒ เปิดหน้าต่างอนิเมชันกราฟตอนโหลด ให้เห็นเหมือนแอปจริง */
markView()
/* 24/11: แอปจริง App.jsx เรียก markView() ทุกครั้งที่ pathname/search เปลี่ยน (สลับแท็บ = ?tab= เปลี่ยน) — harness ใช้ MemoryRouter
   ⇒ ต้องเรียกเองตอน location เปลี่ยน ไม่งั้นเลขวิ่ง/กราฟเล่นเฉพาะตอนโหลดหน้าครั้งแรก (ตรวจ/ถ่ายคลิปแล้วไม่เหมือนแอปจริง) */
function ViewMarker() { const loc = useLocation(); useEffect(() => { markView() }, [loc.pathname, loc.search]); return null }
/* เปิดทะเบียนเมนูให้ `audit/stdsweep.mjs` อ่าน — ตรวจว่า "คุณอยู่ตรงนี้" บนรางตรงกับหมวดจริงไหม
   (`alsoIn` = หน้าที่อยู่ 2 หมวดจริงๆ ต้องถูกไฮไลต์ทั้งคู่) */
window.__NAV = NAV_ITEMS.map(i => ({ to: i.to, group: i.group, alsoIn: i.alsoIn || null }))
import ScrollHint from '../src/components/ScrollHint'
import MobileNavBar from '../src/components/MobileNavBar'
import ScanWedgeGuard from '../src/components/ScanWedgeGuard'
import { ToastContainer } from '../src/components/Toast'
import ConfirmHost from '../src/components/ConfirmHost'   // ❓ กล่องยืนยันกลาง (18/11) — ไม่มี = askConfirm ถอยไป window.confirm แล้ว sweep วัดกล่องในแอปไม่ได้
import '../src/index.css'

const mods = import.meta.glob('../src/pages/*.jsx')
const NAMES = Object.keys(mods).map(p => p.split('/').pop().replace('.jsx',''))
/* หน้าที่เป็น "คอมโพเนนต์เดียว หลาย route" (prop ต่างกัน) — `ไฟล์@ค่า` = เปิดไฟล์นั้นด้วย view=ค่า (19/10)
   /people-board = Dashboard view="people" · ไม่ใส่ไว้ = สวีปทุกตัวไม่เคยเห็นจอคนเลย */
const VARIANTS = { 'Dashboard@people': { view: 'people' } }
NAMES.push(...Object.keys(VARIANTS))

/* 🛡️ หน้าที่ "โค้ดจริงอยู่หลังแท็บ/ปุ่มในเนื้อหน้า" — crashsweep กดได้แค่ปุ่ม**หัวเพจ** ⇒ เข้าไม่ถึง
   (audit/README §โค้ดที่อยู่ในโมดัล/สาขาที่ต้องกดถึง · ถ้าสวีปกดไม่ถึง = ไม่มีด่านเลย)
   ⇒ ใส่ "ที่อยู่เต็ม" เป็นชื่อหน้าไปเลย: `?p=` ตัดที่ `&` ให้เองตอนหา component
      ส่วน query ที่เหลือ `ENTRY` ส่งเข้า MemoryRouter ⇒ `useTabParam` อ่านได้จริง
   🔴 เพิ่มมุมมอง/แท็บใหม่ที่มีโค้ดเป็นของตัวเอง = เติมที่นี่ในคอมมิทเดียวกัน */
NAMES.push(
  'ProductionPlan&tab=lots',              // 🧲 แผนสั่งงานล็อต + ไทม์ไลน์ราง (PlanTimeline)
)

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
/* ⚠️ harness เดิมใช้ `<MemoryRouter>` เปล่าๆ ⇒ `useSearchParams()` ในหน้าลูก**ว่างเสมอ**
   ทำให้โค้ดสาย "รับตัวกรองจาก URL" (เช่น /oee-analytics?section=PD3 ที่เจาะมาจาก OBEYA)
   ไม่เคยถูกรันใน harness เลยสักครั้ง = บั๊กทั้งคลาสมองไม่เห็น (2026-09-22)
   ⇒ ส่ง query string จริงของ harness เข้าไปเป็นที่อยู่ตั้งต้น (ตัด `p`/`role` ที่เป็นของ harness เองออก) */
const ENTRY = (() => {
  const q = new URLSearchParams(location.search);
  q.delete('p'); q.delete('role'); q.delete('sections');
  /* `?path=/production-plan` — ตั้ง **pathname** ของที่อยู่ตั้งต้น (2026-09-24)
     เดิมตรึงเป็น `/` เสมอ ⇒ lab ของ sidebar จำลอง "กำลังอยู่หน้าไหน" ไม่ได้เลย
     แล้วไฮไลต์ "คุณอยู่ตรงนี้" บนราง **ไม่เคยถูกเห็นใน harness สักครั้ง**
     (นั่นคือเหตุผลที่ bug ไฮไลต์รางหลุดไปถึงหน้างาน — user ต้องมาทักเอง) */
  const path = q.get('path') || '/'; q.delete('path');
  return q.toString() ? `${path}?${q}` : path;
})();
/* ?sections=PD2,PD3 — จำลอง user ที่ถูกจำกัดส่วนงาน (2026-10-05) · เดิม sections:[] ตายตัว ⇒ สาย "ขอบเขตจาก URL
   อยู่นอกสังกัด user" / ตัวกรองส่วนงานของบอร์ด OBEYA ไม่เคยถูกรันใน harness เลย */
const SECTIONS = (new URLSearchParams(location.search).get('sections') || '').split(',').map(s => s.trim()).filter(Boolean);
/* 🔑 **`lineId` ต้องตรงกับ `id` ของไลน์ใน mock จริงๆ** (2026-11-13 · ห้ามถอด)
   เดิมตั้งไว้ `1` ขณะที่ `audit/mockSupabase.js` ให้ไลน์มี `id` เป็น `'id-N'`
   ⇒ **ไม่ตรงกันเลยสักแถว** ⇒ ทุกจุดที่ถาม "ไลน์ของผู้ใช้คนนี้คือไลน์ไหน" หาไม่เจอ
     แล้วเดินเข้ากิ่ง fail-open ทุกครั้ง ⇒ **กิ่ง "ขอบเขตรายไลน์" ไม่เคยถูกรันใน crashsweep เลย**
     (เจอตอนแก้บั๊ก /checkin 13/11 ที่หัวหน้ากลุ่ม PD4 แจ้ง — harness โชว์พฤติกรรมนั้นไม่ได้)
   ตอนนี้ mock ให้ `production_lines.id` เป็นเลขแล้ว (= ของจริงที่เป็น integer)
   🔴 เลือก **2** โดยเจตนา = ไลน์**ลูก** ของไลน์ 1 และมีหลานคือไลน์ 4 (`PARENT_OF = {2:1, 3:1, 4:2}`)
      ⇒ กิ่ง "ไลน์ลูกตกทอดจากไลน์แม่" + "ไล่ขึ้นหา ancestor" + "ครอบครัวไลน์" ถูกรันจริง
      ตั้งเป็นไลน์แม่ (1) จะไม่เคยเดินสายตกทอดขึ้นเลย */
const CTX = { role:ROLE, lineId:2, team:'A', section:SECTIONS[0] || 'PD1', sections:SECTIONS, fullName:'ทดสอบ ระบบ',
  userId:'x', email:'a@b.c', position:'หัวหน้าส่วน', signatureUrl:null, avatarUrl:null,
  mtnTeams:[], isDeptAdmin:false, sidebarOpen:false }

/* ?p=__sidebar — วัด sidebar แบบ D (rail + แผงลอย) นอกแอปจริง · role=admin เพื่อให้เห็นเมนูครบ
   จำลอง marginLeft แบบเดียวกับ ProtectedLayout เพื่อวัดว่าเนื้อหาถูกบีบเมื่อไหร่ */
/* 24/11: lab ของ sidebar โหลด "หน้าจริง" ตาม path ที่เมนูพาไป (เดโม sidebar↔แผ่นเนื้อหา · TabBody) — `/daily-report` → DailyReport.jsx
   หาไฟล์ไม่เจอ = บอกบนจอ (ไม่ใช่ทุก route ชื่อตรงไฟล์) · ไม่ใช่ตัวสวีป — crashsweep ยังใช้ <App/> เดิม */
function ShellPage(){
  const loc = useLocation()
  const file = loc.pathname === '/' ? 'DeptHub' : loc.pathname.slice(1).split('/')[0].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  const key = `../src/pages/${file}.jsx`
  const [C, setC] = useState(null)
  useEffect(() => { setC(null); if (!mods[key]) return; mods[key]().then(m => setC(() => m.default)).catch(() => setC(null)) }, [key])
  return (
    <TabBody tab={loc.pathname}>
      {!mods[key] ? <div style={{ padding: 24, color: 'var(--muted)' }}>harness: ไม่มีไฟล์ {file}.jsx สำหรับ {loc.pathname}</div>
        : !C ? <Skeleton cards={6} style={{ padding: '24px 24px 0' }} />
        : <EB><Suspense fallback={<Skeleton cards={6} style={{ padding: '24px 24px 0' }} />}><C /></Suspense></EB>}
    </TabBody>
  )
}
/* ?p=__sidebar2 — 24/11 ต้นแบบ "ราง 260px ย่อเหลือ 72px" แบบรีล Sidebar v2 (ระดับหนัก) ด้วย token ของเรา · หมวดจาก NAV_GROUP_ORDER จริง
   หน้าจริงโหลดผ่าน ShellPage · เป็นแค่แล็บสำหรับเคาะดีไซน์ — Sidebar จริงยังเป็น rail 64px + แผงลอย */
/* ?p=__sidebar3 — 25/11 ข้อ 3 "แบบผสม": รางกว้างแสดง *เฉพาะหมวด* (ย่อ 260→72) + เมนูย่อยเป็น **แผงลอย** ข้างราง (ไม่ดันหมวดอื่นลง)
   หมวด 17 หน้า (ตั้งค่า) เลื่อนในแผงเอง · กดหน้า = แผงปิด · ย่อแล้วแผงยังโผล่ข้างไอคอน */
function WideSidebarLab({ panel = false }){
  const [min, setMin] = useState(false)
  const [group, setGroup] = useState('ภาพรวม')
  const [path, setPath] = useState('/')
  const [open, setOpen] = useState(null)   // หมวดที่แผงลอยเปิดอยู่ (เฉพาะโหมด panel)
  const items = NAV_ITEMS.filter(i => i.group === group)
  const W = min ? 72 : 260
  const nav = (p) => { setPath(p); window.history.replaceState(null, '', '?p=__sidebar2&role=admin&go=' + encodeURIComponent(p)) }
  return (
    <UserContext.Provider value={CTX}>
      <MemoryRouter initialEntries={[path]} key={path}>
        <ViewMarker />
        <div className="app-frame" style={{ display:'flex', minHeight:'100vh', background:'var(--bg)' }}>
          <aside style={{ position:'fixed', top:0, left:0, bottom:0, width:W, transition:'width .32s cubic-bezier(.2,.8,.2,1)', overflow:'hidden', display:'flex', flexDirection:'column', padding:'14px 10px', gap:4,
            background:'linear-gradient(180deg, var(--rail-top), var(--rail-bot))', borderRight:'1px solid var(--border)', zIndex:50 }}>
            <button onClick={()=>setMin(m=>!m)} aria-label="ย่อ/ขยาย" style={{ position:'absolute', top:16, right:-1, width:24, height:24, borderRadius:'50%', border:'1px solid var(--border)', background:'var(--card)', color:'var(--muted)', cursor:'pointer', transform: min ? 'rotate(180deg)' : 'none', transition:'transform .32s' }}>‹</button>
            <div style={{ display:'flex', alignItems:'center', gap:10, height:40, padding:'0 6px', marginBottom:6 }}>
              <span style={{ flex:'0 0 32px', width:32, height:32, borderRadius:'50%', background:'var(--accent)', color:'var(--accent-ink)', display:'grid', placeItems:'center', fontWeight:700, fontSize:13 }}>E</span>
              <span style={{ fontWeight:600, fontSize:15, color:'var(--text)', opacity: min ? 0 : 1, transform: min ? 'translateX(-8px)' : 'none', transition:'opacity .18s, transform .25s', whiteSpace:'nowrap' }}>ESM</span>
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', padding:'4px 10px 2px', whiteSpace:'nowrap' }}>{min ? '•' : 'หมวด'}</div>
            {[...new Set(NAV_GROUP_ORDER)].map(g => { const m = NAV_GROUP_META[g] || {}; const cur = g === group; return (
              <button key={g} onClick={()=>{ if (panel) { setOpen(o => o === g ? null : g); return } setGroup(g); const first = NAV_ITEMS.find(i => i.group === g); if (first) nav(first.to) }} aria-current={cur ? 'page' : undefined} title={g}
                style={{ position:'relative', display:'flex', alignItems:'center', gap:12, height:40, padding:'0 12px', borderRadius:12, border:'none', background:'transparent', color: cur ? 'var(--accent)' : 'var(--muted)', fontWeight: cur ? 600 : 400, cursor:'pointer', fontSize:13, whiteSpace:'nowrap', textAlign:'left', width:'100%' }}>
                {cur && <motion.span layoutId="wide-active" transition={railPill()} aria-hidden="true" className="neon-row" style={{ position:'absolute', inset:0, borderRadius:12, background:'var(--accent-dim)', pointerEvents:'none' }}>
                  <span className="neon-bar" style={{ position:'absolute', left:-10, top:8, bottom:8, width:4, borderRadius:'0 4px 4px 0', background:'var(--accent)' }} />
                </motion.span>}
                <Icon glyph={m.icon || '•'} size={19} style={{ position:'relative', zIndex:1, flex:'0 0 20px' }} />   {/* ไอคอนเส้นชุดเดียวกับ sidebar จริง (UI §6.36) */}
                <span style={{ position:'relative', zIndex:1, opacity: min ? 0 : 1, transform: min ? 'translateX(-8px)' : 'none', transition:'opacity .18s, transform .25s', overflow:'hidden', textOverflow:'ellipsis' }}>{m.short || g}</span>
              </button>) })}
            {!panel && !min && items.length > 1 && <div style={{ marginTop:8, paddingLeft:8, borderLeft:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:2 }}>
              {items.slice(0, 8).map(i => <button key={i.to} onClick={()=>nav(i.to)} aria-current={path === i.to ? 'page' : undefined}
                style={{ display:'flex', alignItems:'center', gap:8, height:30, padding:'0 10px', borderRadius:8, border:'none', background: path === i.to ? 'var(--accent-dim)' : 'transparent', color: path === i.to ? 'var(--accent)' : 'var(--muted)', fontSize:12, cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textAlign:'left' }}><Icon glyph={i.icon} size={15} /><span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{i.label}</span></button>)}
            </div>}
            <div style={{ flex:1 }} />
            <div style={{ display:'flex', alignItems:'center', gap:10, height:42, padding:'0 8px', borderRadius:12, background:'var(--accent-dim)', color:'var(--text)', fontSize:12, whiteSpace:'nowrap', overflow:'hidden' }}>
              <span style={{ flex:'0 0 26px', width:26, height:26, borderRadius:'50%', background:'var(--accent)', color:'var(--accent-ink)', display:'grid', placeItems:'center', fontSize:11, fontWeight:700 }}>ท</span>
              <span style={{ opacity: min ? 0 : 1, transition:'opacity .18s' }}>ทดสอบ ระบบ · PD1</span>
            </div>
          </aside>
          {panel && open && (() => { const list = NAV_ITEMS.filter(i => i.group === open); const top = 14 + 40 + 6 + 20 + [...new Set(NAV_GROUP_ORDER)].indexOf(open) * 44; return (
            <>
              <div onClick={()=>setOpen(null)} style={{ position:'fixed', inset:0, zIndex:55 }} />
              <motion.div key={open} initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ duration:.18, ease:'easeOut' }}
                style={{ position:'fixed', left:W + 8, top: (() => { const t = Math.min(top, window.innerHeight - 16 - Math.min(list.length * 36 + 40, 440)); return Math.max(8, t) })(), transform:'translateY(-8px)', width:230, maxHeight:'calc(100vh - 24px)', overflowY:'auto', zIndex:60, padding:'8px 6px', borderRadius:14,
                  background:'var(--card)', border:'1px solid var(--border)', boxShadow:'var(--shadow-float)', display:'flex', flexDirection:'column', gap:2 }}>
                <div style={{ fontSize:11, color:'var(--muted)', padding:'4px 10px 6px' }}>{open} · {list.length} หน้า</div>
                {list.map(i => { const cur = path === i.to; return (
                  <button key={i.to} onClick={()=>{ setGroup(open); nav(i.to); setOpen(null) }} aria-current={cur ? 'page' : undefined}
                    style={{ position:'relative', display:'flex', alignItems:'center', gap:9, height:34, padding:'0 12px', borderRadius:9, border:'none', background:'transparent', color: cur ? 'var(--accent)' : 'var(--text)', fontWeight: cur ? 600 : 400, fontSize:12.5, cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', textAlign:'left' }}>
                    {cur && <span className="neon-row" aria-hidden="true" style={{ position:'absolute', inset:0, borderRadius:'inherit', background:'var(--accent-dim)', pointerEvents:'none' }}><span className="neon-bar" style={{ position:'absolute', left:0, top:7, bottom:7, width:3, borderRadius:'0 3px 3px 0', background:'var(--accent)' }} /></span>}
                    <Icon glyph={i.icon} size={15} style={{ position:'relative', zIndex:1, flex:'0 0 16px' }} /><span style={{ position:'relative', zIndex:1, overflow:'hidden', textOverflow:'ellipsis' }}>{i.label}</span>
                  </button>) })}
              </motion.div>
            </>) })()}
          <main id="mainbox" className="app-sheet" style={{ flex:1, marginLeft:W, minHeight:'100vh', paddingTop:14, background:'var(--bg)', overflowY:'auto', overflowX:'hidden', minWidth:0, transition:'margin-left .32s cubic-bezier(.2,.8,.2,1)' }}>
            <ShellPage />
          </main>
        </div>
      </MemoryRouter>
    </UserContext.Provider>
  )
}
function SidebarLab(){
  const [pinned, setPinned] = useState(false)
  const [open, setOpen] = useState(true)
  window.__setPin = setPinned
  const marginLeft = open ? (pinned ? 'calc(var(--rail-w) + var(--sidebar-w))' : 'var(--rail-w)') : 0
  return (
    <MemoryRouter initialEntries={[ENTRY]}><ViewMarker />
      <UserContext.Provider value={{ ...CTX, role:'admin' }}>
        <div className="app-frame" style={{ display:'flex', minHeight:'100vh', background:'var(--bg)' }}>
          <Sidebar isOpen={open} onClose={()=>setOpen(false)} onLogout={()=>{}} theme="dark" onToggleTheme={()=>{}}
            userRole="admin" userLineId={null} userEmail="a@b.c" userFullName="ทดสอบ ระบบ" userSignatureUrl={null}
            userPosition="operator" userAvatarUrl={null} remoteCode={null} onToggleRemote={()=>{}}
            onOpenPalette={()=>{ window.__palette = (window.__palette||0)+1 }} pinned={pinned} onTogglePin={()=>setPinned(v=>!v)} />
          {!open && <button id="reopen" onClick={()=>setOpen(true)} style={{position:'fixed',top:10,left:14,zIndex:1100}}>☰</button>}
          <main id="mainbox" className="app-sheet" style={{ flex:1, marginLeft, minHeight:'100vh', paddingTop:14, background:'var(--bg)',
            overflowY:'auto', overflowX:'hidden', minWidth:0, transition:'margin-left 0.3s' }}>
            <ShellPage />
          </main>
        </div>
      </UserContext.Provider>
    </MemoryRouter>
  )
}

const TV_SHELL = new URLSearchParams(location.search).get('tvshell') === '1'
const DisplayRotatorLazy = React.lazy(() => import('../src/components/DisplayRotator'))
function TvShellHarness(){
  useEffect(() => { document.body.classList.add('esm-tv-shell'); return () => document.body.classList.remove('esm-tv-shell') }, [])
  /* role ตาม ?role= (admin = ผ่านสิทธิ์ทุกหน้า — ใช้คู่ ?rot= เพราะ harness ไม่ได้โหลดตารางสิทธิ์ของ display) */
  return <DisplayRotatorLazy userId="x" role={ROLE} shell />
}
function App(){
  const [name, setName] = useState(new URLSearchParams(location.search).get('p') || NAMES[0])
  const [C, setC] = useState(null)
  useEffect(()=>{ window.__crash=false; setC(null)
    const key = `../src/pages/${name.split('@')[0]}.jsx`
    mods[key]().then(m => setC(()=>m.default)).catch(e => { window.__crash=true; console.error(e) })
  },[name])
  return (
    <MemoryRouter initialEntries={[ENTRY]}><ViewMarker />
      <UserContext.Provider value={CTX}>
        {/* จำลองโครงเดียวกับ App จริง: main เลื่อนแนวตั้งอย่างเดียว */}
        {/* 📺 ?tvshell=1: main ไม่เลื่อนเอง (ทั้งเอกสารเลื่อน) เหมือน App จริง — ตัววนจอแบ่งส่วนด้วย window.scrollTo */}
        <main id="mainbox" style={{ flex:1, minHeight:'100vh', paddingTop:14, background:'var(--bg)',
          ...(TV_SHELL ? { overflowX:'clip' } : { overflowY:'auto', overflowX:'hidden' }), minWidth:0 }}>
          <ScrollHint/><EB><Suspense fallback={<div>loading</div>}>{C ? <C {...(VARIANTS[name] || {})}/> : null}</Suspense></EB>
          {/* ToastContainer ต้องมีในหน้าปกติด้วย (05/10) — เดิมมีแค่ใน FeedbackLab ⇒ toast จากหน้าอื่น (เช่น "ขอบเขตนอกสังกัด" ของบอร์ด KPI) ไม่โผล่ ตรวจอัตโนมัติไม่ได้ */}
          <ToastContainer/><ConfirmHost/>
        </main>
        {/* 📺 ?tvshell=1 — กรอบจอ TV (16/10) · แถบบน + body.esm-tv-shell เหมือนบัญชี display ในแอปจริง */}
        {TV_SHELL && <Suspense fallback={null}><TvShellHarness/></Suspense>}
        {/* 📱 แถบล่างมือถือเหมือนแอปจริง (15/10) — สวีปมือถือต้องเห็นว่าแถบบังอะไรไหม · จอคอม = null */}
        <MobileNavBar role={ROLE} onOpenMenu={() => { window.__menu = (window.__menu || 0) + 1 }} onOpenSearch={() => { window.__palette = (window.__palette || 0) + 1 }} />
        {/* 🔫 ด่านปุ่มสแกนข้างเครื่อง (20/10) — เหมือนแอปจริง · จอคอม = ไม่ติดตั้ง */}
        <ScanWedgeGuard />
      </UserContext.Provider>
    </MemoryRouter>
  )
}
/* ?p=__feedback — โมดัล 💬 แจ้งปัญหา (2026-09-22)
   มันถูก render จาก App shell ไม่ใช่จากหน้าไหน ⇒ crashsweep ที่ไล่เปิดทีละ "หน้า" มองไม่เห็นเลย
   พอเพิ่มช่องแนบรูป (สิ่งที่พังได้จริง: preview/ถอดรูป/ล้นโมดัลบนมือถือ) เลยต้องมี harness ของตัวเอง */
const FeedbackLab = () => (
  <MemoryRouter initialEntries={[ENTRY]}><ViewMarker />
    <UserContext.Provider value={{ ...CTX, role:'admin' }}>
      <EB><Suspense fallback={<div>loading</div>}>
        {React.createElement(React.lazy(() => import('../src/components/FeedbackModal')), { onClose(){} })}
      </Suspense></EB>
      {/* ⚠️ ต้องมี ToastContainer ใน harness ด้วย — ไม่งั้น `toast.error(...)` ไม่โผล่ที่ไหนเลย
          แล้วกฎ "ปฏิเสธไฟล์ต้องขึ้น toast บอกเหตุผล ห้ามเงียบ" จะตรวจอัตโนมัติไม่ได้
          (เจอ 22/09: เทสรายงานว่า 'ไม่มีข้อความเตือน' ทั้งที่โค้ดเรียก toast ถูกแล้ว) */}
      <ToastContainer/><ConfirmHost/>
    </UserContext.Provider>
  </MemoryRouter>
)

/* ?p=__bell — กระดิ่ง 2 แท็บ (🎯 รอคุณ · 📢 แจ้งเตือนทั่วไป · 2026-10-13) อยู่ใน App shell เหมือน FeedbackModal
   ⇒ crashsweep รายหน้ามองไม่เห็น · ?p=__bell&open=1 เปิด dropdown ให้เลย */
function BellLab(){
  useEffect(() => {
    if (new URLSearchParams(location.search).get('open')) setTimeout(() => document.querySelector('button[title]')?.click(), 600)
  }, [])
  return (
    <MemoryRouter initialEntries={[ENTRY]}><ViewMarker />
      <UserContext.Provider value={{ ...CTX, role:'admin', sections:['PD1'], mtnTeams:[] }}>
        <EB><NotificationBell userId="x" role="admin" /></EB>
        <ToastContainer/><ConfirmHost/>
      </UserContext.Provider>
    </MemoryRouter>
  )
}

window.__PAGES = NAMES
const only = new URLSearchParams(location.search).get('p')
createRoot(document.getElementById('root')).render(
  only === '__sidebar' ? <SidebarLab/> : only === '__sidebar2' ? <WideSidebarLab/> : only === '__sidebar3' ? <WideSidebarLab panel /> : only === '__feedback' ? <FeedbackLab/> : only === '__bell' ? <BellLab/> : <App/>)
