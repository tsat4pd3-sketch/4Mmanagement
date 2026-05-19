import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const ROLES = [
  { value: 'admin',      label: 'Admin',      color: '#e31937', desc: 'ทุกหน้า + ตั้งค่าระบบ + จัดการผู้ใช้' },
  { value: 'manager',    label: 'Manager',    color: '#f59e0b', desc: 'ภาพรวม + Cross Section + ตั้งค่าไลน์ + พนักงาน' },
  { value: 'supervisor', label: 'Supervisor', color: '#4d9fff', desc: 'ภาพรวม + Cross Line + ตั้งค่าไลน์ + เช็คชื่อ' },
  { value: 'leader',     label: 'Leader',     color: '#22c55e', desc: 'ภาพรวม + ไลน์ตัวเอง + พนักงานในไลน์' },
];
const SECTIONS = ['PD1', 'PD2', 'PD3', 'PD4'];
const TEAMS    = ['A', 'B'];

const emptyForm = { email: '', password: '', fullName: '', role: 'supervisor', section: '', lineId: '', team: '' };

export default function AddUser() {
  const [users,         setUsers]         = useState([]);
  const [lines,         setLines]         = useState([]);
  const [fetchingUsers, setFetchingUsers] = useState(true);
  const [showModal,     setShowModal]     = useState(false);
  const [modalMode,     setModalMode]     = useState('create');
  const [editingId,     setEditingId]     = useState(null);
  const [form,          setForm]          = useState(emptyForm);
  const [loading,       setLoading]       = useState(false);
  const [message,       setMessage]       = useState(null);
  const [error,         setError]         = useState(null);

  useEffect(() => {
    supabase.from('production_lines').select('id, name').order('name')
      .then(({ data }) => setLines(data || []));
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setFetchingUsers(true);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, role, line_id, section, team');
    const { data: authUsers } = await supabase.rpc('get_auth_users');

    const emailMap = {};
    (authUsers || []).forEach(u => { emailMap[u.id] = u.email; });

    setUsers((profiles || []).map(p => ({ ...p, email: emailMap[p.id] || '—' })));
    setFetchingUsers(false);
  };

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setModalMode('create');
    setMessage(null);
    setError(null);
    setShowModal(true);
  };

  const openEdit = (u) => {
    setForm({
      email:    u.email,
      password: '',
      fullName: u.full_name || '',
      role:     u.role      || 'supervisor',
      section:  u.section   || '',
      lineId:   u.line_id   ? String(u.line_id) : '',
      team:     u.team      || '',
    });
    setEditingId(u.id);
    setModalMode('edit');
    setMessage(null);
    setError(null);
    setShowModal(true);
  };

  const handleCreate = async () => {
    if (!form.email || !form.password) return setError('กรุณากรอก Email และรหัสผ่าน');
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
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email:     form.email,
            password:  form.password,
            role:      form.role,
            full_name: form.fullName || null,
            section:   form.section  || null,
            team:      form.team     || null,
            line_id:   form.lineId   ? Number(form.lineId) : null,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');

      setMessage(`สร้าง user "${form.email}" (${form.role}) สำเร็จ`);
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const { error: err } = await supabase.from('profiles').update({
        full_name: form.fullName || null,
        role:      form.role,
        section:   form.section  || null,
        team:      form.team     || null,
        line_id:   form.lineId   ? Number(form.lineId) : null,
      }).eq('id', editingId);
      if (err) throw err;
      setMessage('อัปเดตข้อมูลผู้ใช้สำเร็จ');
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
            🔑 จัดการผู้ใช้งาน
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>กำหนดสิทธิ์และสังกัด Section / Group / Team ของแต่ละ user</p>
        </div>
        <button
          onClick={openCreate}
          style={{ padding: '10px 20px', background: 'var(--amber)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          ➕ เพิ่มผู้ใช้ใหม่
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, color: 'var(--green)', fontSize: 13 }}>
          ✅ {message}
        </div>
      )}

      {/* User Table */}
      <div className="card" style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ minWidth: 680 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>ชื่อ / อีเมล</th>
              <th style={{ textAlign: 'center', minWidth: 100 }}>สิทธิ์</th>
              <th style={{ textAlign: 'center', minWidth: 80 }}>Section</th>
              <th style={{ minWidth: 140 }}>ไลน์ / Group</th>
              <th style={{ textAlign: 'center', minWidth: 80 }}>Team</th>
              <th style={{ textAlign: 'center', minWidth: 80 }}>แก้ไข</th>
            </tr>
          </thead>
          <tbody>
            {fetchingUsers ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>กำลังโหลด...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>ไม่พบข้อมูลผู้ใช้</td></tr>
            ) : users.map(u => {
              const rc      = ROLES.find(r => r.value === u.role);
              const lineName = lines.find(l => l.id === u.line_id)?.name || '—';
              return (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{u.full_name || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>ไม่ระบุชื่อ</span>}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                      background: rc ? `${rc.color}22` : 'var(--bg3)',
                      color:      rc ? rc.color        : 'var(--text2)',
                      border:     `1px solid ${rc ? rc.color + '44' : 'var(--border2)'}`,
                    }}>
                      {u.role?.toUpperCase() || '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, color: u.section ? 'var(--text)' : 'var(--muted)' }}>
                    {u.section || '—'}
                  </td>
                  <td style={{ fontSize: 13, color: u.line_id ? 'var(--text)' : 'var(--muted)' }}>
                    {lineName}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, color: u.team ? 'var(--text)' : 'var(--muted)' }}>
                    {u.team ? `Team ${u.team}` : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => openEdit(u)}
                      style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}
                    >
                      ✏️ แก้ไข
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Role reference */}
      <div style={{ padding: '12px 16px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border2)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>สิทธิ์การเข้าถึง</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
          {ROLES.map(r => (
            <div key={r.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0, marginTop: 4 }} />
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.color }}>{r.label}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{r.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0, marginBottom: 18, fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: 17 }}>
              {modalMode === 'create' ? '➕ เพิ่มผู้ใช้ใหม่' : '✏️ แก้ไขข้อมูลผู้ใช้'}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {modalMode === 'create' ? (
                <>
                  <div>
                    <label style={labelSt}>อีเมล</label>
                    <input type="email" placeholder="user@company.com" value={form.email} onChange={e => setF('email', e.target.value)} />
                  </div>
                  <div>
                    <label style={labelSt}>รหัสผ่าน (อย่างน้อย 6 ตัว)</label>
                    <input type="password" placeholder="••••••" value={form.password} onChange={e => setF('password', e.target.value)} />
                  </div>
                </>
              ) : (
                <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 8, fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  📧 <span style={{ color: 'var(--text)' }}>{form.email}</span>
                </div>
              )}

              <div>
                <label style={labelSt}>ชื่อ - นามสกุล</label>
                <input type="text" placeholder="ชื่อเต็ม" value={form.fullName} onChange={e => setF('fullName', e.target.value)} />
              </div>

              <div>
                <label style={labelSt}>สิทธิ์การใช้งาน (Role)</label>
                <select value={form.role} onChange={e => setF('role', e.target.value)}>
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelSt}>Section</label>
                  <select value={form.section} onChange={e => setF('section', e.target.value)}>
                    <option value="">— เลือก —</option>
                    {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelSt}>Team</label>
                  <select value={form.team} onChange={e => setF('team', e.target.value)}>
                    <option value="">— เลือก —</option>
                    {TEAMS.map(t => <option key={t} value={t}>Team {t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={labelSt}>ไลน์ผลิต / Group</label>
                <select value={form.lineId} onChange={e => setF('lineId', e.target.value)}>
                  <option value="">— เลือกไลน์ —</option>
                  {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              {error && (
                <div style={{ padding: '8px 12px', background: 'rgba(227,25,55,0.08)', border: '1px solid rgba(227,25,55,0.2)', borderRadius: 7, color: 'var(--accent)', fontSize: 13 }}>
                  ❌ {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={modalMode === 'create' ? handleCreate : handleUpdate}
                  disabled={loading}
                  style={{ flex: 2, padding: 12, background: loading ? 'var(--muted)' : 'var(--amber)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 14, cursor: loading ? 'default' : 'pointer' }}
                >
                  {loading ? 'กำลังบันทึก...' : modalMode === 'create' ? 'สร้าง Account' : 'บันทึก'}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: 12, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
