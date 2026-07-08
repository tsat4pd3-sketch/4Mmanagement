import { useState, useEffect, useLayoutEffect, useContext, useRef, useCallback, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { hasPermission } from '../utils/permissions';

function resizeImage(file, maxPx = 1280, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width: w, height: h } = img;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', quality);
    };
    img.src = url;
  });
}

function getWorkDate() {
  const now = new Date();
  const h = now.getHours();
  if (h < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getCurrentShift() {
  const h = new Date().getHours();
  return (h >= 8 && h < 20) ? 'day' : 'night';
}

// Period boundaries — เวลาที่ใช้บันทึก started_at ไม่ใช่เวลาที่ลาก
// กะเช้า: เช้า 08:00 / บ่าย 12:00 / OT 17:30
// กะดึก: OT 20:00 / ปกติ 22:30 / ใกล้เช้า 03:00 (วันถัดไป)
const SHIFT_PERIODS = {
  day: [
    { key: 'morning',      label: 'ช่วงเช้า',    start: '08:00', h: 8,  m: 0  },
    { key: 'afternoon',    label: 'ช่วงบ่าย',    start: '12:00', h: 12, m: 0  },
    { key: 'ot',           label: 'OT',           start: '17:30', h: 17, m: 30 },
  ],
  night: [
    { key: 'night_ot',     label: 'OT กะดึก',    start: '20:00', h: 20, m: 0  },
    { key: 'night_normal', label: 'กะดึกปกติ',   start: '22:30', h: 22, m: 30 },
    { key: 'night_late',   label: 'ใกล้เช้า',    start: '03:00', h: 3,  m: 0  },
  ],
};

function getCurrentPeriod(shift) {
  const now = new Date();
  const nowTotalMin = now.getHours() * 60 + now.getMinutes();
  // สำหรับกะดึก: 03:00 อยู่หลัง 20:00 → บวก 24h ให้กับชั่วโมงที่น้อยกว่า 8
  const toAdj = (h, m) => {
    const base = h * 60 + m;
    return (shift === 'night' && h < 8) ? base + 1440 : base;
  };
  const nowAdj = (shift === 'night' && now.getHours() < 8) ? nowTotalMin + 1440 : nowTotalMin;
  const periods = SHIFT_PERIODS[shift];
  let current = periods[0];
  for (const p of periods) {
    if (nowAdj >= toAdj(p.h, p.m)) current = p;
  }
  return current;
}

// คืน Date object ของต้นช่วง (snapped) — ใช้เป็น started_at / ended_at
function getPeriodStartDate(period, workDate) {
  const d = new Date(`${workDate}T${period.start}:00`);
  // ช่วง night_late (03:00) ข้ามวัน → วันถัดจาก workDate
  if (period.h < 8) d.setDate(d.getDate() + 1);
  return d;
}

const CARD_W = 70;
const CARD_H = 58;
const STATION_PHOTO_SZ = 36; // photo size inside the on-map mini card — must fit CARD_H alongside the header row
const POOL_PHOTO_SZ = 44;    // photo size in sidebar pool/special-task cards — independent of map marker size

// skill_definitions has rows that share the same display label under different skill_name keys
// (data duplication) — without this, the radar chart's category axis collapses both entries onto
// the same angle, which makes the polygon zigzag in/out and look like crossing lines
function dedupeByLabel(items, labelKey) {
  const byLabel = new Map();
  for (const item of items) {
    const existing = byLabel.get(item[labelKey]);
    if (!existing || item.score > existing.score) byLabel.set(item[labelKey], item);
  }
  return [...byLabel.values()];
}

function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}
const LINE_4M_CATEGORIES = ['Machine', 'Material', 'Method'];
const SPECIAL_TASKS = ['5ส', 'คัดงาน', 'แก้ไขปัญหาคุณภาพ', 'งานปรับปรุงไลน์', 'อื่นๆ'];

// Aligned with SKILL_LEVELS scale used across Dashboard / Operator / Report
const fitColor = (score) => {
  if (score >= 100) return '#a855f7';
  if (score >= 75)  return '#22c55e';
  if (score >= 50)  return '#84cc16';
  if (score >= 25)  return '#f59e0b';
  return '#ef4444';
};
const fitLabel = (score) => {
  if (score >= 100) return 'ผู้เชี่ยวชาญ';
  if (score >= 75)  return 'แก้ปัญหาได้';
  if (score >= 50)  return 'มาตรฐาน';
  if (score >= 25)  return 'ต้องดูแล';
  return 'ยังไม่ผ่าน OJT';
};

// Man 4M case classification
// 1 = same-line + skill OK + has history → silent approved log
// 2 = cross-line + skill OK → OJT image + SV approve
// 3 = cross-line + (no skill OR no history) → OJT image + SV + QA
const getManCase = ({ moveType, skillOk, hasHistory }) => {
  if (moveType === 'same' && skillOk && hasHistory) return 1;
  if (moveType === 'cross' && skillOk) return 2;
  return 3;
};
const MAN_CASE_META = {
  1: { label: '✅ เก็บ log อัตโนมัติ ไม่ต้องอนุมัติ', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', needsImage: false, requiresQa: false, autoApprove: true },
  2: { label: '🟡 ต้องแนบรูป OJT + SV อนุมัติ',      color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', needsImage: true,  requiresQa: false, autoApprove: false },
  3: { label: '🔴 ต้องแนบรูป OJT + SV + QA อนุมัติ', color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  needsImage: true,  requiresQa: true,  autoApprove: false },
};

export default function Management() {
  const { role, lineId: userLineId, team: userTeam, section: userSection, fullName, user } = useContext(UserContext);
  const isLeader = role === 'leader';
  const isSupervisor = role === 'supervisor';

  const [workers,        setWorkers]        = useState([]);
  const [fourMLogs,      setFourMLogs]      = useState([]);
  const [dynamicStations,setDynamicStations]= useState([]);
  const [wipPoints,      setWipPoints]      = useState([]);
  const [machinePoints,  setMachinePoints]  = useState([]);
  const [drMachines,     setDrMachines]     = useState([]);
  const [lineLayout,     setLineLayout]     = useState(null);
  const [draggingWorker, setDraggingWorker] = useState(null);
  const [selectedLine,   setSelectedLine]   = useState('');
  const [lines,          setLines]          = useState([]);
  const [allLines,       setAllLines]       = useState([]); // ทุกไลน์รวมไลน์ย่อย (ใช้หา parent_line_name)
  const [show4MModal,    setShow4MModal]    = useState(null);
  const [log4MForm,      setLog4MForm]      = useState({ category: 'Man', description: '', moveType: 'same', skillOk: false, hasHistory: false, subtype: 'change' });
  const [isMobile,       setIsMobile]       = useState(window.innerWidth <= 768);
  const vw = useWidth();
  const isWide  = vw >= 1280;
  const isUltra = vw >= 1600;
  const [autoManAlert,   setAutoManAlert]   = useState(null);
  const [skillDefs,      setSkillDefs]      = useState([]);
  const [dragOverStation,setDragOverStation]= useState(null);
  const [fitPopup,       setFitPopup]       = useState(null);
  const [hoverCard,      setHoverCard]      = useState(null);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [detailSheet,    setDetailSheet]    = useState(null);
  const [stationModal,   setStationModal]   = useState(null);
  const [homePositions,  setHomePositions]  = useState({});
  const [radarWorker,    setRadarWorker]    = useState(null);
  const [isSaving4M,     setIsSaving4M]     = useState(false);
  const [reqImageFile,   setReqImageFile]   = useState(null);
  const [reqImagePreview,setReqImagePreview]= useState(null);
  const [specialTasks,   setSpecialTasks]   = useState([]);
  const [specialModal,   setSpecialModal]   = useState(null); // worker to assign
  const [specialTaskType,setSpecialTaskType]= useState('5ส');
  const [pendingDocModal, setPendingDocModal] = useState(null); // { log: {...} }
  const [docImageFile,    setDocImageFile]    = useState(null);
  const [panelCollapsed,  setPanelCollapsed]  = useState(false);
  const [filterMan,       setFilterMan]       = useState(true);
  const [filterMachine,   setFilterMachine]   = useState(false);
  const [filterWip,       setFilterWip]       = useState(false);
  const [docImagePreview, setDocImagePreview] = useState(null);
  const [isSavingDoc,     setIsSavingDoc]     = useState(false);
  const [lineProdData,    setLineProdData]    = useState(null); // heijunka data for selected line
  const [boardDate,       setBoardDate]       = useState(() => getWorkDate()); // วันที่ mini Heijunka board — เลือกดูย้อนหลังได้
  const [imgBox,         setImgBox]         = useState(null); // actual rendered image bounds inside objectFit:contain
  const imgRef = useRef(null);
  const recalcImgBox = useCallback(() => {
    // rAF ensures CSS layout has settled before reading dimensions
    requestAnimationFrame(() => {
      const img = imgRef.current;
      if (!img || !img.naturalWidth) return;
      const { naturalWidth: nw, naturalHeight: nh } = img;
      const { width: cw, height: ch } = img.getBoundingClientRect();
      if (!cw || !ch) return;
      const scale = Math.min(cw / nw, ch / nh);
      const rw = nw * scale, rh = nh * scale;
      setImgBox({ offsetX: (cw - rw) / 2, offsetY: (ch - rh) / 2, rw, rh });
    });
  }, []);
  // ResizeObserver จับทุกกรณีที่กรอบรูปเปลี่ยนขนาด รวมถึงพับ/กาง sidebar
  // ซึ่งเปลี่ยนขนาด container โดยไม่มี window resize event
  useEffect(() => {
    window.addEventListener('resize', recalcImgBox);
    const img = imgRef.current;
    const ro = img ? new ResizeObserver(recalcImgBox) : null;
    if (ro) ro.observe(img);
    return () => {
      window.removeEventListener('resize', recalcImgBox);
      if (ro) ro.disconnect();
    };
  }, [recalcImgBox, lineLayout]);
  // reset imgBox when layout changes
  useEffect(() => { setImgBox(null); }, [lineLayout]);

  const hoverTimer = useRef(null);
  const [nowForBoardState, setNowForBoard] = useState(new Date());
  const nowForBoard = useRef(nowForBoardState);
  nowForBoard.current = nowForBoardState;
  useEffect(() => {
    const t = setInterval(() => setNowForBoard(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // ไลน์ย่อยที่ผูกกับ selectedLine (เช่น HDF1/HDF2 ใต้ HYDROFORM) — รวมจุดงาน/เครื่องจักร/การผลิตของมันเข้ามาแสดง
  // ในผังเดียวกัน เพราะจริงๆ อยู่พื้นที่เดียวกัน ไม่ได้แยกกันทางกายภาพ
  const childLineNames = useMemo(
    () => allLines.filter(l => l.parent_line_name === selectedLine).map(l => l.name),
    [allLines, selectedLine],
  );

  const fetchLineProd = useCallback(async (lineNames) => {
    if (!lineNames?.length) { setLineProdData(null); return; }
    const dateStr = boardDate;
    const { data: sessions } = await supabaseDR
      .from('production_sessions')
      .select('id, line_name, shift, status, work_date, created_at, dr_products(name, target_per_shift, cycle_time_sec)')
      .eq('work_date', dateStr)
      .in('line_name', lineNames);
    if (!sessions?.length) { setLineProdData(null); return; }
    const sessionIds = sessions.map(s => s.id);
    const { data: orders } = await supabaseDR
      .from('prod_orders')
      .select('session_id, status, qty, qty_ok, qty_actual, prod_no, mat_no, opened_at, confirmed_at')
      .in('session_id', sessionIds);
    // production_sessions.product_id ไม่ได้ตั้งค่าเสมอ (กะนึงมีได้หลาย mat_no)
    // จึง fallback ไปหา cycle_time_sec ตรงจาก mat_no ของออเดอร์เอง
    const matNos = [...new Set((orders || []).map(o => o.mat_no).filter(Boolean))];
    const ctMap = {};
    const nameMap = {};
    const imgMap = {};
    if (matNos.length) {
      const { data: products } = await supabaseDR
        .from('dr_products')
        .select('mat_no, name, cycle_time_sec, image_url')
        .in('mat_no', matNos);
      (products || []).forEach(p => { ctMap[p.mat_no] = p.cycle_time_sec || 0; nameMap[p.mat_no] = p.name || ''; imgMap[p.mat_no] = p.image_url || ''; });
    }
    const ordersBySession = {};
    (orders || []).forEach(o => { (ordersBySession[o.session_id] ||= []).push(o); });
    // downtime ของ session เหล่านี้ — ใช้วาดแถบ ⛔ บนไทม์ไลน์ และบอกสาเหตุใน tooltip ของใบที่ดีเลย์
    const { data: dtLogs } = await supabaseDR.from('downtime_logs')
      .select('session_id, duration_min, started_at, ended_at, machine_no, description, dr_downtime_types(category, name_th)')
      .in('session_id', sessionIds);
    const dtBySession = {};
    (dtLogs || []).forEach(d => { (dtBySession[d.session_id] ||= []).push(d); });
    const enriched = sessions.map(s => ({ ...s, orders: ordersBySession[s.id] || [], dtLogs: dtBySession[s.id] || [] }));
    const { data: breakPolicies } = await supabaseDR.from('break_policies').select('*').eq('is_active', true);
    setLineProdData({ sessions: enriched, workDate: dateStr, ctByMatNo: ctMap, nameByMatNo: nameMap, imgByMatNo: imgMap, breakPolicies: breakPolicies || [] });
  }, [boardDate]);

  useEffect(() => {
    if (!selectedLine) return;
    const cardLineNames = [selectedLine, ...childLineNames];
    fetchLineProd(cardLineNames);
    const t = setInterval(() => fetchLineProd(cardLineNames), 30000);
    return () => clearInterval(t);
  }, [selectedLine, childLineNames, fetchLineProd]);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    supabase.from('skill_definitions').select('*').order('sort_order').then(({ data }) => setSkillDefs(data || []));
    const fetchLines = async () => {
      let q = supabase.from('production_lines').select('id, name, section, parent_line_name').order('name');
      if (isLeader && userLineId) q = q.eq('id', userLineId);
      else if (isSupervisor && userSection) q = q.eq('section', userSection);
      const { data } = await q;
      // ไลน์ย่อย (มี parent_line_name) ใช้ผังเดียวกับไลน์หลักและถูกรวมเข้าการ์ดเดียวกันอยู่แล้ว —
      // ไม่ต้องให้เลือกแยกในหน้านี้ เพื่อไม่ให้ dropdown แตกเป็นหลายไลน์ทั้งที่พื้นที่จริงเดียวกัน
      const topLevel = (data || []).filter(l => !l.parent_line_name);
      setLines(topLevel.length ? topLevel : (data || []));
      const list = topLevel.length ? topLevel : (data || []);
      if (list.length > 0) setSelectedLine(list[0].name);
      setAllLines(data || []);
    };
    fetchLines();
  }, []);

  useEffect(() => {
    if (!selectedLine) return;
    fetchData();
    fetchSetup();
  }, [selectedLine]);

  const fetchSetup = async () => {
    const cardLineNames = [selectedLine, ...childLineNames];
    const { data: layoutData } = await supabase.from('line_layouts').select('image_url').eq('line_name', selectedLine).maybeSingle();
    setLineLayout(layoutData?.image_url || null);
    const { data: stationData } = await supabase.from('workstations').select('*, station_requirements(*)').in('line_name', cardLineNames);
    setDynamicStations(stationData || []);
    const { data: wipData } = await supabase.from('wip_buffer_points').select('*').in('line_name', cardLineNames);
    setWipPoints(wipData || []);
    const { data: mpData } = await supabase.from('machine_points').select('*').in('line_name', cardLineNames);
    setMachinePoints(mpData || []);
    const { data: drMc } = await supabaseDR.from('machines').select('id, machine_no, machine_name').in('line_name', cardLineNames).eq('is_active', true);
    setDrMachines(drMc || []);
  };

  const fetchData = async () => {
    const today = getWorkDate();
    const { data: workerData } = await supabase
      .from('daily_production_logs')
      .select('id, assigned_line, employee_id, employees(id, employee_id_code, name, image_url, team, section, line_id, employee_skills(skill_name, score))')
      .eq('work_date', today).eq('shift', getCurrentShift()).eq('is_present', true).eq('has_helmet', true).eq('has_boots', true).eq('has_gloves', true);
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

    // ── Station assignment log (period-snapped) ──────────────────
    if (droppedWorker?.employee_id) {
      const workDate = getWorkDate();
      const shift    = getCurrentShift();
      const period   = getCurrentPeriod(shift);
      const periodStart = getPeriodStartDate(period, workDate);

      // ปิด record เดิมที่ยังเปิดอยู่ของพนักงานคนนี้
      await supabase
        .from('station_assignment_logs')
        .update({ ended_at: periodStart.toISOString() })
        .eq('employee_id', droppedWorker.employee_id)
        .eq('work_date', workDate)
        .eq('shift', shift)
        .is('ended_at', null);

      // สร้าง record ใหม่เฉพาะเมื่อย้ายไปสถานี (ไม่สร้างตอนย้ายกลับ pool)
      if (finalAssign) {
        const station = dynamicStations.find(s => String(s.id) === String(finalAssign));
        await supabase.from('station_assignment_logs').insert({
          employee_id:      droppedWorker.employee_id,
          station_id:       finalAssign,
          station_name:     station?.station_name || null,
          line_name:        station?.line_name || selectedLine,
          work_date:        workDate,
          shift,
          period:           period.key,
          period_start:     period.start,
          started_at:       periodStart.toISOString(),
          ended_at:         null,
          assigned_by_uid:  user?.id || null,
          assigned_by_name: fullName || null,
        });
      }
    }

    // ถ้า assign ไปสถานีผลิต → ล้าง special task อัตโนมัติ
    if (finalAssign && droppedWorker?.employee_id) {
      const today = getWorkDate();
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
          const today = getWorkDate();
          const { data: history } = await supabase.from('daily_production_logs').select('id')
            .eq('employee_id', empId).eq('assigned_line', String(finalAssign))
            .lt('work_date', today).limit(1);
          const hasHistory = (history?.length ?? 0) > 0;
          const currentLineId = lines.find(l => l.name === station.line_name)?.id;
          const sameLine = droppedWorker.employees?.line_id != null && droppedWorker.employees.line_id === currentLineId;
          const skillOk = fit.details.length === 0 || fit.details.every(d => d.pass);
          const moveType = sameLine ? 'same' : 'cross';
          const manCase = getManCase({ moveType, skillOk, hasHistory });

          if (manCase === 1) {
            // Silent: log directly as approved, no notification
            const desc = `${droppedWorker.employees?.name} ย้ายไปจุด ${station.station_name} (ไลน์เดิม / skill ผ่าน / มีประวัติ)`;
            const { data: dup } = await supabase.from('four_m_logs')
              .select('id').eq('work_date', today).eq('category', 'Man').eq('description', desc).limit(1);
            if (!dup?.length) {
              await supabase.from('four_m_logs').insert([{
                work_date: today, line_name: station.line_name, category: 'Man',
                description: desc, requires_qa: false, status: 'approved',
                change_subtype: 'same_ok',
              }]);
              fetchData();
            }
          } else {
            const desc = `${droppedWorker.employees?.name} ${moveType === 'cross' ? 'ย้ายข้ามไลน์ไปจุด' : 'ย้ายไปจุด'} ${station.station_name}`;
            const mc = MAN_CASE_META[manCase];
            await supabase.from('four_m_logs').insert([{
              work_date: today,
              line_name: station.line_name,
              category: 'Man',
              description: desc,
              requires_qa: mc.requiresQa,
              status: 'pending_doc',
              change_subtype: manCase === 2 ? 'cross_skill_ok' : 'cross_needs_ojt',
              created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
            }]);
            toast.info('เข้าตำแหน่งแล้ว — กรุณาแนบเอกสาร OJT ภายหลัง');
            fetchData();
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
  const onHoverEnter = (e, worker, fit = null, stationName = null) => {
    if (isMobile) return;
    clearTimeout(hoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => setHoverCard({ worker, fit, rect, stationName }), 180);
  };
  const onHoverLeave = () => { clearTimeout(hoverTimer.current); setHoverCard(null); };

  /* ── Touch tap on pool card ── */
  const handlePoolTap = (worker) => {
    if (!isMobile) {
      clearTimeout(hoverTimer.current);
      setHoverCard(null);
      setRadarWorker(worker);
      return;
    }
    setSelectedWorker(prev => prev?.id === worker.id ? null : worker);
  };

  /* ── Save 4M log ── */
  const handleSave4MLog = async () => {
    if (!log4MForm.description.trim()) { toast.error('กรุณาระบุรายละเอียด'); return; }
    const isMan = log4MForm.category === 'Man';

    // Compute case/requires_qa
    let requires_qa, change_subtype, autoApprove;
    if (isMan) {
      const mc = MAN_CASE_META[getManCase(log4MForm)];
      requires_qa = mc.requiresQa;
      autoApprove = mc.autoApprove;
      change_subtype = log4MForm.moveType === 'same' ? 'same_ok' : log4MForm.skillOk ? 'cross_skill_ok' : 'cross_needs_ojt';
      if (mc.needsImage && !reqImageFile) { toast.error('กรุณาแนบรูปหลักฐาน OJT'); return; }
    } else {
      requires_qa = log4MForm.subtype === 'change';
      change_subtype = log4MForm.subtype;
      autoApprove = false;
      if (requires_qa && !reqImageFile) { toast.error('กรุณาแนบรูปรายละเอียดการเปลี่ยนแปลง (บังคับสำหรับรายการที่ต้องผ่าน QA)'); return; }
    }

    setIsSaving4M(true);
    const today = getWorkDate();
    const { data: { user } } = await supabase.auth.getUser();

    let request_image_url = null;
    if (reqImageFile) {
      const resized = await resizeImage(reqImageFile);
      const path = `request/${Date.now()}_${user?.id ?? 'anon'}.jpg`;
      const { error: upErr } = await supabase.storage.from('four-m-images').upload(path, resized, { upsert: false, contentType: 'image/jpeg' });
      if (upErr) { toast.error('อัปโหลดรูปไม่สำเร็จ: ' + upErr.message); setIsSaving4M(false); return; }
      const { data: urlData } = supabase.storage.from('four-m-images').getPublicUrl(path);
      request_image_url = urlData.publicUrl;
    }

    const logData = {
      work_date: today,
      line_name: show4MModal.lineName || selectedLine,
      category: log4MForm.category,
      description: log4MForm.description.trim(),
      requires_qa,
      change_subtype,
      created_by: user?.id ?? null,
      request_image_url,
      ...(autoApprove ? { status: 'approved' } : {}),
    };
    const { error } = await supabase.from('four_m_logs').insert([logData]);
    setIsSaving4M(false);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    setShow4MModal(null);
    setLog4MForm({ category: 'Man', description: '', moveType: 'same', skillOk: false, hasHistory: false, subtype: 'change' });
    setReqImageFile(null); setReqImagePreview(null);
    fetchData();
    if (!autoApprove) {
      supabase.functions.invoke('send-notification', { body: { event: 'new_4m', log: logData } }).catch(() => {});
    }
  };

  /* ── Station click: open picker modal ── */
  const handleStationClick = (st) => {
    setStationModal(st);
  };

  /* ── Save home position ── */
  const saveHomePosition = async (worker, stationId) => {
    const empId = worker.employee_id || worker.employees?.id;
    if (!empId) return;
    // ใช้ line_name ของสถานีจริง ไม่ใช่ selectedLine เฉยๆ — เพราะตอนนี้ selectedLine อาจเป็นไลน์หลัก
    // (เช่น HYDROFORM) ที่รวมจุดงานจากไลน์ย่อยหลายไลน์ (HDF1/HDF2/...) เข้ามาแสดงพร้อมกัน
    const station = dynamicStations.find(s => String(s.id) === String(stationId));
    await supabase.from('employee_home_positions').upsert(
      { employee_id: empId, station_id: stationId, line_name: station?.line_name || selectedLine, updated_at: new Date().toISOString() },
      { onConflict: 'employee_id' }
    );
    setHomePositions(prev => ({ ...prev, [empId]: String(stationId) }));
  };

  const specialEmpIds = new Set(specialTasks.map(t => t.employee_id));

  const matchesTeam = (w) => {
    if (isLeader) {
      // Leader เห็นเฉพาะพนักงานในไลน์ตัวเอง
      if (userLineId && w.employees?.line_id !== userLineId) return false;
      return true;
    }
    if (isSupervisor) {
      // Supervisor เห็นเฉพาะพนักงานในส่วนงานตัวเอง (เหมือน operator.jsx)
      if (userSection && w.employees?.section !== userSection) return false;
      return true;
    }
    return true;
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
    const today = getWorkDate();
    await supabase.from('operator_special_tasks').upsert(
      { employee_id: worker.employee_id, task_type: taskType, work_date: today },
      { onConflict: 'employee_id,work_date' }
    );
    setSpecialModal(null);
    fetchData();
  };

  const removeSpecialTask = async (worker) => {
    const today = getWorkDate();
    await supabase.from('operator_special_tasks').delete()
      .eq('employee_id', worker.employee_id).eq('work_date', today);
    fetchData();
  };

  /* ── Special Pool Card ── */
  const SpecialCard = ({ worker }) => {
    const task = specialTasks.find(t => t.employee_id === worker.employee_id);
    const canDrag = hasPermission('manage_master_data', role);
    const isSelected = selectedWorker?.id === worker.id;
    return (
      <div
        draggable={!isMobile && canDrag}
        onDragStart={!isMobile && canDrag ? (e) => handleDragStart(e, worker) : undefined}
        onDragEnd={!isMobile ? handleDragEnd : undefined}
        onClick={() => canDrag && handlePoolTap(worker)}
        style={{
          width: '100%',
          padding: isMobile ? '10px 8px' : '8px 6px 7px',
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
          ? <img src={worker.employees.image_url} style={{ width: isMobile ? 44 : POOL_PHOTO_SZ, height: isMobile ? 44 : POOL_PHOTO_SZ, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: '2px solid rgba(245,158,11,0.7)', flexShrink: 0 }} />
          : <div style={{ width: isMobile ? 44 : POOL_PHOTO_SZ, height: isMobile ? 44 : POOL_PHOTO_SZ, borderRadius: '50%', background: 'rgba(245,158,11,0.15)', border: '2px solid rgba(245,158,11,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>👤</div>
        }
        <div style={{ flex: isMobile ? 1 : undefined, minWidth: 0, width: isMobile ? undefined : '100%' }}>
          <div style={{ fontSize: isMobile ? 13 : 11, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: isMobile ? 'left' : 'center' }}>
            {isMobile ? (worker.employees?.name ?? '?') : (worker.employees?.name?.split(' ')[0] ?? '?')}
          </div>
          <div style={{ fontSize: isMobile ? 11 : 9, color: '#f59e0b', fontWeight: 700, background: 'rgba(245,158,11,0.15)', borderRadius: 3, padding: isMobile ? '2px 6px' : '1px 6px', marginTop: 2, display: isMobile ? 'inline-block' : 'block', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 140 : '100%', whiteSpace: 'nowrap', textAlign: 'center' }}>
            {task?.task_type || 'งานพิเศษ'}
          </div>
          {worker.employees?.section && (
            <div style={{ fontSize: isMobile ? 10 : 9, color: '#a78bfa', background: 'rgba(167,139,250,0.12)', borderRadius: 3, padding: isMobile ? '1px 6px' : '1px 6px', marginTop: 2, display: isMobile ? 'inline-block' : 'block', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 140 : '100%', whiteSpace: 'nowrap', textAlign: 'center' }}>
              📍 {worker.employees.section}
            </div>
          )}
        </div>
        {/* remove button — leader+ */}
        {['admin','manager','supervisor','leader'].includes(role) && (
          <button onClick={(e) => { e.stopPropagation(); removeSpecialTask(worker); }}
            style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(239,68,68,0.85)', border: 'none', color: '#fff', fontSize: 11, lineHeight: '22px', textAlign: 'center', cursor: 'pointer', padding: 0 }}>
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
          position: 'relative',
          width: '100%',
          padding: '8px 6px 6px',
          background: isSelected ? 'rgba(77,159,255,0.22)' : 'rgba(8,8,14,0.88)',
          border: isSelected ? '2px solid #4d9fff' : '1.5px solid rgba(77,159,255,0.45)',
          borderLeft: isSelected ? '4px solid #4d9fff' : '4px solid rgba(77,159,255,0.55)',
          borderRadius: 8,
          cursor: isMobile ? 'pointer' : 'grab',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          boxShadow: isSelected ? '0 0 0 3px rgba(77,159,255,0.3), 0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.5)',
          userSelect: 'none', backdropFilter: 'blur(3px)',
          transition: 'all 0.15s',
          transform: isSelected ? 'scale(1.04)' : 'scale(1)',
        }}
      >
        {/* photo */}
        {worker.employees?.image_url
          ? <img src={worker.employees.image_url} style={{ width: POOL_PHOTO_SZ, height: POOL_PHOTO_SZ, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: `3px solid ${isSelected ? '#4d9fff' : 'rgba(77,159,255,0.7)'}`, boxShadow: isSelected ? '0 0 10px rgba(77,159,255,0.5)' : 'none', flexShrink: 0, display: 'block' }} />
          : <div style={{ width: POOL_PHOTO_SZ, height: POOL_PHOTO_SZ, borderRadius: '50%', background: 'rgba(77,159,255,0.15)', border: '3px solid rgba(77,159,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>👤</div>
        }
        {/* header: name */}
        <div style={{ width: '100%', fontSize: 11, fontWeight: 700, color: isSelected ? '#4d9fff' : '#c8c8d0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', flexShrink: 0 }}>
          {worker.employees?.name?.split(' ')[0] ?? '?'}
        </div>
        {/* team badge */}
        {worker.employees?.team && (
          <div style={{ fontSize: 9, fontWeight: 800, color: '#4d9fff', background: 'rgba(77,159,255,0.18)', borderRadius: 3, padding: '1px 6px', flexShrink: 0 }}>
            Team {worker.employees.team}
          </div>
        )}
        {/* assign to special task */}
        {['admin','manager','supervisor','leader'].includes(role) && (
          <button onClick={(e) => { e.stopPropagation(); setSpecialModal(worker); setSpecialTaskType('5ส'); }}
            title="กำหนดงานนอกไลน์"
            style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(245,158,11,0.9)', border: '1px solid rgba(0,0,0,0.3)', color: '#fff', fontSize: 11, lineHeight: '22px', textAlign: 'center', cursor: 'pointer', padding: 0 }}>
            🏷
          </button>
        )}
      </div>
    );
  };

  /* ── Station worker ── */
  const StationWorker = ({ worker, fit, stationName }) => {
    const fc = fitColor(fit.score);
    return (
      <div
        draggable={!isMobile}
        onDragStart={!isMobile ? (e) => handleDragStart(e, worker) : undefined}
        onDragEnd={!isMobile ? handleDragEnd : undefined}
        onMouseEnter={!isMobile ? (e) => onHoverEnter(e, worker, fit, stationName) : undefined}
        onMouseLeave={!isMobile ? onHoverLeave : undefined}
        style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isMobile ? 'pointer' : 'grab', userSelect: 'none' }}
      >
        {/* photo only — score & name now live exclusively in the hover popup card so the
            small on-map circle isn't cropped/obscured by an overlaid number */}
        <div style={{ position: 'relative', width: STATION_PHOTO_SZ, height: STATION_PHOTO_SZ, flexShrink: 0 }}>
          {worker.employees?.image_url
            ? <img src={worker.employees.image_url} style={{ width: STATION_PHOTO_SZ, height: STATION_PHOTO_SZ, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', pointerEvents: 'none', border: `2px solid ${fc}`, boxShadow: `0 0 8px ${fc}88`, display: 'block' }} />
            : <div style={{ width: STATION_PHOTO_SZ, height: STATION_PHOTO_SZ, borderRadius: '50%', background: `${fc}22`, border: `2px solid ${fc}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>👤</div>
          }
        </div>
      </div>
    );
  };

  /* ── Pending doc logs by line ── */
  const pendingDocByLine = {};
  for (const m of fourMLogs) {
    if (m.status === 'pending_doc') {
      if (!pendingDocByLine[m.line_name]) pendingDocByLine[m.line_name] = [];
      pendingDocByLine[m.line_name].push(m);
    }
  }

  /* ── Layout ── */
  const poolW = isMobile ? '100%' : panelCollapsed ? 44 : isUltra ? 280 : isWide ? 248 : 220;
  const poolStyle = isMobile
    ? { width: '100%', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '10px 12px', flexShrink: 0, maxHeight: '42vh', display: 'flex', flexDirection: 'column' }
    : { width: poolW, minWidth: poolW, background: 'var(--bg2)', borderRight: '1px solid var(--border)', padding: panelCollapsed ? '12px 6px' : isWide ? '18px 12px' : '15px 10px', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: panelCollapsed ? 'hidden' : 'auto', transition: 'width 0.25s ease, min-width 0.25s ease' };

  const isOpenIssue = m => m.status !== 'approved' && m.status !== 'rejected';

  // ตัวเลข badge บนปุ่ม toggle ต้องสื่อความหมาย "ผิดปกติ" ไม่ใช่แค่จำนวนจุดทั้งหมด
  const vacantStationCount = dynamicStations.filter(st => !workers.some(w => String(w.assigned_line) === String(st.id))).length;
  const lowWipCount = wipPoints.filter(p => (p.current_qty ?? 0) < (p.min_qty ?? 0)).length;

  const STATUS_FILTERS = [
    { key: 'man',     on: filterMan,     toggle: () => setFilterMan(v => !v),     label: 'MAN',     icon: '👤', color: '#4d9fff', count: vacantStationCount, title: 'แสดง/ซ่อนจุดงาน (คน) บนผัง — ตัวเลข = จุดที่ยังไม่มีคนประจำ' },
    { key: 'machine', on: filterMachine, toggle: () => setFilterMachine(v => !v), label: 'MACHINE', icon: '⚙️', color: '#f59e0b', count: 0,                  title: 'แสดง/ซ่อนจุดเครื่องจักรบนผัง' },
    { key: 'wip',     on: filterWip,     toggle: () => setFilterWip(v => !v),     label: 'WIP',     icon: '📦', color: '#22c55e', count: lowWipCount,        title: 'แสดง/ซ่อนจุด WIP บนผัง — ตัวเลข = จุดที่ของต่ำกว่า min' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', width: '100%', height: 'calc(100vh - 80px)', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* MAN / MACHINE / WIP status filters — fixed, sit just left of the global notification bell */}
      <div style={{ position: 'fixed', top: 10, right: 58, zIndex: 1200, display: 'flex', gap: 6 }}>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={f.toggle}
            title={f.title}
            style={{
              position: 'relative',
              width: 36, height: 36, borderRadius: 8,
              background: f.on ? `${f.color}38` : 'var(--bg3)',
              border: f.on ? `1px solid ${f.color}` : '1px solid var(--border2)',
              color: f.on ? f.color : 'var(--text2)', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
            }}
          >
            {f.icon}
            {f.count > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: f.color, color: '#fff',
                fontSize: 10, fontWeight: 800,
                minWidth: 17, height: 17, borderRadius: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 3px', lineHeight: 1,
              }}>
                {f.count > 99 ? '99+' : f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Pool Panel ── */}
      <div style={poolStyle}>
        {/* Collapse toggle (desktop only) */}
        {!isMobile && (
          <button
            onClick={() => setPanelCollapsed(c => !c)}
            title={panelCollapsed ? 'ขยาย panel' : 'ย่อ panel'}
            style={{ alignSelf: panelCollapsed ? 'center' : 'flex-end', marginBottom: panelCollapsed ? 8 : 6, flexShrink: 0, width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {panelCollapsed ? '▶' : '◀'}
          </button>
        )}
        {!panelCollapsed && (<>
        <div style={{ marginBottom: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>ไลน์ผลิต</div>
          <select value={selectedLine} onChange={(e) => !isLeader && setSelectedLine(e.target.value)} disabled={isLeader}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 13, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', opacity: isLeader ? 0.7 : 1 }}>
            {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
          {childLineNames.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
              🔗 รวมไลน์ย่อย: {childLineNames.join(', ')}
            </div>
          )}
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
          <div style={{ overflowY: 'auto', display: isMobile ? 'flex' : 'grid', gridTemplateColumns: isUltra ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', flexDirection: 'column', gap: isWide ? 7 : 6, ...(isMobile ? { maxHeight: '28vh' } : { flex: '7 0 0', minHeight: 0 }) }}>
            {poolWorkers.map(w => <PoolCard key={w.id} worker={w} />)}
            {poolWorkers.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: '8px 0', gridColumn: '1/-1' }}>ไม่มีพนักงานใน Pool</div>
            )}
          </div>

          {/* Special task pool — 30% */}
          <div
            onDragOver={!isMobile ? (e) => e.preventDefault() : undefined}
            onDrop={!isMobile ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              const logId = e.dataTransfer.getData('logId');
              const w = workers.find(wk => String(wk.id) === String(logId));
              if (w) { setSpecialModal(w); setSpecialTaskType('5ส'); setDraggingWorker(null); }
            } : undefined}
            style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed rgba(245,158,11,0.4)', flexShrink: 0 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', fontFamily: 'var(--font-display)' }}>🟡 งานนอกไลน์</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{specialWorkers.length} คน</span>
            </div>
            {hasPermission('manage_master_data', role) && specialWorkers.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5, fontStyle: 'italic' }}>drag กลับไลน์ผลิตได้</div>
            )}
          </div>
          <div
            onDragOver={!isMobile ? (e) => e.preventDefault() : undefined}
            onDrop={!isMobile ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              const logId = e.dataTransfer.getData('logId');
              const w = workers.find(wk => String(wk.id) === String(logId));
              if (w) { setSpecialModal(w); setSpecialTaskType('5ส'); setDraggingWorker(null); }
            } : undefined}
            style={{ overflowY: 'auto', display: isMobile ? 'flex' : 'grid', gridTemplateColumns: isUltra ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', flexDirection: 'column', gap: isWide ? 7 : 6, ...(isMobile ? { maxHeight: '15vh' } : { flex: '3 0 0', minHeight: 0 }) }}>
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
                  width: '100%', marginBottom: 5, padding: isWide ? '8px 10px' : '6px 8px', fontSize: isWide ? 12 : 11, textAlign: 'left', borderRadius: 6, cursor: 'pointer',
                  background: cat === 'Machine' ? 'rgba(245,158,11,0.12)' : cat === 'Material' ? 'rgba(34,197,94,0.12)' : 'rgba(139,92,246,0.12)',
                  color: cat === 'Machine' ? 'var(--amber)' : cat === 'Material' ? 'var(--green)' : '#c084fc',
                  border: `1px solid ${cat === 'Machine' ? 'rgba(245,158,11,0.3)' : cat === 'Material' ? 'rgba(34,197,94,0.3)' : 'rgba(139,92,246,0.3)'}`,
                }}>
                {cat === 'Machine' ? '⚙️' : cat === 'Material' ? '📦' : '📋'} {cat}
              </button>
            ))}
          </div>
        )}
        </>)} {/* /panelCollapsed */}
      </div>

      {/* ── Canvas Area ── */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative', padding: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {autoManAlert && (
          <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', background: 'rgba(77,159,255,0.95)', color: '#fff', padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 600, zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>
            🆕 Man Change: {autoManAlert.name} — ประจำ {autoManAlert.station} เป็นครั้งแรก
          </div>
        )}


        {/* ── Mini Heijunka board ── */}
        {lineProdData && (() => {
          const HOURS = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6,7];
          const LEFT_W = 110;
          const nowMs = nowForBoard.current.getTime();
          const wd = lineProdData.workDate;
          const gridStartMs = new Date(`${wd}T08:00:00`).getTime();
          const gridEndMs   = gridStartMs + 24 * 3600000;
          const isHistorical = nowMs >= gridEndMs;   // วันงานที่ดูอยู่จบไปแล้ว (โหมดย้อนหลัง)
          const isFutureDay  = nowMs < gridStartMs;
          const pctPerMs = 100 / (12 * 3600000);
          const HALVES = [
            { key: 'am', hours: HOURS.slice(0, 12), startMs: gridStartMs },
            { key: 'pm', hours: HOURS.slice(12), startMs: gridStartMs + 12 * 3600000 },
          ];
          const fmtMs = (ms) => {
            const d = new Date(ms);
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          };
          const { sessions } = lineProdData;
          const ctByMatNo = lineProdData.ctByMatNo || {};
          const nameByMatNo = lineProdData.nameByMatNo || {};
          const imgByMatNo = lineProdData.imgByMatNo || {};
          const breakPolicies = lineProdData.breakPolicies || [];
          const getBreakIntervals = (half) => breakPolicies
            .filter(p => p.shift === 'both' || (p.shift === 'day' && half.key === 'am') || (p.shift === 'night' && half.key === 'pm'))
            .map(p => {
              const idx = half.hours.indexOf(Number(String(p.start_time).slice(0,2)));
              if (idx < 0) return null;
              const mins = Number(String(p.start_time).slice(3,5)) || 0;
              const s = half.startMs + idx * 3600000 + mins * 60000;
              const e = s + (p.duration_min || 0) * 60000;
              return [s, e];
            })
            .filter(Boolean)
            .sort((a, b) => a[0] - b[0]);

          // คำนวณคิวทั้งวัน (24 ชม.) ครั้งเดียวต่อแถว product แทนการตัดแยกทีละกะ
          // เพื่อให้การ์ดที่ดีเลย์ล้นข้ามกะ (เช่น ผลิตจากกะเช้าไปจบกะดึก) ต่อแถวเดิมได้ ไม่ถูกตัดทิ้งที่ขอบกะ
          // (ใช้ logic เดียวกับ Dashboard.jsx เพื่อให้ตำแหน่ง/ความกว้างของการ์ดตรงกันทั้งสองหน้า)
          const MIN_W_PCT = 1.5;
          const ROUND_MS = 2 * 3600000;
          const roundIndexOf = (ms) => Math.floor((ms - gridStartMs) / ROUND_MS);
          const roundStartOf = (idx) => gridStartMs + idx * ROUND_MS;
          const allBreaksOnce = () => [...getBreakIntervals(HALVES[0]), ...getBreakIntervals(HALVES[1])].sort((a, b) => a[0] - b[0]);

          const computeQueuedPositionsFull = (cards) => {
            const breaks = allBreaksOnce();
            const filtered = cards.filter(o => o.orderStartMs && o.orderEndMs);
            const byOpenTime = [...filtered].sort((a, b) => a.orderStartMs - b.orderStartMs);
            // คิวแสดงผลจริง: ใบที่ "ปิดแล้ว" (confirm) คือลำดับการผลิตที่เกิดขึ้นจริง ให้แทรกเข้าคิวก่อนตามเวลาปิดจริง
            // (confirmed_at) เสมอ — ใบที่ "ยังไม่ปิด" ถือว่ายังไม่ถึงตาที่ผลิตจริง ต้องถีบไปต่อท้ายคิวเสมอ ไม่ว่าจะ
            // เปิดมาก่อนนานแค่ไหนก็ตาม ผลคือถ้ามีใบ confirm มาแทรก จะดันใบที่ยังไม่ปิดถอยไปอยู่หลังสุด ไม่บังพื้นที่
            // ของใบที่ทำสำเร็จไปแล้วจริง ๆ — ทำให้เหลือใบแดง (ยังไม่ปิด) แค่เท่าที่จำเป็นจริง ๆ
            const doneCards = filtered.filter(o => o.isDone && o.confirmed_at)
              .sort((a, b) => new Date(a.confirmed_at).getTime() - new Date(b.confirmed_at).getTime() || a.orderStartMs - b.orderStartMs);
            const openCards = filtered.filter(o => !(o.isDone && o.confirmed_at))
              .sort((a, b) => a.orderStartMs - b.orderStartMs);
            const sorted = [...doneCards, ...openCards];
            // ── ชุดสแกนปิดรวด (batch confirm) ──────────────────────────────────────
            // เครื่องจักรยังไม่ส่งสัญญาณจบทีละใบ พนักงานจึงสแกนปิดทั้งล็อตรวดเดียว (เช่น 9 ใบติดกัน)
            // ถ้าตัดสิน "ปิดช้า" รายใบจาก confirmed_at ใบแรก ๆ ของชุดจะกลายเป็นส้มเกินจริงเสมอ
            // จึงจัดกลุ่มใบที่สแกนห่างกันไม่เกิน 5 นาทีเป็นชุดเดียว แล้วตัดสินความช้าที่ใบสุดท้ายของชุด
            // (เทียบเวลาสแกนจบชุด กับเวลาจบตามทฤษฎีของงานทั้งชุด)
            const BATCH_GAP_MS = 5 * 60000;
            const batchIdOf = new Map();
            let curBatchId = 0;
            doneCards.forEach((o, i) => {
              if (i > 0 && new Date(o.confirmed_at).getTime() - new Date(doneCards[i - 1].confirmed_at).getTime() > BATCH_GAP_MS) curBatchId++;
              batchIdOf.set(o, curBatchId);
            });
            const batchCount = new Map();
            doneCards.forEach(o => { const b = batchIdOf.get(o); batchCount.set(b, (batchCount.get(b) || 0) + 1); });
            const batchSeen = new Map();
            // เงื่อนไขผสม: ใบที่ยังไม่ปิด+เกินเวลาจะตีแดงก็ต่อเมื่อ "ยอดรวมจริงของแถวนี้ยังไม่ทันเป้าตามเวลา" ด้วย
            // ถ้ายอดรวมทันเป้าอยู่ (แค่สแกนปิดไม่ตรง FIFO) จะไม่ตีแดง เพราะงานยังผลิตได้ตามแผนจริง
            const ctSec = ctByMatNo[byOpenTime[0]?.mat_no] || 0;
            const rowActualQty = cards.reduce((a, c) => a + (c.isDone ? (c.qty_ok ?? c.qty ?? 0) : (c.qty_actual ?? 0)), 0);
            const firstStartMs = byOpenTime.length ? byOpenTime[0].orderStartMs : null;
            let expectedQty = Infinity;
            if (ctSec > 0 && firstStartMs) {
              let elapsedMs = Math.max(0, Math.min(nowMs, firstStartMs + 24 * 3600000) - firstStartMs);
              breaks.forEach(([bs, be]) => {
                const os = Math.max(bs, firstStartMs), oe = Math.min(be, nowMs);
                if (oe > os) elapsedMs -= (oe - os);
              });
              expectedQty = Math.max(0, elapsedMs) / 1000 / ctSec;
            }
            const rowBehindPace = rowActualQty < expectedQty;
            let queueEndMs = -Infinity;
            let curRoundIdx = null;
            return sorted.map(o => {
              const roundIdx = roundIndexOf(o.orderStartMs);
              // ห้ามให้ queueEndMs ถอยหลัง — ถ้าการ์ดก่อนหน้ายาวคร่อมเข้ารอบถัดไป (duration ยาวจาก qty×ct)
              // ต้องเดินคิวต่อจากที่มันจบจริง ไม่ใช่กระโดดกลับไปที่จุดเริ่มรอบใหม่ (จะทำให้ทับกัน)
              if (curRoundIdx === null || roundIdx !== curRoundIdx) {
                curRoundIdx = roundIdx;
                queueEndMs = Math.max(queueEndMs, roundStartOf(roundIdx));
              }
              const durationMs = Math.max(o.orderEndMs - o.orderStartMs, 0);
              let startMs = Math.max(o.orderStartMs, queueEndMs);
              let endMs = startMs + durationMs;
              // ถ้าช่วงเวลาผลิตของการ์ดนี้ทับเวลาพักเบรค ไม่เลื่อน startMs ไปหลังเบรค (เพราะจะทำให้
              // เวลาที่ "ว่าง" ก่อนเบรคเสียไปฟรี ๆ) แต่ให้ "ซอย" ทับเบรคแล้วยืดความยาวการ์ดออกแทน
              const consumedBreaks = new Set();
              let extended = true;
              while (extended) {
                extended = false;
                breaks.forEach(([bs, be], i) => {
                  if (consumedBreaks.has(i)) return;
                  if (bs < endMs && be > startMs) {
                    consumedBreaks.add(i);
                    endMs += (be - bs);
                    extended = true;
                  }
                });
              }
              // กฎตายตัว: ใบกัมบังห้ามซ้อนทับกันเอง และความกว้างต้องไม่สั้นกว่า durationMs (qty × ct) เด็ดขาด
              // ดังนั้นถ้าปิดงานเร็วกว่าทฤษฎี (confirmed_at < endMs) จะไม่บีบ/เลื่อนตำแหน่งตาม confirmed_at เลย —
              // ปล่อยให้การ์ดอยู่ตามคิว (queueFloor + durationMs) เหมือนเดิม ใช้ confirmed_at แค่ตัดสินสี/ไอคอนเท่านั้น
              // ส่วนกรณีปิดงานช้ากว่าทฤษฎี (isLateDone) ปล่อยให้ endMs เดิม + แสดง "หาง" ของความช้าแยกต่างหาก (ไม่ขยับการ์ดหลัก)
              // ปิดช้า: ใบเดี่ยวตัดสินตามเดิม · ใบในชุดสแกนรวดเดียวตัดสินเฉพาะใบสุดท้ายของชุด
              // (ใบแรก ๆ ของชุดถือว่าจบตามคิวทฤษฎี เพราะเวลาสแกนไม่ใช่เวลาผลิตจบจริงของใบนั้น)
              let isLateDone = false;
              if (o.isDone && o.confirmed_at) {
                const bid = batchIdOf.get(o);
                const size = batchCount.get(bid) || 1;
                const seen = (batchSeen.get(bid) || 0) + 1;
                batchSeen.set(bid, seen);
                if (size === 1 || seen === size)
                  isLateDone = new Date(o.confirmed_at).getTime() > endMs + (size > 1 ? BATCH_GAP_MS : 0);
              }
              let occupiedEndMs = endMs;
              if (isLateDone) {
                occupiedEndMs = new Date(o.confirmed_at).getTime();
              } else if (!o.isDone && !o.isCarry && nowMs > endMs) {
                occupiedEndMs = nowMs;
              }
              // เดินคิวต้องไม่ขยับมาก่อน endMs ของการ์ดนี้เด็ดขาด (ไม่งั้นใบถัดไปจะมาทับกล่องที่แสดงอยู่)
              // ถ้าปิดช้ากว่าทฤษฎี (isLateDone) ค่อยยืดคิวต่อไปถึง occupiedEndMs (confirmed_at จริง) กันใบถัดไปทับ "หาง"
              // ถ้าปิดเร็ว/ยังไม่ปิด ใช้ endMs เดิม — ห้ามใช้ confirmed_at ที่เร็วกว่ามาเลื่อนคิวให้สั้นลง
              queueEndMs = isLateDone ? occupiedEndMs : endMs;
              const isDelayed = !o.isDone && !o.isCarry && !o.is_backfill && endMs < nowMs && rowBehindPace;
              return { o, startMs, endMs, occupiedEndMs, isDelayed, isLateDone };
            }).map((item, i, arr) => {
              // ใบที่ยังไม่ปิด+เลยกำหนด หางสีแดงจะยืดไปถึง "ตอนนี้" เสมอ — แต่ถ้าใบถัดไปเริ่มทำงานไปแล้ว
              // (แสดงว่าคิวเดินต่อไปจริงแล้ว) ต้องตัดหางแดงให้สุดแค่จุดที่ใบถัดไปเริ่ม ไม่ให้ยืดไปทับใบถัดไป
              if (item.isDelayed && arr[i + 1]) {
                return { ...item, occupiedEndMs: Math.min(item.occupiedEndMs, arr[i + 1].startMs) };
              }
              return item;
            });
          };

          // ตัดผลคิวทั้งวัน (ms จริง) มาเป็น % สำหรับ "กะ" หนึ่ง ๆ — การ์ดเดียวกันแสดงต่อกันได้ทั้ง 2 กะ
          const pctForHalf = (item, half) => {
            const hs = half.startMs, he = half.startMs + 12 * 3600000;
            const rightMs = item.isLateDone ? item.occupiedEndMs : item.endMs;
            if (rightMs <= hs || item.startMs >= he) return null;
            const leftPct = Math.max(0, (item.startMs - hs) * pctPerMs);
            const rightPct = Math.max(0, Math.min(100, (rightMs - hs) * pctPerMs));
            const widthPct = Math.max(MIN_W_PCT, rightPct - leftPct);
            let tailLeftPct = 0, tailWidthPct = 0;
            if (item.isDelayed && item.occupiedEndMs > rightMs) {
              const tLeft  = Math.max(0, Math.min(100, (rightMs - hs) * pctPerMs));
              const tRight = Math.max(0, Math.min(100, (item.occupiedEndMs - hs) * pctPerMs));
              tailLeftPct = tLeft;
              tailWidthPct = Math.max(0, tRight - tLeft);
            }
            return { o: item.o, leftPct, widthPct, tailLeftPct, tailWidthPct, realEndMs: item.endMs, isDelayed: item.isDelayed, isLateDone: item.isLateDone, startMs: item.startMs };
          };

          const buildCards = (sessList) => {
            const cards = [];
            sessList.forEach(s => {
              const sessionCtSec = s.dr_products?.cycle_time_sec || 0;
              // ใบที่ status = carry_over คือใบเดิมที่ถูกยกยอดไปต่อในกะถัดไปแล้ว (มีใบใหม่ status='open'
              // พร้อม carry_over_from_session_id ชี้กลับมา) — ถ้าแสดงทั้งสองใบจะเห็นเป็นกัมบังซ้อนทับกัน
              // ข้ามกะเช้า/กะดึก ทั้งที่เป็นงานเดียวกัน จึงตัดใบเดิม (carry_over) ออกจาก timeline
              const sorted = [...s.orders].filter(o => o.status !== 'carry_over').sort((a, b) => new Date(a.opened_at || 0) - new Date(b.opened_at || 0));
              sorted.forEach(o => {
                const ctSec = ctByMatNo[o.mat_no] || sessionCtSec || 0;
                // ใช้ opened_at เป็น start จริง — ไม่ accumulate จาก session start
                // เพื่อไม่ให้ order ที่ยิงตอนบ่ายกลายเป็น delay ทันที
                const orderStartMs = o.opened_at ? new Date(o.opened_at).getTime() : null;
                let orderEndMs   = orderStartMs && ctSec > 0 ? orderStartMs + (o.qty || 0) * ctSec * 1000 : null;
                if (orderStartMs && !orderEndMs) orderEndMs = orderStartMs + 5 * 60000;
                const isDone    = o.status === 'confirmed';
                const isCarry   = o.status === 'carry_over';
                const isDelayed = !isDone && !isCarry && !o.is_backfill && !!orderEndMs && nowMs > orderEndMs;
                const productKey = (nameByMatNo[o.mat_no] || s.dr_products?.name || '').trim().toUpperCase() || o.mat_no || 'unknown';
                const productLabel = nameByMatNo[o.mat_no] || s.dr_products?.name || o.mat_no || 'ไม่ทราบ P/N';
                const productImg = imgByMatNo[o.mat_no] || '';
                cards.push({ ...o, orderStartMs, orderEndMs, isDone, isCarry, isDelayed, productKey, productLabel, productImg, shift: s.shift, sessionOpen: s.status === 'open' });
              });
            });
            return cards;
          };

          const allCards = buildCards(sessions);

          // ── Downtime ของไลน์นี้ — แถบ ⛔ บนไทม์ไลน์ + สาเหตุใน tooltip ของใบที่ดีเลย์/ปิดช้า ──
          const dtWindows = sessions.flatMap(sx => (sx.dtLogs || []).map(d => {
            const ds = d.started_at ? new Date(d.started_at).getTime() : null;
            if (ds == null) return null;
            const de = d.ended_at ? new Date(d.ended_at).getTime() : ds + (d.duration_min || 0) * 60000;
            return {
              s: ds, e: Math.max(de, ds + 60000), name: d.dr_downtime_types?.name_th || 'Downtime',
              machine: d.machine_no || '', desc: d.description || '',
              planned: d.dr_downtime_types?.category === 'planned',
              min: d.duration_min || Math.round((de - ds) / 60000),
            };
          }).filter(Boolean)).sort((a, b) => a.s - b.s);
          const dtLabel = (w) => `⛔ ${w.name}${w.machine ? ` @${w.machine}` : ''} ${fmtMs(w.s)}–${fmtMs(w.e)} (${w.min}น.)${w.desc ? ` — ${w.desc}` : ''}`;
          const dtTooltip = (a, b) => {
            const hits = dtWindows.filter(w => w.s < b && w.e > a);
            return hits.length ? ` · สาเหตุที่เป็นไปได้: ${hits.map(dtLabel).join(' · ')}` : ' · ไม่มีบันทึก downtime ในช่วงนี้';
          };

          // แยกแถวตาม mat_no/product — ไม่ให้ product ต่างกัน (เช่น RH/LH) ปนแถวเดียวกัน
          const groups = {};
          allCards.forEach(c => {
            (groups[c.productKey] = groups[c.productKey] || { key: c.productKey, label: c.productLabel, img: c.productImg, cards: [] }).cards.push(c);
          });
          const productRows = Object.values(groups).sort((a, b) => a.label.localeCompare(b.label));

          const totalDelayed = productRows.reduce((sum, row) =>
            sum + computeQueuedPositionsFull(row.cards).filter(p => p.isDelayed).length, 0);
          const hasOpen = sessions.some(s => s.status === 'open');

          const openByMatNo = {};
          sessions.forEach(s => s.orders.forEach(o => {
            if (o.status === 'open') openByMatNo[o.mat_no] = (openByMatNo[o.mat_no] || 0) + 1;
          }));
          const matNoChips = Object.entries(openByMatNo);

          // ── Smart planner: คาดการณ์เวลาเสร็จ + คำแนะนำ OT (logic เดียวกับ Dashboard) ──
          // กะเช้า: OT ต่อท้ายกะ (เลิก 17:30, OT ถึง 20:00) · กะดึก: OT อยู่หัวกะ (เข้าปกติ 22:30, เปิด OT = เข้า 20:00)
          const plannerChips = (() => {
            const DAY_REG_END  = gridStartMs + 9.5  * 3600000;  // 17:30
            const DAY_OT_END   = gridStartMs + 12   * 3600000;  // 20:00
            const NIGHT_OT_IN  = gridStartMs + 12   * 3600000;  // 20:00 (เข้าแบบเปิด OT)
            const NIGHT_REG_IN = gridStartMs + 14.5 * 3600000;  // 22:30 (เข้าปกติ)
            const FRAME_END    = gridEndMs;                     // 08:00
            const finishFrom = (startMs, workMs) => {
              const breaks = allBreaksOnce();
              let end = startMs + workMs;
              const consumed = new Set();
              let ext = true;
              while (ext) {
                ext = false;
                breaks.forEach(([bs, be], i) => {
                  if (consumed.has(i)) return;
                  if (bs < end && be > startMs) { consumed.add(i); end += be - bs; ext = true; }
                });
              }
              return end;
            };
            const chips = [];
            ['day', 'night'].forEach(shift => {
              let remainCards = 0, remainQty = 0, projEndMs = null, noCt = 0, workMs = 0, started = false;
              productRows.forEach(row => {
                computeQueuedPositionsFull(row.cards).forEach(item => {
                  if (item.o.shift !== shift) return;
                  if (item.o.isDone || (item.o.qty_actual || 0) > 0) started = true;
                  if (item.o.isDone || item.o.isCarry) return;
                  remainCards++;
                  const rq = Math.max(0, (item.o.qty || 0) - (item.o.qty_actual || 0));
                  remainQty += rq;
                  const ct = ctByMatNo[item.o.mat_no] || 0;
                  if (ct > 0) workMs += rq * ct * 1000; else noCt++;
                  const end = Math.max(item.endMs, item.occupiedEndMs);
                  projEndMs = projEndMs == null ? end : Math.max(projEndMs, end);
                });
              });
              if (!remainCards) return;
              const sLabel = shift === 'day' ? '☀️' : '🌙';
              if (isHistorical) {
                chips.push({ color: '#ef4444', text: `${sLabel} งานไม่จบในกะ ${remainCards} ใบ (~${remainQty.toLocaleString()} ชิ้น)` });
                return;
              }
              if (isFutureDay || projEndMs == null) return;
              if (noCt === remainCards) {
                chips.push({ color: 'var(--muted)', text: `${sLabel} คาดการณ์ไม่ได้ — งานค้าง ${remainCards} ใบไม่มี cycle time` });
                return;
              }
              if (shift === 'day') {
                const projLabel = `~${fmtMs(projEndMs)}`;
                const otMin = Math.ceil((projEndMs - DAY_REG_END) / 60000);
                if (projEndMs <= DAY_REG_END) {
                  chips.push({ color: '#22c55e', text: `${sLabel} คาดเสร็จ ${projLabel} — จบในเวลาปกติ (ก่อน 17:30) ไม่ต้องเปิด OT` });
                } else if (projEndMs <= DAY_OT_END) {
                  chips.push({ color: '#f59e0b', text: `${sLabel} คาดเสร็จ ${projLabel} — ⏰ ต้องเปิด OT ~${otMin} นาที (เลิก 17:30 → ผลิตถึง ${projLabel})` });
                } else {
                  chips.push({ color: '#ef4444', text: `${sLabel} คาดเสร็จ ${projLabel} — 🚨 เกินกรอบ OT (20:00) ควรวางแผนยกยอด/เพิ่มกำลังผลิต` });
                }
                return;
              }
              // กะดึก — ก่อนเริ่มกะ: ตัดสินใจว่าต้องเรียกเข้า 20:00 มั้ย · เริ่มแล้ว: เทียบคิวจริงกับ 08:00
              if (nowMs < NIGHT_REG_IN && !started) {
                const normalFinish = finishFrom(Math.max(NIGHT_REG_IN, nowMs), workMs);
                if (normalFinish <= FRAME_END) {
                  chips.push({ color: '#22c55e', text: `${sLabel} เข้างานปกติ 22:30 ทัน — คาดเสร็จ ~${fmtMs(normalFinish)} (ก่อน 08:00) ไม่ต้องเปิด OT` });
                } else {
                  const otFinish = finishFrom(Math.max(NIGHT_OT_IN, nowMs), workMs);
                  if (otFinish <= FRAME_END) {
                    chips.push({ color: '#f59e0b', text: `${sLabel} ⏰ ต้องเปิด OT เข้า 20:00 — คาดเสร็จ ~${fmtMs(otFinish)} (ถ้าเข้า 22:30 จะจบ ~${fmtMs(normalFinish)} เกิน 08:00)` });
                  } else {
                    chips.push({ color: '#ef4444', text: `${sLabel} 🚨 เกินกำลังกะดึกแม้เข้า 20:00 (คาดเสร็จ ~${fmtMs(otFinish)}) — ควรวางแผนยกยอด/เพิ่มกำลัง` });
                  }
                }
                return;
              }
              const projLabel = `~${fmtMs(projEndMs)}`;
              if (projEndMs <= FRAME_END) {
                chips.push({ color: '#22c55e', text: `${sLabel} คาดเสร็จ ${projLabel} — จบภายในกะ (ก่อน 08:00)` });
              } else {
                chips.push({ color: '#ef4444', text: `${sLabel} คาดเสร็จ ${projLabel} — 🚨 เกิน 08:00 ควรวางแผนยกยอดไปกะถัดไป` });
              }
            });
            return chips;
          })();
          const todayWd = getWorkDate();
          const shiftBoardDate = (days) => {
            const d = new Date(`${boardDate}T12:00:00`);
            d.setDate(d.getDate() + days);
            setBoardDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
          };

          return (
            <div style={{
              marginBottom: 10,
              background: 'var(--card)',
              border: `1px solid ${totalDelayed > 0 ? 'rgba(239,68,68,0.45)' : hasOpen ? 'rgba(34,197,94,0.35)' : 'var(--border2)'}`,
              borderRadius: 10, overflow: 'hidden',
            }}>
              {/* Header */}
              <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg2)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                  📊 Heijunka — {selectedLine}
                  {isHistorical && <span style={{ marginLeft: 6, fontSize: 8, padding: '1px 6px', borderRadius: 10, background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>📅 ย้อนหลัง {boardDate}</span>}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => shiftBoardDate(-1)} style={{ padding: '1px 7px', borderRadius: 6, cursor: 'pointer', fontSize: 9, fontWeight: 700, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text2)' }}>◀</button>
                  <input type="date" value={boardDate} max={todayWd} onChange={e => e.target.value && setBoardDate(e.target.value)}
                    style={{ padding: '1px 5px', borderRadius: 6, fontSize: 9, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)' }} />
                  <button onClick={() => shiftBoardDate(1)} disabled={boardDate >= todayWd} style={{ padding: '1px 7px', borderRadius: 6, cursor: boardDate >= todayWd ? 'default' : 'pointer', fontSize: 9, fontWeight: 700, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text2)', opacity: boardDate >= todayWd ? 0.4 : 1 }}>▶</button>
                  {boardDate !== todayWd && (
                    <button onClick={() => setBoardDate(todayWd)} style={{ padding: '1px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 9, fontWeight: 700, background: 'var(--accent)', border: '1px solid var(--accent)', color: '#08130a' }}>วันนี้</button>
                  )}
                  {totalDelayed > 0 && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>⚠️ ดีเลย์ {totalDelayed} ใบ</span>}
                  {(() => {
                    // hierarchy: 1 ชิปต่อไลน์ย่อย แทนป้ายต่อ session
                    const byChild = {};
                    sessions.forEach(sx => { (byChild[sx.line_name] = byChild[sx.line_name] || []).push(sx); });
                    const names = Object.keys(byChild).sort();
                    const multi = names.length > 1 || (names.length === 1 && names[0] !== selectedLine);
                    return names.map(ln => {
                      const list = [...byChild[ln]].sort((a, b) => (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1));
                      const anyOpen = list.some(sx => sx.status === 'open');
                      return (
                        <span key={ln} style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, fontWeight: 700,
                          background: anyOpen ? 'rgba(34,197,94,0.15)' : 'rgba(128,128,128,0.12)',
                          color: anyOpen ? '#22c55e' : '#888' }}>
                          {multi && <span style={{ fontWeight: 800 }}>{ln} · </span>}
                          {list.map(sx => `${sx.shift === 'day' ? '☀️' : '🌙'}${sx.status === 'open' ? '●' : '✓'}`).join(' ')}
                          {anyOpen ? ' Live' : ' ปิด'}
                        </span>
                      );
                    });
                  })()}
                </div>
              </div>
              {/* Kanban ที่เปิดอยู่ ต่อ MAT.NO */}
              {matNoChips.length > 0 && (
                <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border2)', display: 'flex', gap: 6, flexWrap: 'wrap', background: 'var(--bg)' }}>
                  <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>🎴 Kanban เปิดอยู่:</span>
                  {matNoChips.map(([matNo, count]) => (
                    <span key={matNo} style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, fontWeight: 700, background: 'rgba(77,159,255,0.12)', color: '#4d9fff', fontFamily: 'monospace' }}>
                      {matNo} · {count} ใบ
                    </span>
                  ))}
                </div>
              )}
              {/* Legend สีสถานะ kanban */}
              <div style={{ padding: '4px 12px', borderBottom: '1px solid var(--border2)', display: 'flex', gap: 10, flexWrap: 'wrap', background: 'var(--bg)' }}>
                {[
                  { c: '#4d9fff', icon: '▶', label: 'กำลังผลิต' },
                  { c: '#22c55e', icon: '✓', label: 'เสร็จแล้ว' },
                  { c: '#f97316', icon: '✓!', label: 'เสร็จ (ช้ากว่ากำหนด)' },
                  { c: '#ef4444', icon: '!', label: 'ล่าช้า' },
                  { c: '#f59e0b', icon: '↷', label: 'ยกยอดข้ามกะ' },
                  { c: '#6b7280', icon: '⏪', label: 'ยิงย้อนหลัง' },
                  { c: '#ef4444', icon: '⛔', label: 'Downtime (แถบบนแถว)' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 2, background: `${item.c}28`, border: `1.2px solid ${item.c}cc`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, fontWeight: 800, color: item.c, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 600 }}>{item.label}</span>
                  </div>
                ))}
              </div>
              {/* 🧠 Smart planner — คาดการณ์เวลาเสร็จ / คำแนะนำ OT */}
              {plannerChips.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '5px 12px', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)' }}>
                  <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--muted)', alignSelf: 'center' }}>🧠 PLANNER</span>
                  {plannerChips.map((c, i) => (
                    <span key={i} style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: `${c.color === 'var(--muted)' ? 'rgba(148,163,184,0.12)' : c.color + '1f'}`, color: c.color, border: `1px solid ${c.color === 'var(--muted)' ? 'rgba(148,163,184,0.3)' : c.color + '55'}` }}>
                      {c.text}
                    </span>
                  ))}
                </div>
              )}
              {/* Timeline: 2 แถว × 12 ชม. แยกแถวตาม product (mat_no) */}
              {HALVES.map(half => (
                <div key={half.key} style={{ borderTop: half.key === 'pm' ? '2px solid var(--border2)' : 'none' }}>
                  {/* Hour header */}
                  <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)' }}>
                    <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid var(--border2)', padding: '4px 8px', fontSize: 8, fontWeight: 700, color: 'var(--muted)' }}>กะ / ผลิต</div>
                    {half.hours.map((h, i) => {
                      const slotMs = half.startMs + i * 3600000;
                      const isNow = nowMs >= slotMs && nowMs < slotMs + 3600000;
                      const isShiftBound = h === 8 || h === 20;
                      return (
                        <div key={i} style={{
                          flex: 1, minWidth: 0, textAlign: 'center',
                          fontSize: 8, fontWeight: isNow ? 800 : isShiftBound ? 600 : 400,
                          color: isNow ? '#4d9fff' : isShiftBound ? 'var(--text2)' : 'var(--muted)',
                          padding: '4px 0', lineHeight: 1,
                          borderRight: `1px solid ${isShiftBound ? 'var(--border2)' : 'var(--border)'}`,
                          background: isNow ? 'rgba(77,159,255,0.12)' : 'transparent',
                        }}>
                          {String(h).padStart(2,'0')}:00
                          {isNow && <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#4d9fff', margin: '1px auto 0' }} />}
                        </div>
                      );
                    })}
                  </div>
                  {/* Rows ต่อ product */}
                  {productRows.map((row, ri) => {
                    const rowActual = row.cards.reduce((a, c) => a + (c.isDone ? (c.qty_ok ?? c.qty ?? 0) : (c.qty_actual ?? 0)), 0);
                    const rowDemand = row.cards.reduce((a, c) => a + (c.qty || 0), 0);
                    const doneCount = row.cards.filter(c => c.isDone).length;
                    const delayed   = computeQueuedPositionsFull(row.cards).map(item => pctForHalf(item, half)).filter(p => p && p.isDelayed).length;
                    const isOpen    = row.cards.some(c => c.sessionOpen);
                    const pct       = rowDemand > 0 ? Math.min((rowActual / rowDemand) * 100, 100) : 0;
                    const barColor  = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={row.key} style={{ display: 'flex', height: 34, borderTop: ri > 0 ? '1px solid var(--border2)' : 'none', overflow: 'hidden' }}>
                        <div style={{ width: LEFT_W, flexShrink: 0, padding: '3px 8px', borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                          {row.img && <img src={row.img} alt="" style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
                          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: LEFT_W - 16 }}>{row.label}</span>
                            {delayed > 0 && <span style={{ fontSize: 7, color: '#ef4444', fontWeight: 700 }}>⚠️{delayed}</span>}
                            {isOpen && delayed === 0 && <span style={{ fontSize: 7, color: '#22c55e', fontWeight: 700 }}>● Live</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 900, color: barColor, lineHeight: 1 }}>{rowActual}</span>
                            <span style={{ fontSize: 7, color: 'var(--muted)' }}>/{rowDemand} ชิ้น · {doneCount}/{row.cards.length}ใบ</span>
                          </div>
                          </div>
                        </div>
                        {/* Timeline cells + order blocks */}
                        <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
                          {half.hours.map((h, i) => {
                            const slotMs = half.startMs + i * 3600000;
                            const isNow = nowMs >= slotMs && nowMs < slotMs + 3600000;
                            const isShiftBound = h === 8 || h === 20;
                            return <div key={i} style={{ flex: 1, minWidth: 0, height: '100%', borderRight: `1px solid ${isShiftBound ? 'var(--border2)' : 'var(--border)'}`, background: isNow ? 'rgba(77,159,255,0.06)' : 'transparent' }} />;
                          })}
                          {(() => {
                            const breaks = getBreakIntervals(half);
                            return breaks.map(([bs, be], pi) => {
                                const leftPct = Math.max(0, (bs - half.startMs) * pctPerMs);
                                const widthPct = Math.min(100 - leftPct, (be - bs) * pctPerMs);
                                if (widthPct <= 0) return null;
                                const p = breakPolicies.find(bp => {
                                  const idx = half.hours.indexOf(Number(String(bp.start_time).slice(0,2)));
                                  if (idx < 0) return false;
                                  const mins = Number(String(bp.start_time).slice(3,5)) || 0;
                                  return half.startMs + idx * 3600000 + mins * 60000 === bs;
                                }) || {};
                                return (
                                  <div key={`brk-${pi}`} title={`${p.name_th || p.name_en} — ไลน์ไม่รองรับ KANBAN`}
                                    style={{
                                      position: 'absolute', top: 0, bottom: 0, left: `${leftPct}%`, width: `${widthPct}%`,
                                      background: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)',
                                      borderLeft: '1px dashed rgba(148,163,184,0.6)', borderRight: '1px dashed rgba(148,163,184,0.6)',
                                      zIndex: 0, pointerEvents: 'none',
                                    }}
                                  />
                                );
                              });
                          })()}
                          {/* ⛔ แถบ downtime — ชิดขอบบนแถว ชี้เมาส์ดูรายละเอียด */}
                          {dtWindows.map((w, di) => {
                            const l = Math.max(0, (w.s - half.startMs) * pctPerMs);
                            const rgt = Math.min(100, (w.e - half.startMs) * pctPerMs);
                            if (rgt <= 0 || l >= 100 || rgt <= l) return null;
                            return (
                              <div key={`dt-${di}`} title={dtLabel(w)}
                                style={{
                                  position: 'absolute', top: 0, height: 4, left: `${l}%`, width: `${Math.max(rgt - l, 0.4)}%`,
                                  background: w.planned ? '#94a3b8' : '#ef4444', opacity: 0.85,
                                  borderRadius: '0 0 3px 3px', zIndex: 3, cursor: 'help',
                                }} />
                            );
                          })}
                          {(() => {
                            const positioned = computeQueuedPositionsFull(row.cards).map(item => pctForHalf(item, half)).filter(Boolean);
                            return positioned.map(({ o, leftPct, widthPct, tailLeftPct, tailWidthPct, realEndMs, isDelayed, isLateDone, startMs }, oi) => {
                            if (leftPct >= 100) return null;
                            const sc = isLateDone ? '#f97316' : o.isDone ? '#22c55e' : isDelayed ? '#ef4444' : o.isCarry ? '#f59e0b' : o.is_backfill ? '#6b7280' : '#4d9fff';
                            const icon = o.isDone ? (isLateDone ? '✓!' : '✓') : isDelayed ? '!' : o.isCarry ? '↷' : o.is_backfill ? '⏪' : '▶';
                            const doneQty = o.isDone ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
                            const pctBlock = (o.qty || 0) > 0 ? Math.min((doneQty / o.qty) * 100, 100) : (o.isDone ? 100 : 0);
                            const causeText = isLateDone ? dtTooltip(startMs, new Date(o.confirmed_at).getTime())
                              : isDelayed ? dtTooltip(startMs, Math.min(nowMs, gridEndMs)) : '';
                            return (
                              <Fragment key={o.prod_no || oi}>
                              <div
                                title={`${o.prod_no || ''} ${o.mat_no || ''} — ${o.qty}ชิ้น${o.is_backfill ? ' ⏪ยิงย้อนหลัง' : isLateDone ? ` ✓เสร็จ (ช้ากว่ากำหนด${Math.round((new Date(o.confirmed_at).getTime()-realEndMs)/60000)}นาที)` : isDelayed ? ` ⚠️ช้า${Math.round((nowMs - realEndMs) / 60000)}นาที ยังไม่ปิด — ใบถัดไปถูกดันไปต่อท้าย` : o.isDone ? ' ✓เสร็จ' : ` →${fmtMs(realEndMs)}`}${causeText}`}
                                style={{
                                  position: 'absolute', top: 3, bottom: 3, left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 22,
                                  background: `${sc}28`, border: `1.5px solid ${sc}${o.isDone && !isLateDone ? 'cc' : (isDelayed || isLateDone) ? 'dd' : '88'}`,
                                  borderRadius: 4, overflow: 'hidden', cursor: 'default', zIndex: 1,
                                  boxShadow: (isDelayed || isLateDone) ? `0 0 6px ${sc}44` : 'none',
                                }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pctBlock}%`, background: `${sc}22` }} />
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 2px', overflow: 'hidden' }}>
                                  <div style={{ fontSize: 7, fontWeight: 800, color: sc, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {icon} {o.prod_no || (oi + 1)}
                                  </div>
                                  <div style={{ fontSize: 6, color: 'var(--muted)', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.qty}ชิ้น</div>
                                </div>
                              </div>
                              {/* หางเงาแดง — ยังไม่ปิดงานแม้เลยกำหนดแล้ว ครองไลน์อยู่จนถึงตอนนี้ ดันใบถัดไปไปต่อท้าย */}
                              {tailWidthPct > 0 && (
                                <div title="ยังไม่ปิดงาน — ดีเลย์ยังดำเนินอยู่"
                                  style={{
                                    position: 'absolute', top: 3, bottom: 3,
                                    left: `${tailLeftPct}%`, width: `${tailWidthPct}%`,
                                    background: 'repeating-linear-gradient(45deg, #ef444433 0px, #ef444433 4px, #ef444412 4px, #ef444412 8px)',
                                    border: '1.5px dashed #ef4444aa', borderLeft: 'none',
                                    borderRadius: '0 4px 4px 0', zIndex: 1, pointerEvents: 'none',
                                  }} />
                              )}
                              </Fragment>
                            );
                          });
                          })()}
                          {/* Now marker */}
                          {nowMs >= half.startMs && nowMs < half.startMs + 12 * 3600000 && (() => {
                            const nowPct = (nowMs - half.startMs) * pctPerMs;
                            return <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${nowPct}%`, width: 1.5, background: 'rgba(77,159,255,0.7)', zIndex: 2, pointerEvents: 'none' }} />;
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Canvas */}
        <div style={{
          width: '100%', flex: 1, minHeight: 0,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          backgroundColor: lineLayout ? 'transparent' : 'var(--bg3)', borderRadius: 12,
          border: lineLayout ? 'none' : '1px solid var(--border)',
        }}>
          {lineLayout ? (
            /* objectFit:contain keeps image within bounds — use JS imgBox to map % → px for stations */
            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              <img
                ref={imgRef}
                src={lineLayout}
                alt="line map"
                onLoad={recalcImgBox}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', borderRadius: 12, userSelect: 'none' }}
                draggable={false}
              />
              <style>{`
                @keyframes pulse-ring {
                  0%   { box-shadow: 0 0 0 0 rgba(77,159,255,0.6), 0 2px 8px rgba(0,0,0,0.6); }
                  70%  { box-shadow: 0 0 0 8px rgba(77,159,255,0), 0 2px 8px rgba(0,0,0,0.6); }
                  100% { box-shadow: 0 0 0 0 rgba(77,159,255,0), 0 2px 8px rgba(0,0,0,0.6); }
                }
              `}</style>
              {imgBox && (() => {
                // จุดตั้งค่าในหน้า Line Setup เป็นแค่หมุดตำแหน่งจริง อาจอยู่ใกล้กันมากกว่าขนาดการ์ดจริง
                // ที่นี่ต้องผลักการ์ดที่จะทับกัน (เต็มขนาด CARD_W x CARD_H) ออกจากกันในพิกเซลจริง
                // แล้วโยงเส้นกลับไปยังตำแหน่งจริงที่ตั้งไว้ ไม่ขยับตำแหน่งจริงใน DB
                const raw = dynamicStations.map(st => ({
                  st,
                  px: imgBox.offsetX + (parseFloat(st.pos_left) / 100) * imgBox.rw,
                  py: imgBox.offsetY + (parseFloat(st.pos_top) / 100) * imgBox.rh,
                  dox: 0, doy: 0,
                }));
                const MIN_PX_X = CARD_W, MIN_PX_Y = CARD_H;
                for (let pass = 0; pass < 60; pass++) {
                  let moved = false;
                  for (let i = 0; i < raw.length; i++) {
                    for (let j = i + 1; j < raw.length; j++) {
                      const a = raw[i], b = raw[j];
                      const dx = (b.px + b.dox) - (a.px + a.dox);
                      const dy = (b.py + b.doy) - (a.py + a.doy);
                      const ndx = dx / MIN_PX_X, ndy = dy / MIN_PX_Y;
                      const dist = Math.sqrt(ndx * ndx + ndy * ndy) || 0.0001;
                      if (dist < 1) {
                        const overlap = (1 - dist) / 2;
                        const pushX = (ndx / dist) * overlap * MIN_PX_X;
                        const pushY = (ndy / dist) * overlap * MIN_PX_Y;
                        a.dox -= pushX; a.doy -= pushY;
                        b.dox += pushX; b.doy += pushY;
                        moved = true;
                      }
                    }
                  }
                  if (!moved) break;
                }

                return (
                  <>
                    {filterMan && <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }}>
                      {raw.map(({ st, px, py, dox, doy }) => {
                        if (Math.abs(dox) < 2 && Math.abs(doy) < 2) return null;
                        return (
                          <g key={`ln-${st.id}`}>
                            <line x1={px} y1={py} x2={px + dox} y2={py + doy}
                              stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="4 3" />
                            <circle cx={px} cy={py} r={3} fill="rgba(255,255,255,0.7)" />
                          </g>
                        );
                      })}
                    </svg>}
                    {filterMan && raw.map(({ st, px, py, dox, doy }) => {
            const stTop  = py + doy;
            const stLeft = px + dox;
            const workerAtStation = workers.find(w => String(w.assigned_line) === String(st.id));
            const workerFit       = workerAtStation ? computeFit(workerAtStation, st) : null;
            const hasMan  = fourMLogs.some(m => m.line_name === st.line_name && m.category === 'Man');
            const has4M   = fourMLogs.some(m => m.line_name === st.line_name && m.category !== 'Man');
            const hasMachineIssue = fourMLogs.some(m => m.line_name === st.line_name && m.category === 'Machine' && isOpenIssue(m));
            const hasWipIssue     = fourMLogs.some(m => m.line_name === st.line_name && m.category === 'Material' && isOpenIssue(m));
            const isDimmed = false;
            const highlightColor = hasMachineIssue ? '#f59e0b' : hasWipIssue ? '#22c55e' : hasMan ? '#4d9fff' : null;
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
                /* outer: anchor point only — fixed size so translate(-50%,-50%) is always consistent */
                style={{
                  position: 'absolute', top: stTop, left: stLeft, transform: 'translate(-50%, -50%)',
                  width: CARD_W, height: CARD_H,
                  cursor: isMobile ? 'pointer' : 'default',
                  zIndex: isOver ? 20 : 5,
                  opacity: isDimmed ? 0.28 : 1,
                  filter: isDimmed ? 'grayscale(0.6)' : 'none',
                  transition: 'opacity 0.2s, filter 0.2s',
                }}
              >
                {/* inner: visual card — clips content to fixed height */}
                <div style={{
                  width: '100%', height: '100%', overflow: 'hidden',
                  borderTop:    `1px solid ${highlightColor ? highlightColor : activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderRight:  `1px solid ${highlightColor ? highlightColor : activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderBottom: `1px solid ${highlightColor ? highlightColor : activeFc ? `${activeFc}55` : 'rgba(255,255,255,0.18)'}`,
                  borderLeft:   `4px solid ${highlightColor ? highlightColor : activeFc || 'rgba(255,255,255,0.25)'}`,
                  borderRadius: 8,
                  backgroundColor: isOver || isPulse ? `${activeFc || '#4d9fff'}1a` : 'rgba(8,8,14,0.88)',
                  backdropFilter: 'blur(3px)',
                  animation: isPulse ? 'pulse-ring 1.4s ease-in-out infinite' : 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '3px 3px 2px',
                  transition: 'background-color 0.18s, border-color 0.18s',
                }}>
                  <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, flexShrink: 0 }}>
                    <span title={st.station_name} style={{ fontSize: isWide ? 10 : 9, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: activeFc || '#c8c8d0' }}>
                      {st.station_name}
                    </span>
                    <div style={{ display: 'flex', gap: 1, flexShrink: 0, alignItems: 'center' }}>
                      {workerAtStation?.employee_id && homePositions[workerAtStation.employee_id] === String(st.id) && (
                        <span style={{ fontSize: 8, lineHeight: 1 }} title="ตำแหน่งประจำ">🏠</span>
                      )}
                      {hasMan && <span title="มีบันทึก 4M หมวด Man" style={{ width: 6, height: 6, borderRadius: '50%', background: '#4d9fff', display: 'inline-block', flexShrink: 0 }} />}
                      {has4M  && <span title="มีบันทึก 4M" style={{ width: 6, height: 6, borderRadius: '50%', background: '#e74c3c', display: 'inline-block', flexShrink: 0 }} />}
                      {(pendingDocByLine[st.line_name]?.length > 0) && (() => {
                        const workerEmpId = workerAtStation?.employee_id;
                        const isHomeStation = workerEmpId && homePositions[workerEmpId] === String(st.id);
                        const logsForLine = pendingDocByLine[st.line_name] ?? [];
                        const relevantLog = logsForLine.find(l =>
                          workerAtStation && l.description?.includes(workerAtStation.employees?.name)
                        ) || (isHomeStation && logsForLine[0]);
                        if (!relevantLog) return null;
                        return (
                          <span key="pending-doc-badge"
                            onClick={(e) => { e.stopPropagation(); setPendingDocModal({ log: relevantLog }); setDocImageFile(null); setDocImagePreview(null); }}
                            title="ค้างแนบเอกสาร OJT — คลิกเพื่อแนบ"
                            style={{ fontSize: 9, cursor: 'pointer', lineHeight: 1 }}
                          >⚠️</span>
                        );
                      })()}
                      {!workerAtStation && (() => {
                        const logsForLine = pendingDocByLine[st.line_name] ?? [];
                        if (!logsForLine.length) return null;
                        const homeWorker = workers.find(w => w.employee_id && homePositions[w.employee_id] === String(st.id));
                        if (!homeWorker) return null;
                        const relevantLog = logsForLine.find(l => l.description?.includes(homeWorker.employees?.name));
                        if (!relevantLog) return null;
                        return (
                          <span key="pending-doc-home-badge"
                            onClick={(e) => { e.stopPropagation(); setPendingDocModal({ log: relevantLog }); setDocImageFile(null); setDocImagePreview(null); }}
                            title="ค้างแนบเอกสาร OJT — คลิกเพื่อแนบ"
                            style={{ fontSize: 9, cursor: 'pointer', lineHeight: 1 }}
                          >⚠️</span>
                        );
                      })()}
                      {!isMobile && (
                        <button onClick={(e) => { e.stopPropagation(); setShow4MModal({ stationId: st.id, lineName: st.line_name }); setLog4MForm({ category: 'Man', description: '' }); }}
                          title="บันทึก 4M"
                          style={{ width: 14, height: 14, background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', color: 'white', fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: 0, lineHeight: '14px', textAlign: 'center' }}>+</button>
                      )}
                    </div>
                  </div>

                  {/* content — worker fills top-down; empty + centered */}
                  {workerAtStation
                    ? <StationWorker worker={workerAtStation} fit={workerFit} stationName={st.station_name} />
                    : isPulse
                      ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                          <div style={{ fontSize: 18, opacity: 0.7 }}>👆</div>
                          {touchPreviewFit && (
                            <div style={{ background: fitColor(touchPreviewFit.score), color: '#fff', fontSize: 10, fontWeight: 900, padding: '1px 6px', borderRadius: 4 }}>
                              {touchPreviewFit.score}
                            </div>
                          )}
                        </div>
                      )
                      : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOver ? activeFc : 'rgba(255,255,255,0.22)', fontSize: 20 }}>+</div>
                  }
                </div>

                {/* Desktop drag-preview fit popup — outside inner div so overflow:hidden doesn't clip it */}
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
                    {filterWip && wipPoints.map(p => {
                      const isLow = (p.current_qty ?? 0) < (p.min_qty ?? 0);
                      const wTop  = imgBox.offsetY + (parseFloat(p.pos_top) / 100) * imgBox.rh;
                      const wLeft = imgBox.offsetX + (parseFloat(p.pos_left) / 100) * imgBox.rw;
                      return (
                        <div key={`wip-${p.id}`} title={`${p.point_type === 'packaging' ? '📦' : '🧱'} ${p.point_name}${p.point_type === 'packaging' ? (p.packaging_no ? ` (${p.packaging_no})` : '') : (p.mat_no ? ` (${p.mat_no})` : '')} — ${p.current_qty ?? 0}/${p.min_qty ?? 0}–${p.max_qty ?? 0}`}
                          style={{
                            position: 'absolute', top: wTop, left: wLeft, transform: 'translate(-50%, -50%)',
                            width: 54, height: 40, zIndex: 4,
                            border: isLow ? '2px solid #ef4444' : '2px solid rgba(34,197,94,0.85)',
                            borderRadius: 7, backgroundColor: isLow ? 'rgba(239,68,68,0.22)' : 'rgba(0,0,0,0.78)',
                            backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', padding: '2px 2px 1px',
                          }}>
                          <div style={{ fontSize: 8, fontWeight: 700, color: isLow ? '#fecaca' : '#e0e0e0', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.point_type === 'packaging' ? '📦' : '🧱'} {p.point_name}</div>
                          <div style={{ fontSize: 7, color: isLow ? '#fca5a5' : '#a3a3a3' }}>{p.current_qty ?? 0}/{p.min_qty ?? 0}–{p.max_qty ?? 0}</div>
                        </div>
                      );
                    })}
                    {filterMachine && machinePoints.map(p => {
                      const mc = drMachines.find(m => m.machine_no === p.machine_no);
                      const mTop  = imgBox.offsetY + (parseFloat(p.pos_top) / 100) * imgBox.rh;
                      const mLeft = imgBox.offsetX + (parseFloat(p.pos_left) / 100) * imgBox.rw;
                      return (
                        <div key={`mc-${p.id}`} title={`⚙️ ${p.machine_no} ${mc?.machine_name || ''}`}
                          style={{
                            position: 'absolute', top: mTop, left: mLeft, transform: 'translate(-50%, -50%)',
                            width: 54, height: 40, zIndex: 4,
                            border: '2px solid rgba(245,158,11,0.85)', borderRadius: 7,
                            backgroundColor: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(2px)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            padding: '2px 2px 1px',
                          }}>
                          <div style={{ fontSize: 8, fontWeight: 700, color: '#e0e0e0', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⚙️ {p.machine_no}</div>
                          <div style={{ fontSize: 7, color: '#a3a3a3', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mc?.machine_name || ''}</div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          ) : (
            <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 32 }}>
              <div style={{ fontSize: 48, opacity: 0.25 }}>🏭</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
                ยังไม่มีผังไลน์ —{' '}
                <span style={{ color: 'var(--accent)', fontWeight: 600, cursor: 'default' }}>ตั้งค่าที่หน้า ตั้งค่าผังไลน์</span>
              </div>
              {workers.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, width: '100%', maxWidth: 700 }}>
                  {[
                    { label: 'พร้อมทำงาน', count: poolWorkers.length, color: '#4d9fff', icon: '🔵' },
                    { label: 'ประจำสถานี', count: workers.filter(w => w.assigned_line).length, color: 'var(--accent)', icon: '✅' },
                    { label: 'งานนอกไลน์', count: specialWorkers.length, color: '#f59e0b', icon: '🟡' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
                      <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-display)', color: s.color }}>{s.count}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
              {workers.length > 0 && (
                <div style={{ width: '100%', maxWidth: 700 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>รายชื่อพนักงานวันนี้</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                    {workers.map(w => (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                        {w.employees?.image_url
                          ? <img src={w.employees.image_url} style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', flexShrink: 0 }} />
                          : <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>👤</div>
                        }
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.employees?.name?.split(' ')[0] || '?'}</div>
                          <div style={{ fontSize: 9, color: 'var(--muted)' }}>{w.employees?.team ? `Team ${w.employees.team}` : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
            boxShadow: '0 4px 20px rgba(61,214,92,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="บันทึก 4M"
        >🚨</button>
      )}

      {/* ── Radar skill modal (portal → renders at body to escape stacking context) ── */}
      {radarWorker && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 16, padding: '20px 24px', width: 'min(90vw, 380px)', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              {radarWorker.employees?.image_url
                ? <img src={radarWorker.employees.image_url} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: '2px solid var(--border2)', flexShrink: 0 }} />
                : <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>👤</div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{radarWorker.employees?.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{radarWorker.employees?.employee_id_code}</div>
                <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                  {radarWorker.employees?.team && <span style={{ fontSize: 10, fontWeight: 800, color: '#4d9fff', background: 'rgba(77,159,255,0.15)', borderRadius: 4, padding: '1px 6px' }}>Team {radarWorker.employees.team}</span>}
                  {radarWorker.employees?.section && <span style={{ fontSize: 10, color: '#a78bfa', background: 'rgba(167,139,250,0.12)', borderRadius: 4, padding: '1px 6px' }}>📍 {radarWorker.employees.section}</span>}
                </div>
              </div>
              <button onClick={() => setRadarWorker(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: '0 4px', alignSelf: 'flex-start' }}>✕</button>
            </div>
            {skillDefs.length > 0 ? (() => {
              const workerSkills = radarWorker.employees?.employee_skills || [];
              const radarDataFiltered = dedupeByLabel(
                skillDefs.map(sd => ({ subject: sd.label, score: workerSkills.find(s => s.skill_name === sd.name)?.score ?? 0, fullMark: 100 })),
                'subject'
              )
                .filter(d => d.score > 0)
                .sort((a, b) => b.score - a.score);
              if (radarDataFiltered.length === 0) return (
                <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>ยังไม่มีข้อมูลทักษะ</div>
              );
              return (
                <ResponsiveContainer width="100%" height={200}>
                  <RadarChart data={radarDataFiltered}>
                    <PolarGrid stroke="var(--border2)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text2)', fontSize: 10 }} />
                    <Radar name="ทักษะ" dataKey="score" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              );
            })() : (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>ยังไม่มีข้อมูลทักษะ</div>
            )}
          </div>
        </div>
      , document.body)}

      {/* ── Desktop hover card ── */}
      {!isMobile && hoverCard && !radarWorker && !stationModal && <WorkerHoverCard card={hoverCard} skillDefs={skillDefs} />}

      {/* ── Desktop fit popup ── */}
      {!isMobile && fitPopup && <FitPopup fitPopup={fitPopup} onClose={() => setFitPopup(null)} />}

      {/* ── Mobile fit popup (after assign) ── */}
      {isMobile && fitPopup && (
        <div style={{ position: 'fixed', top: 16, left: 16, right: 16, zIndex: 1000, background: 'var(--card)', border: `2px solid ${fitColor(fitPopup.fit.score)}`, borderRadius: 14, padding: '14px 16px', boxShadow: 'var(--shadow-lg)', animation: 'hoverIn 0.25s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={fitPopup.worker.employees?.image_url || ''} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: `2px solid ${fitColor(fitPopup.fit.score)}`, flexShrink: 0 }} />
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
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'relative', background: 'var(--card)', borderRadius: '20px 20px 0 0', padding: '20px 20px 36px', boxShadow: 'var(--shadow-lg)', animation: 'slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } } @keyframes hoverIn { from { opacity:0; transform:scale(0.93) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
            {/* Handle */}
            <div style={{ width: 36, height: 4, background: 'var(--border2)', borderRadius: 3, margin: '0 auto 16px' }} />

            {/* Worker header */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
              {detailSheet.worker.employees?.image_url
                ? <img src={detailSheet.worker.employees.image_url} style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: `3px solid ${fitColor(detailSheet.fit.score)}`, flexShrink: 0 }} />
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
                    // hide skills with score 0 that have no station requirement
                    if (score === 0 && !fitReq) return null;
                    const bar = fitReq ? (fitReq.pass ? '#22c55e' : '#ef4444') : sd.color;
                    return (
                      <div key={sd.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 13, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: sd.color, display: 'inline-block', flexShrink: 0 }} />{sd.label}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: bar }}>
                            {score > 0 ? `${score}%` : '—'}{fitReq && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>/{fitReq.required}%</span>}
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
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
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
                      ? <img src={workerHere.employees.image_url} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: `2px solid ${fitColor(fitHere.score)}`, flexShrink: 0 }} />
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
                        ? <img src={w.employees.image_url} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: `2px solid ${fc}`, flexShrink: 0 }} />
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

      {/* ── Attach-doc modal ── */}
      {pendingDocModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--card)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>📎 แนบเอกสาร OJT</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              <b>{pendingDocModal.log.category}</b> · {pendingDocModal.log.line_name}<br/>
              {pendingDocModal.log.description}
            </div>
            {/* Image upload */}
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                รูปหลักฐาน OJT <span style={{ color: 'var(--muted)' }}>(ไม่บังคับ)</span>
              </label>
              <div
                style={{ border: `2px dashed ${docImageFile ? '#a855f7' : 'var(--border2)'}`, borderRadius: 8, padding: '10px 12px', background: docImageFile ? 'rgba(168,85,247,0.06)' : 'var(--bg2)', cursor: 'pointer', textAlign: 'center' }}
                onClick={() => document.getElementById('doc-img-input').click()}
              >
                {docImagePreview
                  ? <img src={docImagePreview} alt="" style={{ maxHeight: 140, borderRadius: 6, objectFit: 'contain' }} />
                  : <span style={{ color: 'var(--muted)', fontSize: 13 }}>📸 แตะเพื่อเลือกรูป</span>
                }
              </div>
              <input id="doc-img-input" type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { setDocImageFile(f); const r = new FileReader(); r.onload = ev => setDocImagePreview(ev.target.result); r.readAsDataURL(f); }
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button disabled={isSavingDoc} onClick={async () => {
                setIsSavingDoc(true);
                try {
                  let publicUrl = null;
                  if (docImageFile) {
                    const ext = docImageFile.name.split('.').pop();
                    const path = `4m-requests/${Date.now()}.${ext}`;
                    const { error: upErr } = await supabase.storage.from('4m-images').upload(path, docImageFile, { upsert: true });
                    if (upErr) throw upErr;
                    publicUrl = supabase.storage.from('4m-images').getPublicUrl(path).data.publicUrl;
                  }
                  const { error: updErr } = await supabase.from('four_m_logs').update({
                    status: 'pending',
                    ...(publicUrl ? { request_image_url: publicUrl } : {}),
                  }).eq('id', pendingDocModal.log.id);
                  if (updErr) throw updErr;
                  supabase.functions.invoke('send-notification', {
                    body: { event: 'status_change', log: { ...pendingDocModal.log, status: 'pending', request_image_url: publicUrl } }
                  }).catch(() => {});
                  toast.success('แนบเอกสารเรียบร้อย — รอ SV อนุมัติ');
                  setPendingDocModal(null);
                  fetchData();
                } catch (err) {
                  toast.error('เกิดข้อผิดพลาด: ' + err.message);
                } finally {
                  setIsSavingDoc(false);
                }
              }} style={{ flex: 2, padding: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, opacity: isSavingDoc ? 0.6 : 1, cursor: isSavingDoc ? 'not-allowed' : 'pointer' }}>
                {isSavingDoc ? 'กำลังบันทึก...' : 'ส่งอนุมัติ'}
              </button>
              <button onClick={() => { if (!isSavingDoc) { setPendingDocModal(null); setDocImageFile(null); setDocImagePreview(null); } }}
                style={{ flex: 1, padding: 12, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
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
              {/* Man: 3-case logic */}
              {log4MForm.category === 'Man' && (() => {
                const manCase = getManCase(log4MForm);
                const meta = MAN_CASE_META[manCase];
                return (
                  <div style={{ background: 'rgba(77,159,255,0.06)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>ลักษณะการย้ายงาน</div>
                    {/* move type */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[{ v: 'same', label: '🏭 ไลน์เดิม', desc: 'ย้ายในไลน์/ส่วนงานเดียวกัน' }, { v: 'cross', label: '🔀 ข้ามไลน์', desc: 'ย้ายข้ามไลน์ / ข้ามส่วนงาน' }].map(opt => (
                        <label key={opt.v} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 6px', borderRadius: 7, cursor: 'pointer',
                          border: `2px solid ${log4MForm.moveType === opt.v ? '#4d9fff' : 'var(--border2)'}`,
                          background: log4MForm.moveType === opt.v ? 'rgba(77,159,255,0.1)' : 'transparent' }}>
                          <input type="radio" name="moveType" value={opt.v} checked={log4MForm.moveType === opt.v}
                            onChange={() => setLog4MForm({ ...log4MForm, moveType: opt.v })} style={{ display: 'none' }} />
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{opt.label}</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>{opt.desc}</span>
                        </label>
                      ))}
                    </div>
                    {/* skill + history */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={log4MForm.skillOk} onChange={e => setLog4MForm({ ...log4MForm, skillOk: e.target.checked })} style={{ width: 15, height: 15 }} />
                      ทักษะผ่านเกณฑ์ที่กำหนด
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={log4MForm.hasHistory} onChange={e => setLog4MForm({ ...log4MForm, hasHistory: e.target.checked })} style={{ width: 15, height: 15 }} />
                      มีประวัติเคยทำงานจุดนี้มาก่อน
                    </label>
                    {/* result badge */}
                    <div style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, background: meta.bg, color: meta.color, fontWeight: 600 }}>
                      {meta.label}
                    </div>
                  </div>
                );
              })()}
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
              {/* Image upload — required when needsImage */}
              {(() => {
                const isMan = log4MForm.category === 'Man';
                const needsImage = isMan
                  ? MAN_CASE_META[getManCase(log4MForm)].needsImage
                  : log4MForm.subtype === 'change';
                if (!needsImage) return null;
                return (
                  <div>
                    <label style={{ ...labelSt, color: '#a855f7' }}>
                      📎 {log4MForm.category === 'Man' ? 'รูปหลักฐาน OJT' : 'รูปรายละเอียดการเปลี่ยนแปลง'} <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ border: `2px dashed ${reqImageFile ? '#a855f7' : 'var(--border2)'}`, borderRadius: 8, padding: '10px 12px', background: reqImageFile ? 'rgba(168,85,247,0.06)' : 'var(--bg2)', cursor: 'pointer', textAlign: 'center', position: 'relative' }}
                      onClick={() => document.getElementById('req-img-input').click()}>
                      <input id="req-img-input" type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setReqImageFile(f);
                          const reader = new FileReader();
                          reader.onload = ev => setReqImagePreview(ev.target.result);
                          reader.readAsDataURL(f);
                        }} />
                      {reqImagePreview
                        ? <img src={reqImagePreview} style={{ maxHeight: 140, maxWidth: '100%', borderRadius: 6, objectFit: 'contain' }} />
                        : <div style={{ color: 'var(--muted)', fontSize: 13 }}>📷 แตะเพื่อเลือกรูป (JPG/PNG/WebP)</div>}
                    </div>
                    {reqImageFile && (
                      <button type="button" onClick={() => { setReqImageFile(null); setReqImagePreview(null); }}
                        style={{ marginTop: 4, fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        ✕ ลบรูป
                      </button>
                    )}
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={handleSave4MLog} disabled={isSaving4M} style={{ flex: 2, padding: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 15, opacity: isSaving4M ? 0.6 : 1, cursor: isSaving4M ? 'not-allowed' : 'pointer' }}>
                  {isSaving4M ? 'กำลังบันทึก...' : 'บันทึก 4M Log'}
                </button>
                <button onClick={() => { if (!isSaving4M) { setShow4MModal(null); setLog4MForm({ category: 'Man', description: '' }); setReqImageFile(null); setReqImagePreview(null); } }}
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
  const { worker, fit, rect, stationName } = card;
  const emp = worker.employees;
  const skills = emp?.employee_skills || [];
  const tooltipW = 400;
  const photoW = 118;

  const elRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const gap = 10;
    let left = rect.right + gap;
    if (left + tooltipW > window.innerWidth - 8) left = rect.left - tooltipW - gap;
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipW - 8));
    let top = rect.top - 20;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    setPos({ top, left });
  }, [rect, worker?.id, fit?.score]);

  const radarData = dedupeByLabel(
    skillDefs.map(sd => ({ skill: sd.label, score: skills.find(s => s.skill_name === sd.name)?.score ?? 0, fullMark: 100 })),
    'skill'
  )
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score);

  const fc = fit ? fitColor(fit.score) : 'var(--accent)';

  // Capped to a fixed row count (not CSS overflow) so the card height stays consistent
  // no matter how many skills an employee has — required skills for this station are
  // prioritized first, then highest score.
  const MAX_STATS = 9;
  const allStatRows = skillDefs
    .map(sd => ({ name: sd.name, label: sd.label, color: sd.color, score: skills.find(s => s.skill_name === sd.name)?.score ?? 0, req: fit?.details?.find(d => d.label === sd.label) }))
    .filter(s => s.score > 0 || s.req)
    .sort((a, b) => (b.req ? 1 : 0) - (a.req ? 1 : 0) || b.score - a.score);
  const statRows = allStatRows.slice(0, MAX_STATS);
  const hiddenCount = allStatRows.length - statRows.length;

  return (
    <div ref={elRef} style={{ position: 'fixed', top: pos ? pos.top : -9999, left: pos ? pos.left : -9999, width: tooltipW, maxHeight: 'calc(100vh - 16px)', overflowY: 'hidden', zIndex: 3000, pointerEvents: 'none', visibility: pos ? 'visible' : 'hidden', background: 'var(--card)', border: `1px solid ${fc}55`, borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: 14, animation: pos ? 'hoverIn 0.18s ease' : 'none' }}>
      <style>{`@keyframes hoverIn { from { opacity:0; transform:scale(0.93) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>

      {/* Header — portrait photo + name/badges/station stacked in the left column,
          skill stat list in the right column. Rank badge floats above the photo so
          it never covers the face. */}
      <div style={{ display: 'flex', gap: 12, marginTop: 18, marginBottom: 10 }}>
        <div style={{ flexShrink: 0, width: photoW }}>
          <div style={{ position: 'relative' }}>
            {emp?.image_url
              ? <img src={emp.image_url} style={{ width: photoW, height: photoW * 1.35, borderRadius: 10, objectFit: 'cover', objectPosition: 'top', border: `2px solid ${fc}`, boxShadow: `0 0 14px ${fc}55`, display: 'block' }} />
              : <div style={{ width: photoW, height: photoW * 1.35, borderRadius: 10, background: 'var(--bg3)', border: `2px solid ${fc}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44 }}>👤</div>
            }
            {fit && (
              <div style={{ position: 'absolute', top: -16, left: 4, background: fc, color: '#fff', fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-display)', lineHeight: 1, borderRadius: 7, padding: '3px 8px', boxShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                {fit.score}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{emp?.name || '—'}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{emp?.employee_id_code || ''}</div>
            {stationName && (
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>→ {stationName}</div>
            )}
            {fit && <div style={{ fontSize: 10, fontWeight: 700, color: fc }}>{fitLabel(fit.score)}</div>}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {emp?.team && <span style={{ fontSize: 9, fontWeight: 800, background: 'rgba(77,159,255,0.15)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 4, padding: '1px 5px' }}>Team {emp.team}</span>}
              {emp?.section && <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(167,139,250,0.13)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 4, padding: '1px 5px' }}>📍 {emp.section}</span>}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {statRows.length > 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 3 }}>
              {statRows.map(s => {
                const pass = s.req ? s.req.pass : null;
                const sc = pass === false ? '#ef4444' : pass === true ? 'var(--accent)' : 'var(--text2)';
                return (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg3)', border: `1px solid ${sc}33`, borderRadius: 5, padding: '4px 6px' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 4 }}>{s.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 900, color: sc, fontFamily: 'var(--font-display)', flexShrink: 0 }}>
                      {s.score > 0 ? s.score : '—'}{s.req ? <span style={{ fontSize: 9, opacity: 0.6 }}>/{s.req.required}</span> : ''}
                    </span>
                  </div>
                );
              })}
              {hiddenCount > 0 && (
                <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>+{hiddenCount} ทักษะอื่นๆ</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Radar chart — full width, below the header. Wide margins + small font so long
          Thai skill labels don't clip past the card edges at high skill counts. */}
      {skillDefs.length > 0 && radarData.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'center', marginTop: 4, marginBottom: 2 }}>ภาพรวมทักษะ</div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} margin={{ top: 16, right: 70, bottom: 16, left: 70 }}>
                <PolarGrid stroke="var(--border2)" />
                <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: 'var(--muted)', fontWeight: 600 }} />
                <Radar name="ทักษะ" dataKey="score" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.22} strokeWidth={1.5} dot={{ r: 2, fill: 'var(--accent)' }} />
                {fit && (
                  <Radar name="required" dataKey={() => null}
                    data={radarData.map(d => {
                      const req = fit.details?.find(r => r.label === d.skill);
                      return { skill: d.skill, score: req?.required ?? 0 };
                    })}
                    stroke="rgba(239,68,68,0.6)" fill="rgba(239,68,68,0.06)" strokeWidth={1} strokeDasharray="3 2"
                  />
                )}
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </>
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
        <img src={fitPopup.worker.employees?.image_url || ''} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: `2.5px solid ${fc}`, flexShrink: 0 }} />
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
