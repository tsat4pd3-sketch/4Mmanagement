import { createContext, useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { ToastContainer } from './components/Toast';
import Login from './pages/Login';
import SignatureModal from './components/SignatureModal';

const Register     = lazy(() => import('./pages/Register'));
const Checkin      = lazy(() => import('./pages/Checkin'));
const Management   = lazy(() => import('./pages/Management'));
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Operator     = lazy(() => import('./pages/operator'));
const LineSetup    = lazy(() => import('./pages/LineSetup'));
const AddUser      = lazy(() => import('./pages/AddUser'));
const Report       = lazy(() => import('./pages/Report'));
const ShiftOrganize = lazy(() => import('./pages/ShiftOrganize'));

/* ─── Role System ──────────────────────────────────────────── */
export const UserContext = createContext({ role: 'admin', lineId: null, team: null, section: null, notifyEmail: null, signatureUrl: null, fullName: null });

const ROLE_LABELS = {
  admin:      '👑 Admin',
  manager:    '🏢 Manager',
  supervisor: '🎯 Supervisor',
  leader:     '⭐ Leader',
  qa:         '🔍 QA',
};

// null roles = accessible to every role
const NAV_ITEMS = [
  { to: '/',           icon: '📊', label: 'Dashboard',          roles: null },
  { to: '/management', icon: '🔄', label: 'จัดการสายผลิต',     roles: null },
  { to: '/checkin',    icon: '📝', label: 'เช็คชื่อ & PPE',    roles: null },
  { to: '/linesetup',  icon: '⚙️',  label: 'ตั้งค่าผังไลน์',   roles: ['admin', 'manager', 'supervisor'] },
  { to: '/register',   icon: '➕', label: 'เพิ่มพนักงาน',      roles: ['admin', 'manager', 'supervisor'] },
  { to: '/operator',   icon: '👥', label: 'ฐานข้อมูลพนักงาน',  roles: ['admin', 'manager', 'supervisor', 'leader'] },
  { to: '/report',        icon: '📋', label: 'รายงาน',            roles: null },
  { to: '/shift-organize', icon: '🗓', label: 'ตารางกะ',         roles: ['admin', 'manager', 'supervisor'] },
];

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
        <div style={{
          width: 52, height: 52, background: 'var(--accent)', borderRadius: 5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 30px rgba(61,214,92,0.3)',
        }}>
          <svg width="28" height="26" viewBox="0 0 28 26" fill="none">
            <path d="M14 1L27 25H1L14 1Z" fill="rgba(255,255,255,0.95)"/>
            <path d="M14 9L21 25H7L14 9Z" fill="#080f08"/>
          </svg>
        </div>
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
        fontSize: 'clamp(2.5rem,8vw,5rem)', letterSpacing: '-1px',
        color: 'var(--accent)', lineHeight: 1,
      }}>
        4M System
      </div>

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
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [sigUrl, setSigUrl] = useState(userSignatureUrl);

  useEffect(() => { setSigUrl(userSignatureUrl); }, [userSignatureUrl]);

  const visibleItems = NAV_ITEMS.filter(item => canAccess(userRole, item.roles));
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
            <div style={{ width: 28, height: 28, background: 'var(--accent)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="13" viewBox="0 0 14 13" fill="none">
                <path d="M7 1L13 12H1L7 1Z" fill="rgba(255,255,255,0.92)"/>
                <path d="M7 5L10 12H4L7 5Z" fill="var(--bg2)"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 8, letterSpacing: '2px', color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, fontFamily: 'var(--font-display)' }}>Thai Summit</div>
              <div style={{ fontSize: 7, letterSpacing: '1.5px', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>4M · VX System</div>
            </div>
          </div>
        </div>

        {/* Links */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className="nav-link"
              style={location.pathname === item.to
                ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }
                : {}}
              onClick={() => isMobile && onClose()}
            >
              <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
            </Link>
          ))}

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
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {userFullName || (userEmail?.split('@')[0]) || 'Unknown'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {userEmail || ''}
              </div>
            </div>
            <div style={{
              fontSize: 9, fontWeight: 700, padding: '2px 5px',
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
    </>
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

  return (
    <UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection, notifyEmail: userNotifyEmail, signatureUrl: userSignatureUrl, fullName: userFullName }}>
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <ToggleBtn isOpen={isOpen} sidebarW={sidebarPx} onClick={() => setIsOpen(o => !o)} />
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
          overflow: 'hidden',
        }}>
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลด...</div>}>
            <Routes>
              <Route path="/"           element={<Dashboard />} />
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
