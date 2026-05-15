import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const ROLES = [
  { value: 'admin',      label: 'Admin — ควบคุมทั้งระบบ' },
  { value: 'manager',    label: 'Manager — ดูภาพรวม + จัดการ Cross Section' },
  { value: 'supervisor', label: 'Supervisor — ดูภาพรวม + จัดการ Cross Line' },
  { value: 'leader',     label: 'Leader — ดูภาพรวม + จัดการ Line ของตัวเอง' },
];

export default function AddUser() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [role,     setRole]     = useState('supervisor');
  const [lineId,   setLineId]   = useState('');
  const [lines,    setLines]    = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [message,  setMessage]  = useState(null);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    supabase.from('production_lines').select('id, name').order('name').then(({ data }) => setLines(data || []));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (role === 'leader' && !lineId) return setError('กรุณาเลือกไลน์ผลิตสำหรับ Leader');
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
          body: JSON.stringify({ email, password, role, line_id: role === 'leader' ? Number(lineId) : null }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');

      // Patch line_id if the edge function returned the new user id
      if (role === 'leader' && lineId && data.user?.id) {
        await supabase.from('profiles').update({ line_id: Number(lineId) }).eq('id', data.user.id);
      }

      setMessage(`สร้าง user "${email}" (${role}) สำเร็จ`);
      setEmail(''); setPassword(''); setRole('supervisor'); setLineId('');
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
        width: '100%', maxWidth: 480,
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

        {/* Role permission matrix */}
        <div style={{ marginBottom: 20, padding: '12px 14px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border2)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            สิทธิ์การเข้าถึง
          </div>
          {[
            { role: 'admin',      color: '#e31937', label: '👑 Admin',      desc: 'ทุกหน้า + ตั้งค่าระบบ + จัดการผู้ใช้' },
            { role: 'manager',    color: '#f59e0b', label: '🏢 Manager',    desc: 'Dashboard + Report + Management (ทุกไลน์) + พนักงาน' },
            { role: 'supervisor', color: '#4d9fff', label: '🎯 Supervisor', desc: 'Dashboard + Report + Management (ข้ามไลน์) + เช็คชื่อ' },
            { role: 'leader',     color: '#22c55e', label: '⭐ Leader',     desc: 'Dashboard + Report + Management (ไลน์ตัวเอง) + เช็คชื่อ' },
          ].map(r => (
            <div key={r.role} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0, marginTop: 4 }} />
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.color }}>{r.label}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{r.desc}</span>
              </div>
            </div>
          ))}
        </div>

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
            <select value={role} onChange={e => { setRole(e.target.value); setLineId(''); }}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {role === 'leader' && (
            <div>
              <label style={labelSt}>ไลน์ผลิต (สำหรับ Leader)</label>
              <select value={lineId} onChange={e => setLineId(e.target.value)} required>
                <option value="">— เลือกไลน์ —</option>
                {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Leader จะจัดการได้เฉพาะไลน์นี้เท่านั้น
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '13px',
              background: loading ? 'var(--muted)' : 'var(--amber)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
              cursor: loading ? 'default' : 'pointer',
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
