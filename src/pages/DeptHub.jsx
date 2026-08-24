import { useState, useEffect, useRef, useContext, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { navItemsForGroups, NAV_GROUP_META, NAV_GROUP_ORDER, UserContext } from '../App';
import { topPaths } from '../utils/navRecent';
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
     9 การ์ด (= 9 หมวด sidebar) → ≥1200px จัด 3 คอลัมน์ ลงตัวพอดี 3×3
     จำนวนการ์ดลดลงได้ตามสิทธิ์ของ role (การ์ดที่ไม่มีเมนูให้เข้าเลยถูกซ่อน) → auto-fill รับได้ */
  .hub-grid {
    display: grid; gap: clamp(12px, 1.6vw, 20px);
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  }
  @media (min-width: 1200px) { .hub-grid { grid-template-columns: repeat(3, 1fr); } }
  /* แถบค้นหา — คลิกแล้วเปิด CommandPalette ตัวเดียวกับ Ctrl+K ของหน้าอื่น (ไม่เขียนตัวค้นใหม่) */
  .hub-search {
    display: flex; align-items: center; gap: 9px; width: 100%;
    padding: 10px 14px; border-radius: 10px; cursor: text;
    background: var(--card); border: 1px solid var(--border2);
    color: var(--muted); font-size: 14px; font-family: var(--font-body); text-align: left;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  @media (hover: hover) {
    .hub-search:hover { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(61,214,92,0.08); }
  }
  .star-chip {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 8px 13px; border-radius: 9px; cursor: pointer;
    background: var(--card); border: 1px solid var(--border2);
    color: var(--text2); font-size: 13px; font-weight: 700; font-family: var(--font-body);
    transition: transform 0.15s ease, border-color 0.15s ease;
  }
  @media (hover: hover) {
    .star-chip:hover { transform: translateY(-2px); border-color: var(--accent); color: var(--text); }
  }
  .more-chip {
    background: transparent; border: 1px dashed var(--border2); color: var(--muted);
  }
  /* มือถือ ≤768px: top bar (ชื่อ user/ธีม/ออกจากระบบ) เลิกลอย absolute — กลับเข้า flow ชิดขวา
     กันทับหัวข้อ (desktop ไม่เปลี่ยน: media ไม่ match) */
  @media (max-width: 768px) {
    .hub-topbar { position: static !important; align-self: flex-end; margin-bottom: 4px; }
  }
`;

/* ⚠️ กฎเหล็ก — "1 การ์ด = 1 หมวดใน sidebar" และรายการการ์ด **derive จาก NAV_GROUP_ORDER**
   ห้ามพิมพ์รายชื่อหมวดเป็น array มือที่นี่ (2026-08-24)

   ที่มา: เดิมการ์ดถูกเขียนมือ 7 ใบ แล้วยุบ 'ภาพรวม' เข้าการ์ดฝ่ายผลิต · พอเพิ่มหมวด
   'วิศวกรรม (PE)' ทีหลัง **ไม่มีใครมาเพิ่มการ์ด** → `/pe-docs` เข้าจากหน้า Home ไม่ได้เลย
   (เจอตอน review หน้า Home — ผู้ใช้บอก "หาหน้าไม่เจอ") · derive แล้วหมวดใหม่ได้การ์ดเอง
   แม้ไม่มีใครมาเติม meta (ตกลงมาที่ไอคอน/สีสำรอง) — เทส home-coverage ล็อกไว้อีกชั้น

   ตารางนี้เก็บแค่ "หน้าตา" ของการ์ด (รหัส/สี/ปลายทางเริ่มต้น/คำอธิบาย)
   ส่วน "มีเมนูอะไรบ้าง" ยังมาจาก NAV_ITEMS ผ่าน navItemsForGroups เสมอ */
const CARD_META = {
  'ภาพรวม':                   { code: 'OVW·01', color: '#3dd65c', route: '/dashboard',    label: 'Overview & Control',      desc: 'จอภาพรวมโรงงาน · ผังรวม · Dashboard ส่วนงาน · สายธารความต้องการ' },
  'ฝ่ายผลิต':                 { code: 'PRD·02', color: '#22c55e', route: '/daily-report', label: 'Production',              desc: 'เช็คชื่อ-PPE · จัดการไลน์ · Daily Report · Daily Checker · Kaizen' },
  'วิเคราะห์ & รายงาน':       { code: 'ANL·03', color: '#c084fc', route: '/oee-analytics', label: 'Analytics & Reports',    desc: 'OEE · VSM · สอบกลับ Order · ประวัติผลิต · รายงาน/ใบพิมพ์' },
  'พนักงาน & ทักษะ':          { code: 'HRM·04', color: '#22d3ee', route: '/operator',     label: 'People & Skills',         desc: 'ฐานข้อมูลพนักงาน · สกิล & Level Up · OJT · ตารางกะ' },
  'Logistic - Store':         { code: 'LOG·05', color: '#f59e0b', route: '/line-stock',   label: 'Logistic & Store',        desc: 'สต๊อกในไลน์ · Kanban · Rack Center · Delivery · ขนส่ง' },
  'การตรวจสอบและซ่อมบำรุง':   { code: 'MTN·06', color: '#fb923c', route: '/mtn-repair',   label: 'Inspection & Maintenance', desc: 'แจ้งซ่อม MO · ตรวจ/แผน PM · ผังเครื่องจักร · พลังงาน' },
  'ควบคุมคุณภาพ QA/QC':       { code: 'QUA·07', color: '#4d9fff', route: '/qa',           label: 'Quality QA/QC',           desc: 'ใบตรวจ · SPC · NCR · CAPA/8D · เคลมลูกค้า · CQI-15' },
  'วิศวกรรม (PE)':            { code: 'ENG·08', color: '#f472b6', route: '/pe-docs',      label: 'Process Engineering',     desc: 'Process Flow · PFMEA · Control Plan' },
  'ตั้งค่าโปรแกรม,ฐานข้อมูล': { code: 'SET·09', color: '#34d399', route: '/products',     label: 'Master Data & Settings',  desc: 'Product Master · เครื่องจักร · ผัง · ปฏิทิน · สิทธิ์ · แจ้งเตือน' },
};

const DEPTS = NAV_GROUP_ORDER.map((group, i) => {
  const m = CARD_META[group] || {};
  return {
    key: group,
    group,
    code: m.code || `MOD·${String(i + 1).padStart(2, '0')}`,
    label: m.label || group,           // ชื่ออังกฤษบนหัวการ์ด (หมวดใหม่ที่ยังไม่ตั้ง = ใช้ชื่อหมวดไปก่อน)
    labelTh: group,                    // ชื่อไทย = ชื่อหมวดใน sidebar เป๊ะ (ห้ามตั้งชื่อใหม่ให้ต่างจากเมนู)
    icon: NAV_GROUP_META[group]?.icon || '📁',
    color: m.color || '#94a3b8',       // ต้องเป็น hex — ใช้ต่อสตริง `${color}15` ทำพื้นชิป (CSS var ใช้ไม่ได้)
    route: m.route,                    // ไม่ตั้ง = ใช้เมนูตัวแรกของหมวดที่ user เข้าได้ (คำนวณตอน render)
    desc: m.desc || '',
  };
});

const CHIP_CAP = 6;   // ชิปต่อการ์ดสูงสุด — ที่เหลือพับหลังปุ่ม "ดูทั้งหมด" (เดิม 15 ชิปใบเดียวจนอ่านไม่ออก)

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

/* ตัวเลขบนแถบ telemetry ต้อง "กดต่อได้" — เห็นว่ามี Downtime ค้าง 3 จุดแล้วต้องไปดูได้ทันที
   (เดิมเป็นป้ายอ่านอย่างเดียว ผู้ใช้ต้องไปไล่หาหน้าเองว่าดูที่ไหน)
   ⚠️ ปลายทางต้องผ่าน canAccessPage — role ที่เข้าหน้านั้นไม่ได้ ให้เป็นป้ายเฉยๆ ห้ามพาไปแล้วโดนเด้ง */
function TeleTile({ t, onGo }) {
  const shown = useCountUp(t.val);
  const body = (
    <>
      <div className="scan" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 700, lineHeight: 1, color: shown == null ? 'var(--muted2)' : t.color, fontVariantNumeric: 'tabular-nums' }}>
          {shown == null ? '–' : shown}
        </span>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>{t.unit}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--text2)', fontFamily: 'var(--font-body)' }}>{t.label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--muted2)', letterSpacing: '0.14em', fontFamily: MONO }}>{t.sub}</span>
        {onGo && <span style={{ fontSize: 11, color: t.color, marginLeft: 'auto' }}>↗</span>}
      </div>
    </>
  );
  const style = { '--tc': t.color };
  return onGo
    ? <button type="button" className="tele-tile" style={{ ...style, cursor: 'pointer' }} onClick={onGo} title={t.goTitle}>{body}</button>
    : <div className="tele-tile" style={style}>{body}</div>;
}

// work date เดียวกับกฎทั้งระบบ: ก่อน 08:00 นับเป็นวันก่อนหน้า (ห้าม toISOString)
function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DeptHub({ onLogout, theme, onToggleTheme, userFullName, userRole, userPosition,
  userEmail, userAvatarUrl, onAvatarSaved, userSignatureUrl, onSignatureSaved,
  realRole, onOpenViewAs, remoteCode, onToggleRemote, onOpenSearch }) {
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

  // ใบค้างเก่ากว่า 7 วัน default ของหน้ารายงาน → ส่ง from ย้อน 90 วันไปด้วย ไม่งั้นเปิดมาเจอจอว่าง
  // (สัญญาของ /report: ?tab= เป็น "เลข index ของ TABS" · 4 = แท็บ 4M Changes — ดู CLAUDE.md)
  const fourMLink = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `/report?tab=4&from=${from}`;
  }, []);

  const TELE = [
    { key: 'lines',   label: 'ไลน์กำลังผลิต',  sub: 'LINES RUNNING',  val: tele.lines,   color: '#3dd65c', unit: 'ไลน์',
      to: '/daily-report', goTitle: 'เปิด Daily Report — ดูกะที่เปิดอยู่' },
    { key: 'present', label: 'เช็คชื่อวันนี้',   sub: 'ON SHIFT',       val: tele.present, color: '#4d9fff', unit: 'คน',
      to: '/checkin', goTitle: 'เปิดหน้าเช็คชื่อ & PPE' },
    { key: 'dt',      label: 'Downtime ค้าง', sub: 'MACHINES DOWN',  val: tele.dt,      color: tele.dt > 0 ? '#ef4444' : '#3dd65c', unit: 'จุด',
      to: '/dashboard', goTitle: 'เปิด Dashboard — แผง Andon เครื่องที่หยุดอยู่' },
    { key: 'fourM',   label: '4M รออนุมัติ',   sub: '4M PENDING',     val: tele.fourM,   color: tele.fourM > 0 ? '#f59e0b' : '#3dd65c', unit: 'รายการ',
      to: fourMLink, goTitle: 'เปิดคิวอนุมัติ 4M (ย้อนหลัง 90 วัน)' },
  ];

  // ชิปเมนูย่อย = เมนูจริงจาก NAV_ITEMS (sidebar) กรองตามสิทธิ์ role — ตรงกับ sidebar เสมอ
  const menuItemsOf = (d) => navItemsForGroups([d.group], userRole);

  // อันดับ "ใช้บ่อย" ของเครื่องนี้ (navRecent · localStorage) — อ่านครั้งเดียวตอน mount ก็พอ
  // ใช้ 2 ที่: เลือกว่าชิปไหนได้โผล่ก่อนเมื่อการ์ดมีเมนูเกิน CHIP_CAP · แถว ⭐ ใช้บ่อย ด้านบน
  const [useRank] = useState(() => new Map(topPaths(40).map((p, i) => [p, i])));

  const favItems = useMemo(() => {
    const allowed = navItemsForGroups(NAV_GROUP_ORDER, userRole);
    return topPaths(8).map(p => allowed.find(i => i.to === p)).filter(Boolean).slice(0, 6);
  }, [userRole]);

  const [expanded, setExpanded] = useState({});   // การ์ดไหนกาง "ดูทั้งหมด" อยู่

  /** เลือกชิปที่โผล่: คัดด้วย "ใช้บ่อย" แต่ **เรียงตามลำดับเมนูเดิม** (ตำแหน่งชิปจะได้ไม่เต้นทุกวัน) */
  const chipsOf = (d) => {
    const items = menuItemsOf(d);
    if (items.length <= CHIP_CAP) return { shown: items, hidden: [] };
    const pick = new Set(
      [...items].sort((a, b) => (useRank.get(a.to) ?? 999) - (useRank.get(b.to) ?? 999))
        .slice(0, CHIP_CAP).map(i => i.to),
    );
    return { shown: items.filter(i => pick.has(i.to)), hidden: items.filter(i => !pick.has(i.to)) };
  };

  // การ์ดที่ role นี้เข้าไม่ได้สักเมนู = ไม่ต้องโชว์ (เดิมโชว์แล้วกดเข้าไปโดนเด้งกลับ)
  const cards = useMemo(
    () => DEPTS.map(d => ({ ...d, items: menuItemsOf(d) })).filter(d => d.items.length > 0),
    [userRole],   // eslint-disable-line react-hooks/exhaustive-deps -- menuItemsOf อ่านจาก NAV_ITEMS (คงที่) + userRole
  );

  const openMenu = (e, to) => {
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

        {/* 🔎 ค้นหาเมนู — หน้า Home เคยเป็นหน้าเดียวในระบบที่ค้นหาไม่ได้ (หน้าอื่นมี Ctrl+K/ช่องค้นใน drawer)
            ทั้งที่มีเมนู 58 รายการ 9 หมวด · เปิด CommandPalette ตัวเดียวกับหน้าอื่น ไม่เขียนตัวค้นใหม่ */}
        {onOpenSearch && (
          <button type="button" className="hub-search" onClick={onOpenSearch}
            style={{ maxWidth: 460, marginTop: 14 }}>
            <span style={{ fontSize: 15 }}>🔎</span>
            <span style={{ flex: 1 }}>ค้นหาเมนู… (เช่น ซ่อม, oee, สต๊อก)</span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>
              Ctrl K
            </span>
          </button>
        )}
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
          {TELE.map(t => (
            <TeleTile key={t.key} t={t}
              onGo={t.to && canAccessPage(t.to.split('?')[0], userRole) ? () => navigate(t.to) : undefined} />
          ))}
        </div>
      </div>

      {/* ── ⭐ ใช้บ่อยของเครื่องนี้ — ไม่มีสถิติ (เครื่องใหม่) = ไม่โชว์บล็อกเปล่า
             หลักเดียวกับ ⭐ บน rail/drawer ของ sidebar (navRecent ชุดเดียวกัน) ── */}
      {favItems.length > 0 && (
        <div style={{ width: '100%', maxWidth: 'min(97vw, 2400px)', marginBottom: 'clamp(18px, 2.4vw, 26px)', animation: 'hub-fade-up 0.6s ease 0.1s both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: MONO }}>
              ⭐ ใช้บ่อย
            </span>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: MONO }}>this device</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {favItems.map(it => (
              <button key={it.to} type="button" className="star-chip" onClick={() => navigate(it.to)} title={it.group}>
                <span style={{ fontSize: 15 }}>{it.icon}</span>{it.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Module Grid ── */}
      <div className="hub-grid" style={{ width: '100%', maxWidth: 'min(97vw, 2400px)' }}>
        {cards.map((d, i) => {
          const { shown, hidden } = chipsOf(d);
          const open = !!expanded[d.key];
          const chips = open ? d.items : shown;
          const route = d.route || d.items[0].to;   // ไม่ตั้ง route = เข้าเมนูตัวแรกที่ user เข้าได้
          return (
          <div
            key={d.key}
            className="smart-card active"
            style={{ '--mc': d.color, animation: `hub-fade-up 0.55s ease ${0.12 + 0.06 * i}s both` }}
            onClick={() => navigate(route)}
          >
            <div className="edge" />

            {/* แถวบน: รหัสโมดูล + จำนวนหน้าที่ user คนนี้เข้าได้จริง */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: d.color, opacity: 0.9 }}>
                {d.code}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text2)' }}>
                {/* ไฟสถานะนิ่ง+เรืองแสง (ไม่กระพริบ — กระพริบสงวนให้ Andon แดง) */}
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3dd65c', boxShadow: '0 0 5px 1px rgba(61,214,92,0.6)' }} />
                {d.items.length} หน้า
              </span>
            </div>

            {/* ไอคอน + ชื่อ */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 30, lineHeight: 1 }}>{d.icon}</span>
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
            {d.desc && (
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12, fontFamily: 'var(--font-body)' }}>
                {d.desc}
              </div>
            )}

            {/* ชิปเมนูจริงจาก sidebar (NAV_ITEMS) — คลิกเข้าหน้านั้นได้เลย
                เกิน CHIP_CAP = พับไว้หลังปุ่ม "ดูทั้งหมด" (ห้ามซ่อนเงียบ — ต้องบอกจำนวนที่พับ) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {chips.map(item => (
                <button key={item.to} type="button" className="dept-chip"
                  title={`เปิด ${item.label}`}
                  onClick={e => openMenu(e, item.to)}
                  style={{ background: `${d.color}15`, color: d.color, border: `1px solid ${d.color}30` }}>
                  <span style={{ fontSize: 12 }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
              {hidden.length > 0 && (
                <button type="button" className="dept-chip more-chip"
                  onClick={e => { e.stopPropagation(); setExpanded(s => ({ ...s, [d.key]: !open })); }}>
                  {open ? '▲ ย่อ' : `▾ ดูทั้งหมด (${hidden.length})`}
                </button>
              )}
            </div>
          </div>
          );
        })}
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
