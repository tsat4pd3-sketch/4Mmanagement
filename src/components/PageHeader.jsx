import { useContext } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../App';
import useIsMobile from '../utils/useIsMobile';

/* ══ 🧭 PageHeader — หัวหน้าเพจมาตรฐาน (breadcrumb + ชื่อหน้า + ปุ่ม + แท็บ) ══════════════
   ทุกหน้าควรขึ้นด้วย component นี้ ห้ามวาดหัวเรื่อง/แถบแท็บเอง
   (ดู docs/NAVIGATION-REVIEW.md — เดิมมีหัวเรื่องแค่ 22 จาก 56 หน้า และแท็บมุมโค้ง 7/8/12 ปนกัน)

   ใช้:
     const [tab, setTab] = useTabParam(['list','kpi'], 'list');
     <PageHeader title="แจ้งซ่อม MTN (MO)" icon="🛠️" sub="ค้างดำเนินการ 3 ใบ"
       actions={<button…/>} tabs={[{key:'list',label:'📋 รายการ MO'},…]} tab={tab} onTab={setTab} />

   • breadcrumb (หมวด › ชื่อหน้า) generate เองจาก NAV_ITEMS ตาม pathname — ไม่ต้องใส่มือ
   • เว้น paddingRight ให้พ้น 🔔 มุมขวาบนตามกติกา UI §7
   • แท็บ: ปุ่มทรงเดียวกันทั้งระบบ · เลื่อนแนวนอนได้บนมือถือ · แท็บที่ถูกเลือกใช้สี accent
   ═════════════════════════════════════════════════════════════════════════════════════════ */
export default function PageHeader({
  title, icon, sub, actions, tabs, tab, onTab, breadcrumb = true, children,
}) {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const navItem = NAV_ITEMS.find(n => n.to === pathname);
  const tabLabel = tabs?.find(t => t.key === tab)?.label;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
      {breadcrumb && navItem && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
          <button onClick={() => navigate('/')} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
          }}>🏠 หน้าหลัก</button>
          <span>›</span>
          <span>{navItem.group}</span>
          <span>›</span>
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>{navItem.label}</span>
          {tabLabel && <><span>›</span><span style={{ color: 'var(--text2)' }}>{tabLabel}</span></>}
        </div>
      )}

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        justifyContent: 'space-between', paddingRight: 52,   // กัน 🔔 ทับ (UI §7)
      }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 19 : 23, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            {icon && <span>{icon}</span>}{title}
          </h2>
          {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
        </div>
        {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>{actions}</div>}
      </div>

      {!!tabs?.length && (
        <div style={{ display: 'flex', gap: 7, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 4 : 0 }}>
          {tabs.filter(Boolean).map(t => {
            const on = t.key === tab;
            return (
              <button key={t.key} onClick={() => onTab && onTab(t.key)} style={{
                fontSize: 13.5, fontWeight: 700, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
                whiteSpace: 'nowrap', flexShrink: 0,
                background: on ? 'var(--accent)' : 'var(--bg3)',
                color: on ? '#08120a' : 'var(--text)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
              }}>
                {t.label}
                {t.badge ? <span style={{ marginLeft: 6, color: on ? '#08120a' : '#f59e0b' }}>{t.badge}</span> : null}
              </button>
            );
          })}
        </div>
      )}
      {children}
    </div>
  );
}
