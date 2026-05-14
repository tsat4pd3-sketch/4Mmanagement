import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function LineSetup() {
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState('');
  const [newLineName, setNewLineName] = useState('');
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [layoutImage, setLayoutImage] = useState(null);
  const [stations, setStations] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [tempPos, setTempPos] = useState(null);
  const [formData, setFormData] = useState({ id: null, name: '', minScore: 70, skills: [] });
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const skillOptions = [
    { id: 'skill_welding', label: 'งานเชื่อม' },
    { id: 'skill_spot_nut', label: 'งานสปอทนัท' },
    { id: 'skill_quality_check', label: 'งาน QC' },
    { id: 'skill_refill_part', label: 'งานเติมพาร์ท' },
    { id: 'skill_management', label: 'งานบริหาร' }
  ];

  const fetchLines = async () => {
    const { data } = await supabase.from('production_lines').select('id, name').order('name');
    setLines(data || []);
    if (data?.length > 0 && !selectedLine) setSelectedLine(data[0].name);
  };

  useEffect(() => { fetchLines(); }, []);

  useEffect(() => {
    if (selectedLine) fetchLineData();
  }, [selectedLine]);

  const fetchLineData = async () => {
    const { data: layoutData } = await supabase.from('line_layouts').select('*').eq('line_name', selectedLine).single();
    setLayoutImage(layoutData?.image_url || null);
    const { data: stationData } = await supabase.from('workstations').select('*').eq('line_name', selectedLine);
    setStations(stationData || []);
  };

  const handleAddLine = async () => {
    const name = newLineName.trim();
    if (!name) return;
    setIsAddingLine(true);
    const { error } = await supabase.from('production_lines').insert([{ name }]);
    if (error) { alert('Error: ' + error.message); }
    else {
      setNewLineName('');
      await fetchLines();
      setSelectedLine(name);
    }
    setIsAddingLine(false);
  };

  const handleDeleteLine = async (line) => {
    if (!window.confirm(`ลบไลน์ "${line.name}" ?\n\nจุดงานและผังไลน์ทั้งหมดในไลน์นี้จะถูกลบด้วย`)) return;
    await supabase.from('workstations').delete().eq('line_name', line.name);
    await supabase.from('line_layouts').delete().eq('line_name', line.name);
    await supabase.from('employees').update({ line_id: null }).eq('line_id', line.id);
    await supabase.from('production_lines').delete().eq('id', line.id);
    const remaining = lines.filter(l => l.id !== line.id);
    setLines(remaining);
    if (selectedLine === line.name) {
      const next = remaining[0]?.name || '';
      setSelectedLine(next);
      if (!next) { setLayoutImage(null); setStations([]); }
    }
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setIsUploading(true);
      const fileExt = file.name.split('.').pop();
      const safeLineName = selectedLine.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `layout_${safeLineName}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('employee-photos').upload(`layouts/${fileName}`, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('employee-photos').getPublicUrl(`layouts/${fileName}`);
      await supabase.from('line_layouts').upsert({ line_name: selectedLine, image_url: data.publicUrl }, { onConflict: 'line_name' });
      setLayoutImage(data.publicUrl);
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
    const existingStation = stations.find(s => s.id === formData.id);
    const payload = {
      line_name: selectedLine,
      station_name: formData.name,
      pos_top: tempPos ? tempPos.top : existingStation?.pos_top,
      pos_left: tempPos ? tempPos.left : existingStation?.pos_left,
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
    <div style={{
      padding: '16px',
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: 16,
      height: isMobile ? 'auto' : 'calc(100vh - 40px)',
      minHeight: isMobile ? 'calc(100vh - 40px)' : undefined,
      overflow: isMobile ? 'auto' : 'hidden',
    }}>
      <div style={{
        flex: 1,
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: isMobile ? 280 : undefined,
        height: isMobile ? 280 : undefined,
      }}>
        {selectedLine ? (
          layoutImage ? (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <img
                src={layoutImage}
                onClick={handleImageClick}
                style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'crosshair', display: 'block' }}
              />
              {stations.map(st => (
                <div
                  key={st.id}
                  onClick={(e) => { e.stopPropagation(); editStation(st); }}
                  style={{
                    position: 'absolute', top: st.pos_top, left: st.pos_left, transform: 'translate(-50%, -50%)',
                    width: 75, height: 30,
                    border: formData.id === st.id ? '2px solid var(--green)' : '1px dashed var(--blue)',
                    backgroundColor: formData.id === st.id ? 'rgba(34,197,94,0.25)' : 'rgba(77,159,255,0.15)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 700,
                    color: formData.id === st.id ? 'var(--green)' : 'var(--blue)',
                    borderRadius: 4, zIndex: 5, textAlign: 'center'
                  }}
                >
                  {st.station_name}
                </div>
              ))}
              {tempPos && (
                <div style={{
                  position: 'absolute', top: tempPos.top, left: tempPos.left, transform: 'translate(-50%, -50%)',
                  width: 75, height: 30,
                  border: '2px solid var(--accent)', backgroundColor: 'rgba(227,25,55,0.2)',
                  zIndex: 10, pointerEvents: 'none', borderRadius: 4
                }} />
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <p style={{ color: 'var(--muted)', marginBottom: 12 }}>ยังไม่มีรูปผังไลน์ {selectedLine}</p>
              <label style={uploadBtnSt}>
                {isUploading ? 'อัปโหลด...' : '➕ อัปโหลดรูป'}
                <input type="file" hidden onChange={handleUploadImage} disabled={isUploading} />
              </label>
            </div>
          )
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>เพิ่มไลน์ผลิตก่อน</p>
        )}
      </div>

      <div style={{
        width: isMobile ? '100%' : 320,
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', flexShrink: 0
      }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={labelSt}>ไลน์ผลิต ({lines.length})</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {lines.map(l => (
              <div
                key={l.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  background: selectedLine === l.name ? 'rgba(227,25,55,0.1)' : 'var(--bg2)',
                  border: `1px solid ${selectedLine === l.name ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onClick={() => { setSelectedLine(l.name); setTempPos(null); setFormData({ id: null, name: '', minScore: 70, skills: [] }); }}
              >
                <span style={{ fontSize: 13, flex: 1, color: selectedLine === l.name ? 'var(--accent)' : 'var(--text)', fontWeight: selectedLine === l.name ? 600 : 400 }}>
                  {l.name}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteLine(l); }}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
                  title="ลบไลน์"
                >
                  🗑️
                </button>
              </div>
            ))}
            {lines.length === 0 && (
              <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>
                ยังไม่มีไลน์ผลิต
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              placeholder="ชื่อไลน์ใหม่ เช่น ไลน์ F"
              value={newLineName}
              onChange={e => setNewLineName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddLine()}
              style={{ flex: 1, fontSize: 13, padding: '8px 10px' }}
            />
            <button
              onClick={handleAddLine}
              disabled={isAddingLine || !newLineName.trim()}
              style={{ padding: '8px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, flexShrink: 0 }}
            >
              {isAddingLine ? '...' : '+ เพิ่ม'}
            </button>
          </div>
        </div>

        {selectedLine && <>
          {layoutImage && (
            <label style={{ fontSize: 12, color: 'var(--blue)', cursor: 'pointer', display: 'block', marginBottom: 14, textAlign: 'right' }}>
              {isUploading ? 'อัปโหลด...' : '🔄 เปลี่ยนรูปภาพ'}
              <input type="file" hidden onChange={handleUploadImage} disabled={isUploading} />
            </label>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginBottom: 10 }}>
            <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
              {formData.id ? '📝 แก้ไขจุดงาน' : '📍 เพิ่มจุดงาน'}
            </h4>

            {(tempPos || formData.id) ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg2)', padding: 14, borderRadius: 10 }}>
                <input
                  placeholder="ชื่อจุด (OP10)"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>สกิลที่ต้องการ:</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  {skillOptions.map(s => (
                    <label key={s.id} style={{
                      fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                      padding: '6px 8px',
                      background: formData.skills.includes(s.id) ? 'rgba(77,159,255,0.15)' : 'var(--bg3)',
                      borderRadius: 5, border: `1px solid ${formData.skills.includes(s.id) ? 'var(--blue)' : 'var(--border)'}`,
                      color: 'var(--text2)'
                    }}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={formData.skills.includes(s.id)} onChange={() => toggleSkill(s.id)} />
                      {s.label}
                    </label>
                  ))}
                </div>
                <label style={{ fontSize: 12, color: 'var(--text2)' }}>Min Score (%)</label>
                <input type="number" value={formData.minScore} onChange={e => setFormData({ ...formData, minScore: e.target.value })} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={handleSaveStation} style={{ flex: 1, padding: '9px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700 }}>
                    {formData.id ? 'บันทึก' : 'เพิ่ม'}
                  </button>
                  <button onClick={() => { setTempPos(null); setFormData({ id: null, name: '', minScore: 70, skills: [] }); }}
                    style={{ padding: '9px 14px', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 7 }}>
                    ยกเลิก
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px', border: '2px dashed var(--border)', color: 'var(--muted)', borderRadius: 10, fontSize: 12 }}>
                คลิกบนรูปภาพเพื่อเพิ่มจุดงาน<br />หรือคลิกที่จุดเดิมเพื่อแก้ไข
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0 10px' }} />
          <h4 style={{ margin: '0 0 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
            รายการจุดงาน ({stations.length})
          </h4>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {stations.map(st => (
              <div key={st.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div onClick={() => editStation(st)} style={{ cursor: 'pointer', flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{st.station_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{st.required_skill_field}</div>
                </div>
                <button onClick={() => deleteStation(st.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>
              </div>
            ))}
          </div>
        </>}
      </div>
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 0,
  letterSpacing: '0.04em', textTransform: 'uppercase'
};

const uploadBtnSt = {
  display: 'inline-block', padding: '10px 20px',
  background: 'var(--accent)', color: '#fff',
  borderRadius: 8, cursor: 'pointer', fontSize: 14
};
