import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';

const LEAVE_TYPES = ['ลากิจ', 'ลาป่วย', 'ลาพักร้อน'];
const LEAVE_DURATION_OPTS = [
  { value: 'full',  label: 'เต็มวัน' },
  { value: 'half',  label: 'ครึ่งวัน' },
  { value: 'hours', label: 'ระบุชั่วโมง' },
];
const LEAVE_PERIOD_OPTS = [
  { value: 'morning',   label: '🌅 ลาช่วงเช้า', sub: 'มาบ่าย' },
  { value: 'afternoon', label: '🌇 ลาช่วงบ่าย', sub: 'มาเช้า' },
];

function getShiftInfo() {
  const now = new Date();
  const h = now.getHours();
  const totalMin = h * 60 + now.getMinutes();
  const isDay = totalMin >= 8 * 60 && totalMin < 20 * 60;
  const workDate = new Date(now);
  if (h < 8) workDate.setDate(workDate.getDate() - 1);
  return {
    shift:       isDay ? 'day' : 'night',
    workDateStr: workDate.toISOString().split('T')[0],
    label:       isDay ? '☀️ กะเช้า' : '🌙 กะดึก',
    timeRange:   isDay ? '08:00–19:59' : '20:00–07:59',
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
  const { role, lineId, team } = useContext(UserContext);

  const [employees,   setEmployees]   = useState([]);
  const [attendance,  setAttendance]  = useState({});
  const [isSaving,    setIsSaving]    = useState(false);
  const [filterShift, setFilterShift] = useState(true);
  const [noSchedule,  setNoSchedule]  = useState(false);

  const shiftInfo = getShiftInfo();

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const { workDateStr } = shiftInfo;

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
    ] = await Promise.all([
      empQ,
      supabase.from('daily_production_logs')
        .select('employee_id, is_present, has_helmet, has_boots, has_gloves, has_ot, remark, leave_type, leave_duration, leave_hours')
        .eq('work_date', workDateStr),
      supabase.from('shift_schedules').select('*').eq('work_date', workDateStr),
      supabase.from('shift_overrides').select('*').eq('work_date', workDateStr),
    ]);

    if (!empData) return;

    const lineSchedule = {};
    (scheduleData || []).forEach(s => { lineSchedule[s.line_id] = s.day_team; });
    setNoSchedule(Object.keys(lineSchedule).length === 0);

    const empOverride = {};
    (overrideData || []).forEach(o => { empOverride[o.employee_id] = o.shift; });

    const enriched = empData.map(emp => {
      let assignedShift = null;
      if (empOverride[emp.id]) {
        assignedShift = empOverride[emp.id];
      } else if (emp.line_id && lineSchedule[emp.line_id]) {
        const dayTeam = lineSchedule[emp.line_id];
        assignedShift = emp.team === dayTeam ? 'day' : emp.team ? 'night' : null;
      }
      return { ...emp, assignedShift };
    });

    setEmployees(enriched);

    const init = {};
    enriched.forEach(emp => {
      const log = logData?.find(l => l.employee_id === emp.id);
      init[emp.id] = {
        is_present:     log ? log.is_present     : false,
        has_helmet:     log ? log.has_helmet     : false,
        has_boots:      log ? log.has_boots      : false,
        has_gloves:     log ? log.has_gloves     : false,
        has_ot:         log ? log.has_ot         : false,
        remark:         log ? (log.remark || '') : '',
        leave_type:     log ? (log.leave_type     || '') : '',
        leave_duration: log ? (log.leave_duration || '') : '',
        leave_period:   log ? (log.leave_period   || '') : '',
        leave_hours:    log ? (log.leave_hours    || '') : '',
      };
    });
    setAttendance(init);
  };

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
    if (!userData?.user?.id) { alert('กรุณา Login ก่อน'); setIsSaving(false); return; }

    const { workDateStr } = shiftInfo;
    const logs = employees.map(emp => {
      const rec = attendance[emp.id];
      return {
        employee_id:    emp.id,
        work_date:      workDateStr,
        is_present:     rec.is_present,
        has_helmet:     rec.has_helmet,
        has_boots:      rec.has_boots,
        has_gloves:     rec.has_gloves,
        has_ot:         rec.has_ot,
        remark:         rec.remark || null,
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

    if (error) alert('เกิดข้อผิดพลาด: ' + error.message);
    else alert('บันทึกข้อมูลสำเร็จ!');
    setIsSaving(false);
  };

  const displayed = filterShift
    ? employees.filter(emp => !emp.assignedShift || emp.assignedShift === shiftInfo.shift)
    : employees;

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
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '10px 22px',
              background: isSaving ? 'var(--muted)' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
            }}
          >
            {isSaving ? '⏳ กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>

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
        <span style={{ fontSize: 12, color: 'var(--muted)', padding: '3px 0' }}>รวม {displayed.length} คน</span>
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
              <th style={{ textAlign: 'center', minWidth: 56 }}>OT</th>
              <th style={{ minWidth: 220 }}>🏖️ การลา</th>
              <th style={{ minWidth: 140 }}>หมายเหตุ</th>
              <th style={{ textAlign: 'center', minWidth: 110 }}>สถานะ</th>
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
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: '#f59e0b', width: 'auto' }} checked={rec.has_ot} onChange={() => toggle(emp.id, 'has_ot')} disabled={!rec.is_present} />
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
                </tr>
              );
            })}

            {displayed.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>
                  ไม่มีพนักงานในกะนี้ — ลองกด 👥 ทุกคน
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
