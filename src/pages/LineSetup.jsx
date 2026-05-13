import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function LineSetup() {
  const [selectedLine, setSelectedLine] = useState('Line A');
  const [layoutImage, setLayoutImage] = useState(null);
  const [stations, setStations] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [tempPos, setTempPos] = useState(null); 
  const [formData, setFormData] = useState({ id: null, name: '', minScore: 70, skills: [] });

  const skillOptions = [
    { id: 'skill_welding', label: 'งานเชื่อม' },
    { id: 'skill_spot_nut', label: 'งานสปอทนัท' },
    { id: 'skill_quality_check', label: 'งาน QC' },
    { id: 'skill_refill_part', label: 'งานเติมพาร์ท' },
    { id: 'skill_management', label: 'งานบริหาร' }
  ];

  useEffect(() => { fetchLineData(); }, [selectedLine]);

  const fetchLineData = async () => {
    const { data: layoutData } = await supabase.from('line_layouts').select('*').eq('line_name', selectedLine).single();
    setLayoutImage(layoutData?.image_url || null);
    const { data: stationData } = await supabase.from('workstations').select('*').eq('line_name', selectedLine);
    setStations(stationData || []);
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setIsUploading(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${selectedLine}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('employee-photos').upload(`layouts/${fileName}`, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('employee-photos').getPublicUrl(`layouts/${fileName}`);
      await supabase.from('line_layouts').upsert({ line_name: selectedLine, image_url: data.publicUrl }, { onConflict: 'line_name' });
      setLayoutImage(data.publicUrl);
      alert('อัปโหลดสำเร็จ!');
    } catch (error) { alert('Error: ' + error.message); } 
    finally { setIsUploading(false); }
  };

  const handleImageClick = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setTempPos({ top: `${y.toFixed(2)}%`, left: `${x.toFixed(2)}%` });
    setFormData({ id: null, name: '', minScore: 70, skills: [] });
  };

  const toggleSkill = (skillId) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skillId) ? prev.skills.filter(s => s !== skillId) : [...prev.skills, skillId]
    }));
  };

  const handleSaveStation = async () => {
    if (!formData.name || formData.skills.length === 0) return alert('กรุณาระบุชื่อและสกิล');
    const payload = {
      line_name: selectedLine,
      station_name: formData.name,
      pos_top: tempPos ? tempPos.top : stations.find(s => s.id === formData.id).pos_top,
      pos_left: tempPos ? tempPos.left : stations.find(s => s.id === formData.id).pos_left,
      required_skill_field: formData.skills.join(','),
      min_skill_score: parseInt(formData.minScore)
    };

    const { error } = formData.id 
      ? await supabase.from('workstations').update(payload).eq('id', formData.id)
      : await supabase.from('workstations').insert([payload]);

    if (!error) { fetchLineData(); setTempPos(null); setFormData({ id: null, name: '', minScore: 70, skills: [] }); }
  };

  const deleteStation = async (id) => {
    if (!window.confirm('ยืนยันการลบจุดงานนี้?')) return;
    const { error } = await supabase.from('workstations').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  const editStation = (st) => {
    setTempPos(null);
    setFormData({ id: st.id, name: st.station_name, minScore: st.min_skill_score, skills: st.required_skill_field.split(',') });
  };

  return (
    <div style={{ padding: '20px', display: 'flex', gap: '20px', height: 'calc(100vh - 40px)' }}>
      {/* ฝั่งซ้าย: รูปภาพ Layout */}
      <div style={{ flex: 1, backgroundColor: '#fff', borderRadius: '15px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ddd' }}>
        {layoutImage ? (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <img src={layoutImage} onClick={handleImageClick} style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'crosshair', display: 'block' }} />
            {stations.map(st => (
              <div key={st.id} onClick={(e) => { e.stopPropagation(); editStation(st); }}
                style={{ 
                  position: 'absolute', top: st.pos_top, left: st.pos_left, transform: 'translate(-50%, -50%)', 
                  width: '75px', height: '30px', // ขนาดเล็กกะทัดรัด
                  border: formData.id === st.id ? '2px solid #2ecc71' : '1px dashed #3498db', 
                  backgroundColor: formData.id === st.id ? 'rgba(46, 204, 113, 0.2)' : 'rgba(52,152,219,0.1)', 
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                  fontSize: '8px', fontWeight: 'bold', color: '#3498db', borderRadius: '4px', zIndex: 5, textAlign: 'center'
                }}>
                {st.station_name}
              </div>
            ))}
            {tempPos && <div style={{ position: 'absolute', top: tempPos.top, left: tempPos.left, transform: 'translate(-50%, -50%)', width: '75px', height: '30px', border: '2px solid #e74c3c', backgroundColor: 'rgba(231,76,60,0.2)', zIndex: 10, pointerEvents: 'none' }} />}
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p>ยังไม่มีรูปผังไลน์ {selectedLine}</p>
            <label style={uploadBtnStyle}> {isUploading ? 'อัปโหลด...' : '➕ อัปโหลดรูป'} <input type="file" hidden onChange={handleUploadImage} disabled={isUploading} /></label>
          </div>
        )}
      </div>

      {/* ฝั่งขวา: Sidebar */}
      <div style={{ width: '320px', backgroundColor: '#fff', padding: '20px', borderRadius: '15px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontWeight: 'bold' }}>เลือกไลน์: </label>
          <select value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)} style={inputStyle}>
            <option>Line A</option><option>Line B</option><option>Line C</option><option>Line D</option>
          </select>
          {layoutImage && (
            <label style={{ fontSize: '11px', color: '#3498db', cursor: 'pointer', display: 'block', marginTop: '10px', textAlign: 'right' }}>
              {isUploading ? 'อัปโหลด...' : '🔄 เปลี่ยนรูปภาพ'} <input type="file" hidden onChange={handleUploadImage} disabled={isUploading} />
            </label>
          )}
        </div>

        <h4>{formData.id ? '📝 แก้ไขจุดงาน' : '📍 เพิ่มจุดงาน'}</h4>
        {(tempPos || formData.id) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '10px' }}>
            <input placeholder="ชื่อจุด (OP10)" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} />
            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>สกิลที่ต้องการ:</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
              {skillOptions.map(s => (
                <label key={s.id} style={{ fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', padding: '5px', backgroundColor: formData.skills.includes(s.id) ? '#e3f2fd' : '#fff', borderRadius: '4px', border: '1px solid #eee' }}>
                  <input type="checkbox" checked={formData.skills.includes(s.id)} onChange={() => toggleSkill(s.id)} /> {s.label}
                </label>
              ))}
            </div>
            <label style={{ fontSize: '12px' }}>Min Score (%)</label>
            <input type="number" value={formData.minScore} onChange={e => setFormData({...formData, minScore: e.target.value})} style={inputStyle} />
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button onClick={handleSaveStation} style={{ ...btn, backgroundColor: '#2ecc71', flex: 1 }}>{formData.id ? 'บันทึก' : 'เพิ่ม'}</button>
              <button onClick={() => { setTempPos(null); setFormData({id: null, name: '', minScore: 70, skills: []}); }} style={{ ...btn, backgroundColor: '#95a5a6' }}>ยกเลิก</button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px', border: '2px dashed #eee', color: '#bdc3c7', borderRadius: '10px', fontSize: '12px' }}>
            คลิกบนรูปภาพเพื่อเพิ่มจุดงาน <br/> หรือคลิกที่จุดเดิมเพื่อแก้ไข
          </div>
        )}
        <hr style={{ margin: '20px 0' }} />
        <h4>รายการจุดงาน ({stations.length})</h4>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {stations.map(st => (
            <div key={st.id} style={{ padding: '10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div onClick={() => editStation(st)} style={{ cursor: 'pointer', flex: 1 }}>
                <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#2c3e50' }}>{st.station_name}</div>
                <div style={{ fontSize: '9px', color: '#7f8c8d' }}>{st.required_skill_field}</div>
              </div>
              <button onClick={() => deleteStation(st.id)} style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer' }}>🗑️</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding: '8px', borderRadius: '5px', border: '1px solid #ddd', width: '100%', boxSizing: 'border-box' };
const btn = { padding: '8px', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' };
const uploadBtnStyle = { display: 'inline-block', padding: '10px 20px', backgroundColor: '#3498db', color: 'white', borderRadius: '8px', cursor: 'pointer', marginTop: '10px' };