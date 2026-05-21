import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

const SKILL_LEVELS = [
  { min: 80, label: 'ชำนาญ',       color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { min: 60, label: 'ผ่านเกณฑ์',   color: '#84cc16', bg: 'rgba(132,204,18,0.15)' },
  { min: 40, label: 'กำลังพัฒนา', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { min: 0,  label: 'เริ่มต้น',     color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
];
const getLevel = (score) => SKILL_LEVELS.find(l => score >= l.min) || SKILL_LEVELS[3];

const EMP_GRADES = {
  gold:   { label: 'ประจำ',  gradient: 'linear-gradient(135deg,#7a5800,#ffd700,#c8941a,#ffd700,#7a5800)', glow: 'rgba(255,215,0,0.45)',   text: '#c8941a', badge: 'rgba(255,215,0,0.15)',   border: 'rgba(200,148,26,0.5)' },
  silver: { label: 'รายวัน', gradient: 'linear-gradient(135deg,#555,#d0d0d0,#999,#d0d0d0,#555)',          glow: 'rgba(192,192,192,0.4)',  text: '#a0a0a0', badge: 'rgba(192,192,192,0.15)', border: 'rgba(160,160,160,0.5)' },
  bronze: { label: 'อื่นๆ',  gradient: 'linear-gradient(135deg,#4a2800,#cd7f32,#8b4a1e,#cd7f32,#4a2800)', glow: 'rgba(205,127,50,0.35)',  text: '#b06a28', badge: 'rgba(205,127,50,0.15)',  border: 'rgba(176,106,40,0.5)' },
};

const getEmpGrade = (code = '') => {
  if (/^210/i.test(code))       return EMP_GRADES.gold;
  if (/^(STM|PTA)/i.test(code)) return EMP_GRADES.silver;
  return EMP_GRADES.bronze;
};

export default function Operator() {
  const { role, lineId: userLineId, section: userSection } = useContext(UserContext);
  const isLeader = role === 'leader';
  const isSupervisor = role === 'supervisor';

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
  const [filterSection, setFilterSection] = useState('');
  const [filterGroup,   setFilterGroup]   = useState('');
  const [filterTeam,    setFilterTeam]    = useState('');
  const [filterGrade,   setFilterGrade]   = useState('');
  const [lines,         setLines]         = useState([]);

  useEffect(() => {
    fetchSkillDefs();
    fetchEmployees();
    supabase.from('production_lines').select('id, name, section').order('name')
      .then(({ data }) => setLines(data || []));
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
    const makeBase = () => {
      let q = supabase.from('employees').select('*, employee_skills(skill_name, score)');
      if (isLeader && userLineId)       q = q.eq('line_id', userLineId);
      if (isSupervisor && userSection)  q = q.eq('section', userSection);
      return q;
    };
    const [{ data: active }, { data: inactive }] = await Promise.all([
      makeBase().eq('is_active', true).order('employee_id_code'),
      makeBase().eq('is_active', false).order('employee_id_code'),
    ]);
    setEmployees(active || []);
    setInactiveEmployees(inactive || []);
  };

  const getEmpSkill = (emp, skillName) =>
    emp.employee_skills?.find(s => s.skill_name === skillName)?.score ?? 0;

  const handleDeactivate = async (id, name) => {
    if (!window.confirm(`ปิดใช้งานพนักงาน: ${name}?\nพนักงานจะไม่ปรากฏในระบบเช็คชื่อ แต่ข้อมูลยังคงอยู่`)) return;
    const { error } = await supabase.from('employees').update({ is_active: false }).eq('id', id);
    if (error) toast.error('ไม่สามารถปิดใช้งานได้: ' + error.message);
    else fetchEmployees();
  };

  const handleReactivate = async (id) => {
    const { error } = await supabase.from('employees').update({ is_active: true }).eq('id', id);
    if (error) toast.error('เกิดข้อผิดพลาด: ' + error.message);
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
        name:       editingEmp.name,
        position:   editingEmp.position   || null,
        department: editingEmp.department,
        section:    isSupervisor ? (userSection || null) : (editingEmp.section || null),
        group_name: editingEmp.group_name || null,
        team:       editingEmp.team       || null,
        line_id:    editingEmp.line_id    || null,
        image_url:  photoUrl,
        start_date: editingEmp.start_date || null,
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

      toast.success('อัปเดตข้อมูลพนักงานเรียบร้อย!');
      setEditingEmp(null);
      fetchEmployees();
    } catch (err) {
      toast.error('เกิดข้อผิดพลาด: ' + err.message);
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
    if (error) toast.error('เกิดข้อผิดพลาด: ' + error.message);
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

  const allEmps = [...employees, ...inactiveEmployees];
  const sectionOpts = [...new Set(allEmps.map(e => e.section).filter(Boolean))].sort();
  const groupOpts   = [...new Set(allEmps.map(e => e.group_name).filter(Boolean))].sort();
  const teamOpts    = [...new Set(allEmps.map(e => e.team).filter(Boolean))].sort();

  const displayed = (showInactive ? inactiveEmployees : employees)
    .filter(emp => !filterSection || emp.section    === filterSection)
    .filter(emp => !filterGroup   || emp.group_name === filterGroup)
    .filter(emp => !filterTeam    || emp.team       === filterTeam)
    .filter(emp => !filterGrade   || getEmpGrade(emp.employee_id_code) === EMP_GRADES[filterGrade]);

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
        {isSupervisor && userSection && (
          <div style={{
            fontSize: 11, color: '#4d9fff', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4,
            padding: '4px 8px', borderRadius: 6,
            background: 'rgba(77,159,255,0.1)', border: '1px solid rgba(77,159,255,0.25)',
          }}>
            🏢 {userSection}
          </div>
        )}
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
          {/* Section / Group / Team / Grade filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { label: 'Section', value: filterSection, opts: sectionOpts, set: setFilterSection },
              { label: 'Group',   value: filterGroup,   opts: groupOpts,   set: setFilterGroup },
              { label: 'Team',    value: filterTeam,    opts: teamOpts,    set: setFilterTeam },
            ].map(f => (
              <select key={f.label} value={f.value} onChange={e => f.set(e.target.value)}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: f.value ? 'var(--text)' : 'var(--muted)', minWidth: 110 }}>
                <option value="">{`— ${f.label} —`}</option>
                {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}

            {/* Grade filter chips */}
            {[
              { key: 'gold',   icon: '🥇' },
              { key: 'silver', icon: '🥈' },
              { key: 'bronze', icon: '🥉' },
            ].map(({ key, icon }) => {
              const g = EMP_GRADES[key];
              const active = filterGrade === key;
              return (
                <button key={key} onClick={() => setFilterGrade(active ? '' : key)}
                  style={{
                    padding: '4px 11px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${active ? g.border : 'var(--border2)'}`,
                    background: active ? g.badge : 'var(--bg3)',
                    color: active ? g.text : 'var(--muted)',
                    transition: 'all 0.15s',
                  }}>
                  {icon} {g.label}
                </button>
              );
            })}

            {(filterSection || filterGroup || filterTeam || filterGrade) && (
              <button onClick={() => { setFilterSection(''); setFilterGroup(''); setFilterTeam(''); setFilterGrade(''); }}
                style={{ fontSize: 11, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)', cursor: 'pointer' }}>
                ✕ ล้าง
              </button>
            )}
          </div>

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
                  <th style={{ fontSize: 10, whiteSpace: 'nowrap' }}>Section</th>
                  <th style={{ fontSize: 10, whiteSpace: 'nowrap' }}>Group</th>
                  <th style={{ fontSize: 10, whiteSpace: 'nowrap' }}>Team</th>
                  <th style={{ fontSize: 10, whiteSpace: 'nowrap' }}>วันเริ่มงาน</th>
                  {skillDefs.map(sd => (
                    <th key={sd.name} style={{ fontSize: 10, color: sd.color, whiteSpace: 'nowrap' }}>{sd.label}</th>
                  ))}
                  <th style={{ textAlign: 'center' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(emp => {
                  const grade = getEmpGrade(emp.employee_id_code);
                  return (
                  <tr key={emp.id} style={!emp.is_active ? { opacity: 0.5 } : {}}>
                    <td>
                      <div style={{
                        display: 'inline-flex', padding: 2.5, borderRadius: 12,
                        background: !emp.is_active ? 'var(--border2)' : grade.gradient,
                        boxShadow: !emp.is_active ? 'none' : `0 0 10px ${grade.glow}`,
                      }}>
                        <img
                          src={emp.image_url || ''}
                          alt=""
                          style={{
                            width: 42, height: 42, borderRadius: 9,
                            objectFit: 'cover', display: 'block',
                            filter: !emp.is_active ? 'grayscale(1)' : 'none',
                            background: 'var(--bg3)',
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, color: grade.text, fontFamily: 'var(--font-display)', fontSize: 13 }}>
                        {emp.employee_id_code}
                      </div>
                      <div style={{
                        display: 'inline-block', marginTop: 3,
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
                        padding: '1px 7px', borderRadius: 4,
                        background: grade.badge, color: grade.text, border: `1px solid ${grade.border}`,
                      }}>
                        {grade.label}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{emp.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{emp.department || 'ไม่ระบุแผนก'}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{emp.section    || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{emp.group_name || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{emp.team       || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {emp.start_date ? emp.start_date : '—'}
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
                          ↩ เพิ่ม
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
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
                  <label style={labelSt}>ตำแหน่งงาน</label>
                  <select value={editingEmp.position || ''}
                    onChange={e => setEditingEmp({ ...editingEmp, position: e.target.value })}>
                    <option value="">— เลือก —</option>
                    <option value="Operator">Operator</option>
                    <option value="Leader">Leader</option>
                    <option value="Technician">Technician</option>
                    <option value="Engineer">Engineer</option>
                    <option value="QC">QC</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelSt}>แผนก</label>
                <input type="text" value={editingEmp.department || ''}
                  onChange={e => setEditingEmp({ ...editingEmp, department: e.target.value })} />
              </div>
              <div>
                <label style={labelSt}>วันเริ่มงาน</label>
                <input type="date" value={editingEmp.start_date || ''}
                  onChange={e => setEditingEmp({ ...editingEmp, start_date: e.target.value })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelSt}>Section</label>
                  {isSupervisor ? (
                    <input type="text" value={userSection || ''} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                  ) : (
                    <select value={editingEmp.section || ''} onChange={e => setEditingEmp({ ...editingEmp, section: e.target.value })}>
                      <option value="">— เลือก —</option>
                      {['PD1','PD2','PD3','PD4'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label style={labelSt}>Team</label>
                  <select value={editingEmp.team || ''} onChange={e => setEditingEmp({ ...editingEmp, team: e.target.value })}>
                    <option value="">— เลือก —</option>
                    <option value="A">Team A (กะเช้า)</option>
                    <option value="B">Team B (กะดึก)</option>
                    <option value="C">Team C (ไม่มีพันธะกะ)</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelSt}>Group / Line</label>
                {isLeader ? (
                  <input type="text" value={editingEmp.group_name || myLineName || ''} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                ) : (
                  <select value={editingEmp.group_name || ''} onChange={e => {
                    const val = e.target.value;
                    const line = lines.find(l => l.name === val);
                    setEditingEmp({ ...editingEmp, group_name: val, line_id: line?.id || null });
                  }}>
                    <option value="">— เลือก Line —</option>
                    {(isSupervisor && userSection ? lines.filter(l => l.section === userSection) : lines)
                      .map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                  </select>
                )}
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
