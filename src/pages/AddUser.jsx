import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { accessSummaryForRole } from '../App';
import { ROLE_OPTIONS, roleLabel } from '../utils/roleMeta';

// ชื่อ/สี/คำอธิบายชุดสิทธิ์ อ่านจาก src/utils/roleMeta.js ที่เดียว (ห้ามนิยามซ้ำในหน้า)
// desc = "ลักษณะ/ขอบเขตอำนาจ" ของ role เท่านั้น — ห้ามพิมพ์รายชื่อโมดูล/หน้า
// เพราะหน้าเข้าได้จริงเป็น data-driven จาก role_permissions (แสดงอัตโนมัติผ่าน accessSummaryForRole)
const ROLES = ROLE_OPTIONS.map(r => ({ ...r, label: `${r.icon} ${r.label} (${r.en})` }));
// sections = ขอบเขตส่วนงาน (เลือกได้หลายอัน ทุก role) — ว่าง = เห็นทุกส่วนงาน
// profiles.section (เดี่ยว) ยังถูกเขียนเป็นตัวแรกของ sections เสมอ เพื่อให้ rollback โค้ดกลับเวอร์ชันเก่าได้โดย supervisor ไม่หลุด scope
const emptyForm = { email: '', password: '', fullName: '', role: 'supervisor', position: '', sections: [], lineId: '', team: '', notifyEmail: '' };

// คำอธิบายกะของแต่ละทีม (ดู CLAUDE.md "Shift Logic") — ทีมอื่นที่ไม่รู้จักแสดงชื่อเฉยๆ
const TEAM_DESC = {
  A: '(ทำงานสลับกะกับ TEAM B)',
  B: '(ทำงานสลับกะกับ TEAM A)',
  C: '(เข้ากะเช้าตลอด ไม่สลับกะ)',
};

// ตำแหน่งงานจริงในโรงงาน (แสดงตัวตน/รายงาน/ลายเซ็น) — คนละมิติกับ role ซึ่งเป็น "ชุดสิทธิ์ใช้ระบบ"
// เป็น dropdown + ตัวเลือก "อื่นๆ (พิมพ์เอง)" — ตำแหน่งใหม่ไม่ต้องแก้โค้ด และเปลี่ยนตัวเลือกได้ตลอด
const POSITION_SUGGESTIONS = ['ผู้จัดการฝ่าย', 'หัวหน้าแผนก', 'หัวหน้าส่วน', 'หัวหน้าไลน์', 'วิศวกร', 'เจ้าหน้าที่', 'ช่างเทคนิค', 'ธุรการ'];

export default function AddUser() {
  const [users,         setUsers]         = useState([]);
  const [lines,         setLines]         = useState([]);
  const [sectionOpts,   setSectionOpts]   = useState([]);
  const [teamOpts,      setTeamOpts]      = useState([]);
  const [fetchingUsers, setFetchingUsers] = useState(true);
  const [showModal,     setShowModal]     = useState(false);
  const [modalMode,     setModalMode]     = useState('create');
  const [editingId,     setEditingId]     = useState(null);
  const [form,          setForm]          = useState(emptyForm);
  // ค้นหา/กรอง/เรียง — default เรียง "สร้างล่าสุดก่อน" (user ใหม่ขึ้นบนสุด หาเจอทันที)
  const [q,             setQ]             = useState('');
  const [filterRole,    setFilterRole]    = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [sort,          setSort]          = useState({ key: 'created_at', dir: 'desc' });
  const [posCustom,     setPosCustom]     = useState(false); // ตำแหน่ง = "อื่นๆ (พิมพ์เอง)" อยู่
  const [loading,       setLoading]       = useState(false);
  const [message,       setMessage]       = useState(null);
  const [error,         setError]         = useState(null);

  useEffect(() => {
    supabase.from('production_lines').select('id, name').order('name')
      .then(({ data }) => setLines(data || []));
    supabase.from('org_nodes').select('code, name, kind').eq('is_active', true).order('sort_order')
      .then(({ data }) => {
        const nodes = data || [];
        setSectionOpts(nodes.filter(n => n.kind === 'section').map(n => n.code || n.name));
        setTeamOpts([...new Set(nodes.filter(n => n.kind === 'team').map(n => n.code || n.name))]);
      });
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setFetchingUsers(true);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, role, position, line_id, section, sections, team, notify_email');
    const { data: authUsers } = await supabase.rpc('get_auth_users');

    const authMap = {};
    (authUsers || []).forEach(u => { authMap[u.id] = u; });

    setUsers((profiles || []).map(p => ({
      ...p,
      email: authMap[p.id]?.email || '—',
      created_at: authMap[p.id]?.created_at || null,
    })));
    setFetchingUsers(false);
  };

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // ป้องกันบั๊ก fail-open: ถ้า supervisor/leader ไม่มี section/line_id ทุกหน้าที่กรองข้อมูลตาม
  // section/line_id จะข้าม condition แล้วโชว์ข้อมูลทุกไลน์ทุกแผนกเหมือน admin โดยไม่มีอะไรเตือน
  const validateScope = () => {
    if (form.role === 'supervisor' && !form.sections.length) return 'ชุดสิทธิ์ระดับส่วน ต้องกำหนด Section อย่างน้อย 1 ส่วนงาน ไม่งั้นจะเห็นข้อมูลทุกส่วนงานแบบไม่จำกัด';
    if (form.role === 'leader' && (!form.lineId || !form.team)) return 'ชุดสิทธิ์ระดับไลน์ ต้องกำหนดทั้งไลน์ผลิตและ Team ไม่งั้นจะเห็นข้อมูลทุกไลน์แบบไม่จำกัด';
    return null;
  };

  const openCreate = () => {
    setForm(emptyForm);
    setPosCustom(false);
    setEditingId(null);
    setModalMode('create');
    setMessage(null);
    setError(null);
    setShowModal(true);
  };

  const openEdit = (u) => {
    setForm({
      email:       u.email,
      password:    '',
      fullName:    u.full_name    || '',
      role:        u.role         || 'supervisor',
      position:    u.position     || '',
      sections:    (u.sections?.length ? u.sections : (u.section ? [u.section] : [])),
      lineId:      u.line_id      ? String(u.line_id) : '',
      team:        u.team         || '',
      notifyEmail: u.notify_email || '',
    });
    setPosCustom(!!u.position && !POSITION_SUGGESTIONS.includes(u.position));
    setEditingId(u.id);
    setModalMode('edit');
    setMessage(null);
    setError(null);
    setShowModal(true);
  };

  const handleCreate = async () => {
    if (!form.email || !form.password) return setError('กรุณากรอก Email และรหัสผ่าน');
    const scopeErr = validateScope();
    if (scopeErr) return setError(scopeErr);
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
            email:        form.email,
            password:     form.password,
            role:         form.role,
            full_name:    form.fullName || null,
            position:     form.position || null,
            section:      form.sections[0] || null,
            sections:     form.sections,
            team:         form.team || null,
            line_id:      form.lineId ? Number(form.lineId) : null,
            notify_email: form.notifyEmail || null,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      // create-user v14 เขียนโปรไฟล์ครบทุก field ในจังหวะเดียวแล้ว (ไม่มีจังหวะสองให้พลาด)

      setMessage(`สร้าง user "${form.email}" (${form.role}) สำเร็จ`);
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    const who = form.fullName || form.email;
    if (!window.confirm(`ลบผู้ใช้ "${who}" ถาวร?\n\nบัญชี login และสิทธิ์ทั้งหมดจะถูกลบ กู้คืนไม่ได้`)) return;
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: editingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ลบไม่สำเร็จ');
      setMessage(`ลบผู้ใช้ "${who}" แล้ว`);
      setShowModal(false);
      fetchUsers();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleUpdate = async () => {
    const scopeErr = validateScope();
    if (scopeErr) return setError(scopeErr);
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const { error: err } = await supabase.from('profiles').update({
        full_name:    form.fullName    || null,
        role:         form.role,
        position:     form.position    || null,
        section:      form.sections[0] || null,
        sections:     form.sections.length ? form.sections : null,
        team:         form.team        || null,
        line_id:      form.lineId      ? Number(form.lineId) : null,
        notify_email: form.notifyEmail || null,
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

  const norm = (v) => (v || '').toString().trim().toLowerCase();
  const toggleSort = (key) => setSort(prev => prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'created_at' ? 'desc' : 'asc' });

  const view = (() => {
    const kw = norm(q);
    let rows = users.filter(u => {
      if (filterRole && u.role !== filterRole) return false;
      if (filterSection) {
        const secs = u.sections?.length ? u.sections : (u.section ? [u.section] : []);
        if (!secs.includes(filterSection)) return false;
      }
      if (!kw) return true;
      return [u.full_name, u.email, u.position, u.section, ...(u.sections || [])].some(v => norm(v).includes(kw));
    });
    const val = (u) => {
      switch (sort.key) {
        case 'name':       return norm(u.full_name || u.email);
        case 'position':   return norm(u.position);
        case 'role':       return norm(u.role);
        case 'section':    return norm(u.sections?.length ? u.sections.join(',') : u.section);
        case 'line':       return norm(lines.find(l => l.id === u.line_id)?.name);
        case 'team':       return norm(u.team);
        case 'created_at': return u.created_at || '';
        default:           return '';
      }
    };
    rows.sort((a, b) => {
      const cmp = val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  })();

  // หัวตารางกดเรียงได้ — ลูกศรบอกคอลัมน์+ทิศทางที่ใช้อยู่
  const Th = ({ label, sortKey, style }) => (
    <th onClick={() => toggleSort(sortKey)} title="คลิกเพื่อเรียง"
      style={{ ...style, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label} <span style={{ fontSize: 11, opacity: sort.key === sortKey ? 1 : 0.35 }}>
        {sort.key === sortKey ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );

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

      {/* Toolbar: ค้นหา + กรอง + ตัวนับ (input ใน flex row ต้องกำหนด width — index.css ตั้ง input{width:100%}) */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input type="search" placeholder="🔍 ค้นหา ชื่อ / อีเมล / ตำแหน่ง..." value={q}
          onChange={e => setQ(e.target.value)}
          style={{ width: 260, padding: '8px 12px', borderRadius: 8, fontSize: 13 }} />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          style={{ width: 'auto', minWidth: 130, padding: '8px 10px', borderRadius: 8, fontSize: 13 }}>
          <option value="">ทุกชุดสิทธิ์</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={filterSection} onChange={e => setFilterSection(e.target.value)}
          style={{ width: 'auto', minWidth: 120, padding: '8px 10px', borderRadius: 8, fontSize: 13 }}>
          <option value="">ทุก Section</option>
          {sectionOpts.map(sec => <option key={sec} value={sec}>{sec}</option>)}
        </select>
        {(q || filterRole || filterSection) && (
          <button onClick={() => { setQ(''); setFilterRole(''); setFilterSection(''); }}
            style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>
            ✕ ล้างตัวกรอง
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          {view.length === users.length ? `ทั้งหมด ${users.length} คน` : `แสดง ${view.length} จาก ${users.length} คน`}
          <span style={{ marginLeft: 6, opacity: 0.7 }}>· ไม่มีการจำกัดจำนวน user</span>
        </span>
      </div>

      {/* User Table */}
      <div className="card table-sticky" style={{ overflowX: 'auto', marginBottom: 16, maxHeight: '65vh' }}>
        <table style={{ minWidth: 680 }}>
          <thead>
            <tr>
              <Th label="ชื่อ / อีเมล" sortKey="name" style={{ minWidth: 200 }} />
              <Th label="ตำแหน่ง" sortKey="position" style={{ textAlign: 'center', minWidth: 100 }} />
              <Th label="ชุดสิทธิ์" sortKey="role" style={{ textAlign: 'center', minWidth: 100 }} />
              <Th label="Section" sortKey="section" style={{ textAlign: 'center', minWidth: 80 }} />
              <Th label="ไลน์ / Group" sortKey="line" style={{ minWidth: 140 }} />
              <Th label="Team" sortKey="team" style={{ textAlign: 'center', minWidth: 80 }} />
              <th style={{ minWidth: 180 }}>📬 Notify Email</th>
              <Th label="สร้างเมื่อ" sortKey="created_at" style={{ textAlign: 'center', minWidth: 96 }} />
              <th style={{ textAlign: 'center', minWidth: 80 }}>แก้ไข</th>
            </tr>
          </thead>
          <tbody>
            {fetchingUsers ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>กำลังโหลด...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>ไม่พบข้อมูลผู้ใช้</td></tr>
            ) : view.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>ไม่พบ user ที่ตรงกับตัวกรอง — ลองล้างตัวกรอง</td></tr>
            ) : view.map(u => {
              const rc      = ROLES.find(r => r.value === u.role);
              const lineName = lines.find(l => l.id === u.line_id)?.name || '—';
              return (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{u.full_name || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>ไม่ระบุชื่อ</span>}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</div>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, color: u.position ? 'var(--text)' : 'var(--muted)' }}>
                    {u.position || '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                      background: rc ? `${rc.color}22` : 'var(--bg3)',
                      color:      rc ? rc.color        : 'var(--text2)',
                      border:     `1px solid ${rc ? rc.color + '44' : 'var(--border2)'}`,
                    }}>
                      {u.role ? roleLabel(u.role) : '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, color: (u.sections?.length || u.section) ? 'var(--text)' : 'var(--muted)' }}>
                    {u.sections?.length ? u.sections.join(', ') : (u.section || '—')}
                  </td>
                  <td style={{ fontSize: 13, color: u.line_id ? 'var(--text)' : 'var(--muted)' }}>
                    {lineName}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, color: u.team ? 'var(--text)' : 'var(--muted)' }}>
                    {u.team ? `Team ${u.team}` : '—'}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {u.notify_email
                      ? <span style={{ color: 'var(--green)' }}>📬 {u.notify_email}</span>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 12, color: u.created_at ? 'var(--text2)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
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

      {/* Role reference — หมวดที่เข้าได้ดึงจากตารางสิทธิ์จริง (role_permissions) ไม่ hardcode */}
      <div style={{ padding: '12px 16px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border2)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          สิทธิ์การเข้าถึง <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— หมวดที่เข้าได้อ่านจากตารางสิทธิ์ปัจจุบัน ปรับรายหน้าได้ที่เมนู 🔐 จัดการสิทธิ์</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
          {ROLES.map(r => {
            const sum = accessSummaryForRole(r.value);
            return (
              <div key={r.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0, marginTop: 5 }} />
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: r.color }}>{r.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{r.desc}</span>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    {sum.all ? '✅ เข้าได้ทุกหน้า' : sum.total === 0 ? '— ยังไม่เปิดสิทธิ์หน้าไหน' : `เข้าได้ ${sum.total} หน้า: ${sum.groups.join(' · ')}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="overlay">
          {/* จอ desktop: ขยายกว้าง 2 คอลัมน์ ห้ามทรงแคบสูงจนล้นจอ (UI-CONVENTIONS "ขยายกว้างก่อนยอมสูงเกินจอ") */}
          <div className="modal" style={{ width: 'min(96vw, 920px)', maxWidth: 920, maxHeight: '94vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, marginBottom: 18, fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: 17 }}>
              {modalMode === 'create' ? '➕ เพิ่มผู้ใช้ใหม่' : '✏️ แก้ไขข้อมูลผู้ใช้'}
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 13, alignItems: 'start' }}>
              {/* โซน 1: ตัวตน (ตำแหน่ง = แสดงผล) แยกชัดจากโซน 2: สิทธิ์ — เคยปนกันจน user งงว่าตำแหน่งคือสิทธิ์ */}
              <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 800, color: 'var(--accent)', borderBottom: '1px solid var(--border)', paddingBottom: 5 }}>
                👤 ข้อมูลบัญชี & ตัวตน
              </div>
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
                <label style={labelSt}>ตำแหน่งงาน (Position)</label>
                {/* dropdown ปกติ (เปลี่ยนค่าได้เสมอ) + "อื่นๆ" เปิดช่องพิมพ์เอง — datalist เดิมพอมีค่าแล้วตัวเลือกอื่นหาย */}
                <select
                  value={posCustom ? '__custom__' : form.position}
                  onChange={e => {
                    if (e.target.value === '__custom__') { setPosCustom(true); setF('position', ''); }
                    else { setPosCustom(false); setF('position', e.target.value); }
                  }}>
                  <option value="">— ไม่ระบุ —</option>
                  {POSITION_SUGGESTIONS.map(pos => <option key={pos} value={pos}>{pos}</option>)}
                  <option value="__custom__">อื่นๆ (พิมพ์เอง)...</option>
                </select>
                {posCustom && (
                  <input type="text" autoFocus placeholder="พิมพ์ตำแหน่ง เช่น ผู้ช่วยหัวหน้าแผนก"
                    value={form.position} onChange={e => setF('position', e.target.value)}
                    style={{ marginTop: 6 }} />
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  ตำแหน่งจริงในโรงงาน — ใช้แสดงตัวตน/รายงาน/ลายเซ็น <b>ไม่มีผลต่อสิทธิ์</b>
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 800, color: 'var(--accent2)', borderBottom: '1px solid var(--border)', paddingBottom: 5, marginTop: 4 }}>
                🔐 สิทธิ์การใช้งานในระบบ — เข้าหน้าไหนได้ / เห็นข้อมูลส่วนงานไหน (ไม่เกี่ยวกับตำแหน่งงานข้างบน)
              </div>

              <div>
                <label style={labelSt}>ชุดสิทธิ์การใช้งาน (Role)</label>
                <select value={form.role} onChange={e => setF('role', e.target.value)}>
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                  ))}
                </select>
                {/* สรุปหน้าเข้าได้จริงของ role ที่เลือก — อ่านสดจากตารางสิทธิ์ ไม่ hardcode */}
                {(() => {
                  const sum = accessSummaryForRole(form.role);
                  return (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
                      {sum.all
                        ? '✅ role นี้เข้าได้ทุกหน้า'
                        : sum.total === 0
                          ? '⚠️ role นี้ยังไม่ถูกเปิดสิทธิ์หน้าไหนเลย — ไปเปิดที่เมนู 🔐 จัดการสิทธิ์'
                          : <>เข้าได้ <b>{sum.total} หน้า</b> ในหมวด: {sum.groups.join(' · ')} — ปรับรายหน้าได้ที่เมนู 🔐 จัดการสิทธิ์</>}
                    </div>
                  );
                })()}
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>
                  ขอบเขตส่วนงาน (Section) {form.role === 'supervisor' && <span style={{ color: 'var(--red)' }}>* จำเป็นอย่างน้อย 1</span>}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border2)' }}>
                  {sectionOpts.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มีข้อมูล Section</span>}
                  {sectionOpts.map(s => {
                    const checked = form.sections.includes(s);
                    return (
                      <label key={s} style={{
                        display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, userSelect: 'none',
                        background: checked ? 'rgba(77,159,255,0.15)' : 'var(--bg2)',
                        border: `1px solid ${checked ? 'rgba(77,159,255,0.5)' : 'var(--border2)'}`,
                        color: checked ? '#4d9fff' : 'var(--text2)',
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setF('sections', checked ? form.sections.filter(x => x !== s) : [...form.sections, s])}
                          style={{ margin: 0 }}
                        />
                        {s}
                      </label>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                  เลือกได้หลายส่วนงาน — user จะเห็นข้อมูลเฉพาะส่วนงานที่ติ๊กไว้ (ใช้ได้กับทุกชุดสิทธิ์ เช่น สิทธิ์ทั้งฝ่าย ที่ดูแลเฉพาะบางส่วน) · ไม่ติ๊กเลย = เห็นทุกส่วนงาน
                  <br />💡 ขอบเขตนี้มีผลกับ<b>ข้อมูลฝ่ายผลิต</b> (พนักงาน/ไลน์/เช็คชื่อ/รายงาน) — สาย Logistic/Store/ขาย <b>ไม่ต้องติ๊ก</b> เพราะโมดูล Logistic ไม่ได้แบ่งข้อมูลตามส่วนงาน ใช้ Role คุมการเข้าหน้าแทน
                </div>
              </div>

              <div>
                <label style={labelSt}>Team {form.role === 'leader' && <span style={{ color: 'var(--red)' }}>* จำเป็น</span>}</label>
                <select value={form.team} onChange={e => setF('team', e.target.value)}>
                  <option value="">— เลือก —</option>
                  {teamOpts.map(t => <option key={t} value={t}>Team {t} {TEAM_DESC[t] || ''}</option>)}
                </select>
              </div>

              <div>
                <label style={labelSt}>ไลน์ผลิต / Group {form.role === 'leader' && <span style={{ color: 'var(--red)' }}>* จำเป็น</span>}</label>
                <select value={form.lineId} onChange={e => setF('lineId', e.target.value)}>
                  <option value="">— เลือกไลน์ —</option>
                  {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              {(form.role === 'supervisor' || form.role === 'leader') && (
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)', padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6, lineHeight: 1.5 }}>
                  ⚠️ {form.role === 'supervisor'
                    ? 'สิทธิ์ระดับส่วน เห็นเฉพาะข้อมูลใน Section ที่ติ๊กไว้ — ถ้าไม่กำหนดจะเห็นทุกส่วนงานแบบไม่จำกัด'
                    : 'สิทธิ์ระดับไลน์ เห็นเฉพาะข้อมูลในไลน์+Team ที่กำหนด — ถ้าไม่กำหนดจะเห็นทุกไลน์แบบไม่จำกัด'}
                </div>
              )}

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelSt}>📬 Notify Email (รับการแจ้งเตือน)</label>
                <input
                  type="email"
                  placeholder="notify@company.com (เว้นว่างถ้าใช้ email login)"
                  value={form.notifyEmail}
                  onChange={e => setF('notifyEmail', e.target.value)}
                />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  ระบุ email ที่จะรับการแจ้งเตือนจากระบบ (4M Changes, ขาดงาน ฯลฯ) เว้นว่างเพื่อใช้ email login แทน
                </div>
              </div>

              {error && (
                <div style={{ gridColumn: '1 / -1', padding: '8px 12px', background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)', borderRadius: 7, color: 'var(--red)', fontSize: 13 }}>
                  ❌ {error}
                </div>
              )}

              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 4 }}>
                {modalMode === 'edit' && form.role !== 'admin' && (
                  <button type="button" onClick={handleDelete} disabled={loading}
                    title="ลบบัญชีถาวร (ลบตัวเอง/บัญชี admin ไม่ได้)"
                    style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: loading ? 'default' : 'pointer' }}>
                    🗑 ลบผู้ใช้
                  </button>
                )}
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
