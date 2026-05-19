import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const CARD_W = 60;

export default function LineSetup() {
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState('');
  const [newLineName, setNewLineName] = useState('');
  const [newLineSection, setNewLineSection] = useState('');
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [layoutImage, setLayoutImage] = useState(null);
  const [stations, setStations] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [tempPos, setTempPos] = useState(null);
  const [formData, setFormData] = useState({ id: null, name: '', requirements: {}, skill_allowance: false });
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [collisionWarn, setCollisionWarn] = useState(false);
  const [skillDefs, setSkillDefs] = useState([]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const fetchLines = async () => {
    const { data } = await supabase.from('production_lines').select('id, name, section').order('name');
    setLines(data || []);
    if (data?.length > 0 && !selectedLine) setSelectedLine(data[0].name);
  };

  useEffect(() => {
    fetchLines();
    supabase.from('skill_definitions').select('*').order('sort_order').then(({ data }) => setSkillDefs(data || []));
  }, []);

  useEffect(() => {
    if (selectedLine) fetchLineData();
  }, [selectedLine]);

  const fetchLineData = async () => {
    const { data: layoutData } = await supabase.from('line_layouts').select('*').eq('line_name', selectedLine).single();
    setLayoutImage(layoutData?.image_url || null);
    const { data: stationData } = await supabase.from('workstations').select('*, station_requirements(*)').eq('line_name', selectedLine);
    setStations(stationData || []);
  };

  const handleAddLine = async () => {
    const name = newLineName.trim();
    if (!name) return;
    setIsAddingLine(true);
    const { error } = await supabase.from('production_lines').insert([{ name, section: newLineSection || null }]);
    if (error) { alert('Error: ' + error.message); }
    else {
      setNewLineName('');
      setNewLineSection('');
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

  const handleUpdateSection = async (line, section) => {
    await supabase.from('production_lines').update({ section: section || null }).eq('id', line.id);
    await fetchLines();
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

    const newXpx = (x / 100) * rect.width;
    const newYpx = (y / 100) * rect.height;
    const PAD = CARD_W + 8;

    const collision = stations.some(st => {
      const stX = (parseFloat(st.pos_left) / 100) * rect.width;
      const stY = (parseFloat(st.pos_top) / 100) * rect.height;
      return Math.abs(newXpx - stX) < PAD && Math.abs(newYpx - stY) < PAD * 1.5;
    });

    if (collision) {
      setCollisionWarn(true);
      setTimeout(() => setCollisionWarn(false), 2000);
      return;
    }

    setCollisionWarn(false);
    setTempPos({ top: `${y.toFixed(2)}%`, left: `${x.toFixed(2)}%` });
    setFormData({ id: null, name: '', requirements: {} });
  };

  const toggleSkillReq = (skillName) => {
    setFormData(prev => {
      const reqs = { ...prev.requirements };
      if (skillName in reqs) {
        delete reqs[skillName];
      } else {
        reqs[skillName] = 70;
      }
      return { ...prev, requirements: reqs };
    });
  };

  const setSkillScore = (skillName, score) => {
    setFormData(prev => ({
      ...prev,
      requirements: { ...prev.requirements, [skillName]: parseInt(score) || 0 },
    }));
  };

  const handleSaveStation = async () => {
    if (!formData.name) return alert('กรุณาระบุชื่อจุดงาน');
    const existingStation = stations.find(s => s.id === formData.id);
    const payload = {
      line_name: selectedLine,
      station_name: formData.name,
      pos_top: tempPos ? tempPos.top : existingStation?.pos_top,
      pos_left: tempPos ? tempPos.left : existingStation?.pos_left,
      skill_allowance: formData.skill_allowance,
    };
    let stationId = formData.id;
    if (stationId) {
      const { error } = await supabase.from('workstations').update(payload).eq('id', stationId);
      if (error) return alert('Error: ' + error.message);
    } else {
      const { data, error } = await supabase.from('workstations').insert([payload]).select().single();
      if (error) return alert('Error: ' + error.message);
      stationId = data.id;
    }

    await supabase.from('station_requirements').delete().eq('station_id', stationId);
    const reqRows = Object.entries(formData.requirements).map(([skill_name, min_score]) => ({
      station_id: stationId,
      skill_name,
      min_score,
    }));
    if (reqRows.length > 0) {
      await supabase.from('station_requirements').insert(reqRows);
    }

    fetchLineData();
    setTempPos(null);
    setFormData({ id: null, name: '', requirements: {} });
  };

  const deleteStation = async (id) => {
    if (!window.confirm('ยืนยันการลบจุดงานนี้?')) return;
    await supabase.from('station_requirements').delete().eq('station_id', id);
    const { error } = await supabase.from('workstations').delete().eq('id', id);
    if (!error) fetchLineData();
  };

  const editStation = (st) => {
    setTempPos(null);
    const reqMap = {};
    (st.station_requirements || []).forEach(r => { reqMap[r.skill_name] = r.min_score; });
    setFormData({ id: st.id, name: st.station_name, requirements: reqMap, skill_allowance: st.skill_allowance || false });
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
        position: 'relative', overflow: 'auto',
        display: layoutImage ? 'block' : 'flex',
        alignItems: layoutImage ? undefined : 'center',
        justifyContent: layoutImage ? undefined : 'center',
        minHeight: isMobile ? 340 : undefined,
        height: isMobile ? 340 : undefined,
      }}>
        {selectedLine ? (
          layoutImage ? (
            <div style={{
              position: 'relative',
              width: isMobile ? 800 : '100%',
              height: isMobile ? 500 : '100%',
              minWidth: isMobile ? 800 : undefined,
              minHeight: isMobile ? 500 : undefined,
            }}>
              {collisionWarn && (
                <div style={{
                  position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(245,158,11,0.95)', color: '#fff',
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  zIndex: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  whiteSpace: 'nowrap', pointerEvents: 'none',
                }}>
                  ⚠️ ใกล้กับจุดงานอื่นเกินไป — คลิกในพื้นที่ว่าง
                </div>
              )}
              <img
                src={layoutImage}
                onClick={handleImageClick}
                style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'crosshair', display: 'block' }}
              />
              {stations.map(st => {
                const isSelected = formData.id === st.id;
                return (
                  <div
                    key={st.id}
                    onClick={(e) => { e.stopPropagation(); editStation(st); }}
                    style={{
                      position: 'absolute', top: st.pos_top, left: st.pos_left, transform: 'translate(-50%, -50%)',
                      width: CARD_W, minHeight: 30,
                      border: isSelected ? '2px solid var(--green)' : '2px solid rgba(255,255,255,0.75)',
                      borderRadius: 8,
                      backgroundColor: isSelected ? 'rgba(34,197,94,0.18)' : 'rgba(0,0,0,0.82)',
                      backdropFilter: 'blur(2px)',
                      boxShadow: isSelected ? '0 0 8px rgba(34,197,94,0.5)' : '0 2px 6px rgba(0,0,0,0.6)',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      padding: '3px 2px', zIndex: 5,
                    }}
                  >
                    <div style={{ fontSize: 7, fontWeight: 700, color: isSelected ? 'var(--green)' : '#e0e0e0', textAlign: 'center', width: '100%', padding: '0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {st.station_name}
                    </div>
                    {st.skill_allowance && <div style={{ fontSize: 6, color: '#22c55e', fontWeight: 800, lineHeight: '10px' }}>💰</div>}
                    <div style={{ color: isSelected ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.25)', fontSize: 14, lineHeight: '18px' }}>+</div>
                  </div>
                );
              })}
              {tempPos && (
                <div style={{
                  position: 'absolute', top: tempPos.top, left: tempPos.left, transform: 'translate(-50%, -50%)',
                  width: CARD_W, minHeight: 30,
                  border: '2px solid var(--accent)', backgroundColor: 'rgba(227,25,55,0.2)',
                  backdropFilter: 'blur(2px)',
                  zIndex: 10, pointerEvents: 'none', borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 14 }}>+</div>
                </div>
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
              <div key={l.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  background: selectedLine === l.name ? 'rgba(227,25,55,0.1)' : 'var(--bg2)',
                  border: `1px solid ${selectedLine === l.name ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onClick={() => { setSelectedLine(l.name); setTempPos(null); setFormData({ id: null, name: '', requirements: {} }); }}
              >
                  <span style={{ fontSize: 13, flex: 1, color: selectedLine === l.name ? 'var(--accent)' : 'var(--text)', fontWeight: selectedLine === l.name ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.name}
                  </span>
                  <select
                    value={l.section || ''}
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); handleUpdateSection(l, e.target.value); }}
                    style={{ fontSize: 11, padding: '2px 4px', borderRadius: 5, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', width: 'auto', flexShrink: 0 }}
                  >
                    <option value="">Section</option>
                    {['PD1','PD2','PD3','PD4'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteLine(l); }}
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                    title="ลบไลน์">🗑️</button>
              </div>
            ))}
            {lines.length === 0 && (
              <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีไลน์ผลิต</div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input placeholder="ชื่อไลน์ใหม่ เช่น ไลน์ F" value={newLineName}
                onChange={e => setNewLineName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddLine()}
                style={{ flex: 1, fontSize: 13, padding: '8px 10px' }} />
              <select value={newLineSection} onChange={e => setNewLineSection(e.target.value)}
                style={{ fontSize: 12, padding: '8px 8px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', flexShrink: 0, width: 'auto' }}>
                <option value="">Section</option>
                {['PD1','PD2','PD3','PD4'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button onClick={handleAddLine} disabled={isAddingLine || !newLineName.trim()}
              style={{ padding: '8px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>
              {isAddingLine ? '...' : '+ เพิ่มไลน์'}
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
                <input placeholder="ชื่อจุด (OP10)" value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })} />
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
                  สกิลที่ต้องการ: {Object.keys(formData.requirements).length > 0 && (
                    <span style={{ color: 'var(--blue)', fontWeight: 400 }}>({Object.keys(formData.requirements).length} สกิล)</span>
                  )}
                </label>
                {skillDefs.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px', background: 'var(--bg3)', borderRadius: 6 }}>
                    ยังไม่มีสกิล — กำหนดสกิลได้ที่หน้า Operator
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {skillDefs.map(skill => {
                      const checked = skill.name in formData.requirements;
                      return (
                        <div key={skill.name} style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '6px 8px', borderRadius: 6,
                          background: checked ? 'rgba(77,159,255,0.1)' : 'var(--bg3)',
                          border: `1px solid ${checked ? 'var(--blue)' : 'var(--border)'}`,
                        }}>
                          <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }}
                            checked={checked} onChange={() => toggleSkillReq(skill.name)} />
                          <span style={{ fontSize: 11, color: 'var(--text2)', flex: 1 }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: skill.color || '#4d9fff', marginRight: 4 }} />
                            {skill.label}
                          </span>
                          {checked && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <input type="number" min={0} max={100}
                                value={formData.requirements[skill.name]}
                                onChange={e => setSkillScore(skill.name, e.target.value)}
                                style={{ width: 46, fontSize: 11, padding: '2px 4px', textAlign: 'center' }} />
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>%</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* skill allowance toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  background: formData.skill_allowance ? 'rgba(34,197,94,0.1)' : 'var(--bg3)',
                  border: `1.5px solid ${formData.skill_allowance ? 'rgba(34,197,94,0.4)' : 'var(--border2)'}` }}>
                  <input type="checkbox" checked={formData.skill_allowance}
                    onChange={e => setFormData({ ...formData, skill_allowance: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: '#22c55e' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: formData.skill_allowance ? '#22c55e' : 'var(--text2)' }}>💰 จุดงานได้ค่าฝีมือ</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>พนักงานที่ถูก assign จุดนี้จะได้ค่าฝีมือรายวัน</div>
                  </div>
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={handleSaveStation} style={{ flex: 1, padding: '9px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700 }}>
                    {formData.id ? 'บันทึก' : 'เพิ่ม'}
                  </button>
                  <button onClick={() => { setTempPos(null); setFormData({ id: null, name: '', requirements: {}, skill_allowance: false }); }}
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
            {stations.map(st => {
              const reqs = st.station_requirements || [];
              return (
                <div key={st.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div onClick={() => editStation(st)} style={{ cursor: 'pointer', flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {st.station_name}
                      {st.skill_allowance && <span style={{ fontSize: 10, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>💰 ค่าฝีมือ</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                      {reqs.length > 0
                        ? reqs.map(r => {
                            const def = skillDefs.find(d => d.name === r.skill_name);
                            return `${def?.label || r.skill_name} ≥${r.min_score}%`;
                          }).join(', ')
                        : 'ไม่มีสกิลที่กำหนด'}
                    </div>
                  </div>
                  <button onClick={() => deleteStation(st.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>🗑️</button>
                </div>
              );
            })}
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
