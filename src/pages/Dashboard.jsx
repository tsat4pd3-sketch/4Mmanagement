import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';

const FADE_UP = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };
const stagger = (i) => ({ ...FADE_UP, transition: { delay: i * 0.06, duration: 0.35 } });

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const h = () => setMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return mobile;
}

function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

function getShiftInfo(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const total = h * 60 + m;
  const isDay = total >= 480 && total < 1200;
  return { isDay, label: isDay ? 'กะเช้า' : 'กะดึก', icon: isDay ? '☀️' : '🌙' };
}

function RadialProgress({ pct, size = 80, stroke = 7, color = 'var(--accent)' }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
        style={{ stroke: 'var(--border2)' }} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
        strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
    </svg>
  );
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height: 4, borderRadius: 3, background: 'var(--border2)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.7s ease' }} />
    </div>
  );
}

const SKILL_LEVELS = [
  { min: 100, label: 'ผู้เชี่ยวชาญ',   color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  { min: 75,  label: 'แก้ปัญหาได้',    color: '#22c55e', bg: 'rgba(34,197,94,0.15)'  },
  { min: 50,  label: 'มาตรฐาน',        color: '#84cc16', bg: 'rgba(132,204,18,0.15)' },
  { min: 25,  label: 'ต้องดูแล',       color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { min: 0,   label: 'ยังไม่ผ่าน OJT', color: '#ef4444', bg: 'rgba(239,68,68,0.15)'  },
];
const getFitLevel = (fit) => fit === null ? null : SKILL_LEVELS.find(l => fit >= l.min) ?? SKILL_LEVELS[4];

const CAT_META = {
  Man:      { color: '#4d9fff', icon: '👤', bg: 'rgba(77,159,255,0.12)' },
  Machine:  { color: '#f59e0b', icon: '⚙️', bg: 'rgba(245,158,11,0.12)' },
  Material: { color: '#a855f7', icon: '📦', bg: 'rgba(168,85,247,0.12)' },
  Method:   { color: '#22c55e', icon: '📋', bg: 'rgba(34,197,94,0.12)' },
};
const getCatMeta = (cat = '') => {
  const key = Object.keys(CAT_META).find(k => cat.includes(k));
  return key ? CAT_META[key] : { color: '#888', icon: '🔔', bg: 'rgba(128,128,128,0.1)' };
};

function getWorkDateStr(date) {
  const h = date.getHours();
  const d = new Date(date);
  if (h < 8) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function Dashboard() {
  const now = useNow();
  const isMobile = useIsMobile();
  const vw = useWidth();
  const isWide = vw >= 1280;   // desktop / laptop
  const isUltra = vw >= 1600;  // large desktop / TV
  const shiftInfo = getShiftInfo(now);
  const workDateStr = getWorkDateStr(now);

  const [selectedDate,  setSelectedDate]  = useState(workDateStr);
  const [selectedShift, setSelectedShift] = useState(shiftInfo.isDay ? 'day' : 'night');

  // Section filter — เหมาะกับจอ TV ที่ตั้งไว้ดูเฉพาะส่วนงานตัวเอง
  // จำค่าไว้ใน URL (?section=...) เพื่อให้ bookmark จอ TV ได้ตรงส่วนงานทุกครั้งที่เปิด
  const [selectedSection, setSelectedSection] = useState(() => new URLSearchParams(window.location.search).get('section') || 'all');
  const changeSection = (sec) => {
    setSelectedSection(sec);
    const params = new URLSearchParams(window.location.search);
    if (sec === 'all') params.delete('section'); else params.set('section', sec);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  };

  // Auto-sync shift when day→night boundary crosses (20:00) while viewing today
  useEffect(() => {
    if (selectedDate === workDateStr) {
      setSelectedShift(shiftInfo.isDay ? 'day' : 'night');
    }
  }, [shiftInfo.isDay, selectedDate, workDateStr]);
  const [logs, setLogs]         = useState([]);
  const [fourMLogs, setFourMLogs] = useState([]);
  const [lines, setLines]       = useState([]);
  const [loading, setLoading]   = useState(true);

  const [empCounts, setEmpCounts] = useState({});   // { [line_id]: count }

  const [layouts,       setLayouts]       = useState([]);
  const [workstations,  setWorkstations]  = useState([]);
  const [stationEmpMap, setStationEmpMap] = useState({});
  const [expandedLine,  setExpandedLine]  = useState(null);
  const [prodStatus,    setProdStatus]    = useState([]);
  const [ctByMatNo,     setCtByMatNo]     = useState({});
  const [nameByMatNo,   setNameByMatNo]   = useState({});
  const [imgByMatNo,    setImgByMatNo]    = useState({});
  const [breakPolicies, setBreakPolicies] = useState([]);

  // โหลดเฉพาะข้อมูลผลิต/OEE จาก DR — เบากว่า fetchAll มาก ใช้กับ realtime
  const fetchProdStatus = useCallback(async () => {
    const todayStr = getWorkDateStr(new Date());
    const [{ data: sessions }, { data: breakPolicies }, { data: products }] = await Promise.all([
      supabaseDR
        .from('production_sessions')
        .select('id, line_name, shift, status, work_date, created_at, dr_products(name, target_per_shift, cycle_time_sec, process_type)')
        .eq('work_date', todayStr),
      supabaseDR.from('break_policies').select('*').eq('is_active', true),
      supabaseDR.from('dr_products').select('mat_no, name, cycle_time_sec, image_url').not('mat_no', 'is', null),
    ]);
    // production_sessions.product_id ไม่ได้ตั้งค่าเสมอ (กะนึงมีได้หลาย mat_no) — ใช้ map นี้
    // เป็น fallback หา cycle_time_sec รายออเดอร์จาก mat_no ตรง ๆ แทนการพึ่ง session.dr_products
    const ctMap = {};
    const nameMap = {};
    const imgMap = {};
    (products || []).forEach(p => { ctMap[p.mat_no] = p.cycle_time_sec || 0; nameMap[p.mat_no] = p.name || ''; imgMap[p.mat_no] = p.image_url || ''; });
    setCtByMatNo(ctMap);
    setNameByMatNo(nameMap);
    setImgByMatNo(imgMap);
    setBreakPolicies(breakPolicies || []);
    const sessionIds = (sessions || []).map(s => s.id);
    let ordersBySession = {}, dtBySession = {}, defectBySession = {};
    if (sessionIds.length > 0) {
      const [{ data: orders }, { data: dtLogs }, { data: defectLogs }] = await Promise.all([
        supabaseDR.from('prod_orders').select('session_id, status, qty, qty_ok, qty_actual, prod_no, part_name, mat_no, opened_at').in('session_id', sessionIds),
        supabaseDR.from('downtime_logs').select('session_id, duration_min, dr_downtime_types(category)').in('session_id', sessionIds),
        supabaseDR.from('defect_logs').select('session_id, qty_ng, qty_suspect').in('session_id', sessionIds),
      ]);
      (orders     || []).forEach(o => { (ordersBySession[o.session_id]  ||= []).push(o); });
      (dtLogs     || []).forEach(d => { (dtBySession[d.session_id]      ||= []).push(d); });
      (defectLogs || []).forEach(d => { (defectBySession[d.session_id]  ||= []).push(d); });
    }

    const computeSessionOEE = (s) => {
      const openedAt  = s.created_at ? new Date(s.created_at) : null;
      const closedAt  = new Date();
      if (!openedAt) return null;
      const shiftMin  = Math.round((closedAt - openedAt) / 60000);
      const dts       = dtBySession[s.id] || [];
      const plannedDT = dts.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
      const unplannedDT = dts.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
      // Policy breaks overlap
      const wDate = s.work_date;
      const policyBreak = (breakPolicies || [])
        .filter(p => p.shift === 'both' || p.shift === s.shift)
        .filter(p => p.process_type === 'common' || p.process_type === s.dr_products?.process_type)
        .reduce((sum, p) => {
          const [ph, pm] = (p.start_time || '00:00').split(':').map(Number);
          let pStart = new Date(`${wDate}T${String(ph).padStart(2,'0')}:${String(pm).padStart(2,'0')}:00`);
          const pEnd = new Date(pStart.getTime() + p.duration_min * 60000);
          if (pStart < openedAt && pEnd < openedAt) pStart = new Date(pStart.getTime() + 86400000);
          return sum + Math.max(0, (Math.min(pEnd, closedAt) - Math.max(pStart, openedAt)) / 60000);
        }, 0);
      const netAvail = Math.max(0, shiftMin - plannedDT - policyBreak);
      const runMin   = Math.max(0, netAvail - unplannedDT);
      const ctSec    = s.dr_products?.cycle_time_sec || 0;
      const produced = (ordersBySession[s.id] || []).filter(o => o.status === 'confirmed').reduce((a, o) => a + o.qty, 0);
      const ngQty    = (defectBySession[s.id] || []).reduce((a, d) => a + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
      const A = netAvail > 0 ? Math.min(1, runMin / netAvail) : 0;
      const P = (runMin > 0 && ctSec > 0) ? Math.min(1, (produced * ctSec / 60) / runMin) : (runMin > 0 ? 1 : 0);
      const Q = produced > 0 ? Math.max(0, (produced - ngQty) / produced) : 1;
      return { A, P, Q, oee: A * P * Q, runMin, netAvail, shiftMin };
    };

    const ps = (sessions || []).map(s => {
      const orders  = ordersBySession[s.id] || [];
      const active  = orders.filter(o => !['cancelled','imported'].includes(o.status));
      const demand  = active.reduce((sum, o) => sum + (o.qty || 0), 0);
      const actual  = active.filter(o => o.status === 'confirmed').reduce((sum, o) => sum + (o.qty_ok ?? o.qty ?? 0), 0);
      const target  = s.dr_products?.target_per_shift || 0;
      const oeeData = s.status === 'open' ? computeSessionOEE(s) : null;
      return { ...s, orders: active, demand, actual, target, oeeData };
    });
    setProdStatus(ps);
  }, []);

  const fetchAll = useCallback(async (date) => {
    setLoading(true);
    const [
      { data: logData },
      { data: fmData },
      { data: lineData },
      { data: empData },
      { data: scheduleData },
      { data: overrideData },
      { data: layoutData },
      { data: wsData },
      { data: hpData },
    ] = await Promise.all([
      supabase.from('daily_production_logs')
        .select('id, is_present, has_helmet, has_boots, has_gloves, has_ot, has_extended_ot, shift, assigned_line, employees!inner(id, name, image_url, employee_id_code, line_id, team, is_active, employee_skills(skill_name, score))')
        .eq('work_date', date)
        .eq('employees.is_active', true),
      supabase.from('four_m_logs').select('*').eq('work_date', date).order('created_at', { ascending: false }),
      supabase.from('production_lines').select('id, name, section, std_day_shift, std_night_shift').order('name'),
      supabase.from('employees').select('id, line_id, team').eq('is_active', true),
      supabase.from('shift_schedules').select('line_id, day_team').eq('work_date', date),
      supabase.from('shift_overrides').select('employee_id, shift').eq('work_date', date),
      supabase.from('line_layouts').select('line_name, image_url'),
      supabase.from('workstations').select('id, line_name, station_name, pos_top, pos_left, station_requirements(skill_name, min_score)'),
      supabase.from('employee_home_positions').select('employee_id, station_id, employees(id, name, image_url, position, employee_skills(skill_name, score))'),
    ]);

    // Build per-line day_team map
    const lineSchedule = {};
    (scheduleData || []).forEach(s => { lineSchedule[s.line_id] = s.day_team; });

    // Build per-employee override map
    const empOverride = {};
    (overrideData || []).forEach(o => { empOverride[o.employee_id] = o.shift; });

    // Enrich logs with assignedShift (same logic as Checkin.jsx)
    const enriched = (logData || []).map(log => {
      const emp = log.employees;
      let assignedShift = null;
      if (emp) {
        if (empOverride[emp.id]) {
          assignedShift = empOverride[emp.id];
        } else if (emp.line_id && lineSchedule[emp.line_id]) {
          const dayTeam = lineSchedule[emp.line_id];
          const nightTeam = dayTeam === 'A' ? 'B' : 'A';
          assignedShift = emp.team === dayTeam ? 'day' : emp.team === nightTeam ? 'night' : null;
        }
      }
      return { ...log, assignedShift };
    });

    setLogs(enriched);
    setFourMLogs(fmData || []);
    setLines(lineData || []);

    // Build line capacity using shift_schedules for correct day/night split
    const counts = {};
    (empData || []).forEach(emp => {
      if (!emp.line_id) return;
      if (!counts[emp.line_id]) counts[emp.line_id] = { day: 0, night: 0, all: 0 };
      counts[emp.line_id].all++;
      const dayTeam = lineSchedule[emp.line_id];
      if (!dayTeam) return;
      const nightTeam = dayTeam === 'A' ? 'B' : 'A';
      if (emp.team === dayTeam)   counts[emp.line_id].day++;
      else if (emp.team === nightTeam) counts[emp.line_id].night++;
    });
    setEmpCounts(counts);
    setLayouts(layoutData || []);
    setWorkstations(wsData || []);

    // Build skill fit lookups from NESTED data (same source as Management page,
    // avoids the 1000-row truncation that flat queries hit).
    // station_id → [{ skill_name, min_score }] from nested workstations
    const stationReqMap = {};
    (wsData || []).forEach(ws => {
      stationReqMap[String(ws.id)] = ws.station_requirements || [];
    });
    // employee_id → { skill_name: score } from nested employee_skills
    const empSkillMap = {};
    const addSkills = (emp) => {
      if (!emp?.id || empSkillMap[emp.id]) return;
      const m = {};
      (emp.employee_skills || []).forEach(s => { m[s.skill_name] = s.score; });
      empSkillMap[emp.id] = m;
    };
    (logData || []).forEach(l => addSkills(l.employees));
    (hpData || []).forEach(hp => addSkills(hp.employees));

    // Identical formula to Management.jsx computeFit: passed / total * 100
    const computeFit = (empId, stationId) => {
      const reqs = stationReqMap[String(stationId)];
      if (!reqs || reqs.length === 0) return null;
      const skills = empSkillMap[empId] || {};
      const passed = reqs.filter(r => Number(skills[r.skill_name] ?? 0) >= r.min_score).length;
      return Math.round((passed / reqs.length) * 100);
    };

    // Build stationEmpMap: station_id → employee + today's attendance + skill fit
    // Only present employees will be shown on the floor map
    const attMap = {};
    enriched.forEach(l => { if (l.employees?.id) attMap[l.employees.id] = l; });

    const semap = {};

    // 1st pass: home positions as baseline
    (hpData || []).forEach(hp => {
      if (!hp.employees) return;
      const att = attMap[hp.employee_id];
      semap[String(hp.station_id)] = {
        ...hp.employees,
        is_present:      att ? att.is_present      : null,
        has_ot:          att?.has_ot          ?? false,
        has_extended_ot: att?.has_extended_ot ?? false,
        assignedShift:   att?.assignedShift   ?? null,
        fitScore:        computeFit(hp.employee_id, hp.station_id),
      };
    });

    // 2nd pass: override with today's actual assigned_line (same source as Management page)
    enriched.forEach(l => {
      if (!l.assigned_line || !l.employees?.id) return;
      const stId = String(l.assigned_line);
      semap[stId] = {
        id:              l.employees.id,
        name:            l.employees.name,
        image_url:       l.employees.image_url ?? null,
        position:        l.employees.position  ?? null,
        is_present:      l.is_present,
        has_ot:          l.has_ot          ?? false,
        has_extended_ot: l.has_extended_ot ?? false,
        assignedShift:   l.assignedShift   ?? null,
        fitScore:        computeFit(l.employees.id, l.assigned_line),
      };
    });
    setStationEmpMap(semap);
    setLoading(false);

    // ข้อมูลผลิต/OEE โหลดแยก (เบากว่า) — realtime จะอัปเดตเฉพาะส่วนนี้
    fetchProdStatus();
  }, [fetchProdStatus]);

  useEffect(() => { fetchAll(selectedDate); }, [selectedDate, fetchAll]);

  // Auto-refresh ข้อมูลหลักทุก 5 นาที (พนักงาน/กะ/ทักษะเปลี่ยนไม่บ่อย)
  useEffect(() => {
    const t = setInterval(() => fetchAll(selectedDate), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [selectedDate, fetchAll]);

  // Realtime refresh เฉพาะข้อมูลผลิต — debounce 1.5s กัน event รัวๆ ตอนสแกนหลายใบติดกัน
  useEffect(() => {
    let timer = null;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetchProdStatus(), 1500);
    };
    const ch = supabaseDR.channel('dash-dr')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prod_orders' },         refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' },       refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'defect_logs' },         refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_sessions' }, refresh)
      .subscribe();
    return () => { clearTimeout(timer); supabaseDR.removeChannel(ch); };
  }, [fetchProdStatus]);

  // Determine OT windows based on current time (for live "today" view)
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const inDayOTWindow      = nowMin >= 17 * 60 + 30 && nowMin < 20 * 60;
  const inExtendedOTWindow = nowMin >= 20 * 60 && nowMin < 23 * 60;

  const sections = useMemo(() => [...new Set(lines.map(l => l.section).filter(Boolean))].sort(), [lines]);
  const visibleLines = useMemo(
    () => selectedSection === 'all' ? lines : lines.filter(l => l.section === selectedSection),
    [lines, selectedSection],
  );
  const visibleLineNames = useMemo(() => new Set(visibleLines.map(l => l.name)), [visibleLines]);
  const visibleLineIds   = useMemo(() => new Set(visibleLines.map(l => l.id)), [visibleLines]);

  const visibleFourMLogs = useMemo(
    () => selectedSection === 'all' ? fourMLogs : fourMLogs.filter(f => visibleLineNames.has(f.line_name)),
    [fourMLogs, selectedSection, visibleLineNames],
  );
  const visibleProdStatus = useMemo(
    () => selectedSection === 'all' ? prodStatus : prodStatus.filter(s => visibleLineNames.has(s.line_name)),
    [prodStatus, selectedSection, visibleLineNames],
  );
  const visibleLayouts = useMemo(
    () => selectedSection === 'all' ? layouts : layouts.filter(l => visibleLineNames.has(l.line_name)),
    [layouts, selectedSection, visibleLineNames],
  );

  /* Filter by assignedShift — memoized so the 1s clock tick doesn't re-filter all logs */
  const shiftLogs = useMemo(
    () => {
      const base = selectedShift === 'all' ? logs : logs.filter(l => l.assignedShift === selectedShift);
      return selectedSection === 'all' ? base : base.filter(l => visibleLineIds.has(l.employees?.line_id));
    },
    [logs, selectedShift, selectedSection, visibleLineIds],
  );

  const present  = useMemo(() => shiftLogs.filter(l =>  l.is_present), [shiftLogs]);
  const absent   = useMemo(() => shiftLogs.filter(l => !l.is_present), [shiftLogs]);
  const ppeReady = useMemo(() => present.filter(l => l.has_helmet && l.has_boots && l.has_gloves), [present]);
  const otCount  = useMemo(() => present.filter(l => l.has_ot).length, [present]);

  const shiftKey = selectedShift === 'all' ? 'all' : selectedShift;

  // Set of employee IDs to show on floor map — memoized, depends on logs/shift not clock
  const shiftEmpIds = useMemo(() => {
    if (selectedShift === 'all') return null;
    const ids = new Set(shiftLogs.map(l => l.employees?.id).filter(Boolean));
    if (selectedDate === workDateStr && selectedShift === 'night' && inExtendedOTWindow) {
      logs.filter(l => l.assignedShift === 'day' && l.has_extended_ot && l.is_present)
          .forEach(l => { if (l.employees?.id) ids.add(l.employees.id); });
    }
    return ids;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftLogs, logs, selectedShift, selectedDate, workDateStr, inExtendedOTWindow]);

  const lineStats = useMemo(() => visibleLines.map(line => {
    const lineLogs    = shiftLogs.filter(l => l.employees?.line_id === line.id);
    const linePresent = lineLogs.filter(l => l.is_present).length;
    const stdTotal = selectedShift === 'day'  ? (line.std_day_shift   || 0)
                   : selectedShift === 'night' ? (line.std_night_shift || 0)
                   : (line.std_day_shift || 0) + (line.std_night_shift || 0);
    const lineTotal = stdTotal > 0 ? stdTotal : (empCounts[line.id]?.[shiftKey] ?? lineLogs.length);
    const lineAlerts = fourMLogs.filter(f => f.line_name === line.name).length;
    const rate = lineTotal > 0 ? Math.round((linePresent / lineTotal) * 100) : 0;
    return { ...line, linePresent, lineTotal, lineAlerts, rate };
  }), [visibleLines, shiftLogs, selectedShift, empCounts, shiftKey, fourMLogs]);

  const totalCapacity = useMemo(() => lineStats.reduce((s, l) => s + l.lineTotal, 0) || shiftLogs.length, [lineStats, shiftLogs]);
  const attendRate    = useMemo(() => totalCapacity > 0 ? Math.round((present.length / totalCapacity) * 100) : 0, [totalCapacity, present]);
  const ppeRate       = useMemo(() => present.length > 0 ? Math.round((ppeReady.length / present.length) * 100) : 0, [present, ppeReady]);

  const isToday = selectedDate === workDateStr;

  return (
    <div className="page-content" style={{ maxWidth: '100%' }}>

      {/* ── Header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
        <motion.div {...stagger(0)}>
          <div style={{ fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Production Overview
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            {selectedShift !== 'all' && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: selectedShift === 'day' ? 'rgba(245,158,11,0.15)' : 'rgba(77,159,255,0.15)',
                color: selectedShift === 'day' ? '#f59e0b' : '#4d9fff',
                border: `1px solid ${selectedShift === 'day' ? 'rgba(245,158,11,0.3)' : 'rgba(77,159,255,0.3)'}`,
              }}>
                {selectedShift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'}
                {isToday && selectedShift === (shiftInfo.isDay ? 'day' : 'night') && ' · กะปัจจุบัน'}
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-display)' }}>
              {isToday
                ? now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : selectedDate}
            </span>
          </div>
        </motion.div>

        <motion.div {...stagger(1)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Section filter — สำหรับจอ TV ดูเฉพาะส่วนงานตัวเอง */}
          {sections.length > 1 && (
            <select
              value={selectedSection}
              onChange={e => changeSection(e.target.value)}
              style={{
                background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10,
                padding: '7px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text)',
                cursor: 'pointer', outline: 'none',
              }}>
              <option value="all">🏭 ทุกส่วนงาน</option>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {/* Shift toggle */}
          <div style={{ display: 'flex', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 3, gap: 2 }}>
            {[
              { val: 'day',   label: '☀️ กะเช้า', active: 'rgba(245,158,11,0.2)', color: '#f59e0b' },
              { val: 'night', label: '🌙 กะดึก',  active: 'rgba(77,159,255,0.2)', color: '#4d9fff' },
              { val: 'all',   label: 'ทั้งหมด',    active: 'rgba(255,255,255,0.1)', color: 'var(--text2)' },
            ].map(s => (
              <button key={s.val} onClick={() => setSelectedShift(s.val)}
                style={{
                  padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: selectedShift === s.val ? s.active : 'transparent',
                  color: selectedShift === s.val ? s.color : 'var(--muted)',
                  transition: 'all 0.15s',
                }}>
                {s.label}
              </button>
            ))}
          </div>
          {/* Date picker */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--card)', border: '1px solid var(--border2)',
            padding: '8px 14px', borderRadius: 10,
          }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>📅</span>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, outline: 'none', padding: 0 }} />
          </div>
        </motion.div>
      </div>

      {/* ── KPI Row ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isWide ? 'repeat(5, 1fr)' : 'repeat(auto-fit, minmax(140px, 1fr))', gap: isMobile ? 10 : 14, marginBottom: 24 }}>
        {[
          {
            label: 'พนักงานทั้งหมด', value: totalCapacity, unit: 'คน',
            sub: `เช็คชื่อแล้ว ${present.length + absent.length} / ${totalCapacity} คน`,
            accent: '#4d9fff', icon: '👥',
            radial: null,
          },
          {
            label: 'อัตราการมาทำงาน', value: attendRate, unit: '%',
            sub: `มา ${present.length} · ขาด ${absent.length}`,
            accent: attendRate >= 90 ? '#22c55e' : attendRate >= 75 ? '#f59e0b' : '#e74c3c',
            icon: '✅', radial: attendRate,
          },
          {
            label: 'PPE ครบถ้วน', value: ppeRate, unit: '%',
            sub: `${ppeReady.length} / ${present.length} คนที่มา`,
            accent: ppeRate >= 90 ? '#22c55e' : ppeRate >= 70 ? '#f59e0b' : '#e74c3c',
            icon: '🦺', radial: ppeRate,
          },
          {
            label: 'OT วันนี้', value: otCount, unit: 'คน',
            sub: present.length > 0 ? `${Math.round(otCount/present.length*100)}% ของคนที่มา` : 'ไม่มีข้อมูล',
            accent: '#f59e0b', icon: '⏰', radial: null,
          },
          {
            label: '4M Alerts', value: visibleFourMLogs.length, unit: 'รายการ',
            sub: visibleFourMLogs.length > 0 ? `${[...new Set(visibleFourMLogs.map(f => f.line_name))].length} ไลน์ได้รับผลกระทบ` : 'ไม่มีการแจ้งเตือน',
            accent: visibleFourMLogs.length > 0 ? '#e74c3c' : '#22c55e', icon: '🚨', radial: null,
          },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} {...stagger(i + 2)}>
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border2)',
              borderRadius: 14, padding: isMobile ? '14px 14px' : isWide ? '22px 24px' : '18px 20px',
              boxShadow: 'var(--shadow-sm)',
              borderTop: `3px solid ${kpi.accent}`,
              display: 'flex', flexDirection: 'column', gap: 4,
              position: 'relative', overflow: 'hidden',
              minHeight: isWide ? 130 : undefined,
            }}>
              <div style={{ position: 'absolute', top: 14, right: 16, opacity: 0.12, fontSize: isWide ? 56 : 42, lineHeight: 1, userSelect: 'none' }}>
                {kpi.icon}
              </div>
              <div style={{ fontSize: isWide ? 12 : 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {kpi.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                {kpi.radial !== null ? (
                  <div style={{ position: 'relative', width: isWide ? 72 : 60, height: isWide ? 72 : 60, flexShrink: 0 }}>
                    <RadialProgress pct={kpi.radial} size={isWide ? 72 : 60} stroke={isWide ? 7 : 6} color={kpi.accent} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isWide ? 15 : 13, fontWeight: 800, color: kpi.accent, fontFamily: 'var(--font-display)' }}>
                      {kpi.value}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: isWide ? 42 : 36, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', lineHeight: 1 }}>
                    {loading ? '—' : kpi.value}
                    <span style={{ fontSize: isWide ? 16 : 14, fontWeight: 500, color: 'var(--text2)', marginLeft: 4 }}>{kpi.unit}</span>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{kpi.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Line Status Grid ─────────────────────────────── */}
      <motion.div {...stagger(7)} style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          สถานะไลน์ผลิต
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isUltra ? 'repeat(auto-fill, minmax(200px, 1fr))' : isWide ? 'repeat(auto-fill, minmax(180px, 1fr))' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: isMobile ? 10 : 14 }}>
          {lineStats.map((line, i) => {
            const healthy = line.rate >= 80 && line.lineAlerts === 0;
            const warn    = line.lineAlerts > 0 || (line.rate > 0 && line.rate < 80);
            const color   = healthy ? '#22c55e' : warn ? '#f59e0b' : '#555';
            return (
              <motion.div key={line.id} {...stagger(8 + i)}>
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border2)',
                  borderRadius: 12, padding: isWide ? '18px 20px' : '14px 16px',
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: isWide ? 14 : 13, fontWeight: 700, color: 'var(--text)' }}>{line.name}</div>
                      {line.section && (
                        <div style={{ fontSize: 10, color: '#4d9fff', marginTop: 2, fontWeight: 600 }}>{line.section}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', background: color,
                        boxShadow: `0 0 6px ${color}`,
                      }} />
                      {line.lineAlerts > 0 && (
                        <div style={{
                          fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6,
                          background: 'rgba(231,76,60,0.15)', color: '#e74c3c',
                          border: '1px solid rgba(231,76,60,0.3)',
                        }}>
                          🚨 {line.lineAlerts}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: isWide ? 32 : 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
                      {line.linePresent}
                    </span>
                    <span style={{ fontSize: isWide ? 13 : 11, color: 'var(--muted)' }}>/ {line.lineTotal} คน</span>
                  </div>

                  <MiniBar value={line.linePresent} max={line.lineTotal} color={color} />

                  <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color }}>
                    {line.lineTotal === 0 ? 'ไม่มีข้อมูล' : `${line.rate}% Attendance ${healthy ? '· ✓ Normal' : line.lineAlerts > 0 ? '· ⚠ Risk' : ''}`}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* ── Heijunka Timeline Board ───────────────────── */}
      {visibleProdStatus.length > 0 && (() => {
        const HOURS   = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6,7];
        const LEFT_W  = 136;
        const nowMs   = now.getTime();

        const wd = visibleProdStatus[0]?.work_date || new Date().toISOString().slice(0, 10);
        const gridStartMs = new Date(`${wd}T08:00:00`).getTime();

        const fmtMs = (ms) => {
          const d = new Date(ms);
          return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        };

        // group sessions by line
        const byLine = {};
        visibleProdStatus.forEach(s => {
          (byLine[s.line_name] = byLine[s.line_name] || []).push(s);
        });

        return (
          <motion.div {...stagger(8)} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              📊 Heijunka Board — ไทม์ไลน์การผลิต
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, padding: '6px 10px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border2)' }}>
              {[
                { c: '#4d9fff', icon: '▶', label: 'กำลังผลิต' },
                { c: '#22c55e', icon: '✓', label: 'เสร็จแล้ว' },
                { c: '#ef4444', icon: '!', label: 'ล่าช้า' },
                { c: '#f59e0b', icon: '↷', label: 'ยกยอดข้ามกะ' },
                { c: '#6b7280', icon: '⏪', label: 'ยิงย้อนหลัง (backfill)' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, background: `${item.c}28`, border: `1.5px solid ${item.c}cc`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: item.c, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{item.label}</span>
                </div>
              ))}
            </div>

            {Object.entries(byLine).map(([lineName, sessions]) => {
              const hasOpen = sessions.some(s => s.status === 'open');
              const totalDelayed = sessions.reduce((acc, s) => {
                const ctSec = s.dr_products?.cycle_time_sec || 0;
                if (!ctSec || s.status !== 'open') return acc;
                const startMs = s.created_at ? new Date(s.created_at).getTime() : null;
                if (!startMs) return acc;
                let cum = 0;
                s.orders.forEach(o => {
                  cum += (o.qty || 0) * ctSec;
                  if (o.status === 'open' && nowMs > startMs + cum * 1000) acc++;
                });
                return acc;
              }, 0);

              return (
                <div key={lineName} style={{
                  marginBottom: 16,
                  background: 'var(--card)',
                  border: `1px solid ${totalDelayed > 0 ? 'rgba(239,68,68,0.45)' : hasOpen ? 'rgba(34,197,94,0.35)' : 'var(--border2)'}`,
                  borderRadius: 12, overflow: 'hidden',
                  boxShadow: totalDelayed > 0 ? '0 0 0 1px rgba(239,68,68,0.12)' : hasOpen ? '0 0 0 1px rgba(34,197,94,0.08)' : 'none',
                }}>

                  {/* ── Line header ── */}
                  <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{lineName}</span>
                      {totalDelayed > 0 && (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                          ⚠️ ดีเลย์ {totalDelayed} ใบ
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {sessions.map(s => (
                        <span key={s.id} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                          background: s.status === 'open' ? 'rgba(34,197,94,0.15)' : 'rgba(128,128,128,0.12)',
                          color: s.status === 'open' ? '#22c55e' : '#888' }}>
                          {s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} {s.status === 'open' ? '● Live' : '✓ ปิดแล้ว'}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* ── Timeline grid: split 24h → 2 rows × 12h, แยกแถวตาม product ── */}
                  {(() => {
                    const pctPerMs = 100 / (12 * 3600000);
                    const HALVES = [
                      { key: 'am', hours: HOURS.slice(0, 12), startMs: gridStartMs },
                      { key: 'pm', hours: HOURS.slice(12), startMs: gridStartMs + 12 * 3600000 },
                    ];

                    // flatten ทุกออเดอร์ของทุก session ในไลน์ พร้อม timing + product key
                    const buildCards = (sessList) => {
                      const cards = [];
                      sessList.forEach(s => {
                        const sessionCtSec = s.dr_products?.cycle_time_sec || 0;
                        const sessionStartMs = s.created_at ? new Date(s.created_at).getTime() : null;
                        const sorted = [...s.orders].sort((a, b) => new Date(a.opened_at || 0) - new Date(b.opened_at || 0));
                        let cumSec = 0;
                        sorted.forEach(o => {
                          // session.dr_products มาจาก product_id ที่อาจไม่ถูกตั้งค่า (กะนึงมีได้หลาย mat_no)
                          // จึง fallback ไปหา cycle_time_sec ตรงจาก mat_no ของออเดอร์เอง
                          const ctSec = ctByMatNo[o.mat_no] || sessionCtSec || 0;
                          // ถ้ามี opened_at ใช้เวลาจริงเป็น start แทนการสะสมจาก session start
                          const openedMs = o.opened_at ? new Date(o.opened_at).getTime() : null;
                          const startSec = cumSec;
                          cumSec += (o.qty || 0) * ctSec;
                          let orderStartMs = openedMs || (sessionStartMs && ctSec > 0 ? sessionStartMs + startSec * 1000 : null);
                          let orderEndMs   = orderStartMs && ctSec > 0 ? orderStartMs + (o.qty || 0) * ctSec * 1000 : null;
                          if (orderStartMs && !orderEndMs) {
                            // ไม่รู้ cycle time จริง ๆ — ให้แสดงเป็นแท่งบาง ๆ แทนการซ่อนไปเลย
                            orderEndMs = orderStartMs + 5 * 60000;
                          }
                          const isDone    = o.status === 'confirmed';
                          const isCarry   = o.status === 'carry_over';
                          const isDelayed = !isDone && !isCarry && !!orderEndMs && nowMs > orderEndMs;
                          const productKey = o.mat_no || s.dr_products?.name || 'unknown';
                          const productLabel = nameByMatNo[o.mat_no] || s.dr_products?.name || o.mat_no || 'ไม่ทราบ P/N';
                          const productImg = imgByMatNo[o.mat_no] || '';
                          cards.push({ ...o, orderStartMs, orderEndMs, isDone, isCarry, isDelayed, productKey, productLabel, productImg, shift: s.shift, sessionOpen: s.status === 'open' });
                        });
                      });
                      return cards;
                    };

                    const allCards = buildCards(sessions);

                    // แยกแถวตาม mat_no/product — เพื่อไม่ให้ product ต่างกัน (เช่น RH60 / LH61) ปนแถวเดียวกัน
                    const groups = {};
                    allCards.forEach(c => {
                      (groups[c.productKey] = groups[c.productKey] || { key: c.productKey, label: c.productLabel, img: c.productImg, cards: [] }).cards.push(c);
                    });
                    const productRows = Object.values(groups).sort((a, b) => a.label.localeCompare(b.label));

                    const hourHeader = (hours, halfStartMs) => (
                      <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)' }}>
                        <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid var(--border2)', padding: '5px 8px', fontSize: 9, fontWeight: 700, color: 'var(--muted)' }}>
                          กะ / ผลิต
                        </div>
                        {hours.map((h, i) => {
                          const slotMs = halfStartMs + i * 3600000;
                          const isNow = nowMs >= slotMs && nowMs < slotMs + 3600000;
                          const isShiftBound = h === 8 || h === 20;
                          return (
                            <div key={i} style={{
                              flex: 1, minWidth: 0, textAlign: 'center',
                              fontSize: 9, fontWeight: isNow ? 800 : isShiftBound ? 600 : 400,
                              color: isNow ? '#4d9fff' : isShiftBound ? 'var(--text2)' : 'var(--muted)',
                              padding: '5px 0', lineHeight: 1,
                              borderRight: `1px solid ${isShiftBound ? 'var(--border2)' : 'var(--border)'}`,
                              background: isNow ? 'rgba(77,159,255,0.12)' : 'transparent',
                            }}>
                              {String(h).padStart(2,'0')}:00
                              {isNow && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#4d9fff', margin: '2px auto 0' }} />}
                            </div>
                          );
                        })}
                      </div>
                    );

                    // เรียงตามเวลาเริ่มจริง แล้วต่อคิวในแถวเดียวกัน (ไม่สร้างแถวใหม่) — แต่ละการ์ดเริ่มได้ไม่ก่อนการ์ดก่อนหน้าสิ้นสุด
                    // เพราะ 1 ไลน์ผลิตได้ทีละใบ ความกว้างคำนวณจากเวลาผลิตจริง (cycle_time × qty)
                    const renderTimeline = (cards, half, rowKey) => (
                      <div key={rowKey} style={{ flex: 1, position: 'relative', display: 'flex' }}>
                        {half.hours.map((h, i) => {
                          const slotMs = half.startMs + i * 3600000;
                          const isNow = nowMs >= slotMs && nowMs < slotMs + 3600000;
                          const isShiftBound = h === 8 || h === 20;
                          return (
                            <div key={i} style={{
                              flex: 1, minWidth: 0, height: '100%',
                              borderRight: `1px solid ${isShiftBound ? 'var(--border2)' : 'var(--border)'}`,
                              background: isNow ? 'rgba(77,159,255,0.06)' : 'transparent',
                              boxSizing: 'border-box',
                            }} />
                          );
                        })}
                        {(() => {
                          return breakPolicies
                            .filter(p => p.shift === 'both' || (p.shift === 'day' && half.key === 'am') || (p.shift === 'night' && half.key === 'pm'))
                            .map((p, pi) => {
                              const idx = half.hours.indexOf(Number(String(p.start_time).slice(0,2)));
                              if (idx < 0) return null;
                              const mins = Number(String(p.start_time).slice(3,5)) || 0;
                              const breakStartMs = half.startMs + idx * 3600000 + mins * 60000;
                              const leftPct = Math.max(0, (breakStartMs - half.startMs) * pctPerMs);
                              const widthPct = Math.min(100 - leftPct, (p.duration_min || 0) * 60000 * pctPerMs);
                              if (widthPct <= 0) return null;
                              return (
                                <div key={`brk-${pi}`} title={`${p.name_th || p.name_en} — ไลน์ไม่รองรับ KANBAN`}
                                  style={{
                                    position: 'absolute', top: 0, bottom: 0,
                                    left: `${leftPct}%`, width: `${widthPct}%`,
                                    background: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)',
                                    borderLeft: '1px dashed rgba(148,163,184,0.6)', borderRight: '1px dashed rgba(148,163,184,0.6)',
                                    zIndex: 0, pointerEvents: 'none',
                                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden',
                                  }}>
                                  <span style={{ fontSize: 6, fontWeight: 700, color: 'var(--muted)', writingMode: widthPct < 3 ? 'vertical-rl' : 'horizontal-tb', whiteSpace: 'nowrap', marginBottom: 1 }}>
                                    🚫{p.name_th || p.name_en}
                                  </span>
                                </div>
                              );
                            });
                        })()}
                        {(() => {
                          const MIN_W_PCT = 1.5;
                          const sorted = cards
                            .filter(o => o.orderStartMs && o.orderEndMs && o.orderEndMs > half.startMs && o.orderStartMs < half.startMs + 12 * 3600000)
                            .sort((a, b) => a.orderStartMs - b.orderStartMs);
                          let queueEndMs = -Infinity;
                          const positioned = sorted.map(o => {
                            const durationMs = Math.max(o.orderEndMs - o.orderStartMs, 0);
                            const startMs = Math.max(o.orderStartMs, queueEndMs);
                            const endMs = startMs + durationMs;
                            queueEndMs = endMs;
                            const leftPct = Math.max(0, (startMs - half.startMs) * pctPerMs);
                            const rightPct = Math.min(100, (endMs - half.startMs) * pctPerMs);
                            const widthPct = Math.max(MIN_W_PCT, rightPct - leftPct);
                            return { o, leftPct, widthPct };
                          });
                          return positioned.map(({ o, leftPct, widthPct }, oi) => {
                          if (leftPct >= 100) return null;
                          const statusColor = o.isDone ? '#22c55e' : o.isDelayed ? '#ef4444' : o.isCarry ? '#f59e0b' : '#4d9fff';
                          const icon = o.isDone ? '✓' : o.isDelayed ? '!' : o.isCarry ? '↷' : '▶';
                          const doneQty  = o.isDone ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
                          const pctBlock = (o.qty || 0) > 0 ? Math.min((doneQty / o.qty) * 100, 100) : (o.isDone ? 100 : 0);
                          return (
                            <div key={o.prod_no || oi} title={`${o.prod_no || ''} ${o.mat_no || ''} — ${o.qty}ชิ้น${o.isDelayed ? ` ⚠️ช้า${Math.round((nowMs-o.orderEndMs)/60000)}ม.` : o.isDone ? ' ✓เสร็จ' : ` →${fmtMs(o.orderEndMs)}`}`}
                              style={{
                                position: 'absolute', top: 4, bottom: 4,
                                left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 24,
                                background: `${statusColor}28`,
                                border: `1.5px solid ${statusColor}${o.isDone ? 'cc' : o.isDelayed ? 'dd' : '88'}`,
                                borderRadius: 4, overflow: 'hidden',
                                boxShadow: o.isDelayed ? `0 0 6px ${statusColor}44` : 'none',
                                cursor: 'default', zIndex: 1,
                              }}>
                              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pctBlock}%`, background: `${statusColor}22`, transition: 'width 0.5s ease' }} />
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 3px', overflow: 'hidden' }}>
                                <div style={{ fontSize: 8, fontWeight: 800, color: statusColor, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {icon} {o.prod_no || (oi + 1)}
                                </div>
                                <div style={{ fontSize: 7, color: 'var(--muted)', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {o.qty}ชิ้น
                                </div>
                              </div>
                            </div>
                          );
                          });
                        })()}
                        {/* Now marker */}
                        {nowMs >= half.startMs && nowMs < half.startMs + 12 * 3600000 && (() => {
                          const nowPct = (nowMs - half.startMs) * pctPerMs;
                          return <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${nowPct}%`, width: 1.5, background: 'rgba(77,159,255,0.7)', zIndex: 2, pointerEvents: 'none' }} />;
                        })()}
                      </div>
                    );

                    return HALVES.map(half => (
                      <div key={half.key} style={{ borderTop: half.key === 'pm' ? '2px solid var(--border2)' : 'none' }}>
                        {hourHeader(half.hours, half.startMs)}
                        {productRows.map((row, ri) => {
                          const cards = row.cards.filter(c => c.orderEndMs > half.startMs && c.orderStartMs < half.startMs + 12 * 3600000);
                          const rowActual = row.cards.reduce((a, c) => a + (c.isDone ? (c.qty_ok ?? c.qty ?? 0) : (c.qty_actual ?? 0)), 0);
                          const rowDemand = row.cards.reduce((a, c) => a + (c.qty || 0), 0);
                          const doneCount = row.cards.filter(c => c.isDone).length;
                          const delayed   = cards.filter(c => c.isDelayed).length;
                          const isOpen    = row.cards.some(c => c.sessionOpen);
                          const pct       = rowDemand > 0 ? Math.min((rowActual / rowDemand) * 100, 100) : 0;
                          const barColor  = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';

                          return (
                            <div key={row.key} style={{ display: 'flex', minHeight: 36, borderTop: ri > 0 ? '1px solid var(--border2)' : 'none' }}>
                              {/* Left summary */}
                              <div style={{ width: LEFT_W, flexShrink: 0, padding: '3px 8px', borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {row.img && <img src={row.img} alt="" style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: LEFT_W - 16 }}>{row.label}</span>
                                  {delayed > 0 && <span style={{ fontSize: 8, color: '#ef4444', fontWeight: 700 }}>⚠️{delayed}ใบ</span>}
                                  {isOpen && delayed === 0 && <span style={{ fontSize: 7, color: '#22c55e', fontWeight: 700 }}>● Live</span>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                                  <span style={{ fontSize: 12, fontWeight: 900, color: barColor, lineHeight: 1 }}>{rowActual}</span>
                                  <span style={{ fontSize: 8, color: 'var(--muted)' }}>/{rowDemand} ชิ้น</span>
                                  <span style={{ fontSize: 8, color: 'var(--muted)' }}>{doneCount}/{row.cards.length}ใบ</span>
                                </div>
                                </div>
                              </div>
                              {renderTimeline(cards, half, `${half.key}-${ri}`)}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}

                  {/* ── Footer: per-session progress + OEE ── */}
                  <div style={{ padding: '8px 14px 10px', borderTop: '1px solid var(--border2)', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    {sessions.map(s => {
                      const pct      = s.demand > 0 ? Math.min((s.actual / s.demand) * 100, 100) : 0;
                      const tpct     = s.target > 0 ? Math.min((s.actual / s.target) * 100, 100) : 0;
                      const barColor = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
                      const oee      = s.oeeData;
                      const oeeColor = !oee ? '#888' : oee.oee >= 0.85 ? '#22c55e' : oee.oee >= 0.65 ? '#f59e0b' : '#ef4444';
                      const doneCount = s.orders.filter(o => o.status === 'confirmed').length;

                      return (
                        <div key={s.id} style={{ flex: '1 1 200px', minWidth: 180 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'}</span>
                              <span style={{ fontSize: 20, fontWeight: 900, color: barColor, lineHeight: 1 }}>{s.actual}</span>
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>/ {s.demand} ชิ้น</span>
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{doneCount}/{s.orders.length} ใบ</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              {s.target > 0 && <span style={{ fontSize: 10, color: tpct >= 100 ? '#22c55e' : 'var(--muted)' }}>เป้า {tpct.toFixed(0)}%</span>}
                              <span style={{ fontSize: 13, fontWeight: 800, color: barColor }}>{pct.toFixed(0)}%</span>
                              {oee && <span style={{ fontSize: 13, fontWeight: 800, color: oeeColor }}>OEE {(oee.oee * 100).toFixed(0)}%</span>}
                            </div>
                          </div>
                          <div style={{ height: 5, borderRadius: 3, background: 'var(--border2)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.7s ease' }} />
                          </div>
                          {oee && s.status === 'open' && (
                            <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
                              {[{ l: 'A', v: oee.A, t: 'Availability' }, { l: 'P', v: oee.P, t: 'Performance' }, { l: 'Q', v: oee.Q, t: 'Quality' }].map(k => {
                                const c = k.v >= 0.85 ? '#22c55e' : k.v >= 0.65 ? '#f59e0b' : '#ef4444';
                                return (
                                  <span key={k.l} title={k.t} style={{ fontSize: 10, color: c, fontWeight: 700 }}>
                                    {k.l} {(k.v * 100).toFixed(0)}%
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </div>
              );
            })}
          </motion.div>
        );
      })()}

      {/* ── Bottom Grid ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isUltra ? 'minmax(0,3fr) minmax(0,1fr)' : 'minmax(0,2fr) minmax(0,1fr)', gap: isWide ? 20 : 16 }}>

        {/* Line Floor Maps */}
        <motion.div {...stagger(12)}>
          <div className="card" style={{ padding: 20, height: '100%' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 16 }}>
              🏭 Line Floor Maps
            </div>
            {visibleLayouts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
                ยังไม่มีผัง — ไปตั้งค่าที่หน้า <strong>ตั้งค่าผังไลน์</strong>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isUltra ? 'repeat(3, 1fr)' : '1fr 1fr', gap: isWide ? 14 : 12 }}>
                {visibleLayouts.map(layout => {
                  const lineWs = workstations.filter(w => w.line_name === layout.line_name);
                  const lineStaff = lineWs.map(ws => stationEmpMap[String(ws.id)]).filter(e => e && (!shiftEmpIds || shiftEmpIds.has(e.id)));
                  // Use lineStats (same source as KPI cards) for the footer counts
                  const lineStat = lineStats.find(l => l.name === layout.line_name);
                  const footerPresent = lineStat ? lineStat.linePresent : lineStaff.filter(e => e.is_present === true).length;
                  const footerTotal   = lineStat ? lineStat.lineTotal   : lineStaff.length;
                  const footerAbsent  = lineStat ? (footerTotal - footerPresent) : lineStaff.filter(e => e.is_present === false).length;
                  return (
                    <div
                      key={layout.line_name}
                      onClick={() => setExpandedLine(layout.line_name)}
                      style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border2)', background: '#111' }}
                    >
                      {/* Map thumbnail */}
                      <div style={{ position: 'relative', aspectRatio: '16/9' }}>
                        <img
                          src={layout.image_url}
                          alt={layout.line_name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.65 }}
                        />
                        {lineWs.map(ws => {
                          const emp = stationEmpMap[String(ws.id)];
                          if (!emp) return null;
                          if (shiftEmpIds && !shiftEmpIds.has(emp.id)) return null;
                          // Only show employees who are present
                          if (emp.is_present !== true) return null;
                          const fit = emp.fitScore;
                          const fitLv = getFitLevel(fit);
                          const color = fitLv ? fitLv.color : '#aaa';
                          return (
                            <div key={ws.id} style={{
                              position: 'absolute', top: ws.pos_top, left: ws.pos_left,
                              transform: 'translate(-50%, -50%)',
                              zIndex: 2,
                            }}>
                              <div style={{
                                width: 26, height: 26, borderRadius: '50%',
                                border: `2px solid ${color}`,
                                boxShadow: `0 0 6px ${color}88`,
                                overflow: 'hidden',
                                background: '#1a1a1a',
                              }}>
                                {emp.image_url
                                  ? <img src={emp.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color }}>{(emp.name || '?')[0]}</div>
                                }
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Line label */}
                      <div style={{ padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>
                          {layout.line_name}
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '2px 6px', borderRadius: 4 }}>✓ {footerPresent}/{footerTotal}</span>
                          {footerAbsent > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#e74c3c', background: 'rgba(231,76,60,0.12)', padding: '2px 6px', borderRadius: 4 }}>✗ {footerAbsent}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* 4M Activity Feed */}
        <motion.div {...stagger(13)}>
          <div className="card" style={{ padding: 20, height: '100%' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 16 }}>
              4M Activity Feed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: isWide ? 600 : 420, overflowY: 'auto' }}>
              <AnimatePresence>
                {visibleFourMLogs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>ไม่มีการแจ้งเตือน 4M</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, opacity: 0.6 }}>สถานะปกติ</div>
                  </div>
                ) : visibleFourMLogs.map((log, i) => {
                  const meta = getCatMeta(log.category);
                  return (
                    <motion.div key={log.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                      <div style={{
                        padding: '10px 12px', borderRadius: 10,
                        background: meta.bg,
                        border: `1px solid ${meta.color}22`,
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                      }}>
                        <div style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{meta.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{log.category}</span>
                            <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{log.line_name}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 3, lineHeight: 1.4 }}>
                            {log.description}
                          </div>
                          {log.created_at && (
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                              {new Date(log.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Expanded Line Map Modal */}
      {expandedLine && (() => {
        const layout = layouts.find(l => l.line_name === expandedLine);
        const lineWs = workstations.filter(w => w.line_name === expandedLine);
        if (!layout) return null;
        return (
          <div
            className="overlay"
            onClick={() => setExpandedLine(null)}
            style={{ zIndex: 1000 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--card)',
                borderRadius: 14,
                padding: 20,
                width: 'min(90vw, 900px)',
                maxHeight: '90vh',
                overflow: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                  🏭 {expandedLine}
                </div>
                <button
                  onClick={() => setExpandedLine(null)}
                  style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', padding: '0 4px' }}
                >✕</button>
              </div>
              <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#111' }}>
                <img
                  src={layout.image_url}
                  alt={expandedLine}
                  style={{ width: '100%', display: 'block', opacity: 0.7 }}
                />
                {lineWs.map(ws => {
                  const emp = stationEmpMap[String(ws.id)];
                  if (!emp) return null;
                  if (shiftEmpIds && !shiftEmpIds.has(emp.id)) return null;
                  // Only show present employees on the map
                  if (emp.is_present !== true) return null;
                  const fit = emp.fitScore;
                  const fitLv = getFitLevel(fit);
                  const color = fitLv ? fitLv.color : '#aaa';
                  const shortName = (emp.name || '').split(' ')[0];
                  return (
                    <div key={ws.id} style={{
                      position: 'absolute', top: ws.pos_top, left: ws.pos_left,
                      transform: 'translate(-50%, -50%)',
                      zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        border: `2.5px solid ${color}`,
                        boxShadow: `0 0 10px ${color}99`,
                        overflow: 'hidden', background: '#1a1a1a',
                      }}>
                        {emp.image_url
                          ? <img src={emp.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>{(emp.name || '?')[0]}</div>
                        }
                      </div>
                      <div style={{
                        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
                        borderRadius: 4, padding: '1px 5px',
                        fontSize: 9, fontWeight: 700, color: '#fff',
                        whiteSpace: 'nowrap', maxWidth: 60,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{shortName}</div>
                      {fit !== null && (
                        <div style={{ fontSize: 8, fontWeight: 800, color, background: `${color}25`, padding: '1px 4px', borderRadius: 3 }}>{fit}%</div>
                      )}
                      {emp.has_extended_ot && (
                        <div style={{ fontSize: 8, fontWeight: 800, color: '#ef4444', background: 'rgba(239,68,68,0.2)', padding: '1px 4px', borderRadius: 3 }}>OT+23</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Legend — same as skill matrix */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Skill Fit:</span>
                {SKILL_LEVELS.map(lv => (
                  <div key={lv.min} style={{ display: 'flex', alignItems: 'center', gap: 5, background: lv.bg, borderRadius: 6, padding: '3px 8px' }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: lv.color, boxShadow: `0 0 4px ${lv.color}` }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: lv.color }}>{lv.min}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{lv.label}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, borderRadius: 6, padding: '3px 8px', background: 'rgba(128,128,128,0.1)' }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#aaa' }} />
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>ไม่มีข้อกำหนด</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Pill({ label, color }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      color, background: `${color}18`, border: `1px solid ${color}40`,
    }}>{label}</div>
  );
}

function AttendCol({ title, color, items, absent }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title} ({items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
        {items.map(l => (
          <div key={l.id} style={{
            padding: '6px 10px', borderRadius: 7,
            background: 'var(--bg3)',
            borderLeft: `3px solid ${color}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: `${color}20`, border: `1px solid ${color}40`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 800, color, flexShrink: 0,
            }}>
              {(l.employees?.name || '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.employees?.name || '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                {absent ? 'ขาดงาน' : (l.has_helmet && l.has_boots && l.has_gloves ? '🟢 PPE ครบ' : '🟡 PPE ไม่ครบ')}
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>ไม่มีข้อมูล</div>
        )}
      </div>
    </div>
  );
}
