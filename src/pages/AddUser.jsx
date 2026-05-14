import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AddUser() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [role,     setRole]     = useState('supervisor');
  const [loading,  setLoading]  = useState(false);
  const [message,  setMessage]  = useState(null);
  const [error,    setError]    = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email, password, role }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      setMessage(`สร้าง user "${email}" สำเร็จ`);
      setEmail(''); setPassword(''); setRole('supervisor');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 80px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--card)',
        border: '1px solid var(--border2)',
        borderRadius: 16,
        padding: '36px 32px',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>
            🔑 เพิ่มผู้ใช้งานระบบ
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            สร้าง account สำหรับเข้าใช้งาน 4M System
          </p>
        </div>

        <div style={{ height: 2, background: 'var(--amber)', borderRadius: 2, marginBottom: 24, opacity: 0.7 }} />

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelSt}>อีเมล</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@company.com"
              required
            />
          </div>

          <div>
            <label style={labelSt}>รหัสผ่าน</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="อย่างน้อย 6 ตัวอักษร"
              minLength={6}
              required
            />
          </div>

          <div>
            <label style={labelSt}>สิทธิ์การใช้งาน</label>
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="supervisor">Supervisor — เช็คชื่อ, จัดการสาย</option>
              <option value="manager">Manager — เข้าถึงทุกส่วน</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '13px',
              background: loading ? 'var(--muted)' : 'var(--amber)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
            }}
          >
            {loading ? 'กำลังสร้าง...' : 'สร้าง Account'}
          </button>
        </form>

        {message && (
          <div style={{ marginTop: 20, padding: '12px 16px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, color: 'var(--green)', fontSize: 14 }}>
            ✅ {message}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 20, padding: '12px 16px', background: 'rgba(227,25,55,0.08)', border: '1px solid rgba(227,25,55,0.2)', borderRadius: 8, color: 'var(--accent)', fontSize: 14 }}>
            ❌ {error}
          </div>
        )}
      </div>
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
