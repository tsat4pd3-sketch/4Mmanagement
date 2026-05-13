import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function Operator() {
  const [employees, setEmployees] = useState([]);
  const [editingEmp, setEditingEmp] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { fetchEmployees(); }, []);

  const fetchEmployees = async () => {
    const { data, error } = await supabase.from('employees').select('*').order('employee_id_code');
    if (error) console.error('Error:', error);
    else setEmployees(data || []);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`⚠️ คุณแน่ใจหรือไม่ที่จะลบพนักงาน: ${name}?\nข้อมูลการเช็คอินและประวัติจะหายไปทั้งหมด`)) return;
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) alert('ไม่สามารถลบได้: ' + error.message);
    else { alert('ลบข้อมูลสำเร็จ'); fetchEmployees(); }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      let photoUrl = editingEmp.image_url;
      if (editingEmp.newPhoto) {
        const fileExt = editingEmp.newPhoto.name.split('.').pop();
        const fileName = `emp_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('employee-photos').upload(fileName, editingEmp.newPhoto);
        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage.from('employee-photos').getPublicUrl(fileName);
        photoUrl = publicUrlData.publicUrl;
      }
      const { error } = await supabase.from('employees').update({
        name: editingEmp.name,
        department: editingEmp.department,
        skill_welding: Number(editingEmp.skill_welding || 0),
        skill_spot_nut: Number(editingEmp.skill_spot_nut || 0),
        skill_quality_check: Number(editingEmp.skill_quality_check || 0),
        skill_refill_part: Number(editingEmp.skill_refill_part || 0),
        skill_management: Number(editingEmp.skill_management || 0),
        image_url: photoUrl
      }).eq('id', editingEmp.id);
      if (error) throw error;
      alert('💾 อัปเดตข้อมูลพนักงานเรียบร้อย!');
      setEditingEmp(null);
      fetchEmployees();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 3vw, 22px)', color: 'var(--text)' }}>
          👥 ฐานข้อมูลพนักงาน
        </h2>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>ทั้งหมด {employees.length} คน</span>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>โปรไฟล์</th>
              <th>ID</th>
              <th>ชื่อ - นามสกุล</th>
              <th>ทักษะ (%)</th>
              <th style={{ textAlign: 'center' }}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => (
              <tr key={emp.id}>
                <td>
                  <img
                    src={emp.image_url || 'https://via.placeholder.com/50'}
                    alt=""
                    style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border2)' }}
                  />
                </td>
                <td style={{ fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--font-display)' }}>
                  {emp.employee_id_code}
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{emp.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{emp.department || 'ไม่ระบุแผนก'}</div>
                </td>
                <td>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 8px', fontSize: 11 }}>
                    <span style={{ color: 'var(--text2)' }}>🛠️ <b style={{ color: 'var(--text)' }}>{emp.skill_welding}%</b></span>
                    <span style={{ color: 'var(--text2)' }}>🔩 <b style={{ color: 'var(--text)' }}>{emp.skill_spot_nut}%</b></span>
                    <span style={{ color: 'var(--text2)' }}>🔍 <b style={{ color: 'var(--text)' }}>{emp.skill_quality_check}%</b></span>
                    <span style={{ color: 'var(--text2)' }}>📦 <b style={{ color: 'var(--text)' }}>{emp.skill_refill_part}%</b></span>
                  </div>
                </td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => setEditingEmp({ ...emp, newPhoto: null })}
                    style={{ padding: '6px 12px', background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, marginRight: 6, fontSize: 13 }}
                  >
                    ✏️ แก้ไข
                  </button>
                  <button
                    onClick={() => handleDelete(emp.id, emp.name)}
                    style={{ padding: '6px 12px', background: 'rgba(231,76,60,0.12)', color: 'var(--red)', border: '1px solid rgba(231,76,60,0.25)', borderRadius: 6, fontSize: 13 }}
                  >
                    🗑️ ลบ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingEmp && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(600px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, borderBottom: '1px solid var(--border)', paddingBottom: 12, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              📝 แก้ไขข้อมูลพนักงาน
            </h3>
            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelSt}>ชื่อ - นามสกุล</label>
                  <input type="text" value={editingEmp.name} onChange={e => setEditingEmp({ ...editingEmp, name: e.target.value })} required />
                </div>
                <div>
                  <label style={labelSt}>แผนก</label>
                  <input type="text" value={editingEmp.department} onChange={e => setEditingEmp({ ...editingEmp, department: e.target.value })} />
                </div>
              </div>

              <div style={{ background: 'var(--bg2)', padding: 14, borderRadius: 10, marginTop: 4 }}>
                <label style={{ ...labelSt, marginBottom: 10, display: 'block' }}>📊 ระดับทักษะ (%)</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[
                    ['งานเชื่อม', 'skill_welding'],
                    ['สปอทนัท', 'skill_spot_nut'],
                    ['งาน QC', 'skill_quality_check'],
                    ['เติมพาร์ท', 'skill_refill_part'],
                    ['บริหาร', 'skill_management'],
                  ].map(([label, key]) => (
                    <div key={key}>
                      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
                      <input
                        type="number"
                        value={editingEmp[key]}
                        onChange={e => setEditingEmp({ ...editingEmp, [key]: e.target.value })}
                        min={0} max={100}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label style={labelSt}>อัปเดตรูปถ่าย</label>
                <input type="file" accept="image/*" onChange={e => setEditingEmp({ ...editingEmp, newPhoto: e.target.files[0] })} />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button type="submit" disabled={isSaving}
                  style={{ flex: 2, padding: 12, background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  {isSaving ? 'กำลังบันทึก...' : '💾 บันทึกข้อมูล'}
                </button>
                <button type="button" onClick={() => setEditingEmp(null)}
                  style={{ flex: 1, padding: 12, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8 }}>
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.04em', textTransform: 'uppercase'
};
