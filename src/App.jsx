import { createContext, useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { fmtDateTime } from './utils/dateFormat';
import tsLogo from './assets/TS logo.png';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { ToastContainer } from './components/Toast';
import Login from './pages/Login';
import SignatureModal from './components/SignatureModal';
import ChangePasswordModal from './components/ChangePasswordModal';

const Register     = lazy(() => import('./pages/Register'));
const Checkin      = lazy(() => import('./pages/Checkin'));
const Management   = lazy(() => import('./pages/Management'));
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Operator     = lazy(() => import('./pages/operator'));
const LineSetup    = lazy(() => import('./pages/LineSetup'));
const AddUser      = lazy(() => import('./pages/AddUser'));
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

/* ─── Role System ──────────────────────────────────────────── */
export const UserContext = createContext({ role: 'admin', lineId: null, team: null, section: null, notifyEmail: null, signatureUrl: null, fullName: null });

const ROLE_LABELS = {
  admin:      '👑 Admin',
  manager:    '🏢 Manager',
  supervisor: '🎯 Supervisor',
  leader:     '⭐ Leader',
  qa:         '🔍 QA',
  document_control: '🗂 Doc Control',
};

// null roles = accessible to every role
// group ใช้จัดหมวดหมู่ในแถบ sidebar (มี minimize/expand ต่อหมวด)
const NAV_ITEMS = [
  { to: '/',            icon: '🏠', label: 'หน้าหลัก',           roles: null, group: 'ภาพรวม' },
  { to: '/dashboard',   icon: '📊', label: 'Dashboard',           roles: null, group: 'ภาพรวม' },

  { to: '/management',  icon: '🔄', label: 'จัดการสายผลิต',      roles: null, group: 'การผลิต' },
  { to: '/checkin',     icon: '📝', label: 'เช็คชื่อ & PPE',     roles: null, group: 'การผลิต' },
  { to: '/daily-report',   icon: '📊', label: 'Daily Report',      roles: null, group: 'การผลิต' },
  { to: '/oee-analytics',  icon: '📈', label: 'OEE Analytics',      roles: null, group: 'การผลิต' },
  { to: '/products',        icon: '🔩', label: 'Product Master',    roles: null, group: 'การผลิต' },
  { to: '/line-stock',      icon: '📦', label: 'Line Stock',         roles: null, group: 'การผลิต' },
  { to: '/heijunka',       icon: '🎴', label: 'Heijunka Kanban',   roles: null, group: 'การผลิต' },

  { to: '/report',        icon: '📋', label: 'รายงาน',            roles: null, group: 'รายงาน/คุณภาพ' },
  { to: '/event-log',      icon: '⚡', label: 'CQI-15 Event Log', roles: ['admin', 'manager', 'supervisor', 'leader', 'qa'], group: 'รายงาน/คุณภาพ' },

  { to: '/linesetup',  icon: '⚙️',  label: 'ตั้งค่าผังไลน์',   roles: ['admin', 'manager', 'supervisor'], group: 'บริหารจัดการ' },
  { to: '/register',   icon: '➕', label: 'เพิ่มพนักงาน',      roles: ['admin', 'manager', 'supervisor'], group: 'บริหารจัดการ' },
  { to: '/operator',   icon: '👥', label: 'ฐานข้อมูลพนักงาน',  roles: ['admin', 'manager', 'supervisor', 'leader'], group: 'บริหารจัดการ' },
  { to: '/shift-organize', icon: '🗓', label: 'ตารางกะ',         roles: ['admin', 'manager', 'supervisor'], group: 'บริหารจัดการ' },
  { to: '/company-calendar', icon: '📅', label: 'ปฏิทินบริษัท',    roles: null, group: 'บริหารจัดการ' },
];

const NAV_GROUP_ORDER = ['ภาพรวม', 'การผลิต', 'รายงาน/คุณภาพ', 'บริหารจัดการ'];

const canAccess = (role, roles) => !roles || roles.includes(role ?? 'admin');

/* ─── Role Route Guard ────────────────────────────────────── */
function RoleRoute({ children, allow, userRole }) {
  if (!allow.includes(userRole ?? 'admin')) return <Navigate to="/" replace />;
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
            fontFamily: 'var(--font-display)', fontSize: 10,
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
function Sidebar({ isOpen, onClose, onLogout, theme, onToggleTheme, userRole, userLineId, userEmail, userFullName, userSignatureUrl }) {
  const location = useLocation();
  const isMobile = window.innerWidth <= 768;
  const [sigModalOpen,  setSigModalOpen]  = useState(false);
  const [sigUrl,        setSigUrl]        = useState(userSignatureUrl);
  const [pwdModalOpen,  setPwdModalOpen]  = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nav_collapsed_groups') || '{}'); } catch { return {}; }
  });

  useEffect(() => { setSigUrl(userSignatureUrl); }, [userSignatureUrl]);

  const toggleGroup = (g) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [g]: !prev[g] };
      localStorage.setItem('nav_collapsed_groups', JSON.stringify(next));
      return next;
    });
  };

  const visibleItems = NAV_ITEMS.filter(item => canAccess(userRole, item.roles));
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
        {/* Logo */}
        <div style={{ padding: '18px 6px 16px', borderBottom: '1px solid var(--border)', marginBottom: 10, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={tsLogo} alt="Thai Summit Group" width={28} height={28} style={{ borderRadius: 3, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 10, letterSpacing: '2px', color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, fontFamily: 'var(--font-display)' }}>Thai Summit</div>
              <div style={{ fontSize: 9, letterSpacing: '1.5px', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>ESM · Shopfloor</div>
            </div>
          </div>
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
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group}</span>
                  <span style={{ fontSize: 10, transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>▾</span>
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

          {canAccess(userRole, ['admin']) && (
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
                {userEmail || ''}
              </div>
            </div>
            <div style={{
              fontSize: 10, fontWeight: 700, padding: '2px 6px',
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
            fontSize: 10, fontWeight: 800,
            minWidth: 17, height: 17, borderRadius: 9,
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
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
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

/* ─── Toggle Button ──────────────────────────────────────────── */
function ToggleBtn({ isOpen, sidebarW, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed', top: 14,
        left: isOpen ? sidebarW + 10 : 14,
        zIndex: 1100,
        width: 34, height: 34, borderRadius: 8,
        background: 'var(--bg3)',
        border: '1px solid var(--border2)',
        color: 'var(--text2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15,
        transition: 'left 0.3s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {isOpen ? '✕' : '☰'}
    </button>
  );
}

/* ─── Protected Layout ─────────────────────────────────────────────── */
function ProtectedLayout({ session, theme, onToggleTheme, userRole, userLineId, userTeam, userSection, userEmail, userFullName, userNotifyEmail, userSignatureUrl }) {
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
    await supabase.auth.signOut();
    navigate('/login');
  };

  const sidebarPx  = isTV ? 280 : 240;
  const marginLeft = (!isMobile && isOpen) ? sidebarPx : 0;
  const role       = userRole ?? 'admin';

  // หน้า Hub (เลือกส่วนงาน) — แสดงเต็มจอ ไม่มี sidebar / toggle / bell
  if (location.pathname === '/') {
    return (
      <UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection, notifyEmail: userNotifyEmail, signatureUrl: userSignatureUrl, fullName: userFullName }}>
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--muted)', fontSize: 14, background: 'var(--bg)' }}>กำลังโหลด...</div>}>
          <DeptHub onLogout={handleLogout} theme={theme} onToggleTheme={onToggleTheme} userFullName={userFullName} userRole={role} />
        </Suspense>
      </UserContext.Provider>
    );
  }

  return (
    <UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection, notifyEmail: userNotifyEmail, signatureUrl: userSignatureUrl, fullName: userFullName }}>
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <ToggleBtn isOpen={isOpen} sidebarW={sidebarPx} onClick={() => setIsOpen(o => !o)} />
        <NotificationBell userId={userId} />
        <Sidebar
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={onToggleTheme}
          userRole={role}
          userLineId={userLineId}
          userEmail={userEmail}
          userFullName={userFullName}
          userSignatureUrl={userSignatureUrl}
        />

        <main style={{
          flex: 1,
          marginLeft,
          minHeight: '100vh',
          paddingTop: 60,
          background: 'var(--bg)',
          transition: 'margin-left 0.3s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'auto',
          minWidth: 0,
        }}>
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลด...</div>}>
            <Routes>
              <Route path="/dashboard"  element={<Dashboard />} />
              <Route path="/management" element={<Management />} />
              <Route path="/checkin"    element={<Checkin />} />
              <Route path="/report"     element={<Report />} />
              <Route path="/register"   element={
                <RoleRoute allow={['admin', 'supervisor']} userRole={role}><Register /></RoleRoute>
              } />
              <Route path="/operator"   element={
                <RoleRoute allow={['admin', 'manager', 'supervisor', 'leader']} userRole={role}><Operator /></RoleRoute>
              } />
              <Route path="/linesetup"  element={
                <RoleRoute allow={['admin', 'manager', 'supervisor']} userRole={role}><LineSetup /></RoleRoute>
              } />
              <Route path="/add-user"   element={
                <RoleRoute allow={['admin']} userRole={role}><AddUser /></RoleRoute>
              } />
              <Route path="/shift-organize" element={
                <RoleRoute allow={['admin', 'manager', 'supervisor']} userRole={role}><ShiftOrganize /></RoleRoute>
              } />
              <Route path="/daily-report"  element={<DailyReport />} />
              <Route path="/oee-analytics" element={<OEEAnalytics />} />
              <Route path="/event-log" element={<EventLog />} />
              <Route path="/products"   element={<ProductMaster />} />
              <Route path="/line-stock" element={<LineStock />} />
              <Route path="/heijunka"  element={<HeijunkaKanban />} />
              <Route path="/company-calendar" element={<CompanyCalendar />} />
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
  const [userEmail,        setUserEmail]        = useState(null);
  const [userFullName,     setUserFullName]     = useState(null);
  const [userNotifyEmail,  setUserNotifyEmail]  = useState(null);
  const [userSignatureUrl, setUserSignatureUrl] = useState(null);
  const [showSplash,   setShowSplash]   = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('4m-theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('4m-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const fetchProfile = async (user) => {
    setUserEmail(user.email ?? null);
    const { data } = await supabase.from('profiles').select('role, line_id, full_name, team, section, notify_email, signature_url').eq('id', user.id).single();
    setUserRole(data?.role ?? 'admin');
    setUserLineId(data?.line_id ?? null);
    setUserFullName(data?.full_name ?? null);
    setUserTeam(data?.team ?? null);
    setUserSection(data?.section ?? null);
    setUserNotifyEmail(data?.notify_email ?? null);
    setUserSignatureUrl(data?.signature_url ?? null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) fetchProfile(session.user);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) fetchProfile(s.user);
      else { setUserRole(null); setUserLineId(null); setUserTeam(null); setUserSection(null); setUserEmail(null); setUserFullName(null); setUserNotifyEmail(null); setUserSignatureUrl(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

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

      {session === undefined ? (
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
                userRole={userRole}
                userLineId={userLineId}
                userTeam={userTeam}
                userSection={userSection}
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
