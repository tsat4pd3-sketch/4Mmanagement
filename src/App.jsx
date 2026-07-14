import { createContext, useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { fmtDateTime } from './utils/dateFormat';
import tsLogo from './assets/TS logo.png';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { ToastContainer } from './components/Toast';
import Login from './pages/Login';
import SignatureModal from './components/SignatureModal';
import ChangePasswordModal from './components/ChangePasswordModal';
import { loadPermissions, canAccessPage } from './utils/permissions';
import { effectiveSections } from './utils/sectionScope';

const Register     = lazy(() => import('./pages/Register'));
const Checkin      = lazy(() => import('./pages/Checkin'));
const Management   = lazy(() => import('./pages/Management'));
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Operator     = lazy(() => import('./pages/operator'));
const LineSetup    = lazy(() => import('./pages/LineSetup'));
const MachineDatabase = lazy(() => import('./pages/MachineDatabase'));
const AddUser      = lazy(() => import('./pages/AddUser'));
const CustomerDemand = lazy(() => import('./pages/CustomerDemand'));
const PlannerSales   = lazy(() => import('./pages/PlannerSales'));
const RundownStock   = lazy(() => import('./pages/RundownStock'));
const Report       = lazy(() => import('./pages/Report'));
const ShiftOrganize = lazy(() => import('./pages/ShiftOrganize'));
const EventLog      = lazy(() => import('./pages/EventLog'));
const DailyReport   = lazy(() => import('./pages/DailyReport'));
const OEEAnalytics  = lazy(() => import('./pages/OEEAnalytics'));
const DeptHub       = lazy(() => import('./pages/DeptHub'));
const HeijunkaKanban = lazy(() => import('./pages/HeijunkaKanban'));
const ProductMaster  = lazy(() => import('./pages/ProductMaster'));
const LineStock      = lazy(() => import('./pages/LineStock'));
const CompanyCalendar = lazy(() => import('./pages/CompanyCalendar'));
const RackCenter      = lazy(() => import('./pages/RackCenter'));
const OrgSetup        = lazy(() => import('./pages/OrgSetup'));
const PMSetup     = lazy(() => import('./pages/PMSetup'));
const PMCheckData = lazy(() => import('./pages/PMCheckData'));
const PMSchedule  = lazy(() => import('./pages/PMSchedule'));
const MtnMachineLayout = lazy(() => import('./pages/MtnMachineLayout'));
const DailyPM     = lazy(() => import('./pages/DailyPM'));
const Improvements = lazy(() => import('./pages/Improvements'));
const MorningMeeting = lazy(() => import('./pages/MorningMeeting'));
const PermissionsManagement = lazy(() => import('./pages/PermissionsManagement'));
const QualityControl = lazy(() => import('./pages/QualityControl'));
const QAInspectionSetup = lazy(() => import('./pages/QAInspectionSetup'));
const NotificationConfig = lazy(() => import('./pages/NotificationConfig'));

/* ─── Role System ──────────────────────────────────────────── */
export const UserContext = createContext({ role: 'admin', lineId: null, team: null, section: null, notifyEmail: null, signatureUrl: null, fullName: null });

// null roles = accessible to every role
// group ใช้จัดหมวดหมู่ในแถบ sidebar (มี minimize/expand ต่อหมวด)
// สิทธิ์เข้าหน้าอ่านจาก role_permissions ผ่าน canAccessPage() เท่านั้น (data-driven)
// — จึงไม่มีฟิลด์ roles ในนี้ (เคยมี แต่เป็น dead field ไม่ถูกอ่าน ลบออก 2026-07-10 กันเข้าใจผิดว่าเป็น source of truth)
const NAV_ITEMS = [
  { to: '/',            icon: '🏠', label: 'หน้าหลัก',           group: 'ภาพรวม' },

  // Dashboard ย้ายจากหมวด "ภาพรวม" → "ฝ่ายผลิต" (คำสั่ง user 2026-07-12 — เนื้อหาส่วนใหญ่เป็นรายละเอียดฝ่ายผลิต)
  { to: '/dashboard',   icon: '📊', label: 'Dashboard',           group: 'ฝ่ายผลิต' },
  { to: '/morning-meeting', icon: '🌅', label: 'ประชุมแถวเช้า',   group: 'ฝ่ายผลิต' },
  { to: '/checkin',     icon: '📝', label: 'เช็คชื่อ & PPE',     group: 'ฝ่ายผลิต' },
  { to: '/management',  icon: '🔄', label: 'จัดการไลน์ผลิต',     group: 'ฝ่ายผลิต' },
  { to: '/daily-report',   icon: '📊', label: 'Daily Report',      group: 'ฝ่ายผลิต' },
  { to: '/oee-analytics',  icon: '📈', label: 'OEE',                group: 'ฝ่ายผลิต' },
  { to: '/daily-pm',       icon: '✅', label: 'Daily PM ฝ่ายผลิต',   group: 'ฝ่ายผลิต' },
  { to: '/improvements',   icon: '💡', label: 'Improvements',        group: 'ฝ่ายผลิต' },

  { to: '/line-stock',      icon: '📦', label: 'Store management',       group: 'Logistic - Store' },
  { to: '/heijunka',       icon: '🎴', label: 'Kanban Board',             group: 'Logistic - Store' },
  { to: '/rack-center',    icon: '🗃️', label: 'Rack Center management',  group: 'Logistic - Store' },
  { to: '/planner-sales',   icon: '📈', label: 'Planner & Sales',           group: 'Logistic - Store' },
  { to: '/rundown-stock',   icon: '📉', label: 'Rundown Stock',             group: 'Logistic - Store' },
  { to: '/customer-demand', icon: '🚚', label: 'Delivery',                  group: 'Logistic - Store' },

  { to: '/pm-check',    icon: '✅', label: 'ตรวจสอบอุปกรณ์เครื่องจักร',        group: 'การตรวจสอบและซ่อมบำรุง' },
  { to: '/pm-schedule', icon: '📅', label: 'แผน PM อุปกรณ์เครื่องจักร',        group: 'การตรวจสอบและซ่อมบำรุง' },
  { to: '/mtn-layout',  icon: '🗺️', label: 'ผังเครื่องจักร (ซ่อมบำรุง)',      group: 'การตรวจสอบและซ่อมบำรุง' },
  { to: '/pm-setup',    icon: '🔩', label: 'Setup การตรวจสอบอุปกรณ์เครื่องจักร', group: 'การตรวจสอบและซ่อมบำรุง' },

  { to: '/qa',             icon: '🔍', label: 'Quality Control Center', group: 'ควบคุมคุณภาพ QA/QC' },
  { to: '/qa-setup',       icon: '📐', label: 'มาตรฐานการตรวจ & Drawing', group: 'ควบคุมคุณภาพ QA/QC' },
  { to: '/event-log',      icon: '⚡', label: 'CQI-15 Event Log', group: 'ควบคุมคุณภาพ QA/QC' },

  { to: '/report',        icon: '📋', label: 'รายงาน',            group: 'รายงาน' },

  { to: '/org-setup',  icon: '🏢', label: 'แผนผังองค์กร',     group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/register',   icon: '➕', label: 'เพิ่มพนักงาน',      group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/operator',   icon: '👥', label: 'ฐานข้อมูลพนักงาน',  group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/products',        icon: '🔩', label: 'Product Master',    group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/linesetup',  icon: '⚙️',  label: 'ตั้งค่าผังไลน์',   group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/machine-database', icon: '🏭', label: 'ฐานข้อมูลเครื่องจักร', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/shift-organize', icon: '🗓', label: 'ตารางกะ',         group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/company-calendar', icon: '📅', label: 'ปฏิทินบริษัท',    group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/permissions', icon: '🔐', label: 'จัดการสิทธิ์',       group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
  { to: '/notification-config', icon: '🔔', label: 'ตั้งค่าการแจ้งเตือน', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล' },
];

const NAV_GROUP_ORDER = ['ภาพรวม', 'ฝ่ายผลิต', 'Logistic - Store', 'การตรวจสอบและซ่อมบำรุง', 'ควบคุมคุณภาพ QA/QC', 'รายงาน', 'ตั้งค่าโปรแกรม,ฐานข้อมูล'];

// เมนูจริงของหมวด sidebar สำหรับ DeptHub — การ์ดหน้าหลักดึงไปแสดงเป็นชิปที่คลิกเข้าหน้าได้เลย
// อิง NAV_ITEMS ตัวเดียวกับ sidebar เสมอ (single source of truth — ห้ามพิมพ์รายชื่อเมนูซ้ำใน DeptHub)
// และกรองตามสิทธิ์ role เดียวกับ sidebar เพื่อให้ชิปตรงกับเมนูที่ user คนนั้นเห็นจริง
export function navItemsForGroups(groups, role) {
  return NAV_ITEMS.filter(i => i.to !== '/' && groups.includes(i.group) && canAccessPage(i.to, role));
}

// สรุปสิทธิ์เข้าหน้าของ role จากตารางสิทธิ์จริง (role_permissions) — ใช้โชว์ในหน้า จัดการผู้ใช้งาน
// เพื่อไม่ต้อง hardcode รายชื่อโมดูลต่อ role (เคย hardcode แล้ว drift ตามโมดูลที่เพิ่มไม่ทัน)
export function accessSummaryForRole(role) {
  const pages = NAV_ITEMS.filter(i => i.to !== '/' && canAccessPage(i.to, role));
  const groups = NAV_GROUP_ORDER.filter(g => pages.some(p => p.group === g));
  return { total: pages.length, all: pages.length >= NAV_ITEMS.length - 1, groups };
}

// เข้าโมดูลจากหน้าหลัก (DeptHub) → กาง sidebar เฉพาะหมวดของโมดูลนั้น หมวดอื่นพับ
// เพื่อให้เห็นเมนูของโมดูลที่เลือกทันที ไม่ต้องไล่หาในเมนูที่กางหมดทุกหมวด
// (user ยังพับ/กางเองต่อได้ตามปกติ ค่าที่ตั้งจาก hub จะถูกจำต่อใน localStorage เดียวกัน)
export function focusSidebarGroups(groups) {
  const collapsed = {};
  NAV_GROUP_ORDER.forEach(g => { if (!groups.includes(g)) collapsed[g] = true; });
  try { localStorage.setItem('nav_collapsed_groups', JSON.stringify(collapsed)); } catch { /* ignore */ }
  // Sidebar mount อยู่ตลอด — แจ้งให้ sync state จาก localStorage ใหม่
  window.dispatchEvent(new Event('nav-groups-changed'));
}

/* ─── Role Route Guard ────────────────────────────────────────────────
   สิทธิ์เข้าถึงแต่ละหน้าเก็บอยู่ใน role_permissions (ตาราง) ไม่ใช่ array ในโค้ดอีกต่อไป
   จัดการได้จากหน้า "จัดการสิทธิ์" (admin เท่านั้น) — ดู src/utils/permissions.js
   admin bypass เสมอ กันกรณี config ผิดจนตัวเองเข้าไม่ได้ ── */
function RoleRoute({ children, path, userRole }) {
  if (!canAccessPage(path, userRole)) return <Navigate to="/" replace />;
  return children;
}

/* ─── Splash Screen ────────────────────────────────────── */
function SplashScreen({ onDone }) {
  const barRef = useRef(null);

  useEffect(() => {
    setTimeout(() => document.getElementById('splash-logo')?.classList.add('up'), 100);
    setTimeout(() => document.getElementById('splash-title')?.classList.add('up'), 300);
    setTimeout(() => document.getElementById('splash-subtitle')?.classList.add('up'), 420);
    setTimeout(() => document.getElementById('splash-sub')?.classList.add('up'), 500);

    let w = 0;
    const iv = setInterval(() => {
      w = Math.min(w + 2.5, 100);
      if (barRef.current) barRef.current.style.width = w + '%';
      if (w >= 100) { clearInterval(iv); setTimeout(onDone, 400); }
    }, 20);

    return () => clearInterval(iv);
  }, [onDone]);

  return (
    <div id="splash">
      {/* Triangle logo */}
      <div id="splash-logo" style={{
        opacity: 0, transform: 'translateY(20px)',
        transition: 'opacity 0.6s ease, transform 0.6s ease',
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8,
      }}>
        <img src={tsLogo} alt="Thai Summit Group" width={52} height={52} style={{ borderRadius: 5 }} />
        <div style={{ textAlign: 'left' }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 13, letterSpacing: '2px', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.9)',
          }}>Thai Summit Group</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 11,
            letterSpacing: '2px', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.35)',
          }}>VX Production System</div>
        </div>
      </div>

      {/* 4M title */}
      <div id="splash-title" style={{
        opacity: 0, transform: 'translateY(16px)',
        transition: 'opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s',
        fontFamily: 'var(--font-display)', fontWeight: 700,
        fontSize: 'clamp(1.2rem,3.5vw,2.4rem)', letterSpacing: '0.5px',
        color: 'var(--accent)', lineHeight: 1,
      }}>
        ENTERPRISE SHOPFLOOR MANAGEMENT
      </div>
      <div style={{
        opacity: 0, transform: 'translateY(10px)',
        transition: 'opacity 0.5s ease 0.25s, transform 0.5s ease 0.25s',
        fontSize: 'clamp(0.75rem,1.8vw,0.95rem)', color: 'var(--muted)', fontWeight: 500,
        letterSpacing: '0.5px', marginTop: 4,
      }} id="splash-subtitle">Thai Summit Group · ESM</div>

      <div className="splash-sub" id="splash-sub">Zero defect is possible</div>

      <div className="splash-bar-wrap" style={{ marginTop: 12 }}>
        <div className="splash-bar-fill" ref={barRef} />
      </div>
    </div>
  );
}

/* ─── Sidebar ──────────────────────────────────────────────── */
function Sidebar({ isOpen, onClose, onLogout, theme, onToggleTheme, userRole, userLineId, userEmail, userFullName, userSignatureUrl, userPosition }) {
  const location = useLocation();
  const isMobile = window.innerWidth <= 768;
  const [sigModalOpen,  setSigModalOpen]  = useState(false);
  const [sigUrl,        setSigUrl]        = useState(userSignatureUrl);
  const [pwdModalOpen,  setPwdModalOpen]  = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nav_collapsed_groups') || '{}'); } catch { return {}; }
  });

  useEffect(() => { setSigUrl(userSignatureUrl); }, [userSignatureUrl]);

  // hub สั่งโฟกัสหมวด (focusSidebarGroups) → โหลดค่าพับ/กางจาก localStorage ใหม่
  useEffect(() => {
    const sync = () => {
      try { setCollapsedGroups(JSON.parse(localStorage.getItem('nav_collapsed_groups') || '{}')); } catch { /* ignore */ }
    };
    window.addEventListener('nav-groups-changed', sync);
    return () => window.removeEventListener('nav-groups-changed', sync);
  }, []);

  const toggleGroup = (g) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [g]: !prev[g] };
      localStorage.setItem('nav_collapsed_groups', JSON.stringify(next));
      return next;
    });
  };

  const visibleItems = NAV_ITEMS.filter(item => canAccessPage(item.to, userRole));
  const groupedItems = NAV_GROUP_ORDER
    .map(g => ({ group: g, items: visibleItems.filter(i => i.group === g) }))
    .filter(g => g.items.length > 0);
  const displayName = userFullName || userEmail || '';
  const initials = displayName
    ? displayName.split(/[\s@]/)[0].slice(0, 2).toUpperCase()
    : '?';

  return (
    <>
      {isMobile && isOpen && (
        <div className="sidebar-backdrop visible" onClick={onClose} />
      )}
      <nav style={{
        position: 'fixed', top: 0, left: 0, height: '100vh',
        width: isOpen ? 'var(--sidebar-w)' : '0px',
        background: 'var(--bg2)',
        borderRight: isOpen ? '1px solid var(--border)' : 'none',
        display: 'flex', flexDirection: 'column',
        padding: isOpen ? '0 10px 20px' : '0',
        overflow: 'hidden',
        transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1), padding 0.3s',
        zIndex: 1000,
        boxShadow: isOpen ? '4px 0 30px rgba(0,0,0,0.3)' : 'none',
      }}>
        {/* Logo + ปุ่มพับ sidebar (อยู่ในหัวแถบ ไม่ลอยทับเนื้อหา) */}
        <div style={{ padding: '18px 6px 16px', borderBottom: '1px solid var(--border)', marginBottom: 10, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <img src={tsLogo} alt="Thai Summit Group" width={28} height={28} style={{ borderRadius: 3, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, letterSpacing: '2px', color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, fontFamily: 'var(--font-display)' }}>Thai Summit</div>
              <div style={{ fontSize: 11, letterSpacing: '1.5px', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>ESM · Shopfloor</div>
            </div>
          </div>
          <button
            onClick={onClose}
            title="พับเมนู"
            style={{
              width: 28, height: 28, borderRadius: 7, flexShrink: 0,
              background: 'var(--bg3)', border: '1px solid var(--border2)',
              color: 'var(--text2)', fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >⟨</button>
        </div>

        {/* Links */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', minHeight: 0 }}>
          {groupedItems.map(({ group, items }) => {
            const collapsed = !!collapsedGroups[group];
            const groupHasActive = items.some(i => location.pathname === i.to);
            return (
              <div key={group} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => toggleGroup(group)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '8px 10px 4px',
                    color: groupHasActive ? 'var(--accent)' : 'var(--muted)',
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group}</span>
                  <span style={{ fontSize: 11, transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>▾</span>
                </button>
                {!collapsed && items.map(item => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="nav-link"
                    style={location.pathname === item.to
                      ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }
                      : {}}
                    onClick={() => isMobile && onClose()}
                  >
                    <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                  </Link>
                ))}
              </div>
            );
          })}

          {canAccessPage('/add-user', userRole) && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
              <Link
                to="/add-user"
                className="nav-link"
                style={location.pathname === '/add-user'
                  ? { background: 'var(--accent2-dim)', color: 'var(--accent2)' }
                  : { color: 'var(--accent2)' }}
                onClick={() => isMobile && onClose()}
              >
                <span style={{ fontSize: 15 }}>🔑</span>
                <span style={{ whiteSpace: 'nowrap' }}>จัดการผู้ใช้งาน</span>
              </Link>
            </div>
          )}
        </div>

        {/* Footer: User info + Theme toggle + Logout */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* User info card */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 8,
            background: 'var(--bg3)', border: '1px solid var(--border2)',
            marginBottom: 2,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--accent), #ff6b6b)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: '#fff',
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {userFullName || (userEmail?.split('@')[0]) || 'Unknown'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {[userPosition, userEmail].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 700, padding: '2px 6px',
              borderRadius: 4, flexShrink: 0,
              background: userRole === 'admin' ? 'var(--accent-dim)' :
                          userRole === 'manager' ? 'var(--accent2-dim)' :
                          userRole === 'supervisor' ? 'rgba(77,159,255,0.12)' :
                          'var(--accent-dim)',
              color: userRole === 'admin' ? 'var(--accent)' :
                     userRole === 'manager' ? 'var(--accent2)' :
                     userRole === 'supervisor' ? '#4d9fff' :
                     'var(--green)',
              border: `1px solid ${
                userRole === 'admin' ? 'rgba(61,214,92,0.3)' :
                userRole === 'manager' ? 'rgba(245,154,63,0.3)' :
                userRole === 'supervisor' ? 'rgba(77,159,255,0.3)' :
                'rgba(61,214,92,0.3)'
              }`,
            }}>
              {userRole?.toUpperCase() ?? 'ADMIN'}
            </div>
          </div>

          <button
            onClick={() => setSigModalOpen(true)}
            className="nav-link"
            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', color: 'var(--text2)' }}
          >
            <span style={{ fontSize: 15, flexShrink: 0 }}>✍️</span>
            <span style={{ whiteSpace: 'nowrap' }}>ลายเซ็น</span>
          </button>

          <button
            onClick={() => setPwdModalOpen(true)}
            className="nav-link"
            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', color: 'var(--text2)' }}
          >
            <span style={{ fontSize: 15, flexShrink: 0 }}>🔐</span>
            <span style={{ whiteSpace: 'nowrap' }}>เปลี่ยนรหัสผ่าน</span>
          </button>

          <button
            onClick={onToggleTheme}
            className="nav-link"
            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', justifyContent: 'space-between' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{theme === 'dark' ? '☀️' : '🌙'}</span>
              <span style={{ whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </span>
            </div>
            <div style={{
              width: 36, height: 20, borderRadius: 10, flexShrink: 0,
              background: theme === 'dark' ? 'var(--accent)' : 'var(--border2)',
              position: 'relative',
              transition: 'background 0.25s',
            }}>
              <div style={{
                position: 'absolute', top: 2,
                left: theme === 'dark' ? 18 : 2,
                width: 16, height: 16, borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.25s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </div>
          </button>

          <button
            onClick={onLogout}
            className="nav-link"
            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', color: '#ff6b6b' }}
          >
            <span style={{ fontSize: 15 }}>🚪</span>
            <span style={{ whiteSpace: 'nowrap' }}>ออกจากระบบ</span>
          </button>
        </div>
      </nav>
      <SignatureModal
        open={sigModalOpen}
        onClose={() => setSigModalOpen(false)}
        currentSignatureUrl={sigUrl}
        onSaved={(url) => setSigUrl(url)}
      />
      <ChangePasswordModal
        open={pwdModalOpen}
        onClose={() => setPwdModalOpen(false)}
        userEmail={userEmail}
      />
    </>
  );
}

/* ─── Notification Bell ─────────────────────────────────────── */
function NotificationBell({ userId }) {
  const [notifs, setNotifs]     = useState([]);
  const [open,   setOpen]       = useState(false);
  const dropRef                 = useRef(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, type, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    setNotifs(data || []);
  }, [userId]);

  useEffect(() => {
    load();
    if (!userId) return;
    const ch = supabase
      .channel(`notif-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [userId, load]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    const unread = notifs.filter(n => !n.is_read).map(n => n.id);
    if (!unread.length) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', unread);
    setNotifs(n => n.map(x => ({ ...x, is_read: true })));
  };

  const markOne = async (id) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifs(n => n.map(x => x.id === id ? { ...x, is_read: true } : x));
  };

  const unread = notifs.filter(n => !n.is_read).length;

  const typeColor = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#4d9fff' };

  return (
    <div ref={dropRef} style={{ position: 'fixed', top: 10, right: 14, zIndex: 1200 }}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) load(); }}
        style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'var(--bg3)', border: '1px solid var(--border2)',
          color: 'var(--text2)', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', position: 'relative', boxShadow: 'var(--shadow-sm)',
        }}
        title="แจ้งเตือน"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', color: '#fff',
            fontSize: 11, fontWeight: 800,
            minWidth: 18, height: 18, borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 42, right: 0,
          width: 'min(340px,92vw)',
          background: 'var(--card)',
          border: '1px solid var(--border2)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>🔔 แจ้งเตือน</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                อ่านทั้งหมด
              </button>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifs.length === 0 ? (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>ไม่มีแจ้งเตือน</div>
            ) : notifs.map(n => (
              <div
                key={n.id}
                onClick={() => markOne(n.id)}
                style={{
                  padding: '9px 14px', borderBottom: '1px solid var(--border)',
                  background: n.is_read ? 'transparent' : 'var(--accent-dim)',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                    background: n.is_read ? 'var(--border2)' : (typeColor[n.type] || '#4d9fff'),
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: n.is_read ? 400 : 700, color: 'var(--text)', lineHeight: 1.4 }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div>}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                      {fmtDateTime(n.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Toggle Button — โผล่เฉพาะตอน sidebar พับอยู่ (ปุ่มพับอยู่ในหัว sidebar แล้ว) ─── */
function ToggleBtn({ isOpen, onClick }) {
  if (isOpen) return null;
  return (
    <button
      onClick={onClick}
      title="เปิดเมนู"
      style={{
        position: 'fixed', top: 14, left: 14,
        zIndex: 1100,
        width: 34, height: 34, borderRadius: 8,
        background: 'var(--bg3)',
        border: '1px solid var(--border2)',
        color: 'var(--text2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, cursor: 'pointer',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      ☰
    </button>
  );
}

/* ─── Auto-Logout ──────────────────────────────────────────────────── */
const IDLE_TIMEOUT_MS  = 30 * 60 * 1000; // 30 min idle → show warning
const WARN_DURATION_MS =  5 * 60 * 1000; // 5 min countdown before forced logout
// นับ idle ร่วมกันทุกแท็บของ browser เดียวกันผ่าน localStorage — แท็บที่เปิดทิ้งไว้ต้องไม่
// auto-logout ทั้งที่ user กำลังใช้งานอีกแท็บอยู่ (เคยเป็นสาเหตุหลักของ "เด้ง login บ่อย"
// เพราะ signOut จากแท็บ idle พาแท็บที่ใช้งานอยู่หลุดด้วย — session แชร์กันใน localStorage)
const ACTIVITY_LS_KEY = 'esm-last-activity';

function useAutoLogout(isDisplay, onLogout) {
  const [warnSecsLeft, setWarnSecsLeft] = useState(null); // null = not warning
  const lastActivityRef = useRef(Date.now());
  const warnActiveRef   = useRef(false);
  const countdownRef    = useRef(null);
  const onLogoutRef     = useRef(onLogout);
  useEffect(() => { onLogoutRef.current = onLogout; }, [onLogout]);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    warnActiveRef.current = false;
    setWarnSecsLeft(null);
  }, []);

  const dismissWarning = useCallback(() => {
    stopCountdown();
    lastActivityRef.current = Date.now();
    try { localStorage.setItem(ACTIVITY_LS_KEY, String(Date.now())); } catch { /* private mode */ }
  }, [stopCountdown]);

  useEffect(() => {
    if (isDisplay) return; // display users never get auto-logged out

    const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    let lastLsWrite = 0;
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      // แชร์เวลา activity ให้แท็บอื่น (เขียนถี่สุดทุก 5 วิ กัน write spam)
      if (Date.now() - lastLsWrite > 5000) {
        lastLsWrite = Date.now();
        try { localStorage.setItem(ACTIVITY_LS_KEY, String(Date.now())); } catch { /* private mode */ }
      }
      // กลับมาใช้งานระหว่าง countdown = ยังอยู่ — ปิดคำเตือนเอง ไม่ต้องบังคับกดปุ่ม
      // (เดิมขยับเมาส์/แตะจอไม่ช่วย ต้องกดปุ่มเท่านั้น เลยโดน logout ทั้งที่คนอยู่หน้าจอ)
      if (warnActiveRef.current) dismissWarning();
    };
    EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }));

    // แท็บอื่นมี activity → นับเป็น activity ของเราด้วย (storage event ยิงเฉพาะแท็บอื่น)
    const onStorage = (e) => {
      if (e.key !== ACTIVITY_LS_KEY) return;
      lastActivityRef.current = Date.now();
      if (warnActiveRef.current) dismissWarning();
    };
    window.addEventListener('storage', onStorage);

    // Poll every 30s to check idle time — เทียบกับ activity ล่าสุดของ "ทุกแท็บ" (max ของ local ref กับ localStorage)
    const pollId = setInterval(() => {
      if (warnActiveRef.current) return; // already counting down
      let shared = 0;
      try { shared = Number(localStorage.getItem(ACTIVITY_LS_KEY)) || 0; } catch { /* ignore */ }
      const lastActivity = Math.max(lastActivityRef.current, shared);
      const idle = Date.now() - lastActivity;
      if (idle >= IDLE_TIMEOUT_MS) {
        // Start countdown
        warnActiveRef.current = true;
        let secsLeft = Math.round(WARN_DURATION_MS / 1000);
        setWarnSecsLeft(secsLeft);
        countdownRef.current = setInterval(() => {
          secsLeft -= 1;
          setWarnSecsLeft(secsLeft);
          if (secsLeft <= 0) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
            warnActiveRef.current = false;
            onLogoutRef.current();
          }
        }, 1000);
      }
    }, 30_000);

    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, onActivity));
      window.removeEventListener('storage', onStorage);
      clearInterval(pollId);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isDisplay, dismissWarning]);

  return { warnSecsLeft, dismissWarning };
}

function AutoLogoutWarning({ secsLeft, onStay, onLogout }) {
  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2,'0')} นาที` : `${secs} วินาที`;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border2)',
        borderRadius: 16, padding: '32px 36px', maxWidth: 400, width: '90vw',
        boxShadow: 'var(--shadow-lg)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏱️</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          คุณไม่ได้ใช้งานระบบ
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.6 }}>
          ระบบจะออกจากระบบอัตโนมัติใน
          <span style={{ fontWeight: 800, color: '#ef4444', fontSize: 20, display: 'block', margin: '6px 0' }}>
            {timeStr}
          </span>
          เพื่อความปลอดภัยของข้อมูล
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={onStay} style={{
            padding: '10px 24px', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none',
          }}>
            ยังอยู่ที่นี่
          </button>
          <button onClick={onLogout} style={{
            padding: '10px 24px', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer',
            background: 'rgba(239,68,68,0.12)', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.35)',
          }}>
            ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Protected Layout ─────────────────────────────────────────────── */
// permsVersion ไม่ได้ใช้ในฟังก์ชันโดยตรง — รับไว้เพื่อให้ prop เปลี่ยนแล้ว layout ทั้งต้น re-render
// (RoleRoute/Sidebar อ่าน permission cache แบบ sync ผ่าน canAccessPage ระหว่าง render)
function ProtectedLayout({ session, theme, onToggleTheme, userRole, userLineId, userTeam, userSection, userSections, userPosition, userEmail, userFullName, userNotifyEmail, userSignatureUrl }) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const isTV     = typeof window !== 'undefined' && window.innerWidth >= 1920;
  const [isOpen, setIsOpen] = useState(!isMobile);
  const navigate = useNavigate();
  const location = useLocation();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 768) setIsOpen(false);
      else setIsOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!session) return <Navigate to="/login" replace />;

  const handleLogout = async () => {
    // scope 'local' = ออกเฉพาะ browser นี้ (ทุกแท็บของเครื่องนี้ผ่าน localStorage event)
    // ห้ามใช้ default (global) — global จะ revoke refresh token ของ user นี้ "ทุกเครื่อง"
    // → account ที่ใช้ร่วมกันหลายจุดในโรงงานโดนเด้ง login พร้อมกันทั้งหมดทุกครั้งที่
    // เครื่องใดเครื่องหนึ่ง logout/auto-logout (สาเหตุหลักของ "เด้ง login บ่อย" 2026-07-14)
    await supabase.auth.signOut({ scope: 'local' });
    navigate('/login');
  };

  const isDisplay = userRole === 'display';
  const { warnSecsLeft, dismissWarning } = useAutoLogout(isDisplay, handleLogout);

  const sidebarPx  = isTV ? 280 : 240;
  const marginLeft = (!isMobile && isOpen) ? sidebarPx : 0;
  const role       = userRole; // ไม่ fallback เป็น 'admin' อีกต่อไป — profileLoaded gate ด้านบนรับประกันว่า role ถูก resolve แล้วก่อนถึงจุดนี้

  // หน้า Hub (เลือกส่วนงาน) — แสดงเต็มจอ ไม่มี sidebar / toggle / bell
  if (location.pathname === '/') {
    return (
      <UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection, sections: userSections || [], position: userPosition, notifyEmail: userNotifyEmail, signatureUrl: userSignatureUrl, fullName: userFullName }}>
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--muted)', fontSize: 14, background: 'var(--bg)' }}>กำลังโหลด...</div>}>
          <DeptHub onLogout={handleLogout} theme={theme} onToggleTheme={onToggleTheme} userFullName={userFullName} userRole={role} userPosition={userPosition} />
        </Suspense>
      </UserContext.Provider>
    );
  }

  return (
    <UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection, sections: userSections || [], position: userPosition, notifyEmail: userNotifyEmail, signatureUrl: userSignatureUrl, fullName: userFullName }}>
      {warnSecsLeft !== null && (
        <AutoLogoutWarning secsLeft={warnSecsLeft} onStay={dismissWarning} onLogout={handleLogout} />
      )}
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <ToggleBtn isOpen={isOpen} onClick={() => setIsOpen(true)} />
        <NotificationBell userId={userId} />
        <Sidebar
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={onToggleTheme}
          userRole={role}
          userLineId={userLineId}
          userPosition={userPosition}
          userEmail={userEmail}
          userFullName={userFullName}
          userSignatureUrl={userSignatureUrl}
        />

        <main style={{
          flex: 1,
          marginLeft,
          minHeight: '100vh',
          paddingTop: 14,
          background: 'var(--bg)',
          transition: 'margin-left 0.3s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'auto',
          minWidth: 0,
        }}>
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลด...</div>}>
            <Routes>
              <Route path="/dashboard"  element={
                <RoleRoute path="/dashboard" userRole={role}><Dashboard /></RoleRoute>
              } />
              <Route path="/management" element={
                <RoleRoute path="/management" userRole={role}><Management /></RoleRoute>
              } />
              <Route path="/checkin"    element={
                <RoleRoute path="/checkin" userRole={role}><Checkin /></RoleRoute>
              } />
              <Route path="/report"     element={
                <RoleRoute path="/report" userRole={role}><Report /></RoleRoute>
              } />
              <Route path="/register"   element={
                <RoleRoute path="/register" userRole={role}><Register /></RoleRoute>
              } />
              <Route path="/operator"   element={
                <RoleRoute path="/operator" userRole={role}><Operator /></RoleRoute>
              } />
              <Route path="/linesetup"  element={
                <RoleRoute path="/linesetup" userRole={role}><LineSetup /></RoleRoute>
              } />
              <Route path="/machine-database" element={
                <RoleRoute path="/machine-database" userRole={role}><MachineDatabase /></RoleRoute>
              } />
              <Route path="/add-user"   element={
                <RoleRoute path="/add-user" userRole={role}><AddUser /></RoleRoute>
              } />
              <Route path="/org-setup"  element={
                <RoleRoute path="/org-setup" userRole={role}><OrgSetup /></RoleRoute>
              } />
              <Route path="/shift-organize" element={
                <RoleRoute path="/shift-organize" userRole={role}><ShiftOrganize /></RoleRoute>
              } />
              <Route path="/permissions" element={
                <RoleRoute path="/permissions" userRole={role}><PermissionsManagement /></RoleRoute>
              } />
              <Route path="/notification-config" element={
                <RoleRoute path="/notification-config" userRole={role}><NotificationConfig /></RoleRoute>
              } />
              <Route path="/daily-report"  element={
                <RoleRoute path="/daily-report" userRole={role}><DailyReport /></RoleRoute>
              } />
              <Route path="/oee-analytics" element={
                <RoleRoute path="/oee-analytics" userRole={role}><OEEAnalytics /></RoleRoute>
              } />
              <Route path="/daily-pm" element={
                <RoleRoute path="/daily-pm" userRole={role}><DailyPM /></RoleRoute>
              } />
              <Route path="/improvements" element={
                <RoleRoute path="/improvements" userRole={role}><Improvements /></RoleRoute>
              } />
              <Route path="/morning-meeting" element={
                <RoleRoute path="/morning-meeting" userRole={role}><MorningMeeting /></RoleRoute>
              } />
              <Route path="/event-log" element={
                <RoleRoute path="/event-log" userRole={role}><EventLog /></RoleRoute>
              } />
              <Route path="/qa" element={
                <RoleRoute path="/qa" userRole={role}><QualityControl /></RoleRoute>
              } />
              <Route path="/qa-setup" element={
                <RoleRoute path="/qa-setup" userRole={role}><QAInspectionSetup /></RoleRoute>
              } />
              <Route path="/products"   element={
                <RoleRoute path="/products" userRole={role}><ProductMaster /></RoleRoute>
              } />
              <Route path="/line-stock" element={
                <RoleRoute path="/line-stock" userRole={role}><LineStock /></RoleRoute>
              } />
              <Route path="/heijunka"  element={
                <RoleRoute path="/heijunka" userRole={role}><HeijunkaKanban /></RoleRoute>
              } />
              <Route path="/customer-demand" element={
                <RoleRoute path="/customer-demand" userRole={role}><CustomerDemand /></RoleRoute>
              } />
              <Route path="/planner-sales" element={
                <RoleRoute path="/planner-sales" userRole={role}><PlannerSales /></RoleRoute>
              } />
              <Route path="/rundown-stock" element={
                <RoleRoute path="/rundown-stock" userRole={role}><RundownStock /></RoleRoute>
              } />
              <Route path="/rack-center" element={
                <RoleRoute path="/rack-center" userRole={role}><RackCenter /></RoleRoute>
              } />
              <Route path="/company-calendar" element={
                <RoleRoute path="/company-calendar" userRole={role}><CompanyCalendar /></RoleRoute>
              } />
              <Route path="/pm-setup"    element={
                <RoleRoute path="/pm-setup" userRole={role}><PMSetup /></RoleRoute>
              } />
              <Route path="/pm-check"    element={
                <RoleRoute path="/pm-check" userRole={role}><PMCheckData /></RoleRoute>
              } />
              <Route path="/pm-schedule" element={
                <RoleRoute path="/pm-schedule" userRole={role}><PMSchedule /></RoleRoute>
              } />
              <Route path="/mtn-layout" element={
                <RoleRoute path="/mtn-layout" userRole={role}><MtnMachineLayout /></RoleRoute>
              } />
            </Routes>
          </Suspense>
        </main>
      </div>
    </UserContext.Provider>
  );
}

/* ─── App Root ─────────────────────────────────────────────────────────── */
export default function App() {
  const [session,      setSession]      = useState(undefined);
  const [userRole,     setUserRole]     = useState(null);
  const [userLineId,   setUserLineId]   = useState(null);
  const [userTeam,     setUserTeam]     = useState(null);
  const [userSection,  setUserSection]  = useState(null);
  const [userPosition, setUserPosition] = useState(null); // ตำแหน่งงานจริง (แสดงผลเท่านั้น ไม่เกี่ยวกับสิทธิ์)
  // ขอบเขตหลายส่วนงาน (จาก profiles.sections + fallback section เดี่ยวของ supervisor) — [] = ไม่จำกัด
  const [userSections, setUserSections] = useState([]);
  const [userEmail,        setUserEmail]        = useState(null);
  const [userFullName,     setUserFullName]     = useState(null);
  const [userNotifyEmail,  setUserNotifyEmail]  = useState(null);
  const [userSignatureUrl, setUserSignatureUrl] = useState(null);
  const [showSplash,   setShowSplash]   = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('4m-theme') || 'dark');
  // ต้อง resolve ทั้ง profile (role จริง) และ permissions ก่อนค่อย render route tree —
  // ป้องกัน fail-open: ห้าม fallback เป็น 'admin' ระหว่างรอโหลด (เคยเป็นช่องโหว่)
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [permsLoaded,   setPermsLoaded]   = useState(false);
  // bump เมื่อ role_permissions เปลี่ยน (realtime) เพื่อให้ sidebar/route ที่อ่าน cache แบบ sync re-render
  const [permsVersion,  setPermsVersion]  = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('4m-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const fetchProfile = async (user) => {
    setUserEmail(user.email ?? null);
    const { data, error } = await supabase.from('profiles').select('role, line_id, full_name, team, section, sections, position, notify_email, signature_url').eq('id', user.id).single();
    // fail-visible: โหลดโปรไฟล์ไม่ได้ = แอปใช้งานไม่ได้อยู่ดี (role null → เมนูหาย, query ฝั่ง Main
    // ล้มหมด กลายเป็น "หน้าผี") — ห้ามปล่อย render ต่อแบบไม่มี role
    if (error || !data) {
      const authBroken = !data && !error                       // query ผ่านแต่ไม่มีแถว = user ถูกลบ
        || error?.code === 'PGRST116'                          // 0 rows
        || error?.status === 401 || error?.status === 403
        || /jwt|token|expired/i.test(error?.message || '');
      if (authBroken) {
        // token เสีย/user ถูกลบ → เคลียร์ session ฝั่ง client ให้เด้งไปหน้า login
        try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* token เสียอยู่แล้ว */ }
      }
      // error อื่น (เช่น network สะดุด) → ค้างที่ "กำลังโหลด..." ให้ผู้ใช้ F5 — ไม่ signOut
      // เพราะ localStorage แชร์ข้ามแท็บ เดี๋ยวพาแท็บอื่นที่ดีๆ อยู่หลุดไปด้วย
      return;
    }
    setUserRole(data?.role ?? null);
    setUserLineId(data?.line_id ?? null);
    setUserFullName(data?.full_name ?? null);
    setUserTeam(data?.team ?? null);
    setUserSection(data?.section ?? null);
    setUserPosition(data?.position ?? null);
    setUserSections(effectiveSections(data?.role, data?.sections, data?.section));
    setUserNotifyEmail(data?.notify_email ?? null);
    setUserSignatureUrl(data?.signature_url ?? null);
    setProfileLoaded(true);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user);
        loadPermissions().then(() => setPermsLoaded(true));
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        fetchProfile(s.user);
        loadPermissions().then(() => setPermsLoaded(true));
      } else {
        setUserRole(null); setUserLineId(null); setUserTeam(null); setUserSection(null); setUserSections([]); setUserPosition(null); setUserEmail(null); setUserFullName(null); setUserNotifyEmail(null); setUserSignatureUrl(null);
        setProfileLoaded(false); setPermsLoaded(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // admin แก้สิทธิ์ที่หน้า จัดการสิทธิ์ → ทุกเครื่องที่เปิดอยู่รีเฟรช cache + re-render ทันที
  useEffect(() => {
    if (!session?.user) return;
    const ch = supabase
      .channel('role-permissions-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_permissions' }, async () => {
        await loadPermissions(true);
        setPermsVersion(v => v + 1);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session?.user?.id]);

  return (
    <>
      <div id="noise-overlay" />

      {showSplash && (
        <SplashScreen onDone={() => {
          const el = document.getElementById('splash');
          el?.classList.add('hidden');
          setTimeout(() => setShowSplash(false), 950);
        }} />
      )}

      {session === undefined || (session && (!profileLoaded || !permsLoaded)) ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontSize: 14 }}>
          กำลังโหลด...
        </div>
      ) : (
        <Router>
          <Routes>
            <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
            <Route path="/*"     element={
              <ProtectedLayout
                session={session}
                theme={theme}
                onToggleTheme={toggleTheme}
                permsVersion={permsVersion}
                userRole={userRole}
                userLineId={userLineId}
                userTeam={userTeam}
                userSection={userSection}
                userSections={userSections}
                userPosition={userPosition}
                userEmail={userEmail}
                userFullName={userFullName}
                userNotifyEmail={userNotifyEmail}
                userSignatureUrl={userSignatureUrl}
              />
            } />
          </Routes>
        </Router>
      )}
      <ToastContainer />
    </>
  );
}
