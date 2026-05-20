import { useState, useEffect, useContext, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

const CARD_W = 82;
const LINE_4M_CATEGORIES = ['Machine', 'Material', 'Method'];
const SPECIAL_TASKS = ['5ส', 'คัดงาน', 'แก้ไขปัญหาคุณภาพ', 'งานปรับปรุงไลน์', 'อื่นๆ'];

const fitColor = (score) => {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#84cc16';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
};
const fitLabel = (score) => {
  if (score >= 80) return 'ชำนาญ';
  if (score >= 60) return 'ผ่านเกณฑ์';
  if (score >= 40) return 'กำลังพัฒนา';
  return 'ต่ำกว่าเกณฑ์';
};

export default function Management() {
  const { role, lineId: userLineId, team: userTeam } = useContext(UserContext);
  const isLeader = role === 'leader';

  const [workers,        setWorkers]        = useState([]);
  const [fourMLogs,      setFourMLogs]      = useState([]);
  const [dynamicStations,setDynamicStations]= useState([]);
  const [lineLayout,     setLineLayout]     = useState(null);
  const [draggingWorker, setDraggingWorker] = useState(null);
  const [selectedLine,   setSelectedLine]   = useState('');
  const [lines,          setLines]          = useState([]);
  const [show4MModal,    setShow4MModal]    = useState(null);
  const [log4MForm,      setLog4MForm]      = useState({ category: 'Man', description: '', sameDept: false, skillOk: false, subtype: 'change' });
  const [isMobile,       setIsMobile]       = useState(window.innerWidth <= 768);
  const [autoManAlert,   setAutoManAlert]   = useState(null);
  const [skillDefs,      setSkillDefs]      = useState([]);
  const [dragOverStation,setDragOverStation]= useState(null);
  const [fitPopup,       setFitPopup]       = useState(null);
  const [hoverCard,      setHoverCard]      = useState(null);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [detailSheet,    setDetailSheet]    = useState(null);
  const [stationModal,   setStationModal]   = useState(null);
  const [homePositions,  setHomePositions]  = useState({});
  const [isSaving4M,     setIsSaving4M]     = useState(false);
  const [specialTasks,   setSpecialTasks]   = useState([]);
  const [specialModal,   setSpecialModal]   = useState(null); // worker to assign
  const [specialTaskType,setSpecialTaskType]= useState('5ส');
  const hoverTimer = useRef(null);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    supabase.from('skill_definitions').select('*').order('sort_order').then(({ data }) => setSkillDefs(data || []));
    const fetchLines = async () => {
      let q = supabase.from('production_lines').select('id, name').order('name');
      if (isLeader && userLineId) q = q.eq('id', userLineId);
      const { data } = await q;
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
    const { data: stationData } = await supabase.from('workstations').select('*, station_requirements(*)').eq('line_name', selectedLine);
    setDynamicStations(stationData || []);
  };

  const fetchData = async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data: workerData } = await supabase
      .from('daily_production_logs')
      .select('id, assigned_line, employee_id, employees(id, employee_id_code, name, image_url, team, section, line_id, employee_skills(skill_name, score))')
      .eq('work_date', today).eq('is_present', true).eq('has_helmet', true).eq('has_boots', true).eq('has_gloves', true);
    const { data: mData } = await supabase.from('four_m_logs').select('*').eq('work_date', today);
    const { data: homeData } = await supabase.from('employee_home_positions').select('employee_id, station_id');
    const { data: stData } = await supabase.from('operator_special_tasks').select('*').eq('work_date', today);
    setWorkers(workerData || []);
    setFourMLogs(mData || []);
    setSpecialTasks(stData || []);
    const hpMap = {};
    (homeData || []).forEach(h => { hpMap[h.employee_id] = String(h.station_id); });
    setHomePositions(hpMap);
  };

  const computeFit = (worker, station) => {
    const reqs = station.station_requirements || [];
    if (reqs.length === 0) return { score: 100, details: [] };
    const skillMap = {};
    (worker.employees?.employee_skills || []).forEach(s => { skillMap[s.skill_name] = s.score; });
    const details = reqs.map(req => {
      const actual = Number(skillMap[req.skill_name] ?? 0);
      const def = skillDefs.find(d => d.name === req.skill_name);
      return { label: def?.label || req.skill_name, color: def?.color || '#4d9fff', required: req.min_score, actual, pass: actual >= req.min_score };
    });
    const passed = details.filter(d => d.pass).length;
    return { score: Math.round((passed / details.length) * 100), details };
  };

  /* ── Assign worker ── shared between drag-drop and touch-tap */
  const assignWorker = async (logId, stationId) => {
    const finalAssign = stationId === 'Pool' ? null : stationId;
    const droppedWorker = workers.find(w => w.id === logId);
    setWorkers(prev => prev.map(w => w.id === logId ? { ...w, assigned_line: finalAssign } : w));
    setSelectedWorker(null);
    await supabase.from('daily_production_logs').update({ assigned_line: finalAssign }).eq('id', logId);
    // ถ้า assign ไปสถานีผลิต → ล้าง special task อัตโนมัติ
    if (finalAssign && droppedWorker?.employee_id) {
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('operator_special_tasks').delete().eq('employee_id', droppedWorker.employee_id).eq('work_date', today);
      setSpecialTasks(prev => prev.filter(t => t.employee_id !== droppedWorker.employee_id));
    }

    if (finalAssign && droppedWorker) {
      const station = dynamicStations.find(s => String(s.id) === String(finalAssign));
      if (station) {
        const fit = computeFit(droppedWorker, station);
        setFitPopup({ worker: droppedWorker, station, fit });
        setTimeout(() => setFitPopup(null), 4500);
        const empId = droppedWorker.employee_id;
        const isHome = empId && homePositions[empId] === String(finalAssign);
        if (!isHome && empId) {
          const today = new Date().toISOString().split('T')[0];
          const { data: history } = await supabase.from('daily_production_logs').select('id')
            .eq('employee_id', empId).eq('assigned_line', String(finalAssign))
            .lt('work_date', today).limit(1);
          if (!history?.length) {
            const desc = `[Auto] ${droppedWorker.employees?.name} ประจำจุด ${station.station_name} เป็นครั้งแรก`;
            const { data: dup } = await supabase.from('four_m_logs')
              .select('id').eq('work_date', today).eq('category', 'Man').eq('description', desc).limit(1);
            if (!dup?.length) {
              const currentLineId = lines.find(l => l.name === station.line_name)?.id;
              const sameDept = droppedWorker.employees?.line_id != null && droppedWorker.employees.line_id === currentLineId;
              const skillPass = fit.details.length === 0 || fit.details.every(d => d.pass);
              const auto_requires_qa = !(sameDept && skillPass);
              await supabase.from('four_m_logs').insert([{ work_date: today, line_name: station.line_name, category: 'Man', description: desc, requires_qa: auto_requires_qa }]);
              setAutoManAlert({ name: droppedWorker.employees?.name, station: station.station_name });
              setTimeout(() => setAutoManAlert(null), 4000);
              fetchData();
            }
          }
        }
      }
    }
  };

  /* ── Drag (desktop) ── */
  const handleDragStart = (e, worker) => { e.dataTransfer.setData('logId', worker.id); setDraggingWorker(worker); };
  const handleDragEnd   = () => { setDraggingWorker(null); setDragOverStation(null); };
  const handleDrop      = (e, stationId) => { e.preventDefault(); assignWorker(e.dataTransfer.getData('logId'), stationId); setDraggingWorker(null); setDragOverStation(null); };

  /* ── Hover (desktop) ── */
  const onHoverEnter = (e, worker, fit = null) => {
    if (isMobile) return;
    clearTimeout(hoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => setHoverCard({ worker, fit, rect }), 180);
  };
  const onHoverLeave = () => { clearTimeout(hoverTimer.current); setHoverCard(null); };

  /* ── Touch tap on pool card ── */
  const handlePoolTap = (worker) => {
    if (!isMobile) return;
    setSelectedWorker(prev => prev?.id === worker.id ? null : worker);
  };

  /* ── Save 4M log ── */
  const handleSave4MLog = async () => {
    if (!log4MForm.description.trim()) { toast.error('กรุณาระบุรายละเอียด'); return; }
    setIsSaving4M(true);
    const today = new Date().toISOString().split('T')[0];
    const isMan = log4MForm.category === 'Man';
    const requires_qa = isMan
      ? !(log4MForm.sameDept && log4MForm.skillOk)
      : log4MForm.subtype === 'change';
    const change_subtype = isMan ? null : log4MForm.subtype;
    const { error } = await supabase.from('four_m_logs').insert([{
      work_date: today,
      line_name: show4MModal.lineName || selectedLine,
      category: log4MForm.category,
      description: log4MForm.description.trim(),
      requires_qa,
      change_subtype,
    }]);
    setIsSaving4M(false);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    setShow4MModal(null);
    setLog4MForm({ category: 'Man', description: '', sameDept: false, skillOk: false, subtype: 'change' });
    fetchData();
  };

  /* ── Station click: open picker modal ── */
  const handleStationClick = (st) => {
    setStationModal(st);
  };

  /* ── Save home position ── */
  const saveHomePosition = async (worker, stationId) => {
    const empId = worker.employee_id || worker.employees?.id;
    if (!empId) return;
    await supabase.from('employee_home_positions').upsert(
      { employee_id: empId, station_id: stationId, line_name: selectedLine, updated_at: new Date().toISOString() },
      { onConflict: 'employee_id' }
    );
    setHomePositions(prev => ({ ...prev, [empId]: String(stationId) }));
  };

  const specialEmpIds = new Set(specialTasks.map(t => t.employee_id));

  const matchesTeam = (w) => {
    if (!isLeader || !userTeam) return true;
    const empTeam = w.employees?.team;
    return empTeam === userTeam || empTeam === 'C';
  };

  const poolWorkers = workers.filter(w => {
    if (w.assigned_line) return false;
    if (specialEmpIds.has(w.employee_id)) return false;
    return matchesTeam(w);
  });

  const specialWorkers = workers.filter(w => {
    if (w.assigned_line) return false;
    if (!specialEmpIds.has(w.employee_id)) return false;
    return matchesTeam(w);
  });

  const assignSpecialTask = async (worker, taskType) => {
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('operator_special_tasks').upsert(
      { employee_id: worker.employee_id, task_type: taskType, work_date: today },
      { onConflict: 'employee_id,work_date' }
    );
    setSpecialModal(null);
    fetchData();
  };

  const removeSpecialTask = async (worker) => {
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('operator_special_tasks').delete()
      .eq('employee_id', worker.employee_id).eq('work_date', today);
    fetchData();
  };

  /* ── Special Pool Card ── */
  const SpecialCard = ({ worker }) => {
    const task = specialTasks.find(t => t.employee_id === worker.employee_id);
    const canDrag = ['admin', 'manager', 'supervisor'].includes(role);
    const isSelected = selectedWorker?.id === worker.id;
    return (
      <div
        draggable={!isMobile && canDrag}
        onDragStart={!isMobile && canDrag ? (e) => handleDragStart(e, worker) : undefined}
        onDragEnd={!isMobile ? handleDragEnd : undefined}
        onClick={() => canDrag && handlePoolTap(worker)}
        style={{
          width: isMobile ? '100%' : CARD_W,
          padding: isMobile ? '10px 8px' : '8px 5px 7px',
          background: isSelected ? 'rgba(245,158,11,0.25)' : 'rgba(245,158,11,0.1)',
          border: isSelected ? '2px solid #f59e0b' : '1.5px solid rgba(245,158,11,0.4)',
          borderRadius: 10,
          cursor: canDrag ? (isMobile ? 'pointer' : 'grab') : 'default',
          display: 'flex', flexDirection: isMobile ? 'row' : 'column', alignItems: 'center',
          gap: isMobile ? 10 : 5, userSelect: 'none', position: 'relative',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        {worker.employees?.image_url
          ? <img src={worker.employees.image_url} style={{ width: isMobile ? 44 : 42, height: isMobile ? 44 : 42, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(245,158,11,0.7)', flexShrink: 0 }} />
          : <div style={{ width: isMobile ? 44 : 42, height: isMobile ? 44 : 42, borderRadius: '50%', background: 'rgba(245,158,11,0.15)', border: '2px solid rgba(245,158,11,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>👤</div>
        }
        <div style={{ flex: isMobile ? 1 : undefined, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 13 : 10, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: isMobile ? 'left' : 'center' }}>
            {isMobile ? (worker.employees?.name ?? '?') : (worker.employees?.name?.split(' ')[0] ?? '?')}
          </div>
          <div style={{ fontSize: isMobile ? 11 : 8, color: '#f59e0b', fontWeight: 700, background: 'rgba(245,158,11,0.15)', borderRadius: 3, padding: isMobile ? '2px 6px' : '1px 4px', marginTop: 2, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 140 : 68, whiteSpace: 'nowrap' }}>
            {task?.task_type || 'งานพิเศษ'}
          </div>
          {worker.employees?.section && (
            <div style={{ fontSize: isMobile ? 10 : 7, color: '#a78bfa', background: 'rgba(167,139,250,0.12)', borderRadius: 3, padding: isMobile ? '1px 6px' : '1px 4px', marginTop: 2, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 140 : 68, whiteSpace: 'nowrap' }}>
              📍 {worker.employees.section}
            </div>
          )}
        </div>
        {/* remove button — leader+ */}
        {['admin','manager','supervisor','leader'].includes(role) && (
          <button onClick={(e) => { e.stopPropagation(); removeSpecialTask(worker); }}
            style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: '50%', background: 'rgba(239,68,68,0.85)', border: 'none', color: '#fff', fontSize: 11, lineHeight: '22px', textAlign: 'center', cursor: 'pointer', padding: 0 }}>
            ✕
          </button>
        )}
      </div>
    );
  };

  /* ── Pool PoolCard component ── */
  const PoolCard = ({ worker }) => {
    const isSelected = selectedWorker?.id === worker.id;
    return (
      <div
        draggable={!isMobile}
        onDragStart={!isMobile ? (e) => handleDragStart(e, worker) : undefined}
        onDragEnd={!isMobile ? handleDragEnd : undefined}
        onMouseEnter={!isMobile ? (e) => onHoverEnter(e, worker) : undefined}
        onMouseLeave={!isMobile ? onHoverLeave : undefined}
        onClick={() => handlePoolTap(worker)}
        style={{
          width: '100%',
          padding: isMobile ? '10px 8px' : '6px 5px 6px',
          background: isSelected ? 'rgba(77,159,255,0.2)' : 'rgba(77,159,255,0.08)',
          border: isSelected ? '2px solid #4d9fff' : '1.5px solid rgba(77,159,255,0.35)',
          borderRadius: 10,
          cursor: isMobile ? 'pointer' : 'grab',
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          gap: isMobile ? 10 : 5,
          boxShadow: isSelected ? '0 0 0 3px rgba(77,159,255,0.3), 0 4px 14px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.35)',
          userSelect: 'none',
          transition: 'all 0.15s',
          transform: isSelected ? 'scale(1.03)' : 'scale(1)',
        }}
      >
        {worker.employees?.image_url
          ? <img src={worker.employees.image_url} style={{ width: isMobile ? 52 : 50, height: isMobile ? 52 : 50, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${isSelected ? '#4d9fff' : 'rgba(77,159,255,0.6)'}`, flexShrink: 0 }} />
          : <div style={{ width: isMobile ? 52 : 50, height: isMobile ? 52 : 50, borderRadius: '50%', background: 'rgba(77,159,255,0.15)', border: '2px solid rgba(77,159,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
        }
        <div style={{ flex: isMobile ? 1 : undefined, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 14 : 10, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: isMobile ? 'left' : 'center' }}>
            {isMobile ? (worker.employees?.name ?? '?') : (worker.employees?.name?.split(' ')[0] ?? '?')}
          </div>
          {isMobile && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{worker.employees?.employee_id_code}</div>}
          {worker.employees?.team && (
            <div style={{ fontSize: isMobile ? 11 : 8, fontWeight: 800, color: '#4d9fff', background: 'rgba(77,159,255,0.15)', borderRadius: 3, padding: isMobile ? '2px 7px' : '1px 5px', marginTop: 3, display: 'inline-block' }}>
              Team {worker.employees.team}
            </div>
          )}
          {worker.employees?.section && (
            <div style={{ fontSize: isMobile ? 11 : 7, color: '#a78bfa', background: 'rgba(167,139,250,0.12)', borderRadius: 3, padding: isMobile ? '2px 7px' : '1px 4px', marginTop: 2, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 160 : 72, whiteSpace: 'nowrap' }}>
              📍 {worker.employees.section}
            </div>
          )}
        </div>
        {isMobile && isSelected && (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#4d9fff', background: 'rgba(77,159,255,0.15)', borderRadius: 6, padding: '4px 8px', flexShrink: 0 }}>เลือกแล้ว ✓</div>
        )}
        {/* assign to special task — leader+ */}
        {['admin','manager','supervisor','leader'].includes(role) && (
          <button onClick={(e) => { e.stopPropagation(); setSpecialModal(worker); setSpecialTaskType('5ส'); }}
            title="กำหนดงานนอกไลน์"
            style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(245,158,11,0.85)', border: 'none', color: '#fff', fontSize: 9, lineHeight: '18px', textAlign: 'center', cursor: 'pointer', padding: 0, display: isMobile ? 'none' : 'block' }}>
            🏷
          </button>
        )}
      </div>
    );
  };

  /* ── Station worker ── */
  const StationWorker = ({ worker, fit }) => {
    const fc = fitColor(fit.score);
    return (
      <div
        draggable={!isMobile}
        onDragStart={!isMobile ? (e) => handleDragStart(e, worker) : undefined}
        onDragEnd={!isMobile ? handleDragEnd : undefined}
        onMouseEnter={!isMobile ? (e) => onHoverEnter(e, worker, fit) : undefined}
        onMouseLeave={!isMobile ? onHoverLeave : undefined}
        style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: isMobile ? 'pointer' : 'grab', userSelect: 'none' }}
      >
        {worker.employees?.image_url
          ? <img src={worker.employees.image_url} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none', border: `3px solid ${fc}`, boxShadow: `0 0 8px ${fc}88`, flexShrink: 0 }} />
          : <div style={{ width: 42, height: 42, borderRadius: '50%', background: `${fc}22`, border: `3px solid ${fc}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>👤</div>
        }
        <div style={{ background: fc, color: '#fff', fontSize: 12, fontWeight: 900, padding: '2px 0', width: 44, textAlign: 'center', borderRadius: 5, boxShadow: `0 1px 5px ${fc}99`, pointerEvents: 'none' }}>
          {fit.score}
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, color: fc, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%', textAlign: 'center', pointerEvents: 'none' }}>
          {worker.employees?.name?.split(' ')[0] ?? '?'}
        </div>
      </div>
    );
  };

  /* ── Layout ── */
  const poolStyle = isMobile
    ? { width: '100%', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '10px 12px', flexShrink: 0, maxHeight: '42vh', display: 'flex', flexDirection: 'column' }
    : { width: 210, background: 'var(--bg2)', borderRight: '1px solid var(--border)', padding: '15px 10px', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', width: '100%', height: 'calc(100vh - 80px)', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── Pool Panel ── */}
      <div style={poolStyle}>
        <div style={{ marginBottom: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>ไลน์ผลิต</div>
          <select value={selectedLine} onChange={(e) => !isLeader && setSelectedLine(e.target.value)} disabled={isLeader}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 13, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', opacity: isLeader ? 0.7 : 1 }}>
            {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </div>

        {/* instruction banner on mobile when worker selected */}
        {isMobile && selectedWorker && (
          <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(77,159,255,0.15)', border: '1px solid rgba(77,159,255,0.4)', fontSize: 12, fontWeight: 600, color: '#4d9fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <span>👆 แตะ station ด้านล่างเพื่อจัดตำแหน่ง</span>
            <button onClick={() => setSelectedWorker(null)} style={{ background: 'none', border: 'none', color: '#4d9fff', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
          </div>
        )}

        <div
          onDragOver={!isMobile ? (e) => e.preventDefault() : undefined}
          onDrop={!isMobile ? (e) => handleDrop(e, 'Pool') : undefined}
          style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 0 }}
        >
          {/* Normal pool — 70% */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🔵 พร้อมทำงาน</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{poolWorkers.length} คน</span>
          </div>
          <div style={{ overflowY: 'auto', display: isMobile ? 'flex' : 'grid', gridTemplateColumns: 'repeat(2, 1fr)', flexDirection: 'column', gap: 6, flex: '7 0 0', minHeight: 0 }}>
            {poolWorkers.map(w => <PoolCard key={w.id} worker={w} />)}
            {poolWorkers.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: '8px 0', gridColumn: '1/-1' }}>ไม่มีพนักงานใน Pool</div>
            )}
          </div>

          {/* Special task pool — 30% */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed rgba(245,158,11,0.4)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', fontFamily: 'var(--font-display)' }}>🟡 งานนอกไลน์</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{specialWorkers.length} คน</span>
            </div>
            {['admin','manager','supervisor'].includes(role) && specialWorkers.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5, fontStyle: 'italic' }}>drag กลับไลน์ผลิตได้</div>
            )}
          </div>
          <div style={{ overflowY: 'auto', display: isMobile ? 'flex' : 'grid', gridTemplateColumns: 'repeat(2, 1fr)', flexDirection: 'column', gap: 6, flex: '3 0 0', minHeight: 0 }}>
            {specialWorkers.map(w => <SpecialCard key={w.id} worker={w} />)}
            {specialWorkers.length === 0 && (
              <div style={{ color: 'rgba(245,158,11,0.5)', fontSize: 10, textAlign: 'center', padding: '6px 0', gridColumn: '1/-1' }}>—</div>
            )}
            {/* mobile: assign button */}
            {isMobile && ['admin','manager','supervisor','leader'].includes(role) && selectedWorker && !specialEmpIds.has(selectedWorker.employee_id) && (
              <button onClick={() => { setSpecialModal(selectedWorker); setSpecialTaskType('5ส'); }}
                style={{ marginTop: 6, padding: '8px', borderRadius: 8, background: 'rgba(245,158,11,0.15)', border: '1px dashed rgba(245,158,11,0.5)', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                🏷 กำหนดงานนอกไลน์ให้ผู้ถูกเลือก
              </button>
            )}
          </div>
        </div>

        {/* 4M buttons — desktop only in sidebar */}
        {selectedLine && !isMobile && (
          <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>บันทึก 4M ไลน์</div>
            {LINE_4M_CATEGORIES.map(cat => (
              <button key={cat} onClick={() => { setShow4MModal({ lineName: selectedLine }); setLog4MForm({ category: cat, description: '' }); }}
                style={{
                  width: '100%', marginBottom: 5, padding: '6px 8px', fontSize: 11, textAlign: 'left', borderRadius: 6, cursor: 'pointer',
                  background: cat === 'Machine' ? 'rgba(245,158,11,0.12)' : cat === 'Material' ? 'rgba(34,197,94,0.12)' : 'rgba(139,92,246,0.12)',
                  color: cat === 'Machine' ? 'var(--amber)' : cat === 'Material' ? 'var(--green)' : '#c084fc',
                  border: `1px solid ${cat === 'Machine' ? 'rgba(245,158,11,0.3)' : cat === 'Material' ? 'rgba(34,197,94,0.3)' : 'rgba(139,92,246,0.3)'}`,
                }}>
                {cat === 'Machine' ? '⚙️' : cat === 'Material' ? '📦' : '📋'} {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Canvas Area ── */}
      <div style={{ flex: 1, position: 'relative', padding: 10, overflow: 'auto' }}>
        {autoManAlert && (
          <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: 'rgba(77,159,255,0.95)', color: '#fff', padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 600, zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>
            🆕 Man Change: {autoManAlert.name} — ประจำ {autoManAlert.station} เป็นครั้งแรก
          </div>
        )}

        <div style={{
          position: 'relative',
          width: isMobile ? 900 : '100%', minWidth: isMobile ? 900 : undefined,
          maxWidth: isMobile ? undefined : 1200,
          height: isMobile ? 600 : '100%', minHeight: isMobile ? 600 : undefined,
          margin: isMobile ? undefined : '0 auto',
          backgroundImage: lineLayout ? `url('${lineLayout}')` : 'none',
          backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
          backgroundColor: lineLayout ? 'transparent' : 'var(--bg3)', borderRadius: 12,
          border: lineLayout ? 'none' : '1px solid var(--border)',
        }}>
          {!lineLayout && (
            <div style={{ textAlign: 'center', marginTop: '20%', color: 'var(--muted)', fontSize: 14 }}>กรุณาอัปโหลดรูปผังไลน์ที่หน้า Setup</div>
          )}

          <style>{`
            @keyframes pulse-ring {
              0%   { box-shadow: 0 0 0 0 rgba(77,159,255,0.6), 0 2px 8px rgba(0,0,0,0.6); }
              70%  { box-shadow: 0 0 0 8px rgba(77,159,255,0), 0 2px 8px rgba(0,0,0,0.6); }
              100% { box-shadow: 0 0 0 0 rgba(77,159,255,0), 0 2px 8px rgba(0,0,0,0.6); }
            }
          `}</style>

          {dynamicStations.map(st => {
            const workerAtStation = workers.find(w => String(w.assigned_line) === String(st.id));
            const workerFit       = workerAtStation ? computeFit(workerAtStation, st) : null;
            const hasMan  = fourMLogs.some(m => m.line_name === st.line_name && m.category === 'Man');
            const has4M   = fourMLogs.some(m => m.line_name === st.line_name && m.category !== 'Man');
            const isOver  = dragOverStation === st.id;
            const previewFit = isOver && draggingWorker ? computeFit(draggingWorker, st) : null;
            const touchPreviewFit = isMobile && selectedWorker && !workerAtStation ? computeFit(selectedWorker, st) : null;
            const activeFc = previewFit ? fitColor(previewFit.score)
                           : touchPreviewFit ? fitColor(touchPreviewFit.score)
                           : (workerFit ? fitColor(workerFit.score) : null);
            const isPulse = isMobile && selectedWorker && !workerAtStation;

            return (
              <div
                key={st.id}
                onDragOver={!isMobile ? (e) => { e.preventDefault(); setDragOverStation(st.id); } : undefined}
                onDragEnter={!isMobile ? (e) => { e.preventDefault(); setDragOverStation(st.id); } : undefined}
                onDragLeave={!isMobile ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverStation(null); } : undefined}
                onDrop={!isMobile ? (e) => handleDrop(e, st.id) : undefined}
                onClick={() => handleStationClick(st)}
                style={{
                  position: 'absolute', top: st.pos_top, left: st.pos_left, transform: 'translate(-50%, -50%)',
                  width: CARD_W,
                  borderTop:    `1px solid ${activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderRight:  `1px solid ${activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderBottom: `1px solid ${activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderLeft:   `4px solid ${activeFc || 'rgba(255,255,255,0.25)'}`,
                  borderRadius: 8,
                  backgroundColor: isOver || isPulse ? `${activeFc || '#4d9fff'}1a` : 'rgba(8,8,14,0.88)',
                  backdropFilter: 'blur(3px)',
                  animation: isPulse ? 'pulse-ring 1.4s ease-in-out infinite' : 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '5px 4px 6px',
                  cursor: isMobile ? 'pointer' : 'default',
                  transition: 'background-color 0.18s, border-color 0.18s',
                  zIndex: isOver ? 20 : 5,
                }}
              >
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: activeFc || '#c8c8d0' }}>
                    {st.station_name}
                  </span>
                  <div style={{ display: 'flex', gap: 1, flexShrink: 0, alignItems: 'center' }}>
                    {workerAtStation?.employee_id && homePositions[workerAtStation.employee_id] === String(st.id) && (
                      <span style={{ fontSize: 8, lineHeight: 1 }} title="ตำแหน่งประจำ">🏠</span>
                    )}
                    {hasMan && <span style={{ background: '#4d9fff', color: '#fff', borderRadius: 2, padding: '0 2px', fontSize: 5, fontWeight: 800 }}>MAN</span>}
                    {has4M  && <span style={{ background: '#e74c3c', color: '#fff', borderRadius: 2, padding: '0 2px', fontSize: 5, fontWeight: 800 }}>4M</span>}
                    {!isMobile && (
                      <button onClick={(e) => { e.stopPropagation(); setShow4MModal({ stationId: st.id, lineName: st.line_name }); setLog4MForm({ category: 'Man', description: '' }); }}
                        style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 2, color: 'white', fontSize: 5, cursor: 'pointer', padding: '1px 2px', lineHeight: 1 }}>+4M</button>
                    )}
                  </div>
                </div>

                {workerAtStation
                  ? <StationWorker worker={workerAtStation} fit={workerFit} />
                  : isPulse
                    ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ fontSize: 18, opacity: 0.7 }}>👆</div>
                        {touchPreviewFit && (
                          <div style={{ background: fitColor(touchPreviewFit.score), color: '#fff', fontSize: 10, fontWeight: 900, padding: '1px 6px', borderRadius: 4 }}>
                            {touchPreviewFit.score}
                          </div>
                        )}
                      </div>
                    )
                    : <div style={{ color: isOver ? activeFc : 'rgba(255,255,255,0.22)', fontSize: 20, lineHeight: '28px' }}>+</div>
                }

                {/* Desktop drag-preview fit popup */}
                {previewFit && !isMobile && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(6,6,12,0.97)', border: `1px solid ${activeFc}`, borderRadius: 8, padding: '8px 10px',
                    zIndex: 100, minWidth: 116, pointerEvents: 'none', boxShadow: `0 4px 24px rgba(0,0,0,0.7)`,
                  }}>
                    <div style={{ textAlign: 'center', marginBottom: 4 }}>
                      <span style={{ display: 'inline-block', background: activeFc, color: '#fff', fontSize: 20, fontWeight: 900, padding: '2px 14px', borderRadius: 5 }}>{previewFit.score}</span>
                    </div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginBottom: 6 }}>{fitLabel(previewFit.score)}</div>
                    {previewFit.details.map(d => (
                      <div key={d.label} style={{ marginBottom: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: d.color, display: 'inline-block' }} />{d.label}
                          </span>
                          <span style={{ fontSize: 8, fontWeight: 800, color: d.pass ? '#22c55e' : '#ef4444', marginLeft: 8 }}>
                            {d.actual}<span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>/{d.required}</span>
                          </span>
                        </div>
                        <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                          <div style={{ position: 'absolute', left: `${d.required}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)', zIndex: 2 }} />
                          <div style={{ width: `${Math.min(d.actual,100)}%`, height: '100%', background: d.pass ? '#22c55e' : '#ef4444', borderRadius: 2 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Mobile FAB 4M ── */}
      {isMobile && selectedLine && (
        <button
          onClick={() => { setShow4MModal({ lineName: selectedLine }); setLog4MForm({ category: 'Man', description: '' }); }}
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 500,
            width: 54, height: 54, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff', border: 'none',
            fontSize: 22, fontWeight: 900, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(227,25,55,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="บันทึก 4M"
        >🚨</button>
      )}

      {/* ── Desktop hover card ── */}
      {!isMobile && hoverCard && <WorkerHoverCard card={hoverCard} skillDefs={skillDefs} />}

      {/* ── Desktop fit popup ── */}
      {!isMobile && fitPopup && <FitPopup fitPopup={fitPopup} onClose={() => setFitPopup(null)} />}

      {/* ── Mobile fit popup (after assign) ── */}
      {isMobile && fitPopup && (
        <div style={{ position: 'fixed', top: 16, left: 16, right: 16, zIndex: 1000, background: 'var(--card)', border: `2px solid ${fitColor(fitPopup.fit.score)}`, borderRadius: 14, padding: '14px 16px', boxShadow: 'var(--shadow-lg)', animation: 'hoverIn 0.25s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={fitPopup.worker.employees?.image_url || ''} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${fitColor(fitPopup.fit.score)}`, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{fitPopup.worker.employees?.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>→ {fitPopup.station.station_name}</div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: fitColor(fitPopup.fit.score), fontFamily: 'var(--font-display)', lineHeight: 1 }}>{fitPopup.fit.score}</div>
            <button onClick={() => setFitPopup(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ marginTop: 6, textAlign: 'center', fontSize: 12, fontWeight: 700, color: fitColor(fitPopup.fit.score) }}>{fitLabel(fitPopup.fit.score)}</div>
        </div>
      )}

      {/* ── Mobile bottom sheet: worker detail ── */}
      {isMobile && detailSheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setDetailSheet(null)} />
          <div style={{ position: 'relative', background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '20px 20px 36px', boxShadow: 'var(--shadow-lg)', animation: 'slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } } @keyframes hoverIn { from { opacity:0; transform:scale(0.93) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
            {/* Handle */}
            <div style={{ width: 36, height: 4, background: 'var(--border2)', borderRadius: 3, margin: '0 auto 16px' }} />

            {/* Worker header */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
              {detailSheet.worker.employees?.image_url
                ? <img src={detailSheet.worker.employees.image_url} style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${fitColor(detailSheet.fit.score)}`, flexShrink: 0 }} />
                : <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>👤</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{detailSheet.worker.employees?.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{detailSheet.worker.employees?.employee_id_code}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {detailSheet.worker.employees?.team && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#4d9fff', background: 'rgba(77,159,255,0.15)', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 5, padding: '2px 8px' }}>Team {detailSheet.worker.employees.team}</span>
                  )}
                  {detailSheet.worker.employees?.section && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', background: 'rgba(167,139,250,0.13)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 5, padding: '2px 8px' }}>
                      📍 สังกัด: {detailSheet.worker.employees.section}
                    </span>
                  )}
                  {detailSheet.stationName && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: fitColor(detailSheet.fit.score), background: `${fitColor(detailSheet.fit.score)}15`, border: `1px solid ${fitColor(detailSheet.fit.score)}40`, borderRadius: 5, padding: '2px 8px' }}>
                      {detailSheet.stationName} · {detailSheet.fit.score}% {fitLabel(detailSheet.fit.score)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Skills */}
            {skillDefs.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>ทักษะ</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {skillDefs.map(sd => {
                    const skills = detailSheet.worker.employees?.employee_skills || [];
                    const score = skills.find(s => s.skill_name === sd.name)?.score ?? 0;
                    const fitReq = detailSheet.fit?.details?.find(d => d.label === sd.label);
                    const bar = fitReq ? (fitReq.pass ? '#22c55e' : '#ef4444') : sd.color;
                    return (
                      <div key={sd.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 13, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: sd.color, display: 'inline-block', flexShrink: 0 }} />{sd.label}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: bar }}>
                            {score}%{fitReq && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>/{fitReq.required}%</span>}
                            {fitReq && <span style={{ marginLeft: 4 }}>{fitReq.pass ? '✓' : '✗'}</span>}
                          </span>
                        </div>
                        <div style={{ height: 6, background: 'var(--border2)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                          {fitReq && <div style={{ position: 'absolute', left: `${fitReq.required}%`, top: 0, bottom: 0, width: 2, background: 'var(--muted)', zIndex: 2 }} />}
                          <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', background: bar, borderRadius: 4, transition: 'width 0.5s ease' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={async () => {
                  await assignWorker(detailSheet.worker.id, 'Pool');
                  setDetailSheet(null);
                }}
                style={{ flex: 1, padding: '13px', background: 'rgba(231,76,60,0.12)', color: 'var(--red)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                ↩ ส่งกลับ Pool
              </button>
              <button
                onClick={() => setDetailSheet(null)}
                style={{ flex: 1, padding: '13px', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Station Picker Modal ── */}
      {stationModal && (() => {
        const st = stationModal;
        const workerHere = workers.find(w => String(w.assigned_line) === String(st.id));
        const fitHere    = workerHere ? computeFit(workerHere, st) : null;
        const sortedPool = poolWorkers
          .map(w => ({ ...w, _fit: computeFit(w, st) }))
          .sort((a, b) => b._fit.score - a._fit.score);
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} onClick={() => setStationModal(null)} />
            <div style={{ position: 'relative', background: 'var(--card)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '20px 18px 36px', boxShadow: 'var(--shadow-lg)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', animation: 'slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)' }}>
              {/* Handle */}
              <div style={{ width: 36, height: 4, background: 'var(--border2)', borderRadius: 3, margin: '0 auto 14px' }} />
              {/* Title */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{st.station_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>เลือกพนักงานประจำจุดนี้</div>
                </div>
                <button onClick={() => setStationModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer' }}>×</button>
              </div>

              {/* Current worker */}
              {workerHere && (
                <div style={{ marginBottom: 12, padding: '10px 12px', background: `${fitColor(fitHere.score)}12`, border: `1px solid ${fitColor(fitHere.score)}40`, borderRadius: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>ประจำอยู่ตอนนี้</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {workerHere.employees?.image_url
                      ? <img src={workerHere.employees.image_url} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${fitColor(fitHere.score)}`, flexShrink: 0 }} />
                      : <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{workerHere.employees?.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{workerHere.employees?.employee_id_code}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <div style={{ background: fitColor(fitHere.score), color: '#fff', fontWeight: 900, fontSize: 18, padding: '2px 10px', borderRadius: 6 }}>{fitHere.score}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {homePositions[workerHere.employee_id] !== String(st.id) && (
                          <button
                            onClick={async () => { await saveHomePosition(workerHere, st.id); }}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.3)', cursor: 'pointer', fontWeight: 700 }}
                            title="บันทึกเป็นตำแหน่งประจำ"
                          >📌 บันทึกตำแหน่งประจำ</button>
                        )}
                        {homePositions[workerHere.employee_id] === String(st.id) && (
                          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontWeight: 700 }}>🏠 ตำแหน่งประจำ</span>
                        )}
                        <button
                          onClick={() => { assignWorker(workerHere.id, 'Pool'); setStationModal(null); }}
                          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(231,76,60,0.1)', color: 'var(--red)', border: '1px solid rgba(231,76,60,0.3)', cursor: 'pointer', fontWeight: 700 }}
                        >↩ Pool</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Pool workers sorted by fit */}
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                พนักงานใน Pool ({sortedPool.length} คน) — เรียงตาม Fit Score
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedPool.length === 0 && (
                  <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>ไม่มีพนักงานใน Pool</div>
                )}
                {sortedPool.map(w => {
                  const fc = fitColor(w._fit.score);
                  const isHome = w.employee_id && homePositions[w.employee_id] === String(st.id);
                  return (
                    <div
                      key={w.id}
                      onClick={() => { assignWorker(w.id, st.id); setStationModal(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: `${fc}0d`, border: `1px solid ${fc}30`, cursor: 'pointer', transition: 'background 0.15s' }}
                    >
                      {w.employees?.image_url
                        ? <img src={w.employees.image_url} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${fc}`, flexShrink: 0 }} />
                        : <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${fc}18`, border: `2px solid ${fc}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>👤</div>
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          {w.employees?.name}
                          {isHome && <span style={{ fontSize: 10 }} title="ตำแหน่งประจำ">🏠</span>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{w.employees?.employee_id_code}{w.employees?.team ? ` · Team ${w.employees.team}` : ''}</div>
                      </div>
                      <div style={{ background: fc, color: '#fff', fontWeight: 900, fontSize: 16, padding: '3px 10px', borderRadius: 6, flexShrink: 0 }}>{w._fit.score}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Special Task Modal ── */}
      {specialModal && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(360px, 94vw)' }}>
            <h3 style={{ marginTop: 0, color: '#f59e0b', fontFamily: 'var(--font-display)' }}>🏷 กำหนดงานนอกไลน์</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -10 }}>{specialModal.employees?.name}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {SPECIAL_TASKS.map(t => (
                <button key={t} onClick={() => setSpecialTaskType(t)}
                  style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, textAlign: 'left', cursor: 'pointer',
                    background: specialTaskType === t ? 'rgba(245,158,11,0.2)' : 'var(--bg3)',
                    border: specialTaskType === t ? '2px solid #f59e0b' : '1.5px solid var(--border2)',
                    color: specialTaskType === t ? '#f59e0b' : 'var(--text2)' }}>
                  {specialTaskType === t ? '✓ ' : ''}{t}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => assignSpecialTask(specialModal, specialTaskType)}
                style={{ flex: 2, padding: 12, background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                ยืนยัน
              </button>
              <button onClick={() => setSpecialModal(null)}
                style={{ flex: 1, padding: 12, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 4M Modal ── */}
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
              {/* Man: same-dept + skill checkboxes */}
              {log4MForm.category === 'Man' && (
                <div style={{ background: 'rgba(77,159,255,0.07)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>เงื่อนไขการอนุมัติ</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={log4MForm.sameDept} onChange={e => setLog4MForm({ ...log4MForm, sameDept: e.target.checked })} style={{ width: 16, height: 16 }} />
                    เปลี่ยนในหน่วยงาน / สังกัดเดียวกัน
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={log4MForm.skillOk} onChange={e => setLog4MForm({ ...log4MForm, skillOk: e.target.checked })} style={{ width: 16, height: 16 }} />
                    ทักษะผ่านเกณฑ์ที่กำหนด
                  </label>
                  <div style={{ fontSize: 11, marginTop: 2, padding: '5px 8px', borderRadius: 6,
                    background: (log4MForm.sameDept && log4MForm.skillOk) ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.1)',
                    color: (log4MForm.sameDept && log4MForm.skillOk) ? '#22c55e' : '#ef4444' }}>
                    {(log4MForm.sameDept && log4MForm.skillOk)
                      ? '✅ ระดับ: ไม่รุนแรง — หัวหน้างานอนุมัติได้'
                      : '🔴 ระดับ: รุนแรง — ต้องผ่าน QA'}
                  </div>
                </div>
              )}
              {/* Machine/Material/Method: replace vs change */}
              {log4MForm.category !== 'Man' && (
                <div style={{ background: 'rgba(245,158,11,0.07)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>ลักษณะการเปลี่ยนแปลง</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[{ v: 'replace', label: '🔄 Replace', desc: 'สลับ / ทดแทน' }, { v: 'change', label: '⚠️ Change', desc: 'เปลี่ยนแปลง' }].map(opt => (
                      <label key={opt.v} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 6px', borderRadius: 7, cursor: 'pointer',
                        border: `2px solid ${log4MForm.subtype === opt.v ? (opt.v === 'replace' ? '#22c55e' : '#ef4444') : 'var(--border2)'}`,
                        background: log4MForm.subtype === opt.v ? (opt.v === 'replace' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)') : 'transparent' }}>
                        <input type="radio" name="subtype" value={opt.v} checked={log4MForm.subtype === opt.v} onChange={() => setLog4MForm({ ...log4MForm, subtype: opt.v })} style={{ display: 'none' }} />
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{opt.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{opt.desc}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2, padding: '5px 8px', borderRadius: 6,
                    background: log4MForm.subtype === 'replace' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.1)',
                    color: log4MForm.subtype === 'replace' ? '#22c55e' : '#ef4444' }}>
                    {log4MForm.subtype === 'replace'
                      ? '✅ ระดับ: ไม่รุนแรง — หัวหน้างานอนุมัติได้'
                      : '🔴 ระดับ: รุนแรง — ต้องผ่าน QA'}
                  </div>
                </div>
              )}
              <div>
                <label style={labelSt}>รายละเอียด</label>
                <textarea value={log4MForm.description} onChange={e => setLog4MForm({ ...log4MForm, description: e.target.value })}
                  placeholder="ระบุรายละเอียดการเปลี่ยนแปลง..." rows={3} style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={handleSave4MLog} disabled={isSaving4M} style={{ flex: 2, padding: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 15, opacity: isSaving4M ? 0.6 : 1, cursor: isSaving4M ? 'not-allowed' : 'pointer' }}>
                  {isSaving4M ? 'กำลังบันทึก...' : 'บันทึก 4M Log'}
                </button>
                <button onClick={() => { if (!isSaving4M) { setShow4MModal(null); setLog4MForm({ category: 'Man', description: '' }); } }}
                  style={{ flex: 1, padding: 12, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: isSaving4M ? 'not-allowed' : 'pointer' }}>
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

/* ── Desktop hover tooltip ── */
function WorkerHoverCard({ card, skillDefs }) {
  const { worker, fit, rect } = card;
  const emp = worker.employees;
  const skills = emp?.employee_skills || [];
  const tooltipW = 230;
  const gap = 10;
  let left = rect.right + gap;
  if (left + tooltipW > window.innerWidth - 12) left = rect.left - tooltipW - gap;
  const top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - 340));

  return (
    <div style={{ position: 'fixed', top, left, width: tooltipW, zIndex: 3000, pointerEvents: 'none', background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: '14px 14px 12px', animation: 'hoverIn 0.18s ease' }}>
      <style>{`@keyframes hoverIn { from { opacity:0; transform:scale(0.93) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        {emp?.image_url
          ? <img src={emp.image_url} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border2)', flexShrink: 0 }} />
          : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>👤</div>
        }
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>{emp?.name || '—'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{emp?.employee_id_code || ''}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {emp?.team && <span style={{ fontSize: 9, fontWeight: 800, background: 'rgba(77,159,255,0.15)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 4, padding: '1px 5px' }}>Team {emp.team}</span>}
            {emp?.section && <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(167,139,250,0.13)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 4, padding: '1px 5px' }}>📍 {emp.section}</span>}
          </div>
        </div>
      </div>
      {fit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, background: `${fitColor(fit.score)}15`, border: `1px solid ${fitColor(fit.score)}40`, borderRadius: 8, padding: '6px 10px' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: fitColor(fit.score), fontFamily: 'var(--font-display)', lineHeight: 1 }}>{fit.score}</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: fitColor(fit.score) }}>{fitLabel(fit.score)}</div>
            <div style={{ fontSize: 9, color: 'var(--muted)' }}>Fit Score</div>
          </div>
        </div>
      )}
      {skillDefs.length > 0 && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>ทักษะ</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {skillDefs.map(sd => {
              const score = skills.find(s => s.skill_name === sd.name)?.score ?? 0;
              const fitReq = fit?.details?.find(d => d.label === sd.label);
              const bar = fitReq ? (fitReq.pass ? '#22c55e' : '#ef4444') : sd.color;
              return (
                <div key={sd.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: sd.color, display: 'inline-block' }} />{sd.label}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: bar }}>{score}%{fitReq && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 9 }}>/{fitReq.required}%</span>}</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--border2)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                    {fitReq && <div style={{ position: 'absolute', left: `${fitReq.required}%`, top: 0, bottom: 0, width: 1.5, background: 'var(--muted)', zIndex: 2 }} />}
                    <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', background: bar, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Desktop fit popup (after drop) ── */
function FitPopup({ fitPopup, onClose }) {
  const fc = fitColor(fitPopup.fit.score);
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'rgba(10,10,18,0.97)', border: `1px solid ${fc}66`, borderLeft: `4px solid ${fc}`, borderRadius: 12, padding: '14px 16px', boxShadow: `0 8px 36px rgba(0,0,0,0.6)`, zIndex: 1000, width: 264, animation: 'fmSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1)' }}>
      <style>{`@keyframes fmSlideIn { from { opacity:0; transform: translateX(28px) scale(0.94); } to { opacity:1; transform:translateX(0) scale(1); } }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <img src={fitPopup.worker.employees?.image_url || ''} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: `2.5px solid ${fc}`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#f0f0f4' }}>{fitPopup.worker.employees?.name}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>→ {fitPopup.station.station_name}</div>
        </div>
        <div style={{ background: fc, color: '#fff', fontWeight: 900, fontSize: 22, padding: '4px 10px', borderRadius: 6, flexShrink: 0 }}>{fitPopup.fit.score}</div>
      </div>
      <div style={{ textAlign: 'center', marginBottom: 10, background: `${fc}20`, border: `1px solid ${fc}55`, borderRadius: 5, padding: '3px 0', fontSize: 11, fontWeight: 800, color: fc }}>{fitLabel(fitPopup.fit.score)}</div>
      {fitPopup.fit.details.map(d => (
        <div key={d.label} style={{ marginBottom: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: d.color, display: 'inline-block' }} />{d.label}
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, color: d.pass ? '#22c55e' : '#ef4444' }}>
              {d.actual}<span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>/{d.required}%</span> {d.pass ? '✓' : '✗'}
            </span>
          </div>
          <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: `${d.required}%`, top: 0, bottom: 0, width: 1.5, background: 'rgba(255,255,255,0.3)', zIndex: 2 }} />
            <div style={{ width: `${Math.min(d.actual,100)}%`, height: '100%', background: d.pass ? '#22c55e' : '#ef4444', borderRadius: 3 }} />
          </div>
        </div>
      ))}
      <button onClick={onClose} style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 18, cursor: 'pointer' }}>×</button>
    </div>
  );
}

const labelSt = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' };
