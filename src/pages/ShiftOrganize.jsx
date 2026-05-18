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

export default function ShiftOrganize() {
  const { role } = useContext(UserContext);
  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);

  const [weekRef,   setWeekRef]   = useState(new Date());
  const [lines,     setLines]     = useState([]);
  const [weekTeams, setWeekTeams] = useState({}); // line_id → 'A' | 'B' | null
  const [pending,   setPending]   = useState({}); // line_id → 'A' | 'B'
  const [isSaving,  setIsSaving]  = useState(false);

  const [overrides,    setOverrides]    = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [showOvrModal, setShowOvrModal] = useState(false);
  const [ovrDate,      setOvrDate]      = useState(toDateStr(new Date()));
  const [ovrEmpId,     setOvrEmpId]     = useState('');
  const [ovrShift,     setOvrShift]     = useState('day');
  const [ovrReason,    setOvrReason]    = useState('');

  const weekDates = getWeekDates(weekRef);
  const weekStart = toDateStr(weekDates[0]); // Monday
  const weekEnd   = toDateStr(weekDates[6]); // Sunday

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
    // Use Monday's record as the canonical setting for the week
    const { data } = await supabase
      .from('shift_schedules')
      .select('line_id, day_team')
      .eq('work_date', weekStart);
    const map = {};
    (data || []).forEach(r => { map[r.line_id] = r.day_team; });
    setWeekTeams(map);
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

  const getTeam = (lineId) =>
    pending[lineId] !== undefined ? pending[lineId] : (weekTeams[lineId] || null);

  const toggleTeam = (lineId) => {
    if (!canEdit) return;
    const cur = getTeam(lineId);
    setPending(p => ({ ...p, [lineId]: cur === 'A' ? 'B' : 'A' }));
  };

  const pendingCount = Object.keys(pending).length;

  const handleSave = async () => {
    if (!pendingCount) return;
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    // Apply the same team to every day of the selected week
    const rows = [];
    for (const [lineId, day_team] of Object.entries(pending)) {
      for (const d of weekDates) {
        rows.push({ work_date: toDateStr(d), line_id: parseInt(lineId), day_team, created_by: userId });
      }
    }

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

  const fmtDate = (d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

  return (
    <div className="page-content">
      {/* Header */}
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
            {isSaving ? '⏳ กำลังบันทึก...' : `💾 บันทึก (${pendingCount} ไลน์)`}
          </button>
        )}
      </div>

      {/* Week Navigator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={prevWeek} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>‹</button>
        <button onClick={goToday}  style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12 }}>วันนี้</button>
        <button onClick={nextWeek} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>›</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>สัปดาห์</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            จ. {fmtDate(weekDates[0])} — อา. {fmtDate(weekDates[6])}
          </span>
        </div>
      </div>

      {/* Weekly Shift Table */}
      <div className="card" style={{ marginBottom: 8 }}>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 180 }}>ไลน์ผลิต</th>
              <th style={{ minWidth: 80 }}>Section</th>
              <th style={{ textAlign: 'center', minWidth: 130 }}>☀️ กะเช้า</th>
              <th style={{ textAlign: 'center', minWidth: 130 }}>🌙 กะดึก</th>
              {canEdit && <th style={{ textAlign: 'center', minWidth: 90 }}>จัดการ</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const team  = getTeam(line.id);
              const night = team === 'A' ? 'B' : team === 'B' ? 'A' : null;
              const isPending = pending[line.id] !== undefined;
              return (
                <tr key={line.id}>
                  <td style={{ fontWeight: 600, fontSize: 14 }}>{line.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{line.section || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    {team ? (
                      <span style={{
                        display: 'inline-block', padding: '5px 20px', borderRadius: 7,
                        fontSize: 14, fontWeight: 800,
                        background: team === 'A' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                        color:      team === 'A' ? '#22c55e'              : '#f59e0b',
                        border: isPending
                          ? `2px solid ${team === 'A' ? '#22c55e' : '#f59e0b'}`
                          : '1px solid transparent',
                      }}>
                        Team {team}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่กำหนด</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {night ? (
                      <span style={{
                        display: 'inline-block', padding: '5px 20px', borderRadius: 7,
                        fontSize: 14, fontWeight: 800,
                        background: night === 'A' ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
                        color:      night === 'A' ? 'rgba(34,197,94,0.6)'  : 'rgba(245,158,11,0.6)',
                        border: '1px solid transparent',
                      }}>
                        Team {night}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => toggleTeam(line.id)}
                        style={{
                          padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                          border: '1px solid var(--border2)',
                          background: isPending ? 'rgba(245,158,11,0.12)' : 'var(--bg3)',
                          color: isPending ? 'var(--amber)' : 'var(--text2)',
                          cursor: 'pointer',
                        }}
                      >
                        {team ? '⇄ สลับ' : '+ กำหนด'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 24, padding: '0 4px' }}>
          การตั้งค่าจะมีผลกับทุกวันในสัปดาห์ (จันทร์–อาทิตย์) กด ⇄ สลับ แล้วกด 💾 บันทึก เพื่อบันทึกการเปลี่ยนแปลง
        </div>
      )}

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
