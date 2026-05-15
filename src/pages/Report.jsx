import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const CAT_META = {
  Man:      { color: '#4d9fff', bg: 'rgba(77,159,255,0.12)',  label: 'Man',      icon: '👷' },
  Machine:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Machine',  icon: '⚙️' },
  Material: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'Material', icon: '📦' },
  Method:   { color: '#c084fc', bg: 'rgba(139,92,246,0.12)', label: 'Method',   icon: '📋' },
};

const TABS = ['รายวัน', 'รายพนักงาน', 'สรุปช่วงเวลา', '🚨 4M Changes', '📊 Skill Matrix'];

const SKILL_LEVELS = [
  { min: 80, label: 'ชำนาญ',       color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { min: 60, label: 'ผ่านเกณฑ์',   color: '#84cc16', bg: 'rgba(132,204,18,0.15)' },
  { min: 40, label: 'กำลังพัฒนา', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { min: 0,  label: 'เริ่มต้น',     color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
];
const getLevel = (score) => SKILL_LEVELS.find(l => score >= l.min) || SKILL_LEVELS[3];

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
      {activeTab === 2 && <RangeTab />}
      {activeTab === 3 && <FourMTab />}
      {activeTab === 4 && <SkillMatrixTab />}
    </div>
  );
}

function DailyTab() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { load(); }, [date]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('daily_production_logs')
      .select('*, employees(name, employee_id_code, image_url, department)')
      .eq('work_date', date).eq('is_present', true).order('updated_at');
    setLogs(data || []);
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>รวม {logs.length} คน</span>
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
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.assigned_line || '—'}</td>
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

  useEffect(() => {
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
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.assigned_line || '—'}</td>
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
  const today = new Date().toISOString().split('T')[0];
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; });
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

function FourMTab() {
  const today = new Date().toISOString().split('T')[0];
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; });
  const [to, setTo] = useState(today);
  const [line, setLine] = useState('');
  const [cat, setCat] = useState('');
  const [logs, setLogs] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('name').order('name').then(({ data }) => setLines(data || []));
  }, []);

  useEffect(() => { load(); }, [from, to, line, cat]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('four_m_logs').select('*')
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (line) q = q.eq('line_name', line);
    if (cat) q = q.eq('category', cat);
    const { data } = await q;
    setLogs(data || []);
    setLoading(false);
  };

  const kpi = Object.fromEntries(Object.keys(CAT_META).map(k => [k, logs.filter(l => l.category === k).length]));

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {Object.entries(CAT_META).map(([k, m]) => (
          <div key={k} onClick={() => setCat(c => c === k ? '' : k)} style={{
            background: cat === k ? m.bg : 'var(--card)',
            border: `1px solid ${cat === k ? m.color : 'var(--border)'}`,
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
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>รวม {logs.length} รายการ</span>
      </div>
      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 560 }}>
            <thead><tr><th>วันที่</th><th>ไลน์</th><th>ประเภท</th><th>รายละเอียดการเปลี่ยนแปลง</th><th>เวลาบันทึก</th></tr></thead>
            <tbody>
              {logs.length === 0 ? <EmptyRow cols={5} /> : logs.map(l => {
                const m = CAT_META[l.category] || {};
                const ts = l.created_at ? new Date(l.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—';
                return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.work_date}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.line_name}</td>
                    <td><span style={{ background: m.bg, color: m.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{m.icon} {l.category}</span></td>
                    <td style={{ fontSize: 13 }}>{l.description}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{ts}</td>
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

function SkillMatrixTab() {
  const [skillDefs, setSkillDefs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterLine, setFilterLine] = useState('');
  const [lines, setLines] = useState([]);

  useEffect(() => {
    supabase.from('production_lines').select('id, name').order('name').then(({ data }) => setLines(data || []));
    load();
  }, []);

  useEffect(() => { load(); }, [filterLine]);

  const load = async () => {
    setLoading(true);
    const [{ data: defs }, { data: emps }] = await Promise.all([
      supabase.from('skill_definitions').select('*').order('sort_order'),
      filterLine
        ? supabase.from('employees').select('id, name, employee_id_code, line_id, employee_skills(skill_name, score)').eq('is_active', true).eq('line_id', filterLine).order('name')
        : supabase.from('employees').select('id, name, employee_id_code, line_id, employee_skills(skill_name, score)').eq('is_active', true).order('name'),
    ]);
    setSkillDefs(defs || []);
    setEmployees(emps || []);
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
          <option value="">ทุกไลน์</option>
          {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{employees.length} คน · {skillDefs.length} สกิล</span>
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
          <table style={{ minWidth: 300 + skillDefs.length * 90 }}>
            <thead>
              <tr>
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
              {employees.length === 0 ? <EmptyRow cols={1 + skillDefs.length} /> : employees.map(emp => {
                const skillMap = {};
                (emp.employee_skills || []).forEach(s => { skillMap[s.skill_name] = s.score; });
                return (
                  <tr key={emp.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{emp.employee_id_code}</div>
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
