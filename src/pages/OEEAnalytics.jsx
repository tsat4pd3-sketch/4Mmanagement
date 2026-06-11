import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';

// ── Supabase DR client ────────────────────────────────────────────
const DR_URL  = import.meta.env.VITE_SUPABASE_DR_URL  || import.meta.env.VITE_SUPABASE_URL;
const DR_KEY  = import.meta.env.VITE_SUPABASE_DR_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseDR = createClient(DR_URL, DR_KEY);

// ── Colour helpers ───────────────────────────────────────────────
const oeeColor  = v => v >= 80 ? '#22c55e' : v >= 60 ? '#f59e0b' : '#ef4444';
const aColor    = v => v >= 90 ? '#22c55e' : v >= 75 ? '#f59e0b' : '#ef4444';
const pColor    = v => v >= 85 ? '#22c55e' : v >= 70 ? '#f59e0b' : '#ef4444';
const qColor    = v => v >= 99 ? '#22c55e' : v >= 95 ? '#f59e0b' : '#ef4444';

const UNPLAN_COLORS = ['#ef4444','#f97316','#eab308','#84cc16','#06b6d4','#8b5cf6','#ec4899','#6b7280','#a78bfa'];
const PLAN_COLORS   = ['#60a5fa','#34d399','#fb7185','#fbbf24'];

// ── OEE calculation helpers ──────────────────────────────────────
const SHIFT_MIN = 720; // 12h shift

function calcOEE(sessions, downtimes, defects) {
  // For each session, calculate A, P, Q from raw data
  const results = [];
  for (const s of sessions) {
    const sessionDT = downtimes.filter(d => d.session_id === s.id);
    const sessionDefects = defects.filter(d => d.session_id === s.id);

    // AT: available time = shift minutes - planned DT
    const plannedMin  = sessionDT.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
    const unplannedMin = sessionDT.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);

    // Use stored start/end or default to shift length
    let shiftMin = SHIFT_MIN;
    if (s.start_time && s.end_time) {
      const [sh, sm] = s.start_time.split(':').map(Number);
      const [eh, em] = s.end_time.split(':').map(Number);
      let diff = (eh * 60 + em) - (sh * 60 + sm);
      if (diff <= 0) diff += 1440; // crosses midnight
      if (diff > 0 && diff <= 1440) shiftMin = diff;
    }

    const loadingMin = shiftMin - plannedMin;
    const operatingMin = Math.max(0, loadingMin - unplannedMin);

    // A = operating / loading
    const oeeA = loadingMin > 0 ? Math.min(100, (operatingMin / loadingMin) * 100) : (s.oee_a != null ? s.oee_a : null);

    // P = (actual_qty * CT) / operating_min  — if CT available
    const ctSec = s.dr_products?.cycle_time_sec || 0;
    let oeeP = s.oee_p != null ? s.oee_p : null;
    if (ctSec > 0 && operatingMin > 0 && s.actual_qty) {
      oeeP = Math.min(100, ((s.actual_qty * ctSec / 60) / operatingMin) * 100);
    }

    // Q = qty_ok / actual_qty
    const ngQty = sessionDefects.reduce((a, d) => a + (d.qty_ng || 0), 0) + (s.qty_ng || 0);
    const totalQty = s.actual_qty || 0;
    const okQty = s.qty_ok || Math.max(0, totalQty - ngQty);
    let oeeQ = s.oee_q != null ? s.oee_q : null;
    if (totalQty > 0) {
      oeeQ = Math.min(100, (okQty / totalQty) * 100);
    }

    const oee = (oeeA != null && oeeP != null && oeeQ != null)
      ? (oeeA / 100) * (oeeP / 100) * (oeeQ / 100) * 100
      : s.oee;

    results.push({
      ...s,
      calcA: oeeA != null ? +oeeA.toFixed(1) : null,
      calcP: oeeP != null ? +oeeP.toFixed(1) : null,
      calcQ: oeeQ != null ? +oeeQ.toFixed(1) : null,
      calcOEE: oee != null ? +oee.toFixed(1) : null,
      loadingMin,
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
const fmtMonthKey = d => d.slice(0, 7);          // YYYY-MM
const fmtYearKey  = d => d.slice(0, 4);          // YYYY
const thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const fmtMonthLabel = k => { const [y, m] = k.split('-'); return `${thMonths[+m - 1]} ${(+y + 543).toString().slice(-2)}`; };
const fmtDayLabel   = d => { const [,m,dd] = d.split('-'); return `${+dd}/${+m}`; };

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

// ── Main Component ───────────────────────────────────────────────
export default function OEEAnalytics() {
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
      let q = supabaseDR.from('production_sessions')
        .select('*, dr_products(name, cycle_time_sec, target_per_shift)')
        .eq('status', 'closed')
        .gte('work_date', dateFrom)
        .lte('work_date', dateTo)
        .order('work_date', { ascending: true });
      if (selLine)  q = q.eq('line_name', selLine);
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
  }, [dateFrom, dateTo, selLine, selShift]);

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
    page:    { padding: '20px 24px', maxWidth: 1400, margin: '0 auto' },
    section: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 },
    title:   { fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 12 },
    sel:     { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 },
    tab:     active => ({ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                background: active ? 'var(--accent)' : 'var(--bg2)', color: active ? '#000' : 'var(--text)' }),
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>📈 OEE Analytics</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>วิเคราะห์ประสิทธิภาพการผลิต — Availability · Performance · Quality</div>
      </div>

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
          {lines.map(l => <option key={l} value={l}>{l}</option>)}
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
    </div>
  );
}
