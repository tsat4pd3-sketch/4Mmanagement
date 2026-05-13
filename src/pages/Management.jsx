import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function Management() {
  const [workers, setWorkers] = useState([]);
  const [fourMLogs, setFourMLogs] = useState([]);
  const [dynamicStations, setDynamicStations] = useState([]);
  const [lineLayout, setLineLayout] = useState(null);
  const [draggingWorker, setDraggingWorker] = useState(null);
  const [selectedLine, setSelectedLine] = useState('');
  const [lines, setLines] = useState([]);
  const [show4MModal, setShow4MModal] = useState(null);
  const [log4MForm, setLog4MForm] = useState({ category: 'Man', description: '' });

  useEffect(() => {
    const fetchLines = async () => {
      const { data } = await supabase.from('production_lines').select('id, name').order('name');
      setLines(data || []);
      if (data?.length > 0) setSelectedLine(data[0].name);
    };
    fetchLines();
  }, []);

  useEffect(() => {
    if (!selectedLine) return;
    fetchData();
    fetchSetup();
  }, [selectedLine]);

  const fetchSetup = async () => {
    const { data: layoutData } = await supabase.from('line_layouts').select('image_url').eq('line_name', selectedLine).single();
    setLineLayout(layoutData?.image_url || null);
    const { data: stationData } = await supabase.from('workstations').select('*').eq('line_name', selectedLine);
    setDynamicStations(stationData || []);
  };

  const fetchData = async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data: workerData } = await supabase
      .from('daily_production_logs')
      .select(`id, assigned_line, employees ( employee_id_code, name, image_url, skill_welding, skill_spot_nut, skill_quality_check, skill_refill_part, skill_management )`)
      .eq('work_date', today).eq('is_present', true).eq('has_helmet', true).eq('has_boots', true).eq('has_gloves', true);
    const { data: mData } = await supabase.from('four_m_logs').select('*').eq('work_date', today);
    setWorkers(workerData || []);
    setFourMLogs(mData || []);
  };

  const handleSave4MLog = async () => {
    if (!log4MForm.description.trim()) return alert('กรุณาระบุรายละเอียด');
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase.from('four_m_logs').insert([{
      work_date: today,
      line_name: show4MModal.lineName,
      category: log4MForm.category,
      description: log4MForm.description
    }]);
    if (error) return alert('Error: ' + error.message);
    setShow4MModal(null);
    setLog4MForm({ category: 'Man', description: '' });
    fetchData();
  };

  const handleDragStart = (e, worker) => {
    e.dataTransfer.setData('logId', worker.id);
    setDraggingWorker(worker);
  };

  const handleDrop = async (e, stationId) => {
    e.preventDefault();
    const logId = e.dataTransfer.getData('logId');
    const finalAssign = stationId === 'Pool' ? null : stationId;
    setWorkers(prev => prev.map(w => w.id === logId ? { ...w, assigned_line: finalAssign } : w));
    setDraggingWorker(null);
    await supabase.from('daily_production_logs').update({ assigned_line: finalAssign }).eq('id', logId);
  };

  const WorkerCard = ({ worker, isInLayout = false }) => {
    let isLowSkill = false;
    let missingSkills = [];
    if (isInLayout) {
      const station = dynamicStations.find(s => String(s.id) === String(worker.assigned_line));
      if (station) {
        station.required_skill_field.split(',').forEach(skillKey => {
          const score = Number(worker.employees[skillKey.trim()] || 0);
          if (score < station.min_skill_score) { isLowSkill = true; missingSkills.push(skillKey); }
        });
      }
    }
    return (
      <div draggable onDragStart={(e) => handleDragStart(e, worker)}
        title={isLowSkill ? `ขาดทักษะ: ${missingSkills.join(', ')}` : 'ผ่านเกณฑ์'}
        style={{
          padding: '2px 4px', backgroundColor: isLowSkill ? '#fff5f5' : 'white',
          border: isLowSkill ? '2px solid #e74c3c' : '1.5px solid #27ae60',
          borderRadius: '5px', cursor: 'grab', display: 'flex', alignItems: 'center', gap: '4px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)', width: isInLayout ? '65px' : 'auto',
          zIndex: 50, userSelect: 'none'
        }}>
        <img src={worker.employees.image_url || 'https://via.placeholder.com/50'} style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none' }} />
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
          <div style={{ fontWeight: 'bold', fontSize: '7px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {worker.employees.name.split(' ')[0]}
          </div>
          {isInLayout && <div style={{ fontSize: '6px', color: isLowSkill ? '#e74c3c' : '#27ae60' }}>{isLowSkill ? '⚠️ Gap' : '✅ OK'}</div>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: 'calc(100vh - 80px)', backgroundColor: '#f0f2f5', overflow: 'hidden' }}>

      {/* Pool */}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, 'Pool')}
        style={{ width: '220px', backgroundColor: '#fff', borderRight: '1px solid #ddd', padding: '15px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>🔵 พร้อมทำงาน</h3>
          <select value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)} style={{ padding: '4px', borderRadius: '5px', fontSize: '12px' }}>
            {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {workers.filter(w => !w.assigned_line).map(w => <WorkerCard key={w.id} worker={w} />)}
          {workers.filter(w => !w.assigned_line).length === 0 && (
            <div style={{ color: '#bdc3c7', fontSize: '12px', textAlign: 'center', padding: '20px' }}>ไม่มีพนักงานใน Pool</div>
          )}
        </div>
      </div>

      {/* Layout */}
      <div style={{ flex: 1, position: 'relative', padding: '10px', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          position: 'relative', width: '100%', maxWidth: '1200px', height: '100%',
          backgroundImage: lineLayout ? `url('${lineLayout}')` : 'none',
          backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
          backgroundColor: lineLayout ? 'transparent' : 'white', borderRadius: '15px',
        }}>
          {!lineLayout && <div style={{ textAlign: 'center', marginTop: '20%', color: '#bdc3c7' }}>กรุณาอัปโหลดรูปผังไลน์ที่หน้า Setup</div>}
          {dynamicStations.map(st => {
            const workerAtStation = workers.find(w => String(w.assigned_line) === String(st.id));
            const has4M = fourMLogs.some(m => m.line_name === st.line_name);
            return (
              <div key={st.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, st.id)}
                style={{
                  position: 'absolute', top: st.pos_top, left: st.pos_left, transform: 'translate(-50%, -50%)',
                  width: '75px', minHeight: '30px', border: '1px dashed #bdc3c7', borderRadius: '6px',
                  backgroundColor: 'rgba(255,255,255,0.6)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', padding: '2px', transition: 'all 0.2s'
                }}>
                <div style={{ fontSize: '7px', fontWeight: 'bold', marginBottom: '1px', color: '#7f8c8d', textAlign: 'center', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
                  <span>{st.station_name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShow4MModal({ stationId: st.id, lineName: st.line_name }); }}
                    style={{ background: has4M ? '#e74c3c' : '#95a5a6', border: 'none', borderRadius: '3px', color: 'white', fontSize: '6px', cursor: 'pointer', padding: '1px 3px', lineHeight: 1 }}
                    title="บันทึก 4M Change"
                  >
                    {has4M ? '🚨' : '+4M'}
                  </button>
                </div>
                {workerAtStation ? <WorkerCard worker={workerAtStation} isInLayout={true} /> : <div style={{ color: '#bdc3c7', fontSize: '12px' }}>+</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 4M Log Modal */}
      {show4MModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '30px', width: '420px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ marginTop: 0, color: '#c0392b' }}>🚨 บันทึก 4M Change</h3>
            <p style={{ color: '#888', fontSize: '13px', marginTop: '-10px' }}>ไลน์: {show4MModal.lineName}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={labelStyle}>ประเภทการเปลี่ยนแปลง (4M Category)</label>
                <select value={log4MForm.category} onChange={e => setLog4MForm({ ...log4MForm, category: e.target.value })} style={inputStyle}>
                  <option value="Man">Man — คน / พนักงาน</option>
                  <option value="Machine">Machine — เครื่องจักร</option>
                  <option value="Material">Material — วัสดุ</option>
                  <option value="Method">Method — วิธีการ</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>รายละเอียด</label>
                <textarea
                  value={log4MForm.description}
                  onChange={e => setLog4MForm({ ...log4MForm, description: e.target.value })}
                  placeholder="ระบุรายละเอียดการเปลี่ยนแปลง..."
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button onClick={handleSave4MLog} style={{ flex: 2, padding: '11px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                  บันทึก 4M Log
                </button>
                <button onClick={() => { setShow4MModal(null); setLog4MForm({ category: 'Man', description: '' }); }}
                  style={{ flex: 1, padding: '11px', backgroundColor: '#95a5a6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes blink { 0% {opacity: 1;} 50% {opacity: 0.2;} 100% {opacity: 1;} }
        .blink { animation: blink 1s infinite; color: red; }
      `}</style>
    </div>
  );
}

const labelStyle = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#555' };
const inputStyle = { width: '100%', padding: '9px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' };
