import { useState, useEffect, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { loadCompanyCalendar, getDayType } from '../utils/companyCalendar';

const LEAVE_TYPES = ['ลากิจ', 'ลาป่วย', 'ลาพักร้อน', 'อื่นๆ'];
const LEAVE_DURATION_OPTS = [
  { value: 'full',  label: 'เต็มวัน' },
  { value: 'half',  label: 'ครึ่งวัน' },
  { value: 'hours', label: 'ระบุชั่วโมง' },
];
const LEAVE_PERIOD_OPTS = [
  { value: 'morning',   label: '🌅 ลาช่วงเช้า', sub: 'มาบ่าย' },
  { value: 'afternoon', label: '🌇 ลาช่วงบ่าย', sub: 'มาเช้า' },
];

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toLocalDateStr(dt);
}

function getShiftInfo() {
  const now = new Date();
  const h = now.getHours();
  const totalMin = h * 60 + now.getMinutes();
  const isDay = totalMin >= 8 * 60 && totalMin < 20 * 60;
  const workDate = new Date(now);
  if (h < 8) workDate.setDate(workDate.getDate() - 1);
  return {
    shift:       isDay ? 'day' : 'night',
    workDateStr: toLocalDateStr(workDate),
    label:       isDay ? '☀️ กะเช้า' : '🌙 กะดึก',
    timeRange:   isDay ? '08:00–17:30 · OT 17:30–20:00' : 'OT 20:00–22:30 · 22:30–07:59',
  };
}

function getRowStatus(rec) {
  if (!rec) return null;
  if (rec.leave_type) {
    if (rec.leave_duration === 'full')  return 'leave-full';
    if (rec.leave_duration === 'half')  return rec.leave_period === 'morning' ? 'leave-half-am' : 'leave-half-pm';
    if (rec.leave_duration === 'hours') return 'leave-hours';
    return 'leave-full';
  }
  if (!rec.is_present) return 'absent';
  if (rec.is_present && rec.has_helmet && rec.has_boots && rec.has_gloves) return 'ready';
  return 'partial';
}

const STATUS_META = {
  'ready':          { bg: 'rgba(34,197,94,0.06)',   label: '🟢 พร้อม',             color: '#22c55e' },
  'partial':        { bg: 'rgba(245,158,11,0.06)',  label: '🟡 PPE ไม่ครบ',        color: '#f59e0b' },
  'absent':         { bg: 'rgba(231,76,60,0.06)',   label: '🔴 ขาดงาน',            color: '#ef4444' },
  'leave-full':     { bg: 'rgba(139,92,246,0.06)',  label: '🟣 ลาเต็มวัน',         color: '#a855f7' },
  'leave-half-am':  { bg: 'rgba(77,159,255,0.06)',  label: '🔵 ลาช่วงเช้า',        color: '#4d9fff' },
  'leave-half-pm':  { bg: 'rgba(34,197,94,0.06)',   label: '🔵 ลาช่วงบ่าย',        color: '#38bdf8' },
  'leave-hours':    { bg: 'rgba(77,159,255,0.06)',  label: '🔵 ลาบางส่วน',         color: '#4d9fff' },
};

export default function Checkin() {
  const { role, lineId, team, fullName } = useContext(UserContext);

  const [employees,      setEmployees]      = useState([]);
  const [lines,          setLines]          = useState([]);
  const [attendance,     setAttendance]     = useState({});
  const [otBookings,     setOtBookings]     = useState({});
  const [otTasks,        setOtTasks]        = useState({});
  const [otExtraBookings, setOtExtraBookings] = useState({}); // { [empId]: { [date]: bool } } — วันหยุดล่วงหน้าเพิ่ม
  const [otExtraTasks,    setOtExtraTasks]    = useState({}); // { [empId]: { [date]: taskTypeId } }
  const [taskTypes,      setTaskTypes]      = useState([]);
  const [isSaving,       setIsSaving]       = useState(false);
  const [filterShift,    setFilterShift]    = useState(true);
  const [noSchedule,     setNoSchedule]     = useState(false);
  const [orgSections,    setOrgSections]    = useState([]);
  const [selSection,     setSelSection]     = useState('');
  const [selLine,        setSelLine]        = useState('');
  const [showExport,     setShowExport]     = useState(false);
  const [exportMonth,    setExportMonth]    = useState(() => toLocalDateStr(new Date()).slice(0, 7));
  const [exportHalf,     setExportHalf]     = useState('1-15');
  const [exportSection,  setExportSection]  = useState('');
  const [exporting,      setExporting]      = useState(false);
  const [previewNight,   setPreviewNight]   = useState(false);
  const [calLoaded,      setCalLoaded]      = useState(false);

  const realShiftInfo = getShiftInfo();
  const shiftInfo = previewNight
    ? { ...realShiftInfo, shift: 'night', label: '🌙 กะดึก (Preview)' }
    : realShiftInfo;

  useEffect(() => { loadCompanyCalendar().then(() => setCalLoaded(true)); }, []);
  useEffect(() => { fetchData(); }, [previewNight, calLoaded]);

  const isHolidayDate = (dateStr) => calLoaded && getDayType(dateStr) !== 'working';

  /* ── วันที่จองรถ "ล่วงหน้าเพิ่ม" ในรอบเช็คชื่อนี้ (เพิ่มเติมจากกลไกเดิม) ──
     กะดึก: คืนถัดไป (nextDateStr) จองได้เสมออยู่แล้ว (กลไกเดิม) — ถ้าคืนถัดๆไปจากนั้นเป็นวันหยุดต่อกัน
            (เช่น คืน พฤหัส จองคืนศุกร์ไว้แล้ว, ถ้าคืนเสาร์เป็นวันหยุด ก็ให้จองคืนเสาร์+อาทิตย์ต่อได้เลย)
     กะเช้า: ปกติ OT วันนี้ใช้ has_ot อยู่แล้ว (ไม่ใช่ล่วงหน้า) — ถ้าพรุ่งนี้เป็นวันหยุด ให้จองล่วงหน้าต่อเนื่อง
            จนกว่าจะเจอวันทำงานปกติ (เช่น กะเช้าศุกร์ จองเสาร์-อาทิตย์-(จันทร์ถ้าหยุดด้วย)) */
  const extraAdvanceDates = (() => {
    const { workDateStr, shift } = shiftInfo;
    const dates = [];
    const scanStart = shift === 'night' ? addDaysToDateStr(workDateStr, 2) : addDaysToDateStr(workDateStr, 1);
    let cur = scanStart;
    while (isHolidayDate(cur)) { dates.push(cur); cur = addDaysToDateStr(cur, 1); }
    return dates;
  })();

  const shortDateLabel = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const wd = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][dt.getDay()];
    return `${wd} ${d}/${m}`;
  };

  const fetchData = async () => {
    const { workDateStr } = shiftInfo;
    const nextDateStr = addDaysToDateStr(workDateStr, 1);

    let empQ = supabase.from('employees').select('*').eq('is_active', true).order('employee_id_code');
    if (role === 'leader') {
      if (lineId) empQ = empQ.eq('line_id', lineId);
      if (team)   empQ = empQ.eq('team', team);
    }

    const [
      { data: empData },
      { data: logData },
      { data: scheduleData },
      { data: overrideData },
      { data: lineData },
      { data: orgNodeData },
      { data: mergeData },
      { data: bookingData },
      { data: taskTypeData },
      { data: extraBookingData },
    ] = await Promise.all([
      empQ,
      supabase.from('daily_production_logs')
        .select('employee_id, is_present, has_helmet, has_boots, has_gloves, has_ot, has_extended_ot, remark, leave_type, leave_duration, leave_period, leave_hours')
        .eq('work_date', workDateStr),
      supabase.from('shift_schedules').select('*').eq('work_date', workDateStr),
      supabase.from('shift_overrides').select('*').eq('work_date', workDateStr),
      supabase.from('production_lines').select('id, name, section').order('section').order('name'),
      supabase.from('org_nodes').select('code, name').eq('kind', 'section').eq('is_active', true).order('name'),
      supabase.from('shift_merge_events').select('*').lte('start_date', workDateStr).gte('end_date', workDateStr),
      shiftInfo.shift === 'night'
        ? supabase.from('ot_night_bookings').select('employee_id, task_type_id').eq('work_date', nextDateStr).eq('shift', 'night')
        : supabase.from('ot_night_bookings').select('employee_id, task_type_id').eq('work_date', workDateStr).eq('shift', 'day'),
      supabase.from('ot_task_types').select('id, name').eq('is_active', true).order('sort_order'),
      extraAdvanceDates.length
        ? supabase.from('ot_night_bookings').select('employee_id, work_date, task_type_id').in('work_date', extraAdvanceDates).eq('shift', shiftInfo.shift)
        : Promise.resolve({ data: [] }),
    ]);
    setLines(lineData || []);
    setOrgSections((orgNodeData || []).map(n => n.code || n.name).sort());
    setTaskTypes(taskTypeData || []);

    if (!empData) return;

    const lineSchedule = {};
    (scheduleData || []).forEach(s => { lineSchedule[s.line_id] = s.day_team; });
    setNoSchedule(Object.keys(lineSchedule).length === 0);

    const empOverride = {};
    (overrideData || []).forEach(o => { empOverride[o.employee_id] = o.shift; });

    // map lineId → section for merge event lookup
    const lineSection = {};
    (lineData || []).forEach(l => { lineSection[l.id] = l.section; });

    const enriched = empData.map(emp => {
      let assignedShift = null;
      if (empOverride[emp.id]) {
        // 1st priority: individual override
        assignedShift = empOverride[emp.id];
      } else {
        // 2nd priority: merge event (line-level beats section-level)
        const empSec = lineSection[emp.line_id];
        const mergeEvent =
          (mergeData || []).find(e => e.line_id === emp.line_id) ||
          (mergeData || []).find(e => e.section && e.section === empSec);
        if (mergeEvent) {
          assignedShift = mergeEvent.target_shift;
        } else if (emp.line_id && lineSchedule[emp.line_id]) {
          // 3rd priority: normal A/B schedule
          const dayTeam = lineSchedule[emp.line_id];
          const nightTeam = dayTeam === 'A' ? 'B' : 'A';
          // Team C = fixed day shift (ไม่หมุน A/B)
          assignedShift = emp.team === 'C' ? 'day' : emp.team === dayTeam ? 'day' : emp.team === nightTeam ? 'night' : null;
        }
      }
      return { ...emp, assignedShift };
    });

    setEmployees(enriched);

    const init = {};
    enriched.forEach(emp => {
      const log = logData?.find(l => l.employee_id === emp.id);
      init[emp.id] = {
        is_present:       log ? log.is_present       : false,
        has_helmet:       log ? log.has_helmet       : false,
        has_boots:        log ? log.has_boots        : false,
        has_gloves:       log ? log.has_gloves       : false,
        has_ot:           log ? log.has_ot           : false,
        has_extended_ot:  log ? log.has_extended_ot  : false,
        remark:         log ? (log.remark || '') : '',
        leave_type:     log ? (log.leave_type     || '') : '',
        leave_duration: log ? (log.leave_duration || '') : '',
        leave_period:   log ? (log.leave_period   || '') : '',
        leave_hours:    log ? (log.leave_hours    || '') : '',
      };
    });
    setAttendance(init);

    const bookingByEmp = {};
    (bookingData || []).forEach(b => { bookingByEmp[b.employee_id] = b.task_type_id; });
    const bookInit = {};
    const taskInit = {};
    enriched.forEach(emp => {
      bookInit[emp.id] = Object.prototype.hasOwnProperty.call(bookingByEmp, emp.id);
      taskInit[emp.id] = bookingByEmp[emp.id] || '';
    });
    setOtBookings(bookInit);
    setOtTasks(taskInit);

    const extraBookInit = {};
    const extraTaskInit = {};
    enriched.forEach(emp => { extraBookInit[emp.id] = {}; extraTaskInit[emp.id] = {}; });
    (extraBookingData || []).forEach(b => {
      if (!extraBookInit[b.employee_id]) extraBookInit[b.employee_id] = {};
      if (!extraTaskInit[b.employee_id]) extraTaskInit[b.employee_id] = {};
      extraBookInit[b.employee_id][b.work_date] = true;
      extraTaskInit[b.employee_id][b.work_date] = b.task_type_id || '';
    });
    setOtExtraBookings(extraBookInit);
    setOtExtraTasks(extraTaskInit);
  };

  const toggleOtBooking = (empId) =>
    setOtBookings(prev => ({ ...prev, [empId]: !prev[empId] }));

  const setOtTask = (empId, taskTypeId) =>
    setOtTasks(prev => ({ ...prev, [empId]: taskTypeId }));

  const toggleOtExtraBooking = (empId, date) =>
    setOtExtraBookings(prev => ({ ...prev, [empId]: { ...prev[empId], [date]: !prev[empId]?.[date] } }));

  const setOtExtraTask = (empId, date, taskTypeId) =>
    setOtExtraTasks(prev => ({ ...prev, [empId]: { ...prev[empId], [date]: taskTypeId } }));

  const toggle = (empId, field) =>
    setAttendance(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: !prev[empId][field] } }));

  const setField = (empId, field, value) =>
    setAttendance(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: value } }));

  const setLeaveType = (empId, value) => {
    setAttendance(prev => {
      const cur = prev[empId];
      if (!value) {
        return { ...prev, [empId]: { ...cur, leave_type: '', leave_duration: '', leave_period: '', leave_hours: '', is_present: true } };
      }
      const duration = cur.leave_duration || 'full';
      const isPresent = duration !== 'full';
      return { ...prev, [empId]: { ...cur, leave_type: value, leave_duration: duration, is_present: isPresent } };
    });
  };

  const setLeaveDuration = (empId, value) => {
    setAttendance(prev => {
      const cur = prev[empId];
      const isPresent = value !== 'full';
      return {
        ...prev, [empId]: {
          ...cur,
          leave_duration: value,
          is_present: isPresent,
          leave_period: value === 'half' ? (cur.leave_period || 'afternoon') : '',
          leave_hours:   value !== 'hours' ? '' : cur.leave_hours,
        }
      };
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) { toast.error('กรุณา Login ก่อน'); setIsSaving(false); return; }

    const { workDateStr } = shiftInfo;
    const logs = employees.map(emp => {
      const rec = attendance[emp.id];
      return {
        employee_id:    emp.id,
        work_date:      workDateStr,
        shift:          emp.assignedShift || shiftInfo.shift,
        is_present:     rec.is_present,
        has_helmet:     rec.has_helmet,
        has_boots:      rec.has_boots,
        has_gloves:     rec.has_gloves,
        has_ot:           rec.has_ot,
        has_extended_ot:  rec.has_extended_ot || false,
        remark:           rec.remark || null,
        leave_type:     rec.leave_type     || null,
        leave_duration: rec.leave_duration || null,
        leave_period:   rec.leave_period   || null,
        leave_hours:    rec.leave_hours    ? Number(rec.leave_hours) : null,
        checked_by:     userData.user.id,
      };
    });

    const { error } = await supabase
      .from('daily_production_logs')
      .upsert(logs, { onConflict: 'work_date,employee_id' });

    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); setIsSaving(false); return; }

    /* ── บันทึกการจอง OT (สำหรับธุรการจองรถรับส่ง) ──
       กะดึก: จองล่วงหน้าว่าจะมาทำ OT คืนวันถัดไป (checkbox 🚐 OT พรุ่งนี้) → work_date = วันถัดไป, shift='night'
       กะเช้า: OT จริงของวันนี้ (has_ot) → work_date = วันนี้, shift='day' */
    {
      const isNightShift = shiftInfo.shift === 'night';
      const bookDate = isNightShift ? addDaysToDateStr(workDateStr, 1) : workDateStr;
      const otShift  = isNightShift ? 'night' : 'day';
      const isBooked = emp => isNightShift ? !!otBookings[emp.id] : !!attendance[emp.id]?.has_ot;

      const toBook   = displayed.filter(isBooked).map(emp => emp.id);
      const toUnbook = displayed.filter(emp => !isBooked(emp)).map(emp => emp.id);

      if (toBook.length) {
        await supabase.from('ot_night_bookings').upsert(
          toBook.map(empId => ({
            work_date:      bookDate,
            shift:          otShift,
            employee_id:    empId,
            task_type_id:   otTasks[empId] || null,
            booked_by:      userData.user.id,
            booked_by_name: fullName || null,
          })),
          { onConflict: 'employee_id,work_date,shift' }
        );
      }
      if (toUnbook.length) {
        await supabase.from('ot_night_bookings')
          .delete()
          .eq('work_date', bookDate)
          .eq('shift', otShift)
          .in('employee_id', toUnbook);
      }
    }

    /* ── บันทึกการจองรถ "ล่วงหน้าเพิ่ม" สำหรับวันหยุดต่อเนื่อง (extraAdvanceDates) ── */
    if (extraAdvanceDates.length) {
      const otShift = shiftInfo.shift;
      for (const d of extraAdvanceDates) {
        const isBookedExtra = emp => !!otExtraBookings[emp.id]?.[d];
        const toBookExtra   = displayed.filter(isBookedExtra).map(emp => emp.id);
        const toUnbookExtra = displayed.filter(emp => !isBookedExtra(emp)).map(emp => emp.id);

        if (toBookExtra.length) {
          await supabase.from('ot_night_bookings').upsert(
            toBookExtra.map(empId => ({
              work_date:      d,
              shift:          otShift,
              employee_id:    empId,
              task_type_id:   otExtraTasks[empId]?.[d] || null,
              booked_by:      userData.user.id,
              booked_by_name: fullName || null,
            })),
            { onConflict: 'employee_id,work_date,shift' }
          );
        }
        if (toUnbookExtra.length) {
          await supabase.from('ot_night_bookings')
            .delete()
            .eq('work_date', d)
            .eq('shift', otShift)
            .in('employee_id', toUnbookExtra);
        }
      }
    }

    /* ── Skill farming: +1 XP for employees working at stations requiring ≥70% skill ── */
    try {
      const { data: todayLogs } = await supabase
        .from('daily_production_logs')
        .select('employee_id, assigned_line, employees(employee_skills(skill_name, score))')
        .eq('work_date', workDateStr)
        .eq('is_present', true)
        .not('assigned_line', 'is', null);

      if (todayLogs?.length) {
        const stationIds = [...new Set(todayLogs.map(l => l.assigned_line))];
        const { data: reqs } = await supabase
          .from('station_requirements')
          .select('station_id, skill_name, min_score')
          .in('station_id', stationIds)
          .gte('min_score', 70);

        if (reqs?.length) {
          const skillUpserts = [];
          for (const log of todayLogs) {
            const stReqs = reqs.filter(r => String(r.station_id) === String(log.assigned_line));
            if (!stReqs.length) continue;
            const skills = log.employees?.employee_skills || [];
            const skillMap = Object.fromEntries(skills.map(s => [s.skill_name, s.score]));
            for (const req of stReqs) {
              const cur = Number(skillMap[req.skill_name] ?? 0);
              if (cur < req.min_score) {
                skillUpserts.push({ employee_id: log.employee_id, skill_name: req.skill_name, score: Math.min(cur + 1, req.min_score), updated_at: new Date().toISOString() });
              }
            }
          }
          if (skillUpserts.length) {
            await supabase.from('employee_skills').upsert(skillUpserts, { onConflict: 'employee_id,skill_name' });
          }
        }
      }
    } catch (_) { /* skill farming errors are non-critical */ }

    toast.success('บันทึกข้อมูลสำเร็จ!');

    /* ── Auto-open production session + Telegram notification ── */
    try {
      const isNight = shiftInfo.shift === 'night';

      // ไลน์ที่ถูกเช็คจริง (อาจมีหลายไลน์ถ้าเลือกทั้ง section)
      const checkedLineIds = [...new Set(displayed.map(emp => emp.line_id).filter(Boolean))];
      const checkedLines = lines.filter(l => checkedLineIds.includes(l.id));
      const lineNamesText = checkedLines.map(l => l.name).join(', ') || (selSection ? `Section: ${selSection}` : 'ทุกไลน์');

      // เปิด session ทุกไลน์ที่ถูกเช็ค (ถ้ายังไม่มี)
      // start_time ของกะดึกอ้างจากเช็คบ็อกซ์ OT ของพนักงานในไลน์นั้นจริง ๆ
      // (ไม่ใช่เวลาที่ SV กดบันทึก — เพราะ SV อาจกดบันทึกล่าช้ากว่าเวลาที่งานเริ่มจริง)
      let anyOtNight = false;
      for (const ln of checkedLines) {
        const lineHasOtNight = isNight && displayed.some(e =>
          e.line_id === ln.id && attendance[e.id]?.is_present && attendance[e.id]?.has_ot
        );
        const lineStartTime = !isNight ? '08:00' : (lineHasOtNight ? '20:00' : '22:30');
        if (lineHasOtNight) anyOtNight = true;

        const { data: exist } = await supabaseDR
          .from('production_sessions').select('id')
          .eq('work_date', workDateStr).eq('line_name', ln.name).eq('shift', shiftInfo.shift)
          .maybeSingle();
        if (!exist) {
          await supabaseDR.from('production_sessions').insert({
            work_date: workDateStr, line_name: ln.name,
            shift: shiftInfo.shift, start_time: lineStartTime,
            status: 'open', opened_by_name: fullName || 'SV',
            notes: lineHasOtNight ? 'OT กะดึก (Auto จากเช็คชื่อ)' : null,
          });
        }
      }

      const hasOtNight = anyOtNight;
      const startTime  = !isNight ? '08:00' : (hasOtNight ? '20:00' : '22:30');

      // summary สำหรับ Telegram
      const shown = displayed;
      const present = shown.filter(e => attendance[e.id]?.is_present).length;
      const absent  = shown.filter(e => attendance[e.id] && !attendance[e.id].is_present && !attendance[e.id].leave_type).length;
      const leave   = shown.filter(e => attendance[e.id]?.leave_type).length;
      const ot      = shown.filter(e => attendance[e.id]?.has_ot).length;

      await fetch(`https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({
          event: 'checkin_summary',
          summary: {
            line_name:   lineNamesText,
            shift:       shiftInfo.shift,
            shift_label: shiftInfo.label,
            work_date:   workDateStr,
            start_time:  startTime,
            has_ot_night: hasOtNight,
            total:   shown.length,
            present, absent, leave, ot,
            checked_by: fullName || 'SV',
          },
        }),
      }).catch(() => {}); // fire-and-forget, ไม่บล็อก
    } catch (_) { /* non-critical */ }

    setIsSaving(false);
  };

  /* ── Export: ฟอร์มกระดาษจริง (ใบขออนุมัติ OT + บันทึกการมาทำงาน) ─── */
  const ATT_CODE = { 'ลากิจ': 'ก', 'ลาป่วย': 'ป', 'ลาพักร้อน': 'ส' };

  const handleExportForms = async () => {
    setExporting(true);
    try {
      const [y, m] = exportMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const dayFrom = exportHalf === '1-15' ? 1 : 16;
      const dayTo   = exportHalf === '1-15' ? 15 : lastDay;
      const dateFrom = `${exportMonth}-${String(dayFrom).padStart(2, '0')}`;
      const dateTo   = `${exportMonth}-${String(dayTo).padStart(2, '0')}`;
      const days = [];
      for (let d = dayFrom; d <= dayTo; d++) days.push(d);

      let empQ = supabase.from('employees').select('id, employee_id_code, name, position, line_id').eq('is_active', true).order('employee_id_code');
      const { data: empData } = await empQ;
      const lineIds = exportSection ? lines.filter(l => l.section === exportSection).map(l => l.id) : null;
      const scopedEmp = (empData || []).filter(e => !lineIds || lineIds.includes(e.line_id));
      if (!scopedEmp.length) { toast.error('ไม่พบพนักงานในส่วนงานนี้'); setExporting(false); return; }

      const { data: logData } = await supabase
        .from('daily_production_logs')
        .select('employee_id, work_date, is_present, has_ot, has_extended_ot, leave_type, shift')
        .gte('work_date', dateFrom).lte('work_date', dateTo)
        .in('employee_id', scopedEmp.map(e => e.id))
        .limit(10000);

      const logsByEmp = {};
      (logData || []).forEach(l => {
        if (!logsByEmp[l.employee_id]) logsByEmp[l.employee_id] = {};
        logsByEmp[l.employee_id][l.work_date] = l;
      });

      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const { registerThaiFont } = await import('../lib/pdfThaiFont');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      registerThaiFont(doc);
      const deptLabel = exportSection || 'ทุกส่วนงาน';

      /* ── Form 1: ใบรายงานการปฏิบัติงานชดเชย/ทำ OT (ฟอร์ม 2) ───── */
      let y0 = 10;
      doc.setFontSize(11); doc.setFont('Sarabun', 'bold');
      doc.text('บริษัท ไทยซัมมิทออโตพาร์ท จำกัด', 14, y0);
      doc.setFontSize(13);
      doc.text('ใบรายงานการปฏิบัติงานชดเชย / ทำ OT', 148, y0, { align: 'center' });
      y0 += 6;
      doc.setFontSize(9); doc.setFont('Sarabun', 'normal');
      doc.text(`แผนก/ส่วนงาน: ${deptLabel}`, 14, y0);
      doc.text(`เดือน: ${m}  ปี ${y + 543}   ช่วงวันที่ ${dayFrom}-${dayTo}`, 148, y0, { align: 'center' });
      doc.text(`ชุดที่ 02`, 270, y0, { align: 'right' });

      const otHead = [['ลำดับ', 'เลขที่พนักงาน', 'ชื่อ-สกุล', ...days.map(String), 'รวม (ชม.)']];
      const otRows = scopedEmp.map((e, i) => {
        const logs = logsByEmp[e.id] || {};
        let total = 0;
        const cells = days.map(d => {
          const dateStr = `${exportMonth}-${String(d).padStart(2, '0')}`;
          const log = logs[dateStr];
          if (!log) return '';
          // สูตรเดียวกับ Report.jsx: กะดึก OT = 2 ชม.เสมอ / กะเช้า OT = 2 ชม. (หรือ 5 ชม.ถ้ามี extended OT)
          const hrs = !log.has_ot ? 0 : (log.shift === 'night' ? 2 : (log.has_extended_ot ? 5 : 2));
          total += hrs;
          return hrs ? String(hrs) : '';
        });
        return [i + 1, e.employee_id_code, e.name, ...cells, total || ''];
      });

      autoTable(doc, {
        head: otHead, body: otRows, startY: y0 + 4,
        styles: { font: 'Sarabun', fontSize: 6.5, halign: 'center', cellPadding: 1 },
        headStyles: { font: 'Sarabun', fillColor: [40, 60, 90], fontSize: 6.5 },
        columnStyles: { 2: { halign: 'left', cellWidth: 32 } },
        margin: { left: 14, right: 14 },
      });

      let yAfter = doc.lastAutoTable.finalY + 6;
      doc.setFontSize(7.5);
      [
        'หมายเหตุ:',
        '1. วันที่ 1-15 อยู่ในรอบจ่ายค่าตอบแทนวันที่ 22 ของเดือน',
        '2. วันที่ 16-สิ้นเดือน อยู่ในรอบจ่ายค่าตอบแทนวันที่ 7 ของเดือนถัดไป',
        '3. กรณีลา/ฝึกอบรมข้ามวัน ให้บันทึกในวันที่เกิดขึ้นจริง',
        '4. ชั่วโมง OT นับเฉพาะที่ได้รับอนุมัติให้ปฏิบัติงานจริง',
      ].forEach((t, i) => { doc.text(t, 14, yAfter + i * 4); });

      const sigY = yAfter + 26;
      const sigBoxes = ['ผู้บันทึก', 'ผู้ตรวจสอบ', 'ผู้อนุมัติแผนก', 'ผู้อนุมัติฝ่าย HRM'];
      sigBoxes.forEach((label, i) => {
        const x = 14 + i * 68;
        doc.rect(x, sigY, 60, 22);
        doc.setFontSize(7.5);
        doc.text(label, x + 30, sigY + 18, { align: 'center' });
        doc.text('ลงชื่อ ......................................', x + 30, sigY + 8, { align: 'center' });
      });

      /* ── Form 2: บันทึกการมาทำงาน (รายเดือน) ───────────────────── */
      doc.addPage();
      let y1 = 10;
      doc.setFontSize(11); doc.setFont('Sarabun', 'bold');
      doc.text('บริษัท ไทยซัมมิทออโตพาร์ท จำกัด', 14, y1);
      doc.setFontSize(13);
      doc.text('บันทึกการมาทำงาน', 148, y1, { align: 'center' });
      y1 += 6;
      doc.setFontSize(9); doc.setFont('Sarabun', 'normal');
      doc.text(`แผนก: ${deptLabel}`, 14, y1);
      doc.text(`เดือน ${m} ปี ${y + 543}   วันที่ ${dayFrom}-${dayTo}`, 148, y1, { align: 'center' });

      const attHead = [['ลำดับ', 'เลขที่พนักงาน', 'ชื่อ-สกุล', ...days.map(String)]];
      const attRows = scopedEmp.map((e, i) => {
        const logs = logsByEmp[e.id] || {};
        const cells = days.map(d => {
          const dateStr = `${exportMonth}-${String(d).padStart(2, '0')}`;
          const log = logs[dateStr];
          if (!log) return '';
          if (log.leave_type) return ATT_CODE[log.leave_type] || 'ล';
          if (!log.is_present) return 'ขาด';
          if (log.has_extended_ot) return '/OT+';
          if (log.has_ot) return '/OT';
          return '/';
        });
        return [i + 1, e.employee_id_code, e.name, ...cells];
      });

      autoTable(doc, {
        head: attHead, body: attRows, startY: y1 + 4,
        styles: { font: 'Sarabun', fontSize: 6.5, halign: 'center', cellPadding: 1 },
        headStyles: { font: 'Sarabun', fillColor: [40, 60, 90], fontSize: 6.5 },
        columnStyles: { 2: { halign: 'left', cellWidth: 32 } },
        margin: { left: 14, right: 14 },
      });

      const legendY = doc.lastAutoTable.finalY + 6;
      doc.setFontSize(7.5);
      doc.text('สัญลักษณ์ :  / = มาทำงาน   ขาด = ขาดงาน   ก = ลากิจ   ป = ลาป่วย   ส = ลาพักร้อน   /OT = ทำ OT ปกติ   /OT+ = ทำ OT ขยาย (23:00 น.)', 14, legendY);

      const sigY2 = legendY + 16;
      ['ผู้บังคับบัญชา / หัวหน้างาน', 'ผู้ตรวจสอบ (HRM)'].forEach((label, i) => {
        const x = 14 + i * 100;
        doc.rect(x, sigY2, 90, 22);
        doc.setFontSize(7.5);
        doc.text(label, x + 45, sigY2 + 18, { align: 'center' });
        doc.text('ลงชื่อ ......................................', x + 45, sigY2 + 8, { align: 'center' });
      });

      doc.save(`attendance_forms_${exportMonth}_${exportHalf}${exportSection ? '_' + exportSection : ''}.pdf`);
      toast.success('สร้างไฟล์ PDF สำเร็จ');
      setShowExport(false);
    } catch (err) {
      console.error(err);
      toast.error('สร้าง PDF ไม่สำเร็จ: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const sections = orgSections.length ? orgSections : [...new Set(lines.map(l => l.section))].sort();
  const linesForSection = selSection ? lines.filter(l => l.section === selSection) : lines;

  const displayed = employees.filter(emp => {
    if (filterShift && emp.assignedShift && emp.assignedShift !== shiftInfo.shift) return false;
    if (selLine)    return emp.line_id === Number(selLine);
    if (selSection) {
      const lineIds = linesForSection.map(l => l.id);
      return lineIds.includes(emp.line_id);
    }
    return true;
  });

  /* Summary counts */
  const counts = displayed.reduce((acc, emp) => {
    const s = getRowStatus(attendance[emp.id]);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page-content">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 3vw, 22px)', color: 'var(--text)' }}>
            📝 เช็คชื่อ & PPE
          </h2>
          <span style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: shiftInfo.shift === 'day' ? 'rgba(245,158,11,0.15)' : 'rgba(77,159,255,0.15)',
            color:      shiftInfo.shift === 'day' ? '#f59e0b'               : '#4d9fff',
            border: `1px solid ${shiftInfo.shift === 'day' ? 'rgba(245,158,11,0.3)' : 'rgba(77,159,255,0.3)'}`,
          }}>
            {shiftInfo.label} · {shiftInfo.timeRange}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{shiftInfo.workDateStr}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {realShiftInfo.shift === 'day' && (
            <button
              onClick={() => setPreviewNight(p => !p)}
              title="ดูตัวอย่างหน้าจอกะดึก (รวมคอลัมน์ OT พรุ่งนี้) — ปิดปุ่มบันทึกอัตโนมัติระหว่าง preview"
              style={{
                padding: '8px 14px', borderRadius: 8,
                border: '1px solid var(--border2)', fontSize: 12, cursor: 'pointer',
                background: previewNight ? 'rgba(6,182,212,0.15)' : 'var(--bg3)',
                color:      previewNight ? '#06b6d4'              : 'var(--text2)',
                fontWeight: previewNight ? 700 : 400,
              }}
            >
              {previewNight ? '👁 กำลัง Preview กะดึก' : '🌙 Preview กะดึก'}
            </button>
          )}
          <button
            onClick={() => setFilterShift(f => !f)}
            style={{
              padding: '8px 14px', borderRadius: 8,
              border: '1px solid var(--border2)', fontSize: 12, cursor: 'pointer',
              background: filterShift ? 'rgba(77,159,255,0.12)' : 'var(--bg3)',
              color:      filterShift ? 'var(--blue)'           : 'var(--text2)',
              fontWeight: filterShift ? 600 : 400,
            }}
          >
            {filterShift ? '👁 เฉพาะกะนี้' : '👥 ทุกคน'}
          </button>
          <button
            onClick={() => { setExportSection(selSection || ''); setShowExport(true); }}
            style={{
              padding: '8px 14px', borderRadius: 8,
              border: '1px solid var(--border2)', fontSize: 12, cursor: 'pointer',
              background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 600,
            }}
          >
            📄 ส่งออกฟอร์ม
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || previewNight}
            title={previewNight ? 'ปิดโหมด Preview ก่อนบันทึก' : undefined}
            style={{
              padding: '10px 22px',
              background: isSaving || previewNight ? 'var(--muted)' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
              cursor: previewNight ? 'not-allowed' : 'pointer',
            }}
          >
            {isSaving ? '⏳ กำลังบันทึก...' : previewNight ? '🔒 ปิด Preview ก่อนบันทึก' : '💾 บันทึก'}
          </button>
        </div>
      </div>

      {/* Section & Line filter bar — supervisor only */}
      {role !== 'leader' && lines.length > 0 && (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '12px 16px', marginBottom: 14,
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
          {/* Section tabs */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Section</span>
            <button
              onClick={() => { setSelSection(''); setSelLine(''); }}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: selSection === '' ? '2px solid var(--accent)' : '1px solid var(--border2)',
                background: selSection === '' ? 'var(--accent-dim)' : 'var(--bg3)',
                color: selSection === '' ? 'var(--accent)' : 'var(--text2)',
              }}
            >ทั้งหมด</button>
            {sections.map(sec => (
              <button
                key={sec}
                onClick={() => { setSelSection(sec); setSelLine(''); }}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: selSection === sec ? '2px solid var(--accent)' : '1px solid var(--border2)',
                  background: selSection === sec ? 'var(--accent-dim)' : 'var(--bg3)',
                  color: selSection === sec ? 'var(--accent)' : 'var(--text2)',
                }}
              >{sec}</button>
            ))}
          </div>

          {/* Divider */}
          {selSection && <div style={{ width: 1, height: 28, background: 'var(--border)' }} />}

          {/* Line dropdown */}
          {selSection && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>ไลน์</span>
              <select
                value={selLine}
                onChange={e => setSelLine(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, fontSize: 13, width: 'auto', minWidth: 180 }}
              >
                <option value="">— ทุกไลน์ใน {selSection} —</option>
                {linesForSection.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}

          {/* Employee count badge */}
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
            แสดง <span style={{ color: 'var(--text)', fontWeight: 700 }}>{displayed.length}</span> คน
          </div>
        </div>
      )}

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_META).map(([key, m]) => counts[key] ? (
          <span key={key} style={{
            fontSize: 12, padding: '3px 10px', borderRadius: 20,
            background: m.bg, color: m.color, border: `1px solid ${m.color}44`, fontWeight: 600,
          }}>
            {m.label} {counts[key]}
          </span>
        ) : null)}
        {role === 'leader' && <span style={{ fontSize: 12, color: 'var(--muted)', padding: '3px 0' }}>รวม {displayed.length} คน</span>}
      </div>

      {previewNight && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 14,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          fontSize: 13, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600,
        }}>
          🔒 <span>โหมด Preview กะดึก — เวลาจริงยังเป็นกะเช้า ปุ่มบันทึกถูกปิดไว้เพื่อป้องกันข้อมูลผิดพลาด กดปุ่ม "👁 กำลัง Preview กะดึก" อีกครั้งเพื่อออก</span>
        </div>
      )}

      <div style={{
        padding: '10px 14px', borderRadius: 8, marginBottom: 14,
        background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)',
        fontSize: 13, color: '#06b6d4', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        🚐 <span>
          {shiftInfo.shift === 'night'
            ? <>คอลัมน์ <strong>จองรถ OT / งานที่ทำ</strong> = จองล่วงหน้าว่าจะมาทำ OT คืนวันที่ {addDaysToDateStr(shiftInfo.workDateStr, 1)} พร้อมระบุงานที่จะทำ เพื่อใช้ออกรายงานให้ธุรการจองรถรับส่ง (ดูที่หน้า Report)</>
            : <>ติ๊ก <strong>OT</strong> แล้วเลือก <strong>งานที่ทำ</strong> ในคอลัมน์ขวา เพื่อใช้ออกรายงานให้ธุรการจองรถรับส่ง (ดูที่หน้า Report)</>}
          {!!extraAdvanceDates.length && (
            <> · 🔶 พบวันหยุดต่อเนื่อง <strong>{extraAdvanceDates.map(shortDateLabel).join(', ')}</strong> — เพิ่มช่องจองรถล่วงหน้าให้แล้ว</>
          )}
        </span>
      </div>

      {noSchedule && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 14,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          fontSize: 13, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ <span>ยังไม่มีตาราง shift สำหรับวันนี้ — ไปกำหนดได้ที่หน้า <strong>ตารางกะ</strong></span>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>พนักงาน</th>
              <th style={{ textAlign: 'center', minWidth: 48 }}>กะ</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>มางาน</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>หมวก</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>รองเท้า</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>ถุงมือ</th>
              <th style={{ textAlign: 'center', minWidth: 72 }} title="OT ปกติ | OT+23 = กะเช้าต่อถึง 23:00 (พิเศษ)">OT</th>
              <th style={{ minWidth: 220 }}>🏖️ การลา</th>
              <th style={{ minWidth: 140 }}>หมายเหตุ</th>
              <th style={{ textAlign: 'center', minWidth: 110 }}>สถานะ</th>
              <th style={{ textAlign: 'center', minWidth: 150 }} title="จองรถรับส่งสำหรับ OT พร้อมระบุงานที่ทำ — ใช้ออกรายงานให้ธุรการจองรถรับส่ง · ช่อง 🔶 = จองล่วงหน้าเพิ่มสำหรับวันหยุดต่อเนื่อง (ตามปฏิทินบริษัท)">🚐 จองรถ OT / งานที่ทำ</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(emp => {
              const rec = attendance[emp.id];
              if (!rec) return null;
              const status = getRowStatus(rec);
              const meta   = STATUS_META[status] || STATUS_META.absent;
              const hasLeave = !!rec.leave_type;

              return (
                <tr key={emp.id} style={{ background: meta.bg }}>
                  {/* Employee */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {emp.image_url
                        ? <img src={emp.image_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border2)', flexShrink: 0 }} />
                        : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>👤</div>
                      }
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{emp.employee_id_code}</div>
                      </div>
                    </div>
                  </td>

                  {/* Shift */}
                  <td style={{ textAlign: 'center' }}>
                    {emp.assignedShift
                      ? <span style={{ fontSize: 15 }}>{emp.assignedShift === 'day' ? '☀️' : '🌙'}</span>
                      : <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                    }
                  </td>

                  {/* มางาน */}
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ transform: 'scale(1.4)', accentColor: 'var(--accent)', width: 'auto' }}
                      checked={rec.is_present}
                      onChange={() => toggle(emp.id, 'is_present')}
                    />
                  </td>

                  {/* PPE */}
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_helmet} onChange={() => toggle(emp.id, 'has_helmet')} disabled={!rec.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_boots} onChange={() => toggle(emp.id, 'has_boots')} disabled={!rec.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_gloves} onChange={() => toggle(emp.id, 'has_gloves')} disabled={!rec.is_present} />
                  </td>

                  {/* OT */}
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: '#f59e0b', width: 'auto' }} checked={rec.has_ot} onChange={() => toggle(emp.id, 'has_ot')} disabled={!rec.is_present} />
                      {/* Special extended OT (day shift 20:00–23:00) — rare case */}
                      {(emp.assignedShift === 'day' || shiftInfo.shift === 'day') && rec.has_ot && (
                        <div
                          title="OT พิเศษ กะเช้า ต่อถึง 23:00"
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}
                          onClick={() => toggle(emp.id, 'has_extended_ot')}
                        >
                          <div style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                            padding: '2px 5px', borderRadius: 4,
                            background: rec.has_extended_ot ? 'rgba(239,68,68,0.15)' : 'var(--bg2)',
                            color: rec.has_extended_ot ? '#ef4444' : 'var(--muted)',
                            border: `1px solid ${rec.has_extended_ot ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                            transition: 'all 0.15s',
                          }}>
                            {rec.has_extended_ot ? '🔴 OT+23' : '○ OT+23'}
                          </div>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Leave column */}
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {/* Leave type */}
                      <select
                        value={rec.leave_type || ''}
                        onChange={e => setLeaveType(emp.id, e.target.value)}
                        style={{
                          padding: '5px 8px', borderRadius: 6, fontSize: 12,
                          border: `1px solid ${hasLeave ? '#a855f744' : 'var(--border2)'}`,
                          background: hasLeave ? 'rgba(168,85,247,0.08)' : 'var(--bg3)',
                          color: hasLeave ? '#a855f7' : 'var(--text2)',
                          width: '100%',
                        }}
                      >
                        <option value="">— ไม่ลา —</option>
                        {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>

                      {/* หมายเหตุ (แสดงเมื่อเลือก อื่นๆ) */}
                      {rec.leave_type === 'อื่นๆ' && (
                        <input
                          type="text"
                          placeholder="ระบุเหตุผล..."
                          value={rec.remark || ''}
                          onChange={e => setAttendance(prev => ({ ...prev, [emp.id]: { ...prev[emp.id], remark: e.target.value } }))}
                          style={{
                            padding: '4px 8px', borderRadius: 6, fontSize: 11,
                            border: '1px solid rgba(168,85,247,0.4)',
                            background: 'rgba(168,85,247,0.06)', color: 'var(--text)',
                            width: '100%',
                          }}
                        />
                      )}

                      {/* Duration (shown only when leave_type is set) */}
                      {hasLeave && (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {LEAVE_DURATION_OPTS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setLeaveDuration(emp.id, opt.value)}
                              style={{
                                flex: 1, padding: '3px 0', fontSize: 10, fontWeight: 700,
                                borderRadius: 5, border: 'none', cursor: 'pointer',
                                background: rec.leave_duration === opt.value ? '#a855f7' : 'var(--bg2)',
                                color: rec.leave_duration === opt.value ? '#fff' : 'var(--text2)',
                                transition: 'all 0.15s',
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Period selector — half day only */}
                      {hasLeave && rec.leave_duration === 'half' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {LEAVE_PERIOD_OPTS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setField(emp.id, 'leave_period', opt.value)}
                              title={opt.sub}
                              style={{
                                flex: 1, padding: '3px 4px', fontSize: 10, fontWeight: 700,
                                borderRadius: 5, border: 'none', cursor: 'pointer',
                                background: rec.leave_period === opt.value ? '#0ea5e9' : 'var(--bg2)',
                                color: rec.leave_period === opt.value ? '#fff' : 'var(--text2)',
                                transition: 'all 0.15s', lineHeight: 1.3,
                              }}
                            >
                              {opt.label}
                              <div style={{ fontSize: 8, opacity: 0.8, fontWeight: 400 }}>{opt.sub}</div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Hours input */}
                      {hasLeave && rec.leave_duration === 'hours' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="number"
                            min={0.5} max={8} step={0.5}
                            value={rec.leave_hours || ''}
                            onChange={e => setField(emp.id, 'leave_hours', e.target.value)}
                            placeholder="จำนวนชั่วโมง"
                            style={{ padding: '4px 8px', borderRadius: 5, fontSize: 12, width: '100%' }}
                          />
                          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>ชม.</span>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Remark */}
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      placeholder="หมายเหตุ..."
                      value={rec.remark || ''}
                      onChange={e => setField(emp.id, 'remark', e.target.value)}
                      style={{ fontSize: 12, padding: '5px 8px' }}
                    />
                  </td>

                  {/* Status */}
                  <td style={{ textAlign: 'center', fontWeight: 700, color: meta.color, whiteSpace: 'nowrap', fontSize: 12 }}>
                    {meta.label}
                    {hasLeave && rec.leave_type && (
                      <div style={{ fontSize: 10, fontWeight: 600, color: meta.color, marginTop: 1, opacity: 0.8 }}>
                        {rec.leave_type}
                      </div>
                    )}
                    {hasLeave && rec.leave_duration === 'hours' && rec.leave_hours && (
                      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)', marginTop: 1 }}>
                        {rec.leave_hours} ชม.
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      {shiftInfo.shift === 'night' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 9, color: 'var(--muted)' }}>{shortDateLabel(addDaysToDateStr(shiftInfo.workDateStr, 1))}</span>
                          <input
                            type="checkbox"
                            style={{ transform: 'scale(1.4)', accentColor: '#06b6d4', width: 'auto' }}
                            checked={!!otBookings[emp.id]}
                            onChange={() => toggleOtBooking(emp.id)}
                          />
                          {otBookings[emp.id] && (
                            <select
                              value={otTasks[emp.id] || ''}
                              onChange={e => setOtTask(emp.id, e.target.value || null)}
                              style={{ fontSize: 11, padding: '2px 4px', maxWidth: 130 }}
                            >
                              <option value="">— งานที่ทำ —</option>
                              {taskTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          )}
                        </div>
                      ) : rec.has_ot ? (
                        <select
                          value={otTasks[emp.id] || ''}
                          onChange={e => setOtTask(emp.id, e.target.value || null)}
                          style={{ fontSize: 11, padding: '2px 4px', maxWidth: 140 }}
                        >
                          <option value="">— งานที่ทำ —</option>
                          {taskTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                      )}

                      {/* จองรถล่วงหน้าเพิ่ม — วันหยุดต่อเนื่อง */}
                      {extraAdvanceDates.map(d => (
                        <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
                          <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700 }}>{shortDateLabel(d)} 🔶</span>
                          <input
                            type="checkbox"
                            style={{ transform: 'scale(1.3)', accentColor: '#f59e0b', width: 'auto' }}
                            checked={!!otExtraBookings[emp.id]?.[d]}
                            onChange={() => toggleOtExtraBooking(emp.id, d)}
                          />
                          {otExtraBookings[emp.id]?.[d] && (
                            <select
                              value={otExtraTasks[emp.id]?.[d] || ''}
                              onChange={e => setOtExtraTask(emp.id, d, e.target.value || null)}
                              style={{ fontSize: 11, padding: '2px 4px', maxWidth: 130 }}
                            >
                              <option value="">— งานที่ทำ —</option>
                              {taskTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}

            {displayed.length === 0 && (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>
                  ไม่มีพนักงานในกะนี้ — ลองกด 👥 ทุกคน
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Export forms modal */}
      {showExport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--card)', borderRadius: 12, padding: 22, width: 380, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14, color: 'var(--text)' }}>📄 ส่งออกฟอร์มกระดาษ (PDF)</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
              สร้างฟอร์ม 2 หน้า ตามฟอร์มกระดาษจริงที่ใช้หน้างาน:<br />
              1) ใบรายงานการปฏิบัติงานชดเชย/ทำ OT &nbsp; 2) บันทึกการมาทำงาน
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>เดือน</label>
            <input type="month" value={exportMonth} onChange={e => setExportMonth(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border2)', marginBottom: 12, background: 'var(--bg)', color: 'var(--text)' }} />

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>ช่วงครึ่งเดือน</label>
            <select value={exportHalf} onChange={e => setExportHalf(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border2)', marginBottom: 12, background: 'var(--bg)', color: 'var(--text)' }}>
              <option value="1-15">วันที่ 1-15</option>
              <option value="16-end">วันที่ 16-สิ้นเดือน</option>
            </select>

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>ส่วนงาน</label>
            <select value={exportSection} onChange={e => setExportSection(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border2)', marginBottom: 18, background: 'var(--bg)', color: 'var(--text)' }}>
              <option value="">— ทุกส่วนงาน —</option>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowExport(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={handleExportForms} disabled={exporting}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                {exporting ? '⏳ กำลังสร้าง...' : '⬇ สร้าง PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
