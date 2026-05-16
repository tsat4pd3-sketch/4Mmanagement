import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';

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

    // Build employee query scoped to user's line/team
    let empQ = supabase.from('employees').select('*').eq('is_active', true).order('employee_id_code');
    if (role === 'supervisor' && lineId) empQ = empQ.eq('line_id', lineId);
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
      supabase.from('daily_production_logs').select('*').eq('work_date', workDateStr),
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
        is_present: log ? log.is_present : false,
        has_helmet: log ? log.has_helmet : false,
        has_boots:  log ? log.has_boots  : false,
        has_gloves: log ? log.has_gloves : false,
        has_ot:     log ? log.has_ot     : false,
        remark:     log ? log.remark     : '',
      };
    });
    setAttendance(init);
  };

  const toggle = (empId, field) =>
    setAttendance(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: !prev[empId][field] } }));

  const setRemark = (empId, value) =>
    setAttendance(prev => ({ ...prev, [empId]: { ...prev[empId], remark: value } }));

  const handleSave = async () => {
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) { alert('กรุณา Login ก่อน'); setIsSaving(false); return; }

    const { workDateStr } = shiftInfo;
    const logs = employees.map(emp => ({
      employee_id: emp.id,
      work_date:   workDateStr,
      is_present:  attendance[emp.id].is_present,
      has_helmet:  attendance[emp.id].has_helmet,
      has_boots:   attendance[emp.id].has_boots,
      has_gloves:  attendance[emp.id].has_gloves,
      has_ot:      attendance[emp.id].has_ot,
      remark:      attendance[emp.id].remark,
      checked_by:  userData.user.id,
    }));

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

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 3vw, 22px)', color: 'var(--text)' }}>
            📝 เช็คชื่อ & PPE
          </h2>
          <span style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: shiftInfo.shift === 'day' ? 'rgba(245,158,11,0.15)' : 'rgba(77,159,255,0.15)',
            color:      shiftInfo.shift === 'day' ? '#f59e0b'              : '#4d9fff',
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

      {noSchedule && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 14,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          fontSize: 13, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>⚠️</span>
          <span>ยังไม่มีตาราง shift สำหรับวันนี้ ({shiftInfo.workDateStr}) — คอลัมน์ "กะ" จะแสดง — ทั้งหมด ไปกำหนดได้ที่หน้า <strong>ตารางกะ</strong></span>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 680 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>พนักงาน</th>
              <th style={{ textAlign: 'center', minWidth: 52 }}>กะ</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>มางาน</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>หมวก</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>รองเท้า</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>ถุงมือ</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>OT</th>
              <th style={{ minWidth: 160 }}>หมายเหตุ</th>
              <th style={{ textAlign: 'center', minWidth: 90 }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(emp => {
              const rec = attendance[emp.id];
              if (!rec) return null;
              const ready = rec.is_present && rec.has_helmet && rec.has_boots && rec.has_gloves;
              return (
                <tr key={emp.id} style={{ background: ready ? 'rgba(34,197,94,0.05)' : 'rgba(231,76,60,0.04)' }}>
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
                  <td style={{ textAlign: 'center' }}>
                    {emp.assignedShift
                      ? <span style={{ fontSize: 15 }}>{emp.assignedShift === 'day' ? '☀️' : '🌙'}</span>
                      : <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                    }
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--accent)', width: 'auto' }} checked={rec.is_present} onChange={() => toggle(emp.id, 'is_present')} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_helmet} onChange={() => toggle(emp.id, 'has_helmet')} disabled={!rec.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_boots} onChange={() => toggle(emp.id, 'has_boots')} disabled={!rec.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: 'var(--green)', width: 'auto' }} checked={rec.has_gloves} onChange={() => toggle(emp.id, 'has_gloves')} disabled={!rec.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.4)', accentColor: '#f59e0b', width: 'auto' }} checked={rec.has_ot} onChange={() => toggle(emp.id, 'has_ot')} disabled={!rec.is_present} />
                  </td>
                  <td>
                    <input
                      type="text"
                      placeholder="หมายเหตุ..."
                      value={rec.remark || ''}
                      onChange={e => setRemark(emp.id, e.target.value)}
                    />
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: ready ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {ready ? '🟢 พร้อม' : '🔴 ไม่พร้อม'}
                  </td>
                </tr>
              );
            })}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>
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
