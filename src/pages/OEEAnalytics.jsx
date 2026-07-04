import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, ComposedChart, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, ReferenceLine, LabelList,
} from 'recharts';
import { supabase, supabaseDR } from '../supabaseClient';

// ── Colour helpers ───────────────────────────────────────────────
const oeeColor  = v => v >= 80 ? '#22c55e' : v >= 60 ? '#f59e0b' : '#ef4444';
const aColor    = v => v >= 90 ? '#22c55e' : v >= 75 ? '#f59e0b' : '#ef4444';
const pColor    = v => v >= 85 ? '#22c55e' : v >= 70 ? '#f59e0b' : '#ef4444';
const qColor    = v => v >= 99 ? '#22c55e' : v >= 95 ? '#f59e0b' : '#ef4444';

const UNPLAN_COLORS = ['#ef4444','#f97316','#eab308','#84cc16','#06b6d4','#8b5cf6','#ec4899','#6b7280','#a78bfa'];
const PLAN_COLORS   = ['#60a5fa','#34d399','#fb7185','#fbbf24'];

// เป้าหมายมาตรฐานของแต่ละตัวชี้วัด — ใช้แสดงเส้น Target บนกราฟ/เกจ
const TARGET = { oee: 85, a: 90, p: 90, q: 99 };
const METRIC_COLOR = { a: '#22c55e', p: '#f59e0b', q: '#a78bfa' };
const METRIC_LABEL = { a: 'AVAILABILITY (A)', p: 'PERFORMANCE (P)', q: 'QUALITY (Q)' };
const METRIC_COLOR_FN = { a: aColor, p: pColor, q: qColor };

// ── OEE calculation helpers ──────────────────────────────────────
// หมายเหตุ: A/P/Q/OEE คำนวณและบันทึกไว้แล้วใน production_sessions (oee_a/oee_p/oee_q/oee)
// ตอนปิดกะจาก DailyReport.jsx ซึ่งคิดรวม break_policies และ CT ต่อ MAT.NO อย่างถูกต้องแล้ว
// ห้ามคำนวณซ้ำด้วยสูตรอย่างง่ายที่นี่ เพราะจะได้ตัวเลขคนละชุดกับหน้า Daily Report
function calcOEE(sessions, downtimes, defects) {
  const results = [];
  for (const s of sessions) {
    const sessionDT = downtimes.filter(d => d.session_id === s.id);
    const sessionDefects = defects.filter(d => d.session_id === s.id);

    const plannedMin   = sessionDT.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
    const unplannedMin = sessionDT.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);

    const ngQty = sessionDefects.reduce((a, d) => a + (d.qty_ng || 0), 0) + (s.qty_ng || 0);
    const totalQty = s.actual_qty || 0;
    const okQty = s.qty_ok || Math.max(0, totalQty - ngQty);

    results.push({
      ...s,
      calcA: s.oee_a != null ? +Number(s.oee_a).toFixed(1) : null,
      calcP: s.oee_p != null ? +Number(s.oee_p).toFixed(1) : null,
      calcQ: s.oee_q != null ? +Number(s.oee_q).toFixed(1) : null,
      calcOEE: s.oee  != null ? +Number(s.oee).toFixed(1)  : null,
      unplannedMin: +unplannedMin.toFixed(1),
      plannedMin:   +plannedMin.toFixed(1),
      dtBreakdown: sessionDT,
      defectBreakdown: sessionDefects,
      ngQty, okQty, totalQty,
    });
  }
  return results;
}

// ── Date helpers ─────────────────────────────────────────────────
// ⚠️ ห้ามใช้ toISOString() เพื่อคำนวณวันที่ local — จะเพี้ยนข้ามวันเพราะ UTC offset (ดู CLAUDE.md)
const fmtMonthKey = d => d.slice(0, 7);          // YYYY-MM
const fmtYearKey  = d => d.slice(0, 4);          // YYYY
const thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const fmtMonthLabel = k => { const [y, m] = k.split('-'); return `${thMonths[+m - 1]} ${(+y + 543).toString().slice(-2)}`; };
const fmtDayLabel   = d => { const [,m,dd] = d.split('-'); return `${+dd}/${+m}`; };
const fmtThaiDate   = d => { if (!d) return '—'; const [y,m,dd] = d.split('-').map(Number); return `${dd} ${thMonths[m-1]} ${y+543}`; };

function getWorkDateStr(date = new Date()) {
  const h = date.getHours();
  const d = new Date(date);
  if (h < 8) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function dateStrAdd(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ── KPI Card ─────────────────────────────────────────────────────
const KpiCard = ({ label, value, color, sub }) => (
  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', minWidth: 110, flex: 1 }}>
    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 900, color: color || 'var(--text)', lineHeight: 1 }}>{value ?? '—'}{value != null ? '%' : ''}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
  </div>
);

// ── Custom tooltip ───────────────────────────────────────────────
const OEETooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>{p.name}: {p.value?.toFixed(1)}%</div>
      ))}
    </div>
  );
};

// ── Gauge ring (SVG, no deps) ─────────────────────────────────────
function GaugeRing({ value, size = 168, stroke = 15, color = '#22c55e' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  );
}

// ── Mini sparkline bar (under A/P/Q kpi) ──────────────────────────
function MiniTrend({ data, dataKey, color, target }) {
  const hasData = data.some(d => d[dataKey] != null);
  if (!hasData) return <div style={{ height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)' }}>ไม่มีข้อมูล</div>;
  return (
    <ResponsiveContainer width="100%" height={54}>
      <BarChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <ReferenceLine y={target} stroke={color} strokeDasharray="3 3" strokeOpacity={0.6} />
        <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} opacity={0.85} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Vertical metric bar (Live session card) ───────────────────────
function MetricColumn({ label, value, target, color }) {
  const H = 130;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const barH = (pct / 100) * H;
  const targetTop = H - (target / 100) * H;
  return (
    <div style={{ textAlign: 'center', width: 70 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ position: 'relative', width: 44, height: H, margin: '0 auto', background: 'var(--bg2)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: barH, background: color, transition: 'height .5s ease' }} />
        <div style={{ position: 'absolute', left: -1, right: -1, top: targetTop, borderTop: '2px dashed rgba(255,255,255,0.55)' }} />
      </div>
      <div style={{ marginTop: 6, fontWeight: 900, fontSize: 15, color }}>{value != null ? value.toFixed(1) : '—'}%</div>
    </div>
  );
}

const STATUS_BADGE = {
  open:          { label: '● RUNNING',    bg: 'rgba(34,197,94,0.15)',  color: '#22c55e' },
  pending_close: { label: '◐ รออนุมัติปิด', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  closed:        { label: '■ ปิดกะแล้ว',   bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' },
};

// ── Main Component ───────────────────────────────────────────────
export default function OEEAnalytics() {
  const [viewTab, setViewTab] = useState('today'); // today | trend

  // ══════════════════════════ Shared line/org data ══════════════════════════
  const [linesFull, setLinesFull] = useState([]); // [{id,name,section,parent_line_name}]
  const [parentChildrenMap, setParentChildrenMap] = useState({}); // { 'HYDROFORM': ['HDF1','HDF2',...] }

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name').then(({ data }) => {
      const rows = data || [];
      setLinesFull(rows);
      const pcm = {};
      rows.forEach(l => {
        if (l.parent_line_name) {
          if (!pcm[l.parent_line_name]) pcm[l.parent_line_name] = [];
          pcm[l.parent_line_name].push(l.name);
        }
      });
      setParentChildrenMap(pcm);
    });
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
     TAB: TODAY — real-time single-day monitoring dashboard
     ══════════════════════════════════════════════════════════════════════ */
  const [tdDate,   setTdDate]   = useState(() => getWorkDateStr());
  const [tdShift,  setTdShift]  = useState('');
  const [tdSection,setTdSection]= useState('');
  const [tdDept,   setTdDept]   = useState('');
  const [tdLine,   setTdLine]   = useState('');
  const [tdTeam,   setTdTeam]   = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate,  setLastUpdate]  = useState(null);

  const [tdSessions,  setTdSessions]  = useState([]);
  const [tdDowntimes, setTdDowntimes] = useState([]);
  const [tdDefects,   setTdDefects]   = useState([]);
  const [tdHistory,   setTdHistory]   = useState([]); // last 10 days, closed sessions, lightweight
  const [tdProductsByMat, setTdProductsByMat] = useState({}); // mat_no -> part name
  const [shiftSchedMap, setShiftSchedMap] = useState({}); // line_id -> day_team
  const [tdLoading, setTdLoading] = useState(false);

  // Cascading Section → Department(group) → Line options
  const sectionOptions = useMemo(() => [...new Set(linesFull.map(l => l.section).filter(Boolean))].sort(), [linesFull]);

  const deptOptions = useMemo(() => {
    const inSection = tdSection ? linesFull.filter(l => l.section === tdSection) : linesFull;
    const parents = [...new Set(inSection.filter(l => parentChildrenMap[l.name]).map(l => l.name))];
    const standalone = inSection.filter(l => !l.parent_line_name && !parentChildrenMap[l.name]).map(l => l.name);
    return { parents: parents.sort(), standalone: standalone.sort() };
  }, [tdSection, linesFull, parentChildrenMap]);

  const lineOptions = useMemo(() => {
    if (!tdDept) return [];
    if (parentChildrenMap[tdDept]) return parentChildrenMap[tdDept];
    return [];
  }, [tdDept, parentChildrenMap]);

  const tdScopeLines = useMemo(() => {
    if (tdLine) return [tdLine];
    if (tdDept) return parentChildrenMap[tdDept] ? [tdDept, ...parentChildrenMap[tdDept]] : [tdDept];
    if (tdSection) return linesFull.filter(l => l.section === tdSection).map(l => l.name);
    return null; // ทุกไลน์
  }, [tdLine, tdDept, tdSection, linesFull, parentChildrenMap]);

  const tdScopeLabel = tdLine || tdDept || tdSection || 'ทุกไลน์';

  const loadToday = useCallback(async () => {
    setTdLoading(true);
    try {
      let q = supabaseDR.from('production_sessions')
        .select('*, dr_products(name, mat_no)')
        .eq('work_date', tdDate)
        .in('status', ['open', 'pending_close', 'closed'])
        .order('created_at', { ascending: false })
        .limit(500);
      if (tdScopeLines?.length === 1) q = q.eq('line_name', tdScopeLines[0]);
      else if (tdScopeLines?.length > 1) q = q.in('line_name', tdScopeLines);
      if (tdShift) q = q.eq('shift', tdShift);
      const { data: sess } = await q;

      const sessionIds = (sess || []).map(s => s.id);
      const [{ data: dt }, { data: def }] = await Promise.all([
        sessionIds.length
          ? supabaseDR.from('downtime_logs').select('*, dr_downtime_types(name_th, category, color)').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
        sessionIds.length
          ? supabaseDR.from('defect_logs').select('*, dr_defect_types(name_th, color)').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
      ]);

      setTdSessions(sess || []);
      setTdDowntimes(dt || []);
      setTdDefects(def || []);
      setLastUpdate(new Date());

      // เก็บ mat_no → part name ไว้ map ให้ downtime_logs.mat_no (free text, ไม่ใช่ FK)
      const matMap = {};
      (sess || []).forEach(s => { if (s.dr_products?.mat_no) matMap[s.dr_products.mat_no] = s.dr_products.name; });
      setTdProductsByMat(prev => ({ ...prev, ...matMap }));
    } finally {
      setTdLoading(false);
    }
  }, [tdDate, tdShift, tdScopeLines]);

  const loadTdHistory = useCallback(async () => {
    const startStr = dateStrAdd(tdDate, -9);
    let q = supabaseDR.from('production_sessions')
      .select('work_date, oee, oee_a, oee_p, oee_q, status, line_name, shift')
      .eq('status', 'closed')
      .gte('work_date', startStr).lte('work_date', tdDate)
      .limit(3000);
    if (tdScopeLines?.length === 1) q = q.eq('line_name', tdScopeLines[0]);
    else if (tdScopeLines?.length > 1) q = q.in('line_name', tdScopeLines);
    if (tdShift) q = q.eq('shift', tdShift);
    const { data } = await q;
    setTdHistory(data || []);
  }, [tdDate, tdShift, tdScopeLines]);

  // ทีมตามตาราง shift_schedules (A/B สลับกันตามวัน, C กะเช้าตลอด) — best effort, ถ้าไม่มีข้อมูลจะไม่ระบุ
  useEffect(() => {
    if (!tdDate || !linesFull.length) return;
    const ids = linesFull.map(l => l.id);
    supabase.from('shift_schedules').select('line_id, day_team').eq('work_date', tdDate).in('line_id', ids)
      .then(({ data }) => {
        const m = {};
        (data || []).forEach(r => { m[r.line_id] = r.day_team; });
        setShiftSchedMap(m);
      });
  }, [tdDate, linesFull]);

  const lineIdByName = useMemo(() => Object.fromEntries(linesFull.map(l => [l.name, l.id])), [linesFull]);
  const resolveTeam = useCallback((lineName, shift) => {
    const id = lineIdByName[lineName];
    const dayTeam = id != null ? shiftSchedMap[id] : undefined;
    if (!dayTeam) return null;
    if (shift === 'day') return dayTeam;
    if (dayTeam === 'C') return null; // Team C ไม่มีกะดึก
    return dayTeam === 'A' ? 'B' : 'A';
  }, [lineIdByName, shiftSchedMap]);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { loadTdHistory(); }, [loadTdHistory]);

  // Auto refresh ทุก 60 วิ เฉพาะตอนอยู่ tab วันนี้ + เปิด auto refresh
  useEffect(() => {
    if (viewTab !== 'today' || !autoRefresh) return;
    const t = setInterval(() => { loadToday(); loadTdHistory(); }, 60000);
    return () => clearInterval(t);
  }, [viewTab, autoRefresh, loadToday, loadTdHistory]);

  const tdSessionsTeamFiltered = useMemo(() => {
    if (!tdTeam) return tdSessions;
    return tdSessions.filter(s => resolveTeam(s.line_name, s.shift) === tdTeam);
  }, [tdSessions, tdTeam, resolveTeam]);

  const tdSessionIdSet = useMemo(() => new Set(tdSessionsTeamFiltered.map(s => s.id)), [tdSessionsTeamFiltered]);
  const tdDowntimesScoped = useMemo(() => tdTeam ? tdDowntimes.filter(d => tdSessionIdSet.has(d.session_id)) : tdDowntimes, [tdDowntimes, tdTeam, tdSessionIdSet]);
  const tdDefectsScoped   = useMemo(() => tdTeam ? tdDefects.filter(d => tdSessionIdSet.has(d.session_id)) : tdDefects,   [tdDefects, tdTeam, tdSessionIdSet]);

  const tdRows = useMemo(() => calcOEE(tdSessionsTeamFiltered, tdDowntimesScoped, tdDefectsScoped), [tdSessionsTeamFiltered, tdDowntimesScoped, tdDefectsScoped]);

  const tdKpi = useMemo(() => {
    const valid = key => tdRows.filter(r => r[key] != null).map(r => r[key]);
    const avg = arr => arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : null;
    return {
      oee: avg(valid('calcOEE')), a: avg(valid('calcA')), p: avg(valid('calcP')), q: avg(valid('calcQ')),
      totalQty: tdRows.reduce((s, r) => s + (r.totalQty || 0), 0),
      targetQty: tdRows.reduce((s, r) => s + (r.target_qty || 0), 0),
      totalDT: tdDowntimesScoped.reduce((s, d) => s + (d.duration_min || 0), 0),
      totalShiftMin: tdSessionsTeamFiltered.reduce((s, r) => s + (r.shift_min || 0), 0),
    };
  }, [tdRows, tdDowntimesScoped, tdSessionsTeamFiltered]);

  const tdHistoryGrouped = useMemo(() => {
    const map = {};
    for (const r of tdHistory) { (map[r.work_date] ||= []).push(r); }
    const days = [];
    for (let i = 9; i >= 0; i--) {
      const key = dateStrAdd(tdDate, -i);
      const items = map[key] || [];
      const avg = arr => arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : null;
      days.push({
        key, label: fmtDayLabel(key),
        oee: avg(items.filter(i => i.oee   != null).map(i => +i.oee)),
        a:   avg(items.filter(i => i.oee_a != null).map(i => +i.oee_a)),
        p:   avg(items.filter(i => i.oee_p != null).map(i => +i.oee_p)),
        q:   avg(items.filter(i => i.oee_q != null).map(i => +i.oee_q)),
      });
    }
    return days;
  }, [tdHistory, tdDate]);

  // Live/latest session card
  const tdLiveSession = useMemo(() => {
    const running = tdSessionsTeamFiltered.filter(s => s.status === 'open' || s.status === 'pending_close')
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (running.length) return running[0];
    const closed = [...tdSessionsTeamFiltered].sort((a, b) => (b.closed_at || b.created_at || '').localeCompare(a.closed_at || a.created_at || ''));
    return closed[0] || null;
  }, [tdSessionsTeamFiltered]);

  const tdLiveRow = useMemo(() => tdLiveSession ? tdRows.find(r => r.id === tdLiveSession.id) : null, [tdLiveSession, tdRows]);

  // Downtime donut (โดยประเภท)
  const tdDtDonut = useMemo(() => {
    const map = {};
    for (const d of tdDowntimesScoped) {
      const name = d.dr_downtime_types?.name_th || 'ไม่ระบุ';
      const cat  = d.dr_downtime_types?.category || 'unplanned';
      if (!map[name]) map[name] = { name, min: 0, category: cat };
      map[name].min += d.duration_min || 0;
    }
    const total = Object.values(map).reduce((s, d) => s + d.min, 0);
    return Object.values(map).sort((a, b) => b.min - a.min).map((d, i) => ({
      ...d, min: +d.min.toFixed(1), pct: total > 0 ? +(d.min / total * 100).toFixed(1) : 0,
      color: d.category === 'planned' ? PLAN_COLORS[i % PLAN_COLORS.length] : UNPLAN_COLORS[i % UNPLAN_COLORS.length],
    }));
  }, [tdDowntimesScoped]);

  // Top 10 downtime แยกตามพาร์ท (mat_no ที่บันทึกไว้ตอน log downtime)
  const tdDtByPart = useMemo(() => {
    const map = {};
    for (const d of tdDowntimesScoped) {
      const mat = d.mat_no || 'ไม่ระบุ MAT.NO';
      if (!map[mat]) map[mat] = { mat, part: tdProductsByMat[mat] || mat, min: 0 };
      map[mat].min += d.duration_min || 0;
    }
    const arr = Object.values(map).sort((a, b) => b.min - a.min).slice(0, 10);
    const max = arr.length ? arr[0].min : 0;
    const total = Object.values(map).reduce((s, d) => s + d.min, 0);
    return arr.map(d => ({ ...d, min: +d.min.toFixed(1), pct: total > 0 ? +(d.min / total * 100).toFixed(1) : 0, barPct: max > 0 ? (d.min / max * 100) : 0 }));
  }, [tdDowntimesScoped, tdProductsByMat]);

  /* ══════════════════════════════════════════════════════════════════════
     TAB: TREND — historical range analytics (เดิม)
     ══════════════════════════════════════════════════════════════════════ */
  const [sessions,   setSessions]   = useState([]);
  const [downtimes,  setDowntimes]  = useState([]);
  const [defects,    setDefects]    = useState([]);
  const [dtTypes,    setDtTypes]    = useState([]);
  const [defectTypes,setDefectTypes]= useState([]);
  const [lines,      setLines]      = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Filters
  const [period,     setPeriod]     = useState('monthly'); // daily|monthly|yearly
  const [selLine,    setSelLine]    = useState('');
  const [selShift,   setSelShift]   = useState('');
  const [dateFrom,   setDateFrom]   = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo,     setDateTo]     = useState(() => new Date().toISOString().slice(0, 10));

  // ── Load data ──────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const pcm = parentChildrenMap; // pre-loaded by shared effect above

      // Expand selLine: if it's a parent, include all its children
      const expandedLines = selLine
        ? (pcm[selLine] ? [selLine, ...pcm[selLine]] : [selLine])
        : null;

      let q = supabaseDR.from('production_sessions')
        .select('*')
        .eq('status', 'closed')
        .gte('work_date', dateFrom)
        .lte('work_date', dateTo)
        .order('work_date', { ascending: true })
        .limit(5000);
      if (expandedLines?.length === 1) q = q.eq('line_name', expandedLines[0]);
      else if (expandedLines?.length > 1) q = q.in('line_name', expandedLines);
      if (selShift) q = q.eq('shift', selShift);
      const { data: sess } = await q;

      const sessionIds = (sess || []).map(s => s.id);

      const [{ data: dt }, { data: def }, { data: dtt }, { data: deft }, { data: linesData }] = await Promise.all([
        sessionIds.length
          ? supabaseDR.from('downtime_logs').select('*, dr_downtime_types(name_th, category, color)').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
        sessionIds.length
          ? supabaseDR.from('defect_logs').select('*, dr_defect_types(name_th, color)').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
        supabaseDR.from('dr_downtime_types').select('*').eq('is_active', true).order('sort_order'),
        supabaseDR.from('dr_defect_types').select('*').eq('is_active', true).order('sort_order'),
        supabaseDR.from('production_sessions').select('line_name').eq('status', 'closed'),
      ]);

      setSessions(sess || []);
      setDowntimes(dt || []);
      setDefects(def || []);
      setDtTypes(dtt || []);
      setDefectTypes(deft || []);

      const uniqueLines = [...new Set((linesData || []).map(r => r.line_name).filter(Boolean))].sort();
      setLines(uniqueLines);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selLine, selShift, parentChildrenMap]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Computed rows ──────────────────────────────────────────────
  const rows = useMemo(() => calcOEE(sessions, downtimes, defects), [sessions, downtimes, defects]);

  // ── Group by period ────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = {};
    for (const r of rows) {
      const key = period === 'daily'
        ? r.work_date
        : period === 'monthly'
        ? fmtMonthKey(r.work_date)
        : fmtYearKey(r.work_date);
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => {
      const valid = items.filter(i => i.calcOEE != null);
      const avg = arr => arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : null;
      return {
        key,
        label: period === 'daily' ? fmtDayLabel(key) : period === 'monthly' ? fmtMonthLabel(key) : `${+key + 543}`,
        oee:   avg(valid.map(i => i.calcOEE)),
        a:     avg(items.filter(i => i.calcA != null).map(i => i.calcA)),
        p:     avg(items.filter(i => i.calcP != null).map(i => i.calcP)),
        q:     avg(items.filter(i => i.calcQ != null).map(i => i.calcQ)),
        totalQty:   items.reduce((s, i) => s + (i.totalQty || 0), 0),
        ngQty:      items.reduce((s, i) => s + (i.ngQty || 0), 0),
        unplannedMin: items.reduce((s, i) => s + i.unplannedMin, 0),
        count: items.length,
      };
    });
  }, [rows, period]);

  // ── Overall KPIs ───────────────────────────────────────────────
  const kpi = useMemo(() => {
    const validOEE = grouped.filter(g => g.oee != null);
    const avg = key => validOEE.length ? +(validOEE.reduce((s, g) => s + (g[key] || 0), 0) / validOEE.length).toFixed(1) : null;
    return { oee: avg('oee'), a: avg('a'), p: avg('p'), q: avg('q'), sessions: rows.length, total: rows.reduce((s, r) => s + r.totalQty, 0) };
  }, [grouped, rows]);

  // ── Downtime Pareto ────────────────────────────────────────────
  const dtPareto = useMemo(() => {
    const map = {};
    for (const d of downtimes) {
      const name = d.dr_downtime_types?.name_th || 'ไม่ระบุ';
      const cat  = d.dr_downtime_types?.category || 'unplanned';
      if (!map[name]) map[name] = { name, min: 0, category: cat };
      map[name].min += d.duration_min || 0;
    }
    return Object.values(map).sort((a, b) => b.min - a.min).map((d, i) => ({
      ...d, min: +d.min.toFixed(1),
      color: d.category === 'planned' ? PLAN_COLORS[i % PLAN_COLORS.length] : UNPLAN_COLORS[i % UNPLAN_COLORS.length],
    }));
  }, [downtimes]);

  // ── Defect breakdown ───────────────────────────────────────────
  const defectBreakdown = useMemo(() => {
    const map = {};
    for (const d of defects) {
      const name = d.dr_defect_types?.name_th || 'ไม่ระบุ';
      const color = d.dr_defect_types?.color || '#6b7280';
      if (!map[name]) map[name] = { name, qty: 0, color };
      map[name].qty += (d.qty_ng || 0) + (d.qty_suspect || 0);
    }
    // Also add from session-level qty_ng
    for (const s of rows) {
      if (s.ngQty > 0 && Object.keys(map).length === 0) {
        map['NG (รวม)'] = { name: 'NG (รวม)', qty: s.ngQty, color: '#ef4444' };
      }
    }
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [defects, rows]);

  // ── Styles ─────────────────────────────────────────────────────
  const s = {
    page:    { padding: '20px 24px', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' },
    section: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 },
    title:   { fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 12 },
    sel:     { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 },
    tab:     active => ({ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                background: active ? 'var(--accent)' : 'var(--bg2)', color: active ? '#000' : 'var(--text)' }),
  };

  return (
    <div style={s.page}>
      <style>{`@keyframes oee-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>📈 OEE Analytics</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>วิเคราะห์ประสิทธิภาพการผลิต — Availability · Performance · Quality</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={s.tab(viewTab === 'today')}  onClick={() => setViewTab('today')}>⚡ ภาพรวมวันนี้</button>
          <button style={s.tab(viewTab === 'trend')}  onClick={() => setViewTab('trend')}>📊 แนวโน้ม/ประวัติ</button>
        </div>
      </div>

      {viewTab === 'today' ? (
        <>
          {/* ── Filter bar ── */}
          <div style={{ ...s.section, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <input type="date" value={tdDate} onChange={e => setTdDate(e.target.value)} style={s.sel} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtThaiDate(tdDate)}</span>

            <select style={s.sel} value={tdShift} onChange={e => setTdShift(e.target.value)}>
              <option value="">ALL SHIFT (ทุกกะ)</option>
              <option value="day">กะเช้า</option>
              <option value="night">กะดึก</option>
            </select>

            <select style={s.sel} value={tdSection} onChange={e => { setTdSection(e.target.value); setTdDept(''); setTdLine(''); }}>
              <option value="">ทุกส่วนงาน</option>
              {sectionOptions.map(sec => <option key={sec} value={sec}>{sec}</option>)}
            </select>

            <select style={s.sel} value={tdDept} onChange={e => { setTdDept(e.target.value); setTdLine(''); }}>
              <option value="">ทุกแผนก/กลุ่มไลน์</option>
              {deptOptions.parents.map(p => <option key={p} value={p}>▸ {p}</option>)}
              {deptOptions.standalone.map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            {lineOptions.length > 0 && (
              <select style={s.sel} value={tdLine} onChange={e => setTdLine(e.target.value)}>
                <option value="">{tdDept} (ทั้งหมด)</option>
                {lineOptions.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            )}

            <select style={s.sel} value={tdTeam} onChange={e => setTdTeam(e.target.value)}>
              <option value="">ทุกทีม</option>
              <option value="A">Team A</option>
              <option value="B">Team B</option>
              <option value="C">Team C</option>
            </select>

            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              LAST UPDATE : {lastUpdate ? lastUpdate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
            </span>
            <button onClick={() => { loadToday(); loadTdHistory(); }} style={{ ...s.tab(false) }}>🔄</button>
            <button onClick={() => setAutoRefresh(v => !v)} style={s.tab(autoRefresh)}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: autoRefresh ? '#22c55e' : 'var(--muted)', marginRight: 6, animation: autoRefresh ? 'oee-pulse 1.4s ease infinite' : 'none' }} />
              AUTO REFRESH
            </button>
            {tdLoading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด...</span>}
          </div>

          {/* 1. OEE Overview */}
          <div style={s.section}>
            <div style={s.title}>1. OEE OVERVIEW — {tdScopeLabel}</div>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: 168, height: 168, flexShrink: 0 }}>
                <GaugeRing value={tdKpi.oee} color={oeeColor(tdKpi.oee ?? 0)} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE รวมวันนี้</div>
                  <div style={{ fontSize: 34, fontWeight: 900, color: tdKpi.oee != null ? oeeColor(tdKpi.oee) : 'var(--muted)' }}>{tdKpi.oee ?? '—'}{tdKpi.oee != null ? '%' : ''}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>TARGET {TARGET.oee}%</div>
                </div>
              </div>
              {['a', 'p', 'q'].map(k => (
                <div key={k} style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{METRIC_LABEL[k]}</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: tdKpi[k] != null ? METRIC_COLOR_FN[k](tdKpi[k]) : 'var(--muted)' }}>{tdKpi[k] ?? '—'}{tdKpi[k] != null ? '%' : ''}</div>
                  <MiniTrend data={tdHistoryGrouped} dataKey={k} color={METRIC_COLOR[k]} target={TARGET[k]} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>TARGET {TARGET[k]}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* Row: Live session + Production qty gauge */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* 1.1 Live session */}
            <div style={{ ...s.section, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={s.title}>1.1 OEE รายการล่าสุด (กำลังผลิตงานอยู่)</div>
                {tdLiveSession && (() => { const b = STATUS_BADGE[tdLiveSession.status] || STATUS_BADGE.closed; return (
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: b.bg, color: b.color }}>{b.label}</span>
                ); })()}
              </div>
              {!tdLiveSession ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูลกะในวันที่เลือก</div>
              ) : (
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ minWidth: 140 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>LINE</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>{tdLiveSession.line_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>PART</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{tdLiveSession.dr_products?.name || tdLiveSession.dr_products?.mat_no || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: tdLiveRow?.calcOEE != null ? oeeColor(tdLiveRow.calcOEE) : 'var(--muted)' }}>
                      {tdLiveRow?.calcOEE ?? '—'}{tdLiveRow?.calcOEE != null ? '%' : ''}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>TARGET {TARGET.oee}%</div>
                  </div>
                  <div style={{ display: 'flex', gap: 14 }}>
                    <MetricColumn label="A" value={tdLiveRow?.calcA} target={TARGET.a} color={METRIC_COLOR.a} />
                    <MetricColumn label="P" value={tdLiveRow?.calcP} target={TARGET.p} color={METRIC_COLOR.p} />
                    <MetricColumn label="Q" value={tdLiveRow?.calcQ} target={TARGET.q} color={METRIC_COLOR.q} />
                  </div>
                </div>
              )}
            </div>

            {/* 3. Production qty gauge */}
            <div style={{ ...s.section, marginBottom: 0 }}>
              <div style={s.title}>3. จำนวนชิ้นงานที่ผลิตรวมของวันนี้</div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>เป้าหมาย</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>{tdKpi.targetQty.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>ชิ้น</span></div>
                  <div style={{ height: 10 }} />
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>ผลิตได้แล้ว</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#4d9fff' }}>{tdKpi.totalQty.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>ชิ้น</span></div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>คงเหลืออีก {Math.max(0, tdKpi.targetQty - tdKpi.totalQty).toLocaleString()} ชิ้น</div>
                </div>
                <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
                  <GaugeRing value={tdKpi.targetQty > 0 ? Math.min(100, tdKpi.totalQty / tdKpi.targetQty * 100) : 0} color="#4d9fff" size={140} stroke={13} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 900, color: '#4d9fff' }}>{tdKpi.targetQty > 0 ? Math.round(Math.min(100, tdKpi.totalQty / tdKpi.targetQty * 100)) : 0}%</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>เทียบเป้าหมาย</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 1.2 Daily OEE chart */}
          <div style={s.section}>
            <div style={s.title}>1.2 OEE แสดงค่าของแต่ละวัน (10 วันล่าสุด)</div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={tdHistoryGrouped} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                <Tooltip content={<OEETooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={TARGET.oee} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1} label={{ value: `TARGET ${TARGET.oee}%`, fill: '#22c55e', fontSize: 10, position: 'insideTopRight' }} />
                <Bar dataKey="oee" name="OEE %" fill="#22c55e" opacity={0.85} radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="oee" position="top" formatter={v => v != null ? `${v}%` : ''} style={{ fontSize: 10, fill: 'var(--text)' }} />
                </Bar>
                <Line type="monotone" dataKey="a" name="A%" stroke="#22c55e" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="p" name="P%" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="q" name="Q%" stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 2. Downtime */}
          <div style={s.section}>
            <div style={s.title}>2. DOWNTIME</div>
            <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.3fr 1.5fr', gap: 16 }}>
              {/* 2.1 Total */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>2.1 Downtime รวมของวันนี้</div>
                <div style={{ position: 'relative', width: 120, height: 120, margin: '0 auto' }}>
                  <GaugeRing value={tdKpi.totalShiftMin > 0 ? Math.min(100, tdKpi.totalDT / tdKpi.totalShiftMin * 100) : 0} color="#a855f7" size={120} stroke={11} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#a855f7' }}>{tdKpi.totalDT.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>นาที</div>
                  </div>
                </div>
                <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                  {tdKpi.totalShiftMin > 0 ? (tdKpi.totalDT / tdKpi.totalShiftMin * 100).toFixed(2) : '0.00'}% ของเวลาผลิตทั้งหมด
                </div>
              </div>

              {/* 2.2 Donut by type */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>2.2 Downtime แยกตามสาเหตุ</div>
                {tdDtDonut.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูล Downtime</div>
                ) : (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart>
                        <Pie data={tdDtDonut} dataKey="min" nameKey="name" innerRadius={38} outerRadius={62} paddingAngle={2}>
                          {tdDtDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={v => [`${v} นาที`]} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ flex: 1, overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                        <thead><tr style={{ color: 'var(--muted)' }}>
                          <th style={{ textAlign: 'left', padding: '3px 6px' }}>สาเหตุ</th>
                          <th style={{ textAlign: 'right', padding: '3px 6px' }}>นาที</th>
                          <th style={{ textAlign: 'right', padding: '3px 6px' }}>%</th>
                        </tr></thead>
                        <tbody>
                          {tdDtDonut.map((d, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '3px 6px' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: d.color, marginRight: 5 }} />{d.name}</td>
                              <td style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--text)' }}>{d.min}</td>
                              <td style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--text)' }}>{d.pct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* 2.3 Top 10 by part */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>2.3 Top 10 Downtime รายพาร์ท</div>
                {tdDtByPart.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูล</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                      <thead><tr style={{ color: 'var(--muted)' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>#</th>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>พาร์ท</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>นาที</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>%</th>
                        <th style={{ padding: '3px 6px', width: 90 }}></th>
                      </tr></thead>
                      <tbody>
                        {tdDtByPart.map((d, i) => (
                          <tr key={d.mat} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '3px 6px', color: 'var(--muted)' }}>{i + 1}</td>
                            <td style={{ padding: '3px 6px', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{d.part}</td>
                            <td style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--text)' }}>{d.min}</td>
                            <td style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--muted)' }}>{d.pct}%</td>
                            <td style={{ padding: '3px 6px' }}>
                              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg2)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${d.barPct}%`, background: '#a855f7', borderRadius: 4 }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
      <>
      {/* Filters */}
      <div style={{ ...s.section, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['daily','monthly','yearly'].map(p => (
            <button key={p} style={s.tab(period === p)} onClick={() => setPeriod(p)}>
              {p === 'daily' ? 'รายวัน' : p === 'monthly' ? 'รายเดือน' : 'รายปี'}
            </button>
          ))}
        </div>
        <select style={s.sel} value={selLine} onChange={e => setSelLine(e.target.value)}>
          <option value="">ทุกไลน์</option>
          {/* Leaf lines (no parent, no children in session list) */}
          {lines.filter(l => !Object.values(parentChildrenMap).flat().includes(l) && !parentChildrenMap[l]).map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
          {/* Parent lines: show as group + individual sub-lines */}
          {Object.entries(parentChildrenMap).filter(([p]) => lines.includes(p) || lines.some(l => parentChildrenMap[p]?.includes(l))).map(([parent, children]) => (
            <optgroup key={parent} label={`▸ ${parent}`}>
              <option value={parent}>{parent} (ทั้งหมด)</option>
              {children.filter(c => lines.includes(c)).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select style={s.sel} value={selShift} onChange={e => setSelShift(e.target.value)}>
          <option value="">ทุกกะ</option>
          <option value="day">กะเช้า</option>
          <option value="night">กะดึก</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={s.sel} />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>ถึง</span>
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={s.sel} />
        <button onClick={loadData} style={{ ...s.tab(false), paddingLeft: 12, paddingRight: 12 }}>🔄 โหลด</button>
        {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด...</span>}
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <KpiCard label="OEE เฉลี่ย"     value={kpi.oee} color={kpi.oee != null ? oeeColor(kpi.oee) : undefined} sub={`${kpi.sessions} กะ`} />
        <KpiCard label="Availability (A)" value={kpi.a}   color={kpi.a   != null ? aColor(kpi.a)   : undefined} sub="% เวลาที่เครื่องพร้อม" />
        <KpiCard label="Performance (P)"  value={kpi.p}   color={kpi.p   != null ? pColor(kpi.p)   : undefined} sub="% ความเร็วผลิต" />
        <KpiCard label="Quality (Q)"      value={kpi.q}   color={kpi.q   != null ? qColor(kpi.q)   : undefined} sub="% ชิ้นงานดี" />
        <KpiCard label="ผลิตรวม" value={null} sub={`${kpi.total.toLocaleString()} ชิ้น`}
          color="var(--text)" />
      </div>

      {/* OEE Trend Chart */}
      <div style={s.section}>
        <div style={s.title}>แนวโน้ม OEE · A · P · Q</div>
        {grouped.length === 0
          ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{loading ? 'กำลังโหลด...' : 'ไม่มีข้อมูล'}</div>
          : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={grouped} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                <Tooltip content={<OEETooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={85} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1} label={{ value: '85%', fill: '#22c55e', fontSize: 10 }} />
                <Line type="monotone" dataKey="oee" name="OEE" stroke="#4d9fff" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="a"   name="A%"  stroke="#22c55e" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
                <Line type="monotone" dataKey="p"   name="P%"  stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
                <Line type="monotone" dataKey="q"   name="Q%"  stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )
        }
      </div>

      {/* Downtime Pareto + Defect side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Downtime Pareto */}
        <div style={s.section}>
          <div style={s.title}>Pareto — Downtime รายประเภท (นาที)</div>
          {dtPareto.length === 0
            ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูล Downtime</div>
            : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dtPareto} layout="vertical" margin={{ left: 10, right: 30, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} unit="m" />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'var(--muted)' }} width={120} />
                  <Tooltip formatter={(v) => [`${v} นาที`]} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
                  <Bar dataKey="min" name="นาที" radius={[0, 4, 4, 0]}>
                    {dtPareto.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          }
          {dtPareto.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {dtPareto.slice(0, 6).map((d, i) => (
                <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${d.color}22`, border: `1px solid ${d.color}55`, color: d.color, fontWeight: 700 }}>
                  {d.name}: {d.min.toLocaleString()}m
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Quality Breakdown */}
        <div style={s.section}>
          <div style={s.title}>ของเสียรายประเภท</div>
          {defectBreakdown.length === 0
            ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูลของเสีย</div>
            : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={defectBreakdown} layout="vertical" margin={{ left: 10, right: 30, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} unit="ชิ้น" />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'var(--muted)' }} width={120} />
                  <Tooltip formatter={(v) => [`${v} ชิ้น`]} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
                  <Bar dataKey="qty" name="ชิ้น" radius={[0, 4, 4, 0]}>
                    {defectBreakdown.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          }
          {defectBreakdown.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {defectBreakdown.map((d, i) => (
                <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${d.color}22`, border: `1px solid ${d.color}55`, color: d.color, fontWeight: 700 }}>
                  {d.name}: {d.qty.toLocaleString()}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* A/P/Q Bar comparison by period */}
      <div style={s.section}>
        <div style={s.title}>เปรียบเทียบ A · P · Q</div>
        {grouped.length === 0
          ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{loading ? 'กำลังโหลด...' : 'ไม่มีข้อมูล'}</div>
          : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={grouped} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                <Tooltip content={<OEETooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="a" name="A%" fill="#22c55e" opacity={0.8} radius={[2, 2, 0, 0]} />
                <Bar dataKey="p" name="P%" fill="#f59e0b" opacity={0.8} radius={[2, 2, 0, 0]} />
                <Bar dataKey="q" name="Q%" fill="#a78bfa" opacity={0.8} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )
        }
      </div>

      {/* Data Table */}
      <div style={s.section}>
        <div style={s.title}>ตารางสรุป</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>ช่วงเวลา</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>กะ</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>ผลิตรวม</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>DT (นาที)</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>A%</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>P%</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Q%</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>OEE%</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g, i) => (
                <tr key={g.key} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'var(--bg2)' : 'transparent' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--text)' }}>{period === 'daily' ? g.key : g.label}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--muted)' }}>{g.count}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{g.totalQty.toLocaleString()}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.unplannedMin > 60 ? '#ef4444' : 'var(--text)' }}>{g.unplannedMin.toLocaleString()}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.a != null ? aColor(g.a) : 'var(--muted)', fontWeight: 700 }}>{g.a ?? '—'}{g.a != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.p != null ? pColor(g.p) : 'var(--muted)', fontWeight: 700 }}>{g.p ?? '—'}{g.p != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.q != null ? qColor(g.q) : 'var(--muted)', fontWeight: 700 }}>{g.q ?? '—'}{g.q != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.oee != null ? oeeColor(g.oee) : 'var(--muted)', fontWeight: 900, fontSize: 14 }}>{g.oee ?? '—'}{g.oee != null ? '%' : ''}</td>
                </tr>
              ))}
              {grouped.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>{loading ? 'กำลังโหลด...' : 'ไม่มีข้อมูล'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
