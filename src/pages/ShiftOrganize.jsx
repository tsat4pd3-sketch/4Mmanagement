import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';

function getWeekDates(refDate) {
  const d = new Date(refDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(mon);
    dt.setDate(mon.getDate() + i);
    return dt;
  });
}

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

const DAY_LABELS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

export default function ShiftOrganize() {
  const { role } = useContext(UserContext);
  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);

  const [weekRef,  setWeekRef]  = useState(new Date());
  const [lines,    setLines]    = useState([]);
  const [schedules, setSchedules] = useState({});
  const [pending,  setPending]  = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const [overrides,     setOverrides]     = useState([]);
  const [employees,     setEmployees]     = useState([]);
  const [showOvrModal,  setShowOvrModal]  = useState(false);
  const [ovrDate,       setOvrDate]       = useState(toDateStr(new Date()));
  const [ovrEmpId,      setOvrEmpId]      = useState('');
  const [ovrShift,      setOvrShift]      = useState('day');
  const [ovrReason,     setOvrReason]     = useState('');

  const weekDates = getWeekDates(weekRef);
  const weekStart = toDateStr(weekDates[0]);
  const weekEnd   = toDateStr(weekDates[6]);

  useEffect(() => {
    fetchLines();
    fetchEmployees();
  }, []);

  useEffect(() => {
    if (lines.length > 0) {
      fetchSchedules();
      fetchOverrides();
    }
  }, [weekRef, lines.length]);

  const fetchLines = async () => {
    const { data } = await supabase.from('production_lines').select('id, name, section').order('id');
    setLines(data || []);
  };

  const fetchEmployees = async () => {
    const { data } = await supabase.from('employees').select('id, name, employee_id_code').eq('is_active', true).order('name');
    setEmployees(data || []);
  };

  const fetchSchedules = async () => {
    const { data } = await supabase
      .from('shift_schedules')
      .select('work_date, line_id, day_team')
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd);
    const map = {};
    (data || []).forEach(r => { map[`${r.work_date}_${r.line_id}`] = r.day_team; });
    setSchedules(map);
    setPending({});
  };

  const fetchOverrides = async () => {
    const { data } = await supabase
      .from('shift_overrides')
      .select('id, work_date, employee_id, shift, reason, employees(name, employee_id_code)')
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd)
      .order('work_date');
    setOverrides(data || []);
  };

  const getTeam = (lineId, dateStr) => {
    const key = `${dateStr}_${lineId}`;
    return pending[key] !== undefined ? pending[key] : (schedules[key] || null);
  };

  const toggleTeam = (lineId, dateStr) => {
    if (!canEdit) return;
    const cur = getTeam(lineId, dateStr);
    setPending(p => ({ ...p, [`${dateStr}_${lineId}`]: cur === 'A' ? 'B' : 'A' }));
  };

  const pendingCount = Object.keys(pending).length;

  const handleSave = async () => {
    if (!pendingCount) return;
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const rows = Object.entries(pending).map(([key, day_team]) => {
      const [work_date, line_id] = key.split('_');
      return { work_date, line_id: parseInt(line_id), day_team, created_by: userId };
    });

    const { error } = await supabase
      .from('shift_schedules')
      .upsert(rows, { onConflict: 'work_date,line_id' });

    if (error) alert('เกิดข้อผิดพลาด: ' + error.message);
    else fetchSchedules();
    setIsSaving(false);
  };

  const handleAddOverride = async () => {
    if (!ovrEmpId) return;
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('shift_overrides').upsert([{
      work_date:   ovrDate,
      employee_id: ovrEmpId,
      shift:       ovrShift,
      reason:      ovrReason || null,
      created_by:  userData?.user?.id,
    }], { onConflict: 'work_date,employee_id' });
    if (error) alert('เกิดข้อผิดพลาด: ' + error.message);
    else { setShowOvrModal(false); setOvrEmpId(''); setOvrReason(''); fetchOverrides(); }
  };

  const handleDeleteOverride = async (id) => {
    await supabase.from('shift_overrides').delete().eq('id', id);
    fetchOverrides();
  };

  const prevWeek = () => { const d = new Date(weekRef); d.setDate(d.getDate() - 7); setWeekRef(d); };
  const nextWeek = () => { const d = new Date(weekRef); d.setDate(d.getDate() + 7); setWeekRef(d); };
  const goToday  = () => setWeekRef(new Date());

  const todayStr = toDateStr(new Date());

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
          🗓 ตารางกะการทำงาน
        </h2>
        {canEdit && pendingCount > 0 && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{ padding: '10px 22px', background: isSaving ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}
          >
            {isSaving ? '⏳ กำลังบันทึก...' : `💾 บันทึก (${pendingCount} รายการ)`}
          </button>
        )}
      </div>

      {/* Week Navigator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={prevWeek} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>‹</button>
        <button onClick={goToday}  style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12 }}>วันนี้</button>
        <button onClick={nextWeek} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>›</button>
        <span style={{ fontSize: 13, color: 'var(--text2)', marginLeft: 4 }}>
          {weekDates[0].toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
          {' — '}
          {weekDates[6].toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        {canEdit && (
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>คลิกเซลล์ ☀️ เพื่อสลับทีม</span>
        )}
      </div>

      {/* Schedule Grid */}
      <div className="card" style={{ overflowX: 'auto', marginBottom: 24 }}>
        <table style={{ minWidth: 680 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>ไลน์ผลิต</th>
              <th style={{ width: 70, textAlign: 'center', fontSize: 11 }}>กะ</th>
              {weekDates.map((d, i) => {
                const isToday = toDateStr(d) === todayStr;
                return (
                  <th key={i} style={{ textAlign: 'center', minWidth: 66, color: isToday ? 'var(--accent)' : 'var(--muted)' }}>
                    <div>{DAY_LABELS[i]}</div>
                    <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400 }}>{d.getDate()}/{d.getMonth() + 1}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const rows = [];
              rows.push(
                <tr key={`${line.id}-day`} style={{ background: 'rgba(255,255,255,0.01)' }}>
                  <td rowSpan={2} style={{ verticalAlign: 'middle', borderRight: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{line.name}</div>
                    {line.section && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{line.section}</div>}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 11, color: '#f59e0b', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap', padding: '6px 8px' }}>☀️ เช้า</td>
                  {weekDates.map(d => {
                    const ds = toDateStr(d);
                    const team = getTeam(line.id, ds);
                    const isPending = pending[`${ds}_${line.id}`] !== undefined;
                    return (
                      <td key={ds} style={{ textAlign: 'center', padding: '6px 4px' }}>
                        <div
                          onClick={() => toggleTeam(line.id, ds)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 40, height: 28, borderRadius: 6, fontSize: 13, fontWeight: 700,
                            cursor: canEdit ? 'pointer' : 'default',
                            border: isPending ? '2px solid var(--amber)' : '1px solid var(--border2)',
                            background: team === 'A' ? 'rgba(34,197,94,0.15)' : team === 'B' ? 'rgba(245,158,11,0.15)' : 'var(--bg3)',
                            color:      team === 'A' ? '#22c55e'              : team === 'B' ? '#f59e0b'              : 'var(--muted)',
                            transition: 'all 0.15s',
                            userSelect: 'none',
                          }}
                        >
                          {team || '—'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
              rows.push(
                <tr key={`${line.id}-night`}>
                  <td style={{ textAlign: 'center', fontSize: 11, color: '#4d9fff', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap', padding: '6px 8px', borderBottom: '2px solid var(--border)' }}>🌙 ดึก</td>
                  {weekDates.map(d => {
                    const ds = toDateStr(d);
                    const team = getTeam(line.id, ds);
                    const night = team === 'A' ? 'B' : team === 'B' ? 'A' : null;
                    return (
                      <td key={ds} style={{ textAlign: 'center', padding: '6px 4px', borderBottom: '2px solid var(--border)' }}>
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 40, height: 28, borderRadius: 6, fontSize: 13, fontWeight: 700,
                          border: '1px solid var(--border)',
                          background: night === 'A' ? 'rgba(34,197,94,0.08)' : night === 'B' ? 'rgba(245,158,11,0.08)' : 'transparent',
                          color:      night === 'A' ? 'rgba(34,197,94,0.65)' : night === 'B' ? 'rgba(245,158,11,0.65)' : 'var(--muted)',
                          opacity: 0.8,
                        }}>
                          {night || '—'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
              return rows;
            })}
          </tbody>
        </table>
      </div>

      {/* Individual Overrides */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text2)' }}>
          🔀 รายการพิเศษรายบุคคล (สัปดาห์นี้)
        </h3>
        {canEdit && (
          <button
            onClick={() => { setOvrDate(weekStart); setShowOvrModal(true); }}
            style={{ padding: '7px 16px', background: 'rgba(77,159,255,0.15)', color: 'var(--blue)', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}
          >
            ➕ เพิ่มรายการ
          </button>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 500 }}>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>รหัส</th>
              <th>พนักงาน</th>
              <th style={{ textAlign: 'center' }}>กะ</th>
              <th>เหตุผล</th>
              {canEdit && <th style={{ textAlign: 'center' }}>ลบ</th>}
            </tr>
          </thead>
          <tbody>
            {overrides.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>
                  ไม่มีรายการพิเศษในสัปดาห์นี้
                </td>
              </tr>
            )}
            {overrides.map(o => (
              <tr key={o.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{o.work_date}</td>
                <td style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--font-display)' }}>{o.employees?.employee_id_code}</td>
                <td style={{ fontSize: 13 }}>{o.employees?.name}</td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 700,
                    background: o.shift === 'day' ? 'rgba(245,158,11,0.15)' : 'rgba(77,159,255,0.15)',
                    color: o.shift === 'day' ? '#f59e0b' : '#4d9fff',
                  }}>
                    {o.shift === 'day' ? '☀️ เช้า' : '🌙 ดึก'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>{o.reason || '—'}</td>
                {canEdit && (
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => handleDeleteOverride(o.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }}>
                      🗑️
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Override Modal */}
      {showOvrModal && (
        <div className="overlay">
          <div className="modal">
            <h3 style={{ marginTop: 0, marginBottom: 18, fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: 16 }}>
              🔀 เพิ่มรายการพิเศษรายบุคคล
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelSt}>วันที่</label>
                <input type="date" value={ovrDate} onChange={e => setOvrDate(e.target.value)} />
              </div>
              <div>
                <label style={labelSt}>พนักงาน</label>
                <select value={ovrEmpId} onChange={e => setOvrEmpId(e.target.value)}>
                  <option value="">— เลือกพนักงาน —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.employee_id_code} — {emp.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelSt}>กะ</label>
                <select value={ovrShift} onChange={e => setOvrShift(e.target.value)}>
                  <option value="day">☀️ กะเช้า (08:00–19:59)</option>
                  <option value="night">🌙 กะดึก (20:00–07:59)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>เหตุผล (ถ้ามี)</label>
                <input type="text" placeholder="เช่น ขอเปลี่ยนกะ" value={ovrReason} onChange={e => setOvrReason(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={handleAddOverride} disabled={!ovrEmpId}
                  style={{ flex: 2, padding: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  บันทึก
                </button>
                <button onClick={() => setShowOvrModal(false)}
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

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
