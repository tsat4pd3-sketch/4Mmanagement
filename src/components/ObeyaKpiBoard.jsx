import { toneVar, toneDim, toneLine } from '../utils/statusTone';   // 🎨 token พาเลต 5 สี (UI §6.17)
import InfoMore from './InfoMore';   // ⓘ คำอธิบายยาวพับไว้ (UI §6.10)
import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { urlBool } from '../utils/urlInit';
import { lineNameCompare } from '../utils/lineHierarchy';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from 'recharts';
import { chartAnim } from '../utils/motion';
import TabBody from './TabBody';   // 25/11: เปลี่ยนขอบเขต = cross-fade ทั้งกระดานครั้งเดียว (จังหวะเดียวกับสลับแท็บ)
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';
import { fetchByIds } from '../utils/fetchByIds';
import { SESSION_STATUSES_LIVE } from '../utils/sessionStatus';
import { scoreDef, defBars, unitOf, decimalsOf, summaryModeOf, summaryShort, summaryModeLabel, fmtBar, valueScopeOf, sharedValueDef, yearForecast, neededRunRate, boardSlotOf, baseVarOf, formulaOf } from '../utils/kpiSetup';
import { buildInsight } from '../utils/kpiInsight';
import Segmented from './Segmented';   // 🔁 สลับ ค่าคำนวณ ↔ ค่าดิบ ใน popup 🔍 (25/11)   // 🔎 สรุป insight ใน popup 🔍 (16/11 · เรียงตามความสำคัญมาแล้ว)
import InsightList from './InsightList';             // 🔎 กล่อง insight 3 ข้อ + กางดูที่เหลือ (ของกลาง · UI §6.38)
import { scopedLineNames } from '../utils/sectionScope';
import useOrgScope from '../utils/useOrgScope';
import OrgScopePicker from './OrgScopePicker';
import { PLANT, isPlant, scopeKey, parseScopeKey, scopeOfDef, scopeCovers, sameScope, filterScopeOptions, drillParams, scopeUnder, scopePathText, canonicalScope } from '../utils/orgScope';
import { canAccessPage } from '../utils/permissions';
import { useLiveBoard } from '../utils/useLiveBoard';
import { LIVE, RATE } from '../utils/refreshRates';
import { toast } from './Toast';
import PageHeader from './PageHeader';
import OverflowMenu from './OverflowMenu';   // ⋯ ปุ่มตายตัว ≤2 (UI §6.35)
import { OBEYA_TITLE, OBEYA_ICON } from '../utils/obeyaPage';
import ReadOnlyNote from './ReadOnlyNote';
import SafetyEventModal from './SafetyEventModal';
import KpiMonthNoteModal from './KpiMonthNoteModal';
import { tooltipProps, CELL_BAR_FILL, focusDomain, axisUnitLabel, axisUnitTop } from '../utils/chartAxis';
import { groupChildDefs, rollupChildDefs, childGroupKeyFor, fillParentWithChildren } from '../utils/kpiRollup';
import { pickBoardRows, normKpiRowName, moveBoardKey } from '../utils/kpiBoardRows';
import { checkWriteRows } from '../utils/dbWrite';
import { loadPmTeams, pmTeamsSync } from '../utils/pmTeams';
import { mtnAutoSeries, autoKpiOfName, toRowUnit, autoDetailText, HOURS_PER_MONTH } from '../utils/kpiAuto';
import { GAP, useSheetGrid, StatusLamp, Sheet, WarnNote, EmptyChart, FocusAxisNote, TV_SHEET_GRID } from './ObeyaSheet';
import useTvShell from '../utils/useTvShell';
import { balanceGrid } from '../utils/sheetGrid';
import { applyFormulaEntries, buildBaseIndex, formulaNoteText, amountCompanion, amountText, formulaPartSeries, formulaOfDef } from '../utils/kpiFormula';
import { headcountAuto, headcountAutoVar } from '../utils/kpiHeadcount';
import { boardFlipSec, activeDwellSecOf } from '../utils/displayRotation';
import BoardPager from './BoardPager';
import useFitHeight from '../utils/useFitHeight';
import { packPages, clampPage, pageLabels, cellsUsed } from '../utils/boardPager';
import useIsMobile from '../utils/useIsMobile';
import { isProductionUnit } from '../utils/unitKind';   // 🏭 แผ่น OEE/PPM เฉพาะขอบเขตที่มี "ไลน์ผลิต" (16/11)
import { statusColor, gapToTarget } from '../utils/obeyaKpi';
import {
  yearOf, monthKeys, monthLabel, lastDayOf, SUMMARY_KEY,
  axisOeeYear, axisPpmYear, manualMonthSeries, monthBarScore, autoMonthsOf, fillAutoWithManual, attachManOverlay,
} from '../utils/obeyaYear';
import { ST, worstStatus, safetyKind, isInjury, ymd } from '../utils/obeya';

import { tr, dateLocale } from '../utils/i18n';
import Skeleton from './Skeleton';
/* ══ 📋 OBEYA — บอร์ด KPI ส่วนงาน · 2026-08-27 → 2026-09-23 (วาดใหม่เป็น "แผ่น A4" ชุดเดียวกับจอ SQDCM) ═══
   แทนกระดาษ "OBEYA KPI monitoring" ที่แปะผนังห้องประชุมหน้างาน (คำสั่งนายใหญ่ผ่าน user 2026-08-27)
   user เคาะ 3 ข้อ: ① แยกรายส่วนงาน ② ตัวไหนวิ่งทุกกะให้อัพเดทรายวัน ③ มีแกน Safety

   ═══ 23/09/2026 — user: "tab kpi กับ obeya มันควรจะรูปแบบเดียวกัน" ══════════════════════════════
   เดิมแท็บนี้เป็นตารางแถว (คอลัมน์ = กลุ่มไลน์ × 8 แถว) ส่วนจอ SQDCM เป็นกระดาษ A4 + กราฟ + ไฟสถานะ
   ⇒ ตอนนี้ **ทั้ง 2 แท็บวาดจาก `ObeyaSheet.jsx` ชิ้นเดียวกัน** — ผัง 5×2 = 10 แผ่น:
     แผ่น = KPI ที่หน่วยถือจริง (8 ช่องมาตรฐานเฉพาะที่มีนิยาม/มีไลน์ + KPI พิเศษของหน่วยเป็นแผ่นเต็ม · 05/10) + 🚨 งานที่ต้องตามแก้
     แต่ละแผ่น = ตัวเลขใหญ่ (เดือนที่เลือก) · ไฟสถานะตามเกณฑ์ทางการ 1/0.5/0 · **กราฟ 12 เดือน + แท่ง "สรุป"**
     (ทิศทางเดียวกับโหมดปีของจอ SQDCM) · กดแท่งเดือน = สลับบอร์ดไปเดือนนั้น
   · "คอลัมน์ = กลุ่มไลน์" ของกระดาษเดิม กลายเป็น **ขอบเขต 1 ใบต่อ 1 บอร์ด** — 23/09 ขยายเป็น
     `<OrgScopePicker>` ทุกมิติของผัง (ฝ่าย/ส่วนงาน/แผนก/กลุ่มไลน์/ไลน์/CC · `src/utils/orgScope.js`)
     + ชิปเจาะลง/กลับขึ้นหนึ่งชั้น · deep-link: `?scope=department:HYDROFORM&date=…` (ยังรับ `?section=&group=` เก่า)
     · นิยาม/เป้าไต่จากขอบเขตที่เลือกขึ้นบรรพบุรุษ (แผนก→ส่วนงาน→ฝ่าย→โรงงาน) แล้วบอกว่าเอามาจากชั้นไหน · KPI ของหน่วยที่ไม่เข้าช่อง = แผ่นแยก def:<id> (05/10)
     · ขอบเขตที่ไม่มีไลน์ผลิต (JIG MTN) = แผ่น OEE/PPM ว่างโดยตั้งใจ · ใบ KPI ของหน่วยงานอยู่แผ่น 📌
   · แถบ "ภาพรวมส่วนงาน SQDCM รายวัน" ที่เคยแถมท้ายหน้า **ถอดออก** — ซ้ำกับแท็บ 🖥️ ทั้งดุ้น (กฎ "ห้ามยุบ 2 แท็บ"
     หมายถึงห้ามรวมเป็นบอร์ดเดียว ไม่ได้แปลว่าต้องวาดซ้ำ 2 ที่)

   ═══ ข้อมูล: โหลด "ผลรวมรายเดือน" ไม่ใช่แถวดิบ ═══════════════════════════════════════════════
   กราฟ 12 เดือนต้องการทั้งปี ⇒ ใช้ RPC `obeya_year_rollup` (DR · Σ ต่อ (เดือน, ไลน์)) ตัวเดียวกับโหมดปี
   ของจอ SQDCM (~140 KB/ปี เทียบแถวดิบ 14 วันของโครงเดิม ~300 KB+) แล้ว `obeyaYear.js` เป็นคนหาร/ถ่วง
   🔴 RPC คืน Σ อย่างเดียว — OEE ถ่วง shift_min · PPM = ของเสีย(line-mode) ÷ (สแกนดี+เสีย) · ห้ามคำนวณใน SQL
   ⚠️ ค่าเดือนที่ได้จาก Σ นี้ **ถ่วงด้วย shift_min เต็ม** (ไม่หัก planned DT ที่ตัดช่วงพักแล้วเหมือนโครงเดิม)
      = ชุดเดียวกับโหมดเดือน/ปีของจอ SQDCM ⇒ 2 แท็บตัวเลขตรงกัน (เดิมต่างกันเล็กน้อยแล้วอธิบายไม่ได้)

   ═══ กฎที่ยึด ═════════════════════════════════════════════════════════════════════════════
   • **อ่านอย่างเดียว** ยกเว้นปุ่มบันทึกเหตุการณ์ความปลอดภัย · ทุกแผ่นกดไปหน้าที่ทำงานจริง
   • **สถานะแถว KPI ผ่าน `scoreDef()` เท่านั้น** (เกณฑ์ทางการ ถึง Target = 1 · ถึง Commitment = 0.5 · ไม่ถึง = 0)
     — ทั้งไฟบนหัวแผ่นและสีแท่งรายเดือน (`monthBarScore`) · ห้ามใช้ statusVsTarget/แถบ ±5% กับแถว KPI
   • **ไม่มีเป้า ≠ ผ่าน** = เทา + บอกว่าไปตั้งที่ไหน · **ไม่มีค่า ≠ 0** = ไม่มีแท่ง
   • **Safety**: ⚡ นับบาดเจ็บจาก `safety_events` รายเดือน = ค่าหลัก · ✍️ สรุปจากหน่วยงานความปลอดภัย (กรอกมือ) เติมเฉพาะเดือนที่หน้างานไม่มีบันทึก (09/10 — เดิม 07/09 สรุปหน่วยงานชนะ)
     · ไม่มีบันทึกเลย = เทา **ห้ามเขียว** · ห้ามบวก 2 แหล่ง
   • egress: useLiveBoard(production_sessions · RATE.BOARD + idle gate) — แท็บซ่อน = หยุดยิง · ห้าม subscribe realtime prod_orders/downtime_logs
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

/* ── 8 หัวข้อบนบอร์ดจริง (ถอดจากป้ายเหลืองในรูปที่ user ถ่ายมา 2026-09-01) ───────────────────────
   ⚠️ `name` ต้องตรงกับชื่อใน `kpi_catalog` (migration 20260901_kpi_line_group · แถวปี 2026: 20260907_kpi_catalog_2026_rm_dloh)
      จับคู่แบบ normName → เปลี่ยนตัวพิมพ์/ช่องว่างในทะเบียนแล้วยังหาเจ้อ
   `auto` = ระบบคำนวณให้เอง อัพเดททุกวัน (ตอบข้อ ② ของ user) · `auto: null` = ต้องกรอกที่แท็บ 📑 (ไม่มีข้อมูลตั้งต้นในระบบ)
   ⚠️ ห้ามเดาค่าให้แถว manual — ไม่มีค่า = "ยังไม่กรอก" ไม่ใช่ 0 */
const ROWS_COMMON = [
  { key: 'inv',   name: 'Inventory Balance',     icon: '📦', auto: null },
  { key: 'csat',  name: 'Customer Satisfaction', icon: '🤝', auto: null },
  { key: 'oee',   name: 'OEE',                   icon: '⚙️', auto: 'oee',    unit: '%',   dir: 'up',   to: '/oee-analytics' },
  { key: 'ppm',   name: 'PPM',                   icon: '🎯', auto: 'ppm',    unit: 'PPM', dir: 'down', to: '/oee-analytics?tab=insight' },   // ⚠️ `tab=lean` ไม่มีจริง (ตกไปแท็บวันนี้เงียบๆ) — แก้ 30/09
  { key: 'safe',  name: 'Safety',                icon: '🦺', auto: 'safety', unit: 'ครั้ง', dir: 'down' },
  { key: 'train', name: 'Training',              icon: '🎓', auto: null },
];
/* หมวด Financial เปลี่ยนโครงตามปี (user 2026-09-07: ปี 2026 = %RM ข้อ 1 + DL กับ OH รวมเป็นข้อเดียว · ไฟล์ตัวอย่างเป็นโครงปี 2024)
   ชื่อเก่าในทะเบียนไม่ rename (ตัวตน KPI ข้ามปีต้องคงเดิม) แต่ปิดใช้งานไว้ · เปิดบอร์ดย้อนปี ≤ 2025 ยังได้ DL/OH แยกเหมือนกระดาษเดิม */
const ROWS_FIN_2026 = [
  { key: 'rm',    name: '%RM (Raw Material)',    icon: '🧱', auto: null },
  { key: 'dloh',  name: 'DL+OH (Direct Labor + Overhead)', icon: '💵', auto: null },
];
const ROWS_FIN_LEGACY = [
  { key: 'dl',    name: 'Direct Labor',          icon: '💵', auto: null },
  { key: 'oh',    name: 'Overhead',              icon: '🏷️', auto: null },
];
export const boardRowsFor = year => [...(Number(year) >= 2026 ? ROWS_FIN_2026 : ROWS_FIN_LEGACY), ...ROWS_COMMON];
const normName = normKpiRowName;   // ตัวเดียวกับ utils/kpiBoardRows (ชื่อแบบเทียบได้)
const DEFAULT_APQ = { a: 90, p: 90, q: 99 };   // ค่ามาตรฐานเมื่อกรุ๊ปยังไม่ตั้งเป้า (กฎ oee_targets)

/* วันที่งาน (ตัด 08:00 — งานกะดึกข้ามวันนับเป็นวันก่อนหน้า) · ห้ามใช้ toISOString() (UTC) */
function workDateNow() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return ymd(d);
}
const nf = (v, d = 0) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
/** วันสุดท้ายของเดือน `k` แต่ไม่เกิน `today` (เดือนปัจจุบัน = วันนี้) */
const monthEnd = (k, today) => {
  const end = `${k}-${String(lastDayOf(k)).padStart(2, '0')}`;
  return end < today ? end : today;
};
/** ป้ายสถานะ (คำ + เหตุผล) ให้ StatusLamp — คำชุดเดียวกับจอ SQDCM */
const LAMP_LABEL = { good: 'ตามเป้า', warn: 'ถึง Commitment', bad: 'หลุดเป้า', none: 'ตัดสินไม่ได้' };
/* 🗂️ ชื่อหน้าปลายทางของ "ข้อมูลต้นทาง" (20/11) — ปุ่มต้องบอกว่าพาไปจอไหน ไม่ใช่ "เจาะดู" ลอยๆ · path ไม่รู้จัก = ชื่อ path ตรงๆ */
const SRC_PAGE_NAMES = { '/oee-analytics': 'OEE Analytics', '/safety': 'Safety', '/bbs': 'BBS' };
const srcPageName = (to) => SRC_PAGE_NAMES[String(to || '').split('?')[0]] || String(to || '').split('?')[0].replace(/^\//, '');
/* ตัวเลขฐานของสูตรบนจอ — บาท ≥ 1 ล้าน = MB · ไม่งั้น บ. · ตัวแปรอื่นตามหน่วยของมัน (ใช้ร่วมบรรทัดรอง 🧮 + insight 🔍) */
const fmtInVar = (v, x) => { const u = baseVarOf(v)?.unit || ''; if (x == null) return '—'; if (u === 'บาท') return Math.abs(x) >= 1e6 ? `${(x / 1e6).toLocaleString(dateLocale(), { maximumFractionDigits: 1 })} MB` : `${Math.round(x).toLocaleString(dateLocale())} ${tr("บ.")}`; return `${Number(x).toLocaleString(dateLocale(), { maximumFractionDigits: 1 })} ${u}`; };
const toLamp = (st, why) => ({ status: st === ST.unknown ? 'none' : st, label: st === ST.unknown ? (why?.startsWith('ยังไม่มี') || why?.startsWith('ยังไม่กรอก') ? tr('ยังไม่มีข้อมูล') : tr('ไม่มีเป้า')) : LAMP_LABEL[st], why: why || '' });

/* แผ่น KPI บนมือถือ: หัว (ชื่อ·ตัวเลขใหญ่·ไฟ) ~90px + กราฟ ~200px + ท้าย — อ่านออก ไม่ต้องเลื่อนในแผ่น */
const MOBILE_SHEET_H = 330;

export default function ObeyaKpiBoard({ tabs, tab, onTab }) {
  const navigate = useNavigate();
  const { role, lineId, sections, fullName, scopeIdx } = useContext(UserContext);
  const { can } = usePerms();
  const canRecord = can('safety', 'record');
  const canNote = can('kpi', 'manage');           // เขียนหมายเหตุรายเดือน = คีย์เดียวกับ RLS ของ kpi_month_notes
  /* 🧩 โหมดจัดเรียงแผ่น (09/10) — ปุ่ม ◀ ▶ บนแผ่น (จอสัมผัส/TV ไม่มีเมาส์ลาก) · บันทึกลง kpi_board_layouts ต่อ (ปี, ขอบเขต)
     `layoutOverride` = ลำดับที่เพิ่งกด ใช้ทันทีไม่รอโหลดกลับ · เขียนล้ม = คืนค่าเดิม + toast (ห้ามให้จอโชว์ลำดับที่ไม่ได้บันทึก) */
  const [arrange, setArrange] = useState(false);
  /* 🔁 25/11 (user: "ทุกกราฟที่มีการคำนวณควรมีปุ่มสลับค่าจริงกับค่าคำนวณ — DL/OH กดดูค่าดิบ dl, sale from product ได้") — ต่อแผ่น (คีย์แถว) · เฉพาะ popup */
  const [rawView, setRawView] = useState({});
  const [layoutOverride, setLayoutOverride] = useState(null);  const [noteFor, setNoteFor] = useState(null);   // { rowKey, title, icon, monthKey, valueText }
  const [sp, setSp] = useSearchParams();

  const [lines, setLines] = useState([]);
  const { index: org, ready: orgReady, failed: orgFailed } = useOrgScope(lines);   // ผังองค์กรทุกมิติ (23/09) — แทน org_nodes kind='section'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  /* 🎞 25/11 (user: "เปลี่ยนไลน์แล้ว animation ดูพังๆ เด้งไปมา") — แผ่นไหลขึ้นทีละใบ (stagger) เล่นเฉพาะข้อมูลชุดแรกที่บอร์ดโผล่
     เปลี่ยนขอบเขต/ปี = แผ่นส่วนใหญ่ remount (คีย์ = def id ของขอบเขตใหม่) + ลำดับแผ่นต่างกันได้ ⇒ ให้ทั้งกริด cross-fade ครั้งเดียว
     (`<TabBody tab={data.viewKey}>`) แผ่นข้างในโผล่ทันที (`enter={false}`) · เลขวิ่ง/แท่งยืดยังเล่นตามกฎ chartAnim เหมือนเดิม */
  const firstViewRef = useRef(null);
  if (data?.viewKey && firstViewRef.current == null) firstViewRef.current = data.viewKey;   // ชุดแรกที่โผล่ = ชุดเดียวที่ได้ stagger
  const [err, setErr] = useState(null);
  const [showSafety, setShowSafety] = useState(null);   // null | {} | event
  const [board, setBoard] = useState(() => urlBool('board', false)); // โหมดจอ TV = ซ่อนหัวเพจ เต็มจอ · ?board=1 จากจอวนหน้า
  /* 👁 แผ่น Machine Break Down ดูได้ 2 หน่วย (user 13/10 "ไม่ต้องแก้ แต่เพิ่มให้ดูได้ทั้ง 2 หน่วย") — KPI ทางการยังเป็น % ·
     มุมมอง "ชม." = ชั่วโมงเครื่องหยุด แปลงจาก % ด้วยฐานเดียวกับสูตร (730 × จำนวนเครื่อง ÷ 100) **ไม่แตะข้อมูล/เป้า** · สถานะไฟตัดสินจาก % เหมือนเดิม */
  const [hrRows, setHrRows] = useState(() => new Set());
  /* ?hr=1 (จอวนหน้า) = ทุกแผ่นที่สลับได้เริ่มที่ "ชม." · hrRows จึงเป็น "แผ่นที่กดสลับจากค่าเริ่มต้น" · ไม่มีในลิงก์ = เดิมเป๊ะ (เริ่ม %) */
  const [hrDefault] = useState(() => urlBool('hr', false));
  const toggleHr = (key) => setHrRows((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const wrapRef = useRef(null);
  const reqRef = useRef(0);                             // กันผลโหลดเก่าทับผลใหม่

  /* วัน + ขอบเขต อยู่ใน URL → จอ TV bookmark ได้ (?scope=department:HYDROFORM&date=…)
     ยังรับ `?section=PD3&group=HYDROFORM` เก่า (ลิงก์จากหน้าอื่น/บุ๊กมาร์กเดิม) — แปลงเป็น scope ให้ */
  const today = workDateNow();
  const date = sp.get('date') || today;
  /* 🎯 โฟกัสช่วงค่า (30/09 · คำขอ user) — ยกพื้นแกน Y ขึ้นใกล้ค่าต่ำสุด ให้เห็น gap T/C · default ปิด · ติด URL ไปกับลิงก์/จอ TV */
  const yFocus = sp.get('yfocus') === '1';
  const scopeParam = sp.get('scope') || '';
  const scope = useMemo(() => {
    if (scopeParam) return parseScopeKey(scopeParam);
    if (sp.get('group')) return { kind: 'line_group', value: sp.get('group') };
    if (sp.get('section')) return { kind: 'section', value: sp.get('section') };
    return null;   // ยังไม่เลือก — effect ด้านล่างเลือก default ให้ (ส่วนงานของ user)
  }, [scopeParam, sp]);
  const scopeKeyStr = scope ? scopeKey(scope.kind, scope.value) : '';
  const year = yearOf(date);
  const monthKey = date.slice(0, 7);
  /* ⚡ ทีมช่างของขอบเขตนี้ (แผนก/ส่วนงาน · หรือเจ้าของรหัส CC) → KPI ช่าง MO Closed/MBD/MTBF/MTTR ระบบคำนวณให้
     (06/10 · user ส่งจอ CC JIG MTN "ยังไม่มีข้อมูล" ทั้งที่ระบบคำนวณได้) · 09/10 user: "ถ้ามีออโต้ก็ให้โชว์ออโต้เลย ไม่มีก็เอาค่ากรอกมือ"
     ⇒ กติกาเดียวกับแถว auto ทุกแถว (`fillAutoWithManual`) · ไม่เขียนลงฐาน · ทีมเทียบชื่อแบบเดียวกับ KpiMonthly */
  const [pmTeams, setPmTeams] = useState(() => pmTeamsSync());
  useEffect(() => { let alive = true; loadPmTeams().then(t => { if (alive && t) setPmTeams(t); }); return () => { alive = false; }; }, []);
  const mtnTeam = useMemo(() => {
    if (!scope || isPlant(scope)) return null;
    const normTeam = (v) => String(v || '').toLowerCase().replace(/[\s\-_]+/g, '');
    const units = (org.unitsOf ? org.unitsOf(scope.kind, scope.value) : [scope]).filter(u => ['department', 'section'].includes(u.kind));
    for (const u of units) {
      const t = (pmTeams || []).find(x => normTeam(x.dept_name) === normTeam(u.value) || normTeam(x.label) === normTeam(u.value));
      if (t) return t;
    }
    return null;
  }, [scope, org, pmTeams]);
  const mtnTeamKey = mtnTeam?.key || '';
  /* 💰 ขอบเขตที่ใช้ "เขียน" (โน้ตรายเดือน · ลำดับแผ่น) = หน่วยเจ้าของรหัส (15/10) — ป้ายบนจอยังเป็นรหัสที่เลือก */
  const kscope = useMemo(() => canonicalScope(org, scope || PLANT), [org, scope]);
  const monthNo = Number(date.slice(5, 7));
  const setParam = useCallback((k, v) => {
    setSp(prev => {
      const n = new URLSearchParams(prev);
      if (v) n.set(k, v); else n.delete(k);
      return n;
    }, { replace: true });
  }, [setSp]);

  useEffect(() => {
    loadLinesRes()
      .then(({ data: d }) => setLines(d || []));
  }, []);

  /* scope มาตรฐาน — helper กลางคืน null = ไม่จำกัด (ห้ามคืน [] ไม่งั้น .in() ว่าง = ไม่เห็นอะไรเลย) */
  const scopeSet = useMemo(() => {
    const names = scopedLineNames({ role, lineId, sections, lines, scopeIdx });
    return names ? new Set(names) : null;
  }, [role, lineId, sections, lines, scopeIdx]);   // 🔴 scopeIdx มาแบบ async — ไม่อยู่ใน deps = ขอบเขตค้างค่าเดิม (QC audit 09/11)

  /* ตัวเลือกขอบเขตในสังกัดของ user (ตัดด้วย scope ไลน์ + ส่วนงานสังกัด) */
  const scopeOpts = useMemo(() => filterScopeOptions(org, { scopeSet, sections }), [org, scopeSet, sections]);
  const setScope = useCallback((sc) => {
    setSp(prev => {
      const n = new URLSearchParams(prev);
      n.set('scope', isPlant(sc) ? 'plant' : scopeKey(sc.kind, sc.value));
      n.delete('section'); n.delete('group');   // param เก่าอย่าค้างคู่กับ scope — URL ห้ามโกหก
      return n;
    }, { replace: true });
  }, [setSp]);
  /* default = ส่วนงานของ user (ตัวแรกที่มีในตัวเลือก) → ส่วนงานแรกในผัง → ทั้งโรงงาน
     ⚠️ รอผังโหลดก่อน (orgReady) ไม่งั้นค่าจาก URL เช่น department:HYDROFORM ถูกตีว่าไม่รู้จักแล้วล้างทิ้ง */
  useEffect(() => {
    if (!orgReady || !lines.length) return;
    const known = !!scope && (isPlant(scope) || org.has(scope.kind, scope.value));
    /* 🔒 ขอบเขตจาก URL ที่ผังรู้จักแต่ **อยู่นอกสังกัด user** (05/10 · audit) — เดิมผ่านด่าน org.has แล้วค้างอยู่
       ทั้งที่ dropdown ไม่มีให้เลือก ⇒ จอว่าง/ตัวเลขของหน่วยอื่น · ให้ถอยกลับหน่วยของตัวเองแล้วบอกบนจอ ไม่สลับเงียบ */
    const allowed = known && (isPlant(scope) || scopeOpts.some(o => o.key === scopeKeyStr));
    if (allowed) return;
    const mine = (sections || []).map(x => scopeOpts.find(o => o.kind === 'section' && o.value === x)).find(Boolean);
    const first = scopeOpts.find(o => o.kind === 'section');
    if (known) toast.info(`${tr("ขอบเขต")} "${org.labelOf(scope.kind, scope.value)}" ${tr("อยู่นอกสังกัดของคุณ — สลับไปดูหน่วยของคุณแทน")}`);
    setScope(mine || first || PLANT);
  }, [orgReady, lines.length, scope, scopeKeyStr, org, sections, scopeOpts, setScope]);

  /* ไลน์ในขอบเขตที่เลือก ∩ ขอบเขต user · ขอบเขตที่ไม่มีไลน์ผลิต (แผนกช่าง) = [] → แผ่นอัตโนมัติว่างโดยตั้งใจ */
  const lineNames = useMemo(() => {
    const inUser = lines.filter(l => !scopeSet || scopeSet.has(l.name)).map(l => l.name);
    if (!scope || isPlant(scope)) return inUser;
    const mine = new Set(org.lineNamesOf(scope.kind, scope.value));
    return inUser.filter(n => mine.has(n));
  }, [lines, scopeSet, scope, org]);
  /* 🏭 "มีไลน์ผลิตไหม" นับเฉพาะ unit_kind=production (16/11 · user: "Tooling Maintenance ขึ้น OEE/PPM ที่ไม่เกี่ยว")
     หน่วยสนับสนุน (QA · STORE · Die/JIG/Tooling MTN) อยู่ในทะเบียนไลน์ตั้งแต่ 05/11 (unit_kind='support') ⇒ นับรวมแล้วแผ่นอัตโนมัติจากกะผลิตโผล่ผิดหน่วย */
  const prodNames = useMemo(() => new Set(lines.filter(isProductionUnit).map(l => l.name)), [lines]);
  const scopeNoLines = !!scope && !isPlant(scope) && orgReady && org.lineNamesOf(scope.kind, scope.value).filter(n => prodNames.has(n)).length === 0;
  const members = useMemo(() => {
    const set = new Set(lineNames);
    const m = lines.filter(l => set.has(l.name));
    return {
      names: set,
      groups: [...new Set(m.map(l => l.parent_line_name || l.name))].sort(lineNameCompare),   // กลุ่มไลน์ (เป้า OEE ตั้งรายกลุ่ม)
      prodGroups: [...new Set(m.filter(isProductionUnit).map(l => l.parent_line_name || l.name))].sort(lineNameCompare),   // เฉพาะไลน์ผลิต — ตัดสินว่ามีแผ่น OEE/PPM ไหม
      ccs: [...new Set(m.filter(l => l.cost_center).map(l => l.cost_center))].sort(lineNameCompare),
    };
  }, [lines, lineNames]);
  /* ชิปเจาะลงหนึ่งชั้น (ลูกของขอบเขตที่เลือก · ไม่เกิน 6 ไม่งั้นหัวจอยาว — เกินนั้นใช้ picker) + ชิป ↑ กลับขึ้น */
  const childChips = useMemo(() => {
    if (!scope) return [];
    const kids = org.childrenOf(scope.kind, scope.value).filter(o => o.kind !== 'cost_center' && scopeOpts.some(x => x.key === o.key));
    return kids.length <= 6 ? kids : [];
  }, [scope, org, scopeOpts]);
  const parentScope = useMemo(() => (scope && !isPlant(scope) ? org.ancestorsOf(scope.kind, scope.value).slice(-1)[0] || PLANT : null), [scope, org]);
  const secSet = useMemo(() => (scope ? org.sectionsOf(scope.kind, scope.value) : null), [scope, org]);   // null = ไม่จำกัด
  const scopeText = useMemo(() => scopePathText(org, scope, tr("ทั้งโรงงาน")), [scope, org]);   // CC = เส้นทางเจ้าของ › 💰 รหัส (utils/orgScope)

  /* ── โหลด — ทุกก้อนเช็ค error → warn[] เพื่อขึ้นแถบ "โหลดไม่ครบ" ห้ามเงียบ ─────────────────────
     deps เป็น primitive ล้วน (กฎเหล็ก DB ข้อ 9) · lineNames ส่งเป็นสตริงคั่นด้วย | */
  const lineKey = lineNames.join('|');
  const secKey = secSet ? [...secSet].join('|') : '*';
  const load = useCallback(async () => {
    if (!scopeKeyStr) return;                             // ยังไม่เลือกขอบเขต (effect กำลังตั้ง default)
    const names = lineKey ? lineKey.split('|') : [];      // [] = ขอบเขตไม่มีไลน์ผลิต → ข้าม rollup แต่ยังโหลด KPI กรอกมือ/งานค้าง
    const secOk = (v) => secKey === '*' || (secKey ? secKey.split('|').includes(v || '') : false);
    const seq = ++reqRef.current;
    setLoading(true); setErr(null);
    const warn = [];
    try {
      // 1) ผลรวมรายเดือนทั้งปีของทุกไลน์ (กรอง scope/กลุ่มฝั่ง client — สลับกลุ่มไม่ยิง DB ใหม่)
      const yr = names.length ? await supabaseDR.rpc('obeya_year_rollup', { p_from: `${year}-01-01`, p_to: date }) : { data: {} };
      if (yr.error) warn.push(tr("ผลรวมรายเดือน (OEE/PPM)"));
      const roll = yr.data || {};
      // 2) กะที่ยังเปิดค้างของวันที่ดู — ตัวเลขวันนี้ยังไม่ครบ ต้องบอก
      /* `.in()` ยาวทะลุเพดาน URL = คืนว่างเงียบ (กฎเหล็ก DB ข้อ 5) → ซอยก้อนผ่าน fetchByIds แทน `slice(0, 200)` เดิม
         ที่ตัดไลน์ที่ 201+ ทิ้งเงียบๆ (05/10 · audit) */
      const op = names.length ? await fetchByIds(names, part => supabaseDR.from('production_sessions').select('id')
        /* 🔴 ระบุสถานะรายตัว ห้าม `.neq('status','closed')` — ใบโมฆะจะถูกนับเป็น "กะเปิดค้าง" (08/10 · มีด่าน) */
        .eq('work_date', date).in('status', SESSION_STATUSES_LIVE).in('line_name', part)) : { rows: [] };
      if (op.error || op.truncated) warn.push(tr("กะที่เปิดค้าง"));
      // 3) เป้า OEE (A×P×Q รายกรุ๊ป)
      const tg = await supabase.from('oee_targets').select('group_name, target_a, target_p, target_q');
      if (tg.error) warn.push(tr("เป้า OEE"));
      // 4) ความปลอดภัย — ทั้งหมดของส่วนงาน ≤ วันที่ดู (ใช้ทั้งนับต่อเดือน + งานค้าง)
      const sf = await supabase.from('safety_events')
        .select('*').eq('is_active', true).gte('event_date', `${year}-01-01`).lte('event_date', date)
        .order('event_date', { ascending: false }).limit(500);
      const safetyMissing = (sf.error?.code || '') === '42P01';
      if (sf.error && !safetyMissing) warn.push(tr("เหตุการณ์ความปลอดภัย"));
      const safety = (sf.data || []).filter(e => secOk(e.section));
      // 5) งานที่ต้องตามแก้จากประชุมเช้า/ห้อง Obeya — "บอร์ดที่มีแต่กราฟ ไม่มี action = ไม่ใช่ Obeya"
      const acts = await supabase.from('meeting_action_items')
        .select('id, meeting_date, section, line_name, problem, assignee, due_date, status, source')
        .in('status', ['open', 'doing']).order('due_date', { ascending: true, nullsFirst: false }).limit(60);
      const actsMissing = (acts.error?.code || '') === '42P01';
      if (acts.error && !actsMissing) warn.push(tr("งานติดตาม"));
      const actions = (acts.data || []).filter(a => secOk(a.section));
      // 6) นิยาม KPI ของปี + ค่ารายเดือน (กรอกมือ / เป้าของแถว auto)
      let kdRes = await supabase.from('kpi_definitions')
        .select('*, kpi_catalog(id, name, unit, direction, decimals, summary_mode, value_scope, board_slot, amount_var, value_min, value_max, rollup_mode)').eq('year', year).eq('is_active', true);
      if (kdRes.error && (kdRes.error.code || '') !== '42P01') {
        kdRes = await supabase.from('kpi_definitions').select('*').eq('year', year).eq('is_active', true);
      }
      const kpiMissing = (kdRes.error?.code || '') === '42P01';
      if (kdRes.error && !kpiMissing) warn.push(tr("นิยาม KPI"));
      // นิยามของ "ขอบเขตที่เลือก + บรรพบุรุษ" — นิยามระดับแม่ตกทอดถึงลูก (ตกลงรุ่นเดียวกับแท็บ ⚙️)
      const sel = parseScopeKey(scopeKeyStr);
      const kSel = canonicalScope(org, sel);   // 💰 15/10: โน้ต/ลำดับแผ่นของรหัส CC = ของหน่วยเจ้าของรหัส (คีย์เดียว ไม่แยก 2 ชุด)
      /* นิยามที่ยังค้างอยู่ที่รหัส CC (แถวเก่าก่อน trigger / รหัสที่เพิ่งถูกผูกหน่วยในผัง) = นิยามของหน่วยเจ้าของ — ทำให้ตรงก่อนทุกตัวกรองของบอร์ด */
      const canonDef = (d) => { const sc = scopeOfDef(d); const c = canonicalScope(org, sc); return c === sc ? d : { ...d, scope_kind: c.kind, scope_value: c.value }; };
      const kdAll = (kdRes.data || []).map(canonDef);
      const kdefs = kdAll.filter(d => scopeCovers(org, scopeOfDef(d), sel));
      /* ⬆ นิยามของ "หน่วยลูก" (12/10 · user: ลูกมี แม่ไม่มี ต้องโชว์ที่แม่ด้วย) — เก็บแยกจาก kdefs เพื่อไม่ให้ไปปนกับการตกทอดขาลง */
      const kdefsBelow = kdAll.filter(d => scopeUnder(org, scopeOfDef(d), sel));
      let kentries = [], kplans = [];
      if (kdefs.length || kdefsBelow.length) {
        const ke = await fetchByIds([...kdefs, ...kdefsBelow].map(d => d.id), part => supabase
          .from('kpi_manual_entries').select('kpi_id, month, value').in('kpi_id', part));
        if (ke.error) warn.push(tr("ค่า KPI รายเดือน"));
        kentries = ke.rows;
        /* 📅 แผนรายเดือน — ใช้คาดการณ์ปลายปี (ผลจริง + แผนที่เหลือ) · ตารางยังไม่มี = ไม่มีแผน ไม่ใช่บอร์ดล่ม */
        const kp = await fetchByIds(kdefs.map(d => d.id), part => supabase
          .from('kpi_month_plans').select('kpi_id, month, plan_value').in('kpi_id', part));
        if (kp.error && !/42P01/.test(String(kp.error))) warn.push(tr("แผนรายเดือน"));
        kplans = kp.rows || [];
      }
      /* 💰 ตัวเลขฐาน (ยอดขายกลางของโรงงาน + ยอดเงินของหน่วย) — นิยาม provider='formula' คำนวณค่ารายเดือนจากตรงนี้ (15/10) · ตารางยังไม่มี = ไม่มีสูตร */
      /* cap-ok: kpi_base_inputs ต่อปี สูงสุด 63 แถว (วัด 20/10) */
      const kb = await supabase.from('kpi_base_inputs').select('id, month, scope_kind, scope_value, var_key, value').eq('year', year).limit(5000);
      if (kb.error && (kb.error.code || '') !== '42P01') warn.push(tr("ตัวเลขฐาน KPI"));
      const kbase = kb.data || [];
      /* 🤝 คะแนนรายลูกค้า (Customer Satisfaction ไฟล์ V5 · 24/11) — ให้ popup 🔍 เจาะรายลูกค้า × Q/D · ตารางยังไม่มี = ไม่มีรายละเอียด ไม่ใช่บอร์ดล่ม */
      /* cap-ok: kpi_csat_scores ต่อปี = ลูกค้า (4–6) × 2 ชนิด × 12 เดือน ≤ 150 แถว */
      const kc = await supabase.from('kpi_csat_scores').select('month, customer, kind, result, score, evaluated, remark, grade_a').eq('year', year).limit(5000);
      if (kc.error && (kc.error.code || '') !== '42P01') warn.push(tr("คะแนนลูกค้ารายราย (Customer Satisfaction)"));
      const kcsat = kc.data || [];
      /* 👥 ทะเบียนพนักงาน active — ตัวหาร manpower ของ "ยอดขาย/หัว" เมื่อไม่มีใครกรอก (ค่ากรอกมือชนะ) */
      /* cap-ok: employees ทั้งโรงงาน 351 คน (วัด 20/10) */
      const em = await supabase.from('employees').select('id, section, department, is_active, start_date').eq('is_active', true).limit(5000);
      if (em.error) warn.push(tr("ทะเบียนพนักงาน"));
      const kemps = em.data || [];
      /* 📝 หมายเหตุรายเดือนของขอบเขตที่ดู (remark/action/note) — ตารางยังไม่มี = ไม่มีโน้ต ไม่ใช่บอร์ดล่ม */
      const kn = await supabase.from('kpi_month_notes')
        .select('id, month, row_key, kind, text, image_url, created_by_name, created_at')
        .eq('year', year).eq('scope_kind', kSel.kind || 'plant').eq('scope_value', kSel.value || '').eq('is_active', true)
        .order('created_at', { ascending: true }).limit(1000);
      if (kn.error && (kn.error.code || '') !== '42P01') warn.push(tr("หมายเหตุรายเดือน"));
      const knotes = kn.data || [];
      /* 🧩 ลำดับแผ่นที่หน่วยนี้จัดเอง (09/10 · user PD2 "อยากจัดตำแหน่ง card เอง") — ไม่มีแถว/ตารางยังไม่มี = ลำดับ template */
      const kl = await supabase.from('kpi_board_layouts').select('row_keys')
        .eq('year', year).eq('scope_kind', kSel.kind || 'plant').eq('scope_value', kSel.value || '').maybeSingle();
      if (kl.error && (kl.error.code || '') !== '42P01') warn.push(tr("ลำดับแผ่น"));
      const layoutKeys = Array.isArray(kl.data?.row_keys) ? kl.data.row_keys : [];
      /* ⚡ KPI ช่าง — RPC คืน Σ รายเดือน (mo/dt/machines) แล้ว utils/kpiAuto คำนวณ (RPC ห้ามคำนวณ KPI) · ไม่มีทีมช่าง = ไม่ยิง */
      let mtnRoll = null;
      if (mtnTeamKey) {
        const mr = await supabaseDR.rpc('kpi_mtn_rollup', { p_from: `${year}-01-01`, p_to: `${year}-12-31` });
        if (mr.error) warn.push(tr("KPI ช่างอัตโนมัติ")); else mtnRoll = mr.data || {};
      }
      if (seq !== reqRef.current) return;                 // มีคำขอใหม่แล้ว — ทิ้งผลเก่า
      setData({
        sessions: roll.sessions || [], defects: roll.defects || [],
        openSess: (op.rows || []).length, targets: tg.data || [],
        safety, safetyMissing, actions, actsMissing, kdefs, kdefsBelow, kentries, kplans, knotes, kbase, kcsat, kemps, kpiMissing, warn, mtnRoll, layoutKeys,
        viewKey: `${scopeKeyStr}|${year}`,   // 25/11: ขอบเขต+ปีของ "ข้อมูลชุดนี้" — คีย์ cross-fade ของกริด (ไม่ใช่ URL ที่เปลี่ยนก่อนข้อมูลมา)
      });
    } catch (e) {
      if (seq === reqRef.current) { setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); setData(null); }
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [lineKey, scopeKeyStr, secKey, year, date, org, mtnTeamKey]);
  /* โหลดครั้งแรก + poll + realtime ผ่านตัวกลางตัวเดียว (กฎเหล็ก DB ข้อ 8 · เดิมประกอบ useEffect+usePolling เอง ไม่มี idle gate)
     ฟังแค่ production_sessions (เปิด/ปิดกะ = ตัวเลขเดือนเปลี่ยน) — prod_orders/downtime_logs ห้าม subscribe ในหน้านี้ */
  /* 🔴 `LIVE.YEAR` — แถว KPI ทุกแถวมี series 12 เดือน (อ่านผ่าน obeya_year_rollup เหมือนโหมดปี)
     ไม่ต้องสดระดับนาที · poll RATE.BOARD (15 นาที) ยังเดินตามปกติ (22/10 · ดู refreshRates) */
  useLiveBoard(load, { tables: ['production_sessions'], topic: 'obeya-kpi', tier: LIVE.YEAR, rate: RATE.BOARD });

  /* ── แถว KPI 8 หัวข้อของกลุ่มที่เลือก — ทุกแถวมี series 12 เดือน + แท่งสรุป ──────────────────── */
  const rows = useMemo(() => {
    if (!data || !scope) return [];
    const { sessions, defects, targets, safety, kdefs, kdefsBelow, kentries, kplans, knotes, kbase, kcsat, kemps, mtnRoll } = data;
    const autoSeries = mtnTeam && mtnRoll ? mtnAutoSeries(mtnRoll, year, mtnTeam) : null;
    const planByKpi = {};
    (kplans || []).forEach(e => (planByKpi[e.kpi_id] = planByKpi[e.kpi_id] || {})[e.month] = e.plan_value);
    const notesBy = {};
    (knotes || []).forEach(n => ((notesBy[n.row_key] = notesBy[n.row_key] || {})[n.month] = notesBy[n.row_key][n.month] || []).push(n));
    const ym = x => String(x ?? '').slice(0, 7);
    const inG = r => members.names.has(r.line);
    const gSess = sessions.filter(inG);
    const gDefs = defects.filter(inG);

    const entByKpi = {};
    (kentries || []).forEach(e => (entByKpi[e.kpi_id] = entByKpi[e.kpi_id] || {})[e.month] = e.value);
    /* 🧮 นิยามสูตร: ค่ารายเดือน = ยอดเงินของหน่วย ÷ ยอดขายกลาง (utils/kpiFormula.js) — ทับค่ากรอกมือ · คำนวณไม่ได้ = ใช้ค่ากรอกมือ + ป้าย ✍️ */
    const baseIdxB = buildBaseIndex(kbase || [], { auto: headcountAutoVar(headcountAuto(kemps || [], { year, today })) });
    const fxB = applyFormulaEntries([...(kdefs || []), ...(kdefsBelow || [])], entByKpi, baseIdxB, org);
    Object.assign(entByKpi, fxB.entries);
    const fInfoB = fxB.info;
    const skLabelB = (sk) => { const i = String(sk).indexOf(':'); return i < 0 ? tr("ทั้งโรงงาน") : org.labelOf(sk.slice(0, i), sk.slice(i + 1)); };
    /* เป้า/นิยาม = ของขอบเขตที่เลือกก่อน ไม่มีค่อยไต่ขึ้นบรรพบุรุษทีละชั้น (แผนก → ส่วนงาน → ฝ่าย → โรงงาน)
       แหล่งเดียวกับแท็บ ⚙️ ห้ามตั้งคนละที่ · `inherited` = เอามาจากระดับแม่ (จอต้องบอก) */
    const chain = org.chainOf(scope.kind, scope.value);   // CC → เจ้าของรหัส → แม่ … → โรงงาน (06/10)
    const nearest = (pred, needEntries = false) => {
      let firstHit = null;
      for (const sc of chain) {
        const d = (kdefs || []).find(x => sameScope(scopeOfDef(x), sc) && pred(x));
        if (!d) continue;
        const hit = { def: d, entries: entByKpi[d.id] || {}, unit: unitOf(d), inherited: !sameScope(sc, scope), at: sc };
        if (!needEntries || Object.keys(hit.entries).length) return hit;
        firstHit = firstHit || hit;
      }
      return firstHit;
    };
    const autoDefOf = (k) => nearest(d => d.source === `auto:${k}`)?.def || null;
    const manualOf = (rowName, needEntries = false, rowKey = null, defId = null) => {
      const nn = normName(rowName);
      /* 🎯 ทะเบียนที่ตั้ง "ช่องบนบอร์ด" (board_slot) ชนะ · ไม่ตั้ง = เทียบชื่อแบบเดิม · ตั้งเป็นช่องอื่นแล้ว = ไม่จับด้วยชื่อ (กันโผล่ 2 ที่)
         · แผ่นพิเศษของหน่วย (`def:<id>`) จับด้วย id ตรงๆ */
      const pred = defId ? (x => x.id === defId) : (x => !String(x.source || '').startsWith('auto:')
        && (boardSlotOf(x) ? boardSlotOf(x) === rowKey : normName(x.kpi_catalog?.name || x.name) === nn));
      /* 🏭 KPI ที่ค่าเป็นของโรงงาน (30/09): เป้า/นิยามเอาของหน่วยที่ใกล้สุดตามเดิม แต่ **ค่ารายเดือนอ่านจากนิยามโรงงานตัวเดียว**
         ไม่มีนิยามโรงงาน = ไม่มีค่า (ห้ามถอยไปใช้ค่าที่หน่วยเคยกรอกเอง — จะกลายเป็นแต่ละหน่วยตัวเลขไม่ตรงกันอีก) */
      const first = nearest(pred, false);
      if (first && valueScopeOf(first.def) === 'plant') {
        const pd = sharedValueDef(kdefs, first.def);
        return { ...first, entries: pd ? entByKpi[pd.id] || {} : {}, shared: pd ? 'ok' : 'missing', sharedDef: pd };
      }
      return nearest(pred, needEntries);
    };
    /* เป้า OEE = A×P×Q รายกลุ่ม (oee_targets) — ขอบเขตครอบหลายกลุ่ม = เฉลี่ยของกลุ่ม (กติกาเดียวกับ /oee-analytics ระดับ section) */
    const tg = Object.fromEntries((targets || []).map(t => [t.group_name, t]));
    const apq = (t) => ((Number(t?.target_a) || DEFAULT_APQ.a) * (Number(t?.target_p) || DEFAULT_APQ.p) * (Number(t?.target_q) || DEFAULT_APQ.q)) / 10000;
    const grpTargets = members.groups.map(g => tg[g] || null);
    const setGroups = grpTargets.filter(Boolean).length;
    const oeeTarget = Math.round((grpTargets.length ? grpTargets.reduce((a, t) => a + apq(t), 0) / grpTargets.length : apq(null)) * 10) / 10;
    const inEv = (e) => (members.names.size ? (e.line_name && members.names.has(e.line_name)) : true);

    /* 🧾 แผ่นบนบอร์ด = KPI ที่หน่วยนี้ "ถือ" จริง (05/10 · user: "MTN ไม่ได้มี OEE/PPM แต่มาโชว์ · หัวข้อไม่วิ่งตามแผนกที่เลือก")
       · 8 ช่องมาตรฐาน (บอร์ดกระดาษฝ่ายผลิต) โชว์ต่อเมื่อ (ก) ขอบเขตนี้มีนิยามของช่องนั้น — ของตัวเองหรือตกทอดจาก **หน่วยแม่**
         (นิยามระดับทั้งโรงงานไม่นับว่า "ถือ" — เป็นแค่ที่เก็บค่าร่วม value_scope='plant' · ยกเว้นดูทั้งโรงงานเอง)
         หรือ (ข) แถว auto (OEE/PPM/Safety) และขอบเขตมีไลน์ผลิตจริง (ตัวเลขเกิดเองจากกะ) ⇒ MTN/QA ที่ไม่มีไลน์ไม่เห็น OEE/PPM อีก
       · ขอบเขตที่ยังไม่ตั้ง KPI เลย = โชว์ template เต็มพร้อม "ยังไม่ได้ตั้ง" (บอร์ดว่างเปล่าไม่บอกอะไรใคร)
       · KPI ที่ตั้งไว้ที่ขอบเขตนี้ตรงๆ แต่ไม่เข้าช่องไหน (MTBF/MTTR/Cost Reduction …) = แผ่นเต็มต่อท้าย `def:<id>`
         (เดิมยัดรวมเป็นลิสต์ในแผง "Key Performance" ใบเดียว — อ่านจากไกลไม่ได้ ไม่มีกราฟ ไม่มีหมายเหตุรายเดือน) */
    /* ⬆ KPI ของหน่วยลูกที่แม่ไม่ถือ = รวมขึ้นแม่ (utils/kpiRollup.js · 12/10) — จัดกลุ่มตามทะเบียน/ชื่อ · ค่ารวมคิดตอนวาดแถว */
    const childGroups = groupChildDefs(kdefsBelow || []);
    const rollupOf = (gk) => (gk && childGroups.has(gk) ? rollupChildDefs(childGroups.get(gk), entByKpi, { labelOf: org.labelOf, formulaInfoOf: (d) => fInfoB[d.id] || null }) : null);   // 25/11 รางสูตร = Σ ตัวตั้งของลูก ÷ ค่ากลาง
    /* กติกาเลือกแผ่นอยู่ใน utils/kpiBoardRows.js (pure · มีเทส) — ที่นี่แค่ส่ง closure หา-นิยาม 2 ตัว */
    const { rows: boardRows } = pickBoardRows({
      templates: boardRowsFor(year), kdefs, scope, hasLines: members.prodGroups.length > 0, childGroups,
      findManual: (r) => manualOf(r.name, false, r.key), findAuto: autoDefOf,
      ownScopes: [scope, ...(org.unitsOf ? org.unitsOf(scope.kind, scope.value) : [])],   // CC = หน่วยเจ้าของรหัส (06/10)
      order: layoutOverride || data.layoutKeys,   // ลำดับที่คนจัด (ค่าที่เพิ่งกดยังไม่โหลดกลับ ชนะค่าที่โหลดมา)
    });
    return boardRows.map((r) => {
      const man = r.rollup ? null : manualOf(r.name, false, r.key, r.defId || null);
      const roll = r.rollup ? rollupOf(r.rollup) : null;   // แผ่นที่ค่ามาจากหน่วยลูกล้วน (แม่/บรรพบุรุษไม่มีนิยาม)
      let series = [], def = null, unit = r.unit || man?.unit || '', note = '', fromDept = !!man?.inherited, manual = !r.auto;
      let months = 0, sumKind = 'average', sumApprox = false;
      let hrPerPct = null;   // แผ่น MBD: 1% = กี่ชั่วโมงหยุด (730 × เครื่อง ÷ 100) — เปิดปุ่มสลับ %/ชม.

      /* ⚡ ค่าที่ระบบคำนวณ = ค่าหลักของ **ทุกแถว auto** (user 09/10: "auto ชนะ manual · เดือนไหนไม่มี auto มี manual ก็โชว์ manual")
         ✍️ ค่าที่หน่วยกรอกมือลงนิยามของตัวเองใช้เติมเฉพาะเดือนที่ระบบไม่มีค่า (PD2 คีย์ OEE ม.ค.–ส.ค. = ช่วงก่อนเริ่มใช้ Daily Report
         ⇒ ไม่มีกะให้คำนวณ แล้วบอร์ดไม่ขึ้นเลย) · เดือนที่มีทั้งคู่ = ค่าระบบ **จอต้องเขียนว่าทับกี่เดือน ห้ามเงียบ** · กติกา = `fillAutoWithManual()` (utils/obeyaYear.js) */
      const overlayManual = (k) => fillAutoWithManual({ autoMonths: autoMonthsOf(k.series), manEntries: man?.entries, year });
      const mixNote = (ov, autoLabel = 'ระบบคำนวณจากกะ') => (ov.fillN || ov.overlapN)
        ? `⚡ ${autoLabel} ${ov.autoN} ${tr("เดือน")}${ov.fillN ? ` · ✍️ ${tr("เติมค่ากรอกมือ")} ${ov.fillN} ${tr("เดือนที่ระบบไม่มีค่า")}` : ''}${ov.overlapN ? ` · ✍️ ${tr("แท่งจางซ้อน = ค่ากรอกมือ")} ${ov.overlapN} ${tr("เดือน (ทีมคิดเอง) เทียบค่าระบบ")}` : ''}`
        : '';
      let childMix = null;   // ⬆ เดือนที่เติมจากลูก { filled, covered, n, approx } (แม่มี KPI เอง)
      let mix = null;   // ที่มาตัวเลขแบบย่อ { autoN, fillN, overlapN } — ขึ้นบรรทัดรองของแผ่น (ไม่ใช่กล่องเตือน · user 09/10 "remark เยอะไป")
      const applyOverlay = (k, ov) => {
        mix = ov;
        if (ov.series) { series = ov.series; months = ov.months; sumApprox = true; }   // ปนค่าถ่วงเวลากับค่ากรอกมือ ⇒ สรุปปี = เฉลี่ยเดือน ติด ≈
        else { series = k.series; months = k.months; }
        series = attachManOverlay(series, ov.manOverlap);   // ✍️ เดือนที่ถูกทับ: ค่ากรอกมือติดไปวาดซ้อนเทียบ (ไม่หายเงียบ)
      };
      if (r.auto === 'oee') {
        const k0 = axisOeeYear({ rows: gSess, year, target: { oee: oeeTarget } });
        const ov = overlayManual(k0);
        applyOverlay(k0, ov);
        def = { target_value: oeeTarget, direction: 'up' };
        const mix0 = mixNote(ov);
        note = mix0 ? `${mix0} · ${tr("เป้า A×P×Q จากทะเบียนเป้า")} OEE`
          : !members.groups.length ? 'ขอบเขตนี้ไม่มีไลน์ผลิต — ไม่มี OEE ให้คำนวณ'
          : setGroups === members.groups.length && members.groups.length === 1
            ? `${tr("เป้าจากทะเบียนเป้า")} OEE (A${tg[members.groups[0]].target_a ?? DEFAULT_APQ.a}×P${tg[members.groups[0]].target_p ?? DEFAULT_APQ.p}×Q${tg[members.groups[0]].target_q ?? DEFAULT_APQ.q})`
            : setGroups ? `${tr("เป้าเฉลี่ย")} ${members.groups.length} ${tr("กลุ่มไลน์ (ตั้งแล้ว")} ${setGroups} ${tr("กลุ่ม · ที่เหลือใช้")} 90×90×99)`
              : `${tr("ยังไม่ตั้งเป้า OEE ของกลุ่มในขอบเขตนี้ — ใช้ค่ามาตรฐาน")} 90×90×99`;
      } else if (r.auto === 'ppm') {
        const ad = autoDefOf('ppm');
        def = ad ? { ...ad } : null;
        const k = axisPpmYear({ sessions: gSess, defects: gDefs, year, target: def?.target_value ?? null, direction: def?.direction || 'down' });
        const ov = overlayManual(k);
        applyOverlay(k, ov);
        if (!def && man?.def && (ov.fillN || ov.overlapN)) def = man.def;   // ไม่มีนิยาม auto:ppm ⇒ เป้า/ทิศจากนิยามกรอกมือของหน่วย
        const mixP = mixNote(ov);
        note = mixP ? mixP
          : k.months ? `${tr("ของเสีย")} ${nf(k.ngQty)} ${tr("ชิ้น (ไม่รวมงานทดลอง) · บันทึก")} ${nf(k.defectRows)} ${tr("รายการ")}` : '';
      } else if (r.auto === 'safety') {
        /* Safety: ⚡ บันทึกเหตุการณ์หน้างาน (นับบาดเจ็บรายเดือน) = ค่าหลัก · ✍️ สรุปจากหน่วยงานความปลอดภัย (กรอกมือ · กลุ่ม→ส่วนงาน)
           เติมเฉพาะเดือนที่หน้างานไม่มีบันทึก (09/10 user: ทุกแถว auto กติกาเดียว "auto ชนะ" — เดิม 07/09 สรุปหน่วยงานชนะทั้งปี)
           · ห้ามบวก 2 แหล่งในเดือนเดียว · 🔴 "ไม่มีบันทึก" ≠ 0 ที่เกิดจริง ⇒ auto "มีค่า" = มีบันทึก ≥ 1 ครั้งในเดือนนั้น ·
           เดือนที่ว่างทั้งคู่ = 0 เฉพาะเมื่อปีนี้มีบันทึกหน้างานบ้างแล้ว (พฤติกรรมเดิม) · ไม่มีอะไรเลย = เทา ห้ามเขียว */
        const manSec = manualOf(r.name, true, r.key);
        const cnt = {};
        (safety || []).forEach((e) => { if (inEv(e) && isInjury(e)) cnt[ym(e.event_date)] = (cnt[ym(e.event_date)] || 0) + 1; });
        const hasFloor = (safety || []).length > 0;
        const autoMonths = {};
        monthKeys(year).forEach((k, i) => { if (cnt[k] > 0) autoMonths[i + 1] = cnt[k]; });
        const fx = fillAutoWithManual({ autoMonths, manEntries: manSec?.entries, year, summary: 'sum' });
        mix = fx;
        if (hasFloor || fx.fillN) {
          const upto = monthKeys(year).filter(k => k <= monthKey);
          series = monthKeys(year).map((k, i) => {
            if (autoMonths[i + 1] != null) return { k, v: autoMonths[i + 1] };
            if (fx.series?.[i]?.manualFill) return fx.series[i];
            return hasFloor && upto.includes(k) ? { k, v: 0 } : { k, v: null, empty: true };
          });
          series = attachManOverlay(series, fx.manOverlap);   // ✍️ สรุปหน่วยงานที่ถูกบันทึกหน้างานทับ — วาดซ้อนเทียบ
          const filled = series.filter(p => p.v != null);
          series.push({ k: SUMMARY_KEY, v: filled.length ? filled.reduce((a, p) => a + p.v, 0) : null, summary: true, kind: 'sum' });
          months = filled.length; sumKind = 'sum';
          def = manSec?.def || { target_value: 0, direction: 'down' }; unit = manSec?.unit || r.unit;
          const parts = [`⚡ ${tr("นับบาดเจ็บจากบันทึกหน้างาน")} ${fx.autoN} ${tr("เดือน")}`];
          if (fx.fillN) parts.push(`✍️ ${tr("เติมสรุปจากหน่วยงานความปลอดภัย")} ${fx.fillN} ${tr("เดือนที่หน้างานไม่มีบันทึก")}${manSec?.inherited ? ` (${tr("ค่าระดับ")} ${org.labelOf(manSec.at.kind, manSec.at.value)})` : ''}`);
          if (fx.overlapN) parts.push(`✍️ ${tr("แท่งจางซ้อน = สรุปหน่วยงาน")} ${fx.overlapN} ${tr("เดือน เทียบบันทึกหน้างาน")}`);
          if (!manSec?.def) parts.push(`${tr("เป้า 0 ครั้ง")}${members.names.size ? tr(' · เหตุที่ไม่ระบุไลน์ไม่ถูกนับในขอบเขตนี้') : tr(' · นับตามส่วนงานที่บันทึก')}`);
          note = parts.join(' · ');
        } else {
          series = monthKeys(year).map(k => ({ k, v: null, empty: true })).concat([{ k: SUMMARY_KEY, v: null, summary: true }]);
          note = 'ยังไม่มีใครบันทึกเหตุการณ์ และยังไม่กรอกสรุปจากหน่วยงานความปลอดภัย';
        }
      } else {
        /* 🔴 24/09: วิธีรวมแท่ง "สรุป" มาจาก `kpi_catalog.summary_mode` ของ KPI ตัวนั้น
           เดิมเฉลี่ยตายตัว ⇒ Scrap/Cost Reduction ที่ต้องรวมทั้งปีโชว์ค่าเฉลี่ย */
        /* ⚡ KPI ช่างที่ระบบคำนวณได้ (MO Closed/MBD/MTBF/MTTR): **ค่าระบบชนะ** · ค่ากรอกมือเติมเฉพาะเดือนที่ระบบไม่มีค่า
           (09/10 user — เดิม "ระบบเสนอ คนตัดสิน" ผ่านปุ่ม "ใช้ค่านี้" ถอดแล้ว) · ไม่เขียนลงฐาน · จอต้องบอกว่ามาจากไหนกี่เดือน */
        const manEntries = man?.entries || {};
        const ak = autoSeries && man?.def ? autoKpiOfName(man.def.kpi_catalog?.name || man.def.name) : null;
        const summary = summaryModeOf(man?.def);
        if (roll) {
          /* ⬆ รวมจากหน่วยลูก — ผลรวม (sum) หรือเฉลี่ยไม่ถ่วงน้ำหนัก (≈) · เป้าตามกติกาใน kpiRollup.js · ไม่เขียนลงฐาน */
          const k = manualMonthSeries({ entries: roll.entries, year, summary: summaryModeOf(roll.def) });
          series = k.series; months = k.months; def = roll.def; unit = unitOf(roll.def) || unit;
          sumKind = k.effMode; sumApprox = k.approx || roll.approx; manual = true;
          const names = roll.children.map(c => c.label).join(' · ');
          const partial = roll.partial.length ? ` · ${tr("เดือนที่ลูกกรอกไม่ครบ")}: ${roll.partial.map(m => monthLabel(`${year}-${String(m).padStart(2, '0')}`)).join(' ')}` : '';
          note = `⬆ ${tr("รวมจาก")} ${roll.n} ${tr("หน่วยลูก")} (${roll.combine === 'sum' ? tr('ผลรวม') : roll.combine === 'formula' ? tr('Σ ตัวตั้งของทุกหน่วย ÷ ค่ากลางโรงงาน แล้วคิดสูตรใหม่') : tr('เฉลี่ยไม่ถ่วงน้ำหนัก')}): ${names}${partial}`
            + (roll.targetNote ? ` · ${roll.targetNote} — ${tr("อยากตัดสินด้วยเป้าของระดับนี้ ให้ตั้ง KPI นี้ที่ ⚙️ (แผ่นรวมจะเปลี่ยนเป็นของระดับนี้เอง")})` : '');
        } else if (ak) {
          const autoMonths = {};
          const autoDetail = {};   // 🔢 ตัวตั้ง/ตัวหารของเดือนนั้น (ชม.หยุด · ครั้ง · เครื่อง) — user 13/10 "อยากเห็น hrs. ด้วย" ทั้งที่ KPI เป็น %
          autoSeries.months.forEach((m, i) => {
            const v = toRowUnit(m[ak.key], ak.key, unitOf(man.def) || unit);
            if (v != null) { autoMonths[i + 1] = v; autoDetail[i + 1] = autoDetailText(m, ak.key); }
          });
          const fx = fillAutoWithManual({ autoMonths, manEntries, year, summary });
          mix = fx;
          const k = fx.series
            ? { series: fx.series, months: fx.months, effMode: fx.effMode, approx: fx.approx }
            : manualMonthSeries({ entries: autoMonths, year, summary });
          series = attachManOverlay(k.series.map((p, i) => (i < 12 && !p.manualFill && autoDetail[i + 1] ? { ...p, detail: autoDetail[i + 1] } : p)), fx.manOverlap);
          months = k.months; def = man?.def || null;
          if (ak.key === 'mbd' && autoSeries.machines > 0 && /%/.test(unitOf(man.def) || unit || '%')) hrPerPct = HOURS_PER_MONTH * autoSeries.machines / 100;
          sumKind = k.effMode; sumApprox = k.approx;
          manual = fx.autoN === 0;   // มีค่าระบบสักเดือน = แถวนี้ค่าหลักมาจากระบบ
          note = `${mixNote(fx, 'ระบบคำนวณ')}${fx.autoN && !fx.fillN && !fx.overlapN ? `⚡ ${tr("ระบบคำนวณ")} ${fx.autoN} ${tr("เดือน")}` : ''} (${tr("ทีม")} ${mtnTeam.label} · ${tr("สูตร KPI Guideline 2026 หน้า")} 10)`;
        } else {
          /* ⬆ แม่มี KPI นี้เอง: **แม่ชนะเป็นรายเดือน** — เดือนที่แม่กรอกใช้ค่าแม่ (ไม่บวกลูกซ้ำ) · เดือนที่แม่ไม่ได้กรอกเติมค่ารวมจากลูก
             (user 12/10 "แม่มี 2 ลูกกรอก 2 ไม่ใช่ 4") · เฉพาะนิยามของระดับนี้เอง — นิยามที่ตกทอดจากแม่ (inherited) ไม่เติม (ค่าเป็นของระดับนั้น) */
          const gk = man?.def && !man.inherited ? childGroupKeyFor(childGroups, r, man.def) : null;
          const rollC = gk ? rollupOf(gk) : null;
          const fx = rollC && Object.keys(rollC.entries).length ? fillParentWithChildren(manEntries, rollC) : null;
          if (fx && fx.filled.length) {
            const k = manualMonthSeries({ entries: fx.entries, year, summary });
            series = k.series.map((p, i) => (i < 12 && fx.filled.includes(i + 1) ? { ...p, childFill: true } : p));
            months = k.months; def = man?.def || null;
            sumKind = k.effMode; sumApprox = k.approx || rollC.approx;
            childMix = { filled: fx.filled.length, covered: fx.covered.length, n: rollC.n, approx: rollC.approx };
            const mon = (m) => monthLabel(`${year}-${String(m).padStart(2, '0')}`);
            note = `⬆ ${tr("เดือนที่ระดับนี้ไม่ได้กรอก")} (${fx.filled.map(mon).join(' ')}) ${tr("ใช้ค่า")}${rollC.combine === 'sum' ? tr('รวม') : rollC.combine === 'formula' ? tr('Σ ตัวตั้ง ÷ ค่ากลาง') : tr('เฉลี่ย')}${tr("จาก")} ${rollC.n} ${tr("หน่วยลูก")}: ${rollC.children.map(c => c.label).join(' · ')}`
              + (fx.covered.length ? ` · ${tr("เดือนที่กรอกเองแล้ว")} (${fx.covered.map(mon).join(' ')}) ${tr("ใช้ค่าของระดับนี้ ไม่บวกของลูกซ้ำ")}` : '');
          } else {
            const k = manualMonthSeries({ entries: manEntries, year, summary });
            series = k.series; months = k.months; def = man?.def || null;
            sumKind = k.effMode; sumApprox = k.approx;
          }
        }
      }

      const fiB = man?.def ? fInfoB[(man.sharedDef || man.def).id] : null;
      if (fiB && !r.auto) note = note || formulaNoteText(fiB, monthNo, { labelOf: skLabelB, def: man.def });
      if (man?.shared === 'ok' && !r.auto) note = note || (isPlant(scope) ? 'ค่าโรงงาน — ทุกหน่วยที่ถือ KPI นี้ใช้ตัวเลขเดียวกัน' : 'ค่าโรงงาน (ทุกหน่วยใช้ตัวเลขเดียวกัน) · กรอกที่แท็บ ⚙️ ขอบเขต ทั้งโรงงาน');
      else if (man?.shared === 'missing' && !r.auto) note = note || `KPI ${tr("นี้ใช้ค่าโรงงาน แต่ยังไม่มีนิยามระดับ ทั้งโรงงาน ปี")} ${year} — ${tr("สร้างที่แท็บ ⚙️ ขอบเขต ทั้งโรงงาน แล้วกรอกที่นั่น")}`;
      else if (man?.inherited && !r.auto) note = note || `${tr("ค่าระดับ")} ${org.labelOf(man.at.kind, man.at.value)} (${tr("ยังไม่ตั้งแยกที่ขอบเขตนี้")})`;
      const cur = series.find(p => p.k === monthKey) || null;
      /* 🗓️ เดือนที่เลือกยังไม่มีค่า (KPI กรอกมือกรอกหลังปิดเดือน — วันที่ 30 ก.ย. ทั้งบอร์ดจะ "—" หมดทั้งที่ ม.ค.–ส.ค. ครบ ·
         user ทัก 30/09 "ทีมงานกรอกครบแล้ว") ⇒ ใช้ค่าเดือนล่าสุดที่มี ≤ เดือนที่เลือก แล้ว**เขียนบนจอว่าเป็นเดือนไหน** (`valueKey`/`stale`)
         ไม่ใช่เดาว่าเดือนนี้เท่าเดือนก่อน — ป้าย/เหตุผลต้องบอกว่า "ค่าล่าสุด ส.ค. · ก.ย. ยังไม่กรอก" */
      let value = cur?.v ?? null, valueKey = monthKey, stale = false;
      if (value == null) {
        const prev = series.slice(0, 12).filter(p => p.k <= monthKey && p.v != null).pop();
        if (prev) { value = prev.v; valueKey = prev.k; stale = true; }
      }
      /* 🧮 บรรทัดรองของแผ่นที่ "สูตรคำนวณ" ต้องบอกตัวตั้ง/ตัวหารที่ใช้จริง ไม่ใช่เขียน "กรอกมือ" (09/11 · user: "sales/head เหมือนจะผิด")
         เคสจริง: ยอดขาย/หัว PD1 = 47.951 เพราะกำลังคน PD1 ที่กรอกไว้ 32 คน (ของจริง ~300) — ถ้าแผ่นเขียนแค่ "กรอกมือ" ไม่มีทางเห็นว่าตัวหารผิด */
      let fxSrc = '';
      if (fiB?.computed?.length && !r.auto) {
        const mNo = Number(String(valueKey || monthKey).slice(5, 7)) || monthNo;
        const useM = fiB.computed.includes(mNo) ? mNo : Math.max(...fiB.computed.filter(x => x <= mNo), 0) || fiB.computed[fiB.computed.length - 1];
        const ins = fiB.inputs?.[useM] || {};
        const fmtIn = fmtInVar;
        const vars = fiB.formula?.vars || Object.keys(ins);
        const parts = vars.map(v => `${(baseVarOf(v)?.label || v).split(' (')[0].replace(/^[^\wก-๙]+\s*/, '')} ${fmtIn(v, ins[v])}${fiB.inputSrc?.[useM]?.[v] === 'auto' ? tr(' ≈ทะเบียน') : ''}`);
        fxSrc = `🧮 ${fiB.label} · ${parts.join(' ÷ ')}${useM !== mNo ? ` (${monthLabel(`${year}-${String(useM).padStart(2, '0')}`)})` : ''}`;
      }
      /* 📐 25/11 (user: "คำอธิบายทำเป็น hover · จอไม่รก"): บนแผ่นในกริดเหลือป้ายสั้น "🧮 คำนวณจากตัวเลขฐาน" — ตัวตั้ง/ตัวหารจริง (fxSrc) ไปอยู่ tooltip + popup 🔍 */
      const fxShort = fxSrc ? `🧮 ${tr('คำนวณจากตัวเลขฐาน')}` : '';
      /* 💰 ยอดเงินคู่กัน (16/11 · user: "ให้ขึ้นยอดเงินคู่กัน") — KPI ที่เป็น % ของยอดขาย (100P) ใบบัญชีมียอดเงินคู่กันเสมอ
         ⇒ บรรทัดรองบอกทั้งเดือนที่เลือก + สะสม (MB) จาก kpi_base_inputs ตัวแปรที่ตั้งไว้ใน 📘 ทะเบียน (`amount_var`) · เดือนที่ขาดเขียนบอก ห้ามเดา 0 */
      const amtDef = man?.def || null;
      const amtText = amtDef && !r.auto
        ? amountText(amountCompanion({ def: amtDef, scope: canonicalScope(org, scopeOfDef(amtDef)), base: baseIdxB,
          month: Number(String(valueKey || monthKey).slice(5, 7)) || monthNo }), { monthLabel: (m) => monthLabel(`${year}-${String(m).padStart(2, '0')}`) })
        : '';
      /* 🎯 เป้า/Commitment อ่านผ่าน `defBars()` ตัวเดียว (กฎ kpiSetup "ห้ามให้จอไหนแกะเอง") — เดิมอ่าน `target_value` ตรงๆ
         ⇒ นิยามที่พิมพ์เป้าไว้ในช่องข้อความ ("730" · "≤ 0.5%") แต่ไม่กรอกช่องตัวเลข ขึ้น "ไม่มีเป้า" ทั้งที่ ⚙️ ตัดสิน ○△✗ ได้ (user 09/10) */
      const bars = def ? defBars(def) : null;
      const target = bars?.target_value ?? null;
      const dir = def?.direction || (bars?.target_compare === '<=' ? 'down' : bars?.target_compare === '>=' ? 'up' : r.dir) || null;
      /* 🔴 สถานะ = เกณฑ์ทางการ 1/0.5/0 ผ่าน scoreDef เท่านั้น (17/09) — "เหลือง" = ถึง Commitment แต่ไม่ถึง Target */
      let st = ST.unknown, why = '';
      if (value == null) {
        why = r.auto && !fromDept ? (note || 'ยังไม่มีข้อมูลเดือนนี้') : roll ? 'หน่วยลูกยังไม่กรอกค่าเดือนนี้' : (man || fromDept ? 'ยังไม่กรอกค่าเดือนนี้' : 'ยังไม่ได้ตั้ง KPI ตัวนี้ — ตั้งที่แท็บ ⚙️');
      } else if (def && (target != null || bars?.commit_value != null)) {
        /* 📅 score_by_plan (11/11): เทียบแผนสะสมของเดือนที่โชว์ — แผนของแถวนี้ ไม่มี = แผนของแผ่นโรงงานที่แชร์ค่า (ยอดขาย/หัว) */
        const planEarly = planByKpi[def?.id] || (man?.sharedDef ? planByKpi[man.sharedDef.id] : null) || {};
        const mSel = Number(String(valueKey || monthKey).slice(5, 7)) || monthNo;
        const sc = scoreDef(value, def, { plan: def?.score_by_plan ? planEarly[mSel] ?? null : null });
        st = sc.status === 'good' ? ST.good : sc.status === 'warn' ? ST.warn : sc.status === 'bad' ? ST.bad : ST.unknown;
        const cb = sc.bars.commit_value != null ? ` · Commit ${fmtBar(sc.bars.commit_compare, sc.bars.commit_value, unit)}` : '';
        why = sc.bars.byPlan
          ? `${tr("เทียบแผนสะสม")} ${monthLabel(`${year}-${String(mSel).padStart(2, '0')}`)} ${fmtBar(sc.bars.target_compare, sc.bars.target_value, unit)}${cb} (${tr("เป้าทั้งปี")} ${fmtBar(sc.bars.target_compare, sc.bars.annualTarget, unit)})`
          : def?.score_by_plan ? `${tr("เดือนนี้ยังไม่มีแผนสะสม — เทียบเป้าทั้งปี")} ${fmtBar(sc.bars.target_compare, sc.bars.target_value, unit)}${cb}`
          : `${tr("เทียบ")} Target ${fmtBar(sc.bars.target_compare, sc.bars.target_value, unit)}${cb}`;
      } else {
        why = r.auto && !fromDept ? 'ยังไม่ตั้งเป้า — ตั้งที่แท็บ ⚙️ ปุ่ม 🎯 ท้ายแถว' : 'ยังไม่ตั้งเป้า — ตั้งที่แท็บ ⚙️ ตอนแก้นิยาม KPI';
      }
      if (stale) why = `${tr("ค่าล่าสุด")} ${monthLabel(valueKey)} (${monthLabel(monthKey)} ${tr("ยังไม่กรอก")}) · ${why}`;
      const curFilled = value != null && !!series.find(p => p.k === valueKey)?.manualFill;
      const curDetail = value != null ? (series.find(p => p.k === valueKey)?.detail || null) : null;   // ที่มาของเลขเดือนที่โชว์ (แถว auto ช่าง)
      const curMan = value != null ? (series.find(p => p.k === valueKey)?.man ?? null) : null;   // ✍️ ค่ากรอกมือของเดือนที่โชว์ (ถูกค่าระบบทับ) — โชว์คู่กันให้เห็นความต่าง
      const curChild = value != null && !!series.find(p => p.k === valueKey)?.childFill;
      if (curChild) why = `⬆ ${tr("เดือนนี้ระดับนี้ไม่ได้กรอก ใช้ค่ารวมจากหน่วยลูก")} · ${why}`;
      if (curFilled) why = `✍️ ${tr("เดือนนี้ใช้ค่ากรอกมือ (ระบบไม่มีกะให้คำนวณ")}) · ${why}`;
      const ytd = series[12]?.v ?? null;
      const actualMonths = series.slice(0, 12).filter(p => p.v != null).length;
      /* 📈 คาดปลายปี = ผลจริง + แผนของเดือนที่เหลือ (30/09) — แผนอยู่ที่นิยามของขอบเขตนี้ (แถว auto = นิยาม auto:<key>)
         ไม่มีแผนครบ = บอกว่าขาดเดือนไหน ไม่เดา · ตัดสินรอด/ร่วงด้วย scoreDef เท่านั้น */
      const planDef = r.auto ? (def?.id ? def : autoDefOf(r.auto)) : man?.def;
      /* 16/11 (user: "ทุกกราฟต้องตอบได้ว่าจบปีจะผ่านไหม") — `fallback:true` = เดือนที่ไม่มีแผน สมมติ "ทำได้เท่าที่ผ่านมา" แล้วเขียนสมมติฐานบนจอ (กฎใน yearForecast) */
      const fcDef = planDef && planDef.kpi_catalog ? planDef : { kpi_catalog: { summary_mode: sumKind } };
      const fc = yearForecast({
        actual: series.slice(0, 12).map(p => p.v),
        plan: Array.from({ length: 12 }, (_, i) => planByKpi[planDef?.id]?.[i + 1] ?? null),
        def: fcDef, fallback: true,
      });
      const fcScore = fc.value != null && def && (target != null || def.commit_value != null || def.commitment) ? scoreDef(fc.value, def) : null;
      /* 🏁 เดือนที่เหลือต้องทำเท่าไหร่ถึงถึง Target ทั้งปี · 🔬 สูตรรวม (DL+OH) แตกเป็นสูตรลูกให้ popup 🔍 */
      const needed = neededRunRate({ actual: series.slice(0, 12).map(p => p.v), target, def: fcDef });
      const parts = fiB && !r.auto ? formulaPartSeries(fiB) : [];
      /* 🔬 20/11: กราฟลูกมีเส้นเป้าของตัวเองได้ ถ้าหน่วยตั้ง KPI สูตรลูก (dl_pct/oh_pct) ไว้ในขอบเขตนี้ — อ่านจากนิยามจริง ไม่เดา · ไม่มี = วาดแค่ค่าเฉลี่ยของตัวเอง */
      const partDefs = Object.fromEntries(parts.map(pt => [pt.key, (kdefs || []).find(d => formulaOfDef(d) === pt.key) || null]));
      /* เส้นแผนรายเดือน + เครื่องหมายโน้ต ติดไปกับจุดกราฟ (สเกลเดียวกับผลจริง — ห้ามแกน Y 2 ข้าง) */
      const planMap = planByKpi[planDef?.id] || (man?.sharedDef ? planByKpi[man.sharedDef.id] : null) || {};   // แผ่นที่แชร์ค่าโรงงานใช้แผนของแผ่นโรงงาน
      const notesOfRow = notesBy[r.key] || {};
      series = series.map((p, i) => (i < 12
        ? { ...p, plan: planMap[i + 1] ?? null, notes: notesOfRow[i + 1] || [], noteMark: (notesOfRow[i + 1] || []).length ? '📝' : '',
          /* 📈 แท่งจางของเดือนที่ยังไม่ถึง = ค่าที่ใช้คาดปลายปี (แผน หรือ สมมติเท่าที่ผ่านมา) — ไม่ใช่ผลจริง ห้ามวาดทึบ */
          proj: p.v == null && (fc.src?.[i] === 'assumed' || fc.src?.[i] === 'plan') ? fc.months[i] : null, projSrc: p.v == null ? (fc.src?.[i] || null) : null }
        : p));
      const forecast = value == null && !actualMonths ? null : {
        ...fc,
        status: fcScore ? fcScore.status : null,
        canJudge: !!fcScore,
        hasTarget: !!(def && (target != null || bars?.commit_value != null)),
      };
      return {
        ...r, def, unit, dir, series, value, valueKey, stale, target, st, why, note, manual, fxSrc, fxShort, amtText, fromDept, needed, parts, partDefs, fxInfo: fiB || null, months, sumKind, sumApprox, ytd, actualMonths, forecast, curFilled, curChild, curDetail, curMan, hrPerPct, childMix, mix, roll,
        csat: fiB?.key === 'csat_qd_pct' && kcsat?.length ? kcsat : null,   // 🤝 เจาะรายลูกค้าใน popup 🔍 (แผ่นที่คิดจากสูตร csat_qd_pct เท่านั้น)
        atLabel: man?.inherited && man.at ? org.labelOf(man.at.kind, man.at.value) : '',
        commit: bars?.commit_value ?? null, hasPlan: Object.keys(planMap).length > 0,
        dec: decimalsOf(def),
        delta: target != null && value != null && dir ? gapToTarget(value, target, dir) : null,
        hasDef: !!def,
      };
    });
  }, [data, scope, members, year, monthKey, org, mtnTeam, layoutOverride]);

  /* งานค้างที่ต้องตามแก้ — action item + เหตุการณ์ความปลอดภัยที่ยังไม่ปิด · เรียง "เกินกำหนดก่อน แล้วเก่าก่อน" */
  const todo = useMemo(() => {
    if (!data) return [];
    const acts = (data.actions || []).map(a => ({
      id: `a-${a.id}`, icon: a.source === 'obeya' ? '🏛️' : '🌅', kind: 'action',
      // หัวข้อว่าง/ช่องว่างล้วน = เขียนให้รู้ว่าว่าง ห้ามปล่อยแถวไม่มีชื่อ (UX audit 05/10)
      title: (a.problem || '').trim() || tr('(ไม่มีหัวข้อ)'),
      meta: [a.line_name, a.assignee ? `ผู้รับผิดชอบ ${a.assignee}` : 'ยังไม่ระบุผู้รับผิดชอบ'].filter(Boolean).join(' · '),
      due: a.due_date || null, color: 'var(--blue)', to: a.source === 'obeya' ? '/obeya?tab=sqdcm' : '/morning-meeting',
    }));
    const sf = (data.safety || []).filter(e => e.status === 'open').map((e) => {
      const k = safetyKind(e.kind);
      return {
        id: `s-${e.id}`, icon: k.unknown ? '🦺' : k.icon, kind: 'safety', ev: e,
        /* ชนิดที่ไม่อยู่ในทะเบียน = safetyKind คืน short '?' ⇒ เดิมขึ้น "? — …" (UX audit 05/10) — เขียนเป็นคำแทน */
        title: `${k.unknown ? tr('ไม่ระบุชนิด') : k.short} — ${(e.description || '').trim() || tr('(ไม่มีรายละเอียด)')}`,
        meta: [e.line_name, e.employee_name].filter(Boolean).join(' · ') || 'ยังไม่ปิดเคส',
        due: null, color: k.color, to: null, warn: !e.countermeasure ? tr('ยังไม่ได้ลงมาตรการแก้ไข') : null,
      };
    });
    const over = x => (x.due && x.due < date ? 0 : 1);
    return [...sf, ...acts].sort((a, b) => (over(a) - over(b)) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  }, [data, date]);

  /* ไฟรวม + "ประเมินได้กี่ช่อง" — ไฟเขียวจากช่องเดียวที่ประเมินได้ = หลอกคนอ่าน ต้องเขียนกำกับเสมอ */
  const overall = useMemo(() => {
    const all = rows.map(r => r.st);
    const known = all.filter(s => s !== ST.unknown).length;
    return { st: worstStatus(all), known, total: all.length };
  }, [rows]);
  const overdue = todo.filter(x => x.due && x.due < date).length;

  // ── ผังกระดาษ (ชุดเดียวกับจอ SQDCM) ──────────────────────────────────────────────
  /* ⚠️ ต้องนับ **ทุกแผ่นบนกริด** ไม่ใช่แค่แถว KPI — ท้ายบอร์ดมีแผ่นประจำอีก 1 ใบ
     (🚨 งานที่ต้องตามแก้ · เดิมมี 📌 Key Performance ด้วย — 05/10 แตกเป็นแผ่นรายตัวแล้ว) ถ้าลืมนับ พอ KPI เพิ่มจนเต็มหน้า
     ใบนี้จะถูกวาดทับทุกหน้า = ล้นเหมือนเดิม */
  const sheetItems = useMemo(() => [
    ...rows.map((r) => ({ kind: 'kpi', key: r.key, row: r, title: r.name })),
    { kind: 'todo', key: '__todo', title: 'งานที่ต้องตามแก้' },
  ], [rows]);
  /* ⚖️ 15/10 (user: "เกลี่ยหน้าแรกเหลือ 8 การ์ด ที่เหลือไปหน้า 2") — เกินหน้าเดียวเมื่อไหร่ เกลี่ยให้ทุกหน้าใกล้เคียงกัน
     โดยลดคอลัมน์ (แผ่นกว้างขึ้น ไม่เคยเล็กลง) · `balanceGrid` pure มีเทส */
  const tv = useTvShell();   // 📺 จอประชุม = 3×2 ต่อหน้า (TV_SHEET_GRID) · จอคอมเหมือนเดิม
  const grid = balanceGrid(useSheetGrid(wrapRef, 10, tv ? TV_SHEET_GRID : undefined), sheetItems.length);
  const { cols, cw, ch, fit, k } = grid;

  /* ── 📖 แบ่งหน้าแทนการเลื่อน (25/09 · คำสั่ง user "ดูจบได้ในหน้าเดียว … กดเปลี่ยนหน้า") ──
     จอไหนใส่ได้กี่แผ่นก็แบ่งหน้าตามนั้น — **ห้ามบีบแผ่นให้เล็กลงเพื่อยัดให้ครบ**
     (ฟอนต์ต่ำกว่า 11px = ผิดกติกาจอ TV) · ที่ไม่พอจริงๆ ถึงถอยไปโหมดเลื่อน */
  /* ⛔ ความสูงกริด = **วัดจริงจนถึงก้นจอ** ห้ามเดา `78vh` (ของเดิมเดาไว้ รวมกับหัวเพจแล้วเกิน
     1 จอ ⇒ หน้าเลื่อนขึ้นลงได้ = อาการที่ user ทักมา 25/09)
     ⚠️ ต้องประกาศ **ก่อน** คำนวณจำนวนหน้า เพราะจำนวนหน้าขึ้นกับความสูงที่วัดได้
     `null` = ที่ไม่พอจริง (มือถือหัวเพจสูง) ⇒ ถอยไปโหมดเลื่อนแบบเดิม */
  const [fitRef, availH] = useFitHeight(12, 120);
  /* 📱 มือถือ (15/10 · MOBILE-UX-STANDARD §4 ชนิด D): ไม่ใช้โหมดพอดีจอ/แบ่งหน้า — แผ่นเรียงลงทีละใบ สูงคงที่
     `MOBILE_SHEET_H` แล้วเลื่อนหน้าปกติ · เดิมแผ่นทรง A4 สูง 875px/ใบบนจอ 360×640 (1.4 จอต่อ KPI 1 ตัว · หน้ารวม ~7,000px)
     จอคอม/TV = เหมือนเดิมเป๊ะ (desktopdiff) */
  const isMobile = useIsMobile();
  const fitOn = !isMobile && availH != null;

  /* ช่องต่อหน้า = คอลัมน์ × **แถวที่ลงจอจริง** — จอเตี้ย/จอแคบใส่ได้น้อยแถว ก็แบ่งหน้าเพิ่ม
     ห้ามบีบแผ่นให้เล็กลงเพื่อยัดลงจอ (ฟอนต์จะต่ำกว่า 11px = ผิดกติกา UI จอ TV) */
  const rowsFit = grid.fit
    ? (grid.rows || 1)
    : Math.max(1, Math.floor(((grid.bh || 0) + GAP) / ((grid.ch || 1) + GAP)));
  const perPage = Math.max(1, (grid.cols || 1) * rowsFit);
  const pages = useMemo(() => (fitOn ? packPages(sheetItems, perPage) : [sheetItems]),
    [sheetItems, perPage, fitOn]);
  const [pgRaw, setPg] = useState(0);
  const pg = clampPage(pgRaw, pages.length);          // เปลี่ยนขอบเขต/เดือนแล้วหน้าหาย ⇒ เด้งกลับ ห้ามจอว่าง
  const pageItems = pages[pg] || [];
  /* 📺 สลับหน้าเอง **เฉพาะตอนอยู่ในรอบวนจอ** (DisplayRotator ประกาศ dwell ไว้ · 15/10) — จังหวะ = เวลาที่จอวนค้างหน้านี้ ÷ จำนวนหน้า
     (`boardFlipSec`) · `pg` ใน deps = คนกด ◀▶ เอง → นับเวลาใหม่จากหน้านั้น
     🎤 13/11 · คำสั่ง user "หน้านี้ใช้นำเสนอ ไม่ต้องมี timer ให้กดเอาเอง" ⇒ กดโหมดจอเอง (ไม่อยู่ในรอบวน · `activeDwellSecOf()` = null)
     = **ไม่สลับเอง** เปลี่ยนหน้าด้วย ◀▶ / ลูกศรคีย์บอร์ด / รีโมตพรีเซนเตอร์เท่านั้น · จอวน (role display) ยังสลับให้ครบทุกหน้าเหมือนเดิม */
  useEffect(() => {
    if (!board || pages.length < 2 || activeDwellSecOf() == null) return undefined;
    const sec = boardFlipSec(pages.length);
    if (!sec) return undefined;
    const id = setInterval(() => setPg((pg + 1) % pages.length), sec * 1000);
    return () => clearInterval(id);
  }, [board, pages.length, pg]);
  const has = (kind) => pageItems.some((x) => x.kind === kind);
  const pgLabels = useMemo(() => pageLabels(pages, (x) => x?.title), [pages]);

  const fs = (n) => Math.max(11, Math.round(n * k));
  const goBoard = (on) => {
    setBoard(on);
    try {
      if (on) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* เบราว์เซอร์ TV บางรุ่นไม่มี API นี้ — โหมด fixed ก็เต็มจออยู่แล้ว */ }
  };
  /* 🔗 เจาะจากแผ่นไปหน้าจริง **ต้องพาขอบเขต+วันไปด้วย** (30/09 · user: กรอง PD4 แล้วเจาะ OEE ต้องกรองใหม่)
     ส่งเฉพาะหน้าที่อ่าน param จริง (`/oee-analytics` อ่าน section/dept/line/date) — ใส่บนหน้าที่ไม่อ่าน = URL โกหก
     · param ที่ลิงก์ตั้งมาเอง (เช่น `tab=`) ชนะเสมอ · ทั้งโรงงาน = ไม่ส่งขอบเขต */
  const DRILL_AWARE = new Set(['/oee-analytics']);
  const goTo = (to) => {
    if (!to) return;
    const [path, qs] = to.split('?');
    if (!canAccessPage(path, role)) return;
    const q = new URLSearchParams(qs || '');
    if (DRILL_AWARE.has(path)) {
      Object.entries({ ...drillParams(org, scope), date }).forEach(([k, v]) => { if (v && !q.has(k)) q.set(k, v); });
    }
    navigate(q.toString() ? `${path}?${q}` : path);
  };
  /* 📡 เดือนปัจจุบัน = "สด" (ไม่มี ?date ใน URL ⇒ ตามวันทำงานจริง ข้ามเดือนแล้วบอร์ดเลื่อนตามเอง — จอ TV เปิดค้างเป็นเดือน)
     เดิมกด ◀ แล้ว ▶ กลับมาเดือนนี้ ยังปัก `date=` ค้างไว้ ⇒ บอร์ดค้างที่เดือนนั้นตลอดกาล (user 12/10 "default ควรจะเป็น live รึป่าว")
     ⇒ กลับมาถึงเดือนปัจจุบัน = ถอด `date` ออก · เดือนย้อนหลังเท่านั้นที่ปัก */
  const live = !sp.get('date');
  const setMonth = (k) => {
    if (!k || k === SUMMARY_KEY || k > today.slice(0, 7)) return;
    setParam('date', k === today.slice(0, 7) ? '' : monthEnd(k, today));
  };
  const shiftMonth = (n) => {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // ── กราฟ 12 เดือน + แท่งสรุป (หน้าตาเดียวกับโหมดปีของ SQDCM · สีแท่ง = เกณฑ์ทางการ) — ดู rowChart() ─────────
  /* 📈 บรรทัด "คาดปลายปี" ใต้แผ่น — ผลจริง + แผนที่เหลือ แล้วตัดสินด้วยเกณฑ์เดียวกับไฟ (scoreDef)
     · ไม่มีแผนครบ = เขียนว่าขาดเดือนไหน (ห้ามเดา) · ไม่มีเป้า = บอกตัวเลขอย่างเดียว ไม่ตัดสิน */
  const forecastLine = (r, kk = k) => {
    const fs = (n) => Math.max(11, Math.round(n * kk));
    const f = r.forecast;
    if (!f) return null;
    /* บรรทัดเดียวเสมอ (แผ่นสูงคงที่ — 2 บรรทัด = กราฟถูกบีบจนอ่านไม่ออก) · เต็มความใน title */
    const style = { fontSize: fs(10.5), lineHeight: 1.35, marginBottom: 3, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'clip', textOverflow: 'ellipsis' };
    /* 09/10 (user "remark เยอะไป ซ้ำกันทุกการ์ด"): แผ่นที่คาดไม่ได้ **ไม่เขียนบรรทัดนี้** — ไปรวมเป็นชิปเดียวใต้บอร์ด (`warnLines`)
       ว่ามีกี่แผ่นที่ยังไม่มีแผนรายเดือน · บนแผ่นเหลือเฉพาะตอนคำนวณได้จริง */
    if (f.value == null) return null;
    const verdict = f.status === 'good' ? { t: tr("✅ คาดถึงเป้า"), c: 'var(--green)' }
      : f.status === 'warn' ? { t: '🟡 ถึงแค่ Commitment', c: 'var(--amber)' }
      : f.status === 'bad' ? { t: tr("❌ คาดไม่ถึงเป้า"), c: 'var(--red)' } : null;
    const nAs = f.assumedMonths?.length || 0;
    const assumeTxt = nAs ? (f.assumed?.kind === 'slope' ? `${tr("เดือนที่เหลือ")} ${nAs} ${tr("ด. สมมติเพิ่มต่อเท่าอัตราเดิม")}` : `${tr("เดือนที่เหลือ")} ${nAs} ${tr("ด. สมมติทำได้เท่าค่าเฉลี่ย")} ${nf(f.assumed?.rate, r.dec)}${r.unit ? ' ' + r.unit : ''}`) : '';
    return (
      <div style={style} title={`${tr("ผลจริง")} ${f.actualMonths} ${tr("เดือน")}${f.planMonths ? ` + ${tr("แผน")} ${f.planMonths} ${tr("เดือน")}` : ''}${nAs ? ` + ${assumeTxt}` : ''} ${tr("รวมด้วยวิธี")} "${summaryShort(f.mode)}"${f.approx ? tr(' (โดยประมาณ — KPI นี้คิดจากยอดดิบทั้งปี แต่แผนไม่มียอดดิบ)') : ''}`}>
        {/* 📐 25/11: คำตัดสิน (✅/❌) ขึ้นก่อน — บรรทัดนี้ถูกตัดท้ายเมื่อมีปุ่มข้อมูลต้นทาง จึงต้องให้สิ่งสำคัญสุดอยู่ซ้าย · รายละเอียดเดือนอยู่ใน title */}
        {verdict ? <><b style={{ color: verdict.c }}>{verdict.t}</b> · </> : (f.hasTarget ? '' : <>{tr("ไม่มีเป้า")} · </>)}
        {tr("ปลายปี")} {f.approx || nAs ? '≈ ' : ''}<b style={{ color: 'var(--text2)' }}>{nf(f.value, r.dec)}{r.unit ? ' ' + r.unit : ''}</b>
        {' '}({nAs ? `${tr("จริง")} ${f.actualMonths}+${tr("คาด")} ${nAs}${f.planMonths ? `+${tr("แผน")} ${f.planMonths}` : ''} ${tr("ด.")}` : f.planMonths ? `${tr("จริง")} ${f.actualMonths}+${tr("แผน")} ${f.planMonths} ${tr("ด.")}` : `${tr("จริงครบ")} ${f.actualMonths} ${tr("ด.")}`})
      </div>
    );
  };
  /* 🏷️ บรรทัดรอง = "ที่มาของตัวเลข" แบบย่อ — แทนกล่อง ⚠️ ยาวๆ ใต้แผ่น (09/10) · เต็มความอยู่ใน tooltip ไฟ + popup 🔍
     ⚡ N เดือน = ระบบคำนวณ · ✍️ N เดือน = เติมค่ากรอกมือ · ✍️ ทับ N = กรอกไว้แต่ค่าระบบชนะ · ค่าระดับแม่ติดชื่อระดับ */
  const srcLabel = (r, { full = false } = {}) => {
    if (r.roll) return `⬆ ${tr("รวม")} ${r.roll.n} ${tr("หน่วยลูก")}${r.roll.combine === 'formula' ? tr(' (Σ ตัวตั้ง ÷ ค่ากลาง)') : r.roll.approx ? tr(' (≈ เฉลี่ย)') : ''}`;
    if (r.childMix) return `✍️ ${tr("กรอกมือ · ⬆ เติมจากลูก")} ${r.childMix.filled} ${tr("เดือน")}${r.childMix.approx ? ' (≈)' : ''}`;
    if (r.fxSrc) return full ? r.fxSrc : r.fxShort;   // 🧮 สูตร: ตัวตั้ง/ตัวหารจริง (09/11) — บนกริดย่อ · เต็มใน tooltip/popup (25/11)
    if (r.manual) return `✍️ ${tr("กรอกมือ")}${r.atLabel ? ` (${tr("ระดับ")} ${r.atLabel})` : ''}`;
    const m = r.mix;
    if (m && (m.fillN || m.overlapN)) return `⚡ ${m.autoN} ${tr("เดือน")} · ✍️ ${m.fillN} ${tr("เดือน")}${m.overlapN ? ` · ${tr("ทับ")} ${m.overlapN}` : ''}`;
    return r.curFilled ? '✍️ กรอกมือ (เดือนนี้ไม่มีค่าระบบ)' : '⚡ ระบบคำนวณ';
  };
  /* ⚠️ เตือนบนแผ่น — เฉพาะเรื่องที่คนต้องลงมือ: ไฟเทา (ไม่มีค่า/ไม่มีเป้า) · ค่าโรงงานยังไม่มีนิยาม · กรอกไว้แต่ถูกค่าระบบทับ */
  const cardWarn = (r, kk) => {
    if (r.st === ST.unknown) return r.note ? <WarnNote k={kk} text={r.note} /> : (r.why || null);   // ไม่มีค่า/ไม่มีเป้า: มีเหตุผลยาว = กล่อง · ไม่มี = ข้อความสั้นตามเดิม
    if (r.mix?.overlapN) return <WarnNote k={kk} tone="none" tvHide text={`✍️ ${tr("ค่ากรอกมือซ้อน")} ${r.mix.overlapN} ${tr("เดือน — กดแท่งดูทั้ง 2 ค่า")}`} title={`${tr("แท่งจางที่ซ้อนอยู่ = ค่ากรอกมือ")} ${r.mix.overlapN} ${tr("เดือน (ทีมคิดเอง) · แท่งเต็ม = ค่าระบบ — กดแท่งเพื่อดูทั้ง 2 ค่า")}`} />;
    return null;
  };
  /* popup 🔍 = ที่ของรายละเอียดเต็ม (ไม่จำกัดบรรทัด): คาดปลายปี · เกณฑ์ที่ใช้ตัดสิน · ที่มา/หมายเหตุเต็ม */
  /* 🔎 16/11 (คำสั่ง user): popup 🔍 ต้องตอบ "ตกเพราะอะไร · ค่าไหนเกิน · เพราะอะไร · จบปีจะผ่านไหม" ไม่ใช่พาไปหน้ากรอก
     — เรียบเรียงโดย `buildInsight()` (utils/kpiInsight.js) จากตัวเลขที่ตัดสินแล้ว (scoreDef/applyFormulaEntries/yearForecast/neededRunRate) */
  const insightOf = (r) => {
    const idx = r.valueKey && r.valueKey !== SUMMARY_KEY ? Number(String(r.valueKey).slice(5, 7)) - 1 : null;
    const bars = r.def ? defBars(r.def) : null;
    const planV = r.def?.score_by_plan && idx != null ? (r.series[idx]?.plan ?? null) : null;
    return buildInsight({
      series: r.series.slice(0, 12), valueIdx: idx, value: r.value, target: r.target, commit: r.commit, dir: r.dir,
      targetCompare: bars?.target_compare || null, byPlan: !!(r.def?.score_by_plan && planV != null), planValue: planV,
      monthStatus: (p) => (r.def ? monthBarScore(p, r.def) : 'none'),
      fmt: (v) => `${nf(cvR(r, v), decR(r))}${unitR(r) ? ' ' + unitR(r) : ''}`,
      monthOf: (i) => monthLabel(`${year}-${String(i + 1).padStart(2, '0')}`),
      fmtIn: fmtInVar, info: r.fxInfo, forecast: r.forecast, needed: r.needed,
    });
  };
  /* 🎯 แถวเกณฑ์ใต้ตัวเลขใหญ่ใน popup 🔍 — ตัวเลขใหญ่ สีตามเกณฑ์ (แดง = Target · เหลือง = Commitment · น้ำเงิน = แผนสะสมเดือนนี้) ไม่ใช่ตัวจิ๋วปนกับหมายเหตุ
     (user 16/11: "Target/commitment ตอนนี้ไปขึ้นเหมือน note/remark น่าจะไฮไลท์ให้ชัดเหมือนค่า YTD") · บนแผ่นเล็กไม่วาด (ที่ไม่พอ · tooltip ไฟบอกอยู่แล้ว) */
  const goalsRow = (r, kk, zoomedCopy = false) => {
    if (!(zoomedCopy || kk > k * 1.15)) return null;
    const fs = (n) => Math.max(11, Math.round(n * kk));
    const bars = r.def ? defBars(r.def) : null;
    const idx = r.valueKey && r.valueKey !== SUMMARY_KEY ? Number(String(r.valueKey).slice(5, 7)) - 1 : null;
    const planV = r.def?.score_by_plan && idx != null ? (r.series[idx]?.plan ?? null) : null;
    const items = [
      { lb: '🎯 Target', v: bars?.target_value != null ? fmtBar(bars.target_compare, bars.target_value, r.unit) : 'ยังไม่ตั้ง', c: bars?.target_value != null ? 'var(--red)' : 'var(--muted)' },
      bars?.commit_value != null ? { lb: '🤝 Commitment', v: fmtBar(bars.commit_compare, bars.commit_value, r.unit), c: 'var(--amber)' } : null,
      planV != null ? { lb: `📅 แผนสะสม ${monthLabel(r.valueKey)}`, v: `${nf(cvR(r, planV), decR(r))}${unitR(r) ? ' ' + unitR(r) : ''}`, c: 'var(--blue)' } : null,
      r.ytd != null ? { lb: `YTD (${summaryShort(r.sumKind)})`, v: `${nf(cvR(r, r.ytd), decR(r))}${unitR(r) ? ' ' + unitR(r) : ''}`, c: 'var(--text)' } : null,
    ].filter(Boolean);
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${Math.round(6 * kk)}px ${Math.round(18 * kk)}px`, alignItems: 'baseline' }}>
        {items.map((it) => (
          <div key={it.lb} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: fs(11), fontWeight: 700, color: 'var(--muted)' }}>{it.lb}</span>
            <b style={{ fontSize: fs(17), fontWeight: 900, color: it.c, lineHeight: 1 }}>{it.v}</b>
          </div>
        ))}
      </div>
    );
  };
  const zoomFoot = (r, kk) => {
    const fs = (n) => Math.max(11, Math.round(n * kk));
    const bars = r.def ? defBars(r.def) : null;
    /* 🎯 เกณฑ์ที่ใช้ตัดสิน เขียนชัดๆ ตอนขยาย (user 16/11 "target/commitment ควรโชว์ให้ชัดเจนตอนขยายกราฟ") */
    const crit = [   // Target/Commitment ย้ายขึ้นไปแถว `goalsRow` ใต้ตัวเลขใหญ่แล้ว (user 16/11 "ควรไฮไลท์ให้ชัดเหมือนค่า YTD") — ที่นี่เหลือกติกาประกอบ
      r.dir ? ['ทิศทาง', r.dir === 'down' ? 'ยิ่งต่ำยิ่งดี' : 'ยิ่งสูงยิ่งดี'] : null,
      ['สรุปปี', summaryModeLabel(r.sumKind)],
      r.def?.score_by_plan ? ['○△✗ รายเดือน', 'เทียบแผนสะสม (เส้นน้ำเงิน)'] : null,
    ].filter(Boolean);
    /* 🔴 ชิปกติกาห้าม `nowrap` — ในรางขวา (กว้าง ~30% ของ popup) ชิปยาวอย่าง "○△✗ รายเดือน เทียบแผนสะสม"
       จะล้นออกนอกราง แล้วถูก `overflow:clip` ของแผ่นตัดหายเงียบ ⇒ ยอมให้ตัดบรรทัดในชิป */
    const chip = { fontSize: fs(11), fontWeight: 700, lineHeight: 1.3, padding: '3px 8px', borderRadius: 'var(--r-md)', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', maxWidth: '100%' };
    const ins = insightOf(r);
    /* 🔎 ลำดับในราง/ชั้นล่างของ popup (16/11 · user: "insight เป็นส่วนเสริม … กราฟต้องชัด"):
       ① สรุป 3 ข้อสำคัญสุด (ที่เหลือกางดูได้ ใน `<InsightList>`) → ② กติกาที่ใช้ตัดสิน → ③ ที่มา/หมายเหตุ
       **ห้ามเอา ② ③ ขึ้นก่อน ①** — คนกดแว่นขยายเพื่อถาม "ตกเพราะอะไร" ไม่ใช่มาอ่านกติกา */
    /* 🪪 20/11 (user: "text ขวามือรกเกินไป ย่อก็ยังรก อ่านยาก") — เลิกเป็นลิสต์ประโยคยาวตัดท้าย ⇒ **การ์ดคำตัดสิน 3 ใบ** (เลขใหญ่ + บรรทัดรองสั้น)
       ① เดือนนี้ vs เป้า ② คาดปลายปี ③ เดือนที่เหลือต้องทำ · ตามด้วย "เหตุหลัก" 1 ประโยค · ที่เหลือ (รายปี/แนวโน้ม/ตัวแปร/หมายเหตุ) พับไว้ กางแล้วไม่ตัดท้าย
       ตัวเลขทั้งหมดมาจาก `buildInsight()` (data ของแต่ละข้อ) — ไม่คิดซ้ำในหน้า */
    const byKind = (kd) => ins.find(l => l.kind === kd) || null;
    const gap = byKind('gap'), fc = byKind('forecast'), nd = byKind('needed'), drv = byKind('driver');
    const rest = ins.filter(l => !['gap', 'forecast', 'needed', 'driver'].includes(l.kind));
    const fmtV = (v) => `${nf(cvR(r, v), decR(r))}${unitR(r) ? ' ' + unitR(r) : ''}`;
    const tile = (lb, big, sub, tone, key) => (
      <div key={key} style={{ padding: `${Math.round(6 * kk)}px ${Math.round(9 * kk)}px`, borderRadius: 'var(--r-md)', minWidth: 0,
        background: 'var(--card)', backgroundImage: `linear-gradient(${toneDim(tone)}, ${toneDim(tone)})`, border: `1px solid ${toneLine(tone)}` }}>
        <div style={{ fontSize: fs(10.5), fontWeight: 700, color: 'var(--muted)' }}>{lb}</div>
        <div style={{ fontSize: fs(15), fontWeight: 900, color: toneVar(tone), lineHeight: 1.25, overflowWrap: 'anywhere' }}>{big}</div>
        {sub && <div style={{ fontSize: fs(10.5), color: 'var(--text2)', lineHeight: 1.35, marginTop: 2, overflowWrap: 'anywhere' }}>{sub}</div>}
      </div>
    );
    const tiles = [];
    if (gap?.data) {
      const g = gap.data;
      tiles.push(tile(`${g.label} ${tr("เทียบ")} ${g.refName}`,
        `${g.ok ? '✓' : '✗'} ${g.down ? (g.ok ? tr('ต่ำกว่าเป้า') : tr('เกินเป้า')) : (g.ok ? tr('สูงกว่าเป้า') : tr('ต่ำกว่าเป้า'))} ${fmtV(Math.abs(g.gap))}`,
        `${fmtV(g.value)} vs ${g.cmpSym} ${fmtV(g.ref)}${g.gapPct != null ? ` (${Math.abs(g.gapPct).toFixed(1)}%)` : ''}${!g.ok && g.commitHit === true ? tr(' · ยังถึง Commitment') : ''}${g.commitHit === false ? tr(' · หลุด Commitment') : ''}`,
        gap.tone, 'gap'));
    }
    if (fc?.data) {
      const f = fc.data;
      tiles.push(tile('คาดปลายปี', `${f.status === 'good' ? '✓' : f.status === 'bad' ? '✗' : f.status === 'warn' ? '△' : '?'} ${f.approx ? '≈ ' : ''}${fmtV(f.value)}`,
        `${String(f.verdict).replace(/^[^ก-๙A-Za-z]+/, '')} · ${tr("ถ้า")}${f.assume}`, fc.tone, 'fc'));
    }
    if (nd?.data && nd.data.feasible === false) {
      /* 🧱 20/11 (user): ตัวเลขที่เป็นไปไม่ได้ (≥ 126 %/เดือน · MTTR ติดลบ) ไม่ใช่คำแนะนำ ⇒ การ์ดบอก "ไม่ทันแล้ว" + เหตุผลว่าชนขอบไหน */
      const n = nd.data;
      const lim = n.limit?.kind === 'max' ? `${tr("เพดาน")} ${fmtV(n.limit.value)}` : `${tr("พื้น")} ${fmtV(n.limit?.value)}`;
      tiles.push(tile(`${tr("เดือนที่เหลือ")} ${n.remaining} ${tr("ด.")}`, '✗ ไม่ทัน Target ปีนี้',
        n.kind === 'reach'
          ? `Target ${fmtV(n.perMonth)} ${n.limit?.kind === 'max' ? tr('เกิน') : tr('ต่ำกว่า')}${lim} ${tr("ที่เป็นไปได้")}`
          : `${tr("ต่อให้ทำได้สุด")}${lim} ${tr("ทุกเดือนที่เหลือ ทั้งปีดีสุดได้แค่")} ${fmtV(n.bestCase)}`, 'bad', 'nd'));
    } else if (nd?.data) {
      const n = nd.data;
      tiles.push(tile(`${tr("เดือนที่เหลือ")} ${n.remaining} ${tr("ด.")}`,
        n.kind === 'reach' ? (n.reached ? 'ถึงเป้าแล้ว' : `${tr("ต้องถึง")} ${fmtV(n.perMonth)}`) : (n.trivially ? 'ผ่านแน่แล้ว' : `${n.down ? '≤' : '≥'} ${fmtV(n.perMonth)} /${tr("เดือน")}`),
        n.kind === 'reach' ? (n.reached ? 'ตัวสะสมถอยไม่ได้' : `${tr("เพิ่มอีก")} ${fmtV(Math.abs(n.add))} ${tr("ภายใน ธ.ค.")}`) : (n.trivially ? 'เดือนที่เหลือได้ 0 ก็ยังผ่าน' : `${n.kind === 'sum' ? tr('เดือนละ') : tr('เฉลี่ยต่อเดือน')} ${tr("ถึงจะถึง Target ทั้งปี")}`),
        nd.tone, 'nd'));
    }
    return (
      <>
        {tiles.length ? <div style={{ display: 'grid', gap: Math.max(4, Math.round(5 * kk)) }}>{tiles}</div>
          : <div style={{ fontSize: fs(11), lineHeight: 1.4, color: 'var(--muted)' }}>{tr("ยังไม่มีข้อมูลพอสรุป — ต้องมีค่าอย่างน้อย 1 เดือน + เป้าที่ตั้งไว้")}</div>}
        {drv && (
          <div style={{ marginTop: Math.round(6 * kk), padding: `${Math.round(5 * kk)}px ${Math.round(8 * kk)}px`, borderRadius: 'var(--r-md)', background: 'var(--bg3)', borderLeft: `3px solid ${toneVar('warn')}`, fontSize: fs(11.5), lineHeight: 1.45, color: 'var(--text)', overflowWrap: 'anywhere' }}>
            <b style={{ color: 'var(--muted)', fontSize: fs(10.5) }}>{tr("เหตุหลัก")}</b><br />{drv.text}
          </div>
        )}
        {rest.length > 0 && <div style={{ marginTop: Math.round(6 * kk) }}><InsightList k={kk} items={rest} max={0} lines={4} label={tr("รายละเอียด")} /></div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 6px' }}>
          {crit.map(([lb, v]) => <span key={lb} style={chip}><span style={{ color: 'var(--muted)', fontWeight: 600 }}>{lb}</span> {v}</span>)}
        </div>
        {/* บรรทัด "ปลายปี" ไม่ซ้ำใน popup — อยู่ในรายการ insight (🔮) แล้ว */}
        {r.why && <div style={{ marginBottom: 3 }}>{r.why}</div>}
        {r.note && <div style={{ color: 'var(--text2)' }}>ℹ️ {r.note}</div>}
      </>
    );
  };
  /* `kk` = สเกลของแผ่นที่กำลังวาด (ปกติ = k ของกริด · ใน popup 🔍 ขยาย = ใหญ่กว่า) ⇒ ฟอนต์แกน/ป้ายโตตามแผ่น */
  /* 👁 มุมมองหน่วยของแผ่น (ตอนนี้มีแค่ MBD: % ↔ ชม.) — แปลงตอนวาดเท่านั้น · ค่าในแถว/สถานะ/คาดปลายปียังเป็น % */
  const hvR = (r) => !!(r.hrPerPct && (hrDefault ? !hrRows.has(r.key) : hrRows.has(r.key)));
  const cvR = (r, v) => (v == null ? null : hvR(r) ? v * r.hrPerPct : v);
  const unitR = (r) => (hvR(r) ? 'ชม.' : r.unit);
  const decR = (r) => (hvR(r) ? 1 : r.dec);
  const rowChart = (r, kk = k, sheetW = cw, zoomedCopy = false) => {
    const fs = (n) => Math.max(11, Math.round(n * kk));
    const zoomed = zoomedCopy || kk > k * 1.15;   // ใน popup 🔍 = ป้าย T/C บอกตัวเลข · ตัวเลขบนแท่งคาดการณ์ · กราฟลูกของสูตรรวม (`zoomedCopy` จาก Sheet = ของจริง ห้ามเดาจาก k อย่างเดียว)
    const axisTick = { fontSize: fs(9.5), fill: 'var(--muted)' };
    const chartTip = tooltipProps(fs(11));   // สี/พื้น/cursor มาตรฐาน — utils/chartAxis.js
    const hv = hvR(r); const cv = (v) => cvR(r, v); const unitL = unitR(r); const decL = decR(r);
    const tgtL = cv(r.target); const cmtL = cv(r.commit);
    /* 🔢 ตัวเลขบนแท่ง (UI §กราฟ "ตัวเลขบนแท่งต้องมีเสมอ" · user 30/09 "มีตัวเลข above แต่ละแท่งจะดูง่ายขึ้นมั้ย")
       แน่นเกิน = เว้นแท่งเว้นเลข ห้ามลดฟอนต์ (แผ่นในกริดกว้าง ~300px / 13 แท่ง = ช่องละ ~20px) —
       เดือนที่เลือก + แท่งสรุป โชว์เสมอ · ต่อท้ายตัวเลข (เดิมเป็นป้ายแยก ซ้อนกันไม่ได้) */
    const slotW = Math.max(0, sheetW - 60) / 13;
    const labelW = (v) => nf(cv(v), decL).length * fs(9.5) * 0.62;
    const dense = r.series.some(p => p.v != null && labelW(p.v) > slotW);
    const data = r.series.map((p, i) => {
      const show = p.v != null && (!dense || p.summary || p.k === monthKey || i % 2 === 0);
      return { ...p, v: cv(p.v), vRaw: p.v, man: cv(p.man), manRaw: p.man ?? null, plan: cv(p.plan), proj: cv(p.proj), label: p.summary ? tr('สรุป') : String(Number(String(p.k).slice(5, 7))),
        vLabel: `${show ? nf(cv(p.v), decL) : ''}${p.noteMark || ''}`, projLabel: p.proj != null && zoomed ? nf(cv(p.proj), decL) : '' };
    });
    if (!data.some(p => p.v != null)) return <EmptyChart k={kk} text={`${tr("ยังไม่มีค่าสักเดือนในปี")} ${year}`} />;   // เหตุผลอยู่ที่ไฟ/ท้ายแผ่นแล้ว ไม่พิมพ์ซ้ำ
    /* แกน % ตรึง 0–100 เฉพาะเมื่อค่า/เป้าอยู่ในสเกลนั้นจริง — DL+OH 1.3% บนแกน 0–100 = เส้นแบนอ่านไม่ออก (user ทัก 30/09) */
    const peak = Math.max(...data.map(p => (p.v == null ? 0 : Number(p.v))), ...data.map(p => (p.man == null ? 0 : Number(p.man))), ...data.map(p => (p.proj == null ? 0 : Number(p.proj))), tgtL == null ? 0 : Number(tgtL));
    const isPct = unitL === '%' && peak > 25;
    /* 🎯 โฟกัส: ทุกอย่างที่วาดต้องอยู่ในช่วง (แท่ง · T · C · แผน) — เส้นเป้าหลุดนอกกราฟเงียบๆ = จอโกหก */
    const focus = yFocus ? focusDomain([...data.map(p => p.v), ...data.map(p => p.plan), ...data.map(p => p.man), ...data.map(p => p.proj), tgtL, cmtL], { max: unitL === '%' ? 100 : null }) : null;
    const yDomain = focus ? focus.domain : (isPct ? [0, 100] : undefined);
    const chart = (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* 🔴 กติกาความซื่อสัตย์: แกนไม่เริ่ม 0 ต้องเขียนบนจอ — ตัวร่วมใน ObeyaSheet (SQDCM %Q ใช้ตัวเดียวกัน) */}
      {focus && <FocusAxisNote k={kk} loText={nf(focus.domain[0], decL)} />}
      {r.hrPerPct && (
        <div style={{ position: 'absolute', top: 0, right: 6, zIndex: 2, display: 'flex', gap: 2 }}>
          {[['%', false], ['ชม.', true]].map(([lb, on]) => (
            <button key={lb} type="button" onClick={(e) => { e.stopPropagation(); if (hv !== on) toggleHr(r.key); }}
              title={tr('สลับหน่วยที่ดู — ชม. = ชั่วโมงเครื่องหยุด แปลงจาก % ด้วยฐาน 730 ชม. × จำนวนเครื่อง (ตัวเลข KPI ทางการและไฟสถานะยังเป็น %)')}
              style={{ fontSize: fs(10), lineHeight: 1.3, padding: '1px 6px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 700,
                background: hv === on ? 'var(--accent)' : 'var(--card)', color: hv === on ? 'var(--accent-ink)' : 'var(--muted)' }}>{lb}</button>
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: unitL ? axisUnitTop(fs(9.5), fs(6)) : fs(12), right: 6, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} interval={0} />
          {/* ✍️ แกน X ซ้ำ (ซ่อน) ให้แท่งค่ากรอกมือวาด "ซ้อน" ในช่องเดือนเดียวกัน ไม่ใช่เรียงข้าง — user 14/10 "ขึ้นซ้อนกันเพื่อให้เห็นความต่าง · ขนาดต่างกันเล็กน้อย" */}
          <XAxis xAxisId="man" dataKey="label" hide />
          <XAxis xAxisId="proj" dataKey="label" hide />
          {/* 📏 หน่วยของแกน Y ต้องเขียนบนกราฟ (30/09 · user: "unit มันไม่มีบอก บาท/%/hrs") — ป้ายเหนือแกน ไม่ใช่ต่อท้ายทุก tick (8kPPM อ่านยาก) */}
          <YAxis domain={yDomain} ticks={focus ? focus.ticks : undefined} allowDataOverflow={!!focus} tick={axisTick} width="auto"
            tickFormatter={v => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)}
            label={axisUnitLabel(unitL, { fontSize: fs(9.5), lift: fs(6) })} />
          <Tooltip {...chartTip} formatter={(v, name, item) => [`${nf(v, decL)}${unitL ? ' ' + unitL : ''}${name !== 'plan' && item?.payload?.detail ? ` · ${item.payload.detail}` : ''}`, name === 'plan' ? '📅 แผน' : name === 'man' ? '✍️ กรอกมือ (ทีมคิดเอง)' : name === 'proj' ? `📈 ${tr("คาดการณ์")} (${item?.payload?.projSrc === 'plan' ? tr('ตามแผน') : tr('ถ้าทำได้เท่าที่ผ่านมา')})` : `⚡ ${r.name}`]}
            labelFormatter={(l, pl) => (pl?.[0]?.payload?.summary
              ? `${tr("สรุปปี")} ${year} (${r.sumKind === 'sum' ? tr('รวม') : tr('เฉลี่ย')}${r.auto && !r.fromDept ? tr('ถ่วงน้ำหนัก') : ''}${tr("ทั้งปี")})`
              : `${monthLabel(pl?.[0]?.payload?.k || '')} ${year}${pl?.[0]?.payload?.notes?.length ? ` · 📝 ${pl[0].payload.notes.length} ${tr("หมายเหตุ")}` : ''} · ${tr("กดเพื่อดูหมายเหตุของเดือนนี้")}`)} />
          {/* เส้นเป้า (แดง) + เส้น Commitment (เหลือง) — user 30/09: "มาแต่เส้น target เส้น commitment ไม่เห็น" */}
          {tgtL != null && <ReferenceLine y={tgtL} stroke="var(--red)" strokeDasharray="4 3" label={{ value: zoomed ? `T ${nf(tgtL, decL)}` : 'T', position: 'insideTopRight', fontSize: fs(zoomed ? 10 : 9), fontWeight: 700, fill: 'var(--red)' }} />}
          {cmtL != null && cmtL !== tgtL && <ReferenceLine y={cmtL} stroke="var(--amber)" strokeDasharray="2 3" label={{ value: zoomed ? `C ${nf(cmtL, decL)}` : 'C', position: 'insideTopRight', fontSize: fs(zoomed ? 10 : 9), fontWeight: 700, fill: 'var(--amber)' }} />}
          {/* fill = สีตัวหนังสือใน tooltip เท่านั้น (Cell ทับสีแท่งจริง) — ไม่ใส่ = Recharts ใช้ #000 (user 30/09 "text ดำ") */}
          <Bar {...chartAnim()} dataKey="v" fill={CELL_BAR_FILL} radius={[2, 2, 0, 0]} onClick={(d) => { const pl = d?.payload ?? d; openMonth(r, pl && pl.vRaw !== undefined ? { ...pl, v: pl.vRaw } : pl); }}>
            <LabelList dataKey="vLabel" position="top" style={{ fontSize: fs(9.5), fontWeight: 700, fill: 'var(--text)' }} />
            {data.map((p, i) => (
              <Cell key={i} fill={statusColor(r.def ? monthBarScore({ ...p, v: p.vRaw }, r.def) : 'none')}
                fillOpacity={p.summary ? 0.55 : (p.manualFill || p.childFill) ? 0.38 : (p.k === monthKey ? 1 : 0.8)}
                stroke={p.summary || p.manualFill || p.childFill ? 'var(--text2)' : (p.k === monthKey ? 'var(--text)' : 'none')}
                strokeDasharray={p.summary ? '3 2' : (p.manualFill || p.childFill) ? '2 2' : undefined} cursor={p.summary ? 'default' : 'pointer'} />
            ))}
          </Bar>
          {/* 📈 เดือนที่ยังไม่ถึง = แท่งโปร่งเส้นประ (ค่าที่ใช้คาดปลายปี: แผน หรือ สมมติเท่าที่ผ่านมา) — แยกจากผลจริงให้เห็นชัด (16/11) */}
          {data.some(p => p.proj != null) && (
            <Bar xAxisId="proj" dataKey="proj" fill="var(--text2)" fillOpacity={0.14} stroke="var(--muted)" strokeDasharray="3 2" radius={[2, 2, 0, 0]} {...chartAnim()}>
              {zoomed && <LabelList dataKey="projLabel" position="top" style={{ fontSize: fs(9.5), fontWeight: 600, fill: 'var(--muted)' }} />}
            </Bar>
          )}
          {/* ✍️ ค่ากรอกมือที่ถูกค่าระบบทับ = แท่งแคบกว่า/จางกว่า ซ้อนในช่องเดียวกัน (ช่วงเปลี่ยนผ่าน: ทีมคิดเอง vs ระบบ) · กดแล้วเห็นทั้ง 2 ค่าใน popup */}
          {data.some(p => p.man != null) && (
            <Bar xAxisId="man" dataKey="man" barSize={Math.max(4, Math.round(slotW * 0.42))} fill="var(--text2)" fillOpacity={0.32}
              stroke="var(--text2)" strokeDasharray="2 2" radius={[2, 2, 0, 0]} {...chartAnim()}
              onClick={(d) => { const pl = d?.payload ?? d; openMonth(r, pl && pl.vRaw !== undefined ? { ...pl, v: pl.vRaw } : pl); }} />
          )}
          {/* 📅 เส้นแผนรายเดือน — KPI แบบสะสมเทียบเป้าทั้งปีตั้งแต่ต้นปีจะดู "ตกตลอด" ต้องเทียบแผนของเดือนนั้น (user 30/09) */}
          {r.hasPlan && <Line type="monotone" dataKey="plan" stroke="var(--blue)" strokeWidth={1.5} strokeDasharray="5 3" dot={{ r: 2, fill: 'var(--blue)' }} connectNulls {...chartAnim()} />}
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    );
    /* 🔁 25/11 ค่าดิบของสูตร (user: "ทุกกราฟที่มีการคำนวณควรกดสลับดูค่าจริง เช่น dl, sale from product")
       · ตัวแปรฐานชุดเดียวกับที่คิดค่าหลัก (`r.fxInfo.inputs[เดือน][ตัวแปร]`) — ไม่คิดใหม่ในหน้า
       · 🔴 ห้ามแกน Y 2 ข้าง (กฎ `no-dual-y-axis` — จุดตัดระหว่างสเกลอิสระเป็นของปลอม) ⇒ 1 ตัวแปร = 1 กราฟเล็ก ซ้อนแกน X เดียวกัน (เดือน 1–12) · บาท → MB
       · ปุ่มสลับ = `<Segmented>` (2 ตัวเลือก · UI §มาตรฐานหน้าตา) อยู่เหนือแถวกราฟลูก · สถานะต่อแผ่น (`rawView[r.key]`) */
    const rawVars = zoomed && r.fxInfo?.key ? (formulaOf(r.fxInfo.key)?.vars || []) : [];
    const isRaw = rawVars.length > 0 && !!rawView[r.key];
    const toggle = rawVars.length > 0 ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 0', flexShrink: 0 }}>
        <Segmented size="sm" label={tr('มุมมองกราฟลูก')} value={isRaw ? 'raw' : 'calc'} onChange={(v) => setRawView(o => ({ ...o, [r.key]: v === 'raw' }))}
          options={[{ value: 'calc', label: r.parts?.length ? tr('ค่าคำนวณ (สูตรลูก)') : tr('ค่าคำนวณ') }, { value: 'raw', label: tr('ค่าดิบ (ตัวตั้ง/ตัวหาร)') }]} />
        <span style={{ fontSize: fs(10.5), color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'clip', textOverflow: 'ellipsis' }}>
          {isRaw ? `${tr('ตัวเลขฐานที่ใช้คิด')} ${r.fxInfo.label} · ${tr('บาท = MB')}` : (r.parts?.length ? tr('สูตรลูกของค่าหลัก') : tr('กด "ค่าดิบ" เพื่อดูตัวเลขฐานรายเดือน'))}
        </span>
      </div>
    ) : null;
    const rawGrid = isRaw ? (
      <div style={{ flex: '0 0 42%', minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${rawVars.length}, minmax(0, 1fr))`, gap: 8, paddingTop: 4 }}>
        {rawVars.map((v) => {
          const bv = baseVarOf(v);
          const isBaht = bv?.unit === 'บาท';
          const unit = isBaht ? 'MB' : (bv?.unit || '');
          const label = (bv?.label || v).split(' — ').pop().replace(/\s*\(.*$/, '');   // "ความพึงพอใจ — คะแนนที่ได้ ด้านคุณภาพ (Q)" → "คะแนนที่ได้ ด้านคุณภาพ" (เต็มอยู่ใน title)
          const vals = Array.from({ length: 12 }, (_, i) => { const x = r.fxInfo.inputs?.[i + 1]?.[v]; return x == null || x === '' ? null : (isBaht ? Number(x) / 1e6 : Number(x)); });
          const have = vals.filter(x => x != null);
          const dec = isBaht ? 2 : (have.some(x => !Number.isInteger(x)) ? 2 : 0);
          const avg = have.length ? have.reduce((a, b) => a + b, 0) / have.length : null;
          const pd = vals.map((x, i) => ({ label: String(i + 1), v: x, vLabel: x == null ? '' : nf(x, dec), auto: r.fxInfo.inputSrc?.[i + 1]?.[v] === 'auto' }));
          return (
            <div key={v} style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: fs(10.5), fontWeight: 800, color: 'var(--text2)', padding: '0 4px', whiteSpace: 'nowrap', overflow: 'clip', textOverflow: 'ellipsis' }}
                title={`${bv?.label || v} (${bv?.unit || ''}) · ${tr('เฉลี่ย')} ${avg == null ? '—' : nf(avg, dec)} ${unit} · ${tr('≈ จาง = ค่าจากทะเบียน (ไม่มีใครกรอก)')}`}>
                🧾 {label} <span style={{ fontWeight: 500, color: 'var(--muted)' }}>· {unit} · {tr('เฉลี่ย')} {avg == null ? '—' : nf(avg, dec)}</span>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={pd} margin={{ top: axisUnitTop(fs(9.5), fs(6)) + fs(6), right: 6, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} interval={rawVars.length > 3 ? 1 : 0} />
                    <YAxis tick={axisTick} width="auto" label={axisUnitLabel(unit, { fontSize: fs(9.5), lift: fs(6) })} />
                    <Tooltip {...chartTip} formatter={(x, name, item) => [`${nf(x, dec)} ${unit}${item?.payload?.auto ? tr(' · ≈ทะเบียน') : ''}`, label]} />
                    {avg != null && <ReferenceLine y={avg} stroke="var(--muted)" strokeDasharray="4 3" label={{ value: `${tr('เฉลี่ย')} ${nf(avg, dec)}`, position: 'insideTopRight', fontSize: fs(9), fill: 'var(--muted)' }} />}
                    <Bar dataKey="v" fill={CELL_BAR_FILL} radius={[2, 2, 0, 0]} {...chartAnim()}>
                      <LabelList dataKey="vLabel" position="top" style={{ fontSize: fs(9.5), fontWeight: 700, fill: 'var(--text)' }} />
                      {pd.map((q, i) => <Cell key={i} fill="var(--blue)" fillOpacity={q.auto ? 0.4 : 0.8} />)}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    ) : null;
    if (!(zoomed && (r.parts?.length || rawVars.length))) return chart;
    if (isRaw || !r.parts?.length) {
      /* ค่าดิบ หรือ สูตรไม่มีสูตรลูก (เช่น %RM · DSI · ยอดขาย/หัว): กราฟหลัก + แถวปุ่มสลับ (+ กราฟค่าดิบเมื่อกด) */
      return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}>
          <div style={{ flex: isRaw ? '1 1 58%' : '1 1 0', minHeight: 0 }}>{chart}</div>
          {toggle}
          {rawGrid}
        </div>
      );
    }
    /* 🤝 24/11 (user: "แยก Q/D และเจาะรายลูกค้าได้เลย") — ใต้กราฟลูก Q/D มีตารางรายลูกค้า × เดือน (ผลดิบ + เกรด A/B/C จากไฟล์ V5 ของ QSM)
       เกรด = ระดับทางการ 1/0.5/0 ของใบจริง ⇒ สีเขียว/เหลือง/แดงตามเกรดได้ (ไม่ใช่สีที่คิดเอง) · "*" = ไม่ประเมินเดือนนั้น · ส่วนนี้เลื่อนในตัวเองเมื่อสูงเกิน */
    const csatTable = r.csat ? (() => {
      const custs = [...new Set(r.csat.map(x => x.customer))];
      const ms = Array.from({ length: 12 }, (_, i) => i + 1);
      const has = new Set(r.csat.map(x => x.month));
      const months = ms.filter(m => has.has(m));
      const find = (c, kd, m) => r.csat.find(x => x.customer === c && x.kind === kd && x.month === m) || null;
      const cellT = { padding: `${Math.round(2 * kk)}px ${Math.round(5 * kk)}px`, borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap', fontSize: fs(10.5), fontVariantNumeric: 'tabular-nums' };
      const dotOf = (sc) => <span style={{ display: 'inline-block', width: fs(7), height: fs(7), borderRadius: '50%', background: toneVar(sc >= 1 ? 'good' : sc > 0 ? 'warn' : 'bad'), marginRight: 3, verticalAlign: 'middle' }} />;
      return (
        <div style={{ paddingTop: 6 }}>
          <div style={{ fontSize: fs(10.5), fontWeight: 800, color: 'var(--text2)', padding: '0 4px' }}>
            🤝 {tr('รายลูกค้า')} <span style={{ fontWeight: 500, color: 'var(--muted)' }}>· {tr('ตัวเลข = ผลดิบจากลูกค้า (คะแนน/PPM) · ● เขียว A=1 · เหลือง B=0.5 · แดง C=0 · * ไม่ประเมิน')}</span>
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              <th style={{ ...cellT, textAlign: 'left', color: 'var(--muted)' }}>{tr('ลูกค้า')}</th><th style={{ ...cellT, color: 'var(--muted)' }}>{tr('ด้าน')}</th><th style={{ ...cellT, textAlign: 'left', color: 'var(--muted)' }}>{tr('เกณฑ์ A')}</th>
              {months.map(m => <th key={m} style={{ ...cellT, color: 'var(--muted)' }}>{m}</th>)}
            </tr></thead>
            <tbody>
              {custs.flatMap(c => ['quality', 'delivery'].map(kd => {
                const any = r.csat.find(x => x.customer === c && x.kind === kd);
                if (!any) return null;
                const rm = r.csat.find(x => x.customer === c && x.kind === kd && x.remark)?.remark;
                return (
                  <tr key={`${c}|${kd}`}>
                    <td style={{ ...cellT, textAlign: 'left', fontWeight: 700 }} title={rm || undefined}>{c}{rm ? ' ⓘ' : ''}</td>
                    <td style={cellT}>{kd === 'quality' ? 'Q' : 'D'}</td>
                    <td style={{ ...cellT, textAlign: 'left', color: 'var(--muted)' }}>{any.grade_a || '—'}</td>
                    {months.map(m => {
                      const x = find(c, kd, m);
                      if (!x) return <td key={m} style={{ ...cellT, color: 'var(--muted)' }}>—</td>;
                      if (!x.evaluated || x.score == null) return <td key={m} style={{ ...cellT, color: 'var(--muted)' }} title={tr('ไม่ประเมินเดือนนี้')}>*</td>;
                      return <td key={m} style={cellT} title={`${tr('ผล')} ${x.result} · ${tr('คะแนน')} ${x.score}`}>{dotOf(Number(x.score))}{x.result}</td>;
                    })}
                  </tr>
                );
              }).filter(Boolean))}
            </tbody>
          </table>
        </div>
      );
    })() : null;
    /* 🔬 สูตรรวมแตกเป็นกราฟลูกใน popup 🔍 (16/11 · user: "dl+oh พอกดเจาะเข้าไปควรแตกเป็น 2 กราฟ dl กับ oh") — ตัวแปรชุดเดียวกับค่าหลัก (formulaPartSeries) */
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}>
        <div style={{ flex: csatTable ? '0 0 38%' : '1 1 58%', minHeight: 0 }}>{chart}</div>
        {toggle}
        {csatTable && <div style={{ flex: '1 1 0', overflowY: 'auto', minHeight: 0, order: 2 }}>{csatTable}</div>}
        <div style={{ flex: csatTable ? '0 0 24%' : '0 0 42%', minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${r.parts.length}, minmax(0, 1fr))`, gap: 8, paddingTop: 4 }}>
          {r.parts.map((pt) => {
            /* 20/11 (user: "กราฟ DL/OH มีแผนไหม · ที่แดงเพราะส่วนไหน · ตัวเลขทับกันเละ · % หรือไม่ %"):
               · ไม่มี "แผนรายส่วน" ในระบบ — แผน/เป้าตั้งที่ KPI รวม (DL+OH) · ถ้าหน่วยตั้ง KPI สูตรลูก (DL % / OH %) ไว้ ⇒ วาดเส้น T ของมัน (`partDefs`)
               · ไม่มีเป้าลูก = เทียบ "ค่าเฉลี่ยของตัวเองในปี" (เส้นประ) · ▲ = เดือนที่สูงกว่าเฉลี่ย **และ** KPI รวมเดือนนั้นหลุดเป้า = ตัวที่ดันให้รวมเกิน
               · ทศนิยม ≤ 2 (ป้ายกับ tooltip ชุดเดียวกัน) · สีน้ำเงินล้วน (ไม่ใช่สีสถานะ — สถานะทางการอยู่ที่กราฟรวม) */
            const dec2 = Math.min(decL, 2);
            const vals = Object.values(pt.months).filter(v => v != null);
            const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
            const pDef = r.partDefs?.[pt.key] || null;
            const pBars = pDef ? defBars(pDef) : null;
            const badMain = new Set(r.series.slice(0, 12).map((p, i) => (r.def && p.v != null && monthBarScore(p, r.def) === 'bad' ? i + 1 : null)).filter(Boolean));
            const pd = Array.from({ length: 12 }, (_, i) => {
              const v = pt.months[i + 1] ?? null;
              const above = v != null && avg != null && v > avg;
              const hot = above && badMain.has(i + 1);
              return { label: String(i + 1), v, hot, vLabel: v == null ? '' : `${nf(v, dec2)}${hot ? '▲' : ''}` };
            });
            return (
              <div key={pt.key} style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: fs(10.5), fontWeight: 800, color: 'var(--text2)', padding: '0 4px', whiteSpace: 'nowrap', overflow: 'clip', textOverflow: 'ellipsis' }}
                  title={`${pt.label} · ${pt.expr}${pBars?.target_value != null ? ` · ${tr("เป้าของตัวเอง")} ${fmtBar(pBars.target_compare, pBars.target_value, pt.unit)}` : tr(' · ยังไม่มีเป้าแยกส่วน (ตั้ง KPI สูตรนี้ในขอบเขตนี้ถึงจะมีเส้น T)')} · ▲ = ${tr("สูงกว่าค่าเฉลี่ยปีของตัวเอง ในเดือนที่ KPI รวมหลุดเป้า = ตัวที่ดันให้เกิน")}`}>
                  🔬 {pt.label} <span style={{ fontWeight: 500, color: 'var(--muted)' }}>· {pt.expr} · {tr("เฉลี่ย")} {avg == null ? '—' : nf(avg, dec2)}{pt.unit ? ' ' + pt.unit : ''}{pBars?.target_value != null ? ` · T ${fmtBar(pBars.target_compare, pBars.target_value, pt.unit)}` : ''} · ▲ {tr("ตัวที่ดัน")}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={pd} margin={{ top: axisUnitTop(fs(9.5), fs(6)) + fs(6), right: 6, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={axisTick} interval={0} />
                      <YAxis tick={axisTick} width="auto" label={axisUnitLabel(pt.unit, { fontSize: fs(9.5), lift: fs(6) })} />
                      <Tooltip {...chartTip} formatter={(v, name, item) => [`${nf(v, dec2)}${pt.unit ? ' ' + pt.unit : ''}${item?.payload?.hot ? tr(' · ▲ สูงกว่าเฉลี่ย (เดือนที่รวมหลุดเป้า)') : ''}`, pt.label]} />
                      {avg != null && <ReferenceLine y={avg} stroke="var(--muted)" strokeDasharray="4 3" label={{ value: `เฉลี่ย ${nf(avg, dec2)}`, position: 'insideTopRight', fontSize: fs(9), fill: 'var(--muted)' }} />}
                      {pBars?.target_value != null && <ReferenceLine y={pBars.target_value} stroke="var(--red)" strokeDasharray="4 3" label={{ value: `T ${nf(pBars.target_value, dec2)}`, position: 'insideTopLeft', fontSize: fs(9), fontWeight: 700, fill: 'var(--red)' }} />}
                      <Bar dataKey="v" fill={CELL_BAR_FILL} radius={[2, 2, 0, 0]} {...chartAnim()}>
                        <LabelList dataKey="vLabel" position="top" style={{ fontSize: fs(9.5), fontWeight: 700, fill: 'var(--text)' }} />
                        {pd.map((p, i) => <Cell key={i} fill="var(--blue)" fillOpacity={p.hot ? 1 : 0.45} stroke={p.hot ? 'var(--text)' : 'none'} />)}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  /* กดแท่งเดือน = เลือกเดือนบนบอร์ด + เปิดหมายเหตุของเดือนนั้น (แท่ง "สรุป" = ไม่มีโน้ต) */
  /* 📝 25/11 (user เห็น QCC "0 % แดง" เพราะบอร์ดถูกสลับไป ม.ค. โดยไม่รู้ตัว): กดแท่ง = เปิดหมายเหตุของเดือนนั้น **ไม่สลับเดือนทั้งบอร์ด** — เปลี่ยนเดือนใช้ ◀ ▶ เท่านั้น */
  const openMonth = (r, p) => {
    const k = p?.k;
    if (!k || k === SUMMARY_KEY) return;
    const manTxt = p?.manRaw != null || p?.man != null ? ` · ✍️ ${tr("กรอกมือ (ทีมคิดเอง")}) ${nf(p.manRaw ?? p.man, r.dec)}${r.unit ? ' ' + r.unit : ''}` : '';
    setNoteFor({ rowKey: r.key, title: r.name, icon: r.icon, monthKey: k, valueText: p?.v == null ? '—' : `${manTxt ? tr('⚡ ระบบ ') : ''}${nf(p.v, r.dec)}${r.unit ? ' ' + r.unit : ''}${manTxt}` });
  };

  /* ── หัวแผ่นสรุป ── */
  const monthText = `${monthLabel(monthKey)} ${year}`;
  const shell = board
    /* zIndex ต้องสูงกว่ารางเมนู (App.jsx rail = 1000) — เดิม 800 ⇒ รางทับบอร์ดโหมดจอไป ~60px ซ้าย (user ส่งรูป 30/09) · ต่ำกว่าโมดัล 1100+ */
    ? { position: 'fixed', top: 'var(--tvbar-h, 0px)', left: 0, right: 0, bottom: 0, zIndex: 1010, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }   // top = ใต้แถบบนของกรอบจอ TV
    : { display: 'flex', flexDirection: 'column' };
  const pill = (active) => ({
    fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
    background: active ? 'var(--accent)' : 'var(--bg3)', color: active ? 'var(--accent-ink)' : 'var(--text)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
  });
  const navBtn = { fontSize: 12, fontWeight: 800, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' };
  const overallLamp = toLamp(overall.st, `${tr("ประเมินได้")} ${overall.known}/${overall.total} ${tr("ช่อง")}`);
  const rowsUsed = Math.max(1, Math.ceil(cellsUsed(pageItems) / (cols || 1)));
  const sheetsBox = {
    display: 'grid', gap: GAP, alignContent: 'start', justifyContent: 'center',
    gridTemplateColumns: cw ? `repeat(${cols}, ${cw}px)` : `repeat(${cols}, 1fr)`,
    /* แถวของ "หน้านี้" เท่านั้น แล้วยืดเต็มกล่อง — หน้าสุดท้ายที่มีแผ่นไม่ครบแถวจะได้ไม่เหลือ
       ที่ว่างเป็นแถบใหญ่ใต้บอร์ด (เห็นชัดตอนแบ่งหน้าบนจอเตี้ย) · จอที่เต็มพอดีได้ผลเท่าเดิมเป๊ะ */
    gridTemplateRows: `repeat(${rowsUsed}, minmax(0, 1fr))`,
    height: '100%',
    ...(isMobile ? { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'none', gridAutoRows: `${MOBILE_SHEET_H}px`, height: 'auto' } : null),
  };
  const runRateN = rows.filter(r => r.forecast && (r.forecast.basis === 'runrate' || r.forecast.basis === 'mixed') && r.forecast.hasTarget).length;   // 16/11: ไม่มีแผน = คาดจากที่ผ่านมา (บอกบนจอว่าเป็นสมมติฐาน)
  const warnLines = [
    data?.warn?.length ? `ตัวเลขบางส่วนโหลดไม่ครบ: ${data.warn.join(' · ')}` : null,
    data?.kpiMissing ? 'ยังไม่ได้ apply migration ตาราง KPI — แถว ✍️ ทั้งหมดจะว่างจนกว่าจะ apply (แจ้ง admin)' : null,
    data?.openSess && monthKey === today.slice(0, 7) ? `วันนี้ยังมี ${data.openSess} กะที่ยังไม่ปิด — ตัวเลขเดือนนี้ยังไม่ครบ` : null,
    scopeNoLines ? `${scopeText} ไม่มีไลน์ผลิตในผัง — ไม่มีแผ่น OEE/PPM ให้ (ตัวเลขเกิดจากกะผลิต) · แผ่นที่เห็น = KPI กรอกมือที่ตั้งไว้ที่แท็บ ⚙️` : null,
    err ? `โหลดไม่สำเร็จ: ${err}` : null,
    runRateN ? `📅 ${runRateN} แผ่นคาดปลายปีจาก "ทำได้เท่าที่ผ่านมา" (แท่งโปร่ง ≈) — ใส่แผนรายเดือนที่แท็บ ⚙️ แถว 📅 แผน แล้วจะใช้แผนแทน` : null,
  ].filter(Boolean);

  const moveSheet = async (key, dir) => {
    if (!scope) return;
    const cur = rows.map(r => r.key);
    const next = moveBoardKey(cur, key, dir);
    if (next === cur) return;
    const prev = layoutOverride;
    setLayoutOverride(next);
    const ok = checkWriteRows(await supabase.from('kpi_board_layouts').upsert(
      { year, scope_kind: kscope.kind || 'plant', scope_value: kscope.value || '', row_keys: next },
      { onConflict: 'year,scope_kind,scope_value' }).select('id'), 'บันทึกลำดับแผ่น KPI');
    if (!ok) setLayoutOverride(prev);
  };
  const controls = (
    <>
      {/* ขอบเขต = ผังองค์กรทุกมิติ (23/09) — 1 บอร์ดต่อ 1 ขอบเขต (ฝ่าย/ส่วนงาน/แผนก/กลุ่มไลน์/ไลน์/CC) · ชิป = เจาะลง/กลับขึ้นหนึ่งชั้น */}
      <OrgScopePicker ccOnly index={org} value={scope || PLANT} onChange={setScope} scopeSet={scopeSet} sections={sections} failed={orgFailed}
        width={230} title={tr('เลือกขอบเขตตามรหัส cost center (Obeya/KPI สรุปตามรหัส)')} />
      {parentScope && <button onClick={() => setScope(parentScope)} style={pill(false)} title={`${tr("กลับขึ้น")} ${org.labelOf(parentScope.kind, parentScope.value)}`}>↑</button>}
      {childChips.map(c => (
        <button key={c.key} onClick={() => setScope({ kind: c.kind, value: c.value })} style={pill(false)} title={`${tr("เจาะ")} ${org.labelOf(c.kind, c.value)}`}>{tr(c.label)}</button>
      ))}
      <span className="sep" />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <button onClick={() => shiftMonth(-1)} title={tr('เดือนก่อน')} style={navBtn}>◀</button>
        <b style={{ fontSize: 13, minWidth: 92, textAlign: 'center' }} title={live ? tr("เดือนปัจจุบัน — ตามวันจริง ข้ามเดือนแล้วเลื่อนเอง") : `${tr("ปักดูเดือน")} ${monthText} ${tr("อยู่ — กด \"สด\" เพื่อกลับเดือนปัจจุบัน")}`}>
          {monthText}{live && <span style={{ marginLeft: 5, fontSize: 11, fontWeight: 800, color: 'var(--green)', verticalAlign: 'middle' }}>{tr('● สด')}</span>}
        </b>
        <button onClick={() => shiftMonth(1)} disabled={live} title={live ? tr('อยู่เดือนปัจจุบันแล้ว') : tr('เดือนถัดไป')} style={navBtn}>▶</button>
        {!live && <button onClick={() => setParam('date', '')} title={tr('กลับเดือนปัจจุบัน (ตามวันจริง)')} style={{ ...navBtn, fontSize: 11.5, padding: '2px 8px', fontWeight: 700 }}>{tr('⟲ สด')}</button>}
      </span>
      <span className="sep" />
      {/* 🎯 โฟกัสช่วงค่า — ยกพื้นแกน Y ให้เห็น gap T/C (แกนไม่เริ่ม 0 ⇒ แผ่นเขียนบอกเอง) */}
      <button onClick={() => setParam('yfocus', yFocus ? '' : '1')} style={pill(yFocus)} aria-pressed={yFocus}
        title={yFocus ? tr("กำลังโฟกัสช่วงค่า: แกน Y เริ่มใกล้ค่าต่ำสุด ให้เห็นระยะห่าง Target/Commitment ชัด · กดเพื่อกลับแกนเริ่ม 0")
          : tr("โฟกัสช่วงค่า: ตัดที่ว่างใต้กราฟ ยกพื้นแกน Y ขึ้นใกล้ค่าต่ำสุด ให้เห็นระยะห่าง Target/Commitment ชัดขึ้น (แผ่นจะเขียนบอกว่าแกนไม่เริ่ม 0)")}>
        {yFocus ? tr('โฟกัสช่วงค่า') : tr('แกนเริ่ม 0')}
      </button>
      {/* ✒️ 20/11 (user: "กรอก/ตั้งเป้า ทุกการ์ดกดแล้วเด้งไปหน้าเดียวกัน ⇒ รวมเป็นปุ่มเดียวปลายแถบ") — แผ่น KPI ไม่มีปุ่มมุม/ปุ่มกรอกแล้ว
          · ปุ่มหัวเพจตายตัวเต็ม 2 ตัวแล้ว (บันทึกเหตุการณ์ · โหมดจอ TV · UI §6.35) จึงอยู่ปลายแถบกรองแทน · ไม่มี emoji ในป้าย (§6.35 ข้อ 5) */}
      {onTab && (
        <button type="button" className="pg-btn" onClick={() => onTab('table')} style={{ marginLeft: 'auto' }}
          title={tr('ไปหน้ากรอกค่า / ตั้ง Target-Commitment ของ KPI ขอบเขตนี้ (แท็บ ตั้งค่า KPI / กรอกผล)')}>
          {tr('กรอก / ตั้งเป้า KPI')} ↗
        </button>
      )}
    </>
  );

  return (
    <div style={shell}>
      {!board && (
        <PageHeader
          tabs={tabs} tab={tab} onTab={onTab}
          title={OBEYA_TITLE} icon={OBEYA_ICON}
          sub={`KPI ${tr("ที่ตั้งไว้ของ")} ${scopeText}${members.ccs.length && members.ccs.length <= 3 ? ` (cost ${members.ccs.join(' · ')})` : ''} · ${monthText} · ${tr("ประเมินได้")} ${overall.known}/${overall.total} ${tr("ช่อง")}`}
          filters={controls}
          actions={(
            <>
              {/* ปุ่มตายตัว ≤2 (UI §6.35 · 04/11): หลัก = บันทึกเหตุการณ์ · รอง = โหมดจอ TV · จัดเรียงแผ่น → ⋯ */}
              {canRecord && (
                <button type="button" className="pg-btn primary" onClick={() => setShowSafety({})}>
                  {tr('+ บันทึกเหตุการณ์ความปลอดภัย')}
                </button>
              )}
              {arrange && canNote && (
                <button type="button" className="pg-btn" onClick={() => setArrange(false)} aria-pressed={arrange}
                  title={arrange ? tr('ปิดโหมดจัดเรียง') : tr('จัดลำดับแผ่น KPI ของขอบเขตนี้เอง — กด ◀ ▶ บนแผ่น · บันทึกทันที · มีผลกับทุกคนที่ดูขอบเขตนี้')}>
                  {arrange ? tr('เสร็จสิ้นจัดเรียง') : tr('จัดเรียงแผ่น')}
                </button>
              )}
              <button type="button" className="pg-btn" onClick={() => goBoard(true)}>{tr('โหมดจอ TV')}</button>
              <OverflowMenu items={[
                { key: 'arrange', icon: '⇅', label: tr("จัดเรียงแผ่น KPI"), onClick: () => setArrange(true), hidden: !canNote || arrange,
                  title: tr("จัดลำดับแผ่น KPI ของขอบเขตนี้เอง (บันทึกต่อขอบเขต)") },
              ]} />
            </>
          )}
        />
      )}
      {board && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', flexShrink: 0, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: tv ? 26 : 18, fontWeight: 900 }}>OBEYA · {scope ? org.labelOf(scope.kind, scope.value) : '—'}</div>
          {/* 📺 จอประชุม: ตัวเลือกขอบเขต/เดือน/โฟกัส ไม่มีใครกด ⇒ เหลือแค่ "ดูเดือนไหน" ตัวโต */}
          {tv ? <b style={{ fontSize: 24 }}>{monthText}{live && <span style={{ marginLeft: 8, fontSize: 20, color: 'var(--green)' }}>{tr('● สด')}</span>}</b> : controls}
          <StatusLamp k={tv ? 2 : 1} w={999} stat={overallLamp} />
          <div style={{ flex: 1 }} />
          <button className="tv-hide" onClick={() => goBoard(false)} style={pill(false)}>{tr('ออกจากโหมดจอ')}</button>
        </div>
      )}


      {/* ⚠️ กล่องนอก = padding · กล่องใน (wrapRef) = ที่ถูกวัด ห้ามมี padding (clientHeight รวม padding → แถวล่างโดนตัด) */}
      <div ref={fitRef} style={{ display: 'flex', minHeight: 0, flex: board ? 1 : 'none',
        height: board ? undefined : (fitOn ? `${availH}px` : undefined), padding: board ? 8 : 0 }}>
        {/* 🔴 `clip` เมื่อคุมความสูงได้ — แผ่นที่ลงไม่พอไปหน้าถัดไป ห้ามเลื่อน (คำสั่ง user 25/09)
            ที่ไม่พอจริง (มือถือหัวเพจสูง) = ถอยไป `auto` ยอมให้เลื่อน ดีกว่าตัดเนื้อหาหาย */}
        <div ref={wrapRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: fitOn ? 'clip' : 'auto' }}>
          {loading && !data ? (
            <Skeleton cards={6} style={{ padding: '8px 0' }} />   /* 24/11: โครงเทาวิบแทนข้อความลอย (components/Skeleton) */
          ) : !scope ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{tr('กำลังเลือกขอบเขตเริ่มต้น…')}</div>
          ) : (
            <TabBody tab={data?.viewKey || ''} style={{ height: '100%', minHeight: 0 }}>
            <div style={sheetsBox}>
              {pageItems.filter((x) => x.kind === 'kpi').map(({ row: r }, sheetIdx) => (
                <div key={r.key} style={{ position: 'relative', minHeight: 0, display: 'grid' }}>
                {arrange && (
                  <div style={{ position: 'absolute', top: 4, right: 6, zIndex: 3, display: 'flex', gap: 4 }}>
                    <button onClick={() => moveSheet(r.key, -1)} disabled={rows[0]?.key === r.key} title={tr('เลื่อนไปก่อนหน้า')} style={{ ...navBtn, fontSize: 13, padding: '2px 8px' }}>◀</button>
                    <button onClick={() => moveSheet(r.key, 1)} disabled={rows[rows.length - 1]?.key === r.key} title={tr('เลื่อนไปถัดไป')} style={{ ...navBtn, fontSize: 13, padding: '2px 8px' }}>▶</button>
                  </div>
                )}
                <Sheet k={k} cw={cw} idx={sheetIdx} enter={firstViewRef.current === data?.viewKey} icon={r.icon} title={r.name} statZoom goals={(kk, zoomedCopy) => goalsRow(r, kk, zoomedCopy)} footAside
                  /* 30/09 (user): เลขใหญ่ = ค่าเดือนที่เลือก · บรรทัดรอง = YTD บอกวิธีรวม+จำนวนเดือน · ท้ายแผ่น = คาดปลายปี
                     16/11 (user): กดชิปสถานะ = เปิด popup 🔍 (insight) ไม่ใช่พาไปหน้ากรอก — ปุ่ม "กรอก/ตั้งเป้า" ท้ายแผ่นยังไปหน้ากรอกเหมือนเดิม */
                  sub={`${r.curChild ? tr('⬆ ค่ารวมจากหน่วยลูก (เดือนนี้ระดับนี้ไม่ได้กรอก)') : srcLabel(r)}${r.ytd != null
                    ? ` · YTD ${nf(cvR(r, r.ytd), decR(r))}${unitR(r) ? ' ' + unitR(r) : ''} (${r.sumApprox ? tr('≈ เฉลี่ย') : summaryShort(r.sumKind)}${r.auto && !r.fromDept && !r.sumApprox && r.sumKind !== 'sum' ? tr('ถ่วงน้ำหนัก') : ''} ${r.actualMonths} ${tr("เดือน")})`
                    : ''}${r.amtText ? ` · ${r.amtText}` : ''}`}
                  subFull={r.fxSrc ? `${r.curChild ? tr('⬆ ค่ารวมจากหน่วยลูก (เดือนนี้ระดับนี้ไม่ได้กรอก)') : srcLabel(r, { full: true })}${r.ytd != null
                    ? ` · YTD ${nf(cvR(r, r.ytd), decR(r))}${unitR(r) ? ' ' + unitR(r) : ''} (${r.sumApprox ? tr('≈ เฉลี่ย') : summaryShort(r.sumKind)} ${r.actualMonths} ${tr("เดือน")})`
                    : ''}${r.amtText ? ` · ${r.amtText}` : ''}` : null}
                  big={r.value == null ? '—' : nf(cvR(r, r.value), decR(r))}
                  unit={r.value != null ? unitR(r) : ''} bigNote={r.value != null ? `${tr("เดือน")} ${monthLabel(r.valueKey)}${r.stale ? tr(' (ล่าสุด)') : ''}${r.curDetail ? ` · ${r.curDetail}` : ''}${r.curMan != null ? ` · ✍️ ${tr("กรอกมือ")} ${nf(cvR(r, r.curMan), decR(r))}${unitR(r) ? ' ' + unitR(r) : ''}` : ''}` : ''} delta={r.delta}
                  stat={toLamp(r.st, r.note && !(r.st === ST.unknown) ? `${r.why} · ${r.note}` : r.why)}
                  /* 🧹 ท้ายแผ่น ≤ 1 บรรทัด (user 09/10 "note เยอะไป กราฟเล็กลง") — เหลือเฉพาะ (ก) คาดปลายปีที่คำนวณได้ หรือ (ข) เตือนที่ต้องเห็น
                     (ไฟเทา/ค่ากรอกมือถูกทับ/ขอบเขตโรงงานยังไม่มีนิยาม) · Target/Commit/ที่มาเต็มๆ ย้ายไป tooltip ของไฟ + popup 🔍 (`zoomFoot`) */
                  foot={(kk, zoomedCopy) => (zoomedCopy || kk > k * 1.15 ? zoomFoot(r, kk) : (forecastLine(r, kk) || cardWarn(r, kk)))}
                  /* 🧭 20/11 (user): แว่นขยาย = หน้าที่เดียวกับชิปสถานะ ⇒ ถอดออก (`zoom={false}` · popup เปิดจากชิป) · ปุ่ม "กรอก/ตั้งเป้า" ของทุกแผ่น
                     รวมเป็นปุ่มเดียวปลายแถบกรอง (`controls`) · ท้ายแผ่น = **ข้อมูลต้นทาง · <ชื่อหน้า>** เฉพาะ KPI ที่ระบบคำนวณ
                     (เดิม "เจาะดู" — ฟังเหมือนเปิด insight ทั้งที่พาไปหน้า raw data ของระบบ) */
                  zoom={false}
                  link={r.to ? tr('ข้อมูลต้นทาง') : null} linkTitle={r.to ? `${tr('เปิดข้อมูลต้นทางที่หน้า')} ${srcPageName(r.to)}` : null}
                  onLink={() => (r.to ? goTo(r.to) : onTab?.('table'))}>
                  {(kk, w, zoomedCopy) => rowChart(r, kk, w, zoomedCopy)}
                </Sheet>
                </div>
              ))}


              {/* ═══ งานที่ต้องตามแก้ — สิ่งที่ทำให้บอร์ดนี้เป็น Obeya ไม่ใช่แค่จอตัวเลข ═══ */}
              {has('todo') && (
              <Sheet k={k} cw={cw} icon="🚨" title={tr('งานที่ต้องตามแก้')}
                sub={`action ${tr("จากประชุมเช้า/ห้อง Obeya + เหตุความปลอดภัยที่ยังไม่ปิด")}${data?.actsMissing ? tr(' · ⚠ ยังไม่มีตารางติดตาม') : ''}`}
                big={todo.length ? String(overdue || todo.length) : '0'} unit={overdue ? 'รายการเกินกำหนด' : tr("รายการค้าง")}
                stat={todo.length
                  ? (overdue ? { status: 'bad', label: `${tr("เกินกำหนด")} ${overdue}`, why: `${tr("มี")} ${overdue} ${tr("รายการเลยวันครบกำหนดแล้วยังไม่ปิด")}` }
                    : { status: 'warn', label: `${tr("ค้าง")} ${todo.length}`, why: 'ยังมีงานค้างที่ยังไม่ปิด' })
                  : { status: 'none', label: 'ไม่มีงานค้าง', why: 'ไม่มี action/เหตุความปลอดภัยที่ค้างในส่วนงานนี้ — ถ้าเพิ่งเปิดใช้ ตรวจว่ามีการบันทึกจริงไหม' }}
                link={tr("ไปหน้าประชุมเช้า")} onLink={() => goTo('/morning-meeting')}>
                <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, padding: '0 4px' }}>
                  <ReadOnlyNote show={!canRecord} role={role} compact what={tr("บันทึกเหตุการณ์ความปลอดภัย")} permKey="safety:record" />
                  {!todo.length ? (
                    <div style={{ fontSize: fs(11), color: 'var(--muted)', lineHeight: 1.4, padding: 6 }}>
                      {tr("ไม่มีงานค้างในส่วนงานนี้ — ตัวเลขหลุดเป้าบนแผ่นไหน ให้ตั้ง Action ที่แท็บ 🖥️ จอ")} SQDCM
                    </div>
                  ) : todo.slice(0, 30).map((x) => {
                    const late = x.due && x.due < date;
                    return (
                      <div key={x.id} title={x.title}
                        onClick={() => (x.kind === 'safety' ? (canRecord && setShowSafety(x.ev)) : goTo(x.to))}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 'var(--r-xs)', cursor: 'pointer', background: 'var(--bg3)', borderLeft: `3px solid ${late ? 'var(--red)' : x.color}` }}>
                        <span style={{ fontSize: fs(11) }}>{x.icon}</span>
                        <span style={{ fontSize: fs(11), fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title}</span>
                        {/* ป้ายท้ายแถวห้ามกินที่ชื่อเรื่องจนหาย (UX audit 05/10: ชื่อไลน์ยาว → หัวข้อกว้าง 0) */}
                        <span style={{ fontSize: fs(10), color: late ? 'var(--red)' : 'var(--muted)', whiteSpace: 'nowrap', maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>
                          {x.warn ? `⚠ ${x.warn}` : (x.due ? `${tr("ครบ")} ${x.due}` : x.meta)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Sheet>
              )}
            </div>
            </TabBody>
          )}
        </div>
      </div>
      {/* 📖 แถบเปลี่ยนหน้า — โผล่เฉพาะตอนมีมากกว่า 1 หน้า (มีหน้าเดียวแล้วโชว์ = ขยะบนจอ) */}
      <BoardPager page={pg} count={pages.length} onPage={setPg} labels={pgLabels} compact={board} />
      {/* ⚠️ แถบเตือน "ตัวเลขเดือนนี้ยังไม่ครบ" อยู่ **ใต้บอร์ด** และกินที่สูงคงที่เสมอ (แม้ไม่มีอะไรเตือน) —
          user 30/09: "ยังไม่ครบ มาอยู่ข้างล่างดีมั้ย เพื่อไม่ให้สเกลกราฟวิ่งไปวิ่งมา" · เดิมอยู่บนหัว โผล่/หายตามเดือน ⇒ กริดสูงไม่เท่ากัน */}
      <div style={{ minHeight: 26, margin: board ? '2px 8px 4px' : '6px 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {warnLines.map((w, i) => (
          <span key={i} style={{ fontSize: tv ? 20 : 11.5, fontWeight: 700, padding: tv ? '4px 14px' : '3px 10px', borderRadius: 'var(--r-pill)', color: toneVar(err ? 'bad' : 'warn'), background: toneDim(err ? 'bad' : 'warn'), border: `1px solid ${toneLine(err ? 'bad' : 'warn')}` }}>⚠ {w}</span>
        ))}
      </div>

      {/* คำอธิบายยาว = พับหลัง ⓘ (UI §6.10 · 04/11 user "text อธิบายเยอะๆ ควรเป็น tooltip") — เดิม 3 บรรทัดใต้บอร์ดตลอดเวลา */}
      {!board && (
        <div className="tv-hide" style={{ marginTop: 8 }}>
          <InfoMore id="obeya-kpi-legend" label={tr('ที่มาของตัวเลข · ความหมายสี')} size={11}>
            {tr("ตัวเลข = สะสมเดือนที่เลือก · ⚡ ระบบคำนวณจากกะที่ปิดแล้ว (OEE ถ่วงเวลารับภาระ · PPM = ของเสีย ÷ ยอดที่ผลิตทั้งหมด (สแกนดี + เสีย) × 10⁶ ไม่รวมงานทดลอง) · ✍️ ต้องกรอกที่แท็บ ⚙️ ตั้งค่า KPI / กรอกผล · สีแท่ง/ไฟ = เกณฑ์ทางการ ถึง Target = เขียว · ถึงแค่ Commitment = เหลือง · ไม่ถึง = แดง · ไม่มีเป้าหรือไม่มีค่า = เทา (ไม่ใช่ผ่าน) · แท่ง \"สรุป")}" = {`${tr("เฉลี่ยถ่วงน้ำหนักทั้งปี (แถว ⚡) / เฉลี่ยเดือนที่กรอก (แถว")} ✍️)`} · {tr("กดแท่งเดือนเพื่อดูเดือนนั้น")}
          </InfoMore>
        </div>
      )}

      {noteFor && (
        <KpiMonthNoteModal
          title={noteFor.title} icon={noteFor.icon} monthText={`${monthLabel(noteFor.monthKey)} ${year}`} valueText={noteFor.valueText}
          notes={rows.find(x => x.key === noteFor.rowKey)?.series?.find(p => p.k === noteFor.monthKey)?.notes || []}
          canEdit={canNote}
          ctx={{ year, month: Number(noteFor.monthKey.slice(5, 7)), scopeKind: isPlant(kscope) ? 'plant' : kscope.kind, scopeValue: isPlant(kscope) ? '' : kscope.value, scopeText, rowKey: noteFor.rowKey, fullName }}
          onClose={() => setNoteFor(null)} onChanged={() => load()} />
      )}
      {showSafety && (
        <SafetyEventModal
          init={showSafety} section={secSet && secSet.size === 1 ? [...secSet][0] : ''} date={date}
          lineRows={lines.filter(l => members.names.has(l.name))} sectionOpts={scopeOpts.filter(o => o.kind === 'section').map(o => o.value)}
          onClose={() => setShowSafety(null)}
          onSaved={() => { setShowSafety(null); load(); }}
        />
      )}
    </div>
  );
}
