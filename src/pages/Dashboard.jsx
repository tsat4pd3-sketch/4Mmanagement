import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [summaryData, setSummaryData] = useState([]);
  const [fourMLogs, setFourMLogs] = useState([]);
  const [workstations, setWorkstations] = useState([]);
  const [lines, setLines] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    fetchWorkstations();
    fetchLines();
  }, []);

  useEffect(() => {
    fetchSummary();
    fetch4MLogs();
  }, [selectedDate]);

  const fetchLines = async () => {
    const { data } = await supabase.from('production_lines').select('id, name').order('name');
    setLines(data || []);
  };

  const fetchWorkstations = async () => {
    const { data } = await supabase.from('workstations').select('id, line_name');
    setWorkstations(data || []);
  };

  const fetchSummary = async () => {
    const { data } = await supabase
      .from('daily_production_logs')
      .select('id, is_present, assigned_line, employees ( employee_id_code, name, department )')
      .eq('work_date', selectedDate);
    setSummaryData(data || []);
  };

  const fetch4MLogs = async () => {
    const { data } = await supabase
      .from('four_m_logs')
      .select('*')
      .eq('work_date', selectedDate)
      .order('created_at', { ascending: false });
    setFourMLogs(data || []);
  };

  const totalPresent = summaryData.filter(d => d.is_present).length;
  const totalAbsent  = summaryData.filter(d => !d.is_present).length;

  const getLineCount = (lineName) => {
    const ids = workstations.filter(s => s.line_name === lineName).map(s => String(s.id));
    return summaryData.filter(d => d.assigned_line && ids.includes(String(d.assigned_line))).length;
  };

  const getLine4MCount = (lineName) => fourMLogs.filter(l => l.line_name === lineName).length;

  const lineColors = ['#27ae60', '#2980b9', '#8e44ad', '#f39c12', '#e74c3c', '#1abc9c'];

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <motion.h2 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          style={{ color: 'var(--text)', margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 3vw, 22px)' }}>
          📊 Production Executive Summary
        </motion.h2>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>📅</span>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, outline: 'none', padding: 0, width: 'auto' }}
          />
        </div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={kpiCard('#34495e')}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>พนักงานทั้งหมด</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-display)', margin: '6px 0' }}>
            {summaryData.length}<span style={{ fontSize: 14, fontWeight: 400 }}> คน</span>
          </div>
          <div style={{ fontSize: 11 }}>ขาด: {totalAbsent} | มา: {totalPresent}</div>
        </div>
        {lines.map((line, idx) => (
          <div key={line.id} style={kpiCard(lineColors[idx % lineColors.length])}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12 }}>{line.name}</span>
              {getLine4MCount(line.name) > 0 && (
                <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 7px', borderRadius: 10, fontSize: 10 }}>
                  🚨 {getLine4MCount(line.name)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-display)', margin: '8px 0' }}>
              {getLineCount(line.name)}<span style={{ fontSize: 14, fontWeight: 400 }}> คน</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.9 }}>
              {getLine4MCount(line.name) > 0 ? '⚠️ Risk / Change' : '✅ Normal'}
            </div>
          </div>
        ))}
      </motion.div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, borderBottom: '1px solid var(--border)', paddingBottom: 10, fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text)' }}>
            👥 สรุปรายชื่อพนักงาน
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div>
              <h4 style={{ color: 'var(--green)', fontSize: 13, margin: '0 0 8px' }}>✓ มาทำงาน ({totalPresent})</h4>
              <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {summaryData.filter(d => d.is_present).map(emp => (
                  <div key={emp.id} style={nameTag('var(--green)')}>
                    {emp.employees.name}
                    <small style={{ color: 'var(--muted)', marginLeft: 4 }}>({emp.assigned_line ? 'In-Line' : 'Pool'})</small>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 style={{ color: 'var(--red)', fontSize: 13, margin: '0 0 8px' }}>✗ ขาดงาน ({totalAbsent})</h4>
              <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {summaryData.filter(d => !d.is_present).map(emp => (
                  <div key={emp.id} style={nameTag('var(--red)')}>
                    {emp.employees.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent)', borderBottom: '1px solid var(--border)', paddingBottom: 10, fontFamily: 'var(--font-display)', fontSize: 15 }}>
            🚩 4M Change Logs
          </h3>
          <div style={{ maxHeight: 440, overflowY: 'auto' }}>
            {fourMLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)', fontSize: 13 }}>
                ไม่มีการแจ้งเตือน 4M
              </div>
            ) : (
              fourMLogs.map(log => (
                <div key={log.id} style={logItem(log.category)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                    <span style={{ color: 'var(--text2)' }}>{log.line_name}</span>
                    <span style={{ color: getCategoryColor(log.category) }}>{log.category}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{log.description}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const kpiCard = (bg) => ({
  background: bg, color: '#fff', padding: '16px 18px', borderRadius: 12,
  boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
});

const nameTag = (borderColor) => ({
  padding: '7px 11px', background: 'var(--bg3)', borderRadius: 6,
  fontSize: 13, borderLeft: `3px solid ${borderColor}`, color: 'var(--text)'
});

const logItem = (cat) => ({
  padding: 12, marginBottom: 8, borderRadius: 8,
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderLeft: `4px solid ${getCategoryColor(cat)}`
});

const getCategoryColor = (cat) => {
  if (!cat) return 'var(--muted)';
  if (cat.includes('Man')) return 'var(--blue)';
  if (cat.includes('Machine')) return 'var(--amber)';
  if (cat.includes('Material')) return '#9b59b6';
  return 'var(--green)';
};
