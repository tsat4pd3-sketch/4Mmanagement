import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { lineNameCompare } from '../utils/lineHierarchy';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from 'recharts';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';
import { fetchByIds } from '../utils/fetchByIds';
import { scoreDef, unitOf, decimalsOf, summaryModeOf, summaryShort, fmtBar, valueScopeOf, sharedValueDef, yearForecast, boardSlotOf } from '../utils/kpiSetup';
import { scopedLineNames } from '../utils/sectionScope';
import useOrgScope from '../utils/useOrgScope';
import OrgScopePicker from './OrgScopePicker';
import { PLANT, isPlant, scopeKey, parseScopeKey, scopeOfDef, scopeCovers, sameScope, filterScopeOptions, drillParams } from '../utils/orgScope';
import { canAccessPage } from '../utils/permissions';
import { useLiveBoard } from '../utils/useLiveBoard';
import { LIVE, RATE } from '../utils/refreshRates';
import { toast } from './Toast';
import PageHeader from './PageHeader';
import { OBEYA_TITLE, OBEYA_ICON } from '../utils/obeyaPage';
import ReadOnlyNote from './ReadOnlyNote';
import SafetyEventModal from './SafetyEventModal';
import KpiMonthNoteModal from './KpiMonthNoteModal';
import { tooltipProps, CELL_BAR_FILL, focusDomain, axisUnitLabel, axisUnitTop } from '../utils/chartAxis';
import { pickBoardRows, normKpiRowName } from '../utils/kpiBoardRows';
import { GAP, useSheetGrid, StatusLamp, Sheet, WarnNote, EmptyChart, FocusAxisNote } from './ObeyaSheet';
import BoardPager from './BoardPager';
import useFitHeight from '../utils/useFitHeight';
import { packPages, clampPage, pageLabels, cellsUsed } from '../utils/boardPager';
import { statusColor, gapToTarget } from '../utils/obeyaKpi';
import {
  yearOf, monthKeys, monthLabel, lastDayOf, SUMMARY_KEY,
  axisOeeYear, axisPpmYear, manualMonthSeries, monthBarScore,
} from '../utils/obeyaYear';
import { ST, worstStatus, safetyKind, isInjury, ymd } from '../utils/obeya';

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
   • **Safety**: ค่า KPI = สรุปจากหน่วยงานความปลอดภัย (กรอกมือ · user 07/09) → ไม่มีค่อยถอยไปนับ `safety_events`
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
const toLamp = (st, why) => ({ status: st === ST.unknown ? 'none' : st, label: st === ST.unknown ? (why?.startsWith('ยังไม่มี') || why?.startsWith('ยังไม่กรอก') ? 'ยังไม่มีข้อมูล' : 'ไม่มีเป้า') : LAMP_LABEL[st], why: why || '' });

export default function ObeyaKpiBoard({ tabs, tab, onTab }) {
  const navigate = useNavigate();
  const { role, lineId, sections, fullName } = useContext(UserContext);
  const { can } = usePerms();
  const canRecord = can('safety', 'record');
  const canNote = can('kpi', 'manage');           // เขียนหมายเหตุรายเดือน = คีย์เดียวกับ RLS ของ kpi_month_notes
  const [noteFor, setNoteFor] = useState(null);   // { rowKey, title, icon, monthKey, valueText }
  const [sp, setSp] = useSearchParams();

  const [lines, setLines] = useState([]);
  const { index: org, ready: orgReady } = useOrgScope(lines);   // ผังองค์กรทุกมิติ (23/09) — แทน org_nodes kind='section'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showSafety, setShowSafety] = useState(null);   // null | {} | event
  const [board, setBoard] = useState(false);            // โหมดจอ TV = ซ่อนหัวเพจ เต็มจอ (pattern เดียวกับ SQDCM)
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
    const names = scopedLineNames({ role, lineId, sections, lines });
    return names ? new Set(names) : null;
  }, [role, lineId, sections, lines]);

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
    if (known) toast.info(`ขอบเขต "${org.labelOf(scope.kind, scope.value)}" อยู่นอกสังกัดของคุณ — สลับไปดูหน่วยของคุณแทน`);
    setScope(mine || first || PLANT);
  }, [orgReady, lines.length, scope, scopeKeyStr, org, sections, scopeOpts, setScope]);

  /* ไลน์ในขอบเขตที่เลือก ∩ ขอบเขต user · ขอบเขตที่ไม่มีไลน์ผลิต (แผนกช่าง) = [] → แผ่นอัตโนมัติว่างโดยตั้งใจ */
  const lineNames = useMemo(() => {
    const inUser = lines.filter(l => !scopeSet || scopeSet.has(l.name)).map(l => l.name);
    if (!scope || isPlant(scope)) return inUser;
    const mine = new Set(org.lineNamesOf(scope.kind, scope.value));
    return inUser.filter(n => mine.has(n));
  }, [lines, scopeSet, scope, org]);
  const scopeNoLines = !!scope && !isPlant(scope) && orgReady && org.lineNamesOf(scope.kind, scope.value).length === 0;
  const members = useMemo(() => {
    const set = new Set(lineNames);
    const m = lines.filter(l => set.has(l.name));
    return {
      names: set,
      groups: [...new Set(m.map(l => l.parent_line_name || l.name))].sort(lineNameCompare),   // กลุ่มไลน์ (เป้า OEE ตั้งรายกลุ่ม)
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
  const scopeText = scope ? (isPlant(scope) ? 'ทั้งโรงงาน' : [...org.pathOf(scope.kind, scope.value), scope.value].filter((x, i, a) => a.indexOf(x) === i).join(' › ')) : '—';

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
      if (yr.error) warn.push('ผลรวมรายเดือน (OEE/PPM)');
      const roll = yr.data || {};
      // 2) กะที่ยังเปิดค้างของวันที่ดู — ตัวเลขวันนี้ยังไม่ครบ ต้องบอก
      /* `.in()` ยาวทะลุเพดาน URL = คืนว่างเงียบ (กฎเหล็ก DB ข้อ 5) → ซอยก้อนผ่าน fetchByIds แทน `slice(0, 200)` เดิม
         ที่ตัดไลน์ที่ 201+ ทิ้งเงียบๆ (05/10 · audit) */
      const op = names.length ? await fetchByIds(names, part => supabaseDR.from('production_sessions').select('id')
        .eq('work_date', date).neq('status', 'closed').in('line_name', part)) : { rows: [] };
      if (op.error || op.truncated) warn.push('กะที่เปิดค้าง');
      // 3) เป้า OEE (A×P×Q รายกรุ๊ป)
      const tg = await supabase.from('oee_targets').select('group_name, target_a, target_p, target_q');
      if (tg.error) warn.push('เป้า OEE');
      // 4) ความปลอดภัย — ทั้งหมดของส่วนงาน ≤ วันที่ดู (ใช้ทั้งนับต่อเดือน + งานค้าง)
      const sf = await supabase.from('safety_events')
        .select('*').eq('is_active', true).gte('event_date', `${year}-01-01`).lte('event_date', date)
        .order('event_date', { ascending: false }).limit(500);
      const safetyMissing = (sf.error?.code || '') === '42P01';
      if (sf.error && !safetyMissing) warn.push('เหตุการณ์ความปลอดภัย');
      const safety = (sf.data || []).filter(e => secOk(e.section));
      // 5) งานที่ต้องตามแก้จากประชุมเช้า/ห้อง Obeya — "บอร์ดที่มีแต่กราฟ ไม่มี action = ไม่ใช่ Obeya"
      const acts = await supabase.from('meeting_action_items')
        .select('id, meeting_date, section, line_name, problem, assignee, due_date, status, source')
        .in('status', ['open', 'doing']).order('due_date', { ascending: true, nullsFirst: false }).limit(60);
      const actsMissing = (acts.error?.code || '') === '42P01';
      if (acts.error && !actsMissing) warn.push('งานติดตาม');
      const actions = (acts.data || []).filter(a => secOk(a.section));
      // 6) นิยาม KPI ของปี + ค่ารายเดือน (กรอกมือ / เป้าของแถว auto)
      let kdRes = await supabase.from('kpi_definitions')
        .select('*, kpi_catalog(id, name, unit, direction, decimals, summary_mode, value_scope, board_slot)').eq('year', year).eq('is_active', true);
      if (kdRes.error && (kdRes.error.code || '') !== '42P01') {
        kdRes = await supabase.from('kpi_definitions').select('*').eq('year', year).eq('is_active', true);
      }
      const kpiMissing = (kdRes.error?.code || '') === '42P01';
      if (kdRes.error && !kpiMissing) warn.push('นิยาม KPI');
      // นิยามของ "ขอบเขตที่เลือก + บรรพบุรุษ" — นิยามระดับแม่ตกทอดถึงลูก (ตกลงรุ่นเดียวกับแท็บ ⚙️)
      const sel = parseScopeKey(scopeKeyStr);
      const kdefs = (kdRes.data || []).filter(d => scopeCovers(org, scopeOfDef(d), sel));
      let kentries = [], kplans = [];
      if (kdefs.length) {
        const ke = await fetchByIds(kdefs.map(d => d.id), part => supabase
          .from('kpi_manual_entries').select('kpi_id, month, value').in('kpi_id', part));
        if (ke.error) warn.push('ค่า KPI รายเดือน');
        kentries = ke.rows;
        /* 📅 แผนรายเดือน — ใช้คาดการณ์ปลายปี (ผลจริง + แผนที่เหลือ) · ตารางยังไม่มี = ไม่มีแผน ไม่ใช่บอร์ดล่ม */
        const kp = await fetchByIds(kdefs.map(d => d.id), part => supabase
          .from('kpi_month_plans').select('kpi_id, month, plan_value').in('kpi_id', part));
        if (kp.error && !/42P01/.test(String(kp.error))) warn.push('แผนรายเดือน');
        kplans = kp.rows || [];
      }
      /* 📝 หมายเหตุรายเดือนของขอบเขตที่ดู (remark/action/note) — ตารางยังไม่มี = ไม่มีโน้ต ไม่ใช่บอร์ดล่ม */
      const kn = await supabase.from('kpi_month_notes')
        .select('id, month, row_key, kind, text, created_by_name, created_at')
        .eq('year', year).eq('scope_kind', sel.kind || 'plant').eq('scope_value', sel.value || '').eq('is_active', true)
        .order('created_at', { ascending: true }).limit(1000);
      if (kn.error && (kn.error.code || '') !== '42P01') warn.push('หมายเหตุรายเดือน');
      const knotes = kn.data || [];
      if (seq !== reqRef.current) return;                 // มีคำขอใหม่แล้ว — ทิ้งผลเก่า
      setData({
        sessions: roll.sessions || [], defects: roll.defects || [],
        openSess: (op.rows || []).length, targets: tg.data || [],
        safety, safetyMissing, actions, actsMissing, kdefs, kentries, kplans, knotes, kpiMissing, warn,
      });
    } catch (e) {
      if (seq === reqRef.current) { setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); setData(null); }
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [lineKey, scopeKeyStr, secKey, year, date, org]);
  /* โหลดครั้งแรก + poll + realtime ผ่านตัวกลางตัวเดียว (กฎเหล็ก DB ข้อ 8 · เดิมประกอบ useEffect+usePolling เอง ไม่มี idle gate)
     ฟังแค่ production_sessions (เปิด/ปิดกะ = ตัวเลขเดือนเปลี่ยน) — prod_orders/downtime_logs ห้าม subscribe ในหน้านี้ */
  useLiveBoard(load, { tables: ['production_sessions'], topic: 'obeya-kpi', tier: LIVE.BOARD, rate: RATE.BOARD });

  /* ── แถว KPI 8 หัวข้อของกลุ่มที่เลือก — ทุกแถวมี series 12 เดือน + แท่งสรุป ──────────────────── */
  const rows = useMemo(() => {
    if (!data || !scope) return [];
    const { sessions, defects, targets, safety, kdefs, kentries, kplans, knotes } = data;
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
    /* เป้า/นิยาม = ของขอบเขตที่เลือกก่อน ไม่มีค่อยไต่ขึ้นบรรพบุรุษทีละชั้น (แผนก → ส่วนงาน → ฝ่าย → โรงงาน)
       แหล่งเดียวกับแท็บ ⚙️ ห้ามตั้งคนละที่ · `inherited` = เอามาจากระดับแม่ (จอต้องบอก) */
    const chain = [scope, ...org.ancestorsOf(scope.kind, scope.value).slice().reverse()];
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
    /* กติกาเลือกแผ่นอยู่ใน utils/kpiBoardRows.js (pure · มีเทส) — ที่นี่แค่ส่ง closure หา-นิยาม 2 ตัว */
    const { rows: boardRows } = pickBoardRows({
      templates: boardRowsFor(year), kdefs, scope, hasLines: members.groups.length > 0,
      findManual: (r) => manualOf(r.name, false, r.key), findAuto: autoDefOf,
    });
    return boardRows.map((r) => {
      const man = manualOf(r.name, false, r.key, r.defId || null);
      let series = [], def = null, unit = r.unit || man?.unit || '', note = '', fromDept = !!man?.inherited, manual = !r.auto;
      let months = 0, sumKind = 'average', sumApprox = false;

      if (r.auto === 'oee') {
        const k = axisOeeYear({ rows: gSess, year, target: { oee: oeeTarget } });
        series = k.series; months = k.months;
        def = { target_value: oeeTarget, direction: 'up' };
        note = !members.groups.length ? 'ขอบเขตนี้ไม่มีไลน์ผลิต — ไม่มี OEE ให้คำนวณ'
          : setGroups === members.groups.length && members.groups.length === 1
            ? `เป้าจากทะเบียนเป้า OEE (A${tg[members.groups[0]].target_a ?? DEFAULT_APQ.a}×P${tg[members.groups[0]].target_p ?? DEFAULT_APQ.p}×Q${tg[members.groups[0]].target_q ?? DEFAULT_APQ.q})`
            : setGroups ? `เป้าเฉลี่ย ${members.groups.length} กลุ่มไลน์ (ตั้งแล้ว ${setGroups} กลุ่ม · ที่เหลือใช้ 90×90×99)`
              : `ยังไม่ตั้งเป้า OEE ของกลุ่มในขอบเขตนี้ — ใช้ค่ามาตรฐาน 90×90×99`;
      } else if (r.auto === 'ppm') {
        const ad = autoDefOf('ppm');
        def = ad ? { ...ad } : null;
        const k = axisPpmYear({ sessions: gSess, defects: gDefs, year, target: def?.target_value ?? null, direction: def?.direction || 'down' });
        series = k.series; months = k.months;
        note = k.months ? `ของเสีย ${nf(k.ngQty)} ชิ้น (ไม่รวมงานทดลอง) · บันทึก ${nf(k.defectRows)} รายการ` : '';
      } else if (r.auto === 'safety') {
        /* ค่า KPI Safety = สรุปจากหน่วยงานความปลอดภัย (กรอกมือ · user 07/09) → ไม่มีค่อยถอยไปนับบันทึกหน้างาน
           ห้ามบวก 2 แหล่ง · ไม่มีบันทึกเลย = เทา ห้ามเขียว (0 ที่บันทึก ≠ 0 ที่เกิดจริง) */
        const manSec = manualOf(r.name, true, r.key);
        if (manSec && Object.keys(manSec.entries).length) {
          const k = manualMonthSeries({ entries: manSec.entries, year, summary: summaryModeOf(manSec.def) });
          series = k.series; months = k.months; def = manSec.def; unit = manSec.unit || r.unit;
          sumKind = k.effMode; sumApprox = k.approx;
          fromDept = true; manual = true;
          const inj = (safety || []).filter(e => ym(e.event_date) === monthKey && inEv(e) && isInjury(e)).length;
          note = `สรุปจากหน่วยงานความปลอดภัย${manSec.inherited ? ` (ค่าระดับ ${org.labelOf(manSec.at.kind, manSec.at.value)})` : ''} · หน้างานบันทึกบาดเจ็บเดือนนี้ ${inj} ครั้ง`;
        } else if ((safety || []).length) {
          const cnt = {};
          (safety || []).forEach((e) => { if (inEv(e) && isInjury(e)) cnt[ym(e.event_date)] = (cnt[ym(e.event_date)] || 0) + 1; });
          const upto = monthKeys(year).filter(k => k <= monthKey);
          series = monthKeys(year).map(k => (upto.includes(k) ? { k, v: cnt[k] || 0 } : { k, v: null, empty: true }));
          const total = upto.reduce((a, k) => a + (cnt[k] || 0), 0);
          series.push({ k: SUMMARY_KEY, v: total, summary: true, kind: 'sum' });
          months = upto.length; sumKind = 'sum';
          def = { target_value: 0, direction: 'down' };
          note = `นับจากบันทึกเหตุการณ์ความปลอดภัยหน้างาน · เป้า 0 ครั้ง${members.names.size ? ' · เหตุที่ไม่ระบุไลน์ไม่ถูกนับในขอบเขตนี้' : ' · นับตามส่วนงานที่บันทึก'}`;
        } else {
          series = monthKeys(year).map(k => ({ k, v: null, empty: true })).concat([{ k: SUMMARY_KEY, v: null, summary: true }]);
          note = 'ยังไม่มีใครบันทึกเหตุการณ์ และยังไม่กรอกสรุปจากหน่วยงานความปลอดภัย';
        }
      } else {
        /* 🔴 24/09: วิธีรวมแท่ง "สรุป" มาจาก `kpi_catalog.summary_mode` ของ KPI ตัวนั้น
           เดิมเฉลี่ยตายตัว ⇒ Scrap/Cost Reduction ที่ต้องรวมทั้งปีโชว์ค่าเฉลี่ย */
        const k = manualMonthSeries({ entries: man?.entries || {}, year, summary: summaryModeOf(man?.def) });
        series = k.series; months = k.months; def = man?.def || null;
        sumKind = k.effMode; sumApprox = k.approx;
      }

      if (man?.shared === 'ok' && !r.auto) note = note || (isPlant(scope) ? 'ค่าโรงงาน — ทุกหน่วยที่ถือ KPI นี้ใช้ตัวเลขเดียวกัน' : 'ค่าโรงงาน (ทุกหน่วยใช้ตัวเลขเดียวกัน) · กรอกที่แท็บ ⚙️ ขอบเขต ทั้งโรงงาน');
      else if (man?.shared === 'missing' && !r.auto) note = note || `KPI นี้ใช้ค่าโรงงาน แต่ยังไม่มีนิยามระดับ ทั้งโรงงาน ปี ${year} — สร้างที่แท็บ ⚙️ ขอบเขต ทั้งโรงงาน แล้วกรอกที่นั่น`;
      else if (man?.inherited && !r.auto) note = note || `ค่าระดับ ${org.labelOf(man.at.kind, man.at.value)} (ยังไม่ตั้งแยกที่ขอบเขตนี้)`;
      const cur = series.find(p => p.k === monthKey) || null;
      /* 🗓️ เดือนที่เลือกยังไม่มีค่า (KPI กรอกมือกรอกหลังปิดเดือน — วันที่ 30 ก.ย. ทั้งบอร์ดจะ "—" หมดทั้งที่ ม.ค.–ส.ค. ครบ ·
         user ทัก 30/09 "ทีมงานกรอกครบแล้ว") ⇒ ใช้ค่าเดือนล่าสุดที่มี ≤ เดือนที่เลือก แล้ว**เขียนบนจอว่าเป็นเดือนไหน** (`valueKey`/`stale`)
         ไม่ใช่เดาว่าเดือนนี้เท่าเดือนก่อน — ป้าย/เหตุผลต้องบอกว่า "ค่าล่าสุด ส.ค. · ก.ย. ยังไม่กรอก" */
      let value = cur?.v ?? null, valueKey = monthKey, stale = false;
      if (value == null) {
        const prev = series.slice(0, 12).filter(p => p.k <= monthKey && p.v != null).pop();
        if (prev) { value = prev.v; valueKey = prev.k; stale = true; }
      }
      const target = def?.target_value == null ? null : Number(def.target_value);
      const dir = def?.direction || (def?.target_compare === '<=' ? 'down' : def?.target_compare === '>=' ? 'up' : r.dir) || null;
      /* 🔴 สถานะ = เกณฑ์ทางการ 1/0.5/0 ผ่าน scoreDef เท่านั้น (17/09) — "เหลือง" = ถึง Commitment แต่ไม่ถึง Target */
      let st = ST.unknown, why = '';
      if (value == null) {
        why = r.auto && !fromDept ? (note || 'ยังไม่มีข้อมูลเดือนนี้') : (man || fromDept ? 'ยังไม่กรอกค่าเดือนนี้' : 'ยังไม่ได้ตั้ง KPI ตัวนี้ — ตั้งที่แท็บ ⚙️');
      } else if (def && (target != null || def.commit_value != null || def.commitment)) {
        const sc = scoreDef(value, def);
        st = sc.status === 'good' ? ST.good : sc.status === 'warn' ? ST.warn : sc.status === 'bad' ? ST.bad : ST.unknown;
        const cb = sc.bars.commit_value != null ? ` · Commit ${fmtBar(sc.bars.commit_compare, sc.bars.commit_value, unit)}` : '';
        why = `เทียบ Target ${fmtBar(sc.bars.target_compare, sc.bars.target_value, unit)}${cb}`;
      } else {
        why = r.auto && !fromDept ? 'ยังไม่ตั้งเป้า — ตั้งที่แท็บ ⚙️ ปุ่ม 🎯 ท้ายแถว' : 'ยังไม่ตั้งเป้า — ตั้งที่แท็บ ⚙️ ตอนแก้นิยาม KPI';
      }
      if (stale) why = `ค่าล่าสุด ${monthLabel(valueKey)} (${monthLabel(monthKey)} ยังไม่กรอก) · ${why}`;
      const ytd = series[12]?.v ?? null;
      const actualMonths = series.slice(0, 12).filter(p => p.v != null).length;
      /* 📈 คาดปลายปี = ผลจริง + แผนของเดือนที่เหลือ (30/09) — แผนอยู่ที่นิยามของขอบเขตนี้ (แถว auto = นิยาม auto:<key>)
         ไม่มีแผนครบ = บอกว่าขาดเดือนไหน ไม่เดา · ตัดสินรอด/ร่วงด้วย scoreDef เท่านั้น */
      const planDef = r.auto ? (def?.id ? def : autoDefOf(r.auto)) : man?.def;
      const fc = yearForecast({
        actual: series.slice(0, 12).map(p => p.v),
        plan: Array.from({ length: 12 }, (_, i) => planByKpi[planDef?.id]?.[i + 1] ?? null),
        def: planDef && planDef.kpi_catalog ? planDef : { kpi_catalog: { summary_mode: sumKind } },
      });
      const fcScore = fc.value != null && def && (target != null || def.commit_value != null || def.commitment) ? scoreDef(fc.value, def) : null;
      /* เส้นแผนรายเดือน + เครื่องหมายโน้ต ติดไปกับจุดกราฟ (สเกลเดียวกับผลจริง — ห้ามแกน Y 2 ข้าง) */
      const planMap = planByKpi[planDef?.id] || {};
      const notesOfRow = notesBy[r.key] || {};
      series = series.map((p, i) => (i < 12
        ? { ...p, plan: planMap[i + 1] ?? null, notes: notesOfRow[i + 1] || [], noteMark: (notesOfRow[i + 1] || []).length ? '📝' : '' }
        : p));
      const forecast = value == null && !actualMonths ? null : {
        ...fc,
        status: fcScore ? fcScore.status : null,
        canJudge: !!fcScore,
        hasTarget: !!(def && (target != null || def.commit_value != null || def.commitment)),
      };
      return {
        ...r, def, unit, dir, series, value, valueKey, stale, target, st, why, note, manual, fromDept, months, sumKind, sumApprox, ytd, actualMonths, forecast,
        commit: def?.commit_value == null ? null : Number(def.commit_value), hasPlan: Object.keys(planMap).length > 0,
        dec: decimalsOf(def),
        delta: target != null && value != null && dir ? gapToTarget(value, target, dir) : null,
        hasDef: !!def,
      };
    });
  }, [data, scope, members, year, monthKey, org]);

  /* งานค้างที่ต้องตามแก้ — action item + เหตุการณ์ความปลอดภัยที่ยังไม่ปิด · เรียง "เกินกำหนดก่อน แล้วเก่าก่อน" */
  const todo = useMemo(() => {
    if (!data) return [];
    const acts = (data.actions || []).map(a => ({
      id: `a-${a.id}`, icon: a.source === 'obeya' ? '🏛️' : '🌅', kind: 'action',
      // หัวข้อว่าง/ช่องว่างล้วน = เขียนให้รู้ว่าว่าง ห้ามปล่อยแถวไม่มีชื่อ (UX audit 05/10)
      title: (a.problem || '').trim() || '(ไม่มีหัวข้อ)',
      meta: [a.line_name, a.assignee ? `ผู้รับผิดชอบ ${a.assignee}` : 'ยังไม่ระบุผู้รับผิดชอบ'].filter(Boolean).join(' · '),
      due: a.due_date || null, color: '#3b82f6', to: a.source === 'obeya' ? '/obeya?tab=sqdcm' : '/morning-meeting',
    }));
    const sf = (data.safety || []).filter(e => e.status === 'open').map((e) => {
      const k = safetyKind(e.kind);
      return {
        id: `s-${e.id}`, icon: k.unknown ? '🦺' : k.icon, kind: 'safety', ev: e,
        /* ชนิดที่ไม่อยู่ในทะเบียน = safetyKind คืน short '?' ⇒ เดิมขึ้น "? — …" (UX audit 05/10) — เขียนเป็นคำแทน */
        title: `${k.unknown ? 'ไม่ระบุชนิด' : k.short} — ${(e.description || '').trim() || '(ไม่มีรายละเอียด)'}`,
        meta: [e.line_name, e.employee_name].filter(Boolean).join(' · ') || 'ยังไม่ปิดเคส',
        due: null, color: k.color, to: null, warn: !e.countermeasure ? 'ยังไม่ได้ลงมาตรการแก้ไข' : null,
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
  const grid = useSheetGrid(wrapRef, 10);
  const { cols, cw, ch, fit, k } = grid;

  /* ── 📖 แบ่งหน้าแทนการเลื่อน (25/09 · คำสั่ง user "ดูจบได้ในหน้าเดียว … กดเปลี่ยนหน้า") ──
     จอไหนใส่ได้กี่แผ่นก็แบ่งหน้าตามนั้น — **ห้ามบีบแผ่นให้เล็กลงเพื่อยัดให้ครบ**
     (ฟอนต์ต่ำกว่า 11px = ผิดกติกาจอ TV) · ที่ไม่พอจริงๆ ถึงถอยไปโหมดเลื่อน */
  /* ⛔ ความสูงกริด = **วัดจริงจนถึงก้นจอ** ห้ามเดา `78vh` (ของเดิมเดาไว้ รวมกับหัวเพจแล้วเกิน
     1 จอ ⇒ หน้าเลื่อนขึ้นลงได้ = อาการที่ user ทักมา 25/09)
     ⚠️ ต้องประกาศ **ก่อน** คำนวณจำนวนหน้า เพราะจำนวนหน้าขึ้นกับความสูงที่วัดได้
     `null` = ที่ไม่พอจริง (มือถือหัวเพจสูง) ⇒ ถอยไปโหมดเลื่อนแบบเดิม */
  const [fitRef, availH] = useFitHeight(12, 120);
  const fitOn = availH != null;

  /* ช่องต่อหน้า = คอลัมน์ × **แถวที่ลงจอจริง** — จอเตี้ย/จอแคบใส่ได้น้อยแถว ก็แบ่งหน้าเพิ่ม
     ห้ามบีบแผ่นให้เล็กลงเพื่อยัดลงจอ (ฟอนต์จะต่ำกว่า 11px = ผิดกติกา UI จอ TV) */
  const rowsFit = grid.fit
    ? (grid.rows || 1)
    : Math.max(1, Math.floor(((grid.bh || 0) + GAP) / ((grid.ch || 1) + GAP)));
  const perPage = Math.max(1, (grid.cols || 1) * rowsFit);
  /* ⚠️ ต้องนับ **ทุกแผ่นบนกริด** ไม่ใช่แค่แถว KPI — ท้ายบอร์ดมีแผ่นประจำอีก 2 ใบ
     (🚨 งานที่ต้องตามแก้ · เดิมมี 📌 Key Performance ด้วย — 05/10 แตกเป็นแผ่นรายตัวแล้ว) ถ้าลืมนับ พอ KPI เพิ่มจนเต็มหน้า
     2 ใบนี้จะถูกวาดทับทุกหน้า = หน้าละ 12 ช่องบนกริด 10 ช่อง ⇒ กลับไปล้นเหมือนเดิม */
  const sheetItems = useMemo(() => [
    ...rows.map((r) => ({ kind: 'kpi', key: r.key, row: r, title: r.name })),
    { kind: 'todo', key: '__todo', title: '🚨 งานที่ต้องตามแก้' },
  ], [rows]);
  const pages = useMemo(() => (fitOn ? packPages(sheetItems, perPage) : [sheetItems]),
    [sheetItems, perPage, fitOn]);
  const [pgRaw, setPg] = useState(0);
  const pg = clampPage(pgRaw, pages.length);          // เปลี่ยนขอบเขต/เดือนแล้วหน้าหาย ⇒ เด้งกลับ ห้ามจอว่าง
  const pageItems = pages[pg] || [];
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
  const setMonth = (k) => { if (k && k !== SUMMARY_KEY && k <= today.slice(0, 7)) setParam('date', monthEnd(k, today)); };
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
    if (f.value == null) {
      if (f.reason !== 'no_plan' || !f.hasTarget) return null;
      const miss = f.missing.length === 1 ? monthLabel(`${year}-${String(f.missing[0]).padStart(2, '0')}`)
        : `${monthLabel(`${year}-${String(f.missing[0]).padStart(2, '0')}`)}–${monthLabel(`${year}-${String(f.missing[f.missing.length - 1]).padStart(2, '0')}`)}`;
      return <div style={style} title={`คาดการณ์ปลายปีไม่ได้ — เดือน ${miss} ยังไม่มีทั้งผลจริงและแผน · ตั้งแผนที่แท็บ ⚙️ แถว 📅 แผน แล้วบอร์ดจะคำนวณ "ผลจริง + แผนที่เหลือ" ให้`}>📈 ปลายปี: ต้องกรอก "📅 แผนรายเดือน" {miss} ก่อน (แท็บ ⚙️)</div>;
    }
    const verdict = f.status === 'good' ? { t: '✅ คาดถึงเป้า', c: '#22c55e' }
      : f.status === 'warn' ? { t: '🟡 ถึงแค่ Commitment', c: '#f59e0b' }
      : f.status === 'bad' ? { t: '❌ คาดไม่ถึงเป้า', c: '#ef4444' } : null;
    return (
      <div style={style} title={`ผลจริง ${f.actualMonths} เดือน + แผน ${f.planMonths} เดือน รวมด้วยวิธี "${summaryShort(f.mode)}"${f.approx ? ' (โดยประมาณ — KPI นี้คิดจากยอดดิบทั้งปี แต่แผนไม่มียอดดิบ)' : ''}`}>
        📈 ปลายปี {f.approx ? '≈ ' : ''}<b style={{ color: 'var(--text2)' }}>{nf(f.value, r.dec)}{r.unit ? ' ' + r.unit : ''}</b>
        {' '}({f.planMonths ? `จริง ${f.actualMonths}+แผน ${f.planMonths} ด.` : `จริงครบ ${f.actualMonths} ด.`})
        {verdict ? <> · <b style={{ color: verdict.c }}>{verdict.t}</b></> : (f.hasTarget ? '' : ' · ไม่มีเป้า')}
      </div>
    );
  };
  /* `kk` = สเกลของแผ่นที่กำลังวาด (ปกติ = k ของกริด · ใน popup 🔍 ขยาย = ใหญ่กว่า) ⇒ ฟอนต์แกน/ป้ายโตตามแผ่น */
  const rowChart = (r, kk = k, sheetW = cw) => {
    const fs = (n) => Math.max(11, Math.round(n * kk));
    const axisTick = { fontSize: fs(9.5), fill: 'var(--muted)' };
    const chartTip = tooltipProps(fs(11));   // สี/พื้น/cursor มาตรฐาน — utils/chartAxis.js
    /* 🔢 ตัวเลขบนแท่ง (UI §กราฟ "ตัวเลขบนแท่งต้องมีเสมอ" · user 30/09 "มีตัวเลข above แต่ละแท่งจะดูง่ายขึ้นมั้ย")
       แน่นเกิน = เว้นแท่งเว้นเลข ห้ามลดฟอนต์ (แผ่นในกริดกว้าง ~300px / 13 แท่ง = ช่องละ ~20px) —
       เดือนที่เลือก + แท่งสรุป โชว์เสมอ · 📝 ต่อท้ายตัวเลข (เดิมเป็นป้ายแยก ซ้อนกันไม่ได้) */
    const slotW = Math.max(0, sheetW - 60) / 13;
    const labelW = (v) => nf(v, r.dec).length * fs(9.5) * 0.62;
    const dense = r.series.some(p => p.v != null && labelW(p.v) > slotW);
    const data = r.series.map((p, i) => {
      const show = p.v != null && (!dense || p.summary || p.k === monthKey || i % 2 === 0);
      return { ...p, label: p.summary ? 'สรุป' : String(Number(String(p.k).slice(5, 7))),
        vLabel: `${show ? nf(p.v, r.dec) : ''}${p.noteMark || ''}` };
    });
    if (!data.some(p => p.v != null)) return <EmptyChart k={kk} text={`ยังไม่มีค่าสักเดือนในปี ${year}`} />;   // เหตุผลอยู่ที่ไฟ/ท้ายแผ่นแล้ว ไม่พิมพ์ซ้ำ
    /* แกน % ตรึง 0–100 เฉพาะเมื่อค่า/เป้าอยู่ในสเกลนั้นจริง — DL+OH 1.3% บนแกน 0–100 = เส้นแบนอ่านไม่ออก (user ทัก 30/09) */
    const peak = Math.max(...data.map(p => (p.v == null ? 0 : Number(p.v))), r.target == null ? 0 : Number(r.target));
    const isPct = r.unit === '%' && peak > 25;
    /* 🎯 โฟกัส: ทุกอย่างที่วาดต้องอยู่ในช่วง (แท่ง · T · C · แผน) — เส้นเป้าหลุดนอกกราฟเงียบๆ = จอโกหก */
    const focus = yFocus ? focusDomain([...data.map(p => p.v), ...data.map(p => p.plan), r.target, r.commit], { max: r.unit === '%' ? 100 : null }) : null;
    const yDomain = focus ? focus.domain : (isPct ? [0, 100] : undefined);
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* 🔴 กติกาความซื่อสัตย์: แกนไม่เริ่ม 0 ต้องเขียนบนจอ — ตัวร่วมใน ObeyaSheet (SQDCM %Q ใช้ตัวเดียวกัน) */}
      {focus && <FocusAxisNote k={kk} loText={nf(focus.domain[0], r.dec)} />}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: r.unit ? axisUnitTop(fs(9.5), fs(6)) : fs(12), right: 6, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} interval={0} />
          {/* 📏 หน่วยของแกน Y ต้องเขียนบนกราฟ (30/09 · user: "unit มันไม่มีบอก บาท/%/hrs") — ป้ายเหนือแกน ไม่ใช่ต่อท้ายทุก tick (8kPPM อ่านยาก) */}
          <YAxis domain={yDomain} ticks={focus ? focus.ticks : undefined} allowDataOverflow={!!focus} tick={axisTick} width="auto"
            tickFormatter={v => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)}
            label={axisUnitLabel(r.unit, { fontSize: fs(9.5), lift: fs(6) })} />
          <Tooltip {...chartTip} formatter={(v, name) => [`${nf(v, r.dec)}${r.unit ? ' ' + r.unit : ''}`, name === 'plan' ? '📅 แผน' : r.name]}
            labelFormatter={(l, pl) => (pl?.[0]?.payload?.summary
              ? `สรุปปี ${year} (${r.sumKind === 'sum' ? 'รวม' : 'เฉลี่ย'}${r.auto && !r.fromDept ? 'ถ่วงน้ำหนัก' : ''}ทั้งปี)`
              : `${monthLabel(pl?.[0]?.payload?.k || '')} ${year}${pl?.[0]?.payload?.notes?.length ? ` · 📝 ${pl[0].payload.notes.length} หมายเหตุ` : ''} · กดเพื่อดูเดือนนี้ + หมายเหตุ`)} />
          {/* เส้นเป้า (แดง) + เส้น Commitment (เหลือง) — user 30/09: "มาแต่เส้น target เส้น commitment ไม่เห็น" */}
          {r.target != null && <ReferenceLine y={r.target} stroke="#ef4444" strokeDasharray="4 3" label={{ value: 'T', position: 'insideTopRight', fontSize: fs(9), fill: '#ef4444' }} />}
          {r.commit != null && r.commit !== r.target && <ReferenceLine y={r.commit} stroke="#f59e0b" strokeDasharray="2 3" label={{ value: 'C', position: 'insideTopRight', fontSize: fs(9), fill: '#f59e0b' }} />}
          {/* fill = สีตัวหนังสือใน tooltip เท่านั้น (Cell ทับสีแท่งจริง) — ไม่ใส่ = Recharts ใช้ #000 (user 30/09 "text ดำ") */}
          <Bar dataKey="v" fill={CELL_BAR_FILL} radius={[2, 2, 0, 0]} onClick={(d) => openMonth(r, d?.payload ?? d)}>
            <LabelList dataKey="vLabel" position="top" style={{ fontSize: fs(9.5), fontWeight: 700, fill: 'var(--text)' }} />
            {data.map((p, i) => (
              <Cell key={i} fill={statusColor(r.def ? monthBarScore(p, r.def) : 'none')}
                fillOpacity={p.summary ? 0.55 : (p.k === monthKey ? 1 : 0.8)}
                stroke={p.summary ? 'var(--text2)' : (p.k === monthKey ? 'var(--text)' : 'none')}
                strokeDasharray={p.summary ? '3 2' : undefined} cursor={p.summary ? 'default' : 'pointer'} />
            ))}
          </Bar>
          {/* 📅 เส้นแผนรายเดือน — KPI แบบสะสมเทียบเป้าทั้งปีตั้งแต่ต้นปีจะดู "ตกตลอด" ต้องเทียบแผนของเดือนนั้น (user 30/09) */}
          {r.hasPlan && <Line type="monotone" dataKey="plan" stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="5 3" dot={{ r: 2, fill: '#38bdf8' }} connectNulls isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    );
  };
  /* กดแท่งเดือน = เลือกเดือนบนบอร์ด + เปิดหมายเหตุของเดือนนั้น (แท่ง "สรุป" = ไม่มีโน้ต) */
  const openMonth = (r, p) => {
    const k = p?.k;
    if (!k || k === SUMMARY_KEY) return;
    setMonth(k);
    setNoteFor({ rowKey: r.key, title: r.name, icon: r.icon, monthKey: k, valueText: p?.v == null ? '—' : `${nf(p.v, r.dec)}${r.unit ? ' ' + r.unit : ''}` });
  };

  /* ── หัวแผ่นสรุป ── */
  const monthText = `${monthLabel(monthKey)} ${year}`;
  const shell = board
    /* zIndex ต้องสูงกว่ารางเมนู (App.jsx rail = 1000) — เดิม 800 ⇒ รางทับบอร์ดโหมดจอไป ~60px ซ้าย (user ส่งรูป 30/09) · ต่ำกว่าโมดัล 1100+ */
    ? { position: 'fixed', inset: 0, zIndex: 1010, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }
    : { display: 'flex', flexDirection: 'column' };
  const pill = (active) => ({
    fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
    background: active ? 'var(--accent)' : 'var(--bg3)', color: active ? 'var(--accent-ink)' : 'var(--text)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
  });
  const navBtn = { fontSize: 12, fontWeight: 800, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' };
  const overallLamp = toLamp(overall.st, `ประเมินได้ ${overall.known}/${overall.total} ช่อง`);
  const rowsUsed = Math.max(1, Math.ceil(cellsUsed(pageItems) / (cols || 1)));
  const sheetsBox = {
    display: 'grid', gap: GAP, alignContent: 'start', justifyContent: 'center',
    gridTemplateColumns: cw ? `repeat(${cols}, ${cw}px)` : `repeat(${cols}, 1fr)`,
    /* แถวของ "หน้านี้" เท่านั้น แล้วยืดเต็มกล่อง — หน้าสุดท้ายที่มีแผ่นไม่ครบแถวจะได้ไม่เหลือ
       ที่ว่างเป็นแถบใหญ่ใต้บอร์ด (เห็นชัดตอนแบ่งหน้าบนจอเตี้ย) · จอที่เต็มพอดีได้ผลเท่าเดิมเป๊ะ */
    gridTemplateRows: `repeat(${rowsUsed}, minmax(0, 1fr))`,
    height: '100%',
  };
  const warnLines = [
    data?.warn?.length ? `ตัวเลขบางส่วนโหลดไม่ครบ: ${data.warn.join(' · ')}` : null,
    data?.kpiMissing ? 'ยังไม่ได้ apply migration ตาราง KPI — แถว ✍️ ทั้งหมดจะว่างจนกว่าจะ apply (แจ้ง admin)' : null,
    data?.openSess && monthKey === today.slice(0, 7) ? `วันนี้ยังมี ${data.openSess} กะที่ยังไม่ปิด — ตัวเลขเดือนนี้ยังไม่ครบ` : null,
    scopeNoLines ? `${scopeText} ไม่มีไลน์ผลิตในผัง — ไม่มีแผ่น OEE/PPM ให้ (ตัวเลขเกิดจากกะผลิต) · แผ่นที่เห็น = KPI กรอกมือที่ตั้งไว้ที่แท็บ ⚙️` : null,
    err ? `โหลดไม่สำเร็จ: ${err}` : null,
  ].filter(Boolean);

  const controls = (
    <>
      {/* ขอบเขต = ผังองค์กรทุกมิติ (23/09) — 1 บอร์ดต่อ 1 ขอบเขต (ฝ่าย/ส่วนงาน/แผนก/กลุ่มไลน์/ไลน์/CC) · ชิป = เจาะลง/กลับขึ้นหนึ่งชั้น */}
      <OrgScopePicker index={org} value={scope || PLANT} onChange={setScope} scopeSet={scopeSet} sections={sections}
        width={230} title="เลือกขอบเขตตามผังองค์กร" />
      {parentScope && <button onClick={() => setScope(parentScope)} style={pill(false)} title={`กลับขึ้น ${org.labelOf(parentScope.kind, parentScope.value)}`}>↑</button>}
      {childChips.map(c => (
        <button key={c.key} onClick={() => setScope({ kind: c.kind, value: c.value })} style={pill(false)} title={`เจาะ ${org.labelOf(c.kind, c.value)}`}>{c.label}</button>
      ))}
      <span className="sep" />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <button onClick={() => shiftMonth(-1)} title="เดือนก่อน" style={navBtn}>◀</button>
        <b style={{ fontSize: 13, minWidth: 92, textAlign: 'center' }}>{monthText}</b>
        <button onClick={() => shiftMonth(1)} disabled={monthKey >= today.slice(0, 7)} title="เดือนถัดไป" style={navBtn}>▶</button>
      </span>
      <span className="sep" />
      {/* 🎯 โฟกัสช่วงค่า — ยกพื้นแกน Y ให้เห็น gap T/C (แกนไม่เริ่ม 0 ⇒ แผ่นเขียนบอกเอง) */}
      <button onClick={() => setParam('yfocus', yFocus ? '' : '1')} style={pill(yFocus)} aria-pressed={yFocus}
        title={yFocus ? 'กำลังโฟกัสช่วงค่า: แกน Y เริ่มใกล้ค่าต่ำสุด ให้เห็นระยะห่าง Target/Commitment ชัด · กดเพื่อกลับแกนเริ่ม 0'
          : 'โฟกัสช่วงค่า: ตัดที่ว่างใต้กราฟ ยกพื้นแกน Y ขึ้นใกล้ค่าต่ำสุด ให้เห็นระยะห่าง Target/Commitment ชัดขึ้น (แผ่นจะเขียนบอกว่าแกนไม่เริ่ม 0)'}>
        🎯 {yFocus ? 'โฟกัสช่วงค่า' : 'แกนเริ่ม 0'}
      </button>
    </>
  );

  return (
    <div style={shell}>
      {!board && (
        <PageHeader
          tabs={tabs} tab={tab} onTab={onTab}
          title={OBEYA_TITLE} icon={OBEYA_ICON}
          sub={`KPI ที่ตั้งไว้ของ ${scopeText}${members.ccs.length && members.ccs.length <= 3 ? ` (cost ${members.ccs.join(' · ')})` : ''} · ${monthText} · ประเมินได้ ${overall.known}/${overall.total} ช่อง`}
          filters={controls}
          actions={(
            <>
              {canRecord && (
                <button onClick={() => setShowSafety({})} style={{ ...pill(false), background: 'var(--accent2)', color: '#1a1206', border: 'none' }}>
                  ＋ บันทึกเหตุการณ์ความปลอดภัย
                </button>
              )}
              <button onClick={() => goBoard(true)} style={pill(false)}>📺 โหมดจอ TV</button>
            </>
          )}
        />
      )}
      {board && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', flexShrink: 0, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>📋 OBEYA · {scope ? org.labelOf(scope.kind, scope.value) : '—'}</div>
          {controls}
          <StatusLamp k={1} w={999} stat={overallLamp} />
          <div style={{ flex: 1 }} />
          <button onClick={() => goBoard(false)} style={pill(false)}>ออกจากโหมดจอ</button>
        </div>
      )}


      {/* ⚠️ กล่องนอก = padding · กล่องใน (wrapRef) = ที่ถูกวัด ห้ามมี padding (clientHeight รวม padding → แถวล่างโดนตัด) */}
      <div ref={fitRef} style={{ display: 'flex', minHeight: 0, flex: board ? 1 : 'none',
        height: board ? undefined : (fitOn ? `${availH}px` : undefined), padding: board ? 8 : 0 }}>
        {/* 🔴 `clip` เมื่อคุมความสูงได้ — แผ่นที่ลงไม่พอไปหน้าถัดไป ห้ามเลื่อน (คำสั่ง user 25/09)
            ที่ไม่พอจริง (มือถือหัวเพจสูง) = ถอยไป `auto` ยอมให้เลื่อน ดีกว่าตัดเนื้อหาหาย */}
        <div ref={wrapRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: fitOn ? 'clip' : 'auto' }}>
          {loading && !data ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลดข้อมูล…</div>
          ) : !scope ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังเลือกขอบเขตเริ่มต้น…</div>
          ) : (
            <div style={sheetsBox}>
              {pageItems.filter((x) => x.kind === 'kpi').map(({ row: r }) => (
                <Sheet key={r.key} k={k} cw={cw} icon={r.icon} title={r.name}
                  /* 30/09 (user): เลขใหญ่ = ค่าเดือนที่เลือก · บรรทัดรอง = YTD บอกวิธีรวม+จำนวนเดือน · ท้ายแผ่น = คาดปลายปี */
                  sub={`${r.manual ? '✍️ กรอกมือ' : '⚡ ระบบคำนวณ'}${r.ytd != null
                    ? ` · YTD ${nf(r.ytd, r.dec)}${r.unit ? ' ' + r.unit : ''} (${r.sumApprox ? '≈ เฉลี่ย' : summaryShort(r.sumKind)}${r.auto && !r.fromDept && r.sumKind !== 'sum' ? 'ถ่วงน้ำหนัก' : ''} ${r.actualMonths} เดือน)`
                    : ''}`}
                  big={r.value == null ? '—' : nf(r.value, r.dec)}
                  unit={r.value != null ? r.unit : ''} bigNote={r.value != null ? `เดือน ${monthLabel(r.valueKey)}${r.stale ? ' (ล่าสุด)' : ''}` : ''} delta={r.delta}
                  stat={toLamp(r.st, r.why)}
                  foot={(kk) => <>
                    {forecastLine(r, kk)}
                    {r.note && (r.st === ST.unknown || r.fromDept || r.auto)
                      ? <WarnNote k={kk} text={r.note} tone={r.st === ST.unknown ? '#f59e0b' : '#94a3b8'} />
                      : r.why}
                  </>}
                  link={r.to ? 'เจาะดู' : (r.manual ? 'กรอก/ตั้งเป้า' : null)}
                  onLink={() => (r.to ? goTo(r.to) : onTab?.('table'))}>
                  {(kk, w) => rowChart(r, kk, w)}
                </Sheet>
              ))}


              {/* ═══ งานที่ต้องตามแก้ — สิ่งที่ทำให้บอร์ดนี้เป็น Obeya ไม่ใช่แค่จอตัวเลข ═══ */}
              {has('todo') && (
              <Sheet k={k} cw={cw} icon="🚨" title="งานที่ต้องตามแก้"
                sub={`action จากประชุมเช้า/ห้อง Obeya + เหตุความปลอดภัยที่ยังไม่ปิด${data?.actsMissing ? ' · ⚠ ยังไม่มีตารางติดตาม' : ''}`}
                big={todo.length ? String(overdue || todo.length) : '0'} unit={overdue ? 'รายการเกินกำหนด' : 'รายการค้าง'}
                stat={todo.length
                  ? (overdue ? { status: 'bad', label: `เกินกำหนด ${overdue}`, why: `มี ${overdue} รายการเลยวันครบกำหนดแล้วยังไม่ปิด` }
                    : { status: 'warn', label: `ค้าง ${todo.length}`, why: 'ยังมีงานค้างที่ยังไม่ปิด' })
                  : { status: 'none', label: 'ไม่มีงานค้าง', why: 'ไม่มี action/เหตุความปลอดภัยที่ค้างในส่วนงานนี้ — ถ้าเพิ่งเปิดใช้ ตรวจว่ามีการบันทึกจริงไหม' }}
                link="ไปหน้าประชุมเช้า" onLink={() => goTo('/morning-meeting')}>
                <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, padding: '0 4px' }}>
                  <ReadOnlyNote show={!canRecord} role={role} compact what="บันทึกเหตุการณ์ความปลอดภัย" permKey="safety:record" />
                  {!todo.length ? (
                    <div style={{ fontSize: fs(11), color: 'var(--muted)', lineHeight: 1.4, padding: 6 }}>
                      ไม่มีงานค้างในส่วนงานนี้ — ตัวเลขหลุดเป้าบนแผ่นไหน ให้ตั้ง Action ที่แท็บ 🖥️ จอ SQDCM
                    </div>
                  ) : todo.slice(0, 30).map((x) => {
                    const late = x.due && x.due < date;
                    return (
                      <div key={x.id} title={x.title}
                        onClick={() => (x.kind === 'safety' ? (canRecord && setShowSafety(x.ev)) : goTo(x.to))}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 4, cursor: 'pointer', background: 'var(--bg3)', borderLeft: `3px solid ${late ? '#ef4444' : x.color}` }}>
                        <span style={{ fontSize: fs(11) }}>{x.icon}</span>
                        <span style={{ fontSize: fs(11), fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title}</span>
                        {/* ป้ายท้ายแถวห้ามกินที่ชื่อเรื่องจนหาย (UX audit 05/10: ชื่อไลน์ยาว → หัวข้อกว้าง 0) */}
                        <span style={{ fontSize: fs(10), color: late ? '#ef4444' : 'var(--muted)', whiteSpace: 'nowrap', maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>
                          {x.warn ? `⚠ ${x.warn}` : (x.due ? `ครบ ${x.due}` : x.meta)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Sheet>
              )}
            </div>
          )}
        </div>
      </div>
      {/* 📖 แถบเปลี่ยนหน้า — โผล่เฉพาะตอนมีมากกว่า 1 หน้า (มีหน้าเดียวแล้วโชว์ = ขยะบนจอ) */}
      <BoardPager page={pg} count={pages.length} onPage={setPg} labels={pgLabels} compact={board} />
      {/* ⚠️ แถบเตือน "ตัวเลขเดือนนี้ยังไม่ครบ" อยู่ **ใต้บอร์ด** และกินที่สูงคงที่เสมอ (แม้ไม่มีอะไรเตือน) —
          user 30/09: "ยังไม่ครบ มาอยู่ข้างล่างดีมั้ย เพื่อไม่ให้สเกลกราฟวิ่งไปวิ่งมา" · เดิมอยู่บนหัว โผล่/หายตามเดือน ⇒ กริดสูงไม่เท่ากัน */}
      <div style={{ minHeight: 26, margin: board ? '2px 8px 4px' : '6px 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {warnLines.map((w, i) => (
          <span key={i} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, color: err ? '#ef4444' : '#f59e0b', background: `${err ? '#ef4444' : '#f59e0b'}1a`, border: `1px solid ${err ? '#ef4444' : '#f59e0b'}55` }}>⚠ {w}</span>
        ))}
      </div>

      {!board && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
          ตัวเลข = สะสมเดือนที่เลือก · ⚡ ระบบคำนวณจากกะที่ปิดแล้ว (OEE ถ่วงเวลารับภาระ · PPM = ของเสีย ÷ ยอดที่ผลิตทั้งหมด (สแกนดี + เสีย) × 10⁶ ไม่รวมงานทดลอง)
          · ✍️ ต้องกรอกที่แท็บ ⚙️ ตั้งค่า KPI / กรอกผล · สีแท่ง/ไฟ = เกณฑ์ทางการ ถึง Target = เขียว · ถึงแค่ Commitment = เหลือง · ไม่ถึง = แดง · ไม่มีเป้าหรือไม่มีค่า = เทา (ไม่ใช่ผ่าน)
          · แท่ง "สรุป" = {`เฉลี่ยถ่วงน้ำหนักทั้งปี (แถว ⚡) / เฉลี่ยเดือนที่กรอก (แถว ✍️)`} · กดแท่งเดือนเพื่อดูเดือนนั้น
        </div>
      )}

      {noteFor && (
        <KpiMonthNoteModal
          title={noteFor.title} icon={noteFor.icon} monthText={`${monthLabel(noteFor.monthKey)} ${year}`} valueText={noteFor.valueText}
          notes={rows.find(x => x.key === noteFor.rowKey)?.series?.find(p => p.k === noteFor.monthKey)?.notes || []}
          canEdit={canNote}
          ctx={{ year, month: Number(noteFor.monthKey.slice(5, 7)), scopeKind: isPlant(scope) ? 'plant' : scope.kind, scopeValue: isPlant(scope) ? '' : scope.value, scopeText, rowKey: noteFor.rowKey, fullName }}
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
