import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function Checkin() {
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    const today = new Date().toISOString().split('T')[0];
    
    // 1. ดึงรายชื่อพนักงานทั้งหมด
    const { data: empData, error: empError } = await supabase.from('employees').select('*').order('employee_id_code');
    
    // 2. ดึงข้อมูลประวัติการเช็คชื่อที่อาจจะเคยบันทึกไว้แล้วของ "วันนี้"
    const { data: logData, error: logError } = await supabase
      .from('daily_production_logs')
      .select('*')
      .eq('work_date', today);

    if (empError) {
      console.error('Error fetching employees:', empError);
      return;
    }

    if (empData) {
      setEmployees(empData);
      const initialAttendance = {};
      
      empData.forEach(emp => {
        // ค้นหาว่าคนนี้มี log ของวันนี้หรือยัง ถ้ามีให้ดึงค่าเดิมมาแสดง
        const existingLog = logData?.find(l => l.employee_id === emp.id);
        
        initialAttendance[emp.id] = {
          is_present: existingLog ? existingLog.is_present : false,
          has_helmet: existingLog ? existingLog.has_helmet : false,
          has_boots: existingLog ? existingLog.has_boots : false,
          has_gloves: existingLog ? existingLog.has_gloves : false,
          remark: existingLog ? existingLog.remark : '' // ดึงค่า remark เดิมมาโชว์
        };
      });
      setAttendance(initialAttendance);
    }
  };

  const handleCheckboxChange = (empId, field) => {
    setAttendance(prev => ({
      ...prev,
      [empId]: { ...prev[empId], [field]: !prev[empId][field] }
    }));
  };

  const handleRemarkChange = (empId, value) => {
    setAttendance(prev => ({
      ...prev,
      [empId]: { ...prev[empId], remark: value }
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    
    if (!userData?.user?.id) {
      alert('กรุณา Login ก่อนบันทึกข้อมูล');
      setIsSaving(false);
      return;
    }

    const logsToSave = employees.map(emp => ({
      employee_id: emp.id,
      is_present: attendance[emp.id].is_present,
      has_helmet: attendance[emp.id].has_helmet,
      has_boots: attendance[emp.id].has_boots,
      has_gloves: attendance[emp.id].has_gloves,
      remark: attendance[emp.id].remark, // บันทึก remark ลงไปด้วย
      checked_by: userData.user.id,
      work_date: new Date().toISOString().split('T')[0]
    }));

    // ใช้ upsert เพื่อให้บันทึกซ้ำหรือแก้ไขข้อมูลของวันเดิมได้
    const { error } = await supabase.from('daily_production_logs').upsert(logsToSave, { onConflict: 'work_date, employee_id' });
    
    if (error) {
      alert('เกิดข้อผิดพลาด: ' + error.message);
    } else {
      alert('บันทึกข้อมูลสำเร็จ!');
    }
    setIsSaving(false);
  };

  return (
    <div style={{ padding: '30px', maxWidth: '1100px', margin: '0 auto' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '20px', color: '#ecf0f1' }}>📝 เช็คชื่อและตรวจสอบอุปกรณ์ PPE</h2>
      
      <div style={{ backgroundColor: 'white', borderRadius: '10px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#34495e', color: 'white', textAlign: 'left' }}>
              <th style={{ padding: '15px', borderRadius: '10px 0 0 0' }}>พนักงาน</th>
              <th style={{ padding: '15px', textAlign: 'center' }}>มางาน</th>
              <th style={{ padding: '15px', textAlign: 'center' }}>หมวก</th>
              <th style={{ padding: '15px', textAlign: 'center' }}>รองเท้า</th>
              <th style={{ padding: '15px', textAlign: 'center' }}>ถุงมือ</th>
              <th style={{ padding: '15px' }}>หมายเหตุ (Remark)</th>
              <th style={{ padding: '15px', textAlign: 'center', borderRadius: '0 10px 0 0' }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => {
              const record = attendance[emp.id];
              if (!record) return null;
              
              // ลอจิก: ต้องมาทำงาน และ PPE ครบ 3 อย่าง จึงจะพร้อม
              const isReady = record.is_present && record.has_helmet && record.has_boots && record.has_gloves;

              return (
                <tr key={emp.id} style={{ borderBottom: '1px solid #ddd', backgroundColor: isReady ? '#e8f8f5' : '#fdedec' }}>
                  
                  {/* รูปและชื่อพนักงาน */}
                  <td style={{ padding: '10px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {emp.image_url ? (
                      <img src={emp.image_url} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #fff', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} />
                    ) : (
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#bdc3c7', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '20px' }}>👤</div>
                    )}
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#2c3e50' }}>{emp.name}</div>
                      <div style={{ fontSize: '12px', color: '#7f8c8d' }}>{emp.employee_id_code}</div>
                    </div>
                  </td>

                  {/* ติ๊กถูกต่างๆ */}
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.5)', cursor: 'pointer' }} checked={record.is_present} onChange={() => handleCheckboxChange(emp.id, 'is_present')} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.5)', cursor: 'pointer' }} checked={record.has_helmet} onChange={() => handleCheckboxChange(emp.id, 'has_helmet')} disabled={!record.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.5)', cursor: 'pointer' }} checked={record.has_boots} onChange={() => handleCheckboxChange(emp.id, 'has_boots')} disabled={!record.is_present} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" style={{ transform: 'scale(1.5)', cursor: 'pointer' }} checked={record.has_gloves} onChange={() => handleCheckboxChange(emp.id, 'has_gloves')} disabled={!record.is_present} />
                  </td>

                  {/* ช่องกรอกหมายเหตุ */}
                  <td style={{ padding: '10px' }}>
                    <input 
                      type="text" 
                      placeholder="เช่น ขาดถุงมือ แต่เบิกใหม่แล้ว..." 
                      value={record.remark || ''} 
                      onChange={(e) => handleRemarkChange(emp.id, e.target.value)}
                      style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '90%', fontSize: '14px' }}
                    />
                  </td>

                  {/* สถานะ */}
                  <td style={{ textAlign: 'center', fontWeight: 'bold', color: isReady ? '#27ae60' : '#c0392b' }}>
                    {isReady ? '🟢 พร้อม' : '🔴 ไม่พร้อม'}
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ปุ่มบันทึก */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
          <button onClick={handleSave} disabled={isSaving} style={{ padding: '12px 30px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '5px', fontSize: '16px', fontWeight: 'bold', cursor: isSaving ? 'not-allowed' : 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            {isSaving ? '⏳ กำลังบันทึก...' : '💾 บันทึกข้อมูลประจำวัน'}
          </button>
        </div>
      </div>
    </div>
  );
}