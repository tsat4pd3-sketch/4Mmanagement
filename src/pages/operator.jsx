import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

function resizeImage(file, maxPx = 1280, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width: w, height: h } = img;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', quality);
    };
    img.src = url;
  });
}

// 5-level standard matching factory requirements
const SKILL_LEVELS = [
  { min: 100, label: 'ผู้เชี่ยวชาญ',   color: '#a855f7', bg: 'rgba(168,85,247,0.15)',  band: 4, desc: 'ผ่านอบรมเฉพาะทาง + สอบ' },
  { min: 75,  label: 'แก้ปัญหาได้',    color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   band: 3, desc: 'ทำงานได้ + แก้ไขปัญหา' },
  { min: 50,  label: 'มาตรฐาน',        color: '#84cc16', bg: 'rgba(132,204,18,0.15)',  band: 2, desc: 'ทำงานตามมาตรฐานอิสระ' },
  { min: 25,  label: 'ต้องดูแล',       color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  band: 1, desc: 'OJT แล้ว ยังต้องดูแล' },
  { min: 0,   label: 'ยังไม่ผ่าน OJT', color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   band: 0, desc: 'ต้องผ่านการ OJT ก่อน' },
];
const SKILL_GATES = [25, 50, 75, 100]; // levels requiring approval
const getLevel = (score) => SKILL_LEVELS.find(l => score >= l.min) ?? SKILL_LEVELS[4];
const getBandCeiling = (score) => score < 25 ? 24 : score < 50 ? 49 : score < 75 ? 74 : 99;

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
  const [newSkill, setNewSkill] = useState({ label: '', color: '#4d9fff', category: 'hard_skill', scope_section: '' });
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [myLineName, setMyLineName] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterGroup,   setFilterGroup]   = useState('');
  const [filterTeam,    setFilterTeam]    = useState('');
  const [filterGrade,   setFilterGrade]   = useState('');
  const [lines,           setLines]           = useState([]);
  const [levelUpRequests, setLevelUpRequests] = useState([]);
  const [luDocFile,       setLuDocFile]       = useState(null);
  const [luDocPreview,    setLuDocPreview]    = useState(null);
  const [isReviewing,     setIsReviewing]     = useState(false);
  const [rejectLuModal,   setRejectLuModal]   = useState(null);
  const [rejectLuReason,  setRejectLuReason]  = useState('');
  const [runningWeekly,   setRunningWeekly]   = useState(false);

  useEffect(() => {
    fetchSkillDefs();
    fetchEmployees();
    fetchLevelUpRequests();
    supabase.from('production_lines').select('id, name, section').order('name')
      .then(({ data }) => setLines(data || []));
    if (isLeader && userLineId) {
      supabase.from('production_lines').select('name').eq('id', userLineId).single()
        .then(({ data }) => setMyLineName(data?.name ?? ''));
    }
  }, []);

  const fetchLevelUpRequests = async () => {
    let q = supabase.from('skill_level_up_requests')
      .select('*, employees(id, name, employee_id_code, section, line_id)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });
    if (isSupervisor && userSection) {
      // fetch employee ids in this section first then filter
    }
    const { data } = await q;
    setLevelUpRequests(data || []);
  };

  const handleRunWeeklyUpdate = async () => {
    if (!window.confirm('รัน Weekly Skill Update สำหรับสัปดาห์ที่แล้ว?\n(ปกติรันอัตโนมัติทุกวันจันทร์ 08:05)')) return;
    setRunningWeekly(true);
    const { data, error } = await supabase.rpc('fn_weekly_skill_update');
    setRunningWeekly(false);
    if (error) { toast.error('ผิดพลาด: ' + error.message); return; }
    toast.success(data);
    fetchEmployees();
    fetchLevelUpRequests();
  };

  const handleApproveLevel = async (req) => {
    if (req.to_level === 100 && !luDocFile && !req.doc_url) {
      toast.error('ระดับ 100 ต้องแนบเอกสารการอบรมก่อน'); return;
    }
    setIsReviewing(true);
    const { data: { user } } = await supabase.auth.getUser();
    let doc_url = req.doc_url || null;

    if (luDocFile) {
      const path = `skill-docs/${req.employee_id}_${req.skill_name}_${Date.now()}.jpg`;
      // resize if image
      let fileToUpload = luDocFile;
      if (luDocFile.type.startsWith('image/')) {
        fileToUpload = await resizeImage(luDocFile);
      }
      const { error: upErr } = await supabase.storage.from('four-m-images').upload(path, fileToUpload, { upsert: false });
      if (upErr) { toast.error('อัปโหลดเอกสารไม่สำเร็จ'); setIsReviewing(false); return; }
      const { data: urlData } = supabase.storage.from('four-m-images').getPublicUrl(path);
      doc_url = urlData.publicUrl;
    }

    const { error: rErr } = await supabase.from('skill_level_up_requests').update({
      status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString(), doc_url,
    }).eq('id', req.id);
    if (rErr) { toast.error('ผิดพลาด: ' + rErr.message); setIsReviewing(false); return; }

    await supabase.from('employee_skills').upsert({
      employee_id: req.employee_id, skill_name: req.skill_name,
      score: req.to_level, pending_level: null,
    }, { onConflict: 'employee_id,skill_name' });

    toast.success(`อนุมัติ Level ${req.to_level} สำเร็จ`);
    setIsReviewing(false);
    setLuDocFile(null); setLuDocPreview(null);
    fetchLevelUpRequests();
    fetchEmployees();
  };

  const handleRejectLevel = async () => {
    if (!rejectLuReason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('skill_level_up_requests').update({
      status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
      reject_reason: rejectLuReason.trim(),
    }).eq('id', rejectLuModal.id);
    // Clear pending_level so farming can resume from current score
    await supabase.from('employee_skills').update({ pending_level: null })
      .eq('employee_id', rejectLuModal.employee_id).eq('skill_name', rejectLuModal.skill_name);
    toast.info('Rejected — พนักงานสามารถ farm ต่อได้');
    setRejectLuModal(null); setRejectLuReason('');
    fetchLevelUpRequests();
    fetchEmployees();
  };

  const fetchSkillDefs = async () => {
    const { data } = await supabase.from('skill_definitions').select('*').order('sort_order');
    setSkillDefs(data || []);
  };

  const fetchEmployees = async () => {
    const makeBase = () => {
      let q = supabase.from('employees').select('*, employee_skills(skill_name, score, pending_level)');
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
    if (!lbl) { toast.error('กรุณาระบุชื่อสกิล'); return; }
    // UUID-based key: never conflicts, works with Thai/any language
    const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const name = 'skill_' + uid;
    setIsAddingSkill(true);
    const { error } = await supabase.from('skill_definitions').insert([{
      name,
      label: lbl,
      color: newSkill.color,
      category: newSkill.category,
      scope_section: newSkill.scope_section.trim() || null,
      sort_order: skillDefs.length + 1,
    }]);
    if (error) toast.error('เกิดข้อผิดพลาด: ' + error.message);
    else { setNewSkill({ label: '', color: '#4d9fff', category: 'hard_skill', scope_section: '' }); fetchSkillDefs(); }
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

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {(isLeader ? ['👥 พนักงาน'] : ['👥 พนักงาน', '⚙️ กำหนดสกิล', '⬆️ Level Up']).map((t, i) => (
          <button key={i} onClick={() => setTab(i)} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
            background: tab === i ? 'var(--accent)' : 'var(--bg3)',
            color: tab === i ? '#fff' : 'var(--text2)',
            fontWeight: tab === i ? 700 : 400,
            position: 'relative',
          }}>
            {t}
            {i === 2 && levelUpRequests.length > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {levelUpRequests.length}
              </span>
            )}
          </button>
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
            <table style={{ minWidth: 560, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 2 }}>โปรไฟล์</th>
                  <th style={{ position: 'sticky', left: 58, background: 'var(--bg2)', zIndex: 2 }}>ID</th>
                  <th style={{ position: 'sticky', left: 148, background: 'var(--bg2)', zIndex: 2, boxShadow: '2px 0 6px rgba(0,0,0,0.15)' }}>ชื่อ</th>
                  <th style={{ fontSize: 10, whiteSpace: 'nowrap' }}>Section</th>
                  <th style={{ fontSize: 10, whiteSpace: 'nowrap' }}>Group</th>
                  <th style={{ fontSize: 10, whiteSpace: 'nowrap' }}>Team</th>
                  <th style={{ fontSize: 10, whiteSpace: 'nowrap' }}>วันเริ่มงาน</th>
                  {skillDefs.map(sd => (
                    <th key={sd.name} style={{ fontSize: 10, color: sd.color, whiteSpace: 'nowrap' }}>
                      <div>{{ hard_skill:'🔧', machine_skill:'⚙️', product_skill:'📦', soft_skill:'🧠' }[sd.category || 'hard_skill']} {sd.label}</div>
                      {sd.scope_section && <div style={{ fontSize: 8, color: 'var(--muted)', fontWeight: 400 }}>📍{sd.scope_section}</div>}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', position: 'sticky', right: 0, background: 'var(--bg2)', zIndex: 2, boxShadow: '-2px 0 6px rgba(0,0,0,0.15)' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(emp => {
                  const grade = getEmpGrade(emp.employee_id_code);
                  return (
                  <tr key={emp.id} style={!emp.is_active ? { opacity: 0.5 } : {}}>
                    <td style={{ position: 'sticky', left: 0, background: !emp.is_active ? 'var(--bg2)' : 'var(--bg2)', zIndex: 1 }}>
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
                    <td style={{ position: 'sticky', left: 58, background: 'var(--bg2)', zIndex: 1 }}>
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
                    <td style={{ position: 'sticky', left: 148, background: 'var(--bg2)', zIndex: 1, boxShadow: '2px 0 6px rgba(0,0,0,0.15)' }}>
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
                      const skillObj = emp.employee_skills?.find(s => s.skill_name === sd.name);
                      const score = skillObj?.score ?? 0;
                      const pending = skillObj?.pending_level ?? null;
                      const lv = getLevel(score);
                      return (
                        <td key={sd.name} style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: lv.color }}>{score}</div>
                          <div style={{ fontSize: 9, background: lv.bg, color: lv.color, borderRadius: 4, padding: '1px 5px', marginTop: 2, whiteSpace: 'nowrap' }}>
                            {lv.label}
                          </div>
                          {pending && (
                            <div style={{ fontSize: 8, color: '#f59e0b', fontWeight: 700, marginTop: 2, animation: 'pulse 1.5s infinite' }}>
                              ⏳ Lv.{pending}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', right: 0, background: 'var(--bg2)', zIndex: 1, boxShadow: '-2px 0 6px rgba(0,0,0,0.15)' }}>
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

      {tab === 1 && (() => {
        const CAT_META = {
          hard_skill:    { label: 'Hard Skill',    color: '#ef4444', icon: '🔧' },
          machine_skill: { label: 'Machine Skill', color: '#f97316', icon: '⚙️' },
          product_skill: { label: 'Product Skill', color: '#3b82f6', icon: '📦' },
          soft_skill:    { label: 'Soft Skill',    color: '#a855f7', icon: '🧠' },
        };
        const grouped = Object.entries(CAT_META).map(([k, m]) => ({
          key: k, ...m, skills: skillDefs.filter(sd => (sd.category || 'hard_skill') === k),
        })).filter(g => g.skills.length > 0 || true);

        return (
          <div>
            {/* Skill list grouped by category */}
            {grouped.map(g => g.skills.length === 0 ? null : (
              <div key={g.key} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {g.icon} {g.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                  {g.skills.map(sd => (
                    <div key={sd.id} className="card" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: sd.color, flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{sd.label}</div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                            {sd.scope_section && (
                              <span style={{ fontSize: 9, background: 'rgba(77,159,255,0.12)', color: '#4d9fff', borderRadius: 4, padding: '0 5px', fontWeight: 600 }}>
                                📍 {sd.scope_section}
                              </span>
                            )}
                            <span style={{ fontSize: 9, color: 'var(--muted)' }}>{sd.name}</span>
                          </div>
                        </div>
                      </div>
                      <button onClick={() => handleDeleteSkill(sd)}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}>🗑️</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Add skill form */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>➕ เพิ่มสกิลใหม่</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelSt}>ชื่อสกิล (ภาษาไทยหรืออังกฤษ)</label>
                  <input placeholder="เช่น งานพ่นสี, Robot Arm" value={newSkill.label}
                    onChange={e => setNewSkill({ ...newSkill, label: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && handleAddSkill()} />
                </div>
                <div>
                  <label style={labelSt}>ประเภทสกิล</label>
                  <select value={newSkill.category} onChange={e => setNewSkill({ ...newSkill, category: e.target.value })}>
                    {Object.entries(CAT_META).map(([k, m]) => (
                      <option key={k} value={k}>{m.icon} {m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelSt}>ส่วนงาน (ถ้าจำเพาะ)</label>
                  <input placeholder="เว้นว่าง = ทุกส่วนงาน" value={newSkill.scope_section}
                    onChange={e => setNewSkill({ ...newSkill, scope_section: e.target.value })} />
                </div>
                <div>
                  <label style={labelSt}>สีแสดงผล</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={newSkill.color}
                      onChange={e => setNewSkill({ ...newSkill, color: e.target.value })}
                      style={{ width: 44, height: 36, padding: 2, borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', cursor: 'pointer' }} />
                    <span style={{ fontSize: 12, color: newSkill.color, fontWeight: 700 }}>● ตัวอย่าง</span>
                  </div>
                </div>
              </div>
              <button onClick={handleAddSkill} disabled={isAddingSkill || !newSkill.label.trim()}
                style={{ padding: '9px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: (!newSkill.label.trim() || isAddingSkill) ? 0.5 : 1 }}>
                {isAddingSkill ? 'กำลังบันทึก...' : '➕ เพิ่มสกิล'}
              </button>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                🔑 Key สร้างอัตโนมัติแบบ UUID — ชื่อไทยหรืออักขระพิเศษใช้ได้ทั้งหมด ไม่มีการชนกัน
              </div>
            </div>

            {/* Level reference */}
            <div className="card" style={{ padding: 14, marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>มาตรฐานระดับสกิล</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SKILL_LEVELS.slice().reverse().map(lv => (
                  <div key={lv.min} style={{ display: 'flex', alignItems: 'center', gap: 6, background: lv.bg, borderRadius: 7, padding: '6px 12px' }}>
                    <span style={{ fontWeight: 800, color: lv.color, fontSize: 15, minWidth: 28 }}>{lv.min}</span>
                    <div>
                      <div style={{ fontSize: 11, color: lv.color, fontWeight: 700 }}>{lv.label}</div>
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>{lv.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Tab 2: Level-Up Requests ── */}
      {tab === 2 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              คำขออัพระดับทักษะที่รอการอนุมัติ ({levelUpRequests.length} รายการ)
            </div>
            {['admin','manager'].includes(role) && (
              <button onClick={handleRunWeeklyUpdate} disabled={runningWeekly}
                style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.3)',
                  opacity: runningWeekly ? 0.6 : 1 }}>
                {runningWeekly ? 'กำลังรัน...' : '🔄 Run Weekly Update'}
              </button>
            )}
          </div>

          {/* Level legend */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {SKILL_LEVELS.map(lv => (
              <div key={lv.min} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: lv.bg, fontSize: 11 }}>
                <span style={{ fontWeight: 800, color: lv.color }}>{lv.min === 100 ? '100' : `${lv.min}–${lv.min === 75 ? 99 : lv.min === 50 ? 74 : lv.min === 25 ? 49 : lv.min === 0 ? 24 : 100}`}</span>
                <span style={{ color: lv.color, fontWeight: 600 }}>{lv.label}</span>
                <span style={{ color: 'var(--muted)' }}>— {lv.desc}</span>
              </div>
            ))}
          </div>

          {levelUpRequests.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 14 }}>
              ✅ ไม่มีคำขออัพระดับที่รอการอนุมัติ
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {levelUpRequests.map(req => {
                const emp = req.employees;
                const toLv = SKILL_LEVELS.find(l => l.min === req.to_level);
                const needsDoc = req.to_level === 100;
                const canApprove = req.to_level === 100
                  ? ['admin','manager'].includes(role)
                  : ['admin','manager','supervisor'].includes(role);
                return (
                  <div key={req.id} className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{emp?.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{emp?.employee_id_code}</span>
                        {emp?.section && <span style={{ fontSize: 10, background: 'rgba(77,159,255,0.1)', color: '#4d9fff', borderRadius: 4, padding: '1px 6px' }}>{emp.section}</span>}
                      </div>
                      <div style={{ fontSize: 13, marginBottom: 4 }}>
                        ทักษะ: <strong style={{ color: 'var(--accent)' }}>{skillDefs.find(s => s.name === req.skill_name)?.label ?? req.skill_name}</strong>
                        &nbsp;·&nbsp;
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>score {req.from_score}</span>
                        &nbsp;→&nbsp;
                        <span style={{ color: toLv?.color, fontWeight: 800 }}>Level {req.to_level} ({toLv?.label})</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        ขอเมื่อ {new Date(req.requested_at).toLocaleDateString('th-TH', { dateStyle: 'medium' })}
                      </div>

                      {/* Doc upload for level 100 */}
                      {needsDoc && canApprove && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 11, color: '#a855f7', fontWeight: 600, marginBottom: 4 }}>
                            📄 แนบเอกสารการอบรมเฉพาะทาง <span style={{ color: '#ef4444' }}>*</span>
                          </div>
                          <div style={{ border: `2px dashed ${luDocFile ? '#a855f7' : 'var(--border2)'}`, borderRadius: 7, padding: '8px 12px', cursor: 'pointer', background: luDocFile ? 'rgba(168,85,247,0.06)' : 'var(--bg2)', textAlign: 'center' }}
                            onClick={() => document.getElementById(`doc-${req.id}`).click()}>
                            <input id={`doc-${req.id}`} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                setLuDocFile(f);
                                if (f.type.startsWith('image/')) {
                                  const reader = new FileReader();
                                  reader.onload = ev => setLuDocPreview(ev.target.result);
                                  reader.readAsDataURL(f);
                                } else {
                                  setLuDocPreview(null);
                                }
                              }} />
                            {luDocPreview
                              ? <img src={luDocPreview} style={{ maxHeight: 80, maxWidth: '100%', borderRadius: 4 }} />
                              : <span style={{ color: 'var(--muted)', fontSize: 12 }}>{luDocFile ? luDocFile.name : '📎 แตะเลือกไฟล์'}</span>}
                          </div>
                        </div>
                      )}
                    </div>

                    {canApprove && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => handleApproveLevel(req)} disabled={isReviewing}
                          style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)',
                            opacity: isReviewing ? 0.6 : 1 }}>
                          ✅ อนุมัติ
                        </button>
                        <button onClick={() => { setRejectLuModal(req); setRejectLuReason(''); }} disabled={isReviewing}
                          style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                          ❌ ไม่อนุมัติ
                        </button>
                      </div>
                    )}
                    {!canApprove && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontSize: 10 }}>
                        {req.to_level === 100 ? 'รอ Manager' : 'รอ Supervisor'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Reject modal */}
          {rejectLuModal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: 'var(--card)', borderRadius: 14, padding: '24px', width: 'min(400px,94vw)' }}>
                <h3 style={{ margin: '0 0 4px', color: '#ef4444' }}>❌ ไม่อนุมัติ Level Up</h3>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>
                  {rejectLuModal.employees?.name} · {rejectLuModal.skill_name} → Lv.{rejectLuModal.to_level}
                </p>
                <textarea value={rejectLuReason} onChange={e => setRejectLuReason(e.target.value)}
                  placeholder="ระบุเหตุผล..." rows={3}
                  style={{ width: '100%', borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button onClick={handleRejectLevel}
                    style={{ flex: 2, padding: 10, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                    ยืนยัน
                  </button>
                  <button onClick={() => { setRejectLuModal(null); setRejectLuReason(''); }}
                    style={{ flex: 1, padding: 10, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}>
                    ยกเลิก
                  </button>
                </div>
              </div>
            </div>
          )}
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
