import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';
import { fetchByIds } from '../utils/fetchByIds';
import { scoreDef, fmtBar } from '../utils/kpiSetup';
import { scopedLineNames } from '../utils/sectionScope';
import useOrgScope from '../utils/useOrgScope';
import OrgScopePicker from './OrgScopePicker';
import { PLANT, isPlant, scopeKey, parseScopeKey, scopeOfDef, scopeCovers, sameScope, filterScopeOptions } from '../utils/orgScope';
import { canAccessPage } from '../utils/permissions';
import usePolling from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import PageHeader from './PageHeader';
import ReadOnlyNote from './ReadOnlyNote';
import SafetyEventModal from './SafetyEventModal';
import { GAP, useSheetGrid, StatusLamp, Sheet, WarnNote, EmptyChart } from './ObeyaSheet';
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
     แถวบน  : 5 แผ่นแรกของ 8 หัวข้อ · แถวล่าง: อีก 3 หัวข้อ + 📌 Key Performance ส่วนงาน + 🚨 งานที่ต้องตามแก้
     แต่ละแผ่น = ตัวเลขใหญ่ (เดือนที่เลือก) · ไฟสถานะตามเกณฑ์ทางการ 1/0.5/0 · **กราฟ 12 เดือน + แท่ง "สรุป"**
     (ทิศทางเดียวกับโหมดปีของจอ SQDCM) · กดแท่งเดือน = สลับบอร์ดไปเดือนนั้น
   · "คอลัมน์ = กลุ่มไลน์" ของกระดาษเดิม กลายเป็น **ขอบเขต 1 ใบต่อ 1 บอร์ด** — 23/09 ขยายเป็น
     `<OrgScopePicker>` ทุกมิติของผัง (ฝ่าย/ส่วนงาน/แผนก/กลุ่มไลน์/ไลน์/CC · `src/utils/orgScope.js`)
     + ชิปเจาะลง/กลับขึ้นหนึ่งชั้น · deep-link: `?scope=department:HYDROFORM&date=…` (ยังรับ `?section=&group=` เก่า)
     · นิยาม/เป้าไต่จากขอบเขตที่เลือกขึ้นบรรพบุรุษ (แผนก→ส่วนงาน→ฝ่าย→โรงงาน) แล้วบอกว่าเอามาจากชั้นไหน
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
   • egress: usePolling(RATE.BOARD) — แท็บซ่อน = หยุดยิง · ห้าม subscribe realtime prod_orders/downtime_logs
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
  { key: 'ppm',   name: 'PPM',                   icon: '🎯', auto: 'ppm',    unit: 'PPM', dir: 'down', to: '/oee-analytics?tab=lean' },
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
const normName = x => String(x ?? '').toLowerCase().replace(/[\s\-_./()]+/g, '');
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
  const { role, lineId, sections } = useContext(UserContext);
  const { can } = usePerms();
  const canRecord = can('safety', 'record');
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
    supabase.from('production_lines').select('id, name, section, parent_line_name, cost_center, is_active')
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
    if (scope && (isPlant(scope) || org.has(scope.kind, scope.value))) return;
    const mine = (sections || []).map(x => scopeOpts.find(o => o.kind === 'section' && o.value === x)).find(Boolean);
    const first = scopeOpts.find(o => o.kind === 'section');
    setScope(mine || first || PLANT);
  }, [orgReady, lines.length, scope, org, sections, scopeOpts, setScope]);

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
      groups: [...new Set(m.map(l => l.parent_line_name || l.name))].sort(),   // กลุ่มไลน์ (เป้า OEE ตั้งรายกลุ่ม)
      ccs: [...new Set(m.filter(l => l.cost_center).map(l => l.cost_center))].sort(),
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
      const op = names.length ? await supabaseDR.from('production_sessions').select('id')
        .eq('work_date', date).neq('status', 'closed').in('line_name', names.slice(0, 200)) : { data: [] };
      if (op.error) warn.push('กะที่เปิดค้าง');
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
        .select('*, kpi_catalog(name, unit, direction)').eq('year', year).eq('is_active', true);
      if (kdRes.error && (kdRes.error.code || '') !== '42P01') {
        kdRes = await supabase.from('kpi_definitions').select('*').eq('year', year).eq('is_active', true);
      }
      const kpiMissing = (kdRes.error?.code || '') === '42P01';
      if (kdRes.error && !kpiMissing) warn.push('นิยาม KPI');
      // นิยามของ "ขอบเขตที่เลือก + บรรพบุรุษ" — นิยามระดับแม่ตกทอดถึงลูก (ตกลงรุ่นเดียวกับแท็บ ⚙️)
      const sel = parseScopeKey(scopeKeyStr);
      const kdefs = (kdRes.data || []).filter(d => scopeCovers(org, scopeOfDef(d), sel));
      let kentries = [];
      if (kdefs.length) {
        const ke = await fetchByIds(kdefs.map(d => d.id), part => supabase
          .from('kpi_manual_entries').select('kpi_id, month, value').in('kpi_id', part));
        if (ke.error) warn.push('ค่า KPI รายเดือน');
        kentries = ke.rows;
      }
      if (seq !== reqRef.current) return;                 // มีคำขอใหม่แล้ว — ทิ้งผลเก่า
      setData({
        sessions: roll.sessions || [], defects: roll.defects || [],
        openSess: (op.data || []).length, targets: tg.data || [],
        safety, safetyMissing, actions, actsMissing, kdefs, kentries, kpiMissing, warn,
      });
    } catch (e) {
      if (seq === reqRef.current) { setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); setData(null); }
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [lineKey, scopeKeyStr, secKey, year, date, org]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, RATE.BOARD);

  /* ── แถว KPI 8 หัวข้อของกลุ่มที่เลือก — ทุกแถวมี series 12 เดือน + แท่งสรุป ──────────────────── */
  const rows = useMemo(() => {
    if (!data || !scope) return [];
    const { sessions, defects, targets, safety, kdefs, kentries } = data;
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
        const hit = { def: d, entries: entByKpi[d.id] || {}, unit: d.kpi_catalog?.unit || '', inherited: !sameScope(sc, scope), at: sc };
        if (!needEntries || Object.keys(hit.entries).length) return hit;
        firstHit = firstHit || hit;
      }
      return firstHit;
    };
    const autoDefOf = (k) => nearest(d => d.source === `auto:${k}`)?.def || null;
    const manualOf = (rowName, needEntries = false) => {
      const nn = normName(rowName);
      return nearest(x => !String(x.source || '').startsWith('auto:') && normName(x.kpi_catalog?.name || x.name) === nn, needEntries);
    };
    /* เป้า OEE = A×P×Q รายกลุ่ม (oee_targets) — ขอบเขตครอบหลายกลุ่ม = เฉลี่ยของกลุ่ม (กติกาเดียวกับ /oee-analytics ระดับ section) */
    const tg = Object.fromEntries((targets || []).map(t => [t.group_name, t]));
    const apq = (t) => ((Number(t?.target_a) || DEFAULT_APQ.a) * (Number(t?.target_p) || DEFAULT_APQ.p) * (Number(t?.target_q) || DEFAULT_APQ.q)) / 10000;
    const grpTargets = members.groups.map(g => tg[g] || null);
    const setGroups = grpTargets.filter(Boolean).length;
    const oeeTarget = Math.round((grpTargets.length ? grpTargets.reduce((a, t) => a + apq(t), 0) / grpTargets.length : apq(null)) * 10) / 10;
    const inEv = (e) => (members.names.size ? (e.line_name && members.names.has(e.line_name)) : true);

    return boardRowsFor(year).map((r) => {
      const man = manualOf(r.name);
      let series = [], def = null, unit = r.unit || man?.unit || '', note = '', fromDept = !!man?.inherited, manual = !r.auto;
      let months = 0, sumKind = 'avg';

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
        const manSec = manualOf(r.name, true);
        if (manSec && Object.keys(manSec.entries).length) {
          const k = manualMonthSeries({ entries: manSec.entries, year });
          series = k.series; months = k.months; def = manSec.def; unit = manSec.unit || r.unit;
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
          note = `นับจากบันทึกหน้างาน (safety_events) · เป้า 0 ครั้ง${members.names.size ? ' · เหตุที่ไม่ระบุไลน์ไม่ถูกนับในขอบเขตนี้' : ' · นับตามส่วนงานที่บันทึก'}`;
        } else {
          series = monthKeys(year).map(k => ({ k, v: null, empty: true })).concat([{ k: SUMMARY_KEY, v: null, summary: true }]);
          note = 'ยังไม่มีใครบันทึกเหตุการณ์ และยังไม่กรอกสรุปจากหน่วยงานความปลอดภัย';
        }
      } else {
        const k = manualMonthSeries({ entries: man?.entries || {}, year });
        series = k.series; months = k.months; def = man?.def || null;
      }

      if (man?.inherited && !r.auto) note = note || `ค่าระดับ ${org.labelOf(man.at.kind, man.at.value)} (ยังไม่ตั้งแยกที่ขอบเขตนี้)`;
      const cur = series.find(p => p.k === monthKey) || null;
      const value = cur?.v ?? null;
      const target = def?.target_value == null ? null : Number(def.target_value);
      const dir = def?.direction || (def?.target_compare === '<=' ? 'down' : def?.target_compare === '>=' ? 'up' : r.dir) || null;
      /* 🔴 สถานะ = เกณฑ์ทางการ 1/0.5/0 ผ่าน scoreDef เท่านั้น (17/09) — "เหลือง" = ถึง Commitment แต่ไม่ถึง Target */
      let st = ST.unknown, why = '';
      if (value == null) {
        why = r.auto && !fromDept ? (note || 'ยังไม่มีข้อมูลเดือนนี้') : (man || fromDept ? 'ยังไม่กรอกค่าเดือนนี้' : 'ยังไม่ได้ตั้ง KPI ตัวนี้ — ตั้งที่แท็บ 📑');
      } else if (def && (target != null || def.commit_value != null || def.commitment)) {
        const sc = scoreDef(value, def);
        st = sc.status === 'good' ? ST.good : sc.status === 'warn' ? ST.warn : sc.status === 'bad' ? ST.bad : ST.unknown;
        const cb = sc.bars.commit_value != null ? ` · Commit ${fmtBar(sc.bars.commit_compare, sc.bars.commit_value, unit)}` : '';
        why = `เทียบ Target ${fmtBar(sc.bars.target_compare, sc.bars.target_value, unit)}${cb}`;
      } else {
        why = r.auto && !fromDept ? 'ยังไม่ตั้งเป้า — ตั้งที่แท็บ 📑 ปุ่ม 🎯 ท้ายแถว' : 'ยังไม่ตั้งเป้า — ตั้งที่แท็บ 📑 ตอนแก้นิยาม KPI';
      }
      const ytd = series[12]?.v ?? null;
      return {
        ...r, def, unit, dir, series, value, target, st, why, note, manual, fromDept, months, sumKind, ytd,
        delta: target != null && value != null && dir ? gapToTarget(value, target, dir) : null,
        hasDef: !!def,
      };
    });
  }, [data, scope, members, year, monthKey, org]);

  /* แผง Key Performance = นิยาม KPI ของขอบเขตที่เลือกเป๊ะ (ไม่ใช่แถว auto · ไม่ซ้ำ 8 หัวข้อบนแผ่นหลัก)
     — ใบ KPI ของหน่วยงานสนับสนุน (JIG MTN: MTBF/MTTR/PM) โผล่ที่นี่ทั้งใบ */
  const secRows = useMemo(() => {
    if (!data || !scope) return [];
    const entByKpi = {};
    (data.kentries || []).forEach(e => (entByKpi[e.kpi_id] = entByKpi[e.kpi_id] || {})[e.month] = e.value);
    const mainNames = new Set(boardRowsFor(year).map(r => normName(r.name)));
    return (data.kdefs || [])
      .filter(d => sameScope(scopeOfDef(d), scope) && !String(d.source || '').startsWith('auto:')
        && !mainNames.has(normName(d.kpi_catalog?.name || d.name)))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map((d) => {
        const v = entByKpi[d.id]?.[monthNo];
        const value = v == null ? null : Number(v);
        let st = ST.unknown, why = '';
        if (value == null) why = 'ยังไม่กรอกค่าเดือนนี้';
        else {
          const sc = scoreDef(value, d);
          st = sc.status === 'good' ? ST.good : sc.status === 'warn' ? ST.warn : sc.status === 'bad' ? ST.bad : ST.unknown;
          why = st === ST.unknown ? 'ยังไม่ตั้งเป้า — ตั้งได้ที่แท็บ 📑' : `เทียบ Target ${fmtBar(sc.bars.target_compare, sc.bars.target_value)}`;
        }
        return { id: d.id, name: d.kpi_catalog?.name || d.name || '(ไม่มีชื่อ)', unit: d.kpi_catalog?.unit || '', value, st, why };
      });
  }, [data, monthNo, scope, year]);

  /* งานค้างที่ต้องตามแก้ — action item + เหตุการณ์ความปลอดภัยที่ยังไม่ปิด · เรียง "เกินกำหนดก่อน แล้วเก่าก่อน" */
  const todo = useMemo(() => {
    if (!data) return [];
    const acts = (data.actions || []).map(a => ({
      id: `a-${a.id}`, icon: a.source === 'obeya' ? '🏛️' : '🌅', kind: 'action',
      title: a.problem || '(ไม่ได้ระบุปัญหา)',
      meta: [a.line_name, a.assignee ? `ผู้รับผิดชอบ ${a.assignee}` : 'ยังไม่ระบุผู้รับผิดชอบ'].filter(Boolean).join(' · '),
      due: a.due_date || null, color: '#3b82f6', to: a.source === 'obeya' ? '/obeya?tab=sqdcm' : '/morning-meeting',
    }));
    const sf = (data.safety || []).filter(e => e.status === 'open').map((e) => {
      const k = safetyKind(e.kind);
      return {
        id: `s-${e.id}`, icon: k.icon, kind: 'safety', ev: e,
        title: `${k.short} — ${e.description}`,
        meta: [e.line_name, e.employee_name].filter(Boolean).join(' · ') || 'ยังไม่ปิดเคส',
        due: null, color: k.color, to: null, warn: !e.countermeasure ? 'ยังไม่ได้ลงมาตรการแก้ไข' : null,
      };
    });
    const over = x => (x.due && x.due < date ? 0 : 1);
    return [...sf, ...acts].sort((a, b) => (over(a) - over(b)) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  }, [data, date]);

  /* ไฟรวม + "ประเมินได้กี่ช่อง" — ไฟเขียวจากช่องเดียวที่ประเมินได้ = หลอกคนอ่าน ต้องเขียนกำกับเสมอ */
  const overall = useMemo(() => {
    const all = [...rows.map(r => r.st), ...secRows.map(r => r.st)];
    const known = all.filter(s => s !== ST.unknown).length;
    return { st: worstStatus(all), known, total: all.length };
  }, [rows, secRows]);
  const overdue = todo.filter(x => x.due && x.due < date).length;

  // ── ผังกระดาษ (ชุดเดียวกับจอ SQDCM) ──────────────────────────────────────────────
  const grid = useSheetGrid(wrapRef, 10);
  const { cols, cw, ch, fit, k } = grid;
  const fs = (n) => Math.max(11, Math.round(n * k));
  const goBoard = (on) => {
    setBoard(on);
    try {
      if (on) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* เบราว์เซอร์ TV บางรุ่นไม่มี API นี้ — โหมด fixed ก็เต็มจออยู่แล้ว */ }
  };
  const goTo = (to) => { if (to && canAccessPage(to.split('?')[0], role)) navigate(to); };
  const setMonth = (k) => { if (k && k !== SUMMARY_KEY && k <= today.slice(0, 7)) setParam('date', monthEnd(k, today)); };
  const shiftMonth = (n) => {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // ── กราฟ 12 เดือน + แท่งสรุป (หน้าตาเดียวกับโหมดปีของ SQDCM · สีแท่ง = เกณฑ์ทางการ) ─────────
  const axisTick = { fontSize: fs(9.5), fill: 'var(--muted)' };
  const chartTip = {
    contentStyle: { background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, fontSize: fs(11) },
    labelStyle: { color: 'var(--text2)' },
  };
  const rowChart = (r) => {
    const data = r.series.map(p => ({ ...p, label: p.summary ? 'สรุป' : String(Number(String(p.k).slice(5, 7))) }));
    if (!data.some(p => p.v != null)) return <EmptyChart k={k} text={`ยังไม่มีค่าสักเดือนในปี ${year}`} />;   // เหตุผลอยู่ที่ไฟ/ท้ายแผ่นแล้ว ไม่พิมพ์ซ้ำ
    const isPct = r.unit === '%';
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 6, left: isPct ? -22 : -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} interval={0} />
          <YAxis domain={isPct ? [0, 100] : undefined} tick={axisTick} width={isPct ? 34 : 44}
            tickFormatter={v => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
          <Tooltip {...chartTip} formatter={v => [`${nf(v, 2)}${r.unit ? ' ' + r.unit : ''}`, r.name]}
            labelFormatter={(l, pl) => (pl?.[0]?.payload?.summary
              ? `สรุปปี ${year} (${r.sumKind === 'sum' ? 'รวม' : 'เฉลี่ย'}${r.auto && !r.fromDept ? 'ถ่วงน้ำหนัก' : ''}ทั้งปี)`
              : `${monthLabel(pl?.[0]?.payload?.k || '')} ${year} · กดเพื่อดูเดือนนี้บนบอร์ด`)} />
          {r.target != null && <ReferenceLine y={r.target} stroke="#ef4444" strokeDasharray="4 3" />}
          <Bar dataKey="v" radius={[2, 2, 0, 0]} onClick={(d) => setMonth(d?.payload?.k ?? d?.k)}>
            {data.map((p, i) => (
              <Cell key={i} fill={statusColor(r.def ? monthBarScore(p, r.def) : 'none')}
                fillOpacity={p.summary ? 0.55 : (p.k === monthKey ? 1 : 0.8)}
                stroke={p.summary ? 'var(--text2)' : (p.k === monthKey ? 'var(--text)' : 'none')}
                strokeDasharray={p.summary ? '3 2' : undefined} cursor={p.summary ? 'default' : 'pointer'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  };

  /* ── หัวแผ่นสรุป ── */
  const monthText = `${monthLabel(monthKey)} ${year}`;
  const shell = board
    ? { position: 'fixed', inset: 0, zIndex: 800, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }
    : { display: 'flex', flexDirection: 'column' };
  const pill = (active) => ({
    fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
    background: active ? 'var(--accent)' : 'var(--bg3)', color: active ? '#08120a' : 'var(--text)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
  });
  const navBtn = { fontSize: 12, fontWeight: 800, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' };
  const overallLamp = toLamp(overall.st, `ประเมินได้ ${overall.known}/${overall.total} ช่อง`);
  const sheetsBox = {
    display: 'grid', gap: GAP, alignContent: 'start', justifyContent: 'center',
    gridTemplateColumns: cw ? `repeat(${cols}, ${cw}px)` : `repeat(${cols}, 1fr)`,
    gridAutoRows: ch ? `${ch}px` : 'auto',
  };
  const warnLines = [
    data?.warn?.length ? `ตัวเลขบางส่วนโหลดไม่ครบ: ${data.warn.join(' · ')}` : null,
    data?.kpiMissing ? 'ยังไม่ได้ apply migration ตาราง KPI — แถว ✍️ ทั้งหมดจะว่างจนกว่าจะ apply (แจ้ง admin)' : null,
    data?.openSess && monthKey === today.slice(0, 7) ? `วันนี้ยังมี ${data.openSess} กะที่ยังไม่ปิด — ตัวเลขเดือนนี้ยังไม่ครบ` : null,
    scopeNoLines ? `${scopeText} ไม่มีไลน์ผลิตในผัง — แผ่น OEE/PPM ว่างโดยตั้งใจ · KPI กรอกมือของหน่วยงานนี้อยู่ที่แผ่น 📌 Key Performance (ตั้งที่แท็บ ⚙️)` : null,
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
    </>
  );

  return (
    <div style={shell}>
      {!board && (
        <PageHeader
          tabs={tabs} tab={tab} onTab={onTab}
          title="OBEYA — บอร์ด KPI ส่วนงาน" icon="📋"
          sub={`ตามบอร์ดหน้างาน · ${scopeText}${members.ccs.length && members.ccs.length <= 3 ? ` (cost ${members.ccs.join(' · ')})` : ''} · ${monthText} · ประเมินได้ ${overall.known}/${overall.total} ช่อง`}
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

      {warnLines.length > 0 && (
        <div style={{ margin: '0 0 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {warnLines.map((w, i) => <WarnNote key={i} k={1} text={w} tone={err ? '#ef4444' : '#f59e0b'} />)}
        </div>
      )}

      {/* ⚠️ กล่องนอก = padding · กล่องใน (wrapRef) = ที่ถูกวัด ห้ามมี padding (clientHeight รวม padding → แถวล่างโดนตัด) */}
      <div style={{ display: 'flex', minHeight: 0, flex: board ? 1 : 'none', height: board ? undefined : '78vh', padding: board ? 8 : 0 }}>
        <div ref={wrapRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: fit ? 'clip' : 'auto', overflowX: 'clip' }}>
          {loading && !data ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลดข้อมูล…</div>
          ) : !scope ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังเลือกขอบเขตเริ่มต้น…</div>
          ) : (
            <div style={sheetsBox}>
              {rows.map((r) => (
                <Sheet key={r.key} k={k} cw={cw} icon={r.icon} title={r.name}
                  sub={`${r.manual ? '✍️ กรอกมือ' : '⚡ ระบบคำนวณ'}${r.ytd != null ? ` · ${r.sumKind === 'sum' ? 'รวมปี' : 'YTD'} ${nf(r.ytd, r.unit === 'PPM' ? 0 : 1)}${r.unit ? ' ' + r.unit : ''}` : ''}`}
                  big={r.value == null ? '—' : nf(r.value, r.unit === 'PPM' || r.unit === 'ครั้ง' ? 0 : 1)}
                  unit={r.value != null ? r.unit : ''} delta={r.delta}
                  stat={toLamp(r.st, r.why)}
                  foot={r.note && (r.st === ST.unknown || r.fromDept || r.auto)
                    ? <WarnNote k={k} text={r.note} tone={r.st === ST.unknown ? '#f59e0b' : '#94a3b8'} />
                    : r.why}
                  link={r.to ? 'เจาะดู' : (r.manual ? 'กรอก/ตั้งเป้า' : null)}
                  onLink={() => (r.to ? goTo(r.to) : onTab?.('table'))}>
                  {rowChart(r)}
                </Sheet>
              ))}

              {/* ═══ Key Performance ระดับส่วนงาน (100P / LEAN / QCC / Kaizen / 5S …) ═══ */}
              <Sheet k={k} cw={cw} icon="📌" title={`Key Performance · ${org.labelOf(scope.kind, scope.value)}`}
                sub="KPI ที่ตั้งไว้ที่ขอบเขตนี้โดยตรง (นอกเหนือ 8 หัวข้อหลัก)" big={secRows.length ? `${secRows.filter(r => r.st !== ST.unknown).length}/${secRows.length}` : '—'}
                unit={secRows.length ? 'ประเมินได้' : ''}
                stat={toLamp(worstStatus(secRows.map(r => r.st)), secRows.length ? `${secRows.length} หัวข้อ` : 'ยังไม่ได้ตั้ง KPI ที่ขอบเขตนี้')}
                link="ตั้ง/กรอกที่แท็บ 📑" onLink={() => onTab?.('table')}>
                <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, padding: '0 4px' }}>
                  {!secRows.length ? (
                    <div style={{ fontSize: fs(11), color: 'var(--muted)', lineHeight: 1.4, padding: 6 }}>
                      ยังไม่ได้ตั้ง KPI ระดับส่วนงาน — ตั้งที่แท็บ 📑 โดยเว้นช่อง "กลุ่มไลน์" ไว้
                    </div>
                  ) : secRows.map(r => (
                    <div key={r.id} title={r.why} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 4, background: 'var(--bg3)', borderLeft: `3px solid ${statusColor(r.st === ST.unknown ? 'none' : r.st)}` }}>
                      <span style={{ fontSize: fs(11), fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      <span style={{ fontSize: fs(11.5), fontWeight: 800, color: statusColor(r.st === ST.unknown ? 'none' : r.st), whiteSpace: 'nowrap' }}>
                        {r.value == null ? '—' : `${nf(r.value, 2)}${r.unit ? ' ' + r.unit : ''}`}
                      </span>
                    </div>
                  ))}
                </div>
              </Sheet>

              {/* ═══ งานที่ต้องตามแก้ — สิ่งที่ทำให้บอร์ดนี้เป็น Obeya ไม่ใช่แค่จอตัวเลข ═══ */}
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
                        <span style={{ fontSize: fs(10), color: late ? '#ef4444' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {x.warn ? `⚠ ${x.warn}` : (x.due ? `ครบ ${x.due}` : x.meta)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Sheet>
            </div>
          )}
        </div>
      </div>

      {!board && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
          ตัวเลข = สะสมเดือนที่เลือก · ⚡ ระบบคำนวณจากกะที่ปิดแล้ว (OEE ถ่วงเวลารับภาระ · PPM = ของเสีย ÷ ยอดที่ผลิตทั้งหมด (สแกนดี + เสีย) × 10⁶ ไม่รวมงานทดลอง)
          · ✍️ ต้องกรอกที่แท็บ 📑 KPI รายเดือน / ตั้งเป้า · สีแท่ง/ไฟ = เกณฑ์ทางการ ถึง Target = เขียว · ถึงแค่ Commitment = เหลือง · ไม่ถึง = แดง · ไม่มีเป้าหรือไม่มีค่า = เทา (ไม่ใช่ผ่าน)
          · แท่ง "สรุป" = {`เฉลี่ยถ่วงน้ำหนักทั้งปี (แถว ⚡) / เฉลี่ยเดือนที่กรอก (แถว ✍️)`} · กดแท่งเดือนเพื่อดูเดือนนั้น
        </div>
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
