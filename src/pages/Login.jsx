import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import tsLogo from '../assets/TS logo.png';

const ThaiSummitLogo = ({ size = 48 }) => (
  <img
    src={tsLogo}
    alt="Thai Summit Group"
    width={size}
    height={size}
    style={{ flexShrink: 0, display: 'block' }}
  />
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
    if (!error) { setLoading(false); navigate('/'); return; }

    // แปล error เป็นไทย + แยกประเภท "ไม่พบบัญชี" vs "รหัสผ่านผิด" (คำสั่ง user 2026-07-14)
    // ใช้ RPC login_email_exists (security definer ฝั่ง server) เช็คว่าอีเมลนี้มีบัญชีจริงมั้ย
    const m = (error.message || '').toLowerCase();
    let msg;
    if (m.includes('invalid login credentials')) {
      const { data: exists, error: rpcErr } = await supabase.rpc('login_email_exists', { p_email: email });
      if (rpcErr || exists === null) msg = '❌ อีเมลหรือรหัสผ่านไม่ถูกต้อง';
      else if (exists === false)     msg = `❌ ไม่พบบัญชี "${email}" ในระบบ — ตรวจตัวสะกดอีเมล หรือติดต่อ admin ให้สร้างบัญชี`;
      else                           msg = '🔒 อีเมลถูกต้อง แต่รหัสผ่านไม่ถูกต้อง — ลองใหม่ หรือให้ admin รีเซ็ตรหัสผ่านให้';
    } else if (m.includes('email not confirmed')) {
      msg = '📧 บัญชีนี้ยังไม่ถูกยืนยัน — ติดต่อ admin';
    } else if (error.status === 429 || m.includes('too many') || m.includes('rate limit')) {
      msg = '⏳ ลองเข้าระบบผิดหลายครั้งเกินไป — พักสักครู่แล้วลองใหม่';
    } else if (m.includes('failed to fetch') || m.includes('network')) {
      msg = '📡 เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
    } else {
      msg = 'เข้าสู่ระบบไม่สำเร็จ: ' + error.message;
    }
    setError(msg);
    setLoading(false);
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
            <ThaiSummitLogo size={64} />
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
            fontSize: 11, color: 'var(--muted)', marginTop: 4,
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
          fontSize: 11, color: 'var(--muted2)',
          fontFamily: 'var(--font-display)',
          letterSpacing: '1.5px', textTransform: 'uppercase',
        }}>
          Thai Summit Group — VX Production Intelligence
        </div>
      </div>
    </div>
  );
}
