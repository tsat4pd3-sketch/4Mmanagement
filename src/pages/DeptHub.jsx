import { useNavigate } from 'react-router-dom';
import { focusSidebarGroups } from '../App';

const DEPT_CSS = `
  @keyframes hub-fade-up {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes hub-glow {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1; }
  }
  .dept-card {
    position: relative;
    border-radius: 16px;
    padding: 28px 24px;
    cursor: pointer;
    transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
    overflow: hidden;
  }
  .dept-card.active:hover {
    transform: translateY(-6px) scale(1.01);
  }
  .dept-card.soon {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .dept-card::before {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 60%);
    pointer-events: none;
  }
  .dept-chip {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
    padding: 2px 8px; border-radius: 20px;
    text-transform: uppercase;
  }
`;

// 6 หมวดตรงกับกลุ่มเมนูใน sidebar (NAV_GROUP_ORDER ใน App.jsx ไม่รวม "ภาพรวม")
const DEPTS = [
  {
    key: 'production',
    label: 'Production',
    labelTh: 'ฝ่ายผลิต',
    icon: '🏭',
    color: '#3dd65c',
    glow: 'rgba(61,214,92,0.25)',
    border: 'rgba(61,214,92,0.35)',
    bg: 'rgba(61,214,92,0.06)',
    route: '/dashboard',
    navGroups: ['ภาพรวม', 'ฝ่ายผลิต'], // หมวด sidebar ที่กางไว้เมื่อเข้าจากการ์ดนี้ (หมวดอื่นพับหมด)
    available: true,
    desc: 'เช็คชื่อ-PPE, จัดการไลน์ผลิต, Daily Report, OEE, Daily PM',
    modules: ['Dashboard', 'เช็คชื่อ & PPE', 'จัดการไลน์ผลิต', 'Daily Report', 'OEE', 'Daily PM ฝ่ายผลิต'],
  },
  {
    key: 'logistic',
    label: 'Logistic - Store',
    labelTh: 'คลังวัสดุ & จัดส่ง',
    icon: '📦',
    color: '#f59e0b',
    glow: 'rgba(245,158,11,0.25)',
    border: 'rgba(245,158,11,0.35)',
    bg: 'rgba(245,158,11,0.06)',
    route: '/line-stock',
    navGroups: ['Logistic - Store'],
    available: true,
    desc: 'Stock ในไลน์, Kanban Board, เรียกภาชนะ, Customer Demand',
    modules: ['Store management', 'Kanban Board', 'Rack Center', 'Customer Demand & Shipping'],
  },
  {
    key: 'maintenance',
    label: 'Inspection & Maintenance',
    labelTh: 'การตรวจสอบและซ่อมบำรุง',
    icon: '⚙️',
    color: '#fb923c',
    glow: 'rgba(251,146,60,0.22)',
    border: 'rgba(251,146,60,0.35)',
    bg: 'rgba(251,146,60,0.06)',
    route: '/pm-check?dept=maintenance',
    navGroups: ['การตรวจสอบและซ่อมบำรุง'],
    available: true,
    desc: 'ตรวจสอบอุปกรณ์/เครื่องจักร, แผน PM, ซ่อมบำรุง & JIG',
    modules: ['ตรวจสอบอุปกรณ์เครื่องจักร', 'แผน PM', 'PM Setup', 'JIG Maintenance'],
  },
  {
    key: 'qa',
    label: 'Quality QA/QC',
    labelTh: 'ควบคุมคุณภาพ',
    icon: '🔍',
    color: '#4d9fff',
    glow: 'rgba(77,159,255,0.22)',
    border: 'rgba(77,159,255,0.35)',
    bg: 'rgba(77,159,255,0.06)',
    route: '/qa',
    navGroups: ['ควบคุมคุณภาพ QA/QC'],
    available: true,
    desc: 'Quality Control Center, มาตรฐานการตรวจ & Drawing, CQI-15',
    modules: ['Quality Control Center', 'มาตรฐานการตรวจ & Drawing', 'CQI-15 Event Log'],
  },
  {
    key: 'report',
    label: 'Reports',
    labelTh: 'รายงาน',
    icon: '📋',
    color: '#c084fc',
    glow: 'rgba(192,132,252,0.22)',
    border: 'rgba(192,132,252,0.35)',
    bg: 'rgba(192,132,252,0.06)',
    route: '/report',
    navGroups: ['รายงาน'],
    available: true,
    desc: 'รายงานเช็คชื่อ/สรุป, อนุมัติ 4M, Skill Matrix, เอกสาร HR (PDF/CSV)',
    modules: ['รายวัน/รายพนักงาน', '4M Changes', 'Skill Matrix', 'ค่าฝีมือ/ใบบันทึก', 'จองรถ OT'],
  },
  {
    key: 'settings',
    label: 'Master Data & Settings',
    labelTh: 'ตั้งค่าโปรแกรม, ฐานข้อมูล',
    icon: '🛠️',
    color: '#34d399',
    glow: 'rgba(52,211,153,0.22)',
    border: 'rgba(52,211,153,0.35)',
    bg: 'rgba(52,211,153,0.06)',
    route: '/products',
    navGroups: ['ตั้งค่าโปรแกรม,ฐานข้อมูล'],
    available: true,
    desc: 'Product Master, พนักงาน, ผังไลน์, เครื่องจักร, ตารางกะ, สิทธิ์',
    modules: ['Product Master', 'ฐานข้อมูลพนักงาน', 'ตั้งค่าผังไลน์', 'ฐานข้อมูลเครื่องจักร', 'ตารางกะ', 'ปฏิทินบริษัท'],
  },
];

const ROLE_LABELS = {
  admin:      '👑 Admin',
  manager:    '🏢 Manager',
  supervisor: '🎯 Supervisor',
  leader:     '⭐ Leader',
  qa:         '🔍 QA',
};

export default function DeptHub({ onLogout, theme, onToggleTheme, userFullName, userRole }) {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      padding: 'clamp(24px, 5vw, 60px) clamp(16px, 4vw, 40px)',
    }}>
      <style>{DEPT_CSS}</style>

      {/* Top bar — user info + theme toggle + logout */}
      <div style={{
        position: 'absolute', top: 'clamp(16px, 3vw, 28px)', right: 'clamp(16px, 4vw, 40px)',
        display: 'flex', alignItems: 'center', gap: 10,
        animation: 'hub-fade-up 0.5s ease both',
      }}>
        {userFullName && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
            marginRight: 4, lineHeight: 1.3,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
              {userFullName}
            </span>
            {userRole && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {ROLE_LABELS[userRole] ?? userRole}
              </span>
            )}
          </div>
        )}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            title="สลับธีม"
            style={{
              width: 38, height: 38, borderRadius: 10,
              background: 'var(--card)', border: '1px solid var(--border)',
              color: 'var(--text)', cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        )}
        {onLogout && (
          <button
            onClick={onLogout}
            title="ออกจากระบบ"
            style={{
              height: 38, padding: '0 16px', borderRadius: 10,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: 'var(--font-body)',
            }}
          >
            🚪 ออกจากระบบ
          </button>
        )}
      </div>

      {/* Header */}
      <div style={{
        textAlign: 'center',
        marginBottom: 'clamp(32px, 5vw, 52px)',
        animation: 'hub-fade-up 0.55s ease both',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          background: 'rgba(61,214,92,0.08)',
          border: '1px solid rgba(61,214,92,0.2)',
          borderRadius: 40, padding: '5px 16px', marginBottom: 20,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3dd65c', display: 'inline-block', animation: 'hub-glow 2s ease infinite' }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: '#3dd65c', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>
            Enterprise Shopfloor Management
          </span>
        </div>

        <h1 style={{
          margin: 0,
          fontSize: 'clamp(22px, 4vw, 36px)',
          fontWeight: 900,
          fontFamily: 'var(--font-display)',
          color: 'var(--text)',
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
        }}>
          เลือกส่วนงาน
        </h1>
        <p style={{
          margin: '10px 0 0',
          fontSize: 'clamp(13px, 2vw, 15px)',
          color: 'var(--muted)',
          fontFamily: 'var(--font-body)',
        }}>
          Thai Summit Group · ESM System
        </p>
      </div>

      {/* Department Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(260px, 28vw, 320px), 1fr))',
        gap: 'clamp(12px, 2vw, 20px)',
        width: '100%',
        maxWidth: 1060,
        animation: 'hub-fade-up 0.65s ease 0.1s both',
      }}>
        {DEPTS.map((d, i) => (
          <div
            key={d.key}
            className={`dept-card ${d.available ? 'active' : 'soon'}`}
            style={{
              background: d.bg,
              border: `1.5px solid ${d.border}`,
              boxShadow: d.available ? `0 4px 24px ${d.glow}` : 'none',
              animationDelay: `${0.08 * i}s`,
              animation: 'hub-fade-up 0.55s ease both',
            }}
            onClick={() => {
              if (!d.available) return;
              if (d.navGroups) focusSidebarGroups(d.navGroups); // กาง sidebar เฉพาะหมวดของโมดูลนี้
              navigate(d.route);
            }}
          >
            {/* Coming Soon badge */}
            {!d.available && (
              <div style={{
                position: 'absolute', top: 14, right: 14,
                fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                padding: '3px 9px', borderRadius: 20,
                background: 'rgba(255,255,255,0.07)',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
                textTransform: 'uppercase',
              }}>
                เร็วๆ นี้
              </div>
            )}

            {/* Icon */}
            <div style={{
              fontSize: 'clamp(32px, 4vw, 42px)',
              lineHeight: 1,
              marginBottom: 14,
              filter: d.available ? 'none' : 'grayscale(1)',
            }}>
              {d.icon}
            </div>

            {/* Name */}
            <div style={{ marginBottom: 6 }}>
              <div style={{
                fontSize: 'clamp(15px, 2vw, 18px)',
                fontWeight: 800,
                color: d.available ? d.color : 'var(--text2)',
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}>
                {d.label}
              </div>
              <div style={{
                fontSize: 12,
                color: 'var(--muted)',
                marginTop: 2,
                fontFamily: 'var(--font-body)',
              }}>
                {d.labelTh}
              </div>
            </div>

            {/* Description */}
            <div style={{
              fontSize: 12,
              color: 'var(--text2)',
              lineHeight: 1.6,
              marginBottom: d.modules.length > 0 ? 14 : 0,
            }}>
              {d.desc}
            </div>

            {/* Module chips */}
            {d.modules.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {d.modules.map(m => (
                  <span key={m} className="dept-chip" style={{
                    background: `${d.color}15`,
                    color: d.color,
                    border: `1px solid ${d.color}30`,
                  }}>
                    {m}
                  </span>
                ))}
              </div>
            )}

            {/* Arrow for available */}
            {d.available && (
              <div style={{
                position: 'absolute', bottom: 18, right: 18,
                width: 28, height: 28, borderRadius: '50%',
                background: `${d.color}20`,
                border: `1px solid ${d.color}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: d.color,
              }}>
                →
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 'clamp(32px, 5vw, 52px)',
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-display)',
        animation: 'hub-fade-up 0.55s ease 0.5s both',
      }}>
        ESM · Enterprise Shopfloor Management · Thai Summit Group
      </div>
    </div>
  );
}
