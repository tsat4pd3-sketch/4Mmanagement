import { useState, useEffect, useMemo, Fragment } from 'react';
import { supabase } from '../supabaseClient';
import { loadPermissions } from '../utils/permissions';
import { toast } from '../components/Toast';

const ROLES = [
  { value: 'admin',      label: 'Admin',      color: 'var(--accent)' },
  { value: 'manager',    label: 'Manager',    color: '#f59e0b' },
  { value: 'supervisor', label: 'Supervisor', color: '#4d9fff' },
  { value: 'leader',     label: 'Leader',     color: '#22c55e' },
  { value: 'qa',         label: 'QA',         color: '#c084fc' },
  { value: 'document_control', label: 'Doc Control', color: '#fb923c' },
  { value: 'sale',       label: 'Sale',       color: '#38bdf8' },
  { value: 'display',    label: 'Display',    color: '#94a3b8' },
];

// ชื่อหน้าให้ตรงกับ NAV_ITEMS ใน App.jsx — จัดกลุ่มตามหมวดใน sidebar
const PAGE_GROUPS = [
  {
    group: 'ภาพรวม',
    pages: [
      { key: 'page:/',            label: 'หน้าหลัก' },
      { key: 'page:/dashboard',   label: 'Dashboard' },
    ],
  },
  {
    group: 'ฝ่ายผลิต',
    pages: [
      { key: 'page:/checkin',       label: 'เช็คชื่อ & PPE' },
      { key: 'page:/management',   label: 'จัดการไลน์ผลิต' },
      { key: 'page:/daily-report', label: 'Daily Report' },
      { key: 'page:/daily-pm',     label: 'Daily PM ฝ่ายผลิต' },
      { key: 'page:/oee-analytics', label: 'OEE' },
    ],
  },
  {
    group: 'Logistic - Store',
    pages: [
      { key: 'page:/line-stock',   label: 'Store management' },
      { key: 'page:/heijunka',     label: 'Kanban Board' },
      { key: 'page:/rack-center',  label: 'Rack Center management' },
      { key: 'page:/planner-sales', label: 'Planner & Sales' },
      { key: 'page:/rundown-stock', label: 'Rundown Stock' },
      { key: 'page:/customer-demand', label: 'Delivery' },
    ],
  },
  {
    group: 'การตรวจสอบและซ่อมบำรุง',
    pages: [
      { key: 'page:/pm-check',    label: 'ตรวจสอบอุปกรณ์เครื่องจักร' },
      { key: 'page:/pm-schedule', label: 'แผน PM อุปกรณ์เครื่องจักร' },
      { key: 'page:/pm-setup',    label: 'Setup การตรวจสอบอุปกรณ์เครื่องจักร' },
      { key: 'page:/mtn-layout',  label: 'ผังเครื่องจักร (ซ่อมบำรุง)' },
    ],
  },
  {
    group: 'ควบคุมคุณภาพ QA/QC',
    pages: [
      { key: 'page:/qa',       label: 'Quality Control Center' },
      { key: 'page:/qa-setup', label: 'มาตรฐานการตรวจ & Drawing' },
    ],
  },
  {
    group: 'รายงาน',
    pages: [
      { key: 'page:/report',    label: 'รายงาน' },
      { key: 'page:/event-log', label: 'CQI-15 Event Log' },
    ],
  },
  {
    group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล',
    pages: [
      { key: 'page:/org-setup',         label: 'แผนผังองค์กร' },
      { key: 'page:/register',          label: 'เพิ่มพนักงาน' },
      { key: 'page:/operator',          label: 'ฐานข้อมูลพนักงาน' },
      { key: 'page:/products',          label: 'Product Master' },
      { key: 'page:/linesetup',         label: 'ตั้งค่าผังไลน์' },
      { key: 'page:/machine-database',  label: 'ฐานข้อมูลเครื่องจักร' },
      { key: 'page:/shift-organize',    label: 'ตารางกะ' },
      { key: 'page:/company-calendar',  label: 'ปฏิทินบริษัท' },
      { key: 'page:/notification-config', label: 'ตั้งค่าการแจ้งเตือน' },
      { key: 'page:/add-user',          label: 'จัดการผู้ใช้งาน' },
      { key: 'page:/permissions',       label: 'จัดการสิทธิ์ (หน้านี้)' },
    ],
  },
];

export default function PermissionsManagement() {
  const [tab, setTab] = useState('pages'); // 'pages' | 'actions'
  const [rows, setRows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({}); // { [`${role}:${key}`]: true }

  const load = async () => {
    setLoading(true);
    const [{ data: perms }, { data: cat }] = await Promise.all([
      supabase.from('role_permissions').select('role, permission_key, allowed'),
      supabase.from('permission_catalog').select('resource, action, label, group_name, sort').order('sort'),
    ]);
    setRows(perms || []);
    setCatalog(cat || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const map = useMemo(() => {
    const m = {};
    for (const r of rows) { (m[r.permission_key] ||= {})[r.role] = r.allowed; }
    return m;
  }, [rows]);

  // catalog จัดกลุ่มตาม group_name เรียงตาม sort (sort ใน seed ไล่ต่อเนื่องข้ามกลุ่ม)
  const actionGroups = useMemo(() => {
    const groups = [];
    for (const c of catalog) {
      let g = groups.find(x => x.group === c.group_name);
      if (!g) { g = { group: c.group_name, items: [] }; groups.push(g); }
      g.items.push({ key: `${c.resource}:${c.action}`, label: c.label });
    }
    return groups;
  }, [catalog]);

  const toggle = async (permissionKey, role, current) => {
    if (role === 'admin') return; // admin เข้าถึงได้เสมอ แก้ไม่ได้
    const cellId = `${role}:${permissionKey}`;
    setSaving(prev => ({ ...prev, [cellId]: true }));
    const nextVal = !current;
    setRows(prev => {
      const exists = prev.some(r => r.role === role && r.permission_key === permissionKey);
      return exists
        ? prev.map(r => (r.role === role && r.permission_key === permissionKey) ? { ...r, allowed: nextVal } : r)
        : [...prev, { role, permission_key: permissionKey, allowed: nextVal }];
    });
    // upsert (ไม่ใช่ update) — เผื่อ catalog เพิ่มรายการใหม่ที่ยังไม่มีแถว role_permissions
    // update ที่ไม่เจอแถวจะเงียบ (ไม่ error) ทำให้ UI โชว์สำเร็จทั้งที่ไม่ได้บันทึก
    const { error } = await supabase.from('role_permissions')
      .upsert({ role, permission_key: permissionKey, allowed: nextVal }, { onConflict: 'role,permission_key' });
    setSaving(prev => { const n = { ...prev }; delete n[cellId]; return n; });
    if (error) {
      toast.error('บันทึกไม่สำเร็จ: ' + error.message);
      setRows(prev => prev.map(r => (r.role === role && r.permission_key === permissionKey) ? { ...r, allowed: current } : r));
      return;
    }
    await loadPermissions(true); // รีเฟรช cache ของเซสชันนี้ (เซสชันอื่น sync ผ่าน realtime ใน App.jsx)
  };

  const Cell = ({ permissionKey, role }) => {
    const checked = role === 'admin' ? true : (map[permissionKey]?.[role] ?? false);
    const isSaving = !!saving[`${role}:${permissionKey}`];
    return (
      <td style={{ textAlign: 'center', padding: '8px 4px' }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={role === 'admin' || isSaving}
          onChange={() => toggle(permissionKey, role, checked)}
          style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: role === 'admin' ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.4 : 1 }}
        />
      </td>
    );
  };

  const s = {
    page:    { padding: '20px 24px', maxWidth: 'min(96vw, 1400px)', margin: '0 auto' },
    section: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 },
    groupTitle: { fontSize: 13, fontWeight: 800, color: 'var(--accent)', margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' },
    tabBtn: (active) => ({
      padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
      background: active ? 'var(--accent-dim)' : 'var(--bg3)',
      color: active ? 'var(--accent)' : 'var(--text2)',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
    }),
  };

  // เรียกเป็นฟังก์ชันธรรมดา (ไม่ใช่ <Component/>) — กัน react ถือเป็น component ใหม่ทุก render แล้ว remount ตาราง
  const renderPermTable = (groups, firstColLabel) => (
    <div className="table-sticky">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', position: 'sticky', left: 0, background: 'var(--bg)' }}>{firstColLabel}</th>
            {ROLES.map(r => (
              <th key={r.value} style={{ textAlign: 'center', padding: '8px 4px', minWidth: 90 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: r.color }}>{r.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <Fragment key={g.group}>
              <tr>
                <td colSpan={ROLES.length + 1} style={{ paddingTop: 14, paddingBottom: 4 }}>
                  <span style={s.groupTitle}>{g.group}</span>
                </td>
              </tr>
              {g.items.map(p => (
                <tr key={p.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px', color: 'var(--text)', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg)', maxWidth: 380 }}>{p.label}</td>
                  {ROLES.map(r => <Cell key={r.value} permissionKey={p.key} role={r.value} />)}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>;

  const pageGroups   = PAGE_GROUPS.map(g => ({ group: g.group, items: g.pages }));
  const legacyGroup  = { group: 'Legacy (ระบบเดิม — จะถูกแทนด้วยสิทธิ์รายการย่อยด้านบน)', items: [
    { key: 'manage_master_data', label: 'แก้ไขข้อมูลตั้งค่า (ตารางกะ, เครื่องจักร, Line Stock, Product Master ฯลฯ — สวิตช์รวมแบบเดิม)' },
  ] };

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>🔐 จัดการสิทธิ์</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          กำหนดว่าแต่ละ role เข้าหน้าไหนได้ (แท็บแรก) และทำอะไรในหน้านั้นได้บ้าง เช่น สร้าง/แก้/ลบ/อนุมัติ (แท็บสอง)
        </div>
      </div>

      <div style={{ ...s.section, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        ⚠️ <strong>Admin เข้าถึงได้ทุกอย่างเสมอ</strong> (ล็อกไว้ กันกรณีตั้งค่าผิดจนตัวเองเข้าไม่ได้) —
        การเปลี่ยนแปลงมีผลกับทุกเครื่องที่เปิดระบบอยู่ทันที (sync อัตโนมัติ)
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={s.tabBtn(tab === 'pages')} onClick={() => setTab('pages')}>📄 การเข้าถึงหน้า</button>
        <button style={s.tabBtn(tab === 'actions')} onClick={() => setTab('actions')}>🛠️ สิทธิ์การทำงาน (สร้าง/แก้/ลบ/อนุมัติ)</button>
      </div>

      {tab === 'pages' && renderPermTable(pageGroups, 'หน้า')}

      {tab === 'actions' && (
        <>
          <div style={{ ...s.section, fontSize: 12, lineHeight: 1.6, borderColor: 'rgba(245,154,63,0.4)', background: 'rgba(245,154,63,0.06)' }}>
            <strong style={{ color: 'var(--accent2)' }}>หมายเหตุ:</strong>{' '}
            สิทธิ์รายการย่อยเหล่านี้จะมีผลจริงกับแต่ละหน้า <strong>เมื่อหน้านั้นถูกอัปเดตให้อ่านค่าจากระบบนี้</strong> (กำลังทยอยเปิดใช้ทีละหน้า) —
            ระหว่างนี้หน้าที่ยังไม่อัปเดตจะยึดตามพฤติกรรมเดิม ค่าที่ตั้งไว้ตรงนี้จะถูกใช้ทันทีที่หน้านั้นเปิดใช้ระบบใหม่
          </div>
          {renderPermTable([...actionGroups, legacyGroup], 'การทำงาน')}
        </>
      )}
    </div>
  );
}
