import { useState, useEffect, useContext, useMemo, useRef, Fragment } from 'react';
import { otHoursOfLog } from '../utils/otCost';
import { orgValues, sortLike } from '../utils/listOrder';
import { supabase } from '../supabaseClient';
import { setMasterAuthUser } from '../utils/masterCache';
/* 👥 แกนคน 2 แกน (14/10) — "เช็คชื่อไหม" คนละคำถามกับ "นับกำลังคนไลน์ไหม" (กฎ staffKind.js)
   · จอนี้ = **เช็คชื่อ** ⇒ แสดงครบทุกกลุ่ม แล้ว *แยกหัวข้อให้เห็น* ห้ามกรองใครทิ้ง
   · `onlyShopfloorStaff` เหลือใช้ที่เดียว = ช่องยืมคนข้ามไลน์ (ยืมไป "ช่วยไลน์ผลิต") */
import { onlyShopfloorStaff, staffGroupOf, STAFF_KINDS, STAFF_SHOPFLOOR } from '../utils/staffKind';

/* ลำดับกลุ่มคน (หน้างาน → ช่าง → สนับสนุน) — ใช้ทั้งบนจอและในใบ export ให้ตรงกัน */
const GROUP_ORDER = STAFF_KINDS.map(k => k.key);
/* 🧭 ตัวกรองไลน์ซ่อนได้เฉพาะคนที่ "แกนไลน์อธิบายได้" (16/11 · regression จาก defaultLineFilter 13/11)
   — สายสนับสนุน/ช่าง/คนที่ยังไม่ผูกไลน์ ไม่ได้สังกัดไลน์โดยธรรมชาติ ⇒ ห้ามถูกช่องเลือกไลน์ซ่อน */
import { lineAxisVerdict, familySectionsOf, AXIS_OTHER, AXIS_OFF } from '../utils/lineAxisFilter';
/* 🤝 มุมมองสะสม "คนของไลน์เราถูกยืมออกไปกี่วัน" — สูตรนับอยู่ไฟล์นั้นที่เดียว ห้ามนับในหน้า */
import { borrowWindow, summarizeBorrowOut, BORROW_WINDOW_DAYS } from '../utils/borrowDays';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import useIsMobile from '../utils/useIsMobile';
import { toast } from '../components/Toast';
import { fetchByIds, fetchAllPages } from '../utils/fetchByIds';
import { loadCompanyCalendar, getDayType, isOtHolidayType } from '../utils/companyCalendar';
import { holidayPeriodsForShift, defaultHolidayPeriod, otPeriodLabel, WEEKDAY_OT_TIME } from '../utils/otPeriods';
import { getLineFamilyIds } from '../utils/lineHierarchy';
import { notifyEvent } from '../utils/notifyEvent';   // 🔔 แจ้งหัวหน้าต้นสังกัดเมื่อคนของเขาถูกยืม (19/11)
import { buildViewScope, empScopeOrFilter, scopeLineIds } from '../utils/viewScope';   // 👁️ ขอบเขตที่เห็นได้ ผ่านผัง (22/10)
import LineSelect from '../components/LineSelect';
import LineScopeSelect from '../components/LineScopeSelect';
import { loadLinesRes } from '../utils/useProductionLines';
import { useOrgTeams } from '../utils/useOrgSections';
import { inSectionScope, scopeAnchorless, lineScope, defaultLineFilter } from '../utils/sectionScope';
import { buildScheduleMaps, resolveAssignedShift, teamsVisibleToLeader } from '../utils/shiftAssign';
import { roleLabel } from '../utils/roleMeta';
import { getDocForm, fullCode } from '../utils/docForms';
import { checkWrite } from '../utils/dbWrite';
import { checkinLogRow, upsertCheckin } from '../lib/checkinSave';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import FilterBar from '../components/FilterBar';
import Segmented from '../components/Segmented';
import OverflowMenu from '../components/OverflowMenu';   // ⋯ ปุ่มตายตัว ≤2 (UI §6.35)
import NoticeBar from '../components/NoticeBar';         // แถบแจ้งแถบเดียวต่อเรื่อง (UI §6.35)
import InfoMore from '../components/InfoMore';
import Icon from '../components/Icon';
import { toneVar, toneDim, toneLine } from '../utils/statusTone';   // สี = ความหมาย ผ่าน token (UI §6.17)
import SearchInput from '../components/SearchInput';
import { ALL } from '../utils/filterLabels';
import { useDraftAutosave, loadDraft, clearDraft } from '../utils/formDraft';   // 📝 ร่างในเครื่อง (มือถือ · 22/10)
import DraftRestoreBar from '../components/DraftRestoreBar';
import ScanModal from '../components/ScanModal';
import { badgeScanOutcome } from '../utils/badgeCheckin';   // 🪪 สแกน QR บัตรพนักงาน = ติ๊กมางาน (27/10)
import { SCAN_EVENT } from '../utils/scanWedge';

import SectionScopeSelect from '../components/SectionScopeSelect';
import { tr } from '../utils/i18n';
import { askConfirm } from '../utils/askConfirm';
// fallback เมื่อ master ยังว่าง/ยังไม่ apply migration 20260819 — ตัวจริงอยู่ตาราง leave_types
// (จัดการที่ /report แผงจองรถ OT · เลิก hardcode ตาม QC audit 2026-08-19)
const DEFAULT_LEAVE_TYPES = ['ลากิจ', 'ลาป่วย', 'ลาพักร้อน', 'อื่นๆ'];
const LEAVE_DURATION_OPTS = [
  { value: 'full',  label: 'เต็มวัน' },
  { value: 'half',  label: 'ครึ่งวัน' },
  { value: 'hours', label: 'ระบุชั่วโมง' },
];
const LEAVE_PERIOD_OPTS = [
  { value: 'morning',   label: 'ลาช่วงเช้า', sub: 'มาบ่าย' },
  { value: 'afternoon', label: 'ลาช่วงบ่าย', sub: 'มาเช้า' },
];

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toLocalDateStr(dt);
}

function getShiftInfo() {
  const now = new Date();
  const h = now.getHours();
  const totalMin = h * 60 + now.getMinutes();
  const isDay = totalMin >= 8 * 60 && totalMin < 20 * 60;
  const workDate = new Date(now);
  if (h < 8) workDate.setDate(workDate.getDate() - 1);
  return {
    shift:       isDay ? 'day' : 'night',
    workDateStr: toLocalDateStr(workDate),
    label:       isDay ? tr("☀️ กะเช้า") : '🌙 กะดึก',
    timeRange:   isDay ? '08:00–17:30 · OT 17:30–20:00' : 'OT 20:00–22:30 · 22:30–07:59',
  };
}

function getRowStatus(rec) {
  if (!rec) return null;
  if (rec.leave_type) {
    if (rec.leave_duration === 'full')  return 'leave-full';
    if (rec.leave_duration === 'half')  return rec.leave_period === 'morning' ? 'leave-half-am' : 'leave-half-pm';
    if (rec.leave_duration === 'hours') return 'leave-hours';
    return 'leave-full';
  }
  if (!rec.is_present) return 'absent';
  if (rec.is_present && rec.has_helmet && rec.has_boots && rec.has_gloves) return 'ready';
  return 'partial';
}

/* พาเลต 5 สี (05/11 · UI §6.17): เขียว พร้อม · อำพัน PPE ไม่ครบ · แดง ขาด · ฟ้า ลาทุกแบบ (เดิมม่วง/ฟ้า 3 เฉด) — สีผ่าน token ใน statusTone.js */
const STATUS_META = {
  'ready':          { tone: 'good', label: 'พร้อม' },
  'partial':        { tone: 'warn', label: 'PPE ไม่ครบ' },
  'absent':         { tone: 'bad',  label: 'ขาดงาน' },
  'leave-full':     { tone: 'info', label: 'ลาเต็มวัน' },
  'leave-half-am':  { tone: 'info', label: 'ลาช่วงเช้า' },
  'leave-half-pm':  { tone: 'info', label: 'ลาช่วงบ่าย' },
  'leave-hours':    { tone: 'info', label: 'ลาบางส่วน' },
};
for (const m of Object.values(STATUS_META)) { m.color = toneVar(m.tone); m.bg = toneDim(m.tone); m.line = toneLine(m.tone); }

export default function Checkin() {
  const { role, lineId, team, sections: scopeSecs = [], fullName, scopeIdx } = useContext(UserContext);
  /* 👁️ ขอบเขต "ที่เห็นได้" ตัดสินผ่านผัง — รองรับขอบเขตที่เป็น **แผนก/ไลน์** ไม่ใช่แค่ส่วนงาน
     (22/10 · เคสหัวหน้าที่ดูแล 2 ไลน์ในแผนกเดียว: เดิมต้องตั้ง "ทั้ง PD1" แล้วได้ไลน์อื่นมาด้วย)
     🔴 ชื่อที่ผังไม่รู้จัก = พฤติกรรมเดิม (เทียบข้อความ) — ดู utils/viewScope.js กฎข้อ 1 */
  const viewScope = useMemo(() => buildViewScope(scopeSecs, scopeIdx), [scopeSecs, scopeIdx]);
  const canRecord = can('checkin', 'record', role);
  const orgTeams = useOrgTeams(); // 2026-09-07 ทีม A/B/C จาก org_nodes (fallback A/B/C)

  const [employees,      setEmployees]      = useState([]);
  const [leaveTypes,     setLeaveTypes]     = useState(DEFAULT_LEAVE_TYPES); // master ประเภทลา (best-effort)
  const [lines,          setLines]          = useState([]);
  const [attendance,     setAttendance]     = useState({});
  const [otBookings,     setOtBookings]     = useState({});
  const [otTasks,        setOtTasks]        = useState({});
  const [otExtraBookings, setOtExtraBookings] = useState({}); // { [empId]: { [date]: bool } } — วันหยุดล่วงหน้าเพิ่ม
  const [otExtraTasks,    setOtExtraTasks]    = useState({}); // { [empId]: { [date]: taskTypeId } }
  const [otPeriods,       setOtPeriods]       = useState({}); // { [empId]: ot_period } — ช่วงเวลา OT เมื่อวันจอง(หลัก)เป็นวันหยุด
  const [otExtraPeriods,  setOtExtraPeriods]  = useState({}); // { [empId]: { [date]: ot_period } } — วันหยุดล่วงหน้าเพิ่ม
  const [taskTypes,      setTaskTypes]      = useState([]);
  const [isSaving,       setIsSaving]       = useState(false);
  const [confirmSave,    setConfirmSave]    = useState(false); // popup ยืนยัน "บันทึกในนามใคร" (กันเช็คผิด session บนเครื่องแชร์)
  const [filterShift,    setFilterShift]    = useState(true);
  const [noSchedule,     setNoSchedule]     = useState(false);
  const [orgSections,    setOrgSections]    = useState([]);
  const [selSection,     setSelSection]     = useState('');
  /* 🏠 หัวหน้าไลน์เปิดจอมา ต้องเห็น "ไลน์ตัวเอง" ก่อน (13/11 · หัวหน้ากลุ่ม PD4 แจ้งว่า
       หัวหน้าไลน์เห็นพนักงานไลน์อื่นด้วย) — วัดจริง: หัวหน้า GOR ควรเห็น 24 คน แต่เห็น 52 คน
       (ติดคนของครอบครัว LWR BAR 21 + Office PD4 7 มาด้วย) · เป็นทุกส่วนงาน ไม่ใช่แค่ PD4
     🔴 นี่คือการเปลี่ยน **ค่าตั้งต้นของช่องขอบเขต** ไม่ใช่การบีบสิทธิ์ —
        `lineScope()` ยังคืนเท่าเดิมเป๊ะ (ไลน์ตัวเอง ∪ ไลน์ในส่วนงาน) ⇒ สลับไปดู/ยืมคนไลน์อื่นได้เหมือนเดิม
     🔴 ห้ามแก้เป็นการบีบ scope ใน `lineScope` — 26/10 เคยล็อก "ไลน์ตัวเองไลน์เดียว"
        แล้วทั้งโรงงานเปิดกะไม่ได้เช้าวันจันทร์ · และปุ่ม "ยืมคน" ต้องเห็นคนไลน์อื่นก่อนจึงยืมได้ */
  const [selLine,        setSelLine]        = useState(() => defaultLineFilter({ role, lineId }));
  const [showExport,     setShowExport]     = useState(false);
  const [exportMonth,    setExportMonth]    = useState(() => toLocalDateStr(new Date()).slice(0, 7));
  const [exportHalf,     setExportHalf]     = useState('1-15');
  const [exportSection,  setExportSection]  = useState('');
  const [exporting,      setExporting]      = useState(false);
  const [previewNight,   setPreviewNight]   = useState(false);
  const [calLoaded,      setCalLoaded]      = useState(false);
  const isMobile = useIsMobile();   // 📱 มือถือ = การ์ดต่อคน (docs/MOBILE-UX-STANDARD.md §4 ชนิด A)

  /* 🔴 "ใครกะไม่ขึ้นบ้าง" — จัดกลุ่มตามไลน์ ให้แถบเตือนบอกเป็นรายไลน์ได้ (13/10)
     คนที่ถูกยืมมาช่วยกะนี้ถูกตรึง `assignedShift` ไว้แล้ว จึงไม่เข้าเงื่อนไขนี้โดยอัตโนมัติ */
  const noShiftRows = useMemo(() => {
    const by = new Map();
    for (const e of employees) {
      if (e?.assignedShift) continue;
      const nm = lines.find(l => l.id === e.line_id)?.name || e.section || 'ไม่ระบุไลน์';
      by.set(nm, (by.get(nm) || 0) + 1);
    }
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [employees, lines]);
  const noShiftPeople = noShiftRows.reduce((sum, r) => sum + r[1], 0);

  /* ── 🤝 ยืมพนักงานข้ามไลน์รายกะ (line_helpers — migration 20260819_line_helpers_main) ──
     หัวหน้าดึงคนไลน์อื่นมาช่วยกะนี้ → โผล่ในรายชื่อเช็คชื่อของไลน์ปลายทาง + ผังจัดกำลังคน
     (ไม่แตะ employees.line_id — ตัวตนถาวรอยู่ไลน์เดิม การยืมเป็นเรื่องรายวัน+รายกะ) */
  const [helpersReady,    setHelpersReady]    = useState(true);  // false = ตารางยังไม่ apply migration
  const [showBorrowModal, setShowBorrowModal] = useState(false);
  const [borrowSearch,    setBorrowSearch]    = useState('');
  const [borrowResults,   setBorrowResults]   = useState([]);
  const [borrowLoading,   setBorrowLoading]   = useState(false);
  const [borrowLineId,    setBorrowLineId]    = useState('');

  /* 📊 มุมมองสะสม "คนของไลน์เราถูกยืมออกไปกี่วัน" (16/11 · หน้างาน: *"ยืมตัวพนักงาน ยืมแล้ว
     ไม่ยอมคืน เจ้าของจะมองไม่เห็นรึป่าว"*) — ป้าย `→ ไปช่วยไลน์ X (กะนี้)` ตอบได้แค่กะนี้
     การยืมผูก work_date+shift ⇒ ไม่มีการค้างข้ามวันเชิงโครงสร้าง แต่ **ยืมซ้ำทุกวันได้** ·
     วัดจริง 60 วัน: 123 แถว 36 คน (9 คนเข้า LINE APRON ASSY 5–9 วัน ในช่วง 2–5 สัปดาห์)
     🔴 สูตรนับอยู่ `utils/borrowDays.js` ที่เดียว · `null` = ยังไม่โหลด (ห้ามโชว์ 0 แทน "ไม่รู้") */
  const [showBorrowSum,    setShowBorrowSum]    = useState(false);
  const [borrowSum,        setBorrowSum]        = useState(null);
  const [borrowSumErr,     setBorrowSumErr]     = useState('');
  const [borrowSumLoading, setBorrowSumLoading] = useState(false);

  /* ── สถานะตั้งต้นตอนโหลด — ใช้เทียบว่าการกดบันทึกแต่ละครั้งเป็น "เช็คชื่อครั้งแรก" /
     "อัพเดทกำลังคน" / "จองรถ OT" เพื่อยิงแจ้งเตือน Telegram แยกประเภท (กันหัวหน้าแผนกงง
     ว่าทำไมเช็คชื่อซ้ำ ทั้งที่จริงแค่มาแก้ข้อมูล/จองรถ OT — ดู CLAUDE.md ส่วน Checkin) */
  const [baseline, setBaseline] = useState({ logIds: new Set(), att: {}, otBook: {}, otTask: {}, otPeriod: {} });

  /* ── จองรถ OT แบบอิสระ (ไม่ผูกกับกะที่กำลังเช็คชื่ออยู่) ──
     ใช้กรณีอย่างจันทร์แรกหลังสลับกะ ที่ทีมซึ่งต้องจอง OT ไม่ใช่ทีมที่กำลังเช็คชื่ออยู่ตรงหน้า */
  const [showOtBookModal,  setShowOtBookModal]  = useState(false);
  const [otBookDate,       setOtBookDate]       = useState(() => toLocalDateStr(new Date()));
  const [otBookShift,      setOtBookShift]      = useState('night');
  const [otBookLineId,     setOtBookLineId]     = useState('');
  const [otBookTeam,       setOtBookTeam]       = useState('');
  const [otBookSelections, setOtBookSelections] = useState({}); // { empId: bool }
  const [otBookTasks,      setOtBookTasks]      = useState({}); // { empId: taskTypeId }
  const [otBookPeriods,    setOtBookPeriods]    = useState({}); // { empId: ot_period } — เมื่อวันที่จองเป็นวันหยุด
  const [otBookLoading,    setOtBookLoading]    = useState(false);
  const [otBookSaving,     setOtBookSaving]     = useState(false);

  /* 🔴 กะถูก "ตรึง" ตอนโหลดหน้า (QC 05/10) — เดิมคำนวณใหม่ทุก render
     ⇒ หัวหน้ากะเช้าเปิดหน้าค้าง แล้วกดบันทึกหลัง 20:00 = save ทำงานเป็น "กะดึก" ทั้งที่ข้อมูลบนจอเป็นของกะเช้า
     ⇒ `isBooked` อ่าน otBookings (ว่าง) ⇒ **ยกเลิกจองรถ OT คืนพรุ่งนี้ของทุกคนบนจอ** เงียบๆ
     ตอนนี้: รายชื่อ/จองรถ/บันทึก ใช้กะเดียวกับที่โหลดมาเสมอ · กะจริงเปลี่ยน = แถบเตือน + ปุ่มโหลดกะใหม่ (ไม่สลับให้เอง
     เพราะจะทิ้งสิ่งที่กรอกค้างไว้) */
  const [realShiftInfo, setRealShiftInfo] = useState(getShiftInfo);
  const [shiftChanged, setShiftChanged]   = useState(null);   // ข้อมูลกะใหม่เมื่อเวลาจริงข้ามกะไปแล้ว
  useEffect(() => {
    const t = setInterval(() => {
      const now = getShiftInfo();
      setShiftChanged(now.shift !== realShiftInfo.shift || now.workDateStr !== realShiftInfo.workDateStr ? now : null);
    }, 60000);
    return () => clearInterval(t);
  }, [realShiftInfo]);
  const shiftInfo = previewNight
    ? { ...realShiftInfo, shift: 'night', label: 'กะดึก (Preview)' }
    : realShiftInfo;

  /* 📝 ร่างในเครื่อง (มือถือ · 22/10 · audit handheld ข้อ 4) — เช็คชื่อ 20+ คนแล้วบันทึกทีเดียวตอนท้าย
     ⇒ เน็ตหลุด/รีโหลด/เตะออกหมดกะ = ต้องไล่ติ๊กใหม่ทั้งหมด · เก็บเฉพาะ "คนที่แก้ต่างจากตอนโหลด" (ส่วนเช็คชื่อ+PPE+ลา)
     ต่อ วันงาน|กะ|คนเช็ค · การจองรถ OT ไม่อยู่ในร่าง (มีจอ/บันทึกของมันเอง) · utils/formDraft.js */
  const ckDraftKey = isMobile && shiftInfo?.workDateStr ? `checkin:${shiftInfo.workDateStr}:${shiftInfo.shift}:${fullName || ''}` : null;
  const ckChanges = useMemo(() => {
    const out = {};
    for (const [id, rec] of Object.entries(attendance)) {
      const b = baseline.att?.[id];
      if (b && JSON.stringify(rec) !== JSON.stringify(b)) out[id] = rec;
    }
    return out;
  }, [attendance, baseline]);
  const [ckPending, setCkPending] = useState(null);
  // "ค้างบันทึกกี่คน" จริงๆ (ติ๊ก/แก้ด้วยมือแล้วยังไม่กด 💾) — ใช้เขียนบนจอ ห้ามเดาเอาจากยอดมางานรวม
  const ckPendingCount = Object.keys(ckChanges).length;

  /* 🪪 เช็คชื่อด้วยบัตรพนักงาน (มือถือ · 27/10 · คำสั่ง user) — QR บนบัตร = รหัสพนักงาน (utils/badgeCheckin.js)
     2 ทาง: 📷 เปิดกล้องสแกนต่อเนื่อง (โมดัลไม่ปิดเอง ยิงทีละคนได้เลย) · กดปุ่มสแกนข้างเครื่องตอนไม่ได้แตะช่องไหน
     (ScanWedgeGuard ยิง `esm:scan` มา — หน้านี้รับ)
     🔴 **สแกน 1 ใบ = เขียนลงฐานทันที 1 แถว** (10/11 · คำสั่ง user) — ไม่ต้องกด 💾 บันทึกอีก
     · เขียนไม่ติด = ไม่ติ๊กบนจอ + ขึ้นแดงให้ยิงซ้ำ (ห้ามติ๊กค้างไว้ให้เข้าใจผิดว่าเช็คแล้ว)
     · เขียนเฉพาะ "คนที่ยิงบัตร" แถวเดียว — ไม่แตะคนอื่นในจอ (ปุ่ม 💾 เขียนทั้ง `displayed` ทับของคนอื่นได้) */
  const [badgeScanOpen, setBadgeScanOpen] = useState(false);
  const [confirmScan, setConfirmScan] = useState(false);   // ยืนยัน "สแกนในนามใคร" ครั้งเดียวก่อนเปิดกล้อง
  const [scanSaved, setScanSaved] = useState([]);          // id คนที่บันทึกสำเร็จในรอบสแกนนี้ (ไว้เขียนบนจอ)
  const badgeScanRef = useRef(null);
  useEffect(() => {
    if (!isMobile) return undefined;
    const onScan = async (e) => {
      const fn = badgeScanRef.current; if (!fn) return;
      e.preventDefault();   // หน้านี้รับรหัสแล้ว — ScanWedgeGuard ไม่ต้องขึ้น "จอนี้ไม่มีช่องรอรับ"
      const r = await fn(e.detail?.parsed || { raw: e.detail?.raw });   // เขียนลงฐานแล้วค่อยบอกผล
      if (typeof r === 'string') toast.error(r); else if (r?.ok) toast.success(r.ok);
    };
    window.addEventListener(SCAN_EVENT, onScan);
    return () => window.removeEventListener(SCAN_EVENT, onScan);
  }, [isMobile]);
  useDraftAutosave(ckDraftKey, ckChanges, !!ckDraftKey && !ckPending && Object.keys(ckChanges).length > 0);
  // โหลดรายชื่อเสร็จ (baseline ใหม่) → มีร่างของชุดนี้ที่ต่างจากฐานไหม · เทียบเฉพาะคนที่ยังอยู่ในรายชื่อ
  useEffect(() => {
    if (!ckDraftKey) { setCkPending(null); return; }
    const d = loadDraft(ckDraftKey);
    const usable = d && Object.entries(d.data || {}).some(([id, rec]) => baseline.att?.[id] && JSON.stringify(rec) !== JSON.stringify(baseline.att[id]));
    setCkPending(usable ? d : null);
  }, [ckDraftKey, baseline]);
  const restoreCkDraft = () => {
    const d = ckPending?.data || {};
    setAttendance(prev => { const n = { ...prev }; for (const [id, rec] of Object.entries(d)) if (n[id]) n[id] = { ...n[id], ...rec }; return n; });
    setCkPending(null);
  };

  // โหลด master ประเภทลา (ตารางว่าง/ยังไม่ apply = ใช้ค่า default เดิม)
  useEffect(() => {
    supabase.from('leave_types').select('name, is_active').order('sort_order').then(({ data, error }) => {
      if (error) return;
      const names = (data || []).filter(r => r.is_active).map(r => r.name);
      if (names.length) setLeaveTypes(names);
    });
  }, []);

  useEffect(() => { loadCompanyCalendar().then(() => setCalLoaded(true)); }, []);
  useEffect(() => { fetchData(); }, [previewNight, calLoaded, realShiftInfo]);

  // 🤝 ค้นหาพนักงานทั้งโรงงานสำหรับยืมตัว (debounce 350ms — ค้นด้วยชื่อ/รหัสอย่างน้อย 2 ตัวอักษร)
  useEffect(() => {
    if (!showBorrowModal) return;
    const q = borrowSearch.trim().replace(/[,()%]/g, ''); // กันอักขระที่พัง syntax ของ PostgREST .or()
    if (q.length < 2) { setBorrowResults([]); return; }
    const t = setTimeout(async () => {
      setBorrowLoading(true);
      const { data } = await onlyShopfloorStaff(supabase.from('employees')
        .select('id, employee_id_code, name, image_url, line_id, section, team')
        .eq('is_active', true))
        .or(`name.ilike.%${q}%,employee_id_code.ilike.%${q}%`)
        .order('employee_id_code').limit(30);
      setBorrowResults(data || []);
      setBorrowLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [borrowSearch, showBorrowModal]);

  // "วันหยุดแบบ OT" (ot15/ot2) เท่านั้น — shutdown75 (ม.75) มาทำงาน = ค่าแรงปกติ ไม่เข้า flow จอง OT วันหยุด
  const isHolidayDate = (dateStr) => calLoaded && isOtHolidayType(getDayType(dateStr));

  /* ── วันที่จองรถ "ล่วงหน้าเพิ่ม" ในรอบเช็คชื่อนี้ (เพิ่มเติมจากกลไกเดิม) ──
     กะดึก: คืนถัดไป (nextDateStr) จองได้เสมออยู่แล้ว (กลไกเดิม) — ถ้าคืนถัดๆไปจากนั้นเป็นวันหยุดต่อกัน
            (เช่น คืน พฤหัส จองคืนศุกร์ไว้แล้ว, ถ้าคืนเสาร์เป็นวันหยุด ก็ให้จองคืนเสาร์+อาทิตย์ต่อได้เลย)
     กะเช้า: ปกติ OT วันนี้ใช้ has_ot อยู่แล้ว (ไม่ใช่ล่วงหน้า) — ถ้าพรุ่งนี้เป็นวันหยุด ให้จองล่วงหน้าต่อเนื่อง
            จนกว่าจะเจอวันทำงานปกติ (เช่น กะเช้าศุกร์ จองเสาร์-อาทิตย์-(จันทร์ถ้าหยุดด้วย)) */
  const extraAdvanceDates = (() => {
    const { workDateStr, shift } = shiftInfo;
    const dates = [];
    const scanStart = shift === 'night' ? addDaysToDateStr(workDateStr, 2) : addDaysToDateStr(workDateStr, 1);
    let cur = scanStart;
    while (isHolidayDate(cur)) { dates.push(cur); cur = addDaysToDateStr(cur, 1); }
    return dates;
  })();

  const shortDateLabel = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const wd = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][dt.getDay()];
    return `${wd} ${d}/${m}`;
  };

  const fetchData = async () => {
    const { workDateStr } = shiftInfo;
    const nextDateStr = addDaysToDateStr(workDateStr, 1);

    // ⚠️ ต้องดึงไลน์ก่อนสร้าง query พนักงาน — scope ของ leader = "ทั้งครอบครัวไลน์"
    // (ตัวเอง + ไลน์แม่ + ไลน์ลูก) ตาม pattern มาตรฐาน ห้ามกรอง line_id ตรงตัว
    // เคสจริง 2026-08-10: จัดข้อมูล PD4 ย้ายพนักงานจากไลน์แม่ (GOR/LWR BAR) ไปไลน์ลูก
    // (Assy GOR/Assy LWR) → หัวหน้ากลุ่มที่ผูกกับไลน์แม่เห็น 0 คน = "เช็คชื่อหายหมด"
    const { data: lineData } = await loadLinesRes();   // cache กลาง (25/09)
    // คงลำดับเดิมของหน้านี้ (section → name) — loader กลางเรียงตามชื่ออย่างเดียว
    setLines([...(lineData || [])].sort((a, b) =>
      String(a.section || '').localeCompare(String(b.section || ''))
      || String(a.name || '').localeCompare(String(b.name || ''))));

    // 🔴 ไม่กรอง staff_kind — จอเช็คชื่อต้องเห็นครบทุกกลุ่ม (แยกหัวข้อตอนวาดแทน · 14/10)
    let empQ = supabase.from('employees').select('*').eq('is_active', true).order('employee_id_code');
    /* 🔴 ด่านขอบเขต 2 แกน — **แกนไลน์กับแกนส่วนงานต้องเป็นลำดับ ห้ามเป็น else-if** (19/10)
       เดิมเขียน `if (leader) {…} else if (sections)` ⇒ leader ที่บัญชีไม่มี `line_id`
       หลุดทั้งสองด่าน = เห็นพนักงานทั้งโรงงานเงียบๆ (ดู scopeAnchorless ใน sectionScope.js) */
    /* 🔭 แกนไลน์มาจากของกลาง `lineScope()` (QC audit 09/11 · กวาดรอบ 3) — เดิมคิดเองในหน้า
       ⇒ leader ได้ครอบครัวไลน์ล้วน (ไม่รวมส่วนงานที่กำกับ) และไม่รู้จัก `scopeIdx`
       🔴 ลำดับ 2 แกนยังเหมือนเดิมเป๊ะ (ไม่มีไลน์ในขอบเขต = ถอยไปแกนส่วนงาน ห้ามเป็น else-if ของ role) */
    const scQ = lineScope({ role, lineId, sections: scopeSecs, lines: lineData || [], scopeIdx });
    const famIdsQ = scQ.unlimited ? null
      : new Set((lineData || []).filter(l => new Set(scQ.names).has(l.name)).map(l => l.id));
    if (famIdsQ && famIdsQ.size) {
      empQ = empQ.in('line_id', [...famIdsQ]);
    } else if (scopeSecs.length) {
      /* ทุก role ที่ถูกจำกัดขอบเขต (supervisor เดิม + manager/qa ที่กำหนด sections)
         · รวม leader ที่ยังไม่ผูกไลน์ (เช่นรักษาการหลายหน่วย) — ถอยมาใช้แกนนี้แทน
         🔁 22/10: เดิม `.in('section', …)` เทียบข้อความอย่างเดียว ⇒ ขอบเขตที่เป็น **แผนก/ไลน์**
            คืน 0 แถว · ตอนนี้ขยายผ่านผังเป็น ส่วนงาน/แผนก/ไลน์ แล้วกรองด้วย `.or()` ชุดเดียว */
      const orF = empScopeOrFilter(viewScope, scopeLineIds(viewScope, lineData || []));
      if (orF) empQ = empQ.or(orF);
    }
    if (role === 'leader') {
      // ⚠️ ทีมที่ไม่หมุนกะ (C) = หัวหน้าที่ไม่ได้ยืนหน้างาน → เห็นคนทั้งไลน์ทุกทีม
      //    (ขอบเขตไลน์ยังคุมอยู่ · ปลดเฉพาะแกนทีม — ดู seesAllTeams ใน shiftAssign.js)
      // 🔴 ทีมตัวเอง + ทีมที่ไม่หมุนกะ (C) — พนักงานทีม C = กะเช้าตลอด ยืนหน้างานกับทีมที่เข้าเช้า
      //    เดิม `.eq('team', team)` ทำให้คนทีม C หายจากใบเช็คชื่อของหัวหน้าทีม A/B ทั้งคู่
      //    (2 คนไม่เคยถูกเช็คชื่อเลย — ดูเหตุผลเต็มที่ teamsVisibleToLeader ใน shiftAssign.js)
      const teamsSeen = teamsVisibleToLeader(team);
      if (teamsSeen) empQ = empQ.in('team', teamsSeen);
    }

    const [
      { data: empData },
      { data: logData },
      { data: scheduleData },
      { data: overrideData },
      { data: orgNodeData },
      { data: mergeData },
      { data: bookingData },
      { data: taskTypeData },
      { data: extraBookingData },
    ] = await Promise.all([
      empQ,
      /* cap-ok: daily_production_logs วัน*เดียว* — วัด 11/11/26 สูงสุด 279 แถว/วัน (ทั้งโรงงาน) */
      supabase.from('daily_production_logs')
        .select('employee_id, is_present, has_helmet, has_boots, has_gloves, has_ot, has_extended_ot, remark, leave_type, leave_duration, leave_period, leave_hours, checked_by')
        .eq('work_date', workDateStr),
      /* cap-ok: shift_schedules วัน*เดียว* — วัด 11/11/26 สูงสุด 45 แถว/วัน */
      supabase.from('shift_schedules').select('*').eq('work_date', workDateStr),
      supabase.from('shift_overrides').select('*').eq('work_date', workDateStr),
      supabase.from('org_nodes').select('code, name, sort_order').eq('kind', 'section').eq('is_active', true),
      supabase.from('shift_merge_events').select('*').lte('start_date', workDateStr).gte('end_date', workDateStr),
      shiftInfo.shift === 'night'
        ? supabase.from('ot_night_bookings').select('employee_id, task_type_id, ot_period').eq('work_date', nextDateStr).eq('shift', 'night')
        : supabase.from('ot_night_bookings').select('employee_id, task_type_id, ot_period').eq('work_date', workDateStr).eq('shift', 'day'),
      supabase.from('ot_task_types').select('id, name').eq('is_active', true).order('sort_order'),
      extraAdvanceDates.length
        ? supabase.from('ot_night_bookings').select('employee_id, work_date, task_type_id, ot_period').in('work_date', extraAdvanceDates).eq('shift', shiftInfo.shift)
        : Promise.resolve({ data: [] }),
    ]);
    setOrgSections(orgValues(orgNodeData));   // ลำดับตามผัง (listOrder.js)
    setTaskTypes(taskTypeData || []);

    if (!empData) return;

    /* ── ยืมตัวข้ามไลน์ (line_helpers) — best-effort: ยังไม่ apply migration = ทำงานแบบเดิมเป๊ะ ──
       แถวของวัน+กะนี้ทั้งโรงงาน แล้วแยก 2 ขา:
       - ยืมเข้า (to_line อยู่ใน scope เรา) → ดึง employees ตัวจริงมารวมในรายชื่อ + ป้าย 🤝
       - ยืมออก (คนใน roster เราถูกยืมไปไลน์นอก scope) → ป้าย "→ ไปช่วยไลน์ X" (ไม่ตัดออกจากลิสต์) */
    let helperData = [];
    let helpersOk = true;
    {
      const { data: hd, error: he } = await supabase.from('line_helpers')
        .select('id, employee_id, to_line_id, created_by_name')
        .eq('work_date', workDateStr).eq('shift', shiftInfo.shift);
      if (he) helpersOk = false; else helperData = hd || [];
    }
    setHelpersReady(helpersOk);

    const lineById = Object.fromEntries((lineData || []).map(l => [l.id, l]));
    const inMyScope = (toLineId) => {
      /* 🔭 ของกลางชุดเดียวกับคิวรีหลัก — ไม่มีไลน์ในขอบเขต = ถอยไปแกนส่วนงาน (19/10) */
      if (famIdsQ && famIdsQ.size) return famIdsQ.has(toLineId);
      if (scopeSecs.length) return inSectionScope(scopeSecs, lineById[toLineId]?.section);
      return !famIdsQ;        // ไม่จำกัด = true · มีขอบเขตแต่ไม่มีไลน์เลย = false (fail-closed เดิม)
    };
    const helperIn = helperData.filter(h => inMyScope(h.to_line_id));
    const helperByEmp = Object.fromEntries(helperIn.map(h => [h.employee_id, h]));
    const helperOutByEmp = {};
    helperData.forEach(h => {
      if (!inMyScope(h.to_line_id)) helperOutByEmp[h.employee_id] = { to: lineById[h.to_line_id]?.name || 'ไลน์อื่น', by: h.created_by_name || '' };
    });

    // พนักงานที่ถูกยืมเข้ามาแต่อยู่นอก scope query หลัก → ดึงเพิ่มรายตัว
    const haveIds = new Set(empData.map(e => e.id));
    const missingHelperIds = helperIn.filter(h => !haveIds.has(h.employee_id)).map(h => h.employee_id);
    let helperEmps = [];
    if (missingHelperIds.length) {
      const { data: hemp } = await supabase.from('employees').select('*')
        .in('id', missingHelperIds).eq('is_active', true);
      helperEmps = hemp || [];
    }
    const empAll = [...empData, ...helperEmps];

    // ตารางกะ: ไลน์ผลิต (line_id) + หน่วยงานสนับสนุน (dept_name) — ดู utils/shiftAssign.js
    const schedMaps = buildScheduleMaps(scheduleData, lineData);   // ส่ง lines = ไลน์ลูกตกทอดกะจากไลน์แม่
    setNoSchedule(schedMaps.count === 0);

    const empOverride = {};
    (overrideData || []).forEach(o => { empOverride[o.employee_id] = o.shift; });

    // map lineId → section for merge event lookup
    const lineSection = {};
    (lineData || []).forEach(l => { lineSection[l.id] = l.section; });

    const enriched = empAll.map(emp => {
      // merge event (line-level beats section-level) — ใช้ section ของไลน์พนักงาน
      const empSec = lineSection[emp.line_id];
      const mergeEvent =
        (mergeData || []).find(e => e.line_id === emp.line_id) ||
        (mergeData || []).find(e => e.section && e.section === empSec);
      // ลำดับ: override รายคน → merge event → ตารางกะ (ไลน์ → หน่วยงาน) · Team C = กะเช้าตลอด
      const assignedShift = resolveAssignedShift(emp, {
        overrideShift: empOverride[emp.id],
        mergeShift: mergeEvent?.target_shift,
        maps: schedMaps,
      });
      const helper = helperByEmp[emp.id];
      if (helper) {
        // คนที่ถูกยืมเข้ามา = อยู่กะนี้แน่นอน (การยืมผูกกับกะ) — ห้ามให้ตารางกะไลน์เดิมกรองทิ้ง
        return {
          ...emp, assignedShift: shiftInfo.shift,
          _helperRowId:   helper.id,
          _helperToLineId: helper.to_line_id,
          _helperFrom:    lineById[emp.line_id]?.name || emp.section || 'ไม่ระบุไลน์',
        };
      }
      /* 🔒 ถูกยืมออกไปกะนี้ (19/11 · คำสั่ง user) — ไลน์ที่ยืมเป็นคนเช็คชื่อ/PPE **ฝั่งเดียว**
         จอต้นสังกัดเห็นผลแต่แก้ไม่ได้ และ handleSave ข้ามคนนี้ (เดิม 2 ไลน์บันทึกทับกันได้ ใครกดทีหลังชนะ) */
      if (helperOutByEmp[emp.id]) return { ...emp, assignedShift, _helperOutTo: helperOutByEmp[emp.id].to, _helperOutBy: helperOutByEmp[emp.id].by };
      return { ...emp, assignedShift };
    });

    /* 👀 คนที่ถูกยืมออก: บอกหัวหน้าต้นสังกัดว่า "ใครเช็คชื่อให้แล้ว" (ชื่อจาก profiles · ล้ม = ไม่โชว์ชื่อ ไม่บล็อก) */
    const outIds = enriched.filter(e => e._helperOutTo).map(e => e.id);
    const checkerIds = [...new Set((logData || []).filter(l => outIds.includes(l.employee_id) && l.checked_by).map(l => l.checked_by))];
    let checkerName = {};
    if (checkerIds.length) {
      const { data: pf } = await supabase.from('profiles').select('id, full_name').in('id', checkerIds);
      checkerName = Object.fromEntries((pf || []).map(p => [p.id, p.full_name]));
    }
    enriched.forEach(e => {
      if (!e._helperOutTo) return;
      const log = logData?.find(l => l.employee_id === e.id);
      e._helperOutChecked = log ? (checkerName[log.checked_by] || 'ไลน์ที่ยืม') : '';
    });

    setEmployees(enriched);

    const init = {};
    enriched.forEach(emp => {
      const log = logData?.find(l => l.employee_id === emp.id);
      init[emp.id] = {
        is_present:       log ? log.is_present       : false,
        has_helmet:       log ? log.has_helmet       : false,
        has_boots:        log ? log.has_boots        : false,
        has_gloves:       log ? log.has_gloves       : false,
        has_ot:           log ? log.has_ot           : false,
        has_extended_ot:  log ? log.has_extended_ot  : false,
        remark:         log ? (log.remark || '') : '',
        leave_type:     log ? (log.leave_type     || '') : '',
        leave_duration: log ? (log.leave_duration || '') : '',
        leave_period:   log ? (log.leave_period   || '') : '',
        leave_hours:    log ? (log.leave_hours    || '') : '',
      };
    });
    setAttendance(init);

    const bookingByEmp = {};
    const bookingPeriodByEmp = {};
    (bookingData || []).forEach(b => {
      bookingByEmp[b.employee_id] = b.task_type_id;
      bookingPeriodByEmp[b.employee_id] = b.ot_period || '';
    });
    const bookInit = {};
    const taskInit = {};
    const periodInit = {};
    enriched.forEach(emp => {
      bookInit[emp.id] = Object.prototype.hasOwnProperty.call(bookingByEmp, emp.id);
      taskInit[emp.id] = bookingByEmp[emp.id] || '';
      periodInit[emp.id] = bookingPeriodByEmp[emp.id] || '';
    });
    setOtBookings(bookInit);
    setOtTasks(taskInit);
    setOtPeriods(periodInit);

    const extraBookInit = {};
    const extraTaskInit = {};
    const extraPeriodInit = {};
    enriched.forEach(emp => { extraBookInit[emp.id] = {}; extraTaskInit[emp.id] = {}; extraPeriodInit[emp.id] = {}; });
    (extraBookingData || []).forEach(b => {
      if (!extraBookInit[b.employee_id]) extraBookInit[b.employee_id] = {};
      if (!extraTaskInit[b.employee_id]) extraTaskInit[b.employee_id] = {};
      if (!extraPeriodInit[b.employee_id]) extraPeriodInit[b.employee_id] = {};
      extraBookInit[b.employee_id][b.work_date] = true;
      extraTaskInit[b.employee_id][b.work_date] = b.task_type_id || '';
      extraPeriodInit[b.employee_id][b.work_date] = b.ot_period || '';
    });
    setOtExtraBookings(extraBookInit);
    setOtExtraTasks(extraTaskInit);
    setOtExtraPeriods(extraPeriodInit);

    // snapshot ตั้งต้น (สำหรับเทียบตอนบันทึก — ดูคอมเมนต์ที่ประกาศ baseline)
    setBaseline({
      logIds:   new Set((logData || []).map(l => l.employee_id)),
      att:      JSON.parse(JSON.stringify(init)),
      otBook:   { ...bookInit },
      otTask:   { ...taskInit },
      otPeriod: { ...periodInit },
    });
  };

  const toggleOtBooking = (empId) => {
    const turningOn = !otBookings[empId];
    setOtBookings(prev => ({ ...prev, [empId]: !prev[empId] }));
    // วันจอง(หลัก)เป็นวันหยุด → default ช่วงเวลา 8 ชม. ของกะนั้น ให้เห็นและแก้ได้ก่อนบันทึก
    const bookDate = shiftInfo.shift === 'night' ? addDaysToDateStr(shiftInfo.workDateStr, 1) : shiftInfo.workDateStr;
    if (turningOn && isHolidayDate(bookDate)) {
      setOtPeriods(prev => ({ ...prev, [empId]: prev[empId] || defaultHolidayPeriod(shiftInfo.shift) }));
    }
  };

  const setOtTask = (empId, taskTypeId) =>
    setOtTasks(prev => ({ ...prev, [empId]: taskTypeId }));

  const setOtPeriod = (empId, period) =>
    setOtPeriods(prev => ({ ...prev, [empId]: period }));

  const toggleOtExtraBooking = (empId, date) => {
    const turningOn = !otExtraBookings[empId]?.[date];
    setOtExtraBookings(prev => ({ ...prev, [empId]: { ...prev[empId], [date]: !prev[empId]?.[date] } }));
    // extraAdvanceDates เป็นวันหยุดเสมอ (จาก isHolidayDate) → default 8 ชม. ของกะนั้น
    if (turningOn) {
      setOtExtraPeriods(prev => ({ ...prev, [empId]: { ...prev[empId], [date]: prev[empId]?.[date] || defaultHolidayPeriod(shiftInfo.shift) } }));
    }
  };

  const setOtExtraTask = (empId, date, taskTypeId) =>
    setOtExtraTasks(prev => ({ ...prev, [empId]: { ...prev[empId], [date]: taskTypeId } }));

  const setOtExtraPeriod = (empId, date, period) =>
    setOtExtraPeriods(prev => ({ ...prev, [empId]: { ...prev[empId], [date]: period } }));

  const toggle = (empId, field) =>
    setAttendance(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: !prev[empId][field] } }));

  const setField = (empId, field, value) =>
    setAttendance(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: value } }));

  const setLeaveType = (empId, value) => {
    setAttendance(prev => {
      const cur = prev[empId];
      if (!value) {
        return { ...prev, [empId]: { ...cur, leave_type: '', leave_duration: '', leave_period: '', leave_hours: '', is_present: true } };
      }
      const duration = cur.leave_duration || 'full';
      const isPresent = duration !== 'full';
      return { ...prev, [empId]: { ...cur, leave_type: value, leave_duration: duration, is_present: isPresent } };
    });
  };

  const setLeaveDuration = (empId, value) => {
    setAttendance(prev => {
      const cur = prev[empId];
      const isPresent = value !== 'full';
      return {
        ...prev, [empId]: {
          ...cur,
          leave_duration: value,
          is_present: isPresent,
          leave_period: value === 'half' ? (cur.leave_period || 'afternoon') : '',
          leave_hours:   value !== 'hours' ? '' : cur.leave_hours,
        }
      };
    });
  };

  // ── ตัวตนคนที่ล็อกอินอยู่ (แสดงบนแถบเตือน + popup ยืนยัน) — กันเช็คชื่อผิด session บนเครื่องแชร์กัน ──
  const myScopeLabel = (() => {
    if (role === 'leader') {
      const ln = lines.find(l => l.id === lineId)?.name;
      if (ln) return [`ไลน์ ${ln}`, team && `ทีม ${team}`].filter(Boolean).join(' · ');
      // ไม่ผูกไลน์ → ขอบเขตจริงคือส่วนงาน (เช่นรักษาการหลายหน่วย) · ไม่มีเลย = ทั้งโรงงาน
      if (scopeSecs.length) return [`ส่วนงาน ${scopeSecs.join(', ')} (ยังไม่ผูกไลน์)`, team && `ทีม ${team}`].filter(Boolean).join(' · ');
      return 'ยังไม่กำหนดไลน์/ส่วนงาน';
    }
    if (scopeSecs.length) return `${tr("ส่วนงาน")} ${scopeSecs.join(', ')}`;
    return tr("ทุกส่วนงาน");
  })();

  const handleSwitchUser = async () => {
    // ออกจากระบบเฉพาะเครื่องนี้ (scope local — ห้าม global ตามกฎ auth) แล้ว App เด้งไปหน้า login
    setMasterAuthUser(null);   // 🔐 ผลที่โหลดระหว่างสลับบัญชีห้ามลง cache (ต้นเหตุ dropdown ไลน์ว่าง · masterCache.js)
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ปล่อยให้ App จัดการต่อ */ }
  };

  /* ── 🤝 ยืม/คืนพนักงานข้ามไลน์ ── */
  const openBorrowModal = () => {
    setBorrowLineId(role === 'leader' ? String(lineId || '') : (selLine || ''));
    setBorrowSearch('');
    setBorrowResults([]);
    setShowBorrowModal(true);
  };

  /* 🔔 หัวหน้าต้นสังกัดต้องรู้เมื่อคนของเขาถูกยืมไปช่วยไลน์อื่น (19/11 · คำสั่ง user)
     ผู้รับ = ทะเบียน `notification_rules.line_helper_borrowed` (หัวหน้าไลน์ของไลน์ต้นสังกัด · ตั้งที่ /notification-config)
     · ยืมกันเองในครอบครัวไลน์แม่-ลูก ไม่ถือว่าออก (กติกาเดียวกับ utils/borrowDays.js) = ไม่แจ้ง
     · fire-and-forget — แจ้งไม่ได้ห้ามลากการยืมล้ม */
  const notifyBorrowed = (emp, toLineId) => {
    const home = lines.find(l => l.id === emp.line_id);
    const to = lines.find(l => l.id === Number(toLineId));
    if (!home || !to) return;
    if (getLineFamilyIds(lines, home.id).has(to.id)) return;
    notifyEvent({
      event: 'line_helper_borrowed',
      line_name: home.name, section: home.section || emp.section || undefined,
      title: `🤝 ${emp.name} ${tr("ถูกยืมไปช่วย")} ${to.name}`,
      lines: [
        `${emp.name} (${emp.employee_id_code || '-'}) · ${tr("ไลน์ต้นสังกัด")} ${home.name}`,
        `${tr("ไปช่วย")} ${to.name} · ${shiftInfo.label || (shiftInfo.shift === 'night' ? tr('กะดึก') : tr('กะเช้า'))} ${tr("วันที่")} ${shiftInfo.workDateStr}`,
        `${tr("ยืมโดย")} ${fullName || '-'} — ${tr("ไลน์ที่ยืมเป็นคนเช็คชื่อ/ตรวจ PPE ให้กะนี้")}`,
      ],
      actor: fullName || undefined,
      ref_table: 'line_helpers',
    });
  };

  const borrowEmployee = async (emp) => {
    if (!borrowLineId) { toast.error('เลือกไลน์ปลายทางที่จะให้มาช่วยก่อน'); return; }
    const { error } = await supabase.from('line_helpers').insert({
      work_date:       shiftInfo.workDateStr,
      shift:           shiftInfo.shift,
      employee_id:     emp.id,
      to_line_id:      Number(borrowLineId),
      created_by_name: fullName || null,
    });
    if (error) {
      if (error.code === '42P01') toast.error('ยืมตัวยังใช้ไม่ได้ — ยังไม่ได้ apply migration 20260819_line_helpers_main (แจ้ง admin)');
      else if (error.code === '23505') await resolveBorrowConflict(emp);
      else toast.error((tr('ยืมตัวไม่สำเร็จ') + ': ') + error.message);
      return;
    }
    toast.success(`🤝 ${tr("ยืม")} ${emp.name} ${tr("มาช่วยกะนี้แล้ว")}`);
    notifyBorrowed(emp, borrowLineId);
    setShowBorrowModal(false);
    fetchData();
  };

  /* 23505 = คนนี้ถูกยืมไปแล้วในวัน+กะเดียวกัน (unique work_date+shift+employee_id) — บอกให้ชัดว่าไลน์ไหน/ใครยืม
     · ปลายทางเดิมอยู่ใน scope เรา → เสนอ "ย้าย" มาไลน์ที่เลือกแทน (update แถวเดิม — ยังคง 1 คน 1 ไลน์ต่อกะ)
     · นอก scope → ต้องให้ไลน์นั้นกด ✕ คืน หรือรอกะถัดไป (การยืมหมดอายุเองเมื่อเปลี่ยนกะ/วัน ไม่ต้องกดคืน)
     feedback หน้างาน 2026-09-07: "พอจะยืมใหม่มันติดว่ายืมอยู่แล้ว" — ข้อความเดิมไม่บอกว่าไลน์ไหน/ต้องทำอะไร */
  const resolveBorrowConflict = async (emp) => {
    const { data: rows, error } = await supabase.from('line_helpers')
      .select('id, to_line_id, created_by_name')
      .eq('work_date', shiftInfo.workDateStr).eq('shift', shiftInfo.shift).eq('employee_id', emp.id).limit(1);
    const cur = rows?.[0];
    if (error || !cur) { toast.error(`${emp.name} ${tr("ถูกยืมตัวไปไลน์อื่นแล้วในกะนี้ — ต้องให้ไลน์นั้นกด ✕ คืนก่อน หรือรอกะถัดไป")}`); return; }
    const curLine = lines.find(l => l.id === cur.to_line_id)?.name || 'ไลน์อื่น';
    const by = cur.created_by_name ? ` (${cur.created_by_name} ${tr("ยืม")})` : '';
    const target = lines.find(l => l.id === Number(borrowLineId))?.name || 'ไลน์ที่เลือก';
    if (Number(borrowLineId) === cur.to_line_id) { toast.info(`${emp.name} ${tr("ถูกยืมมา")} ${curLine} ${tr("อยู่แล้วในกะนี้")}`); return; }
    const canMove = scopedLines.some(l => l.id === cur.to_line_id);
    if (!canMove) {
      toast.error(`${emp.name} ${tr("ถูกยืมไป")} ${curLine}${by} ${tr("แล้วในกะนี้ — ให้ไลน์นั้นกด ✕ คืนก่อน หรือรอกะถัดไป (การยืมหมดอายุเองเมื่อเปลี่ยนกะ ไม่ต้องกดคืน")})`);
      return;
    }
    if (!await askConfirm(`${emp.name} ${tr("ถูกยืมไป")} ${curLine}${by} ${tr("แล้วในกะนี้\\nย้ายมาช่วย")} ${target} ${tr("แทน")}?`)) return;
    const { data: moved, error: mErr } = await supabase.from('line_helpers')
      .update({ to_line_id: Number(borrowLineId), created_by_name: fullName || null })
      .eq('id', cur.id).select('id');
    if (mErr || !moved?.length) { toast.error((tr('ย้ายการยืมไม่สำเร็จ') + ': ') + (mErr?.message || 'ไม่มีแถวถูกแก้ (สิทธิ์?)')); return; }
    toast.success(`🤝 ${tr("ย้าย")} ${emp.name} ${tr("จาก")} ${curLine} ${tr("มาช่วย")} ${target} ${tr("แล้ว")}`);
    notifyBorrowed(emp, borrowLineId);
    setShowBorrowModal(false);
    fetchData();
  };

  /* 📊 เปิดแผงสะสม "คนของเราถูกยืมออกไปกี่วัน" — ช่วง 30 วันทำงานล่าสุด (คงที่ · หน้านี้ไม่มี
     ตัวกรองช่วงเวลา และกฎ CLAUDE.md ห้ามยัด <TimeRangeBar> ลงหน้าที่ไม่มีแกนเวลาจริง)
     🔴 เลือกคอลัมน์เท่าที่ใช้ (กฎ egress) · อ่านไม่ได้/ไม่ครบ = เขียนบนจอ ห้ามโชว์ 0 เงียบ ๆ
     🔴 "ของเรา" = คนในรายชื่อที่จอโหลดมา (= ขอบเขตบัญชีเดิมเป๊ะ ไม่ได้ขยายสิทธิ์)
        **ตัดคนที่ถูกยืมเข้ามาออก** — เขาไม่ใช่คนของเรา แค่มายืนกะนี้ */
  const openBorrowSummary = async () => {
    setShowBorrowSum(true);
    if (borrowSumLoading) return;
    setBorrowSumLoading(true);
    setBorrowSumErr('');
    const win = borrowWindow(BORROW_WINDOW_DAYS);
    if (!win.from) {                       // แกะวันไม่ออก = ไม่คิดเอง (ห้ามเดาเป็นช่วงอื่น)
      setBorrowSumErr('คำนวณช่วงวันไม่ได้ — ลองเปิดใหม่อีกครั้ง');
      setBorrowSum(null); setBorrowSumLoading(false);
      return;
    }
    const { rows, error, truncated } = await fetchAllPages(() => supabase.from('line_helpers')
      .select('employee_id, to_line_id, work_date, shift, emp_name, to_line_name')
      .gte('work_date', win.from).lte('work_date', win.to));
    if (error) {
      setBorrowSumErr(error.includes('does not exist')
        ? 'ยังไม่ได้ apply migration 20260819_line_helpers_main (แจ้ง admin)'
        : (tr('อ่านประวัติการยืมตัวไม่สำเร็จ') + ': ') + error);
      setBorrowSum(null); setBorrowSumLoading(false);
      return;
    }
    const empById = new Map(employees.map(e => [e.id, e]));
    const sum = summarizeBorrowOut(rows, {
      homeLineOf: (id) => empById.get(id)?.line_id ?? null,
      familyOf:   (id) => getLineFamilyIds(lines, Number(id)),
      nameOf:     (id) => empById.get(id)?.name,
      lineNameOf: (id) => lines.find(l => l.id === Number(id))?.name,
      mine:       (id) => { const e = empById.get(id); return !!e && !e._helperRowId; },
    });
    setBorrowSum({ ...sum, ...win, truncated, scanned: rows.length });
    setBorrowSumLoading(false);
  };

  const unborrowEmployee = async (emp) => {
    if (!emp._helperRowId) return;
    if (!await askConfirm(`${tr("คืน")} ${emp.name} ${tr("กลับไลน์เดิม")} (${emp._helperFrom})?`)) return;
    const { error } = await supabase.from('line_helpers').delete().eq('id', emp._helperRowId);
    if (error) { toast.error((tr('ยกเลิกยืมตัวไม่สำเร็จ') + ': ') + error.message); return; }
    toast.success(`${tr("คืน")} ${emp.name} ${tr("กลับไลน์เดิมแล้ว")}`);
    fetchData();
  };

  /* 🧾 แถวที่เขียนลง `daily_production_logs` — สูตรอยู่ `src/lib/checkinSave.js` **ที่เดียว**
     ใช้ร่วมกับ `/scan` (ยิงบัตรใบเดียวแล้วจบ) ⇒ 2 ประตูเขียนฟิลด์ชุดเดียวกันเป๊ะ */
  const ckLogRow = (emp, rec, userId) => checkinLogRow({
    emp, rec, workDateStr: shiftInfo.workDateStr, shift: emp.assignedShift || shiftInfo.shift, userId,
  });

  const handleSave = async () => {
    setConfirmSave(false);
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) { toast.error('กรุณา Login ก่อน'); setIsSaving(false); return; }

    const { workDateStr } = shiftInfo;
    // บันทึกเฉพาะรายชื่อที่แสดงบนจอ (displayed) ไม่ใช่ roster ที่โหลดมาทั้งหมด —
    // ไม่งั้นหัวหน้ากะเช้าเปิดหน้าค้างแล้วกดบันทึกตอนเย็น จะทับเช็คชื่อกะดึก/ส่วนอื่นกลับเป็น "ไม่มา"
    // (สรุปยอด + modal ยืนยัน อ้าง displayed อยู่แล้ว — เขียนให้ตรงกัน)
    /* 🔒 คนที่ถูกยืมออกไปไลน์อื่นกะนี้ = ไลน์ที่ยืมบันทึกฝั่งเดียว ⇒ ข้ามทั้งเช็คชื่อและจองรถ OT (19/11 · คำสั่ง user) */
    const savable = displayed.filter(emp => !emp._helperOutTo);
    const skippedOut = displayed.length - savable.length;
    const logs = savable.map(emp => ckLogRow(emp, attendance[emp.id] || {}, userData.user.id));

    const { error } = await supabase
      .from('daily_production_logs')
      .upsert(logs, { onConflict: 'work_date,employee_id' });

    if (error) { toast.error((tr('เกิดข้อผิดพลาด') + ': ') + error.message); setIsSaving(false); return; }

    /* ── บันทึกการจอง OT (สำหรับธุรการจองรถรับส่ง) ──
       กะดึก: จองล่วงหน้าว่าจะมาทำ OT คืนวันถัดไป (checkbox 🚐 OT พรุ่งนี้) → work_date = วันถัดไป, shift='night'
       กะเช้า: OT จริงของวันนี้ (has_ot) → work_date = วันนี้, shift='day' */
    {
      const isNightShift = shiftInfo.shift === 'night';
      const bookDate = isNightShift ? addDaysToDateStr(workDateStr, 1) : workDateStr;
      const otShift  = isNightShift ? 'night' : 'day';
      const bookDateIsHoliday = isHolidayDate(bookDate);
      const isBooked = emp => isNightShift ? !!otBookings[emp.id] : !!attendance[emp.id]?.has_ot;

      const toBook   = savable.filter(isBooked).map(emp => emp.id);
      const toUnbook = savable.filter(emp => !isBooked(emp)).map(emp => emp.id);

      if (toBook.length) {
        const { error: eBook } = await supabase.from('ot_night_bookings').upsert(
          toBook.map(empId => ({
            work_date:      bookDate,
            shift:          otShift,
            employee_id:    empId,
            task_type_id:   otTasks[empId] || null,
            ot_period:      bookDateIsHoliday ? (otPeriods[empId] || defaultHolidayPeriod(otShift)) : null,
            booked_by:      userData.user.id,
            booked_by_name: fullName || null,
          })),
          { onConflict: 'employee_id,work_date,shift' }
        );
        if (eBook) toast.error((tr('จองรถ OT บางรายการไม่สำเร็จ') + ': ') + eBook.message);
      }
      if (toUnbook.length) {
        const { error: eUnbook } = await supabase.from('ot_night_bookings')
          .delete()
          .eq('work_date', bookDate)
          .eq('shift', otShift)
          .in('employee_id', toUnbook);
        if (eUnbook) toast.error((tr('ยกเลิกจองรถ OT บางรายการไม่สำเร็จ') + ': ') + eUnbook.message);
      }
    }

    /* ── บันทึกการจองรถ "ล่วงหน้าเพิ่ม" สำหรับวันหยุดต่อเนื่อง (extraAdvanceDates) ── */
    if (extraAdvanceDates.length) {
      const otShift = shiftInfo.shift;
      for (const d of extraAdvanceDates) {
        const isBookedExtra = emp => !!otExtraBookings[emp.id]?.[d];
        const toBookExtra   = savable.filter(isBookedExtra).map(emp => emp.id);
        const toUnbookExtra = savable.filter(emp => !isBookedExtra(emp)).map(emp => emp.id);

        if (toBookExtra.length) {
          checkWrite(await supabase.from('ot_night_bookings').upsert(
            toBookExtra.map(empId => ({
              work_date:      d,
              shift:          otShift,
              employee_id:    empId,
              task_type_id:   otExtraTasks[empId]?.[d] || null,
              ot_period:      otExtraPeriods[empId]?.[d] || defaultHolidayPeriod(otShift), // extraAdvanceDates = วันหยุดเสมอ
              booked_by:      userData.user.id,
              booked_by_name: fullName || null,
            })),
            { onConflict: 'employee_id,work_date,shift' }
          ), 'จองรถ OT ล่วงหน้า');
        }
        if (toUnbookExtra.length) {
          checkWrite(await supabase.from('ot_night_bookings')
            .delete()
            .eq('work_date', d)
            .eq('shift', otShift)
            .in('employee_id', toUnbookExtra), 'ยกเลิกจองรถ OT ล่วงหน้า');
        }
      }
    }

    /* Skill farming (+1 EXP/วัน) ย้ายไปฝั่ง server แล้ว — fn_daily_skill_farm + pg_cron รายวัน
       ห้ามคืนการเขียน employee_skills จาก client ตรงนี้ (เคยเป็นช่อง farm: กดบันทึกซ้ำ = +1 ซ้ำไม่จำกัด
       และเหมาทุกไลน์ทั้งโรงงาน) — ดู CLAUDE.md ส่วน "Employee Skills & EXP Farming" */

    // เช็คชื่อเสร็จแล้วไม่มีอะไรเด้งต่อ (ถอดออโต้เปิดกะออก 16/09) — บอกทางไปต่อให้ชัด ไม่ปล่อยเงียบ
    toast.success((tr('บันทึกเช็คชื่อสำเร็จ! · ไลน์ที่ต้องลงข้อมูลผลิต ไปกด “เปิดกะ” ที่หน้า') + ' Daily Report')
      + (skippedOut ? ` · ${tr("ข้าม")} ${skippedOut} ${tr("คนที่ถูกยืมไปไลน์อื่น (ไลน์ที่ยืมเป็นคนบันทึก")})` : ''));
    if (ckDraftKey) clearDraft(ckDraftKey);

    /* ── สรุปเช็คชื่อเข้า Telegram ──
       ⚠️ ไม่มีการชวน "เปิดกะ Daily Report" ตรงนี้แล้ว (2026-09-16 · คำสั่ง user "ให้เค้าเปิดกันเองดีกว่า")
       เดิมบันทึกเช็คชื่อเสร็จจะเด้ง modal เสนอเปิดกะ **โดยติ๊กไลน์ไว้ให้ครบทุกไลน์** กด "เปิดกะ" ทีเดียว
       = เปิดกะทุกไลน์ที่เช็คชื่อ ⇒ ไลน์ที่ใช้ระบบเช็คชื่อแต่ยังไม่ลงข้อมูลผลิต (PD1: LINE GWM ·
       LINE MAIN TSRA-1/2 · LINE SUB-STATIONARY) ได้กะเปล่าวันละ 1-2 ใบ ค้าง `open` ไม่มีใครปิด
       — วัดจริง 16/09: 4 ไลน์นี้ 32 กะ **เปล่าทั้งหมด** สร้างห่างกัน 0.35 วิ (ลายเซ็นของ modal ไม่ใช่คนกด)
       และรวมทั้งระบบมีกะเปล่า 214/1,382 ใบ (16%) กวาดฐานข้อมูล + โผล่บนจอว่า "🟢 เปิดกะอยู่"
       **การเปิดกะเป็นการตัดสินใจของไลน์ ต้องไปกดเองที่ Daily Report** (ENGINEERING-PRINCIPLES §2:
       ห้ามให้ระบบเดาแล้วเขียนข้อมูลแทนคน) · ล้างของเก่า: `20260916_delete_empty_sessions_dr.sql` ── */
    try {
      const isNight = shiftInfo.shift === 'night';

      // ไลน์ที่ถูกเช็คจริง (อาจมีหลายไลน์ถ้าเลือกทั้ง section)
      // 🤝 คนยืมตัวนับเป็นไลน์ปลายทาง
      const checkedLineIds = [...new Set(displayed.map(emp => emp._helperToLineId || emp.line_id).filter(Boolean))];
      const checkedLines = lines.filter(l => checkedLineIds.includes(l.id));
      const lineNamesText = checkedLines.map(l => l.name).join(', ') || (selSection ? `Section: ${selSection}` : 'ทุกไลน์');

      // มีคนจอง OT กะดึกไหม — ใช้บอกเวลาเริ่มงานในสรุป Telegram (เทียบด้วย line_id ดิบเหมือนเดิม)
      const anyOtNight = isNight && displayed.some(e =>
        checkedLineIds.includes(e.line_id) && attendance[e.id]?.is_present && attendance[e.id]?.has_ot
      );

      const hasOtNight = anyOtNight;
      const startTime  = !isNight ? '08:00' : (hasOtNight ? '20:00' : '22:30');

      // summary สำหรับ Telegram
      const shown = displayed;
      const present = shown.filter(e => attendance[e.id]?.is_present).length;
      const absent  = shown.filter(e => attendance[e.id] && !attendance[e.id].is_present && !attendance[e.id].leave_type).length;
      const leave   = shown.filter(e => attendance[e.id]?.leave_type).length;
      const ot      = shown.filter(e => attendance[e.id]?.has_ot).length;

      /* ── แยกประเภทแจ้งเตือนตามสิ่งที่เปลี่ยนจริงในการบันทึกครั้งนี้ ──
         ปุ่ม "บันทึก" ตัวเดียวทำ 3 อย่าง (เช็คชื่อ / แก้กำลังคน / จองรถ OT) — เดิมยิง
         checkin_summary ทุกครั้ง หัวหน้าแผนกเลยงงว่าหัวหน้ากลุ่มเช็คชื่อซ้ำ ทั้งที่จริง
         แค่มาลงจอง OT ระหว่างวัน · แยกเป็น 3 event: checkin_summary / checkin_update / ot_booking */
      const displayedIds = shown.map(e => e.id);
      const hadAnyLog = displayedIds.some(id => baseline.logIds.has(id));
      const attKey = (r = {}) => JSON.stringify([
        !!r.is_present, !!r.has_helmet, !!r.has_boots, !!r.has_gloves,
        r.leave_type || '', r.leave_duration || '', r.leave_period || '', String(r.leave_hours ?? ''),
      ]);
      const attChanged = displayedIds.some(id => attKey(attendance[id]) !== attKey(baseline.att[id]));

      // จอง OT: กะดึกใช้ checkbox (otBookings) · กะเช้าใช้ has_ot — เทียบทั้งสถานะจอง งาน และช่วงเวลา
      const wasBooked = id => isNight ? !!baseline.otBook[id] : !!baseline.att[id]?.has_ot;
      const nowBooked = id => isNight ? !!otBookings[id]      : !!attendance[id]?.has_ot;
      const otChanged = displayedIds.some(id =>
        wasBooked(id) !== nowBooked(id) ||
        (nowBooked(id) && ((otTasks[id] || '') !== (baseline.otTask[id] || '') ||
                           (otPeriods[id] || '') !== (baseline.otPeriod[id] || ''))));

      const post = (event, payload) => fetch(`https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ event, ...payload }),
      }).catch(() => {}); // fire-and-forget, ไม่บล็อก

      if (!hadAnyLog) {
        // ครั้งแรกของวัน = เช็คชื่อเริ่มงาน (แบบเดิม)
        post('checkin_summary', { summary: {
          line_name: lineNamesText, shift: shiftInfo.shift, shift_label: shiftInfo.label,
          work_date: workDateStr, start_time: startTime, has_ot_night: hasOtNight,
          total: shown.length, present, absent, leave, ot, checked_by: fullName || 'SV',
        } });
      } else if (attChanged) {
        // เคยเช็คชื่อไปแล้ว + ข้อมูลกำลังคนเปลี่ยน = อัพเดทกำลังคนระหว่างวัน
        const changed = shown.filter(e => attKey(attendance[e.id]) !== attKey(baseline.att[e.id]));
        const changedNames = changed.slice(0, 15).map(e => {
          const st = getRowStatus(attendance[e.id]);
          return `• ${e.name} — ${STATUS_META[st]?.label || (attendance[e.id]?.is_present ? tr('มา') : tr('ขาด'))}`;
        }).join('\n') + (changed.length > 15 ? `\n…${tr("และอีก")} ${changed.length - 15} ${tr("คน")}` : '');
        post('checkin_update', { summary: {
          line_name: lineNamesText, shift: shiftInfo.shift, shift_label: shiftInfo.label,
          work_date: workDateStr, total: shown.length, present, absent, leave, ot,
          checked_by: fullName || 'SV', changed_count: changed.length, changed_names: changedNames,
        } });
      }

      if (otChanged) {
        // จองรถ OT — แจ้งรายละเอียด ใครทำ OT / งานอะไร / ช่วงเวลาไหน (สำหรับวันจองหลักของกะนี้)
        const bookDate = isNight ? addDaysToDateStr(workDateStr, 1) : workDateStr;
        const otShift  = isNight ? 'night' : 'day';
        const bookHoliday = isHolidayDate(bookDate);
        const bookedEmps = shown.filter(e => nowBooked(e.id));
        const taskName = id => taskTypes.find(t => String(t.id) === String(otTasks[id]))?.name || '';
        const timeOf   = id => bookHoliday ? otPeriodLabel(otPeriods[id] || defaultHolidayPeriod(otShift)) : WEEKDAY_OT_TIME[otShift];
        const items = bookedEmps.map(e => {
          const meta = [taskName(e.id), timeOf(e.id)].filter(Boolean).join(' · ');
          return `• ${e.name}${meta ? ` — ${meta}` : ''}`;
        }).join('\n');
        post('ot_booking', { booking: {
          line_name: lineNamesText, work_date: bookDate, date_label: shortDateLabel(bookDate),
          shift: otShift, shift_label: otShift === 'night' ? '🌙 กะดึก' : tr("☀️ กะเช้า"),
          count: bookedEmps.length, booked_by: fullName || 'SV', items,
        } });
      }

      // อัพเดท baseline เป็นสถานะล่าสุด — บันทึกครั้งถัดไปเทียบจากตรงนี้ (กันแจ้งซ้ำ)
      setBaseline({
        logIds: new Set([...baseline.logIds, ...displayedIds]),
        att: JSON.parse(JSON.stringify(attendance)),
        otBook: { ...otBookings }, otTask: { ...otTasks }, otPeriod: { ...otPeriods },
      });
    } catch (_) { /* non-critical */ }

    setIsSaving(false);
  };

  /* ── จองรถ OT แบบอิสระ: เลือกวันที่/กะ/ไลน์/ทีมเองได้ ไม่ผูกกับกะที่กำลังเช็คชื่ออยู่
     ใช้กรณีทีมที่ต้องจอง OT ไม่ใช่ทีมที่กำลังเช็คชื่ออยู่ตรงหน้า (เช่น จันทร์แรกหลังสลับกะ) ── */
  const otBookLineOptions = [...new Map(employees.filter(e => e.line_id).map(e => [e.line_id, e])).values()]
    .map(e => lines.find(l => l.id === e.line_id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  const otBookEmpOptions = employees.filter(e =>
    (!otBookLineId || String(e.line_id) === String(otBookLineId)) &&
    (!otBookTeam || e.team === otBookTeam)
  );

  const loadOtBookExisting = async (date, shift) => {
    if (!date || !shift) return;
    setOtBookLoading(true);
    const { data } = await supabase.from('ot_night_bookings').select('employee_id, task_type_id, ot_period').eq('work_date', date).eq('shift', shift);
    const sel = {}; const tasks = {}; const periods = {};
    (data || []).forEach(r => {
      sel[r.employee_id] = true;
      if (r.task_type_id) tasks[r.employee_id] = r.task_type_id;
      if (r.ot_period)    periods[r.employee_id] = r.ot_period;
    });
    setOtBookSelections(sel);
    setOtBookTasks(tasks);
    setOtBookPeriods(periods);
    setOtBookLoading(false);
  };

  const openOtBookModal = () => {
    setOtBookDate(toLocalDateStr(new Date()));
    setOtBookShift('night');
    setOtBookLineId(lineId || '');
    setOtBookTeam(team || '');
    setShowOtBookModal(true);
    loadOtBookExisting(toLocalDateStr(new Date()), 'night');
  };

  const handleSaveOtBookModal = async () => {
    if (!otBookDate || !otBookShift) { toast.error('เลือกวันที่และกะก่อน'); return; }
    setOtBookSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const toBook   = otBookEmpOptions.filter(e => otBookSelections[e.id]).map(e => e.id);
      const toUnbook = otBookEmpOptions.filter(e => !otBookSelections[e.id]).map(e => e.id);

      const otBookDateIsHoliday = isHolidayDate(otBookDate);
      if (toBook.length) {
        const { error } = await supabase.from('ot_night_bookings').upsert(
          toBook.map(empId => ({
            work_date:      otBookDate,
            shift:          otBookShift,
            employee_id:    empId,
            task_type_id:   otBookTasks[empId] || null,
            ot_period:      otBookDateIsHoliday ? (otBookPeriods[empId] || defaultHolidayPeriod(otBookShift)) : null,
            booked_by:      userData?.user?.id || null,
            booked_by_name: fullName || null,
          })),
          { onConflict: 'employee_id,work_date,shift' }
        );
        if (error) throw error;
      }
      if (toUnbook.length) {
        const { error } = await supabase.from('ot_night_bookings')
          .delete()
          .eq('work_date', otBookDate)
          .eq('shift', otBookShift)
          .in('employee_id', toUnbook);
        if (error) throw error;
      }
      toast.success(`${tr("บันทึกการจองรถ OT วันที่")} ${otBookDate} ${tr("แล้ว")} (${toBook.length} ${tr("คน")})`);
      setShowOtBookModal(false);
    } catch (e) {
      toast.error((tr('บันทึกไม่สำเร็จ') + ': ') + e.message);
    } finally {
      setOtBookSaving(false);
    }
  };

  /* ── Export: ฟอร์มกระดาษจริง (ใบขออนุมัติ OT + บันทึกการมาทำงาน) ─── */
  const ATT_CODE = { 'ลากิจ': 'ก', 'ลาป่วย': 'ป', 'ลาพักร้อน': 'ส' };

  const handleExportForms = async () => {
    setExporting(true);
    try {
      const [y, m] = exportMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const dayFrom = exportHalf === '1-15' ? 1 : 16;
      const dayTo   = exportHalf === '1-15' ? 15 : lastDay;
      const dateFrom = `${exportMonth}-${String(dayFrom).padStart(2, '0')}`;
      const dateTo   = `${exportMonth}-${String(dayTo).padStart(2, '0')}`;
      const days = [];
      for (let d = dayFrom; d <= dayTo; d++) days.push(d);

      // 🔴 ไม่กรอง staff_kind — ใบ export ต้องตรงกับรายชื่อที่เช็คชื่อบนจอ (14/10)
      let empQ = supabase.from('employees').select('id, employee_id_code, name, position, line_id, section, staff_kind').eq('is_active', true).order('employee_id_code');
      // mandatory scope filter ก่อน แล้วค่อยกรองตามส่วนงานที่เลือกใน modal (pattern เดียวกับ fetchData)
      // 🔴 ลำดับเดียวกับ fetchData — ห้าม else-if (leader ไม่มีไลน์ต้องถอยมาใช้ส่วนงาน · 19/10)
      /* 🔭 ของกลางชุดเดียวกับ fetchData (กวาดรอบ 3) — ลำดับ 2 แกนเหมือนเดิม */
      const scX = lineScope({ role, lineId, sections: scopeSecs, lines, scopeIdx });
      const famIdsX = scX.unlimited ? null
        : new Set((lines || []).filter(l => new Set(scX.names).has(l.name)).map(l => l.id));
      if (famIdsX && famIdsX.size) {   // ทั้งครอบครัวไลน์ (ตัวเอง + แม่ + ลูก) — ห้ามกรอง line_id ตรงตัว
        empQ = empQ.in('line_id', [...famIdsX]);
      } else if (scopeSecs.length) {
        const orX = empScopeOrFilter(viewScope, scopeLineIds(viewScope, lines || []));
        if (orX) empQ = empQ.or(orX);
      }
      if (role === 'leader') {
        // ⚠️ ทีมที่ไม่หมุนกะ (C) = หัวหน้าที่ไม่ได้ยืนหน้างาน → เห็นคนทั้งไลน์ทุกทีม
        //    (ขอบเขตไลน์ยังคุมอยู่ · ปลดเฉพาะแกนทีม — ดู seesAllTeams ใน shiftAssign.js)
        // 🔴 ทีมตัวเอง + ทีมที่ไม่หมุนกะ (C) — พนักงานทีม C = กะเช้าตลอด ยืนหน้างานกับทีมที่เข้าเช้า
        //    เดิม `.eq('team', team)` ทำให้คนทีม C หายจากใบเช็คชื่อของหัวหน้าทีม A/B ทั้งคู่
        //    (2 คนไม่เคยถูกเช็คชื่อเลย — ดูเหตุผลเต็มที่ teamsVisibleToLeader ใน shiftAssign.js)
        const teamsSeen = teamsVisibleToLeader(team);
        if (teamsSeen) empQ = empQ.in('team', teamsSeen);
      }
      const { data: empData } = await empQ;
      const lineIds = exportSection ? lines.filter(l => l.section === exportSection).map(l => l.id) : null;
      const scopedEmp = (empData || []).filter(e => !lineIds || lineIds.includes(e.line_id));
      if (!scopedEmp.length) { toast.error('ไม่พบพนักงานในส่วนงานนี้'); setExporting(false); return; }
      /* 🔴 เรียงกลุ่มให้ตรงกับลำดับบนจอ (หน้างาน → ช่าง → สนับสนุน · 14/10)
         คนกาช่องตามลำดับแถวที่เห็นบนจอ ⇒ กระดาษสลับลำดับ = กาผิดคน */
      scopedEmp.sort((a, b) => GROUP_ORDER.indexOf(staffGroupOf(a)) - GROUP_ORDER.indexOf(staffGroupOf(b))
        || String(a.employee_id_code || '').localeCompare(String(b.employee_id_code || '')));

      /* 🔴 ใบนี้ถูกพิมพ์ไปเซ็น (บันทึกการมาทำงาน / ชดเชย-OT ที่ register ใน doc_forms)
         ⇒ ข้อมูลขาด = ช่องวันเข้างานว่าง = อ่านว่า "ขาดงาน" ทั้งที่มาทำงานจริง (audit 2026-09-02)
         เดิมพังได้ 2 ทางพร้อมกัน:
           • `.in()` กับ ~300 uuid = URL ~12,000 ตัวอักษร (ปลอดภัยที่ ~120 id) → proxy ตัด คิวรีล้มเงียบ
           • `.limit(10000)` ใช้ไม่ได้จริง — PostgREST clamp 1000 · 300 คน × 16 วัน ≈ 4,800 แถว
         → fetchByIds ทำครบ 3 ชั้น (ก้อน id + แบ่งหน้า + order คงที่)
         **โหลดไม่ครบ = ไม่ยอมพิมพ์** (ใบที่ผิดแล้วมีลายเซ็นอนุมัติ แย่กว่าไม่ได้ใบ) */
      const logRes = await fetchByIds(scopedEmp.map(e => e.id), (c) => supabase
        .from('daily_production_logs')
        .select('employee_id, work_date, is_present, has_ot, has_extended_ot, leave_type, shift')
        .gte('work_date', dateFrom).lte('work_date', dateTo)
        .in('employee_id', c));
      if (logRes.error || logRes.truncated) {
        toast.error('โหลดข้อมูลการมาทำงานไม่ครบ — ยังพิมพ์ไม่ได้ (ใบจะขึ้นว่า "ขาดงาน" ผิด) ลองลดช่วงวันที่ หรือเลือกส่วนงานให้แคบลง');
        setExporting(false); return;
      }
      const logData = logRes.rows;

      const logsByEmp = {};
      (logData || []).forEach(l => {
        if (!logsByEmp[l.employee_id]) logsByEmp[l.employee_id] = {};
        logsByEmp[l.employee_id][l.work_date] = l;
      });

      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const { registerThaiFont } = await import('../lib/pdfThaiFont');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      registerThaiFont(doc);
      const deptLabel = exportSection || tr("ทุกส่วนงาน");

      // เลขฟอร์ม/Rev/ป้ายช่องลายเซ็น/legend อ่านจากทะเบียนเอกสารกลาง (/doc-forms) — fallback = ค่าเดิมในโค้ด
      // จำนวนช่องลายเซ็นต้องเท่า layout เดิมเสมอ (ทะเบียนเปลี่ยนได้เฉพาะข้อความ) → fitSigs ตัด/เติมให้ครบ
      const [dfOt, dfAtt] = await Promise.all([
        getDocForm('ot_compensation_report', {
          title: 'ใบรายงานการปฏิบัติงานชดเชย / ทำ OT',
          sig_blocks: ['ผู้บันทึก', 'ผู้ตรวจสอบ', 'ผู้อนุมัติแผนก', 'ผู้อนุมัติฝ่าย HRM'],
        }),
        getDocForm('attendance_record', {
          title: 'บันทึกการมาทำงาน',
          sig_blocks: ['ผู้บังคับบัญชา / หัวหน้างาน', 'ผู้ตรวจสอบ (HRM)'],
          legend: 'สัญลักษณ์ :  / = มาทำงาน   ขาด = ขาดงาน   ก = ลากิจ   ป = ลาป่วย   ส = ลาพักร้อน   /OT = ทำ OT ปกติ   /OT+ = ทำ OT ขยาย (23:00 น.)',
        }),
      ]);
      const fitSigs = (df, fb) => fb.map((t, i) => (df.sig_blocks?.[i] ?? t));
      const stampCode = (df) => {
        const code = [fullCode(df), df.effective_date ? `Effective: ${df.effective_date}` : ''].filter(Boolean).join(' · ');
        if (!code) return;                       // ทะเบียนยังไม่ตั้งเลขฟอร์ม = หน้าตาเดิมเป๊ะ
        doc.setFontSize(7); doc.setFont('Sarabun', 'normal');
        doc.text(code, 283, 203, { align: 'right' });
      };

      /* ── Form 1: ใบรายงานการปฏิบัติงานชดเชย/ทำ OT (ฟอร์ม 2) ───── */
      let y0 = 10;
      doc.setFontSize(11); doc.setFont('Sarabun', 'bold');
      doc.text('บริษัท ไทยซัมมิทออโตพาร์ท จำกัด', 14, y0);
      doc.setFontSize(13);
      doc.text(dfOt.title || 'ใบรายงานการปฏิบัติงานชดเชย / ทำ OT', 148, y0, { align: 'center' });
      y0 += 6;
      doc.setFontSize(9); doc.setFont('Sarabun', 'normal');
      doc.text(`${tr("แผนก/ส่วนงาน")}: ${deptLabel}`, 14, y0);
      doc.text(`${tr("เดือน")}: ${m}  ${tr("ปี")} ${y + 543}   ${tr("ช่วงวันที่")} ${dayFrom}-${dayTo}`, 148, y0, { align: 'center' });
      doc.text(`${tr("ชุดที่")} 02`, 270, y0, { align: 'right' });

      const otHead = [['ลำดับ', 'เลขที่พนักงาน', 'ชื่อ-สกุล', ...days.map(String), 'รวม (ชม.)']];
      const otRows = scopedEmp.map((e, i) => {
        const logs = logsByEmp[e.id] || {};
        let total = 0;
        const cells = days.map(d => {
          const dateStr = `${exportMonth}-${String(d).padStart(2, '0')}`;
          const log = logs[dateStr];
          if (!log) return '';
          // ชั่วโมง OT = ของกลาง utils/otCost.js (26/11 — เดิมเขียน 2/5/2 ไว้ที่นี่ · บอร์ด Obeya แกน C ใช้ตัวเดียวกัน)
          const hrs = otHoursOfLog(log);
          total += hrs;
          return hrs ? String(hrs) : '';
        });
        return [i + 1, e.employee_id_code, e.name, ...cells, total || ''];
      });

      autoTable(doc, {
        head: otHead, body: otRows, startY: y0 + 4,
        styles: { font: 'Sarabun', fontSize: 6.5, halign: 'center', cellPadding: 1 },
        headStyles: { font: 'Sarabun', fillColor: [40, 60, 90], fontSize: 6.5 },
        columnStyles: { 2: { halign: 'left', cellWidth: 32 } },
        margin: { left: 14, right: 14 },
      });

      let yAfter = doc.lastAutoTable.finalY + 6;
      doc.setFontSize(7.5);
      [
        'หมายเหตุ:',
        '1. วันที่ 1-15 อยู่ในรอบจ่ายค่าตอบแทนวันที่ 22 ของเดือน',
        '2. วันที่ 16-สิ้นเดือน อยู่ในรอบจ่ายค่าตอบแทนวันที่ 7 ของเดือนถัดไป',
        '3. กรณีลา/ฝึกอบรมข้ามวัน ให้บันทึกในวันที่เกิดขึ้นจริง',
        '4. ชั่วโมง OT นับเฉพาะที่ได้รับอนุมัติให้ปฏิบัติงานจริง',
      ].forEach((t, i) => { doc.text(t, 14, yAfter + i * 4); });

      const sigY = yAfter + 26;
      const sigBoxes = fitSigs(dfOt, ['ผู้บันทึก', 'ผู้ตรวจสอบ', 'ผู้อนุมัติแผนก', 'ผู้อนุมัติฝ่าย HRM']);
      sigBoxes.forEach((label, i) => {
        const x = 14 + i * 68;
        doc.rect(x, sigY, 60, 22);
        doc.setFontSize(7.5);
        doc.text(label, x + 30, sigY + 18, { align: 'center' });
        doc.text('ลงชื่อ ......................................', x + 30, sigY + 8, { align: 'center' });
      });

      stampCode(dfOt);

      /* ── Form 2: บันทึกการมาทำงาน (รายเดือน) ───────────────────── */
      doc.addPage();
      let y1 = 10;
      doc.setFontSize(11); doc.setFont('Sarabun', 'bold');
      doc.text('บริษัท ไทยซัมมิทออโตพาร์ท จำกัด', 14, y1);
      doc.setFontSize(13);
      doc.text(dfAtt.title || 'บันทึกการมาทำงาน', 148, y1, { align: 'center' });
      y1 += 6;
      doc.setFontSize(9); doc.setFont('Sarabun', 'normal');
      doc.text(`${tr("แผนก")}: ${deptLabel}`, 14, y1);
      doc.text(`${tr("เดือน")} ${m} ${tr("ปี")} ${y + 543}   ${tr("วันที่")} ${dayFrom}-${dayTo}`, 148, y1, { align: 'center' });

      const attHead = [['ลำดับ', 'เลขที่พนักงาน', 'ชื่อ-สกุล', ...days.map(String)]];
      const attRows = scopedEmp.map((e, i) => {
        const logs = logsByEmp[e.id] || {};
        const cells = days.map(d => {
          const dateStr = `${exportMonth}-${String(d).padStart(2, '0')}`;
          const log = logs[dateStr];
          if (!log) return '';
          if (log.leave_type) return ATT_CODE[log.leave_type] || 'ล';
          if (!log.is_present) return tr("ขาด");
          if (log.has_extended_ot) return '/OT+';
          if (log.has_ot) return '/OT';
          return '/';
        });
        return [i + 1, e.employee_id_code, e.name, ...cells];
      });

      autoTable(doc, {
        head: attHead, body: attRows, startY: y1 + 4,
        styles: { font: 'Sarabun', fontSize: 6.5, halign: 'center', cellPadding: 1 },
        headStyles: { font: 'Sarabun', fillColor: [40, 60, 90], fontSize: 6.5 },
        columnStyles: { 2: { halign: 'left', cellWidth: 32 } },
        margin: { left: 14, right: 14 },
      });

      const legendY = doc.lastAutoTable.finalY + 6;
      doc.setFontSize(7.5);
      doc.text(dfAtt.legend, 14, legendY);

      const sigY2 = legendY + 16;
      fitSigs(dfAtt, ['ผู้บังคับบัญชา / หัวหน้างาน', 'ผู้ตรวจสอบ (HRM)']).forEach((label, i) => {
        const x = 14 + i * 100;
        doc.rect(x, sigY2, 90, 22);
        doc.setFontSize(7.5);
        doc.text(label, x + 45, sigY2 + 18, { align: 'center' });
        doc.text('ลงชื่อ ......................................', x + 45, sigY2 + 8, { align: 'center' });
      });

      stampCode(dfAtt);

      doc.save(`attendance_forms_${exportMonth}_${exportHalf}${exportSection ? '_' + exportSection : ''}.pdf`);
      toast.success('สร้างไฟล์ PDF สำเร็จ');
      setShowExport(false);
    } catch (err) {
      console.error(err);
      toast.error((tr('สร้าง PDF ไม่สำเร็จ') + ': ') + err.message);
    } finally {
      setExporting(false);
    }
  };

  // กรอง dropdown ตาม scope (leader→family · role อื่น→sections · admin/qa→ทั้งหมด) — กันเห็นส่วนงาน/ไลน์ข้าม scope
  const sectionsAll = orgSections.length ? orgSections : sortLike(lines.map(l => l.section), orgSections);
  const sections = scopeSecs.length ? sectionsAll.filter(s => inSectionScope(scopeSecs, s)) : sectionsAll;
  /* 🔭 ของกลาง (กวาดรอบ 3) — ลิสต์ไลน์ใน dropdown = ขอบเขตเดียวกับข้อมูล */
  const scopeDrop = lineScope({ role, lineId, sections: scopeSecs, lines, scopeIdx });
  const scopedLines = scopeDrop.unlimited ? lines
    : (lines.filter(l => new Set(scopeDrop.names).has(l.name)).length
      ? lines.filter(l => new Set(scopeDrop.names).has(l.name))
      : (scopeSecs.length ? lines.filter(l => inSectionScope(scopeSecs, l.section)) : lines));
  const linesForSection = selSection ? scopedLines.filter(l => l.section === selSection) : scopedLines;

  // เลือกไลน์ = มองแบบเป็นขั้น (hierarchy): ไลน์หลักเห็นรวมพนักงานของไลน์ย่อยทุกไลน์,
  // ไลน์ย่อยเห็นของตัวเอง + พนักงานที่ผูกกับไลน์หลัก (พื้นที่เดียวกัน) — ไม่ใช่กรอง line_id ตรงเป๊ะ
  const selLineFamilyIds = selLine ? getLineFamilyIds(lines, Number(selLine)) : null;

  // "ทุกไลน์ใน section" ต้องขยายเป็นครอบครัวไลน์แบบเดียวกับตอนเลือกไลน์เจาะจง —
  // ไลน์แม่/ไลน์ย่อยบางไลน์ไม่ได้กรอก section ของตัวเอง ถ้ากรองแค่ section ตรงเป๊ะ
  // พนักงานที่ผูกกับไลน์เหล่านั้นจะหายทั้งที่เลือกไลน์ตรงๆ แล้วเห็น (เคยเกิดกับไลน์ย่อยที่มี
  // section แต่ไลน์แม่ไม่มี — เลือกไลน์ย่อยเจอคน เลือกทุกไลน์กลับว่าง)
  const sectionFamilyIds = selSection ? (() => {
    const s = new Set();
    linesForSection.forEach(l => { getLineFamilyIds(lines, l.id).forEach(id => s.add(id)); });
    return s;
  })() : null;

  // 🤝 คนที่ถูกยืมตัวมา ให้ตัวกรองไลน์/section มองเป็น "ไลน์ปลายทาง" ไม่ใช่ไลน์เดิม
  const effLineIdOf = (emp) => emp._helperToLineId || emp.line_id;

  /* ── 🧭 "ตัวกรองไลน์ซ่อนใครได้" = ของกลาง `utils/lineAxisFilter.js` (2026-11-16) ─────────
     เดิมถาม `selLineFamilyIds.has(line_id)` ตรงๆ ⇒ พอค่าตั้งต้น "ไลน์ตัวเอง" (13/11) ทำงาน
     **สายสนับสนุน/ช่าง/คนที่ยังไม่ผูกไลน์ หายทั้งกองอย่างเงียบ ๆ** — หน้างานแจ้ง 16/11
     *"พนักงานออฟฟิศ บางทีก็โชว์ บางทีก็ไม่โชว์ ตอนนี้ไม่โชว์เลย"* (วัดจริง: support 64 คน /
     13 คนไม่มี line_id · technician 22 · shopfloor ยังไม่ผูกไลน์ 4) ⇒ ขัดกฎของหน้านี้เอง
     (บรรทัด ~338 "จอเช็คชื่อต้องเห็นครบทุกกลุ่ม แยกหัวข้อตอนวาดแทน")
     🔴 ไม่ได้ถอด `defaultLineFilter` และไม่ได้ขยายขอบเขตสิทธิ์ — คนหน้างานไลน์อื่นยังถูกซ่อน
        เหมือนเดิมเป๊ะ · คนที่แกนไลน์อธิบายไม่ได้ ตัดด้วย "ส่วนงาน" ของครอบครัวไลน์ที่เลือกแทน
     🔴 ครอบครัวว่าง (ไลน์ไม่อยู่ในทะเบียน) = ถอยไปเทียบ id ตรงตัว (พฤติกรรมเดิมของบรรทัดนี้) */
  const axisFamilyIds = selLine
    ? (selLineFamilyIds?.size ? selLineFamilyIds : new Set([Number(selLine)]))
    : null;
  const axisOpts = {
    familyIds:      axisFamilyIds,
    familySections: familySectionsOf(lines, axisFamilyIds),
    lineSections:   Object.fromEntries(lines.map(l => [l.id, l.section])),
  };
  const axisOf = (emp) => lineAxisVerdict(emp, { ...axisOpts, lineId: effLineIdOf(emp) });

  /* 🛡️ ไลน์ตัวเองไม่อยู่ในทะเบียนแล้ว (ถูกลบ/เปลี่ยนชื่อ) ⇒ ค่าตั้งต้นจะทำให้จอว่างทั้งที่มีคน
     = "ลิสต์ว่าง 2 ความหมาย" ⇒ ล้างค่าตั้งต้น ถอยไปเห็นทั้งขอบเขต (fail-open เหมือนที่หน้านี้ใช้อยู่)
     ⚠️ เช็คหลังทะเบียนโหลดเท่านั้น — เช็คตอน lines ว่างจะล้างทิ้งทุกครั้งที่เปิดจอ */
  useEffect(() => {
    if (!lines.length || !selLine) return;
    if (String(selLine) !== String(lineId)) return;               // ผู้ใช้เลือกเอง = ไม่แตะ
    if (defaultLineFilter({ role, lineId, lines }) === '') setSelLine('');
  }, [role, lineId, lines.length, selLine]);   // eslint-disable-line react-hooks/exhaustive-deps

  const displayed = employees.filter(emp => {
    if (filterShift && emp.assignedShift && emp.assignedShift !== shiftInfo.shift) return false;
    const el = effLineIdOf(emp);
    /* 🔴 เลือก "ไลน์" = เข้มเหมือนเดิมกับคนหน้างาน แต่ซ่อนคนที่แกนไลน์อธิบายไม่ได้ไม่ได้
       (กฎ + เหตุผลเต็มอยู่ `utils/lineAxisFilter.js` · ตัวนับขึ้นจอใต้แถบกรอง) */
    if (selLine)    return axisOf(emp) !== AXIS_OTHER;
    /* 🔴 กรองด้วย "ส่วนงาน" ต้องไม่ทิ้งคนที่ยังไม่ผูกไลน์ (2026-10-05 · หัวหน้า PD2 แจ้ง "หายไปหมดเลย")
       เดิมเช็ค `sectionFamilyIds.has(el)` อย่างเดียว = ถามว่า "อยู่ไลน์ไหน" ทั้งที่ผู้ใช้เลือก "ส่วนงาน"
       ⇒ คนที่ `line_id` ยัง null **หายทั้งหมดอย่างเงียบ ๆ** · วัดจริง: PD2 มีคนหน้างาน 35 คน
       ตั้งแผนกครบแล้วแต่ line_id ว่างทุกคน (กลุ่ม Assembly Line D2-D6 ในผังยังไม่ผูกไลน์ผลิต)
       ⇒ จอขึ้น "แสดง 0 คน" เช็คชื่อทั้งส่วนงานไม่ได้เลย
       กติกา: **เลือกส่วนงาน = ยึด section · เลือกไลน์ = ยึด line_id (เข้มเหมือนเดิม)**
       fail-open แบบเดียวกับ `onlyShopfloorStaff` — "นับเกินแล้วเห็น" ดีกว่า "หายเงียบ"
       (คนที่ไม่มีไลน์ถูกนับในแถบเตือนใต้แถบกรอง ไม่ใช่ปล่อยให้ปนเงียบ ๆ) */
    if (selSection) return sectionFamilyIds.has(el) || (!el && emp.section === selSection);
    return true;
  });

  /* 🔢 คนที่ "ดูได้แต่ถูกตัวกรองไลน์ซ่อนไว้" — กฎจอซื่อสัตย์: กรองแถวออกแล้วต้องบอกว่ากี่คน
     (ไม่บอก = หัวหน้าคิดว่าส่วนงานมีแค่นี้ แล้วหา "ยืมคน" ไม่เจอ) */
  const hiddenOtherLines = selLine
    ? employees.filter(emp => {
        if (filterShift && emp.assignedShift && emp.assignedShift !== shiftInfo.shift) return false;
        return axisOf(emp) === AXIS_OTHER;
      }).length
    : 0;

  /* 🔢 คนที่ "โชว์อยู่เพราะแกนไลน์อธิบายเขาไม่ได้" (สายสนับสนุน/ช่าง/ยังไม่ผูกไลน์ ของส่วนงานนี้)
     — กฎจอซื่อสัตย์ 2 ทาง: ซ่อนแล้วต้องบอก **และ** แสดงเกินตัวกรองก็ต้องบอกว่าทำไมเขาขึ้นมา */
  const offAxisShown = selLine ? displayed.filter(emp => axisOf(emp) === AXIS_OFF).length : 0;

  /* 🧭 แถบกรองขอบเขต — เดิมซ่อนจาก leader ด้วยเหตุผล "หัวหน้าไลน์มีไลน์เดียว ไม่ต้องกรอง"
     13/11: สมมติฐานนั้นผิด — ขอบเขตของหัวหน้าไลน์คือ **ไลน์ตัวเอง ∪ ไลน์ในส่วนงาน** (lineScope)
     ⇒ พอตั้งค่าตั้งต้นให้เปิดมาที่ไลน์ตัวเอง ถ้าไม่มีช่องกรอง เขาจะ**สลับไปดู/ยืมคนไลน์อื่นไม่ได้เลย**
        (ปุ่ม "ยืมคน" ต้องเห็นคนไลน์อื่นก่อนจึงยืมเข้าไลน์ตัวเองได้)
     🔴 ขอบเขตมีไลน์เดียวจริง = ซ่อนเหมือนเดิม ไม่เพิ่มของรกจอให้คนที่ไม่ได้ใช้ */
  const showScopeFilter = lines.length > 0 && (role !== 'leader' || scopedLines.length > 1);

  // 🪪 ผลการสแกนบัตร 1 ใบ → ติ๊กมางานบนจอ (กติกาอยู่ใน utils/badgeCheckin.js) · คืน string = ข้อความ error ให้ ScanModal/toast
  const onBadgeScan = async (parsed) => {
    if (!canRecord) return 'บัญชีนี้ไม่มีสิทธิ์เช็คชื่อ (checkin:record)';
    const raw = parsed?.raw || '';
    const r = badgeScanOutcome({ employees, displayedIds: new Set(displayed.map(e => e.id)), attendance, raw });
    if (r.kind === 'unknown') return `${tr("ไม่พบรหัส")} "${raw}" ${tr("ในรายชื่อพนักงานที่โหลดมา — ตรวจรหัสบนบัตร หรือพนักงานยังไม่อยู่ในทะเบียน")}`;
    if (r.kind === 'not_shown') return `${r.emp.name} (${r.emp.employee_id_code}) ${tr("ไม่อยู่ในรายชื่อที่แสดงตอนนี้ (คนละไลน์/กะ/ตัวกรอง) — เปลี่ยนตัวกรอง หรือกด \"ยืมตัว\" ถ้ามาช่วยไลน์นี้")}`;

    /* 🔴 สแกน = เขียนลงฐาน **ทันทีทีละคน** (10/11 · คำสั่ง user "ควรจะเช็คมาเลย")
       `already` ก็เขียน — เพราะ "มางานอยู่แล้ว" อาจเป็นแค่ติ๊กค้างบนจอที่ยังไม่เคยบันทึก
       ข้ามไป = คนยิงบัตรเชื่อว่าเช็คแล้วแต่ฐานยังว่าง (upsert แถวเดิม = ไม่มีผลข้างเคียง) */
    const lentOut = employees.find(e => e.id === r.emp.id)?._helperOutTo;
    if (lentOut) return `${r.emp.name} ${tr("ถูกยืมไปช่วย")} ${lentOut} ${tr("กะนี้ — ไลน์ที่ยืมเป็นคนเช็คชื่อ (จอนี้บันทึกไม่ได้")})`;
    const rec = r.record || { ...(attendance[r.emp.id] || {}), is_present: true };
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) return 'ยังไม่ได้เข้าระบบ — บันทึกไม่ได้ ให้ Login ก่อนแล้วยิงใหม่';
    const okRow = await upsertCheckin(supabase, ckLogRow(r.emp, rec, userData.user.id));
    // ❌ เขียนไม่ติด = **ห้ามติ๊กบนจอ** (ติ๊กไว้ = จอบอกว่าเช็คแล้วทั้งที่ฐานยังว่าง) · ให้ยิงซ้ำ
    if (!okRow) return `${tr("บันทึก")} ${r.emp.name} ${tr("ไม่สำเร็จ — ยังไม่ได้เช็คชื่อ (ดูข้อความแดงที่มุมจอ) · ยิงบัตรซ้ำอีกครั้ง")}`;

    setAttendance(prev => ({ ...prev, [r.emp.id]: rec }));
    // ฐานใหม่แล้ว ⇒ ขยับ baseline ด้วย ไม่งั้นตัวนับ "ค้างบันทึก"/ร่างในเครื่อง ยังนับคนนี้ว่าค้าง
    setBaseline(prev => ({ ...prev, att: { ...prev.att, [r.emp.id]: JSON.parse(JSON.stringify(rec)) },
      logIds: new Set([...prev.logIds, r.emp.id]) }));
    setScanSaved(prev => prev.includes(r.emp.id) ? prev : [...prev, r.emp.id]);
    return { ok: `✓ ${tr("บันทึกแล้ว")} — ${r.emp.name} (${r.emp.employee_id_code}) ${tr("มางาน")}` };
  };
  badgeScanRef.current = isMobile && displayed.length > 0 ? onBadgeScan : null;
  /* 🔴 เรียงตามกลุ่มคน (หน้างาน → ช่าง → สนับสนุน) เพื่อให้แทรกหัวข้อกลุ่มได้ (14/10)
     ใช้ sort ที่เสถียร ⇒ ภายในกลุ่มยังเรียงตามรหัสพนักงานเหมือนเดิมทุกประการ
     🔴 ห้ามเปลี่ยน "ใครอยู่ใน displayed" — ตัวแปรนี้คือรายชื่อที่ถูก **บันทึก** ด้วย (บรรทัด ~601) */
  displayed.sort((a, b) => GROUP_ORDER.indexOf(staffGroupOf(a)) - GROUP_ORDER.indexOf(staffGroupOf(b)));
  const groupCounts = displayed.reduce((m, e) => { const g = staffGroupOf(e); m[g] = (m[g] || 0) + 1; return m; }, {});
  const nonLineCount = displayed.length - (groupCounts[STAFF_SHOPFLOOR] || 0);

  // คนที่โชว์อยู่แต่ยังไม่ผูกไลน์ — ต้องบอกบนจอว่าทำไมถึงขึ้นมา และจะหายเมื่อกรองรายไลน์
  const noLineCount = displayed.filter(e => !effLineIdOf(e)).length;

  /* Summary counts */
  const counts = displayed.reduce((acc, emp) => {
    const s = getRowStatus(attendance[emp.id]);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  /* ติ๊ก OT — ใช้ร่วมตาราง + การ์ดมือถือ (ห้ามก๊อปตรรกะไปไว้ 2 ที่) */
  const toggleOt = (emp, rec) => {
    const turningOn = !rec.has_ot;
    toggle(emp.id, 'has_ot');
    // กะเช้าวันหยุด: จองหลักใช้ has_ot → default ช่วงเวลา 8 ชม. ให้เห็นและแก้ได้ก่อนบันทึก
    if (turningOn && shiftInfo.shift === 'day' && isHolidayDate(shiftInfo.workDateStr)) {
      setOtPeriods(prev => ({ ...prev, [emp.id]: prev[emp.id] || defaultHolidayPeriod('day') }));
    }
  };

  /* 📱 การ์ดต่อคน (มือถือ/handheld · 15/10 · docs/MOBILE-UX-STANDARD.md §4 ชนิด A)
     เดิมเป็นตาราง 11 คอลัมน์กว้าง 820px บนจอ 360px ⇒ ติ๊กหมวก/ถุงมือต้องปัดขวาไปหาคอลัมน์ ชื่อคนหลุดจอ
     การ์ด: ชื่อ+สถานะบนสุด → ปุ่มใหญ่ (≥44px ถุงมือกดได้) มางาน · หมวก · รองเท้า · ถุงมือ · OT → การลา/หมายเหตุ/จองรถ
     ช่องลา/หมายเหตุ/จองรถใช้ "ชิ้นเดียวกับตาราง" (cLeave/cRemark/cBooking) ⇒ ตรรกะไม่แตก 2 ชุด */
  const renderCheckinCard = ({ emp, rec, meta, hasLeave, newGroup, gMeta, grp, cEmp, cLeave, cRemark, cBooking }) => {
    const tg = (on, label, onClick, disabled, color = 'var(--green)') => (
      <button type="button" className={`ck-tg${on ? ' on' : ''}`} aria-pressed={!!on} disabled={disabled} onClick={onClick}
        style={on ? { background: color, borderColor: color } : undefined}>{label}</button>
    );
    const needBooking = shiftInfo.shift === 'night' || rec.has_ot || extraAdvanceDates.length > 0;
    return (
      <Fragment key={emp.id}>
        {newGroup && (
          <div className="ck-group">
            {tr(gMeta?.label)} <span style={{ fontWeight: 600, color: 'var(--muted)' }}>· {groupCounts[grp]} {tr("คน")}
              {grp !== STAFF_SHOPFLOOR && ' — เช็คชื่อได้ แต่ไม่ถูกนับเป็นกำลังคนของไลน์ผลิต'}</span>
          </div>
        )}
        <div className="ck-card" style={{ boxShadow: `inset 4px 0 0 ${meta.color}` }}>
          <div className="ck-top">
            <div style={{ flex: 1, minWidth: 0 }}>{cEmp}</div>
            <div className="ck-status" style={{ color: meta.color }}>
              {emp.assignedShift ? (emp.assignedShift === 'day' ? tr("เช้า · ") : tr("ดึก · ")) : ''}{tr(meta.label)}
              {hasLeave && rec.leave_type && <div style={{ fontSize: 11, opacity: 0.85 }}>{rec.leave_type}</div>}
            </div>
          </div>
          <div className="ck-tgs" style={emp._helperOutTo ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>
            {tg(rec.is_present, rec.is_present ? '✅ มางาน' : '⬜ มางาน', () => toggle(emp.id, 'is_present'), false, 'var(--accent)')}
            {tg(rec.has_helmet, '⛑️ หมวก', () => toggle(emp.id, 'has_helmet'), !rec.is_present)}
            {tg(rec.has_boots, '🥾 รองเท้า', () => toggle(emp.id, 'has_boots'), !rec.is_present)}
            {tg(rec.has_gloves, '🧤 ถุงมือ', () => toggle(emp.id, 'has_gloves'), !rec.is_present)}
            {tg(rec.has_ot, 'OT', () => toggleOt(emp, rec), !rec.is_present, 'var(--amber)')}
            {(emp.assignedShift === 'day' || shiftInfo.shift === 'day') && rec.has_ot
              && tg(rec.has_extended_ot, 'OT+23', () => toggle(emp.id, 'has_extended_ot'), false, 'var(--red)')}
          </div>
          <div className="ck-more" style={emp._helperOutTo ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>
            <div><div className="ck-lbl">{tr('การลา')}</div>{cLeave}</div>
            <div><div className="ck-lbl">{tr('หมายเหตุ')}</div>{cRemark}</div>
            {needBooking && <div><div className="ck-lbl">{tr('จองรถ OT / งานที่ทำ')}</div><div className="ck-book">{cBooking}</div></div>}
          </div>
        </div>
      </Fragment>
    );
  };

  /* แถวพนักงาน 1 คน — ใช้ร่วม 2 มุมมอง: ตาราง (จอคอม · DOM เหมือนเดิมเป๊ะ) / การ์ด (มือถือ · renderCheckinCard)
     ย้ายออกมาจาก displayed.map(...) + แยกเนื้อในช่องเป็นตัวแปร (15/10) — ไม่ได้แก้ตรรกะ */
  const renderCheckinRow = (emp, di) => {
              const rec = attendance[emp.id];
              if (!rec) return null;
              const status = getRowStatus(rec);
              const meta   = STATUS_META[status] || STATUS_META.absent;
              const hasLeave = !!rec.leave_type;
              /* 🔴 หัวข้อกลุ่มคน — ขึ้นเมื่อกลุ่มเปลี่ยน และ**เฉพาะตอนที่จอมีมากกว่า 1 กลุ่ม**
                 (ไลน์ผลิตที่มีแต่คนหน้างาน = ไม่มีหัวข้อโผล่มากวน เหมือนเดิมเป๊ะ)
                 ⚠️ ห้ามเปลี่ยนเป็น "ซ่อนกลุ่มอื่น" — คนที่ไม่ขึ้นจอ = เช็คชื่อไม่ได้ */
              const grp = staffGroupOf(emp);
              const newGroup = nonLineCount > 0 && (di === 0 || staffGroupOf(displayed[di - 1]) !== grp);
              const gMeta = STAFF_KINDS.find(k => k.key === grp);

              const cEmp = (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {emp.image_url
                        ? <img loading="lazy" src={emp.image_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border2)', flexShrink: 0 }} />
                        : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>👤</div>
                      }
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{emp.employee_id_code}</div>
                        {emp._helperRowId && (
                          <div style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <span>{tr('ยืมตัวจาก')} {emp._helperFrom}</span>
                            {canRecord && (
                              <button
                                onClick={() => unborrowEmployee(emp)}
                                title={tr('ยกเลิกยืมตัว — คืนกลับไลน์เดิม')}
                                style={{ padding: '2px 8px', borderRadius: 'var(--r-md)', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'var(--blue-dim)', color: 'var(--blue)', border: '1px solid var(--blue-line)' }}
                              >{tr('คืน')}</button>
                            )}
                          </div>
                        )}
                        {emp._helperOutTo && (
                          <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700, marginTop: 2 }}>
                            → {tr("ไปช่วยไลน์")} {emp._helperOutTo} ({tr("กะนี้")}){emp._helperOutBy ? ` · ${tr("ยืมโดย")} ${emp._helperOutBy}` : ''}
                            <div style={{ fontWeight: 600, color: 'var(--muted)' }}>
                              🔒 {emp._helperOutChecked ? `${tr("เช็คชื่อแล้วโดย")} ${emp._helperOutChecked}` : tr("ยังไม่ได้เช็คชื่อ")} — {tr("ไลน์ที่ยืมเป็นคนบันทึก จอนี้แก้ไม่ได้")}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
              );
              const cLeave = (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {/* Leave type */}
                      <select
                        value={rec.leave_type || ''}
                        onChange={e => setLeaveType(emp.id, e.target.value)}
                        style={{
                          padding: '5px 8px', borderRadius: 'var(--ctl-r)', fontSize: 12,
                          border: `1px solid ${hasLeave ? 'var(--blue-line)' : 'var(--border2)'}`,
                          background: hasLeave ? 'var(--blue-dim)' : 'var(--bg3)',
                          color: hasLeave ? 'var(--blue)' : 'var(--text2)',
                          width: '100%',
                        }}
                      >
                        <option value="">{tr('— ไม่ลา —')}</option>
                        {leaveTypes.map(t => <option key={t} value={t}>{tr(t)}</option>)}
                      </select>

                      {/* หมายเหตุ (แสดงเมื่อเลือก อื่นๆ) */}
                      {rec.leave_type === 'อื่นๆ' && (
                        <input
                          type="text"
                          placeholder={tr('ระบุเหตุผล...')}
                          value={rec.remark || ''}
                          onChange={e => setAttendance(prev => ({ ...prev, [emp.id]: { ...prev[emp.id], remark: e.target.value } }))}
                          style={{
                            padding: '4px 8px', borderRadius: 'var(--ctl-r)', fontSize: 11,
                            border: '1px solid var(--blue-line)',
                            background: 'var(--blue-dim)', color: 'var(--text)',
                            width: '100%',
                          }}
                        />
                      )}

                      {/* Duration (shown only when leave_type is set) */}
                      {hasLeave && (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {LEAVE_DURATION_OPTS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setLeaveDuration(emp.id, opt.value)}
                              style={{
                                flex: 1, padding: '3px 0', fontSize: 11, fontWeight: 700,
                                borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer',
                                background: rec.leave_duration === opt.value ? 'var(--blue)' : 'var(--bg2)',
                                color: rec.leave_duration === opt.value ? '#fff' : 'var(--text2)',
                                transition: 'all 0.15s',
                              }}
                            >{tr(opt.label)}</button>
                          ))}
                        </div>
                      )}

                      {/* Period selector — half day only */}
                      {hasLeave && rec.leave_duration === 'half' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {LEAVE_PERIOD_OPTS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setField(emp.id, 'leave_period', opt.value)}
                              title={tr(opt.sub)}
                              style={{
                                flex: 1, padding: '3px 4px', fontSize: 11, fontWeight: 700,
                                borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer',
                                background: rec.leave_period === opt.value ? 'var(--blue)' : 'var(--bg2)',
                                color: rec.leave_period === opt.value ? '#fff' : 'var(--text2)',
                                transition: 'all 0.15s', lineHeight: 1.3,
                              }}
                            >
                              {tr(opt.label)}
                              <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 400 }}>{tr(opt.sub)}</div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Hours input */}
                      {hasLeave && rec.leave_duration === 'hours' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="number"
                            min={0.5} max={8} step={0.5}
                            value={rec.leave_hours || ''}
                            onChange={e => setField(emp.id, 'leave_hours', e.target.value)}
                            placeholder={tr('จำนวนชั่วโมง')}
                            style={{ padding: '4px 8px', borderRadius: 'var(--ctl-r)', fontSize: 12, width: '100%' }}
                          />
                          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{tr('ชม.')}</span>
                        </div>
                      )}
                    </div>
              );
              const cRemark = (
                    <input
                      type="text"
                      placeholder={tr('หมายเหตุ...')}
                      value={rec.remark || ''}
                      onChange={e => setField(emp.id, 'remark', e.target.value)}
                      style={{ fontSize: 12, padding: '5px 8px' }}
                    />
              );
              const cBooking = (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      {shiftInfo.shift === 'night' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{shortDateLabel(addDaysToDateStr(shiftInfo.workDateStr, 1))}</span>
                          <input
                            type="checkbox"
                            style={{ transform: 'scale(1.4)', accentColor: 'var(--blue)', width: 'auto' }}
                            checked={!!otBookings[emp.id]}
                            onChange={() => toggleOtBooking(emp.id)}
                          />
                          {otBookings[emp.id] && (
                            <>
                              {isHolidayDate(addDaysToDateStr(shiftInfo.workDateStr, 1)) && (
                                <select
                                  value={otPeriods[emp.id] || ''}
                                  onChange={e => setOtPeriod(emp.id, e.target.value)}
                                  title={tr('วันหยุด — เลือกช่วงเวลา OT')}
                                  style={{ fontSize: 11, padding: '2px 4px', maxWidth: 130, color: 'var(--amber)', fontWeight: 700 }}
                                >
                                  <option value="">{tr('— ช่วงเวลา OT —')}</option>
                                  {holidayPeriodsForShift('night').map(p => (
                                    <option key={p.value} value={p.value}>{p.hours} {tr('ชม. ·')} {p.time}</option>
                                  ))}
                                </select>
                              )}
                              <select
                                value={otTasks[emp.id] || ''}
                                onChange={e => setOtTask(emp.id, e.target.value || null)}
                                style={{ fontSize: 11, padding: '2px 4px', maxWidth: 130 }}
                              >
                                <option value="">{tr('— งานที่ทำ —')}</option>
                                {taskTypes.map(t => <option key={t.id} value={t.id}>{tr(t.name)}</option>)}
                              </select>
                            </>
                          )}
                        </div>
                      ) : rec.has_ot ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          {isHolidayDate(shiftInfo.workDateStr) && (
                            <select
                              value={otPeriods[emp.id] || ''}
                              onChange={e => setOtPeriod(emp.id, e.target.value)}
                              title={tr('วันหยุด — เลือกช่วงเวลา OT')}
                              style={{ fontSize: 11, padding: '2px 4px', maxWidth: 140, color: 'var(--amber)', fontWeight: 700 }}
                            >
                              <option value="">{tr('— ช่วงเวลา OT —')}</option>
                              {holidayPeriodsForShift('day').map(p => (
                                <option key={p.value} value={p.value}>{p.hours} {tr('ชม. ·')} {p.time}</option>
                              ))}
                            </select>
                          )}
                          <select
                            value={otTasks[emp.id] || ''}
                            onChange={e => setOtTask(emp.id, e.target.value || null)}
                            style={{ fontSize: 11, padding: '2px 4px', maxWidth: 140 }}
                          >
                            <option value="">{tr('— งานที่ทำ —')}</option>
                            {taskTypes.map(t => <option key={t.id} value={t.id}>{tr(t.name)}</option>)}
                          </select>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                      )}

                      {/* จองรถล่วงหน้าเพิ่ม — วันหยุดต่อเนื่อง */}
                      {extraAdvanceDates.map(d => (
                        <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
                          <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>{shortDateLabel(d)} 🔶</span>
                          <input
                            type="checkbox"
                            style={{ transform: 'scale(1.3)', accentColor: 'var(--amber)', width: 'auto' }}
                            checked={!!otExtraBookings[emp.id]?.[d]}
                            onChange={() => toggleOtExtraBooking(emp.id, d)}
                          />
                          {otExtraBookings[emp.id]?.[d] && (
                            <>
                              <select
                                value={otExtraPeriods[emp.id]?.[d] || ''}
                                onChange={e => setOtExtraPeriod(emp.id, d, e.target.value)}
                                title={tr('วันหยุด — เลือกช่วงเวลา OT')}
                                style={{ fontSize: 11, padding: '2px 4px', maxWidth: 130, color: 'var(--amber)', fontWeight: 700 }}
                              >
                                <option value="">{tr('— ช่วงเวลา OT —')}</option>
                                {holidayPeriodsForShift(shiftInfo.shift).map(p => (
                                  <option key={p.value} value={p.value}>{p.hours} {tr('ชม. ·')} {p.time}</option>
                                ))}
                              </select>
                              <select
                                value={otExtraTasks[emp.id]?.[d] || ''}
                                onChange={e => setOtExtraTask(emp.id, d, e.target.value || null)}
                                style={{ fontSize: 11, padding: '2px 4px', maxWidth: 130 }}
                              >
                                <option value="">{tr('— งานที่ทำ —')}</option>
                                {taskTypes.map(t => <option key={t.id} value={t.id}>{tr(t.name)}</option>)}
                              </select>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
              );
              if (isMobile) return renderCheckinCard({ emp, rec, meta, hasLeave, newGroup, gMeta, grp, cEmp, cLeave, cRemark, cBooking });
              return (
                <Fragment key={emp.id}>
                {newGroup && (
                  <tr>
                    <td colSpan={99} style={{ background: 'var(--bg3)', padding: '6px 10px', fontSize: 12, fontWeight: 800, color: 'var(--text2)' }}>
                      {tr(gMeta?.label)} <span style={{ fontWeight: 600, color: 'var(--muted)' }}>· {groupCounts[grp]} {tr("คน")}
                        {grp !== STAFF_SHOPFLOOR && ' — เช็คชื่อได้ แต่ไม่ถูกนับเป็นกำลังคนของไลน์ผลิต'}</span>
                    </td>
                  </tr>
                )}
                <tr style={{ background: meta.bg, ...(emp._helperOutTo ? { pointerEvents: 'none', opacity: 0.65 } : {}) }} aria-disabled={emp._helperOutTo ? true : undefined}>
                  {/* Employee */}
                  <td>
                    {cEmp}
                  </td>

                  {/* Shift */}
                  <td style={{ textAlign: 'center' }}>
                    {emp.assignedShift
                      ? <span style={{ fontSize: 15 }}>{emp.assignedShift === 'day' ? '☀️' : '🌙'}</span>
                      : <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                    }
                  </td>

                  {/* มางาน */}
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ transform: 'scale(1.4)', accentColor: 'var(--accent)', width: 'auto' }}
                      checked={rec.is_present}
                      onChange={() => toggle(emp.id, 'is_present')}
                    />
                  </td>

                  {/* PPE */}
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_helmet} onChange={() => toggle(emp.id, 'has_helmet')} disabled={!rec.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_boots} onChange={() => toggle(emp.id, 'has_boots')} disabled={!rec.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_gloves} onChange={() => toggle(emp.id, 'has_gloves')} disabled={!rec.is_present} />
                  </td>

                  {/* OT */}
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--amber)', width: 'auto' }} checked={rec.has_ot} onChange={() => toggleOt(emp, rec)} disabled={!rec.is_present} />
                      {/* Special extended OT (day shift 20:00–23:00) — rare case */}
                      {(emp.assignedShift === 'day' || shiftInfo.shift === 'day') && rec.has_ot && (
                        <div
                          title={tr('OT พิเศษ กะเช้า ต่อถึง 23:00')}
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}
                          onClick={() => toggle(emp.id, 'has_extended_ot')}
                        >
                          <div style={{
                            fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                            padding: '2px 5px', borderRadius: 'var(--r-xs)',
                            background: rec.has_extended_ot ? 'var(--red-dim)' : 'var(--bg2)',
                            color: rec.has_extended_ot ? 'var(--red)' : 'var(--muted)',
                            border: `1px solid ${rec.has_extended_ot ? 'var(--red-line)' : 'var(--border)'}`,
                            transition: 'all 0.15s',
                          }}>
                            {rec.has_extended_ot ? '🔴 OT+23' : '○ OT+23'}
                          </div>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Leave column */}
                  <td style={{ padding: '6px 8px' }}>
                    {cLeave}
                  </td>

                  {/* Remark */}
                  <td style={{ padding: '6px 8px' }}>
                    {cRemark}
                  </td>

                  {/* Status */}
                  <td style={{ textAlign: 'center', fontWeight: 700, color: meta.color, whiteSpace: 'nowrap', fontSize: 12 }}>
                    {tr(meta.label)}
                    {hasLeave && rec.leave_type && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: meta.color, marginTop: 1, opacity: 0.8 }}>
                        {rec.leave_type}
                      </div>
                    )}
                    {hasLeave && rec.leave_duration === 'hours' && rec.leave_hours && (
                      <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)', marginTop: 1 }}>
                        {rec.leave_hours} {tr("ชม.")}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {cBooking}
                  </td>
                </tr>
                </Fragment>
              );
  };

  return (
    <Page>
      {/* 📊 Modal สะสม "คนของเราถูกยืมออกไปกี่วัน" (16/11) — ตัวเลขทุกตัวมาจาก utils/borrowDays.js
          🔴 ช่วงเวลาเขียนบนจอเสมอ · "ไม่รู้/ไม่ครบ" ต้องเห็น ห้ามกลายเป็น 0 เงียบ ๆ */}
      {showBorrowSum && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '20px 24px', maxWidth: 680, width: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{tr('คนของเราที่ถูกยืมออกไปช่วยไลน์อื่น')}</div>
              <button onClick={() => setShowBorrowSum(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              {borrowSum
                ? <>{tr("นับจาก")}<b> {tr("วันงาน")} {borrowSum.from} → {borrowSum.to}</b> ({borrowSum.days} {tr('วัน')}) · 1 {tr("วัน = 1 วัน ไม่ว่าถูกยืมกี่กะ")} · <b>{tr('ยืมข้ามไลน์แม่-ไลน์ลูกของตัวเองไม่นับว่าออก')}</b></>
                : <>{tr('ช่วง')} {BORROW_WINDOW_DAYS} {tr('วันทำงานล่าสุด')} — {tr('การยืมผูกกับวัน+กะ หมดกะหลุดเอง · แผงนี้ตอบว่า "ถูกยืมซ้ำกี่วัน" ซึ่งป้ายบนรายชื่อตอบไม่ได้')}</>}
            </div>

            {borrowSumErr && <NoticeBar tone="bad" style={{ marginBottom: 10 }}>{borrowSumErr}</NoticeBar>}
            {borrowSumLoading && <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>{tr('⏳ กำลังรวบรวม...')}</div>}

            {!borrowSumLoading && !borrowSumErr && borrowSum && (
              <>
                {borrowSum.people.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>
                    {tr('ไม่มีคนในรายชื่อนี้ถูกยืมออกไปไลน์อื่นในช่วงที่นับ')}
                    <span style={{ fontSize: 11.5 }}> {tr('(อ่านแถวการยืมทั้งโรงงาน')} {borrowSum.scanned} {tr('แถว)')}</span>
                  </div>
                ) : (
                  /* 📱 ปัดได้ทั้ง 2 แกน — 4 คอลัมน์บนจอ 390px ต้องไม่ "ล้นแล้วปัดไม่ได้" */
                  <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--bg2-surf)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 420 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>
                          <th style={{ textAlign: 'left',   padding: '6px 10px', fontSize: 11.5, fontWeight: 700 }}>{tr('พนักงาน')}</th>
                          <th style={{ textAlign: 'left',   padding: '6px 10px', fontSize: 11.5, fontWeight: 700 }}>{tr('ไลน์ต้นสังกัด')}</th>
                          <th style={{ textAlign: 'center', padding: '6px 10px', fontSize: 11.5, fontWeight: 700 }}>{tr('ถูกยืมออก')}</th>
                          <th style={{ textAlign: 'left',   padding: '6px 10px', fontSize: 11.5, fontWeight: 700 }}>{tr('ไปไลน์')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {borrowSum.people.map(p => (
                          <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 10px', fontWeight: 700, color: 'var(--text)' }}>{p.name}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 11.5 }}>{p.homeLineName || '—'}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <b style={{ color: 'var(--text)', fontSize: 13 }}>{p.days}</b> {tr('วัน')}
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                {p.shifts} {tr('กะ')}{p.span ? ` · ${tr('ในช่วง')} ${p.span} ${tr('วัน')}` : ''}
                              </div>
                            </td>
                            <td style={{ padding: '6px 10px', fontSize: 11.5, color: 'var(--text2)' }}>
                              {p.toLines.map(t => `${t.name} (${t.days})`).join(' · ')}
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.firstDate} → {p.lastDate}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span>{tr('รวม')} <b style={{ color: 'var(--text)' }}>{borrowSum.people.length}</b> {tr('คน')} · <b style={{ color: 'var(--text)' }}>{borrowSum.totalDays}</b> {tr('คน-วัน')}</span>
                  {borrowSum.unknownHome > 0 && (
                    <span data-warn="1" style={{ color: 'var(--amber)' }}>
                      ⚠ {borrowSum.unknownHome} {tr('แถวไม่รู้ไลน์ต้นสังกัด จึงไม่ถูกนับ — คนที่ยังไม่ผูกไลน์ (ไปผูกที่ ฐานข้อมูลพนักงาน)')}
                    </span>
                  )}
                  {borrowSum.skipped > 0 && (
                    <span>{borrowSum.skipped} {tr('แถวเป็นของคนนอกรายชื่อที่จอนี้โหลด (คนละขอบเขต/คนละทีม/ถูกยืมเข้ามา) — ไม่นับ')}</span>
                  )}
                  {borrowSum.truncated && (
                    <span data-warn="1" style={{ color: 'var(--amber)' }}>⚠ {tr('ข้อมูลมากเกินกว่าจะอ่านครบในรอบเดียว — ตัวเลขนี้ยังไม่ครบ')}</span>
                  )}
                  <span>{tr('การยืมหมดอายุเองเมื่อเปลี่ยนกะ — ตัวเลขนี้คือ "ถูกยืมซ้ำ" ไม่ใช่ "ค้างคืนไม่ยอมคืน" · ถ้าคนเดิมถูกยืมบ่อยจนเหมือนย้ายสังกัด ให้คุยกันแล้วตั้งที่')} <strong>{tr('ผังกำลังคน')}</strong> ({tr('คนวิ่งข้ามแผนก')})</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 🤝 Modal ยืมพนักงานข้ามไลน์ */}
      {showBorrowModal && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '20px 24px', maxWidth: 520, width: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{tr('ยืมพนักงานมาช่วยกะนี้')}</div>
              <button onClick={() => setShowBorrowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              {tr(shiftInfo.label)} · {shiftInfo.workDateStr} — {tr("คนที่ยืมจะโผล่ในรายชื่อเช็คชื่อและผังจัดกำลังคนของไลน์ปลายทาง เฉพาะกะนี้ (ไม่ย้ายสังกัดถาวร) · หมดกะแล้วหลุดเอง ไม่ต้องกดคืน — กด ✕ คืน เฉพาะเมื่อจะให้ไลน์อื่นยืมต่อในกะเดียวกัน")}
            </div>
            {!helpersReady && (
              <NoticeBar tone="bad" style={{ marginBottom: 10 }}>
                {tr("ระบบยืมตัวยังใช้ไม่ได้ — ยังไม่ได้")} apply migration <code>20260819_line_helpers_main.sql</code> ({tr("แจ้ง")} admin)
              </NoticeBar>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{tr('มาช่วยไลน์')}</span>
              {/* 2026-09-07 อ่านทะเบียนไลน์ผ่าน <LineSelect> (ลำดับชั้น/ปลดระวาง) — คง scope เดิม (scopedLines) */}
              <LineSelect lines={scopedLines} value={borrowLineId} valueKey="id" placeholder={tr('— เลือกไลน์ปลายทาง —')} includeSupport
                style={{ padding: '7px 10px', borderRadius: 6, fontSize: 13, width: 'auto', minWidth: 200, flex: 1 }} onChange={setBorrowLineId} />
            </div>
            <SearchInput value={borrowSearch} onChange={setBorrowSearch} autoFocus grow={false}
              fields={tr("ชื่อ / รหัสพนักงาน (อย่างน้อย 2 ตัวอักษร)")} style={{ marginBottom: 10 }} />
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--bg2-surf)', minHeight: 120 }}>
              {borrowLoading && <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>{tr('⏳ กำลังค้นหา...')}</div>}
              {!borrowLoading && borrowSearch.trim().length >= 2 && borrowResults.length === 0 && (
                <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>{tr("ไม่พบพนักงานที่ตรงกับ")} "{borrowSearch.trim()}"</div>
              )}
              {!borrowLoading && borrowSearch.trim().length < 2 && (
                <div style={{ padding: 14, fontSize: 12, color: 'var(--muted)' }}>{tr('พิมพ์ชื่อหรือรหัสพนักงานเพื่อค้นหา — ค้นได้ทั้งโรงงาน ไม่จำกัดไลน์/ส่วนงาน')}</div>
              )}
              {!borrowLoading && borrowResults.map(r => {
                const homeLine = lines.find(l => l.id === r.line_id)?.name || r.section || '—';
                const already = employees.find(e => e.id === r.id);
                const borrowedHere = !!already?._helperRowId;
                const inRoster = !!already && !borrowedHere;
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>
                    {r.image_url
                      ? <img loading="lazy" src={r.image_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>👤</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.employee_id_code} · {homeLine}{r.team ? ` · ${tr("ทีม")} ${r.team}` : ''}</div>
                    </div>
                    {borrowedHere
                      ? <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 700, whiteSpace: 'nowrap' }}>{tr('ยืมแล้ว →')} {lines.find(l => l.id === already._helperToLineId)?.name || tr("ไลน์ใน scope")}</span>
                      : inRoster
                        ? <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{tr('อยู่ในรายชื่อแล้ว')}</span>
                        : (
                          <button
                            onClick={() => borrowEmployee(r)}
                            disabled={!helpersReady}
                            style={{ padding: '5px 12px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 700, cursor: helpersReady ? 'pointer' : 'not-allowed', background: helpersReady ? 'var(--accent)' : 'var(--muted)', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
                          >{tr('ยืมตัว')}</button>
                        )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Header — UI-STANDARD 2026-09-24: ชิปกะ/วันที่อยู่ใน sub · ปุ่มอยู่ใน actions */}
      <PageHeader title={tr('เช็คชื่อ & PPE')} icon="📝"
        sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            padding: '4px 10px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 700,
            background: shiftInfo.shift === 'day' ? 'var(--amber-dim)' : 'var(--blue-dim)',
            color:      shiftInfo.shift === 'day' ? 'var(--amber)'     : 'var(--blue)',
            border: `1px solid ${shiftInfo.shift === 'day' ? 'var(--amber-line)' : 'var(--blue-line)'}`,
          }}>
            {tr(shiftInfo.label)} · {shiftInfo.timeRange}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{shiftInfo.workDateStr}</span>
        </span>}
        filters={<>
          {/* "เฉพาะกะนี้ / ทุกคน" = ตัวกรองการดู ⇒ อยู่แถบกรองใต้แท็บ ไม่ใช่ปุ่มคำสั่ง (05/11 · UI §6.35 · เดิมเป็นปุ่ม toggle บนหัว) */}
          <Segmented value={filterShift ? 'shift' : 'all'} onChange={v => setFilterShift(v === 'shift')} label={tr('แสดงใคร')}
            options={[{ value: 'shift', label: tr("เฉพาะกะนี้") }, { value: 'all', label: tr("ทุกคน") }]} />
          {previewNight && <span data-warn="1" style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>{tr('กำลัง Preview กะดึก')}</span>}
        </>}
        actions={<>
          {/* ปุ่มตายตัว ≤2 (UI §6.35): [ยืมพนักงาน] [บันทึก] · ที่เหลือ (Preview กะดึก · ส่งออกฟอร์ม · จองรถ OT) อยู่ใน ⋯ */}
          <OverflowMenu items={[
            { key: 'preview', icon: '🌙', label: previewNight ? 'ออกจาก Preview กะดึก' : 'Preview กะดึก', onClick: () => setPreviewNight(p => !p),
              hidden: realShiftInfo.shift !== 'day', badge: previewNight ? 'เปิดอยู่' : undefined,
              title: tr("ดูตัวอย่างหน้าจอกะดึก (รวมคอลัมน์ OT พรุ่งนี้) — ปิดปุ่มบันทึกอัตโนมัติระหว่าง preview") },
            { key: 'borrowsum', icon: '📊', label: `${tr("คนของเราที่ถูกยืมออก")} (${BORROW_WINDOW_DAYS} ${tr("วัน")})`, onClick: openBorrowSummary,
              title: tr("สรุปสะสมว่าคนของไลน์เราถูกยืมไปช่วยไลน์อื่นกี่วัน / ไลน์ไหน ในช่วง 30 วันทำงานล่าสุด (ป้ายบนรายชื่อบอกได้แค่กะนี้)") },
            { key: 'export', icon: '📄', label: tr("ส่งออกฟอร์ม"), onClick: () => { setExportSection(selSection || ''); setShowExport(true); } },
            { key: 'otbook', icon: '🚚', label: tr("จองรถ OT"), onClick: openOtBookModal, title: tr("จองรถ OT วันที่/ไลน์/ทีมใดก็ได้ ไม่ต้องรอเช็คชื่อกะนั้น") },
          ]} />
          {canRecord && (
            <button type="button" className="pg-btn" onClick={openBorrowModal}
              title={tr('ดึงพนักงานจากไลน์/ส่วนงานอื่นมาช่วยกะนี้ — จะโผล่ในรายชื่อเช็คชื่อและผังจัดกำลังคนของไลน์ปลายทาง')}>
              {tr('ยืมพนักงาน')}
            </button>
          )}
          <button type="button" className="pg-btn primary"
            onClick={() => setConfirmSave(true)}
            disabled={isSaving || previewNight || !canRecord}
            title={previewNight ? tr('ปิดโหมด Preview ก่อนบันทึก') : !canRecord ? tr('บัญชีของคุณไม่มีสิทธิ์บันทึกเช็คชื่อ') : undefined}
            style={{ opacity: (isSaving || previewNight || !canRecord) ? 0.55 : 1, cursor: (previewNight || !canRecord) ? 'not-allowed' : 'pointer' }}>
            {isSaving ? tr('กำลังบันทึก...') : previewNight ? tr('ปิด Preview ก่อนบันทึก') : !canRecord ? tr('ไม่มีสิทธิ์บันทึก') : tr('บันทึก')}
          </button>
        </>} />

      {/* แถบตัวตนคนล็อกอิน — กันเช็คชื่อผิด session บนเครื่องแชร์ (หัวหน้ากะก่อนไม่ logout)
          เด่นชัดตลอดเวลา + ปุ่มสลับผู้ใช้ในตัว · Andon: นิ่ง ไม่กระพริบ (แค่เตือนตัวตน ไม่ใช่ alarm) */}
      <div data-page-note="1" style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: 'var(--accent-dim)', border: '1px solid var(--accent)',
        borderRadius: 'var(--r-md)', padding: '9px 14px', marginBottom: 14,
      }}>
        <Icon glyph="👤" size={20} style={{ color: 'var(--accent)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 700 }}>
            {tr("กำลังเช็คชื่อในนาม")}: <span style={{ color: 'var(--accent)' }}>{fullName || tr('ไม่ทราบชื่อ')}</span>
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {roleLabel(role)} · {myScopeLabel}
          </span>
        </div>
        <button type="button" className="pg-btn" onClick={handleSwitchUser} style={{ marginLeft: 'auto' }}
          title={tr('ออกจากระบบเครื่องนี้ แล้วให้คนที่จะเช็คชื่อ login ด้วยบัญชีตัวเอง')}>
          {tr('ไม่ใช่ฉัน — สลับผู้ใช้')}
        </button>
      </div>

      {/* 🚩 หัวหน้ากลุ่มที่บัญชียังไม่ผูกไลน์และไม่ได้ตั้งขอบเขตส่วนงาน = ด่านทั้งสองแกนไม่ทำงาน
          ⇒ เขียนบนจอตรงๆ ว่ากำลังเห็นทั้งโรงงาน (กฎความซื่อสัตย์ของจอ — ไม่บล็อก เพราะบล็อก
          = เช็คชื่อไม่ได้ทั้งกะ) · Andon เหลือง = นิ่ง ไม่กระพริบ */}
      {scopeAnchorless({ role, lineId, sections: scopeSecs }) && (
        <NoticeBar tone="warn" style={{ marginBottom: 14 }}>
          {tr("บัญชีนี้เป็น")}<b>{tr('หัวหน้ากลุ่ม')}</b>{tr('แต่')}<b>{tr('ยังไม่ได้ผูกไลน์ และไม่ได้ตั้งขอบเขตส่วนงาน')}</b> —
          {tr("รายชื่อข้างล่างจึงเป็น")}<b>{tr('พนักงานทั้งโรงงาน')}</b> {tr("ไม่ใช่เฉพาะไลน์ที่ดูแล")}
          <span style={{ color: 'var(--muted)' }}> {tr('· ให้แอดมินตั้งไลน์หรือขอบเขตส่วนงานที่ทะเบียนผู้ใช้')}</span>
        </NoticeBar>
      )}

      {/* Section & Line filter bar — ทุก role ที่ขอบเขตมีมากกว่า 1 ไลน์ (ดู showScopeFilter) */}
      {showScopeFilter && (
        <FilterBar style={{ marginBottom: 14 }}>
          {/* ขอบเขต = ช่องเดียว ส่วนงาน → กลุ่มไลน์ → ไลน์ (<LineScopeSelect> · 2026-10-02 · เดิมปุ่มส่วนงาน 14 ปุ่ม + ช่องไลน์
              ที่โผล่หลังเลือกส่วนงาน = หน้าตาไม่เหมือนหน้าอื่น) · ส่วนงานที่ไม่มีไลน์ (คลัง/QA) ยังเลือกได้เพราะเช็คชื่อ "คน" */}
          <span className="filter-label">{tr('ขอบเขต')}</span>
          <LineScopeSelect lines={scopedLines} sections={sections} section={selSection} line={selLine} valueKey="id" includeSupport
            onChange={(sec, ln) => { setSelSection(sec); setSelLine(ln); }} />

          <span className="spacer" />
          {/* Employee count badge */}
          <span className="filter-count">
            {tr("แสดง")} <span style={{ color: 'var(--text)', fontWeight: 700 }}>{displayed.length}</span> {tr("คน")}
            {/* 16/11 แก้ข้อความ tooltip: ตั้งแต่ลง lineAxisFilter คนกลุ่มนี้ **ขึ้นแม้กรองรายไลน์**
                (ข้อความเดิมบอกว่า "จะไม่ขึ้นเมื่อกรองรายไลน์" = จอโกหกหลังเปลี่ยนพฤติกรรม) */}
            {noLineCount > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}
                title={tr('คนเหล่านี้อยู่ส่วนงานนี้แต่ยังไม่ได้ผูกไลน์ — ยังขึ้นให้เช็คชื่อได้ตามปกติ (ตัวกรองไลน์ไม่ซ่อนคนที่ไม่สังกัดไลน์) แต่กำลังคนของไลน์จะไม่นับเขา · ไปผูกที่ ฐานข้อมูลพนักงาน (ช่อง Group / กลุ่ม)')}>
                ⚠ {noLineCount} {tr("คนยังไม่ผูกไลน์")}
              </span>
            )}
            {/* 🧭 ทำไมคนที่ไม่ได้อยู่ไลน์นี้ยังขึ้นมา — ต้องเขียนบนจอ ไม่ใช่ให้หัวหน้าเดา */}
            {offAxisShown > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}
                title={tr('สายสนับสนุน / ช่าง / คนที่ยังไม่ผูกไลน์ ของส่วนงานนี้ — เขาไม่ได้สังกัดไลน์โดยธรรมชาติ ตัวกรองไลน์จึงไม่ซ่อนเขา (ดูหัวข้อกลุ่มในรายชื่อ) · เช็คชื่อได้ แต่ไม่ถูกนับเป็นกำลังคนของไลน์ผลิต')}>
                🗂️ {offAxisShown} {tr('คนไม่สังกัดไลน์')}
              </span>
            )}
            {hiddenOtherLines > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}
                title={tr('อยู่ในขอบเขตที่คุณดูได้ แต่เป็นไลน์อื่น — เปลี่ยนช่อง “ขอบเขต” เพื่อดู หรือยืมคนเข้าไลน์ตัวเอง')}>
                +{hiddenOtherLines} {tr('คนในไลน์อื่น')}
              </span>
            )}
          </span>
        </FilterBar>
      )}

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_META).map(([key, m]) => counts[key] ? (
          <span key={key} style={{
            fontSize: 12, padding: '3px 10px', borderRadius: 'var(--r-pill)',
            background: m.bg, color: m.color, border: `1px solid ${m.line}`, fontWeight: 600,
          }}>
            {tr(m.label)} {counts[key]}
          </span>
        ) : null)}
        {/* ขอบเขตมีไลน์เดียว = ไม่มีแถบกรองให้ติดตัวนับ ⇒ บอกที่นี่แทน (กฎจอซื่อสัตย์ ห้ามเงียบ) */}
        {role === 'leader' && !showScopeFilter && (
          <span style={{ fontSize: 12, color: 'var(--muted)', padding: '3px 0' }}>
            {tr('รวม')} {displayed.length} {tr('คน')}
            {offAxisShown > 0 && (
              <span title={tr('สายสนับสนุน / ช่าง / คนที่ยังไม่ผูกไลน์ ของส่วนงานนี้ — ไม่ได้สังกัดไลน์ จึงไม่ถูกตัวกรองไลน์ซ่อน')}>
                {' '}· 🗂️ {offAxisShown} {tr('คนไม่สังกัดไลน์')}
              </span>
            )}
          </span>
        )}
      </div>

      <DraftRestoreBar draft={ckPending} what={tr("การเช็คชื่อกะนี้")} onRestore={restoreCkDraft}
        onDiscard={() => { if (ckDraftKey) clearDraft(ckDraftKey); setCkPending(null); }} />
      {shiftChanged && (
        <NoticeBar tone="warn" style={{ marginBottom: 14 }}
          action={{ label: tr("โหลดรายชื่อกะใหม่"), title: tr("สิ่งที่ยังไม่บันทึกจะหาย"),
            onClick: () => { setPreviewNight(false); setShiftChanged(null); setRealShiftInfo(getShiftInfo()); } }}>
          <b>{tr('เวลาข้ามเข้า')} {tr(shiftChanged.label)} ({shiftChanged.workDateStr}) {tr("แล้ว")}</b> {tr('— หน้านี้ยังเป็นรายชื่อ')}{tr(realShiftInfo.label)} ({realShiftInfo.workDateStr})
          · {tr("กดบันทึกตอนนี้ = บันทึกของกะเดิม (ถูกต้องถ้ายังกรอกกะเดิมอยู่")})
        </NoticeBar>
      )}

      {previewNight && (
        <NoticeBar tone="bad" style={{ marginBottom: 14 }} action={{ label: tr("ออกจาก Preview"), onClick: () => setPreviewNight(false) }}>
          <b>{tr('โหมด Preview กะดึก')}</b> — {tr("เวลาจริงยังเป็นกะเช้า ปุ่มบันทึกถูกปิดไว้กันข้อมูลผิดพลาด")}
        </NoticeBar>
      )}

      {/* มือถือไม่โชว์ — อธิบาย "คอลัมน์" ของตาราง ซึ่งมุมมองการ์ดไม่มี (การ์ดเขียนป้าย 🚐 จองรถ OT ในตัวแล้ว)
          เดิมกล่องนี้ + คำเตือนดันรายชื่อลงจอที่ 2 บน handheld 360×640 */}
      {/* คำอธิบายคอลัมน์จองรถ OT = ข้อความอธิบาย ⇒ พับใน ⓘ (UI §6.10) · วันหยุดต่อเนื่องที่เพิ่มช่องให้ = ข้อเท็จจริง เขียนบนจอ */}
      {!isMobile && <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, fontSize: 12.5 }}>
        <InfoMore id="ck-ot-col" label={tr('คอลัมน์ จองรถ OT / งานที่ทำ คืออะไร')}>
          {shiftInfo.shift === 'night'
            ? <>{tr('คอลัมน์')} <strong>{tr('จองรถ OT / งานที่ทำ')}</strong> = {tr("จองล่วงหน้าว่าจะมาทำ OT คืนวันที่")} {addDaysToDateStr(shiftInfo.workDateStr, 1)} {tr('พร้อมระบุงานที่จะทำ เพื่อใช้ออกรายงานให้ธุรการจองรถรับส่ง (ดูที่หน้า Report)')}</>
            : <>{tr('ติ๊ก')} <strong>OT</strong> {tr('แล้วเลือก')} <strong>{tr('งานที่ทำ')}</strong> {tr('ในคอลัมน์ขวา เพื่อใช้ออกรายงานให้ธุรการจองรถรับส่ง (ดูที่หน้า Report)')}</>}
        </InfoMore>
        {!!extraAdvanceDates.length && (
          <span data-warn="1" style={{ color: 'var(--amber)' }}>{tr('พบวันหยุดต่อเนื่อง')} <strong>{extraAdvanceDates.map(shortDateLabel).join(', ')}</strong> {tr('— เพิ่มช่องจองรถล่วงหน้าให้แล้ว (เลือก OT 8 หรือ 10 ชม.)')}</span>
        )}
      </div>}

      {noSchedule && (
        <NoticeBar tone="warn" style={{ marginBottom: 14 }}>{tr('ยังไม่มีตาราง shift สำหรับวันนี้ — ไปกำหนดได้ที่หน้า')} <strong>{tr('ตารางกะ')}</strong></NoticeBar>
      )}

      {/* 🔴 "บางคนกะไม่ขึ้น" ต้องบอกว่าใคร/ไลน์ไหน (2026-10-13 · feedback หน้างาน PD2)
          เดิมเตือนเฉพาะตอน**ทั้งตาราง**ว่าง (noSchedule) ⇒ ไลน์เดียวที่ยังไม่มีกะ = เงียบสนิท
          หัวหน้าเห็นช่องกะว่างปนกับคนที่มีกะ แล้วเดาเองว่าข้อมูลพนักงานผิด (ของจริง: ตารางกะไม่มีแถวของไลน์นั้น)
          ⚠️ คนกลุ่มนี้ **ยังอยู่ในลิสต์ให้เช็คชื่อได้ตามปกติ** — คำเตือนนี้อธิบายเหตุ ไม่ได้บล็อกงาน */}
      {!noSchedule && noShiftRows.length > 0 && (
        <NoticeBar tone="bad" style={{ marginBottom: 14 }}>
          <strong>{noShiftPeople} {tr('คนยังไม่มีกะ')}</strong> — {tr("ตารางกะสัปดาห์นี้ยังไม่มีแถวของไลน์เหล่านี้ (และไม่มีไลน์แม่ให้ตกทอด) · เช็คชื่อได้ตามปกติ แต่กะจะว่างและกำลังคนของไลน์นับเป็น")} 0
          <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {noShiftRows.map(([nm, n]) => (
              <span key={nm} style={{
                padding: '2px 8px', borderRadius: 'var(--r-pill)', fontSize: 11.5, fontWeight: 700,
                background: 'var(--bg3-surf)', border: '1px solid var(--border)', color: 'var(--red)',
              }}>{nm} · {n} {tr('คน')}</span>
            ))}
          </div>
          <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted)' }}>
            {tr("แก้ที่หน้า")} <strong>{tr('ตารางกะ')}</strong> {tr('— กด')} <b>{tr('+ กำหนด')}</b> {tr("ที่ไลน์นั้น (ไลน์ที่สร้างใหม่หลังเติมตารางล่วงหน้าไปแล้ว จะไม่มีแถวของตัวเอง")})
          </div>
        </NoticeBar>
      )}

      {isMobile && canRecord && displayed.length > 0 && (
        <button type="button" onClick={() => setConfirmScan(true)}
          style={{ width: '100%', minHeight: 52, marginBottom: 12, borderRadius: 'var(--r-md)', border: '2px solid var(--accent)', background: 'var(--accent-dim)',
            color: 'var(--accent)', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
          {tr('สแกนบัตรพนักงานเช็คชื่อ')}
        </button>
      )}
      {/* 🪪 ด่านเดียวก่อนเริ่มยิงบัตร — บอกว่า "ในนามใคร" และว่าทุกใบจะลงระบบทันที
          (ถามครั้งเดียวตอนเปิด ไม่ถามรายใบ — ยิงบัตรหน้าประตูต้องไหลต่อเนื่อง) */}
      {confirmScan && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
          <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '22px 24px', width: '100%', maxWidth: 380, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>🪪</div>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 4 }}>{tr('สแกนบัตรเช็คชื่อในนาม')}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>{fullName || tr('ไม่ทราบชื่อ')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--amber)', marginTop: 10, marginBottom: 18, lineHeight: 1.5 }}>
              {tr("ยิงบัตร 1 ใบ")} = <b>{tr('บันทึก “มางาน” ลงระบบทันที')}</b> {tr('ไม่ต้องกด 💾 บันทึกอีก')}<br />
              ({shiftInfo.workDateStr} · {shiftInfo.label})
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setConfirmScan(false)}
                style={{ flex: 1, minHeight: 46, borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg3-surf)', color: 'var(--text2)', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>{tr('ยกเลิก')}</button>
              <button type="button" onClick={() => { setScanSaved([]); setConfirmScan(false); setBadgeScanOpen(true); }}
                style={{ flex: 1, minHeight: 46, borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>{tr('เริ่มสแกน')}</button>
            </div>
          </div>
        </div>
      )}
      {badgeScanOpen && (
        <ScanModal title={tr('สแกนบัตรพนักงาน')} closeOnHit={false}
          hint={`${tr("ส่องกล้องที่ QR บนบัตร หรือกดปุ่มสแกนข้างเครื่อง — ยิงทีละใบได้ต่อเนื่อง · ทุกใบบันทึกลงระบบทันที (ในนาม")} ${fullName || tr('ไม่ทราบชื่อ')})`}
          onScan={onBadgeScan} onClose={() => setBadgeScanOpen(false)}
          footer={<div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>
            {/* 🔴 ตัวเลขต้องตอบ "รอบนี้ยิงไปกี่ใบแล้ว" — ของเดิมโชว์ยอดมางานรวม (รวมที่บันทึกไว้ก่อนหน้า)
                ยิงเพิ่ม 1 ใบ เลขขยับ 108→109 กลืนไปกับของเดิม = มองไม่ออกว่าใบนี้ติดหรือไม่ติด
                และต่อท้ายว่า "ยังไม่ได้บันทึก" ตายตัวทั้งที่ตอนนี้บันทึกให้แล้ว = จอโกหก */}
            <span style={{ color: 'var(--green)' }}>{tr('บันทึกแล้วรอบนี้')} {scanSaved.length} {tr('คน')}</span>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>
              {' · '}{tr('มางานรวม')} {displayed.filter(e => attendance[e.id]?.is_present).length}/{displayed.length} {tr("คน")}
            </span>
            {ckPendingCount > 0 && (
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>
                ⚠️ {tr("ยังมีที่ติ๊ก/แก้ด้วยมือค้างอยู่")} {ckPendingCount} {tr("คน — ต้องปิดหน้าต่างนี้แล้วกด 💾 บันทึก (การยิงบัตรบันทึกให้เฉพาะคนที่ยิง")})
              </div>
            )}
          </div>} />
      )}
      {isMobile ? (
        <div className="ck-cards">
          {displayed.map(renderCheckinRow)}
          {displayed.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>{tr("ไม่มีพนักงานในกะนี้ — ลองเลือก \"ทุกคน")}"</div>
          )}
        </div>
      ) : (
      <div className="card table-sticky">
        <table style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>{tr('พนักงาน')}</th>
              <th style={{ textAlign: 'center', minWidth: 48 }}>{tr('กะ')}</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>{tr('มางาน')}</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>{tr('หมวก')}</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>{tr('รองเท้า')}</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>{tr('ถุงมือ')}</th>
              <th style={{ textAlign: 'center', minWidth: 72 }} title={tr('OT ปกติ | OT+23 = กะเช้าต่อถึง 23:00 (พิเศษ)')}>OT</th>
              <th style={{ minWidth: 220 }}>{tr('การลา')}</th>
              <th style={{ minWidth: 140 }}>{tr('หมายเหตุ')}</th>
              <th style={{ textAlign: 'center', minWidth: 110 }}>{tr('สถานะ')}</th>
              <th style={{ textAlign: 'center', minWidth: 150 }} title={tr('จองรถรับส่งสำหรับ OT พร้อมระบุงานที่ทำ — ใช้ออกรายงานให้ธุรการจองรถรับส่ง · ช่อง 🔶 = จองล่วงหน้าเพิ่มสำหรับวันหยุดต่อเนื่อง (ตามปฏิทินบริษัท)')}>{tr('จองรถ OT / งานที่ทำ')}</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(renderCheckinRow)}

            {displayed.length === 0 && (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>
                  {tr("ไม่มีพนักงานในกะนี้ — ลองเลือก \"ทุกคน")}"
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* 📱 ปุ่มบันทึกเกาะล่างจอ (มือถือ) — เช็ค 20 คนแล้วไม่ต้องเลื่อนกลับขึ้นไปหาปุ่มบนหัวหน้า
          เรียก setConfirmSave(true) ตัวเดียวกับปุ่มบนหัว ⇒ ผ่าน popup ยืนยัน "บันทึกในนามใคร" เหมือนเดิม */}
      {isMobile && displayed.length > 0 && (
        <div className="m-savebar">
          <span className="m-savebar-sum">{tr('มา')} {displayed.filter(e => attendance[e.id]?.is_present).length}/{displayed.length} {tr('คน')}</span>
          <button type="button" onClick={() => setConfirmSave(true)} disabled={isSaving || previewNight || !canRecord}>
            {isSaving ? tr('กำลังบันทึก...') : previewNight ? tr('ปิด Preview ก่อน') : !canRecord ? tr('ไม่มีสิทธิ์บันทึก') : tr('บันทึก')}
          </button>
        </div>
      )}

      {/* จองรถ OT แบบอิสระ modal */}
      {/* ยืนยัน "บันทึกในนามใคร" ก่อนเซฟจริง — จุด checkpoint บังคับให้เห็นชื่อ กันเช็คผิด session
          (ไม่ปิดจากคลิกฉากหลัง ตามกฎ modal ฟอร์ม — ต้องเลือกยืนยัน/สลับผู้ใช้) */}
      {confirmSave && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
          <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '22px 24px', width: '100%', maxWidth: 380, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>👤</div>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 4 }}>{tr('บันทึกเช็คชื่อในนาม')}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>{fullName || tr('ไม่ทราบชื่อ')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, marginBottom: 18 }}>
              {roleLabel(role)} · {myScopeLabel}<br />
              {tr("ระบบจะลงว่าคนนี้เป็นผู้เช็คชื่อ — ถ้าไม่ใช่ตัวคุณ ให้สลับผู้ใช้ก่อน")}
            </div>
            {/* 🔎 เขียนให้ชัดว่าเช็คชื่อ ≠ เปิดกะ (2026-09-17 · คำสั่ง user)
                เดิมบันทึกเสร็จระบบเด้ง modal เปิดกะให้เองทุกไลน์ → ถอดออก 16/09 เพราะสร้างกะเปล่า
                214/1,382 ใบ · หน้างานเลยรู้สึกว่า "เปิดกะจากหน้าเช็คชื่อไม่ติด" ทั้งที่ตั้งใจเอาออก
                ⇒ ไม่เอาออโต้กลับมา แต่ต้องบอกให้ชัดว่าต้องไปกดเองที่ไหน และกดเพื่ออะไร */}
            <div style={{
              textAlign: 'left', fontSize: 11.5, lineHeight: 1.55, color: 'var(--text2)',
              background: 'var(--bg2-surf)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)', padding: '9px 11px', marginBottom: 14,
            }}>
              <b style={{ color: 'var(--accent2)' }}>{tr('ℹ️ เช็คชื่อไม่ใช่การเปิดกะ')}</b><br />
              {tr("ระบบ")}<b>{tr('ไม่เปิดกะให้อัตโนมัติ')}</b> — <b>{tr("เปิดกะ = สำหรับไลน์ที่จะลงข้อมูลการผลิตเท่านั้น")}</b>
              ({tr("ยอดผลิต · Downtime · ของเสีย")} · OEE)<br />
              {tr("ไลน์ที่ต้องลงข้อมูลผลิต ให้ไปกด")} <b>{tr('“เปิดกะ” ที่หน้า Daily Report')}</b> {tr("ของไลน์ตัวเอง · ไลน์ที่ใช้แค่เช็คชื่อ")} <b>{tr('ไม่ต้องเปิดกะ')}</b>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSwitchUser}
                style={{ flex: 1, padding: '11px 0', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  background: 'var(--bg3-surf)', color: 'var(--text2)', border: '1px solid var(--border2)' }}>
                {tr('ไม่ใช่ฉัน')}
              </button>
              <button
                onClick={handleSave}
                style={{ flex: 2, padding: '11px 0', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                  background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }}>
                {tr('ใช่ บันทึกเลย')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOtBookModal && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
          <div style={{ background: 'var(--card-surf)', borderRadius: 'var(--r-lg)', padding: 22, width: '100%', maxWidth: 640, maxHeight: '86vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, color: 'var(--text)' }}>{tr('จองรถ OT')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
              {tr("เลือกวันที่/กะ/ไลน์/ทีมได้อิสระ ไม่ต้องรอเช็คชื่อกะนั้น — เหมาะกับกรณีทีมที่ต้องจอง OT ไม่ใช่ทีมที่กำลังเช็คชื่ออยู่ (เช่น จันทร์แรกหลังสลับกะ")})
            </div>

            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>{tr('วันที่ทำ OT')}</label>
                <input type="date" value={otBookDate}
                  onChange={e => { setOtBookDate(e.target.value); loadOtBookExisting(e.target.value, otBookShift); }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>{tr('กะ')}</label>
                <select value={otBookShift}
                  onChange={e => { setOtBookShift(e.target.value); loadOtBookExisting(otBookDate, e.target.value); }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)' }}>
                  <option value="day">{tr('กะเช้า')}</option>
                  <option value="night">{tr('กะดึก')}</option>
                </select>
              </div>
            </div>

            {isHolidayDate(otBookDate) && (
              <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700, marginBottom: 10 }}>
                {tr("วันที่เลือกเป็นวันหยุด — เลือกช่วงเวลา OT ให้พนักงานแต่ละคน (8 ชม. / 10 ชม.")})
              </div>
            )}

            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>{tr('ไลน์')}</label>
                {/* 2026-09-07 อ่านทะเบียนไลน์ผ่าน <LineSelect> — คง pre-filter "ไลน์ที่มีพนักงาน" (otBookLineOptions) */}
                <LineSelect lines={otBookLineOptions} value={otBookLineId} valueKey="id" placeholder={tr('— เลือกไลน์ —')} includeSupport
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)' }} onChange={setOtBookLineId} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>{tr('ทีม')}</label>
                <select value={otBookTeam} onChange={e => setOtBookTeam(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)' }}>
                  <option value="">{tr(ALL.team)}</option>
                  {orgTeams.map(t => <option key={t} value={t}>Team {t}</option>)}{/* 2026-09-07 ทีมจากผังองค์กร (useOrgTeams) */}
                </select>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', marginBottom: 14 }}>
              {otBookLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังโหลด...')}</div>
              ) : !otBookLineId ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('เลือกไลน์ก่อน')}</div>
              ) : otBookEmpOptions.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('ไม่พบพนักงานในไลน์/ทีมนี้')}</div>
              ) : otBookEmpOptions.map((emp, i) => (
                <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <input type="checkbox" checked={!!otBookSelections[emp.id]}
                    onChange={e => {
                      setOtBookSelections(prev => ({ ...prev, [emp.id]: e.target.checked }));
                      if (e.target.checked && isHolidayDate(otBookDate)) {
                        setOtBookPeriods(prev => ({ ...prev, [emp.id]: prev[emp.id] || defaultHolidayPeriod(otBookShift) }));
                      }
                    }}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                  <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.employee_id_code} · Team {emp.team}</div>
                  </div>
                  {otBookSelections[emp.id] && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                      {isHolidayDate(otBookDate) && (
                        <select value={otBookPeriods[emp.id] || ''} onChange={e => setOtBookPeriods(prev => ({ ...prev, [emp.id]: e.target.value }))}
                          title={tr('วันหยุด — เลือกช่วงเวลา OT')}
                          style={{ fontSize: 11, padding: '4px 6px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--amber-line)', background: 'var(--bg)', color: 'var(--amber)', fontWeight: 700, width: 150 }}>
                          <option value="">{tr('— ช่วงเวลา OT —')}</option>
                          {holidayPeriodsForShift(otBookShift).map(p => (
                            <option key={p.value} value={p.value}>{p.hours} {tr('ชม. ·')} {p.time}</option>
                          ))}
                        </select>
                      )}
                      <select value={otBookTasks[emp.id] || ''} onChange={e => setOtBookTasks(prev => ({ ...prev, [emp.id]: e.target.value }))}
                        style={{ fontSize: 11, padding: '4px 6px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', width: 150 }}>
                        <option value="">{tr('— งานที่ทำ —')}</option>
                        {taskTypes.map(t => <option key={t.id} value={t.id}>{tr(t.name)}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowOtBookModal(false)} style={{ padding: '8px 16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text2)', cursor: 'pointer' }}>{tr('ยกเลิก')}</button>
              <button onClick={handleSaveOtBookModal} disabled={otBookSaving || !otBookLineId || !canRecord}
                style={{ padding: '8px 16px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, cursor: otBookSaving || !otBookLineId ? 'not-allowed' : 'pointer', opacity: otBookSaving || !otBookLineId ? 0.6 : 1 }}>
                {otBookSaving ? tr('กำลังบันทึก...') : tr('บันทึกการจอง')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export forms modal */}
      {showExport && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--card-surf)', borderRadius: 'var(--r-lg)', padding: 22, width: 'min(380px, 94vw)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14, color: 'var(--text)' }}>{tr('ส่งออกฟอร์มกระดาษ (PDF)')}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
              {tr("สร้างฟอร์ม 2 หน้า ตามฟอร์มกระดาษจริงที่ใช้หน้างาน")}:<br />
              1) ใบรายงานการปฏิบัติงานชดเชย/ทำ OT &nbsp; 2) บันทึกการมาทำงาน
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>{tr('เดือน')}</label>
            <input type="month" value={exportMonth} onChange={e => setExportMonth(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border2)', marginBottom: 12, background: 'var(--bg)', color: 'var(--text)' }} />

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>{tr('ช่วงครึ่งเดือน')}</label>
            <select value={exportHalf} onChange={e => setExportHalf(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border2)', marginBottom: 12, background: 'var(--bg)', color: 'var(--text)' }}>
              <option value="1-15">{tr('วันที่ 1-15')}</option>
              <option value="16-end">{tr('วันที่ 16-สิ้นเดือน')}</option>
            </select>

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>{tr('ส่วนงาน')}</label>
            {/* จำกัดตัวเลือกตาม scope — ต้นไม้ผังองค์กรตัวเดียวกับจออื่น (SectionScopeSelect อ่าน UserContext.sections เอง) */}
            <SectionScopeSelect lines={lines} value={exportSection} onChange={s => setExportSection(s)} only={sections}
              width="100%" style={{ marginBottom: 18 }} />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowExport(false)} style={{ padding: '8px 16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text2)', cursor: 'pointer' }}>{tr('ยกเลิก')}</button>
              <button onClick={handleExportForms} disabled={exporting}
                style={{ padding: '8px 16px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, cursor: 'pointer' }}>
                {exporting ? tr('กำลังสร้าง...') : tr('สร้าง PDF')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
