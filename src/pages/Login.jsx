import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      navigate('/');
    }
  };

  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', backgroundColor: '#f0f2f5'
    }}>
      <div style={{
        backgroundColor: 'white', padding: '40px', borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px'
      }}>
        <h2 style={{ textAlign: 'center', marginBottom: '8px', color: '#2c3e50' }}>🏭 4M System</h2>
        <p style={{ textAlign: 'center', color: '#888', marginBottom: '30px' }}>เข้าสู่ระบบ</p>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input
            type="email"
            placeholder="อีเมล"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '15px' }}
          />
          <input
            type="password"
            placeholder="รหัสผ่าน"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '15px' }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px', backgroundColor: loading ? '#95a5a6' : '#2c3e50',
              color: 'white', border: 'none', borderRadius: '8px',
              fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        {error && (
          <p style={{ color: 'red', marginTop: '15px', textAlign: 'center', fontSize: '14px' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
