import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [summaryData, setSummaryData] = useState([]);
  const [fourMLogs, setFourMLogs] = useState([]);
  const [workstations, setWorkstations] = useState([]);
  const [lines, setLines] = useState([]);

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
  const totalAbsent = summaryData.filter(d => !d.is_present).length;

  const getLineCount = (lineName) => {
    const stationIds = workstations.filter(s => s.line_name === lineName).map(s => String(s.id));
    return summaryData.filter(d => d.assigned_line && stationIds.includes(String(d.assigned_line))).length;
  };

  const getLine4MCount = (lineName) => fourMLogs.filter(log => log.line_name === lineName).length;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
  };
  const itemVariants = {
    hidden: { y: 15, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  const lineColors = ['#27ae60', '#2980b9', '#8e44ad', '#f39c12', '#e74c3c', '#1abc9c'];

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <motion.h2 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} style={{ color: '#2c3e50', margin: 0 }}>
          📊 Production Executive Summary
        </motion.h2>
        <div style={{ backgroundColor: 'white', padding: '10px 15px', borderRadius: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <label style={{ fontWeight: 'bold', marginRight: '10px' }}>📅 วันที่:</label>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            style={{ border: 'none', outline: 'none', fontSize: '16px', color: '#3498db', fontWeight: 'bold' }} />
        </div>
      </div>

      <motion.div variants={containerVariants} initial="hidden" animate="visible"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '25px' }}>
        <motion.div variants={itemVariants} style={cardStyle('#34495e')}>
          <div style={{ fontSize: '14px', opacity: 0.8 }}>พนักงานทั้งหมด</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summaryData.length} <span style={{ fontSize: '16px' }}>คน</span></div>
          <div style={{ fontSize: '12px', marginTop: '5px' }}>ขาด: {totalAbsent} | มา: {totalPresent}</div>
        </motion.div>

        {lines.map((line, idx) => (
          <motion.div key={line.id} variants={itemVariants} style={cardStyle(lineColors[idx % lineColors.length])}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '14px' }}>{line.name}</span>
              {getLine4MCount(line.name) > 0 && (
                <span style={{ backgroundColor: '#e74c3c', padding: '2px 8px', borderRadius: '10px', fontSize: '10px' }}>
                  🚨 {getLine4MCount(line.name)} Change
                </span>
              )}
            </div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', margin: '10px 0' }}>
              {getLineCount(line.name)} <span style={{ fontSize: '16px' }}>คน</span>
            </div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>
              สถานะ: {getLine4MCount(line.name) > 0 ? 'Risk / Change' : 'Normal'}
            </div>
          </motion.div>
        ))}
      </motion.div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} style={sectionStyle}>
          <h3 style={{ marginTop: 0, borderBottom: '2px solid #eee', paddingBottom: '10px' }}>👥 สรุปรายชื่อพนักงาน</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div>
              <h4 style={{ color: '#27ae60', fontSize: '14px' }}>✓ มาทำงาน ({totalPresent})</h4>
              <div style={listContainer}>
                {summaryData.filter(d => d.is_present).map(emp => (
                  <div key={emp.id} style={nameTag}>
                    {emp.employees.name} <small>({emp.assigned_line ? 'In-Line' : 'Pool'})</small>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 style={{ color: '#e74c3c', fontSize: '14px' }}>✗ ขาดงาน ({totalAbsent})</h4>
              <div style={listContainer}>
                {summaryData.filter(d => !d.is_present).map(emp => (
                  <div key={emp.id} style={{ ...nameTag, borderLeft: '3px solid #e74c3c' }}>
                    {emp.employees.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} style={sectionStyle}>
          <h3 style={{ marginTop: 0, color: '#c0392b', borderBottom: '2px solid #f9ebea', paddingBottom: '10px' }}>🚩 4M Change Logs</h3>
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {fourMLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#bdc3c7' }}>ไม่มีการแจ้งเตือน 4M</div>
            ) : (
              fourMLogs.map(log => (
                <div key={log.id} style={logItemStyle(log.category)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 'bold' }}>
                    <span>{log.line_name}</span>
                    <span>{log.category}</span>
                  </div>
                  <div style={{ fontSize: '14px', marginTop: '5px' }}>{log.description}</div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

const cardStyle = (bgColor) => ({
  backgroundColor: bgColor, color: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
});
const sectionStyle = {
  backgroundColor: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', minHeight: '400px'
};
const listContainer = {
  maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px'
};
const nameTag = {
  padding: '8px 12px', backgroundColor: '#f8f9fa', borderRadius: '5px', fontSize: '13px', borderLeft: '3px solid #27ae60'
};
const logItemStyle = (cat) => ({
  padding: '12px', marginBottom: '10px', borderRadius: '8px', backgroundColor: '#fff', border: '1px solid #eee',
  borderLeft: `5px solid ${getCategoryColor(cat)}`, boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
});
const getCategoryColor = (cat) => {
  if (!cat) return '#7f8c8d';
  if (cat.includes('Man')) return '#3498db';
  if (cat.includes('Machine')) return '#f39c12';
  if (cat.includes('Material')) return '#9b59b6';
  return '#2ecc71';
};
