import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { focusSidebarGroups, navItemsForGroups } from '../App';
import { roleLabel } from '../utils/roleMeta';
import { supabase, supabaseDR } from '../supabaseClient';
import { fetchActiveDowntimes } from '../utils/downtimeAlarm';

/* ── DeptHub — landing "Smart Factory / Industry 5.0" (redesign v2 2026-07-13) ──
   คอนเซปต์: Mission Control ของโรงงาน — ไม่ใช่แค่เมนู แต่เป็นแผงควบคุมที่มีชีวิต
   - แถบ TELEMETRY สด: ไลน์กำลังผลิต / เช็คชื่อวันนี้ / Downtime ค้าง / 4M รออนุมัติ
     (นับจากตารางจริง refresh ทุก 60 วิ — เป็นของเสริม ผิดพลาดต้องไม่ทำหน้าพัง)
   - โมดูล = แผงควบคุม: มุม bracket + รหัสโมดูล (PRD·01) + ไฟสถานะนิ่ง (Andon §2: ห้ามกระพริบ)
   - พื้นหลังกริด blueprint จางๆ + นาฬิกา/กะสด · ฟอนต์ตัวเลข/รหัส = monospace
   การทำงานเดิมคงครบ: ชิปเมนูดึงจาก NAV_ITEMS (ห้ามพิมพ์ list มือ) · focusSidebarGroups ·
   กรองสิทธิ์ role · theme toggle/logout · .hub-topbar มือถือกลับเข้า flow */

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const DEPT_CSS = `
  @keyframes hub-fade-up {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  /* กริด blueprint จางๆ ทั้งหน้า — โทนตาม theme */
  .hub-root {
    background-image:
      radial-gradient(80rem 40rem at 50% -14rem, rgba(61,214,92,0.07), transparent 65%),
      linear-gradient(rgba(61,214,92,0.032) 1px, transparent 1px),
      linear-gradient(90deg, rgba(61,214,92,0.032) 1px, transparent 1px);
    background-size: auto, 44px 44px, 44px 44px;
  }
  [data-theme="light"] .hub-root {
    background-image:
      radial-gradient(80rem 40rem at 50% -14rem, rgba(13,61,20,0.06), transparent 65%),
      linear-gradient(rgba(13,61,20,0.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(13,61,20,0.045) 1px, transparent 1px);
    background-size: auto, 44px 44px, 44px 44px;
  }
  .smart-card {
    position: relative;
    border-radius: 12px;
    padding: 22px 20px 20px;
    cursor: pointer;
    background: var(--card);
    border: 1px solid var(--border2);
    overflow: hidden;
    transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
  }
  /* เส้นสถานะสีประจำโมดูลบนขอบบน */
  .smart-card .edge {
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--mc) 0%, transparent 78%);
    opacity: 0.85;
  }
  /* มุม bracket แบบ HUD */
  .smart-card::before, .smart-card::after {
    content: ''; position: absolute; width: 13px; height: 13px; opacity: 0.55;
    transition: opacity 0.2s ease;
  }
  .smart-card::before { top: 7px; left: 7px; border-top: 1.5px solid var(--mc); border-left: 1.5px solid var(--mc); }
  .smart-card::after { bottom: 7px; right: 7px; border-bottom: 1.5px solid var(--mc); border-right: 1.5px solid var(--mc); }
  @media (hover: hover) {
    .smart-card.active:hover {
      transform: translateY(-5px);
      border-color: var(--mc);
      box-shadow: 0 10px 30px -12px var(--mc);
    }
    .smart-card.active:hover::before, .smart-card.active:hover::after { opacity: 1; }
  }
  .smart-card.soon { cursor: not-allowed; opacity: 0.5; }
  .dept-chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
    padding: 4px 10px; border-radius: 6px;
    cursor: pointer;
    transition: transform 0.12s ease, filter 0.12s ease;
    font-family: var(--font-body);
  }
  @media (hover: hover) {
    .dept-chip:hover { transform: translateY(-1px); filter: brightness(1.35); }
  }
  .tele-tile {
    flex: 1 1 150px; min-width: 150px;
    background: var(--card); border: 1px solid var(--border2); border-radius: 10px;
    padding: 12px 16px 11px; text-align: left; position: relative; overflow: hidden;
  }
  .tele-tile .scan {
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--tc) 0%, transparent 70%); opacity: 0.7;
  }
  /* กริดโมดูล — ใช้พื้นที่แนวนอนเต็มที่ (กฎ user 2026-07-14: ห้ามเหลือขอบข้างว่างเยอะ)
     6 การ์ดจัดคอลัมน์ให้สมดุล: แคบ=auto · ≥1200px = 3 คอลัมน์ (2 แถว) · ≥1900px = 6 คอลัมน์แถวเดียว (จอ TV) */
  .hub-grid {
    display: grid; gap: clamp(12px, 1.6vw, 20px);
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
  @media (min-width: 1200px) { .hub-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1900px) { .hub-grid { grid-template-columns: repeat(6, 1fr); } }
  /* มือถือ ≤768px: top bar (ชื่อ user/ธีม/ออกจากระบบ) เลิกลอย absolute — กลับเข้า flow ชิดขวา
     กันทับหัวข้อ (desktop ไม่เปลี่ยน: media ไม่ match) */
  @media (max-width: 768px) {
    .hub-topbar { position: static !important; align-self: flex-end; margin-bottom: 4px; }
  }
`;

// 6 หมวดตรงกับกลุ่มเมนูใน sidebar — เมนูย่อยบนการ์ดดึงจาก NAV_ITEMS ผ่าน navGroups อัตโนมัติ
// (ห้ามพิมพ์รายชื่อเมนูซ้ำที่นี่ — เคยมี list มือแล้ว drift ไม่ตรงกับ sidebar)
const DEPTS = [
  {
    key: 'production', code: 'PRD·01', label: 'Production', labelTh: 'ฝ่ายผลิต', icon: '🏭',
    color: '#3dd65c', route: '/dashboard', navGroups: ['ภาพรวม', 'ฝ่ายผลิต'], available: true,
    desc: 'เช็คชื่อ-PPE, จัดการไลน์ผลิต, Daily Report, OEE, Daily PM',
  },
  {
    key: 'logistic', code: 'LOG·02', label: 'Logistic & Store', labelTh: 'คลังวัสดุ & จัดส่ง', icon: '📦',
    color: '#f59e0b', route: '/line-stock', navGroups: ['Logistic - Store'], available: true,
    desc: 'Stock ในไลน์, Kanban Board, เรียกภาชนะ, Customer Demand',
  },
  {
    key: 'maintenance', code: 'MTN·03', label: 'Inspection & Maintenance', labelTh: 'การตรวจสอบและซ่อมบำรุง', icon: '⚙️',
    color: '#fb923c', route: '/pm-check?dept=maintenance', navGroups: ['การตรวจสอบและซ่อมบำรุง'], available: true,
    desc: 'ตรวจสอบอุปกรณ์/เครื่องจักร, แผน PM, ซ่อมบำรุง & JIG',
  },
  {
    key: 'qa', code: 'QUA·04', label: 'Quality QA/QC', labelTh: 'ควบคุมคุณภาพ', icon: '🔍',
    color: '#4d9fff', route: '/qa', navGroups: ['ควบคุมคุณภาพ QA/QC'], available: true,
    desc: 'Quality Control Center, มาตรฐานการตรวจ & Drawing, CQI-15',
  },
  {
    key: 'report', code: 'RPT·05', label: 'Reports', labelTh: 'รายงาน', icon: '📋',
    color: '#c084fc', route: '/report', navGroups: ['รายงาน'], available: true,
    desc: 'รายงานเช็คชื่อ/สรุป, อนุมัติ 4M, Skill Matrix, เอกสาร HR (PDF/CSV)',
  },
  {
    key: 'settings', code: 'SET·06', label: 'Master Data & Settings', labelTh: 'ตั้งค่าโปรแกรม, ฐานข้อมูล', icon: '🛠️',
    color: '#34d399', route: '/products', navGroups: ['ตั้งค่าโปรแกรม,ฐานข้อมูล'], available: true,
    desc: 'Product Master, พนักงาน, ผังไลน์, เครื่องจักร, ตารางกะ, สิทธิ์',
  },
];

// work date เดียวกับกฎทั้งระบบ: ก่อน 08:00 นับเป็นวันก่อนหน้า (ห้าม toISOString)
function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DeptHub({ onLogout, theme, onToggleTheme, userFullName, userRole, userPosition }) {
  const navigate = useNavigate();

  // นาฬิกา/กะสด — display เท่านั้น (ขอบกะตรง getCurrentShift: day 08:00–19:59)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const isDayShift = now.getHours() >= 8 && now.getHours() < 20;
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const thaiDate = now.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  // ── LIVE TELEMETRY — นับจากตารางจริง (head:true count = เบา) refresh ทุก 60 วิ ──
  // เป็นของเสริมของหน้า hub: query พลาด = คงค่าเดิม/แสดง "–" ห้ามทำหน้าพัง
  const [tele, setTele] = useState({ lines: null, present: null, dt: null, fourM: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const wd = getWorkDate();
      try {
        const [s, a, m, dts] = await Promise.all([
          supabaseDR.from('production_sessions').select('id', { count: 'exact', head: true })
            .eq('work_date', wd).in('status', ['open', 'pending_close']),
          supabase.from('daily_production_logs').select('id', { count: 'exact', head: true })
            .eq('work_date', wd).eq('is_present', true),
          supabase.from('four_m_logs').select('id', { count: 'exact', head: true })
            .in('status', ['pending', 'pending_qa']),
          fetchActiveDowntimes(),
        ]);
        if (!alive) return;
        setTele({ lines: s.count ?? 0, present: a.count ?? 0, fourM: m.count ?? 0, dt: dts.list.length });
      } catch { /* เงียบ — telemetry เป็นของเสริม */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const TELE = [
    { key: 'lines',   label: 'ไลน์กำลังผลิต',  sub: 'LINES RUNNING',  val: tele.lines,   color: '#3dd65c', unit: 'ไลน์' },
    { key: 'present', label: 'เช็คชื่อวันนี้',   sub: 'ON SHIFT',       val: tele.present, color: '#4d9fff', unit: 'คน' },
    { key: 'dt',      label: 'Downtime ค้าง', sub: 'MACHINES DOWN',  val: tele.dt,      color: tele.dt > 0 ? '#ef4444' : '#3dd65c', unit: 'จุด' },
    { key: 'fourM',   label: '4M รออนุมัติ',   sub: '4M PENDING',     val: tele.fourM,   color: tele.fourM > 0 ? '#f59e0b' : '#3dd65c', unit: 'รายการ' },
  ];

  // ชิปเมนูย่อย = เมนูจริงจาก NAV_ITEMS (sidebar) กรองตามสิทธิ์ role — ตรงกับ sidebar เสมอ
  const menuItemsOf = (d) => (d.navGroups ? navItemsForGroups(d.navGroups, userRole) : []);

  const openMenu = (e, d, to) => {
    e.stopPropagation(); // อย่าให้ card onClick ยิงซ้ำ
    if (d.navGroups) focusSidebarGroups(d.navGroups);
    navigate(to);
  };

  return (
    <div className="hub-root" style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      padding: 'clamp(24px, 5vw, 56px) clamp(16px, 4vw, 40px)',
    }}>
      <style>{DEPT_CSS}</style>

      {/* Top bar — user info + theme toggle + logout (มือถือ: .hub-topbar กลับเข้า flow) */}
      <div className="hub-topbar" style={{
        position: 'absolute', top: 'clamp(16px, 3vw, 28px)', right: 'clamp(16px, 4vw, 40px)',
        display: 'flex', alignItems: 'center', gap: 10,
        animation: 'hub-fade-up 0.5s ease both',
      }}>
        {userFullName && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: 4, lineHeight: 1.3 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
              {userFullName}
            </span>
            {userRole && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {userPosition ? `${userPosition} · ` : ''}{roleLabel(userRole)}
              </span>
            )}
          </div>
        )}
        {onToggleTheme && (
          <button onClick={onToggleTheme} title="สลับธีม" style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'var(--card)', border: '1px solid var(--border)',
            color: 'var(--text)', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        )}
        {onLogout && (
          <button onClick={onLogout} title="ออกจากระบบ" style={{
            height: 38, padding: '0 16px', borderRadius: 10,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)',
          }}>
            🚪 ออกจากระบบ
          </button>
        )}
      </div>

      {/* ── Header — แถวนอนเต็มความกว้าง: ชื่อระบบซ้าย · นาฬิกา/กะขวา (จอแคบ wrap) ── */}
      <div style={{ width: '100%', maxWidth: 'min(97vw, 2400px)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '14px clamp(20px, 3vw, 48px)', marginBottom: 'clamp(18px, 2.5vw, 26px)', animation: 'hub-fade-up 0.55s ease both' }}>
        <div style={{ minWidth: 'min(100%, 420px)' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          background: 'rgba(61,214,92,0.08)', border: '1px solid rgba(61,214,92,0.22)',
          borderRadius: 6, padding: '5px 14px', marginBottom: 18,
        }}>
          {/* จุดเขียวนิ่ง+เรืองแสง — กระพริบสงวนให้สถานะแดง (Andon §2) */}
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3dd65c', boxShadow: '0 0 7px 1px rgba(61,214,92,0.7)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', color: '#3dd65c', textTransform: 'uppercase', fontFamily: MONO }}>
            Industry 5.0 · Smart Factory Platform
          </span>
        </div>

        <h1 style={{
          margin: 0, fontSize: 'clamp(24px, 4.2vw, 40px)', fontWeight: 900,
          fontFamily: 'var(--font-display)', color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1.15,
        }}>
          ESM Control Center
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 'clamp(13px, 2vw, 15px)', color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>
          ศูนย์ควบคุมโรงงานอัจฉริยะ · Thai Summit Group — เลือกส่วนงานเพื่อเริ่มทำงาน
        </p>
        </div>

        {/* นาฬิกา + กะ — readout สด (ชิดขวาบนจอกว้าง) */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: 'var(--text)', background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, padding: '4px 12px', fontVariantNumeric: 'tabular-nums' }}>
            ⏱ {clock}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: isDayShift ? '#f59e0b' : '#4d9fff', background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, padding: '5px 12px' }}>
            {isDayShift ? '☀️ กะเช้า 08:00–20:00' : '🌙 กะดึก 20:00–08:00'}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--text2)', background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, padding: '5px 12px' }}>
            📅 {thaiDate}
          </span>
        </div>
      </div>

      {/* ── LIVE TELEMETRY ── */}
      <div style={{ width: '100%', maxWidth: 'min(97vw, 2400px)', marginBottom: 'clamp(22px, 3vw, 32px)', animation: 'hub-fade-up 0.6s ease 0.08s both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: MONO }}>
            ● Live Telemetry
          </span>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: MONO }}>refresh 60s</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {TELE.map(t => (
            <div key={t.key} className="tele-tile" style={{ '--tc': t.color }}>
              <div className="scan" />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 700, lineHeight: 1, color: t.val == null ? 'var(--muted2)' : t.color, fontVariantNumeric: 'tabular-nums' }}>
                  {t.val == null ? '–' : t.val}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>{t.unit}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--text2)', fontFamily: 'var(--font-body)' }}>{t.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted2)', letterSpacing: '0.14em', fontFamily: MONO }}>{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Module Grid ── */}
      <div className="hub-grid" style={{ width: '100%', maxWidth: 'min(97vw, 2400px)' }}>
        {DEPTS.map((d, i) => (
          <div
            key={d.key}
            className={`smart-card ${d.available ? 'active' : 'soon'}`}
            style={{ '--mc': d.color, animation: `hub-fade-up 0.55s ease ${0.12 + 0.07 * i}s both` }}
            onClick={() => {
              if (!d.available) return;
              if (d.navGroups) focusSidebarGroups(d.navGroups); // กาง sidebar เฉพาะหมวดของโมดูลนี้
              navigate(d.route);
            }}
          >
            <div className="edge" />

            {/* แถวบน: รหัสโมดูล + สถานะ */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: d.color, opacity: 0.9 }}>
                {d.code}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: d.available ? 'var(--text2)' : 'var(--muted)' }}>
                {/* ไฟสถานะนิ่ง+เรืองแสง (ไม่กระพริบ) */}
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.available ? '#3dd65c' : 'var(--muted2)', boxShadow: d.available ? '0 0 5px 1px rgba(61,214,92,0.6)' : 'none' }} />
                {d.available ? 'ONLINE' : 'SOON'}
              </span>
            </div>

            {/* ไอคอน + ชื่อ */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 30, lineHeight: 1, filter: d.available ? 'none' : 'grayscale(1)' }}>{d.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'clamp(15px, 2vw, 17px)', fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                  {d.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-body)' }}>
                  {d.labelTh}
                </div>
              </div>
            </div>

            {/* คำอธิบาย */}
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: menuItemsOf(d).length > 0 ? 12 : 0, fontFamily: 'var(--font-body)' }}>
              {d.desc}
            </div>

            {/* ชิปเมนูจริงจาก sidebar (NAV_ITEMS) — คลิกเข้าหน้านั้นได้เลย */}
            {menuItemsOf(d).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {menuItemsOf(d).map(item => (
                  <button key={item.to} type="button" className="dept-chip"
                    title={`เปิด ${item.label}`}
                    onClick={e => openMenu(e, d, item.to)}
                    style={{ background: `${d.color}15`, color: d.color, border: `1px solid ${d.color}30` }}>
                    <span style={{ fontSize: 12 }}>{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={{
        marginTop: 'clamp(28px, 4vw, 44px)',
        fontSize: 11, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase',
        fontFamily: MONO, animation: 'hub-fade-up 0.55s ease 0.55s both', textAlign: 'center',
      }}>
        ESM · Smart Factory Platform · Thai Summit Group
      </div>
    </div>
  );
}
