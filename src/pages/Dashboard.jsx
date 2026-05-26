import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
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
  const shiftInfo = getShiftInfo(now);
  const workDateStr = getWorkDateStr(now);

  const [selectedDate,  setSelectedDate]  = useState(workDateStr);
  const [selectedShift, setSelectedShift] = useState(shiftInfo.isDay ? 'day' : 'night');
  const [logs, setLogs]         = useState([]);
  const [fourMLogs, setFourMLogs] = useState([]);
  const [lines, setLines]       = useState([]);
  const [loading, setLoading]   = useState(true);

  const [empCounts, setEmpCounts] = useState({});   // { [line_id]: count }

  const [layouts,       setLayouts]       = useState([]);
  const [workstations,  setWorkstations]  = useState([]);
  const [stationEmpMap, setStationEmpMap] = useState({});
  const [expandedLine,  setExpandedLine]  = useState(null);

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
        .select('id, is_present, has_helmet, has_boots, has_gloves, has_ot, shift, employees!inner(id, name, employee_id_code, line_id, team, is_active)')
        .eq('work_date', date)
        .eq('employees.is_active', true),
      supabase.from('four_m_logs').select('*').eq('work_date', date).order('created_at', { ascending: false }),
      supabase.from('production_lines').select('id, name, section, std_day_shift, std_night_shift').order('name'),
      supabase.from('employees').select('id, line_id, team').eq('is_active', true),
      supabase.from('shift_schedules').select('line_id, day_team').eq('work_date', date),
      supabase.from('shift_overrides').select('employee_id, shift').eq('work_date', date),
      supabase.from('line_layouts').select('line_name, image_url'),
      supabase.from('workstations').select('id, line_name, station_name, pos_top, pos_left'),
      supabase.from('employee_home_positions').select('employee_id, station_id, employees(id, name, image_url, position)'),
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
    // Build stationEmpMap: station_id → employee + today's attendance
    const attMap = {};
    (logData || []).forEach(l => { if (l.employees?.id) attMap[l.employees.id] = l; });
    const semap = {};
    (hpData || []).forEach(hp => {
      if (!hp.employees) return;
      const att = attMap[hp.employee_id];
      semap[hp.station_id] = {
        ...hp.employees,
        is_present: att ? att.is_present : null,
        has_ot: att?.has_ot ?? false,
      };
    });
    setStationEmpMap(semap);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(selectedDate); }, [selectedDate]);

  /* Filter by assignedShift — computed per-employee based on their line's shift_schedules.
     This correctly handles lines where day_team differs (e.g. line A: Team A=day, line B: Team B=day) */
  const shiftLogs = selectedShift === 'all' ? logs : logs.filter(l => l.assignedShift === selectedShift);

  const present = shiftLogs.filter(l => l.is_present);
  const absent  = shiftLogs.filter(l => !l.is_present);
  const ppeReady = present.filter(l => l.has_helmet && l.has_boots && l.has_gloves);
  const otCount  = present.filter(l => l.has_ot).length;

  const shiftKey     = selectedShift === 'all' ? 'all' : selectedShift;

  const lineStats = lines.map(line => {
    const lineLogs    = shiftLogs.filter(l => l.employees?.line_id === line.id);
    const linePresent = lineLogs.filter(l => l.is_present).length;
    // Use standard manpower if set, fallback to actual employee count
    const stdTotal = selectedShift === 'day'  ? (line.std_day_shift   || 0)
                   : selectedShift === 'night' ? (line.std_night_shift || 0)
                   : (line.std_day_shift || 0) + (line.std_night_shift || 0);
    const lineTotal = stdTotal > 0 ? stdTotal : (empCounts[line.id]?.[shiftKey] ?? lineLogs.length);
    const lineAlerts  = fourMLogs.filter(f => f.line_name === line.name).length;
    const rate = lineTotal > 0 ? Math.round((linePresent / lineTotal) * 100) : 0;
    return { ...line, linePresent, lineTotal, lineAlerts, rate };
  });

  const totalCapacity = lineStats.reduce((s, l) => s + l.lineTotal, 0) || shiftLogs.length;

  const attendRate = totalCapacity > 0 ? Math.round((present.length / totalCapacity) * 100) : 0;
  const ppeRate    = present.length > 0 ? Math.round((ppeReady.length / present.length) * 100) : 0;

  const isToday = selectedDate === workDateStr;

  return (
    <div className="page-content" style={{ maxWidth: 1400 }}>

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: isMobile ? 10 : 14, marginBottom: 24 }}>
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
            label: '4M Alerts', value: fourMLogs.length, unit: 'รายการ',
            sub: fourMLogs.length > 0 ? `${[...new Set(fourMLogs.map(f => f.line_name))].length} ไลน์ได้รับผลกระทบ` : 'ไม่มีการแจ้งเตือน',
            accent: fourMLogs.length > 0 ? '#e74c3c' : '#22c55e', icon: '🚨', radial: null,
          },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} {...stagger(i + 2)}>
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border2)',
              borderRadius: 14, padding: isMobile ? '14px 14px' : '18px 20px',
              boxShadow: 'var(--shadow-sm)',
              borderTop: `3px solid ${kpi.accent}`,
              display: 'flex', flexDirection: 'column', gap: 4,
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 14, right: 16, opacity: 0.12, fontSize: 42, lineHeight: 1, userSelect: 'none' }}>
                {kpi.icon}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {kpi.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                {kpi.radial !== null ? (
                  <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
                    <RadialProgress pct={kpi.radial} size={60} stroke={6} color={kpi.accent} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: kpi.accent, fontFamily: 'var(--font-display)' }}>
                      {kpi.value}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 36, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', lineHeight: 1 }}>
                    {loading ? '—' : kpi.value}
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text2)', marginLeft: 4 }}>{kpi.unit}</span>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: isMobile ? 10 : 12 }}>
          {lineStats.map((line, i) => {
            const healthy = line.rate >= 80 && line.lineAlerts === 0;
            const warn    = line.lineAlerts > 0 || (line.rate > 0 && line.rate < 80);
            const color   = healthy ? '#22c55e' : warn ? '#f59e0b' : '#555';
            return (
              <motion.div key={line.id} {...stagger(8 + i)}>
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border2)',
                  borderRadius: 12, padding: '14px 16px',
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{line.name}</div>
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
                    <span style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
                      {line.linePresent}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>/ {line.lineTotal} คน</span>
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

      {/* ── Bottom Grid ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}>

        {/* Line Floor Maps */}
        <motion.div {...stagger(12)}>
          <div className="card" style={{ padding: 20, height: '100%' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 16 }}>
              🏭 Line Floor Maps
            </div>
            {layouts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
                ยังไม่มีผัง — ไปตั้งค่าที่หน้า <strong>ตั้งค่าผังไลน์</strong>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                {layouts.map(layout => {
                  const lineWs = workstations.filter(w => w.line_name === layout.line_name);
                  const lineStaff = lineWs.map(ws => stationEmpMap[ws.id]).filter(Boolean);
                  const presentCount = lineStaff.filter(e => e.is_present === true).length;
                  const absentCount  = lineStaff.filter(e => e.is_present === false).length;
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
                          const emp = stationEmpMap[ws.id];
                          if (!emp) return null;
                          const color = emp.is_present === true ? '#22c55e' : emp.is_present === false ? '#e74c3c' : '#aaa';
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
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {presentCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '2px 6px', borderRadius: 4 }}>✓ {presentCount}</span>}
                          {absentCount  > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#e74c3c', background: 'rgba(231,76,60,0.12)',  padding: '2px 6px', borderRadius: 4 }}>✗ {absentCount}</span>}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
              <AnimatePresence>
                {fourMLogs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>ไม่มีการแจ้งเตือน 4M</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, opacity: 0.6 }}>สถานะปกติ</div>
                  </div>
                ) : fourMLogs.map((log, i) => {
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
                  const emp = stationEmpMap[ws.id];
                  if (!emp) return null;
                  const color = emp.is_present === true ? '#22c55e' : emp.is_present === false ? '#e74c3c' : '#aaa';
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
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                {[['#22c55e', 'มาทำงาน'], ['#e74c3c', 'ขาดงาน'], ['#aaa', 'ยังไม่เช็คชื่อ']].map(([c, l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: c, boxShadow: `0 0 5px ${c}` }} />
                    {l}
                  </div>
                ))}
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
