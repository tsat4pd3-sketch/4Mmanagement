import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const LINE_4M_CATEGORIES = [
  { key: 'Machine',  label: '🔧 Machine',  color: '#f59e0b' },
  { key: 'Material', label: '📦 Material', color: '#8b5cf6' },
  { key: 'Method',   label: '📋 Method',   color: '#22c55e' },
];

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
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

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

  const openLineLevelModal = (category) => {
    setLog4MForm({ category, description: '' });
    setShow4MModal({ stationId: null, lineName: selectedLine });
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
          const score = Number(worker.employees?.[skillKey.trim()] || 0);
          if (score < station.min_skill_score) { isLowSkill = true; missingSkills.push(skillKey); }
        });
      }
    }

    /* ---- Pool card: vertical, narrow, tall ---- */
    if (!isInLayout) {
      return (
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, worker)}
          title={worker.employees?.name ?? '?'}
          style={{
            width: 60,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 4, padding: '8px 4px',
            backgroundColor: 'rgba(34,197,94,0.1)',
            border: '1.5px solid #27ae60',
            borderRadius: 8, cursor: 'grab',
            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            userSelect: 'none', flexShrink: 0,
          }}
        >
          <img
            src={worker.employees?.image_url || ''}
            style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none' }}
          />
          <div style={{
            fontSize: 9, fontWeight: 700, color: '#fff',
            textAlign: 'center', width: '100%',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            pointerEvents: 'none',
          }}>
            {worker.employees?.name?.split(' ')[0] ?? '?'}
          </div>
        </div>
      );
    }

    /* ---- Layout card: horizontal, compact ---- */
    return (
      <div
        draggable
        onDragStart={(e) => handleDragStart(e, worker)}
        title={isLowSkill ? `ขาดทักษะ: ${missingSkills.join(', ')}` : 'ผ่านเกณฑ์'}
        style={{
          padding: '3px 5px',
          backgroundColor: isLowSkill ? 'rgba(231,76,60,0.2)' : 'rgba(34,197,94,0.15)',
          border: isLowSkill ? '2px solid #e74c3c' : '1.5px solid #27ae60',
          borderRadius: 5, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 4,
          boxShadow: '0 2px 4px rgba(0,0,0,0.4)', width: '88px',
          zIndex: 50, userSelect: 'none',
        }}
      >
        <img
          src={worker.employees?.image_url || ''}
          style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
          <div style={{ fontWeight: 700, fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#fff' }}>
            {worker.employees?.name?.split(' ')[0] ?? '?'}
          </div>
          <div style={{ fontSize: 8, color: isLowSkill ? '#e74c3c' : '#27ae60' }}>
            {isLowSkill ? '⚠️ Gap' : '✅ OK'}
          </div>
        </div>
      </div>
    );
  };

  const poolStyle = isMobile
    ? { width: '100%', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', flexShrink: 0 }
    : { width: 220, background: 'var(--bg2)', borderRight: '1px solid var(--border)', padding: 15, display: 'flex', flexDirection: 'column', flexShrink: 0 };

  const poolInnerStyle = isMobile
    ? { display: 'flex', flexDirection: 'row', gap: 6, overflowX: 'auto', paddingBottom: 4, minHeight: 42 }
    : { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', width: '100%', height: 'calc(100vh - 80px)', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ---- Left Panel: Pool + Line-level 4M controls ---- */}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, 'Pool')} style={poolStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMobile ? 8 : 14, flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: isMobile ? 14 : 15, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            🔵 พร้อมทำงาน
          </h3>
          <select
            value={selectedLine}
            onChange={(e) => setSelectedLine(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', width: 'auto' }}
          >
            {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </div>

        <div style={poolInnerStyle}>
          {workers.filter(w => !w.assigned_line).map(w => <WorkerCard key={w.id} worker={w} />)}
          {workers.filter(w => !w.assigned_line).length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: '10px 20px', width: '100%' }}>ไม่มีพนักงานใน Pool</div>
          )}
        </div>

        {/* Line-level 4M Change Management */}
        {!isMobile && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              4M การเปลี่ยนแปลงไลน์
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {LINE_4M_CATEGORIES.map(cat => {
                const hasLog = fourMLogs.some(m => m.line_name === selectedLine && m.category === cat.key);
                return (
                  <button
                    key={cat.key}
                    onClick={() => openLineLevelModal(cat.key)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 10px', borderRadius: 7, cursor: 'pointer',
                      background: hasLog ? `${cat.color}22` : 'var(--bg3)',
                      border: hasLog ? `1.5px solid ${cat.color}` : '1px solid var(--border2)',
                      color: hasLog ? cat.color : 'var(--text2)',
                      fontSize: 12, fontWeight: 600, transition: 'all 0.15s'
                    }}
                  >
                    <span>{cat.label}</span>
                    {hasLog && <span style={{ fontSize: 10, background: cat.color, color: '#000', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ---- Factory Floor Map ---- */}
      <div style={{ flex: 1, position: 'relative', padding: 10, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
        <div style={{
          position: 'relative', width: '100%', maxWidth: 1200,
          height: '100%',
          backgroundImage: lineLayout ? `url('${lineLayout}')` : 'none',
          backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
          backgroundColor: lineLayout ? 'transparent' : 'var(--bg3)', borderRadius: 12,
          border: lineLayout ? 'none' : '1px solid var(--border)',
        }}>
          {!lineLayout && (
            <div style={{ textAlign: 'center', marginTop: '20%', color: 'var(--muted)', fontSize: 14 }}>
              กรุณาอัปโหลดรูปผังไลน์ที่หน้า Setup
            </div>
          )}
          {dynamicStations.map(st => {
            const workerAtStation = workers.find(w => String(w.assigned_line) === String(st.id));
            const has4M = fourMLogs.some(m => m.line_name === st.line_name);
            const has4MCategories = {
              Machine:  fourMLogs.some(m => m.line_name === st.line_name && m.category === 'Machine'),
              Material: fourMLogs.some(m => m.line_name === st.line_name && m.category === 'Material'),
              Method:   fourMLogs.some(m => m.line_name === st.line_name && m.category === 'Method'),
            };
            return (
              <div
                key={st.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, st.id)}
                style={{
                  position: 'absolute', top: st.pos_top, left: st.pos_left, transform: 'translate(-50%, -50%)',
                  width: 100, minHeight: 50,
                  border: has4M ? '2px solid #e74c3c' : '2px solid rgba(255,255,255,0.75)',
                  borderRadius: 7,
                  backgroundColor: 'rgba(0,0,0,0.82)',
                  backdropFilter: 'blur(2px)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'flex-start', padding: '3px 3px 3px 3px',
                  transition: 'all 0.2s',
                  boxShadow: has4M ? '0 0 8px rgba(231,76,60,0.6)' : '0 2px 6px rgba(0,0,0,0.6)',
                }}
              >
                <div style={{
                  fontSize: 9, fontWeight: 700, color: '#fff', textAlign: 'center',
                  width: '100%', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '0 2px', marginBottom: 2,
                  borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: 2,
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 62 }}>{st.station_name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setLog4MForm({ category: 'Man', description: '' }); setShow4MModal({ stationId: st.id, lineName: st.line_name }); }}
                    style={{
                      background: has4M ? '#e74c3c' : 'rgba(255,255,255,0.15)',
                      border: 'none', borderRadius: 3, color: '#fff',
                      fontSize: 7, cursor: 'pointer', padding: '2px 4px', lineHeight: 1,
                      flexShrink: 0,
                    }}
                    title="บันทึก 4M Change"
                  >
                    {has4M ? '🚨' : '+4M'}
                  </button>
                </div>

                {(has4MCategories.Machine || has4MCategories.Material || has4MCategories.Method) && (
                  <div style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
                    {has4MCategories.Machine  && <span style={{ fontSize: 6, background: '#f59e0b', color: '#000', borderRadius: 3, padding: '1px 3px', fontWeight: 700 }}>M/C</span>}
                    {has4MCategories.Material && <span style={{ fontSize: 6, background: '#8b5cf6', color: '#fff', borderRadius: 3, padding: '1px 3px', fontWeight: 700 }}>MAT</span>}
                    {has4MCategories.Method   && <span style={{ fontSize: 6, background: '#22c55e', color: '#000', borderRadius: 3, padding: '1px 3px', fontWeight: 700 }}>MTD</span>}
                  </div>
                )}

                {workerAtStation
                  ? <WorkerCard worker={workerAtStation} isInLayout={true} />
                  : <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 18, lineHeight: 1, marginTop: 2 }}>+</div>
                }
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- 4M Modal ---- */}
      {show4MModal && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(420px, 94vw)' }}>
            <h3 style={{ marginTop: 0, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>🚨 บันทึก 4M Change</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -10 }}>ไลน์: {show4MModal.lineName}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelSt}>ประเภทการเปลี่ยนแปลง</label>
                <select value={log4MForm.category} onChange={e => setLog4MForm({ ...log4MForm, category: e.target.value })}>
                  <option value="Man">Man — คน / พนักงาน</option>
                  <option value="Machine">Machine — เครื่องจักร</option>
                  <option value="Material">Material — วัสดุ</option>
                  <option value="Method">Method — วิธีการ</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>รายละเอียด</label>
                <textarea
                  value={log4MForm.description}
                  onChange={e => setLog4MForm({ ...log4MForm, description: e.target.value })}
                  placeholder="ระบุรายละเอียดการเปลี่ยนแปลง..."
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  onClick={handleSave4MLog}
                  style={{ flex: 2, padding: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)' }}
                >
                  บันทึก 4M Log
                </button>
                <button
                  onClick={() => { setShow4MModal(null); setLog4MForm({ category: 'Man', description: '' }); }}
                  style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8 }}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.04em', textTransform: 'uppercase'
};
