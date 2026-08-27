import { useState, useEffect, useRef, useContext, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { navItemsForGroups, UserContext } from '../App';
import { scopedLineNames, MAINTENANCE_ROLES } from '../utils/sectionScope';
import { roleLabel } from '../utils/roleMeta';
import { positionLabel } from '../utils/positions';   // position เก็บเป็น key — แสดงต้องแปลงชื่อเสมอ
import { canAccessPage } from '../utils/permissions';
import { buildProfileMenu } from '../utils/profileMenu';
import { supabase, supabaseDR } from '../supabaseClient';
import { fetchActiveDowntimes } from '../utils/downtimeAlarm';
import { toast } from '../components/Toast';
import { uploadMyAvatar } from '../utils/profileSelf';
import ImageCropModal from '../components/ImageCropModal';
import SignatureModal from '../components/SignatureModal';
import ChangePasswordModal from '../components/ChangePasswordModal';
const FeedbackModal = lazy(() => import('../components/FeedbackModal'));  // 💬 ช่องรับ feedback (ชุดเดียวกับ sidebar)
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';

/* ── DeptHub — landing "Smart Factory / Industry 5.0" (redesign v2 2026-07-13) ──
   คอนเซปต์: Mission Control ของโรงงาน — ไม่ใช่แค่เมนู แต่เป็นแผงควบคุมที่มีชีวิต
   - แถบ TELEMETRY สด: ไลน์กำลังผลิต / เช็คชื่อวันนี้ / Downtime ค้าง / 4M รออนุมัติ
     (นับจากตารางจริง refresh ทุก 60 วิ — เป็นของเสริม ผิดพลาดต้องไม่ทำหน้าพัง)
   - โมดูล = แผงควบคุม: มุม bracket + รหัสโมดูล (PRD·01) + ไฟสถานะนิ่ง (Andon §2: ห้ามกระพริบ)
   - พื้นหลังกริด blueprint จางๆ + นาฬิกา/กะสด · ฟอนต์ตัวเลข/รหัส = monospace
   การทำงานเดิมคงครบ: ชิปเมนูดึงจาก NAV_ITEMS (ห้ามพิมพ์ list มือ) ·
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
  @media (hover: hover) {
    .tele-tile:hover { transform: translateY(-4px); border-color: var(--tc); }
  }
  .tele-tile { transition: transform 0.2s ease, border-color 0.2s ease; }
  /* กริดโมดูล — ใช้พื้นที่แนวนอนเต็มที่ (กฎ user 2026-07-14: ห้ามเหลือขอบข้างว่างเยอะ)
     6 การ์ดจัดคอลัมน์ให้สมดุล: แคบ=auto · ≥1200px = 3 คอลัมน์ (2 แถว) · ≥1900px = 6 คอลัมน์แถวเดียว (จอ TV) */
  .hub-grid {
    display: grid; gap: clamp(12px, 1.6vw, 20px);
    grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
  }
  @media (min-width: 1200px) { .hub-grid { grid-template-columns: repeat(4, 1fr); } }
  @media (min-width: 1900px) { .hub-grid { grid-template-columns: repeat(4, 1fr); } }
  /* มือถือ ≤768px: top bar (ชื่อ user/ธีม/ออกจากระบบ) เลิกลอย absolute — กลับเข้า flow ชิดขวา
     กันทับหัวข้อ (desktop ไม่เปลี่ยน: media ไม่ match) */
  @media (max-width: 768px) {
    .hub-topbar { position: static !important; align-self: flex-end; margin-bottom: 4px; }
  }
`;

// 7 หมวดตรงกับกลุ่มเมนูใน sidebar (จัดหมวดใหม่ 2026-07-20) — เมนูย่อยบนการ์ดดึงจาก NAV_ITEMS ผ่าน navGroups อัตโนมัติ
// (ห้ามพิมพ์รายชื่อเมนูซ้ำที่นี่ — เคยมี list มือแล้ว drift ไม่ตรงกับ sidebar)
const DEPTS = [
  {
    key: 'production', code: 'PRD·01', label: 'Production', labelTh: 'ฝ่ายผลิต', icon: '🏭',
    color: '#3dd65c', route: '/dashboard', navGroups: ['ภาพรวม', 'ฝ่ายผลิต'], available: true,
    desc: 'เช็คชื่อ-PPE, จัดการไลน์ผลิต, Daily Report, OEE, Daily PM, ใบรายงานของเสีย',
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
    color: '#4d9fff', route: '/qa', navGroups: ['คุณภาพ & วิศวกรรม'], available: true,
    desc: 'Quality Control Center, มาตรฐานการตรวจ & Drawing, ใบรายงานของเสีย, CQI-15',
  },
  {
    key: 'report', code: 'RPT·05', label: 'Analytics & Reports', labelTh: 'วิเคราะห์ & รายงาน', icon: '📋',
    color: '#c084fc', route: '/report', navGroups: ['วิเคราะห์ & รายงาน'], available: true,
    desc: 'OEE Analytics, รายงานเช็คชื่อ/สรุป, อนุมัติ 4M, จองรถ OT (PDF/CSV)',
  },
  {
    key: 'people', code: 'HRM·06', label: 'People & Skills', labelTh: 'พนักงาน & ทักษะ', icon: '👥',
    color: '#22d3ee', route: '/operator', navGroups: ['พนักงาน & ทักษะ'], available: true,
    desc: 'ฐานข้อมูลพนักงาน, สกิล & Level Up, OJT, Skill Matrix, ตารางกะ',
  },
  {
    key: 'settings', code: 'SET·07', label: 'Master Data & Settings', labelTh: 'ตั้งค่าโปรแกรม, ฐานข้อมูล', icon: '🛠️',
    color: '#34d399', route: '/products', navGroups: ['ตั้งค่าโปรแกรม,ฐานข้อมูล'], available: true,
    desc: 'Product Master, ผังไลน์, เครื่องจักร, ปฏิทิน, สิทธิ์, แจ้งเตือน',
  },
];

// ตัวเลขวิ่งขึ้นสู่ค่าจริง (count-up) — เอฟเฟกต์ตอนโหลด/ค่าเปลี่ยน ไม่ใช่ไฟกระพริบ (Andon §2 ไม่เกี่ยว)
function useCountUp(target, dur = 700) {
  const [val, setVal] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    if (target == null) return;
    const from = prevRef.current, to = target;
    if (from === to) { setVal(to); return; }
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const pr = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - pr, 3);
      setVal(Math.round(from + (to - from) * eased));
      if (pr < 1) raf = requestAnimationFrame(step);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return target == null ? null : val;
}

function TeleTile({ t }) {
  const shown = useCountUp(t.val);
  return (
    <div className="tele-tile" style={{ '--tc': t.color }}>
      <div className="scan" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 700, lineHeight: 1, color: shown == null ? 'var(--muted2)' : t.color, fontVariantNumeric: 'tabular-nums' }}>
          {shown == null ? '–' : shown}
        </span>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>{t.unit}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--text2)', fontFamily: 'var(--font-body)' }}>{t.label}</div>
      <div style={{ fontSize: 11, color: 'var(--muted2)', letterSpacing: '0.14em', fontFamily: MONO }}>{t.sub}</div>
    </div>
  );
}

// work date เดียวกับกฎทั้งระบบ: ก่อน 08:00 นับเป็นวันก่อนหน้า (ห้าม toISOString)
function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DeptHub({ onLogout, theme, onToggleTheme, userFullName, userRole, userPosition,
  userEmail, userAvatarUrl, onAvatarSaved, userSignatureUrl, onSignatureSaved,
  realRole, onOpenViewAs, remoteCode, onToggleRemote }) {
  const navigate = useNavigate();
  // scope ของผู้ใช้ (DeptHub อยู่ใน UserContext.Provider ของ App แล้ว)
  const { lineId: userLineId, sections: userSections = [] } = useContext(UserContext);

  // ── โปรไฟล์เมนู: รายการมาจาก buildProfileMenu (utils/profileMenu.js) ชุดเดียวกับ sidebar ──
  //    เดิมหน้านี้เขียนเมนูของตัวเองแล้ว drift (ขาด 💬 แจ้งปัญหา / 🎭 จำลองมุมมอง / รีโมทจอ)
  const [profileOpen, setProfileOpen] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const fileRef = useRef(null);

  const onAvatarCropped = async (file) => {
    setCropFile(null);
    // helper กลาง (utils/profileSelf) — อัปโหลด + เขียน profiles ผ่าน RPC + ลบไฟล์เก่า
    // ⚠️ ห้าม update profiles ตรง: RLS ที่บล็อกจะ "สำเร็จ 0 แถว" โดยไม่มี error (บั๊กลายเซ็น 2026-08-17)
    const res = await uploadMyAvatar(file, userAvatarUrl);
    if (!res.ok) { toast.error(res.message); return; }
    onAvatarSaved?.(res.url);
    toast.success('เปลี่ยนรูปโปรไฟล์แล้ว');
  };

  const profileItems = buildProfileMenu({
    realRole: realRole ?? userRole,
    canRemote: canAccessPage('/remote', userRole),
    remoteCode, theme,
    on: {
      avatar:       () => fileRef.current?.click(),
      signature:    () => setSigOpen(true),
      password:     () => setPwdOpen(true),
      feedback:     () => setFbOpen(true),
      viewAs:       onOpenViewAs,
      toggleRemote: onToggleRemote,
      toggleTheme:  onToggleTheme,   // มีปุ่มธีมแยกข้างนอกด้วย (layout ของหน้านี้) — ในเมนูก็ต้องมีให้ครบชุด
      logout:       onLogout,
    },
  });

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
  const [prodLines, setProdLines] = useState([]);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name')
      .then(({ data }) => setProdLines(data || []));
  }, []);

  // ⚠️ ตัวเลขบนหน้าหลักต้อง scope — ไม่งั้นหัวหน้าไลน์เห็นของทั้งโรงงานแล้วสับสน
  //    ("ไลน์ผมทำไมไม่แจ้งเตือนแบบนี้" = เห็น Andon ของแผนกอื่น · feedback 2026-08-19)
  //    หน่วยงานช่าง → ทั้งโรงงาน (ดูแลเครื่องทุกไลน์) · ผลิต → เฉพาะส่วนงานตัวเอง
  const scopeNames = useMemo(
    () => scopedLineNames({ role: userRole, lineId: userLineId, sections: userSections, lines: prodLines }),
    [userRole, userLineId, userSections, prodLines],
  );
  const scopeLineIds = useMemo(
    () => (scopeNames ? prodLines.filter(l => scopeNames.includes(l.name)).map(l => l.id) : null),
    [scopeNames, prodLines],
  );
  const wholeFactory = scopeNames == null;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const wd = getWorkDate();
      try {
        let qs = supabaseDR.from('production_sessions').select('id', { count: 'exact', head: true })
          .eq('work_date', wd).in('status', ['open', 'pending_close']);
        if (scopeNames) qs = qs.in('line_name', scopeNames);

        // เช็คชื่อ scope ผ่านไลน์ของพนักงาน (daily_production_logs ไม่มี line_name เอง)
        let qa = supabase.from('daily_production_logs')
          .select('id, employees!inner(line_id)', { count: 'exact', head: true })
          .eq('work_date', wd).eq('is_present', true);
        if (scopeLineIds) qa = qa.in('employees.line_id', scopeLineIds);

        let qm = supabase.from('four_m_logs').select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'pending_qa']);
        if (scopeNames) qm = qm.in('line_name', scopeNames);

        const [s, a, m, dts] = await Promise.all([qs, qa, qm, fetchActiveDowntimes(scopeNames)]);
        if (!alive) return;
        setTele({ lines: s.count ?? 0, present: a.count ?? 0, fourM: m.count ?? 0, dt: dts.list.length });
      } catch { /* เงียบ — telemetry เป็นของเสริม */ }
    };
    load();
    const stopPoll = visibleInterval(load, RATE.ANALYTIC);
    return () => { alive = false; stopPoll(); };
  }, [scopeNames, scopeLineIds]);

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
    navigate(to);   // rail/accordion ไฮไลต์+เปิดหมวดของหน้าปลายทางเองแล้ว ไม่ต้องสั่งโฟกัสหมวด
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
      {/* zIndex 1200 ที่ตัว topbar จำเป็น — ทุก section มี animation fill-mode:both (คง transform)
          จึงเป็น stacking context แยก ถ้า topbar ไม่มี z-index เมนูโปรไฟล์ข้างใน (z 1300) จะโดน
          hero/telemetry ที่อยู่หลังใน DOM วาดทับ (เคยพัง: dropdown โดนชิปนาฬิกาบัง) */}
      <div className="hub-topbar" style={{
        position: 'absolute', top: 'clamp(16px, 3vw, 28px)', right: 'clamp(16px, 4vw, 40px)',
        display: 'flex', alignItems: 'center', gap: 10, zIndex: 1200,
        animation: 'hub-fade-up 0.5s ease both',
      }}>
        {userFullName && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: 4, lineHeight: 1.3 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
              {userFullName}
            </span>
            {userRole && (
              <span style={{ fontSize: 11, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {/* จุดเขียว ONLINE นิ่ง+เรืองแสง */}
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3dd65c', boxShadow: '0 0 4px 1px rgba(61,214,92,0.6)' }} />
                {/* ⚠️ position เก็บเป็น key ต้องผ่าน positionLabel() เสมอ ไม่งั้นขึ้น 'operator' ดิบ (กฎ CLAUDE.md) */}
                {userPosition ? `${positionLabel(userPosition)} · ` : ''}{roleLabel(userRole)}
              </span>
            )}
          </div>
        )}

        {/* Avatar → เมนูโปรไฟล์: เปลี่ยนรูป / ลายเซ็น / เปลี่ยนรหัสผ่าน */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setProfileOpen(o => !o)} title="โปรไฟล์ของฉัน" style={{
            width: 40, height: 40, borderRadius: '50%', padding: 0, cursor: 'pointer', overflow: 'hidden',
            border: `2px solid ${profileOpen ? 'var(--accent)' : 'var(--border2)'}`,
            background: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {userAvatarUrl
              ? <img src={userAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>{(userFullName || '?').trim().charAt(0)}</span>}
          </button>

          {profileOpen && (
            <>
              {/* popup แสดงผล/เมนู (ไม่มี input) — ปิดจากคลิกนอกกรอบได้ตาม UI-CONVENTIONS §5 */}
              <div onClick={() => setProfileOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1290 }} />
              <div style={{
                position: 'absolute', top: 46, right: 0, zIndex: 1300, width: 240,
                background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12,
                boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
              }}>
                <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '2px solid var(--accent)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {userAvatarUrl
                      ? <img src={userAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--accent)' }}>{(userFullName || '?').trim().charAt(0)}</span>}
                  </div>
                  {/* เนื้อหาตัวตนชุดเดียวกับการ์ด user ใน sidebar: ชื่อ · ตำแหน่ง(แปลชื่อแล้ว)+อีเมล · ป้าย role */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userFullName || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[positionLabel(userPosition), userEmail].filter(Boolean).join(' · ') || roleLabel(userRole)}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                    background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid rgba(61,214,92,0.3)',
                  }}>{userRole?.toUpperCase() || '—'}</span>
                </div>
                {/* รายการเมนู = descriptor ชุดเดียวกับ sidebar (utils/profileMenu.js) — ห้ามเติมปุ่มตรงนี้ */}
                {profileItems.map(it => (
                  <button key={it.key}
                    onClick={() => {
                      setProfileOpen(false);
                      if (it.to) { navigate(it.to); return; }
                      it.onClick?.();
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px',
                      background: 'transparent', border: 'none',
                      borderBottom: it.key === 'logout' ? 'none' : '1px solid var(--border)',
                      color: it.color || 'var(--text2)', fontSize: 13, fontWeight: it.danger ? 700 : 600,
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)',
                      justifyContent: it.kind === 'toggle' ? 'space-between' : 'flex-start',
                    }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontSize: 15, flexShrink: 0 }}>{it.icon}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                    </span>
                    {it.kind === 'toggle' && (
                      <span style={{ width: 32, height: 18, borderRadius: 9, flexShrink: 0, position: 'relative', background: it.on ? 'var(--accent)' : 'var(--border2)', transition: 'background 0.25s' }}>
                        <span style={{ position: 'absolute', top: 2, left: it.on ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.25s' }} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
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
          {/* ขอบเขตของตัวเลข — ห้ามให้เดาเอง (เคยเข้าใจผิดว่าเห็น Andon ของแผนกอื่นเป็นของตัวเอง) */}
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 99,
            border: '1px solid var(--border)', color: wholeFactory ? 'var(--muted)' : 'var(--accent)',
          }} title={wholeFactory
              ? (MAINTENANCE_ROLES.includes(userRole) ? 'หน่วยงานช่างดูแลเครื่องจักรทุกไลน์ จึงเห็นทั้งโรงงาน' : 'บัญชีนี้ไม่ได้จำกัดส่วนงาน')
              : `นับเฉพาะไลน์: ${(scopeNames || []).join(', ')}`}>
            {wholeFactory ? '🏭 ทั้งโรงงาน' : `👥 ส่วนงานของฉัน (${(scopeNames || []).length} ไลน์)`}
          </span>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: MONO }}>refresh 60s</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {TELE.map(t => <TeleTile key={t.key} t={t} />)}
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

      {/* input เลือกรูปโปรไฟล์ (ซ่อน) → ImageCropModal crop วงกลม + บีบอัตโนมัติ */}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCropFile(f); }} />
      {cropFile && (
        <ImageCropModal file={cropFile} aspect={1} shape="circle" outputSize={480}
          title="จัดตำแหน่งรูปโปรไฟล์" onCancel={() => setCropFile(null)} onConfirm={onAvatarCropped} />
      )}
      <SignatureModal open={sigOpen} onClose={() => setSigOpen(false)}
        currentSignatureUrl={userSignatureUrl} onSaved={(url) => onSignatureSaved?.(url)} />
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} userEmail={userEmail} />
      {fbOpen && (
        <Suspense fallback={null}>
          <FeedbackModal onClose={() => setFbOpen(false)} />
        </Suspense>
      )}

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
