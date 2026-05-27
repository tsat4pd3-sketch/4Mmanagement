import { useState, useEffect, useRef, useContext, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';

function getWorkDate() {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
}

/* ── Signature URL to DataURL helper ── */
async function urlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ── CSV export utility ── */
function downloadCSV(filename, headers, rows) {
  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function CsvBtn({ onClick, style = {} }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
      background: 'rgba(34,197,94,0.12)', color: '#22c55e',
      border: '1px solid rgba(34,197,94,0.35)', display: 'flex', alignItems: 'center', gap: 5,
      ...style,
    }}>
      ⬇️ CSV
    </button>
  );
}

const CAT_META = {
  Man:      { color: '#4d9fff', bg: 'rgba(77,159,255,0.12)',  label: 'Man',      icon: '👷' },
  Machine:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Machine',  icon: '⚙️' },
  Material: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'Material', icon: '📦' },
  Method:   { color: '#c084fc', bg: 'rgba(139,92,246,0.12)', label: 'Method',   icon: '📋' },
};

const TABS = ['รายวัน', 'รายพนักงาน', '📍 Log จุดงาน', 'สรุปช่วงเวลา', '🚨 4M Changes', '📊 Skill Matrix', '📤 Export', '💰 ค่าฝีมือ', '📋 ใบบันทึก', '🏅 Multi-Skill Form'];

const SKILL_LEVELS = [
  { min: 80, label: 'ชำนาญ',       color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { min: 60, label: 'ผ่านเกณฑ์',   color: '#84cc16', bg: 'rgba(132,204,18,0.15)' },
  { min: 40, label: 'กำลังพัฒนา', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { min: 0,  label: 'เริ่มต้น',     color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
];
const getLevel = (score) => SKILL_LEVELS.find(l => score >= l.min) || SKILL_LEVELS[3];

const lbSt = { fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4, display: 'block' };

export default function Report() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="page-content">
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
          📋 รายงาน
        </h2>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', flexShrink: 0 }}>
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setActiveTab(i)} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            background: activeTab === i ? 'var(--accent)' : 'var(--bg3)',
            color: activeTab === i ? '#fff' : 'var(--text2)',
            fontWeight: activeTab === i ? 700 : 400,
          }}>{t}</button>
        ))}
      </div>
      {activeTab === 0 && <DailyTab />}
      {activeTab === 1 && <PerEmployeeTab />}
      {activeTab === 2 && <StationLogTab />}
      {activeTab === 3 && <RangeTab />}
      {activeTab === 4 && <FourMTab />}
      {activeTab === 5 && <SkillMatrixTab />}
      {activeTab === 6 && <ExportTab goToTab={setActiveTab} />}
      {activeTab === 7 && <SkillAllowanceTab />}
      {activeTab === 8 && <AttendanceFormTab />}
      {activeTab === 9 && <MultiSkillFormTab />}
    </div>
  );
}

function DailyTab() {
  const now = new Date();
  const isDay = (now.getHours() * 60 + now.getMinutes()) >= 480 && (now.getHours() * 60 + now.getMinutes()) < 1200;
  const [date, setDate]   = useState(getWorkDate());
  const [shift, setShift] = useState(isDay ? 'day' : 'night');
  const [logs, setLogs]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [stationMap, setStationMap] = useState({});

  useEffect(() => {
    supabase.from('workstations').select('id, station_name').then(({ data }) => {
      const m = {};
      (data || []).forEach(w => { m[String(w.id)] = w.station_name; });
      setStationMap(m);
    });
  }, []);

  useEffect(() => { load(); }, [date, shift]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('daily_production_logs')
      .select('*, employees(name, employee_id_code, image_url, department, team)')
      .eq('work_date', date).eq('is_present', true).order('updated_at');

    // filter by shift: use shift column if present, fallback to employee.team
    const filtered = (data || []).filter(l => {
      if (shift === 'all') return true;
      const s = l.shift;
      const team = l.employees?.team;
      if (s) return s === shift;
      if (shift === 'day')   return team === 'A' || team === 'C' || !team;
      if (shift === 'night') return team === 'B' || team === 'C' || !team;
      return true;
    });
    setLogs(filtered);
    setLoading(false);
  };

  const shiftBtnStyle = (val) => ({
    padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    background: shift === val
      ? val === 'day' ? 'rgba(245,158,11,0.2)' : val === 'night' ? 'rgba(77,159,255,0.2)' : 'rgba(255,255,255,0.1)'
      : 'transparent',
    color: shift === val
      ? val === 'day' ? '#f59e0b' : val === 'night' ? '#4d9fff' : 'var(--text2)'
      : 'var(--muted)',
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        {/* Shift toggle */}
        <div style={{ display: 'flex', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 3, gap: 2 }}>
          <button style={shiftBtnStyle('day')}   onClick={() => setShift('day')}>☀️ กะเช้า</button>
          <button style={shiftBtnStyle('night')} onClick={() => setShift('night')}>🌙 กะดึก</button>
          <button style={shiftBtnStyle('all')}   onClick={() => setShift('all')}>ทั้งหมด</button>
        </div>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>รวม {logs.length} คน</span>
        <CsvBtn onClick={() => downloadCSV(
          `daily_${date}_${shift}.csv`,
          ['วันที่', 'กะ', 'รหัสพนักงาน', 'ชื่อ', 'แผนก', 'หมวก', 'รองเท้า', 'ถุงมือ', 'OT'],
          logs.map(l => [date, l.shift || (l.employees?.team === 'A' ? 'day' : l.employees?.team === 'B' ? 'night' : ''), l.employees?.employee_id_code, l.employees?.name, l.employees?.department || '', l.has_helmet ? '✓' : '✗', l.has_boots ? '✓' : '✗', l.has_gloves ? '✓' : '✗', l.has_ot ? '✓' : ''])
        )} />
      </div>
      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 500 }}>
            <thead><tr><th>โปรไฟล์</th><th>ID</th><th>ชื่อ</th><th>แผนก</th><th>PPE</th><th>จุดงาน</th></tr></thead>
            <tbody>
              {logs.length === 0 ? <EmptyRow cols={6} /> : logs.map(l => (
                <tr key={l.id}>
                  <td><Thumb src={l.employees?.image_url} /></td>
                  <td style={{ color: 'var(--blue)', fontWeight: 700 }}>{l.employees?.employee_id_code}</td>
                  <td style={{ fontWeight: 600 }}>{l.employees?.name}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{l.employees?.department || '—'}</td>
                  <td>
                    <StatusBadge ok={l.has_helmet} label="หมวก" />
                    <StatusBadge ok={l.has_boots} label="รองเท้า" />
                    <StatusBadge ok={l.has_gloves} label="ถุงมือ" />
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.assigned_line ? (stationMap[String(l.assigned_line)] || l.assigned_line) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PerEmployeeTab() {
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [stationMap, setStationMap] = useState({});

  useEffect(() => {
    supabase.from('workstations').select('id, station_name').then(({ data }) => {
      const m = {};
      (data || []).forEach(w => { m[String(w.id)] = w.station_name; });
      setStationMap(m);
    });
    supabase.from('employees').select('id, name, employee_id_code').eq('is_active', true).order('name').then(({ data }) => {
      setEmployees(data || []);
      if (data?.length) setSelected(data[0].id);
    });
  }, []);

  useEffect(() => { if (selected) load(); }, [selected, month]);

  const load = async () => {
    setLoading(true);
    const from = month + '-01';
    const to = month + '-31';
    const { data } = await supabase.from('daily_production_logs')
      .select('work_date, is_present, has_helmet, has_boots, has_gloves, assigned_line')
      .eq('employee_id', selected).gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false });
    setLogs(data || []);
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
          {employees.map(e => <option key={e.id} value={e.id}>{e.employee_id_code} — {e.name}</option>)}
        </select>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>มา {logs.filter(l => l.is_present).length} วัน</span>
        <CsvBtn onClick={() => {
          const emp = employees.find(e => e.id === selected);
          downloadCSV(
            `employee_${emp?.employee_id_code || selected}_${month}.csv`,
            ['วันที่', 'มาทำงาน', 'หมวก', 'รองเท้า', 'ถุงมือ', 'จุดงาน'],
            logs.map(l => [l.work_date, l.is_present ? '✓' : '✗', l.has_helmet ? '✓' : '✗', l.has_boots ? '✓' : '✗', l.has_gloves ? '✓' : '✗', l.assigned_line || ''])
          );
        }} />
      </div>
      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 400 }}>
            <thead><tr><th>วันที่</th><th>PPE</th><th>จุดงาน</th></tr></thead>
            <tbody>
              {logs.length === 0 ? <EmptyRow cols={3} /> : logs.map((l, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{l.work_date}</td>
                  <td>
                    <StatusBadge ok={l.has_helmet} label="หมวก" />
                    <StatusBadge ok={l.has_boots} label="รองเท้า" />
                    <StatusBadge ok={l.has_gloves} label="ถุงมือ" />
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.assigned_line ? (stationMap[String(l.assigned_line)] || l.assigned_line) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StationLogTab() {
  const today = getWorkDate();
  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [from, setFrom] = useState(() => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; });
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('workstations').select('id, station_name, line_name').order('line_name').order('station_name').then(({ data }) => {
      setStations(data || []);
      if (data?.length) setSelectedStation(String(data[0].id));
    });
  }, []);

  useEffect(() => { if (selectedStation) load(); }, [selectedStation, from, to]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('daily_production_logs')
      .select('work_date, is_present, has_helmet, has_boots, has_gloves, shift, employees(name, employee_id_code, image_url, team, section)')
      .eq('assigned_line', selectedStation)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false });
    setRows(data || []);
    setLoading(false);
  };

  const station = stations.find(s => String(s.id) === selectedStation);

  // group by line for optgroup
  const byLine = stations.reduce((acc, s) => {
    if (!acc[s.line_name]) acc[s.line_name] = [];
    acc[s.line_name].push(s);
    return acc;
  }, {});

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={selectedStation} onChange={e => setSelectedStation(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13, minWidth: 200 }}>
          {Object.entries(byLine).map(([line, sts]) => (
            <optgroup key={line} label={line}>
              {sts.map(s => <option key={s.id} value={String(s.id)}>{s.station_name}</option>)}
            </optgroup>
          ))}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{rows.length} รายการ</span>
        <CsvBtn onClick={() => downloadCSV(
          `station_${station?.station_name || selectedStation}_${from}_${to}.csv`,
          ['วันที่', 'รหัส', 'ชื่อ', 'ทีม', 'สังกัด', 'มาทำงาน', 'PPE ครบ'],
          rows.map(r => [r.work_date, r.employees?.employee_id_code, r.employees?.name, r.employees?.team || '', r.employees?.section || '', r.is_present ? '✓' : '✗', (r.has_helmet && r.has_boots && r.has_gloves) ? '✓' : '✗'])
        )} />
      </div>

      {station && (
        <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid rgba(61,214,92,0.2)', display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>📍 {station.station_name}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{station.line_name}</span>
        </div>
      )}

      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>โปรไฟล์</th>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th>ทีม</th>
                <th>PPE</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <EmptyRow cols={7} /> : rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{r.work_date}</td>
                  <td><Thumb src={r.employees?.image_url} /></td>
                  <td style={{ color: 'var(--blue)', fontWeight: 700 }}>{r.employees?.employee_id_code}</td>
                  <td style={{ fontWeight: 600 }}>{r.employees?.name}</td>
                  <td style={{ fontSize: 12 }}>
                    {r.employees?.team && <span style={{ background: 'rgba(77,159,255,0.15)', color: '#4d9fff', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>Team {r.employees.team}</span>}
                  </td>
                  <td>
                    <StatusBadge ok={r.has_helmet} label="หมวก" />
                    <StatusBadge ok={r.has_boots} label="รองเท้า" />
                    <StatusBadge ok={r.has_gloves} label="ถุงมือ" />
                  </td>
                  <td>
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.is_present ? 'var(--green)' : 'var(--red)' }}>
                      {r.is_present ? '✓ มา' : '✗ ขาด'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RangeTab() {
  const today = getWorkDate();
  const [from, setFrom] = useState(() => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; });
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { load(); }, [from, to]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('daily_production_logs')
      .select('work_date, is_present, employee_id, employees(name, employee_id_code)')
      .gte('work_date', from).lte('work_date', to);
    const map = {};
    (data || []).forEach(l => {
      const key = l.employee_id;
      if (!map[key]) map[key] = { name: l.employees?.name, code: l.employees?.employee_id_code, total: 0, present: 0 };
      map[key].total++;
      if (l.is_present) map[key].present++;
    });
    setRows(Object.values(map).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--muted)' }}>จาก</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
          <span style={{ color: 'var(--muted)' }}>ถึง</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        </div>
        <CsvBtn onClick={() => downloadCSV(
          `summary_${from}_${to}.csv`,
          ['รหัสพนักงาน', 'ชื่อ', 'วันที่มา', 'วันทั้งหมด', '%การมาทำงาน'],
          rows.map(r => [r.code, r.name, r.present, r.total, r.total ? Math.round(r.present / r.total * 100) + '%' : '0%'])
        )} />
      </div>
      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 420 }}>
            <thead><tr><th>ID</th><th>ชื่อ</th><th>มาทำงาน</th><th>%</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <EmptyRow cols={4} /> : rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--blue)', fontWeight: 700 }}>{r.code}</td>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td><KpiSmall value={r.present} label={`/ ${r.total} วัน`} /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--bg3)', borderRadius: 3, minWidth: 60 }}>
                        <div style={{ width: `${r.total ? (r.present / r.total * 100) : 0}%`, height: '100%', background: 'var(--green)', borderRadius: 3, transition: 'width 0.5s' }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 30 }}>{r.total ? Math.round(r.present / r.total * 100) : 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STATUS_META = {
  pending:     { label: '⏳ รอ SV Approve',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  pending_qa:  { label: '🔍 รอ QA Approve',  color: '#a855f7', bg: 'rgba(168,85,247,0.12)'  },
  approved:    { label: '✅ Approved',        color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  rejected:    { label: '❌ Rejected',        color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
};

function FourMTab() {
  const { role } = useContext(UserContext);

  // Determine if the current user can act on this log at its current stage
  const canApproveLog = (log) => {
    if (['admin', 'manager'].includes(role)) return true;
    if (log.status === 'pending')    return ['supervisor', 'leader'].includes(role);
    if (log.status === 'pending_qa') return role === 'qa';
    return false;
  };

  const today = getWorkDate();
  const [from,        setFrom]        = useState(() => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; });
  const [to,          setTo]          = useState(today);
  const [line,        setLine]        = useState('');
  const [cat,         setCat]         = useState('');
  const [statusFilter,setStatusFilter]= useState('');
  const [logs,        setLogs]        = useState([]);
  const [lines,       setLines]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [rejectModal,  setRejectModal]  = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [profileMap,   setProfileMap]   = useState({});
  const [qaApproveModal,  setQaApproveModal]  = useState(null); // log waiting for QA image
  const [qaImageFile,     setQaImageFile]     = useState(null);
  const [qaImagePreview,  setQaImagePreview]  = useState(null);
  const [isApprovingSaving, setIsApprovingSaving] = useState(false);
  const [imageViewModal, setImageViewModal] = useState(null); // { url, title }

  useEffect(() => {
    supabase.from('production_lines').select('name').order('name').then(({ data }) => setLines(data || []));
  }, []);

  useEffect(() => { load(); }, [from, to, line, cat, statusFilter]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('four_m_logs')
      .select('id, work_date, line_name, category, description, created_at, status, sv_approved_by, sv_approved_at, approved_by, approved_at, reject_reason, requires_qa, change_subtype, created_by, request_image_url, qa_image_url')
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (line)         q = q.eq('line_name', line);
    if (cat)          q = q.eq('category', cat);
    if (statusFilter) q = q.eq('status', statusFilter);
    const { data } = await q;
    setLogs(data || []);

    const allIds = [...new Set((data || []).flatMap(l => [l.sv_approved_by, l.approved_by].filter(Boolean)))];
    if (allIds.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', allIds);
      const map = {};
      (profiles || []).forEach(p => { map[p.id] = p.full_name || 'ไม่ระบุ'; });
      setProfileMap(map);
    }
    setLoading(false);
  };

  const handleApprove = async (log) => {
    // QA step requires image confirmation — open modal instead
    if (log.status === 'pending_qa') {
      setQaApproveModal(log);
      setQaImageFile(null);
      setQaImagePreview(null);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    let update;
    let nextStatus;

    if (log.requires_qa !== false) {
      update = { status: 'pending_qa', sv_approved_by: user.id, sv_approved_at: now };
      nextStatus = 'pending_qa';
    } else {
      update = { status: 'approved', sv_approved_by: user.id, sv_approved_at: now, approved_by: user.id, approved_at: now, reject_reason: null };
      nextStatus = 'approved';
    }

    const { error } = await supabase.from('four_m_logs').update(update).eq('id', log.id);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    toast.success(nextStatus === 'pending_qa' ? 'SV Approved → รอ QA' : 'Approved เรียบร้อย');
    supabase.functions.invoke('send-notification', { body: { event: 'status_change', log: { ...log, ...update, status: nextStatus } } }).catch(() => {});
    load();
  };

  const handleQaApproveSubmit = async () => {
    if (!qaImageFile) { toast.error('กรุณาแนบรูปยืนยันคุณภาพงาน'); return; }
    setIsApprovingSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    const ext = qaImageFile.name.split('.').pop();
    const path = `qa/${Date.now()}_${user?.id ?? 'anon'}.${ext}`;
    const { error: upErr } = await supabase.storage.from('four-m-images').upload(path, qaImageFile, { upsert: false });
    if (upErr) { toast.error('อัปโหลดรูปไม่สำเร็จ: ' + upErr.message); setIsApprovingSaving(false); return; }
    const { data: urlData } = supabase.storage.from('four-m-images').getPublicUrl(path);
    const qa_image_url = urlData.publicUrl;

    const now = new Date().toISOString();
    const update = { status: 'approved', approved_by: user.id, approved_at: now, reject_reason: null, qa_image_url };
    const { error } = await supabase.from('four_m_logs').update(update).eq('id', qaApproveModal.id);
    setIsApprovingSaving(false);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    toast.success('QA Approved เรียบร้อย');
    supabase.functions.invoke('send-notification', { body: { event: 'status_change', log: { ...qaApproveModal, ...update, status: 'approved' } } }).catch(() => {});
    setQaApproveModal(null); setQaImageFile(null); setQaImagePreview(null);
    load();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('four_m_logs').update({
      status: 'rejected', approved_by: user.id, approved_at: new Date().toISOString(), reject_reason: rejectReason.trim(),
    }).eq('id', rejectModal);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    toast.success('Rejected แล้ว');
    const log = logs.find(l => l.id === rejectModal);
    if (log) supabase.functions.invoke('send-notification', { body: { event: 'status_change', log: { ...log, status: 'rejected', reject_reason: rejectReason.trim() } } }).catch(() => {});
    setRejectModal(null); setRejectReason('');
    load();
  };

  const [exporting, setExporting] = useState(false);

  const handleExportPdf = async () => {
    setExporting(true);
    const allIds = [...new Set(logs.flatMap(l => [l.sv_approved_by, l.approved_by].filter(Boolean)))];
    const { data: sigProfiles } = await supabase.from('profiles').select('id, full_name, signature_url').in('id', allIds.length ? allIds : ['__none__']);
    const sigMap = {};
    for (const p of (sigProfiles || [])) {
      const sigUrl = p.signature_url ? await urlToDataUrl(p.signature_url) : null;
      sigMap[p.id] = { name: p.full_name, sigUrl };
    }

    const todayStr = new Date().toLocaleDateString('th-TH', { dateStyle: 'long' });
    const rowsHtml = logs.map((l, i) => {
      const m = { Man: { icon: '👤', color: '#3b82f6' }, Machine: { icon: '⚙️', color: '#8b5cf6' }, Material: { icon: '📦', color: '#f59e0b' }, Method: { icon: '📋', color: '#22c55e' } }[l.category] || {};
      const statusLabel = l.status === 'approved' ? '✅ Approved' : l.status === 'rejected' ? '❌ Rejected' : l.status === 'pending_qa' ? '🔍 รอ QA' : '⏳ Pending';
      const svApprover  = l.sv_approved_by ? sigMap[l.sv_approved_by] : null;
      const qaApprover  = l.approved_by    ? sigMap[l.approved_by]    : null;
      const needsQA     = l.requires_qa !== false;
      return `<tr>
        <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;white-space:nowrap">${i+1}</td>
        <td style="border:1px solid #ccc;padding:4px 6px;white-space:nowrap">${l.work_date}</td>
        <td style="border:1px solid #ccc;padding:4px 6px">${l.line_name}</td>
        <td style="border:1px solid #ccc;padding:4px 6px;color:${m.color || '#000'}">${l.category}</td>
        <td style="border:1px solid #ccc;padding:4px 6px;font-size:11px">${l.description}</td>
        <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;white-space:nowrap">${statusLabel}</td>
        <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;min-width:80px">
          ${svApprover?.sigUrl ? `<img src="${svApprover.sigUrl}" style="max-height:36px;max-width:72px;object-fit:contain"/>` : ''}
          ${svApprover?.name ? `<div style="font-size:9px;color:#666;margin-top:2px">${svApprover.name}</div>` : ''}
        </td>
        <td style="border:1px solid #ccc;padding:4px 6px;text-align:center;min-width:80px">
          ${!needsQA ? '<span style="color:#999;font-size:10px">-</span>' : qaApprover?.sigUrl ? `<img src="${qaApprover.sigUrl}" style="max-height:36px;max-width:72px;object-fit:contain"/>` : ''}
          ${needsQA && qaApprover?.name ? `<div style="font-size:9px;color:#666;margin-top:2px">${qaApprover.name}</div>` : ''}
        </td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>4M Change Log</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff}
  table{border-collapse:collapse;width:100%}
  @media print{@page{size:A4 landscape;margin:10mm}body{-webkit-print-color-adjust:exact}}
</style></head><body style="padding:10mm">
  <h2 style="margin:0 0 4px;font-size:16px">บันทึกการเปลี่ยนแปลง 4M</h2>
  <p style="color:#666;margin:0 0 12px;font-size:10px">พิมพ์วันที่: ${todayStr} · รวม ${logs.length} รายการ</p>
  <table>
    <thead><tr style="background:#f3f4f6">
      <th style="border:1px solid #ccc;padding:4px;text-align:center">#</th>
      <th style="border:1px solid #ccc;padding:4px">วันที่</th>
      <th style="border:1px solid #ccc;padding:4px">ไลน์</th>
      <th style="border:1px solid #ccc;padding:4px">ประเภท</th>
      <th style="border:1px solid #ccc;padding:4px">รายละเอียด</th>
      <th style="border:1px solid #ccc;padding:4px;text-align:center">สถานะ</th>
      <th style="border:1px solid #ccc;padding:4px;text-align:center">ลายเซ็น SV</th>
      <th style="border:1px solid #ccc;padding:4px;text-align:center">ลายเซ็น QA</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
<script>window.onload = () => window.print();</script>
</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setExporting(false);
  };

  const kpi = Object.fromEntries(Object.keys(CAT_META).map(k => [k, logs.filter(l => l.category === k).length]));
  const actionableCount = logs.filter(l => ['pending','pending_qa'].includes(l.status)).length;

  return (
    <div>
      {/* Reject modal */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '24px 24px 20px', width: 'min(420px,94vw)', boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 14px', color: '#ef4444', fontFamily: 'var(--font-display)' }}>❌ ระบุเหตุผลที่ Reject</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="เหตุผลที่ไม่อนุมัติ..." rows={3}
              style={{ width: '100%', borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={handleReject}
                style={{ flex: 2, padding: 11, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                ยืนยัน Reject
              </button>
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }}
                style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QA Approve Modal */}
      {qaApproveModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '24px 24px 20px', width: 'min(460px,94vw)', boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 4px', color: '#a855f7', fontFamily: 'var(--font-display)' }}>🔍 QA ยืนยันคุณภาพงาน</h3>
            <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13 }}>
              {qaApproveModal.line_name} · {qaApproveModal.category} · {qaApproveModal.description}
            </p>
            {/* Request image preview */}
            {qaApproveModal.request_image_url && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>📎 รูปจากผู้แจ้ง</div>
                <img src={qaApproveModal.request_image_url} style={{ maxHeight: 130, maxWidth: '100%', borderRadius: 8, objectFit: 'contain', border: '1px solid var(--border2)', cursor: 'pointer' }}
                  onClick={() => setImageViewModal({ url: qaApproveModal.request_image_url, title: 'รูปจากผู้แจ้ง' })} />
              </div>
            )}
            <div style={{ fontSize: 12, color: '#a855f7', fontWeight: 600, marginBottom: 6 }}>📷 แนบรูปยืนยันคุณภาพ <span style={{ color: '#ef4444' }}>*</span></div>
            <div style={{ border: `2px dashed ${qaImageFile ? '#a855f7' : 'var(--border2)'}`, borderRadius: 8, padding: '10px 12px', background: qaImageFile ? 'rgba(168,85,247,0.06)' : 'var(--bg2)', cursor: 'pointer', textAlign: 'center' }}
              onClick={() => document.getElementById('qa-img-input').click()}>
              <input id="qa-img-input" type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setQaImageFile(f);
                  const reader = new FileReader();
                  reader.onload = ev => setQaImagePreview(ev.target.result);
                  reader.readAsDataURL(f);
                }} />
              {qaImagePreview
                ? <img src={qaImagePreview} style={{ maxHeight: 140, maxWidth: '100%', borderRadius: 6, objectFit: 'contain' }} />
                : <div style={{ color: 'var(--muted)', fontSize: 13 }}>📷 แตะเพื่อเลือกรูปยืนยัน</div>}
            </div>
            {qaImageFile && (
              <button type="button" onClick={() => { setQaImageFile(null); setQaImagePreview(null); }}
                style={{ marginTop: 4, fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                ✕ ลบรูป
              </button>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={handleQaApproveSubmit} disabled={isApprovingSaving}
                style={{ flex: 2, padding: 11, background: '#a855f7', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: isApprovingSaving ? 'not-allowed' : 'pointer', opacity: isApprovingSaving ? 0.6 : 1 }}>
                {isApprovingSaving ? 'กำลังบันทึก...' : '✅ QA Approve'}
              </button>
              <button onClick={() => { setQaApproveModal(null); setQaImageFile(null); setQaImagePreview(null); }} disabled={isApprovingSaving}
                style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image viewer modal */}
      {imageViewModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setImageViewModal(null)}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, color: '#fff', marginBottom: 8, fontWeight: 600 }}>{imageViewModal.title}</div>
            <img src={imageViewModal.url} style={{ maxWidth: '88vw', maxHeight: '80vh', borderRadius: 10, objectFit: 'contain', display: 'block' }} />
            <button onClick={() => setImageViewModal(null)}
              style={{ position: 'absolute', top: -10, right: -10, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 28, height: 28, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ×
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {Object.entries(CAT_META).map(([k, m]) => (
          <div key={k} onClick={() => setCat(c => c === k ? '' : k)} style={{
            background: cat === k ? m.bg : 'var(--card)', border: `1px solid ${cat === k ? m.color : 'var(--border)'}`,
            borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s'
          }}>
            <div style={{ fontSize: 20 }}>{m.icon}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{m.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: m.color, fontFamily: 'var(--font-display)' }}>{kpi[k] || 0}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }} />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }} />
        <select value={line} onChange={e => setLine(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }}>
          <option value="">ทุกไลน์</option>
          {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
        </select>
        <select value={cat} onChange={e => setCat(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }}>
          <option value="">ทุกประเภท</option>
          {Object.keys(CAT_META).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 12 }}>
          <option value="">ทุกสถานะ</option>
          <option value="pending">⏳ รอ SV Approve</option>
          <option value="pending_qa">🔍 รอ QA Approve</option>
          <option value="approved">✅ Approved</option>
          <option value="rejected">❌ Rejected</option>
        </select>
        {actionableCount > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 6, padding: '3px 8px' }}>
            ⏳ รอดำเนินการ {actionableCount} รายการ
          </span>
        )}
        <button onClick={handleExportPdf} disabled={exporting || logs.length === 0}
          style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)',
            opacity: (exporting || logs.length === 0) ? 0.5 : 1 }}>
          {exporting ? 'กำลังสร้าง...' : '🖨️ Export PDF'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>⬇️ ดาวน์โหลดได้จากแท็บ Export</span>
      </div>

      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>วันที่</th><th>ไลน์</th><th>ประเภท</th><th>รายละเอียด</th>
                <th style={{ textAlign: 'center' }}>สถานะ</th>
                <th style={{ textAlign: 'center', minWidth: 90 }}>ระดับ</th>
                <th style={{ textAlign: 'center', minWidth: 160 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? <EmptyRow cols={7} /> : logs.map(l => {
                const m  = CAT_META[l.category] || {};
                const sm = STATUS_META[l.status] || STATUS_META.pending;
                const svName  = l.sv_approved_by ? (profileMap[l.sv_approved_by] || '...') : null;
                const qaName  = l.approved_by    ? (profileMap[l.approved_by]    || '...') : null;
                const needsQA = l.requires_qa !== false;
                const userCanAct = canApproveLog(l);
                const isActionable = ['pending','pending_qa'].includes(l.status);
                return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: 12 }}>{l.work_date}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.line_name}</td>
                    <td><span style={{ background: m.bg, color: m.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{m.icon} {l.category}</span></td>
                    <td style={{ fontSize: 13 }}>
                      {l.description}
                      {l.change_subtype && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{l.change_subtype === 'replace' ? '🔄 Replace' : '⚠️ Change'}</div>}
                      {l.reject_reason && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>เหตุผล: {l.reject_reason}</div>}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {l.request_image_url && (
                          <button onClick={() => setImageViewModal({ url: l.request_image_url, title: '📎 รูปจากผู้แจ้ง' })}
                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', background: 'rgba(168,85,247,0.12)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)', fontWeight: 600 }}>
                            📎 รูปแจ้ง
                          </button>
                        )}
                        {l.qa_image_url && (
                          <button onClick={() => setImageViewModal({ url: l.qa_image_url, title: '🔍 รูป QA ยืนยัน' })}
                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontWeight: 600 }}>
                            🔍 รูป QA
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ background: sm.bg, color: sm.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{sm.label}</span>
                        {svName && <span style={{ fontSize: 9, color: 'var(--muted)' }}>SV: {svName}</span>}
                        {qaName && <span style={{ fontSize: 9, color: 'var(--muted)' }}>QA: {qaName}</span>}
                        {l.approved_at && <span style={{ fontSize: 9, color: 'var(--muted)' }}>{new Date(l.approved_at).toLocaleDateString('th-TH')}</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                        background: needsQA ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                        color: needsQA ? '#ef4444' : '#22c55e' }}>
                        {needsQA ? '🔴 QA' : '🟢 SV'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {isActionable ? (
                        userCanAct ? (
                          <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                            <button onClick={() => handleApprove(l)}
                              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
                              ✅ {l.status === 'pending_qa' ? 'QA Approve' : 'SV Approve'}
                            </button>
                            <button onClick={() => { setRejectModal(l.id); setRejectReason(''); }}
                              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                              ❌ Reject
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {l.status === 'pending_qa' ? 'รอ QA' : needsQA ? 'รอ SV → QA' : 'รอหัวหน้า'}
                          </span>
                        )
                      ) : (
                        ['admin','manager'].includes(role) && (
                          <button onClick={() => supabase.from('four_m_logs').update({ status: 'pending', sv_approved_by: null, sv_approved_at: null, approved_by: null, approved_at: null, reject_reason: null }).eq('id', l.id).then(load)}
                            style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                            Reset
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Radar tooltip ── */
function RadarTooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { subject, value } = payload[0].payload;
  const lv = getLevel(value);
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{subject}</div>
      <div style={{ color: lv.color, fontWeight: 800, fontSize: 15 }}>{value}<span style={{ fontSize: 10, fontWeight: 400, marginLeft: 2 }}>/ 100</span></div>
      <div style={{ fontSize: 10, color: lv.color }}>{lv.label}</div>
    </div>
  );
}

/* ── Radar Panel ── */
function OperatorRadarPanel({ emp, skillDefs, onClose }) {
  const skillMap = {};
  (emp.employee_skills || []).forEach(s => { skillMap[s.skill_name] = s.score; });

  const radarData = skillDefs.map(s => ({
    subject: s.label,
    value: skillMap[s.name] ?? 0,
    color: s.color || '#4d9fff',
    fullMark: 100,
  }));

  const scores = radarData.map(d => d.value);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const overall = getLevel(avg);

  /* dynamic gradient based on avg */
  const glowColor = avg >= 80 ? '#22c55e' : avg >= 60 ? '#84cc16' : avg >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(460px, 94vw)',
        background: 'var(--bg2)',
        border: `1px solid ${glowColor}55`,
        borderRadius: 20,
        boxShadow: `0 0 40px ${glowColor}33, 0 20px 60px rgba(0,0,0,0.8)`,
        overflow: 'hidden',
        animation: 'smSlideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
      }}>
        <style>{`
          @keyframes smSlideUp {
            from { opacity:0; transform:translateY(30px) scale(0.96); }
            to   { opacity:1; transform:translateY(0) scale(1); }
          }
        `}</style>

        {/* Header stripe */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${glowColor}, transparent)` }} />

        {/* Profile section */}
        <div style={{ padding: '20px 24px 12px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <img
              src={emp.image_url || ''}
              alt=""
              onError={e => { e.target.style.display = 'none'; }}
              style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'cover', border: `2px solid ${glowColor}88`, display: emp.image_url ? 'block' : 'none' }}
            />
            {!emp.image_url && (
              <div style={{
                width: 72, height: 72, borderRadius: 14,
                background: `linear-gradient(135deg, ${glowColor}44, ${glowColor}22)`,
                border: `2px solid ${glowColor}88`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, fontWeight: 800, color: glowColor,
              }}>
                {(emp.name || '?')[0]}
              </div>
            )}
            {/* Overall ring */}
            <div style={{
              position: 'absolute', bottom: -6, right: -6,
              background: glowColor, color: '#fff',
              borderRadius: 8, padding: '1px 6px', fontSize: 10, fontWeight: 800,
              border: '2px solid var(--bg2)',
            }}>{avg}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text)', lineHeight: 1.2 }}>{emp.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{emp.employee_id_code}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {emp.group_name && <span style={{ fontSize: 10, background: 'var(--bg3)', color: 'var(--text2)', borderRadius: 5, padding: '2px 7px', border: '1px solid var(--border2)' }}>{emp.group_name}</span>}
              <span style={{ fontSize: 10, background: `${glowColor}22`, color: glowColor, borderRadius: 5, padding: '2px 7px', border: `1px solid ${glowColor}44`, fontWeight: 700 }}>
                {overall.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: 4, alignSelf: 'flex-start' }}>✕</button>
        </div>

        {/* Stat bars row */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(radarData.length, 4)}, 1fr)`, gap: 6, padding: '0 24px 12px' }}>
          {radarData.slice(0, 4).map(d => {
            const lv = getLevel(d.value);
            return (
              <div key={d.subject} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.subject}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: lv.color, fontFamily: 'var(--font-display)' }}>{d.value}</div>
                <div style={{ height: 3, background: 'var(--border2)', borderRadius: 2, marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${d.value}%`, background: lv.color, borderRadius: 2, transition: 'width 0.6s ease' }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Radar Chart */}
        <div style={{ padding: '0 12px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Skill Radar</div>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <PolarGrid stroke="var(--border2)" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: 'var(--text2)', fontSize: 11, fontFamily: 'var(--font-body)' }}
              />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                dataKey="value"
                stroke={glowColor}
                fill={glowColor}
                fillOpacity={0.25}
                strokeWidth={2}
                dot={{ r: 4, fill: glowColor, strokeWidth: 0 }}
              />
              <Tooltip content={<RadarTooltipContent />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* All skill bars (if > 4 skills) */}
        {radarData.length > 4 && (
          <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {radarData.slice(4).map(d => {
              const lv = getLevel(d.value);
              return (
                <div key={d.subject} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.subject}</div>
                  <div style={{ flex: 1, height: 6, background: 'var(--border2)', borderRadius: 3 }}>
                    <div style={{ height: '100%', width: `${d.value}%`, background: lv.color, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: lv.color, width: 28, textAlign: 'right' }}>{d.value}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillMatrixTab() {
  const [skillDefs,    setSkillDefs]    = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [filterLine,   setFilterLine]   = useState('');
  const [lines,        setLines]        = useState([]);
  const [selectedEmp,  setSelectedEmp]  = useState(null);

  useEffect(() => {
    supabase.from('production_lines').select('id, name').order('name').then(({ data }) => setLines(data || []));
    load();
  }, []);

  useEffect(() => { load(); }, [filterLine]);

  const load = async () => {
    setLoading(true);
    const baseSelect = 'id, name, employee_id_code, image_url, group_name, line_id, employee_skills(skill_name, score)';
    const [{ data: defs }, { data: emps }] = await Promise.all([
      supabase.from('skill_definitions').select('*').order('sort_order'),
      filterLine
        ? supabase.from('employees').select(baseSelect).eq('is_active', true).eq('line_id', filterLine).order('name')
        : supabase.from('employees').select(baseSelect).eq('is_active', true).order('name'),
    ]);
    setSkillDefs(defs || []);
    setEmployees(emps || []);
    setLoading(false);
  };

  return (
    <div>
      {selectedEmp && (
        <OperatorRadarPanel
          emp={selectedEmp}
          skillDefs={skillDefs}
          onClose={() => setSelectedEmp(null)}
        />
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
          <option value="">ทุกไลน์</option>
          {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{employees.length} คน · {skillDefs.length} สกิล</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>· คลิกที่พนักงานเพื่อดู Radar Chart</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>⬇️ ดาวน์โหลดได้จากแท็บ Export</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {SKILL_LEVELS.map(lv => (
          <span key={lv.label} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: lv.bg, color: lv.color, border: `1px solid ${lv.color}40` }}>
            {lv.label} {lv.min > 0 ? `≥${lv.min}%` : '<40%'}
          </span>
        ))}
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>— ยังไม่ประเมิน</span>
      </div>

      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 220 + skillDefs.length * 90 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 44, textAlign: 'center' }}>รูป</th>
                <th style={{ minWidth: 130, textAlign: 'left' }}>พนักงาน</th>
                {skillDefs.map(s => (
                  <th key={s.name} style={{ minWidth: 88, textAlign: 'center', fontSize: 11 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: s.color || '#4d9fff', marginRight: 3 }} />
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? <EmptyRow cols={2 + skillDefs.length} /> : employees.map(emp => {
                const skillMap = {};
                (emp.employee_skills || []).forEach(s => { skillMap[s.skill_name] = s.score; });
                const scores = skillDefs.map(s => skillMap[s.name] ?? 0);
                const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
                const avgLv = getLevel(avg);

                return (
                  <tr
                    key={emp.id}
                    onClick={() => setSelectedEmp(emp)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                      {emp.image_url ? (
                        <img src={emp.image_url} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'cover', border: `2px solid ${avgLv.color}66`, display: 'block', margin: '0 auto' }} />
                      ) : (
                        <div style={{
                          width: 38, height: 38, borderRadius: 10, margin: '0 auto',
                          background: `${avgLv.color}22`, border: `2px solid ${avgLv.color}55`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 15, fontWeight: 800, color: avgLv.color,
                        }}>
                          {(emp.name || '?')[0]}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{emp.employee_id_code}</div>
                      {scores.length > 0 && (
                        <div style={{ marginTop: 3, display: 'inline-block', fontSize: 9, fontWeight: 700, color: avgLv.color, background: avgLv.bg, borderRadius: 4, padding: '1px 5px' }}>
                          avg {avg}%
                        </div>
                      )}
                    </td>
                    {skillDefs.map(s => {
                      const score = skillMap[s.name];
                      if (score === undefined) return <td key={s.name} style={{ textAlign: 'center' }}><span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span></td>;
                      const lv = getLevel(score);
                      return (
                        <td key={s.name} style={{ textAlign: 'center', padding: '6px 4px' }}>
                          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', background: lv.bg, borderRadius: 6, padding: '4px 8px', minWidth: 52 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: lv.color }}>{score}</span>
                            <span style={{ fontSize: 9, color: lv.color, marginTop: 1 }}>{lv.label}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   🏅 MultiSkillFormTab — MULTI SKILL OF OPERATORS export
   ══════════════════════════════════════════════════════════════ */

const MS_LEVELS = [
  { level: 4, pct: '100%',   label: 'สามารถสอนงานผู้อื่นได้',                          color: '#166534', bg: '#bbf7d0', border: '#16a34a' },
  { level: 3, pct: '75-99%', label: 'สามารถแก้ปัญหาและตัดสินใจในการทำงานได้',          color: '#1e3a5f', bg: '#bfdbfe', border: '#3b82f6' },
  { level: 2, pct: '50-74%', label: 'ปฏิบัติงานได้โดยไม่ต้องมีผู้แนะนำ',              color: '#713f12', bg: '#fef9c3', border: '#eab308' },
  { level: 1, pct: '25-49%', label: 'ผ่านการอบรม(OJT)และปฏิบัติงานได้โดยมีผู้แนะนำ', color: '#7c2d12', bg: '#fed7aa', border: '#f97316' },
  { level: 0, pct: '0-24%',  label: 'อยู่ระหว่างการฝึกอบรม',                           color: '#7f1d1d', bg: '#fecaca', border: '#ef4444' },
];

function scoreToLevel(score) {
  if (score === undefined || score === null) return 0;
  if (score >= 100) return 4;
  if (score >= 75)  return 3;
  if (score >= 50)  return 2;
  if (score >= 25)  return 1;
  return 0;
}

const msStyle = (lv) => MS_LEVELS.find(l => l.level === lv) || { bg: '#fff', color: '#999', border: '#ccc' };

/* ── SVG Skill Gauge — circle quartered like factory skill matrix form ── */
/* Fill order clockwise: bottom-left → bottom-right → top-right → top-left  */
const GAUGE_FILL = ['none', '#f97316', '#eab308', '#3b82f6', '#22c55e'];
const GAUGE_STROKE = ['#9ca3af', '#f97316', '#ca8a04', '#2563eb', '#16a34a'];

/* SVG arc paths for each quadrant (cx=17, cy=17, r=15, clockwise fill)
   L1=bottom-left  L2=+bottom-right  L3=+top-right  L4=+top-left        */
const Q_PATHS = [
  'M17,17 L2,17 A15,15 0 0,1 17,32 Z',   // bottom-left
  'M17,17 L17,32 A15,15 0 0,1 32,17 Z',  // bottom-right
  'M17,17 L32,17 A15,15 0 0,1 17,2 Z',   // top-right
  'M17,17 L17,2 A15,15 0 0,1 2,17 Z',    // top-left
];

function SkillGauge({ level, size = 34 }) {
  const fill   = GAUGE_FILL[level]   || 'none';
  const stroke = GAUGE_STROKE[level] || '#9ca3af';
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', margin: 'auto' }}>
      <circle cx="17" cy="17" r="15" fill="none" stroke={stroke} strokeWidth="1.5"/>
      {Q_PATHS.slice(0, level).map((d, i) => <path key={i} d={d} fill={fill} opacity="0.85"/>)}
      <line x1="17" y1="2"  x2="17" y2="32" stroke={stroke} strokeWidth="1"/>
      <line x1="2"  y1="17" x2="32" y2="17" stroke={stroke} strokeWidth="1"/>
      <circle cx="17" cy="17" r="15" fill="none" stroke={stroke} strokeWidth="1.5"/>
    </svg>
  );
}

/* inline SVG string for PDF export */
function skillGaugeSvgStr(lv) {
  const fill   = GAUGE_FILL[lv]   || 'none';
  const stroke = GAUGE_STROKE[lv] || '#9ca3af';
  const sectors = Q_PATHS.slice(0, lv)
    .map(d => `<path d="${d}" fill="${fill}" opacity="0.85"/>`)
    .join('');
  return `<svg width="26" height="26" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
    <circle cx="17" cy="17" r="15" fill="none" stroke="${stroke}" stroke-width="1.5"/>
    ${sectors}
    <line x1="17" y1="2" x2="17" y2="32" stroke="${stroke}" stroke-width="1"/>
    <line x1="2" y1="17" x2="32" y2="17" stroke="${stroke}" stroke-width="1"/>
    <circle cx="17" cy="17" r="15" fill="none" stroke="${stroke}" stroke-width="1.5"/>
  </svg>`;
}

function calcServiceDuration(startDate) {
  if (!startDate) return '';
  const start = new Date(startDate);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (months < 0) { years--; months += 12; }
  const parts = [];
  if (years > 0) parts.push(`${years}ปี`);
  if (months > 0) parts.push(`${months}เดือน`);
  return parts.length ? parts.join(' ') : '< 1 เดือน';
}

function buildMultiSkillHtml({ empRows, levelCounts, skillDefs, dept, section, department, headName, maker, checker, approver, totalEmps, makerSigUrl, checkerSigUrl, approverSigUrl }) {
  const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  const levelCell = (lv) =>
    `<td style="text-align:center;border:1px solid #999;padding:2px">${skillGaugeSvgStr(lv)}</td>`;

  const skillHeaderCells = skillDefs.map(s =>
    `<th style="border:1px solid #666;background:#e5e7eb;padding:3px 2px;font-size:9px;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);height:90px;white-space:nowrap">${s.label}</th>`
  ).join('');

  const empRowsHtml = empRows.map(({ emp, levels, overall, index }) => `
    <tr>
      <td style="text-align:center;border:1px solid #999;white-space:nowrap">${index}</td>
      <td style="border:1px solid #999;padding:0 3px;white-space:nowrap;font-size:9px">${emp.employee_id_code || ''}</td>
      <td style="border:1px solid #999;padding:0 3px;font-size:9px">${emp.name || ''}</td>
      <td style="border:1px solid #999;padding:0 3px;font-size:9px">${emp.position || ''}</td>
      <td style="border:1px solid #999;padding:0 3px;font-size:9px;white-space:nowrap">${calcServiceDuration(emp.start_date)}</td>
      ${levels.map(levelCell).join('')}${levelCell(overall)}
    </tr>`).join('');

  const summaryRowsHtml = MS_LEVELS.map((lv, li) => {
    const fillHex = GAUGE_FILL[lv.level] === 'none' ? '' : `background:${lv.bg + "33"};`;
    return `<tr>
      <td style="border:1px solid #999;padding:2px;text-align:center;vertical-align:middle">${skillGaugeSvgStr(lv.level)}</td>
      <td style="border:1px solid #999;padding:2px 4px;font-size:9px">${lv.pct} — ${lv.label}</td>
      ${levelCounts[li].map(cnt =>
        `<td style="text-align:center;border:1px solid #999;font-size:9px;font-weight:700;${cnt > 0 ? fillHex : ''}">${cnt || ''}</td>`
      ).join('')}
    </tr>`;
  }).join('');

  const legendHtml = MS_LEVELS.map(lv => {
    const s = msStyle(lv.level);
    return `<tr>
      <td style="padding:2px 4px;text-align:center;border:1px solid #ccc;vertical-align:middle">${skillGaugeSvgStr(lv.level)}</td>
      <td style="padding:1px 6px;font-size:8px">${lv.pct} — ${lv.label}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
<title>MULTI SKILL OF OPERATORS</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}body{font-family:'Sarabun',sans-serif;font-size:10px;background:#fff;color:#000}
  .page{padding:8mm}table{border-collapse:collapse;font-size:10px}
  @media print{@page{size:A3 landscape;margin:6mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="page">
  <table style="width:100%;margin-bottom:4px"><tr>
    <td style="vertical-align:top;width:22%">
      <div style="font-size:9px;line-height:2">
        <div>ฝ่าย : <strong>${dept}</strong></div>
        <div>ส่วน : <strong>${section}</strong></div>
        <div>แผนก : <strong>${department}</strong></div>
        <div>หัวหน้าแผนก : <strong>${headName}</strong></div>
      </div>
    </td>
    <td style="vertical-align:top;text-align:center;width:50%">
      <div style="font-size:14px;font-weight:800;margin-bottom:6px">MULTI SKILL OF OPERATORS</div>
      <table style="margin:0 auto;font-size:8px">${legendHtml}</table>
    </td>
    <td style="vertical-align:top;width:28%">
      <table style="width:100%;font-size:8px;border-collapse:collapse">
        <tr>
          <th style="border:1px solid #666;background:#f3f4f6;padding:2px;text-align:center">จัดทำโดย</th>
          <th style="border:1px solid #666;background:#f3f4f6;padding:2px;text-align:center">ตรวจสอบโดย</th>
          <th style="border:1px solid #666;background:#f3f4f6;padding:2px;text-align:center">อนุมัติโดย</th>
        </tr>
        <tr style="height:40px">
          <td style="border:1px solid #666;text-align:center;vertical-align:middle">${makerSigUrl ? `<img src="${makerSigUrl}" style="max-height:36px;max-width:90px;object-fit:contain"/>` : ''}</td>
          <td style="border:1px solid #666;text-align:center;vertical-align:middle">${checkerSigUrl ? `<img src="${checkerSigUrl}" style="max-height:36px;max-width:90px;object-fit:contain"/>` : ''}</td>
          <td style="border:1px solid #666;text-align:center;vertical-align:middle">${approverSigUrl ? `<img src="${approverSigUrl}" style="max-height:36px;max-width:90px;object-fit:contain"/>` : ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #666;padding:2px;text-align:center">(${maker || '......................'})</td>
          <td style="border:1px solid #666;padding:2px;text-align:center">(${checker || '......................'})</td>
          <td style="border:1px solid #666;padding:2px;text-align:center">(${approver || '......................'})</td>
        </tr>
        <tr>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">หัวหน้าแผนก</td>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">วิศวกร/หัวหน้าส่วน</td>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">ผู้จัดการส่วนผลิต</td>
        </tr>
        <tr>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">วันที่ .................</td>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">วันที่ .................</td>
          <td style="border:1px solid #666;padding:1px;text-align:center;font-size:7px">วันที่ .................</td>
        </tr>
      </table>
    </td>
  </tr></table>
  <table style="width:100%"><thead>
    <tr style="background:#d1d5db">
      <th style="border:1px solid #666;padding:3px;text-align:center;width:24px" rowspan="2">ลำดับ</th>
      <th style="border:1px solid #666;padding:3px;text-align:center;width:70px" rowspan="2">เลขที่บัตร</th>
      <th style="border:1px solid #666;padding:3px;text-align:center;min-width:110px" rowspan="2">ชื่อ-นามสกุล</th>
      <th style="border:1px solid #666;padding:3px;text-align:center;min-width:80px" rowspan="2">ตำแหน่ง</th>
      <th style="border:1px solid #666;padding:3px;text-align:center;min-width:60px" rowspan="2">อายุงาน</th>
      <th style="border:1px solid #666;padding:3px;text-align:center" colspan="${skillDefs.length + 1}">ทักษะความสามารถการปฏิบัติงานของพนักงาน</th>
    </tr>
    <tr style="background:#e5e7eb">${skillHeaderCells}
      <th style="border:1px solid #666;background:#d1fae5;padding:3px 2px;font-size:9px;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);height:90px;white-space:nowrap">ทักษะโดยรวม</th>
    </tr>
  </thead><tbody>${empRowsHtml}</tbody></table>
  <div style="margin-top:10px">
    <table style="width:100%"><thead>
      <tr style="background:#d1d5db">
        <th style="border:1px solid #666;padding:3px;font-size:9px;text-align:center" colspan="2">ระดับความสามารถ</th>
        ${skillDefs.map(s => `<th style="border:1px solid #666;background:#e5e7eb;padding:3px 2px;font-size:9px;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);height:70px;white-space:nowrap">${s.label}</th>`).join('')}
        <th style="border:1px solid #666;background:#d1fae5;padding:3px 2px;font-size:9px;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);height:70px;white-space:nowrap">ทักษะโดยรวม</th>
      </tr>
    </thead><tbody>
      ${summaryRowsHtml}
      <tr style="background:#f3f4f6;font-weight:700">
        <td colspan="2" style="border:1px solid #999;text-align:center;padding:2px;font-size:9px">รวมพนักงานทั้งหมด</td>
        ${skillDefs.map(() => `<td style="text-align:center;border:1px solid #999;font-size:9px">${totalEmps}</td>`).join('')}
        <td style="text-align:center;border:1px solid #999;font-size:9px">${totalEmps}</td>
      </tr>
    </tbody></table>
  </div>
  <div style="margin-top:6px;font-size:8px;color:#555">พิมพ์วันที่ ${today} · จำนวนพนักงาน ${totalEmps} คน</div>
</div>
<script>window.onload = () => { window.print(); }</script></body></html>`;
}

function MultiSkillFormTab() {
  const { role, signatureUrl: ctxSigUrl, fullName: ctxFullName } = useContext(UserContext);

  const [skillDefs,  setSkillDefs]  = useState([]);
  const [employees,  setEmployees]  = useState([]);
  const [lines,      setLines]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [filterLine, setFilterLine] = useState('');

  // Header info inputs
  const [dept,       setDept]       = useState('Production');
  const [section,    setSection]    = useState('');
  const [department, setDepartment] = useState('');
  const [headName,   setHeadName]   = useState('');
  const [maker,      setMaker]      = useState('');
  const [checker,    setChecker]    = useState('');
  const [approver,   setApprover]   = useState('');

  // Signature URLs per role slot
  const [makerSig,    setMakerSig]    = useState(null);
  const [checkerSig,  setCheckerSig]  = useState(null);
  const [approverSig, setApproverSig] = useState(null);

  // Auto-fill current user's name + signature into the matching slot on load
  useEffect(() => {
    if (!ctxFullName && !ctxSigUrl) return;
    if (['leader'].includes(role)) {
      if (ctxFullName) setMaker(n => n || ctxFullName);
      if (ctxSigUrl)  setMakerSig(ctxSigUrl);
    } else if (['supervisor'].includes(role)) {
      if (ctxFullName) setChecker(n => n || ctxFullName);
      if (ctxSigUrl)   setCheckerSig(ctxSigUrl);
    } else if (['manager', 'admin'].includes(role)) {
      if (ctxFullName) setApprover(n => n || ctxFullName);
      if (ctxSigUrl)   setApproverSig(ctxSigUrl);
    }
  }, [role, ctxFullName, ctxSigUrl]);

  useEffect(() => {
    supabase.from('production_lines').select('id, name').order('name')
      .then(({ data }) => setLines(data || []));
    supabase.from('skill_definitions').select('*').order('sort_order')
      .then(({ data }) => setSkillDefs(data || []));
  }, []);

  const load = async () => {
    setLoading(true);
    const sel = 'id, name, employee_id_code, position, section, team, start_date, employee_skills(skill_name, score)';
    const q = filterLine
      ? supabase.from('employees').select(sel).eq('is_active', true).eq('line_id', filterLine).order('name')
      : supabase.from('employees').select(sel).eq('is_active', true).order('name');
    const { data } = await q;
    setEmployees(data || []);
    setLoading(false);
  };

  const handlePrint = async () => {
    const empRows = employees.map((emp, i) => {
      const sm = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
      const levels = skillDefs.map(s => scoreToLevel(sm[s.name]));
      const validLevels = levels.filter(l => l > 0);
      const overall = validLevels.length
        ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length)
        : 0;
      return { emp, levels, overall, index: i + 1 };
    });
    const levelCounts = MS_LEVELS.map(lv => [
      ...skillDefs.map((_, si) => empRows.filter(r => r.levels[si] === lv.level).length),
      empRows.filter(r => r.overall === lv.level).length,
    ]);
    const [mSig, cSig, aSig] = await Promise.all([
      makerSig    ? urlToDataUrl(makerSig)    : Promise.resolve(null),
      checkerSig  ? urlToDataUrl(checkerSig)  : Promise.resolve(null),
      approverSig ? urlToDataUrl(approverSig) : Promise.resolve(null),
    ]);
    const html = buildMultiSkillHtml({ empRows, levelCounts, skillDefs, dept, section, department, headName, maker, checker, approver, totalEmps: empRows.length, makerSigUrl: mSig, checkerSigUrl: cSig, approverSigUrl: aSig });
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  const msLevelColor = (lv) => {
    const m = msStyle(lv);
    return { bg: m.bg || 'var(--bg3)', color: m.color || 'var(--muted)' };
  };

  // Precompute per-employee levels once (avoids O(n*skills) recalculation on every render)
  const empLevelRows = useMemo(() => employees.map(emp => {
    const sm = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
    const levels = skillDefs.map(s => scoreToLevel(sm[s.name]));
    const validLevels = levels.filter(l => l > 0);
    const overall = validLevels.length
      ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length)
      : 0;
    return { emp, levels, overall };
  }), [employees, skillDefs]);

  // Precompute summary counts (avoids O(levels*skills*employees) inline in JSX)
  const summaryCounts = useMemo(() => MS_LEVELS.map(lv => ({
    lv,
    counts: skillDefs.map((_, si) => empLevelRows.filter(r => r.levels[si] === lv.level).length),
    total:  empLevelRows.filter(r => r.overall === lv.level).length,
  })), [empLevelRows, skillDefs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters + header inputs */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <span style={lbSt}>ไลน์ผลิต</span>
          <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'กำลังโหลด...' : '🔍 ดึงข้อมูล'}
        </button>
      </div>

      {employees.length > 0 && (
        <>
          {/* Document header inputs */}
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--text2)', fontSize: 13 }}>ข้อมูลหัวเอกสาร</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {[
                { label: 'ฝ่าย', val: dept,       set: setDept },
                { label: 'ส่วน', val: section,    set: setSection },
                { label: 'แผนก', val: department, set: setDepartment },
                { label: 'หัวหน้าแผนก', val: headName, set: setHeadName },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <span style={lbSt}>{label}</span>
                  <input value={val} onChange={e => set(e.target.value)} style={{ width: '100%', padding: '6px 10px', borderRadius: 7, fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)' }} />
                </div>
              ))}
            </div>

            {/* Signature slots */}
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {[
                { label: 'จัดทำโดย', name: maker, setName: setMaker, sig: makerSig, setSig: setMakerSig, autoRole: 'leader' },
                { label: 'ตรวจสอบโดย', name: checker, setName: setChecker, sig: checkerSig, setSig: setCheckerSig, autoRole: 'supervisor' },
                { label: 'อนุมัติโดย', name: approver, setName: setApprover, sig: approverSig, setSig: setApproverSig, autoRole: 'manager/admin' },
              ].map(({ label, name, setName, sig, setSig, autoRole }) => (
                <div key={label} style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: 10, background: 'var(--bg2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={lbSt}>{label}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', background: 'var(--bg3)', borderRadius: 4, padding: '1px 5px' }}>{autoRole}</span>
                  </div>
                  <input value={name} onChange={e => setName(e.target.value)}
                    placeholder="ชื่อ-นามสกุล"
                    style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', marginBottom: 6 }} />
                  {sig ? (
                    <div style={{ position: 'relative' }}>
                      <img src={sig} alt="sig" style={{ width: '100%', height: 48, objectFit: 'contain', borderRadius: 4, background: '#fff', border: '1px solid var(--border2)' }} />
                      <button onClick={() => setSig(null)}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: 4, fontSize: 10, cursor: 'pointer', padding: '1px 5px' }}>✕</button>
                    </div>
                  ) : (
                    <label style={{ display: 'block', cursor: 'pointer' }}>
                      <div style={{ height: 48, border: '1px dashed var(--border2)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>
                        📎 อัปโหลดลายเซ็น
                      </div>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                        const file = e.target.files[0];
                        if (file) setSig(URL.createObjectURL(file));
                      }} />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 15 }}>MULTI SKILL OF OPERATORS</span>
                <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 10 }}>{employees.length} คน · {skillDefs.length} ทักษะ</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>🖨️ พิมพ์ได้จากแท็บ Export</span>
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {MS_LEVELS.map(lv => (
                <div key={lv.level} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: lv.level > 0 ? lv.bg + "33" : 'var(--bg3)', border: `1px solid ${lv.level > 0 ? lv.border : 'var(--border)'}` }}>
                  <SkillGauge level={lv.level} size={20} />
                  <span style={{ fontSize: 10, color: lv.level > 0 ? lv.color : 'var(--muted)', fontWeight: lv.level > 0 ? 700 : 400 }}>
                    {lv.pct} · {lv.label}
                  </span>
                </div>
              ))}
            </div>

            <table style={{ minWidth: 300 + skillDefs.length * 70, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', width: 30, textAlign: 'center' }}>#</th>
                  <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', width: 80 }}>รหัส</th>
                  <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', minWidth: 120 }}>ชื่อ-สกุล</th>
                  <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', minWidth: 80 }}>ตำแหน่ง</th>
                  {skillDefs.map(s => (
                    <th key={s.name} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'var(--bg3)', width: 68, textAlign: 'center', fontSize: 10, verticalAlign: 'bottom' }}>
                      {s.label}
                    </th>
                  ))}
                  <th style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'rgba(34,197,94,0.12)', color: '#22c55e', width: 68, textAlign: 'center', fontSize: 10, verticalAlign: 'bottom' }}>ทักษะโดยรวม</th>
                </tr>
              </thead>
              <tbody>
                {empLevelRows.map(({ emp, levels, overall }, i) => (
                  <tr key={emp.id}>
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>{i+1}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 5px', fontSize: 11, color: 'var(--muted)' }}>{emp.employee_id_code}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 5px', fontWeight: 500 }}>{emp.name}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 5px', fontSize: 11, color: 'var(--text2)' }}>{emp.position || ''}</td>
                    {levels.map((lv, si) => (
                      <td key={si} style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '4px 2px' }}>
                        <SkillGauge level={lv} size={30} />
                      </td>
                    ))}
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '4px 2px', background: overall > 0 ? msStyle(overall).bg + "22" : '' }}>
                      <SkillGauge level={overall} size={30} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary count table */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text2)' }}>สรุปจำนวนพนักงานแยกตามระดับ</div>
              <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid var(--border2)', padding: '4px 8px', background: 'var(--bg3)', minWidth: 60 }}>ระดับ</th>
                    <th style={{ border: '1px solid var(--border2)', padding: '4px 8px', background: 'var(--bg3)', minWidth: 120 }}>ความหมาย</th>
                    {skillDefs.map(s => (
                      <th key={s.name} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'var(--bg3)', width: 68, textAlign: 'center', fontSize: 10 }}>{s.label}</th>
                    ))}
                    <th style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'rgba(34,197,94,0.12)', color: '#22c55e', width: 68, textAlign: 'center', fontSize: 10 }}>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryCounts.map(({ lv, counts, total }) => {
                    const c = msLevelColor(lv.level);
                    return (
                      <tr key={lv.level}>
                        <td style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '4px 6px', background: lv.level > 0 ? lv.bg + "33" : '' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <SkillGauge level={lv.level} size={22} />
                            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{lv.pct}</span>
                          </div>
                        </td>
                        <td style={{ border: '1px solid var(--border2)', padding: '3px 8px', fontSize: 11, color: 'var(--text2)' }}>{lv.label}</td>
                        {counts.map((cnt, i) => (
                          <td key={i} style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: cnt > 0 ? 700 : 400, color: cnt > 0 ? (lv.level > 0 ? c.color : 'var(--muted)') : 'var(--muted)' }}>
                            {cnt || ''}
                          </td>
                        ))}
                        <td style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: 700, color: total > 0 ? '#22c55e' : 'var(--muted)' }}>{total || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && employees.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          เลือกไลน์และกด "ดึงข้อมูล" เพื่อแสดง Multi-Skill Matrix
        </div>
      )}
    </div>
  );
}

// ─── Export Tab ─────────────────────────────────────────────
const SUMCOLS = ['ส', 'ป', 'ก', 'พง', 'กธ', 'บป', 'ข', 'มต'];
const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

/* ── Quick CSV export section at top of Export tab ── */
function QuickCsvSection() {
  const today = getWorkDate();
  const thisMonth = today.slice(0, 7);
  const [isLoading, setIsLoading] = useState({});

  const run = (key, fn) => async () => {
    setIsLoading(p => ({ ...p, [key]: true }));
    await fn();
    setIsLoading(p => ({ ...p, [key]: false }));
  };

  const exportDailyCSV = async (date = today) => {
    const { data } = await supabase.from('daily_production_logs')
      .select('work_date, employees(name, employee_id_code, department), is_present, has_helmet, has_boots, has_gloves, has_ot, leave_type, remark')
      .eq('work_date', date);
    downloadCSV(`daily_${date}.csv`,
      ['วันที่', 'รหัส', 'ชื่อ', 'แผนก', 'มาทำงาน', 'หมวก', 'รองเท้า', 'ถุงมือ', 'OT', 'ลา', 'หมายเหตุ'],
      (data || []).map(l => [l.work_date, l.employees?.employee_id_code, l.employees?.name, l.employees?.department || '', l.is_present ? '✓' : '✗', l.has_helmet ? '✓' : '✗', l.has_boots ? '✓' : '✗', l.has_gloves ? '✓' : '✗', l.has_ot ? '✓' : '', l.leave_type || '', l.remark || ''])
    );
  };

  const exportFourMCSV = async () => {
    const from = thisMonth + '-01'; const to = thisMonth + '-31';
    const { data } = await supabase.from('four_m_logs').select('*').gte('work_date', from).lte('work_date', to).order('work_date');
    downloadCSV(`4m_changes_${thisMonth}.csv`,
      ['วันที่', 'ไลน์', 'ประเภท', 'รายละเอียด', 'เวลา'],
      (data || []).map(l => [l.work_date, l.line_name, l.category, l.description, l.created_at ? new Date(l.created_at).toLocaleString('th-TH') : ''])
    );
  };

  const exportSkillCSV = async () => {
    const [{ data: defs }, { data: emps }] = await Promise.all([
      supabase.from('skill_definitions').select('*').order('sort_order'),
      supabase.from('employees').select('name, employee_id_code, department, employee_skills(skill_name, score)').eq('is_active', true).order('employee_id_code'),
    ]);
    const headers = ['รหัส', 'ชื่อ', 'แผนก', ...(defs || []).map(d => d.label), 'เฉลี่ย'];
    const rows = (emps || []).map(emp => {
      const sm = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
      const scores = (defs || []).map(d => sm[d.name] ?? 0);
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      return [emp.employee_id_code, emp.name, emp.department || '', ...scores, avg];
    });
    downloadCSV(`skill_matrix_${today}.csv`, headers, rows);
  };

  const QUICK_EXPORTS = [
    { key: 'daily',  icon: '📋', label: 'เช็คชื่อวันนี้',     sub: today,           fn: () => exportDailyCSV(today) },
    { key: 'fourm',  icon: '🚨', label: '4M Changes เดือนนี้', sub: thisMonth,       fn: exportFourMCSV },
    { key: 'skill',  icon: '📊', label: 'Skill Matrix ทั้งหมด', sub: 'ข้อมูลล่าสุด', fn: exportSkillCSV },
  ];

  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text)' }}>⬇️ Export CSV — ดาวน์โหลดด่วน</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {QUICK_EXPORTS.map(item => (
          <button key={item.key} onClick={run(item.key, item.fn)} disabled={isLoading[item.key]}
            style={{
              padding: '12px 18px', borderRadius: 10, border: '1px solid rgba(34,197,94,0.3)',
              background: isLoading[item.key] ? 'var(--bg3)' : 'rgba(34,197,94,0.08)',
              color: '#22c55e', cursor: isLoading[item.key] ? 'not-allowed' : 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, minWidth: 160,
              opacity: isLoading[item.key] ? 0.6 : 1,
            }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{isLoading[item.key] ? 'กำลังดาวน์โหลด...' : item.label}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{item.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExportTab({ goToTab }) {
  const [lines,      setLines]      = useState([]);
  const [lineId,     setLineId]     = useState('');
  const [month,      setMonth]      = useState(new Date().toISOString().slice(0, 7));
  const [period,     setPeriod]     = useState('1');
  const [dept,       setDept]       = useState('');
  const [formType,   setFormType]   = useState('attendance');
  const [employees,  setEmployees]  = useState([]);
  const [logsMap,    setLogsMap]    = useState({});
  const [isLoading,  setIsLoading]  = useState(false);
  const [ready,      setReady]      = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('id, name').order('name')
      .then(({ data }) => setLines(data || []));
  }, []);

  const [y, m] = month.split('-').map(Number);
  const startDay = period === '1' ? 1 : 16;
  const endDay   = period === '1' ? 15 : new Date(y, m, 0).getDate();
  const days     = Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i);
  const thMonthStr = `${TH_MONTHS[m - 1]} ${y + 543}`;

  const load = async () => {
    setIsLoading(true);
    const pad = d => String(d).padStart(2, '0');
    const startDate = `${month}-${pad(startDay)}`;
    const endDate   = `${month}-${pad(endDay)}`;

    let empQ = supabase.from('employees')
      .select('id, name, employee_id_code, team, department, section')
      .eq('is_active', true).order('employee_id_code');
    if (lineId) empQ = empQ.eq('line_id', lineId);
    const { data: emps } = await empQ;

    const empIds = (emps || []).map(e => e.id);
    let logData = [];
    if (empIds.length) {
      const { data } = await supabase.from('daily_production_logs')
        .select('employee_id, work_date, is_present')
        .in('employee_id', empIds)
        .gte('work_date', startDate).lte('work_date', endDate);
      logData = data || [];
    }

    const map = {};
    logData.forEach(l => {
      const d = parseInt(l.work_date.split('-')[2]);
      if (!map[l.employee_id]) map[l.employee_id] = {};
      map[l.employee_id][d] = l.is_present;
    });

    setEmployees(emps || []);
    setLogsMap(map);
    setReady(true);
    setIsLoading(false);
  };

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #rpt-print, #rpt-print * { visibility: visible !important; }
          #rpt-print { position: fixed; inset: 0; background: #fff; padding: 6mm; overflow: visible; }
          @page { size: A4 landscape; margin: 0; }
        }
      `}</style>

      <QuickCsvSection />

      <div className="card" style={{ padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text)' }}>📄 ใบบันทึก / ใบสั่ง OT</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={lbSt}>ประเภทรายงาน</div>
            <select value={formType} onChange={e => { setFormType(e.target.value); setReady(false); }}
              style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
              <option value="attendance">ใบบันทึกการมาทำงาน</option>
              <option value="ot">ใบสั่งงาน OT</option>
            </select>
          </div>
          <div>
            <div style={lbSt}>สายผลิต</div>
            <select value={lineId} onChange={e => {
              const id = e.target.value;
              const ln = lines.find(l => l.id === id);
              setLineId(id);
              setDept(ln?.name || '');
              setReady(false);
            }} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
              <option value="">ทุกไลน์</option>
              {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <div style={lbSt}>ชื่อแผนก</div>
            <input value={dept} onChange={e => setDept(e.target.value)}
              placeholder="เช่น Hydroform Dept"
              style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13, width: 170 }} />
          </div>
          <div>
            <div style={lbSt}>เดือน</div>
            <input type="month" value={month} onChange={e => { setMonth(e.target.value); setReady(false); }}
              style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
          </div>
          <div>
            <div style={lbSt}>งวด</div>
            <select value={period} onChange={e => { setPeriod(e.target.value); setReady(false); }}
              style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
              <option value="1">วันที่ 1–15</option>
              <option value="2">วันที่ 16–สิ้นเดือน</option>
            </select>
          </div>
          <button onClick={load} disabled={isLoading} style={{
            padding: '8px 18px', borderRadius: 8, background: 'var(--accent)', color: '#fff',
            border: 'none', fontWeight: 700, fontSize: 13, cursor: isLoading ? 'default' : 'pointer',
          }}>
            {isLoading ? 'กำลังโหลด...' : '📥 โหลดข้อมูล'}
          </button>
          {ready && (
            <button onClick={() => window.print()} style={{
              padding: '8px 18px', borderRadius: 8, background: '#16a34a', color: '#fff',
              border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}>
              🖨️ Print / Export PDF
            </button>
          )}
        </div>
        {ready && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            โหลดแล้ว <strong>{employees.length}</strong> คน · {thMonthStr} งวด {startDay}–{endDay}
            &nbsp;·&nbsp;กด <strong>🖨️ Print / Export PDF</strong> แล้วเลือก "Save as PDF" ใน dialog
          </div>
        )}
      </div>

      {ready && (
        <div id="rpt-print" style={{ background: '#fff', color: '#000', border: '1px solid var(--border2)', borderRadius: 8, overflowX: 'auto' }}>
          {formType === 'attendance'
            ? <AttendancePrint employees={employees} days={days} logsMap={logsMap}
                dept={dept} thMonthStr={thMonthStr} startDay={startDay} endDay={endDay} />
            : <OTPrint employees={employees} dept={dept} thMonthStr={thMonthStr} />
          }
        </div>
      )}

      <SkillAllowanceExportCard />
      <MultiSkillExportCard />
    </div>
  );
}

/* ── Compact export cards embedded in ExportTab ── */

function SkillAllowanceExportCard() {
  const today = new Date();
  const [year,    setYear]    = useState(today.getFullYear());
  const [month,   setMonth]   = useState(today.getMonth() + 1);
  const [period,  setPeriod]  = useState(1);
  const [line,    setLine]    = useState('');
  const [section, setSection] = useState('');
  const [lines,   setLines]   = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('name, section').order('name')
      .then(({ data }) => setLines(data || []));
  }, []);

  const periodDays = () => {
    const dim = new Date(year, month, 0).getDate();
    return period === 1
      ? Array.from({ length: 15 }, (_, i) => i + 1)
      : Array.from({ length: dim - 15 }, (_, i) => i + 16);
  };

  const handlePrint = async () => {
    setLoading(true);
    const days = periodDays();
    const pad = d => String(d).padStart(2, '0');
    const startDate = `${year}-${pad(month)}-${pad(days[0])}`;
    const endDate   = `${year}-${pad(month)}-${pad(days[days.length - 1])}`;

    let stQ = supabase.from('workstations').select('id, station_name, line_name').eq('skill_allowance', true);
    if (line) stQ = stQ.eq('line_name', line);
    const { data: stations } = await stQ;
    if (!stations?.length) { toast.info('ไม่พบตำแหน่งที่ได้ค่าฝีมือ'); setLoading(false); return; }

    const stationIds = stations.map(s => String(s.id));
    const { data: logs } = await supabase
      .from('daily_production_logs')
      .select('work_date, employee_id, employees(employee_id_code, name, section, team)')
      .gte('work_date', startDate).lte('work_date', endDate)
      .eq('is_present', true).eq('has_helmet', true).eq('has_boots', true).eq('has_gloves', true)
      .in('assigned_line', stationIds);

    const empMap = {};
    (logs || []).forEach(log => {
      const d = parseInt(log.work_date.split('-')[2]);
      if (!empMap[log.employee_id]) empMap[log.employee_id] = { emp: log.employees, days: {} };
      empMap[log.employee_id].days[d] = true;
    });

    const rows = Object.values(empMap)
      .filter(r => section ? r.emp?.section === section : true)
      .sort((a, b) => (a.emp?.name || '').localeCompare(b.emp?.name || '', 'th'));

    setLoading(false);
    if (!rows.length) { toast.info('ไม่มีข้อมูล'); return; }

    const dStr = `${days[0]}-${days[days.length - 1]}`;
    const sectionLabel = section || (line ? `ไลน์ ${line}` : 'ทุกไลน์');
    const tableRows = rows.map((r, i) => {
      const dayCells = days.map(d =>
        `<td style="text-align:center;border:1px solid #333;font-size:13px">${r.days[d] ? '✓' : ''}</td>`
      ).join('');
      const total = Object.keys(r.days).length;
      return `<tr>
        <td style="text-align:center;border:1px solid #333">${i+1}</td>
        <td style="border:1px solid #333;white-space:nowrap;padding:0 4px">${r.emp?.employee_id_code || ''}</td>
        <td style="border:1px solid #333;padding:0 4px">${r.emp?.name || ''}</td>
        ${dayCells}
        <td style="text-align:center;border:1px solid #333;font-weight:bold">${total}</td>
        <td style="border:1px solid #333;width:70px"></td>
        <td style="border:1px solid #333;width:80px"></td>
        <td style="border:1px solid #333;width:70px"></td>
        <td style="border:1px solid #333"></td>
      </tr>`;
    }).join('');
    const extraRows = Math.max(0, 10 - rows.length);
    const emptyRows = Array.from({ length: extraRows }, (_, i) => `
      <tr style="height:28px">
        <td style="text-align:center;border:1px solid #333">${rows.length + i + 1}</td>
        <td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        ${days.map(() => '<td style="border:1px solid #333"></td>').join('')}
        <td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        <td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        <td style="border:1px solid #333"></td>
      </tr>`).join('');
    const daySumRow = days.map(d => {
      const cnt = rows.filter(r => r.days[d]).length;
      return `<td style="text-align:center;border:1px solid #333;font-size:12px">${cnt || 0}</td>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
<title>ใบสรุปค่าฝีมือ ${THAI_MONTHS[month]} ${year + 543}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}body{font-family:'Sarabun',sans-serif;font-size:13px;background:#fff;color:#000}
  .page{padding:12mm 10mm;width:297mm;min-height:210mm}table{border-collapse:collapse;width:100%;font-size:11px}
  th{border:1px solid #333;background:#f0f0f0;text-align:center;padding:3px 2px;font-size:11px}
  td{border:1px solid #333;padding:2px 2px;font-size:11px}
  @media print{@page{size:A4 landscape;margin:8mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="page">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
    <div style="flex:1;text-align:center"><div style="font-size:16px;font-weight:bold">ใบสรุปการปฏิบัติงานค่าฝีมือ</div></div>
    <div style="font-size:12px;white-space:nowrap">ฟอร์ม SA-01</div>
  </div>
  <div style="margin-bottom:2px">ประจำงวด วันที่ ${dStr} เดือน ${THAI_MONTHS[month]} ปี ${year + 543}</div>
  <div style="margin-bottom:8px">ส่วนงาน ${sectionLabel}</div>
  <table><thead>
    <tr>
      <th rowspan="2" style="width:28px">ลำดับ</th>
      <th rowspan="2" style="width:70px">เลขที่บัตรพนักงาน</th>
      <th rowspan="2" style="min-width:100px">ชื่อ - สกุล</th>
      <th colspan="${days.length}">เดือน ${THAI_MONTHS[month]} ${year + 543}</th>
      <th rowspan="2" style="width:30px">รวม</th>
      <th rowspan="2" style="width:70px">ลายเซ็นพนักงาน</th>
      <th rowspan="2" style="width:80px">TA ตรวจสอบ</th>
      <th rowspan="2" style="width:70px">ลายเซ็น TA</th>
      <th rowspan="2" style="width:50px">หมายเหตุ</th>
    </tr>
    <tr>${days.map(d => `<th style="width:22px">${d}</th>`).join('')}</tr>
  </thead><tbody>
    ${tableRows}${emptyRows}
    <tr style="background:#f0f0f0;font-weight:bold">
      <td colspan="3" style="text-align:center;border:1px solid #333">รวม</td>
      ${daySumRow}
      <td style="text-align:center;border:1px solid #333">${rows.reduce((s,r)=>s+Object.keys(r.days).length,0)}</td>
      <td style="border:1px solid #333" colspan="4"></td>
    </tr>
  </tbody></table>
  <div style="margin-top:10px;font-size:11px;line-height:1.8">
    <strong>หมายเหตุ :</strong><br/>
    1. วันที่ 1-15 จะจ่ายในงวดวันที่ 22 ของทุกเดือน<br/>
    2. วันที่ 16-31 จะจ่ายในงวดวันที่ 7 ของทุกเดือน<br/>
    3. กรณีใบ Certification ขาดอายุจะถูกระงับการจ่ายค่าฝีมือ<br/>
    4. พนักงานมีสิทธิ์ได้รับค่าฝีมือต้องปฏิบัติงานครบ 8 ชั่วโมง / วัน
  </div>
</div>
<script>window.onload = () => { window.print(); }</script></body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text)' }}>💰 ใบสรุปค่าฝีมือ (SA-01)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div>
          <span style={lbSt}>ปี</span>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {[today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1].map(y => <option key={y} value={y}>{y+543}</option>)}
          </select>
        </div>
        <div>
          <span style={lbSt}>เดือน</span>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {THAI_MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <span style={lbSt}>งวด</span>
          <select value={period} onChange={e => setPeriod(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value={1}>งวด 1 (1-15)</option>
            <option value={2}>งวด 2 (16-สิ้นเดือน)</option>
          </select>
        </div>
        <div>
          <span style={lbSt}>ไลน์</span>
          <select value={line} onChange={e => setLine(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <button onClick={handlePrint} disabled={loading}
          style={{ padding: '8px 20px', background: '#f59e0b', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'กำลังโหลด...' : '🖨️ พิมพ์ PDF'}
        </button>
      </div>
    </div>
  );
}

function MultiSkillExportCard() {
  const { role, signatureUrl: ctxSigUrl, fullName: ctxFullName } = useContext(UserContext);

  const [lines,      setLines]      = useState([]);
  const [skillDefs,  setSkillDefs]  = useState([]);
  const [filterLine, setFilterLine] = useState('');
  const [dept,       setDept]       = useState('Production');
  const [section,    setSection]    = useState('');
  const [department, setDepartment] = useState('');
  const [headName,   setHeadName]   = useState('');
  const [maker,      setMaker]      = useState('');
  const [checker,    setChecker]    = useState('');
  const [approver,   setApprover]   = useState('');
  const [loading,    setLoading]    = useState(false);
  const [makerSig,    setMakerSig]    = useState(null);
  const [checkerSig,  setCheckerSig]  = useState(null);
  const [approverSig, setApproverSig] = useState(null);

  useEffect(() => {
    if (!ctxSigUrl && !ctxFullName) return;
    if (['leader'].includes(role)) {
      if (ctxFullName) setMaker(n => n || ctxFullName);
      if (ctxSigUrl)   setMakerSig(ctxSigUrl);
    } else if (['supervisor'].includes(role)) {
      if (ctxFullName) setChecker(n => n || ctxFullName);
      if (ctxSigUrl)   setCheckerSig(ctxSigUrl);
    } else if (['manager', 'admin'].includes(role)) {
      if (ctxFullName) setApprover(n => n || ctxFullName);
      if (ctxSigUrl)   setApproverSig(ctxSigUrl);
    }
  }, [role, ctxFullName, ctxSigUrl]);

  useEffect(() => {
    Promise.all([
      supabase.from('production_lines').select('id, name').order('name'),
      supabase.from('skill_definitions').select('*').order('sort_order'),
    ]).then(([{ data: l }, { data: s }]) => { setLines(l || []); setSkillDefs(s || []); });
  }, []);

  const handlePrint = async () => {
    setLoading(true);
    const sel = 'id, name, employee_id_code, position, section, team, start_date, employee_skills(skill_name, score)';
    const q = filterLine
      ? supabase.from('employees').select(sel).eq('is_active', true).eq('line_id', filterLine).order('name')
      : supabase.from('employees').select(sel).eq('is_active', true).order('name');
    const { data } = await q;
    setLoading(false);
    const employees = data || [];
    if (!employees.length) { toast.info('ไม่พบพนักงาน'); return; }

    const empRows = employees.map((emp, i) => {
      const sm = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
      const levels = skillDefs.map(s => scoreToLevel(sm[s.name]));
      const validLevels = levels.filter(l => l > 0);
      const overall = validLevels.length ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length) : 0;
      return { emp, levels, overall, index: i + 1 };
    });
    const levelCounts = MS_LEVELS.map(lv => [
      ...skillDefs.map((_, si) => empRows.filter(r => r.levels[si] === lv.level).length),
      empRows.filter(r => r.overall === lv.level).length,
    ]);
    const [mSig, cSig, aSig] = await Promise.all([
      makerSig    ? urlToDataUrl(makerSig)    : Promise.resolve(null),
      checkerSig  ? urlToDataUrl(checkerSig)  : Promise.resolve(null),
      approverSig ? urlToDataUrl(approverSig) : Promise.resolve(null),
    ]);
    const html = buildMultiSkillHtml({ empRows, levelCounts, skillDefs, dept, section, department, headName, maker, checker, approver, totalEmps: empRows.length, makerSigUrl: mSig, checkerSigUrl: cSig, approverSigUrl: aSig });
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text)' }}>🏅 Multi-Skill Form (MULTI SKILL OF OPERATORS)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div>
          <span style={lbSt}>ไลน์ผลิต</span>
          <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {[
          { label: 'ฝ่าย', val: dept,       set: setDept },
          { label: 'ส่วน', val: section,    set: setSection },
          { label: 'แผนก', val: department, set: setDepartment },
          { label: 'หัวหน้าแผนก', val: headName, set: setHeadName },
        ].map(({ label, val, set }) => (
          <div key={label}>
            <span style={lbSt}>{label}</span>
            <input value={val} onChange={e => set(e.target.value)} placeholder={label}
              style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13, width: 130, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)' }} />
          </div>
        ))}
      </div>

      {/* Signature slots */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, alignItems: 'flex-end' }}>
        {[
          { label: 'จัดทำโดย', name: maker, setName: setMaker, sig: makerSig, setSig: setMakerSig, autoRole: 'leader' },
          { label: 'ตรวจสอบโดย', name: checker, setName: setChecker, sig: checkerSig, setSig: setCheckerSig, autoRole: 'supervisor' },
          { label: 'อนุมัติโดย', name: approver, setName: setApprover, sig: approverSig, setSig: setApproverSig, autoRole: 'manager/admin' },
        ].map(({ label, name, setName, sig, setSig, autoRole }) => (
          <div key={label} style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 10px', background: 'var(--bg2)', minWidth: 170 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={lbSt}>{label}</span>
              <span style={{ fontSize: 9, color: 'var(--muted)', background: 'var(--bg3)', borderRadius: 4, padding: '1px 4px' }}>{autoRole}</span>
            </div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อ-นามสกุล"
              style={{ width: '100%', padding: '4px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', marginBottom: 5 }} />
            {sig ? (
              <div style={{ position: 'relative' }}>
                <img src={sig} alt="sig" style={{ width: '100%', height: 40, objectFit: 'contain', background: '#fff', border: '1px solid var(--border2)', borderRadius: 4 }} />
                <button onClick={() => setSig(null)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: 4, fontSize: 9, cursor: 'pointer', padding: '1px 4px' }}>✕</button>
              </div>
            ) : (
              <label style={{ cursor: 'pointer' }}>
                <div style={{ height: 40, border: '1px dashed var(--border2)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>📎 อัปโหลด</div>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) setSig(URL.createObjectURL(f)); }} />
              </label>
            )}
          </div>
        ))}
        <button onClick={handlePrint} disabled={loading}
          style={{ padding: '8px 20px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, alignSelf: 'flex-end' }}>
          {loading ? 'กำลังโหลด...' : '🖨️ พิมพ์ PDF (A3)'}
        </button>
      </div>
    </div>
  );
}

function AttendancePrint({ employees, days, logsMap, dept, thMonthStr, startDay, endDay }) {
  const bdr  = '0.5px solid #555';
  const tdSt = (ex = {}) => ({ border: bdr, fontSize: 6.5, textAlign: 'center', padding: '0 1px', lineHeight: 1.3, verticalAlign: 'middle', ...ex });
  const thSt = (ex = {}) => ({ ...tdSt(), background: '#dde8ff', fontWeight: 700, ...ex });

  return (
    <div style={{ fontFamily: '"Sarabun","TH Sarabun New",Arial,sans-serif', background: '#fff', color: '#000', padding: 6, minWidth: 900 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 3 }}>
        <tbody>
          <tr>
            <td style={{ width: '35%', textAlign: 'center', fontWeight: 800, fontSize: 10 }}>
              บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด
            </td>
            <td style={{ width: '20%', border: bdr, textAlign: 'center', fontSize: 8, padding: '3px 6px' }}>
              เดือน <strong>{thMonthStr}</strong>
            </td>
            <td style={{ width: '22%', border: bdr, textAlign: 'center', fontSize: 8, padding: '3px 6px' }}>
              งวด วันที่ {startDay}–{endDay}
            </td>
            <td style={{ width: '23%', border: bdr, textAlign: 'center', fontSize: 8, padding: '3px 6px' }}>
              จำนวนพนักงาน <strong>{employees.length}</strong> คน
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, marginBottom: 3 }}>
        ใบบันทึกการมาทำงาน - การหยุดงานของพนักงาน
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 3 }}>
        <tbody>
          <tr>
            <td style={{ fontSize: 7.5, padding: '1px 0' }}>หัวหน้าแผนก ___________________</td>
            <td style={{ fontSize: 7.5, textAlign: 'center' }}>หัวหน้าส่วน ___________________</td>
            <td style={{ fontSize: 7.5, textAlign: 'right' }}>ผู้จัดการ ___________________</td>
          </tr>
        </tbody>
      </table>

      {dept && (
        <div style={{ fontWeight: 700, fontSize: 8, marginBottom: 3, background: '#eef2ff', display: 'inline-block', padding: '1px 6px' }}>
          {dept}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 6.5 }}>
        <colgroup>
          <col style={{ width: 18 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 46 }} />
          {days.flatMap(d => [
            <col key={`ca${d}`} style={{ width: 9 }} />,
            <col key={`cb${d}`} style={{ width: 9 }} />,
            <col key={`cc${d}`} style={{ width: 9 }} />,
          ])}
          {SUMCOLS.map(s => <col key={`cs${s}`} style={{ width: 12 }} />)}
          <col style={{ width: 15 }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} style={thSt({ fontSize: 5.5 })}>ลำดับ</th>
            <th rowSpan={2} style={thSt({ textAlign: 'left', paddingLeft: 3 })}>ชื่อ - สกุล</th>
            <th rowSpan={2} style={thSt()}>เลขที่บัตร</th>
            {days.map(d => <th key={d} colSpan={3} style={thSt()}>{d}</th>)}
            {SUMCOLS.map(s => <th key={s} rowSpan={2} style={thSt({ fontSize: 5.5 })}>{s}</th>)}
            <th rowSpan={2} style={thSt({ fontSize: 5.5 })}>OT<br/>ชม.</th>
          </tr>
          <tr>
            {days.flatMap(d => [
              <th key={`${d}c`} style={thSt({ fontSize: 5 })}>ช</th>,
              <th key={`${d}b`} style={thSt({ fontSize: 5 })}>บ</th>,
              <th key={`${d}o`} style={thSt({ fontSize: 5 })}>อ</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp, idx) => {
            const log = logsMap[emp.id] || {};
            const absentCount = days.filter(d => log[d] === false).length;

            const mainCells = days.flatMap(d => {
              const status = log[d];
              return [
                <td key={`${d}c`} style={tdSt({ background: status === false ? '#ffe4e1' : status === true ? '#f0fff4' : '#fff', fontSize: 6 })}>
                  {status === false ? 'ข' : status === true ? '✓' : ''}
                </td>,
                <td key={`${d}b`} style={tdSt({ background: '#fff' })}></td>,
                <td key={`${d}o`} style={tdSt({ background: '#fff' })}></td>,
              ];
            });

            const otCells = days.flatMap(d => [
              <td key={`${d}c2`} style={tdSt({ height: 10 })}></td>,
              <td key={`${d}b2`} style={tdSt()}></td>,
              <td key={`${d}o2`} style={tdSt()}></td>,
            ]);

            return [
              <tr key={`${emp.id}a`} style={{ height: 14 }}>
                <td rowSpan={2} style={tdSt({ textAlign: 'center', fontWeight: 600 })}>{idx + 1}</td>
                <td rowSpan={2} style={tdSt({ textAlign: 'left', paddingLeft: 3 })}>{emp.name}</td>
                <td rowSpan={2} style={tdSt({ fontSize: 6 })}>{emp.employee_id_code}</td>
                {mainCells}
                {SUMCOLS.map(s => (
                  <td key={s} style={tdSt()}>{s === 'ข' && absentCount > 0 ? absentCount : ''}</td>
                ))}
                <td style={tdSt()}></td>
              </tr>,
              <tr key={`${emp.id}b`} style={{ height: 10 }}>
                {otCells}
                {SUMCOLS.map(s => <td key={s} style={tdSt()}></td>)}
                <td style={tdSt()}></td>
              </tr>,
            ];
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 5, fontSize: 6, lineHeight: 1.8, color: '#444' }}>
        <div><strong>หมายเหตุ:</strong> ส=มาสาย &nbsp; ป=ลาป่วย &nbsp; ก=กาคิง &nbsp; พง=ลาพักผ่อนประจำปี &nbsp; กธ=ลากิจธุระอันจำเป็น &nbsp; บป=ลาอุปสมบท &nbsp; ข=ขาดงาน &nbsp; มต=ไม่มา Meeting</div>
        <div>★ ช = ช่วงเช้า, บ = ช่วงบ่าย, อ = ช่วงโอที &nbsp; ★ ลา 12 ชั่วโมง = 0.2, ลาครึ่งวัน = 0.5</div>
      </div>
    </div>
  );
}

function OTPrint({ employees, dept, thMonthStr }) {
  const bdr  = '0.5px solid #444';
  const tdSt = (ex = {}) => ({ border: bdr, fontSize: 8, padding: '2px 3px', verticalAlign: 'middle', ...ex });
  const thSt = (ex = {}) => ({ ...tdSt(), background: '#c8e6c9', fontWeight: 700, textAlign: 'center', ...ex });

  const half   = Math.ceil(employees.length / 2);
  const groups = [employees.slice(0, half), employees.slice(half)];
  const cols   = [
    { label: 'สำดับ', w: 22 }, { label: 'เลขที่บัตร', w: 56 }, { label: 'ชื่อ-สกุล', w: 110 },
    { label: 'งานที่ทำ', w: 90 }, { label: 'สายรอง', w: 60 },
    { label: 'เวลาเริ่ม', w: 40 }, { label: 'ลายมือชื่อ ล.1', w: 48 },
    { label: 'เวลาเลิก', w: 40 }, { label: 'ชั่วโมง', w: 28 }, { label: 'ลายมือชื่อ ล.2', w: 48 },
  ];

  const renderGroup = (grp, offset) => (
    <table key={offset} style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, tableLayout: 'fixed', fontSize: 8 }}>
      <colgroup>{cols.map((c, i) => <col key={i} style={{ width: c.w }} />)}</colgroup>
      <thead>
        <tr>{cols.map((c, i) => <th key={i} style={thSt()}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {grp.map((emp, i) => (
          <tr key={emp.id} style={{ height: 20 }}>
            <td style={tdSt({ textAlign: 'center' })}>{offset + i + 1}</td>
            <td style={tdSt()}>{emp.employee_id_code}</td>
            <td style={tdSt()}>{emp.name}</td>
            {Array(7).fill(0).map((_, j) => <td key={j} style={tdSt()}></td>)}
          </tr>
        ))}
        {Array.from({ length: Math.max(0, 5 - grp.length) }).map((_, i) => (
          <tr key={`p${i}`} style={{ height: 20 }}>
            {cols.map((_, j) => <td key={j} style={tdSt()}></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div style={{ fontFamily: '"Sarabun","TH Sarabun New",Arial,sans-serif', background: '#fff', color: '#000', padding: 10, minWidth: 700, fontSize: 9 }}>
      <div style={{ textAlign: 'right', marginBottom: 6, fontSize: 8 }}>□ วันธรรมดา &nbsp;&nbsp; □ วันหยุด</div>
      <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, marginBottom: 6 }}>
        แบบฟอร์มใบสั่งงานและรายงานการทำงานล่วงเวลา (ใบ ล.1 และ ล.2)
      </div>
      <div style={{ marginBottom: 6, fontSize: 8, lineHeight: 1.8 }}>
        <div>บริษัท: บริษัทไทยซัมมิท โอโตโมทีฟ จำกัด (สาขา 1) &nbsp;&nbsp;&nbsp; วันที่: ___________</div>
        <div>ฝ่าย: Production &nbsp;&nbsp; ส่วน: {dept || '___________'} &nbsp;&nbsp; Cost: ___________</div>
      </div>
      <div style={{ fontWeight: 700, fontSize: 8.5, marginBottom: 4, borderBottom: '1px solid #555', paddingBottom: 2 }}>
        รายชื่อพนักงานที่ทำงานล่วงเวลา
      </div>
      {groups.map((grp, i) => grp.length > 0 && renderGroup(grp, i === 0 ? 0 : groups[0].length))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10, fontSize: 8 }}>
        {['ผู้บันทึกและผู้อนุมัติ ล.1', 'ผู้บันทึกและผู้อนุมัติ ล.2'].map((label, i) => (
          <div key={i} style={{ border: bdr, padding: '8px 12px' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>{label}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <span>ผู้บันทึก _________________</span><span>(หัวหน้างาน)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>( _________________ )</span><span>(ระดับจัดการ)</span>
            </div>
            <div style={{ fontSize: 7, color: '#888', marginTop: 4 }}>คุณภูลยทารสคน ลาตธนสารสมบัติ</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 7, lineHeight: 1.7, color: '#666', borderTop: '0.5px solid #ccc', paddingTop: 4 }}>
        <strong>ระเบียบปฏิบัติ</strong><br/>
        1. หน่วยงานต้องบันทึกข้อมูลการทำงานล่วงเวลาภายใน 15.00 น. เพื่อส่งข้อมูลให้ฝ่าย HRM จัดรอรับล่า โดยฝ่าย HRM จะแจ้งสายรองภายใน 16.00 น.<br/>
        2. ผู้ที่ทำงานล่วงเวลาต้องลายมือชื่อทั้งก่อนเริ่มงาน (ล.1) และหลังเวลาเลิกงาน (ล.2) โดยให้ส่งแบบฟอร์มนี้ที่ฝ่าย HRM ภายในเวลา 10.00 น. ของวันอังคารไป<br/>
        * รายการขอ OT ข้ามวัน, ** รายการขอ OT ย้อนหลัง
      </div>
    </div>
  );
}

const Loader = () => (
  <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
);

const EmptyRow = ({ cols }) => (
  <tr><td colSpan={cols} style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)', fontSize: 12 }}>ไม่มีข้อมูล</td></tr>
);

const Thumb = ({ src }) => (
  <img src={src || 'https://via.placeholder.com/40'} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border2)' }} />
);

const StatusBadge = ({ ok, label }) => (
  <span style={{
    display: 'inline-block', fontSize: 10, borderRadius: 4, padding: '1px 5px', marginRight: 3,
    background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(231,76,60,0.15)',
    color: ok ? 'var(--green)' : 'var(--red)',
    border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(231,76,60,0.3)'}`,
  }}>{ok ? '✓' : '✗'} {label}</span>
);

const KpiSmall = ({ value, label }) => (
  <span style={{ fontWeight: 700, color: 'var(--green)' }}>
    {value}<span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}> {label}</span>
  </span>
);

/* ══════════════════════════════════════════════════════════════
   💰 SkillAllowanceTab — ใบสรุปค่าฝีมือ
   ══════════════════════════════════════════════════════════════ */
const THAI_MONTHS = ['', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function SkillAllowanceTab() {
  const today = new Date();
  const [year,   setYear]   = useState(today.getFullYear());
  const [month,  setMonth]  = useState(today.getMonth() + 1);
  const [period, setPeriod] = useState(1); // 1=วันที่ 1-15, 2=วันที่ 16-31
  const [line,   setLine]   = useState('');
  const [section, setSection] = useState('');
  const [lines,  setLines]  = useState([]);
  const [rows,   setRows]   = useState([]); // [{emp, days:{1:true,...}, total}]
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('name, section').order('name')
      .then(({ data }) => setLines(data || []));
  }, []);

  // ช่วงวันตามงวด
  const periodDays = () => {
    const daysInMonth = new Date(year, month, 0).getDate();
    if (period === 1) return Array.from({ length: 15 }, (_, i) => i + 1);       // 1-15
    return Array.from({ length: daysInMonth - 15 }, (_, i) => i + 16);           // 16-end
  };

  const load = async () => {
    setLoading(true);
    const days = periodDays();
    const startDate = `${year}-${String(month).padStart(2,'0')}-${String(days[0]).padStart(2,'0')}`;
    const endDate   = `${year}-${String(month).padStart(2,'0')}-${String(days[days.length-1]).padStart(2,'0')}`;

    // หา station ที่มี skill_allowance=true
    let stQ = supabase.from('workstations').select('id, station_name, line_name').eq('skill_allowance', true);
    if (line) stQ = stQ.eq('line_name', line);
    const { data: stations } = await stQ;
    if (!stations?.length) { setRows([]); setLoading(false); return; }

    const stationIds = stations.map(s => String(s.id));

    // logs ที่ qualify
    const { data: logs } = await supabase
      .from('daily_production_logs')
      .select('work_date, employee_id, assigned_line, employees(employee_id_code, name, section, team)')
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .eq('is_present', true)
      .eq('has_helmet', true)
      .eq('has_boots', true)
      .eq('has_gloves', true)
      .in('assigned_line', stationIds);

    // group by employee
    const empMap = {};
    (logs || []).forEach(log => {
      const empId = log.employee_id;
      const day   = parseInt(log.work_date.split('-')[2]);
      if (!empMap[empId]) empMap[empId] = { emp: log.employees, days: {} };
      empMap[empId].days[day] = true;
    });

    const result = Object.values(empMap)
      .filter(r => section ? r.emp?.section === section : true)
      .sort((a, b) => (a.emp?.name || '').localeCompare(b.emp?.name || '', 'th'));

    setRows(result);
    setLoading(false);
  };

  const handlePrint = () => {
    const days = periodDays();
    const dStr = `${days[0]}-${days[days.length-1]}`;
    const sectionLabel = section || (line ? `ไลน์ ${line}` : 'ทุกไลน์');

    const tableRows = rows.map((r, i) => {
      const dayCells = days.map(d =>
        `<td style="text-align:center;border:1px solid #333;font-size:13px">${r.days[d] ? '✓' : ''}</td>`
      ).join('');
      const total = Object.keys(r.days).length;
      return `
        <tr>
          <td style="text-align:center;border:1px solid #333">${i+1}</td>
          <td style="border:1px solid #333;white-space:nowrap;padding:0 4px">${r.emp?.employee_id_code || ''}</td>
          <td style="border:1px solid #333;padding:0 4px">${r.emp?.name || ''}</td>
          ${dayCells}
          <td style="text-align:center;border:1px solid #333;font-weight:bold">${total}</td>
          <td style="border:1px solid #333;width:70px"></td>
          <td style="border:1px solid #333;width:80px"></td>
          <td style="border:1px solid #333;width:70px"></td>
          <td style="border:1px solid #333"></td>
        </tr>`;
    }).join('');

    // แถวว่างเพิ่มเติม (รวม 10 แถว)
    const extraRows = Math.max(0, 10 - rows.length);
    const emptyRows = Array.from({ length: extraRows }, (_, i) => `
      <tr style="height:28px">
        <td style="text-align:center;border:1px solid #333">${rows.length + i + 1}</td>
        <td style="border:1px solid #333"></td>
        <td style="border:1px solid #333"></td>
        ${days.map(() => '<td style="border:1px solid #333"></td>').join('')}
        <td style="border:1px solid #333"></td>
        <td style="border:1px solid #333"></td>
        <td style="border:1px solid #333"></td>
        <td style="border:1px solid #333"></td>
        <td style="border:1px solid #333"></td>
      </tr>`).join('');

    const daySumRow = days.map(d => {
      const cnt = rows.filter(r => r.days[d]).length;
      return `<td style="text-align:center;border:1px solid #333;font-size:12px">${cnt || 0}</td>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<title>ใบสรุปค่าฝีมือ ${THAI_MONTHS[month]} ${year + 543}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', sans-serif; font-size: 13px; background: #fff; color: #000; }
  .page { padding: 12mm 10mm; width: 297mm; min-height: 210mm; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th { border: 1px solid #333; background: #f0f0f0; text-align: center; padding: 3px 2px; font-size: 11px; }
  td { border: 1px solid #333; padding: 2px 2px; font-size: 11px; }
  @media print {
    @page { size: A4 landscape; margin: 8mm; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="page">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
    <div style="flex:1;text-align:center">
      <div style="font-size:16px;font-weight:bold">ใบสรุปการปฏิบัติงานค่าฝีมือ</div>
    </div>
    <div style="font-size:12px;white-space:nowrap">ฟอร์ม SA-01</div>
  </div>
  <div style="margin-bottom:2px">ประจำงวด วันที่ ${dStr} เดือน ${THAI_MONTHS[month]} ปี ${year + 543}</div>
  <div style="margin-bottom:8px">ส่วนงาน ${sectionLabel}</div>
  <table>
    <thead>
      <tr>
        <th rowspan="2" style="width:28px">ลำดับ</th>
        <th rowspan="2" style="width:70px">เลขที่บัตรพนักงาน</th>
        <th rowspan="2" style="min-width:100px">ชื่อ - สกุล</th>
        <th colspan="${days.length}">เดือน ${THAI_MONTHS[month]} ${year + 543}</th>
        <th rowspan="2" style="width:30px">รวม</th>
        <th rowspan="2" style="width:70px">ลายเซ็นพนักงาน</th>
        <th rowspan="2" style="width:80px">TA ตรวจสอบการทำงาน</th>
        <th rowspan="2" style="width:70px">ลายเซ็น TA</th>
        <th rowspan="2" style="width:50px">หมายเหตุ</th>
      </tr>
      <tr>
        ${days.map(d => `<th style="width:22px">${d}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${tableRows}
      ${emptyRows}
      <tr style="background:#f0f0f0;font-weight:bold">
        <td colspan="3" style="text-align:center;border:1px solid #333">รวม</td>
        ${daySumRow}
        <td style="text-align:center;border:1px solid #333">${rows.reduce((s,r)=>s+Object.keys(r.days).length,0)}</td>
        <td style="border:1px solid #333" colspan="4"></td>
      </tr>
    </tbody>
  </table>
  <div style="margin-top:10px;font-size:11px;line-height:1.8">
    <strong>หมายเหตุ :</strong><br/>
    1. วันที่ 1-15 จะจ่ายในงวดวันที่ 22 ของทุกเดือน<br/>
    2. วันที่ 16-31 จะจ่ายในงวดวันที่ 7 ของทุกเดือน<br/>
    3. กรณีใบ Certification ขาดอายุจะถูกระงับการจ่ายค่าฝีมือ<br/>
    4. พนักงานมีสิทธิ์ได้รับค่าฝีมือต้องปฏิบัติงานครบ 8 ชั่วโมง / วัน<br/>
    5. หลักเกณฑ์การจ่ายค่าฝีมือ ตามประกาศที่ SVP.051/2566
  </div>
</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  const days = periodDays();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ปี</div>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {[today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1].map(y => (
              <option key={y} value={y}>{y + 543}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>เดือน</div>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {THAI_MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>งวด</div>
          <select value={period} onChange={e => setPeriod(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value={1}>งวด 1 (วันที่ 1-15)</option>
            <option value={2}>งวด 2 (วันที่ 16-สิ้นเดือน)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ไลน์ผลิต</div>
          <select value={line} onChange={e => setLine(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'กำลังโหลด...' : '🔍 ดึงข้อมูล'}
        </button>
        {rows.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', alignSelf: 'center' }}>🖨️ พิมพ์ได้จากแท็บ Export</span>
        )}
      </div>

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>ใบสรุปค่าฝีมือ</span>
              <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 10 }}>
                งวดวันที่ {days[0]}-{days[days.length-1]} {THAI_MONTHS[month]} {year + 543}
              </span>
            </div>
            <span style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
              {rows.length} คน
            </span>
          </div>
          <table style={{ minWidth: 600, borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>ลำดับ</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>รหัส</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', minWidth: 120 }}>ชื่อ - สกุล</th>
                {days.map(d => (
                  <th key={d} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: 'var(--bg3)', width: 24, textAlign: 'center', fontSize: 10 }}>{d}</th>
                ))}
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', textAlign: 'center' }}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ border: '1px solid var(--border2)', padding: '3px 6px', textAlign: 'center' }}>{i+1}</td>
                  <td style={{ border: '1px solid var(--border2)', padding: '3px 6px', whiteSpace: 'nowrap' }}>{r.emp?.employee_id_code}</td>
                  <td style={{ border: '1px solid var(--border2)', padding: '3px 6px' }}>{r.emp?.name}</td>
                  {days.map(d => (
                    <td key={d} style={{ border: '1px solid var(--border2)', textAlign: 'center', color: '#22c55e', fontWeight: 700 }}>
                      {r.days[d] ? '✓' : ''}
                    </td>
                  ))}
                  <td style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>
                    {Object.keys(r.days).length}
                  </td>
                </tr>
              ))}
              <tr style={{ background: 'var(--bg3)', fontWeight: 700 }}>
                <td colSpan={3} style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '3px 6px' }}>รวม</td>
                {days.map(d => (
                  <td key={d} style={{ border: '1px solid var(--border2)', textAlign: 'center', fontSize: 11 }}>
                    {rows.filter(r => r.days[d]).length || ''}
                  </td>
                ))}
                <td style={{ border: '1px solid var(--border2)', textAlign: 'center' }}>
                  {rows.reduce((s,r) => s + Object.keys(r.days).length, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!loading && rows.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          เลือกเงื่อนไขและกด "ดึงข้อมูล" เพื่อแสดงข้อมูลค่าฝีมือ
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   📋 AttendanceFormTab — ใบบันทึกการมาทำงาน
   ══════════════════════════════════════════════════════════════ */
function AttendanceFormTab() {
  const today   = new Date();
  const [year,    setYear]    = useState(today.getFullYear());
  const [month,   setMonth]   = useState(today.getMonth() + 1);
  const [period,  setPeriod]  = useState(2); // 1=1-15, 2=16-end
  const [line,    setLine]    = useState('');
  const [dept,    setDept]    = useState('');
  const [lines,   setLines]   = useState([]);
  const [empRows, setEmpRows] = useState([]); // [{emp, byDay:{d:{present,ot,leave}}}]
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section').order('name')
      .then(({ data }) => setLines(data || []));
  }, []);

  const periodDays = () => {
    const dim = new Date(year, month, 0).getDate();
    if (period === 1) return Array.from({ length: 15 }, (_, i) => i + 1);
    return Array.from({ length: dim - 15 }, (_, i) => i + 16);
  };

  const isSunday = (day) => {
    const d = new Date(year, month - 1, day);
    return d.getDay() === 0;
  };

  const load = async () => {
    setLoading(true);
    const days = periodDays();
    const pad = (n) => String(n).padStart(2, '0');
    const startDate = `${year}-${pad(month)}-${pad(days[0])}`;
    const endDate   = `${year}-${pad(month)}-${pad(days[days.length - 1])}`;

    let q = supabase
      .from('daily_production_logs')
      .select('work_date, employee_id, is_present, has_ot, leave_type, leave_duration, leave_period, employees(name, employee_id_code, section, team, line_id)')
      .gte('work_date', startDate)
      .lte('work_date', endDate);

    const { data: logs } = await q;

    // group by employee
    const selectedLineId = line ? (lines.find(l => l.name === line)?.id ?? null) : null;
    const empMap = {};
    (logs || []).forEach(log => {
      const emp = log.employees;
      if (!emp) return;
      if (selectedLineId && emp.line_id !== selectedLineId) return;
      if (dept && emp.section !== dept) return;

      const id  = log.employee_id;
      const day = parseInt(log.work_date.split('-')[2]);
      if (!empMap[id]) empMap[id] = { emp, byDay: {} };
      empMap[id].byDay[day] = {
        present: log.is_present,
        ot:      log.has_ot,
        leave:   log.leave_type || null,
        leaveDur: log.leave_duration || null,
      };
    });

    const result = Object.values(empMap)
      .sort((a, b) => (a.emp.name || '').localeCompare(b.emp.name || '', 'th'));
    setEmpRows(result);
    setLoading(false);
  };

  const handlePrint = async () => {
    const days    = periodDays();
    const dStr    = `${days[0]}-${days[days.length-1]}`;
    const deptLabel = dept || line || 'ทุกแผนก';
    const totalEmp  = empRows.length;

    const { data: { user } } = await supabase.auth.getUser();
    const { data: prof } = await supabase.from('profiles').select('signature_url').eq('id', user.id).single();
    const sigDataUrl = prof?.signature_url ? await urlToDataUrl(prof.signature_url) : null;

    const thStyle = 'border:1px solid #000;background:#e8e8e8;text-align:center;font-size:8px;padding:1px 0;';
    const tdStyle = 'border:1px solid #000;text-align:center;font-size:9px;padding:0;height:14px;';
    const tdOTStyle = 'border:1px solid #000;text-align:center;font-size:8px;padding:0;height:12px;';

    const leaveCode = {'ลากิจ':'ก', 'ลาป่วย':'ป', 'ลาพักร้อน':'พง'};

    const makeDayRow1 = (d, r) => {
      const sun = isSunday(d);
      const sunBg = sun ? 'background:#fff8d0;' : '';
      const info = r.byDay[d];
      let markCh = '', markB = '', markO = '';
      if (info?.leave) {
        markCh = `<span style="font-size:8px;color:#b00">${leaveCode[info.leave] || info.leave}</span>`;
      } else if (info?.present) {
        markCh = `<span style="font-size:11px;line-height:1">╱</span>`;
      }
      if (info?.ot) markO = `<span style="font-size:11px;line-height:1">╱</span>`;
      return `<td style="${tdStyle}${sunBg}">${markCh}</td><td style="${tdStyle}${sunBg}">${markB}</td><td style="${tdStyle}${sunBg}">${markO}</td>`;
    };

    const makeDayRow2 = (d, r) => {
      const sun = isSunday(d);
      const sunBg = sun ? 'background:#fff8d0;' : '';
      const info = r.byDay[d];
      const otHr = info?.ot ? '2' : '';
      return `<td style="${tdOTStyle}${sunBg}"></td><td style="${tdOTStyle}${sunBg}"></td><td style="${tdOTStyle}${sunBg}">${otHr}</td>`;
    };

    const dayHeaderRow1 = days.map(d => {
      const sun = isSunday(d);
      const bg = sun ? 'background:#f5c842;' : '';
      return `<th colspan="3" style="${thStyle}${bg}">${d}</th>`;
    }).join('');

    const dayHeaderRow2 = days.map(d => {
      const sun = isSunday(d);
      const bg = sun ? 'background:#fff8d0;' : '';
      return `<th style="${thStyle}${bg}width:7px">ช</th><th style="${thStyle}${bg}width:7px">บ</th><th style="${thStyle}${bg}width:7px">อ</th>`;
    }).join('');

    const dayCols = days.map(() => `<col style="width:7px"/><col style="width:7px"/><col style="width:7px"/>`).join('');

    const empHtml = empRows.map((r, i) => {
      const cntSick     = days.filter(d => r.byDay[d]?.leave === 'ลาป่วย').length;
      const cntPersonal = days.filter(d => r.byDay[d]?.leave === 'ลากิจ').length;
      const cntVacation = days.filter(d => r.byDay[d]?.leave === 'ลาพักร้อน').length;
      const cntAbsent   = days.filter(d => { const b=r.byDay[d]; return b && !b.present && !b.leave; }).length;
      const cntOT       = days.filter(d => r.byDay[d]?.ot).length;
      const fmt = v => v > 0 ? String(v) : '';

      return `
        <tr>
          <td rowspan="2" style="border:1px solid #000;text-align:center;font-size:9px;vertical-align:middle;padding:0">${i+1}</td>
          <td rowspan="2" style="border:1px solid #000;font-size:9px;padding:0 3px;vertical-align:middle">${r.emp.name || ''}</td>
          <td rowspan="2" style="border:1px solid #000;text-align:center;font-size:9px;padding:0;vertical-align:middle;white-space:nowrap">${r.emp.employee_id_code || ''}</td>
          ${days.map(d => makeDayRow1(d, r)).join('')}
          <td style="${tdStyle}">${fmt(0)}</td>
          <td style="${tdStyle}">${fmt(cntSick)}</td>
          <td style="${tdStyle}">${fmt(cntPersonal)}</td>
          <td style="${tdStyle}">${fmt(cntVacation)}</td>
          <td style="${tdStyle}">${fmt(0)}</td>
          <td style="${tdStyle}">${fmt(0)}</td>
          <td style="${tdStyle}">${fmt(cntAbsent)}</td>
          <td style="${tdStyle}">${fmt(0)}</td>
          <td style="${tdStyle}">${fmt(cntOT)}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;font-size:8px;text-align:left;padding:0 3px;height:12px">→ จำนวน ช.ม ที่ทำ OT</td>
          ${days.slice(1).map(d => makeDayRow2(d, r)).join('')}
          <td style="${tdOTStyle}">${fmt(cntOT)}</td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
          <td style="${tdOTStyle}"></td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<title>ใบบันทึกการมาทำงาน ${THAI_MONTHS[month]} ${year+543}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Sarabun',sans-serif;font-size:10px;background:#fff;color:#000}
  table{border-collapse:collapse;width:100%}
  @media print{@page{size:A3 landscape;margin:5mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body style="padding:5mm">

<!-- HEADER TABLE -->
<table style="width:100%;border-collapse:collapse;margin-bottom:3px">
  <tr>
    <td style="width:70px;vertical-align:middle;padding:2px 4px;text-align:center">
      <svg width="55" height="42" viewBox="0 0 55 42">
        <rect x="1" y="1" width="53" height="40" rx="3" fill="#fff" stroke="#c00" stroke-width="1.5"/>
        <text x="8" y="28" font-family="Arial Black,sans-serif" font-size="22" font-weight="900" fill="#c00">S</text>
        <text x="26" y="28" font-family="Arial Black,sans-serif" font-size="16" font-weight="900" fill="#c00">T</text>
        <text x="36" y="28" font-family="Arial Black,sans-serif" font-size="14" font-weight="900" fill="#c00">S</text>
        <text x="5" y="38" font-family="Arial,sans-serif" font-size="5" letter-spacing="1" fill="#333">AUTOMOTIVE</text>
      </svg>
    </td>
    <td style="vertical-align:middle;padding:2px 8px">
      <div style="font-size:11px;font-weight:bold;text-align:center">บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด</div>
      <div style="font-size:10px;font-weight:bold;text-align:center;margin-top:2px">ใบบันทึกการมาทำงาน - การหยุดงานของพนักงาน</div>
      <div style="font-size:10px;text-align:center;margin-top:2px">${deptLabel}</div>
    </td>
    <td style="width:38%;vertical-align:top;padding:0">
      <table style="width:100%;border-collapse:collapse;font-size:9px">
        <tr>
          <td style="border:1px solid #000;padding:2px 6px;text-align:center">เดือน ${THAI_MONTHS[month]} ${year+543}</td>
          <td style="border:1px solid #000;padding:2px 6px;text-align:center">งวด วันที่ ${dStr}</td>
          <td style="border:1px solid #000;padding:2px 6px;text-align:center">จำนวนพนักงาน <b>${totalEmp}</b> คน</td>
        </tr>
        <tr>
          <td style="border:1px solid #000;height:52px;text-align:center;vertical-align:top;padding-top:2px;font-size:8px">
            ${sigDataUrl ? `<img src="${sigDataUrl}" style="max-height:40px;max-width:90px;object-fit:contain;display:block;margin:0 auto 2px"/>` : '<div style="height:40px"></div>'}
            หัวหน้าแผนก
          </td>
          <td style="border:1px solid #000;height:52px;text-align:center;vertical-align:bottom;padding-bottom:2px;font-size:8px">หัวหน้าส่วน</td>
          <td style="border:1px solid #000;height:52px;text-align:center;vertical-align:bottom;padding-bottom:2px;font-size:8px">ผู้จัดการ</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- MAIN TABLE -->
<table style="width:100%;border-collapse:collapse;table-layout:fixed">
  <colgroup>
    <col style="width:16px"/>
    <col style="width:88px"/>
    <col style="width:52px"/>
    ${dayCols}
    <col style="width:13px"/>
    <col style="width:13px"/>
    <col style="width:13px"/>
    <col style="width:14px"/>
    <col style="width:14px"/>
    <col style="width:14px"/>
    <col style="width:13px"/>
    <col style="width:14px"/>
    <col style="width:16px"/>
  </colgroup>
  <thead>
    <tr>
      <th rowspan="2" style="${thStyle}">ลำดับ</th>
      <th rowspan="2" style="${thStyle}">ชื่อ - สกุล</th>
      <th rowspan="2" style="${thStyle}">เลขที่บัตร</th>
      ${dayHeaderRow1}
      <th rowspan="2" style="${thStyle}width:13px">ส</th>
      <th rowspan="2" style="${thStyle}width:13px">ป</th>
      <th rowspan="2" style="${thStyle}width:13px">ก</th>
      <th rowspan="2" style="${thStyle}width:14px">พง</th>
      <th rowspan="2" style="${thStyle}width:14px">กธ</th>
      <th rowspan="2" style="${thStyle}width:14px">บป</th>
      <th rowspan="2" style="${thStyle}width:13px">ข</th>
      <th rowspan="2" style="${thStyle}width:14px">มต</th>
      <th rowspan="2" style="${thStyle}width:16px">OT</th>
    </tr>
    <tr>
      ${dayHeaderRow2}
    </tr>
  </thead>
  <tbody>
    ${empHtml}
  </tbody>
</table>

<!-- FOOTER -->
<div style="margin-top:4px;font-size:8px;line-height:1.7;border-top:1px solid #666;padding-top:3px">
  หมายเหตุ * ส=มาสาย &nbsp; ป=ลาป่วย &nbsp; ก=ลากิจ &nbsp; พง=พักผ่อนประจำปี &nbsp; กธ=กิจธุระอันจำเป็น &nbsp; บป=ลาอุปสมบท &nbsp; ข=ขาดงาน &nbsp; พง=พักงาน<br/>
  * ช = ช่วงเช้า, บ = ช่วงบ่าย, อ = ช่วงโอที, มต = ไม่มา Meeting<br/>
  * ลา 2 ชั่วโมง = 0.2, ลาครึ่งวัน = 0.5
</div>

<script>window.onload = () => window.print();</script>
</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  const days = periodDays();
  const depts = [...new Set(lines.map(l => l.section).filter(Boolean))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ปี</div>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {[today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1].map(y => (
              <option key={y} value={y}>{y+543}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>เดือน</div>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            {THAI_MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>งวด</div>
          <select value={period} onChange={e => setPeriod(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value={1}>งวด 1 (วันที่ 1-15)</option>
            <option value={2}>งวด 2 (วันที่ 16-สิ้นเดือน)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ไลน์</div>
          <select value={line} onChange={e => setLine(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        {depts.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ส่วนงาน / Section</div>
            <select value={dept} onChange={e => setDept(e.target.value)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13 }}>
              <option value="">ทุกส่วนงาน</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'กำลังโหลด...' : '🔍 ดึงข้อมูล'}
        </button>
        {empRows.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', alignSelf: 'center' }}>🖨️ พิมพ์ได้จากแท็บ Export</span>
        )}
      </div>

      {/* Preview */}
      {empRows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700 }}>ใบบันทึกการมาทำงาน</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              งวดวันที่ {days[0]}-{days[days.length-1]} {THAI_MONTHS[month]} {year+543} · {empRows.length} คน
            </span>
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>#</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', minWidth: 100 }}>ชื่อ - สกุล</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)' }}>รหัส</th>
                {days.map(d => (
                  <th key={d} style={{ border: '1px solid var(--border2)', padding: '4px 3px', background: isSunday(d) ? 'rgba(245,200,50,0.35)' : 'var(--bg3)', width: 22, textAlign: 'center', fontSize: 10 }}>{d}</th>
                ))}
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'var(--bg3)', textAlign: 'center' }}>รวม</th>
                <th style={{ border: '1px solid var(--border2)', padding: '4px 6px', background: 'rgba(255,150,50,0.15)', textAlign: 'center', color: '#c05000' }}>OT</th>
              </tr>
            </thead>
            <tbody>
              {empRows.map((r, i) => {
                const totalP = days.filter(d => r.byDay[d]?.present).length;
                const totalOT = days.filter(d => r.byDay[d]?.ot).length;
                return (
                  <tr key={i}>
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', padding: '3px 4px' }}>{i+1}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 6px', whiteSpace: 'nowrap' }}>{r.emp.name}</td>
                    <td style={{ border: '1px solid var(--border2)', padding: '3px 6px', whiteSpace: 'nowrap' }}>{r.emp.employee_id_code}</td>
                    {days.map(d => {
                      const info = r.byDay[d];
                      const sunBg = isSunday(d) ? 'rgba(245,200,50,0.2)' : 'transparent';
                      return (
                        <td key={d} style={{ border: '1px solid var(--border2)', textAlign: 'center', background: sunBg }}>
                          {info?.present ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                            : info?.leave ? <span style={{ color: '#f59e0b', fontSize: 9 }}>{info.leave}</span>
                            : ''}
                          {info?.ot ? <span style={{ color: '#c05000', fontSize: 8, display: 'block' }}>OT</span> : ''}
                        </td>
                      );
                    })}
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: 700, color: '#22c55e' }}>{totalP}</td>
                    <td style={{ border: '1px solid var(--border2)', textAlign: 'center', fontWeight: 700, color: '#c05000' }}>{totalOT || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && empRows.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          เลือกเงื่อนไขและกด "ดึงข้อมูล" เพื่อแสดงใบบันทึกการมาทำงาน
        </div>
      )}
    </div>
  );
}
