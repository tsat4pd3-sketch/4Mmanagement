import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function Checkin() {
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { fetchEmployees(); }, []);

  const fetchEmployees = async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data: empData, error: empError } = await supabase.from('employees').select('*').order('employee_id_code');
    const { data: logData } = await supabase.from('daily_production_logs').select('*').eq('work_date', today);

    if (empError) { console.error('Error fetching employees:', empError); return; }
    if (empData) {
      setEmployees(empData);
      const init = {};
      empData.forEach(emp => {
        const log = logData?.find(l => l.employee_id === emp.id);
        init[emp.id] = {
          is_present: log ? log.is_present : false,
          has_helmet: log ? log.has_helmet : false,
          has_boots: log ? log.has_boots : false,
          has_gloves: log ? log.has_gloves : false,
          remark: log ? log.remark : ''
        };
      });
      setAttendance(init);
    }
  };

  const toggle = (empId, field) =>
    setAttendance(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: !prev[empId][field] } }));

  const setRemark = (empId, value) =>
    setAttendance(prev => ({ ...prev, [empId]: { ...prev[empId], remark: value } }));

  const handleSave = async () => {
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) { alert('กรุณา Login ก่อน'); setIsSaving(false); return; }

    const logs = employees.map(emp => ({
      employee_id: emp.id,
      is_present: attendance[emp.id].is_present,
      has_helmet: attendance[emp.id].has_helmet,
      has_boots: attendance[emp.id].has_boots,
      has_gloves: attendance[emp.id].has_gloves,
      remark: attendance[emp.id].remark,
      checked_by: userData.user.id,
      work_date: new Date().toISOString().split('T')[0]
    }));

    const { error } = await supabase.from('daily_production_logs').upsert(logs, { onConflict: 'work_date, employee_id' });
    if (error) alert('เกิดข้อผิดพลาด: ' + error.message);
    else alert('บันทึกข้อมูลสำเร็จ!');
    setIsSaving(false);
  };

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 3vw, 22px)', color: 'var(--text)' }}>
          📝 เช็คชื่อ & PPE
        </h2>
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

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>พนักงาน</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>มางาน</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>หมวก</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>รองเท้า</th>
              <th style={{ textAlign: 'center', minWidth: 64 }}>ถุงมือ</th>
              <th style={{ minWidth: 160 }}>หมายเหตุ</th>
              <th style={{ textAlign: 'center', minWidth: 90 }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => {
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
