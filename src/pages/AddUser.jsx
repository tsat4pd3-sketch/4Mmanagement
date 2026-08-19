import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { accessSummaryForRole } from '../App';
import { ROLE_OPTIONS, roleLabel, groupRolesByAxis } from '../utils/roleMeta';
import { positionOptions, positionLabel, loadPositions, levelOfPosition, maintenanceKindOfPosition, levelMeta } from '../utils/positions';
import { can, loadPermissions } from '../utils/permissions';   // เช็คสิทธิ์ของ role ที่เลือก เพื่อเตือนเมื่อไม่ตรงกับระดับงาน
import { MTN_TEAMS, deptNameOf, teamKeyOf } from '../utils/mtnTeams';

// ทีมช่างซ่อม (profiles.mtn_teams) แยกคิวใบแจ้งซ่อม MO ให้ถูกทีม — โผล่เฉพาะ role ที่เกี่ยวกับงานซ่อม
// (mtn = ทีมซ่อม, engineer = วิศวกรรม, leader/supervisor = ช่างฝ่ายผลิตที่ first-response บาง PD)
// admin/manager เห็นคิวทุกทีมอยู่แล้ว ไม่ต้องผูกทีม
const MTN_TEAM_ROLES = ['mtn', 'engineer', 'leader', 'supervisor'];
const isMtnTeamRole = (r) => MTN_TEAM_ROLES.includes(r);

// ชื่อ/สี/คำอธิบายชุดสิทธิ์ อ่านจาก src/utils/roleMeta.js ที่เดียว (ห้ามนิยามซ้ำในหน้า)
// desc = "ลักษณะ/ขอบเขตอำนาจ" ของ role เท่านั้น — ห้ามพิมพ์รายชื่อโมดูล/หน้า
// เพราะหน้าเข้าได้จริงเป็น data-driven จาก role_permissions (แสดงอัตโนมัติผ่าน accessSummaryForRole)
const ROLES = ROLE_OPTIONS.map(r => ({ ...r, label: `${r.icon} ${r.label} (${r.en})` }));
// จัดกลุ่ม role ตามแกน (ระดับสิทธิ์ / หน่วยงาน / อุปกรณ์) — ทำให้เห็นชัดว่า role ไม่ใช่ "ตำแหน่งงาน"
//   เคสจริงที่เคยสับสน: "ส่วนวิศวกรรม" เป็นหน่วยงาน ไม่ใช่ตำแหน่งวิศวกร (วิศวกรแผนกช่างใช้ role ซ่อมบำรุง)
const ROLE_GROUPS = groupRolesByAxis(ROLES);
// <optgroup> ของ role — ใช้ซ้ำทุก dropdown ที่เลือก role ในหน้านี้
const RoleOptGroups = ({ withDesc = false }) => ROLE_GROUPS.map(g => (
  <optgroup key={g.axis} label={g.label}>
    {g.roles.map(r => <option key={r.value} value={r.value}>{r.label}{withDesc ? ` — ${r.desc}` : ''}</option>)}
  </optgroup>
));
// sections = ขอบเขตส่วนงาน (เลือกได้หลายอัน ทุก role) — ว่าง = เห็นทุกส่วนงาน
// profiles.section (เดี่ยว) ยังถูกเขียนเป็นตัวแรกของ sections เสมอ เพื่อให้ rollback โค้ดกลับเวอร์ชันเก่าได้โดย supervisor ไม่หลุด scope
const emptyForm = { email: '', password: '', fullName: '', role: 'supervisor', position: '', sections: [], mtnTeams: [], deptAdmin: false, lineId: '', team: '', notifyEmail: '' };

// flag "แอดมินหน่วยงาน" โผล่เฉพาะ role หน่วยงานสนับสนุน (indirect) — ไม่ใช่ admin (ได้ทุกอย่างแล้ว)
// / display (ดูอย่างเดียว) · role ฝ่ายผลิต (supervisor/leader) ก็ให้ตั้งได้ (หัวหน้าส่วน/ไลน์ = แอดมินของหน่วยตัวเอง)
const DEPT_ADMIN_ELIGIBLE = (r) => r && r !== 'admin' && r !== 'display';

// คำอธิบายกะของแต่ละทีม (ดู CLAUDE.md "Shift Logic") — ทีมอื่นที่ไม่รู้จักแสดงชื่อเฉยๆ
const TEAM_DESC = {
  A: '(ทำงานสลับกะกับ TEAM B)',
  B: '(ทำงานสลับกะกับ TEAM A)',
  C: '(เข้ากะเช้าตลอด ไม่สลับกะ)',
};

// ตำแหน่งงานจริงในโรงงาน (แสดงตัวตน/รายงาน/ลายเซ็น) — คนละมิติกับ role ซึ่งเป็น "ชุดสิทธิ์ใช้ระบบ"
// master list กลางใช้ร่วมทุกหน้า (src/utils/positions.js) + ตัวเลือก "อื่นๆ (พิมพ์เอง)" — ห้าม hardcode ซ้ำ
// ตัวเลือกตำแหน่ง — อ่านสดจาก cache ของ master (loadPositions() เรียกตอน mount) · [{value:key,label:ไทย,level}]
const posOpts = () => positionOptions();

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
  const [resetPw,       setResetPw]       = useState(''); // ช่องตั้งรหัสใหม่ใน modal แก้ไข
  const [resetPwBusy,   setResetPwBusy]   = useState(false);

  const [posVer, setPosVer] = useState(0);   // bump เมื่อ master ตำแหน่งโหลดเสร็จ → dropdown/ป้ายระดับ re-render

  useEffect(() => {
    // master ตำแหน่งงาน (positions) — ต้องโหลดก่อน positionLabel()/levelOfPosition() ถึงได้ค่าจาก DB
    Promise.all([loadPositions(), loadPermissions()]).then(() => setPosVer(v => v + 1));
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

    // mtn_teams best-effort แยก query — คอลัมน์เพิ่งเพิ่ม (migration 20260722) ยังไม่ apply ก็ไม่พังลิสต์หลัก
    const mtnMap = {};
    const { data: mtnRows, error: mtnErr } = await supabase.from('profiles').select('id, mtn_teams');
    if (!mtnErr) (mtnRows || []).forEach(r => { mtnMap[r.id] = Array.isArray(r.mtn_teams) ? r.mtn_teams : []; });
    // is_dept_admin best-effort แยก query — คอลัมน์เพิ่งเพิ่ม (migration 20260803)
    const daMap = {};
    const { data: daRows, error: daErr } = await supabase.from('profiles').select('id, is_dept_admin');
    if (!daErr) (daRows || []).forEach(r => { daMap[r.id] = r.is_dept_admin === true; });

    setUsers((profiles || []).map(p => ({
      ...p,
      mtn_teams: mtnMap[p.id] || [],
      is_dept_admin: daMap[p.id] || false,
      email: authMap[p.id]?.email || '—',
      created_at: authMap[p.id]?.created_at || null,
    })));
    setFetchingUsers(false);
  };

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // เขียน mtn_teams แยก best-effort (คอลัมน์เพิ่งเพิ่ม 20260722 · create-user edge ยังไม่รู้จัก field นี้)
  //   role ที่ไม่เกี่ยวงานซ่อม → เคลียร์เป็น null · error (ยังไม่ apply migration) = เงียบ ไม่ทำ flow หลักพัง
  const saveMtnTeams = async (id) => {
    if (!id) return;
    const val = isMtnTeamRole(form.role) && form.mtnTeams.length ? form.mtnTeams : null;
    await supabase.from('profiles').update({ mtn_teams: val }).eq('id', id); // ignore error โดยตั้งใจ
  };

  // เขียน is_dept_admin แยก best-effort (คอลัมน์เพิ่งเพิ่ม 20260803 · create-user edge ยังไม่รู้จัก field นี้)
  //   role ที่ไม่เข้าเกณฑ์ (admin/display) → false เสมอ · error (ยังไม่ apply migration) = เงียบ
  const saveDeptAdmin = async (id) => {
    if (!id) return;
    const val = DEPT_ADMIN_ELIGIBLE(form.role) ? !!form.deptAdmin : false;
    try { await supabase.from('profiles').update({ is_dept_admin: val }).eq('id', id); } catch { /* ยังไม่ apply migration */ }
  };

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
    setResetPw('');
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
      mtnTeams:    Array.isArray(u.mtn_teams) ? u.mtn_teams : [],
      deptAdmin:   u.is_dept_admin === true,
      lineId:      u.line_id      ? String(u.line_id) : '',
      team:        u.team         || '',
      notifyEmail: u.notify_email || '',
    });
    setPosCustom(!!u.position && !posOpts().some(p => p.value === u.position));
    setEditingId(u.id);
    setModalMode('edit');
    setMessage(null);
    setError(null);
    setResetPw('');
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
      // mtn_teams เขียนตามหลัง best-effort (edge ยังไม่รู้จัก field นี้)
      await saveMtnTeams(data.user?.id);
      await saveDeptAdmin(data.user?.id);

      setMessage(`สร้าง user "${form.email}" (${form.role}) สำเร็จ`);
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // admin ตั้งรหัสผ่านใหม่ให้ user (ลืมรหัส/login ไม่ได้) — ผ่าน Edge Function reset-user-password
  // (admin-only ฝั่ง server + ห้ามใช้กับบัญชี admin — เจ้าตัวเปลี่ยนเองผ่านเมนูเปลี่ยนรหัสผ่าน)
  const handleResetPassword = async () => {
    const who = form.fullName || form.email;
    if (resetPw.length < 6) return setError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
    if (!window.confirm(`ตั้งรหัสผ่านใหม่ให้ "${who}" ?\n\nรหัสเดิมจะใช้ไม่ได้ทันที — อย่าลืมแจ้งรหัสใหม่ให้เจ้าตัว`)) return;
    setResetPwBusy(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: editingId, new_password: resetPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
      setResetPw('');
      setMessage(`ตั้งรหัสผ่านใหม่ให้ "${who}" แล้ว — แจ้งรหัสใหม่ให้เจ้าตัวด้วย`);
      setShowModal(false);
    } catch (err) { setError(err.message); }
    finally { setResetPwBusy(false); }
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
      await saveMtnTeams(editingId); // best-effort แยก กัน edit พังถ้ายังไม่ apply migration
      await saveDeptAdmin(editingId); // best-effort แยก (migration 20260803)
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
      <div style={{ display: 'flex', paddingRight: 52, justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
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
          <RoleOptGroups />
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
              <Th label="สร้างเมื่อ" sortKey="created_at" style={{ textAlign: 'center', minWidth: 96 }} />
              <th style={{ textAlign: 'center', minWidth: 80 }}>แก้ไข</th>
            </tr>
          </thead>
          <tbody>
            {fetchingUsers ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>กำลังโหลด...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>ไม่พบข้อมูลผู้ใช้</td></tr>
            ) : view.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28, fontSize: 13 }}>ไม่พบ user ที่ตรงกับตัวกรอง — ลองล้างตัวกรอง</td></tr>
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
                    {u.position ? positionLabel(u.position) : '—'}
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
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          สิทธิ์การเข้าถึง <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— หมวดที่เข้าได้อ่านจากตารางสิทธิ์ปัจจุบัน ปรับรายหน้าได้ที่เมนู 🔐 จัดการสิทธิ์</span>
        </div>
        {/* ⚠️ ย้ำให้ชัดว่า role ≠ ตำแหน่งงาน — เคยเข้าใจผิดว่า "ส่วนวิศวกรรม" คือตำแหน่งวิศวกร */}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          ชุดสิทธิ์ <b>ไม่ใช่ตำแหน่งงาน</b> — ตำแหน่งจริง (วิศวกร / ช่างเทคนิค / หัวหน้าแผนก) กรอกที่ช่อง “ตำแหน่งงาน” แยกต่างหาก<br />
          เช่น <b>วิศวกรที่สังกัดแผนกซ่อมบำรุง</b> ให้เลือกชุดสิทธิ์ <b>🔧 ซ่อมบำรุง</b> แล้วกรอกตำแหน่งว่า “วิศวกร” — ไม่ใช่เลือก “ส่วนวิศวกรรม”
        </div>
        {ROLE_GROUPS.map(g => (
          <div key={g.axis} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
              {g.label} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— {g.hint}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 8 }}>
              {g.roles.map(r => {
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
        ))}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="overlay">
          {/* จอ desktop: ขยายกว้าง 2 คอลัมน์ ห้ามทรงแคบสูงจนล้นจอ (UI-CONVENTIONS "ขยายกว้างก่อนยอมสูงเกินจอ") */}
          <div className="modal" style={{ width: 'min(96vw, 920px)', maxWidth: 920, maxHeight: '94vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, marginBottom: 18, fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: 17 }}>
              {modalMode === 'create' ? '➕ เพิ่มผู้ใช้ใหม่' : '✏️ แก้ไขข้อมูลผู้ใช้'}
            </h3>

            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 13, alignItems: 'start' }}>
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
                <>
                  <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 8, fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    📧 <span style={{ color: 'var(--text)' }}>{form.email}</span>
                  </div>
                  {form.role !== 'admin' && (
                    <div>
                      <label style={labelSt}>🔑 ตั้งรหัสผ่านใหม่ (กรณีลืมรหัส / login ไม่ได้)</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {/* input ใน flex row ต้องกำหนด width เอง (กฎ F5 — index.css default 100%) */}
                        <input type="text" placeholder="รหัสใหม่ อย่างน้อย 6 ตัว..." value={resetPw}
                          onChange={e => setResetPw(e.target.value)}
                          autoComplete="off"
                          style={{ flex: 1, width: 'auto', minWidth: 0 }} />
                        <button type="button" onClick={handleResetPassword}
                          disabled={resetPwBusy || resetPw.length < 6}
                          style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                            cursor: (resetPwBusy || resetPw.length < 6) ? 'not-allowed' : 'pointer',
                            background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)',
                            opacity: (resetPwBusy || resetPw.length < 6) ? 0.5 : 1 }}>
                          {resetPwBusy ? 'กำลังตั้ง...' : 'รีเซ็ตรหัส'}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        รหัสเดิมใช้ไม่ได้ทันที — แจ้งรหัสใหม่ให้เจ้าตัว แล้วแนะนำให้ไปเปลี่ยนเองที่เมนูเปลี่ยนรหัสผ่าน
                      </div>
                    </div>
                  )}
                </>
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
                  {posOpts().map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  <option value="__custom__">อื่นๆ (พิมพ์เอง)...</option>
                </select>
                {posCustom && (
                  <input type="text" autoFocus placeholder="พิมพ์ตำแหน่ง เช่น ผู้ช่วยหัวหน้าแผนก"
                    value={form.position} onChange={e => setF('position', e.target.value)}
                    style={{ marginTop: 6 }} />
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  ตำแหน่งจริงในโรงงาน — ใช้แสดงตัวตน/รายงาน/ลายเซ็น <b>ไม่มีผลต่อสิทธิ์</b>
                  {(() => {
                    const lv = levelOfPosition(form.position);
                    return lv ? <> · ระดับงาน: <b style={{ color: 'var(--text2)' }}>{levelMeta(lv)?.label}</b></> : null;
                  })()}
                </div>
                {/* ⚠️ คำเตือน "ระดับงานไม่ตรงกับสิทธิ์ที่ให้" — แนะนำเท่านั้น ไม่บล็อก (หน้างานมีข้อยกเว้นเสมอ)
                    เคสจริงที่จับได้: ธุรการ (ระดับสนับสนุน) ที่ role ซ่อมบำรุง ได้สิทธิ์อนุมัติ PM เต็ม */}
                {(() => {
                  const kind = maintenanceKindOfPosition(form.position);   // 'am' | 'pm' | 'both' | null
                  if (!form.position || !levelOfPosition(form.position)) return null;
                  const hasPm = can('pm', 'record', form.role) || can('pm', 'approve', form.role);
                  const hasAm = can('am', 'record', form.role);
                  const msgs = [];
                  if (kind === null && (hasPm || hasAm))
                    msgs.push(`ตำแหน่งนี้เป็นสายสนับสนุน แต่ชุดสิทธิ์ที่เลือกให้บันทึก/อนุมัติผลตรวจได้ — ตรวจอีกครั้งว่าตั้งใจ`);
                  if (kind === 'am' && hasPm)
                    msgs.push(`ตำแหน่งนี้เป็นระดับหน้างาน (AM) แต่ชุดสิทธิ์ให้ทำงาน PM ของช่างได้ด้วย`);
                  if (kind === 'pm' && !hasPm)
                    msgs.push(`ตำแหน่งนี้เป็นช่าง (PM) แต่ชุดสิทธิ์ที่เลือกยังบันทึกผลตรวจ PM ไม่ได้`);
                  if (!msgs.length) return null;
                  return (
                    <div style={{ marginTop: 6, padding: '6px 9px', borderRadius: 7, fontSize: 11, lineHeight: 1.5,
                      background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)', color: 'var(--text)' }}>
                      ⚠️ {msgs.join(' · ')}
                      <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                        เป็นแค่คำแนะนำ — สิทธิ์จริงคุมที่ 🔐 จัดการสิทธิ์ (ปรับได้ตามหน้างาน)
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 800, color: 'var(--accent2)', borderBottom: '1px solid var(--border)', paddingBottom: 5, marginTop: 4 }}>
                🔐 สิทธิ์การใช้งานในระบบ — เข้าหน้าไหนได้ / เห็นข้อมูลส่วนงานไหน (ไม่เกี่ยวกับตำแหน่งงานข้างบน)
              </div>

              <div>
                <label style={labelSt}>ชุดสิทธิ์การใช้งาน (Role)</label>
                <select value={form.role} onChange={e => setF('role', e.target.value)}>
                  <RoleOptGroups withDesc />
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

              {/* ทีมช่างซ่อม — แยกคิวใบแจ้งซ่อม MO (โผล่เฉพาะ role งานซ่อม) · แยกจาก Section ไม่กระทบ scope ข้อมูลผลิต */}
              {isMtnTeamRole(form.role) && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelSt}>🔧 ทีมช่างซ่อม (แยกคิวใบแจ้งซ่อม MO)</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border2)' }}>
                    {MTN_TEAMS.map(t => {
                      const checked = (form.mtnTeams || []).some(x => teamKeyOf(x) === t);
                      return (
                        <label key={t} style={{
                          display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                          padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, userSelect: 'none',
                          background: checked ? 'rgba(245,158,11,0.15)' : 'var(--bg2)',
                          border: `1px solid ${checked ? 'rgba(245,158,11,0.5)' : 'var(--border2)'}`,
                          color: checked ? 'var(--accent2)' : 'var(--text2)',
                        }}>
                          <input type="checkbox" checked={checked}
                            onChange={() => setF('mtnTeams', checked ? form.mtnTeams.filter(x => teamKeyOf(x) !== t) : [...form.mtnTeams, t])}
                            style={{ margin: 0 }} />
                          {deptNameOf(t)}
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                    เลือกทีมที่ user คนนี้สังกัด — หน้าแจ้งซ่อม (MO) จะ<b>โชว์คิวของทีมนี้ก่อน</b> + เดาหน่วยงานปลายทางตอนแจ้ง · ช่างฝ่ายผลิตที่ first-response เลือก <b>PRODUCTION</b> · ไม่ติ๊กเลย = เห็นคิวทุกทีม
                  </div>
                </div>
              )}

              {/* แอดมินหน่วยงาน — ชั้น 2 (แก้/ตั้งค่า/อนุมัติ เฉพาะหน่วยงานตัวเอง) ซ้อนบน role เดิม · โผล่ทุก role ยกเว้น admin/display */}
              {DEPT_ADMIN_ELIGIBLE(form.role) && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
                    background: form.deptAdmin ? 'rgba(234,179,8,0.12)' : 'var(--bg3)', border: `1px solid ${form.deptAdmin ? 'rgba(234,179,8,0.55)' : 'var(--border2)'}` }}>
                    <input type="checkbox" checked={!!form.deptAdmin} onChange={e => setF('deptAdmin', e.target.checked)} style={{ margin: 0, width: 'auto' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: form.deptAdmin ? '#eab308' : 'var(--text)' }}>🛡️ เป็นแอดมินหน่วยงาน</span>
                  </label>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                    ให้สิทธิ์ <b>แก้ข้อมูล master/ตั้งค่า/อนุมัติ</b> ในหน้าที่ role นี้เข้าถึงได้ — <b>เฉพาะหน่วยงาน/scope ของตัวเอง</b> (ไม่ใช่ admin ระบบ · ไม่ได้จัดการสิทธิ์/ผังองค์กร/เพิ่ม user ทั้งระบบ) · ไม่ติ๊ก = ใช้งานได้อย่างเดียว แก้ไม่ได้ · ปรับ "แอดมินหน่วยงานทำอะไรได้" ที่หน้าจัดการสิทธิ์ คอลัมน์ 🛡️
                  </div>
                </div>
              )}

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

              {/* ⚠️ ช่อง "📬 Notify Email" ถูกถอดออก 2026-08-17 (คำสั่ง user "เราไม่ได้มีระบบ email")
                  ระบบไม่มีการส่งอีเมลเลย — ไม่มี provider ใดๆ ในโปรเจค (resend/sendgrid/smtp/nodemailer = 0 จุด)
                  แจ้งเตือนทั้งหมดไป Telegram (notification_rules) + in-app (notifications) + Web Push
                  ของเดิมเขียนว่า "รับการแจ้งเตือนจากระบบ (4M Changes, ขาดงาน ฯลฯ)" = คำสัญญาที่ระบบทำไม่ได้
                  แอดมินที่กรอกจะเชื่อว่าคนนั้นได้เมล ทั้งที่ไม่มีอะไรถูกส่ง (ตอนถอด: กรอกไว้ 0 จาก 64 คน)
                  คอลัมน์ `profiles.notify_email` **ยังอยู่** (ไม่ drop — ไม่มีข้อมูล ไม่รีบ และเผื่อวันหน้าทำระบบเมลจริง)
                  ถ้าจะเปิดใช้ ต้องมีตัวส่งเมลจริงก่อน แล้วค่อยเอาช่องนี้กลับมา */}

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
