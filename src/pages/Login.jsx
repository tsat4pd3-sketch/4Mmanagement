import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else navigate('/');
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--card)',
        border: '1px solid var(--border2)',
        borderRadius: 16,
        padding: '40px 36px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--accent)' }}>4M</span>
            <span style={{ color: 'var(--text)', marginLeft: 6 }}>System</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Production Intelligence
          </div>
        </div>

        <div style={{ height: 2, background: 'var(--accent)', borderRadius: 2, marginBottom: 28, opacity: 0.7 }} />

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Email
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@company.com" required autoComplete="email" />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Password
            </label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)', borderRadius: 8, padding: '10px 14px' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8, padding: '13px',
              background: loading ? 'var(--muted)' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, letterSpacing: '0.04em',
            }}
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'SIGN IN'}
          </button>
        </form>
      </div>
    </div>
  );
}
