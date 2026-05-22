import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

const TriangleLogo = ({ size = 48 }) => (
  <div style={{
    width: size, height: size,
    background: 'var(--accent)',
    borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 4px 20px rgba(61,214,92,0.25)',
  }}>
    <svg width={size * 0.58} height={size * 0.52} viewBox="0 0 28 26" fill="none">
      <path d="M14 1L27 25H1L14 1Z" fill="rgba(255,255,255,0.95)"/>
      <path d="M14 9L21 25H7L14 9Z" fill="var(--bg2)"/>
    </svg>
  </div>
);

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
        borderRadius: 'var(--radius-lg)',
        padding: '40px 36px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* VX Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <TriangleLogo size={52} />
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 11, letterSpacing: '3px',
            color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4,
          }}>
            Thai Summit Group
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 18, letterSpacing: '1px', color: 'var(--text)',
          }}>
            4M · VX Production System
          </div>
          <div style={{
            fontSize: 10, color: 'var(--muted)', marginTop: 4,
            letterSpacing: '2px', textTransform: 'uppercase',
            fontFamily: 'var(--font-display)',
          }}>
            Zero defect is possible
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 24 }} />

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              color: 'var(--muted)', marginBottom: 6,
              letterSpacing: '2px', textTransform: 'uppercase',
              fontFamily: 'var(--font-display)',
            }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="user@thaisummit.com" required autoComplete="email" />
          </div>

          <div>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              color: 'var(--muted)', marginBottom: 6,
              letterSpacing: '2px', textTransform: 'uppercase',
              fontFamily: 'var(--font-display)',
            }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required autoComplete="current-password" />
          </div>

          {error && (
            <div style={{
              fontSize: 13, color: 'var(--red)',
              background: 'rgba(224,92,74,0.1)',
              border: '1px solid rgba(224,92,74,0.25)',
              borderRadius: 'var(--radius)', padding: '10px 14px',
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 6, padding: '13px',
            background: loading ? 'var(--muted)' : 'var(--accent)',
            color: loading ? 'var(--text2)' : '#0a1f0c',
            border: 'none', borderRadius: 'var(--radius)',
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 14, letterSpacing: '2px', textTransform: 'uppercase',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}>
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'SIGN IN'}
          </button>
        </form>

        {/* Brand footer */}
        <div style={{
          marginTop: 28, textAlign: 'center',
          fontSize: 9, color: 'var(--muted2)',
          fontFamily: 'var(--font-display)',
          letterSpacing: '1.5px', textTransform: 'uppercase',
        }}>
          Thai Summit Group — VX Production Intelligence
        </div>
      </div>
    </div>
  );
}
