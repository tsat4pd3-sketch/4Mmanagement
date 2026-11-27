import { fmtAxis, tooltipProps, CELL_BAR_FILL, focusDomain, shortTick } from '../utils/chartAxis';
import { urlPick, urlBool } from '../utils/urlInit';
import { ALL } from '../utils/filterLabels';
/* ══ 🏛️ OBEYA — ห้องบัญชาการโรงงาน (SQDCM + ลูปปิด countermeasure) ═══════════════════════
   ออกแบบ: docs/OBEYA-DESIGN.md · KPI ทั้งหมด: src/utils/obeyaKpi.js (ห้ามคำนวณซ้ำในไฟล์นี้)

   โจทย์จาก user (2026-09-15) — 3 ข้อ ที่เป็นตัวกำหนดหน้าตาทั้งหน้า:
     ① "prototype ทดลองการใช้งานและสอนพนักงานได้"  → ต้องใช้งานได้จริง ไม่ใช่ภาพนิ่ง
     ② "หน้ารวมใน 1 หน้าที่มอนิเตอร์ทุกด้าน ลักษณะกราฟ" → ทุกแกนอยู่จอเดียว ทุกแผงเป็นกราฟ
     ③ "เปิดจอทีวี 70 นิ้ว ให้เหมือนมีกระดาษ A4 ติดเต็มหน้าจอ" → แผงละ 1 แผ่น สัดส่วน A4 จริง

   ── ③ ทำยังไง (คณิตของผัง) ────────────────────────────────────────────────────────
   A4 แนวตั้ง = 210×297 ⇒ อัตราส่วน กว้าง/สูง = 0.7071
   จอ 16:9 สูง 1 หน่วย แบ่ง 2 แถว ⇒ แผ่นสูง 0.5 ⇒ กว้าง 0.354 ⇒ 1.778 ÷ 0.354 = **5.03 คอลัมน์**
   ⇒ **5 คอลัมน์ × 2 แถว = กระดาษ A4 สิบแผ่นปูเต็มจอ 16:9 พอดีเป๊ะ** (เศษ 0.03 = ช่องไฟ)
     · แผ่นแนวนอน (A4 landscape) = 2 ช่องติดกัน → ใช้กับ OEE และ ACTION BOARD
   ขนาดแผ่นวัดจาก container จริงด้วย ResizeObserver **ไม่ใช่ media query** — จอ TV/โปรเจคเตอร์
   มี devicePixelRatio และ overscan ไม่เท่ากัน ถ้า hardcode ไว้จะล้นจอบางเครื่องแล้วมี scrollbar
   ⚠️ ห้ามใช้ `dvh/svh` (Chromium 108) / `@container` (105) / `color-mix()` (111) — เพดานจอ TV = Cr 94

   ── สิ่งที่หน้านี้ "ห้าม" ทำ (กฎจาก OBEYA-DESIGN §4) ─────────────────────────────────
   · อ่านอย่างเดียวทั้งหน้า **ยกเว้น ACTION BOARD** — ตัวเลขทุกตัวลิงก์กลับหน้าที่ทำงานจริง
   · แกนที่ข้อมูลยังไม่พร้อม (S กับ Q) **ต้องเขียนบนจอว่าไม่พร้อม ห้ามโชว์ 0 ห้ามซ่อนแผง**
     — จอที่ยืนยันสิ่งที่ไม่จริง แย่กว่าจอที่ว่าง
   · ห้ามคำนวณ OEE/A/P/Q เอง (oee.js เป็นเจ้าของสูตรจุดเดียว — กฎ SCADA ใน CLAUDE.md)

   ── งบ egress ──────────────────────────────────────────────────────────────────────
   จอนี้ = **จอห้องประชุม 1-2 จอ ไม่ใช่บอร์ดหน้าไลน์ 10 จอ** · โหมดเดือนโหลด ~400 KB/รอบ
   ⇒ subscribe realtime แค่ `production_sessions` (เหตุการณ์เดียวที่เปลี่ยนตัวเลขบนจอนี้จริง)
     + `meeting_action_items` (ต้องสดตอนประชุม) · poll กันเหนียวที่ RATE.ANALYTIC
   ⚠️ อย่าเพิ่ม subscribe `prod_orders`/`downtime_logs` — ทุกใบงานที่ปิดในโรงงานจะลากจอโหลดใหม่ทั้งก้อน */
import { toneVar, toneDim, toneLine } from '../utils/statusTone';   // 🎨 token พาเลต 5 สี (UI §6.17)
import { useState, useEffect, useMemo, useCallback, useRef, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { chartAnim } from '../utils/motion';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import PageHeader from './PageHeader';
import { OBEYA_TITLE, OBEYA_ICON } from '../utils/obeyaPage';
import { A4, GAP, useSheetGrid, StatusLamp, Sheet, WarnNote, EmptyChart, FocusAxisNote, TV_SHEET_GRID } from './ObeyaSheet';
import useTvShell from '../utils/useTvShell';
import BoardPager from './BoardPager';
import useFitHeight from '../utils/useFitHeight';
import useIsMobile from '../utils/useIsMobile';
import { packPages, clampPage, pageLabels, cellsUsed } from '../utils/boardPager';
import LineSelect from './LineSelect';
import PersonSelect from './PersonSelect';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { dtBucketName, buildDtIndex } from '../utils/downtimeCategory';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { otCostOf, otCostYearRows, otRateText } from '../utils/otCost';   // 💸 26/11 ค่า OT = ก้อนที่ 3 ของแกน C
import { loadCompanyCalendar, getDayType } from '../utils/companyCalendar';
import { otPeriodMeta } from '../utils/otPeriods';
import { moCostOf, moCostYearRows, MO_COST_EXCLUDED_STATUSES } from '../utils/moCost';   // 🔧 27/11 ค่าซ่อม MO = ก้อนที่ 4 ของแกน C
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { inSectionScope, scopedLineNames } from '../utils/sectionScope';
import useOrgScope from '../utils/useOrgScope';
import OrgScopePicker from './OrgScopePicker';
import { PLANT, isPlant, parseScopeKey, drillParams, scopePathText } from '../utils/orgScope';
import { canWriteUnit, writeBlockText } from '../utils/writeScope';
import useColumnHistory from '../utils/useColumnHistory';
import { useLiveBoard } from '../utils/useLiveBoard';
import { LIVE, RATE } from '../utils/refreshRates';
import { loadLinesRes } from '../utils/useProductionLines';
import { oeeTargetForLines, sumDefectQty, orderPlanQty, orderProducedQty, isTrialDefect, QBIN_EMBED } from '../utils/oee';
import { useLatestRequest } from '../utils/useLatestRequest';
import { defectUnitCost, fmtBaht, lineCostCenter, rateFor, ratePerHour, RATE_COMPONENTS } from '../utils/costSaving';
import { notifyEvent } from '../utils/notifyEvent';
import TimeRangeBar from './TimeRangeBar';
import Segmented from './Segmented';
/* 📷 ปิด action ต้องแนบรูปหลักฐานได้ (12/10 · คำสั่ง user) — อัปโหลดผ่าน utils/actionImage.js เท่านั้น
   `<QualityPhotoField>` เป็นช่องกรอกล้วน (คืน File ให้หน้าแม่) ใช้ซ้ำได้ สัดส่วน 4:3 ชุดเดียวกัน */
import QualityPhotoField from './QualityPhotoField';
import ImageLightbox from './ImageLightbox';   // 🔍 ฉากดูรูปของกลาง (ห้ามเปิดแท็บใหม่ ห้ามเขียนโมดัลเอง)
import { uploadActionPhoto, removeActionImg } from '../utils/actionImage';
import { LOOKBACK_DAYS, presetRange, addDays, rangeDays, normalizeRange } from '../utils/timeRange';
import {
  OBEYA_AXES, PERIODS, periodRange, prevRange, statusColor, statusOf, statusWhy, gapToTarget,
  axisOee, axisSafety, axisQuality, axisDelivery, axisCost, axisMan, actionHealth, scopeActions, fillDays, round1,
} from '../utils/obeyaKpi';
import {
  yearOf, yearRange, monthRange, prevMonthRange, monthLabel, SUMMARY_KEY, monthBarStatus,
  axisOeeYear, axisSafetyYear, axisQualityYear, axisDeliveryYear, axisCostYear, axisManYear, paretoYear,
} from '../utils/obeyaYear';

import { tr } from '../utils/i18n';
import Skeleton from './Skeleton';
/* วันที่งาน (ตัด 08:00 — งานกะดึกข้ามวันนับเป็นวันก่อนหน้า)
   ⚠️ ห้ามใช้ toISOString() — คืน UTC ทำให้วันที่เพี้ยนสำหรับไทย (กฎ Date/Time ใน CLAUDE.md) */
const getWorkDate = () => {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (k) => { const [, m, d] = String(k).split('-'); return `${+d}/${+m}`; };
/* แผ่นบนมือถือสูงคงที่ — เท่ากับแท็บบอร์ด KPI (ObeyaKpiBoard) ให้ 2 แท็บหน้าตาเดียวกัน */
const MOBILE_SHEET_H = 330;

/* 📷 รูปหลักฐานของ action — แตะแล้วขยายในแอป (16/11 · คำสั่ง user "รูปที่แนบต้องกดขยายดูได้")
   เดิมเป็น `<a target="_blank">` ⇒ กลางประชุมแล้วเด้งออกจากบอร์ด (และตัวบล็อกป็อปอัปกินได้เงียบๆ)
   🔴 ฉากขยายใช้ของกลาง `ImageLightbox` เท่านั้น ห้ามวาดโมดัลดูรูปในไฟล์นี้ */
function ActionImgBtn({ url, label, result, fs }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="tbtn" onClick={() => setOpen(true)}
        title={tr('รูปหลักฐานที่แนบไว้ — แตะเพื่อดูรูปขยาย')} aria-label={tr('ดูรูปหลักฐาน')}
        style={{ fontSize: fs(11), background: 'none', border: 'none', padding: 0, cursor: 'zoom-in', lineHeight: 1 }}>📷</button>
      {open && <ImageLightbox onClose={() => setOpen(false)}
        items={[{ url, title: (label || '').trim() || tr('รูปหลักฐาน'), caption: result || null }]} />}
    </>
  );
}

export default function ObeyaSqdcmBoard({ tabs, tab, onTab }) {
  const { role, lineId, sections, fullName, section: homeSection, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  const canRecord = can('obeya', 'record', role) || can('morning_meeting', 'record', role);
  const canManage = can('kpi', 'manage', role);   // 💸 ตั้งค่าแรง OT (obeya_cost_settings · RLS has_perm('kpi:manage'))
  const [otRateOpen, setOtRateOpen] = useState(false);
  const today = getWorkDate();

  const [period, setPeriod] = useState(() => urlPick('period', ['week', 'month', 'year'], 'week'));   // ?period= ค่าตั้งต้น (จอวนหน้า) — ยังเป็น "ดูช่วงไหน" ไม่ใช่วันที่ตายตัว
  /* ขอบเขต = ผังองค์กรทุกมิติ (23/09 · แทน select ส่วนงานจาก org_nodes kind='section') — รับ ?scope= / ?section= ตอนเปิด */
  const [scope, setScope] = useState(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('scope')) return parseScopeKey(sp.get('scope'));
      if (sp.get('section')) return { kind: 'section', value: sp.get('section') };
    } catch { /* harness */ }
    return { ...PLANT };
  });
  /* โหมดปี (2026-09-22): `year` = ปีปฏิทินที่ดู · `monthSel` = เดือนที่ drill-down จากแท่งปี
     (null = โหมดเดือน "เดือนนี้" แบบเดิม) · กดแท่งเดือนไหนบนโหมดปี → ทั้งจอสลับเป็นโหมดเดือนของเดือนนั้น */
  const [year, setYear] = useState(() => yearOf(today));
  const [monthSel, setMonthSel] = useState(null);
  const isYear = period === 'year';

  /* ── ⏱️ กรอบเวลากำหนดเอง (23/09 · คำสั่ง user "เอาทั้งสองอย่าง") ────────────────────
     จอนี้ **ไม่เหมือนหน้าอื่น**: ปุ่ม สัปดาห์/เดือน/ปี ของมันแปลว่า **"ดูช่วงไหน"**
     (สัปดาห์นี้ / เดือนนี้ / ปีนี้) ไม่ใช่ "ขนาดถัง" ⇒ **ห้ามแปลงปุ่มพวกนี้เป็นสเกล**
     จะเปลี่ยนความหมายของจอที่หน้างานคุ้นอยู่แล้ว
     ⇒ เก็บปุ่มเดิมไว้กดเร็ว **แล้วเพิ่มกรอบวันที่ + ปุ่มย้อนหลังทับได้**:
       · แก้วันเอง / กดปุ่มย้อนหลัง → `custom` ชนะ (ป้ายบนจอเปลี่ยนเป็น "กำหนดเอง")
       · กดปุ่ม สัปดาห์/เดือน/ปี → ล้าง `custom` กลับไปโหมดเดิมทันที
     · ไม่ผูกกับ URL เหมือนหน้าอื่นโดยตั้งใจ — จอนี้เปิดค้างบน TV `?tab=sqdcm`
       ถ้าเขียน `?from=&to=` ลง URL ด้วย ลิงก์ที่แปะไว้บนจอจะค้างอยู่ช่วงเก่าตลอดไป */
  const [custom, setCustom] = useState(null);   // null = ใช้ปุ่มสัปดาห์/เดือน/ปีตามเดิม

  const { from, to } = useMemo(() => {
    if (custom) return custom;
    if (period === 'year') return yearRange(year, today);
    if (period === 'month' && monthSel) return monthRange(monthSel, today);
    return periodRange(period, today);
  }, [custom, period, today, year, monthSel]);
  const prev = useMemo(() => {
    /* ช่วงเทียบของกรอบกำหนดเอง = ช่วงยาวเท่ากันที่อยู่ติดกันข้างหน้า
       (เทียบกับ "สัปดาห์ก่อน/เดือนก่อน" ไม่ได้ เพราะกรอบเองไม่ใช่หน่วยปฏิทิน) */
    if (custom) {
      const n = rangeDays(custom.from, custom.to) || 1;
      return { from: addDays(custom.from, -n), to: addDays(custom.from, -1) };
    }
    if (period === 'year') return yearRange(year - 1, today);
    if (period === 'month' && monthSel) return prevMonthRange(monthSel, today);
    return prevRange(period, today);
  }, [custom, period, today, year, monthSel]);
  const drillMonth = (k) => {
    if (!k || k === SUMMARY_KEY) return;
    setMonthSel(k); setPeriod('month');
  };
  const pickPeriod = (key) => {
    setMonthSel(null);
    setCustom(null);                       // กดปุ่มช่วง = เลิกใช้กรอบกำหนดเอง
    if (key === 'year' && period !== 'year') setYear(yearOf(today));
    setPeriod(key);
  };
  /* แก้วันทีละช่อง: เริ่มจากกรอบที่กำลังดูอยู่ แล้วทับด้านที่แก้ (normalize กันเลือกกลับด้าน) */
  const setCustomSide = (side, v) => setCustom(c => {
    const base = c || { from, to };
    return normalizeRange(side === 'from' ? v : base.from, side === 'to' ? v : base.to);
  });

  // ── master (โหลดครั้งเดียว) ────────────────────────────────────────────────────
  const [lines, setLines] = useState([]);
  const { index: org, failed: orgFailed } = useOrgScope(lines);
  const scopeLineSet = useMemo(() => (isPlant(scope) ? null : new Set(org.lineNamesOf(scope.kind, scope.value))), [scope, org]);
  // ส่วนงานที่ขอบเขตนี้สังกัด — ใช้ตอนตั้ง Action item / ส่งต่อ ?section= ให้หน้าที่ยังอ่านแค่ section
  const secFilter = isPlant(scope) ? '' : (org.sectionOf(scope.kind, scope.value) || '');
  /* 🔐 ชั้นที่ 3 — ใบ Action ผูกส่วนงาน ⇒ เขียน/ปิดได้เฉพาะส่วนงานตัวเอง (audit 15/10)
     เดิม `scope` มาจาก URL โดย **ไม่มีด่านเลยแม้แต่ `org.has()`** ⇒ เขียน Action ใส่ส่วนงานอื่นได้
     🔴 ระดับโรงงาน/ฝ่าย (หา section ไม่ได้) = ของกลาง ⇒ ต้องมีใบผ่าน */
  const scopeWrite = useMemo(
    () => canWriteUnit({ role, section: homeSection, sections, allUnits, respCostCenters, scopeIdx }, secFilter, { unknownTarget: 'block' }),
    [role, homeSection, sections, allUnits, respCostCenters, scopeIdx, secFilter]);
  /* ส่วนงานทั้งหมดที่อยู่ใต้ขอบเขตที่เลือก (ฝ่าย = หลายส่วนงาน) — ใช้กรองใบ Action ที่ระบุแค่ส่วนงาน · null = ทั้งโรงงาน */
  const scopeSecs = useMemo(() => (isPlant(scope) ? null : org.sectionsOf(scope.kind, scope.value)), [scope, org]);
  const scopeText = scopePathText(org, scope, tr("ทุกส่วนงาน"));   // CC = เส้นทางหน่วยเจ้าของ › 💰 รหัส (12/10)
  const [targets, setTargets] = useState({});
  const [ccRates, setCcRates] = useState([]);
  /* daily_production_logs.assigned_line = **id จุดงาน (workstations.id)** ไม่ใช่ชื่อไลน์ (docs/modules/morning-meeting.md)
     — เดิมจอนี้เอา id ไปเทียบชื่อไลน์ตรงๆ ⇒ ติดตัวกรองส่วนงานเมื่อไหร่ แกน S/M หายเกลี้ยงเงียบๆ (แก้ 2026-09-22) */
  const [stationLine, setStationLine] = useState({});
  /* 💸 ค่าแรงมาตรฐาน OT (obeya_cost_settings · ตัวเดียวทั้งโรงงาน · user 26/11 "ใช้ 50 บาทไปก่อน") — null = ยังไม่โหลด/โหลดไม่ได้ ⇒ C เขียนว่าคิด OT ไม่ได้ ห้าม 0
     ปฏิทินบริษัทโหลดครั้งเดียว (ตัวคูณ 1.5/2 อ่านจาก day_type เท่านั้น) */
  const [otRate, setOtRate] = useState(null);
  const [otRateFail, setOtRateFail] = useState(false);
  const [calReady, setCalReady] = useState(false);
  const [bookings, setBookings] = useState([]);
  /* 🔧 ใบ MO ที่ผู้แจ้งรับมอบในช่วง (ho_at ตามเวลาไทย) + แถวค่าแรง/อะไหล่รายใบ (ค่าที่ช่างกรอก · user 27/11) · โหลดล้ม = moBad ⇒ C เขียนบอก ห้ามเงียบ */
  const [moOrders, setMoOrders] = useState([]);
  const [moLabor, setMoLabor] = useState({});
  const [moParts, setMoParts] = useState({});
  const [moBad, setMoBad] = useState(false);
  useEffect(() => {
    supabase.from('obeya_cost_settings').select('ot_wage_per_hour').eq('id', 'default').maybeSingle()
      .then(({ data, error }) => { if (error || !data) setOtRateFail(true); else setOtRate(Number(data.ot_wage_per_hour)); });
    loadCompanyCalendar().then(() => setCalReady(true)).catch(() => setCalReady(false));
  }, []);
  useEffect(() => {
    loadLinesRes()
      .then(({ data, error }) => { if (!error) setLines(data || []); });
    supabase.from('workstations').select('id, line_name')
      .then(({ data, error }) => { if (!error) setStationLine(Object.fromEntries((data || []).map(w => [String(w.id), w.line_name]))); });
    supabase.from('oee_targets').select('*')
      .then(({ data, error }) => { if (!error) setTargets(Object.fromEntries((data || []).map(t => [t.group_name, t]))); });
    supabase.from('cost_center_rates').select('*')
      .then(({ data, error }) => { if (!error) setCcRates(data || []); });
  }, []);

  // ── ข้อมูลช่วงเวลา ─────────────────────────────────────────────────────────────
  const [sess, setSess] = useState([]);
  const [prevSess, setPrevSess] = useState([]);
  const [dts, setDts] = useState([]);
  const [defs, setDefs] = useState([]);
  const [orders, setOrders] = useState([]);
  const [attend, setAttend] = useState([]);
  const [partCost, setPartCost] = useState({});
  const [loadWarn, setLoadWarn] = useState(null);
  /* 🔴 แยก "คิวรี downtime ล้ม" ออกจาก loadWarn รวม — เพราะ 2 แผง (C · ทำไมถึงหลุดเป้า) ตัดสินจาก
     ข้อมูลก้อนนี้ก้อนเดียว ถ้าไม่รู้ว่ามันล้ม ไฟจะขึ้น **เขียว "ไม่มีเครื่องหยุด"** ทั้งที่แปลว่าโหลดไม่ได้
     — ว่างเพราะไม่มีเหตุการณ์ กับ ว่างเพราะคิวรีพัง ต้องไม่หน้าตาเหมือนกัน (กฎความซื่อสัตย์ของจอ) */
  const [dtBad, setDtBad] = useState(false);
  // ของเสียโหลดไม่ได้ = ครึ่งหนึ่งของ C หาย ⇒ ไฟ C ต้องเทา "โหลดไม่ได้" เหมือน dtBad (05/10)
  const [dfBad, setDfBad] = useState(false);
  const [loading, setLoading] = useState(true);
  // เปลี่ยนเดือน/ปีระหว่างโหลด = คำตอบของช่วงเก่าห้ามทับจอ (กฎ DB ข้อ 4 · QC 05/10)
  const begin = useLatestRequest();

  /* ⚠️ deps ต้องเป็น primitive ล้วน (กฎเหล็ก DB ข้อ 9) — ห้ามใส่ array/object
     scope ส่วนงานกรองทีหลังใน useMemo ไม่ใช่ในคิวรี เพื่อไม่ให้สลับส่วนงาน = ยิง DB ใหม่ทุกครั้ง */
  const loadBoard = useCallback(async () => {
    const live = begin();
    setLoading(true);
    try {
      const sRes = await fetchAllPages(() => supabaseDR.from('production_sessions')
        .select('id, work_date, shift, line_name, oee, oee_a, oee_p, oee_q, actual_qty, qty_ok, qty_ng, shift_min, start_time')
        .eq('status', 'closed').gte('work_date', from).lte('work_date', to), { orderBy: ['work_date', 'id'] });
      const ids = sRes.rows.map(s => s.id);

      // ⚠️ ห้าม .in(ids) ตรงๆ — ช่วงเดือนมี 400+ กะ URL ยาวเกินเพดาน proxy แล้วคืนค่าว่างเงียบ
      const [dtRes, dfRes, ordRes, pRes, atRes, bkRes, moRes] = await Promise.all([
        fetchByIds(ids, c => supabaseDR.from('downtime_logs')
          /* ⚠️ ข้อความอิสระของ downtime ชื่อ `description` **ไม่ใช่ `reason`** — ไม่มีคอลัมน์ชื่อนั้นในตาราง
             เขียนผิดมาตั้งแต่สร้างบอร์ด ⇒ คิวรีนี้ล้มทั้งก้อน แผง "ทำไมถึงหลุดเป้า" กับครึ่งหนึ่งของ C
             ว่างเปล่ามาตลอด (จอขึ้นเหมือน "ไม่มีเครื่องหยุด" ทั้งที่จริงคือโหลดไม่ได้)
             · ทุก component อื่นในรีโปใช้ `description` หมด — ดู OeeInsightPanel / MachineReliability */
          .select('session_id, duration_min, description, machine_no, dr_downtime_types(name_th, category, planned_cap_min)').in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('defect_logs')
          .select(`session_id, qty_ng, qty_suspect, is_trial, dr_defect_types(name_th, excl_from_q), prod_orders(mat_no), ${QBIN_EMBED}`).in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('prod_orders')
          .select('session_id, mat_no, status, qty, qty_ok, qty_actual').in('session_id', c)),
        fetchAllPages(() => supabaseDR.from('production_sessions')
          .select('id, work_date, line_name, oee, oee_a, oee_p, oee_q, actual_qty, qty_ng, shift_min')
          .eq('status', 'closed').gte('work_date', prev.from).lte('work_date', prev.to), { orderBy: ['work_date', 'id'] }),
        fetchAllPages(() => supabase.from('daily_production_logs')
          .select('work_date, employee_id, shift, is_present, has_helmet, has_boots, has_gloves, has_ot, has_extended_ot, assigned_line')
          .gte('work_date', from).lte('work_date', to), { orderBy: ['work_date'] }),
        /* 💸 ใบจอง OT วันหยุด = ชั่วโมงต่อคน (8/10) ของวันที่ปฏิทินมาร์ค ot15/ot2 — วันทำงานไม่ใช้ (ชม.ตามกะ) */
        fetchAllPages(() => supabase.from('ot_night_bookings')
          .select('work_date, employee_id, ot_period')
          .gte('work_date', from).lte('work_date', to), { orderBy: ['work_date'] }),
        /* 🔧 ใบ MO รับมอบในช่วง — ho_at เป็น timestamptz ⇒ กรอบ 00:00–23:59:59 เวลาไทย (+07:00) ของ from..to */
        fetchAllPages(() => supabaseDR.from('mtn_orders')
          .select('id, status, ho_at, line_name, cost_center, labor_cost, parts_cost')
          .gte('ho_at', `${from}T00:00:00+07:00`).lte('ho_at', `${to}T23:59:59+07:00`), { orderBy: ['ho_at', 'id'] }),
      ]);
      /* แถวค่าแรง/อะไหล่รายใบ (ยอดต่อใบผ่าน orderCostTotal — แถวชนะ header) */
      const moIds = (moRes.rows || []).filter(o => !MO_COST_EXCLUDED_STATUSES.includes(o.status)).map(o => o.id);
      const [mlRes, mpRes] = moIds.length ? await Promise.all([
        fetchByIds(moIds, c => supabaseDR.from('mtn_order_labor').select('order_id, amount, rate_per_hour, hours').in('order_id', c)),
        fetchByIds(moIds, c => supabaseDR.from('mtn_order_parts').select('order_id, amount, qty, unit_price').in('order_id', c)),
      ]) : [{ rows: [] }, { rows: [] }];

      if (!live()) return;
      setSess(sRes.rows); setPrevSess(pRes.rows);
      setDts(dtRes.rows); setDefs(dfRes.rows); setOrders(ordRes.rows); setAttend(atRes.rows); setBookings(bkRes.error ? [] : bkRes.rows);
      setMoOrders(moRes.error ? [] : moRes.rows);
      const groupBy = (rows) => { const m = {}; (rows || []).forEach(r => { (m[r.order_id] || (m[r.order_id] = [])).push(r); }); return m; };
      setMoLabor(groupBy(mlRes.rows)); setMoParts(groupBy(mpRes.rows));
      setMoBad(!!(moRes.error || moRes.truncated || mlRes.error || mpRes.error));
      // โหลดไม่ครบ = ตัวเลขต่ำกว่าจริง **ต้องบอกบนจอ** ห้ามเงียบ (บทเรียนแท็บแนวโน้ม /oee-analytics)
      // กะโหลดไม่ได้ = ไม่มี id ไปดึง downtime ⇒ "ว่าง" ของ downtime ก็เชื่อไม่ได้เช่นกัน
      setDtBad(!!(dtRes.error || dtRes.truncated || sRes.error || sRes.truncated));
      setDfBad(!!(dfRes.error || dfRes.truncated || sRes.error || sRes.truncated));
      const bad = [sRes, dtRes, dfRes, ordRes, pRes, atRes].find(r => r.error || r.truncated);
      setLoadWarn(bad ? (bad.error || 'ข้อมูลบางส่วนถูกตัด (ช่วงยาวเกิน) — ตัวเลขอาจต่ำกว่าจริง') : null);

      const mats = [...new Set(dfRes.rows.map(d => d.prod_orders?.mat_no).filter(Boolean))];
      if (mats.length) {
        /* audit 05/10: เดิม `.in(mats.slice(0,300))` ตัดเงียบ + ไม่อ่าน error ⇒ แกน C บอก "N พาร์ทยังไม่มีต้นทุน" ทั้งที่คิวรีล้ม */
        const pm = await fetchByIds(mats, c => supabaseDR.from('parts_master').select('mat_no, material_cost, standard_cost').in('mat_no', c));
        if (!live()) return;
        if (pm.error) setLoadWarn(w => w || `${tr("โหลดต้นทุนต่อชิ้น (ทะเบียนชิ้นส่วน) ไม่สำเร็จ — แกน C คิดเงินไม่ครบ")}: ${pm.error.message || pm.error}`);
        setPartCost(Object.fromEntries((pm.rows || []).map(r => [r.mat_no, r])));
      } else setPartCost({});
    } finally { if (live()) setLoading(false); }
  }, [from, to, prev.from, prev.to, begin]);

  useLiveBoard(loadBoard, {
    tables: ['production_sessions'], topic: 'obeya-board', tier: LIVE.BOARD, rate: RATE.ANALYTIC,
    enabled: !isYear,
  });

  /* ── โหมดปี: ผลรวมรายเดือนจาก RPC (ไม่โหลดแถวดิบ) ─────────────────────────────────
     วัดจริง 22/09: ทั้งปี 2026 = ~137 KB (DR) + ~63 KB (Main) เทียบโหมดเดือนที่โหลดแถวดิบ ~400 KB
     · RPC คืน Σ อย่างเดียว — การหาร/ถ่วง/ตัดสินอยู่ใน obeyaYear.js (ห้ามย้ายสูตรลง SQL) */
  const [yr, setYr] = useState(null);           // { sessions, downtime, defects, orders, attend }
  const loadYear = useCallback(async () => {
    const live = begin();
    setLoading(true);
    try {
      const [dr, at, mo] = await Promise.all([
        supabaseDR.rpc('obeya_year_rollup', { p_from: from, p_to: to }),
        supabase.rpc('obeya_attendance_rollup', { p_from: from, p_to: to }),
        supabaseDR.rpc('obeya_mo_cost_rollup', { p_from: from, p_to: to }),   // 🔧 27/11 ค่าซ่อม MO ต่อเดือน/ไลน์ (Σ อย่างเดียว)
      ]);
      setMoBad(!!mo.error);
      if (!live()) return;
      const bad = dr.error || at.error;
      /* RPC ฝั่ง DR ล้ม = ไม่มีทั้ง downtime และของเสีย ⇒ C/Pareto ต้องเทา "โหลดไม่ได้"
         เดิมโหมดปีไม่เคยตั้งธงนี้ ⇒ ล้มแล้วขึ้นเขียว "ไม่มีความสูญเสีย/ไม่มีเครื่องหยุด" (QC 05/10) */
      setDtBad(!!dr.error); setDfBad(!!dr.error);
      setLoadWarn(bad ? `${tr("โหลดสรุปรายปีไม่สำเร็จ")}: ${bad.message || bad}` : null);
      const j = dr.data || {};
      setYr({
        sessions: j.sessions || [], downtime: j.downtime || [], defects: j.defects || [], orders: j.orders || [],
        attend: Array.isArray(at.data) ? at.data : [],
        mo: Array.isArray(mo.data) ? mo.data : [],
      });
      const mats = [...new Set((j.defects || []).map(d => d.mat).filter(Boolean))];
      if (mats.length) {
        /* audit 05/10: เดิม `.in(mats.slice(0,300))` ตัดเงียบ + ไม่อ่าน error ⇒ แกน C บอก "N พาร์ทยังไม่มีต้นทุน" ทั้งที่คิวรีล้ม */
        const pm = await fetchByIds(mats, c => supabaseDR.from('parts_master').select('mat_no, material_cost, standard_cost').in('mat_no', c));
        if (!live()) return;
        if (pm.error) setLoadWarn(w => w || `${tr("โหลดต้นทุนต่อชิ้น (ทะเบียนชิ้นส่วน) ไม่สำเร็จ — แกน C คิดเงินไม่ครบ")}: ${pm.error.message || pm.error}`);
        setPartCost(Object.fromEntries((pm.rows || []).map(r => [r.mat_no, r])));
      } else setPartCost({});
    } finally { if (live()) setLoading(false); }
  }, [from, to, begin]);
  /* 🔴 `LIVE.YEAR` ไม่ใช่ `LIVE.BOARD` — สรุปทั้งปีไม่ต้องสดระดับนาที (22/10 · ดู refreshRates)
     ที่ 60 วิ: ทุกครั้งที่ไลน์ไหนก็ได้แตะ production_sessions = คิดสรุปทั้งปีใหม่ (ครั้งละ ~1.2 วินาที) */
  useLiveBoard(loadYear, {
    tables: ['production_sessions'], topic: 'obeya-year', tier: LIVE.YEAR, rate: RATE.ANALYTIC,
    enabled: isYear,
  });

  // ── Action items (Main project — คนละ client จึงแยก board) ──────────────────────
  const [actions, setActions] = useState([]);
  const loadActions = useCallback(async () => {
    const { data, error } = await supabase.from('meeting_action_items').select('*')
      .or(`status.in.(open,doing),meeting_date.gte.${from}`)
      .order('due_date', { nullsFirst: false }).limit(300);
    if (!error) setActions(data || []);
  }, [from]);
  useLiveBoard(loadActions, {
    tables: ['meeting_action_items'], topic: 'obeya-actions', tier: LIVE.PAGE,
    rate: RATE.BACKUP, client: supabase,
  });

  // ── scope ส่วนงาน ──────────────────────────────────────────────────────────────
  const secOfLine = useMemo(
    () => Object.fromEntries(lines.map(l => [l.name, l.section])), [lines],
  );
  /* scope ไลน์ของ user ผ่าน helper กลางตัวเดียวกับบอร์ด KPI (05/10 · audit) — leader = ครอบครัวไลน์ตัวเอง
     ไม่ใช่แค่ส่วนงาน · null = ไม่จำกัด (ห้ามคืน [] — lines ยังไม่โหลด = เห็นทั้งหมดชั่วคราว ไม่ใช่ว่างเปล่า) */
  const userLineSet = useMemo(() => {
    const names = scopedLineNames({ role, lineId, sections, lines, scopeIdx });
    return names ? new Set(names) : null;
  }, [role, lineId, sections, lines, scopeIdx]);   // 🔴 scopeIdx มาแบบ async — ไม่อยู่ใน deps = ขอบเขตค้างค่าเดิม (QC audit 09/11)
  const lineOk = useCallback((name) => {
    const sec = secOfLine[name];
    if (!inSectionScope(sections, sec)) return false;           // scope ของ user (ส่วนงาน)
    if (userLineSet && !userLineSet.has(name)) return false;    // scope ของ user (ครอบครัวไลน์ของ leader)
    if (scopeLineSet && !scopeLineSet.has(name)) return false;  // ตัวกรองขอบเขตบนจอ (ทุกมิติของผัง)
    return true;
  }, [secOfLine, sections, userLineSet, scopeLineSet]);
  /* 🔒 ใบ Action ก็ต้องเดินตามขอบเขตเดียวกับข้อมูลผลิต (05/10) — เดิมโชว์ทุกใบทั้งโรงงานไม่ว่าจะเลือกส่วนงานไหน */
  const actLineOk = useCallback((n) => (Object.prototype.hasOwnProperty.call(secOfLine, n) ? lineOk(n) : null), [secOfLine, lineOk]);
  const scopedActs = useMemo(() => scopeActions(actions, { sections, scopeSecs, lineOk: actLineOk }), [actions, sections, scopeSecs, actLineOk]);

  const fSess = useMemo(() => sess.filter(s => lineOk(s.line_name)), [sess, lineOk]);
  const fPrev = useMemo(() => prevSess.filter(s => lineOk(s.line_name)), [prevSess, lineOk]);
  const sessIds = useMemo(() => new Set(fSess.map(s => s.id)), [fSess]);
  const fDts = useMemo(() => dts.filter(d => sessIds.has(d.session_id)), [dts, sessIds]);
  const fDefs = useMemo(() => defs.filter(d => sessIds.has(d.session_id)), [defs, sessIds]);
  const fOrders = useMemo(() => orders.filter(o => sessIds.has(o.session_id)), [orders, sessIds]);
  /* เช็คชื่อ: แปลง id จุดงาน → ชื่อไลน์ก่อนกรอง · แถวที่ไม่รู้จุดงาน/จุดงานไม่ผูกไลน์ = คงไว้ (กันแกน S/M หาย) */
  const lineOfStation = useCallback((st) => (st == null ? null : (stationLine[String(st)] || null)), [stationLine]);
  const fAttend = useMemo(
    () => attend.filter((a) => { const ln = lineOfStation(a.assigned_line); return !ln || lineOk(ln); }),
    [attend, lineOk, lineOfStation],
  );

  // ── โหมดปี: กรอง scope แถวสรุปแบบเดียวกับแถวดิบ ─────────────────────────────────
  const ySess = useMemo(() => (yr?.sessions || []).filter(r => lineOk(r.line)), [yr, lineOk]);
  const yDts = useMemo(() => (yr?.downtime || []).filter(r => lineOk(r.line)), [yr, lineOk]);
  const yDefs = useMemo(() => (yr?.defects || []).filter(r => lineOk(r.line)), [yr, lineOk]);
  const yOrders = useMemo(() => (yr?.orders || []).filter(r => lineOk(r.line)), [yr, lineOk]);
  const yAttend = useMemo(
    () => (yr?.attend || []).filter((a) => { const ln = lineOfStation(a.line); return !ln || lineOk(ln); }),
    [yr, lineOk, lineOfStation],
  );

  // ── เป้า OEE ของขอบเขตที่เลือก (เฉลี่ยรายกรุ๊ป — ไม่เก็บระดับ section ใน DB) ──────
  const target = useMemo(() => {
    const names = isYear ? ySess.map(s => s.line) : fSess.map(s => s.line_name);
    // กติกากลางตัวเดียวกับ FactoryMap/GroupOverview/DeptDashboard (oee.js oeeTargetForLines · 05/10)
    return oeeTargetForLines(names, lines, targets);
  }, [fSess, ySess, isYear, lines, targets]);

  // ── KPI รายแกน (คำนวณใน obeyaKpi.js ทั้งหมด) ────────────────────────────────────
  const kOeeM = useMemo(() => axisOee({ sessions: fSess, target }), [fSess, target]);
  const kOeePrev = useMemo(() => axisOee({ sessions: fPrev, target }), [fPrev, target]);
  const kSM = useMemo(() => axisSafety({ logs: fAttend }), [fAttend]);
  const kQM = useMemo(() => axisQuality({ sessions: fSess, defects: fDefs, target }), [fSess, fDefs, target]);
  const kMM = useMemo(() => axisMan({ logs: fAttend }), [fAttend]);

  const kDM = useMemo(() => {
    let plan = 0, made = 0;
    const byDay = {};
    const dayOf = Object.fromEntries(fSess.map(s => [s.id, s.work_date]));
    fOrders.forEach((o) => {
      /* เป้า/ยอดผ่านสูตรกลาง (oee §6 / §6.1) — เดิม Σqty ทุกสถานะ ⇒ ใบยกยอดนับเป้า 2 รอบ + นับใบยกเลิก
         (ยอดผลิต vs แผน 71% ทั้งที่งานจบครบ) · ยอดของใบ open = qty_actual ที่กรอกระหว่างกะ (เดิมให้ 0) */
      const t = orderPlanQty(o);
      const p = orderProducedQty(o);
      plan += t; made += Number(p) || 0;
      const d = dayOf[o.session_id];
      if (!d) return;
      (byDay[d] || (byDay[d] = { k: d, plan: 0, made: 0 })).plan += t;
      byDay[d].made += Number(p) || 0;
    });
    const series = Object.values(byDay).sort((a, b) => a.k.localeCompare(b.k))
      .map(b => ({ ...b, v: b.plan ? round1((b.made / b.plan) * 100) : null }));
    return axisDelivery({ target: plan, produced: made, series });
  }, [fOrders, fSess]);

  const kCM = useMemo(() => {
    const comps = RATE_COMPONENTS.map(c => c.key);
    const dayOf = Object.fromEntries(fSess.map(s => [s.id, s.work_date]));
    const lineOf = Object.fromEntries(fSess.map(s => [s.id, s.line_name]));
    const byDay = {};
    let dtBaht = 0, ngBaht = 0;
    const noRate = new Set(); const noCost = new Set();
    fDts.forEach((d) => {
      if (d.dr_downtime_types?.category === 'planned') return;      // C = ความสูญเสีย ⇒ นับเฉพาะนอกแผน
      const ln = lineOf[d.session_id]; const wd = dayOf[d.session_id];
      const cc = ln ? lineCostCenter(lines, ln) : null;
      const rate = cc ? rateFor(ccRates, cc, wd) : null;
      const perHr = ratePerHour(rate, comps);
      if (!perHr) { if (ln) noRate.add(ln); return; }
      const v = ((Number(d.duration_min) || 0) / 60) * perHr;
      dtBaht += v;
      (byDay[wd] || (byDay[wd] = { k: wd, dt: 0, ng: 0 })).dt += v;
    });
    fDefs.forEach((d) => {
      /* งานทดลอง/ประเภทที่กันออกจาก %Q ไม่ใช่ความสูญเสียของการผลิต — กติกาเดียวกับโหมดปี
         (`ng − trial_ng`) และแผ่น Q (QC 05/10: เดิมเดือนนับ ปีไม่นับ ⇒ C เดือน ≠ ผลรวมในปี) */
      if (isTrialDefect(d)) return;
      const mat = d.prod_orders?.mat_no;
      const { unit } = defectUnitCost(mat ? partCost[mat] : null);
      if (!unit) { if (mat) noCost.add(mat); return; }
      const wd = dayOf[d.session_id];
      const v = ((Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0)) * unit;
      ngBaht += v;
      (byDay[wd] || (byDay[wd] = { k: wd, dt: 0, ng: 0 })).ng += v;
    });
    /* 💸 ค่า OT (ประมาณการ) — ชม.จากเช็คชื่อในขอบเขต × ค่าแรงมาตรฐาน × ตัวคูณปฏิทิน (utils/otCost.js) */
    const bkHours = {};
    bookings.forEach(b => { const h = otPeriodMeta(b.ot_period)?.hours; if (h) bkHours[`${b.employee_id}|${b.work_date}`] = h; });
    const ot = otCostOf({ logs: fAttend, rate: otRate, dayTypeOf: calReady ? getDayType : () => null, bookingHoursOf: (e, d) => bkHours[`${e}|${d}`] ?? null });
    Object.entries(ot.byDate).forEach(([wd, b]) => { (byDay[wd] || (byDay[wd] = { k: wd, dt: 0, ng: 0 })).ot = Math.round(b.baht); });
    /* 🔧 ค่าซ่อม MO (ค่าที่ช่างกรอก · นับวันรับมอบ) — ขอบเขตตามไลน์ของใบ (ใบไม่ระบุไลน์ = นับเฉพาะ ทั้งโรงงาน) */
    const mo = moCostOf({ orders: moOrders.filter(o => (o.line_name ? lineOk(o.line_name) : isPlant(scope))), laborByOrder: moLabor, partsByOrder: moParts });
    Object.entries(mo.byDate).forEach(([wd, b]) => { (byDay[wd] || (byDay[wd] = { k: wd, dt: 0, ng: 0 })).mo = Math.round(b.baht); });
    const moNote = moBad ? 'โหลดใบ MO ไม่ได้ — ค่าซ่อมไม่ถูกนับ' : (mo.nNoCost ? `${mo.nNoCost} ใบ MO รับมอบแล้วแต่ยังไม่ลงค่าใช้จ่าย` : '');
    const otNote = otRateFail ? 'โหลดค่าแรง OT ไม่ได้ — ค่า OT ไม่ถูกนับ'
      : (ot.rows && ot.unknownRate) ? 'ยังไม่ตั้งค่าแรง OT — ค่า OT ไม่ถูกนับ'
      : (!calReady && ot.rows) ? 'อ่านปฏิทินบริษัทไม่ได้ — OT คิดที่อัตราวันทำงาน 1.5 ทุกวัน' : '';
    const series = Object.values(byDay).sort((a, b) => a.k.localeCompare(b.k))
      .map(b => ({ ...b, ot: b.ot || 0, mo: b.mo || 0, v: Math.round(b.dt + b.ng + (b.ot || 0) + (b.mo || 0)) }));
    return { ...axisCost({ dtBaht, ngBaht, otBaht: ot.baht ?? 0, otNote, moBaht: mo.baht, moNote, series, missingRate: noRate.size, missingCost: noCost.size, sessions: fSess.length }),
      otHours: ot.hours, otRows: ot.rows, otHolidayGuess: ot.holidayGuess, moN: mo.nCost, moNoCost: mo.nNoCost };
  }, [fDts, fDefs, fSess, fAttend, bookings, otRate, otRateFail, calReady, moOrders, moLabor, moParts, moBad, lineOk, scope, lines, ccRates, partCost]);

  // ── โหมดปี: KPI จากผลรวมรายเดือน (obeyaYear.js) — โครงผลลัพธ์เดียวกับโหมดเดือน ─────────
  const kOeeY = useMemo(() => axisOeeYear({ rows: ySess, year, target }), [ySess, year, target]);
  const kSY = useMemo(() => axisSafetyYear({ rows: yAttend, year }), [yAttend, year]);
  const kQY = useMemo(() => axisQualityYear({ rows: ySess, defects: yDefs, year, target }), [ySess, yDefs, year, target]);
  const kMY = useMemo(() => axisManYear({ rows: yAttend, year }), [yAttend, year]);
  const kDY = useMemo(() => axisDeliveryYear({ rows: yOrders, year }), [yOrders, year]);
  const kCY = useMemo(() => {
    const comps = RATE_COMPONENTS.map(c => c.key);
    const rows = []; const noRate = new Set(); const noCost = new Set();
    yDts.forEach((d) => {
      if (d.category === 'planned') return;                       // C = ความสูญเสีย ⇒ นอกแผนเท่านั้น
      const cc = d.line ? lineCostCenter(lines, d.line) : null;
      const perHr = ratePerHour(cc ? rateFor(ccRates, cc, `${d.m}-01`) : null, comps);
      if (!perHr) { if (d.line) noRate.add(d.line); return; }
      rows.push({ m: d.m, dt: ((Number(d.min) || 0) / 60) * perHr, ng: 0 });
    });
    yDefs.forEach((d) => {
      const { unit } = defectUnitCost(d.mat ? partCost[d.mat] : null);
      if (!unit) { if (d.mat) noCost.add(d.mat); return; }
      rows.push({ m: d.m, dt: 0, ng: ((Number(d.ng) || 0) - (Number(d.trial_ng) || 0)) * unit });
    });
    /* 💸 OT รายปีจาก RPC (นับคน-วันแยกชนิด · ชม.วันหยุดถือ 8 = ประมาณ) */
    const oty = otCostYearRows(yAttend, otRate);
    oty.rows.forEach(r => rows.push(r));
    const otNote = otRateFail ? 'โหลดค่าแรง OT ไม่ได้ — ค่า OT ไม่ถูกนับ'
      : (oty.unknownRate && yAttend.some(a => Number(a.ot) > 0)) ? 'ยังไม่ตั้งค่าแรง OT — ค่า OT ไม่ถูกนับ'
      : oty.legacy ? 'ตัวรวมยอดรายปียังไม่แยกชนิด OT (ต้องอัปเดตฐาน) — บางเดือนไม่มีค่า OT' : '';
    /* 🔧 ค่าซ่อม MO รายปี (RPC Σ ต่อเดือน/ไลน์ · กรองขอบเขตเหมือนโหมดเดือน) */
    const moy = moCostYearRows((yr?.mo || []).filter(r => (r.line ? lineOk(r.line) : isPlant(scope))));
    moy.rows.forEach(r => rows.push(r));
    const moNote = moBad ? 'โหลดสรุปใบ MO ไม่ได้ — ค่าซ่อมไม่ถูกนับ' : (moy.nNoCost ? `${moy.nNoCost} ใบ MO รับมอบแล้วแต่ยังไม่ลงค่าใช้จ่าย` : '');
    return { ...axisCostYear({ rows, year, missingRate: noRate.size, missingCost: noCost.size, otNote, moNote, sessions: ySess.length }), otApprox: oty.approx, moN: moy.n - moy.nNoCost, moNoCost: moy.nNoCost };
  }, [yDts, yDefs, ySess, yAttend, yr, otRate, otRateFail, moBad, lineOk, scope, year, lines, ccRates, partCost]);
  const paretoY = useMemo(() => paretoYear(yDts), [yDts]);

  /* จอวาดจากชุดเดียว — โหมดปีกับโหมดวันให้โครงผลลัพธ์เหมือนกัน (value/target/state/note/series) */
  const kOee = isYear ? kOeeY : kOeeM;
  const kS = isYear ? kSY : kSM;
  const kQ = isYear ? kQY : kQM;
  const kD = isYear ? kDY : kDM;
  const kC = isYear ? kCY : kCM;
  const kM = isYear ? kMY : kMM;

  // ── "ทำไมหลุดเป้า" — Pareto เวลาเครื่องหยุดนอกแผน (สาเหตุอันดับต้น) ───────────────
  const paretoM = useMemo(() => {
    const dtIdx = buildDtIndex(fDts);
    const g = {};
    fDts.forEach((d) => {
      if (d.dr_downtime_types?.category === 'planned') return;
      /* 🗑️ "อื่นๆ / Alarm ไม่ระบุสาเหตุ" แตกตามเครื่องก่อนนับ (utils/downtimeCategory 23/09)
         — ยุบรวมไว้แท่งเดียว = แท่งใหญ่ที่บอกไม่ได้ว่าไปแก้ที่ไหน ผิดกฎความซื่อสัตย์ของจอ */
      const name = dtBucketName(d, dtIdx);
      g[name] = (g[name] || 0) + (Number(d.duration_min) || 0);
    });
    const rows = Object.entries(g).map(([name, min]) => ({ name, min: Math.round(min) }))
      .sort((a, b) => b.min - a.min);
    const total = rows.reduce((a, r) => a + r.min, 0);
    return { rows: rows.slice(0, 6), total };
  }, [fDts]);
  const pareto = isYear ? paretoY : paretoM;

  const health = useMemo(() => actionHealth(scopedActs.items, today), [scopedActs, today]);
  const ngTotalM = useMemo(() => sumDefectQty(fDefs, 'line'), [fDefs]);
  const ngTotal = isYear ? (kQY.ngQty || 0) : ngTotalM;

  /* ── ไฟสถานะของ 3 แผ่นที่ "ไม่มีเป้าให้เทียบ" — ต้องเขียนเองแทน statusWhy() ────────────
     กฎความซื่อสัตย์ของจอ: ห้ามแต่งเป้าขึ้นมาเองเพื่อให้ไฟติดสวย และห้ามปล่อยเทาเฉยๆ
     โดยไม่บอกว่าเทาเพราะอะไร — ทุกดวงต้องตอบได้ว่า "สีนี้เพราะอะไร" ใน tooltip */
  const nSess = isYear ? ySess.length : fSess.length;   // 0 = ช่วงนี้ยังไม่มีกะ ⇒ "ไม่มีข้อมูล" ไม่ใช่ "ไม่มีความสูญเสีย"
  const costStat = useMemo(() => {
    if (dtBad || dfBad) return { status: 'none', label: 'โหลดไม่ได้', why: 'คิวรีข้อมูลเครื่องหยุด/ของเสียล้มเหลว — ตัวเลขนี้ยังเชื่อไม่ได้ (ดูข้อความแดงบนหัวจอ)' };
    if (kC.value == null) return { status: 'none', label: 'ยังไม่มีข้อมูล', why: kC.note || 'ช่วงนี้ยังไม่มีความสูญเสียที่คิดเป็นเงินได้' };
    if (!nSess) return { status: 'none', label: 'ยังไม่มีข้อมูล', why: 'ช่วงนี้ยังไม่มีกะที่ปิดแล้ว — ยังตัดสินไม่ได้ว่ามีความสูญเสียหรือไม่' };
    if (kC.value <= 0) return { status: 'good', label: 'ไม่มีความสูญเสีย', why: 'ช่วงนี้ไม่มีเครื่องหยุดนอกแผน/ของเสียที่คิดเป็นเงินได้' };
    // ⚠️ แดงนี้ = "มีเงินหายไป" ไม่ใช่ "เกินเป้า" — ยังไม่มีใครตั้งเพดานค่าความสูญเสียไว้
    return { status: 'bad', label: 'มีความสูญเสีย', why: `${tr("เสียไป")} ${fmtBaht(kC.value)} (${tr("ยังไม่ได้ตั้งเพดานค่าความสูญเสีย — แดงนี้แปลว่า \"มีเงินหายไป\" ไม่ใช่ \"เกินเป้า")}")` };
  }, [kC.value, kC.note, dtBad, dfBad, nSess]);

  const paretoStat = useMemo(() => {
    if (dtBad) return { status: 'none', label: 'โหลดไม่ได้', why: 'คิวรีข้อมูลเครื่องหยุดล้มเหลว — ตัวเลขนี้ยังเชื่อไม่ได้ (ดูข้อความแดงบนหัวจอ)' };
    if (!pareto.total && !nSess) return { status: 'none', label: 'ยังไม่มีข้อมูล', why: 'ช่วงนี้ยังไม่มีกะที่ปิดแล้ว — "ไม่มีเครื่องหยุด" กับ "ยังไม่มีข้อมูล" ต้องไม่หน้าตาเหมือนกัน' };
    if (!pareto.total) return { status: 'good', label: 'ไม่มีเครื่องหยุด', why: 'ช่วงนี้ไม่มีเวลาเครื่องหยุดนอกแผนเลย' };
    // แผ่นนี้ตอบ "ทำไม" ไม่ใช่ KPI ของตัวเอง ⇒ ไม่มีเป้าของ "นาทีที่หยุด" ให้ตัดสิน = เทาเสมอ
    const top = pareto.rows[0];
    return { status: 'none', label: 'ไม่มีเป้า', why: `${tr("หยุดรวม")} ${pareto.total.toLocaleString()} ${tr("นาที · อันดับ")} 1 "${top.name}" ${top.min.toLocaleString()} ${tr("นาที — ยังไม่ได้ตั้งเป้าเวลาหยุด จึงตัดสินผ่าน/ไม่ผ่านไม่ได้")}` };
  }, [pareto, dtBad, nSess]);

  const actionStat = useMemo(() => {
    if (health.empty) return { status: 'none', label: 'ยังไม่มีใบ', why: 'ยังไม่มีใครบันทึกสิ่งที่ตกลงกันว่าจะแก้สักใบ — ตามงานไม่ได้' };
    if (health.overdue.length) return { status: 'bad', label: `${tr("เกินกำหนด")} ${health.overdue.length}`, why: `${tr("มี")} ${health.overdue.length} ${tr("ใบที่เลยวันครบกำหนดแล้วยังไม่ปิด")}` };
    return { status: 'good', label: 'ตามกำหนด', why: `${tr("ค้างอยู่")} ${health.liveCount} ${tr("ใบ ยังไม่มีใบไหนเลยกำหนด")}` };
  }, [health]);

  // ── ผังกระดาษ ──────────────────────────────────────────────────────────────────
  const [board, setBoard] = useState(() => urlBool('board', false));   // โหมดจอ TV = ซ่อนหัวเพจ เต็มจอ · ?board=1
  const wrapRef = useRef(null);
  const tv = useTvShell();   // 📺 จอประชุม = 3×2 ต่อหน้า (TV_SHEET_GRID) · จอคอมเหมือนเดิม
  const grid = useSheetGrid(wrapRef, 10, tv ? TV_SHEET_GRID : undefined);

  /* ── 📖 แบ่งหน้าแทนการเลื่อน (25/09 · คำสั่ง user "ดูจบได้ในหน้าเดียว … กดเปลี่ยนหน้า") ──
     แผ่นของบอร์ดนี้ตายตัว 8 ใบ = 10 ช่อง (OEE กับ ACTION BOARD กว้าง 2 ช่อง)
     🔴 `span` ในลิสต์นี้ **ต้องตรงกับ `span=` บนแผ่นจริง** ไม่งั้นตัวแบ่งหน้านับช่องผิด
        แล้วหน้าหนึ่งจะมีแผ่นเกินกริด ⇒ กลับไปล้นอีก · แบ่งเฉพาะตอน `fit` (จอกว้าง) */
  const SHEETS = [
    { key: 'S', title: 'S ความปลอดภัย' }, { key: 'Q', title: 'Q คุณภาพ' },
    { key: 'D', title: 'D ส่งมอบ' }, { key: 'C', title: 'C ต้นทุน' }, { key: 'M', title: 'M กำลังคน' },
    { key: 'oee', title: 'OEE เทียบเป้า', span: 2 },
    { key: 'why', title: 'ทำไมถึงหลุดเป้า' },
    { key: 'action', title: 'ACTION BOARD', span: 2 },
  ];
  /* ⛔ ความสูงกริด = **วัดจริงจนถึงก้นจอ** ห้ามเดา `78vh` (ของเดิมเดาไว้ รวมกับหัวเพจแล้วเกิน
     1 จอ ⇒ หน้าเลื่อนขึ้นลงได้ = อาการที่ user ทักมา 25/09)
     ⚠️ ต้องประกาศ **ก่อน** คำนวณจำนวนหน้า เพราะจำนวนหน้าขึ้นกับความสูงที่วัดได้
     `null` = ที่ไม่พอจริง (มือถือหัวเพจสูง) ⇒ ถอยไปโหมดเลื่อนแบบเดิม */
  const [fitRef, availH] = useFitHeight(12, 120);
  /* 💻 จอเตี้ย (< 800px เช่นโน้ตบุ๊ก 1366×768) — ไม่บีบลงจอเดียว (UX audit 05/10: แผ่นเหลือสูง ~220px
     กล่องเตือนในแผ่นทับกราฟจนอ่านไม่ได้) ⇒ ให้กริดสูงคงที่ SHORT_GRID_H แล้วหน้าเลื่อนได้ · โหมดจอ TV ยังคุมเต็มจอเหมือนเดิม */
  const SHORT_VH = 800, SHORT_GRID_H = 760;
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 1080));
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  /* 📱 มือถือ (15/10): ไม่ใช้ "จอเตี้ย" (กริดสูงตรึง 760px) และไม่ใช้โหมดพอดีจอ — จอ 360×640 เตี้ยกว่า 800 เสมอ
     ⇒ เดิมแผ่น 10 ใบถูกบีบลงกล่อง 760px = **สูงใบละ 67px ตัวเลขใหญ่โดนตัดครึ่ง กราฟหาย** (วัดจริง 15/10)
     ⇒ แผ่นเรียงลง 1 คอลัมน์ สูงคงที่ MOBILE_SHEET_H แล้วเลื่อนหน้าปกติ (แบบเดียวกับแท็บบอร์ด KPI) · จอคอม/TV เดิมเป๊ะ */
  const isMobile = useIsMobile();
  const shortScreen = !board && !isMobile && vh < SHORT_VH;
  const fitOn = availH != null && !shortScreen && !isMobile;

  /* ช่องต่อหน้า = คอลัมน์ × **แถวที่ลงจอจริง** — จอเตี้ย/จอแคบใส่ได้น้อยแถว ก็แบ่งหน้าเพิ่ม
     ห้ามบีบแผ่นให้เล็กลงเพื่อยัดลงจอ (ฟอนต์จะต่ำกว่า 11px = ผิดกติกา UI จอ TV) */
  const rowsFit = grid.fit
    ? (grid.rows || 1)
    : Math.max(1, Math.floor(((grid.bh || 0) + GAP) / ((grid.ch || 1) + GAP)));
  const perPage = Math.max(1, (grid.cols || 1) * rowsFit);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pages = useMemo(() => (fitOn ? packPages(SHEETS, perPage) : [SHEETS]), [perPage, fitOn]);
  const [pgRaw, setPg] = useState(0);
  const pg = clampPage(pgRaw, pages.length);
  const has = (key) => (pages[pg] || []).some((x) => x.key === key);
  const pgLabels = useMemo(() => pageLabels(pages, (x) => x?.title), [pages]);

  const { cols, cw, ch, fit, k } = grid;
  const fs = (n) => Math.max(11, Math.round(n * k));

  // ── modal ตั้ง action ──────────────────────────────────────────────────────────
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const assigneeHist = useColumnHistory(supabase, 'meeting_action_items', 'assignee');
  const openModal = (pre = {}) => setModal({
    problem: '', root_cause: '', line_name: '', assignee: '', kpi_key: '',
    due_date: '', target_value: '', ...pre,
  });
  const saveAction = async () => {
    if (!modal.problem.trim()) return toast.error('ระบุปัญหา/สิ่งที่ต้องทำก่อน');
    /* 🔴 ต้องตรวจ "ค่าที่จะเขียนจริง" ไม่ใช่ขอบเขตที่กำลังดู (QC audit 15/10)
       `sec` มาจากไลน์ที่เลือกในฟอร์ม ซึ่งอาจเป็นส่วนงานอื่นแม้ขอบเขตที่ดูจะเป็นของเรา
       (`<LineSelect>` fail-open เมื่อ `sections` ว่าง) ⇒ คำนวณ `sec` ก่อน แล้วค่อยตรวจ */
    const sec = modal.line_name ? (secOfLine[modal.line_name] || secFilter || null) : (secFilter || null);
    const wSec = canWriteUnit({ role, section: homeSection, sections, allUnits, respCostCenters, scopeIdx }, sec, { unknownTarget: 'block' });
    if (!wSec.ok) return toast.info(writeBlockText(wSec, { what: 'ใบ Action ของส่วนงานนี้', unit: sec }));
    setSaving(true);
    try {
      const { data: { user } = {} } = await supabase.auth.getUser();
      const ok = checkWrite(await supabase.from('meeting_action_items').insert({
        meeting_date: today, section: sec, line_name: modal.line_name || null,
        problem: modal.problem.trim(), root_cause: modal.root_cause?.trim() || null,
        assignee: modal.assignee?.trim() || null, due_date: modal.due_date || null,
        source: 'obeya', kpi_key: modal.kpi_key || null,
        target_value: modal.target_value === '' ? null : Number(modal.target_value),
        created_by: user?.id || null, created_by_name: fullName || null,
      }).select('id'), 'ตั้ง Action Item');
      if (!ok) return;
      notifyEvent({
        event: 'meeting_action_assigned', type: 'info', ref_table: 'meeting_action_items',
        line_name: modal.line_name || null, section: sec, actor: fullName,
        lines: [
          `🏛️ OBEYA ${today} · ${tr("แกน")} ${modal.kpi_key || '—'}`,
          `📌 ${modal.problem.trim()}`,
          `🙋 ${modal.assignee?.trim() || tr('(ยังไม่ระบุผู้รับผิดชอบ)')}`,
          modal.due_date ? `⏰ ${tr("กำหนดเสร็จ")} ${modal.due_date}` : '',
        ],
      });
      toast.success('ตั้ง Action Item แล้ว');
      setModal(null);
      loadActions();
    } finally { setSaving(false); }
  };
  const setStatus = async (a, status, extra = null) => {
    /* 🔐 ปิด/เลื่อนใบของส่วนงานอื่นไม่ได้ — ตัดสินจาก section ของ "ใบนั้น" ไม่ใช่ขอบเขตที่กำลังดู */
    const w = canWriteUnit({ role, section: homeSection, sections, allUnits, respCostCenters, scopeIdx }, a?.section);
    if (!w.ok) return toast.info(writeBlockText(w, { what: 'ใบ Action นี้', unit: a?.section }));
    const patch = { status, updated_at: new Date().toISOString(), ...(extra || {}) };
    if (status === 'done') patch.done_at = new Date().toISOString();
    // ⚠️ RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" ⇒ ต้องนับแถวจริง ห้ามเชื่อ !error
    const res = await supabase.from('meeting_action_items').update(patch).eq('id', a.id).select('id');
    if (!checkWrite(res, 'อัพเดท Action')) return false;
    if (!res.data?.length) { toast.error('ไม่มีสิทธิ์อัพเดทใบนี้ (ติดต่อผู้ดูแลระบบ)'); return false; }
    setActions(prev => prev.map(x => (x.id === a.id ? { ...x, ...patch } : x)));
    return true;
  };

  /* ── ปิด action = บันทึก "ทำอะไรไป" + รูปหลักฐาน (12/10 · คำสั่ง user) ──────────────
     🔴 ทั้ง 2 ช่อง **ไม่บังคับ** — บังคับเมื่อไหร่คนเลิกกดปิด แล้วบอร์ดเต็มไปด้วยงานค้างปลอม
     🔴 อัปโหลดรูปก่อน แล้วค่อยเขียนแถว · เขียนแถวไม่ผ่าน = ลบไฟล์ที่เพิ่งอัปทิ้ง (ไม่ให้มีไฟล์กำพร้า) */
  const [closing, setClosing] = useState(null);   // { a, result, file } | null
  const [closeSaving, setCloseSaving] = useState(false);
  const doClose = async () => {
    if (!closing) return;
    setCloseSaving(true);
    let url = null;
    try {
      if (closing.file) url = await uploadActionPhoto(closing.file, closing.a.id);
    } catch (e) {
      setCloseSaving(false);
      return toast.error((tr('อัปโหลดรูปไม่สำเร็จ') + ': ') + e.message);   // ล้มที่รูป = ยังไม่ปิดใบ (ห้ามปิดเงียบแล้วรูปหาย)
    }
    const extra = { result_value: closing.result?.trim() || null, ...(url ? { result_img: url } : {}) };
    const ok = await setStatus(closing.a, 'done', extra);
    setCloseSaving(false);
    if (!ok) { if (url) removeActionImg(url); return; }
    toast.success('ปิดงานแล้ว');
    setClosing(null);
  };

  // ── ตัวช่วยวาดกราฟ (หน้าตาเดียวกันทุกแผ่น — ห้ามแต่ละแผ่นตั้งเอง) ────────────────
  const axisTick = { fontSize: fs(10), fill: 'var(--muted)' };
  const chartTip = tooltipProps(fs(11));   // สี/พื้น/cursor มาตรฐาน — utils/chartAxis.js (แท่ง Cell ต้องมี fill={CELL_BAR_FILL} ไม่งั้น tooltip ดำ)
  const daySeries = (s) => fillDays(s, from, to).map(p => ({ ...p, label: dayLabel(p.k) }));
  const ytdTag = isYear ? 'YTD · ' : '';

  /* ── กราฟโหมดปี: 12 แท่งรายเดือน + แท่งที่ 13 "สรุป" (เฉลี่ยถ่วงน้ำหนัก หรือรวม แล้วแต่ KPI) ──
     กดแท่งเดือน = drill-down ทั้งจอไปโหมดเดือนของเดือนนั้น (แท่งสรุปกดไม่ได้)
     · เดือนว่างไม่มีแท่ง (ไม่ใช่แท่ง 0) · แท่งสรุปจางกว่า + มีขอบ ให้แยกจากเดือนจริงได้จากระยะไกล
     · สีแท่ง = สถานะเทียบเป้าเดียวกับโหมดวัน (ห้ามคิดเกณฑ์ใหม่) */
  /* ป้ายแกน X: แผ่นแคบ (A4 แนวตั้ง ~250px) ใส่ชื่อเดือนไทย 13 ตัวไม่พอ → ใช้เลขเดือน 1-12 + "สรุป"
     (วัดจริง 22/09: ชื่อย่อไทยชนกันเป็นพืด อ่านไม่ออก) · แผ่นกว้าง (OEE 2 ช่อง) ใช้ชื่อย่อไทยได้ · tooltip บอกชื่อเต็มเสมอ */
  const yearData = (k, narrow) => k.series.map(p => ({
    ...p, label: p.summary ? 'สรุป' : (narrow ? String(Number(String(p.k).slice(5, 7))) : monthLabel(p.k)),
  }));
  const onBarClick = (d) => drillMonth(d?.payload?.k ?? d?.k);
  const yearBars = (k, { fmt = v => `${v}%`, name = k.key, domain = [0, 100], ticks = undefined, yWidth = 'auto', left = 4, stacked = false, span = 1 } = {}) => {
    const narrow = (cw * span + GAP * (span - 1)) < 420;
    const data = yearData(k, narrow);
    if (!data.some(p => p.v != null)) return null;
    const cellOf = (p, i) => (
      <Cell key={i} fill={statusColor(monthBarStatus(p, k.target, k.better))}
        fillOpacity={p.summary ? 0.55 : 1} stroke={p.summary ? 'var(--text2)' : 'none'} strokeDasharray={p.summary ? '3 2' : undefined}
        cursor={p.summary ? 'default' : 'pointer'} />
    );
    const tickY = stacked ? { ...axisTick, fontSize: fs(9.5) } : axisTick;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 6, left, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ ...axisTick, fontSize: fs(9.5) }} interval={0} />
          <YAxis domain={stacked ? undefined : domain} ticks={stacked ? undefined : ticks} allowDataOverflow={!stacked && !!ticks} tick={tickY} width="auto"
            tickFormatter={stacked ? (v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)) : undefined} />
          <Tooltip {...chartTip} formatter={stacked
            ? ((v, nm) => [fmtBaht(v), nm === 'dt' ? tr("เครื่องหยุด") : nm === 'ot' ? tr('ค่า OT') : nm === 'mo' ? tr('ค่าซ่อม MO') : 'ของเสีย'])
            : (v => [fmt(v), name])}
            labelFormatter={(l, pl) => (pl?.[0]?.payload?.summary
              ? `${tr("สรุปปี")} ${year} (${pl[0].payload.kind === 'sum' ? tr('รวมทั้งปี') : tr('เฉลี่ยถ่วงน้ำหนักทั้งปี')})`
              : `${monthLabel(pl?.[0]?.payload?.k || '')} ${year} · ${tr("กดเพื่อเจาะรายวัน")}`)} />
          {k.target != null && !stacked && <ReferenceLine y={k.target} stroke="var(--red)" strokeDasharray="4 3" />}
          {stacked ? (
            <>
              <Bar {...chartAnim()} dataKey="dt" stackId="c" fill="var(--amber)" onClick={onBarClick} cursor="pointer" />
              <Bar {...chartAnim()} dataKey="ng" stackId="c" fill="var(--blue)" onClick={onBarClick} cursor="pointer">
                {data.map((p, i) => <Cell key={i} fill="var(--blue)" fillOpacity={p.summary ? 0.55 : 1} />)}
              </Bar>
              <Bar {...chartAnim()} dataKey="ot" stackId="c" fill="var(--purple)" onClick={onBarClick} cursor="pointer">
                {data.map((p, i) => <Cell key={i} fill="var(--purple)" fillOpacity={p.summary ? 0.55 : 1} />)}
              </Bar>
              <Bar {...chartAnim()} dataKey="mo" stackId="c" fill="var(--muted)" radius={[2, 2, 0, 0]} onClick={onBarClick} cursor="pointer">
                {data.map((p, i) => <Cell key={i} fill="var(--muted)" fillOpacity={p.summary ? 0.55 : 1} />)}
              </Bar>
            </>
          ) : (
            <Bar {...chartAnim()} dataKey="v" fill={CELL_BAR_FILL} radius={[2, 2, 0, 0]} onClick={onBarClick}>
              {data.map(cellOf)}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  const rowsUsed = Math.max(1, Math.ceil(cellsUsed((pages[pg] || [])) / (cols || 1)));
  const sheetsBox = {
    display: 'grid', gap: GAP, alignContent: 'start', justifyContent: 'center',
    gridTemplateColumns: cw ? `repeat(${cols}, ${cw}px)` : `repeat(${cols}, 1fr)`,
    /* แถวของ "หน้านี้" เท่านั้น แล้วยืดเต็มกล่อง — หน้าสุดท้ายที่มีแผ่นไม่ครบแถวจะได้ไม่เหลือ
       ที่ว่างเป็นแถบใหญ่ใต้บอร์ด (เห็นชัดตอนแบ่งหน้าบนจอเตี้ย) · จอที่เต็มพอดีได้ผลเท่าเดิมเป๊ะ */
    gridTemplateRows: `repeat(${rowsUsed}, minmax(0, 1fr))`,
    height: '100%',
    ...(isMobile ? { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'none', gridAutoRows: `${MOBILE_SHEET_H}px`, height: 'auto' } : null),
  };

  const axisSheet = (key) => OBEYA_AXES.find(a => a.key === key);

  /* ── 🔗 เจาะจากแผ่นไปหน้าจริง — **ต้องพาตัวกรองไปด้วย** (2026-09-22 · user แจ้ง) ──────────
     ของเดิมเขียน `window.location.href = '/oee-analytics'` ซึ่งผิด 2 ชั้น:
       1. **โหลดเว็บใหม่ทั้งก้อน** ไม่ใช่การเปลี่ยนหน้าแบบ SPA — ช้า + state ทั้งแอปหายหมด
          (user: "มันรีเฟรชเว็ปไปหน้าใหม่") · ต้องใช้ `navigate()` ของ react-router
       2. **ทิ้งตัวกรองที่ผู้ใช้ตั้งไว้** — กรอง PD3 อยู่ พอเจาะเข้าไปต้องกรองใหม่อีกรอบ
          ⇒ ส่ง `section` (+ `date` เมื่อหน้าปลายทางเป็นภาพรายวัน) ติดไปใน URL เสมอ
     ⚠️ ส่ง param เฉพาะหน้าที่ **อ่านมันจริง** — ใส่ `?section=` บนหน้าที่ไม่ได้อ่าน = URL โกหก */
  const navigate = useNavigate();
  const drill = (path, params) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v) q.set(k, v); });
    navigate(q.toString() ? `${path}?${q}` : path);
  };

  /* โหมดจอ TV = คลุมทั้งจอจริงด้วย position:fixed — ห้ามใช้ `height: 100vh` เฉยๆ
     เพราะหน้านี้อยู่ใน <main> ที่มี sidebar + padding ⇒ 100vh จะล้นจอแล้วแถวล่างโดนตัดเงียบ
     (วัดจริงด้วย Playwright 15/09: แถวที่ 2 ถูกตัด 37px ทั้งแถว) */
  const shell = board
    ? { position: 'fixed', top: 'var(--tvbar-h, 0px)', left: 0, right: 0, bottom: 0, zIndex: 1010, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }   // > รางเมนู 1000 (30/09) · top = ใต้แถบบนของกรอบจอ TV
    : { display: 'flex', flexDirection: 'column' };
  const goBoard = (on) => {
    setBoard(on);
    // ขอเต็มจอจากเบราว์เซอร์ด้วย (best-effort) — จอ TV มักมีแถบ URL กินที่ · ปฏิเสธได้ ไม่ใช่ error
    try {
      if (on) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* เบราว์เซอร์ TV บางรุ่นไม่มี API นี้ — ไม่เป็นไร โหมด fixed ก็เต็มจออยู่แล้ว */ }
  };

  const periodText = custom ? `${tr("กำหนดเอง")} (${rangeDays(from, to)} ${tr("วัน")})`
    : isYear ? `${tr("ปี")} ${year}`
    : period === 'month' ? (monthSel ? `${tr("เดือน")} ${monthLabel(monthSel)} ${monthSel.slice(0, 4)} (${tr("เจาะจากปี")})` : tr("เดือนนี้"))
      : tr("สัปดาห์นี้");
  const shiftCount = isYear ? (kOee.shifts || 0) : fSess.length;
  /* UI-STANDARD 2026-09-24: ป้ายปุ่มช่วงให้เป็นชุดเดียวกัน "…นี้" (PERIODS ใน obeyaKpi.js ใช้ key ตัดสิน ป้ายเป็นแค่ข้อความ) */
  const PERIOD_LABEL = { week: 'สัปดาห์นี้', month: 'เดือนนี้', year: 'ปีนี้' };
  const yearNavBtn = {
    fontSize: 'var(--ctl-fs)', fontWeight: 800, padding: '0 10px', borderRadius: 'var(--ctl-r)', cursor: 'pointer',
    background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
  };

  return (
    <div style={shell}>
      {!board && (
        <PageHeader
          tabs={tabs} tab={tab} onTab={onTab}
          title={OBEYA_TITLE} icon={OBEYA_ICON}
          sub={`${periodText} · ${from} → ${to} · ${shiftCount.toLocaleString()} ${tr("กะที่ปิดแล้ว")}`}
          filters={(
            <>
              <OrgScopePicker ccOnly index={org} value={scope} onChange={setScope} scopeSet={null} sections={sections} failed={orgFailed}
                plantLabel={ALL.section} width={230} title={tr('เลือกขอบเขต — เฉพาะหน่วยที่มี cost center (Obeya วัดที่ CC)')} />
              <span className="sep" />
              {/* ช่วงที่ดู — value ว่างเมื่อใช้กรอบกำหนดเอง/เจาะเดือน ⇒ กดปุ่มเดิมซ้ำได้ (pickPeriod ล้าง custom) */}
              <Segmented label={tr('ช่วงที่ดู')} value={custom || monthSel ? null : period} onChange={pickPeriod}
                options={PERIODS.map(p => ({ value: p.key, label: PERIOD_LABEL[p.key] || tr(p.label) }))} />
              {monthSel && (
                <button className="ctl-btn" onClick={() => pickPeriod('year')} title={tr('กลับไปดูทั้งปี')} style={yearNavBtn}>{tr('← ปี')} {year}</button>
              )}
              {isYear && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button className="ctl-btn" onClick={() => setYear(y => y - 1)} title={tr('ปีก่อน')} style={yearNavBtn}>◀</button>
                  <b style={{ fontSize: 14, minWidth: 44, textAlign: 'center' }}>{year}</b>
                  <button className="ctl-btn" onClick={() => setYear(y => y + 1)} disabled={year >= yearOf(today)} title={tr('ปีถัดไป')} style={yearNavBtn}>▶</button>
                </span>
              )}
            </>
          )}
          actions={(
            <>
              {/* ปุ่มตายตัว ≤2 (UI §6.35 · 04/11): หลัก = ตั้ง Action · รอง = โหมดจอ TV */}
              {canRecord && (
                <button type="button" className="pg-btn primary tv-hide" onClick={() => openModal()}>{tr('+ ตั้ง Action')}</button>
              )}
              <button type="button" className="pg-btn" onClick={() => goBoard(true)}>{tr('โหมดจอ TV')}</button>
            </>
          )}
        />
      )}

      {/* ⏱️ กรอบเวลากำหนดเอง — วางใต้หัวเพจ ไม่โชว์ในโหมดจอ TV (จอ TV ไม่มีคนกด)
          `scales={null}` โดยตั้งใจ: ปุ่ม สัปดาห์/เดือน/ปี ด้านบนทำหน้าที่นั้นอยู่แล้ว
          และมันคนละความหมายกับ "สเกล" ของหน้าอื่น (ดูคอมเมนต์ที่ state `custom`) */}
      {!board && (
        <TimeRangeBar
          scale={null} scales={null} presets={LOOKBACK_DAYS}
          from={from} to={to} today={today}
          onFrom={v => setCustomSide('from', v)}
          onTo={v => setCustomSide('to', v)}
          onPreset={d => setCustom(presetRange(d, today))}
          style={{ margin: '8px 0 10px', flexShrink: 0 }}
          note={custom
            ? tr("📌 กำลังใช้กรอบเวลาที่กำหนดเอง — กดปุ่ม สัปดาห์นี้/เดือนนี้/ปีนี้ ในแถบด้านบนเพื่อกลับไปช่วงมาตรฐาน")
            : tr("แก้วันที่หรือกดปุ่มย้อนหลัง เพื่อดูช่วงอื่นนอกเหนือจาก สัปดาห์นี้ / เดือนนี้ / ปีนี้")}
        />
      )}

      {board && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: tv ? 26 : 18, fontWeight: 900 }}>OBEYA</div>
          <div style={{ fontSize: tv ? 22 : 13, color: tv ? 'var(--text2)' : 'var(--muted)', fontWeight: tv ? 700 : 400 }}>
            {scopeText} · {periodText}{tv ? '' : ` · ${from} → ${to} · ${shiftCount.toLocaleString()} ${tr("กะ")}`}
          </div>
          <div style={{ flex: 1 }} />
          <button className="tv-hide" onClick={() => goBoard(false)} style={{
            fontSize: 12, padding: '4px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer',
            background: 'var(--bg3-surf)', color: 'var(--text)', border: '1px solid var(--border2)',
          }}>{tr('ออกจากโหมดจอ')}</button>
        </div>
      )}

      {loadWarn && (
        <div style={{ margin: '0 0 8px', fontSize: tv ? 20 : 12, color: 'var(--red)', fontWeight: 700 }}>
          ⚠️ {loadWarn}
        </div>
      )}

      {/* ⚠️ กล่องนอก = ที่ใส่ padding · กล่องใน (wrapRef) = ที่ถูกวัด **ห้ามมี padding**
          `clientHeight` รวม padding เสมอ ⇒ ถ้าวัดกล่องที่มี padding แผ่นจะสูงเกินไป
          แล้วแถวล่างถูก `overflow: clip` ตัดหายเงียบๆ (เจอจริงตอนวัดด้วย Playwright) */}
      <div ref={fitRef} style={{
        display: 'flex', minHeight: 0,
        flex: board ? 1 : 'none', height: board ? undefined : (fitOn ? `${availH}px` : shortScreen ? `${SHORT_GRID_H}px` : undefined),
        padding: board ? 8 : 0,
      }}>
      {/* 🔴 `clip` เมื่อคุมความสูงได้ · ที่ไม่พอจริง = ถอยไป `auto` ยอมให้เลื่อน (ดู useFitHeight) */}
      <div ref={wrapRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: fitOn || shortScreen ? 'clip' : 'auto' }}>
        {loading && (isYear ? !yr : !fSess.length) ? (
          <Skeleton cards={6} style={{ padding: '8px 0' }} />   /* 24/11: โครงเทาวิบแทนข้อความลอย (components/Skeleton) */
        ) : (
        <div style={sheetsBox}>

          {/* ═══ S — ความปลอดภัย ═══ */}
          {has('S') && (
          <Sheet k={k} cw={cw} idx={0} icon={axisSheet('S').icon} title={tr('S ความปลอดภัย')}
            sub={`${ytdTag}${tr("ใส่ PPE ครบตอนเช็คชื่อ")} (leading)`} big={kS.value ?? '—'} unit={kS.value != null ? '%' : ''}
            stat={statusWhy(kS.value, kS.target, 'up', '%')}
            foot={<WarnNote k={k} text={kS.note} tone="bad" />}
            link={tr("ไปหน้าเช็คชื่อ/PPE")} onLink={() => drill('/daily-checker')}>
            {isYear ? (yearBars(kS, { name: 'PPE ครบ' }) || <EmptyChart k={k} text={tr("ยังไม่มีบันทึกเช็คชื่อในปีนี้")} />) : kS.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daySeries(kS.series)} margin={{ top: 4, right: 6, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtAxis} domain={[0, 100]} tick={axisTick} width="auto" />
                  <Tooltip {...chartTip} formatter={v => [`${v}%`, 'PPE ครบ']} />
                  <ReferenceLine y={kS.target} stroke="var(--red)" strokeDasharray="4 3" />
                  <Bar {...chartAnim()} dataKey="v" fill={CELL_BAR_FILL} radius={[2, 2, 0, 0]}>
                    {daySeries(kS.series).map((p, i) => (
                      <Cell key={i} fill={statusColor(statusOf(p.v, kS.target, 'up'))} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text={tr("ยังไม่มีบันทึกเช็คชื่อในช่วงนี้")} />}
          </Sheet>
          )}

          {/* ═══ Q — คุณภาพ ═══
              %Q กระจุกใกล้ 100 ⇒ ขยายช่วงถาวรด้วย `focusDomain()` (เดิมเขียน domain เองว่า 95–100 โดยไม่มีป้าย = ผิดกติกาความซื่อสัตย์ 05/10)
              🔴 แกนไม่เริ่ม 0 ต้องมี <FocusAxisNote> เสมอ · ค่าที่มี 0 จริง = focusDomain คืน null = แกน 0–100 ตามปกติ */}
          {has('Q') && (() => { const qFocus = focusDomain([...(kQ.series || []).map(p => p.v), kQ.target], { max: 100 }); const qDom = qFocus ? qFocus.domain : [0, 100]; const qNote = (node) => (node ? <div style={{ position: 'relative', width: '100%', height: '100%' }}>{qFocus && <FocusAxisNote k={k} loText={String(qFocus.domain[0])} fixed />}{node}</div> : null); return (
          <Sheet k={k} cw={cw} idx={1} icon={axisSheet('Q').icon} title={tr('Q คุณภาพ')}
            sub={`${ytdTag}%Q ${tr("ถ่วงด้วยจำนวนผลิต")} · NG ${ngTotal.toLocaleString()} ${tr("ชิ้น")}`}
            big={kQ.value ?? '—'} unit={kQ.value != null ? '%' : ''}
            delta={gapToTarget(kQ.value, kQ.target, 'up')} stat={statusWhy(kQ.value, kQ.target, 'up', '%')}
            foot={kQ.note ? <WarnNote k={k} text={kQ.note} /> : `${tr("เป้า")} ${kQ.target}%`}
            link={tr("ดูของเสียละเอียด")} onLink={() => drill('/oee-analytics', { tab: 'insight', ...drillParams(org, scope) })}>
            {isYear ? (qNote(yearBars(kQ, { name: 'Q', domain: qDom, ticks: qFocus?.ticks })) || <EmptyChart k={k} text={tr("ยังไม่มีกะที่ปิดแล้วในปีนี้")} />) : kQ.series.length ? qNote(
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daySeries(kQ.series)} margin={{ top: 4, right: 6, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtAxis} domain={qDom} ticks={qFocus?.ticks} allowDataOverflow={!!qFocus} tick={axisTick} width="auto" />
                  <Tooltip {...chartTip} formatter={v => [`${v}%`, 'Q']} />
                  <ReferenceLine y={kQ.target} stroke="var(--red)" strokeDasharray="4 3" />
                  <Line {...chartAnim()} type="monotone" dataKey="v" stroke={axisSheet('Q').color} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>,
            ) : <EmptyChart k={k} text={tr("ยังไม่มีกะที่ปิดแล้วในช่วงนี้")} />}
          </Sheet>
          ); })()}

          {/* ═══ D — ส่งมอบ ═══ */}
          {has('D') && (
          <Sheet k={k} cw={cw} idx={2} icon={axisSheet('D').icon} title={tr('D ส่งมอบ')}
            sub={`${ytdTag}${tr("ผลิตได้ตามแผนในใบงาน")}`} big={kD.value ?? '—'} unit={kD.value != null ? '%' : ''}
            delta={gapToTarget(kD.value, kD.target, 'up')} stat={statusWhy(kD.value, kD.target, 'up', '%')}
            foot={kD.note ? <WarnNote k={k} text={kD.note} />
              : `${tr("แผน")} ${kD.plan.toLocaleString()} · ${tr("ทำได้")} ${kD.produced.toLocaleString()} ${tr("ชิ้น")}`}
            link={tr("ดูแผน/ใบงาน")} onLink={() => drill('/production-plan')}>
            {isYear ? (yearBars(kD, { name: 'ทำได้ตามแผน' }) || <EmptyChart k={k} text={tr("ยังไม่มีใบงานที่มีเป้าในปีนี้")} />) : kD.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daySeries(kD.series)} margin={{ top: 4, right: 6, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtAxis} tick={axisTick} width="auto" />
                  <Tooltip {...chartTip} formatter={v => [`${v}%`, 'ทำได้ตามแผน']} />
                  <ReferenceLine y={100} stroke="var(--red)" strokeDasharray="4 3" />
                  <Bar {...chartAnim()} dataKey="v" fill={CELL_BAR_FILL} radius={[2, 2, 0, 0]}>
                    {daySeries(kD.series).map((p, i) => (
                      <Cell key={i} fill={statusColor(statusOf(p.v, 100, 'up'))} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text={tr("ยังไม่มีใบงานที่มีเป้าในช่วงนี้")} />}
          </Sheet>
          )}

          {/* ═══ C — ต้นทุน ═══ */}
          {has('C') && (
          <Sheet k={k} cw={cw} idx={3} icon={axisSheet('C').icon} title={tr('C ต้นทุนที่เสียไป')}
            sub={`${isYear ? tr("รวมทั้งปี · ") : ""}${tr("เครื่องหยุดนอกแผน + ของเสีย + ค่า OT + ค่าซ่อม MO")}${otRate != null ? ` (${tr('OT ประมาณ')} ${otRateText(otRate)} × 1.5/2)` : ''}`}
            subFull={`${tr("เครื่องหยุดนอกแผน + ของเสีย + ค่า OT + ค่าซ่อม MO")} — ${tr('ค่าซ่อม MO = ค่าแรง + อะไหล่ที่ช่างกรอกในใบ นับวันที่ผู้แจ้งรับมอบ')} · ${tr('ค่า OT = ชม. OT จากเช็คชื่อ × ค่าแรงมาตรฐาน × ตัวคูณตามปฏิทิน (วันทำงาน 1.5 · วันหยุด 1.5/2) · ประมาณการให้เห็นภาพ ไม่ใช่ต้นทุนบัญชี')}${kC.otHolidayGuess ? ` · ${tr('วันหยุดที่ไม่มีใบจอง OT คิด 8 ชม.')} ${kC.otHolidayGuess} ${tr('คน-วัน')}` : ''}${kC.otApprox ? ` · ${tr('วันหยุดในโหมดปีคิด 8 ชม./คน')}` : ''}`}
            big={kC.value != null ? fmtBaht(kC.value) : '—'}
            stat={costStat}
            foot={kC.note ? <WarnNote k={k} text={kC.note} />
              : (
                <span>
                  {`${tr("เครื่องหยุด")} ${fmtBaht(kC.dtBaht)} · ${tr("ของเสีย")} ${fmtBaht(kC.ngBaht)} · OT ${fmtBaht(kC.otBaht)}${!isYear && kC.otHours ? ` (${kC.otHours} ${tr('ชม.')})` : ''} · ${tr('ซ่อม MO')} ${fmtBaht(kC.moBaht)}${kC.moN ? ` (${kC.moN} ${tr('ใบ')})` : ''}`}
                  {canManage && !tv && (
                    <button type="button" onClick={() => setOtRateOpen(true)} title={tr('ตั้งค่าแรงมาตรฐาน OT (บาท/ชม.) — ตัวเดียวทั้งโรงงาน · ประมาณการให้หน้างานเห็นภาพ')}
                      style={{ marginLeft: 6, background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)', color: 'var(--accent)', fontSize: 'inherit', padding: '0 6px', cursor: 'pointer' }}>
                      ✎ {otRate != null ? otRateText(otRate) : tr('ตั้งค่าแรง OT')}
                    </button>
                  )}
                </span>
              )}
            link={tr("ดู LOSS ละเอียด")} onLink={() => drill('/oee-analytics', { tab: 'insight', ...drillParams(org, scope) })}>
            {isYear ? (yearBars(kC, { stacked: true }) || <EmptyChart k={k} text={tr("ยังไม่มีความสูญเสียที่คิดเป็นเงินได้")} />) : kC.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daySeries(kC.series)} margin={{ top: 4, right: 6, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tick={axisTick} width="auto" tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                  <Tooltip {...chartTip} formatter={(v, n) => [fmtBaht(v), n === 'dt' ? tr("เครื่องหยุด") : n === 'ot' ? tr('ค่า OT') : n === 'mo' ? tr('ค่าซ่อม MO') : 'ของเสีย']} />
                  <Bar {...chartAnim()} dataKey="dt" stackId="c" fill="var(--amber)" />
                  <Bar {...chartAnim()} dataKey="ng" stackId="c" fill="var(--blue)" />
                  <Bar {...chartAnim()} dataKey="ot" stackId="c" fill="var(--purple)" />
                  <Bar {...chartAnim()} dataKey="mo" stackId="c" fill="var(--muted)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text={tr("ยังไม่มีความสูญเสียที่คิดเป็นเงินได้")} />}
          </Sheet>
          )}

          {/* ═══ M — กำลังคน ═══ */}
          {has('M') && (
          <Sheet k={k} cw={cw} idx={4} icon={axisSheet('M').icon} title={tr('M กำลังคน')}
            sub={`${ytdTag}${tr("มา")} ${kM.present ?? 0} · ${tr("ขาด")} ${kM.absent ?? 0}${kM.ot ? ` · OT ${kM.ot}` : ''}`}
            big={kM.value ?? '—'} unit={kM.value != null ? '%' : ''}
            delta={gapToTarget(kM.value, kM.target, 'up')} stat={statusWhy(kM.value, kM.target, 'up', '%')}
            foot={kM.note ? <WarnNote k={k} text={kM.note} />
              : tr("อัตรามาทำงานจากการเช็คชื่อรายวัน (ยังไม่มีข้อมูลขวัญกำลังใจ)")}
            link={tr("ดูกำลังคนย้อนหลัง")} onLink={() => drill('/workforce-insight')}>
            {isYear ? (yearBars(kM, { name: 'มาทำงาน' }) || <EmptyChart k={k} text={tr("ยังไม่มีบันทึกเช็คชื่อในปีนี้")} />) : kM.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daySeries(kM.series)} margin={{ top: 4, right: 6, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtAxis} domain={[0, 100]} tick={axisTick} width="auto" />
                  <Tooltip {...chartTip} formatter={(v, n) => (n === 'v' ? [`${v}%`, tr("มาทำงาน")] : [v, tr("คน")])} />
                  <ReferenceLine y={kM.target} stroke="var(--red)" strokeDasharray="4 3" />
                  <Bar {...chartAnim()} dataKey="v" fill={axisSheet('M').color} radius={[2, 2, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text={tr("ยังไม่มีบันทึกเช็คชื่อในช่วงนี้")} />}
          </Sheet>
          )}

          {/* ═══ OEE — แผ่นแนวนอน (2 ช่อง) ═══ */}
          {has('oee') && (
          <Sheet k={k} cw={cw} idx={5} span={2} icon="⚙️" title={tr('OEE เทียบเป้า')}
            sub={`${ytdTag}A ${kOee.a ?? '—'} · P ${kOee.p ?? '—'} · Q ${kOee.q ?? '—'}  |  ${tr("เป้า")} A${target.a}/P${target.p}/Q${target.q}`}
            big={kOee.value ?? '—'} unit={kOee.value != null ? '%' : ''}
            delta={gapToTarget(kOee.value, kOee.target, 'up')}
            stat={statusWhy(kOee.value, kOee.target, 'up', '%')}
            foot={isYear
              ? (kOee.value != null
                ? `YTD ${kOee.value}% ${tr("จาก")} ${kOee.months} ${tr("เดือน")} · ${kOee.shifts.toLocaleString()} ${tr("กะ · แท่ง \"สรุป\" = เฉลี่ยถ่วงน้ำหนักทั้งปี · กดแท่งเดือนเพื่อเจาะรายวัน")}`
                : tr("ยังไม่มีกะที่ปิดแล้วในปีนี้"))
              : kOee.value != null && kOeePrev.value != null
              ? `${tr("งวดก่อน")} ${kOeePrev.value}% (${prev.from}→${prev.to}) · ${kOee.value >= kOeePrev.value ? tr('ดีขึ้น') : tr('แย่ลง')} ${Math.abs(round1(kOee.value - kOeePrev.value))} ${tr("จุด")}`
              : tr("ยังเทียบงวดก่อนไม่ได้ (งวดก่อนไม่มีกะที่ปิดแล้ว)")}
            link={tr("เจาะ OEE")} onLink={() => drill('/oee-analytics', { ...drillParams(org, scope), date: to })}>
            {isYear ? (yearBars(kOee, { name: 'OEE', span: 2 }) || <EmptyChart k={k} text={tr("ยังไม่มีกะที่ปิดแล้วในปีนี้")} />) : kOee.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daySeries(kOee.series)} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtAxis} domain={[0, 100]} tick={axisTick} width="auto" />
                  <Tooltip {...chartTip} formatter={v => [`${v}%`, 'OEE']} />
                  <ReferenceLine y={kOee.target} stroke="var(--red)" strokeDasharray="5 3"
                    label={{ value: `เป้า ${kOee.target}%`, position: 'insideTopRight', fill: 'var(--red)', fontSize: fs(10) }} />
                  <Bar {...chartAnim()} dataKey="v" fill={CELL_BAR_FILL} radius={[2, 2, 0, 0]}>
                    {daySeries(kOee.series).map((p, i) => (
                      <Cell key={i} fill={statusColor(statusOf(p.v, kOee.target, 'up'))} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text={tr("ยังไม่มีกะที่ปิดแล้วในช่วงนี้")} />}
          </Sheet>
          )}

          {/* ═══ ทำไมหลุดเป้า — Pareto ═══ */}
          {has('why') && (
          <Sheet k={k} cw={cw} idx={6} icon="🔎" title={tr('ทำไมถึงหลุดเป้า')}
            sub={`${isYear ? tr('รวมทั้งปี · ') : ''}${tr("เวลาเครื่องหยุดนอกแผน (นาที")})`}
            big={pareto.total ? pareto.total.toLocaleString() : '—'} unit={pareto.total ? 'นาที' : ''}
            stat={paretoStat}
            foot={pareto.rows.length
              ? `${tr("อันดับ")} 1 "${pareto.rows[0].name}" = ${Math.round((pareto.rows[0].min / pareto.total) * 100)}% ${tr("ของเวลาที่เสีย")}`
              : tr("ไม่มีเวลาเครื่องหยุดนอกแผนในช่วงนี้")}
            link={tr("ดู Pareto เต็ม")} onLink={() => drill('/oee-analytics', { tab: 'insight', ...drillParams(org, scope) })}>
            {pareto.rows.length ? (
              <ResponsiveContainer width="100%" height="100%">
                {/* แกนตัวเลขซ่อนเพื่อประหยัดที่ในแผ่น A4 ⇒ ต้องเขียนตัวเลขที่ปลายแท่งแทน (กราฟไม่มีตัวเลข = อ่านไม่ได้ · chartsweep) */}
                <BarChart data={pareto.rows} layout="vertical" margin={{ top: 2, right: 44, left: 2, bottom: 2 }}>
                  <XAxis type="number" tick={axisTick} hide />
                  {/* ชื่อสาเหตุยาวกว่าแกน = Recharts ตัดขึ้นบรรทัดใหม่ แถวล่างสุดล้นขอบล่างของ SVG (chartsweep 05/10: "Sensor / Ree…" ยื่น 3px) ⇒ ตัดให้อยู่บรรทัดเดียวด้วย shortTick ตามความกว้างแกน · ชื่อเต็มอยู่ใน tooltip */}
                  <YAxis type="category" dataKey="name" tick={{ ...axisTick, fontSize: fs(9.5) }} width={Math.round(cw * 0.42)}
                    tickFormatter={shortTick(Math.max(8, Math.floor((Math.round(cw * 0.42) - 8) / (fs(9.5) * 0.8))))} />
                  <Tooltip {...chartTip} formatter={v => [`${v} ${tr("นาที")}`, 'เวลาที่เสีย']} />
                  <Bar {...chartAnim()} dataKey="min" fill="var(--amber)" radius={[0, 3, 3, 0]}>
                    <LabelList dataKey="min" position="right" formatter={v => `${Math.round(v).toLocaleString()} ${tr("น.")}`}
                      style={{ fontSize: fs(10), fill: 'var(--text2)', fontWeight: 700 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text={tr("ไม่มีเวลาเครื่องหยุดนอกแผน")} />}
          </Sheet>
          )}

          {/* ═══ ACTION BOARD — แผ่นแนวนอน (2 ช่อง) · ที่เดียวของหน้าที่เขียนข้อมูลได้ ═══ */}
          {has('action') && (
          <Sheet k={k} cw={cw} idx={7} span={2} icon="📋" title={tr('ACTION BOARD — สิ่งที่ตกลงกันว่าจะแก้')}
            sub={`${health.empty ? tr('ยังไม่มีใครบันทึกสักใบ') : `${tr("เป็นๆ")} ${health.liveCount} ${tr("ใบ · ปิดแล้ว")} ${health.done.length} ${tr("ใบ")}${health.closeRate != null ? ` (${health.closeRate}%)` : ''}`}${scopedActs.hidden ? ` · ${tr("นอกขอบเขต")} ${scopedActs.hidden} ${tr("ใบ")}` : ''}`}
            big={health.overdue.length || (health.empty ? '0' : health.liveCount)}
            unit={health.overdue.length ? 'ใบเกินกำหนด' : 'ใบค้าง'}
            stat={actionStat}>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 4, padding: '0 6px 2px', minHeight: 0 }}>
              {health.empty ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                  <WarnNote k={k} tone="bad"
                    text={tr("ยังไม่มีใบ action ในช่วงที่ดู — ตามงานไม่ได้ว่าปัญหาที่พบถูกแก้หรือยัง (ตั้ง Action จากปุ่มบนหัวจอ)")} />
                  <div className="tv-hide" style={{ fontSize: fs(11), color: 'var(--muted)', lineHeight: 1.4 }}>
                    {tr("นี่คือเหตุผลหลักที่ทำหน้านี้ — ไม่ใช่เพื่อโชว์ตัวเลขสวยๆ แต่เพื่อปิดลูป: ตัวเลขหลุดเป้า → ใครรับ → ทำอะไร → ภายในเมื่อไหร่ → ดีขึ้นจริงไหม")}
                  </div>
                  {canRecord && (
                    <button className="tv-hide" onClick={() => openModal()} style={{
                      alignSelf: 'flex-start', fontSize: fs(12), fontWeight: 800, padding: '6px 14px',
                      borderRadius: 'var(--r-md)', background: 'var(--accent2)', color: 'var(--accent-ink)', border: 'none', cursor: 'pointer',
                    }}>{tr('➕ ตั้งใบแรก')}</button>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flexShrink: 0 }}>
                    {[['เกินกำหนด', health.overdue.length, 'bad'], ['ใกล้ครบ', health.dueSoon.length, 'warn'],
                      ['กำลังทำ', health.open.length, 'info'], ['ปิดแล้ว', health.done.length, 'good']].map(([l, n, c]) => (
                      <span key={l} style={{
                        fontSize: fs(10.5), fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-pill)', color: toneVar(c),
                        background: 'var(--bg3)', backgroundImage: `linear-gradient(${toneDim(c)}, ${toneDim(c)})`, border: `1px solid ${toneLine(c)}`,
                      }}>{l} {n}</span>
                    ))}
                    {canRecord && (
                      <button className="tv-hide" onClick={() => openModal()} style={{
                        fontSize: fs(10.5), fontWeight: 800, padding: '2px 10px', borderRadius: 'var(--r-md)', marginLeft: 'auto',
                        background: 'var(--accent2)', color: 'var(--accent-ink)', border: 'none', cursor: 'pointer',
                      }}>{tr('➕ ตั้ง Action')}</button>
                    )}
                  </div>
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[...health.overdue, ...health.dueSoon, ...health.open].slice(0, 20).map((a) => {
                      const late = health.overdue.includes(a);
                      return (
                        <div key={a.id} style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 'var(--r-xs)',
                          background: 'var(--bg3)', borderLeft: `3px solid ${late ? 'var(--red)' : 'var(--blue)'}`,
                        }}>
                          {a.kpi_key && (
                            <span style={{ fontSize: fs(10), fontWeight: 900, color: axisSheet(a.kpi_key)?.color || 'var(--muted)' }}>
                              {a.kpi_key}
                            </span>
                          )}
                          <span title={a.problem} style={{ fontSize: fs(11), fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {(a.problem || '').trim() || tr("(ไม่มีหัวข้อ)")}
                          </span>
                          <span style={{ fontSize: fs(10), color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {a.line_name || '—'} · {(a.assignee || '').trim() || tr("ยังไม่ระบุผู้รับผิดชอบ")} · {a.due_date || tr("ไม่มีกำหนด")}
                          </span>
                          {/* 🔍 กดขยายในแอป (16/11) — เดิมเปิดแท็บใหม่ = ออกจากบอร์ดที่กำลังประชุมอยู่ */}
                          {a.result_img && (
                            <ActionImgBtn url={a.result_img} label={a.problem} result={a.result_value} fs={fs} />
                          )}
                          {canRecord && (
                            /* เปิดหน้าต่างปิดงาน (ใส่ผล + รูป) แทนการปิดทันที — ปิดเปล่าๆ ไม่มีหลักฐานว่าแก้อะไร */
                            <button className="tv-hide" onClick={() => setClosing({ a, result: a.result_value || '', file: null })} style={{
                              fontSize: fs(10), fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                              background: 'var(--bg2-surf)', color: 'var(--green)', border: '1px solid var(--green-line)',
                            }}>{tr('ปิด')}</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </Sheet>
          )}

        </div>
        )}
      </div>
      </div>
      {/* 📖 แถบเปลี่ยนหน้า — โผล่เฉพาะตอนมีมากกว่า 1 หน้า */}
      <BoardPager page={pg} count={pages.length} onPage={setPg} labels={pgLabels} compact={board} />

      {/* ── modal ปิด action (ผลที่ทำ + รูปหลักฐาน · ทั้งคู่ไม่บังคับ) ───────────── */}
      {closing && (
        <div className="modal-scroll" style={{
          position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--card-surf)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)',
            padding: 16, width: 'min(460px, 100%)', maxHeight: '90%', overflowY: 'auto',
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>{tr('✅ ปิดงานติดตาม')}</h3>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 10 }}>
              {(closing.a.problem || '').trim() || tr("(ไม่มีหัวข้อ)")}
            </div>
            <div style={{ display: 'grid', gap: 9 }}>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ทำอะไรไป / ผลที่ได้ (ไม่บังคับ)')}
                <textarea value={closing.result} rows={3} onChange={e => setClosing({ ...closing, result: e.target.value })}
                  style={{ marginTop: 3, fontSize: 13.5 }} placeholder={tr('เช่น เปลี่ยนตัวจับชิ้นงานเป็นแบบ quick clamp · เวลาเปลี่ยนรุ่นลดจาก 25 → 14 นาที')} />
              </label>
              <QualityPhotoField label={tr('รูปหลักฐาน (ไม่บังคับ)')} url={closing.a.result_img || null} file={closing.file}
                hint={tr('ถ่ายสิ่งที่แก้ไปจริง — เดือนหน้าปัญหาเดิมกลับมาจะได้ย้อนดูได้')}
                onPick={(f) => setClosing({ ...closing, file: f })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setClosing(null)} disabled={closeSaving} style={{
                fontSize: 13, padding: '7px 14px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                background: 'var(--bg3-surf)', color: 'var(--text2)', border: '1px solid var(--border2)',
              }}>{tr('ยกเลิก')}</button>
              <button onClick={doClose} disabled={closeSaving} style={{
                fontSize: 13, fontWeight: 800, padding: '7px 18px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                background: 'var(--green)', color: 'var(--accent-ink)', border: 'none',
              }}>{closeSaving ? tr('⏳ กำลังบันทึก...') : tr('✅ ปิดงาน')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── modal ตั้ง action ─────────────────────────────────────────────────── */}
      {otRateOpen && (
        <OtRateModal value={otRate} fullName={fullName}
          onClose={() => setOtRateOpen(false)}
          onSaved={(v) => { setOtRate(v); setOtRateFail(false); setOtRateOpen(false); }} />
      )}
      {modal && (
        <div className="modal-scroll" /* ไม่ปิดจาก backdrop — UI-CONVENTIONS §5: เผลอแตะพื้นหลังแล้วข้อมูลหายทั้งฟอร์ม (ปิดด้วยปุ่มยกเลิก/✕ เท่านั้น) */ style={{
          position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--card-surf)', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)',
            padding: 16, width: 'min(520px, 100%)', maxHeight: '90%', overflowY: 'auto',
          }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 17 }}>{tr('➕ ตั้ง Action Item (OBEYA')} {today})</h3>
            <div style={{ display: 'grid', gap: 9 }}>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('แกนที่จะไปแก้')}
                <select value={modal.kpi_key} onChange={e => setModal({ ...modal, kpi_key: e.target.value })}
                  style={{ marginTop: 3, fontSize: 13.5 }}>
                  <option value="">{tr('— ไม่ระบุแกน —')}</option>
                  {OBEYA_AXES.map(a => <option key={a.key} value={a.key}>{a.icon} {a.key} · {tr(a.label)}</option>)}
                  <option value="OEE">⚙️ OEE</option>
                </select>
              </label>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ปัญหา / สิ่งที่ต้องทำ *')}
                <textarea value={modal.problem} rows={2} onChange={e => setModal({ ...modal, problem: e.target.value })}
                  style={{ marginTop: 3, fontSize: 13.5 }} placeholder={tr('เช่น ลดเวลาเปลี่ยนแม่พิมพ์ไลน์ 060 จาก 25 นาที เหลือ 15 นาที')} />
              </label>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('สาเหตุ (ถ้ารู้แล้ว)')}
                <textarea value={modal.root_cause} rows={2} onChange={e => setModal({ ...modal, root_cause: e.target.value })}
                  style={{ marginTop: 3, fontSize: 13.5 }} />
              </label>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ไลน์')}
                <LineSelect lines={lines} value={modal.line_name} onChange={v => setModal({ ...modal, line_name: v })}
                  role={role} lineId={lineId} sections={sections} style={{ marginTop: 3, fontSize: 13.5 }} />
              </label>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr("ผู้รับผิดชอบ")}
                <PersonSelect value={modal.assignee || ''} source="both" history={assigneeHist}
                  placeholder={tr('ชื่อผู้รับผิดชอบ')} style={{ marginTop: 3 }}
                  onChange={v => setModal({ ...modal, assignee: v })} />
              </div>
              <div style={{ display: 'flex', gap: 9 }}>
                <label style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1 }}>{tr('กำหนดเสร็จ')}
                  <input type="date" value={modal.due_date} onChange={e => setModal({ ...modal, due_date: e.target.value })}
                    style={{ marginTop: 3, fontSize: 13.5, width: '100%' }} />
                </label>
                <label style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1 }}>{tr('เป้าที่ตกลงกัน')}
                  <input type="number" step="0.1" value={modal.target_value} placeholder={tr('เช่น 82')}
                    onChange={e => setModal({ ...modal, target_value: e.target.value })}
                    style={{ marginTop: 3, fontSize: 13.5, width: '100%' }} />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setModal(null)} disabled={saving} style={{
                fontSize: 13.5, padding: '7px 14px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                background: 'var(--bg3-surf)', color: 'var(--text)', border: '1px solid var(--border2)',
              }}>{tr('ยกเลิก')}</button>
              <button onClick={saveAction} disabled={saving} style={{
                fontSize: 13.5, fontWeight: 800, padding: '7px 16px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none',
              }}>{saving ? tr('กำลังบันทึก…') : tr('บันทึก')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* 💸 โมดัลตั้ง "ค่าแรงมาตรฐาน OT" (26/11 · user: "ใช้ 50 บาทไปก่อน") — ตัวเลขเดียวทั้งโรงงาน · บันทึกที่ obeya_cost_settings id='default'
   🔴 ประมาณการให้หน้างานเห็นภาพ ไม่ใช่ต้นทุนบัญชี — เขียนไว้ในโมดัลและบนแผ่น · RLS has_perm('kpi:manage') · เขียนผ่าน checkWriteRows (RLS ปฏิเสธ = 0 แถว) */
function OtRateModal({ value, fullName, onClose, onSaved }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = Number(v);
    if (!(n >= 0) || v === '') { toast.error(tr('กรอกค่าแรงเป็นตัวเลข ≥ 0')); return; }
    setBusy(true);
    const ok = checkWriteRows(await supabase.from('obeya_cost_settings').update({ ot_wage_per_hour: n, updated_by_name: fullName || null }).eq('id', 'default').select('id'),
      tr('ค่าแรงมาตรฐาน OT'), { zeroMsg: 'ไม่มีสิทธิ์ kpi:manage' });
    setBusy(false);
    if (ok) { toast.success(`${tr('ตั้งค่าแรง OT')} ${n.toLocaleString('en-US')} ${tr('บาท/ชม. แล้ว')}`); onSaved(n); }
  };
  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      {/* ฟอร์มกรอก ⇒ ปิดด้วยปุ่มเท่านั้น (ด่าน modal-closes-on-backdrop) */}
      <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', padding: 18, width: 'min(420px, 96vw)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{tr('ค่าแรงมาตรฐาน OT')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 12px', lineHeight: 1.6 }}>
          {tr('ตัวเลขเดียวทั้งโรงงาน ใช้คิด "ค่า OT" บนแกน C: ชม. OT จากเช็คชื่อ × ค่าแรงนี้ × ตัวคูณตามปฏิทิน (วันทำงาน 1.5 · วันหยุด 1.5/2)')}
          <br /><b style={{ color: 'var(--amber)' }}>{tr('ประมาณการเพื่อให้หน้างานเห็นภาพ ไม่ใช่ต้นทุนบัญชี')}</b>
        </div>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{tr('บาท / ชั่วโมง')}</label>
        <input type="number" min="0" step="any" value={v} onChange={e => setV(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 16, fontWeight: 800, padding: '8px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="pg-btn" onClick={onClose}>{tr('ยกเลิก')}</button>
          <button type="button" className="pg-btn primary" disabled={busy} onClick={save}>{busy ? tr('กำลังบันทึก…') : tr('บันทึก')}</button>
        </div>
      </div>
    </div>
  );
}
