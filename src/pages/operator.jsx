import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';

const SKILL_LEVELS = [
  { min: 80, label: 'ชำนาญ',       color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { min: 60, label: 'ผ่านเกณฑ์',   color: '#84cc16', bg: 'rgba(132,204,18,0.15)' },
  { min: 40, label: 'กำลังพัฒนา', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { min: 0,  label: 'เริ่มต้น',     color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
];
const getLevel = (score) => SKILL_LEVELS.find(l => score >= l.min) || SKILL_LEVELS[3];

export default function Operator() {
  const { role, lineId: userLineId } = useContext(UserContext);
  const isLeader = role === 'leader';

  const [tab, setTab] = useState(0);
  const [skillDefs, setSkillDefs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [inactiveEmployees, setInactiveEmployees] = useState([]);
  const [showInactive, setShowInactive] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newSkill, setNewSkill] = useState({ label: '', color: '#4d9fff' });
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [myLineName, setMyLineName] = useState('');

  useEffect(() => {
    fetchSkillDefs();
    fetchEmployees();
    if (isLeader && userLineId) {
      supabase.from('production_lines').select('name').eq('id', userLineId).single()
        .then(({ data }) => setMyLineName(data?.name ?? ''));
    }
  }, []);

  const fetchSkillDefs = async () => {
    const { data } = await supabase.from('skill_definitions').select('*').order('sort_order');
    setSkillDefs(data || []);
  };

  const fetchEmployees = async () => {
    let base = supabase.from('employees').select('*, employee_skills(skill_name, score)');
    if (isLeader && userLineId) base = base.eq('line_id', userLineId);
    const [{ data: active }, { data: inactive }] = await Promise.all([
      base.eq('is_active', true).order('employee_id_code'),
      base.eq('is_active', false).order('employee_id_code'),
    ]);
    setEmployees(active || []);
    setInactiveEmployees(inactive || []);
  };

  const getEmpSkill = (emp, skillName) =>
    emp.employee_skills?.find(s => s.skill_name === skillName)?.score ?? 0;

  const handleDeactivate = async (id, name) => {
    if (!window.confirm(`ปิดใช้งานพนักงาน: ${name}?\nพนักงานจะไม่ปรากฏในระบบเช็คชื่อ แต่ข้อมูลยังคงอยู่`)) return;
    const { error } = await supabase.from('employees').update({ is_active: false }).eq('id', id);
    if (error) alert('ไม่สามารถปิดใช้งานได้: ' + error.message);
    else fetchEmployees();
  };

  const handleReactivate = async (id) => {
    const { error } = await supabase.from('employees').update({ is_active: true }).eq('id', id);
    if (error) alert('Error: ' + error.message);
    else fetchEmployees();
  };

  const openEdit = (emp) => {
    const scores = {};
    skillDefs.forEach(sd => {
      scores[sd.name] = emp.employee_skills?.find(s => s.skill_name === sd.name)?.score ?? 0;
    });
    setEditingEmp({ ...emp, newPhoto: null, skillScores: scores });
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
        const { data: pub } = supabase.storage.from('employee-photos').getPublicUrl(fileName);
        photoUrl = pub.publicUrl;
      }

      const { error } = await supabase.from('employees').update({
        name: editingEmp.name,
        department: editingEmp.department,
        image_url: photoUrl,
      }).eq('id', editingEmp.id);
      if (error) throw error;

      const upserts = skillDefs.map(sd => ({
        employee_id: editingEmp.id,
        skill_name: sd.name,
        score: Number(editingEmp.skillScores?.[sd.name] ?? 0),
        updated_at: new Date().toISOString(),
      }));
      const { error: skillErr } = await supabase.from('employee_skills')
        .upsert(upserts, { onConflict: 'employee_id,skill_name' });
      if (skillErr) throw skillErr;

      alert('💾 อัปเดตข้อมูลพนักงานเรียบร้อย!');
      setEditingEmp(null);
      fetchEmployees();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddSkill = async () => {
    const lbl = newSkill.label.trim();
    if (!lbl) return;
    const name = 'skill_' + lbl.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    setIsAddingSkill(true);
    const { error } = await supabase.from('skill_definitions').insert([{
      name, label: lbl, color: newSkill.color, sort_order: skillDefs.length + 1,
    }]);
    if (error) alert('Error: ' + error.message);
    else { setNewSkill({ label: '', color: '#4d9fff' }); fetchSkillDefs(); }
    setIsAddingSkill(false);
  };

  const handleDeleteSkill = async (sd) => {
    if (!window.confirm(`ลบสกิล "${sd.label}"?\nคะแนนสกิลนี้ของพนักงานและ requirement ทุก station จะถูกลบด้วย`)) return;
    await supabase.from('employee_skills').delete().eq('skill_name', sd.name);
    await supabase.from('station_requirements').delete().eq('skill_name', sd.name);
    await supabase.from('skill_definitions').delete().eq('id', sd.id);
    fetchSkillDefs();
    fetchEmployees();
  };

  const displayed = showInactive ? inactiveEmployees : employees;

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
          👥 ฐานข้อมูลพนักงาน
        </h2>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {(isLeader ? ['👥 พนักงาน'] : ['👥 พนักงาน', '⚙️ กำหนดสกิล']).map((t, i) => (
          <button key={i} onClick={() => setTab(i)} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
            background: tab === i ? 'var(--accent)' : 'var(--bg3)',
            color: tab === i ? '#fff' : 'var(--text2)',
            fontWeight: tab === i ? 700 : 400,
          }}>{t}</button>
        ))}
        {isLeader && myLineName && (
          <div style={{
            fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4,
            padding: '4px 8px', borderRadius: 6,
            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)',
          }}>
            📍 {myLineName}
          </div>
        )}
      </div>

      {tab === 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>ใช้งาน {employees.length} คน</span>
            <button onClick={() => setShowInactive(s => !s)}
              style={{
                padding: '6px 12px', borderRadius: 7, border: 'none', fontSize: 12, cursor: 'pointer',
                background: showInactive ? 'rgba(231,76,60,0.15)' : 'var(--bg3)',
                color: showInactive ? 'var(--red)' : 'var(--text2)',
              }}>
              {showInactive
                ? `✅ ดูพนักงานใช้งาน (${employees.length})`
                : `❌ ปิดใช้งาน (${inactiveEmployees.length})`}
            </button>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>โปรไฟล์</th>
                  <th>ID</th>
                  <th>ชื่อ</th>
                  {skillDefs.map(sd => (
                    <th key={sd.name} style={{ fontSize: 10, color: sd.color, whiteSpace: 'nowrap' }}>{sd.label}</th>
                  ))}
                  <th style={{ textAlign: 'center' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(emp => (
                  <tr key={emp.id} style={!emp.is_active ? { opacity: 0.5 } : {}}>
                    <td>
                      <img src={emp.image_url || 'https://via.placeholder.com/50'} alt=""
                        style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border2)', filter: !emp.is_active ? 'grayscale(1)' : 'none' }} />
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--font-display)' }}>{emp.employee_id_code}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{emp.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{emp.department || 'ไม่ระบุแผนก'}</div>
                    </td>
                    {skillDefs.map(sd => {
                      const score = getEmpSkill(emp, sd.name);
                      const lv = getLevel(score);
                      return (
                        <td key={sd.name} style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: lv.color }}>{score}%</div>
                          <div style={{ fontSize: 9, background: lv.bg, color: lv.color, borderRadius: 4, padding: '1px 5px', marginTop: 2, whiteSpace: 'nowrap' }}>
                            {lv.label}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {emp.is_active ? (
                        <>
                          <button onClick={() => openEdit(emp)}
                            style={{ padding: '6px 12px', background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, marginRight: 6, fontSize: 13 }}>
                            ✏️ แก้ไข
                          </button>
                          <button onClick={() => handleDeactivate(emp.id, emp.name)}
                            style={{ padding: '6px 12px', background: 'rgba(231,76,60,0.12)', color: 'var(--red)', border: '1px solid rgba(231,76,60,0.25)', borderRadius: 6, fontSize: 13 }}>
                            🚫 ปิด
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleReactivate(emp.id)}
                          style={{ padding: '6px 12px', background: 'rgba(34,197,94,0.12)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 6, fontSize: 13 }}>
                          ↩ เปิด
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 1 && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 20 }}>
            {skillDefs.map(sd => (
              <div key={sd.id} className="card" style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: sd.color, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{sd.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{sd.name}</div>
                  </div>
                </div>
                <button onClick={() => handleDeleteSkill(sd)}
                  style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 15, padding: '2px 4px' }}>🗑️</button>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              ระดับสกิล (Skill Levels)
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SKILL_LEVELS.map(lv => (
                <div key={lv.label} style={{ display: 'flex', alignItems: 'center', gap: 8, background: lv.bg, borderRadius: 8, padding: '8px 14px' }}>
                  <span style={{ fontWeight: 800, color: lv.color, fontSize: 16 }}>{lv.min}%+</span>
                  <span style={{ fontSize: 12, color: lv.color, fontWeight: 600 }}>{lv.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>➕ เพิ่มสกิลใหม่</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input placeholder="ชื่อสกิล เช่น งานพ่นสี" value={newSkill.label}
                onChange={e => setNewSkill({ ...newSkill, label: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && handleAddSkill()}
                style={{ flex: 1, minWidth: 180 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>สี</span>
                <input type="color" value={newSkill.color}
                  onChange={e => setNewSkill({ ...newSkill, color: e.target.value })}
                  style={{ width: 44, height: 34, padding: 2, borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', cursor: 'pointer' }} />
              </div>
              <button onClick={handleAddSkill} disabled={isAddingSkill || !newSkill.label.trim()}
                style={{ padding: '8px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>
                {isAddingSkill ? '...' : 'เพิ่ม'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              * ชื่อ key ถูกสร้างอัตโนมัติจากชื่อ เช่น "งานพ่นสี" → skill_
            </div>
          </div>
        </div>
      )}

      {editingEmp && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(640px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, borderBottom: '1px solid var(--border)', paddingBottom: 12, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              📝 แก้ไขข้อมูลพนักงาน
            </h3>
            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelSt}>ชื่อ - นามสกุล</label>
                  <input type="text" value={editingEmp.name}
                    onChange={e => setEditingEmp({ ...editingEmp, name: e.target.value })} required />
                </div>
                <div>
                  <label style={labelSt}>แผนก</label>
                  <input type="text" value={editingEmp.department || ''}
                    onChange={e => setEditingEmp({ ...editingEmp, department: e.target.value })} />
                </div>
              </div>

              <div style={{ background: 'var(--bg2)', padding: 14, borderRadius: 10 }}>
                <label style={{ ...labelSt, marginBottom: 10, display: 'block' }}>📊 ระดับทักษะ (%)</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {skillDefs.map(sd => {
                    const score = Number(editingEmp.skillScores?.[sd.name] ?? 0);
                    const lv = getLevel(score);
                    return (
                      <div key={sd.name}>
                        <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: sd.color }}>
                          <span style={{ fontWeight: 600 }}>{sd.label}</span>
                          <span style={{ background: lv.bg, color: lv.color, borderRadius: 4, padding: '0 5px', fontSize: 9, fontWeight: 700 }}>
                            {lv.label}
                          </span>
                        </label>
                        <input type="number" value={score}
                          onChange={e => setEditingEmp({
                            ...editingEmp,
                            skillScores: { ...editingEmp.skillScores, [sd.name]: e.target.value },
                          })}
                          min={0} max={100} />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={labelSt}>อัปเดตรูปถ่าย</label>
                <input type="file" accept="image/*"
                  onChange={e => setEditingEmp({ ...editingEmp, newPhoto: e.target.files[0] })} />
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
  letterSpacing: '0.04em', textTransform: 'uppercase',
};
