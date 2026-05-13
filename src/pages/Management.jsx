import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function Management() {
  const [workers, setWorkers] = useState([]);
  const [fourMLogs, setFourMLogs] = useState([]);
  const [dynamicStations, setDynamicStations] = useState([]); 
  const [lineLayout, setLineLayout] = useState(null);
  const [draggingWorker, setDraggingWorker] = useState(null);
  const [selectedLine, setSelectedLine] = useState('Line A');

  useEffect(() => {
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
      const station = dynamicStations.find(s => s.id === worker.assigned_line);
      if (station) {
        const requiredSkills = station.required_skill_field.split(',');
        requiredSkills.forEach(skillKey => {
          const score = Number(worker.employees[skillKey.trim()] || 0);
          if (score < station.min_skill_score) {
            isLowSkill = true;
            missingSkills.push(skillKey);
          }
        });
      }
    }

    return (
      <div 
        draggable
        onDragStart={(e) => handleDragStart(e, worker)}
        style={{
          padding: '2px 4px', 
          backgroundColor: isLowSkill ? '#fff5f5' : 'white', 
          border: isLowSkill ? '2px solid #e74c3c' : '1.5px solid #27ae60',
          borderRadius: '5px', 
          cursor: 'grab', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '4px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          width: isInLayout ? '65px' : 'auto', // ขนาดจิ๋วในหน้าผัง
          zIndex: 50,
          userSelect: 'none'
        }}
        title={isLowSkill ? `ขาดทักษะ: ${missingSkills.join(', ')}` : 'ผ่านเกณฑ์'}
      >
        <img 
          src={worker.employees.image_url || 'https://via.placeholder.com/50'} 
          style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none' }} 
        />
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
      
      {/* 🔵 ฝั่งซ้าย: Attendance Pool */}
      <div 
        onDragOver={(e) => e.preventDefault()} 
        onDrop={(e) => handleDrop(e, 'Pool')} 
        style={{ width: '220px', backgroundColor: '#fff', borderRight: '1px solid #ddd', padding: '15px', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>🔵 พร้อมทำงาน</h3>
          <select value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)} style={{ padding: '4px', borderRadius: '5px' }}>
            <option>Line A</option><option>Line B</option><option>Line C</option><option>Line D</option>
          </select>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {workers.filter(w => !w.assigned_line).map(w => <WorkerCard key={w.id} worker={w} />)}
        </div>
      </div>

      {/* 🏭 ฝั่งขวา: Visual Layout */}
      <div style={{ flex: 1, position: 'relative', padding: '10px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ 
          position: 'relative', 
          width: '100%', 
          maxWidth: '1200px',
          height: '100%',
          backgroundImage: lineLayout ? `url('${lineLayout}')` : 'none',
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          backgroundColor: lineLayout ? 'transparent' : 'white',
          borderRadius: '15px',
        }}>
          {!lineLayout && <div style={{ textAlign: 'center', marginTop: '20%', color: '#bdc3c7' }}>กรุณาอัปโหลดรูปผังไลน์ที่หน้า Setup</div>}
          
          {/* วาดจุด Workstations */}
          {dynamicStations.map(st => {
            const workerAtStation = workers.find(w => w.assigned_line === st.id);
            const has4M = fourMLogs.some(m => m.line_name === st.line_name);

            return (
              <div
                key={st.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, st.id)}
                style={{
                  position: 'absolute',
                  top: st.pos_top,
                  left: st.pos_left,
                  transform: 'translate(-50%, -50%)',
                  width: '75px', // ขนาดกรอบเล็กเท่ากับหน้า Setup (75x30)
                  minHeight: '30px',
                  border: '1px dashed #bdc3c7',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255,255,255,0.6)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '2px',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: '7px', fontWeight: 'bold', marginBottom: '1px', color: '#7f8c8d', textAlign: 'center' }}>
                  {st.station_name} {has4M && <span className="blink" style={{fontSize: '8px'}}>🚨</span>}
                </div>
                
                {workerAtStation ? (
                  <WorkerCard worker={workerAtStation} isInLayout={true} />
                ) : (
                  <div style={{ color: '#bdc3c7', fontSize: '12px' }}>+</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`
        @keyframes blink { 0% {opacity: 1;} 50% {opacity: 0.2;} 100% {opacity: 1;} }
        .blink { animation: blink 1s infinite; color: red; }
      `}</style>
    </div>
  );
}