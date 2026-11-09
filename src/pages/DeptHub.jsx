import { useState, useEffect, useRef, useContext, useMemo, lazy, Suspense } from 'react';
import { LOGISTIC_GROUPS } from '../utils/logisticSide';
import { useNavigate } from 'react-router-dom';
import { navItemsForGroups, isNavGuest, NAV_GROUP_META, NAV_GROUP_ORDER, UserContext } from '../App';
import { toneOf } from '../utils/statusTone';
import { topPaths } from '../utils/navRecent';
import { scopedLineNames, MAINTENANCE_ROLES } from '../utils/sectionScope';
import { roleLabel } from '../utils/roleMeta';
import { positionLabel } from '../utils/positions';   // position เก็บเป็น key — แสดงต้องแปลงชื่อเสมอ
import { canAccessPage } from '../utils/permissions';
import { buildProfileMenu } from '../utils/profileMenu';
import useLang, { langToggleLabel, langToggleTitle } from '../utils/useLang';   // 🌐 ปุ่มสลับ ไทย/English + ป้ายการ์ด/telemetry แปลที่จุดวาด
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { fetchActiveDowntimes } from '../utils/downtimeAlarm';
import { toast } from '../components/Toast';
import KpiTile from '../components/KpiTile';   // การ์ดตัวเลขโครงเดียว (UI §6.35 · 04/11)
import { uploadMyAvatar } from '../utils/profileSelf';
import ImageCropModal from '../components/ImageCropModal';
import SignatureModal from '../components/SignatureModal';
import ChangePasswordModal from '../components/ChangePasswordModal';
const NotifyPrefsModal = lazy(() => import('../components/NotifyPrefsModal'));  // 🔕 ตั้งค่าแจ้งเตือนของฉัน
const FeedbackModal = lazy(() => import('../components/FeedbackModal'));  // 💬 ช่องรับ feedback (ชุดเดียวกับ sidebar)
import { visibleInterval } from '../utils/usePolling';
import { RATE, LIVE } from '../utils/refreshRates';
import { liveChannel } from '../utils/liveChannel';
import { coalesce, makeIdleGate } from '../utils/liveRefresh';
import Icon from '../components/Icon';   // ✒️ ไอคอนเส้นแทน emoji (UI §6.36)

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
  /* 04/11 (UI §6.35/§6.17): ถอดกริด blueprint + แสงเรือง + มุม HUD + เส้นสีประจำโมดูล — ของตกแต่งทั้งหมด · พาเลต 5 สี */
  .hub-root { background: var(--bg); }
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
  @media (hover: hover) {
    .smart-card.active:hover { transform: translateY(-3px); border-color: var(--accent); box-shadow: var(--shadow-float); }
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
    .hub-search:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
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
  /* จอสัมผัส: ชิปเมนูสูงจริง ~23px กดพลาดง่ายเมื่อใส่ถุงมือ — เพิ่ม padding ให้สูง ~34px
     ⚠️ ใช้ padding (ขนาดจริง) ไม่ใช่ ::before ขยาย hit area แบบกฎกลางใน index.css
     เพราะชิปเรียงห่างกันแค่ 6px → hit area 40px ของชิปข้างกันจะทับกันแล้วแย่งการกด
     (และกฎกลางไม่ครอบอยู่แล้ว: button:not(:has(*)) ไม่จับปุ่มที่มี span ข้างใน) */
  @media (pointer: coarse) {
    .dept-chip { padding: 9px 12px; }
    .star-chip { padding: 10px 14px; }
  }
  /* มือถือ ≤768px: top bar (ชื่อ user/ธีม/ออกจากระบบ) เลิกลอย absolute — กลับเข้า flow ชิดขวา
     กันทับหัวข้อ (desktop ไม่เปลี่ยน: media ไม่ match) */
  @media (max-width: 768px) {
    .hub-topbar { position: static !important; align-self: flex-end; margin-bottom: 4px; }
    /* 📱 มือถือ/handheld (15/10 · docs/MOBILE-UX-STANDARD.md §2 ข้อ 1 "งานของฉันมาก่อน ตกแต่งทีหลัง")
       เดิมจอแรกของ 360×640 = แบนเนอร์ INDUSTRY 5.0 + ชื่อระบบตัวใหญ่ + นาฬิกา + วันที่ + ตัวเลข 4 ช่อง
       ⇒ ปุ่มเข้าเมนูเริ่มที่จอ 2 · มือถือมีนาฬิกา/วันที่อยู่แล้ว · ชื่อระบบไม่ใช่สิ่งที่คนมาทำ
       ลำดับมือถือ: ค้นหาเมนู + กะ → ⭐ ใช้บ่อย (ปุ่มใหญ่ 2 คอลัมน์) → ตัวเลขสด → หมวดเมนู · จอคอมไม่แตะ */
    .hub-banner, .hub-title, .hub-sub, .hub-clock, .hub-date, .hub-foot { display: none !important; }
    .hub-head { order: 1; margin-bottom: 14px !important; gap: 8px !important; }
    .hub-head .hub-search { margin-top: 0 !important; min-height: 46px; font-size: 15px; }
    .hub-fav { order: 2; margin-bottom: 16px !important; }
    .hub-fav-list { display: grid !important; grid-template-columns: 1fr 1fr; }
    .hub-fav-list .star-chip { min-height: 52px; justify-content: flex-start; text-align: left; white-space: normal; line-height: 1.3; }
    .hub-tele { order: 3; margin-bottom: 18px !important; }
    .hub-tele .tele-tile { flex: 1 1 140px; min-width: 140px; padding: 9px 12px; }
    .hub-grid { order: 4; }
    .hub-head .hub-search > span:last-child { display: none; }   /* "Ctrl K" — handheld ไม่มีคีย์บอร์ด */
    .hub-tele > div:first-child > span:last-child { display: none; }   /* "refresh 60s" ดันหัวแถวพับ 3 บรรทัด */
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
/* 🔴 **สีประจำโมดูล ห้ามเป็นสีสถานะ** (`STATUS_COLOR` ใน `utils/statusTone.js`: เขียว var(--green) ·
   เหลือง var(--amber) · แดง var(--red)) — 23/09 ก้อน B · มีด่าน `module-identity-not-status-hue`
   เดิม "ฝ่ายผลิต" เป็น var(--green) และ "Warehouse & Delivery" เป็น var(--amber) **เป๊ะตัวเดียวกับไฟสถานะ**
   ที่การ์ด telemetry บนหน้าเดียวกันใช้อยู่ ⇒ จอเดียวกันมีแถบเขียว/เหลือง 2 ความหมายปนกัน
   คนหน้างานอ่านแถบเหลืองเหนือ Warehouse ว่า "คลังมีปัญหา" ทั้งที่มันแปลว่า "นี่คือการ์ดคลัง"
   ⇒ ย้ายไปโทนเย็นที่ไม่มีความหมายสถานะ (teal / indigo) · การ์ดยังแยกกันออกด้วย emoji + code + สีอื่น */
  'ภาพรวม':                   { code: 'OVW·01', route: '/obeya?tab=todo', label: 'Overview & Control',    desc: 'งานค้างของส่วนงาน · ผังรวมโรงงาน' },
  // 📺 จอที่ "แขวนทิ้งไว้" — แยกจากภาพรวมเพราะไม่ใช่หน้าที่เปิดมากดทำงาน (nav audit 2026-08-28)
  'จอแสดงผล':              { code: 'TVB·02', route: '/tv',           label: 'Wall Displays',           desc: 'ไทม์ไลน์ผลิตทุกไลน์ · Andon Board · OEE รายไลน์' },
  'ฝ่ายผลิต':                 { code: 'PRD·02', route: '/daily-report', label: 'Production',              desc: 'เช็คชื่อ-PPE · จัดการไลน์ · Daily Report · Daily Checker · Kaizen' },
  'วิเคราะห์ & รายงาน':       { code: 'ANL·03', route: '/oee-analytics', label: 'Analytics & Reports',    desc: 'OEE · VSM · สอบกลับ Order · ประวัติผลิต · รายงาน/ใบพิมพ์' },
  'พนักงาน & ทักษะ':          { code: 'HRM·04', route: '/operator',     label: 'People & Skills',         desc: 'ฐานข้อมูลพนักงาน · สกิล & Level Up · OJT · ตารางกะ' },
  // Logistic แยก 3 ฝั่งตามแผนกเจ้าของ — ⚠️ Warehouse (FG 1xx · ส่งลูกค้า) ≠ Store (2xx/3xx/5xx · ป้อนไลน์) · ชื่อหมวดจาก LOGISTIC_GROUPS
  [LOGISTIC_GROUPS.inbound]:  { code: 'STO·06', route: '/line-stock',      label: 'Planning & Store',      desc: 'แผนงาน + Store (3xx ซื้อนอก · 5xx raw · 2xx ผลิตเอง) — Planner & Sales · สต๊อกในไลน์ · บอร์ดคัมบัง · ขนส่งเข้าไลน์' },
  [LOGISTIC_GROUPS.outbound]: { code: 'DLV·07', route: '/customer-demand', label: 'Warehouse & Delivery',  desc: 'Warehouse (FG 1xx) · Delivery · Rack Center — จัดส่งลูกค้า · คาดการณ์ของจะขาด · ภาชนะ' },
  'การตรวจสอบและซ่อมบำรุง':   { code: 'MTN·08', route: '/mtn-repair',   label: 'Inspection & Maintenance', desc: 'แจ้งซ่อม MO · ศูนย์ PM (ตรวจ·แผน·ล่วงหน้า) · ผังเครื่องจักร · พลังงาน' },
  'คุณภาพ & วิศวกรรม':        { code: 'QUA·09', route: '/qa',           label: 'Quality & Engineering',   desc: 'ใบตรวจ · SPC · NCR · CAPA/8D · เคลมลูกค้า · CQI-15 · PFMEA/Control Plan' },
  'ตั้งค่าโปรแกรม,ฐานข้อมูล': { code: 'SET·10', route: '/products',     label: 'Master Data & Settings',  desc: 'Product Master · เครื่องจักร · ผัง · ปฏิทิน · สิทธิ์ · แจ้งเตือน' },
  'ผู้บริหาร & เดโม':         { code: 'EXE·11', route: '/flow-tower',   label: 'Executive & Demo',        desc: 'สายธารความต้องการ · ภาพรวมกลุ่มโรงงาน · ภาพเมื่อข้อมูลเชื่อมกัน' },
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
    route: m.route,                    // ไม่ตั้ง = ใช้เมนูตัวแรกของหมวดที่ user เข้าได้ (คำนวณตอน render)
    desc: m.desc || '',
  };
});

const CHIP_CAP = 6;   // ชิปต่อการ์ดสูงสุด — ที่เหลือพับหลังปุ่ม "ดูทั้งหมด" (เดิม 15 ชิปใบเดียวจนอ่านไม่ออก)

// ตัวเลขวิ่งขึ้นสู่ค่าจริง (count-up) — เอฟเฟกต์ตอนโหลด/ค่าเปลี่ยน ไม่ใช่ไฟกระพริบ (Andon §2 ไม่เกี่ยว)
// work date เดียวกับกฎทั้งระบบ: ก่อน 08:00 นับเป็นวันก่อนหน้า (ห้าม toISOString)
function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DeptHub({ onLogout, theme, onToggleTheme, userFullName, userRole, userPosition,
  userEmail, userAvatarUrl, onAvatarSaved, userSignatureUrl, onSignatureSaved,
  realRole, onOpenViewAs, remoteCode, onToggleRemote, onOpenSearch, permsVersion }) {
  const navigate = useNavigate();
  const { lang, toggleLang, tr } = useLang();
  // scope ของผู้ใช้ (DeptHub อยู่ใน UserContext.Provider ของ App แล้ว)
  const { lineId: userLineId, sections: userSections = [] } = useContext(UserContext);

  // ── โปรไฟล์เมนู: รายการมาจาก buildProfileMenu (utils/profileMenu.js) ชุดเดียวกับ sidebar ──
  //    เดิมหน้านี้เขียนเมนูของตัวเองแล้ว drift (ขาด 💬 แจ้งปัญหา / 🎭 จำลองมุมมอง / รีโมทจอ)
  const [profileOpen, setProfileOpen] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);   // 🔕 ตั้งค่าแจ้งเตือนของฉัน
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
    remoteCode, theme, lang,
    on: {
      toggleLang,
      avatar:       () => fileRef.current?.click(),
      signature:    () => setSigOpen(true),
      password:     () => setPwdOpen(true),
      notifyPrefs:  () => setNotifyOpen(true),
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
    loadLinesRes()
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
        // ⚠️ count query คืน { error, count: null } **ไม่ throw** → `?? 0` จะแปลง "โหลดไม่ได้"
        //    เป็น "ไม่มีไลน์เดินเลย / ไม่มีคนมาเช็คชื่อ / Downtime 0 (เขียว)" ซึ่งเป็นคำกล่าวอ้างเท็จ
        //    ส่ง null แทน → TeleTile แสดง "–" (รองรับอยู่แล้ว) = บอกว่า "ยังไม่รู้" ไม่ใช่ "เป็นศูนย์"
        const num = (r) => (r?.error ? null : (r?.count ?? 0));
        setTele({
          lines: num(s), present: num(a), fourM: num(m),
          dt: dts?.error ? null : dts.list.length,
        });
      } catch { if (alive) setTele({ lines: null, present: null, dt: null, fourM: null }); }
    };
    /* 🔴 2026-10-01 (งานลด egress · Pro หมด 11 ต.ค.) — เดิมเป็น poll ล้วนทุก 20 นาที
       และ 1 tick = **5 คิวรี** (3 count + `fetchActiveDowntimes` อีก 2) · หน้านี้เป็นหน้าแรก
       ที่ทุกคนเปิดค้างไว้ ⇒ วัดจริง 01/10: `production_sessions?select=id,line_name,shift,status`
       1,168 ครั้ง/วัน + `?select=id` 1,108 ครั้ง/วัน มาจากทางนี้เป็นหลัก
       แก้เป็นแบบเดียวกับ Management.jsx (กฎเหล็กข้อ 8): realtime = ช่องทางหลัก ·
       `coalesce` = เพดานความถี่ · `makeIdleGate` = **tick ที่ไม่มีอะไรเปลี่ยนไม่ยิงเลยสักไบต์**
       ⚠️ ต้อง subscribe **ทั้ง 2 project** — ตัวเลข 4 ตัวบนแถบนี้มาจากคนละฝั่ง
          (กะ/Downtime = DR · เช็คชื่อ/4M = Main) ถ้า touch แค่ฝั่งเดียว เลขอีกฝั่งจะค้างถึง
          LIVE.FLOOR (2 ชม.) เช่นตอนเช้าที่คนเช็คชื่อแล้วแต่ยังไม่มีใครเปิดกะ */
    const g = makeIdleGate(LIVE.FLOOR);
    const bump = coalesce(() => { g.loaded(); return load(); }, LIVE.BOARD);
    const onEvent = () => { g.touch(); bump(); };
    load();
    g.loaded();
    const stopPoll = visibleInterval(() => { if (g.shouldRun()) { g.loaded(); load(); } }, RATE.BACKUP);
    const chDR = liveChannel(supabaseDR, 'depthub-dr')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_sessions' }, onEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' },       onEvent)
      .subscribe((st) => { if (st === 'SUBSCRIBED') g.touch(); });
    const chMain = liveChannel(supabase, 'depthub-main')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_production_logs' }, onEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'four_m_logs' },           onEvent)
      .subscribe((st) => { if (st === 'SUBSCRIBED') g.touch(); });
    return () => {
      alive = false; stopPoll(); bump.cancel();
      supabaseDR.removeChannel(chDR); supabase.removeChannel(chMain);
    };
  }, [scopeNames, scopeLineIds]);

  // ใบค้างเก่ากว่า 7 วัน default ของหน้ารายงาน → ส่ง from ย้อน 90 วันไปด้วย ไม่งั้นเปิดมาเจอจอว่าง
  // (สัญญาของ /report: ?tab= เป็น "เลข index ของ TABS" · 4 = แท็บ 4M Changes — ดู CLAUDE.md)
  const fourMLink = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `/report?tab=4&from=${from}`;
  }, []);

  /* 🚦 สีบนการ์ด = **สถานะเทียบเป้าเท่านั้น** ห้ามใช้เป็นสีประจำการ์ด (`utils/statusTone.js`)
     เดิม: ไลน์=เขียวตายตัว · เช็คชื่อ=น้ำเงินตายตัว · DT/4M=สีตามสถานะ
     ⇒ 4 ใบเรียงกันแต่สีมี 2 ความหมายปนกัน คนอ่านใบแรกผิดว่า "เขียว = ปกติ"
        (เขียวอยู่อย่างนั้นแม้เดินจริง 1 จาก 20 ไลน์) · 23/09 จาก brief De-AI UI
     ตอนนี้: ตัวที่ไม่มีเป้า = **เทา + โชว์ตัวหาร** ให้คนตัดสินเอง · ตัวที่ 0 = ดี ค่อยมีสี */
  const lineTotal = scopeNames ? scopeNames.length : (prodLines.length || null);
  const TELE = [
    { key: 'lines',   label: 'ไลน์กำลังผลิต',  val: tele.lines,   unit: 'ไลน์', note: 'เปิดกะอยู่ตอนนี้',
      of: lineTotal, tone: 'none',   // "ควรเดินกี่ไลน์" ขึ้นกับแผนผลิตรายวัน — ระบบไม่มีเป้านี้ ⇒ ห้ามทาสี
      to: '/daily-report', goTitle: 'เปิด Daily Report — ดูกะที่เปิดอยู่' },
    { key: 'present', label: 'เช็คชื่อวันนี้',   val: tele.present, unit: 'คน', note: 'มาทำงานวันนี้',
      tone: 'none',                  // ยอดคนที่ "ควรมา" อยู่ที่ตารางกะ ไม่ใช่ที่นี่ ⇒ เทา
      to: '/checkin', goTitle: 'เปิดหน้าเช็คชื่อ & PPE' },
    { key: 'dt',      label: 'Downtime ค้าง', val: tele.dt,      unit: 'จุด', note: tele.dt > 0 ? 'เครื่องหยุดอยู่ตอนนี้' : 'ไม่มีเครื่องหยุด',
      tone: toneOf({ value: tele.dt, zeroIsGood: true }),          // > 0 = ผลิตหยุดอยู่จริง ⇒ แดง
      to: '/dashboard', goTitle: 'เปิด Dashboard — แผง Andon เครื่องที่หยุดอยู่' },
    { key: 'fourM',   label: '4M รออนุมัติ',   val: tele.fourM,   unit: 'รายการ', note: tele.fourM > 0 ? 'รออนุมัติอยู่' : 'ไม่มีค้าง',
      // คิวค้าง = ต้องไปจัดการ แต่สายการผลิตยังเดิน ⇒ เหลือง ไม่ใช่แดง (จอที่แดงตลอดคือจอที่คนเลิกมอง)
      tone: toneOf({ value: tele.fourM, zeroIsGood: true, over: 'warn' }),
      to: fourMLink, goTitle: 'เปิดคิวอนุมัติ 4M (ย้อนหลัง 90 วัน)' },
  ];

  // ชิปเมนูย่อย = เมนูจริงจาก NAV_ITEMS (sidebar) กรองตามสิทธิ์ role — ตรงกับ sidebar เสมอ
  const menuItemsOf = (d) => navItemsForGroups([d.group], userRole);

  // อันดับ "ใช้บ่อย" ของเครื่องนี้ (navRecent · localStorage) — อ่านครั้งเดียวตอน mount ก็พอ
  // ใช้ 2 ที่: เลือกว่าชิปไหนได้โผล่ก่อนเมื่อการ์ดมีเมนูเกิน CHIP_CAP · แถว ⭐ ใช้บ่อย ด้านบน
  const [useRank] = useState(() => new Map(topPaths(40).map((p, i) => [p, i])));

  /* ⚠️ deps ต้องมี permsVersion ด้วย — 2 memo นี้เรียก canAccessPage() ที่อ่าน permission cache
     แบบ sync · App ยิง permsVersion ลงมาเมื่อ realtime แจ้งว่า role_permissions เปลี่ยน
     ถ้าไม่ใส่ใน deps การ์ด/ชิปหน้า Home จะค้างเวอร์ชันเดิมจนกว่าจะ reload
     ขณะที่ sidebar (คำนวณ inline) อัปเดตทันที = 2 ที่ไม่ตรงกันชั่วคราว */
  const favItems = useMemo(() => {
    const allowed = navItemsForGroups(NAV_GROUP_ORDER, userRole);
    return topPaths(8).map(p => allowed.find(i => i.to === p)).filter(Boolean).slice(0, 6);
  }, [userRole, permsVersion]);

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
    [userRole, permsVersion],   // eslint-disable-line react-hooks/exhaustive-deps -- menuItemsOf อ่านจาก NAV_ITEMS (คงที่) + userRole
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
        // 📺 บัญชีจอ TV: แถบบน (fixed สูง --tvbar-h) เคยทับปุ่มธีม/โปรไฟล์ทั้งแถว ⇒ ดันลงพ้นแถบ (นอกโหมด TV = 0 ไม่เปลี่ยน)
        position: 'absolute', top: 'calc(var(--tvbar-h, 0px) + clamp(16px, 3vw, 28px))', right: 'clamp(16px, 4vw, 40px)',
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
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
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
                background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)',
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
                    fontSize: 11, fontWeight: 800, padding: '2px 6px', borderRadius: 'var(--r-xs)', flexShrink: 0,
                    background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--green-line)',
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
                      <Icon glyph={it.icon} size={15} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                    </span>
                    {it.kind === 'toggle' && (
                      <span style={{ width: 32, height: 18, borderRadius: 'var(--r-md)', flexShrink: 0, position: 'relative', background: it.on ? 'var(--accent)' : 'var(--border2)', transition: 'background 0.25s' }}>
                        <span style={{ position: 'absolute', top: 2, left: it.on ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.25s' }} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* 🌐 ปุ่มสลับภาษา — คู่กับปุ่มธีม ป้ายบอก "กดแล้วได้ภาษาอะไร" */}
        <button type="button" onClick={toggleLang} title={langToggleTitle(lang)} aria-label={langToggleTitle(lang)} style={{
          height: 38, minWidth: 44, padding: '0 10px', borderRadius: 'var(--r-md)',
          background: 'var(--card)', border: '1px solid var(--border)',
          color: 'var(--text)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span aria-hidden="true">🌐</span>{langToggleLabel(lang)}
        </button>
        {onToggleTheme && (
          <button onClick={onToggleTheme} title={tr('สลับธีม')} style={{
            width: 38, height: 38, borderRadius: 'var(--r-md)',
            background: 'var(--card)', border: '1px solid var(--border)',
            color: 'var(--text)', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {theme === 'dark' ? '️' : '🌙'}
          </button>
        )}
      </div>

      {/* ── Header — แถวนอนเต็มความกว้าง: ชื่อระบบซ้าย · นาฬิกา/กะขวา (จอแคบ wrap) ── */}
      <div className="hub-head" style={{ width: '100%', maxWidth: 'min(97vw, 2400px)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '14px clamp(20px, 3vw, 48px)', marginBottom: 'clamp(18px, 2.5vw, 26px)', animation: 'hub-fade-up 0.55s ease both' }}>
        <div style={{ minWidth: 'min(100%, 420px)' }}>
        <h1 className="hub-title" style={{
          margin: 0, fontSize: 'clamp(24px, 4.2vw, 40px)', fontWeight: 900,
          fontFamily: 'var(--font-display)', color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1.15,
        }}>
          ESM Control Center
        </h1>
        <p className="hub-sub" style={{ margin: '8px 0 0', fontSize: 'clamp(13px, 2vw, 15px)', color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>
          {tr('ศูนย์ควบคุมโรงงานอัจฉริยะ · Thai Summit Group — เลือกส่วนงานเพื่อเริ่มทำงาน')}
        </p>

        {/* 🔎 ค้นหาเมนู — หน้า Home เคยเป็นหน้าเดียวในระบบที่ค้นหาไม่ได้ (หน้าอื่นมี Ctrl+K/ช่องค้นใน drawer)
            ทั้งที่มีเมนู 58 รายการ 9 หมวด · เปิด CommandPalette ตัวเดียวกับหน้าอื่น ไม่เขียนตัวค้นใหม่ */}
        {onOpenSearch && (
          <button type="button" className="hub-search" onClick={onOpenSearch}
            style={{ maxWidth: 460, marginTop: 14 }}>
            <span style={{ fontSize: 15 }}>🔎</span>
            <span style={{ flex: 1 }}>{tr('ค้นหาเมนู… (เช่น ซ่อม, oee, สต๊อก)')}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--r-xs)', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>
              Ctrl K
            </span>
          </button>
        )}
        </div>

        {/* นาฬิกา + กะ — readout สด (ชิดขวาบนจอกว้าง) */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="hub-clock" style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: 'var(--text)', background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)', padding: '4px 12px', fontVariantNumeric: 'tabular-nums' }}>
            ⏱ {clock}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: isDayShift ? 'var(--amber)' : 'var(--blue)', background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)', padding: '5px 12px' }}>
            {tr(isDayShift ? '☀️ กะเช้า 08:00–20:00' : '🌙 กะดึก 20:00–08:00')}
          </span>
          <span className="hub-date" style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--text2)', background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)', padding: '5px 12px' }}>
            {thaiDate}
          </span>
        </div>
      </div>

      {/* ── LIVE TELEMETRY ── */}
      <div className="hub-tele" style={{ width: '100%', maxWidth: 'min(97vw, 2400px)', marginBottom: 'clamp(22px, 3vw, 32px)', animation: 'hub-fade-up 0.6s ease 0.08s both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>
            {tr('สถานะตอนนี้')}
          </span>
          {/* ขอบเขตของตัวเลข — ห้ามให้เดาเอง (เคยเข้าใจผิดว่าเห็น Andon ของแผนกอื่นเป็นของตัวเอง) */}
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--r-pill)',
            border: '1px solid var(--border)', color: wholeFactory ? 'var(--muted)' : 'var(--accent)',
          }} title={wholeFactory
              ? (MAINTENANCE_ROLES.includes(userRole) ? 'หน่วยงานช่างดูแลเครื่องจักรทุกไลน์ จึงเห็นทั้งโรงงาน' : 'บัญชีนี้ไม่ได้จำกัดส่วนงาน')
              : `นับเฉพาะไลน์: ${(scopeNames || []).join(', ')}`}>
            {wholeFactory ? tr('🏭 ทั้งโรงงาน') : `👥 ส่วนงานของฉัน (${(scopeNames || []).length} ไลน์)`}
          </span>
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('อัปเดตทุก 60 วินาที')}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* การ์ดตัวเลขโครงเดียว (UI §6.35) — ตัวเลขสีเดียว · สถานะอยู่ที่บรรทัดล่าง · กดได้เฉพาะที่มีสิทธิ์เข้าปลายทาง */}
          {TELE.map(t => (
            <KpiTile key={t.key} label={tr(t.label)} value={t.val}
              unit={t.of != null && t.val != null ? `/ ${t.of} ${tr(t.unit)}` : tr(t.unit)}
              note={t.val == null ? 'ยังโหลดไม่ได้' : tr(t.note)} tone={t.val == null ? undefined : (t.tone === 'none' ? undefined : t.tone)}
              title={t.goTitle} style={{ flex: '1 1 150px' }}
              onClick={t.to && canAccessPage(t.to.split('?')[0], userRole) ? () => navigate(t.to) : undefined} />
          ))}
        </div>
      </div>

      {/* ── ⭐ ใช้บ่อยของเครื่องนี้ — ไม่มีสถิติ (เครื่องใหม่) = ไม่โชว์บล็อกเปล่า
             หลักเดียวกับ ⭐ บน rail/drawer ของ sidebar (navRecent ชุดเดียวกัน) ── */}
      {favItems.length > 0 && (
        <div className="hub-fav" style={{ width: '100%', maxWidth: 'min(97vw, 2400px)', marginBottom: 'clamp(18px, 2.4vw, 26px)', animation: 'hub-fade-up 0.6s ease 0.1s both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>
              ⭐ {tr('ใช้บ่อย')}
            </span>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('เครื่องนี้')}</span>
          </div>
          <div className="hub-fav-list" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {favItems.map(it => (
              <button key={it.to} type="button" className="star-chip" onClick={() => navigate(it.to)} title={it.group}>
                <Icon glyph={it.icon} size={15} />{tr(it.label)}
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
            style={{ animation: `hub-fade-up 0.55s ease ${0.12 + 0.06 * i}s both` }}
            onClick={() => navigate(route)}
            /* การ์ดทั้งใบเป็นจุดคลิก (ของเดิม) — เป็น div เพราะข้างในมีปุ่มชิป ซ้อน <button> ไม่ได้
               จึงต้องใส่ role/tabIndex/onKeyDown เองให้คีย์บอร์ดเข้าถึงได้ */
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(route); } }}
            aria-label={`${d.label} — ${tr(d.labelTh)}`}
          >
            {/* แถวบน: จำนวนหน้าที่ user คนนี้เข้าได้จริง (04/11: ถอดรหัส OVW·01 + ไฟเขียว — ตกแต่ง) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{d.items.length} {tr('หน้า')}</span>
            </div>

            {/* ไอคอน + ชื่อ */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <Icon glyph={d.icon} size={28} strokeWidth={1.5} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'clamp(15px, 2vw, 17px)', fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                  {d.label}
                </div>
                {/* ชื่อหมวดไทยใต้ชื่ออังกฤษ — โหมด English ถ้าแปลแล้วซ้ำกับหัว (Production/Production) ไม่วาดซ้ำ */}
                {tr(d.labelTh) !== d.label && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-body)' }}>
                  {tr(d.labelTh)}
                </div>
                )}
              </div>
            </div>

            {/* คำอธิบาย */}
            {d.desc && (
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12, fontFamily: 'var(--font-body)' }}>
                {tr(d.desc)}
              </div>
            )}

            {/* ชิปเมนูจริงจาก sidebar (NAV_ITEMS) — คลิกเข้าหน้านั้นได้เลย
                เกิน CHIP_CAP = พับไว้หลังปุ่ม "ดูทั้งหมด" (ห้ามซ่อนเงียบ — ต้องบอกจำนวนที่พับ) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {chips.map(item => {
                /* 🚪 ชิป "ทางลัด" (หน้าที่บ้านจริงอยู่การ์ดอื่น · `alsoIn`) ต้องหน้าตาต่างจากของการ์ดนี้
                   — จางลง + `<หมวดบ้าน>` ท้ายชิป · ไม่งั้นการ์ดดูเหมือนเป็นเจ้าของหน้านั้นด้วย
                   แล้วคำถาม "หน้านี้อยู่หมวดไหน" มี 2 คำตอบ (24/09 · คำสั่ง user — ดู `isNavGuest`) */
                const guest = isNavGuest(item, d.group);
                const homeShort = NAV_GROUP_META[item.group]?.short || item.group;
                return (
                  <button key={item.to} type="button" className="dept-chip"
                    title={guest ? `เปิด ${item.label} — ทางลัด · เมนูนี้อยู่หมวด "${item.group}"` : `เปิด ${item.label}`}
                    onClick={e => openMenu(e, item.to)}
                    style={guest
                      ? { background: 'transparent', color: 'var(--text2)', border: '1px dashed var(--border2)' }
                      : { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' }}>
                    <Icon glyph={item.icon} size={12} style={{ opacity: guest ? 0.7 : 1 }} />
                    {tr(item.label)}
                    {guest && <span style={{ fontSize: 11, color: 'var(--muted)' }}>↗{tr(homeShort)}</span>}
                  </button>
                );
              })}
              {hidden.length > 0 && (
                <button type="button" className="dept-chip more-chip"
                  onClick={e => { e.stopPropagation(); setExpanded(s => ({ ...s, [d.key]: !open })); }}>
                  {open ? `${tr('ย่อ')}` : `${tr('ดูทั้งหมด')} (${hidden.length})`}
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
        /* 🚫 รูปคนไม่รับ GIF + บันทึกเป็น webp — สเปคเดียวกับ /operator · /register · sidebar */
        <ImageCropModal file={cropFile} aspect={1} shape="circle" outputSize={480} allowGif={false} webp
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
      {/* 🔕 ตั้งค่าแจ้งเตือนของฉัน — role จริง (ไม่ใช่ role ที่จำลองมุมมองอยู่) */}
      {notifyOpen && (
        <Suspense fallback={null}>
          <NotifyPrefsModal role={realRole ?? userRole} onClose={() => setNotifyOpen(false)} />
        </Suspense>
      )}

      {/* ── Footer ── */}
      <div className="hub-foot" style={{
        marginTop: 'clamp(28px, 4vw, 44px)',
        fontSize: 11.5, color: 'var(--muted)',
        animation: 'hub-fade-up 0.55s ease 0.55s both', textAlign: 'center',
      }}>
        ESM · Smart Factory Platform · Thai Summit Group
      </div>
    </div>
  );
}
