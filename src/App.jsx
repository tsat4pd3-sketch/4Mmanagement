import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import Login from './pages/Login';
import Register from './pages/Register';
import Checkin from './pages/Checkin';
import Management from './pages/Management';
import Dashboard from './pages/Dashboard';
import Operator from './pages/operator';
import LineSetup from './pages/LineSetup';

function ProtectedLayout({ session }) {
  const [isOpen, setIsOpen] = useState(window.innerWidth > 768);
  const navigate = useNavigate();

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) setIsOpen(false);
      else setIsOpen(true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  if (!session) return <Navigate to="/login" replace />;

  const toggleSidebar = () => setIsOpen(!isOpen);
  const sidebarWidth = isOpen ? '240px' : '0px';

  return (
    <div style={{ display: 'flex', width: '100vw', minHeight: '100vh', backgroundColor: '#f0f2f5', overflowX: 'hidden' }}>

      <button
        onClick={toggleSidebar}
        style={{
          position: 'fixed', top: '15px', left: isOpen ? '255px' : '15px',
          zIndex: 1100, padding: '10px 15px', borderRadius: '8px',
          backgroundColor: '#2c3e50', color: 'white', border: 'none', cursor: 'pointer',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)', fontSize: '16px'
        }}
      >
        {isOpen ? '❮ Hide' : '❯ Show Menu'}
      </button>

      <nav style={{
        width: sidebarWidth, minWidth: sidebarWidth, backgroundColor: '#1a252f', color: 'white',
        display: 'flex', flexDirection: 'column', padding: isOpen ? '70px 15px 20px 15px' : '0px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', overflow: 'hidden',
        position: 'fixed', height: '100vh', zIndex: 1000, boxShadow: isOpen ? '4px 0 15px rgba(0,0,0,0.1)' : 'none'
      }}>
        <h2 style={{ fontSize: '22px', marginBottom: '30px', whiteSpace: 'nowrap', textAlign: 'center' }}>🏭 4M System</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Link to="/" onClick={() => window.innerWidth <= 768 && setIsOpen(false)} style={navLinkStyle}>📊 สรุปผล (Dashboard)</Link>
          <Link to="/management" onClick={() => window.innerWidth <= 768 && setIsOpen(false)} style={navLinkStyle}>🔄 จัดการสายผลิต</Link>
          <Link to="/checkin" onClick={() => window.innerWidth <= 768 && setIsOpen(false)} style={navLinkStyle}>📝 เช็คชื่อ & PPE</Link>
          <Link to="/linesetup" onClick={() => window.innerWidth <= 768 && setIsOpen(false)} style={{ ...navLinkStyle, backgroundColor: '#34495e' }}>⚙️ ตั้งค่าผังไลน์ (Setup)</Link>
          <Link to="/register" onClick={() => window.innerWidth <= 768 && setIsOpen(false)} style={navLinkStyle}>➕ เพิ่มพนักงาน</Link>
          <Link to="/operator" onClick={() => window.innerWidth <= 768 && setIsOpen(false)} style={navLinkStyle}>👥 ฐานข้อมูลพนักงาน</Link>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <button onClick={handleLogout} style={{ ...navLinkStyle, color: '#ff7675', background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
            🚪 ออกจากระบบ
          </button>
        </div>
      </nav>

      <main style={{
        flex: 1, marginLeft: sidebarWidth, width: `calc(100% - ${sidebarWidth})`,
        padding: '20px', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        minHeight: '100vh', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ width: '100%', height: '100%', flex: 1 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/register" element={<Register />} />
            <Route path="/checkin" element={<Checkin />} />
            <Route path="/management" element={<Management />} />
            <Route path="/operator" element={<Operator />} />
            <Route path="/linesetup" element={<LineSetup />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f0f2f5' }}>
        <p style={{ fontSize: '18px', color: '#555' }}>กำลังโหลด...</p>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/*" element={<ProtectedLayout session={session} />} />
      </Routes>
    </Router>
  );
}

const navLinkStyle = {
  color: '#ecf0f1',
  textDecoration: 'none',
  padding: '12px 15px',
  borderRadius: '8px',
  display: 'block',
  fontSize: '15px',
  transition: 'all 0.2s',
  marginBottom: '4px',
};

export default App;
