import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AddUser() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('supervisor');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

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
      setEmail('');
      setPassword('');
      setRole('supervisor');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '40px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <h2 style={{ marginBottom: '8px', color: '#2c3e50' }}>👤 เพิ่มผู้ใช้งานระบบ</h2>
        <p style={{ color: '#888', marginBottom: '30px', fontSize: '14px' }}>
          สร้าง account สำหรับเข้าใช้งาน 4M System
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={labelStyle}>อีเมล</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@company.com"
              required
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>รหัสผ่าน</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="อย่างน้อย 6 ตัวอักษร"
              minLength={6}
              required
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>สิทธิ์การใช้งาน</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
              <option value="supervisor">Supervisor — เช็คชื่อ, จัดการสาย</option>
              <option value="manager">Manager — เข้าถึงทุกส่วน</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px', marginTop: '8px',
              backgroundColor: loading ? '#95a5a6' : '#2c3e50',
              color: 'white', border: 'none', borderRadius: '8px',
              fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {loading ? 'กำลังสร้าง...' : 'สร้าง Account'}
          </button>
        </form>

        {message && (
          <div style={{ marginTop: '20px', padding: '12px 16px', backgroundColor: '#d5f5e3', borderRadius: '8px', color: '#1e8449', fontSize: '14px' }}>
            ✅ {message}
          </div>
        )}
        {error && (
          <div style={{ marginTop: '20px', padding: '12px 16px', backgroundColor: '#fdecea', borderRadius: '8px', color: '#c0392b', fontSize: '14px' }}>
            ❌ {error}
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: '600', color: '#555' };
const inputStyle = { width: '100%', padding: '11px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '15px', boxSizing: 'border-box' };
