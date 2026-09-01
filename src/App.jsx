import { createContext, useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { fmtDateTime } from './utils/dateFormat';
import tsLogo from './assets/TS logo.png';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase, setDrActorName } from './supabaseClient';
import { ToastContainer, toast } from './components/Toast';
import Login from './pages/Login';
import SignatureModal from './components/SignatureModal';
import ChangePasswordModal from './components/ChangePasswordModal';
const FeedbackModal = lazy(() => import('./components/FeedbackModal'));
import { loadPermissions, canAccessPage, setDeptAdmin } from './utils/permissions';
import { trackVisit, topPaths } from './utils/navRecent';
import { effectiveSections } from './utils/sectionScope';
import useIsMobile from './utils/useIsMobile';
import ScrollHint from './components/ScrollHint';
import { pushSupported, getPushState, subscribePush, unsubscribePush } from './utils/webpush';
import { loadPositions, positionLabel } from './utils/positions';   // ตำแหน่งเก็บเป็น key — แสดงต้องแปลงเป็นชื่อ
import { roleLabel } from './utils/roleMeta';                       // ป้ายชื่อ role (โหมดจำลองมุมมอง 🎭)
import { buildProfileMenu } from './utils/profileMenu';             // รายการเมนูโปรไฟล์ — จุดเดียว ใช้ร่วมกับหน้า Home
import { uploadMyAvatar } from './utils/profileSelf';               // อัปโหลดรูปโปรไฟล์ (ใช้ร่วมกับหน้า Home)
import { liveChannel } from './utils/liveChannel';
const ImageCropModal = lazy(() => import('./components/ImageCropModal'));
const ViewAsModal = lazy(() => import('./components/ViewAsModal')); // 🎭 admin จำลองมุมมอง role อื่น

const Register     = lazy(() => import('./pages/Register'));
const Checkin      = lazy(() => import('./pages/Checkin'));
const Management   = lazy(() => import('./pages/Management'));
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Operator     = lazy(() => import('./pages/operator'));
const LineSetup    = lazy(() => import('./pages/LineSetup'));
const LayoutSetup  = lazy(() => import('./pages/LayoutSetup'));
const MachineDatabase = lazy(() => import('./pages/MachineDatabase'));
const DieRegistry = lazy(() => import('./pages/DieRegistry'));
const ProcessSetup = lazy(() => import('./pages/ProcessSetup'));
const QrLabels     = lazy(() => import('./pages/QrLabels'));
const AddUser      = lazy(() => import('./pages/AddUser'));
const CustomerDemand = lazy(() => import('./pages/CustomerDemand'));
const PlannerSales   = lazy(() => import('./pages/PlannerSales'));
const RundownStock   = lazy(() => import('./pages/RundownStock'));
const StoreMonitor   = lazy(() => import('./pages/StoreMonitor'));
const Transport      = lazy(() => import('./pages/Transport'));
const Report       = lazy(() => import('./pages/Report'));
const ShiftOrganize = lazy(() => import('./pages/ShiftOrganize'));
const EventLog      = lazy(() => import('./pages/EventLog'));
const DailyReport   = lazy(() => import('./pages/DailyReport'));
const OEEAnalytics  = lazy(() => import('./pages/OEEAnalytics'));
const ProductHistory = lazy(() => import('./pages/ProductHistory'));
const VSM           = lazy(() => import('./pages/VSM'));
const OrderTrace = lazy(() => import('./pages/OrderTrace'));
const DeptHub       = lazy(() => import('./pages/DeptHub'));
const DeptDashboard = lazy(() => import('./pages/DeptDashboard'));
// 📺 จอเฝ้าระวังแขวนห้อง — เปลือกเต็มจอของ <MtnAndonBoard> (ดูหัวไฟล์ TvBoard.jsx · ไม่ใช่บอร์ดใบใหม่)
const TvBoard = lazy(() => import('./pages/TvBoard'));
const FlowTower    = lazy(() => import('./pages/FlowTower'));
const GroupOverview = lazy(() => import('./pages/GroupOverview'));
const AdoptionOutlook = lazy(() => import('./pages/AdoptionOutlook'));
const HeijunkaKanban = lazy(() => import('./pages/HeijunkaKanban'));
const ProductMaster  = lazy(() => import('./pages/ProductMaster'));
const LineStock      = lazy(() => import('./pages/LineStock'));
const CompanyCalendar = lazy(() => import('./pages/CompanyCalendar'));
const RackCenter      = lazy(() => import('./pages/RackCenter'));
const OrgSetup        = lazy(() => import('./pages/OrgSetup'));
const PmHub       = lazy(() => import('./pages/PmHub'));   // 🔧 ศูนย์ PM (5 หน้าเดิมเป็นแท็บ)
const MtnMachineLayout = lazy(() => import('./pages/MtnMachineLayout'));
const Energy = lazy(() => import('./pages/Energy'));
const Improvements = lazy(() => import('./pages/Improvements'));
const OjtTraining = lazy(() => import('./pages/OjtTraining'));
const DailyChecker = lazy(() => import('./pages/DailyChecker'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const DocFormsRegistry = lazy(() => import('./pages/DocFormsRegistry'));
const MorningMeeting = lazy(() => import('./pages/MorningMeeting'));
const ProductionPlan = lazy(() => import('./pages/ProductionPlan'));
const PermissionsManagement = lazy(() => import('./pages/PermissionsManagement'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const QualityControl = lazy(() => import('./pages/QualityControl'));
const QAInspectionSetup = lazy(() => import('./pages/QAInspectionSetup'));
const PEDocs = lazy(() => import('./pages/PEDocs'));
const ScrapReport = lazy(() => import('./pages/ScrapReport'));
const NotificationConfig = lazy(() => import('./pages/NotificationConfig'));
const MtnRepair = lazy(() => import('./pages/MtnRepair'));
const FactoryMap = lazy(() => import('./pages/FactoryMap'));
const LineOeeBoard = lazy(() => import('./pages/LineOeeBoard'));
const RemoteControl = lazy(() => import('./pages/RemoteControl'));
const RemoteReceiver = lazy(() => import('./components/RemoteReceiver'));

/* ─── Role System ──────────────────────────────────────────── */
export const UserContext = createContext({ role: 'admin', lineId: null, team: null, section: null, notifyEmail: null, signatureUrl: null, fullName: null });

// null roles = accessible to every role
// group ใช้จัดหมวดหมู่ในแถบ sidebar (มี minimize/expand ต่อหมวด)
// สิทธิ์เข้าหน้าอ่านจาก role_permissions ผ่าน canAccessPage() เท่านั้น (data-driven)
// — จึงไม่มีฟิลด์ roles ในนี้ (เคยมี แต่เป็น dead field ไม่ถูกอ่าน ลบออก 2026-07-10 กันเข้าใจผิดว่าเป็น source of truth)
// ⚠️ export — PageHeader ใช้สร้าง breadcrumb (หมวด › ชื่อหน้า) จากลิสต์นี้ ห้ามถอด export
export const NAV_ITEMS = [
  { to: '/',            icon: '🏠', label: 'หน้าหลัก',           group: 'ภาพรวม' },
  // 🎮 /remote ตั้งใจไม่อยู่ในเมนูหมวด — คู่กับปุ่ม 📺 รับรีโมทจอ ที่โซนล่างของ sidebar (ดู Sidebar)

  // จัดหมวดเมนูใหม่ทั้งระบบ 2026-07-20 (คำสั่ง user): ภาพรวม = จอแสดงผล/ผู้บริหาร · ฝ่ายผลิต = งานประจำวัน
  // · วิเคราะห์ & รายงาน · พนักงาน & ทักษะ (ใหม่ — รวมเรื่องคนที่เคยกระจาย 3 หมวด)
  // ⚠️ ชื่อเมนูต้องบอกว่า "เข้าไปทำอะไร" ไม่ใช่บอกแค่ว่าเกี่ยวกับเรื่องอะไร (nav audit 2026-08-27)
  // Dashboard รายส่วนงาน (ผลิต/ซ่อมบำรุง/สโตร์/QA) — หน้าเดียวสลับด้วย ?dept= · ดู docs/DASHBOARD-DESIGN.md
  // ⚠️ นี่คือ "คิวงานที่กดไปทำ" ไม่ใช่จอแขวน — จอแขวนอยู่หมวด 📺 จอแสดงผล (nav audit 2026-08-28)
  { to: '/dept-dashboard', icon: '📋', label: 'งานค้างของส่วนงาน',  group: 'ภาพรวม' },
  { to: '/factory-map', icon: '🗺️', label: 'ผังรวมโรงงาน',       group: 'ภาพรวม' },

  /* ── 📺 จอแสดงผล — 3 จอที่ "แขวนทิ้งไว้" ไม่ใช่หน้าที่เปิดมากดทำงาน (nav audit 2026-08-28) ──
     เดิมนั่งปนใน "ภาพรวม" กับ /dept-dashboard (คิวงาน) และ /factory-map (จอสำรวจ มี metric tab)
     ⚠️ ชื่อต้องบอกว่า "จอนี้ตอบคำถามอะไร" — เดิม "จอผลิตรวม (TV)" กับ "จอ TV แขวนห้อง"
        มีคำว่า TV/จอ ทั้งคู่ คนเลือกไม่ถูกว่าอันไหนควรแขวน (ผิดกฎชื่อเมนูของเราเอง) */
  { to: '/dashboard',   icon: '📊', label: 'ไทม์ไลน์ผลิตทุกไลน์ (TV)', group: 'จอแสดงผล' },
  /* 📺 จอเฝ้าระวัง (`?dept=` ช่าง/ผลิต/สโตร์) — เต็มจอ ไม่มี sidebar/กระดิ่ง
     render ที่ branch พิเศษใน ProtectedLayout (เหมือนหน้า Home) ไม่ได้อยู่ใน <Routes> ด้านล่าง */
  { to: '/tv', icon: '📺', label: 'จอเฝ้าระวังแขวนห้อง (ช่าง/ผลิต/สโตร์)', group: 'จอแสดงผล' },
  // 📟 บอร์ด OEE ประจำไลน์ (จอ TV หน้าไลน์ · deep-link ?line=) — อ่านตารางเราเท่านั้น เตรียมรับ SCADA เป็น "เซ็นเซอร์"
  { to: '/line-oee', icon: '📟', label: 'OEE รายไลน์ (จอหน้าไลน์)', group: 'จอแสดงผล' },
  { to: '/morning-meeting', icon: '🌅', label: 'ประชุมแถวเช้า',   group: 'ฝ่ายผลิต' },
  { to: '/checkin',     icon: '📝', label: 'เช็คชื่อ & PPE',     group: 'ฝ่ายผลิต' },
  { to: '/management',  icon: '🔄', label: 'จัดการไลน์ผลิต',     group: 'ฝ่ายผลิต' },
  { to: '/daily-report',   icon: '📊', label: 'Daily Report',      group: 'ฝ่ายผลิต' },
  { to: '/production-plan', icon: '🗓️', label: 'วางแผนการผลิต',      group: 'ฝ่ายผลิต' },
  { to: '/oee-analytics',  icon: '📈', label: 'OEE',                group: 'วิเคราะห์ & รายงาน' },
  { to: '/product-history', icon: '📜', label: 'ประวัติผลิต (by Product)', group: 'วิเคราะห์ & รายงาน' },
  { to: '/vsm',            icon: '🗺️', label: 'VSM สายธารคุณค่า',   group: 'วิเคราะห์ & รายงาน' },
  { to: '/order-trace', icon: '🔎', label: 'สอบกลับ Order (Trace)', group: 'วิเคราะห์ & รายงาน' },
  { to: '/daily-checker',  icon: '✅', label: 'Daily Checker',       group: 'ฝ่ายผลิต' },  // ขมวด PM Daily + LPA + ระบบเช็คอื่น (แท็บใน DailyChecker)
  { to: '/improvements',   icon: '💡', label: 'Improvements',        group: 'ฝ่ายผลิต' },
  { to: '/scrap-report',   icon: '♻️', label: 'ใบรายงานของเสีย (Scrap)', group: 'ฝ่ายผลิต' },

  { to: '/line-stock',      icon: '📦', label: 'สต๊อกในไลน์',              group: 'Logistic - Store' },
  { to: '/heijunka',       icon: '🎴', label: 'บอร์ดคัมบัง (ทุกสโตร์)',   group: 'Logistic - Store' },
  { to: '/rack-center',    icon: '🗃️', label: 'ภาชนะ & Packaging',       group: 'Logistic - Store' },
  { to: '/planner-sales',   icon: '📈', label: 'Planner & Sales',           group: 'Logistic - Store' },
  { to: '/rundown-stock',   icon: '📉', label: 'คาดการณ์ของจะขาด',        group: 'Logistic - Store' },
  { to: '/customer-demand', icon: '🚚', label: 'จัดส่งลูกค้า',             group: 'Logistic - Store' },
  { to: '/store-monitor',   icon: '🚨', label: 'เฝ้าระวังสต๊อก (Abnormal)',  group: 'Logistic - Store' },
  { to: '/transport',       icon: '🚚', label: 'มอบหมายขนส่ง (Transport)',   group: 'Logistic - Store' },

  // ⚠️ 4 เมนู PM เดิมขึ้นต้นด้วยคำชุดเดียวกัน ("...อุปกรณ์เครื่องจักร") จนแยกไม่ออกว่าอันไหนทำอะไร
  //    ชื่อใหม่บอกการกระทำ: บันทึกผล / ดูปฏิทิน / ดูว่าจะครบกำหนด / ตั้งจุดที่ต้องตรวจ (nav audit 2026-08-27)
  { to: '/mtn-repair',  icon: '🛠️', label: 'แจ้งซ่อม MTN (MO)',                group: 'การตรวจสอบและซ่อมบำรุง' },
  // 🔧 ศูนย์ PM — ยุบ 5 หน้า (ตรวจ/แผน/ล่วงหน้า/ประสานงาน/ตั้งค่า) เป็นแท็บใน PmHub
  //    route เดิมทั้ง 5 redirect เข้าแท็บ · ไม่อยู่ในเมนู (pattern เดียวกับ Daily Checker)
  //    ⭐ วิธีนี้แก้ปัญหา "4 เมนู PM ชื่อขึ้นต้นเหมือนกันจนแยกไม่ออก" ได้แรงกว่าการเปลี่ยนชื่อ
  //       (nav audit 2026-08-27) — ชื่อแท็บในนั้นยึดกฎเดียวกัน: บอกว่าเข้าไปทำอะไร
  { to: '/pm',          icon: '🔧', label: 'ซ่อมบำรุงตามแผน PM (ตรวจ·แผน·ล่วงหน้า·ประสานงาน)', group: 'การตรวจสอบและซ่อมบำรุง' },
  { to: '/mtn-layout',  icon: '🗺️', label: 'ผังเครื่องจักร (ซ่อมบำรุง)',      group: 'การตรวจสอบและซ่อมบำรุง' },
  { to: '/energy',      icon: '⚡', label: 'พลังงานไฟฟ้า',                    group: 'การตรวจสอบและซ่อมบำรุง' },

  // หมวด "วิศวกรรม (PE)" ที่มีเมนูเดียว ถูกยุบเข้ามาที่นี่ (nav audit 2026-08-27) — หมวดเมนูเดียว
  // กินที่บนแถบไอคอน rail เท่าหมวดใหญ่ · งาน PFMEA/CP เป็นงานคุณภาพสายเดียวกันอยู่แล้ว (ลูป 8D → PE)
  { to: '/qa',             icon: '🔍', label: 'Quality Control Center', group: 'คุณภาพ & วิศวกรรม' },
  { to: '/qa-setup',       icon: '📐', label: 'มาตรฐานการตรวจ & Drawing', group: 'คุณภาพ & วิศวกรรม' },
  { to: '/event-log',      icon: '⚡', label: 'CQI-15 Event Log', group: 'คุณภาพ & วิศวกรรม' },
  { to: '/pe-docs',        icon: '📐', label: 'Flow / PFMEA / Control Plan', group: 'คุณภาพ & วิศวกรรม' },

  { to: '/report',        icon: '📋', label: 'รายงาน',            group: 'วิเคราะห์ & รายงาน' },

  { to: '/register',   icon: '➕', label: 'เพิ่มพนักงาน',      group: 'พนักงาน & ทักษะ' },
  { to: '/operator',   icon: '👥', label: 'ฐานข้อมูลพนักงาน',  group: 'พนักงาน & ทักษะ' },
  { to: '/ojt-training', icon: '📖', label: 'อบรมสอนงาน OJT',   group: 'พนักงาน & ทักษะ' },
  { to: '/skills-report', icon: '🏅', label: 'Skill Matrix & ค่าฝีมือ', group: 'พนักงาน & ทักษะ' },
  { to: '/shift-organize', icon: '🗓', label: 'ตารางกะ',         group: 'พนักงาน & ทักษะ' },

  // ── จอผู้บริหาร/เดโม — แยกออกจาก "ภาพรวม" (nav audit 2026-08-27) ────────────────
  // 3 หน้านี้เปิดตอนประชุม/เดโม ไม่ใช่หน้าที่หัวหน้ากะเปิดทุกวัน · เดิมนั่งปนกับ Dashboard/ผังรวม
  { to: '/flow-tower', icon: '🔗', label: 'สายธารความต้องการ',   group: 'ผู้บริหาร & เดโม' },
  // 🧪 mockup ตอบโจทย์ผู้บริหาร "ดูภาพรวมหลายโรงงาน" — โรงงานที่ 1 ข้อมูลจริง ที่เหลือจำลอง (seed: admin/manager)
  { to: '/group-overview', icon: '🏢', label: 'ภาพรวมกลุ่มโรงงาน (Mockup)', group: 'ผู้บริหาร & เดโม' },
  // "ข้อมูลเชื่อมกันทั้งองค์กรแล้วตอบคำถามอะไรได้" — สอบกลับ/คุมคุณภาพ/predictive/prescriptive
  // ฝั่งวันนี้นับสดจากฐานจริง ฝั่งอนาคตติดป้ายคาดการณ์ (seed: admin/manager)
  { to: '/adoption-outlook', icon: '🔮', label: 'ภาพเมื่อข้อมูลเชื่อมกัน', group: 'ผู้บริหาร & เดโม' },

  // ── ตั้งค่า 13 เมนู แบ่ง 2 กลุ่มย่อยด้วย `sub` (nav audit 2026-08-27) ─────────────
  // ไม่ได้เพิ่มหมวดบนแถบไอคอน — แค่คั่นหัวข้อในแผงเดียวกัน แยก "ของที่กรอกทุกเดือน"
  // ออกจาก "ของที่ตั้งครั้งเดียว" · ห้ามลืมใส่ `sub` ให้เมนูใหม่ในหมวดนี้ (ไม่ใส่ = ตกไปกลุ่มแรก)
  { to: '/products',        icon: '🔩', label: 'Product Master',    group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ฐานข้อมูลหลัก' },
  { to: '/machine-database', icon: '🏭', label: 'ฐานข้อมูลเครื่องจักร', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ฐานข้อมูลหลัก' },
  { to: '/die-registry', icon: '🔨', label: 'ทะเบียนแม่พิมพ์', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ฐานข้อมูลหลัก' },
  { to: '/process-setup', icon: '🏭', label: 'กระบวนการผลิต', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ฐานข้อมูลหลัก' },
  { to: '/org-setup',  icon: '🏢', label: 'แผนผังองค์กร',     group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ฐานข้อมูลหลัก' },
  { to: '/layout-setup', icon: '🗺️', label: 'ตั้งค่าผัง/Floorplan', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ฐานข้อมูลหลัก' },
  // /linesetup ย้ายมาฝังในแท็บ "ผลิต (ผังไลน์)" ของ /layout-setup แล้ว — คง route ไว้สำหรับลิงก์เก่า (deep-link) ไม่โชว์ใน sidebar
  { to: '/company-calendar', icon: '📅', label: 'ปฏิทินบริษัท',    group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ฐานข้อมูลหลัก' },

  { to: '/permissions', icon: '🔐', label: 'จัดการสิทธิ์',       group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ตั้งค่าระบบ' },
  // จัดการผู้ใช้งาน ย้ายเข้าหมวดตั้งค่าฯ (คำสั่ง user 2026-07-20) — เดิมเป็นลิงก์พิเศษลอยท้าย sidebar
  { to: '/add-user',    icon: '🔑', label: 'จัดการผู้ใช้งาน',     group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ตั้งค่าระบบ' },
  { to: '/notification-config', icon: '🔔', label: 'ตั้งค่าการแจ้งเตือน', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ตั้งค่าระบบ' },
  { to: '/doc-forms',   icon: '📄', label: 'ทะเบียนเอกสาร & ฟอร์ม', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ตั้งค่าระบบ' },
  { to: '/qr-labels', icon: '🏷️', label: 'พิมพ์ป้าย QR', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ตั้งค่าระบบ' },
  { to: '/audit-log',   icon: '📜', label: 'ประวัติการแก้ไขข้อมูล', group: 'ตั้งค่าโปรแกรม,ฐานข้อมูล', sub: 'ตั้งค่าระบบ' },
];

export const NAV_GROUP_ORDER = ['ภาพรวม', 'จอแสดงผล', 'ฝ่ายผลิต', 'วิเคราะห์ & รายงาน', 'พนักงาน & ทักษะ', 'Logistic - Store', 'การตรวจสอบและซ่อมบำรุง', 'คุณภาพ & วิศวกรรม', 'ตั้งค่าโปรแกรม,ฐานข้อมูล', 'ผู้บริหาร & เดโม'];

// ไอคอน + ชื่อย่อของหมวด — ใช้บนแถบไอคอน (rail) ของ sidebar แบบใหม่ (2026-08-18 · คำสั่ง user "เอา D เลย")
// ชื่อย่อ ≤ ~9 ตัวอักษรให้พอดีความกว้าง rail 64px ที่ฟอนต์ 11px (กฎฟอนต์ขั้นต่ำ UI-CONVENTIONS)
export const NAV_GROUP_META = {
  'ภาพรวม':                    { icon: '🏠', short: 'ภาพรวม' },
  'จอแสดงผล':               { icon: '📺', short: 'จอแขวน' },
  'ฝ่ายผลิต':                  { icon: '🏭', short: 'ผลิต' },
  'วิเคราะห์ & รายงาน':        { icon: '📈', short: 'รายงาน' },
  'พนักงาน & ทักษะ':           { icon: '👥', short: 'พนักงาน' },
  'Logistic - Store':          { icon: '📦', short: 'สโตร์' },
  'การตรวจสอบและซ่อมบำรุง':    { icon: '🛠️', short: 'ซ่อมบำรุง' },
  'คุณภาพ & วิศวกรรม':         { icon: '✅', short: 'คุณภาพ' },
  'ตั้งค่าโปรแกรม,ฐานข้อมูล':  { icon: '⚙️', short: 'ตั้งค่า' },
  'ผู้บริหาร & เดโม':          { icon: '🔮', short: 'ผู้บริหาร' },
};

// เมนูจริงของหมวด sidebar สำหรับ DeptHub — การ์ดหน้าหลักดึงไปแสดงเป็นชิปที่คลิกเข้าหน้าได้เลย
// อิง NAV_ITEMS ตัวเดียวกับ sidebar เสมอ (single source of truth — ห้ามพิมพ์รายชื่อเมนูซ้ำใน DeptHub)
// และกรองตามสิทธิ์ role เดียวกับ sidebar เพื่อให้ชิปตรงกับเมนูที่ user คนนั้นเห็นจริง
export function navItemsForGroups(groups, role) {
  return NAV_ITEMS.filter(i => i.to !== '/' && groups.includes(i.group) && canAccessPage(i.to, role));
}

// สรุปสิทธิ์เข้าหน้าของ role จากตารางสิทธิ์จริง (role_permissions) — ใช้โชว์ในหน้า จัดการผู้ใช้งาน
// เพื่อไม่ต้อง hardcode รายชื่อโมดูลต่อ role (เคย hardcode แล้ว drift ตามโมดูลที่เพิ่มไม่ทัน)
export function accessSummaryForRole(role) {
  const pages = NAV_ITEMS.filter(i => i.to !== '/' && canAccessPage(i.to, role));
  const groups = NAV_GROUP_ORDER.filter(g => pages.some(p => p.group === g));
  return { total: pages.length, all: pages.length >= NAV_ITEMS.length - 1, groups };
}

// focusSidebarGroups ถูกถอดออกแล้ว (2026-08-18) — desktop เป็น rail (ไฮไลต์หมวดของหน้าปัจจุบันเอง)
// และ drawer มือถือเป็น accordion ที่เปิดหมวดของหน้าปัจจุบันให้อัตโนมัติ จึงไม่ต้องสั่งโฟกัสจาก hub อีก

/* ─── Role Route Guard ────────────────────────────────────────────────
   สิทธิ์เข้าถึงแต่ละหน้าเก็บอยู่ใน role_permissions (ตาราง) ไม่ใช่ array ในโค้ดอีกต่อไป
   จัดการได้จากหน้า "จัดการสิทธิ์" (admin เท่านั้น) — ดู src/utils/permissions.js
   admin bypass เสมอ กันกรณี config ผิดจนตัวเองเข้าไม่ได้ ── */
function RoleRoute({ children, path, userRole }) {
  if (!canAccessPage(path, userRole)) return <Navigate to="/" replace />;
  return children;
}

/* ─── Splash Screen ────────────────────────────────────── */
function SplashScreen({ onDone }) {
  const barRef = useRef(null);

  useEffect(() => {
    setTimeout(() => document.getElementById('splash-logo')?.classList.add('up'), 100);
    setTimeout(() => document.getElementById('splash-title')?.classList.add('up'), 300);
    setTimeout(() => document.getElementById('splash-subtitle')?.classList.add('up'), 420);
    setTimeout(() => document.getElementById('splash-sub')?.classList.add('up'), 500);

    let w = 0;
    const iv = setInterval(() => {
      w = Math.min(w + 2.5, 100);
      if (barRef.current) barRef.current.style.width = w + '%';
      if (w >= 100) { clearInterval(iv); setTimeout(onDone, 400); }
    }, 20);

    return () => clearInterval(iv);
  }, [onDone]);

  return (
    <div id="splash">
      {/* Triangle logo */}
      <div id="splash-logo" style={{
        opacity: 0, transform: 'translateY(20px)',
        transition: 'opacity 0.6s ease, transform 0.6s ease',
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8,
      }}>
        <img src={tsLogo} alt="Thai Summit Group" width={52} height={52} style={{ borderRadius: 5 }} />
        <div style={{ textAlign: 'left' }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 13, letterSpacing: '2px', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.9)',
          }}>Thai Summit Group</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 11,
            letterSpacing: '2px', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.35)',
          }}>VX Production System</div>
        </div>
      </div>

      {/* 4M title */}
      <div id="splash-title" style={{
        opacity: 0, transform: 'translateY(16px)',
        transition: 'opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s',
        fontFamily: 'var(--font-display)', fontWeight: 700,
        fontSize: 'clamp(1.2rem,3.5vw,2.4rem)', letterSpacing: '0.5px',
        color: 'var(--accent)', lineHeight: 1,
      }}>
        ENTERPRISE SHOPFLOOR MANAGEMENT
      </div>
      <div style={{
        opacity: 0, transform: 'translateY(10px)',
        transition: 'opacity 0.5s ease 0.25s, transform 0.5s ease 0.25s',
        fontSize: 'clamp(0.75rem,1.8vw,0.95rem)', color: 'var(--muted)', fontWeight: 500,
        letterSpacing: '0.5px', marginTop: 4,
      }} id="splash-subtitle">Thai Summit Group · ESM</div>

      <div className="splash-sub" id="splash-sub">Zero defect is possible</div>

      <div className="splash-bar-wrap" style={{ marginTop: 12 }}>
        <div className="splash-bar-fill" ref={barRef} />
      </div>
    </div>
  );
}

/* ─── Sidebar ──────────────────────────────────────────────── */
// export ไว้ให้ audit harness (audit/main.jsx ?p=__sidebar) mount ตรงๆ เพื่อวัด layout — แอปจริงใช้ผ่าน ProtectedLayout เท่านั้น
export function Sidebar({ isOpen, onClose, onLogout, theme, onToggleTheme, userRole, userLineId, userEmail, userFullName, userSignatureUrl, userPosition, userAvatarUrl, remoteCode, onToggleRemote, onOpenPalette, pinned, onTogglePin, realRole, onOpenViewAs, onAvatarSaved }) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [sigModalOpen,  setSigModalOpen]  = useState(false);
  const [fbOpen, setFbOpen] = useState(false);   // 💬 กล่องรับ feedback หน้างาน
  const [sigUrl,        setSigUrl]        = useState(userSignatureUrl);
  const [pwdModalOpen,  setPwdModalOpen]  = useState(false);
  // 📷 เปลี่ยนรูปโปรไฟล์ — เดิมมีเฉพาะหน้า Home (DeptHub) sidebar ไม่มี (drift · แก้ 2026-08-21)
  const avatarRef = useRef(null);
  const [avatarFile, setAvatarFile] = useState(null);   // ไฟล์ที่เลือก → ส่งเข้า ImageCropModal
  // เมนูโปรไฟล์ท้าย sidebar (ลายเซ็น/รหัสผ่าน/รีโมท/ธีม/ออกจากระบบ) พับได้ — default ซ่อน ลดความรก
  const [footerOpen, setFooterOpen] = useState(() => { try { return localStorage.getItem('sb_footer_open') === '1'; } catch { return false; } });
  const toggleFooter = () => setFooterOpen(v => { try { localStorage.setItem('sb_footer_open', v ? '0' : '1'); } catch { /* private mode */ } return !v; });
  // drawer มือถือ: หมวดเป็น accordion เปิดทีละหมวด — undefined = ตามหมวดของหน้าปัจจุบัน · null = ปิดหมด
  // (เดิมกางทุกหมวด 55 รายการ = เลื่อน 3 จอ — ปัญหาเดียวกับ desktop ก่อนเปลี่ยนเป็น rail)
  const [mOpenGroup, setMOpenGroup] = useState(undefined);

  // ── แผงหมวดของ rail (desktop · sidebar แบบ D 2026-08-18) ──────────────────────
  // panel = ชื่อหมวด | '__star' (ใช้บ่อย) | '__me' (โปรไฟล์) | null = ปิด
  // ปกติแผง "ลอยทับ" เนื้อหา (เนื้อหาไม่ถูกบีบ — คำสั่ง user) · ปักหมุด 📌 = ค้างไว้และดันเนื้อหา
  const [panel, setPanel] = useState(null);
  const pinnedRef = useRef(pinned);
  useEffect(() => { pinnedRef.current = pinned; }, [pinned]);

  // เปลี่ยนหน้า = ปิดแผงเอง (เว้นปักหมุด) — เลือกเมนูแล้วแผงต้องหลบให้เห็นเนื้อหาทันที
  // และ accordion มือถือกลับไปตามหมวดของหน้าใหม่ (undefined = follow active)
  useEffect(() => {
    if (!pinnedRef.current) setPanel(null);
    setMOpenGroup(undefined);
  }, [location.pathname]);

  // Esc ปิดแผง (เฉพาะตอนไม่ปักหมุด)
  useEffect(() => {
    if (!panel || pinned) return;
    const onKey = (e) => { if (e.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, pinned]);

  useEffect(() => { setSigUrl(userSignatureUrl); }, [userSignatureUrl]);

  const visibleItems = NAV_ITEMS.filter(item => canAccessPage(item.to, userRole));
  // ค้นหาเมนู: พิมพ์แล้วยุบเป็นลิสต์แบน (ข้ามการไล่กางหมวด) — หมวดยังโชว์เป็นคำอธิบายท้ายบรรทัด
  const [navQ, setNavQ] = useState('');
  const q = navQ.trim().toLowerCase();
  const searchHits = q
    ? visibleItems.filter(i => (i.label + ' ' + i.group + ' ' + i.to).toLowerCase().includes(q))
    : null;
  const groupedItems = NAV_GROUP_ORDER
    .map(g => ({ group: g, items: visibleItems.filter(i => i.group === g) }))
    .filter(g => g.items.length > 0);
  const displayName = userFullName || userEmail || '';
  const initials = displayName
    ? displayName.split(/[\s@]/)[0].slice(0, 2).toUpperCase()
    : '?';

  // หมวดของหน้าปัจจุบัน — ใช้ไฮไลต์บน rail + เป็นแผง default ตอนปักหมุด + หมวดที่ accordion มือถือเปิดให้เอง
  const activeGroup = groupedItems.find(g => g.items.some(i => i.to === location.pathname))?.group || null;
  // หน้าที่ใช้บ่อยของเครื่องนี้ (navRecent) — desktop = แผง ⭐ บน rail · มือถือ = บล็อกบนสุดของ drawer
  const starItems = topPaths(8).map(p => visibleItems.find(i => i.to === p)).filter(Boolean);

  // ปักหมุดอยู่แต่ยังไม่มีแผงเปิด (เพิ่งโหลด/เพิ่งกดปัก) → เปิดแผงหมวดของหน้าปัจจุบันให้
  useEffect(() => {
    if (pinned) setPanel(p => p || activeGroup || groupedItems[0]?.group || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned]);

  // การ์ดข้อมูล user (ใช้ทั้ง drawer มือถือ + แผงโปรไฟล์บน desktop)
  const userCard = (clickable) => (
    <div onClick={clickable ? toggleFooter : undefined}
      title={clickable ? (footerOpen ? 'พับเมนูโปรไฟล์' : 'กางเมนูโปรไฟล์ (ลายเซ็น/รหัสผ่าน/ธีม/ออกจากระบบ)') : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', borderRadius: 8,
        background: 'var(--bg3)', border: '1px solid var(--border2)',
        marginBottom: 2, cursor: clickable ? 'pointer' : 'default', userSelect: 'none',
      }}>
      {userAvatarUrl ? (
        <img src={userAvatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', border: '1.5px solid var(--accent)' }} />
      ) : (
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--accent), #ff6b6b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 800, color: '#fff',
        }}>{initials}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {userFullName || (userEmail?.split('@')[0]) || 'Unknown'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[positionLabel(userPosition), userEmail].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, padding: '2px 6px',
        borderRadius: 4, flexShrink: 0,
        background: userRole === 'admin' ? 'var(--accent-dim)' :
                    userRole === 'manager' ? 'var(--accent2-dim)' :
                    userRole === 'supervisor' ? 'rgba(77,159,255,0.12)' :
                    'var(--accent-dim)',
        color: userRole === 'admin' ? 'var(--accent)' :
               userRole === 'manager' ? 'var(--accent2)' :
               userRole === 'supervisor' ? '#4d9fff' :
               'var(--green)',
        border: `1px solid ${
          userRole === 'admin' ? 'rgba(61,214,92,0.3)' :
          userRole === 'manager' ? 'rgba(245,154,63,0.3)' :
          userRole === 'supervisor' ? 'rgba(77,159,255,0.3)' :
          'rgba(61,214,92,0.3)'
        }`,
      }}>
        {userRole?.toUpperCase() ?? 'ADMIN'}
      </div>
      {clickable && !footerOpen && remoteCode && <span style={{ fontSize: 12, flexShrink: 0 }} title={`รับรีโมทอยู่ · ${remoteCode}`}>📺</span>}
      {clickable && <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{footerOpen ? '▾' : '▸'}</span>}
    </div>
  );

  /* ── เมนูโปรไฟล์ — render จาก descriptor กลาง `buildProfileMenu` (src/utils/profileMenu.js)
     รายการเมนู "มีอะไรบ้าง" อยู่ที่ไฟล์นั้นที่เดียว ใช้ร่วมกับ dropdown มุมขวาบนของหน้า Home
     (DeptHub) — เดิมเขียนแยกกัน 2 ชุดแล้ว drift (หน้า Home ไม่มี 💬/🎭/รีโมท · sidebar ไม่มี 📷)
     ที่นี่รับผิดชอบแค่ "หน้าตา" ของแถวเมนู · JSX ชุดนี้ใช้ทั้ง drawer มือถือ + แผง '__me' desktop */
  const profileItems = buildProfileMenu({
    realRole, canRemote: canAccessPage('/remote', userRole), remoteCode, theme,
    on: {
      avatar:       () => avatarRef.current?.click(),
      signature:    () => setSigModalOpen(true),
      password:     () => setPwdModalOpen(true),
      feedback:     () => setFbOpen(true),
      viewAs:       onOpenViewAs,
      toggleRemote: onToggleRemote,
      toggleTheme:  onToggleTheme,
      logout:       onLogout,
    },
  });

  const profileActions = (closeNav) => (<>
    {profileItems.map(it => {
      const style = { background: 'none', border: 'none', width: '100%', textAlign: 'left', color: it.color || 'var(--text2)' };
      if (it.to) {
        return (
          <Link key={it.key} to={it.to} onClick={closeNav} className="nav-link"
            style={{ color: location.pathname === it.to ? 'var(--accent)' : (it.color || 'var(--text2)') }}>
            <span style={{ fontSize: 15, flexShrink: 0 }}>{it.icon}</span>
            <span style={{ whiteSpace: 'nowrap' }}>{it.label}</span>
          </Link>
        );
      }
      if (it.kind === 'toggle') {
        return (
          <button key={it.key} onClick={it.onClick} className="nav-link"
            style={{ ...style, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{it.icon}</span>
              <span style={{ whiteSpace: 'nowrap', color: 'var(--text2)' }}>{it.label}</span>
            </div>
            <div style={{
              width: 36, height: 20, borderRadius: 10, flexShrink: 0,
              background: it.on ? 'var(--accent)' : 'var(--border2)',
              position: 'relative', transition: 'background 0.25s',
            }}>
              <div style={{
                position: 'absolute', top: 2, left: it.on ? 18 : 2,
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </div>
          </button>
        );
      }
      return (
        <button key={it.key} onClick={() => { it.onClick?.(); if (it.key !== 'logout') closeNav?.(); }}
          className="nav-link" style={style}>
          <span style={{ fontSize: 15, flexShrink: 0 }}>{it.icon}</span>
          <span style={{ whiteSpace: 'nowrap' }}>{it.label}</span>
        </button>
      );
    })}
    {/* input ไฟล์ของ 📷 เปลี่ยนรูปโปรไฟล์ — ซ่อนไว้ กดผ่านรายการเมนูด้านบน */}
    <input ref={avatarRef} type="file" accept="image/*" style={{ display: 'none' }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setAvatarFile(f); }} />
  </>);

  const modals = (<>
    {fbOpen && <Suspense fallback={null}><FeedbackModal onClose={() => setFbOpen(false)} /></Suspense>}
    {avatarFile && (
      <Suspense fallback={null}>
        <ImageCropModal file={avatarFile} aspect={1} shape="circle" outputSize={480}
          title="จัดตำแหน่งรูปโปรไฟล์" onCancel={() => setAvatarFile(null)}
          onConfirm={async (blob) => {
            setAvatarFile(null);
            const res = await uploadMyAvatar(blob, userAvatarUrl);   // helper กลาง (ใช้ร่วมกับหน้า Home)
            if (!res.ok) { toast.error(res.message); return; }
            onAvatarSaved?.(res.url);
            toast.success('เปลี่ยนรูปโปรไฟล์แล้ว');
          }} />
      </Suspense>
    )}
    <SignatureModal
      open={sigModalOpen}
      onClose={() => setSigModalOpen(false)}
      currentSignatureUrl={sigUrl}
      onSaved={(url) => setSigUrl(url)}
    />
    <ChangePasswordModal
      open={pwdModalOpen}
      onClose={() => setPwdModalOpen(false)}
      userEmail={userEmail}
    />
  </>);

  /* ── Desktop: rail 64px + แผงหมวดลอยทับ (sidebar แบบ D · 2026-08-18) ─────────────
     หลัก: เนื้อหาหลักเสีย 64px เท่านั้น (เดิม 252px) — แผงเมนูลอยทับตอนกดไอคอนหมวด
     เลือกเมนูแล้วปิดเอง · 📌 ปักหมุด = ค้างแผงไว้และดันเนื้อหา (opt-in เท่านั้น) */
  if (!isMobile) {
    const panelOpen = !!panel;
    const panelMeta = panel === '__star' ? { icon: '⭐', title: 'ใช้บ่อย' }
      : panel === '__me' ? { icon: '👤', title: 'โปรไฟล์ & อุปกรณ์' }
      : { icon: NAV_GROUP_META[panel]?.icon || '📁', title: panel };
    const panelItems = panel && panel !== '__star' && panel !== '__me'
      ? (groupedItems.find(g => g.group === panel)?.items || [])
      : null;

    const railBtn = ({ key, icon, label, title, onClick, isOpenPanel, isCurrent }) => (
      <button key={key} onClick={onClick} title={title}
        style={{
          width: 56, flexShrink: 0, borderRadius: 10, cursor: 'pointer', outline: 'none',
          border: `1px solid ${isOpenPanel ? 'var(--accent)' : 'transparent'}`,
          background: isOpenPanel ? 'var(--accent-dim)' : 'transparent',
          color: (isOpenPanel || isCurrent) ? 'var(--accent)' : 'var(--text2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
          padding: '6px 2px 4px',
        }}>
        <span style={{ fontSize: 18, lineHeight: 1.15 }}>{icon}</span>
        {/* 11px = ฟอนต์ขั้นต่ำตาม UI-CONVENTIONS — ชื่อย่อจาก NAV_GROUP_META ถูกเลือกให้พอดี 56px */}
        <span style={{ fontSize: 11, lineHeight: 1.2, maxWidth: 56, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </button>
    );

    return (
      <>
        <nav style={{
          position: 'fixed', top: 0, left: 0, height: '100vh',
          width: isOpen ? 'var(--rail-w)' : '0px',
          background: 'var(--bg2)', borderRight: isOpen ? '1px solid var(--border)' : 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: isOpen ? '10px 0 8px' : '10px 0',
          gap: 4, zIndex: 1000, overflow: 'hidden',
          transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}>
            <Link to="/" title="หน้าหลัก (เลือกโมดูล)" style={{ flexShrink: 0, lineHeight: 0, marginBottom: 2 }}>
              <img src={tsLogo} alt="Thai Summit Group" width={30} height={30} style={{ borderRadius: 4 }} />
            </Link>
            {railBtn({
              key: '__search', icon: '🔎', label: 'ค้นหา', title: 'ค้นหาเมนู (Ctrl+K)',
              onClick: onOpenPalette, isOpenPanel: false, isCurrent: false,
            })}
            <div style={{ width: 40, borderTop: '1px solid var(--border)', margin: '2px 0', flexShrink: 0 }} />

            {/* หมวดเมนู — ส่วนกลางเลื่อนได้ กันจอเตี้ยตกขอบ */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: '100%' }}>
              {groupedItems.map(({ group }) => railBtn({
                key: group,
                icon: NAV_GROUP_META[group]?.icon || '📁',
                label: NAV_GROUP_META[group]?.short || group,
                title: group,
                onClick: () => setPanel(p => (p === group && !pinned) ? null : group),
                isOpenPanel: panel === group,
                isCurrent: activeGroup === group,
              }))}
            </div>

            <div style={{ width: 40, borderTop: '1px solid var(--border)', margin: '2px 0', flexShrink: 0 }} />
            {railBtn({
              key: '__star', icon: '⭐', label: 'ใช้บ่อย', title: 'หน้าที่ใช้บ่อย (เครื่องนี้)',
              onClick: () => setPanel(p => (p === '__star' && !pinned) ? null : '__star'),
              isOpenPanel: panel === '__star', isCurrent: false,
            })}
            {/* โปรไฟล์ user — รายละเอียด/ลายเซ็น/รหัสผ่าน/รีโมท/ธีม/ออกจากระบบ อยู่ในแผงนี้ (ไม่หายไปไหน) */}
            <button
              onClick={() => setPanel(p => (p === '__me' && !pinned) ? null : '__me')}
              title={`${displayName} · โปรไฟล์/ลายเซ็น/ธีม/ออกจากระบบ`}
              style={{
                width: 44, height: 44, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', outline: 'none',
                border: `2px solid ${panel === '__me' ? 'var(--accent)' : 'var(--border2)'}`,
                background: 'var(--bg3)', padding: 0, position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
              }}>
              {userAvatarUrl ? (
                <img src={userAvatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{initials}</span>
              )}
              {remoteCode && (
                <span title={`รับรีโมทอยู่ · ${remoteCode}`} style={{ position: 'absolute', right: -3, top: -3, fontSize: 12 }}>📺</span>
              )}
            </button>
            <button onClick={onClose} title="ซ่อนเมนู (เต็มจอ — เหมาะจอ TV)" style={{
              width: 32, height: 26, borderRadius: 8, flexShrink: 0, marginTop: 4,
              background: 'var(--bg3)', border: '1px solid var(--border2)',
              color: 'var(--text2)', fontSize: 12, cursor: 'pointer', outline: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>◀</button>
        </nav>

        {isOpen && panelOpen && (<>
          {/* backdrop โปร่งใส — คลิกนอกแผง = ปิด (เฉพาะตอนไม่ปักหมุด) */}
          {!pinned && (
            <div onClick={() => setPanel(null)} style={{ position: 'fixed', top: 0, bottom: 0, right: 0, left: 'var(--rail-w)', zIndex: 997, background: 'transparent' }} />
          )}
          <div style={{
            position: 'fixed', top: 0, bottom: 0, left: 'var(--rail-w)', width: 'var(--sidebar-w)',
            background: 'var(--bg2)', borderRight: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', padding: '0 10px 14px',
            zIndex: 998,
            boxShadow: pinned ? 'none' : '18px 0 40px rgba(0,0,0,0.45)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 2px 10px', borderBottom: '1px solid var(--border)', marginBottom: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 17, flexShrink: 0 }}>{panelMeta.icon}</span>
              <span style={{ fontSize: 13.5, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{panelMeta.title}</span>
              <button onClick={onTogglePin} title={pinned ? 'เลิกปักหมุด — แผงจะปิดเองหลังเลือกเมนู' : 'ปักหมุดแผงค้างไว้ (เนื้อหาหลักจะแคบลง)'} style={{
                width: 26, height: 26, borderRadius: 6, flexShrink: 0, cursor: 'pointer', outline: 'none',
                border: `1px solid ${pinned ? 'var(--accent)' : 'var(--border2)'}`,
                background: pinned ? 'var(--accent-dim)' : 'transparent',
                color: pinned ? 'var(--accent)' : 'var(--muted)', fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>📌</button>
              {!pinned && (
                <button onClick={() => setPanel(null)} title="ปิดแผง (Esc)" style={{
                  width: 26, height: 26, borderRadius: 6, flexShrink: 0, cursor: 'pointer', outline: 'none',
                  border: '1px solid var(--border2)', background: 'transparent',
                  color: 'var(--muted)', fontSize: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
              )}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {panelItems && panelItems.map((item, i) => (
                <div key={item.to}>
                  {/* หัวข้อย่อยในหมวด (`sub`) — คั่นเฉพาะตอนเปลี่ยนกลุ่ม ไม่เพิ่มหมวดบนแถบไอคอน */}
                  {item.sub && item.sub !== panelItems[i - 1]?.sub && (
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.04em',
                      padding: '9px 9px 3px', marginTop: i === 0 ? 0 : 5,
                      borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    }}>{item.sub}</div>
                  )}
                  <Link
                    to={item.to} className="nav-link"
                    style={location.pathname === item.to
                      ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }
                      : {}}
                    onClick={() => { if (!pinned) setPanel(null); }}
                  >
                    <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                  </Link>
                </div>
              ))}

              {panel === '__star' && (
                starItems.length === 0 ? (
                  <div style={{ padding: '18px 10px', color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>
                    ยังไม่มีสถิติการใช้งานบนเครื่องนี้
                    <div style={{ marginTop: 4, fontSize: 11 }}>เข้าหน้าต่างๆ แล้วหน้าที่ใช้บ่อยจะมาอยู่ที่นี่เอง</div>
                  </div>
                ) : starItems.map(item => (
                  <Link
                    key={item.to} to={item.to} className="nav-link"
                    style={location.pathname === item.to
                      ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }
                      : {}}
                    onClick={() => { if (!pinned) setPanel(null); }}
                  >
                    <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)', flexShrink: 0, maxWidth: '38%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.group}</span>
                  </Link>
                ))
              )}

              {panel === '__me' && (<>
                {userCard(false)}
                {profileActions(() => { if (!pinned) setPanel(null); })}
              </>)}
            </div>
          </div>
        </>)}
        {modals}
      </>
    );
  }

  /* ── Mobile: drawer เต็มแบบเดิม (เปิดจาก ☰ ทับเนื้อหาอยู่แล้ว ไม่บีบจอ) ── */
  return (
    <>
      {isMobile && isOpen && (
        <div className="sidebar-backdrop visible" onClick={onClose} />
      )}
      <nav style={{
        position: 'fixed', top: 0, left: 0, height: '100vh',
        width: isOpen ? 'var(--sidebar-w)' : '0px',
        background: 'var(--bg2)',
        borderRight: isOpen ? '1px solid var(--border)' : 'none',
        display: 'flex', flexDirection: 'column',
        padding: isOpen ? '0 10px 20px' : '0',
        overflow: 'hidden',
        transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1), padding 0.3s',
        zIndex: 1000,
        boxShadow: isOpen ? '4px 0 30px rgba(0,0,0,0.3)' : 'none',
      }}>
        {/* Logo + ปุ่มพับ sidebar (อยู่ในหัวแถบ ไม่ลอยทับเนื้อหา) */}
        <div style={{ padding: '18px 6px 16px', borderBottom: '1px solid var(--border)', marginBottom: 10, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <img src={tsLogo} alt="Thai Summit Group" width={28} height={28} style={{ borderRadius: 3, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, letterSpacing: '2px', color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, fontFamily: 'var(--font-display)' }}>Thai Summit</div>
              <div style={{ fontSize: 11, letterSpacing: '1.5px', color: 'var(--muted)', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>ESM · Shopfloor</div>
            </div>
          </div>
          <button
            onClick={onClose}
            title="พับเมนู"
            style={{
              // สัญลักษณ์ show/hide เหมือนกันทั้งระบบ: 32×32 radius8 bg3 border2 · ◀ = พับ
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: 'var(--bg3)', border: '1px solid var(--border2)',
              color: 'var(--text2)', fontSize: 14, cursor: 'pointer', outline: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >◀</button>
        </div>

        {/* ค้นหาเมนู — 51 รายการ 8 หมวด ถ้าไม่มีช่องค้นต้องจำว่าอยู่หมวดไหน (NAVIGATION-REVIEW §2.5) */}
        <div style={{ position: 'relative', marginBottom: 6, flexShrink: 0 }}>
          <input
            value={navQ} onChange={e => setNavQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setNavQ(''); }}
            placeholder="🔎 ค้นหาเมนู…  (Ctrl+K)"
            style={{
              width: '100%', padding: '7px 26px 7px 10px', fontSize: 12.5, borderRadius: 8,
              background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)',
            }}
          />
          {navQ && (
            <button onClick={() => setNavQ('')} title="ล้างคำค้น" style={{
              position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
              width: 20, height: 20, borderRadius: 5, border: 'none', background: 'transparent',
              color: 'var(--muted)', cursor: 'pointer', fontSize: 13, lineHeight: 1,
            }}>✕</button>
          )}
        </div>

        {/* Links */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', minHeight: 0 }}>
          {searchHits ? (
            searchHits.length === 0 ? (
              <div style={{ padding: '18px 10px', color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>
                ไม่พบเมนูที่ตรงกับ “{navQ}”
                <div style={{ marginTop: 4, fontSize: 11 }}>เมนูที่ไม่มีสิทธิ์เข้าจะไม่แสดง</div>
              </div>
            ) : searchHits.map(item => (
              <Link
                key={item.to} to={item.to} className="nav-link"
                style={location.pathname === item.to
                  ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }
                  : {}}
                onClick={() => { setNavQ(''); if (isMobile) onClose(); }}
              >
                <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)', flexShrink: 0, maxWidth: '42%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.group}</span>
              </Link>
            ))
          ) : (<>
            {/* ⭐ ใช้บ่อย — คนหน้างานวนอยู่ 3-5 หน้าเดิมทั้งวัน ยกขึ้นบนสุดไม่ต้องไล่หาในหมวด
                (แนวคิดเดียวกับปุ่ม ⭐ บน rail ของ desktop · ไม่มีสถิติ = ไม่โชว์บล็อกเปล่า) */}
            {starItems.length > 0 && (<>
              <div style={{ padding: '4px 9px 2px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.03em' }}>⭐ ใช้บ่อย</div>
              {starItems.slice(0, 5).map(item => (
                <Link
                  key={`star-${item.to}`} to={item.to} className="nav-link"
                  style={location.pathname === item.to
                    ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }
                    : {}}
                  onClick={onClose}
                >
                  <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                </Link>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0 2px' }} />
            </>)}

            {/* หมวด = accordion เปิดทีละหมวด · หมวดของหน้าปัจจุบันเปิดให้เอง (mOpenGroup undefined = follow) */}
            {groupedItems.map(({ group, items }) => {
              const open = (mOpenGroup === undefined ? activeGroup : mOpenGroup) === group;
              const groupHasActive = items.some(i => location.pathname === i.to);
              return (
                <div key={group} style={{ marginBottom: 2 }}>
                  {/* หัวหมวด — ปกติ = สี text (ขาวอมเขียว เป็นกลาง อ่านง่าย ไม่กลืนกับเขียว accent)
                      · หมวดที่มีหน้าปัจจุบัน = accent + พื้นจาง + ขีดซ้าย ให้รู้ทันทีว่าอยู่หมวดไหน */}
                  <button
                    onClick={() => setMOpenGroup(open ? null : group)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      background: groupHasActive ? 'var(--accent-dim)' : 'none',
                      border: 'none', borderLeft: `2px solid ${groupHasActive ? 'var(--accent)' : 'transparent'}`,
                      borderRadius: 'var(--radius)', cursor: 'pointer', padding: '10px 10px 10px 9px',
                      marginTop: 3,
                      color: groupHasActive ? 'var(--accent)' : 'var(--text)',
                      fontSize: 13, fontWeight: 800, letterSpacing: '0.01em',
                      fontFamily: 'var(--font-display)',
                    }}
                  >
                    <span style={{ fontSize: 15, flexShrink: 0 }}>{NAV_GROUP_META[group]?.icon || '📁'}</span>
                    <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', flexShrink: 0 }}>{items.length}</span>
                    <span style={{ fontSize: 12, opacity: 0.6, transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }}>▾</span>
                  </button>
                  {open && items.map((item, i) => (
                    <div key={item.to}>
                      {/* หัวข้อย่อย (`sub`) — เหมือนแผงบน desktop ให้ 2 โหมดเห็นโครงเดียวกัน */}
                      {item.sub && item.sub !== items[i - 1]?.sub && (
                        <div style={{
                          fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.04em',
                          padding: '9px 9px 3px', marginTop: i === 0 ? 0 : 5,
                          borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                        }}>{item.sub}</div>
                      )}
                      <Link
                        to={item.to}
                        className="nav-link"
                        style={location.pathname === item.to
                          ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }
                          : {}}
                        onClick={onClose}
                      >
                        <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                      </Link>
                    </div>
                  ))}
                </div>
              );
            })}
          </>)}

        </div>

        {/* Footer: User info + Theme toggle + Logout */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* User info card — คลิกเพื่อกาง/พับเมนูโปรไฟล์ด้านล่าง */}
          {userCard(true)}

          {footerOpen && profileActions(onClose)}
        </div>
      </nav>
      {modals}
    </>
  );
}

/* ─── เสียงแจ้งเตือน (Web Audio — ไม่ต้องมีไฟล์เสียง) ───────────
   เล่นตอนมี notification ใหม่เข้ามาแบบ realtime · เบราว์เซอร์บล็อกเสียงจนกว่าจะมี
   user gesture → prime AudioContext ตอนแตะจอ/คลิกครั้งแรก · ปิดเสียงได้ (localStorage) */
let _notifAudioCtx = null;
function primeNotifAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_notifAudioCtx) _notifAudioCtx = new AC();
    if (_notifAudioCtx.state === 'suspended') _notifAudioCtx.resume().catch(() => {});
  } catch { /* ไม่รองรับ — ข้าม */ }
}
function playNotifChime() {
  if (localStorage.getItem('esm-notif-sound') === 'off') return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_notifAudioCtx) _notifAudioCtx = new AC();
    const ctx = _notifAudioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // จังหวะ 2 โน้ต A5 → D6 (ding-dong เบาๆ)
    [{ f: 880, t: 0 }, { f: 1174.66, t: 0.12 }].forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const s = now + t;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.18, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(s);
      osc.stop(s + 0.4);
    });
  } catch { /* เสียงถูกบล็อก — เงียบ ไม่ให้พังหน้า */ }
}

/* ─── Notification Bell ─────────────────────────────────────── */
// map ที่มาของแจ้งเตือน → หน้าที่เปิดตอนกด — **ต้อง mirror กับ `routeFor()` ใน edge `send-push`**
// (Web Push กดแล้วเปิดหน้าไหน กระดิ่งในแอปต้องพาไปหน้าเดียวกัน — แก้ฝั่งไหนให้ตามไปแก้อีกฝั่งด้วย)
// feedback หน้างาน 2026-08-25: "เปิด MO แล้วอยากให้ช่างรับงานได้ทันที" — เดิมกดแจ้งเตือนแล้วแค่ mark อ่าน ไม่พาไปไหน
const NOTIF_ROUTE = {
  four_m_logs:   '/event-log',
  mtn_orders:    '/mtn-repair',
  downtime_logs: '/daily-report',
};

function NotificationBell({ userId, role }) {
  const [notifs, setNotifs]     = useState([]);
  const [open,   setOpen]       = useState(false);
  const [muted,  setMuted]      = useState(() => localStorage.getItem('esm-notif-sound') === 'off');
  const dropRef                 = useRef(null);
  const navigate                = useNavigate();

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, type, is_read, created_at, ref_table, ref_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    setNotifs(data || []);
  }, [userId]);

  // ปลายทางต้องผ่าน canAccessPage ก่อนเสมอ (กฎเดียวกับ telemetry บนหน้า Home) — ไม่มีสิทธิ์ = กดแล้วแค่ mark อ่าน ไม่พาไปแล้วโดนเด้ง
  const notifTarget = useCallback((n) => {
    const path = NOTIF_ROUTE[n?.ref_table];
    return path && canAccessPage(path, role) ? path : null;
  }, [role]);

  // เตรียม AudioContext ตอน gesture แรก (เบราว์เซอร์ต้องมี user interaction ก่อนเล่นเสียง)
  useEffect(() => {
    const prime = () => primeNotifAudio();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => { window.removeEventListener('pointerdown', prime); window.removeEventListener('keydown', prime); };
  }, []);

  useEffect(() => {
    load();
    if (!userId) return;
    const ch = liveChannel(supabase, `notif-${userId}`)
      // INSERT = มี notification ใหม่จริง (initial load ไม่เข้าตรงนี้) → รีโหลด + เล่นเสียง
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => { load(); playNotifChime(); })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [userId, load]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem('esm-notif-sound', next ? 'off' : 'on');
    if (!next) { primeNotifAudio(); playNotifChime(); } // เปิดเสียง = เล่นตัวอย่างให้ฟัง
  };

  // ── Web Push (เด้งเข้ามือถือแม้ปิดแอป) ──
  const [pushState, setPushState] = useState('default'); // default|subscribed|unsubscribed|denied|unsupported|ios-need-install
  const [pushBusy,  setPushBusy]  = useState(false);
  const refreshPush = useCallback(() => { getPushState().then(setPushState).catch(() => {}); }, []);
  useEffect(() => { refreshPush(); }, [refreshPush]);

  const enablePush = async () => {
    setPushBusy(true);
    try {
      const ok = await subscribePush(userId);
      if (!ok && Notification.permission === 'denied') toast.error('เบราว์เซอร์บล็อกการแจ้งเตือน — เปิดสิทธิ์ในตั้งค่าเบราว์เซอร์');
      else if (ok) toast.success('เปิดแจ้งเตือนเข้ามือถือแล้ว 📲');
    } catch (e) { toast.error(e.message || 'เปิดไม่สำเร็จ'); }
    finally { setPushBusy(false); refreshPush(); }
  };
  const disablePush = async () => {
    setPushBusy(true);
    await unsubscribePush();
    setPushBusy(false); refreshPush();
    toast.info('ปิดแจ้งเตือนเข้ามือถือแล้ว');
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    const unread = notifs.filter(n => !n.is_read).map(n => n.id);
    if (!unread.length) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', unread);
    setNotifs(n => n.map(x => ({ ...x, is_read: true })));
  };

  const markOne = async (id) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifs(n => n.map(x => x.id === id ? { ...x, is_read: true } : x));
  };

  const unread = notifs.filter(n => !n.is_read).length;

  // PWA: จำนวนที่ยังไม่อ่าน → badge จุดแดง/เลขบนไอคอนแอปที่ติดตั้ง (Android/desktop Chrome/Edge)
  // ⚠️ iOS ไม่รองรับ App Badging API (Apple ยังไม่ทำ) — guard ด้วย 'setAppBadge' in navigator · อัปเดตเฉพาะตอนเปิดแอป (ไม่มี SW/push)
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    (unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(() => {});
  }, [unread]);
  useEffect(() => () => { navigator.clearAppBadge?.().catch(() => {}); }, []); // ล้าง badge ตอน logout/unmount

  const typeColor = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#4d9fff' };

  return (
    <div ref={dropRef} style={{ position: 'fixed', top: 10, right: 14, zIndex: 1200 }}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) load(); }}
        style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'var(--bg3)', border: '1px solid var(--border2)',
          color: 'var(--text2)', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', position: 'relative', boxShadow: 'var(--shadow-sm)',
        }}
        title="แจ้งเตือน"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', color: '#fff',
            fontSize: 11, fontWeight: 800,
            minWidth: 18, height: 18, borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 42, right: 0,
          width: 'min(340px,92vw)',
          background: 'var(--card)',
          border: '1px solid var(--border2)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>🔔 แจ้งเตือน</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={toggleMute} title={muted ? 'เปิดเสียงแจ้งเตือน' : 'ปิดเสียงแจ้งเตือน'}
                style={{ fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, opacity: muted ? 0.5 : 1 }}>
                {muted ? '🔕' : '🔔'}
              </button>
              {unread > 0 && (
                <button onClick={markAllRead} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  อ่านทั้งหมด
                </button>
              )}
            </div>
          </div>

          {/* ── Web Push: เปิดแจ้งเตือนเข้ามือถือ (เด้งแม้ปิดแอป) ── */}
          {pushState !== 'unsupported' && (
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'var(--bg2)' }}>
              {pushState === 'subscribed' ? (
                <>
                  <span style={{ color: 'var(--accent)', fontWeight: 600 }}>📲 เปิดแจ้งเตือนเข้ามือถือแล้ว</span>
                  <button onClick={disablePush} disabled={pushBusy}
                    style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>ปิด</button>
                </>
              ) : pushState === 'denied' ? (
                <span style={{ color: 'var(--accent2)' }}>🔕 เบราว์เซอร์บล็อกการแจ้งเตือน — เปิดสิทธิ์ในตั้งค่าเบราว์เซอร์ก่อน</span>
              ) : pushState === 'ios-need-install' ? (
                <span style={{ color: 'var(--muted)' }}>📲 iPhone: กด “แชร์ → เพิ่มไปยังหน้าจอโฮม” แล้วเปิดจากไอคอนก่อน จึงเปิดแจ้งเตือนได้</span>
              ) : (
                <>
                  <span style={{ color: 'var(--text2)' }}>📲 เด้งแจ้งเตือนเข้ามือถือแม้ปิดแอป</span>
                  <button onClick={enablePush} disabled={pushBusy}
                    style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: '#071008', background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                    {pushBusy ? 'กำลังเปิด…' : 'เปิด'}
                  </button>
                </>
              )}
            </div>
          )}

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifs.length === 0 ? (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>ไม่มีแจ้งเตือน</div>
            ) : notifs.map(n => (
              <div
                key={n.id}
                onClick={() => {
                  markOne(n.id);
                  // แจ้งเตือนที่ผูกใบงาน (ref_table) → เปิดหน้าที่ทำงานจริงให้เลย เหมือนกด Web Push
                  const target = notifTarget(n);
                  if (target) { setOpen(false); navigate(target); }
                }}
                title={notifTarget(n) ? 'กดเพื่อเปิดหน้าที่เกี่ยวข้อง' : undefined}
                style={{
                  padding: '9px 14px', borderBottom: '1px solid var(--border)',
                  background: n.is_read ? 'transparent' : 'var(--accent-dim)',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                    background: n.is_read ? 'var(--border2)' : (typeColor[n.type] || '#4d9fff'),
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: n.is_read ? 400 : 700, color: 'var(--text)', lineHeight: 1.4 }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div>}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                      {fmtDateTime(n.created_at)}
                    </div>
                  </div>
                  {/* ลูกศรบอกว่ากดแล้วเปิดหน้าที่เกี่ยวข้องได้ — มือถือไม่มี hover ให้อ่าน title */}
                  {notifTarget(n) && <span style={{ flexShrink: 0, alignSelf: 'center', fontSize: 14, color: 'var(--muted)' }}>›</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Toggle Button — โผล่เฉพาะตอน sidebar พับอยู่ (ปุ่มพับอยู่ในหัว sidebar แล้ว) ─── */
function ToggleBtn({ isOpen, onClick }) {
  if (isOpen) return null;
  return (
    <button
      onClick={onClick}
      title="เปิดเมนู"
      style={{
        // เครื่องหมายเหมือนปุ่มมุมขวาบน (🔔/filter): 36×36 radius8 bg3 border2
        // top:10 คงที่ (ฝั่งซ้ายไม่มีช่องว่างสำรองแบบขวา — ถ้าเลื่อนลงจะทับ pool/board)
        position: 'fixed', top: 10, left: 14,
        zIndex: 1100,
        width: 36, height: 36, borderRadius: 8,
        background: 'var(--bg3)',
        border: '1px solid var(--border2)',
        color: 'var(--text2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, cursor: 'pointer', outline: 'none',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      ☰
    </button>
  );
}

/* ─── Auto-Logout ──────────────────────────────────────────────────── */
const IDLE_TIMEOUT_MS  = 30 * 60 * 1000; // 30 min idle → show warning
const WARN_DURATION_MS =  5 * 60 * 1000; // 5 min countdown before forced logout
// นับ idle ร่วมกันทุกแท็บของ browser เดียวกันผ่าน localStorage — แท็บที่เปิดทิ้งไว้ต้องไม่
// auto-logout ทั้งที่ user กำลังใช้งานอีกแท็บอยู่ (เคยเป็นสาเหตุหลักของ "เด้ง login บ่อย"
// เพราะ signOut จากแท็บ idle พาแท็บที่ใช้งานอยู่หลุดด้วย — session แชร์กันใน localStorage)
const ACTIVITY_LS_KEY = 'esm-last-activity';

// ── เพดานเวลา login ตามกะ (2026-07-15) ────────────────────────────────────────
// leader/หัวหน้าทำงานสลับกะ + ใช้เครื่องเช็คชื่อร่วมกัน → เดิม idle 30 นาทีไม่เตะ
// เพราะเครื่องถูกใช้ตลอด หัวหน้ากะก่อนเลยค้าง login ข้ามกะ คนกะใหม่มาเช็คผิด session
// กติกา: session ต้องไม่อยู่เกิน "สิ้นกะที่ตอน login + 60 นาที" (คำสั่ง user)
// ยกเว้น admin (ดูแลระบบ เครื่องตัวเอง) + display (จอลอย — ไม่ logout อยู่แล้ว)
const SESSION_START_KEY = 'esm-session-started';
const SHIFT_GRACE_MS = 60 * 60 * 1000; // เผื่อ 60 นาทีหลังสิ้นกะ (ทำงานคาบเกี่ยว/OT ต่อเนื่อง)

// คืน timestamp (ms) ที่ session ต้องหมดอายุ = สิ้นกะของเวลาที่ login + grace
// กะเช้า 08:00–19:59 → สิ้นกะ 20:00 · กะดึก 20:00–07:59 → สิ้นกะ 08:00 ของเช้าถัดไป
function shiftDeadlineFrom(loginTsMs) {
  const d = new Date(loginTsMs);
  const h = d.getHours();
  const y = d.getFullYear(), mo = d.getMonth(), day = d.getDate();
  let end;
  if (h >= 8 && h < 20) {
    end = new Date(y, mo, day, 20, 0, 0, 0);          // กะเช้า → 20:00 วันเดียวกัน
  } else if (h >= 20) {
    end = new Date(y, mo, day + 1, 8, 0, 0, 0);        // กะดึกช่วงหัวค่ำ → 08:00 วันถัดไป
  } else {
    end = new Date(y, mo, day, 8, 0, 0, 0);            // กะดึกช่วงเช้ามืด (< 08:00) → 08:00 วันเดียวกัน
  }
  return end.getTime() + SHIFT_GRACE_MS;
}

function useAutoLogout(isDisplay, onLogout, shiftCapped) {
  const [warnSecsLeft, setWarnSecsLeft] = useState(null); // null = not warning
  const lastActivityRef = useRef(Date.now());
  const warnActiveRef   = useRef(false);
  const countdownRef    = useRef(null);
  const onLogoutRef     = useRef(onLogout);
  useEffect(() => { onLogoutRef.current = onLogout; }, [onLogout]);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    warnActiveRef.current = false;
    setWarnSecsLeft(null);
  }, []);

  const dismissWarning = useCallback(() => {
    stopCountdown();
    lastActivityRef.current = Date.now();
    try { localStorage.setItem(ACTIVITY_LS_KEY, String(Date.now())); } catch { /* private mode */ }
  }, [stopCountdown]);

  useEffect(() => {
    if (isDisplay) return; // display users never get auto-logged out

    const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    let lastLsWrite = 0;
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      // แชร์เวลา activity ให้แท็บอื่น (เขียนถี่สุดทุก 5 วิ กัน write spam)
      if (Date.now() - lastLsWrite > 5000) {
        lastLsWrite = Date.now();
        try { localStorage.setItem(ACTIVITY_LS_KEY, String(Date.now())); } catch { /* private mode */ }
      }
      // กลับมาใช้งานระหว่าง countdown = ยังอยู่ — ปิดคำเตือนเอง ไม่ต้องบังคับกดปุ่ม
      // (เดิมขยับเมาส์/แตะจอไม่ช่วย ต้องกดปุ่มเท่านั้น เลยโดน logout ทั้งที่คนอยู่หน้าจอ)
      if (warnActiveRef.current) dismissWarning();
    };
    EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }));

    // แท็บอื่นมี activity → นับเป็น activity ของเราด้วย (storage event ยิงเฉพาะแท็บอื่น)
    const onStorage = (e) => {
      if (e.key !== ACTIVITY_LS_KEY) return;
      lastActivityRef.current = Date.now();
      if (warnActiveRef.current) dismissWarning();
    };
    window.addEventListener('storage', onStorage);

    // แท็บถูกทิ้งไว้ข้ามคืน (timer ถูก throttle) → เช็คเพดานกะทันทีที่กลับมา active
    const onVisible = () => { if (document.visibilityState === 'visible') checkShiftDeadline(); };
    document.addEventListener('visibilitychange', onVisible);

    // เพดานกะ: เตะออกทันทีเมื่อเลย "สิ้นกะที่ login + 60 นาที" (ไม่สนใจ idle — คนกำลังใช้ก็ต้องออก
    // เพื่อให้หัวหน้ากะใหม่ login ด้วยบัญชีตัวเอง) · เช็คทั้งใน poll และตอนแท็บกลับมา active
    const checkShiftDeadline = () => {
      if (!shiftCapped) return false;
      let startTs = 0;
      try { startTs = Number(localStorage.getItem(SESSION_START_KEY)) || 0; } catch { /* private mode */ }
      if (!startTs) {
        // ไม่มี timestamp (login ค้างมาก่อนมีฟีเจอร์นี้) → ตั้งจากตอนนี้ ให้ได้กรอบกะปัจจุบันไปก่อน
        startTs = Date.now();
        try { localStorage.setItem(SESSION_START_KEY, String(startTs)); } catch { /* private mode */ }
      }
      if (Date.now() > shiftDeadlineFrom(startTs)) { onLogoutRef.current(); return true; }
      return false;
    };

    // Poll every 30s to check idle time — เทียบกับ activity ล่าสุดของ "ทุกแท็บ" (max ของ local ref กับ localStorage)
    const pollId = setInterval(() => {
      if (checkShiftDeadline()) return; // เลยเพดานกะ = ออกแล้ว
      if (warnActiveRef.current) return; // already counting down
      let shared = 0;
      try { shared = Number(localStorage.getItem(ACTIVITY_LS_KEY)) || 0; } catch { /* ignore */ }
      const lastActivity = Math.max(lastActivityRef.current, shared);
      const idle = Date.now() - lastActivity;
      if (idle >= IDLE_TIMEOUT_MS) {
        // Start countdown
        warnActiveRef.current = true;
        let secsLeft = Math.round(WARN_DURATION_MS / 1000);
        setWarnSecsLeft(secsLeft);
        countdownRef.current = setInterval(() => {
          secsLeft -= 1;
          setWarnSecsLeft(secsLeft);
          if (secsLeft <= 0) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
            warnActiveRef.current = false;
            onLogoutRef.current();
          }
        }, 1000);
      }
    }, 30_000);

    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, onActivity));
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(pollId);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isDisplay, shiftCapped, dismissWarning]);

  return { warnSecsLeft, dismissWarning };
}

function AutoLogoutWarning({ secsLeft, onStay, onLogout }) {
  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2,'0')} นาที` : `${secs} วินาที`;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border2)',
        borderRadius: 16, padding: '32px 36px', maxWidth: 400, width: '90vw',
        boxShadow: 'var(--shadow-lg)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏱️</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          คุณไม่ได้ใช้งานระบบ
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.6 }}>
          ระบบจะออกจากระบบอัตโนมัติใน
          <span style={{ fontWeight: 800, color: '#ef4444', fontSize: 20, display: 'block', margin: '6px 0' }}>
            {timeStr}
          </span>
          เพื่อความปลอดภัยของข้อมูล
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={onStay} style={{
            padding: '10px 24px', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none',
          }}>
            ยังอยู่ที่นี่
          </button>
          <button onClick={onLogout} style={{
            padding: '10px 24px', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer',
            background: 'rgba(239,68,68,0.12)', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.35)',
          }}>
            ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Protected Layout ─────────────────────────────────────────────── */
// permsVersion ไม่ได้ใช้ในฟังก์ชันโดยตรง — รับไว้เพื่อให้ prop เปลี่ยนแล้ว layout ทั้งต้น re-render
// (RoleRoute/Sidebar อ่าน permission cache แบบ sync ผ่าน canAccessPage ระหว่าง render)
function ProtectedLayout({ session, theme, onToggleTheme, userRole, realRole, viewAs, onApplyViewAs, userLineId, userTeam, userSection, userSections, userMtnTeams, userIsDeptAdmin, userPosition, userEmail, userFullName, userNotifyEmail, userSignatureUrl, userAvatarUrl, onAvatarSaved, onSignatureSaved, permsVersion }) {
  const isMobile = useIsMobile();
  const isTV     = !useIsMobile(1919);   // จอ ≥1920 (TV) — reactive แทน innerWidth ครั้งเดียว
  const [isOpen, setIsOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 768);
  const navigate = useNavigate();
  const location = useLocation();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 768) setIsOpen(false);
      else setIsOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleLogout = async () => {
    // scope 'local' = ออกเฉพาะ browser นี้ (ทุกแท็บของเครื่องนี้ผ่าน localStorage event)
    // ห้ามใช้ default (global) — global จะ revoke refresh token ของ user นี้ "ทุกเครื่อง"
    // → account ที่ใช้ร่วมกันหลายจุดในโรงงานโดนเด้ง login พร้อมกันทั้งหมดทุกครั้งที่
    // เครื่องใดเครื่องหนึ่ง logout/auto-logout (สาเหตุหลักของ "เด้ง login บ่อย" 2026-07-14)
    setDrActorName(null);
    setDeptAdmin(false);
    await supabase.auth.signOut({ scope: 'local' });
    navigate('/login');
  };

  const isDisplay = userRole === 'display';
  // เพดานกะ (สิ้นกะ+60นาที เตะออก) ใช้กับ role หน้างานที่ทำงานสลับกะ + ใช้เครื่องเช็คชื่อร่วมกัน
  // = หัวหน้าไลน์ (leader) + หัวหน้าส่วน (supervisor) · admin/manager/office ทำงานเครื่องตัวเอง
  // ไม่ต้องโดนเตะรายกะ (มี idle-logout 30 นาทีคุมอยู่แล้ว) · แก้ขอบเขตที่ list นี้จุดเดียว
  // ⚠️ เพดานกะตัดสินจาก "role จริง" — admin ที่จำลองมุมมอง leader ต้องไม่โดนเตะออกท้ายกะ
  const shiftCapped = !viewAs && ['leader', 'supervisor'].includes(userRole);
  const { warnSecsLeft, dismissWarning } = useAutoLogout(isDisplay, handleLogout, shiftCapped);

  // 🎭 โหมดจำลองมุมมอง role — modal เลือก role (admin จริงเท่านั้น) + ป้ายลอยบอกว่าอยู่ในโหมด
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const viewAsBanner = viewAs ? (
    <div style={{
      position: 'fixed', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 999,
      background: 'rgba(147,51,234,0.16)', border: '1.5px solid #a855f7', color: '#c084fc',
      fontSize: 12.5, fontWeight: 700, backdropFilter: 'blur(6px)', boxShadow: '0 4px 18px rgba(0,0,0,0.4)',
      maxWidth: '92vw', flexWrap: 'wrap', justifyContent: 'center',
    }}>
      <span>🎭 กำลังดูในมุมมอง: {roleLabel(viewAs.role)}{viewAs.deptAdmin ? ' + 🛡️ แอดมินหน่วยงาน' : ''}{viewAs.mtnTeams?.length ? ` + 🔧 ${viewAs.mtnTeams.length} ทีมช่าง` : ''}</span>
      <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>การบันทึกยังเป็นสิทธิ์จริงของ admin</span>
      <button onClick={() => onApplyViewAs(null)}
        style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: '#a855f7', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}>
        ✕ ออกจากโหมด
      </button>
    </div>
  ) : null;
  const viewAsModal = (realRole === 'admin' && viewAsOpen) ? (
    <Suspense fallback={null}>
      <ViewAsModal current={viewAs} onClose={() => setViewAsOpen(false)} onApply={onApplyViewAs} />
    </Suspense>
  ) : null;

  // 🔎 ค้นหาเมนู (Ctrl/⌘+K) — เมนู 51 รายการ 8 หมวด หาไม่เจอถ้าไม่มีทางลัด (NAVIGATION-REVIEW §2.5)
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPaletteOpen(v => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // จำหน้าที่เข้าบ่อยไว้ในเครื่อง (ยกขึ้นบนสุดใน palette) — จุดเดียวของทั้งแอป
  useEffect(() => { trackVisit(location.pathname); }, [location.pathname]);

  // 📌 ปักหมุดแผงหมวดของ rail (desktop) — pinned = แผงค้าง + เนื้อหาแคบลง (opt-in เท่านั้น)
  // state อยู่ที่ layout เพราะ marginLeft ของ <main> ต้องรู้ด้วย
  const [railPinned, setRailPinned] = useState(() => { try { return localStorage.getItem('esm_rail_pin') === '1'; } catch { return false; } });
  const toggleRailPin = useCallback(() => {
    setRailPinned(v => { try { localStorage.setItem('esm_rail_pin', v ? '0' : '1'); } catch { /* private mode */ } return !v; });
  }, []);

  // 📺 โหมดจอตาม (รับรีโมทจากมือถือ) — จำรหัสไว้ข้ามการรีเฟรช เปิด/ปิดจากปุ่มใน sidebar
  const [remoteCode, setRemoteCode] = useState(() => localStorage.getItem('esm-remote-receiver') || null);
  const onToggleRemote = useCallback(() => {
    setRemoteCode(c => {
      if (c) { localStorage.removeItem('esm-remote-receiver'); return null; }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      localStorage.setItem('esm-remote-receiver', code);
      return code;
    });
  }, []);

  // ⚠️ guard นี้ต้องอยู่ "หลัง" hooks ทุกตัว (useAutoLogout/useState/useCallback ด้านบน) —
  // ถ้าวางก่อน hooks จะเกิด React #310 (hook count เปลี่ยนตอน session null→มีค่า) จอ error
  if (!session) return <Navigate to="/login" replace />;

  // sidebar แบบ D (2026-08-18): desktop เนื้อหาเสียแค่ rail 64px — แผงหมวดลอยทับ ไม่ดันเนื้อหา
  // ยกเว้นปักหมุด 📌 (opt-in) = rail + แผง (var(--rail-w) + var(--sidebar-w))
  const marginLeft = (!isMobile && isOpen)
    ? (railPinned ? 'calc(var(--rail-w) + var(--sidebar-w))' : 'var(--rail-w)')
    : 0;
  const role       = userRole; // ไม่ fallback เป็น 'admin' อีกต่อไป — profileLoaded gate ด้านบนรับประกันว่า role ถูก resolve แล้วก่อนถึงจุดนี้

  /* 📺 จอ TV (`/tv`) — แสดงเต็มจอ ไม่มี sidebar / rail / กระดิ่ง / RemoteReceiver / CommandPalette
     จอนี้ "แขวนไว้อย่างเดียว" ไม่มีคนกด → chrome ทุกชิ้นคือ DOM ที่เปลืองเปล่าบนเบราว์เซอร์สมาร์ททีวี
     และพื้นที่แนวตั้งที่ผังต้องการ (บทเรียน 2026-08-26) · ยังผ่าน canAccessPage ตามปกติ */
  if (location.pathname === '/tv') {
    if (!canAccessPage('/tv', role)) return <Navigate to="/" replace />;
    return (
      <UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection, sections: userSections || [], mtnTeams: userMtnTeams || [], position: userPosition, notifyEmail: userNotifyEmail, signatureUrl: userSignatureUrl, avatarUrl: userAvatarUrl, fullName: userFullName, isDeptAdmin: userIsDeptAdmin, realRole: realRole ?? role }}>
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--muted)', fontSize: 14, background: 'var(--bg)' }}>กำลังโหลด...</div>}>
          <TvBoard />
        </Suspense>
        {viewAsBanner}
        {viewAsModal}
      </UserContext.Provider>
    );
  }

  // หน้า Hub (เลือกส่วนงาน) — แสดงเต็มจอ ไม่มี sidebar / toggle / bell
  if (location.pathname === '/') {
    return (
      <UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection, sections: userSections || [], mtnTeams: userMtnTeams || [], position: userPosition, notifyEmail: userNotifyEmail, signatureUrl: userSignatureUrl, avatarUrl: userAvatarUrl, fullName: userFullName, isDeptAdmin: userIsDeptAdmin, realRole: realRole ?? role }}>
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--muted)', fontSize: 14, background: 'var(--bg)' }}>กำลังโหลด...</div>}>
          <DeptHub onLogout={handleLogout} theme={theme} onToggleTheme={onToggleTheme} userFullName={userFullName} userRole={role} userPosition={userPosition}
            userEmail={userEmail} userAvatarUrl={userAvatarUrl} onAvatarSaved={onAvatarSaved}
            userSignatureUrl={userSignatureUrl} onSignatureSaved={onSignatureSaved}
            realRole={realRole} onOpenViewAs={realRole === 'admin' ? () => setViewAsOpen(true) : undefined}
            remoteCode={remoteCode} onToggleRemote={onToggleRemote}
            onOpenSearch={() => setPaletteOpen(true)} permsVersion={permsVersion} />
        </Suspense>
        {/* 🔎 ค้นหาเมนู — หน้า Home ต้องมีเหมือนหน้าอื่น (Ctrl+K ที่ผูกไว้ด้านบนทำงานทุกหน้าอยู่แล้ว
            แต่เดิม mount palette เฉพาะ branch ล่าง → กด Ctrl+K ที่หน้า Home แล้วไม่มีอะไรขึ้น) */}
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={role} />
        </Suspense>
        {/* 📺 จอตามต้องรับรีโมทได้แม้ค้างอยู่หน้า Hub (เดิม mount เฉพาะหน้าอื่น — จอ TV ที่เปิดหน้านี้ทิ้งไว้สั่งไม่ได้) */}
        {remoteCode && (
          <Suspense fallback={null}>
            <RemoteReceiver code={remoteCode} onStop={onToggleRemote} />
          </Suspense>
        )}
        {viewAsBanner}
        {viewAsModal}
      </UserContext.Provider>
    );
  }

  return (
    <UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection, sections: userSections || [], mtnTeams: userMtnTeams || [], position: userPosition, notifyEmail: userNotifyEmail, signatureUrl: userSignatureUrl, avatarUrl: userAvatarUrl, fullName: userFullName, isDeptAdmin: userIsDeptAdmin, realRole: realRole ?? role, sidebarOpen: isOpen }}>
      {warnSecsLeft !== null && (
        <AutoLogoutWarning secsLeft={warnSecsLeft} onStay={dismissWarning} onLogout={handleLogout} />
      )}
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <ToggleBtn isOpen={isOpen} onClick={() => setIsOpen(true)} />
        <NotificationBell userId={userId} role={role} />
        {/* บอกว่า "ยังเลื่อนลงได้อีก" — มือถือไม่มี scrollbar ให้เห็น (ครอบทั้งหน้าเพจและ modal) */}
        <ScrollHint />
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={role} />
        </Suspense>
        {/* 📺 จอตาม: รับคำสั่งรีโมท (pointer/คลิก/เลื่อน/เปลี่ยนหน้า) — ทำงานได้ทุกหน้า */}
        {remoteCode && (
          <Suspense fallback={null}>
            <RemoteReceiver code={remoteCode} onStop={onToggleRemote} />
          </Suspense>
        )}
        <Sidebar
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={onToggleTheme}
          userRole={role}
          userLineId={userLineId}
          userPosition={userPosition}
          userEmail={userEmail}
          userFullName={userFullName}
          userSignatureUrl={userSignatureUrl}
          userAvatarUrl={userAvatarUrl}
          remoteCode={remoteCode}
          onToggleRemote={onToggleRemote}
          onOpenPalette={() => setPaletteOpen(true)}
          pinned={railPinned}
          onTogglePin={toggleRailPin}
          realRole={realRole}
          onOpenViewAs={realRole === 'admin' ? () => setViewAsOpen(true) : undefined}
          onAvatarSaved={onAvatarSaved}
        />
        {viewAsBanner}
        {viewAsModal}

        <main style={{
          flex: 1,
          marginLeft,
          minHeight: '100vh',
          paddingTop: 14,
          background: 'var(--bg)',
          transition: 'margin-left 0.3s cubic-bezier(0.4,0,0.2,1)',
          // ⚠️ เลื่อนได้แค่ขึ้น-ลง — ห้ามเลื่อนซ้ายขวาทั้งหน้า (คำสั่ง user 2026-08-04)
          //   ของกว้าง (ตาราง/บอร์ด/กราฟ) ต้องมี scroller ของตัวเอง (overflowX:'auto' ที่กล่องมันเอง)
          //   ตาม UI-CONVENTIONS — ห้ามปล่อยให้ล้นออกมาดันทั้งหน้าให้เลื่อนข้าง
          overflowY: 'auto',
          overflowX: 'hidden',
          minWidth: 0,
        }}>
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลด...</div>}>
            <Routes>
              <Route path="/dashboard"  element={
                <RoleRoute path="/dashboard" userRole={role}><Dashboard /></RoleRoute>
              } />
              <Route path="/factory-map" element={
                <RoleRoute path="/factory-map" userRole={role}><FactoryMap /></RoleRoute>
              } />
              <Route path="/line-oee" element={
                <RoleRoute path="/line-oee" userRole={role}><LineOeeBoard /></RoleRoute>
              } />
              <Route path="/dept-dashboard" element={
                <RoleRoute path="/dept-dashboard" userRole={role}><DeptDashboard /></RoleRoute>
              } />
              <Route path="/flow-tower" element={
                <RoleRoute path="/flow-tower" userRole={role}><FlowTower /></RoleRoute>
              } />
              <Route path="/adoption-outlook" element={
                <RoleRoute path="/adoption-outlook" userRole={role}><AdoptionOutlook /></RoleRoute>
              } />
              <Route path="/group-overview" element={
                <RoleRoute path="/group-overview" userRole={role}><GroupOverview /></RoleRoute>
              } />
              <Route path="/management" element={
                <RoleRoute path="/management" userRole={role}><Management /></RoleRoute>
              } />
              <Route path="/checkin"    element={
                <RoleRoute path="/checkin" userRole={role}><Checkin /></RoleRoute>
              } />
              <Route path="/report"     element={
                <RoleRoute path="/report" userRole={role}><Report /></RoleRoute>
              } />
              <Route path="/skills-report" element={
                <RoleRoute path="/skills-report" userRole={role}><Report mode="skills" /></RoleRoute>
              } />
              <Route path="/register"   element={
                <RoleRoute path="/register" userRole={role}><Register /></RoleRoute>
              } />
              <Route path="/operator"   element={
                <RoleRoute path="/operator" userRole={role}><Operator /></RoleRoute>
              } />
              <Route path="/layout-setup" element={
                <RoleRoute path="/layout-setup" userRole={role}><LayoutSetup /></RoleRoute>
              } />
              <Route path="/linesetup"  element={
                <RoleRoute path="/linesetup" userRole={role}><LineSetup /></RoleRoute>
              } />
              <Route path="/process-setup" element={
                <RoleRoute path="/process-setup" userRole={role}><ProcessSetup /></RoleRoute>
              } />
              <Route path="/qr-labels" element={
                <RoleRoute path="/qr-labels" userRole={role}><QrLabels /></RoleRoute>
              } />
              <Route path="/machine-database" element={
                <RoleRoute path="/machine-database" userRole={role}><MachineDatabase /></RoleRoute>
              } />
              <Route path="/die-registry" element={
                <RoleRoute path="/die-registry" userRole={role}><DieRegistry /></RoleRoute>
              } />
              <Route path="/add-user"   element={
                <RoleRoute path="/add-user" userRole={role}><AddUser /></RoleRoute>
              } />
              <Route path="/org-setup"  element={
                <RoleRoute path="/org-setup" userRole={role}><OrgSetup /></RoleRoute>
              } />
              <Route path="/shift-organize" element={
                <RoleRoute path="/shift-organize" userRole={role}><ShiftOrganize /></RoleRoute>
              } />
              <Route path="/permissions" element={
                <RoleRoute path="/permissions" userRole={role}><PermissionsManagement /></RoleRoute>
              } />
              <Route path="/audit-log" element={
                <RoleRoute path="/audit-log" userRole={role}><AuditLog /></RoleRoute>
              } />
              <Route path="/notification-config" element={
                <RoleRoute path="/notification-config" userRole={role}><NotificationConfig /></RoleRoute>
              } />
              <Route path="/daily-report"  element={
                <RoleRoute path="/daily-report" userRole={role}><DailyReport /></RoleRoute>
              } />
              <Route path="/oee-analytics" element={
                <RoleRoute path="/oee-analytics" userRole={role}><OEEAnalytics /></RoleRoute>
              } />
              <Route path="/order-trace" element={
                <RoleRoute path="/order-trace" userRole={role}><OrderTrace /></RoleRoute>
              } />
              <Route path="/product-history" element={
                <RoleRoute path="/product-history" userRole={role}><ProductHistory /></RoleRoute>
              } />
              <Route path="/vsm" element={
                <RoleRoute path="/vsm" userRole={role}><VSM /></RoleRoute>
              } />
              <Route path="/daily-checker" element={
                <RoleRoute path="/daily-checker" userRole={role}><DailyChecker /></RoleRoute>
              } />
              {/* ⤵ route เก่าที่ยุบเข้าแท็บ Daily Checker แล้ว → redirect (ลิงก์/bookmark เก่ายังใช้ได้
                  และทุกคนเห็นภาพเดียวกัน ไม่ใช่หน้าเดี่ยวที่ไม่มีแท็บพี่น้อง — ดู NAVIGATION-REVIEW §2.4)
                  สิทธิ์เข้า /daily-checker piggyback บน page:/daily-pm‖/pokayoke‖/lpa อยู่แล้ว (permissions.js) */}
              <Route path="/pokayoke" element={<Navigate to="/daily-checker?tab=pokayoke" replace />} />
              <Route path="/daily-pm" element={<Navigate to="/daily-checker?tab=pm" replace />} />
              <Route path="/bbs" element={<Navigate to="/daily-checker?tab=bbs" replace />} />
              <Route path="/improvements" element={
                <RoleRoute path="/improvements" userRole={role}><Improvements /></RoleRoute>
              } />
              <Route path="/ojt-training" element={
                <RoleRoute path="/ojt-training" userRole={role}><OjtTraining /></RoleRoute>
              } />
              <Route path="/lpa" element={<Navigate to="/daily-checker?tab=lpa" replace />} />
              <Route path="/doc-forms" element={
                <RoleRoute path="/doc-forms" userRole={role}><DocFormsRegistry /></RoleRoute>
              } />
              <Route path="/morning-meeting" element={
                <RoleRoute path="/morning-meeting" userRole={role}><MorningMeeting /></RoleRoute>
              } />
              <Route path="/remote" element={
                <RoleRoute path="/remote" userRole={role}><RemoteControl /></RoleRoute>
              } />
              <Route path="/production-plan" element={
                <RoleRoute path="/production-plan" userRole={role}><ProductionPlan /></RoleRoute>
              } />
              <Route path="/event-log" element={
                <RoleRoute path="/event-log" userRole={role}><EventLog /></RoleRoute>
              } />
              <Route path="/qa" element={
                <RoleRoute path="/qa" userRole={role}><QualityControl /></RoleRoute>
              } />
              <Route path="/scrap-report" element={
                <RoleRoute path="/scrap-report" userRole={role}><ScrapReport /></RoleRoute>
              } />
              <Route path="/qa-setup" element={
                <RoleRoute path="/qa-setup" userRole={role}><QAInspectionSetup /></RoleRoute>
              } />
              <Route path="/pe-docs" element={
                <RoleRoute path="/pe-docs" userRole={role}><PEDocs /></RoleRoute>
              } />
              <Route path="/products"   element={
                <RoleRoute path="/products" userRole={role}><ProductMaster /></RoleRoute>
              } />
              <Route path="/line-stock" element={
                <RoleRoute path="/line-stock" userRole={role}><LineStock /></RoleRoute>
              } />
              <Route path="/heijunka"  element={
                <RoleRoute path="/heijunka" userRole={role}><HeijunkaKanban /></RoleRoute>
              } />
              <Route path="/customer-demand" element={
                <RoleRoute path="/customer-demand" userRole={role}><CustomerDemand /></RoleRoute>
              } />
              <Route path="/planner-sales" element={
                <RoleRoute path="/planner-sales" userRole={role}><PlannerSales /></RoleRoute>
              } />
              <Route path="/rundown-stock" element={
                <RoleRoute path="/rundown-stock" userRole={role}><RundownStock /></RoleRoute>
              } />
              <Route path="/store-monitor" element={
                <RoleRoute path="/store-monitor" userRole={role}><StoreMonitor /></RoleRoute>
              } />
              <Route path="/transport" element={
                <RoleRoute path="/transport" userRole={role}><Transport /></RoleRoute>
              } />
              <Route path="/rack-center" element={
                <RoleRoute path="/rack-center" userRole={role}><RackCenter /></RoleRoute>
              } />
              <Route path="/company-calendar" element={
                <RoleRoute path="/company-calendar" userRole={role}><CompanyCalendar /></RoleRoute>
              } />
              {/* 🔧 ศูนย์ PM — 5 หน้างานซ่อมบำรุงตามแผนเป็นแท็บในหน้าเดียว (2026-08-26 · feedback หน้างาน)
                  สิทธิ์ piggyback บน page:/pm-check‖/pm-schedule‖/pm-forecast‖/pm-coordination‖/pm-setup
                  (permissions.js) — ไม่ต้อง seed page:/pm · แท็บโผล่ตามสิทธิ์ย่อยของแต่ละหน้า */}
              <Route path="/pm" element={
                <RoleRoute path="/pm" userRole={role}><PmHub /></RoleRoute>
              } />
              {/* ⤵ route เก่าที่ยุบเข้าแท็บแล้ว → redirect (ลิงก์/bookmark เก่ายังใช้ได้ · ห้าม render ซ้ำ 2 ทาง) */}
              <Route path="/pm-check"        element={<Navigate to="/pm?tab=check" replace />} />
              <Route path="/pm-schedule"     element={<Navigate to="/pm?tab=plan" replace />} />
              <Route path="/pm-forecast"     element={<Navigate to="/pm?tab=forecast" replace />} />
              <Route path="/pm-coordination" element={<Navigate to="/pm?tab=coord" replace />} />
              <Route path="/pm-setup"        element={<Navigate to="/pm?tab=setup" replace />} />
              <Route path="/energy" element={
                <RoleRoute path="/energy" userRole={role}><Energy /></RoleRoute>
              } />
              <Route path="/mtn-layout" element={
                <RoleRoute path="/mtn-layout" userRole={role}><MtnMachineLayout /></RoleRoute>
              } />
              <Route path="/mtn-repair" element={
                <RoleRoute path="/mtn-repair" userRole={role}><MtnRepair /></RoleRoute>
              } />
            </Routes>
          </Suspense>
        </main>
      </div>
    </UserContext.Provider>
  );
}

/* ─── App Root ─────────────────────────────────────────────────────────── */
export default function App() {
  const [session,      setSession]      = useState(undefined);
  const [userRole,     setUserRole]     = useState(null);
  const [userLineId,   setUserLineId]   = useState(null);
  const [userTeam,     setUserTeam]     = useState(null);
  const [userSection,  setUserSection]  = useState(null);
  const [userPosition, setUserPosition] = useState(null); // ตำแหน่งงานจริง (แสดงผลเท่านั้น ไม่เกี่ยวกับสิทธิ์)
  // ขอบเขตหลายส่วนงาน (จาก profiles.sections + fallback section เดี่ยวของ supervisor) — [] = ไม่จำกัด
  const [userSections, setUserSections] = useState([]);
  const [userEmail,        setUserEmail]        = useState(null);
  const [userFullName,     setUserFullName]     = useState(null);
  const [userNotifyEmail,  setUserNotifyEmail]  = useState(null);
  const [userSignatureUrl, setUserSignatureUrl] = useState(null);
  const [userAvatarUrl,    setUserAvatarUrl]    = useState(null); // รูปโปรไฟล์ user (profiles.avatar_url — 2026-07-14)
  const [userMtnTeams,     setUserMtnTeams]     = useState([]);   // ทีมช่างซ่อมที่ user สังกัด (profiles.mtn_teams — 2026-07-22) แยกคิว MO
  const [userIsDeptAdmin,  setUserIsDeptAdmin]  = useState(false); // แอดมินหน่วยงาน (profiles.is_dept_admin — 2026-08-03) ซ้อนบน role เดิม
  const [showSplash,   setShowSplash]   = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('4m-theme') || 'dark');
  // ต้อง resolve ทั้ง profile (role จริง) และ permissions ก่อนค่อย render route tree —
  // ป้องกัน fail-open: ห้าม fallback เป็น 'admin' ระหว่างรอโหลด (เคยเป็นช่องโหว่)
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [permsLoaded,   setPermsLoaded]   = useState(false);
  // bump เมื่อ role_permissions เปลี่ยน (realtime) เพื่อให้ sidebar/route ที่อ่าน cache แบบ sync re-render
  const [permsVersion,  setPermsVersion]  = useState(0);

  /* ── 🎭 โหมดจำลองมุมมอง role (admin เท่านั้น · 2026-08-19) ──────────────────────
     admin สลับดูระบบเป็น role อื่นเพื่อตรวจว่า "user เห็นเมนู/ปุ่ม/ข้อมูลอะไรบ้าง"
     - เก็บใน sessionStorage = ต่อแท็บ (เปิดแท็บใหม่ = ยังเป็น admin ปกติ · refresh คงโหมดไว้)
     - จำลองเฉพาะฝั่งจอ (UI gating + scope) — RLS ฝั่ง DB ยังเป็น admin จริง การบันทึกใช้สิทธิ์จริงเสมอ
     - honored เฉพาะเมื่อ role จริง = admin (แก้ sessionStorage มือจาก role อื่น = เมิน — จำลองได้แต่ "ลดสิทธิ์"
       อยู่แล้ว แต่กันความสับสน) */
  const [viewAs] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('esm-view-as') || 'null'); } catch { return null; }
  });
  const impersonating = userRole === 'admin' && !!viewAs?.role;
  const applyViewAs = (cfg) => {
    try {
      if (cfg) sessionStorage.setItem('esm-view-as', JSON.stringify(cfg));
      else sessionStorage.removeItem('esm-view-as');
    } catch { /* private mode */ }
    // full reload ไปหน้าหลัก — ล้าง state ของหน้าที่ mount ค้าง (data ถูก query ด้วย scope ของ role เดิม)
    window.location.assign('/');
  };
  // bucket dept_admin ของ hasPermission เป็น module-flag — ต้องตามโหมดจำลองด้วย
  useEffect(() => {
    if (!profileLoaded) return;
    setDeptAdmin(impersonating ? !!viewAs?.deptAdmin : userIsDeptAdmin);
  }, [profileLoaded, impersonating, viewAs, userIsDeptAdmin]);
  // ค่า effective ที่ส่งเข้า layout ทั้งต้น (จำลอง = ทับด้วยค่าที่เลือกในโหมด)
  const effRole     = impersonating ? viewAs.role : userRole;
  const effLineId   = impersonating ? (viewAs.lineId ?? null) : userLineId;
  const effTeam     = impersonating ? (viewAs.team ?? null) : userTeam;
  const effSection  = impersonating ? ((viewAs.sections || [])[0] ?? null) : userSection;
  const effSections = impersonating
    ? effectiveSections(viewAs.role, viewAs.sections || [], (viewAs.sections || [])[0] ?? null)
    : userSections;
  const effMtnTeams = impersonating ? (Array.isArray(viewAs.mtnTeams) ? viewAs.mtnTeams : []) : userMtnTeams;
  const effDeptAdmin = impersonating ? !!viewAs.deptAdmin : userIsDeptAdmin;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('4m-theme', theme);
  }, [theme]);

  // โหมดเบาสำหรับจอ TV/บอร์ด (role display) — ปิด animation box-shadow ที่หนักบน GPU จอ (ดู index.css [data-perf="lite"])
  // จอ display คือบัญชีที่รันบนจอลอย GPU อ่อน · role อื่นบน PC ปกติไม่ต้องล็อกโหมดเบา
  useEffect(() => {
    if (userRole === 'display') document.documentElement.setAttribute('data-perf', 'lite');
    else document.documentElement.removeAttribute('data-perf');
  }, [userRole]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const fetchProfile = async (user) => {
    setUserEmail(user.email ?? null);
    const COLS = 'role, line_id, full_name, team, section, sections, position, notify_email, signature_url, is_dept_admin';
    let { data, error } = await supabase.from('profiles').select(COLS + ', employee_id').eq('id', user.id).single();
    // คอลัมน์ employee_id ยังไม่ apply (42703) → ถอยไป select ชุดเดิม ห้ามให้ login พังทั้งระบบ
    if (error?.code === '42703') ({ data, error } = await supabase.from('profiles').select(COLS).eq('id', user.id).single());
    // fail-visible: โหลดโปรไฟล์ไม่ได้ = แอปใช้งานไม่ได้อยู่ดี (role null → เมนูหาย, query ฝั่ง Main
    // ล้มหมด กลายเป็น "หน้าผี") — ห้ามปล่อย render ต่อแบบไม่มี role
    if (error || !data) {
      const authBroken = !data && !error                       // query ผ่านแต่ไม่มีแถว = user ถูกลบ
        || error?.code === 'PGRST116'                          // 0 rows
        || error?.status === 401 || error?.status === 403
        || /jwt|token|expired/i.test(error?.message || '');
      if (authBroken) {
        // token เสีย/user ถูกลบ → เคลียร์ session ฝั่ง client ให้เด้งไปหน้า login
        try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* token เสียอยู่แล้ว */ }
      }
      // error อื่น (เช่น network สะดุด) → ค้างที่ "กำลังโหลด..." ให้ผู้ใช้ F5 — ไม่ signOut
      // เพราะ localStorage แชร์ข้ามแท็บ เดี๋ยวพาแท็บอื่นที่ดีๆ อยู่หลุดไปด้วย
      return;
    }
    // ── ตัวตน (ทีม/ไลน์/ส่วนงาน) = **ฐานพนักงาน** เมื่อบัญชีผูกกับพนักงานแล้ว ────────────
    //   เดิมอ่านจาก profiles ล้วน ซึ่ง admin กรอกเองตอนสร้าง user → ไม่ตรงกับที่หัวหน้าแผนกตั้งไว้
    //   เคสจริง: หัวหน้า 2 คนทีมสลับกัน → Checkin กรองด้วย team ของบัญชี = มองไม่เห็นกะตัวเอง
    //
    // ⚠️ fallback รายฟิลด์ (`??`) จำเป็นระหว่างเปลี่ยนผ่าน **ห้ามถอดจนกว่าจะผูกครบทุกบัญชี**
    //   ยังไม่ผูก / ฐานพนักงานเว้นช่องนั้นว่าง → ใช้ค่าเดิมในบัญชี
    //   ถ้าถอดตอนนี้: leader 11 คนเสีย line_id+team ทันที = เปิดหน้าเช็คชื่อไม่เห็นใครเลย
    //   (วัดแล้ว 2026-08-21 — ดูกฎ "ตัวตนของคนอยู่ที่ employees" ใน CLAUDE.md)
    //
    // ⚠️ `sections[]` **ไม่ย้าย** — เป็น "ขอบเขตที่ admin ให้" ไม่ใช่ตัวตน และ employees ไม่มีของเทียบเท่า
    let ident = { team: data?.team ?? null, line_id: data?.line_id ?? null, section: data?.section ?? null };
    if (data?.employee_id) {
      const { data: emp } = await supabase.from('employees')
        .select('team, line_id, section').eq('id', data.employee_id).maybeSingle();
      if (emp) ident = {
        team:    emp.team    ?? ident.team,
        line_id: emp.line_id ?? ident.line_id,
        section: emp.section ?? ident.section,
      };
    }

    setUserRole(data?.role ?? null);
    setUserLineId(ident.line_id);
    setUserFullName(data?.full_name ?? null);
    setDrActorName(data?.full_name ?? null); // traceability: ฝั่ง DR anon ต้อง stamp ชื่อผู้แก้เอง (ดู supabaseClient.js)
    setUserTeam(ident.team);
    setUserSection(ident.section);
    setUserPosition(data?.position ?? null);
    loadPositions();   // master ตำแหน่งงาน — ให้ positionLabel() ใช้ได้ทั้งแอป
    setUserSections(effectiveSections(data?.role, data?.sections, ident.section));
    setUserNotifyEmail(data?.notify_email ?? null);
    setUserSignatureUrl(data?.signature_url ?? null);
    // mtn_teams แยก query best-effort — คอลัมน์เพิ่งเพิ่ม (migration 20260722) ถ้ายังไม่ apply ห้ามทำ login พัง
    supabase.from('profiles').select('mtn_teams').eq('id', user.id).maybeSingle()
      .then(({ data: mt }) => setUserMtnTeams(Array.isArray(mt?.mtn_teams) ? mt.mtn_teams : []))
      .catch(() => setUserMtnTeams([]));
    // avatar_url แยก query best-effort — คอลัมน์เพิ่งเพิ่ม (migration 20260714) ถ้ายังไม่ apply ห้ามทำ login พัง
    supabase.from('profiles').select('avatar_url').eq('id', user.id).maybeSingle()
      .then(({ data: av }) => setUserAvatarUrl(av?.avatar_url ?? null))
      .catch(() => setUserAvatarUrl(null));
    // is_dept_admin อยู่ใน select หลักแล้ว (migration 20260803 apply แล้ว — ยืนยันคอลัมน์มีจริงใน prod)
    // ตั้ง sync ก่อน render แรก — เดิมแยก query async แล้วมี race: หน้า render ก่อน flag มา ปุ่มแก้ไขไม่โผล่
    {
      const v = data?.is_dept_admin === true;
      setUserIsDeptAdmin(v); setDeptAdmin(v);
    }
    setProfileLoaded(true);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user);
        loadPermissions().then(() => setPermsLoaded(true));
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s);
      // stamp เวลา login จริง (เฉพาะตอน SIGNED_IN — refresh/INITIAL_SESSION ไม่ยิง event นี้)
      // ใช้คิดเพดานกะใน useAutoLogout · เก็บใน localStorage แชร์ทุกแท็บ + คงข้ามการรีเฟรช
      if (evt === 'SIGNED_IN') {
        try { localStorage.setItem(SESSION_START_KEY, String(Date.now())); } catch { /* private mode */ }
      }
      if (s?.user) {
        fetchProfile(s.user);
        loadPermissions().then(() => setPermsLoaded(true));
      } else {
        try { localStorage.removeItem(SESSION_START_KEY); } catch { /* private mode */ }
        setUserRole(null); setUserLineId(null); setUserTeam(null); setUserSection(null); setUserSections([]); setUserPosition(null); setUserEmail(null); setUserFullName(null); setUserNotifyEmail(null); setUserSignatureUrl(null); setUserAvatarUrl(null);
        setProfileLoaded(false); setPermsLoaded(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // admin แก้สิทธิ์ที่หน้า จัดการสิทธิ์ → ทุกเครื่องที่เปิดอยู่รีเฟรช cache + re-render ทันที
  useEffect(() => {
    if (!session?.user) return;
    const ch = liveChannel(supabase, 'role-permissions-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_permissions' }, async () => {
        await loadPermissions(true);
        setPermsVersion(v => v + 1);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session?.user?.id]);

  return (
    <>
      <div id="noise-overlay" />

      {showSplash && (
        <SplashScreen onDone={() => {
          const el = document.getElementById('splash');
          el?.classList.add('hidden');
          setTimeout(() => setShowSplash(false), 950);
        }} />
      )}

      {session === undefined || (session && (!profileLoaded || !permsLoaded)) ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontSize: 14 }}>
          กำลังโหลด...
        </div>
      ) : (
        <Router>
          <Routes>
            <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
            <Route path="/*"     element={
              <ProtectedLayout
                session={session}
                theme={theme}
                onToggleTheme={toggleTheme}
                permsVersion={permsVersion}
                userRole={effRole}
                realRole={userRole}
                viewAs={impersonating ? viewAs : null}
                onApplyViewAs={applyViewAs}
                userLineId={effLineId}
                userTeam={effTeam}
                userSection={effSection}
                userSections={effSections}
                userMtnTeams={effMtnTeams}
                userIsDeptAdmin={effDeptAdmin}
                userPosition={userPosition}
                userEmail={userEmail}
                userFullName={userFullName}
                userNotifyEmail={userNotifyEmail}
                userSignatureUrl={userSignatureUrl}
                userAvatarUrl={userAvatarUrl}
                onAvatarSaved={setUserAvatarUrl}
                onSignatureSaved={setUserSignatureUrl}
              />
            } />
          </Routes>
        </Router>
      )}
      <ToastContainer />
    </>
  );
}
