import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function Operator() {
  const [employees, setEmployees] = useState([]);
  const [editingEmp, setEditingEmp] = useState(null); 
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
     // ใช้ '*' เพื่อดึงทุกคอลัมน์ รวมถึงชื่อใหม่ที่เราแก้ใน SQL ด้วย
     const { data, error } = await supabase
       .from('employees')
       .select('*') 
       .order('employee_id_code');
    
    if (error) console.error('Error:', error);
    else setEmployees(data || []);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`⚠️ คุณแน่ใจหรือไม่ที่จะลบพนักงาน: ${name}?\nข้อมูลการเช็คอินและประวัติจะหายไปทั้งหมด`)) return;
    
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) {
      alert('ไม่สามารถลบได้: ' + error.message);
    } else {
      alert('ลบข้อมูลสำเร็จ');
      fetchEmployees();
    }
  };

  const openEditModal = (emp) => {
    setEditingEmp({ ...emp, newPhoto: null });
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      let photoUrl = editingEmp.image_url;

      if (editingEmp.newPhoto) {
        const fileExt = editingEmp.newPhoto.name.split('.').pop();
        const fileName = `emp_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('employee-photos')
          .upload(fileName, editingEmp.newPhoto);

        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage.from('employee-photos').getPublicUrl(fileName);
        photoUrl = publicUrlData.publicUrl;
      }

      const { error: updateError } = await supabase
        .from('employees')
        .update({
          name: editingEmp.name,
          department: editingEmp.department,
          // อัปเดตให้ตรงกับชื่อ Skill ใหม่ที่เราตั้งไว้
          skill_welding: Number(editingEmp.skill_welding || 0),
          skill_spot_nut: Number(editingEmp.skill_spot_nut || 0),
          skill_quality_check: Number(editingEmp.skill_quality_check || 0),
          skill_refill_part: Number(editingEmp.skill_refill_part || 0),
          skill_management: Number(editingEmp.skill_management || 0),
          image_url: photoUrl
        })
        .eq('id', editingEmp.id);

      if (updateError) throw updateError;

      alert('💾 อัปเดตข้อมูลพนักงานเรียบร้อย!');
      setEditingEmp(null);
      fetchEmployees();
    } catch (error) {
      alert('เกิดข้อผิดพลาด: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#2c3e50', margin: 0 }}>👥 ฐานข้อมูลพนักงาน (Operator Master)</h2>
        <span style={{ fontSize: '14px', color: '#7f8c8d' }}>จำนวนพนักงานทั้งหมด: {employees.length} คน</span>
      </div>
      
      <div style={{ backgroundColor: 'white', borderRadius: '15px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#1a252f', color: 'white', textAlign: 'left' }}>
              <th style={thStyle}>โปรไฟล์</th>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>ชื่อ - นามสกุล</th>
              <th style={thStyle}>ทักษะความสามารถ (%)</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => (
              <tr key={emp.id} style={{ borderBottom: '1px solid #f1f1f1', transition: 'background 0.2s' }} className="row-hover">
                <td style={tdStyle}>
                  <img src={emp.image_url || 'https://via.placeholder.com/50'} alt="" style={{ width: '50px', height: '50px', borderRadius: '12px', objectFit: 'cover', border: '1px solid #eee' }} />
                </td>
                <td style={{ ...tdStyle, fontWeight: 'bold', color: '#2980b9' }}>{emp.employee_id_code}</td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 'bold' }}>{emp.name}</div>
                  <div style={{ fontSize: '12px', color: '#95a5a6' }}>{emp.department || 'ไม่ระบุแผนก'}</div>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', fontSize: '11px' }}>
                    <span>🛠️ เชื่อม: <b>{emp.skill_welding}%</b></span>
                    <span>🔩 สปอท: <b>{emp.skill_spot_nut}%</b></span>
                    <span>🔍 QC: <b>{emp.skill_quality_check}%</b></span>
                    <span>📦 เติมพาร์ท: <b>{emp.skill_refill_part}%</b></span>
                  </div>
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <button onClick={() => openEditModal(emp)} style={btnEdit}>✏️ แก้ไข</button>
                  <button onClick={() => handleDelete(emp.id, emp.name)} style={btnDelete}>🗑️ ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal แก้ไขพนักงาน */}
      {editingEmp && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h3 style={{ marginTop: 0, borderBottom: '2px solid #eee', paddingBottom: '10px' }}>📝 แก้ไขข้อมูลพนักงาน</h3>
            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '15px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div>
                  <label style={labelStyle}>ชื่อ - นามสกุล</label>
                  <input type="text" value={editingEmp.name} onChange={e => setEditingEmp({...editingEmp, name: e.target.value})} style={inputStyle} required />
                </div>
                <div>
                  <label style={labelStyle}>แผนก</label>
                  <input type="text" value={editingEmp.department} onChange={e => setEditingEmp({...editingEmp, department: e.target.value})} style={inputStyle} />
                </div>
              </div>

              <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '10px', marginTop: '10px' }}>
                <label style={{ ...labelStyle, marginBottom: '10px', display: 'block' }}>📊 ระดับทักษะ (Skill Level %)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                   <div><small>งานเชื่อม</small><input type="number" value={editingEmp.skill_welding} onChange={e => setEditingEmp({...editingEmp, skill_welding: e.target.value})} style={inputStyle} /></div>
                   <div><small>สปอทนัท</small><input type="number" value={editingEmp.skill_spot_nut} onChange={e => setEditingEmp({...editingEmp, skill_spot_nut: e.target.value})} style={inputStyle} /></div>
                   <div><small>งาน QC</small><input type="number" value={editingEmp.skill_quality_check} onChange={e => setEditingEmp({...editingEmp, skill_quality_check: e.target.value})} style={inputStyle} /></div>
                   <div><small>เติมพาร์ท</small><input type="number" value={editingEmp.skill_refill_part} onChange={e => setEditingEmp({...editingEmp, skill_refill_part: e.target.value})} style={inputStyle} /></div>
                   <div><small>บริหาร</small><input type="number" value={editingEmp.skill_management} onChange={e => setEditingEmp({...editingEmp, skill_management: e.target.value})} style={inputStyle} /></div>
                </div>
              </div>

              <div style={{ marginTop: '10px' }}>
                <label style={labelStyle}>อัปเดตรูปถ่าย</label>
                <input type="file" accept="image/*" onChange={e => setEditingEmp({...editingEmp, newPhoto: e.target.files[0]})} style={inputStyle} />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="submit" disabled={isSaving} style={btnSave}>{isSaving ? 'กำลังบันทึก...' : '💾 บันทึกข้อมูล'}</button>
                <button type="button" onClick={() => setEditingEmp(null)} style={btnCancel}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Styles
const thStyle = { padding: '15px', fontSize: '14px', fontWeight: '500' };
const tdStyle = { padding: '15px', fontSize: '14px', verticalAlign: 'middle' };
const inputStyle = { width: '100%', padding: '10px', marginTop: '5px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' };
const labelStyle = { fontSize: '13px', fontWeight: '600', color: '#34495e' };
const modalOverlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 };
const modalContent = { backgroundColor: 'white', padding: '30px', borderRadius: '15px', width: '600px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' };
const btnEdit = { padding: '6px 12px', backgroundColor: '#f39c12', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '8px' };
const btnDelete = { padding: '6px 12px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' };
const btnSave = { flex: 2, padding: '12px', backgroundColor: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };
const btnCancel = { flex: 1, padding: '12px', backgroundColor: '#95a5a6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' };