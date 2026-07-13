import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { focusSidebarGroups, navItemsForGroups } from '../App';
import { roleLabel } from '../utils/roleMeta';

/* ── DeptHub — landing "editorial luxury" (redesign 2026-07-13) ─────────────
   ทิศทาง: typography-led / minimal-luxury — Fraunces (serif, โหลดใน index.html แล้ว)
   ใช้กับตัวเลข-อักษรละตินเท่านั้น (ไทย fallback เป็น Sarabun อัตโนมัติ)
   สีประจำฝ่ายใช้เป็น accent บางๆ (เลขลำดับ/เส้นขอบซ้าย/จุดในชิป) — พื้นหลังโทนเดียว
   การทำงานเดิมคงครบ: ชิปเมนูดึงจาก NAV_ITEMS (ห้ามพิมพ์ list มือ) · focusSidebarGroups ·
   กรองสิทธิ์ role · theme toggle/logout · .hub-topbar มือถือกลับเข้า flow */

const DEPT_CSS = `
  @keyframes hub-fade-up {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .hub-root {
    background:
      radial-gradient(90rem 42rem at 85% -18%, rgba(61,214,92,0.06), transparent 65%),
      radial-gradient(70rem 38rem at -12% 112%, rgba(61,214,92,0.045), transparent 60%),
      var(--bg);
  }
  [data-theme="light"] .hub-root {
    background:
      radial-gradient(90rem 42rem at 85% -18%, rgba(13,61,20,0.05), transparent 65%),
      radial-gradient(70rem 38rem at -12% 112%, rgba(13,61,20,0.035), transparent 60%),
      var(--bg);
  }
  /* กรอบบางรอบจอแบบงานพิมพ์ — เดสก์ท็อป/จอใหญ่เท่านั้น */
  .hub-frame {
    position: fixed; inset: 12px; pointer-events: none; z-index: 2;
    border: 1px solid var(--border); border-radius: 2px;
  }
  @media (max-width: 900px) { .hub-frame { display: none; } }
  /* เส้นทแยงส้ม — ลายเซ็นจาก slide template VX ของบริษัท (แผ่น agenda ใช้เส้นทแยงส้มแบ่งพื้นเขียว) */
  .hub-diagonal {
    position: fixed; top: -12vh; right: 16vw; width: 1px; height: 130vh;
    background: linear-gradient(180deg, transparent 0%, var(--accent2) 30%, var(--accent2) 62%, transparent 100%);
    transform: rotate(22deg); transform-origin: top center;
    opacity: 0.4; pointer-events: none; z-index: 1;
  }
  @media (max-width: 900px) { .hub-diagonal { display: none; } }

  .hub-row {
    position: relative;
    display: grid;
    grid-template-columns: clamp(44px, 6vw, 84px) 1fr auto;
    gap: clamp(10px, 2vw, 28px);
    align-items: start;
    padding: clamp(18px, 2.6vw, 30px) clamp(8px, 1.5vw, 18px);
    border-top: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.25s ease;
  }
  .hub-row:last-of-type { border-bottom: 1px solid var(--border); }
  .hub-row.soon { cursor: not-allowed; opacity: 0.45; }
  .hub-row::before {
    content: '';
    position: absolute; left: 0; top: -1px; bottom: -1px; width: 2px;
    background: var(--accent2);
    transform: scaleY(0); transform-origin: top;
    transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .hub-num {
    font-family: 'Fraunces', var(--font-display), serif;
    font-weight: 300; font-size: clamp(20px, 3vw, 34px); line-height: 1.1;
    color: var(--muted2); letter-spacing: 0.02em;
    transition: color 0.25s ease;
    font-variant-numeric: tabular-nums;
  }
  .hub-title {
    font-family: 'Fraunces', var(--font-display), serif;
    font-weight: 450; font-size: clamp(21px, 3vw, 31px); line-height: 1.12;
    letter-spacing: -0.01em; color: var(--text);
  }
  .hub-arrow {
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid var(--border2); color: var(--muted);
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; margin-top: 2px;
    transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), color 0.25s, border-color 0.25s;
  }
  @media (hover: hover) {
    .hub-row.active:hover { background: var(--bg2); }
    .hub-row.active:hover::before { transform: scaleY(1); }
    .hub-row.active:hover .hub-num { color: var(--accent2); }
    .hub-row.active:hover .hub-arrow { transform: translateX(6px); color: var(--accent2); border-color: var(--accent2); }
  }
  .dept-chip {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
    padding: 5px 13px; border-radius: 999px;
    background: transparent; color: var(--text2);
    border: 1px solid var(--border2);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
    font-family: var(--font-body);
  }
  .dept-chip::before {
    content: ''; width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent2);
  }
  @media (hover: hover) {
    .dept-chip:hover { color: var(--accent2); border-color: var(--accent2); transform: translateY(-1px); }
  }
  /* มือถือ ≤768px: top bar (ชื่อ user/ธีม/ออกจากระบบ) เลิกลอย absolute — กลับเข้า flow ชิดขวา
     กันทับหัวข้อ (desktop ไม่เปลี่ยน: media ไม่ match) */
  @media (max-width: 768px) {
    .hub-topbar { position: static !important; align-self: flex-end; margin-bottom: 4px; }
  }
  @media (max-width: 640px) {
    .hub-row { grid-template-columns: 40px 1fr; }
    .hub-arrow { display: none; }
  }
`;

// 6 หมวดตรงกับกลุ่มเมนูใน sidebar — เมนูย่อยบนการ์ดดึงจาก NAV_ITEMS ผ่าน navGroups อัตโนมัติ
// (ห้ามพิมพ์รายชื่อเมนูซ้ำที่นี่ — เคยมี list มือแล้ว drift ไม่ตรงกับ sidebar)
const DEPTS = [
  {
    key: 'production', label: 'Production', labelTh: 'ฝ่ายผลิต',
    route: '/dashboard', navGroups: ['ภาพรวม', 'ฝ่ายผลิต'], available: true,
    desc: 'เช็คชื่อ-PPE, จัดการไลน์ผลิต, Daily Report, OEE, Daily PM',
  },
  {
    key: 'logistic', label: 'Logistic & Store', labelTh: 'คลังวัสดุ & จัดส่ง',
    route: '/line-stock', navGroups: ['Logistic - Store'], available: true,
    desc: 'Stock ในไลน์, Kanban Board, เรียกภาชนะ, Customer Demand',
  },
  {
    key: 'maintenance', label: 'Inspection & Maintenance', labelTh: 'การตรวจสอบและซ่อมบำรุง',
    route: '/pm-check?dept=maintenance', navGroups: ['การตรวจสอบและซ่อมบำรุง'], available: true,
    desc: 'ตรวจสอบอุปกรณ์/เครื่องจักร, แผน PM, ซ่อมบำรุง & JIG',
  },
  {
    key: 'qa', label: 'Quality Assurance', labelTh: 'ควบคุมคุณภาพ QA/QC',
    route: '/qa', navGroups: ['ควบคุมคุณภาพ QA/QC'], available: true,
    desc: 'Quality Control Center, มาตรฐานการตรวจ & Drawing, CQI-15',
  },
  {
    key: 'report', label: 'Reports', labelTh: 'รายงาน',
    route: '/report', navGroups: ['รายงาน'], available: true,
    desc: 'รายงานเช็คชื่อ/สรุป, อนุมัติ 4M, Skill Matrix, เอกสาร HR (PDF/CSV)',
  },
  {
    key: 'settings', label: 'Master Data & Settings', labelTh: 'ตั้งค่าโปรแกรม, ฐานข้อมูล',
    route: '/products', navGroups: ['ตั้งค่าโปรแกรม,ฐานข้อมูล'], available: true,
    desc: 'Product Master, พนักงาน, ผังไลน์, เครื่องจักร, ตารางกะ, สิทธิ์',
  },
];

const FRAUNCES = "'Fraunces', var(--font-display), serif";

export default function DeptHub({ onLogout, theme, onToggleTheme, userFullName, userRole, userPosition }) {
  const navigate = useNavigate();

  // นาฬิกา/กะสด — display เท่านั้น (ไม่ใช่ work_date สำหรับ query) · ขอบกะตรง getCurrentShift: day 08:00-19:59
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const isDayShift = now.getHours() >= 8 && now.getHours() < 20;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const ss = String(now.getSeconds()).padStart(2, '0');
  const thaiDate = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ชิปเมนูย่อย = เมนูจริงจาก NAV_ITEMS (sidebar) กรองตามสิทธิ์ role — ตรงกับ sidebar เสมอ
  const menuItemsOf = (d) => (d.navGroups ? navItemsForGroups(d.navGroups, userRole) : []);

  const openMenu = (e, d, to) => {
    e.stopPropagation(); // อย่าให้ row onClick ยิงซ้ำ
    if (d.navGroups) focusSidebarGroups(d.navGroups);
    navigate(to);
  };

  const openDept = (d) => {
    if (!d.available) return;
    if (d.navGroups) focusSidebarGroups(d.navGroups); // กาง sidebar เฉพาะหมวดของโมดูลนี้
    navigate(d.route);
  };

  return (
    <div className="hub-root" style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 'clamp(20px, 4vw, 56px) clamp(16px, 5vw, 64px)',
    }}>
      <style>{DEPT_CSS}</style>
      <div className="hub-frame" />
      <div className="hub-diagonal" />

      {/* Top bar — user info + theme toggle + logout (มือถือ: .hub-topbar กลับเข้า flow) */}
      <div className="hub-topbar" style={{
        position: 'absolute', top: 'clamp(20px, 3vw, 32px)', right: 'clamp(20px, 4vw, 44px)',
        display: 'flex', alignItems: 'center', gap: 10, zIndex: 3,
        animation: 'hub-fade-up 0.5s ease both',
      }}>
        {userFullName && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: 6, lineHeight: 1.35 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
              {userFullName}
            </span>
            {userRole && (
              <span style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.04em' }}>
                {userPosition ? `${userPosition} · ` : ''}{roleLabel(userRole)}
              </span>
            )}
          </div>
        )}
        {onToggleTheme && (
          <button onClick={onToggleTheme} title="สลับธีม" style={{
            width: 38, height: 38, borderRadius: '50%',
            background: 'transparent', border: '1px solid var(--border2)',
            color: 'var(--text2)', cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        )}
        {onLogout && (
          <button onClick={onLogout} title="ออกจากระบบ" style={{
            height: 38, padding: '0 18px', borderRadius: 999,
            background: 'transparent', border: '1px solid rgba(239,68,68,0.35)',
            color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 700,
            letterSpacing: '0.03em', fontFamily: 'var(--font-body)',
          }}>
            ออกจากระบบ
          </button>
        )}
      </div>

      <div style={{ width: '100%', maxWidth: 1120 }}>

        {/* ── Hero: ชื่อระบบ (ซ้าย) + นาฬิกา/กะ (ขวา) ── */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between',
          gap: 'clamp(18px, 3vw, 40px)',
          padding: 'clamp(36px, 7vh, 84px) 0 clamp(28px, 4vw, 48px)',
          animation: 'hub-fade-up 0.6s ease both',
        }}>
          <div style={{ minWidth: 'min(100%, 480px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'clamp(14px, 2vw, 22px)' }}>
              {/* จุดเขียวนิ่ง+เรืองแสง — กระพริบสงวนให้สถานะแดง (Andon) ตาม UI-CONVENTIONS */}
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px 1px rgba(61,214,92,0.6)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.34em', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
                Thai Summit Group — Enterprise Shopfloor
              </span>
            </div>
            <h1 style={{ margin: 0, fontFamily: FRAUNCES, color: 'var(--text)', lineHeight: 0.98, letterSpacing: '-0.02em' }}>
              <span style={{ display: 'block', fontSize: 'clamp(44px, 8vw, 92px)', fontWeight: 300 }}>Shopfloor</span>
              <span style={{ display: 'block', fontSize: 'clamp(44px, 8vw, 92px)', fontWeight: 520, fontStyle: 'italic' }}>
                Management<span style={{ color: 'var(--accent)' }}>.</span>
              </span>
            </h1>
            <p style={{ margin: 'clamp(16px, 2.2vw, 26px) 0 0', fontFamily: FRAUNCES, fontStyle: 'italic', fontWeight: 400, fontSize: 'clamp(15px, 2vw, 19px)', color: 'var(--text2)', letterSpacing: '0.01em' }}>
              “Before we build parts, we build people.”
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 'clamp(13px, 1.6vw, 15px)', color: 'var(--muted)', fontFamily: 'var(--font-body)', lineHeight: 1.7, maxWidth: 460 }}>
              ระบบบริหารจัดการโรงงานครบวงจร — เลือกส่วนงานด้านล่างเพื่อเริ่มทำงาน
            </p>
          </div>

          {/* นาฬิกา + กะปัจจุบัน — เครื่องประดับที่มีหน้าที่จริงของหน้างาน */}
          <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
            <div style={{ fontFamily: FRAUNCES, fontWeight: 300, fontSize: 'clamp(40px, 5.5vw, 64px)', lineHeight: 1, color: 'var(--text)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
              {hhmm}
              <span style={{ fontSize: 'clamp(15px, 2vw, 22px)', color: 'var(--muted)', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>{ss}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--font-body)', letterSpacing: '0.02em' }}>
              {isDayShift ? '☀️ กะเช้า 08:00–20:00' : '🌙 กะดึก 20:00–08:00'}
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>
              {thaiDate}
            </div>
          </div>
        </div>

        {/* ── หัวลิสต์ส่วนงาน ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6, animation: 'hub-fade-up 0.6s ease 0.08s both' }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.3em', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
            Modules — ส่วนงาน
          </span>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontFamily: FRAUNCES, fontSize: 12, color: 'var(--muted2)', fontVariantNumeric: 'tabular-nums' }}>
            {String(DEPTS.filter(d => d.available).length).padStart(2, '0')}
          </span>
        </div>

        {/* ── Index list — บรรทัดละส่วนงาน สไตล์สารบัญนิตยสาร ── */}
        <div>
          {DEPTS.map((d, i) => {
            const items = menuItemsOf(d);
            return (
              <div
                key={d.key}
                className={`hub-row ${d.available ? 'active' : 'soon'}`}
                style={{ animation: `hub-fade-up 0.55s ease ${0.12 + 0.07 * i}s both` }}
                onClick={() => openDept(d)}
              >
                <div className="hub-num">{String(i + 1).padStart(2, '0')}</div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <span className="hub-title">{d.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-body)', letterSpacing: '0.02em' }}>
                      {d.labelTh}
                    </span>
                    {!d.available && (
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase', border: '1px solid var(--border2)', borderRadius: 999, padding: '2px 10px' }}>
                        เร็วๆ นี้
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.65, fontFamily: 'var(--font-body)', maxWidth: 660 }}>
                    {d.desc}
                  </div>
                  {/* ชิปเมนูจริงจาก sidebar (NAV_ITEMS) — คลิกเข้าหน้านั้นตรงๆ */}
                  {items.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
                      {items.map(item => (
                        <button key={item.to} type="button" className="dept-chip"
                          title={`เปิด ${item.label}`} onClick={e => openMenu(e, d, item.to)}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {d.available && <div className="hub-arrow">→</div>}
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          padding: 'clamp(24px, 4vw, 40px) 0 clamp(8px, 2vw, 16px)',
          animation: 'hub-fade-up 0.55s ease 0.6s both',
        }}>
          <span style={{ fontFamily: FRAUNCES, fontStyle: 'italic', fontSize: 13, color: 'var(--muted)' }}>ESM</span>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--muted2)', letterSpacing: '0.22em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
            Zero Defect is Possible — Thai Summit Group
          </span>
        </div>
      </div>
    </div>
  );
}
