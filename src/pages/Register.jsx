import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function Register() {
  const [empCode, setEmpCode] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [photo, setPhoto] = useState(null); // เก็บไฟล์รูปภาพ
  const [isUploading, setIsUploading] = useState(false); // สถานะตอนกำลังโหลด

  const handleRegister = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    
    try {
      // 1. เช็คว่า Login อยู่ไหม
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      if (!userId) {
        alert('กรุณา Login ก่อนเพิ่มพนักงาน');
        setIsUploading(false);
        return;
      }

      let photoUrl = null;

      // 2. ถ้ามีการแนบรูปมา ให้ทำการอัปโหลดรูปขึ้น Storage ก่อน
      if (photo) {
        // ตั้งชื่อไฟล์ใหม่ให้ไม่ซ้ำกัน (ใช้วันที่เวลาปัจจุบัน + ชื่อไฟล์เดิม)
        const fileExt = photo.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;

        // อัปโหลดไฟล์
        const { error: uploadError } = await supabase.storage
          .from('employee-photos')
          .upload(fileName, photo);

        if (uploadError) throw uploadError;

        // ดึง URL แบบ Public ของรูปที่เพิ่งอัปโหลด
        const { data: publicUrlData } = supabase.storage
          .from('employee-photos')
          .getPublicUrl(fileName);
          
        photoUrl = publicUrlData.publicUrl;
      }

      // 3. บันทึกข้อมูลทั้งหมด (พร้อม URL รูป) ลงตาราง employees
      const { error: insertError } = await supabase
        .from('employees')
        .insert([
          { 
            employee_id_code: empCode, 
            name: name, 
            department: department,
            image_url: photoUrl, // บันทึกลิงก์รูปลงตาราง
            created_by: userId
          }
        ]);

      if (insertError) throw insertError;

      alert('เพิ่มพนักงานพร้อมรูปถ่ายสำเร็จ!');
      // ล้างฟอร์ม
      setEmpCode(''); setName(''); setDepartment(''); setPhoto(null);
      // เคลียร์ input file
      document.getElementById('photo-upload').value = '';

    } catch (error) {
      alert('เกิดข้อผิดพลาด: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', backgroundColor: 'white', borderRadius: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>📸 เพิ่มพนักงานใหม่</h2>
      <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        
        <input 
          type="text" 
          placeholder="รหัสพนักงาน (เช่น EMP001)" 
          value={empCode} 
          onChange={(e) => setEmpCode(e.target.value)} 
          required 
          style={inputStyle}
        />
        
        <input 
          type="text" 
          placeholder="ชื่อ - นามสกุล" 
          value={name} 
          onChange={(e) => setName(e.target.value)} 
          required 
          style={inputStyle}
        />
        
        <input 
          type="text" 
          placeholder="แผนก / สายงาน" 
          value={department} 
          onChange={(e) => setDepartment(e.target.value)} 
          style={inputStyle}
        />

        {/* ส่วนอัปโหลดรูปภาพ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ fontSize: '14px', fontWeight: 'bold', color: '#7f8c8d' }}>อัปโหลดรูปถ่ายพนักงาน (ถ้ามี):</label>
          <input 
            id="photo-upload"
            type="file" 
            accept="image/*" 
            onChange={(e) => setPhoto(e.target.files[0])}
            style={{ padding: '10px', border: '1px dashed #bdc3c7', borderRadius: '5px' }}
          />
        </div>

        <button 
          type="submit" 
          disabled={isUploading}
          style={{ 
            padding: '12px', 
            backgroundColor: isUploading ? '#95a5a6' : '#2ecc71', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px',
            fontWeight: 'bold',
            cursor: isUploading ? 'not-allowed' : 'pointer'
          }}
        >
          {isUploading ? 'กำลังบันทึกข้อมูล...' : 'บันทึกข้อมูลพนักงาน'}
        </button>
      </form>
    </div>
  );
}

const inputStyle = { padding: '12px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '16px' };