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
import { useState, useEffect, useMemo, useCallback, useRef, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import PageHeader from './PageHeader';
import { A4, GAP, useSheetGrid, StatusLamp, Sheet, WarnNote, EmptyChart } from './ObeyaSheet';
import LineSelect from './LineSelect';
import PersonSelect from './PersonSelect';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { dtBucketName, buildDtIndex } from '../utils/downtimeCategory';
import { checkWrite } from '../utils/dbWrite';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { inSectionScope } from '../utils/sectionScope';
import useOrgScope from '../utils/useOrgScope';
import OrgScopePicker from './OrgScopePicker';
import { PLANT, isPlant, parseScopeKey } from '../utils/orgScope';
import useColumnHistory from '../utils/useColumnHistory';
import { useLiveBoard } from '../utils/useLiveBoard';
import { LIVE, RATE } from '../utils/refreshRates';
import { LINE_COLUMNS } from '../utils/useProductionLines';
import { avgOeeTarget, sumDefectQty } from '../utils/oee';
import { defectUnitCost, fmtBaht, lineCostCenter, rateFor, ratePerHour, RATE_COMPONENTS } from '../utils/costSaving';
import { notifyEvent } from '../utils/notifyEvent';
import TimeRangeBar from './TimeRangeBar';
import { LOOKBACK_DAYS, presetRange, addDays, rangeDays, normalizeRange } from '../utils/timeRange';
import {
  OBEYA_AXES, PERIODS, periodRange, prevRange, statusColor, statusOf, statusWhy, gapToTarget,
  axisOee, axisSafety, axisQuality, axisDelivery, axisCost, axisMan, actionHealth, fillDays, round1,
} from '../utils/obeyaKpi';
import {
  yearOf, yearRange, monthRange, prevMonthRange, monthLabel, SUMMARY_KEY, monthBarStatus,
  axisOeeYear, axisSafetyYear, axisQualityYear, axisDeliveryYear, axisCostYear, axisManYear, paretoYear,
} from '../utils/obeyaYear';

/* วันที่งาน (ตัด 08:00 — งานกะดึกข้ามวันนับเป็นวันก่อนหน้า)
   ⚠️ ห้ามใช้ toISOString() — คืน UTC ทำให้วันที่เพี้ยนสำหรับไทย (กฎ Date/Time ใน CLAUDE.md) */
const getWorkDate = () => {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (k) => { const [, m, d] = String(k).split('-'); return `${+d}/${+m}`; };
export default function ObeyaSqdcmBoard({ tabs, tab, onTab }) {
  const { role, lineId, sections, fullName } = useContext(UserContext);
  const canRecord = can('obeya', 'record', role) || can('morning_meeting', 'record', role);
  const today = getWorkDate();

  const [period, setPeriod] = useState('week');
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
  const { index: org } = useOrgScope(lines);
  const scopeLineSet = useMemo(() => (isPlant(scope) ? null : new Set(org.lineNamesOf(scope.kind, scope.value))), [scope, org]);
  // ส่วนงานที่ขอบเขตนี้สังกัด — ใช้ตอนตั้ง Action item / ส่งต่อ ?section= ให้หน้าที่ยังอ่านแค่ section
  const secFilter = isPlant(scope) ? '' : (org.sectionOf(scope.kind, scope.value) || '');
  const scopeText = isPlant(scope) ? 'ทุกส่วนงาน' : org.labelOf(scope.kind, scope.value);
  const [targets, setTargets] = useState({});
  const [ccRates, setCcRates] = useState([]);
  /* daily_production_logs.assigned_line = **id จุดงาน (workstations.id)** ไม่ใช่ชื่อไลน์ (docs/modules/morning-meeting.md)
     — เดิมจอนี้เอา id ไปเทียบชื่อไลน์ตรงๆ ⇒ ติดตัวกรองส่วนงานเมื่อไหร่ แกน S/M หายเกลี้ยงเงียบๆ (แก้ 2026-09-22) */
  const [stationLine, setStationLine] = useState({});
  useEffect(() => {
    supabase.from('production_lines').select(`${LINE_COLUMNS}, cost_center`).order('name')
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
  const [loading, setLoading] = useState(true);

  /* ⚠️ deps ต้องเป็น primitive ล้วน (กฎเหล็ก DB ข้อ 9) — ห้ามใส่ array/object
     scope ส่วนงานกรองทีหลังใน useMemo ไม่ใช่ในคิวรี เพื่อไม่ให้สลับส่วนงาน = ยิง DB ใหม่ทุกครั้ง */
  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const sRes = await fetchAllPages(() => supabaseDR.from('production_sessions')
        .select('id, work_date, shift, line_name, oee, oee_a, oee_p, oee_q, actual_qty, qty_ok, qty_ng, shift_min, start_time')
        .eq('status', 'closed').gte('work_date', from).lte('work_date', to), { orderBy: ['work_date', 'id'] });
      const ids = sRes.rows.map(s => s.id);

      // ⚠️ ห้าม .in(ids) ตรงๆ — ช่วงเดือนมี 400+ กะ URL ยาวเกินเพดาน proxy แล้วคืนค่าว่างเงียบ
      const [dtRes, dfRes, ordRes, pRes, atRes] = await Promise.all([
        fetchByIds(ids, c => supabaseDR.from('downtime_logs')
          /* ⚠️ ข้อความอิสระของ downtime ชื่อ `description` **ไม่ใช่ `reason`** — ไม่มีคอลัมน์ชื่อนั้นในตาราง
             เขียนผิดมาตั้งแต่สร้างบอร์ด ⇒ คิวรีนี้ล้มทั้งก้อน แผง "ทำไมถึงหลุดเป้า" กับครึ่งหนึ่งของ C
             ว่างเปล่ามาตลอด (จอขึ้นเหมือน "ไม่มีเครื่องหยุด" ทั้งที่จริงคือโหลดไม่ได้)
             · ทุก component อื่นในรีโปใช้ `description` หมด — ดู OeeInsightPanel / MachineReliability */
          .select('session_id, duration_min, description, machine_no, dr_downtime_types(name_th, category)').in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('defect_logs')
          .select('session_id, qty_ng, qty_suspect, is_trial, dr_defect_types(name_th, excl_from_q), prod_orders(mat_no)').in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('prod_orders')
          .select('session_id, mat_no, status, qty, qty_ok, qty_actual').in('session_id', c)),
        fetchAllPages(() => supabaseDR.from('production_sessions')
          .select('id, work_date, line_name, oee, oee_a, oee_p, oee_q, actual_qty, qty_ng, shift_min')
          .eq('status', 'closed').gte('work_date', prev.from).lte('work_date', prev.to), { orderBy: ['work_date', 'id'] }),
        fetchAllPages(() => supabase.from('daily_production_logs')
          .select('work_date, is_present, has_helmet, has_boots, has_gloves, has_ot, has_extended_ot, assigned_line')
          .gte('work_date', from).lte('work_date', to), { orderBy: ['work_date'] }),
      ]);

      setSess(sRes.rows); setPrevSess(pRes.rows);
      setDts(dtRes.rows); setDefs(dfRes.rows); setOrders(ordRes.rows); setAttend(atRes.rows);
      // โหลดไม่ครบ = ตัวเลขต่ำกว่าจริง **ต้องบอกบนจอ** ห้ามเงียบ (บทเรียนแท็บแนวโน้ม /oee-analytics)
      setDtBad(!!(dtRes.error || dtRes.truncated));
      const bad = [sRes, dtRes, dfRes, ordRes, pRes, atRes].find(r => r.error || r.truncated);
      setLoadWarn(bad ? (bad.error || 'ข้อมูลบางส่วนถูกตัด (ช่วงยาวเกิน) — ตัวเลขอาจต่ำกว่าจริง') : null);

      const mats = [...new Set(dfRes.rows.map(d => d.prod_orders?.mat_no).filter(Boolean))];
      if (mats.length) {
        const { data: pm } = await supabaseDR.from('parts_master')
          .select('mat_no, material_cost, standard_cost').in('mat_no', mats.slice(0, 300));
        setPartCost(Object.fromEntries((pm || []).map(r => [r.mat_no, r])));
      } else setPartCost({});
    } finally { setLoading(false); }
  }, [from, to, prev.from, prev.to]);

  useLiveBoard(loadBoard, {
    tables: ['production_sessions'], topic: 'obeya-board', tier: LIVE.BOARD, rate: RATE.ANALYTIC,
    enabled: !isYear,
  });

  /* ── โหมดปี: ผลรวมรายเดือนจาก RPC (ไม่โหลดแถวดิบ) ─────────────────────────────────
     วัดจริง 22/09: ทั้งปี 2026 = ~137 KB (DR) + ~63 KB (Main) เทียบโหมดเดือนที่โหลดแถวดิบ ~400 KB
     · RPC คืน Σ อย่างเดียว — การหาร/ถ่วง/ตัดสินอยู่ใน obeyaYear.js (ห้ามย้ายสูตรลง SQL) */
  const [yr, setYr] = useState(null);           // { sessions, downtime, defects, orders, attend }
  const loadYear = useCallback(async () => {
    setLoading(true);
    try {
      const [dr, at] = await Promise.all([
        supabaseDR.rpc('obeya_year_rollup', { p_from: from, p_to: to }),
        supabase.rpc('obeya_attendance_rollup', { p_from: from, p_to: to }),
      ]);
      const bad = dr.error || at.error;
      setLoadWarn(bad ? `โหลดสรุปรายปีไม่สำเร็จ: ${bad.message || bad}` : null);
      const j = dr.data || {};
      setYr({
        sessions: j.sessions || [], downtime: j.downtime || [], defects: j.defects || [], orders: j.orders || [],
        attend: Array.isArray(at.data) ? at.data : [],
      });
      const mats = [...new Set((j.defects || []).map(d => d.mat).filter(Boolean))];
      if (mats.length) {
        const { data: pm } = await supabaseDR.from('parts_master')
          .select('mat_no, material_cost, standard_cost').in('mat_no', mats.slice(0, 300));
        setPartCost(Object.fromEntries((pm || []).map(r => [r.mat_no, r])));
      } else setPartCost({});
    } finally { setLoading(false); }
  }, [from, to]);
  useLiveBoard(loadYear, {
    tables: ['production_sessions'], topic: 'obeya-year', tier: LIVE.BOARD, rate: RATE.ANALYTIC,
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
  const lineOk = useCallback((name) => {
    const sec = secOfLine[name];
    if (!inSectionScope(sections, sec)) return false;           // scope ของ user
    if (scopeLineSet && !scopeLineSet.has(name)) return false;  // ตัวกรองขอบเขตบนจอ (ทุกมิติของผัง)
    return true;
  }, [secOfLine, sections, scopeLineSet]);

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
    const groups = [...new Set(names.map((nm) => {
      const l = lines.find(x => x.name === nm);
      return l?.parent_line_name || nm;
    }).filter(Boolean))];
    return avgOeeTarget(groups.map(g => targets[g] || null));
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
      const t = Number(o.qty) || 0;
      const p = o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0)
        : ['carry_over', 'imported'].includes(o.status) ? (o.qty_actual ?? 0) : 0;
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
      const mat = d.prod_orders?.mat_no;
      const { unit } = defectUnitCost(mat ? partCost[mat] : null);
      if (!unit) { if (mat) noCost.add(mat); return; }
      const wd = dayOf[d.session_id];
      const v = ((Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0)) * unit;
      ngBaht += v;
      (byDay[wd] || (byDay[wd] = { k: wd, dt: 0, ng: 0 })).ng += v;
    });
    const series = Object.values(byDay).sort((a, b) => a.k.localeCompare(b.k))
      .map(b => ({ ...b, v: Math.round(b.dt + b.ng) }));
    return axisCost({ dtBaht, ngBaht, series, missingRate: noRate.size, missingCost: noCost.size });
  }, [fDts, fDefs, fSess, lines, ccRates, partCost]);

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
    return axisCostYear({ rows, year, missingRate: noRate.size, missingCost: noCost.size });
  }, [yDts, yDefs, year, lines, ccRates, partCost]);
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

  const health = useMemo(() => actionHealth(actions, today), [actions, today]);
  const ngTotalM = useMemo(() => sumDefectQty(fDefs, 'line'), [fDefs]);
  const ngTotal = isYear ? (kQY.ngQty || 0) : ngTotalM;

  /* ── ไฟสถานะของ 3 แผ่นที่ "ไม่มีเป้าให้เทียบ" — ต้องเขียนเองแทน statusWhy() ────────────
     กฎความซื่อสัตย์ของจอ: ห้ามแต่งเป้าขึ้นมาเองเพื่อให้ไฟติดสวย และห้ามปล่อยเทาเฉยๆ
     โดยไม่บอกว่าเทาเพราะอะไร — ทุกดวงต้องตอบได้ว่า "สีนี้เพราะอะไร" ใน tooltip */
  const costStat = useMemo(() => {
    if (dtBad) return { status: 'none', label: 'โหลดไม่ได้', why: 'คิวรีข้อมูลเครื่องหยุดล้มเหลว — ตัวเลขนี้ยังเชื่อไม่ได้ (ดูข้อความแดงบนหัวจอ)' };
    if (kC.value == null) return { status: 'none', label: 'ยังไม่มีข้อมูล', why: 'ช่วงนี้ยังไม่มีความสูญเสียที่คิดเป็นเงินได้' };
    if (kC.value <= 0) return { status: 'good', label: 'ไม่มีความสูญเสีย', why: 'ช่วงนี้ไม่มีเครื่องหยุดนอกแผน/ของเสียที่คิดเป็นเงินได้' };
    // ⚠️ แดงนี้ = "มีเงินหายไป" ไม่ใช่ "เกินเป้า" — ยังไม่มีใครตั้งเพดานค่าความสูญเสียไว้
    return { status: 'bad', label: 'มีความสูญเสีย', why: `เสียไป ${fmtBaht(kC.value)} (ยังไม่ได้ตั้งเพดานค่าความสูญเสีย — แดงนี้แปลว่า "มีเงินหายไป" ไม่ใช่ "เกินเป้า")` };
  }, [kC.value, dtBad]);

  const paretoStat = useMemo(() => {
    if (dtBad) return { status: 'none', label: 'โหลดไม่ได้', why: 'คิวรีข้อมูลเครื่องหยุดล้มเหลว — ตัวเลขนี้ยังเชื่อไม่ได้ (ดูข้อความแดงบนหัวจอ)' };
    if (!pareto.total) return { status: 'good', label: 'ไม่มีเครื่องหยุด', why: 'ช่วงนี้ไม่มีเวลาเครื่องหยุดนอกแผนเลย' };
    // แผ่นนี้ตอบ "ทำไม" ไม่ใช่ KPI ของตัวเอง ⇒ ไม่มีเป้าของ "นาทีที่หยุด" ให้ตัดสิน = เทาเสมอ
    const top = pareto.rows[0];
    return { status: 'none', label: 'ไม่มีเป้า', why: `หยุดรวม ${pareto.total.toLocaleString()} นาที · อันดับ 1 "${top.name}" ${top.min.toLocaleString()} นาที — ยังไม่ได้ตั้งเป้าเวลาหยุด จึงตัดสินผ่าน/ไม่ผ่านไม่ได้` };
  }, [pareto, dtBad]);

  const actionStat = useMemo(() => {
    if (health.empty) return { status: 'none', label: 'ยังไม่มีใบ', why: 'ยังไม่มีใครบันทึกสิ่งที่ตกลงกันว่าจะแก้สักใบ — ตามงานไม่ได้' };
    if (health.overdue.length) return { status: 'bad', label: `เกินกำหนด ${health.overdue.length}`, why: `มี ${health.overdue.length} ใบที่เลยวันครบกำหนดแล้วยังไม่ปิด` };
    return { status: 'good', label: 'ตามกำหนด', why: `ค้างอยู่ ${health.liveCount} ใบ ยังไม่มีใบไหนเลยกำหนด` };
  }, [health]);

  // ── ผังกระดาษ ──────────────────────────────────────────────────────────────────
  const [board, setBoard] = useState(false);            // โหมดจอ TV = ซ่อนหัวเพจ เต็มจอ
  const wrapRef = useRef(null);
  const grid = useSheetGrid(wrapRef, 10);
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
    setSaving(true);
    try {
      const { data: { user } = {} } = await supabase.auth.getUser();
      const sec = modal.line_name ? (secOfLine[modal.line_name] || secFilter || null) : (secFilter || null);
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
          `🏛️ OBEYA ${today} · แกน ${modal.kpi_key || '—'}`,
          `📌 ${modal.problem.trim()}`,
          `🙋 ${modal.assignee?.trim() || '(ยังไม่ระบุผู้รับผิดชอบ)'}`,
          modal.due_date ? `⏰ กำหนดเสร็จ ${modal.due_date}` : '',
        ],
      });
      toast.success('ตั้ง Action Item แล้ว');
      setModal(null);
      loadActions();
    } finally { setSaving(false); }
  };
  const setStatus = async (a, status) => {
    const patch = { status, updated_at: new Date().toISOString() };
    if (status === 'done') patch.done_at = new Date().toISOString();
    // ⚠️ RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" ⇒ ต้องนับแถวจริง ห้ามเชื่อ !error
    const res = await supabase.from('meeting_action_items').update(patch).eq('id', a.id).select('id');
    if (!checkWrite(res, 'อัพเดท Action')) return;
    if (!res.data?.length) return toast.error('ไม่มีสิทธิ์อัพเดทใบนี้ (ติดต่อผู้ดูแลระบบ)');
    setActions(prev => prev.map(x => (x.id === a.id ? { ...x, ...patch } : x)));
  };

  // ── ตัวช่วยวาดกราฟ (หน้าตาเดียวกันทุกแผ่น — ห้ามแต่ละแผ่นตั้งเอง) ────────────────
  const axisTick = { fontSize: fs(10), fill: 'var(--muted)' };
  const chartTip = {
    contentStyle: { background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, fontSize: fs(11) },
    labelStyle: { color: 'var(--text2)' },
  };
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
  const yearBars = (k, { fmt = v => `${v}%`, name = k.key, domain = [0, 100], yWidth = 34, left = -22, stacked = false, span = 1 } = {}) => {
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
          <YAxis domain={stacked ? undefined : domain} tick={tickY} width={yWidth}
            tickFormatter={stacked ? (v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)) : undefined} />
          <Tooltip {...chartTip} formatter={stacked
            ? ((v, nm) => [fmtBaht(v), nm === 'dt' ? 'เครื่องหยุด' : 'ของเสีย'])
            : (v => [fmt(v), name])}
            labelFormatter={(l, pl) => (pl?.[0]?.payload?.summary
              ? `สรุปปี ${year} (${pl[0].payload.kind === 'sum' ? 'รวมทั้งปี' : 'เฉลี่ยถ่วงน้ำหนักทั้งปี'})`
              : `${monthLabel(pl?.[0]?.payload?.k || '')} ${year} · กดเพื่อเจาะรายวัน`)} />
          {k.target != null && !stacked && <ReferenceLine y={k.target} stroke="#ef4444" strokeDasharray="4 3" />}
          {stacked ? (
            <>
              <Bar dataKey="dt" stackId="c" fill="#f59e0b" onClick={onBarClick} cursor="pointer" />
              <Bar dataKey="ng" stackId="c" fill="#a78bfa" radius={[2, 2, 0, 0]} onClick={onBarClick} cursor="pointer">
                {data.map((p, i) => <Cell key={i} fill="#a78bfa" fillOpacity={p.summary ? 0.55 : 1} />)}
              </Bar>
            </>
          ) : (
            <Bar dataKey="v" radius={[2, 2, 0, 0]} onClick={onBarClick}>
              {data.map(cellOf)}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  const sheetsBox = {
    display: 'grid', gap: GAP, alignContent: 'start', justifyContent: 'center',
    gridTemplateColumns: cw ? `repeat(${cols}, ${cw}px)` : `repeat(${cols}, 1fr)`,
    gridAutoRows: ch ? `${ch}px` : 'auto',
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
    ? { position: 'fixed', inset: 0, zIndex: 800, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }
    : { display: 'flex', flexDirection: 'column' };
  const goBoard = (on) => {
    setBoard(on);
    // ขอเต็มจอจากเบราว์เซอร์ด้วย (best-effort) — จอ TV มักมีแถบ URL กินที่ · ปฏิเสธได้ ไม่ใช่ error
    try {
      if (on) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* เบราว์เซอร์ TV บางรุ่นไม่มี API นี้ — ไม่เป็นไร โหมด fixed ก็เต็มจออยู่แล้ว */ }
  };

  const periodText = custom ? `กำหนดเอง (${rangeDays(from, to)} วัน)`
    : isYear ? `ปี ${year}`
    : period === 'month' ? (monthSel ? `เดือน ${monthLabel(monthSel)} ${monthSel.slice(0, 4)} (เจาะจากปี)` : 'เดือนนี้')
      : 'สัปดาห์นี้';
  const shiftCount = isYear ? (kOee.shifts || 0) : fSess.length;
  const yearNavBtn = {
    fontSize: 12, fontWeight: 800, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
    background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
  };

  return (
    <div style={shell}>
      {!board && (
        <PageHeader
          tabs={tabs} tab={tab} onTab={onTab}
          title="OBEYA — ห้องบัญชาการโรงงาน" icon="🏛️"
          sub={`${periodText} · ${from} → ${to} · ${shiftCount.toLocaleString()} กะที่ปิดแล้ว`}
          actions={(
            <>
              <OrgScopePicker index={org} value={scope} onChange={setScope} scopeSet={null} sections={sections}
                plantLabel="ทุกส่วนงาน" width={230} title="เลือกขอบเขตตามผังองค์กร (ฝ่าย/ส่วนงาน/แผนก/กลุ่มไลน์/ไลน์/CC)" />
              {monthSel && (
                <button onClick={() => pickPeriod('year')} title="กลับไปดูทั้งปี" style={{
                  fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                  background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
                }}>← ปี {year}</button>
              )}
              {isYear && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <button onClick={() => setYear(y => y - 1)} title="ปีก่อน" style={yearNavBtn}>◀</button>
                  <b style={{ fontSize: 14, minWidth: 44, textAlign: 'center' }}>{year}</b>
                  <button onClick={() => setYear(y => y + 1)} disabled={year >= yearOf(today)} title="ปีถัดไป" style={yearNavBtn}>▶</button>
                </span>
              )}
              {PERIODS.map(p => (
                <button key={p.key} onClick={() => pickPeriod(p.key)} style={{
                  fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                  background: period === p.key ? 'var(--accent)' : 'var(--bg3)',
                  color: period === p.key ? '#08120a' : 'var(--text)',
                  border: `1px solid ${period === p.key ? 'var(--accent)' : 'var(--border2)'}`,
                }}>{p.label}</button>
              ))}
              {canRecord && (
                <button onClick={() => openModal()} style={{
                  fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                  background: 'var(--accent2)', color: '#1a1206', border: 'none',
                }}>➕ ตั้ง Action</button>
              )}
              <button onClick={() => goBoard(true)} style={{
                fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
              }}>📺 โหมดจอ TV</button>
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
          style={{ margin: '0 0 10px', flexShrink: 0 }}
          note={custom
            ? '📌 กำลังใช้กรอบเวลาที่กำหนดเอง — กดปุ่ม สัปดาห์/เดือน/ปี ด้านบนเพื่อกลับไปช่วงมาตรฐาน'
            : 'แก้วันที่หรือกดปุ่มย้อนหลัง เพื่อดูช่วงอื่นนอกเหนือจาก สัปดาห์นี้ / เดือนนี้ / ปีนี้'}
        />
      )}

      {board && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>🏛️ OBEYA</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {scopeText} · {periodText} · {from} → {to} · {shiftCount.toLocaleString()} กะ
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => goBoard(false)} style={{
            fontSize: 12, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
            background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
          }}>ออกจากโหมดจอ</button>
        </div>
      )}

      {loadWarn && (
        <div style={{ margin: '0 0 8px', fontSize: 12, color: '#ef4444', fontWeight: 700 }}>
          ⚠️ {loadWarn}
        </div>
      )}

      {/* ⚠️ กล่องนอก = ที่ใส่ padding · กล่องใน (wrapRef) = ที่ถูกวัด **ห้ามมี padding**
          `clientHeight` รวม padding เสมอ ⇒ ถ้าวัดกล่องที่มี padding แผ่นจะสูงเกินไป
          แล้วแถวล่างถูก `overflow: clip` ตัดหายเงียบๆ (เจอจริงตอนวัดด้วย Playwright) */}
      <div style={{
        display: 'flex', minHeight: 0,
        flex: board ? 1 : 'none', height: board ? undefined : '78vh', padding: board ? 8 : 0,
      }}>
      <div ref={wrapRef} style={{
        flex: 1, minWidth: 0, minHeight: 0,
        overflowY: fit ? 'clip' : 'auto', overflowX: 'clip',
      }}>
        {loading && (isYear ? !yr : !fSess.length) ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลดข้อมูล…</div>
        ) : (
        <div style={sheetsBox}>

          {/* ═══ S — ความปลอดภัย ═══ */}
          <Sheet k={k} cw={cw} icon={axisSheet('S').icon} title="S ความปลอดภัย"
            sub={`${ytdTag}ใส่ PPE ครบตอนเช็คชื่อ (leading)`} big={kS.value ?? '—'} unit={kS.value != null ? '%' : ''}
            stat={statusWhy(kS.value, kS.target, 'up', '%')}
            foot={<WarnNote k={k} text={kS.note} tone="#ef4444" />}
            link="ไปหน้าเช็คชื่อ/PPE" onLink={() => drill('/daily-checker')}>
            {isYear ? (yearBars(kS, { name: 'PPE ครบ' }) || <EmptyChart k={k} text="ยังไม่มีบันทึกเช็คชื่อในปีนี้" />) : kS.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daySeries(kS.series)} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={axisTick} width={34} />
                  <Tooltip {...chartTip} formatter={v => [`${v}%`, 'PPE ครบ']} />
                  <ReferenceLine y={kS.target} stroke="#ef4444" strokeDasharray="4 3" />
                  <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                    {daySeries(kS.series).map((p, i) => (
                      <Cell key={i} fill={statusColor(statusOf(p.v, kS.target, 'up'))} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text="ยังไม่มีบันทึกเช็คชื่อในช่วงนี้" />}
          </Sheet>

          {/* ═══ Q — คุณภาพ ═══ */}
          <Sheet k={k} cw={cw} icon={axisSheet('Q').icon} title="Q คุณภาพ"
            sub={`${ytdTag}%Q ถ่วงด้วยจำนวนผลิต · NG ${ngTotal.toLocaleString()} ชิ้น`}
            big={kQ.value ?? '—'} unit={kQ.value != null ? '%' : ''}
            delta={gapToTarget(kQ.value, kQ.target, 'up')} stat={statusWhy(kQ.value, kQ.target, 'up', '%')}
            foot={kQ.note ? <WarnNote k={k} text={kQ.note} /> : `เป้า ${kQ.target}%`}
            link="ดูของเสียละเอียด" onLink={() => drill('/oee-analytics', { tab: 'insight' })}>
            {isYear ? (yearBars(kQ, { name: 'Q', domain: [dataMin => Math.min(95, Math.floor(dataMin)), 100] }) || <EmptyChart k={k} text="ยังไม่มีกะที่ปิดแล้วในปีนี้" />) : kQ.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daySeries(kQ.series)} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis domain={[dataMin => Math.min(95, Math.floor(dataMin)), 100]} tick={axisTick} width={34} />
                  <Tooltip {...chartTip} formatter={v => [`${v}%`, 'Q']} />
                  <ReferenceLine y={kQ.target} stroke="#ef4444" strokeDasharray="4 3" />
                  <Line type="monotone" dataKey="v" stroke={axisSheet('Q').color} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text="ยังไม่มีกะที่ปิดแล้วในช่วงนี้" />}
          </Sheet>

          {/* ═══ D — ส่งมอบ ═══ */}
          <Sheet k={k} cw={cw} icon={axisSheet('D').icon} title="D ส่งมอบ"
            sub={`${ytdTag}ผลิตได้ตามแผนในใบงาน`} big={kD.value ?? '—'} unit={kD.value != null ? '%' : ''}
            delta={gapToTarget(kD.value, kD.target, 'up')} stat={statusWhy(kD.value, kD.target, 'up', '%')}
            foot={kD.note ? <WarnNote k={k} text={kD.note} />
              : `แผน ${kD.plan.toLocaleString()} · ทำได้ ${kD.produced.toLocaleString()} ชิ้น`}
            link="ดูแผน/ใบงาน" onLink={() => drill('/production-plan')}>
            {isYear ? (yearBars(kD, { name: 'ทำได้ตามแผน' }) || <EmptyChart k={k} text="ยังไม่มีใบงานที่มีเป้าในปีนี้" />) : kD.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daySeries(kD.series)} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tick={axisTick} width={34} />
                  <Tooltip {...chartTip} formatter={v => [`${v}%`, 'ทำได้ตามแผน']} />
                  <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 3" />
                  <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                    {daySeries(kD.series).map((p, i) => (
                      <Cell key={i} fill={statusColor(statusOf(p.v, 100, 'up'))} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text="ยังไม่มีใบงานที่มีเป้าในช่วงนี้" />}
          </Sheet>

          {/* ═══ C — ต้นทุน ═══ */}
          <Sheet k={k} cw={cw} icon={axisSheet('C').icon} title="C ต้นทุนที่เสียไป"
            sub={`${isYear ? "รวมทั้งปี · " : ""}เครื่องหยุดนอกแผน + ของเสีย`}
            big={kC.value != null ? fmtBaht(kC.value) : '—'}
            stat={costStat}
            foot={kC.note ? <WarnNote k={k} text={kC.note} />
              : `เครื่องหยุด ${fmtBaht(kC.dtBaht)} · ของเสีย ${fmtBaht(kC.ngBaht)}`}
            link="ดู LOSS ละเอียด" onLink={() => drill('/oee-analytics', { tab: 'insight' })}>
            {isYear ? (yearBars(kC, { stacked: true, yWidth: 46, left: -8 }) || <EmptyChart k={k} text="ยังไม่มีความสูญเสียที่คิดเป็นเงินได้" />) : kC.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daySeries(kC.series)} margin={{ top: 4, right: 6, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tick={axisTick} width={46} tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                  <Tooltip {...chartTip} formatter={(v, n) => [fmtBaht(v), n === 'dt' ? 'เครื่องหยุด' : 'ของเสีย']} />
                  <Bar dataKey="dt" stackId="c" fill="#f59e0b" />
                  <Bar dataKey="ng" stackId="c" fill="#a78bfa" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text="ยังไม่มีความสูญเสียที่คิดเป็นเงินได้" />}
          </Sheet>

          {/* ═══ M — กำลังคน ═══ */}
          <Sheet k={k} cw={cw} icon={axisSheet('M').icon} title="M กำลังคน"
            sub={`${ytdTag}มา ${kM.present ?? 0} · ขาด ${kM.absent ?? 0}${kM.ot ? ` · OT ${kM.ot}` : ''}`}
            big={kM.value ?? '—'} unit={kM.value != null ? '%' : ''}
            delta={gapToTarget(kM.value, kM.target, 'up')} stat={statusWhy(kM.value, kM.target, 'up', '%')}
            foot={kM.note ? <WarnNote k={k} text={kM.note} />
              : 'อัตรามาทำงานจากการเช็คชื่อรายวัน (ยังไม่มีข้อมูลขวัญกำลังใจ)'}
            link="ดูกำลังคนย้อนหลัง" onLink={() => drill('/workforce-insight')}>
            {isYear ? (yearBars(kM, { name: 'มาทำงาน' }) || <EmptyChart k={k} text="ยังไม่มีบันทึกเช็คชื่อในปีนี้" />) : kM.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daySeries(kM.series)} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={axisTick} width={34} />
                  <Tooltip {...chartTip} formatter={(v, n) => (n === 'v' ? [`${v}%`, 'มาทำงาน'] : [v, 'คน'])} />
                  <ReferenceLine y={kM.target} stroke="#ef4444" strokeDasharray="4 3" />
                  <Bar dataKey="v" fill={axisSheet('M').color} radius={[2, 2, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text="ยังไม่มีบันทึกเช็คชื่อในช่วงนี้" />}
          </Sheet>

          {/* ═══ OEE — แผ่นแนวนอน (2 ช่อง) ═══ */}
          <Sheet k={k} cw={cw} span={2} icon="⚙️" title="OEE เทียบเป้า"
            sub={`${ytdTag}A ${kOee.a ?? '—'} · P ${kOee.p ?? '—'} · Q ${kOee.q ?? '—'}  |  เป้า A${target.a}/P${target.p}/Q${target.q}`}
            big={kOee.value ?? '—'} unit={kOee.value != null ? '%' : ''}
            delta={gapToTarget(kOee.value, kOee.target, 'up')}
            stat={statusWhy(kOee.value, kOee.target, 'up', '%')}
            foot={isYear
              ? (kOee.value != null
                ? `YTD ${kOee.value}% จาก ${kOee.months} เดือน · ${kOee.shifts.toLocaleString()} กะ · แท่ง "สรุป" = เฉลี่ยถ่วงน้ำหนักทั้งปี · กดแท่งเดือนเพื่อเจาะรายวัน`
                : 'ยังไม่มีกะที่ปิดแล้วในปีนี้')
              : kOee.value != null && kOeePrev.value != null
              ? `งวดก่อน ${kOeePrev.value}% (${prev.from}→${prev.to}) · ${kOee.value >= kOeePrev.value ? 'ดีขึ้น' : 'แย่ลง'} ${Math.abs(round1(kOee.value - kOeePrev.value))} จุด`
              : 'ยังเทียบงวดก่อนไม่ได้ (งวดก่อนไม่มีกะที่ปิดแล้ว)'}
            link="เจาะ OEE" onLink={() => drill('/oee-analytics', { section: secFilter, date: to })}>
            {isYear ? (yearBars(kOee, { name: 'OEE', span: 2 }) || <EmptyChart k={k} text="ยังไม่มีกะที่ปิดแล้วในปีนี้" />) : kOee.series.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daySeries(kOee.series)} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={axisTick} width={34} />
                  <Tooltip {...chartTip} formatter={v => [`${v}%`, 'OEE']} />
                  <ReferenceLine y={kOee.target} stroke="#ef4444" strokeDasharray="5 3"
                    label={{ value: `เป้า ${kOee.target}%`, position: 'insideTopRight', fill: '#ef4444', fontSize: fs(10) }} />
                  <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                    {daySeries(kOee.series).map((p, i) => (
                      <Cell key={i} fill={statusColor(statusOf(p.v, kOee.target, 'up'))} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text="ยังไม่มีกะที่ปิดแล้วในช่วงนี้" />}
          </Sheet>

          {/* ═══ ทำไมหลุดเป้า — Pareto ═══ */}
          <Sheet k={k} cw={cw} icon="🔎" title="ทำไมถึงหลุดเป้า"
            sub={`${isYear ? 'รวมทั้งปี · ' : ''}เวลาเครื่องหยุดนอกแผน (นาที)`}
            big={pareto.total ? pareto.total.toLocaleString() : '—'} unit={pareto.total ? 'นาที' : ''}
            stat={paretoStat}
            foot={pareto.rows.length
              ? `อันดับ 1 "${pareto.rows[0].name}" = ${Math.round((pareto.rows[0].min / pareto.total) * 100)}% ของเวลาที่เสีย`
              : 'ไม่มีเวลาเครื่องหยุดนอกแผนในช่วงนี้'}
            link="ดู Pareto เต็ม" onLink={() => drill('/oee-analytics', { tab: 'insight' })}>
            {pareto.rows.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pareto.rows} layout="vertical" margin={{ top: 2, right: 10, left: 2, bottom: 2 }}>
                  <XAxis type="number" tick={axisTick} hide />
                  <YAxis type="category" dataKey="name" tick={{ ...axisTick, fontSize: fs(9.5) }} width={Math.round(cw * 0.42)} />
                  <Tooltip {...chartTip} formatter={v => [`${v} นาที`, 'เวลาที่เสีย']} />
                  <Bar dataKey="min" fill="#fb923c" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart k={k} text="ไม่มีเวลาเครื่องหยุดนอกแผน" />}
          </Sheet>

          {/* ═══ ACTION BOARD — แผ่นแนวนอน (2 ช่อง) · ที่เดียวของหน้าที่เขียนข้อมูลได้ ═══ */}
          <Sheet k={k} cw={cw} span={2} icon="📋" title="ACTION BOARD — สิ่งที่ตกลงกันว่าจะแก้"
            sub={health.empty ? 'ยังไม่มีใครบันทึกสักใบ' : `เป็นๆ ${health.liveCount} ใบ · ปิดแล้ว ${health.done.length} ใบ${health.closeRate != null ? ` (${health.closeRate}%)` : ''}`}
            big={health.overdue.length || (health.empty ? '0' : health.liveCount)}
            unit={health.overdue.length ? 'ใบเกินกำหนด' : 'ใบค้าง'}
            stat={actionStat}>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 4, padding: '0 6px 2px', minHeight: 0 }}>
              {health.empty ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                  <WarnNote k={k} tone="#ef4444"
                    text="ตารางติดตามงานนี้ว่างเปล่าตั้งแต่สร้าง (13/07) ทั้งที่มีบันทึกเครื่องหยุด 8,000+ ครั้ง — แปลว่า 'สิ่งที่ตกลงกันว่าจะแก้' ยังอยู่นอกระบบ ตามงานไม่ได้" />
                  <div style={{ fontSize: fs(11), color: 'var(--muted)', lineHeight: 1.4 }}>
                    นี่คือเหตุผลหลักที่ทำหน้านี้ — ไม่ใช่เพื่อโชว์ตัวเลขสวยๆ แต่เพื่อปิดลูป:
                    ตัวเลขหลุดเป้า → ใครรับ → ทำอะไร → ภายในเมื่อไหร่ → ดีขึ้นจริงไหม
                  </div>
                  {canRecord && (
                    <button onClick={() => openModal()} style={{
                      alignSelf: 'flex-start', fontSize: fs(12), fontWeight: 800, padding: '6px 14px',
                      borderRadius: 999, background: 'var(--accent2)', color: '#1a1206', border: 'none', cursor: 'pointer',
                    }}>➕ ตั้งใบแรก</button>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flexShrink: 0 }}>
                    {[['เกินกำหนด', health.overdue.length, '#ef4444'], ['ใกล้ครบ', health.dueSoon.length, '#f59e0b'],
                      ['กำลังทำ', health.open.length, '#38bdf8'], ['ปิดแล้ว', health.done.length, '#22c55e']].map(([l, n, c]) => (
                      <span key={l} style={{
                        fontSize: fs(10.5), fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: c,
                        background: 'var(--bg3)', backgroundImage: `linear-gradient(${c}1f, ${c}1f)`, border: `1px solid ${c}55`,
                      }}>{l} {n}</span>
                    ))}
                    {canRecord && (
                      <button onClick={() => openModal()} style={{
                        fontSize: fs(10.5), fontWeight: 800, padding: '2px 10px', borderRadius: 999, marginLeft: 'auto',
                        background: 'var(--accent2)', color: '#1a1206', border: 'none', cursor: 'pointer',
                      }}>➕ ตั้ง Action</button>
                    )}
                  </div>
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[...health.overdue, ...health.dueSoon, ...health.open].slice(0, 20).map((a) => {
                      const late = health.overdue.includes(a);
                      return (
                        <div key={a.id} style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 4,
                          background: 'var(--bg3)', borderLeft: `3px solid ${late ? '#ef4444' : '#38bdf8'}`,
                        }}>
                          {a.kpi_key && (
                            <span style={{ fontSize: fs(10), fontWeight: 900, color: axisSheet(a.kpi_key)?.color || 'var(--muted)' }}>
                              {a.kpi_key}
                            </span>
                          )}
                          <span title={a.problem} style={{ fontSize: fs(11), fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.problem}
                          </span>
                          <span style={{ fontSize: fs(10), color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {a.line_name || '—'} · {a.assignee || 'ยังไม่ระบุ'} · {a.due_date || 'ไม่มีกำหนด'}
                          </span>
                          {canRecord && (
                            <button onClick={() => setStatus(a, 'done')} style={{
                              fontSize: fs(10), fontWeight: 700, padding: '1px 7px', borderRadius: 999, cursor: 'pointer',
                              background: 'var(--bg2)', color: '#22c55e', border: '1px solid #22c55e55',
                            }}>ปิด</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </Sheet>

        </div>
        )}
      </div>
      </div>

      {/* ── modal ตั้ง action ─────────────────────────────────────────────────── */}
      {modal && (
        <div className="modal-scroll" /* ไม่ปิดจาก backdrop — UI-CONVENTIONS §5: เผลอแตะพื้นหลังแล้วข้อมูลหายทั้งฟอร์ม (ปิดด้วยปุ่มยกเลิก/✕ เท่านั้น) */ style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 10,
            padding: 16, width: 'min(520px, 100%)', maxHeight: '90%', overflowY: 'auto',
          }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 17 }}>➕ ตั้ง Action Item (OBEYA {today})</h3>
            <div style={{ display: 'grid', gap: 9 }}>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>แกนที่จะไปแก้
                <select value={modal.kpi_key} onChange={e => setModal({ ...modal, kpi_key: e.target.value })}
                  style={{ marginTop: 3, fontSize: 13.5 }}>
                  <option value="">— ไม่ระบุแกน —</option>
                  {OBEYA_AXES.map(a => <option key={a.key} value={a.key}>{a.icon} {a.key} · {a.label}</option>)}
                  <option value="OEE">⚙️ OEE</option>
                </select>
              </label>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>ปัญหา / สิ่งที่ต้องทำ *
                <textarea value={modal.problem} rows={2} onChange={e => setModal({ ...modal, problem: e.target.value })}
                  style={{ marginTop: 3, fontSize: 13.5 }} placeholder="เช่น ลดเวลาเปลี่ยนแม่พิมพ์ไลน์ 060 จาก 25 นาที เหลือ 15 นาที" />
              </label>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>สาเหตุ (ถ้ารู้แล้ว)
                <textarea value={modal.root_cause} rows={2} onChange={e => setModal({ ...modal, root_cause: e.target.value })}
                  style={{ marginTop: 3, fontSize: 13.5 }} />
              </label>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไลน์
                <LineSelect lines={lines} value={modal.line_name} onChange={v => setModal({ ...modal, line_name: v })}
                  role={role} lineId={lineId} sections={sections} style={{ marginTop: 3, fontSize: 13.5 }} />
              </label>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ผู้รับผิดชอบ
                <PersonSelect value={modal.assignee || ''} source="both" history={assigneeHist}
                  placeholder="ชื่อผู้รับผิดชอบ" style={{ marginTop: 3 }}
                  onChange={v => setModal({ ...modal, assignee: v })} />
              </div>
              <div style={{ display: 'flex', gap: 9 }}>
                <label style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1 }}>กำหนดเสร็จ
                  <input type="date" value={modal.due_date} onChange={e => setModal({ ...modal, due_date: e.target.value })}
                    style={{ marginTop: 3, fontSize: 13.5, width: '100%' }} />
                </label>
                <label style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1 }}>เป้าที่ตกลงกัน
                  <input type="number" step="0.1" value={modal.target_value} placeholder="เช่น 82"
                    onChange={e => setModal({ ...modal, target_value: e.target.value })}
                    style={{ marginTop: 3, fontSize: 13.5, width: '100%' }} />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setModal(null)} disabled={saving} style={{
                fontSize: 13.5, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
              }}>ยกเลิก</button>
              <button onClick={saveAction} disabled={saving} style={{
                fontSize: 13.5, fontWeight: 800, padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                background: 'var(--accent)', color: '#08120a', border: 'none',
              }}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
