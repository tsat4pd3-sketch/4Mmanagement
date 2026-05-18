import { useState, useEffect, useContext, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';

const CARD_W = 82;
const LINE_4M_CATEGORIES = ['Machine', 'Material', 'Method'];

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
  const isLeader     = role === 'leader';
  const isSupervisor = role === 'supervisor';

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
  const [autoManAlert, setAutoManAlert] = useState(null);
  const [skillDefs, setSkillDefs] = useState([]);
  const [dragOverStation, setDragOverStation] = useState(null);
  const [fitPopup, setFitPopup] = useState(null);
  const [hoverCard, setHoverCard] = useState(null); // { worker, x, y, fit? }
  const hoverTimer = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    supabase.from('skill_definitions').select('*').order('sort_order').then(({ data }) => setSkillDefs(data || []));
    const fetchLines = async () => {
      let query = supabase.from('production_lines').select('id, name').order('name');
      if (isLeader && userLineId) query = query.eq('id', userLineId);
      const { data } = await query;
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
      .select(`id, assigned_line, employee_id, employees ( employee_id_code, name, image_url, team, line_id, employee_skills ( skill_name, score ) )`)
      .eq('work_date', today).eq('is_present', true).eq('has_helmet', true).eq('has_boots', true).eq('has_gloves', true);
    const { data: mData } = await supabase.from('four_m_logs').select('*').eq('work_date', today);
    setWorkers(workerData || []);
    setFourMLogs(mData || []);
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

  const handleSave4MLog = async () => {
    if (!log4MForm.description.trim()) return alert('กรุณาระบุรายละเอียด');
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase.from('four_m_logs').insert([{
      work_date: today, line_name: show4MModal.lineName,
      category: log4MForm.category, description: log4MForm.description
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

  const handleDragEnd = () => {
    setDraggingWorker(null);
    setDragOverStation(null);
  };

  const handleDrop = async (e, stationId) => {
    e.preventDefault();
    const logId = e.dataTransfer.getData('logId');
    const finalAssign = stationId === 'Pool' ? null : stationId;
    const droppedWorker = workers.find(w => w.id === logId);
    setWorkers(prev => prev.map(w => w.id === logId ? { ...w, assigned_line: finalAssign } : w));
    setDraggingWorker(null);
    setDragOverStation(null);
    await supabase.from('daily_production_logs').update({ assigned_line: finalAssign }).eq('id', logId);

    if (finalAssign && droppedWorker) {
      const station = dynamicStations.find(s => String(s.id) === String(finalAssign));
      if (station) {
        const fit = computeFit(droppedWorker, station);
        setFitPopup({ worker: droppedWorker, station, fit });
        setTimeout(() => setFitPopup(null), 4500);
        if (droppedWorker.employee_id) {
          const today = new Date().toISOString().split('T')[0];
          const { data: history } = await supabase.from('daily_production_logs').select('id')
            .eq('employee_id', droppedWorker.employee_id).eq('assigned_line', String(finalAssign))
            .lt('work_date', today).limit(1);
          if (!history?.length) {
            const desc = `[Auto] ${droppedWorker.employees?.name} ประจำจุด ${station.station_name} เป็นครั้งแรก`;
            const { data: dup } = await supabase.from('four_m_logs')
              .select('id').eq('work_date', today).eq('category', 'Man').eq('description', desc).limit(1);
            if (!dup?.length) {
              await supabase.from('four_m_logs').insert([{
                work_date: today, line_name: station.line_name, category: 'Man', description: desc,
              }]);
              setAutoManAlert({ name: droppedWorker.employees?.name, station: station.station_name });
              setTimeout(() => setAutoManAlert(null), 4000);
              fetchData();
            }
          }
        }
      }
    }
  };

  const onHoverEnter = (e, worker, fit = null) => {
    clearTimeout(hoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => {
      setHoverCard({ worker, fit, rect });
    }, 180);
  };
  const onHoverLeave = () => {
    clearTimeout(hoverTimer.current);
    setHoverCard(null);
  };

  /* ── Pool worker card ── */
  const PoolCard = ({ worker }) => (
    <div
      draggable
      onDragStart={(e) => handleDragStart(e, worker)}
      onDragEnd={handleDragEnd}
      onMouseEnter={(e) => onHoverEnter(e, worker)}
      onMouseLeave={onHoverLeave}
      style={{
        width: CARD_W, padding: '8px 5px 7px',
        background: 'rgba(77,159,255,0.08)',
        border: '1.5px solid rgba(77,159,255,0.35)',
        borderRadius: 10, cursor: 'grab',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        userSelect: 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      {worker.employees?.image_url
        ? <img src={worker.employees.image_url} style={{ width: 50, height: 50, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(77,159,255,0.6)', pointerEvents: 'none', flexShrink: 0 }} />
        : <div style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(77,159,255,0.15)', border: '2px solid rgba(77,159,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
      }
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%', textAlign: 'center', pointerEvents: 'none' }}>
        {worker.employees?.name?.split(' ')[0] ?? '?'}
      </div>
      {worker.employees?.team && (
        <div style={{ fontSize: 8, fontWeight: 800, color: '#4d9fff', background: 'rgba(77,159,255,0.15)', borderRadius: 3, padding: '1px 5px', pointerEvents: 'none' }}>
          Team {worker.employees.team}
        </div>
      )}
    </div>
  );

  /* ── In-station worker card (FM style) ── */
  const StationWorker = ({ worker, fit }) => {
    const fc = fitColor(fit.score);
    return (
      <div
        draggable
        onDragStart={(e) => handleDragStart(e, worker)}
        onDragEnd={handleDragEnd}
        onMouseEnter={(e) => onHoverEnter(e, worker, fit)}
        onMouseLeave={onHoverLeave}
        style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'grab', userSelect: 'none' }}
      >
        {worker.employees?.image_url
          ? <img src={worker.employees.image_url} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none', border: `3px solid ${fc}`, boxShadow: `0 0 8px ${fc}88`, flexShrink: 0 }} />
          : <div style={{ width: 42, height: 42, borderRadius: '50%', background: `${fc}22`, border: `3px solid ${fc}`, boxShadow: `0 0 8px ${fc}88`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>👤</div>
        }
        <div style={{
          background: fc, color: '#fff',
          fontSize: 12, fontWeight: 900,
          padding: '2px 0', width: 44, textAlign: 'center',
          borderRadius: 5,
          letterSpacing: '0.03em',
          boxShadow: `0 1px 5px ${fc}99`,
          pointerEvents: 'none',
        }}>
          {fit.score}
        </div>
        <div style={{
          fontSize: 9, fontWeight: 700, color: fc,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          width: '100%', textAlign: 'center', pointerEvents: 'none',
        }}>
          {worker.employees?.name?.split(' ')[0] ?? '?'}
        </div>
      </div>
    );
  };

  // Pool visibility: leader sees only their team; supervisor/others see all unassigned
  const poolWorkers = workers.filter(w => {
    if (w.assigned_line) return false;
    if (isLeader && userTeam) return w.employees?.team === userTeam;
    return true;
  });

  const poolStyle = isMobile
    ? { width: '100%', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', flexShrink: 0 }
    : { width: 210, background: 'var(--bg2)', borderRight: '1px solid var(--border)', padding: '15px 10px', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' };

  const poolInnerStyle = isMobile
    ? { display: 'flex', flexDirection: 'row', gap: 6, overflowX: 'auto', paddingBottom: 4, minHeight: 60 }
    : { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', width: '100%', height: 'calc(100vh - 80px)', background: 'var(--bg)', overflow: 'hidden' }}>

      <div style={poolStyle}>
        <div style={{ marginBottom: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>ไลน์ผลิต</div>
          <select
            value={selectedLine}
            onChange={(e) => !isLeader && setSelectedLine(e.target.value)}
            disabled={isLeader}
            style={{
              width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12,
              background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)',
              opacity: isLeader ? 0.7 : 1, cursor: isLeader ? 'default' : 'pointer',
            }}>
            {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </div>

        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, 'Pool')}
          style={{ flexShrink: 0, flex: isMobile ? undefined : 1 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🔵 พร้อมทำงาน</h3>
          <div style={poolInnerStyle}>
            {poolWorkers.map(w => <PoolCard key={w.id} worker={w} />)}
            {poolWorkers.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>ไม่มีในPool</div>
            )}
          </div>
        </div>

        {selectedLine && !isMobile && (
          <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>บันทึก 4M ไลน์</div>
            {LINE_4M_CATEGORIES.map(cat => (
              <button key={cat}
                onClick={() => { setShow4MModal({ lineName: selectedLine }); setLog4MForm({ category: cat, description: '' }); }}
                style={{
                  width: '100%', marginBottom: 5, padding: '6px 8px', fontSize: 11,
                  background: cat === 'Machine' ? 'rgba(245,158,11,0.12)' : cat === 'Material' ? 'rgba(34,197,94,0.12)' : 'rgba(139,92,246,0.12)',
                  color: cat === 'Machine' ? 'var(--amber)' : cat === 'Material' ? 'var(--green)' : '#c084fc',
                  border: `1px solid ${cat === 'Machine' ? 'rgba(245,158,11,0.3)' : cat === 'Material' ? 'rgba(34,197,94,0.3)' : 'rgba(139,92,246,0.3)'}`,
                  borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                }}>
                {cat === 'Machine' ? '⚙️' : cat === 'Material' ? '📦' : '📋'} {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, position: 'relative', padding: 10, overflow: 'auto', minHeight: isMobile ? 240 : undefined }}>
        {autoManAlert && (
          <div style={{
            position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(77,159,255,0.95)', color: '#fff',
            padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 600,
            zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
          }}>
            🆕 Man Change: {autoManAlert.name} — ประจำ {autoManAlert.station} เป็นครั้งแรก (บันทึกอัตโนมัติ)
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
            <div style={{ textAlign: 'center', marginTop: '20%', color: 'var(--muted)', fontSize: 14 }}>
              กรุณาอัปโหลดรูปผังไลน์ที่หน้า Setup
            </div>
          )}

          {dynamicStations.map(st => {
            const workerAtStation = workers.find(w => String(w.assigned_line) === String(st.id));
            const workerFit = workerAtStation ? computeFit(workerAtStation, st) : null;
            const hasMan = fourMLogs.some(m => m.line_name === st.line_name && m.category === 'Man');
            const has4M = fourMLogs.some(m => m.line_name === st.line_name && m.category !== 'Man');
            const isOver = dragOverStation === st.id;
            const previewFit = isOver && draggingWorker ? computeFit(draggingWorker, st) : null;
            const activeFc = previewFit ? fitColor(previewFit.score) : (workerFit ? fitColor(workerFit.score) : null);

            return (
              <div
                key={st.id}
                onDragOver={(e) => { e.preventDefault(); setDragOverStation(st.id); }}
                onDragEnter={(e) => { e.preventDefault(); setDragOverStation(st.id); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverStation(null); }}
                onDrop={(e) => handleDrop(e, st.id)}
                style={{
                  position: 'absolute', top: st.pos_top, left: st.pos_left, transform: 'translate(-50%, -50%)',
                  width: CARD_W,
                  borderTop: `1px solid ${activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderRight: `1px solid ${activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderBottom: `1px solid ${activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderLeft: `4px solid ${activeFc || 'rgba(255,255,255,0.25)'}`,
                  borderRadius: 8,
                  backgroundColor: isOver ? `${activeFc}1a` : 'rgba(8,8,14,0.88)',
                  backdropFilter: 'blur(3px)',
                  boxShadow: activeFc
                    ? `0 0 14px ${activeFc}44, 0 2px 8px rgba(0,0,0,0.6)`
                    : '0 2px 8px rgba(0,0,0,0.6)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '5px 4px 6px',
                  transition: 'all 0.18s', zIndex: isOver ? 20 : 5,
                }}
              >
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: activeFc || '#c8c8d0' }}>
                    {st.station_name}
                  </span>
                  <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                    {hasMan && <span style={{ background: '#4d9fff', color: '#fff', borderRadius: 2, padding: '0 2px', fontSize: 5, fontWeight: 800 }}>MAN</span>}
                    {has4M && <span style={{ background: '#e74c3c', color: '#fff', borderRadius: 2, padding: '0 2px', fontSize: 5, fontWeight: 800 }}>4M</span>}
                    <button
                      onClick={(e) => { e.stopPropagation(); setShow4MModal({ stationId: st.id, lineName: st.line_name }); setLog4MForm({ category: 'Man', description: '' }); }}
                      style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 2, color: 'white', fontSize: 5, cursor: 'pointer', padding: '1px 2px', lineHeight: 1 }}
                      title="บันทึก 4M Change"
                    >+4M</button>
                  </div>
                </div>

                {workerAtStation
                  ? <StationWorker worker={workerAtStation} fit={workerFit} />
                  : (
                    <div style={{ color: isOver ? activeFc : 'rgba(255,255,255,0.22)', fontSize: 20, lineHeight: '28px', transition: 'color 0.15s' }}>+</div>
                  )}

                {previewFit && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(6,6,12,0.97)',
                    border: `1px solid ${activeFc}`,
                    borderRadius: 8, padding: '8px 10px',
                    zIndex: 100, minWidth: 116, pointerEvents: 'none',
                    boxShadow: `0 4px 24px rgba(0,0,0,0.7), 0 0 10px ${activeFc}44`,
                  }}>
                    <div style={{ textAlign: 'center', marginBottom: 2 }}>
                      <span style={{
                        display: 'inline-block',
                        background: activeFc, color: '#fff',
                        fontSize: 20, fontWeight: 900, lineHeight: 1,
                        padding: '2px 14px', borderRadius: 5,
                        boxShadow: `0 2px 8px ${activeFc}88`,
                      }}>{previewFit.score}</span>
                    </div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginBottom: 6 }}>
                      {fitLabel(previewFit.score)}
                    </div>
                    {previewFit.details.length === 0 && (
                      <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>ไม่มีสกิลกำหนด</div>
                    )}
                    {previewFit.details.map(d => (
                      <div key={d.label} style={{ marginBottom: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: d.color, display: 'inline-block', flexShrink: 0 }} />
                            {d.label}
                          </span>
                          <span style={{ fontSize: 8, fontWeight: 800, color: d.pass ? '#22c55e' : '#ef4444', marginLeft: 8 }}>
                            {d.actual}<span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>/{d.required}</span>
                          </span>
                        </div>
                        <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                          <div style={{ position: 'absolute', left: `${d.required}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)', zIndex: 2 }} />
                          <div style={{ width: `${Math.min(d.actual, 100)}%`, height: '100%', background: d.pass ? '#22c55e' : '#ef4444', borderRadius: 2 }} />
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

      {hoverCard && <WorkerHoverCard card={hoverCard} skillDefs={skillDefs} />}

      {fitPopup && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: 'rgba(10,10,18,0.97)',
          border: `1px solid ${fitColor(fitPopup.fit.score)}66`,
          borderLeft: `4px solid ${fitColor(fitPopup.fit.score)}`,
          borderRadius: 12, padding: '14px 16px',
          boxShadow: `0 8px 36px rgba(0,0,0,0.6), 0 0 20px ${fitColor(fitPopup.fit.score)}22`,
          zIndex: 1000, width: 264,
          animation: 'fmSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          <style>{`@keyframes fmSlideIn { from { opacity:0; transform: translateX(28px) scale(0.94); } to { opacity:1; transform:translateX(0) scale(1); } }`}</style>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <img src={fitPopup.worker.employees?.image_url || ''}
              style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: `2.5px solid ${fitColor(fitPopup.fit.score)}`, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#f0f0f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {fitPopup.worker.employees?.name}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>→ {fitPopup.station.station_name}</div>
            </div>
            <div style={{
              background: fitColor(fitPopup.fit.score), color: '#fff',
              fontWeight: 900, fontSize: 22, lineHeight: 1,
              padding: '4px 10px', borderRadius: 6,
              boxShadow: `0 2px 10px ${fitColor(fitPopup.fit.score)}99`,
              flexShrink: 0,
            }}>
              {fitPopup.fit.score}
            </div>
          </div>

          <div style={{
            textAlign: 'center', marginBottom: 10,
            background: `${fitColor(fitPopup.fit.score)}20`,
            border: `1px solid ${fitColor(fitPopup.fit.score)}55`,
            borderRadius: 5, padding: '3px 0',
            fontSize: 11, fontWeight: 800, color: fitColor(fitPopup.fit.score),
            letterSpacing: '0.04em',
          }}>
            {fitLabel(fitPopup.fit.score)}
          </div>

          {fitPopup.fit.details.length === 0 && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>ไม่มีสกิลที่กำหนดสำหรับจุดนี้</div>
          )}
          {fitPopup.fit.details.map(d => (
            <div key={d.label} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: d.color, display: 'inline-block', flexShrink: 0 }} />
                  {d.label}
                </span>
                <span style={{ fontSize: 10, fontWeight: 800, color: d.pass ? '#22c55e' : '#ef4444' }}>
                  {d.actual}<span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>/{d.required}%</span>
                  <span style={{ marginLeft: 3 }}>{d.pass ? '✓' : '✗'}</span>
                </span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                <div style={{ position: 'absolute', left: `${d.required}%`, top: 0, bottom: 0, width: 1.5, background: 'rgba(255,255,255,0.3)', zIndex: 2 }} />
                <div style={{ width: `${Math.min(d.actual, 100)}%`, height: '100%', background: d.pass ? '#22c55e' : '#ef4444', borderRadius: 3, transition: 'width 0.7s cubic-bezier(0.34,1.56,0.64,1)' }} />
              </div>
            </div>
          ))}

          <button onClick={() => setFitPopup(null)}
            style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>
            ×
          </button>
        </div>
      )}

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
                <textarea value={log4MForm.description} onChange={e => setLog4MForm({ ...log4MForm, description: e.target.value })}
                  placeholder="ระบุรายละเอียดการเปลี่ยนแปลง..." rows={3} style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={handleSave4MLog}
                  style={{ flex: 2, padding: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  บันทึก 4M Log
                </button>
                <button onClick={() => { setShow4MModal(null); setLog4MForm({ category: 'Man', description: '' }); }}
                  style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8 }}>
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

function WorkerHoverCard({ card, skillDefs }) {
  const { worker, fit, rect } = card;
  const emp = worker.employees;
  const skills = emp?.employee_skills || [];

  // Position: prefer right of card, fallback left if near edge
  const tooltipW = 230;
  const gap = 10;
  let left = rect.right + gap;
  if (left + tooltipW > window.innerWidth - 12) left = rect.left - tooltipW - gap;
  const top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - 340));

  return (
    <div
      onMouseEnter={() => {}}
      style={{
        position: 'fixed', top, left,
        width: tooltipW, zIndex: 3000, pointerEvents: 'none',
        background: 'var(--card)',
        border: '1px solid var(--border2)',
        borderRadius: 14,
        boxShadow: 'var(--shadow-lg)',
        padding: '14px 14px 12px',
        animation: 'hoverIn 0.18s ease',
      }}
    >
      <style>{`@keyframes hoverIn { from { opacity:0; transform:scale(0.93) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        {emp?.image_url
          ? <img src={emp.image_url} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border2)', flexShrink: 0 }} />
          : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, border: '2px solid var(--border2)' }}>👤</div>
        }
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3, wordBreak: 'break-word' }}>{emp?.name || '—'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{emp?.employee_id_code || ''}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {emp?.team && (
              <span style={{ fontSize: 9, fontWeight: 800, background: 'rgba(77,159,255,0.15)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 4, padding: '1px 5px' }}>
                Team {emp.team}
              </span>
            )}
            {emp?.section && (
              <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(168,85,247,0.12)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 4, padding: '1px 5px' }}>
                {emp.section}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Fit score (if in station) */}
      {fit && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          background: `${fitColor(fit.score)}15`, border: `1px solid ${fitColor(fit.score)}40`,
          borderRadius: 8, padding: '6px 10px',
        }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: fitColor(fit.score), fontFamily: 'var(--font-display)', lineHeight: 1 }}>{fit.score}</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: fitColor(fit.score) }}>{fitLabel(fit.score)}</div>
            <div style={{ fontSize: 9, color: 'var(--muted)' }}>Fit Score</div>
          </div>
        </div>
      )}

      {/* Skills */}
      {skillDefs.length > 0 && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>ทักษะ</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {skillDefs.map(sd => {
              const score = skills.find(s => s.skill_name === sd.name)?.score ?? 0;
              const fitReq = fit?.details?.find(d => d.label === sd.label);
              const barColor = fitReq ? (fitReq.pass ? '#22c55e' : '#ef4444') : sd.color;
              return (
                <div key={sd.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: sd.color, flexShrink: 0, display: 'inline-block' }} />
                      {sd.label}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: barColor }}>
                      {score}%
                      {fitReq && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 9 }}>/{fitReq.required}%</span>}
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--border2)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                    {fitReq && <div style={{ position: 'absolute', left: `${fitReq.required}%`, top: 0, bottom: 0, width: 1.5, background: 'var(--muted)', zIndex: 2 }} />}
                    <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {skillDefs.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', paddingTop: 4 }}>ยังไม่มีทักษะบันทึก</div>
      )}
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.04em', textTransform: 'uppercase'
};
