import { useState, useEffect, useMemo, Fragment } from 'react';
import { supabase } from '../supabaseClient';
import { loadPermissions } from '../utils/permissions';
import { toast } from '../components/Toast';
import { PERMISSION_COLUMN_ROLES } from '../utils/roleMeta';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';

// ชื่อ/สีชุดสิทธิ์อ่านจาก src/utils/roleMeta.js ที่เดียว (ห้ามนิยามซ้ำในหน้า)
// PERMISSION_COLUMN_ROLES = base roles + คอลัมน์ 🛡️ แอดมินหน่วยงาน (bucket ของ flag is_dept_admin)
const ROLES = PERMISSION_COLUMN_ROLES;
// แท็บ "การเข้าถึงหน้า" โชว์เฉพาะ base role — ตัดคอลัมน์ bucket (🛡️ แอดมินหน่วยงาน) ออก (2026-08-06)
//   เพราะ hasPermission() บล็อก key ที่ขึ้นต้น 'page:' ของ bucket ไว้ในโค้ดเสมอ (permissions.js)
//   → ติ๊กช่องนั้นไม่มีทางมีผล = ช่องตายที่ทำให้คนตั้งค่าเข้าใจผิดว่าเปิดหน้าให้แอดมินหน่วยงานได้
const PAGE_COLS = ROLES.filter(r => !r.bucket);

// ชื่อหน้าให้ตรงกับ NAV_ITEMS ใน App.jsx — จัดกลุ่มตามหมวดใน sidebar
const PAGE_GROUPS = [
  {
    group: 'ภาพรวม',
    pages: [
      { key: 'page:/',            label: 'หน้าหลัก' },
      { key: 'page:/dashboard',   label: 'Dashboard' },
      { key: 'page:/dept-dashboard', label: 'Dashboard ส่วนงาน' },
      { key: 'page:/factory-map', label: 'ผังรวมโรงงาน' },
      { key: 'page:/group-overview', label: 'ภาพรวมกลุ่มโรงงาน (Mockup)' },
      { key: 'page:/adoption-outlook', label: 'ภาพเมื่อข้อมูลเชื่อมกัน' },
      { key: 'page:/remote',      label: 'รีโมทจอ' },
    ],
  },
  {
    group: 'ฝ่ายผลิต',
    pages: [
      { key: 'page:/checkin',       label: 'เช็คชื่อ & PPE' },
      { key: 'page:/management',   label: 'จัดการไลน์ผลิต' },
      { key: 'page:/daily-report', label: 'Daily Report' },
      { key: 'page:/daily-checker', label: 'Daily Checker (ศูนย์รวมเช็ค — เข้าได้ถ้ามีสิทธิ์แท็บใดแท็บหนึ่ง)' },
      { key: 'page:/daily-pm',     label: '— แท็บ Autonomous Maintenance (AM) (ใน Daily Checker)' },
      { key: 'page:/pokayoke',     label: '— แท็บ Poka-Yoke Check (ใน Daily Checker)' },
      { key: 'page:/morning-meeting', label: 'ประชุมแถวเช้า' },
      { key: 'page:/improvements', label: 'Improvements (Kaizen)' },
      { key: 'page:/oee-analytics', label: 'OEE' },
      { key: 'page:/production-plan', label: 'วางแผนการผลิต' },
      { key: 'page:/lpa',          label: '— แท็บ Layer Process Audit (ใน Daily Checker)' },
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
      { key: 'page:/store-monitor', label: 'เฝ้าระวังสต๊อก (Abnormal)' },
      { key: 'page:/transport',    label: 'มอบหมายขนส่ง (Transport)' },
    ],
  },
  {
    group: 'การตรวจสอบและซ่อมบำรุง',
    pages: [
      { key: 'page:/mtn-repair',  label: 'แจ้งซ่อม MTN (MO)' },
      { key: 'page:/pm-check',    label: 'ตรวจสอบอุปกรณ์เครื่องจักร' },
      { key: 'page:/pm-schedule', label: 'แผน PM อุปกรณ์เครื่องจักร' },
      { key: 'page:/pm-setup',    label: 'Setup การตรวจสอบอุปกรณ์เครื่องจักร' },
      { key: 'page:/mtn-layout',  label: 'ผังเครื่องจักร (ซ่อมบำรุง)' },
      { key: 'page:/pm-forecast', label: 'PM ล่วงหน้า (Planner)' },
      { key: 'page:/pm-coordination', label: 'แผนประสานงาน PM (แจ้งผลิต)' },
      { key: 'page:/energy',      label: 'พลังงานไฟฟ้า' },
    ],
  },
  {
    group: 'วิศวกรรม (PE)',
    pages: [
      { key: 'page:/pe-docs', label: 'Flow / PFMEA / Control Plan' },
    ],
  },
  {
    group: 'ควบคุมคุณภาพ QA/QC',
    pages: [
      { key: 'page:/qa',       label: 'Quality Control Center' },
      { key: 'page:/qa-setup', label: 'มาตรฐานการตรวจ & Drawing' },
      { key: 'page:/scrap-report', label: 'ใบรายงานของเสีย' },
    ],
  },
  {
    group: 'รายงาน',
    pages: [
      { key: 'page:/report',    label: 'รายงาน' },
      { key: 'page:/event-log', label: 'CQI-15 Event Log' },
      { key: 'page:/product-history', label: 'ประวัติผลิต (by Product)' },
      { key: 'page:/order-trace', label: 'สอบกลับ Order (Trace)' },
      { key: 'page:/vsm',       label: 'VSM สายธารคุณค่า' },
    ],
  },
  {
    group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล',
    pages: [
      { key: 'page:/org-setup',         label: 'แผนผังองค์กร' },
      { key: 'page:/register',          label: 'เพิ่มพนักงาน' },
      { key: 'page:/operator',          label: 'ฐานข้อมูลพนักงาน' },
      { key: 'page:/skills-report',     label: 'รายงานทักษะพนักงาน' },
      { key: 'page:/ojt-training',      label: 'ใบอบรม OJT' },
      { key: 'page:/products',          label: 'Product Master' },
      { key: 'page:/linesetup',         label: 'ตั้งค่าผังไลน์' },
      { key: 'page:/machine-database',  label: 'ฐานข้อมูลเครื่องจักร' },
      { key: 'page:/die-registry',      label: 'ทะเบียนแม่พิมพ์' },
      { key: 'page:/qr-labels',         label: 'พิมพ์ป้าย QR อุปกรณ์' },
      { key: 'page:/process-setup',     label: 'กระบวนการผลิต (Process Types)' },
      { key: 'page:/layout-setup',      label: 'ตั้งค่าผัง/Floorplan' },
      { key: 'page:/shift-organize',    label: 'ตารางกะ' },
      { key: 'page:/company-calendar',  label: 'ปฏิทินบริษัท' },
      { key: 'page:/notification-config', label: 'ตั้งค่าการแจ้งเตือน' },
      { key: 'page:/doc-forms',         label: 'ทะเบียนเอกสาร & ฟอร์ม' },
      { key: 'page:/add-user',          label: 'จัดการผู้ใช้งาน' },
      { key: 'page:/permissions',       label: 'จัดการสิทธิ์ (หน้านี้)' },
      { key: 'page:/audit-log',        label: 'ประวัติการแก้ไขข้อมูล (Audit Log)' },
    ],
  },
];

export default function PermissionsManagement() {
  const [tab, setTab] = useTabParam(['pages', 'actions'], 'pages');
  const [rows, setRows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({}); // { [`${role}:${key}`]: true }

  const load = async () => {
    setLoading(true);
    // ⚠️ role_permissions โต >1000 แถวแล้ว — Supabase ตัดที่ 1000/query ต้องดึงแบบแบ่งหน้า
    // (เดิมดึงรอบเดียว แถวที่ seed ทีหลัง เช่น bucket dept_admin แสดงเป็น "ไม่ติ๊ก" ทั้งที่ DB เป็น true)
    const fetchAllPerms = async () => {
      const PAGE = 1000; const out = [];
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabase.from('role_permissions')
          .select('role, permission_key, allowed').range(from, from + PAGE - 1);
        if (!data) break;
        out.push(...data);
        if (data.length < PAGE) break;
      }
      return out;
    };
    const [perms, { data: cat }] = await Promise.all([
      fetchAllPerms(),
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
    // ยืนยันเฉพาะตอน "ปิดสิทธิ์" (current=true→false) — มีผลทุกเครื่องทันที กันแตะ matrix พลาด
    // (เปิดสิทธิ์ = additive ไม่ต้องถาม ให้แก้ matrix ลื่น)
    if (current && !confirm(`ปิดสิทธิ์ "${permissionKey}" ของ role "${role}" ?\n\nมีผลทุกเครื่องทันที — ผู้ใช้ role นี้จะเข้า/ทำสิ่งนี้ไม่ได้`)) return;
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
        {/* label.tbtn = ขยาย hit area ≥40px บนจอทัช (matrix ช่องแน่น 11 คอลัมน์) — desktop ไม่เปลี่ยน */}
        <label className="tbtn" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: role === 'admin' ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            checked={checked}
            disabled={role === 'admin' || isSaving}
            onChange={() => toggle(permissionKey, role, checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: role === 'admin' ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.4 : 1 }}
          />
        </label>
      </td>
    );
  };

  const s = {
    page:    { padding: 'clamp(10px,2.5vw,20px) clamp(12px,3vw,24px)', maxWidth: 'min(96vw, 1400px)', margin: '0 auto' },
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
  const renderPermTable = (groups, firstColLabel, cols = ROLES) => (
    <div className="table-sticky">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', position: 'sticky', left: 0, background: 'var(--bg)' }}>{firstColLabel}</th>
            {cols.map(r => (
              <th key={r.value} style={{ textAlign: 'center', padding: '8px 4px', minWidth: 90 }} title={r.value}>
                <span style={{ fontSize: 11, fontWeight: 800, color: r.color }}>{r.icon} {r.label}</span>
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>{r.en}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <Fragment key={g.group}>
              <tr>
                <td colSpan={cols.length + 1} style={{ paddingTop: 14, paddingBottom: 4 }}>
                  <span style={s.groupTitle}>{g.group}</span>
                </td>
              </tr>
              {g.items.map(p => (
                <tr key={p.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px', color: 'var(--text)', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg)', maxWidth: 380 }}>{p.label}</td>
                  {cols.map(r => <Cell key={r.value} permissionKey={p.key} role={r.value} />)}
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
  // legacy `manage_master_data` เกษียณแล้ว (2026-07-22) — แตกเป็นสิทธิ์ย่อย oee:set_target /
  // ot_master:manage / management:assign_manpower · แถวเก่ายังอยู่ใน role_permissions (ไม่มีโค้ดอ่าน) เผื่อ rollback

  return (
    <div style={s.page}>
      <PageHeader
        title="จัดการสิทธิ์" icon="🔐"
        sub="กำหนดว่าแต่ละ role เข้าหน้าไหนได้ (แท็บแรก) และทำอะไรในหน้านั้นได้บ้าง เช่น สร้าง/แก้/ลบ/อนุมัติ (แท็บสอง)"
        tabs={[
          { key: 'pages', label: '📄 การเข้าถึงหน้า' },
          { key: 'actions', label: '🛠️ สิทธิ์การทำงาน (สร้าง/แก้/ลบ/อนุมัติ)' },
        ]}
        tab={tab} onTab={setTab}
      />

      <div style={{ ...s.section, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        ⚠️ <strong>Admin เข้าถึงได้ทุกอย่างเสมอ</strong> (ล็อกไว้ กันกรณีตั้งค่าผิดจนตัวเองเข้าไม่ได้) —
        การเปลี่ยนแปลงมีผลกับทุกเครื่องที่เปิดระบบอยู่ทันที (sync อัตโนมัติ)
        <div style={{ marginTop: 6 }}>
          🛡️ <strong style={{ color: '#eab308' }}>แอดมินหน่วยงาน</strong> = คอลัมน์พิเศษ (ไม่ใช่ role ที่เลือกให้ user) — เป็น "สิทธิ์เพิ่ม" ของคนที่ติ๊ก
          <strong> "เป็นแอดมินหน่วยงาน"</strong> ในหน้าจัดการผู้ใช้ · คนนั้นได้ <strong>role เดิม + action ที่ติ๊กในคอลัมน์นี้</strong>
          เฉพาะในหน้าที่ role เดิมเข้าถึงได้ (จำกัด scope หน่วยงานตัวเองตามปกติ ไม่ใช่ admin ระบบ) · แนะนำตั้งเฉพาะแท็บ "สิทธิ์การทำงาน"
        </div>
      </div>

      {tab === 'pages' && (
        <>
          <div style={{ ...s.section, fontSize: 12, lineHeight: 1.6, borderColor: 'rgba(234,179,8,0.4)', background: 'rgba(234,179,8,0.06)' }}>
            🛡️ <strong style={{ color: '#eab308' }}>แอดมินหน่วยงาน "เปิดหน้า" ให้ไม่ได้</strong> — คอลัมน์นั้นจึงไม่มีในแท็บนี้ (ระบบบล็อกไว้ในโค้ด ติ๊กไปก็ไม่มีผล)
            <div style={{ marginTop: 4 }}>
              ต้องการให้ใครเข้าหน้าไหนได้ ให้ติ๊กที่ <strong>role เดิมของเขา</strong> ในตารางนี้ ·
              แล้วค่อยไปเพิ่มอำนาจ แก้/อนุมัติ ให้เขาที่แท็บ <strong>"สิทธิ์การทำงาน"</strong> คอลัมน์แอดมินหน่วยงาน
            </div>
          </div>
          {renderPermTable(pageGroups, 'หน้า', PAGE_COLS)}
        </>
      )}

      {tab === 'actions' && (
        <>
          <div style={{ ...s.section, fontSize: 12, lineHeight: 1.6, borderColor: 'rgba(245,154,63,0.4)', background: 'rgba(245,154,63,0.06)' }}>
            <strong style={{ color: 'var(--accent2)' }}>หมายเหตุ:</strong>{' '}
            สิทธิ์รายการย่อยเหล่านี้จะมีผลจริงกับแต่ละหน้า <strong>เมื่อหน้านั้นถูกอัปเดตให้อ่านค่าจากระบบนี้</strong> (กำลังทยอยเปิดใช้ทีละหน้า) —
            ระหว่างนี้หน้าที่ยังไม่อัปเดตจะยึดตามพฤติกรรมเดิม ค่าที่ตั้งไว้ตรงนี้จะถูกใช้ทันทีที่หน้านั้นเปิดใช้ระบบใหม่
          </div>
          {renderPermTable(actionGroups, 'การทำงาน')}
        </>
      )}
    </div>
  );
}
