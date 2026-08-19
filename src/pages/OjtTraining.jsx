import { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { inSectionScope, ORPHAN_SECTION, ORPHAN_SECTION_LABEL, deptOptionsFor, orphanDepts, sectionValueForSave, sectionValueForEdit } from '../utils/sectionScope';
import { getLineFamilyIds } from '../utils/lineHierarchy';
import tsLogoUrl from '../assets/TS logo.png';
import { getDocForm, docFormSync, loadDocForms, fullCode } from '../utils/docForms';

/* ══════════════════════════════════════════════════════════════
   📖 OJT Training — ใบแจ้งการอบรมสอนงานโดยหัวหน้างาน (ON THE JOB TRAINING)
   Paperless ของฟอร์มกระดาษ FM-HRM-004: บันทึกการอบรมในระบบ + พนักงานเซ็นชื่อบนจอ
   + export PDF layout ตามฟอร์มจริง (window.open + print — pattern เดียวกับ FM-JIG-008)
   ตาราง: ojt_trainings + ojt_training_attendees (Main) — migration 20260714_ojt_training.sql
   ลายเซ็นพนักงาน: bucket `signatures` โฟลเดอร์ของ user ที่ login (ตาม RLS own-folder)
   ══════════════════════════════════════════════════════════════ */

const FORM_NO = 'FM-HRM-004';
const SCORE_LABELS = ['0', '1', '2', '3', '4'];
const DEFAULT_SCOPE = `- รู้ความสำคัญของเอกสารแต่ละประเภท
- รู้วัตถุประสงค์ของเอกสารที่ใช้ในไลน์ผลิต
- เข้าใจเนื้อหาของเอกสารที่ใช้ในไลน์ผลิต
- สามารถอธิบายเอกสารได้อย่างถูกต้อง
- สามารถลงบันทึกเอกสารได้อย่างถูกต้อง`;

const thDate = (d) => {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return `${dd}/${m}/${y + 543}`;
};

async function urlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/* ── แผ่นเซ็นชื่อ (canvas → PNG blob) — พนักงานเซ็นบนจอ/แท็บเล็ต ── */
function SignPadModal({ title, onCancel, onDone }) {
  const cvRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const dirty = useRef(false);

  useEffect(() => {
    const c = cvRef.current;
    if (c) { const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  }, []);

  const pos = (e) => { const c = cvRef.current, r = c.getBoundingClientRect(), t = e.touches?.[0] || e; return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) }; };
  const down = (e) => { e.preventDefault(); drawing.current = true; last.current = pos(e); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const c = cvRef.current, ctx = c.getContext('2d'), p = pos(e); ctx.strokeStyle = '#111'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last.current = p; dirty.current = true; };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = cvRef.current, ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); dirty.current = false; };

  const done = () => {
    if (!dirty.current) { toast.error('ยังไม่ได้เซ็น'); return; }
    cvRef.current.toBlob(b => b && onDone(b), 'image/png');
  };

  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 620px)' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>✍️ {title}</div>
        <canvas ref={cvRef} width={560} height={180} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
          style={{ width: '100%', height: 160, border: '1px dashed var(--border2)', borderRadius: 10, background: '#fff', touchAction: 'none', cursor: 'crosshair', display: 'block' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={clear} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>🗑️ ล้าง</button>
          <button onClick={onCancel} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
          <button onClick={done} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>✔ ใช้ลายเซ็นนี้</button>
        </div>
      </div>
    </div>
  );
}

export default function OjtTraining() {
  const { role, lineId: userLineId, sections: scopeSecs = [], fullName } = useContext(UserContext);
  const canRecord = can('ojt', 'record', role);
  const canDelete = can('ojt', 'delete', role);

  const [trainings, setTrainings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [lines, setLines] = useState([]);
  const [orgSections, setOrgSections] = useState([]);
  const [orgSectionNodes, setOrgSectionNodes] = useState([]);
  const [orgDeptNodes, setOrgDeptNodes] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [editing, setEditing] = useState(null);   // training draft (มี attendees[])
  const [saving, setSaving] = useState(false);
  const [signTarget, setSignTarget] = useState(null); // { idx, title } — แถวที่กำลังเซ็น
  const [empSearch, setEmpSearch] = useState('');
  const [printing, setPrinting] = useState(null);
  const [docReady, setDocReady] = useState(false); // ทะเบียนเอกสารโหลดแล้ว → subtitle ดึงเลขฟอร์มจาก registry
  const ojtFormNo = (docReady ? docFormSync('ojt', { form_code: FORM_NO }).form_code : FORM_NO) || FORM_NO;

  /* ── scope มาตรฐาน: leader → section ของไลน์ตัวเอง · role อื่นตาม sections ── */
  const leaderLine = useMemo(() => lines.find(l => String(l.id) === String(userLineId)), [lines, userLineId]);
  const effSections = useMemo(() => {
    if (role === 'leader' && userLineId) return leaderLine?.section ? [leaderLine.section] : [];
    return scopeSecs;
  }, [role, userLineId, leaderLine, scopeSecs]);

  const load = async () => {
    setLoading(true);
    const [{ data: tr }, { data: ln }, { data: org }, { data: profs }] = await Promise.all([
      supabase.from('ojt_trainings').select('*, ojt_training_attendees(id)').order('train_date', { ascending: false }).order('created_at', { ascending: false }).limit(300),
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabase.from('org_nodes').select('id, code, name, kind, parent_id').eq('is_active', true).order('sort_order'),
      supabase.from('profiles').select('id, full_name, signature_url').order('full_name'),
    ]);
    setLines(ln || []);
    // ลำดับตามผัง (query .order('sort_order') แล้ว) — ห้าม .sort() ตัวอักษรทับ (QC audit 2026-08-18)
    setOrgSections((org || []).filter(n => n.kind === 'section').map(n => n.code || n.name));
    setOrgSectionNodes((org || []).filter(n => n.kind === 'section'));
    setOrgDeptNodes((org || []).filter(n => n.kind === 'department'));
    setProfiles(profs || []);
    setTrainings(tr || []);
    setLoading(false);
  };
  useEffect(() => { load(); loadDocForms().then(() => setDocReady(true)); }, []);

  // พนักงานสำหรับ picker — scope: leader = ครอบครัวไลน์ตัวเอง · role อื่นตาม sections
  useEffect(() => {
    if (!lines.length && role === 'leader') return;
    let q = supabase.from('employees').select('id, name, employee_id_code, section, line_id, team').eq('is_active', true).order('employee_id_code');
    if (role === 'leader' && userLineId) {
      const fam = [...getLineFamilyIds(lines, Number(userLineId) || userLineId)];
      q = q.in('line_id', fam.length ? fam : [userLineId]);
    } else if (scopeSecs.length) {
      q = q.in('section', scopeSecs);
    }
    q.then(({ data }) => setEmployees(data || []));
  }, [lines, role, userLineId, scopeSecs]);

  // mandatory scope ก่อนแสดงรายการ (แบบเดียวกับหน้าอื่น) — leader/scoped เห็นเฉพาะ section ตัวเอง
  const visibleTrainings = useMemo(() => trainings.filter(t => {
    if (role === 'leader' && userLineId) {
      return !effSections.length || inSectionScope(effSections, t.section) || t.created_by_name === fullName;
    }
    if (scopeSecs.length) return inSectionScope(scopeSecs, t.section);
    return true;
  }), [trainings, role, userLineId, effSections, scopeSecs, fullName]);

  const emptyDraft = () => ({
    id: crypto.randomUUID(),
    isNew: true,
    train_date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(),
    time_from: '', time_to: '', location: '', duration_min: 30,
    dept: 'Production',
    section: effSections[0] || '',
    department: leaderLine?.parent_line_name || leaderLine?.name || '',
    for_new: false, for_review: false, for_method_change: false,
    topic: '', scope: DEFAULT_SCOPE,
    trainer_name: fullName || '',
    maker_name: fullName || '', maker_sig_url: null,
    approver_name: '', approver_sig_url: null,
    hr_name: '', hr_sig_url: null,
    status: 'open',
    attendees: [],
  });

  const openEdit = async (t) => {
    const { data: att } = await supabase.from('ojt_training_attendees').select('*').eq('training_id', t.id).order('sort_order');
    // ใบเก่าที่ section ว่างแต่มีแผนกขึ้นตรงฝ่าย → โชว์เป็น sentinel ให้แก้ต่อได้ (pattern Register 2026-08-06)
    setEditing({ ...t, isNew: false, attendees: att || [],
      section: sectionValueForEdit(t.section, t.department, orgDeptNodes, orgSectionNodes) });
  };

  const setF = (k, v) => setEditing(prev => ({ ...prev, [k]: v }));
  const setAtt = (idx, k, v) => setEditing(prev => ({ ...prev, attendees: prev.attendees.map((a, i) => i === idx ? { ...a, [k]: v } : a) }));

  const addEmployee = (emp) => {
    setEditing(prev => {
      if (prev.attendees.some(a => a.employee_id === emp.id)) { toast.info('พนักงานคนนี้อยู่ในรายชื่อแล้ว'); return prev; }
      return {
        ...prev,
        attendees: [...prev.attendees, {
          employee_id: emp.id, emp_code: emp.employee_id_code, emp_name: emp.name,
          pre_score: null, post_score: null, sign_url: null, eval_agree: true,
          evaluator_name: prev.trainer_name || fullName || '',
        }],
      };
    });
    setEmpSearch('');
  };

  const removeAttendee = (idx) => setEditing(prev => ({ ...prev, attendees: prev.attendees.filter((_, i) => i !== idx) }));

  const handleSignDone = async (blob) => {
    const { idx } = signTarget;
    setSignTarget(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) { toast.error('เซสชันหมดอายุ — กรุณา login ใหม่'); return; }
      // path ต้องอยู่ในโฟลเดอร์ auth.uid ของคนบันทึก (RLS bucket signatures) — ชื่อไฟล์กันชนด้วย timestamp
      const path = `${user.id}/ojt_${editing.id}_${idx}_${Date.now()}.png`;
      const { error } = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png' });
      if (error) { toast.error('อัปโหลดลายเซ็นไม่สำเร็จ: ' + error.message); return; }
      const url = supabase.storage.from('signatures').getPublicUrl(path).data.publicUrl;
      // เซ็นทับของเดิม — ลบไฟล์เก่าทิ้ง (best-effort, เฉพาะโฟลเดอร์ตัวเอง)
      const old = editing.attendees[idx]?.sign_url;
      if (old?.includes('/signatures/')) {
        const oldPath = decodeURIComponent(old.split('/signatures/')[1] || '').split('?')[0];
        if (oldPath.startsWith(`${user.id}/`)) supabase.storage.from('signatures').remove([oldPath]).catch(() => {});
      }
      setAtt(idx, 'sign_url', url);
      toast.success('บันทึกลายเซ็นแล้ว');
    } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + e.message); }
  };

  const handleSave = async () => {
    if (!editing.train_date) { toast.error('เลือกวันที่อบรม'); return; }
    if (!editing.topic?.trim()) { toast.error('กรอกหัวข้อที่สอน'); return; }
    if (!editing.attendees.length) { toast.error('เพิ่มพนักงานอย่างน้อย 1 คน'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        id: editing.id,
        train_date: editing.train_date, time_from: editing.time_from || null, time_to: editing.time_to || null,
        location: editing.location || null, duration_min: editing.duration_min ? Number(editing.duration_min) : null,
        dept: editing.dept || null, section: sectionValueForSave(editing.section), department: editing.department || null,
        for_new: !!editing.for_new, for_review: !!editing.for_review, for_method_change: !!editing.for_method_change,
        topic: editing.topic || null, scope: editing.scope || null, trainer_name: editing.trainer_name || null,
        maker_name: editing.maker_name || null, maker_sig_url: editing.maker_sig_url || null,
        approver_name: editing.approver_name || null, approver_sig_url: editing.approver_sig_url || null,
        hr_name: editing.hr_name || null, hr_sig_url: editing.hr_sig_url || null,
        status: editing.status || 'open',
        updated_at: new Date().toISOString(),
        ...(editing.isNew ? { created_by: user?.id || null, created_by_name: fullName || null } : {}),
      };
      const { error } = await supabase.from('ojt_trainings').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      // attendees: ล้างของเดิมแล้ว insert ชุดปัจจุบัน (จำนวนน้อย — ง่ายและ sort_order ตรงตามหน้าจอเสมอ)
      const { error: delErr } = await supabase.from('ojt_training_attendees').delete().eq('training_id', editing.id);
      if (delErr) throw delErr;
      const { error: insErr } = await supabase.from('ojt_training_attendees').insert(
        editing.attendees.map((a, i) => ({
          training_id: editing.id, employee_id: a.employee_id || null,
          emp_code: a.emp_code || null, emp_name: a.emp_name || null,
          pre_score: a.pre_score === null || a.pre_score === '' ? null : Number(a.pre_score),
          post_score: a.post_score === null || a.post_score === '' ? null : Number(a.post_score),
          sign_url: a.sign_url || null, eval_agree: a.eval_agree === null ? null : !!a.eval_agree,
          evaluator_name: a.evaluator_name || null, sort_order: i,
        }))
      );
      if (insErr) throw insErr;
      toast.success('บันทึกใบอบรม OJT เรียบร้อย');
      setEditing(null);
      load();
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ: ' + e.message);
    } finally { setSaving(false); }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`ลบใบอบรม "${t.topic || thDate(t.train_date)}" ? (รายชื่อ+ลายเซ็นพนักงานในใบนี้จะถูกลบด้วย)`)) return;
    const { data: att } = await supabase.from('ojt_training_attendees').select('sign_url').eq('training_id', t.id);
    const { error } = await supabase.from('ojt_trainings').delete().eq('id', t.id);
    if (error) { toast.error('ลบไม่สำเร็จ: ' + error.message); return; }
    // ลบไฟล์ลายเซ็นของใบนี้ (best-effort หลัง DB delete สำเร็จ — กฎ storage)
    const { data: { user } } = await supabase.auth.getUser();
    const paths = (att || []).map(a => a.sign_url).filter(u => u?.includes('/signatures/'))
      .map(u => decodeURIComponent(u.split('/signatures/')[1] || '').split('?')[0])
      .filter(p => user?.id && p.startsWith(`${user.id}/`));
    if (paths.length) supabase.storage.from('signatures').remove(paths).catch(() => {});
    toast.success('ลบแล้ว');
    load();
  };

  /* ── Export PDF — layout ตามฟอร์มกระดาษ FM-HRM-004 (A4 แนวนอน) ── */
  const handlePrint = async (t) => {
    setPrinting(t.id);
    try {
      // เลขฟอร์ม/Rev/ช่องลายเซ็น จากทะเบียนเอกสาร (/doc-forms) — fallback ค่าเดิม
      const df = await getDocForm('ojt', { form_code: FORM_NO, sig_blocks: ['ผู้จัดทำ', 'ระดับจัดการอนุมัติ', 'ผู้รับทราบ'] });
      const sigLabels = df.sig_blocks;
      const { data: att } = await supabase.from('ojt_training_attendees').select('*').eq('training_id', t.id).order('sort_order');
      const rows = att || [];
      const [logo, makerSig, apprSig, hrSig, ...attSigs] = await Promise.all([
        urlToDataUrl(df.logo_url || tsLogoUrl), urlToDataUrl(t.maker_sig_url), urlToDataUrl(t.approver_sig_url), urlToDataUrl(t.hr_sig_url),
        ...rows.map(r => urlToDataUrl(r.sign_url)),
      ]);
      const cb = (v) => `<span style="display:inline-block;width:11px;height:11px;border:1px solid #000;text-align:center;line-height:10px;font-size:10px;vertical-align:middle">${v ? '✓' : '&nbsp;'}</span>`;
      const tick = (v) => v ? '✓' : '';
      const scoreCells = (score) => SCORE_LABELS.map((_, i) =>
        `<td style="border:1px solid #000;width:16px;text-align:center;font-size:10px">${score === i ? '✓' : ''}</td>`).join('');
      const MIN_ROWS = Math.max(rows.length, 15);
      const bodyRows = Array.from({ length: MIN_ROWS }, (_, i) => {
        const r = rows[i];
        if (!r) return `<tr><td style="border:1px solid #000;height:20px"></td><td style="border:1px solid #000"></td>${SCORE_LABELS.map(() => '<td style="border:1px solid #000"></td>').join('')}${SCORE_LABELS.map(() => '<td style="border:1px solid #000"></td>').join('')}<td style="border:1px solid #000"></td><td style="border:1px solid #000"></td><td style="border:1px solid #000"></td></tr>`;
        return `<tr>
          <td style="border:1px solid #000;padding:1px 4px;font-size:10px;height:20px;white-space:nowrap">${i + 1}. ${r.emp_name || ''}</td>
          <td style="border:1px solid #000;text-align:center;font-size:10px;white-space:nowrap">${r.emp_code || ''}</td>
          ${scoreCells(r.pre_score)}
          ${scoreCells(r.post_score)}
          <td style="border:1px solid #000;text-align:center;padding:0">${attSigs[i] ? `<img src="${attSigs[i]}" style="height:18px;max-width:80px;object-fit:contain"/>` : ''}</td>
          <td style="border:1px solid #000;text-align:center;font-size:11px">${tick(r.eval_agree === true)}</td>
          <td style="border:1px solid #000;text-align:center;font-size:11px">${tick(r.eval_agree === false)}</td>
        </tr>`;
      }).join('');
      const evaluators = [...new Set(rows.map(r => r.evaluator_name).filter(Boolean))].join(', ');
      const scopeHtml = (t.scope || '').split('\n').map(l => `<div>${l}</div>`).join('');
      const topicHtml = (t.topic || '').split('\n').map(l => `<div>${l}</div>`).join('');

      const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
<title>ใบแจ้งการอบรมสอนงาน OJT ${thDate(t.train_date)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff}
table{border-collapse:collapse}
@media print{@page{size:A4 portrait;margin:7mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body style="padding:6mm">
<div style="font-size:9px;text-align:right">หน้า 1 ของ 1 หน้า</div>
<table style="width:100%;border:1px solid #000">
  <tr>
    <td style="border:1px solid #000;width:110px;text-align:center;vertical-align:middle;padding:4px">
      ${logo ? `<img src="${logo}" style="width:80px"/>` : '<b>TS AUTOMOTIVE</b>'}
    </td>
    <td style="border:1px solid #000;text-align:center;vertical-align:middle;padding:4px">
      <div style="font-size:15px;font-weight:bold">ใบแจ้งการอบรมสอนงานโดยหัวหน้างาน</div>
      <div style="font-size:13px;font-weight:bold">( ON THE JOB TRAINING )</div>
    </td>
    <td style="border:1px solid #000;width:130px;text-align:center;vertical-align:bottom;padding:4px;font-size:10px">
      ${makerSig ? `<img src="${makerSig}" style="height:26px;object-fit:contain"/>` : '<div style="height:26px"></div>'}
      <div>${sigLabels[0] || 'ผู้จัดทำ'}</div><div>(${t.maker_name || '....................'})</div>
    </td>
    <td style="border:1px solid #000;width:130px;text-align:center;vertical-align:bottom;padding:4px;font-size:10px">
      ${apprSig ? `<img src="${apprSig}" style="height:26px;object-fit:contain"/>` : '<div style="height:26px"></div>'}
      <div>${sigLabels[1] || 'ระดับจัดการอนุมัติ'}</div><div>(${t.approver_name || '....................'})</div>
    </td>
    <td style="border:1px solid #000;width:130px;text-align:center;vertical-align:bottom;padding:4px;font-size:10px">
      ${hrSig ? `<img src="${hrSig}" style="height:26px;object-fit:contain"/>` : '<div style="height:26px"></div>'}
      <div>${sigLabels[2] || 'ผู้รับทราบ'}</div><div>(${t.hr_name || '....................'})</div>
    </td>
  </tr>
  <tr>
    <td style="border:1px solid #000;padding:3px 6px" colspan="2">
      <div>ฝ่าย&nbsp;&nbsp;<b>${t.dept || ''}</b></div>
      <div>ส่วน&nbsp;&nbsp;<b>${t.section || ''}</b></div>
      <div>แผนก&nbsp;<b>${t.department || ''}</b></div>
    </td>
    <td style="border:1px solid #000;padding:3px 6px" colspan="2">
      <div>${cb(t.for_new)} สำหรับพนักงานใหม่ / เปลี่ยนงาน</div>
      <div>${cb(t.for_review)} สำหรับการทบทวน / อบรมซ้ำ</div>
      <div>${cb(t.for_method_change)} สำหรับการเปลี่ยนแปลงวิธีทำงาน</div>
    </td>
    <td style="border:1px solid #000;padding:3px 6px">
      <div>วันที่ <b>${thDate(t.train_date)}</b></div>
      <div>เวลา <b>${t.time_from || '.....'} - ${t.time_to || '.....'}</b> น.</div>
      <div>สถานที่ <b>${t.location || ''}</b></div>
    </td>
  </tr>
</table>

<table style="width:100%;border:1px solid #000;border-top:none">
  <tr style="background:#f0f0f0">
    <th style="border:1px solid #000;padding:2px;width:34%;font-size:10px">หัวข้อและรหัสเอกสารที่สอน</th>
    <th style="border:1px solid #000;padding:2px;width:18%;font-size:10px">ผู้สอนงาน</th>
    <th style="border:1px solid #000;padding:2px;width:12%;font-size:10px">ระยะเวลา</th>
    <th style="border:1px solid #000;padding:2px;font-size:10px">ขอบเขตเนื้อหา</th>
  </tr>
  <tr>
    <td style="border:1px solid #000;padding:3px 6px;vertical-align:top">${topicHtml}</td>
    <td style="border:1px solid #000;padding:3px 6px;text-align:center;vertical-align:middle">${t.trainer_name || ''}</td>
    <td style="border:1px solid #000;padding:3px 6px;text-align:center;vertical-align:middle">${t.duration_min ? `${t.duration_min} นาที` : ''}</td>
    <td style="border:1px solid #000;padding:3px 6px;vertical-align:top">${scopeHtml}</td>
  </tr>
</table>

<table style="width:100%;border:1px solid #000;border-top:none;margin-top:0">
  <tr style="background:#f0f0f0;font-size:10px">
    <th rowspan="3" style="border:1px solid #000;padding:2px">รายชื่อพนักงาน</th>
    <th rowspan="3" style="border:1px solid #000;padding:2px;width:70px">เลขประจำตัว</th>
    <th colspan="10" style="border:1px solid #000;padding:2px">ความเข้าใจ</th>
    <th rowspan="3" style="border:1px solid #000;padding:2px;width:90px">พนักงานลงชื่อ</th>
    <th colspan="2" style="border:1px solid #000;padding:2px">ผลการประเมิน<br/>(ความเข้าใจ)</th>
  </tr>
  <tr style="background:#f0f0f0;font-size:10px">
    <th colspan="5" style="border:1px solid #000;padding:1px">ก่อนOJT</th>
    <th colspan="5" style="border:1px solid #000;padding:1px;background:#f7f3c8">หลังOJT</th>
    <th rowspan="2" style="border:1px solid #000;padding:1px;width:44px">เห็นด้วย</th>
    <th rowspan="2" style="border:1px solid #000;padding:1px;width:50px">ไม่เห็นด้วย</th>
  </tr>
  <tr style="background:#f0f0f0;font-size:9px">
    ${SCORE_LABELS.map(sl => `<th style="border:1px solid #000;width:16px">${sl}</th>`).join('')}
    ${SCORE_LABELS.map(sl => `<th style="border:1px solid #000;width:16px;background:#f7f3c8">${sl}</th>`).join('')}
  </tr>
  ${bodyRows}
</table>
<div style="border:1px solid #000;border-top:none;padding:2px 6px;font-size:10px">
  ผู้ประเมิน (โดยหัวหน้าหรือผู้สอน): <b>${evaluators || t.trainer_name || ''}</b>
</div>

<div style="margin-top:4px;font-size:9px;line-height:1.55">
  <b><u>คำชี้แจง</u></b> 1. กำหนดให้ผู้บังคับบัญชาหรือผู้ที่ได้รับมอบหมายเป็นผู้ทำการอบรมสอนงาน On The Job Training กรณีเริ่มงานใหม่
  เปลี่ยนหน้าที่ เปลี่ยนวิธีทำงาน ตามเอกสารระบบคุณภาพ คือ Quality Manual (QM), System Procedure (SP), Q.C. Flow Chart, Work Instruction (WI), Flow Process Chart (FPC),
  Operation Procedure Standard (OPS), Inspection Standard (IS) และแบบฟอร์มบันทึกต่างๆ เป็นต้น<br/>
  2. พนักงานประเมินเปรียบเทียบความรู้ความเข้าใจของตนเองก่อนและหลังการอบรมโดยมีเกณฑ์คะแนนดังนี้
  &nbsp;&nbsp;- 0 หมายถึง ผลประเมิน 0% พนักงานไม่มีความรู้และไม่เคยปฏิบัติ
  &nbsp;&nbsp;- 1 หมายถึง ผลประเมิน 1-25% พนักงานมีความรู้แต่ไม่เคยปฏิบัติ
  &nbsp;&nbsp;- 2 หมายถึง ผลประเมิน 26-50% พนักงานสามารถปฏิบัติงานได้แต่ยังต้องมีผู้คอยแนะนำ<br/>
  &nbsp;&nbsp;- 3 หมายถึง ผลประเมิน 51-75% พนักงานมีความสามารถทำงานได้ด้วยตนเองตามมาตรฐาน
  &nbsp;&nbsp;- 4 หมายถึง ผลประเมิน 76-100% พนักงานมีความสามารถทำงานได้ด้วยตนเองในระดับดีมากและสามารถสอนผู้อื่นได้<br/>
  3. หัวหน้างานหรือผู้สอนประเมินผู้เข้ารับการอบรมด้วยความเห็นด้วย หรือไม่เห็นด้วย กับผลการประเมินของพนักงาน กรณีไม่เห็นด้วยให้ชี้แจงกับพนักงานเป็นรายบุคคลและวัดผลการปฏิบัติงาน<br/>
  4. กำหนดให้มีการทวนสอบภาคทฤษฎีและปฏิบัติหลังการอบรมสอนงานไม่น้อยกว่า 1 เดือนหลังจากการอบรม 1 ฉบับ
</div>
<div style="margin-top:2px;font-size:9px;display:flex;justify-content:space-between"><span>${fullCode(df)}${df.footer_note ? " · " + df.footer_note : ""}</span><span>${df.effective_date ? "Effective Date : " + df.effective_date : ""}</span></div>
<script>window.onload = () => window.print();</script>
</body></html>`;
      const w = window.open('', '_blank');
      if (!w) { toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup แล้วลองใหม่'); return; }
      w.document.write(html);
      w.document.close();
    } finally { setPrinting(null); }
  };

  /* ── profile picker สำหรับช่องลายเซ็นหัวเอกสาร ── */
  const SigPicker = ({ label, nameKey, sigKey }) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <select value={editing[nameKey] || ''} onChange={e => {
        const p = profiles.find(x => x.full_name === e.target.value);
        setF(nameKey, e.target.value);
        setF(sigKey, p?.signature_url || null);
      }} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
        <option value="">— เลือก —</option>
        {profiles.filter(p => p.full_name).map(p => <option key={p.id} value={p.full_name}>{p.full_name}{p.signature_url ? ' ✍️' : ''}</option>)}
      </select>
      {editing[sigKey] && <img src={editing[sigKey]} alt="" style={{ height: 30, marginTop: 4, background: '#fff', borderRadius: 4, padding: 2 }} />}
    </div>
  );

  const scoreSelect = (val, onChange) => (
    <select value={val === null || val === undefined ? '' : val} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      style={{ width: 'auto', padding: '4px 6px', borderRadius: 6, fontSize: 12 }}>
      <option value="">—</option>
      {SCORE_LABELS.map((s, i) => <option key={s} value={i}>{s}</option>)}
    </select>
  );

  const searchResults = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return [];
    return employees.filter(e => (e.name || '').toLowerCase().includes(q) || (e.employee_id_code || '').toLowerCase().includes(q)).slice(0, 8);
  }, [empSearch, employees]);

  return (
    <div className="page-content">
      {/* paddingRight: 52 = เว้นที่ให้ 🔔 (fixed top-right) ไม่ทับปุ่ม ➕ สร้างใบอบรม */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10, paddingRight: 52 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>📖 อบรมสอนงาน OJT</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>ใบแจ้งการอบรมสอนงานโดยหัวหน้างาน (ON THE JOB TRAINING) — paperless แทนฟอร์ม {ojtFormNo}</div>
        </div>
        {canRecord && (
          <button onClick={() => setEditing(emptyDraft())}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            ➕ สร้างใบอบรม
          </button>
        )}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>กำลังโหลด...</div> : (
        <div className="card table-sticky" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 90 }}>วันที่</th>
                <th style={{ minWidth: 220, textAlign: 'left' }}>หัวข้อที่สอน</th>
                <th>ส่วน/แผนก</th>
                <th>ผู้สอน</th>
                <th style={{ textAlign: 'center' }}>ผู้เข้าอบรม</th>
                <th style={{ textAlign: 'center', minWidth: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {visibleTrainings.map(t => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{thDate(t.train_date)}</td>
                  <td style={{ fontSize: 13 }}>{(t.topic || '—').split('\n')[0]}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{[t.section, t.department].filter(Boolean).join(' / ') || '—'}</td>
                  <td style={{ fontSize: 12 }}>{t.trainer_name || '—'}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{t.ojt_training_attendees?.length ?? 0}</td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button onClick={() => handlePrint(t)} disabled={printing === t.id}
                      style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.35)', marginRight: 6 }}>
                      {printing === t.id ? '...' : '🖨️ PDF'}
                    </button>
                    {canRecord && (
                      <button onClick={() => openEdit(t)}
                        style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', marginRight: 6 }}>✏️</button>
                    )}
                    {canDelete && (
                      <button onClick={() => handleDelete(t)}
                        style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'transparent', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}>🗑</button>
                    )}
                  </td>
                </tr>
              ))}
              {visibleTrainings.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 30, fontSize: 13 }}>ยังไม่มีใบอบรม — กด "➕ สร้างใบอบรม" เพื่อเริ่ม</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── modal ฟอร์ม (มี input — ห้ามปิดจาก backdrop ตาม UI-CONVENTIONS §5) ── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '3vh 2vw' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: 'min(96vw, 1150px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>📖 {editing.isNew ? 'สร้าง' : 'แก้ไข'}ใบอบรมสอนงาน OJT</div>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* แถวข้อมูลหลัก */}
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <div><div style={lb}>วันที่อบรม</div><input type="date" value={editing.train_date} onChange={e => setF('train_date', e.target.value)} style={{ width: '100%' }} /></div>
                <div><div style={lb}>เวลาเริ่ม</div><input type="time" value={editing.time_from || ''} onChange={e => setF('time_from', e.target.value)} style={{ width: '100%' }} /></div>
                <div><div style={lb}>เวลาจบ</div><input type="time" value={editing.time_to || ''} onChange={e => setF('time_to', e.target.value)} style={{ width: '100%' }} /></div>
                <div><div style={lb}>ระยะเวลา (นาที)</div><input type="number" min="1" value={editing.duration_min || ''} onChange={e => setF('duration_min', e.target.value)} style={{ width: '100%' }} /></div>
                <div><div style={lb}>สถานที่</div><input type="text" value={editing.location || ''} onChange={e => setF('location', e.target.value)} style={{ width: '100%' }} /></div>
              </div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <div><div style={lb}>ฝ่าย</div><input type="text" value={editing.dept || ''} onChange={e => setF('dept', e.target.value)} style={{ width: '100%' }} /></div>
                <div>
                  <div style={lb}>ส่วน</div>
                  <select value={editing.section || ''} onChange={e => setEditing(p => ({ ...p, section: e.target.value, department: '' }))} style={{ width: '100%' }}>
                    <option value="">— เลือก —</option>
                    {(effSections.length ? orgSections.filter(s => inSectionScope(effSections, s)) : orgSections).map(s => <option key={s} value={s}>{s}</option>)}
                    {/* แผนกขึ้นตรงฝ่าย (MTN/JIG MTN/DIE MTN) — เดิม cascade เขียนเองทำให้ออกใบ OJT
                        ให้ช่างระบุแผนกไม่ได้เลย (QC audit 2026-08-18 · sentinel เห็นเฉพาะ user ไม่จำกัด scope) */}
                    {!effSections.length && orphanDepts(orgDeptNodes).length > 0 && (
                      <option value={ORPHAN_SECTION}>{ORPHAN_SECTION_LABEL}</option>
                    )}
                  </select>
                </div>
                <div>
                  <div style={lb}>แผนก</div>
                  {(() => {
                    // cascade ผ่าน helper กลาง (§5.3 ข้อ 7 — ห้ามเขียน parent_id cascade เองในหน้า
                    // เดิมเขียนเอง → แผนกขึ้นตรงฝ่ายไม่มีวันโผล่ · แก้ 2026-08-18)
                    const depOpts = deptOptionsFor(editing.section, orgSectionNodes, orgDeptNodes);
                    return (
                      <select value={editing.department || ''} disabled={!editing.section} onChange={e => setF('department', e.target.value)} style={{ width: '100%' }}>
                        <option value="">{editing.section ? '— เลือก —' : 'เลือกส่วนก่อน'}</option>
                        {depOpts.map(d => <option key={d.id} value={d.code || d.name}>{d.name}</option>)}
                        {editing.department && !depOpts.some(d => (d.code || d.name) === editing.department) && (
                          <option value={editing.department}>{editing.department} (นอกผัง — ค่าเดิม)</option>
                        )}
                      </select>
                    );
                  })()}
                </div>
                <div><div style={lb}>ผู้สอนงาน</div><input type="text" value={editing.trainer_name || ''} onChange={e => setF('trainer_name', e.target.value)} style={{ width: '100%' }} /></div>
              </div>

              {/* ประเภทการอบรม */}
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {[['for_new', 'สำหรับพนักงานใหม่ / เปลี่ยนงาน'], ['for_review', 'สำหรับการทบทวน / อบรมซ้ำ'], ['for_method_change', 'สำหรับการเปลี่ยนแปลงวิธีทำงาน']].map(([k, label]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!editing[k]} onChange={e => setF(k, e.target.checked)} style={{ width: 'auto', transform: 'scale(1.2)' }} />
                    {label}
                  </label>
                ))}
              </div>

              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={lb}>หัวข้อและรหัสเอกสารที่สอน (บรรทัดละหัวข้อ)</div>
                  <textarea rows={4} value={editing.topic || ''} onChange={e => setF('topic', e.target.value)}
                    placeholder={'1. ความรู้พื้นฐานของเอกสารในไลน์ผลิต\n2. ขั้นตอนการลงบันทึกข้อมูลของเอกสารในไลน์ผลิต'}
                    style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <div style={lb}>ขอบเขตเนื้อหา (บรรทัดละข้อ)</div>
                  <textarea rows={4} value={editing.scope || ''} onChange={e => setF('scope', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                </div>
              </div>

              {/* ผู้เข้าอบรม */}
              <div>
                <div style={{ ...lb, fontSize: 13, color: 'var(--text)' }}>👥 พนักงานผู้เข้าอบรม ({editing.attendees.length} คน)</div>
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <input type="text" placeholder="🔍 ค้นหาชื่อ/รหัสพนักงาน แล้วคลิกเพื่อเพิ่ม..." value={empSearch} onChange={e => setEmpSearch(e.target.value)}
                    style={{ width: 'min(100%, 380px)', padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
                  {searchResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 'min(100%, 380px)', maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                      {searchResults.map(e => (
                        <div key={e.id} onClick={() => addEmployee(e)}
                          style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>
                          <b>{e.employee_id_code}</b> · {e.name} <span style={{ color: 'var(--muted)', fontSize: 11 }}>({e.section || '-'})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 780 }}>
                    <thead>
                      <tr style={{ fontSize: 12 }}>
                        <th style={{ textAlign: 'left' }}>พนักงาน</th>
                        <th style={{ textAlign: 'center' }}>ก่อน OJT (0-4)</th>
                        <th style={{ textAlign: 'center' }}>หลัง OJT (0-4)</th>
                        <th style={{ textAlign: 'center' }}>ลายเซ็น</th>
                        <th style={{ textAlign: 'center' }}>ผลประเมิน</th>
                        <th style={{ textAlign: 'left' }}>ผู้ประเมิน</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editing.attendees.map((a, idx) => (
                        <tr key={idx}>
                          <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}><b>{a.emp_code}</b> · {a.emp_name}</td>
                          <td style={{ textAlign: 'center' }}>{scoreSelect(a.pre_score, v => setAtt(idx, 'pre_score', v))}</td>
                          <td style={{ textAlign: 'center' }}>{scoreSelect(a.post_score, v => setAtt(idx, 'post_score', v))}</td>
                          <td style={{ textAlign: 'center' }}>
                            {a.sign_url
                              ? <img src={a.sign_url} alt="" onClick={() => canRecord && setSignTarget({ idx, title: `${a.emp_name} เซ็นใหม่` })}
                                  style={{ height: 26, background: '#fff', borderRadius: 4, padding: 2, cursor: 'pointer' }} title="คลิกเพื่อเซ็นใหม่" />
                              : <button onClick={() => setSignTarget({ idx, title: `${a.emp_name} ลงชื่อ` })}
                                  style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)' }}>✍️ เซ็น</button>}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <select value={a.eval_agree === null || a.eval_agree === undefined ? '' : (a.eval_agree ? '1' : '0')}
                              onChange={e => setAtt(idx, 'eval_agree', e.target.value === '' ? null : e.target.value === '1')}
                              style={{ width: 'auto', padding: '4px 6px', borderRadius: 6, fontSize: 12 }}>
                              <option value="">—</option>
                              <option value="1">✓ เห็นด้วย</option>
                              <option value="0">✗ ไม่เห็นด้วย</option>
                            </select>
                          </td>
                          <td><input type="text" value={a.evaluator_name || ''} onChange={e => setAtt(idx, 'evaluator_name', e.target.value)} style={{ width: 130, fontSize: 12, padding: '4px 6px' }} /></td>
                          <td><button onClick={() => removeAttendee(idx)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button></td>
                        </tr>
                      ))}
                      {editing.attendees.length === 0 && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16, fontSize: 12 }}>ยังไม่มีพนักงาน — ค้นหาด้านบนเพื่อเพิ่ม</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ลายเซ็นหัวเอกสาร */}
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                <SigPicker label="ผู้จัดทำ" nameKey="maker_name" sigKey="maker_sig_url" />
                <SigPicker label="ระดับจัดการอนุมัติ" nameKey="approver_name" sigKey="approver_sig_url" />
                <SigPicker label="ผู้รับทราบ" nameKey="hr_name" sigKey="hr_sig_url" />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <button onClick={() => setEditing(null)} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
                <button onClick={handleSave} disabled={saving || !canRecord}
                  style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, opacity: saving ? 0.6 : 1 }}>
                  {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึกใบอบรม'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {signTarget && <SignPadModal title={signTarget.title} onCancel={() => setSignTarget(null)} onDone={handleSignDone} />}
    </div>
  );
}

const lb = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
