import { useState, useEffect, useContext, useRef, useMemo, startTransition, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import ToggleDot from '../components/ToggleDot';
import { filterLinesByDept, getLineFamilyIds } from '../utils/lineHierarchy';
import { fmtDateMedium } from '../utils/dateFormat';
import ImageCropModal from '../components/ImageCropModal';
import { can } from '../utils/permissions';
import {
  inSectionScope, ORPHAN_SECTION, ORPHAN_SECTION_LABEL,
  sectionValueForSave, sectionValueForEdit, orphanDepts, deptOptionsFor, deptNodeFor,
} from '../utils/sectionScope';
import { positionOptionsWith } from '../utils/positions';
import { buildLaborMap, laborTypeOf, laborMeta, LABOR_META } from '../utils/laborType';
import { SKILL_LEVELS, SKILL_GATES, getLevel, getBandCeiling, SKILL_CAT_META_FULL } from '../utils/skillLevels';

// การ์ดสรุปทักษะรายบุคคล — component เดียวกับหน้า Skill Matrix (/skills-report)
// lazy: recharts โหลดเฉพาะตอนเปิดการ์ด ไม่ถ่วงตอนเปิดหน้าฐานข้อมูลพนักงาน
const SkillRadarPanel = lazy(() => import('../components/SkillRadarPanel'));


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

/* สเกลสกิล 5 ระดับ / เพดานขั้น / หมวดสกิล ย้ายไป src/utils/skillLevels.js แล้ว (2026-08-06)
   — เดิมนิยามซ้ำกับ Report.jsx แล้ว drift กัน (import ด้านบน ห้ามนิยามซ้ำที่นี่อีก) */

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
  const { role, lineId: userLineId, section: userSection, sections: scopeSecs = [] } = useContext(UserContext);
  const isLeader = role === 'leader';
  const isSupervisor = role === 'supervisor';
  // ถ้าขอบเขตเหลือ section เดียว → ล็อกฟิลด์ Section ตอนแก้ไขพนักงาน (พฤติกรรม supervisor เดิม)
  // หลาย section → เปิดให้เลือกได้เฉพาะใน scope ตัวเอง
  const lockedScopeSec = scopeSecs.length === 1 ? scopeSecs[0] : null;

  const [tab, setTab] = useState(0);
  const [skillDefs, setSkillDefs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const tableWrapRef = useRef(null);
  const topScrollRef = useRef(null);
  const [scrollState, setScrollState] = useState({ left: false, right: true, hinted: false });
  const [inactiveEmployees, setInactiveEmployees] = useState([]);
  const [showInactive, setShowInactive] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [radarEmp, setRadarEmp] = useState(null);          // พนักงานที่กดดูการ์ดสรุปทักษะ (เหมือนหน้า Skill Matrix)
  const [subItemsByskill, setSubItemsByskill] = useState({}); // หัวข้อการพิจารณาต่อสกิล — ใช้ตอนพิมพ์ใบประเมินรายบุคคล
  const [empCropFile, setEmpCropFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newSkill, setNewSkill] = useState({ label: '', color: '#4d9fff', category: 'hard_skill', scope_section: '', allowance_type: '' });
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null); // skill being edited inline
  const [subItemsSkill, setSubItemsSkill] = useState(null); // skill whose หัวข้อการพิจารณา are being managed
  const [myLineName, setMyLineName] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterDept,    setFilterDept]    = useState('');
  const [filterGroup,   setFilterGroup]   = useState('');
  const [filterTeam,    setFilterTeam]    = useState('');
  const [filterGrade,   setFilterGrade]   = useState('');
  const [filterLabor,   setFilterLabor]   = useState(''); // direct/indirect
  const [filterOffOrg,  setFilterOffOrg]  = useState(false); // ดูเฉพาะคนที่ข้อมูลไม่ตรงผังองค์กร (ไล่แก้)
  const [lines,           setLines]           = useState([]);
  const [busRoutes,       setBusRoutes]       = useState([]);
  const [levelUpRequests, setLevelUpRequests] = useState([]);
  const [luDocFile,       setLuDocFile]       = useState(null);
  const [luDocPreview,    setLuDocPreview]    = useState(null);
  const [isReviewing,     setIsReviewing]     = useState(false);
  const [rejectLuModal,   setRejectLuModal]   = useState(null);
  const [rejectLuReason,  setRejectLuReason]  = useState('');
  const [runningWeekly,   setRunningWeekly]   = useState(false);
  const [orgSectionOpts,  setOrgSectionOpts]  = useState([]);
  const [orgSectionNodes, setOrgSectionNodes] = useState([]);
  const [orgDeptNodes,    setOrgDeptNodes]    = useState([]);
  const [orgLineNodes,    setOrgLineNodes]    = useState([]); // org groups (kind='line') + ref_line_id

  useEffect(() => {
    let alive = true;
    fetchSkillDefs();
    fetchEmployees();
    fetchLevelUpRequests();
    supabase.from('production_lines').select('id, name, section').order('name')
      .then(({ data }) => { if (alive) setLines(data || []); });
    supabase.from('bus_routes').select('id, code, name').eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (alive) setBusRoutes(data || []); });
    supabase.from('skill_sub_items').select('skill_name, seq, label, wi_ref').order('seq')
      .then(({ data }) => {
        if (!alive) return;
        const map = {};
        (data || []).forEach(r => { (map[r.skill_name] ||= []).push(r); });
        setSubItemsByskill(map);
      });
    supabase.from('org_nodes').select('id, code, name, kind, parent_id, labor_type, ref_line_id').eq('is_active', true).order('sort_order')
      .then(({ data }) => {
        if (!alive) return;
        const orgNodes = data || [];
        const secNodes = orgNodes.filter(n => n.kind === 'section');
        setOrgSectionNodes(secNodes);
        setOrgSectionOpts(secNodes.map(n => n.code || n.name));
        setOrgDeptNodes(orgNodes.filter(n => n.kind === 'department'));
        setOrgLineNodes(orgNodes.filter(n => n.kind === 'line'));
      });
    if (isLeader && userLineId) {
      supabase.from('production_lines').select('name').eq('id', userLineId).single()
        .then(({ data }) => { if (alive) setMyLineName(data?.name ?? ''); });
    }
    return () => { alive = false; };
  }, []);

  const fetchLevelUpRequests = async () => {
    const { data } = await supabase.from('skill_level_up_requests')
      .select('*, employees(id, name, employee_id_code, section, line_id)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });
    // mandatory scope filter — leader ก่อน แล้วค่อย section scope (pattern เดียวกับ fetchEmployees)
    let rows = data || [];
    if (isLeader && userLineId)  rows = rows.filter(r => r.employees?.line_id === userLineId);
    else if (scopeSecs.length)   rows = rows.filter(r => inSectionScope(scopeSecs, r.employees?.section));
    setLevelUpRequests(rows);
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
      // รูปบีบผ่าน resizeImage (ได้ .jpg) · PDF ส่งดิบแต่ cap 20MB (สเปคเดียวกับ drawing ฝั่ง QA)
      // และตั้งนามสกุลตามชนิดไฟล์จริง — เดิม fix .jpg ทำให้ PDF ถูกเก็บผิดฟอร์แมต
      const isPdf = luDocFile.type === 'application/pdf';
      if (isPdf && luDocFile.size > 20 * 1024 * 1024) {
        toast.error('ไฟล์ PDF ต้องไม่เกิน 20MB'); setIsReviewing(false); return;
      }
      let fileToUpload = luDocFile;
      if (luDocFile.type.startsWith('image/')) {
        fileToUpload = await resizeImage(luDocFile);
      }
      const path = `skill-docs/${req.employee_id}_${req.skill_name}_${Date.now()}.${isPdf ? 'pdf' : 'jpg'}`;
      const { error: upErr } = await supabase.storage.from('four-m-images').upload(path, fileToUpload, { upsert: false, contentType: isPdf ? 'application/pdf' : 'image/jpeg' });
      if (upErr) { toast.error('อัปโหลดเอกสารไม่สำเร็จ'); setIsReviewing(false); return; }
      const { data: urlData } = supabase.storage.from('four-m-images').getPublicUrl(path);
      doc_url = urlData.publicUrl;
    }

    // เขียนคะแนน + เคลียร์ pending_level ก่อน แล้วค่อยปิดคำขอ — ถ้า upsert ล้ม ห้ามมาร์คคำขอ approved
    // (เดิมปิดคำขอก่อน ถ้า upsert ล้ม พนักงานค้าง pending_level = farm ต่อไม่ได้ + คำขอหายจากรายการ กู้ไม่ได้)
    const { error: sErr } = await supabase.from('employee_skills').upsert({
      employee_id: req.employee_id, skill_name: req.skill_name,
      score: req.to_level, pending_level: null,
    }, { onConflict: 'employee_id,skill_name' });
    if (sErr) { toast.error('บันทึกคะแนนไม่สำเร็จ: ' + sErr.message); setIsReviewing(false); return; }

    const { error: rErr } = await supabase.from('skill_level_up_requests').update({
      status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString(), doc_url,
    }).eq('id', req.id);
    if (rErr) { toast.error('ผิดพลาด: ' + rErr.message); setIsReviewing(false); return; }

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
    // scope ของ leader = ทั้งครอบครัวไลน์ (ตัวเอง + แม่ + ลูก) — ห้ามกรอง line_id ตรงตัว
    // ดึงไลน์เองตรงนี้ ไม่พึ่ง state `lines` เพราะโหลดขนานกัน อาจยังว่างตอน fetch รอบแรก
    let famIds = null;
    if (isLeader && userLineId) {
      const { data: ls } = await supabase.from('production_lines').select('id, name, parent_line_name');
      const s = getLineFamilyIds(ls || [], Number(userLineId));
      famIds = s.size ? [...s] : null;
    }
    const makeBase = () => {
      let q = supabase.from('employees').select('*, employee_skills(skill_name, score, pending_level)');
      if (isLeader && userLineId)       q = famIds ? q.in('line_id', famIds) : q.eq('line_id', userLineId);
      else if (scopeSecs.length)        q = q.in('section', scopeSecs);
      return q;
    };
    const [{ data: active }, { data: inactive }] = await Promise.all([
      makeBase().eq('is_active', true).order('employee_id_code'),
      makeBase().eq('is_active', false).order('employee_id_code'),
    ]);
    // startTransition defers the heavy table re-render so navigation stays responsive
    startTransition(() => {
      setEmployees(active || []);
      setInactiveEmployees(inactive || []);
    });
  };

  // Pre-build skill lookup map per employee so render table is O(1) per cell
  const empSkillMapById = useMemo(() => {
    const out = {};
    [...employees, ...inactiveEmployees].forEach(emp => {
      const m = {};
      (emp.employee_skills || []).forEach(s => { m[s.skill_name] = s; });
      out[emp.id] = m;
    });
    return out;
  }, [employees, inactiveEmployees]);

  const getEmpSkill = (emp, skillName) => {
    const rec = empSkillMapById[emp.id]?.[skillName];
    return rec !== undefined ? rec.score : undefined;
  };

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
    const skillEnabled = {}; // true = has record (will upsert), false = no record (will delete)
    skillDefs.forEach(sd => {
      const rec = emp.employee_skills?.find(s => s.skill_name === sd.name);
      if (rec !== undefined) {
        scores[sd.name] = rec.score;
        skillEnabled[sd.name] = true;
      } else {
        scores[sd.name] = 0;
        skillEnabled[sd.name] = false;
      }
    });
    setEditingEmp({ ...emp, newPhoto: null, skillScores: scores, skillEnabled });
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

      // รหัสพนักงานแก้ได้ (เคสจริง: HR แจ้งรหัสผิดตั้งแต่ลงทะเบียน) — กันซ้ำกับคนอื่นก่อนบันทึก
      const newCode = (editingEmp.employee_id_code || '').trim();
      if (!newCode) throw new Error('กรุณากรอกรหัสพนักงาน');
      const { data: dupCode } = await supabase.from('employees')
        .select('id').eq('employee_id_code', newCode).neq('id', editingEmp.id).limit(1);
      if (dupCode?.length) throw new Error(`รหัส ${newCode} ถูกใช้โดยพนักงานคนอื่นแล้ว`);

      const { error } = await supabase.from('employees').update({
        employee_id_code: newCode,
        name:       editingEmp.name,
        position:   editingEmp.position   || null,
        department: editingEmp.department,
        // เซฟค่าเดียวกับที่ช่อง Section โชว์อยู่เสมอ (WYSIWYG) — "ขึ้นตรงฝ่าย" = null
        // ครอบข้อมูลเก่าที่กรอกชื่อแผนกซ้ำลง section ด้วย (section='MTN' → null) ดู sectionScope.js
        section:    lockedScopeSec || sectionValueForSave(
          sectionValueForEdit(editingEmp.section, editingEmp.department, orgDeptNodes, orgSectionNodes)),
        group_name: editingEmp.group_name || null,
        team:       editingEmp.team       || null,
        line_id:    editingEmp.line_id    || null,
        bus_route_id: editingEmp.bus_route_id || null,
        image_url:  photoUrl,
        start_date: editingEmp.start_date || null,
      }).eq('id', editingEmp.id);
      if (error) throw error;

      // เปลี่ยนรูปสำเร็จแล้วค่อยลบไฟล์รูปเดิมทิ้ง — ไฟล์ใหม่ได้ชื่อใหม่เสมอ (emp_<timestamp>)
      // ถ้าไม่ลบ ไฟล์เก่าจะกองเป็นขยะใน storage (เคยสะสมกว่า 100MB) · fire-and-forget ลบพลาดไม่ต้อง error
      if (editingEmp.newPhoto && editingEmp.image_url?.includes('/employee-photos/')) {
        const oldName = decodeURIComponent(editingEmp.image_url.split('/employee-photos/')[1] || '');
        if (oldName && !oldName.startsWith('layouts/')) {
          supabase.storage.from('employee-photos').remove([oldName]);
        }
      }

      // Skills marked as enabled → upsert; disabled (N/A) → delete record
      const enabledSkills = skillDefs.filter(sd => editingEmp.skillEnabled?.[sd.name]);
      const disabledSkillNames = skillDefs.filter(sd => !editingEmp.skillEnabled?.[sd.name]).map(sd => sd.name);

      if (enabledSkills.length > 0) {
        const upserts = enabledSkills.map(sd => ({
          employee_id: editingEmp.id,
          skill_name: sd.name,
          score: sd.category === 'allowance_skill' ? 100 : Number(editingEmp.skillScores?.[sd.name] ?? 0),
          updated_at: new Date().toISOString(),
        }));
        const { error: skillErr } = await supabase.from('employee_skills')
          .upsert(upserts, { onConflict: 'employee_id,skill_name' });
        if (skillErr) throw skillErr;
      }

      if (disabledSkillNames.length > 0) {
        const { error: delErr } = await supabase.from('employee_skills')
          .delete()
          .eq('employee_id', editingEmp.id)
          .in('skill_name', disabledSkillNames);
        if (delErr) throw delErr;
      }

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
      allowance_type: newSkill.category === 'allowance_skill' ? (newSkill.allowance_type || null) : null,
      sort_order: skillDefs.length + 1,
    }]);
    if (error) toast.error('เกิดข้อผิดพลาด: ' + error.message);
    else { setNewSkill({ label: '', color: '#4d9fff', category: 'hard_skill', scope_section: '', allowance_type: '' }); fetchSkillDefs(); }
    setIsAddingSkill(false);
  };

  const handleDeleteSkill = async (sd) => {
    if (!window.confirm(`ลบสกิล "${sd.label}"?\nคะแนนสกิลนี้ของพนักงานและ requirement ทุก station จะถูกลบด้วย`)) return;
    // ลบลูกก่อน (คะแนน + requirement) แล้วค่อยลบนิยามสกิล + เช็ค error ทุกสเตป
    // ไม่งั้นถ้าลบลูกไม่สำเร็จแต่ลบนิยามไปแล้ว จะเหลือ skill_name ค้างที่อ้างสกิลที่ไม่มี
    const e1 = (await supabase.from('employee_skills').delete().eq('skill_name', sd.name)).error;
    if (e1) { toast.error('ลบคะแนนสกิลไม่สำเร็จ: ' + e1.message); return; }
    const e2 = (await supabase.from('station_requirements').delete().eq('skill_name', sd.name)).error;
    if (e2) { toast.error('ลบ requirement ไม่สำเร็จ: ' + e2.message); return; }
    const e3 = (await supabase.from('skill_definitions').delete().eq('id', sd.id)).error;
    if (e3) { toast.error('ลบสกิลไม่สำเร็จ: ' + e3.message); return; }
    fetchSkillDefs();
    fetchEmployees();
  };

  const handleUpdateSkill = async () => {
    if (!editingSkill?.label?.trim()) { toast.error('กรุณาระบุชื่อสกิล'); return; }
    const { error } = await supabase.from('skill_definitions').update({
      label:          editingSkill.label.trim(),
      color:          editingSkill.color,
      category:       editingSkill.category,
      scope_section:  editingSkill.scope_section || null,
      allowance_type: editingSkill.category === 'allowance_skill' ? (editingSkill.allowance_type || null) : null,
    }).eq('id', editingSkill.id);
    if (error) { toast.error('แก้ไขไม่สำเร็จ: ' + error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditingSkill(null);
    fetchSkillDefs();
    fetchEmployees();
  };

  const workTypes = useMemo(() => [...new Set(skillDefs.filter(sd => sd.category === 'allowance_skill' && sd.allowance_type).map(sd => sd.allowance_type))].sort(), [skillDefs]);
  const allEmps = useMemo(() => [...employees, ...inactiveEmployees], [employees, inactiveEmployees]);
  const sectionOpts = useMemo(() => orgSectionOpts.length ? orgSectionOpts : [...new Set(allEmps.map(e => e.section).filter(Boolean))].sort(), [allEmps, orgSectionOpts]);
  // ประเภทแรงงาน direct/indirect derive จาก department ก่อน แล้ว section (ตั้งที่ผังองค์กร) — laborType.js
  // ช่างส่วนใหญ่อยู่ระดับแผนก → รวมทั้ง section + department nodes ใน map
  const laborMap = useMemo(() => buildLaborMap([...orgSectionNodes, ...orgDeptNodes]), [orgSectionNodes, orgDeptNodes]);
  const empLabor = (emp) => laborTypeOf(emp.section, emp.department, laborMap);
  // ตัวเลือก filter ไล่ตามลำดับชั้นองค์กร (cascade — คำสั่ง user 2026-07-21): Dept เฉพาะใน Section ที่เลือก ·
  // Group เฉพาะใน Section+Dept · Team ตามที่เหลือ — ดึงจากข้อมูลพนักงานจริง (ตรงกับแถวในตารางเสมอ ไม่มีตัวเลือกข้าม section/ซ้ำ)
  const empsInSec   = useMemo(() => allEmps.filter(e => !filterSection || e.section === filterSection), [allEmps, filterSection]);
  // ตัวกรองแผนก = จัดกลุ่มตามผังองค์กร แต่**โชว์เฉพาะแผนกที่มีพนักงานจริง** (ทุกตัวเลือกเจอคนแน่นอน — หัวหน้าหาคนไม่หาย)
  //   "ในผัง" = แผนกในผังที่มีพนักงาน · "นอกผัง" = แผนกที่พนักงานกรอกไว้แต่ยังไม่มีในผัง (ต้องจัดข้อมูล) · เรียงตาม sort_order ผัง
  const deptOrgList  = useMemo(() => {
    const secNode = orgSectionNodes.find(s => (s.code || s.name) === filterSection);
    const empDepts = new Set(empsInSec.map(e => String(e.department || '').trim().toLowerCase()).filter(Boolean));
    return [...new Set(orgDeptNodes   // dedupe ชื่อ — คนละ section ตั้งชื่อแผนกซ้ำกันได้ (เช่น "ทั่วไป" มีทั้ง PD2/PD4)
      .filter(d => filterSection ? (secNode && d.parent_id === secNode.id) : true)  // orgDeptNodes เรียง sort_order มาแล้ว
      .map(d => d.code || d.name)
      .filter(name => empDepts.has(String(name).trim().toLowerCase())))];  // เฉพาะแผนกที่มีพนักงานจริง
  }, [orgDeptNodes, orgSectionNodes, filterSection, empsInSec]);
  const deptLegacyList = useMemo(() => {
    const secNode = orgSectionNodes.find(s => (s.code || s.name) === filterSection);
    const orgAll = new Set(orgDeptNodes
      .filter(d => filterSection ? (secNode && d.parent_id === secNode.id) : true)
      .map(d => String(d.code || d.name).trim().toLowerCase()));
    return [...new Set(empsInSec.map(e => e.department).filter(Boolean))]
      .filter(d => !orgAll.has(String(d).trim().toLowerCase())).sort();
  }, [orgDeptNodes, orgSectionNodes, filterSection, empsInSec]);
  const deptOpts    = useMemo(() => [...deptOrgList, ...deptLegacyList], [deptOrgList, deptLegacyList]);
  const empsInDept  = useMemo(() => empsInSec.filter(e => !filterDept || e.department === filterDept), [empsInSec, filterDept]);
  // ตัวกรองกลุ่ม (Group) = cascade จากผังองค์กร (org_nodes kind='line' ใต้แผนกที่เลือก) เหมือน Dept — โชว์เฉพาะกลุ่มที่มีพนักงานจริง
  const grpDepNode  = useMemo(() => {
    const secNode = orgSectionNodes.find(s => (s.code || s.name) === filterSection);
    return orgDeptNodes.find(d => (d.code || d.name) === filterDept && (!secNode || d.parent_id === secNode.id));
  }, [orgDeptNodes, orgSectionNodes, filterSection, filterDept]);
  // ⚠️ ต้อง fallback เป็น "ทั้งผัง" เมื่อยังไม่เลือกแผนก (pattern เดียวกับ deptOrgList ที่ fallback เมื่อไม่เลือก section)
  // เดิม `grpDepNode ? ... : []` = ไม่เลือกแผนก → ลิสต์ในผังว่าง → **กลุ่มทุกตัวตกไปอยู่ "⚠ นอกผัง" ทั้งที่มีในผังจริง**
  const orgLinesInScope = useMemo(() => {
    if (grpDepNode) return orgLineNodes.filter(g => g.parent_id === grpDepNode.id);
    const secNode = orgSectionNodes.find(s => (s.code || s.name) === filterSection);
    if (secNode) {   // เลือก section แต่ยังไม่เลือกแผนก → กลุ่มของทุกแผนกใน section นั้น
      const depIds = new Set(orgDeptNodes.filter(d => d.parent_id === secNode.id).map(d => d.id));
      return orgLineNodes.filter(g => depIds.has(g.parent_id));
    }
    return orgLineNodes;   // ยังไม่เลือกอะไรเลย → ทั้งผัง
  }, [orgLineNodes, orgDeptNodes, orgSectionNodes, grpDepNode, filterSection]);
  // ⚠️ กลุ่มในผังต้องเทียบทั้ง "ชื่อ" และ "รหัส" — org_nodes kind='line' มี code เป็นเลขไลน์ ('9','12')
  // ขณะที่ employees.group_name เก็บ "ชื่อ" (เช่น LINE ASSY TSRA) · เทียบด้วย code||name อย่างเดียว
  // ทำให้พนักงานที่อยู่ไลน์นั้นจริงถูกตีเป็น "นอกผัง" ทั้งกลุ่ม
  const orgGroupKeys = useMemo(() => {
    const s = new Set();
    orgLinesInScope.forEach(g => {
      [g.name, g.code].filter(Boolean).forEach(v => s.add(String(v).trim().toLowerCase()));
    });
    return s;
  }, [orgLinesInScope]);
  const groupOrgList = useMemo(() => {
    // ค่าใน dropdown = ชื่อกลุ่มที่พนักงานถูกบันทึกไว้จริง (ตัวกรองเทียบกับ group_name ตรงๆ)
    const seen = new Set();
    return empsInDept.map(e => e.group_name).filter(Boolean)
      .filter(gn => orgGroupKeys.has(String(gn).trim().toLowerCase()))
      .filter(gn => { const k = String(gn).trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [orgLinesInScope, orgGroupKeys, empsInDept]);
  const groupLegacyList = useMemo(() =>
    [...new Set(empsInDept.map(e => e.group_name).filter(Boolean))]
      .filter(g => !orgGroupKeys.has(String(g).trim().toLowerCase())).sort()
  , [orgGroupKeys, empsInDept]);
  const groupOpts   = useMemo(() => [...groupOrgList, ...groupLegacyList], [groupOrgList, groupLegacyList]);
  const teamOpts    = useMemo(() => [...new Set(empsInDept.filter(e => !filterGroup || e.group_name === filterGroup).map(e => e.team).filter(Boolean))].sort(), [empsInDept, filterGroup]);

  // ── รายชื่อ "ข้อมูลไม่ตรงผังองค์กร" (worklist สำหรับไล่แก้ · 2026-08-06) ──
  // ฟอร์มเพิ่ม/แก้พนักงานเป็น dropdown จากผังล้วนแล้ว (พิมพ์เองไม่ได้) — ที่ค้างอยู่คือข้อมูลเก่า
  // ก่อนมี cascade · โชว์ให้เห็นเป็นตัวเลข + กรองดูเฉพาะกลุ่มนี้ได้ จะได้ไล่แก้จนหมดแล้วหายไปเอง
  // (เจตนา: ไม่ซ่อน "นอกผัง" ทิ้ง — ถ้าซ่อน จะหาคนที่ต้องแก้ไม่เจอ กลายเป็นข้อมูลผิดที่มองไม่เห็น)
  const orgDeptKeys = useMemo(() => {
    const s = new Set();
    orgDeptNodes.forEach(d => [d.name, d.code].filter(Boolean).forEach(v => s.add(String(v).trim().toLowerCase())));
    return s;
  }, [orgDeptNodes]);
  const allOrgLineKeys = useMemo(() => {
    const s = new Set();
    orgLineNodes.forEach(g => [g.name, g.code].filter(Boolean).forEach(v => s.add(String(v).trim().toLowerCase())));
    return s;
  }, [orgLineNodes]);
  // คืนเหตุผลที่ไม่ตรงผัง ([] = ตรงผัง) — ยังไม่โหลดผัง (ลิสต์ว่าง) ถือว่าตรงหมด กันเตือนผิดตอนเปิดหน้า
  const offOrgReasons = useMemo(() => (emp) => {
    if (!orgDeptNodes.length) return [];
    const r = [];
    const dep = String(emp.department || '').trim();
    if (!dep) r.push('ยังไม่ระบุแผนก');
    else if (!orgDeptKeys.has(dep.toLowerCase())) r.push(`แผนก "${dep}" ไม่มีในผัง`);
    const grp = String(emp.group_name || '').trim();
    if (grp && orgLineNodes.length && !allOrgLineKeys.has(grp.toLowerCase())) r.push(`กลุ่ม "${grp}" ไม่มีในผัง`);
    return r;
  }, [orgDeptNodes, orgLineNodes, orgDeptKeys, allOrgLineKeys]);
  // section ที่ผังยังไม่มีแผนกใต้มันเลย → พนักงาน section นั้น "แก้ผ่านฟอร์มไม่ได้" (ไม่มีตัวเลือกให้เลือก)
  // ต้องไปเพิ่มแผนก/กลุ่มที่ผังองค์กร (/org-setup) ก่อน — ต้องแยกให้เห็น ไม่งั้นสั่งให้ไปแก้แล้วแก้ไม่ได้
  const secWithoutDept = useMemo(() => {
    const has = new Set(orgDeptNodes.map(d => d.parent_id).filter(Boolean));
    return new Set(orgSectionNodes.filter(s => !has.has(s.id)).map(s => s.code || s.name));
  }, [orgDeptNodes, orgSectionNodes]);
  const offOrgStat = useMemo(() => {
    const rows = (showInactive ? inactiveEmployees : employees).filter(e => offOrgReasons(e).length);
    const blocked = rows.filter(e => e.section && secWithoutDept.has(e.section));
    return { total: rows.length, blocked: blocked.length, blockedSecs: [...new Set(blocked.map(e => e.section))].sort() };
  }, [employees, inactiveEmployees, showInactive, offOrgReasons, secWithoutDept]);

  const displayed = useMemo(() => (showInactive ? inactiveEmployees : employees)
    .filter(emp => !filterSection || emp.section    === filterSection)
    .filter(emp => !filterDept    || emp.department === filterDept)
    .filter(emp => !filterGroup   || emp.group_name === filterGroup)
    .filter(emp => !filterTeam    || emp.team       === filterTeam)
    .filter(emp => !filterGrade   || getEmpGrade(emp.employee_id_code) === EMP_GRADES[filterGrade])
    .filter(emp => !filterLabor   || empLabor(emp) === filterLabor)
    .filter(emp => !filterOffOrg  || offOrgReasons(emp).length > 0),
  [employees, inactiveEmployees, showInactive, filterSection, filterDept, filterGroup, filterTeam, filterGrade, filterLabor, filterOffOrg, offOrgReasons, laborMap]);

  // Only show skill columns where at least one displayed employee has score > 0
  // Must be useMemo — stable reference prevents ResizeObserver useEffect from looping
  const activeSkillDefs = useMemo(() => skillDefs.filter(sd =>
    displayed.some(emp => {
      const s = emp.employee_skills?.find(es => es.skill_name === sd.name);
      return s && s.score > 0;
    })
  ), [skillDefs, displayed]);

  // Keep top mirror scrollbar width in sync + track scroll shadow state
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    const updateScroll = () => {
      const left = el.scrollLeft > 8;
      const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 8;
      setScrollState(s => ({ ...s, left, right, hinted: s.hinted || el.scrollLeft > 0 }));
      if (topScrollRef.current) topScrollRef.current.scrollLeft = el.scrollLeft;
    };
    const obs = new ResizeObserver(() => {
      if (topScrollRef.current) {
        const inner = topScrollRef.current.firstElementChild;
        if (inner) inner.style.width = el.scrollWidth + 'px';
      }
      updateScroll();
    });
    el.addEventListener('scroll', updateScroll, { passive: true });
    obs.observe(el);
    updateScroll();
    return () => { el.removeEventListener('scroll', updateScroll); obs.disconnect(); };
  }, [activeSkillDefs, displayed]);

  return (
    <div className="page-content">
      {subItemsSkill && (
        <SkillSubItemsModal skill={subItemsSkill} onClose={() => setSubItemsSkill(null)} />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
          👥 ฐานข้อมูลพนักงาน
        </h2>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {/* แท็บโผล่ตามสิทธิ์จริง (role_permissions) ไม่ hardcode role — ตั้งที่ /permissions แล้วมีผลทันที
            index ต้องคงเดิม (0 พนักงาน · 1 กำหนดสกิล · 2 Level Up) เพราะเนื้อหาอ้าง tab === n · QC audit 2026-08-03 */}
        {[
          [0, '👥 พนักงาน', true],
          [1, '⚙️ กำหนดสกิล', can('skills', 'edit', role)],
          [2, '⬆️ Level Up', can('skills', 'approve_levelup', role) || can('skills', 'approve_levelup_100', role)],
        ].filter(([, , show]) => show).map(([i, t]) => (
          <button key={i} onClick={() => setTab(i)} style={{
            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
            background: tab === i ? 'var(--accent)' : 'var(--bg3)',
            color: tab === i ? '#fff' : 'var(--text2)',
            fontWeight: tab === i ? 700 : 400,
            position: 'relative',
          }}>
            {t}
            {i === 2 && levelUpRequests.length > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {levelUpRequests.length}
              </span>
            )}
          </button>
        ))}
        {scopeSecs.length > 0 && (
          <div style={{
            fontSize: 11, color: '#4d9fff', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4,
            padding: '4px 8px', borderRadius: 6,
            background: 'rgba(77,159,255,0.1)', border: '1px solid rgba(77,159,255,0.25)',
          }}>
            🏢 {scopeSecs.join(', ')}
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
              // เปลี่ยนตัวแม่ = ล้างตัวลูก (กันค้างค่าที่ไม่อยู่ใน scope ใหม่แล้วตารางว่างงงๆ)
              { label: 'Section', value: filterSection, opts: sectionOpts, set: (v) => { setFilterSection(v); setFilterDept(''); setFilterGroup(''); } },
              { label: 'Dept',    value: filterDept,    opts: deptOpts,    set: (v) => { setFilterDept(v); setFilterGroup(''); } },
              { label: 'Group',   value: filterGroup,   opts: groupOpts,   set: setFilterGroup },
              { label: 'Team',    value: filterTeam,    opts: teamOpts,    set: setFilterTeam },
            ].map(f => (
              <select key={f.label} value={f.value} onChange={e => f.set(e.target.value)}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: f.value ? 'var(--text)' : 'var(--muted)', minWidth: 110 }}>
                <option value="">{`— ${f.label} —`}</option>
                {(f.label === 'Dept' || f.label === 'Group') ? (() => {
                  const orgL = f.label === 'Dept' ? deptOrgList : groupOrgList;
                  const legacyL = f.label === 'Dept' ? deptLegacyList : groupLegacyList;
                  return (
                    <>
                      {orgL.length > 0 && (
                        <optgroup label="ในผังองค์กร">
                          {orgL.map(o => <option key={`o_${o}`} value={o}>{o}</option>)}
                        </optgroup>
                      )}
                      {legacyL.length > 0 && (
                        <optgroup label="⚠ นอกผัง (ต้องจัดข้อมูล)">
                          {legacyL.map(o => <option key={`l_${o}`} value={o}>{o}</option>)}
                        </optgroup>
                      )}
                    </>
                  );
                })() : (
                  f.opts.map(o => <option key={o} value={o}>{o}</option>)
                )}
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

            {/* Labor type filter chips (Direct/Indirect — ตั้งที่ผังองค์กร) */}
            <span style={{ width: 1, height: 20, background: 'var(--border2)', margin: '0 2px' }} />
            {['direct', 'indirect'].map(t => {
              const m = LABOR_META[t];
              const active = filterLabor === t;
              return (
                <button key={t} onClick={() => setFilterLabor(active ? '' : t)}
                  style={{ padding: '4px 11px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${active ? m.color : 'var(--border2)'}`,
                    background: active ? `${m.color}22` : 'var(--bg3)',
                    color: active ? m.color : 'var(--muted)', transition: 'all 0.15s' }}>
                  {m.icon} {m.short}
                </button>
              );
            })}

            {(filterSection || filterDept || filterGroup || filterTeam || filterGrade || filterLabor) && (
              <button onClick={() => { setFilterSection(''); setFilterDept(''); setFilterGroup(''); setFilterTeam(''); setFilterGrade(''); setFilterLabor(''); }}
                style={{ fontSize: 11, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)', cursor: 'pointer' }}>
                ✕ ล้าง
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>ใช้งาน {employees.length} คน</span>
            <button onClick={() => setShowInactive(s => !s)}
              style={{
                position: 'relative',
                padding: '6px 12px', borderRadius: 7, border: 'none', fontSize: 12, cursor: 'pointer',
                background: showInactive ? 'rgba(231,76,60,0.15)' : 'var(--bg3)',
                color: showInactive ? 'var(--red)' : 'var(--text2)',
              }}>
              {showInactive
                ? `✅ ดูพนักงานใช้งาน (${employees.length})`
                : `❌ ปิดใช้งาน (${inactiveEmployees.length})`}
              <ToggleDot on={showInactive} />
            </button>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>· คลิกที่พนักงานเพื่อดูสรุปทักษะ (Radar Chart)</span>
          </div>

          {/* worklist ข้อมูลไม่ตรงผังองค์กร — เตือนแบบนิ่ง (ไม่ใช่ alarm) กดกรองดูเฉพาะคนที่ต้องแก้ได้ */}
          {offOrgStat.total > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12,
              padding: '9px 12px', borderRadius: 8,
              background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)',
            }}>
              <span style={{ fontSize: 12.5, color: '#f59e0b', fontWeight: 700 }}>
                ⚠️ ข้อมูลไม่ตรงผังองค์กร {offOrgStat.total} คน
              </span>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                แผนก/กลุ่มที่บันทึกไว้ไม่มีในผัง (ข้อมูลเก่าก่อนระบบบังคับเลือกจากผัง) — เปิดแก้ไขแล้วเลือกใหม่จาก dropdown ได้เลย
                {offOrgStat.blocked > 0 && (
                  <> · <b style={{ color: '#f59e0b' }}>ในนี้ {offOrgStat.blocked} คน ({offOrgStat.blockedSecs.join(', ')}) แก้ที่ฟอร์มยังไม่ได้</b> —
                    ผังยังไม่มีแผนกของส่วนงานนี้ ต้องเพิ่มที่ <Link to="/org-setup" style={{ color: '#f59e0b', fontWeight: 700 }}>ผังองค์กร</Link> ก่อน</>
                )}
              </span>
              <button onClick={() => setFilterOffOrg(v => !v)}
                style={{
                  position: 'relative', marginLeft: 'auto',
                  padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(245,158,11,0.5)', fontSize: 12, cursor: 'pointer',
                  background: filterOffOrg ? 'rgba(245,158,11,0.28)' : 'transparent', color: '#f59e0b', fontWeight: 700,
                }}>
                {filterOffOrg ? '✅ กำลังดูเฉพาะที่ต้องแก้' : '🔎 ดูเฉพาะที่ต้องแก้'}
                <ToggleDot on={filterOffOrg} ring="var(--bg)" />
              </button>
            </div>
          )}

          {/* Scroll hint chip */}
          {!scrollState.hinted && scrollState.right && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--accent)', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 20, padding: '3px 10px' }}>
                ← เลื่อนดูสกิลเพิ่มเติม →
              </div>
            </div>
          )}

          {/* Table + fade overlays */}
          <div style={{ position: 'relative' }}>
            {/* Left fade */}
            <div style={{ position: 'absolute', left: 220, top: 0, bottom: 14, width: 48, pointerEvents: 'none', zIndex: 5, background: 'linear-gradient(to right, var(--bg2), transparent)', opacity: scrollState.left ? 1 : 0, transition: 'opacity 0.2s' }} />
            {/* Right fade */}
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 14, width: 64, pointerEvents: 'none', zIndex: 5, background: 'linear-gradient(to left, var(--bg2), transparent)', opacity: scrollState.right ? 1 : 0, transition: 'opacity 0.2s' }}>
              {scrollState.right && <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--accent)', opacity: 0.7, animation: 'bounceX 1.2s ease-in-out infinite' }}>›</div>}
            </div>

          {/* Top mirror scrollbar */}
          <style>{`
            .skill-table-wrap::-webkit-scrollbar { height: 8px; }
            .skill-table-wrap::-webkit-scrollbar-track { background: var(--bg3); border-radius: 4px; }
            .skill-table-wrap::-webkit-scrollbar-thumb { background: var(--accent); border-radius: 4px; opacity: 0.8; }
            .skill-table-wrap::-webkit-scrollbar-thumb:hover { background: var(--accent2); }
            @keyframes bounceX { 0%,100% { transform: translateY(-50%) translateX(0); } 50% { transform: translateY(-50%) translateX(5px); } }
          `}</style>
          <div ref={topScrollRef}
            onScroll={e => { if (tableWrapRef.current) tableWrapRef.current.scrollLeft = e.target.scrollLeft; }}
            style={{ overflowX: 'auto', overflowY: 'hidden', borderRadius: '4px 4px 0 0' }}
            className="skill-table-wrap">
            <div style={{ height: 1, width: tableWrapRef.current?.scrollWidth || 2000 }} />
          </div>
          <div ref={tableWrapRef} className="card skill-table-wrap table-sticky"
            style={{ overflowX: 'auto', borderRadius: '0 0 8px 8px', marginTop: 0 }}>
            <table style={{ minWidth: 560, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 12 }}>โปรไฟล์</th>
                  <th style={{ position: 'sticky', left: 58, background: 'var(--bg2)', zIndex: 12 }}>ID</th>
                  <th style={{ position: 'sticky', left: 148, background: 'var(--bg2)', zIndex: 12, boxShadow: '2px 0 6px rgba(0,0,0,0.15)' }}>ชื่อ</th>
                  <th style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Section</th>
                  <th style={{ fontSize: 11, whiteSpace: 'nowrap' }}>แผนก</th>
                  <th style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Group</th>
                  <th style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Team</th>
                  <th style={{ fontSize: 11, whiteSpace: 'nowrap' }}>วันเริ่มงาน</th>
                  {activeSkillDefs.map(sd => (
                    <th key={sd.name} style={{ fontSize: 11, color: sd.color, whiteSpace: 'nowrap' }}>
                      <div>{{ hard_skill:'🔧', machine_skill:'⚙️', product_skill:'📦', soft_skill:'🧠' }[sd.category || 'hard_skill']} {sd.label}</div>
                      {sd.scope_section && <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>📍{sd.scope_section}</div>}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', position: 'sticky', right: 0, background: 'var(--bg2)', zIndex: 12, boxShadow: '-2px 0 6px rgba(0,0,0,0.15)' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(emp => {
                  const grade = getEmpGrade(emp.employee_id_code);
                  const offOrg = offOrgReasons(emp);   // เหตุผลที่ข้อมูลไม่ตรงผัง ([] = ตรงผัง)
                  return (
                  // คลิกทั้งแถว = เปิดการ์ดสรุปทักษะ (pattern เดียวกับตาราง Skill Matrix)
                  // — คอลัมน์จัดการ stopPropagation ไว้ ปุ่ม ✏️/🚫 จึงทำงานเหมือนเดิม
                  <tr key={emp.id} onClick={() => setRadarEmp(emp)}
                    title={`ดูสรุปทักษะของ ${emp.name}`}
                    style={{ cursor: 'pointer', transition: 'background 0.15s', ...(!emp.is_active ? { opacity: 0.5 } : {}) }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>
                      <div style={{
                        display: 'inline-flex', padding: 2.5, borderRadius: 12,
                        background: !emp.is_active ? 'var(--border2)' : grade.gradient,
                        boxShadow: !emp.is_active ? 'none' : `0 0 10px ${grade.glow}`,
                      }}>
                        {emp.image_url ? (
                          <img
                            src={emp.image_url}
                            alt=""
                            style={{
                              width: 42, height: 42, borderRadius: 9,
                              objectFit: 'cover', display: 'block',
                              filter: !emp.is_active ? 'grayscale(1)' : 'none',
                              background: 'var(--bg3)',
                            }}
                          />
                        ) : (
                          <div
                            title="ยังไม่มีรูป — กด ✏️ แก้ไขเพื่ออัปโหลดรูป"
                            style={{
                              width: 42, height: 42, borderRadius: 9,
                              background: 'var(--bg3)', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', fontSize: 20,
                            }}>
                            👤
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ position: 'sticky', left: 58, background: 'var(--bg2)', zIndex: 1 }}>
                      <div style={{ fontWeight: 700, color: grade.text, fontFamily: 'var(--font-display)', fontSize: 13 }}>
                        {emp.employee_id_code}
                      </div>
                      <div style={{
                        display: 'inline-block', marginTop: 3,
                        fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
                        padding: '1px 7px', borderRadius: 4,
                        background: grade.badge, color: grade.text, border: `1px solid ${grade.border}`,
                      }}>
                        {grade.label}
                      </div>
                    </td>
                    <td style={{ position: 'sticky', left: 148, background: 'var(--bg2)', zIndex: 1, boxShadow: '2px 0 6px rgba(0,0,0,0.15)' }}>
                      <div style={{ fontWeight: 600 }}>{emp.name}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {emp.section || '—'}
                      {emp.section && (() => { const m = laborMeta(empLabor(emp)); return (
                        <span title={m.label} style={{ marginLeft: 5, fontSize: 11, padding: '0 4px', borderRadius: 3, background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}44`, fontWeight: 700 }}>{m.icon}</span>
                      ); })()}
                    </td>
                    {/* ค่าที่ไม่มีในผังองค์กรทำเป็นสีเหลืองนิ่ง + tooltip บอกเหตุผล (ไม่กระพริบ — ไม่ใช่ alarm) */}
                    <td style={{ fontSize: 12, color: offOrg.some(r => r.includes('แผนก')) ? '#f59e0b' : 'var(--text2)' }}
                      title={offOrg.find(r => r.includes('แผนก')) || ''}>
                      {offOrg.some(r => r.includes('แผนก')) && '⚠ '}{emp.department || '—'}
                    </td>
                    <td style={{ fontSize: 12, color: offOrg.some(r => r.includes('กลุ่ม')) ? '#f59e0b' : 'var(--text2)' }}
                      title={offOrg.find(r => r.includes('กลุ่ม')) || ''}>
                      {offOrg.some(r => r.includes('กลุ่ม')) && '⚠ '}{emp.group_name || '—'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{emp.team       || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {emp.start_date ? emp.start_date : '—'}
                    </td>
                    {activeSkillDefs.map(sd => {
                      const skillObj = empSkillMapById[emp.id]?.[sd.name];
                      const hasRecord = skillObj !== undefined && skillObj.score > 0;
                      const score = hasRecord ? skillObj.score : undefined;
                      const pending = skillObj?.pending_level ?? null;
                      const lv = hasRecord ? getLevel(score) : null;
                      return (
                        <td key={sd.name} style={{ textAlign: 'center' }}>
                          {hasRecord ? (
                            <>
                              <div style={{ fontWeight: 700, fontSize: 13, color: lv.color }}>{score}</div>
                              <div style={{ fontSize: 11, background: lv.bg, color: lv.color, borderRadius: 4, padding: '1px 5px', marginTop: 2, whiteSpace: 'nowrap' }}>
                                {lv.label}
                              </div>
                            </>
                          ) : (
                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                          )}
                          {pending && (
                            <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginTop: 2 }}>
                              ⏳ Lv.{pending}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    {/* กันคลิกปุ่มไปเปิดการ์ดสรุปทักษะของแถว (row click ด้านบน) */}
                    <td onClick={e => e.stopPropagation()} title=""
                      style={{ textAlign: 'center', position: 'sticky', right: 0, background: 'var(--bg2)', zIndex: 1, boxShadow: '-2px 0 8px rgba(0,0,0,0.18)', padding: '0 8px', cursor: 'default' }}>
                      {emp.is_active ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                          {can('employees', 'edit', role) && (
                          <button className="tbtn" title="แก้ไขข้อมูล" onClick={() => openEdit(emp)} style={{
                            width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                            background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                            fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'background 0.15s, transform 0.1s',
                          }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.28)'; e.currentTarget.style.transform = 'scale(1.15)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.12)'; e.currentTarget.style.transform = 'scale(1)'; }}>
                            ✏️
                          </button>
                          )}
                          {can('employees', 'deactivate', role) && (
                          <button className="tbtn" title="ปิดใช้งาน" onClick={() => handleDeactivate(emp.id, emp.name)} style={{
                            width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                            background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                            fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'background 0.15s, transform 0.1s',
                          }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.25)'; e.currentTarget.style.transform = 'scale(1.15)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.transform = 'scale(1)'; }}>
                            🚫
                          </button>
                          )}
                        </div>
                      ) : can('employees', 'deactivate', role) ? (
                        <button className="tbtn" title="เปิดใช้งานอีกครั้ง" onClick={() => handleReactivate(emp.id)} style={{
                          width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                          background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                          fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          margin: '0 auto',
                          transition: 'background 0.15s, transform 0.1s',
                        }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.28)'; e.currentTarget.style.transform = 'scale(1.15)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.12)'; e.currentTarget.style.transform = 'scale(1)'; }}>
                          ↩
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div> {/* end position:relative wrapper */}
        </>
      )}

      {tab === 1 && (() => {
        const CAT_META = SKILL_CAT_META_FULL;   // 4 หมวดทักษะ + ใบเซอร์ค่าฝีมือ (utils/skillLevels.js)
        const grouped = Object.entries(CAT_META).map(([k, m]) => ({
          key: k, ...m, skills: skillDefs.filter(sd => (sd.category || 'hard_skill') === k),
        })).filter(g => g.skills.length > 0 || true);

        return (
          <div>
            {/* Skill list grouped by category */}
            {grouped.map(g => g.skills.length === 0 ? null : (
              <div key={g.key} style={{ marginBottom: 20 }}>
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{g.icon} {g.label}</span>
                  {g.desc && <span style={{ fontSize: 11, color: g.color, opacity: 0.7 }}>{g.desc}</span>}
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
                              <span style={{ fontSize: 11, background: 'rgba(77,159,255,0.12)', color: '#4d9fff', borderRadius: 4, padding: '0 5px', fontWeight: 600 }}>
                                📍 {sd.scope_section}
                              </span>
                            )}
                            {sd.allowance_type && (
                              <span style={{ fontSize: 11, background: 'rgba(34,197,94,0.12)', color: '#22c55e', borderRadius: 4, padding: '0 5px', fontWeight: 600 }}>
                                💰 {sd.allowance_type}
                              </span>
                            )}
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sd.name}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {can('skills', 'edit', role) && (
                          <button onClick={() => setSubItemsSkill(sd)} title="หัวข้อการพิจารณา (ใบประเมินรายบุคคล)"
                            className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}>📝</button>
                        )}
                        {can('skills', 'edit', role) && (
                          <button onClick={() => setEditingSkill({ ...sd, scope_section: sd.scope_section || '' })}
                            className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}>✏️</button>
                        )}
                        {can('skills', 'delete', role) && (
                          <button onClick={() => handleDeleteSkill(sd)}
                            className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}>🗑️</button>
                        )}
                      </div>
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
                  <select value={newSkill.scope_section} onChange={e => setNewSkill({ ...newSkill, scope_section: e.target.value })}>
                    <option value="">— ทุกส่วนงาน —</option>
                    {sectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {newSkill.category === 'allowance_skill' && (
                  <div>
                    <label style={labelSt}>ประเภทค่าฝีมือที่ผูก</label>
                    <select value={newSkill.allowance_type} onChange={e => setNewSkill({ ...newSkill, allowance_type: e.target.value })}>
                      <option value="">— เลือกประเภท —</option>
                      {workTypes.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                )}
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
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{lv.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Edit skill modal */}
            {editingSkill && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: 'var(--card)', borderRadius: 14, padding: '24px', width: 'min(480px,94vw)', boxShadow: 'var(--shadow-lg)' }}>
                  <h3 style={{ margin: '0 0 16px', fontFamily: 'var(--font-display)' }}>✏️ แก้ไขสกิล</h3>
                  <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div style={{ gridColumn: '1/-1' }}>
                      <label style={labelSt}>ชื่อสกิล</label>
                      <input value={editingSkill.label}
                        onChange={e => setEditingSkill({ ...editingSkill, label: e.target.value })} />
                    </div>
                    <div>
                      <label style={labelSt}>ประเภทสกิล</label>
                      <select value={editingSkill.category || 'hard_skill'}
                        onChange={e => setEditingSkill({ ...editingSkill, category: e.target.value })}>
                        <option value="hard_skill">🔧 Hard Skill</option>
                        <option value="machine_skill">⚙️ Machine Skill</option>
                        <option value="product_skill">📦 Product Skill</option>
                        <option value="soft_skill">🧠 Soft Skill</option>
                        <option value="allowance_skill">🎫 ใบเซอร์ค่าฝีมือ</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelSt}>ส่วนงาน</label>
                      <select value={editingSkill.scope_section || ''}
                        onChange={e => setEditingSkill({ ...editingSkill, scope_section: e.target.value })}>
                        <option value="">— ทุกส่วนงาน —</option>
                        {sectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    {editingSkill.category === 'allowance_skill' && (
                      <div style={{ gridColumn: '1/-1' }}>
                        <label style={labelSt}>ประเภทค่าฝีมือที่ผูก</label>
                        <select value={editingSkill.allowance_type || ''}
                          onChange={e => setEditingSkill({ ...editingSkill, allowance_type: e.target.value })}>
                          <option value="">— เลือกประเภท —</option>
                          {workTypes.map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </div>
                    )}
                    <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <label style={{ ...labelSt, marginBottom: 0 }}>สีแสดงผล</label>
                      <input type="color" value={editingSkill.color}
                        onChange={e => setEditingSkill({ ...editingSkill, color: e.target.value })}
                        style={{ width: 44, height: 36, padding: 2, borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', cursor: 'pointer' }} />
                      <span style={{ fontSize: 13, color: editingSkill.color, fontWeight: 700 }}>● {editingSkill.label || 'ตัวอย่าง'}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={handleUpdateSkill}
                      style={{ flex: 2, padding: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                      💾 บันทึก
                    </button>
                    <button onClick={() => setEditingSkill(null)}
                      style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}>
                      ยกเลิก
                    </button>
                  </div>
                </div>
              </div>
            )}
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
            {can('skills', 'run_weekly_update', role) && (
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
                  ? can('skills', 'approve_levelup_100', role)
                  : can('skills', 'approve_levelup', role);
                return (
                  <div key={req.id} className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{emp?.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{emp?.employee_id_code}</span>
                        {emp?.section && <span style={{ fontSize: 11, background: 'rgba(77,159,255,0.1)', color: '#4d9fff', borderRadius: 4, padding: '1px 6px' }}>{emp.section}</span>}
                      </div>
                      <div style={{ fontSize: 13, marginBottom: 4 }}>
                        ทักษะ: <strong style={{ color: 'var(--accent)' }}>{skillDefs.find(s => s.name === req.skill_name)?.label ?? req.skill_name}</strong>
                        &nbsp;·&nbsp;
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>score {req.from_score}</span>
                        &nbsp;→&nbsp;
                        <span style={{ color: toLv?.color, fontWeight: 800 }}>Level {req.to_level} ({toLv?.label})</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        ขอเมื่อ {fmtDateMedium(req.requested_at)}
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
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {req.to_level === 100 ? 'รอชุดสิทธิ์ทั้งฝ่ายอนุมัติ' : 'รอชุดสิทธิ์ระดับส่วนอนุมัติ'}
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

      {/* การ์ดสรุปทักษะรายบุคคล — component เดียวกับหน้า Skill Matrix (radar + พิมพ์ใบ F-PRS-P1-119) */}
      {radarEmp && (
        <Suspense fallback={null}>
          <SkillRadarPanel
            emp={radarEmp}
            skillDefs={skillDefs}
            subItemsByskill={subItemsByskill}
            lines={lines}
            onClose={() => setRadarEmp(null)}
          />
        </Suspense>
      )}

      {editingEmp && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(1360px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, borderBottom: '1px solid var(--border)', paddingBottom: 12, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              📝 แก้ไขข้อมูลพนักงาน
            </h3>
            {/* จอ ≥1100px: ซ้าย = ข้อมูลพนักงาน · ขวา = ระดับทักษะ (landscape ตาม UI-CONVENTIONS §5) */}
            <form onSubmit={handleUpdate} className="modal-2col" style={{ marginTop: 16 }}>
              <div className="m2c-col">
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelSt}>รหัสพนักงาน</label>
                  <input type="text" value={editingEmp.employee_id_code || ''}
                    onChange={e => setEditingEmp({ ...editingEmp, employee_id_code: e.target.value })} required />
                </div>
                <div>
                  <label style={labelSt}>ชื่อ - นามสกุล</label>
                  <input type="text" value={editingEmp.name}
                    onChange={e => setEditingEmp({ ...editingEmp, name: e.target.value })} required />
                </div>
                <div>
                  <label style={labelSt}>ตำแหน่งงาน</label>
                  {/* ตำแหน่งงาน — master list กลาง (src/utils/positions.js) · ค่าเก่านอกลิสต์ยังโชว์ได้ */}
                  <select value={editingEmp.position || ''}
                    onChange={e => setEditingEmp({ ...editingEmp, position: e.target.value })}>
                    <option value="">— เลือก —</option>
                    {positionOptionsWith(editingEmp.position).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelSt}>Section / ส่วน</label>
                  {lockedScopeSec ? (
                    <input type="text" value={lockedScopeSec} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                  ) : (
                    // แผนกขึ้นตรงฝ่าย (MTN/JIG MTN/DIE MTN/QA) เลือกผ่าน sentinel — ดู sectionScope.js
                    //   พนักงานเดิมที่ section ว่างแต่แผนกขึ้นตรงฝ่าย ต้องโชว์ sentinel ไม่งั้นช่องแผนกถูกล็อก
                    <select value={sectionValueForEdit(editingEmp.section, editingEmp.department, orgDeptNodes, orgSectionNodes)}
                      onChange={e => setEditingEmp({ ...editingEmp, section: e.target.value, department: '', group_name: '', line_id: null })}>
                      <option value="">— เลือก —</option>
                      {(scopeSecs.length ? orgSectionOpts.filter(s => inSectionScope(scopeSecs, s)) : orgSectionOpts)
                        .map(s => <option key={s} value={s}>{s}</option>)}
                      {!scopeSecs.length && orphanDepts(orgDeptNodes).length > 0 && (
                        <option value={ORPHAN_SECTION}>{ORPHAN_SECTION_LABEL}</option>
                      )}
                    </select>
                  )}
                </div>
                <div>
                  <label style={labelSt}>Department / แผนก</label>
                  {(() => {
                    const empSection = lockedScopeSec
                      || sectionValueForEdit(editingEmp.section, editingEmp.department, orgDeptNodes, orgSectionNodes);
                    const deptOpts = deptOptionsFor(empSection, orgSectionNodes, orgDeptNodes);
                    return (
                      <>
                        <select value={editingEmp.department || ''} disabled={!empSection}
                          onChange={e => setEditingEmp({ ...editingEmp, department: e.target.value, group_name: '', line_id: null })}>
                          <option value="">{empSection ? '— เลือก —' : 'เลือก Section ก่อน'}</option>
                          {deptOpts.map(d => <option key={d.id} value={d.code || d.name}>{d.name}</option>)}
                        </select>
                        {empSection === ORPHAN_SECTION && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
                            หน่วยงานขึ้นตรงฝ่าย — ไม่มี Section · Group/Line เว้นว่างได้
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              <div>
                <label style={labelSt}>วันเริ่มงาน</label>
                <input type="date" value={editingEmp.start_date || ''}
                  onChange={e => setEditingEmp({ ...editingEmp, start_date: e.target.value })} />
              </div>

              <div>
                <label style={labelSt}>Team / กะ</label>
                <select value={editingEmp.team || ''} onChange={e => setEditingEmp({ ...editingEmp, team: e.target.value })}>
                  <option value="">— เลือก —</option>
                  <option value="A">Team A (กะเช้า)</option>
                  <option value="B">Team B (กะดึก)</option>
                  <option value="C">Team C (ไม่มีพันธะกะ)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>Group / กลุ่ม (Line)</label>
                {isLeader ? (
                  <input type="text" value={editingEmp.group_name || myLineName || ''} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                ) : (() => {
                  // cascade จากผังองค์กร: กลุ่ม (org_nodes kind='line') ใต้แผนกที่เลือก — ตั้ง line_id ผ่าน ref_line_id ให้ production ยังทำงาน
                  const empSection = lockedScopeSec
                    || sectionValueForEdit(editingEmp.section, editingEmp.department, orgDeptNodes, orgSectionNodes);
                  const depNode = deptNodeFor(empSection, editingEmp.department, orgSectionNodes, orgDeptNodes);
                  const orgGroups = depNode ? orgLineNodes.filter(g => g.parent_id === depNode.id) : [];
                  const cur = editingEmp.group_name || '';
                  // เก็บ "ชื่อกลุ่ม" ไม่ใช่ code — code ของ kind='line' เป็นเลขไลน์ ('9','12') ซึ่งไม่สื่อความหมาย
                  // และไม่ตรงกับข้อมูลเดิมเกือบทั้งหมดที่เก็บชื่อไว้ · เทียบค่าปัจจุบันยอมรับทั้งชื่อและ code
                  const sameGroup = (g, v) => g.name === v || (g.code && g.code === v);
                  const curInOrg = orgGroups.some(g => sameGroup(g, cur));
                  if (orgGroups.length) {
                    return (
                      <select value={curInOrg ? (orgGroups.find(g => sameGroup(g, cur))?.name ?? cur) : cur}
                        disabled={!editingEmp.department} onChange={e => {
                        const val = e.target.value;
                        const g = orgGroups.find(x => sameGroup(x, val));
                        // เลือกกลุ่มในผัง → line_id จาก ref_line_id · เลือกค่าเดิม (นอกผัง) → คง line_id เดิม
                        setEditingEmp({ ...editingEmp, group_name: val, line_id: g ? (g.ref_line_id || null) : editingEmp.line_id });
                      }}>
                        <option value="">{editingEmp.department ? '— เลือกกลุ่ม —' : 'เลือกแผนกก่อน'}</option>
                        {orgGroups.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
                        {cur && !curInOrg && <option value={cur}>{cur} (นอกผัง — ค่าเดิม)</option>}
                      </select>
                    );
                  }
                  // fallback: ผังยังไม่มีกลุ่มใต้แผนกนี้ → ใช้ production_lines เดิม (normalize + fail-open)
                  return (
                    <select value={cur} disabled={!editingEmp.department} onChange={e => {
                      const val = e.target.value;
                      const line = lines.find(l => l.name === val);
                      setEditingEmp({ ...editingEmp, group_name: val, line_id: line?.id || null });
                    }}>
                      <option value="">{editingEmp.department ? '— เลือก Line —' : 'เลือกแผนกก่อน'}</option>
                      {filterLinesByDept(
                        (scopeSecs.length ? lines.filter(l => inSectionScope(scopeSecs, l.section)) : lines)
                          // แผนกขึ้นตรงฝ่ายไม่มี section ให้กรอง — ปล่อยให้ filterLinesByDept คัดตามแผนกอย่างเดียว
                          .filter(l => empSection === ORPHAN_SECTION || !empSection || l.section === empSection),
                        editingEmp.department
                      ).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    </select>
                  );
                })()}
              </div>

              <div>
                <label style={labelSt}>🚐 สายรถรับส่ง (สำหรับจองรถ OT)</label>
                <select value={editingEmp.bus_route_id || ''} onChange={e => setEditingEmp({ ...editingEmp, bus_route_id: e.target.value || null })}>
                  <option value="">— ไม่ระบุ —</option>
                  {busRoutes.map(r => <option key={r.id} value={r.id}>{r.code} {r.name}</option>)}
                </select>
              </div>

              </div>

              <div style={{ background: 'var(--bg2)', padding: 14, borderRadius: 10 }}>
                <label style={{ ...labelSt, marginBottom: 12, display: 'block' }}>📊 ระดับทักษะ</label>
                {(() => {
                  // ในโมดัลแก้ไขพนักงานโชว์แค่ชื่อหมวด (ไม่เอา desc — พื้นที่แน่นอยู่แล้ว)
                  const grouped = Object.entries(SKILL_CAT_META_FULL).map(([k, m]) => ({
                    key: k, ...m, desc: null, skills: skillDefs.filter(sd => (sd.category || 'hard_skill') === k),
                  })).filter(g => g.skills.length > 0);
                  return grouped.map(g => (
                    <div key={g.key} style={{ marginBottom: 14 }}>
                      <div style={{ marginBottom: 6, display: 'flex', alignItems: 'baseline', gap: 7 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{g.icon} {g.label}</span>
                        {g.desc && <span style={{ fontSize: 11, color: g.color, opacity: 0.7 }}>{g.desc}</span>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 8 }}>
                        {g.skills.map(sd => {
                          const enabled = editingEmp.skillEnabled?.[sd.name] ?? false;
                          const score = Number(editingEmp.skillScores?.[sd.name] ?? 0);
                          const lv = enabled ? getLevel(score) : null;
                          const pending = editingEmp.employee_skills?.find(s => s.skill_name === sd.name)?.pending_level;
                          return (
                            <div key={sd.name} style={{ background: enabled ? 'var(--bg3)' : 'var(--bg2)', borderRadius: 8, padding: '8px 10px', border: `1px solid ${pending ? '#f59e0b55' : enabled ? 'var(--border)' : 'var(--border2)'}`, opacity: enabled ? 1 : 0.6 }}>
                              {/* Toggle: มีทักษะนี้ */}
                              <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, cursor: 'pointer' }}>
                                <input type="checkbox" checked={enabled}
                                  onChange={e => setEditingEmp({
                                    ...editingEmp,
                                    skillEnabled: { ...editingEmp.skillEnabled, [sd.name]: e.target.checked },
                                  })}
                                  style={{ width: 14, height: 14, cursor: 'pointer' }} />
                                <span style={{ fontSize: 11, fontWeight: 600, color: enabled ? sd.color : 'var(--muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {sd.label}
                                  {sd.scope_section && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {sd.scope_section}</span>}
                                </span>
                                {enabled && lv && (
                                  <span style={{ background: lv.bg, color: lv.color, borderRadius: 4, padding: '1px 5px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                    {lv.label}
                                  </span>
                                )}
                                {!enabled && (
                                  <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>N/A</span>
                                )}
                              </label>
                              {enabled && g.key === 'allowance_skill' ? (
                                <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, textAlign: 'center', padding: '4px 0' }}>✓ มีใบเซอร์</div>
                              ) : enabled ? (
                                <input type="number" value={score}
                                  onChange={e => setEditingEmp({
                                    ...editingEmp,
                                    skillScores: { ...editingEmp.skillScores, [sd.name]: e.target.value },
                                  })}
                                  min={0} max={100}
                                  style={{ width: '100%', boxSizing: 'border-box' }} />
                              ) : (
                                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '4px 0' }}>ไม่เกี่ยวข้อง</div>
                              )}
                              {pending && (
                                <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginTop: 3 }}>⏳ รอ approve Lv.{pending}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>

              <div>
                <label style={labelSt}>อัปเดตรูปถ่าย</label>
                <input type="file" accept="image/*"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) setEmpCropFile(f);
                  }} />
              </div>
              {empCropFile && (
                <ImageCropModal file={empCropFile} aspect={1} shape="circle" outputSize={480}
                  title="จัดตำแหน่งรูปพนักงานให้ตรงกรอบ"
                  onCancel={() => setEmpCropFile(null)}
                  onConfirm={f => { setEditingEmp(prev => ({ ...prev, newPhoto: f })); setEmpCropFile(null); }} />
              )}

              <div className="m2c-span" style={{ display: 'flex', gap: 10, marginTop: 8 }}>
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

/* ── หัวข้อการพิจารณา (sub-items) ต่อสกิล — ใช้ในใบประเมินรายบุคคล (F-PRS-P1-119) ──
   Hybrid: ข้อความหัวข้อมาจากที่นี่ · ค่าติ๊ก 4 ระดับ derive จากคะแนนสกิลตอน export ใน Report */
function SkillSubItemsModal({ skill, onClose }) {
  const { role } = useContext(UserContext);
  const canEdit = can('skills', 'edit', role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newWi, setNewWi] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('skill_sub_items')
      .select('*').eq('skill_name', skill.name).order('seq');
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [skill.name]);

  const addItem = async () => {
    const label = newLabel.trim();
    if (!label) { toast.error('กรุณาระบุหัวข้อ'); return; }
    setSaving(true);
    const nextSeq = (rows.reduce((m, r) => Math.max(m, r.seq || 0), 0)) + 1;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('skill_sub_items').insert([{
      skill_name: skill.name, seq: nextSeq, label, wi_ref: newWi.trim() || null, created_by: user?.id || null,
    }]);
    setSaving(false);
    if (error) { toast.error('เพิ่มไม่สำเร็จ: ' + error.message); return; }
    setNewLabel(''); setNewWi(''); load();
  };

  const delItem = async (id) => {
    if (!window.confirm('ลบหัวข้อนี้?')) return;
    const { error } = await supabase.from('skill_sub_items').delete().eq('id', id);
    if (error) { toast.error('ลบไม่สำเร็จ: ' + error.message); return; }
    load();
  };

  const move = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const a = rows[idx], b = rows[j];
    // สลับ seq สองแถว
    await supabase.from('skill_sub_items').update({ seq: b.seq }).eq('id', a.id);
    await supabase.from('skill_sub_items').update({ seq: a.seq }).eq('id', b.id);
    load();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ width: 'min(560px, 96vw)', maxHeight: '88vh', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>📝 หัวข้อการพิจารณา</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: skill.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>{skill.label}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>ใช้ในใบประเมินทักษะรายบุคคล</span>
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>กำลังโหลด...</div>
        ) : (
          <>
            {rows.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0 12px' }}>
                ยังไม่มีหัวข้อย่อย — ใบประเมินจะแสดง 1 แถว = ชื่อสกิลนี้ · เพิ่มหัวข้อเพื่อให้ตรงฟอร์มกระดาษ
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {rows.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg3)', borderRadius: 7, padding: '7px 10px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', width: 18, textAlign: 'center' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{r.label}</div>
                    {r.wi_ref && <div style={{ fontSize: 11, color: 'var(--muted)' }}>อ้างอิง: {r.wi_ref}</div>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: i === 0 ? 'default' : 'pointer', fontSize: 13, opacity: i === 0 ? 0.3 : 1, padding: '2px 4px' }}>▲</button>
                      <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: i === rows.length - 1 ? 'default' : 'pointer', fontSize: 13, opacity: i === rows.length - 1 ? 0.3 : 1, padding: '2px 4px' }}>▼</button>
                      <button onClick={() => delItem(r.id)} className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}>🗑️</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {canEdit && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>➕ เพิ่มหัวข้อ</div>
                <input placeholder="หัวข้อการพิจารณา เช่น วางแผนการผลิต (plan production)" value={newLabel}
                  onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()}
                  style={{ marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="อ้างอิง WI (ไม่บังคับ) เช่น WI-PD4-001" value={newWi}
                    onChange={e => setNewWi(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()}
                    style={{ flex: 1 }} />
                  <button onClick={addItem} disabled={saving} style={{ padding: '8px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none', flexShrink: 0, opacity: saving ? 0.6 : 1 }}>
                    {saving ? '...' : 'เพิ่ม'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
