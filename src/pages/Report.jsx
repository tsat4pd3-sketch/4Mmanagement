import { useState, useEffect, useRef, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';

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

const TABS = ['รายวัน', 'รายพนักงาน', 'สรุปช่วงเวลา', '🚨 4M Changes', '📊 Skill Matrix', '📤 Export', '💰 ค่าฝีมือ', '📋 ใบบันทึก'];

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
      {activeTab === 5 && <ExportTab />}
      {activeTab === 6 && <SkillAllowanceTab />}
      {activeTab === 7 && <AttendanceFormTab />}
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
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>รวม {logs.length} คน</span>
        <CsvBtn onClick={() => downloadCSV(
          `daily_${date}.csv`,
          ['วันที่', 'รหัสพนักงาน', 'ชื่อ', 'แผนก', 'หมวก', 'รองเท้า', 'ถุงมือ', 'OT'],
          logs.map(l => [date, l.employees?.employee_id_code, l.employees?.name, l.employees?.department || '', l.has_helmet ? '✓' : '✗', l.has_boots ? '✓' : '✗', l.has_gloves ? '✓' : '✗', l.has_ot ? '✓' : ''])
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
  pending:  { label: '⏳ รอ Approve', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  approved: { label: '✅ Approved',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  rejected: { label: '❌ Rejected',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
};

function FourMTab() {
  const { role } = useContext(UserContext);
  const canApproveLog = (log) => {
    if (['admin', 'manager'].includes(role)) return true;
    if (role === 'qa') return log.requires_qa !== false; // qa approves high-severity
    if (['supervisor', 'leader'].includes(role)) return log.requires_qa === false; // supervisor approves low-severity only
    return false;
  };

  const today = new Date().toISOString().split('T')[0];
  const [from,        setFrom]        = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]; });
  const [to,          setTo]          = useState(today);
  const [line,        setLine]        = useState('');
  const [cat,         setCat]         = useState('');
  const [statusFilter,setStatusFilter]= useState('');
  const [logs,        setLogs]        = useState([]);
  const [lines,       setLines]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [rejectModal, setRejectModal] = useState(null); // log id
  const [rejectReason,setRejectReason]= useState('');
  const [approverMap, setApproverMap] = useState({}); // userId → fullName

  useEffect(() => {
    supabase.from('production_lines').select('name').order('name').then(({ data }) => setLines(data || []));
  }, []);

  useEffect(() => { load(); }, [from, to, line, cat, statusFilter]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('four_m_logs')
      .select('id, work_date, line_name, category, description, created_at, status, approved_by, approved_at, reject_reason, requires_qa, change_subtype')
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (line)         q = q.eq('line_name', line);
    if (cat)          q = q.eq('category', cat);
    if (statusFilter) q = q.eq('status', statusFilter);
    const { data } = await q;
    setLogs(data || []);

    // load approver names
    const ids = [...new Set((data || []).filter(l => l.approved_by).map(l => l.approved_by))];
    if (ids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      const map = {};
      (profiles || []).forEach(p => { map[p.id] = p.full_name || 'ไม่ระบุ'; });
      setApproverMap(map);
    }
    setLoading(false);
  };

  const handleApprove = async (logId) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('four_m_logs').update({
      status: 'approved', approved_by: user.id, approved_at: new Date().toISOString(), reject_reason: null,
    }).eq('id', logId);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    toast.success('Approved เรียบร้อย');
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
    setRejectModal(null); setRejectReason('');
    load();
  };

  const kpi = Object.fromEntries(Object.keys(CAT_META).map(k => [k, logs.filter(l => l.category === k).length]));
  const pendingCount = logs.filter(l => l.status === 'pending').length;

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
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
          <option value="pending">⏳ รอ Approve</option>
          <option value="approved">✅ Approved</option>
          <option value="rejected">❌ Rejected</option>
        </select>
        {pendingCount > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 6, padding: '3px 8px' }}>
            ⏳ รอ Approve {pendingCount} รายการ
          </span>
        )}
        <CsvBtn onClick={() => downloadCSV(
          `4m_changes_${from}_${to}.csv`,
          ['วันที่', 'ไลน์', 'ประเภท', 'รายละเอียด', 'สถานะ', 'Approved โดย', 'เวลา Approve', 'เหตุผล Reject'],
          logs.map(l => [l.work_date, l.line_name, l.category, l.description, l.status, l.approved_by ? (approverMap[l.approved_by] || l.approved_by) : '', l.approved_at ? new Date(l.approved_at).toLocaleString('th-TH') : '', l.reject_reason || ''])
        )} />
      </div>

      {loading ? <Loader /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>วันที่</th><th>ไลน์</th><th>ประเภท</th><th>รายละเอียด</th>
                <th style={{ textAlign: 'center' }}>สถานะ</th>
                <th style={{ textAlign: 'center', minWidth: 90 }}>ระดับ</th>
                <th style={{ textAlign: 'center', minWidth: 140 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? <EmptyRow cols={7} /> : logs.map(l => {
                const m  = CAT_META[l.category] || {};
                const sm = STATUS_META[l.status] || STATUS_META.pending;
                const approverName = l.approved_by ? (approverMap[l.approved_by] || '...') : null;
                const needsQA = l.requires_qa !== false;
                const userCanAct = canApproveLog(l);
                return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: 12 }}>{l.work_date}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.line_name}</td>
                    <td><span style={{ background: m.bg, color: m.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{m.icon} {l.category}</span></td>
                    <td style={{ fontSize: 13 }}>
                      {l.description}
                      {l.change_subtype && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{l.change_subtype === 'replace' ? '🔄 Replace' : '⚠️ Change'}</div>}
                      {l.reject_reason && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>เหตุผล: {l.reject_reason}</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ background: sm.bg, color: sm.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{sm.label}</span>
                        {approverName && <span style={{ fontSize: 9, color: 'var(--muted)' }}>{approverName}</span>}
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
                      {l.status === 'pending' ? (
                        userCanAct ? (
                          <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                            <button onClick={() => handleApprove(l.id)}
                              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
                              ✅ Approve
                            </button>
                            <button onClick={() => { setRejectModal(l.id); setRejectReason(''); }}
                              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                              ❌ Reject
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {needsQA ? 'รอ QA' : 'รอหัวหน้า'}
                          </span>
                        )
                      ) : (
                        ['admin','manager'].includes(role) && (
                          <button onClick={() => supabase.from('four_m_logs').update({ status: 'pending', approved_by: null, approved_at: null, reject_reason: null }).eq('id', l.id).then(load)}
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
        <CsvBtn onClick={() => {
          const headers = ['รหัสพนักงาน', 'ชื่อ', ...skillDefs.map(s => s.label), 'เฉลี่ย'];
          const rows = employees.map(emp => {
            const skillMap = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));
            const scores = skillDefs.map(s => skillMap[s.name] ?? 0);
            const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
            return [emp.employee_id_code, emp.name, ...scores, avg];
          });
          downloadCSV('skill_matrix.csv', headers, rows);
        }} />
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

// ─── Export Tab ─────────────────────────────────────────────
const SUMCOLS = ['ส', 'ป', 'ก', 'พง', 'กธ', 'บป', 'ข', 'มต'];
const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

/* ── Quick CSV export section at top of Export tab ── */
function QuickCsvSection() {
  const today = new Date().toISOString().split('T')[0];
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

function ExportTab() {
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
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--text)' }}>📄 Export รายงาน PDF (ฟอร์มทางการ)</div>
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

const lbSt = { fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4, display: 'block' };

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
          <button onClick={handlePrint}
            style={{ padding: '8px 20px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
            🖨️ พิมพ์ PDF
          </button>
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
    supabase.from('production_lines').select('name, section').order('name')
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
    const empMap = {};
    (logs || []).forEach(log => {
      const emp = log.employees;
      if (!emp) return;
      // filter by line or dept if set
      if (line) {
        // match by line name via production_lines — approximate by section or just skip if no match
        // we'll filter by section (dept) below
      }
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

  const handlePrint = () => {
    const days    = periodDays();
    const dStr    = `${days[0]}-${days[days.length-1]}`;
    const deptLabel = dept || line || 'ทุกแผนก';
    const totalEmp  = empRows.length;

    const thStyle = 'border:1px solid #000;background:#d8d8d8;text-align:center;font-size:9px;padding:1px 2px;';
    const tdStyle = 'border:1px solid #000;text-align:center;font-size:9px;padding:0;';

    // day header
    const dayHeaders = days.map(d => {
      const sun  = isSunday(d);
      const bg   = sun ? 'background:#f5c842;' : '';
      return `<th style="${thStyle}${bg}width:20px">${d}</th>`;
    }).join('');

    // employee rows (3 sub-rows each: กะ01, กะ02, OT)
    const empHtml = empRows.map((r, i) => {
      const totalPresent01 = days.filter(d => r.byDay[d]?.present && !r.byDay[d]?.ot).length;
      const totalOT        = days.filter(d => r.byDay[d]?.ot).length;

      const makeDayCells = (rowType) => days.map(d => {
        const sun = isSunday(d);
        const bg  = sun ? 'background:#fff8d0;' : '';
        const info = r.byDay[d];
        let mark = '';
        if (rowType === 'k01') {
          if (info?.present) mark = '<span style="font-size:13px;line-height:1">✓</span>';
          else if (info?.leave) mark = `<span style="font-size:8px;color:#c00">${info.leave}</span>`;
        } else if (rowType === 'ot') {
          if (info?.ot) mark = '<span style="font-size:9px;font-weight:bold;color:#c05000">OT</span>';
        }
        return `<td style="${tdStyle}${bg}height:16px">${mark}</td>`;
      }).join('');

      return `
        <tr>
          <td rowspan="3" style="border:1px solid #000;text-align:center;font-size:9px;vertical-align:middle">${i+1}</td>
          <td rowspan="3" style="border:1px solid #000;font-size:9px;padding:0 3px;vertical-align:middle;min-width:80px">${r.emp.name || ''}</td>
          <td rowspan="3" style="border:1px solid #000;text-align:center;font-size:9px;padding:0 2px;vertical-align:middle;white-space:nowrap">${r.emp.employee_id_code || ''}</td>
          <td style="border:1px solid #000;background:#cce4ff;width:12px"></td>
          <td style="border:1px solid #000;background:#fff4aa;width:12px"></td>
          <td style="border:1px solid #000;background:#ffcccc;width:12px"></td>
          <td style="border:1px solid #000;font-size:8px;padding:0 2px;white-space:nowrap;color:#333">งาน ช. กะ 01</td>
          ${makeDayCells('k01')}
          <td style="border:1px solid #000;text-align:center;font-size:9px;font-weight:bold">${totalPresent01 || ''}</td>
          <td style="border:1px solid #000"></td>
          <td style="border:1px solid #000"></td>
          <td style="border:1px solid #000"></td>
        </tr>
        <tr>
          <td style="border:1px solid #000;background:#cce4ff"></td>
          <td style="border:1px solid #000;background:#fff4aa"></td>
          <td style="border:1px solid #000;background:#ffcccc"></td>
          <td style="border:1px solid #000;font-size:8px;padding:0 2px;white-space:nowrap;color:#333">งาน ช. กะ 02</td>
          ${days.map(d => { const sun=isSunday(d); return `<td style="${tdStyle}${sun?'background:#fff8d0;':''}">&nbsp;</td>`; }).join('')}
          <td style="border:1px solid #000"></td>
          <td style="border:1px solid #000"></td>
          <td style="border:1px solid #000"></td>
          <td style="border:1px solid #000"></td>
        </tr>
        <tr>
          <td style="border:1px solid #000;background:#cce4ff"></td>
          <td style="border:1px solid #000;background:#fff4aa"></td>
          <td style="border:1px solid #000;background:#ffcccc"></td>
          <td style="border:1px solid #000;font-size:8px;padding:0 2px;white-space:nowrap;color:#333">งาน ช. กะ OT</td>
          ${makeDayCells('ot')}
          <td style="border:1px solid #000;text-align:center;font-size:9px;font-weight:bold;color:#c05000">${totalOT || ''}</td>
          <td style="border:1px solid #000"></td>
          <td style="border:1px solid #000"></td>
          <td style="border:1px solid #000"></td>
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
  .page{padding:6mm 5mm;width:420mm;min-height:297mm}
  table{border-collapse:collapse}
  @media print{
    @page{size:A3 landscape;margin:5mm}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style>
</head>
<body>
<div class="page">
  <!-- Header -->
  <table style="width:100%;margin-bottom:3px">
    <tr>
      <td style="width:200px;vertical-align:middle;padding:2px 6px">
        <div style="font-size:20px;font-weight:900;color:#c00;letter-spacing:-1px;line-height:1">S<span style="font-size:14px">T</span></div>
        <div style="font-size:7px;font-weight:bold;letter-spacing:1px">AUTOMOTIVE</div>
      </td>
      <td style="text-align:center;vertical-align:middle">
        <div style="font-size:13px;font-weight:bold">บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด</div>
        <div style="font-size:11px;font-weight:bold;margin-top:4px">ใบบันทึกการมาทำงาน - การกระจายอัตรากำลังพนักงาน</div>
        <div style="font-size:11px;margin-top:2px">${deptLabel}</div>
      </td>
      <td style="text-align:right;vertical-align:top;padding:2px;white-space:nowrap">
        <table style="float:right;font-size:10px">
          <tr><td style="border:1px solid #000;padding:3px 10px">เดือน ${THAI_MONTHS[month]} ${year+543}</td></tr>
          <tr><td style="border:1px solid #000;padding:3px 10px">งวด วันที่ ${dStr}</td></tr>
          <tr><td style="border:1px solid #000;padding:3px 10px">จำนวนพนักงาน <strong>${totalEmp}</strong> คน</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Signature row -->
  <table style="width:100%;margin-bottom:4px">
    <tr>
      <td style="width:33%;border:1px solid #000;height:50px;text-align:center;vertical-align:top;padding-top:3px;font-size:10px">หัวหน้าแผนก</td>
      <td style="width:34%;border:1px solid #000;text-align:center;vertical-align:top;padding-top:3px;font-size:10px">พักหน้าส่วน</td>
      <td style="width:33%;border:1px solid #000;text-align:center;vertical-align:top;padding-top:3px;font-size:10px">ผู้จัดการ</td>
    </tr>
  </table>

  <!-- Main table -->
  <table style="width:100%">
    <thead>
      <tr>
        <th rowspan="2" style="${thStyle}width:18px">ลำดับ</th>
        <th rowspan="2" style="${thStyle}min-width:80px">ชื่อ - สกุล</th>
        <th rowspan="2" style="${thStyle}width:55px">รหัสพนักงาน</th>
        <th colspan="3" style="${thStyle}width:36px">กะ</th>
        <th rowspan="2" style="${thStyle}width:55px">ประเภทงาน</th>
        ${dayHeaders}
        <th rowspan="2" style="${thStyle}width:22px">รวม</th>
        <th rowspan="2" style="${thStyle}width:40px">ลายเซ็น</th>
        <th rowspan="2" style="${thStyle}width:40px">TA</th>
        <th rowspan="2" style="${thStyle}width:30px">หมาย<br/>เหตุ</th>
      </tr>
      <tr>
        <th style="${thStyle}background:#cce4ff;width:12px">ข</th>
        <th style="${thStyle}background:#fff4aa;width:12px">น</th>
        <th style="${thStyle}background:#ffcccc;width:12px">0</th>
      </tr>
    </thead>
    <tbody>
      ${empHtml}
    </tbody>
  </table>

  <!-- Footer legend -->
  <div style="margin-top:6px;font-size:9px;line-height:1.8;border-top:1px solid #000;padding-top:4px">
    <strong>หมายเหตุ:</strong> ข=ช่วงเช้า, น=ช่วงบ่าย, 0=ช่วงค่ำ, กะ=สะสมเดือนประจำ, บก=ไม่มา Meeting<br/>
    * ข = ช่วงเช้า, น = ช่วงบ่าย, 0 = ช่วงค่ำ, กะ = สะสมเดือนประจำ, บก = ไม่มา Meeting<br/>
    * อาร ช่วงเช้า = 0.2, อาทร์ช่วงบ่าย = 0.5
  </div>
</div>
<script>window.onload = () => window.print();</script>
</body>
</html>`;

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
          <button onClick={handlePrint}
            style={{ padding: '8px 20px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
            🖨️ พิมพ์ PDF (A3)
          </button>
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
