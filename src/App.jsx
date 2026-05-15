import { createContext, useState, useEffect, useRef, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient';
import Login from './pages/Login';
import Register from './pages/Register';
import Checkin from './pages/Checkin';
import Management from './pages/Management';
import Dashboard from './pages/Dashboard';
import Operator from './pages/operator';
import LineSetup from './pages/LineSetup';
import AddUser from './pages/AddUser';
import Report from './pages/Report';

/* ─── Role System ────────────────────────────────────────── */
export const UserContext = createContext({ role: 'admin', lineId: null });

const ROLE_LABELS = {
  admin:      '👑 Admin',
  manager:    '🏢 Manager',
  supervisor: '🎯 Supervisor',
  leader:     '⭐ Leader',
};

// null roles = accessible to every role
const NAV_ITEMS = [
  { to: '/',           icon: '📊', label: 'Dashboard',          roles: null },
  { to: '/management', icon: '🔄', label: 'จัดการสายผลิต',     roles: null },
  { to: '/checkin',    icon: '📝', label: 'เช็คชื่อ & PPE',    roles: null },
  { to: '/linesetup',  icon: '⚙️',  label: 'ตั้งค่าผังไลน์',   roles: ['admin'] },
  { to: '/register',   icon: '➕', label: 'เพิ่มพนักงาน',      roles: ['admin'] },
  { to: '/operator',   icon: '👥', label: 'ฐานข้อมูลพนักงาน',  roles: ['admin', 'manager'] },
  { to: '/report',     icon: '📋', label: 'รายงาน',             roles: null },
];

const canAccess = (role, roles) => !roles || roles.includes(role ?? 'admin');

/* ─── Role Route Guard ───────────────────────────────────── */
function RoleRoute({ children, allow, userRole }) {
  if (!allow.includes(userRole ?? 'admin')) return <Navigate to="/" replace />;
  return children;
}

/* ─── Splash Screen ─────────────────────────────────────── */
function SplashScreen({ onDone }) {
  const barRef = useRef(null);

  useEffect(() => {
    ['s0','s1','s2','s3'].forEach((id, i) => {
      setTimeout(() => document.getElementById(id)?.classList.add('up'), 120 + i * 120);
    });
    setTimeout(() => document.getElementById('splash-sub')?.classList.add('up'), 800);

    let w = 0;
    const iv = setInterval(() => {
      w = Math.min(w + 3, 100);
      if (barRef.current) barRef.current.style.width = w + '%';
      if (w >= 100) { clearInterval(iv); setTimeout(onDone, 300); }
    }, 20);

    return () => clearInterval(iv);
  }, [onDone]);

  return (
    <div id="splash">
      <div className="splash-letters">
        <span className="splash-letter" id="s0">4</span>
        <span className="splash-letter red" id="s1">M</span>
        <span className="splash-letter dim" id="s2">&nbsp;</span>
        <span className="splash-letter" id="s3">System</span>
      </div>
      <div className="splash-sub" id="splash-sub">Production Intelligence</div>
      <div className="splash-bar-wrap">
        <div className="splash-bar-fill" ref={barRef} />
      </div>
    </div>
  );
}

/* ─── Cursor Effect ─────────────────────────────────────── */
function useCursor() {
  useEffect(() => {
    const dot  = document.getElementById('cursor');
    const ring = document.getElementById('cursor-ring');
    if (!dot || !ring) return;
    if (!window.matchMedia('(hover: hover)').matches) return;

    dot.style.display  = 'block';
    ring.style.display = 'block';

    let mx = 0, my = 0, rx = 0, ry = 0;

    const onMove = (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx + 'px';
      dot.style.top  = my + 'px';
    };
    document.addEventListener('mousemove', onMove);

    let rafId;
    const animRing = () => {
      rx += (mx - rx) * 0.12;
      ry += (my - ry) * 0.12;
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
      rafId = requestAnimationFrame(animRing);
    };
    rafId = requestAnimationFrame(animRing);

    return () => {
      document.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(rafId);
    };
  }, []);
}

/* ─── Sidebar ────────────────────────────────────────────── */
function Sidebar({ isOpen, onClose, onLogout, theme, onToggleTheme, userRole, userLineId }) {
  const location = useLocation();
  const isMobile = window.innerWidth <= 768;

  const visibleItems = NAV_ITEMS.filter(item => canAccess(userRole, item.roles));

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
        <div style={{ padding: '22px 6px 18px', borderBottom: '1px solid var(--border)', marginBottom: 10, whiteSpace: 'nowrap' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--accent)', fontSize: 22 }}>4M</span>
            <span style={{ color: 'var(--text2)', fontWeight: 400, fontSize: 13 }}>System</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.1em' }}>PRODUCTION INTELLIGENCE</div>
        </div>

        {/* Links */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className="nav-link"
              style={location.pathname === item.to
                ? { background: 'rgba(227,25,55,0.12)', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }
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
                  ? { background: 'rgba(245,158,11,0.12)', color: 'var(--amber)' }
                  : { color: 'var(--amber)' }}
                onClick={() => isMobile && onClose()}
              >
                <span style={{ fontSize: 15 }}>🔑</span>
                <span style={{ whiteSpace: 'nowrap' }}>จัดการผู้ใช้งาน</span>
              </Link>
            </div>
          )}
        </div>

        {/* Footer: Role badge + Theme toggle + Logout */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {userRole && (
            <div style={{
              fontSize: 11, color: 'var(--text2)', padding: '5px 8px',
              borderRadius: 6, background: 'var(--bg3)',
              border: '1px solid var(--border2)',
              textAlign: 'center', whiteSpace: 'nowrap',
              letterSpacing: '0.04em', fontWeight: 600,
            }}>
              {ROLE_LABELS[userRole] ?? userRole}
            </div>
          )}

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
              background: theme === 'dark' ? 'var(--border2)' : 'var(--accent)',
              position: 'relative',
              transition: 'background 0.25s',
            }}>
              <div style={{
                position: 'absolute', top: 2,
                left: theme === 'dark' ? 2 : 18,
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
    </>
  );
}

/* ─── Toggle Button ──────────────────────────────────────── */
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

/* ─── Protected Layout ───────────────────────────────────── */
function ProtectedLayout({ session, theme, onToggleTheme, userRole, userLineId }) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const isTV     = typeof window !== 'undefined' && window.innerWidth >= 1920;
  const [isOpen, setIsOpen] = useState(!isMobile);
  const navigate = useNavigate();

  useCursor();

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
    <UserContext.Provider value={{ role, lineId: userLineId }}>
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
          <Routes>
            <Route path="/"           element={<Dashboard />} />
            <Route path="/management" element={<Management />} />
            <Route path="/checkin"    element={<Checkin />} />
            <Route path="/report"     element={<Report />} />
            <Route path="/register"   element={
              <RoleRoute allow={['admin']} userRole={role}><Register /></RoleRoute>
            } />
            <Route path="/operator"   element={
              <RoleRoute allow={['admin', 'manager']} userRole={role}><Operator /></RoleRoute>
            } />
            <Route path="/linesetup"  element={
              <RoleRoute allow={['admin']} userRole={role}><LineSetup /></RoleRoute>
            } />
            <Route path="/add-user"   element={
              <RoleRoute allow={['admin']} userRole={role}><AddUser /></RoleRoute>
            } />
          </Routes>
        </main>
      </div>
    </UserContext.Provider>
  );
}

/* ─── App Root ───────────────────────────────────────────── */
export default function App() {
  const [session,    setSession]    = useState(undefined);
  const [userRole,   setUserRole]   = useState(null);
  const [userLineId, setUserLineId] = useState(null);
  const [showSplash, setShowSplash] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('4m-theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('4m-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const fetchProfile = async (userId) => {
    const { data } = await supabase.from('profiles').select('role, line_id').eq('id', userId).single();
    setUserRole(data?.role ?? 'admin');
    setUserLineId(data?.line_id ?? null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) fetchProfile(session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user?.id) fetchProfile(s.user.id);
      else { setUserRole(null); setUserLineId(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
      <div id="cursor"      style={{ display: 'none' }} />
      <div id="cursor-ring" style={{ display: 'none' }} />
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
              />
            } />
          </Routes>
        </Router>
      )}
    </>
  );
}
