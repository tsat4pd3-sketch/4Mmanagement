import { useState, useEffect, useMemo } from 'react';
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
      { key: 'page:/oee-analytics', label: 'OEE' },
    ],
  },
  {
    group: 'Logistic - Store',
    pages: [
      { key: 'page:/line-stock',   label: 'Store management' },
      { key: 'page:/heijunka',     label: 'Kanban Board' },
      { key: 'page:/rack-center',  label: 'Rack Center management' },
    ],
  },
  {
    group: 'การตรวจสอบและซ่อมบำรุง',
    pages: [
      { key: 'page:/pm-check',    label: 'ตรวจสอบอุปกรณ์เครื่องจักร' },
      { key: 'page:/pm-schedule', label: 'แผน PM อุปกรณ์เครื่องจักร' },
      { key: 'page:/pm-setup',    label: 'Setup การตรวจสอบอุปกรณ์เครื่องจักร' },
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
      { key: 'page:/add-user',          label: 'จัดการผู้ใช้งาน' },
      { key: 'page:/permissions',       label: 'จัดการสิทธิ์ (หน้านี้)' },
    ],
  },
];

const ACTION_KEYS = [
  { key: 'manage_master_data', label: 'แก้ไขข้อมูลตั้งค่า (ตารางกะ, เครื่องจักร, Line Stock, Product Master, Master Data อื่น ๆ)' },
];

export default function PermissionsManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({}); // { [`${role}:${key}`]: true }

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('role_permissions').select('role, permission_key, allowed');
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const map = useMemo(() => {
    const m = {};
    for (const r of rows) { (m[r.permission_key] ||= {})[r.role] = r.allowed; }
    return m;
  }, [rows]);

  const toggle = async (permissionKey, role, current) => {
    if (role === 'admin') return; // admin เข้าถึงได้เสมอ แก้ไม่ได้
    const cellId = `${role}:${permissionKey}`;
    setSaving(prev => ({ ...prev, [cellId]: true }));
    const nextVal = !current;
    setRows(prev => prev.map(r => (r.role === role && r.permission_key === permissionKey) ? { ...r, allowed: nextVal } : r));
    const { error } = await supabase.from('role_permissions')
      .update({ allowed: nextVal })
      .eq('role', role).eq('permission_key', permissionKey);
    setSaving(prev => { const n = { ...prev }; delete n[cellId]; return n; });
    if (error) {
      toast.error('บันทึกไม่สำเร็จ: ' + error.message);
      setRows(prev => prev.map(r => (r.role === role && r.permission_key === permissionKey) ? { ...r, allowed: current } : r));
      return;
    }
    await loadPermissions(true); // รีเฟรช cache ที่เหลือของแอปในเซสชันนี้
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
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>;

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>🔐 จัดการสิทธิ์</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>กำหนดว่าแต่ละ role เข้าหน้าไหนได้บ้าง และใครแก้ไขข้อมูลตั้งค่าได้ — เปลี่ยนแล้วมีผลทันที</div>
      </div>

      <div style={{ ...s.section, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        ⚠️ <strong>Admin เข้าถึงได้ทุกหน้าเสมอ</strong> (ล็อกไว้ กันกรณีตั้งค่าผิดจนตัวเองเข้าไม่ได้) —
        การเปลี่ยนแปลงที่นี่มีผลกับผู้ใช้ทันทีตั้งแต่ครั้งถัดไปที่โหลดหน้าเว็บ
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', position: 'sticky', left: 0, background: 'var(--bg)' }}>หน้า / สิทธิ์</th>
              {ROLES.map(r => (
                <th key={r.value} style={{ textAlign: 'center', padding: '8px 4px', minWidth: 90 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: r.color }}>{r.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAGE_GROUPS.map(g => (
              <>
                <tr key={g.group}>
                  <td colSpan={ROLES.length + 1} style={{ paddingTop: 14, paddingBottom: 4 }}>
                    <span style={s.groupTitle}>{g.group}</span>
                  </td>
                </tr>
                {g.pages.map(p => (
                  <tr key={p.key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 10px', color: 'var(--text)', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg)' }}>{p.label}</td>
                    {ROLES.map(r => <Cell key={r.value} permissionKey={p.key} role={r.value} />)}
                  </tr>
                ))}
              </>
            ))}

            <tr>
              <td colSpan={ROLES.length + 1} style={{ paddingTop: 14, paddingBottom: 4 }}>
                <span style={s.groupTitle}>การจัดการข้อมูล</span>
              </td>
            </tr>
            {ACTION_KEYS.map(a => (
              <tr key={a.key} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 10px', color: 'var(--text)', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg)', maxWidth: 340 }}>{a.label}</td>
                {ROLES.map(r => <Cell key={r.value} permissionKey={a.key} role={r.value} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
