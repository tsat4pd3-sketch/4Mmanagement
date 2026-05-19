import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';

const SECTIONS = ['PD1', 'PD2', 'PD3', 'PD4'];
const TEAMS    = ['A', 'B'];

export default function Register() {
  const { role, lineId: userLineId, section: userSection } = useContext(UserContext);
  const isSupervisor = role === 'supervisor';

  const [empCode,     setEmpCode]     = useState('');
  const [name,        setName]        = useState('');
  const [position,    setPosition]    = useState('');
  const [department,  setDepartment]  = useState('');
  const [section,     setSection]     = useState('');
  const [groupName,   setGroupName]   = useState('');
  const [lineId,      setLineId]      = useState(null);
  const [team,        setTeam]        = useState('');
  const [photo,       setPhoto]       = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lines,       setLines]       = useState([]);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section').order('name')
      .then(({ data }) => {
        setLines(data || []);
        if (isSupervisor && userSection) {
          setSection(userSection);
        }
      });
  }, []);

  const handleRegister = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) { alert('กรุณา Login ก่อนเพิ่มพนักงาน'); setIsUploading(false); return; }

      let photoUrl = null;
      if (photo) {
        const fileExt = photo.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('employee-photos').upload(fileName, photo);
        if (uploadError) throw uploadError;
        const { data: pub } = supabase.storage.from('employee-photos').getPublicUrl(fileName);
        photoUrl = pub.publicUrl;
      }

      const { error: insertError } = await supabase.from('employees').insert([{
        employee_id_code: empCode,
        name,
        position:   position  || null,
        department,
        section:    section   || null,
        group_name: groupName || null,
        team:       team      || null,
        line_id:    lineId    || null,
        image_url:  photoUrl,
        created_by: userId,
      }]);
      if (insertError) throw insertError;

      alert('เพิ่มพนักงานสำเร็จ!');
      setEmpCode(''); setName(''); setPosition(''); setDepartment('');
      setSection(isSupervisor && userSection ? userSection : '');
      setGroupName(''); setLineId(null);
      setTeam(''); setPhoto(null);
      document.getElementById('photo-upload').value = '';
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 80px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--card)',
        border: '1px solid var(--border2)',
        borderRadius: 16,
        padding: '36px 32px',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>
            📸 เพิ่มพนักงานใหม่
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>บันทึกข้อมูลพนักงานเข้าระบบ</p>
        </div>

        <div style={{ height: 2, background: 'var(--accent)', borderRadius: 2, marginBottom: 24, opacity: 0.6 }} />

        <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelSt}>รหัสพนักงาน</label>
            <input type="text" placeholder="เช่น EMP001" value={empCode} onChange={e => setEmpCode(e.target.value)} required />
          </div>

          <div>
            <label style={labelSt}>ชื่อ - นามสกุล</label>
            <input type="text" placeholder="ชื่อเต็มของพนักงาน" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>ตำแหน่งงาน</label>
              <select value={position} onChange={e => setPosition(e.target.value)}>
                <option value="">— เลือก —</option>
                <option value="Operator">Operator</option>
                <option value="Leader">Leader</option>
                <option value="Technician">Technician</option>
                <option value="Engineer">Engineer</option>
                <option value="QC">QC</option>
              </select>
            </div>
            <div>
              <label style={labelSt}>แผนก / สายงาน</label>
              <input type="text" placeholder="เช่น ฝ่ายผลิต" value={department} onChange={e => setDepartment(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Section</label>
              {isSupervisor && userSection ? (
                <input type="text" value={userSection} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
              ) : (
                <select value={section} onChange={e => setSection(e.target.value)}>
                  <option value="">— เลือก —</option>
                  {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
            <div>
              <label style={labelSt}>Team</label>
              <select value={team} onChange={e => setTeam(e.target.value)}>
                <option value="">— เลือก —</option>
                {TEAMS.map(t => <option key={t} value={t}>Team {t}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelSt}>Group / Line</label>
            {(() => {
              const lineOpts = isSupervisor && userSection
                ? lines.filter(l => l.section === userSection)
                : lines;
              return (
                <select value={groupName} onChange={e => {
                  const val = e.target.value;
                  setGroupName(val);
                  const line = lines.find(l => l.name === val);
                  setLineId(line?.id || null);
                }}>
                  <option value="">— เลือก Line —</option>
                  {lineOpts.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              );
            })()}
          </div>

          <div>
            <label style={labelSt}>รูปถ่าย (ถ้ามี)</label>
            <input id="photo-upload" type="file" accept="image/*" onChange={e => setPhoto(e.target.files[0])} />
          </div>

          <button
            type="submit"
            disabled={isUploading}
            style={{
              marginTop: 4, padding: '13px',
              background: isUploading ? 'var(--muted)' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
            }}
          >
            {isUploading ? 'กำลังบันทึก...' : 'บันทึกข้อมูลพนักงาน'}
          </button>
        </form>
      </div>
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
