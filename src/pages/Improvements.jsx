import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can, canDelete } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyIds, getLineFamilyNames } from '../utils/lineHierarchy';
import { normCode } from '../utils/qrCode';
import { fmtDate } from '../utils/dateFormat';
import { RATE_COMPONENTS, lineCostCenter, rateFor, ratePerHour, fmtBaht, defectUnitCost } from '../utils/costSaving';
import { loadCompanyCalendar, countWorkingDaysInMonth } from '../utils/companyCalendar';
import PeChangeRequests from '../components/PeChangeRequests';

/* ── เฟส PDCA ของขั้นงาน (คำสั่ง user 2026-08-19: แผนงานต้องเห็นชัดว่าขั้นไหนคือ P-D-C-A) ──
   เก็บเป็นคอลัมน์ `improvement_milestones.phase` (migration 20260819_improvement_milestone_phase_dr)
   — เป็น "ข้อมูล" ต่อขั้น ไม่ derive จากชื่อขั้น (ขั้นแก้ชื่อ/เพิ่มเองได้ เดาจากชื่อ = พังเงียบ)
   · check = จุดที่ระบบเทียบผลก่อน/หลังจากข้อมูลจริงให้อัตโนมัติ (แผงผลบนการ์ดคือขั้น C ของโปรเจค)
   · จังหวะ "เริ่มลงมือแก้จริง" ของโปรเจคผูกกับการติ๊กเริ่มขั้น phase='do' (ดู cycleMilestone) */
/* หลังแก้ต้องมี "วันผลิตจริง" อย่างน้อยเท่านี้ ถึงสรุป "ประหยัดจริง" ได้ (เกณฑ์เดียวกับ capaEffect.js)
   — หลังแก้ 0-1 วันแล้วลด 100% คือคำกล่าวอ้างที่ยังพิสูจน์ไม่ได้ ระหว่างรอให้โชว์ "เพดานประหยัด" จาก baseline แทน */
const MIN_AFTER_DAYS = 5;

const PHASES = {
  plan:  { s: 'P', label: 'Plan — วิเคราะห์สาเหตุ/วางแผน', c: '#4d9fff' },
  do:    { s: 'D', label: 'Do — ลงมือแก้ (จุดตั้งวันเริ่มแก้จริง)', c: '#f59e0b' },
  check: { s: 'C', label: 'Check — ติดตามผล (ระบบเทียบข้อมูลจริงให้อัตโนมัติ)', c: '#22c55e' },
  act:   { s: 'A', label: 'Act — สรุปผล/จัดทำมาตรฐาน (อัปเดตเอกสาร PE)', c: '#a855f7' },
};

/* ── helpers ─────────────────────────────────────────────────── */

// รูปหลักฐาน before/after — บีบก่อนอัปโหลดตามกติกา CLAUDE.md "Storage & รูปภาพ" (ห้ามส่งรูปดิบ)
function resizeImage(file, maxPx = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('บีบรูปไม่สำเร็จ'))), 'image/jpeg', quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
    img.src = URL.createObjectURL(file);
  });
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// path ใน bucket improvement-images จาก public URL (null = ไม่ใช่ไฟล์ของ bucket นี้)
const impImagePath = (url) => {
  const p = url?.split('/improvement-images/')[1];
  return p ? decodeURIComponent(p) : null;
};
const removeImpImage = (url) => {
  const p = impImagePath(url);
  if (p) supabaseDR.storage.from('improvement-images').remove([p]).catch(() => {});
};

/* หมายเลขเครื่องใน downtime_logs/mtn_orders เป็นข้อความที่คนพิมพ์ — มี "RB- 107" ปนกับ "RB-107"
   ทุกจุดที่เทียบเครื่องในหน้านี้ต้องเทียบผ่าน normCode (ตัดช่องว่าง/ขีด + uppercase)
   ไม่งั้น dropdown แสดงค่าไม่ได้ + ผลก่อน/หลังนับตกหล่นเงียบๆ (feedback 2026-08-19) */
const sameMc = (a, b) => normCode(a) === normCode(b);

const STATUS_META = {
  monitoring: { label: '👁 กำลังติดตามผล', color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  done:       { label: '✅ สำเร็จ',          color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  cancelled:  { label: '✖ ยกเลิก',           color: '#8b8b96', bg: 'rgba(139,139,150,0.14)' },
};

const EMPTY_FORM = {
  id: null, title: '', line_name: '', machine_no: '', mat_no: '',
  problem_source: 'downtime', problem_type_id: '', problem_label: '',
  description: '', action_taken: '', start_date: todayStr(), baseline_days: 30,
  invest_cost: '',
};

export default function Improvements() {
  const { role, lineId, sections: scopeSecs, fullName } = useContext(UserContext);
  const canManage = can('improvements', 'manage', role);
  const canDel    = canDelete('improvements', 'manage', role);  // สิทธิ์ลบโปรเจค แยกจากจัดการ

  const [lines, setLines] = useState([]);
  const [items, setItems] = useState([]);
  const [dtTypes, setDtTypes] = useState([]);
  const [defectTypes, setDefectTypes] = useState([]);
  const [machines, setMachines] = useState([]);
  const [products, setProducts] = useState([]);
  const [mtnProblemTypes, setMtnProblemTypes] = useState([]);   // ลักษณะปัญหาฝั่ง MTN (source='mtn')
  const [mtnOrders, setMtnOrders] = useState([]);               // ใบซ่อม MO — วัดผล + พาเรโต้ + cross-ref
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState({});          // improvement id -> metric result
  const [statusFilter, setStatusFilter] = useState('all');

  // ── cost saving (2026-08-11): activity rate ต่อ cost center + ต้นทุนต่อชิ้นจาก parts_master ──
  const [ccRates, setCcRates] = useState([]);          // cost_center_rates (Main — ตั้งที่ /org-setup)
  const [partCostByMat, setPartCostByMat] = useState({}); // mat_no -> {material_cost, standard_cost}
  const [workDaysMonth, setWorkDaysMonth] = useState(22); // วันทำงาน/เดือน จากปฏิทินบริษัท (แปลง บาท/วัน → บาท/เดือน)
  // ก้อน rate ที่นับเป็น saving (DL/OH/DP) — นโยบายบัญชีบางที่ไม่นับ DP (sunk cost) · จำต่อเครื่อง
  const [costComps, setCostComps] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('imp_cost_comps')); return Array.isArray(v) && v.length ? v : RATE_COMPONENTS.map(c => c.key); }
    catch { return RATE_COMPONENTS.map(c => c.key); }
  });
  const toggleComp = (key) => setCostComps(prev => {
    const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
    if (!next.length) return prev; // ต้องเหลืออย่างน้อย 1 ก้อน
    localStorage.setItem('imp_cost_comps', JSON.stringify(next));
    return next;
  });

  const [modal, setModal] = useState(null);            // form object เมื่อเปิด modal สร้าง/แก้ไข
  const [saving, setSaving] = useState(false);
  const [beforeFile, setBeforeFile] = useState(null);
  const [afterFile, setAfterFile] = useState(null);
  const [pareto, setPareto] = useState({ loading: false, rows: [] });
  const [closeModal, setCloseModal] = useState(null);  // { imp, note, peImpact } ตอนกดปิดจ๊อบ
  const [doModal,    setDoModal]    = useState(null);  // { imp, action, date } จังหวะ "เริ่มลงมือแก้จริง" (ขั้น Do)
  const [peModal,    setPeModal]    = useState(null);  // imp — เสนอ/ดูคำขอแก้เอกสาร PE (PFMEA/CP) ของโปรเจคนี้
  // milestone/Gantt ต่อโปรเจค (คำสั่ง user 2026-07-14: ตามงานโปรเจคทีมแบบ gantt ไม่ใช่ฟอร์มทีเดียวจบ)
  const [msByImp, setMsByImp] = useState({});          // improvement_id -> [milestones]
  const [ganttOpen, setGanttOpen] = useState({});      // improvement_id -> bool
  const [msDraft, setMsDraft] = useState({});          // improvement_id -> { title, assignee, planned_start, planned_end }

  /* ── load master + improvements ── */
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ln }, { data: imp }, { data: dt }, { data: dft }, { data: mc }, { data: pr }, { data: ms }, { data: mpt }, { data: mo }, ccRes, pcRes] = await Promise.all([
      // cost_center: คิด cost saving (ไลน์ลูกไม่กรอก = ตกทอดจากไลน์แม่ — lineCostCenter)
      supabase.from('production_lines').select('id, name, section, parent_line_name, cost_center').order('name'),
      supabaseDR.from('improvements').select('*').order('created_at', { ascending: false }),
      // ⚠️ คอลัมน์ชื่อประเภทคือ name_th (ไม่มีคอลัมน์ name) — เคยพลาด select 'name' แล้ว query 400 เงียบ list ว่างทั้งหน้า
      supabaseDR.from('dr_downtime_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('dr_defect_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('machines').select('id, line_name, machine_no, machine_name').eq('is_active', true).order('sort_order'),
      // cycle_time_sec: conversion cost ของเสีย = rate × CT/3600
      supabaseDR.from('dr_products').select('id, name, mat_no, line_name, cycle_time_sec').eq('is_active', true).order('name'),
      supabaseDR.from('improvement_milestones').select('*').order('sort_order').order('created_at'),
      supabaseDR.from('mtn_problem_types').select('characteristic').eq('is_active', true).order('sort_order'),
      // ใบซ่อม MO (ไม่รวมที่ถูก reject) — ใช้วัดผล/พาเรโต้/cross-ref · labor_cost/parts_cost = ค่าซ่อมจริง → cost saving
      supabaseDR.from('mtn_orders').select('id, line_name, machine_no, item_type, problem_characteristic, report_at, repair_done_at, work_date, status, labor_cost, parts_cost').neq('status', 'rejected').limit(4000),
      // 2 ตัวล่างเป็น best-effort (migration cost saving ยังไม่ apply = แผง 💰 ขึ้น "ยังตั้งต้นทุนไม่ครบ" — หน้าหลักไม่พัง)
      supabase.from('cost_center_rates').select('*'),
      supabaseDR.from('parts_master').select('mat_no, material_cost, standard_cost').eq('is_active', true),
    ]);
    setLines(ln || []);
    setItems(imp || []);
    setDtTypes(dt || []);
    setDefectTypes(dft || []);
    setMachines(mc || []);
    setProducts(pr || []);
    const m = {};
    (ms || []).forEach(x => { (m[x.improvement_id] ||= []).push(x); });
    setMsByImp(m);
    setMtnProblemTypes([...new Set((mpt || []).map(x => x.characteristic))]);
    setMtnOrders(mo || []);
    setCcRates(ccRes?.data || []);
    const pc = {};
    (pcRes?.data || []).forEach(p => { if (p.mat_no) pc[p.mat_no] = p; });
    setPartCostByMat(pc);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  // วันทำงาน/เดือนจากปฏิทินบริษัท (กฎ CLAUDE.md: ห้ามใช้ค่าคงที่ 22/26 โดยไม่อ้างปฏิทิน — 22 เป็น fallback เมื่อปฏิทินว่าง)
  useEffect(() => {
    loadCompanyCalendar().then(() => setWorkDaysMonth(countWorkingDaysInMonth(todayStr().slice(0, 7), 22))).catch(() => {});
  }, []);

  // รับ prefill จากหน้าแจ้งซ่อม MTN (ปุ่ม "เปิดโปรเจคปรับปรุง") — เชื่อม B
  useEffect(() => {
    if (loading || !canManage) return;
    const raw = sessionStorage.getItem('imp_prefill');
    if (!raw) return;
    sessionStorage.removeItem('imp_prefill');
    try {
      const p = JSON.parse(raw);
      setBeforeFile(null); setAfterFile(null);
      setModal({ ...EMPTY_FORM, problem_source: 'mtn', line_name: p.line_name || '', machine_no: p.machine_no || '', problem_label: p.problem || '', title: p.title || '' });
    } catch { /* ignore */ }
  }, [loading, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── milestone CRUD (Gantt) ── */
  const reloadMilestones = async (impId) => {
    const { data } = await supabaseDR.from('improvement_milestones')
      .select('*').eq('improvement_id', impId).order('sort_order').order('created_at');
    setMsByImp(prev => ({ ...prev, [impId]: data || [] }));
  };
  // ขั้นงานมาตรฐาน PDCA — seed ให้ตอนสร้างโปรเจค (แก้/เพิ่ม/ลบได้อิสระ) กระจายวันตาม baseline
  const seedMilestones = async (imp) => {
    const span = Math.max(7, imp.baseline_days || 30);
    const seg = (a, b) => ({ planned_start: addDays(imp.start_date, Math.round(span * a)), planned_end: addDays(imp.start_date, Math.round(span * b)) });
    const rows = [
      { title: '1. วิเคราะห์สาเหตุ (Plan)',        phase: 'plan',  ...seg(0, 0.1) },
      { title: '2. วางแผน/เตรียมการแก้ไข',        phase: 'plan',  ...seg(0.1, 0.25) },
      { title: '3. ดำเนินการแก้ไข (Do)',           phase: 'do',    ...seg(0.25, 0.5) },
      { title: '4. ติดตามผลจากข้อมูลจริง (Check)', phase: 'check', ...seg(0.5, 0.9) },
      { title: '5. สรุปผล/จัดทำมาตรฐาน (Act)',     phase: 'act',   ...seg(0.9, 1) },
    ].map((r, i) => ({ ...r, improvement_id: imp.id, sort_order: i }));
    const { error } = await supabaseDR.from('improvement_milestones').insert(rows);
    if (error) {
      // ยังไม่ apply migration phase (42703) → seed แบบไม่มีเฟสให้แผนยังเกิด แต่ต้องบอก ห้ามเงียบ
      const { error: e2 } = await supabaseDR.from('improvement_milestones')
        .insert(rows.map(({ phase: _p, ...r }) => r));
      if (!e2) toast.error('สร้างแผนได้ แต่ป้ายเฟส PDCA ยังบันทึกไม่ได้ — ยังไม่ apply migration 20260819_improvement_milestone_phase (แจ้ง admin)');
    }
    reloadMilestones(imp.id);
  };
  const addMilestone = async (impId) => {
    const d = msDraft[impId] || {};
    if (!d.title?.trim()) { toast.error('กรอกชื่อขั้นงานก่อน'); return; }
    const cur = msByImp[impId] || [];
    const row = {
      improvement_id: impId, title: d.title.trim(), assignee: d.assignee?.trim() || null,
      planned_start: d.planned_start || null, planned_end: d.planned_end || null,
      sort_order: cur.length, phase: d.phase || null,
    };
    let { error } = await supabaseDR.from('improvement_milestones').insert(row);
    if (error) {
      // คอลัมน์ phase ยังไม่มี (42703) → ลงแบบไม่มีเฟส + บอก (ห้ามเงียบ)
      const { phase: _p, ...noPhase } = row;
      ({ error } = await supabaseDR.from('improvement_milestones').insert(noPhase));
      if (error) { toast.error(error.message); return; }
      if (d.phase) toast.error('เพิ่มขั้นได้ แต่ป้ายเฟส PDCA ยังบันทึกไม่ได้ — ยังไม่ apply migration 20260819_improvement_milestone_phase (แจ้ง admin)');
    }
    setMsDraft(prev => ({ ...prev, [impId]: { title: '', assignee: '', planned_start: '', planned_end: '', phase: '' } }));
    reloadMilestones(impId);
  };
  // คลิกสถานะ = วนขั้น todo → doing → done (stamp วันปิดจริงตอน done)
  const cycleMilestone = async (m) => {
    const next = m.status === 'todo' ? 'doing' : m.status === 'doing' ? 'done' : 'todo';
    const { error } = await supabaseDR.from('improvement_milestones')
      .update({ status: next, done_at: next === 'done' ? todayStr() : null }).eq('id', m.id);
    if (error) { toast.error(error.message); return; }
    reloadMilestones(m.improvement_id);
    /* จังหวะ 2 ของโปรเจค (2026-08-19): ติ๊กเริ่มขั้น Do = "เริ่มลงมือแก้จริง" — ถ้ายังไม่เคยบันทึกการแก้ไข
       ชวนกรอก + ตั้ง start_date เป็นวันเริ่ม Do (start_date คือจุดตัดเทียบก่อน/หลัง ปล่อยเป็นวันเปิดโปรเจค
       ทั้งที่ยังวิเคราะห์อยู่ = ช่วง "หลังแก้" ปนวันที่ยังไม่ได้แก้ → % ลด/Cost Saving ต่ำกว่าจริง
       — บทเรียนเดียวกับ CAPA effectiveness ที่ pivot ต้องเป็นวันมาตรการมีผลจริง) */
    if (next === 'doing' && m.phase === 'do') {
      const imp = items.find(i => i.id === m.improvement_id);
      if (imp && !imp.action_taken) setDoModal({ imp, action: '', date: todayStr() });
    }
  };
  // บันทึก "เริ่มลงมือแก้จริง" — การแก้ไข + วันเริ่มแก้ (จุดตัดเทียบก่อน/หลังเลื่อนตาม → ล้างผลให้คำนวณใหม่)
  const saveDoStart = async () => {
    const { imp, action, date } = doModal;
    if (!action.trim()) { toast.error('กรอกการแก้ไขที่ลงมือทำก่อน'); return; }
    if (!date) { toast.error('เลือกวันเริ่มแก้จริงก่อน'); return; }
    const { error } = await supabaseDR.from('improvements')
      .update({ action_taken: action.trim(), start_date: date, updated_at: new Date().toISOString() }).eq('id', imp.id);
    if (error) { toast.error(error.message); return; }
    setItems(prev => prev.map(i => (i.id === imp.id ? { ...i, action_taken: action.trim(), start_date: date } : i)));
    setResults(prev => { const n = { ...prev }; delete n[imp.id]; return n; });
    setDoModal(null);
    toast.success('บันทึกการแก้ไข + วันเริ่มแก้จริงแล้ว — การเทียบก่อน/หลังยึดวันนี้เป็นจุดตัด');
  };
  const updateMilestone = async (m, patch) => {
    const { error } = await supabaseDR.from('improvement_milestones').update(patch).eq('id', m.id);
    if (error) { toast.error(error.message); return; }
    reloadMilestones(m.improvement_id);
  };
  const deleteMilestone = async (m) => {
    if (!window.confirm(`ลบขั้นงาน "${m.title}"?`)) return;
    const { error } = await supabaseDR.from('improvement_milestones').delete().eq('id', m.id);
    if (error) { toast.error(error.message); return; }
    reloadMilestones(m.improvement_id);
  };

  /* ── scope: leader → family ไลน์ตัวเอง · role อื่น → section scope (pattern เดียวกับหน้าอื่น) ── */
  const visibleLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const fam = getLineFamilyIds(lines, lineId);
      return new Set(lines.filter(l => fam.has(l.id)).map(l => l.name));
    }
    if (scopeSecs?.length) {
      return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    }
    return null; // ไม่จำกัด
  }, [lines, role, lineId, scopeSecs]);

  const visibleItems = useMemo(() => {
    let list = visibleLineNames ? items.filter(i => visibleLineNames.has(i.line_name)) : items;
    if (statusFilter !== 'all') list = list.filter(i => i.status === statusFilter);
    return list;
  }, [items, visibleLineNames, statusFilter]);

  const lineOptions = useMemo(() => {
    const ls = visibleLineNames ? lines.filter(l => visibleLineNames.has(l.name)) : lines;
    return ls.filter(l => l.parent_line_name); // เฉพาะไลน์ผลิตจริง (ระดับลูก)
  }, [lines, visibleLineNames]);

  const typeName = useCallback((imp) => {
    if (imp.problem_source === 'mtn') return imp.problem_label || 'ทุกอาการ';
    const list = imp.problem_source === 'defect' ? defectTypes : dtTypes;
    return list.find(t => t.id === imp.problem_type_id)?.name_th || imp.problem_label || '—';
  }, [dtTypes, defectTypes]);

  // จำนวนใบ MO ตั้งแต่วันเริ่มแก้ (cross-ref บนการ์ด — D)
  const moCountSince = useCallback((imp) => {
    return mtnOrders.filter(m => m.line_name === imp.line_name
      && (!imp.machine_no || sameMc(m.machine_no, imp.machine_no))
      && (imp.problem_source !== 'mtn' || !imp.problem_label || m.problem_characteristic === imp.problem_label)
      && (m.work_date || String(m.report_at).slice(0, 10)) >= imp.start_date).length;
  }, [mtnOrders]);

  /* ── ผลลัพธ์ก่อน/หลัง จากข้อมูลจริง ──
     ก่อน = [start-baseline_days, start) · หลัง = [start, วันนี้] (เพดาน baseline_days วัน)
     หารด้วย "วันที่มีการผลิตจริง" ของไลน์ (นับจาก production_sessions) ไม่ใช่วันปฏิทิน */
  const computeResult = useCallback(async (imp) => {
    const from = addDays(imp.start_date, -imp.baseline_days);
    const afterEnd = addDays(imp.start_date, imp.baseline_days - 1);
    const to = todayStr() < afterEnd ? todayStr() : afterEnd;
    const { data: sessions } = await supabaseDR.from('production_sessions')
      .select('id, work_date').eq('line_name', imp.line_name)
      .gte('work_date', from).lte('work_date', to);
    if (!sessions?.length) return { noData: true };

    const beforeIds = [], afterIds = [], beforeDays = new Set(), afterDays = new Set();
    sessions.forEach(s => {
      if (s.work_date < imp.start_date) { beforeIds.push(s.id); beforeDays.add(s.work_date); }
      else { afterIds.push(s.id); afterDays.add(s.work_date); }
    });
    const allIds = [...beforeIds, ...afterIds];
    const idSetAfter = new Set(afterIds);

    // ── source = 'mtn' : วัดจากใบซ่อม MO (จำนวนใบ + นาที breakdown) ──
    if (imp.problem_source === 'mtn') {
      const inWin = mtnOrders.filter(m => m.line_name === imp.line_name
        && (!imp.machine_no || sameMc(m.machine_no, imp.machine_no))
        && (!imp.problem_label || m.problem_characteristic === imp.problem_label));
      const dOf = (m) => m.work_date || String(m.report_at).slice(0, 10);
      const bMO = inWin.filter(m => { const d = dOf(m); return d >= from && d < imp.start_date; });
      const aMO = inWin.filter(m => { const d = dOf(m); return d >= imp.start_date && d <= to; });
      const mins = (m) => (m.report_at && m.repair_done_at ? Math.max(0, (new Date(m.repair_done_at) - new Date(m.report_at)) / 60000) : 0);
      const sumMin = (arr) => Math.round(arr.reduce((a, m) => a + mins(m), 0));
      // ค่าซ่อมจริงต่อใบ (ช่างกรอกขั้นซ่อม step 3) — ใช้คิด cost saving ตรงๆ ไม่ต้องประมาณ
      const sumCost = (arr) => arr.reduce((a, m) => a + (Number(m.labor_cost) || 0) + (Number(m.parts_cost) || 0), 0);
      return {
        source: 'mtn', unit: 'ใบ', beforeDays: beforeDays.size, afterDays: afterDays.size,
        beforeTotal: bMO.length, afterTotal: aMO.length, beforeCount: bMO.length, afterCount: aMO.length,
        beforePerDay: beforeDays.size ? bMO.length / beforeDays.size : 0,
        afterPerDay: afterDays.size ? aMO.length / afterDays.size : 0,
        beforeMin: sumMin(bMO), afterMin: sumMin(aMO),
        beforeCost: sumCost(bMO), afterCost: sumCost(aMO),
      };
    }

    let rows = [];
    if (imp.problem_source === 'downtime') {
      let q = supabaseDR.from('downtime_logs')
        .select('session_id, duration_min, machine_no, mat_no, dr_downtime_types(category)')
        .in('session_id', allIds);
      if (imp.problem_type_id) q = q.eq('downtime_type_id', imp.problem_type_id);
      if (imp.mat_no) q = q.eq('mat_no', imp.mat_no);
      rows = (await q).data || [];
      // กรองเครื่องฝั่ง client ด้วย normCode — .eq ตรงๆ จะพลาด log ที่พิมพ์เว้นวรรค ("RB- 107")
      if (imp.machine_no) rows = rows.filter(r => sameMc(r.machine_no, imp.machine_no));
      // นับเฉพาะ downtime "นอกแผน" เหมือน KPI หลัก (planned = นับสต็อก/ไม่มีแผนผลิต ไม่ใช่ loss)
      // — ถ้าผู้ใช้ไม่ได้เจาะจงชนิด (ทุกประเภท) ต้องตัด planned ออก ไม่งั้นผลก่อน/หลังเพี้ยน
      if (!imp.problem_type_id) rows = rows.filter(r => r.dr_downtime_types?.category !== 'planned');
      const sum = (arr) => arr.reduce((a, r) => a + (Number(r.duration_min) || 0), 0);
      const bRows = rows.filter(r => !idSetAfter.has(r.session_id));
      const aRows = rows.filter(r => idSetAfter.has(r.session_id));
      return {
        unit: 'นาที', beforeDays: beforeDays.size, afterDays: afterDays.size,
        beforeTotal: sum(bRows), afterTotal: sum(aRows),
        beforeCount: bRows.length, afterCount: aRows.length,
        beforePerDay: beforeDays.size ? sum(bRows) / beforeDays.size : 0,
        afterPerDay: afterDays.size ? sum(aRows) / afterDays.size : 0,
      };
    }
    // defect: qty NG — กรองสินค้า (ถ้าระบุ) ผ่าน prod_orders.mat_no
    let q = supabaseDR.from('defect_logs')
      .select('session_id, qty_ng, prod_orders(mat_no)')
      .in('session_id', allIds);
    if (imp.problem_type_id) q = q.eq('defect_type_id', imp.problem_type_id);
    rows = ((await q).data || []).filter(r => !imp.mat_no || r.prod_orders?.mat_no === imp.mat_no);
    const sum = (arr) => arr.reduce((a, r) => a + (Number(r.qty_ng) || 0), 0);
    const bRows = rows.filter(r => !idSetAfter.has(r.session_id));
    const aRows = rows.filter(r => idSetAfter.has(r.session_id));
    // ยอด NG แยกราย mat (สำหรับ cost saving — ต้นทุน/ชิ้นต่างกันต่อพาร์ท) · ไม่รู้ mat = key null
    const perMat = { before: {}, after: {} };
    rows.forEach(r => {
      const side = idSetAfter.has(r.session_id) ? 'after' : 'before';
      const m = r.prod_orders?.mat_no || null;
      perMat[side][m] = (perMat[side][m] || 0) + (Number(r.qty_ng) || 0);
    });
    return {
      unit: 'ชิ้น NG', beforeDays: beforeDays.size, afterDays: afterDays.size,
      beforeTotal: sum(bRows), afterTotal: sum(aRows),
      beforeCount: bRows.length, afterCount: aRows.length,
      beforePerDay: beforeDays.size ? sum(bRows) / beforeDays.size : 0,
      afterPerDay: afterDays.size ? sum(aRows) / afterDays.size : 0,
      matBefore: perMat.before, matAfter: perMat.after,
    };
  }, [mtnOrders]);

  /* ── 💰 cost saving (2026-08-11): แปลงผลก่อน/หลัง เป็นบาท ──
     downtime: Δนาที/วัน × rate(DL+OH+DP ก้อนที่เลือก)/60
     defect:   Δชิ้น/วัน × ต้นทุน/ชิ้นราย mat — standard_cost (บช.) ชนะ · ไม่มีค่อย material_cost + conversion(CT×rate)
     mtn:      Δค่าซ่อมจริง (labor+parts ต่อใบ) + Δนาที breakdown × rate
     ข้อมูลไม่ครบ = บอกว่าขาดอะไร ห้ามเดา (missing/defectNoCost) */
  const ctByMat = useMemo(() => {
    const m = {};
    products.forEach(p => { if (p.mat_no && Number(p.cycle_time_sec) > 0) m[p.mat_no] = Number(p.cycle_time_sec); });
    return m;
  }, [products]);

  /* potential=true = โหมด "มูลค่าปัญหาก่อนแก้ (เพดานประหยัดถ้าแก้หายหมด)" — ใช้ตอนข้อมูลหลังแก้ยังน้อย
     (afterDays < MIN_AFTER_DAYS): คิดจาก baseline ล้วน (after = 0) ซึ่งเป็นข้อเท็จจริงที่วัดแล้ว
     ห้ามโชว์ "ประหยัดแล้ว X บาท" จากหลังแก้ 0-1 วัน — หลังแก้วันเดียวลด 100% = คำกล่าวอ้างที่ยังพิสูจน์ไม่ได้
     (เกณฑ์ 5 วันผลิตจริง = มาตรฐานเดียวกับ CAPA effectiveness ใน capaEffect.js) */
  const costSavingOf = useCallback((imp, r, potential = false) => {
    if (!r || r.noData) return null;
    if (potential) r = { ...r, afterPerDay: 0, afterCost: 0, afterMin: 0, afterDays: 0, matAfter: {} };
    const cc = lineCostCenter(lines, imp.line_name);
    const rate = cc ? rateFor(ccRates, cc, imp.start_date) : null;
    const missing = [];
    if (!cc) missing.push('ไลน์ยังไม่ตั้ง cost center — กรอกที่หน้าจัดการไลน์ (ไลน์แม่ ตกทอดถึงลูก)');
    else if (!rate) missing.push(`ยังไม่ตั้ง activity rate ของ cost center ${cc} — ตั้งที่ผังองค์กร → แผง 💰 Activity Rate`);

    // บาท/วัน แยกก้อน — โชว์ครบทุกก้อนเสมอ (ก้อนที่ไม่เลือกไม่เข้ายอดรวม) · วนจาก RATE_COMPONENTS ห้าม hardcode
    const comp = Object.fromEntries(RATE_COMPONENTS.map(c => [c.key, 0]));
    let matPerDay = 0;                      // มูลค่าวัสดุ/standard cost (defect — นับเสมอ ไม่ขึ้นกับก้อนที่เลือก)
    let repairPerDay = 0;                   // mtn: ค่าซ่อมจริงจากใบ MO
    const defectParts = [], defectNoCost = new Set();
    let computable = true;
    const addComp = (hoursPerDay) => { RATE_COMPONENTS.forEach(c => { comp[c.key] += (Number(rate?.[c.field]) || 0) * hoursPerDay; }); };

    if (imp.problem_source === 'downtime') {
      if (!rate) computable = false;
      else addComp((r.beforePerDay - r.afterPerDay) / 60);
    } else if (imp.problem_source === 'mtn') {
      repairPerDay = (r.beforeDays ? (r.beforeCost || 0) / r.beforeDays : 0) - (r.afterDays ? (r.afterCost || 0) / r.afterDays : 0);
      const bdHrPerDay = ((r.beforeDays ? r.beforeMin / r.beforeDays : 0) - (r.afterDays ? r.afterMin / r.afterDays : 0)) / 60;
      if (rate) addComp(bdHrPerDay);
      // ไม่มี rate: ยังคิดส่วนค่าซ่อมจริงได้ (เงินจริง ไม่ต้องพึ่ง rate) — missing บอกอยู่แล้วว่าส่วนนาที breakdown ขาด
    } else {
      const mats = new Set([...Object.keys(r.matBefore || {}), ...Object.keys(r.matAfter || {})]);
      mats.forEach(matKey => {
        const mat = matKey === 'null' ? null : matKey;  // key null ถูกแปลงเป็น 'null' ตอนเป็น object key
        const dQtyPerDay = (r.beforeDays ? (r.matBefore?.[matKey] || 0) / r.beforeDays : 0)
          - (r.afterDays ? (r.matAfter?.[matKey] || 0) / r.afterDays : 0);
        const part = mat ? partCostByMat[mat] : null;
        // สูตรต้นทุน/ชิ้น = util กลาง (ใช้ร่วมกับแผงมูลค่าของเสียใน /oee-analytics)
        const ct = ctByMat[mat] || 0;
        const uc = defectUnitCost(part, { ratePerHr: rate ? ratePerHour(rate, costComps) : 0, ctSec: ct });
        if (uc.source === 'standard') {
          matPerDay += dQtyPerDay * uc.unit;
          defectParts.push({ mat, dQtyPerDay, unit: uc.unit, source: 'standard' });
        } else if (uc.source === 'derived') {
          matPerDay += dQtyPerDay * (Number(part?.material_cost) || 0);
          if (ct && rate) addComp(dQtyPerDay * ct / 3600);
          defectParts.push({ mat, dQtyPerDay, unit: uc.unit, source: 'derived', convMissing: uc.convMissing });
        } else {
          defectNoCost.add(mat || 'ไม่ระบุ MAT');
        }
      });
      if (!defectParts.length) computable = false;
      if (defectNoCost.size) missing.push(`พาร์ทยังไม่ตั้งต้นทุน/ชิ้น (${[...defectNoCost].join(', ')}) — กรอก standard/material cost ที่ Product Master → 🗂 Parts Master`);
    }

    const compSelected = costComps.reduce((a, k) => a + comp[k], 0);
    const totalPerDay = computable ? compSelected + matPerDay + repairPerDay : null;
    const totalPerMonth = totalPerDay != null ? totalPerDay * workDaysMonth : null;
    const invest = Number(imp.invest_cost) || 0;
    const payback = invest > 0 && totalPerMonth > 0 ? invest / totalPerMonth : null;
    return { cc, rate, missing, comp, matPerDay, repairPerDay, defectParts, defectNoCost: [...defectNoCost], totalPerDay, totalPerMonth, payback, invest, computable };
  }, [lines, ccRates, partCostByMat, ctByMat, costComps, workDaysMonth]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const imp of visibleItems) {
        if (results[imp.id]) continue;
        const r = await computeResult(imp).catch(() => ({ noData: true }));
        if (cancelled) return;
        setResults(prev => ({ ...prev, [imp.id]: r }));
      }
    })();
    return () => { cancelled = true; };
  }, [visibleItems, computeResult]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Pareto ปัญหา Top ของไลน์ (หน้าต่างเดียวกับ baseline) — คลิกเพื่อเลือกเป็นเป้าโปรเจค ── */
  const loadPareto = useCallback(async (line_name, source, days) => {
    if (!line_name) { setPareto({ loading: false, rows: [] }); return; }
    setPareto({ loading: true, rows: [] });
    const from = addDays(todayStr(), -days);
    // ── source = 'mtn' : พาเรโต้จากใบซ่อม MO (เครื่อง+อาการ ที่มีใบเยอะสุด) ──
    if (source === 'mtn') {
      const dOf = (m) => m.work_date || String(m.report_at).slice(0, 10);
      const agg = new Map();
      mtnOrders.filter(m => m.line_name === line_name && dOf(m) >= from).forEach(m => {
        const key = `${m.problem_characteristic || ''}::${normCode(m.machine_no)}`; // เครื่องเดียวกันที่พิมพ์ไม่เป๊ะ = แถวเดียวกัน
        const cur = agg.get(key) || { label: m.problem_characteristic || 'ทุกอาการ', machine_no: m.machine_no || '', value: 0, count: 0, planned: false, mins: 0, descCount: new Map() };
        cur.value += 1; cur.count += 1;
        if (m.report_at && m.repair_done_at) cur.mins += Math.max(0, (new Date(m.repair_done_at) - new Date(m.report_at)) / 60000);
        agg.set(key, cur);
      });
      const rows = [...agg.values()].filter(r => r.value > 0).map(r => ({ ...r, mins: Math.round(r.mins), topDescs: [] })).sort((a, b) => b.value - a.value).slice(0, 10);
      setPareto({ loading: false, rows }); return;
    }
    const { data: sessions } = await supabaseDR.from('production_sessions')
      .select('id').eq('line_name', line_name).gte('work_date', from);
    const ids = (sessions || []).map(s => s.id);
    if (!ids.length) { setPareto({ loading: false, rows: [] }); return; }
    const agg = new Map();
    const pushDesc = (cur, desc) => {
      const d = (desc || '').trim();
      if (!d) return;
      cur.descCount.set(d, (cur.descCount.get(d) || 0) + 1);
    };
    if (source === 'downtime') {
      // ดึง category (planned/unplanned) + description มาด้วย — งานในแผนเป็น priority รอง
      // และ note พนักงานคือตัวบอกว่า "อื่นๆ" จริงๆ คือปัญหาอะไร
      const { data } = await supabaseDR.from('downtime_logs')
        .select('downtime_type_id, machine_no, duration_min, description, dr_downtime_types(category)')
        .in('session_id', ids);
      (data || []).forEach(r => {
        const key = `${r.downtime_type_id || ''}::${normCode(r.machine_no)}`; // เครื่องเดียวกันที่พิมพ์ไม่เป๊ะ = แถวเดียวกัน
        const cur = agg.get(key) || { type_id: r.downtime_type_id, machine_no: r.machine_no || '', value: 0, count: 0, planned: r.dr_downtime_types?.category === 'planned', descCount: new Map() };
        cur.value += Number(r.duration_min) || 0; cur.count += 1;
        pushDesc(cur, r.description);
        agg.set(key, cur);
      });
    } else {
      const { data } = await supabaseDR.from('defect_logs')
        .select('defect_type_id, qty_ng, description, prod_orders(mat_no)').in('session_id', ids);
      (data || []).forEach(r => {
        const mat = r.prod_orders?.mat_no || '';
        const key = `${r.defect_type_id || ''}::${mat}`;
        const cur = agg.get(key) || { type_id: r.defect_type_id, mat_no: mat, value: 0, count: 0, planned: false, descCount: new Map() };
        cur.value += Number(r.qty_ng) || 0; cur.count += 1;
        pushDesc(cur, r.description);
        agg.set(key, cur);
      });
    }
    // เรียง: งานนอกแผน (unplanned) มาก่อนเสมอ · งานในแผน (planned เช่น 5ส./นับสต็อก) เป็น priority รองท้ายลิสต์
    // แต่ละแถวแนบ note พนักงานที่พบบ่อยสุด (สำคัญกับประเภท "อื่นๆ" ที่ชื่อประเภทบอกอะไรไม่ได้)
    const rows = [...agg.values()].filter(r => r.value > 0)
      .map(r => ({ ...r, topDescs: [...r.descCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3) }))
      .sort((a, b) => (a.planned ? 1 : 0) - (b.planned ? 1 : 0) || b.value - a.value)
      .slice(0, 10);
    setPareto({ loading: false, rows });
  }, [mtnOrders]);

  useEffect(() => {
    if (modal) loadPareto(modal.line_name, modal.problem_source, Number(modal.baseline_days) || 30);
  }, [modal?.line_name, modal?.problem_source, modal?.baseline_days]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── save / delete / status ── */
  const openCreate = () => { setBeforeFile(null); setAfterFile(null); setModal({ ...EMPTY_FORM, line_name: lineOptions[0]?.name || '' }); };
  const openEdit = (imp) => { setBeforeFile(null); setAfterFile(null); setModal({ ...imp, baseline_days: imp.baseline_days || 30 }); };

  const handleSave = async () => {
    if (!modal.title.trim()) { toast.error('กรอกชื่อโปรเจคปรับปรุงก่อน'); return; }
    if (!modal.line_name) { toast.error('เลือกไลน์ก่อน'); return; }
    if (!modal.start_date) { toast.error('เลือกวันเริ่มแก้ไขก่อน'); return; }
    setSaving(true);
    try {
      const typeList = modal.problem_source === 'defect' ? defectTypes : dtTypes;
      const payload = {
        title: modal.title.trim(),
        line_name: modal.line_name,
        machine_no: modal.machine_no || null,
        mat_no: modal.mat_no || null,
        problem_source: modal.problem_source,
        problem_type_id: modal.problem_type_id || null,
        problem_label: typeList.find(t => t.id === modal.problem_type_id)?.name_th || modal.problem_label || null,
        description: modal.description?.trim() || null,
        action_taken: modal.action_taken?.trim() || null,
        start_date: modal.start_date,
        baseline_days: Number(modal.baseline_days) || 30,
        invest_cost: modal.invest_cost !== '' && modal.invest_cost != null ? Number(modal.invest_cost) : null,
        updated_at: new Date().toISOString(),
      };
      let row;
      if (modal.id) {
        const { data, error } = await supabaseDR.from('improvements').update(payload).eq('id', modal.id).select().single();
        if (error) throw error;
        row = data;
      } else {
        payload.created_by_name = fullName || null;
        const { data, error } = await supabaseDR.from('improvements').insert(payload).select().single();
        if (error) throw error;
        row = data;
      }
      // อัปโหลดรูป (บีบ 1280px) — update url แล้วค่อยลบรูปเก่า (ลบหลัง DB สำเร็จเท่านั้น, best-effort)
      const imgPayload = {};
      for (const [file, field] of [[beforeFile, 'image_before_url'], [afterFile, 'image_after_url']]) {
        if (!file) continue;
        const blob = await resizeImage(file);
        const path = `${row.id}/${field === 'image_before_url' ? 'before' : 'after'}-${Date.now()}.jpg`;
        const { error: upErr } = await supabaseDR.storage.from('improvement-images').upload(path, blob, { upsert: true });
        if (upErr) throw upErr;
        imgPayload[field] = supabaseDR.storage.from('improvement-images').getPublicUrl(path).data.publicUrl;
      }
      if (Object.keys(imgPayload).length) {
        const { error: imgErr } = await supabaseDR.from('improvements').update(imgPayload).eq('id', row.id);
        if (imgErr) throw imgErr;
        if (imgPayload.image_before_url && row.image_before_url) removeImpImage(row.image_before_url);
        if (imgPayload.image_after_url && row.image_after_url) removeImpImage(row.image_after_url);
      }
      // โปรเจคใหม่ seed ขั้นงานมาตรฐาน PDCA 5 ขั้นให้เลย (ปรับ/เพิ่ม/ลบได้ใน Gantt ของการ์ด)
      if (!modal.id) await seedMilestones(row);
      toast.success(modal.id ? 'บันทึกการแก้ไขแล้ว' : 'สร้างโปรเจคปรับปรุงแล้ว — วางแผนขั้นงานใน 🗓 แผนงาน ได้เลย');
      setModal(null);
      setResults(prev => { const p = { ...prev }; delete p[row.id]; return p; }); // คำนวณผลใหม่
      setGanttOpen(prev => ({ ...prev, [row.id]: !modal.id ? true : prev[row.id] }));
      load();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const handleDelete = async (imp) => {
    if (!window.confirm(`ลบโปรเจค "${imp.title}"?`)) return;
    const { error } = await supabaseDR.from('improvements').delete().eq('id', imp.id);
    if (error) { toast.error(error.message); return; }
    // ลบรูปหลัง DB สำเร็จ (กติกา CLAUDE.md — กันไฟล์กำพร้า)
    removeImpImage(imp.image_before_url);
    removeImpImage(imp.image_after_url);
    toast.success('ลบแล้ว');
    setItems(prev => prev.filter(i => i.id !== imp.id));
  };

  const setStatus = async (imp, status, result_note = null) => {
    const { error } = await supabaseDR.from('improvements')
      .update({ status, result_note, updated_at: new Date().toISOString() }).eq('id', imp.id);
    if (error) { toast.error(error.message); return; }
    setItems(prev => prev.map(i => (i.id === imp.id ? { ...i, status, result_note } : i)));
    toast.success(status === 'done' ? 'ปิดโปรเจค — สำเร็จ 🎉' : status === 'cancelled' ? 'ยกเลิกโปรเจคแล้ว' : 'กลับมาติดตามผลต่อ');
  };

  /* ── render ── */
  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  // เครื่องของ "ครอบครัวไลน์" ไม่ใช่ชื่อไลน์ตรงเป๊ะ — กะมักเปิดบนไลน์ลูกแต่เครื่องลงทะเบียน
  // ใต้ไลน์แม่/พี่น้อง (pattern เดียวกับ sessionProcessTypesAll ใน DailyReport) · family ว่าง = fallback ตรงเป๊ะ
  const modalFamNames = modal?.line_name ? getLineFamilyNames(lines, modal.line_name) : [];
  const machineOpts = machines.filter(m => modalFamNames.length
    ? modalFamNames.includes(m.line_name) : m.line_name === modal?.line_name);
  // แปลงหมายเลขเครื่องจาก log (คนพิมพ์ ไม่เป๊ะ) → หมายเลขตามทะเบียนเครื่อง ถ้าจับคู่ได้
  const canonMc = (raw) => (raw ? (machines.find(m => sameMc(m.machine_no, raw))?.machine_no || raw) : '');
  const productOpts = products.filter(p => p.line_name === modal?.line_name && p.mat_no);
  const typeOpts = modal?.problem_source === 'defect' ? defectTypes : dtTypes;

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(96vw, 1500px)', margin: '0 auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>💡 Improvements — โปรเจคปรับปรุง</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            เลือกปัญหาจากพาเรโต้ Downtime / ของเสีย / ใบซ่อม MTN → บันทึกการแก้ไข → ระบบเทียบผลก่อน/หลังจากข้อมูลที่เกิดจริงให้อัตโนมัติ
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto', padding: '7px 10px', fontSize: 12, borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="all">ทุกสถานะ</option>
            <option value="monitoring">👁 กำลังติดตามผล</option>
            <option value="done">✅ สำเร็จ</option>
            <option value="cancelled">✖ ยกเลิก</option>
          </select>
          {canManage && (
            <button onClick={openCreate} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              ➕ เพิ่มโปรเจคปรับปรุง
            </button>
          )}
        </div>
      </div>

      {/* ── 💰 สรุป cost saving รวมขึ้นตาม hierarchy: กลุ่ม → ส่วน → รวม (2026-08-11 · คำสั่ง user
             "rate อยู่ระดับกลุ่ม แล้วค่อย sum ขึ้นมาตาม hierarchy") — rate ไม่กรอกซ้ำระดับบน ยอดระดับบน = ผลรวมจากกลุ่ม ── */}
      {(() => {
        const active = visibleItems.filter(i => i.status !== 'cancelled');
        const tree = new Map(); // section -> { total, groups: Map(group -> total) }
        let grand = 0, computed = 0, pending = 0;
        let earlyCnt = 0, earlyCap = 0; // โปรเจคที่หลังแก้ยังไม่ถึงเกณฑ์ — นับแยกเป็น "เพดาน" ห้ามรวมกับประหยัดจริง
        active.forEach(imp => {
          const rr = results[imp.id];
          if (rr && !rr.noData && (rr.afterDays || 0) < MIN_AFTER_DAYS) {
            const cap = costSavingOf(imp, rr, true);
            if (cap?.totalPerMonth != null) { earlyCnt += 1; earlyCap += cap.totalPerMonth; } else pending += 1;
            return;
          }
          const cs = costSavingOf(imp, rr);
          if (!cs || cs.totalPerMonth == null) { pending += 1; return; }
          computed += 1; grand += cs.totalPerMonth;
          const li = lines.find(l => l.name === imp.line_name);
          const sec = li?.section || '—';
          const grp = li?.parent_line_name || imp.line_name;
          const s = tree.get(sec) || { total: 0, groups: new Map() };
          s.total += cs.totalPerMonth;
          s.groups.set(grp, (s.groups.get(grp) || 0) + cs.totalPerMonth);
          tree.set(sec, s);
        });
        if (!computed && !earlyCnt) return null;
        const col = (v) => (v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : 'var(--muted)');
        return (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>💰 Cost Saving รวม (บาท/เดือน)</span>
              {computed > 0 && <span style={{ fontSize: 16, fontWeight: 800, color: col(grand) }}>{grand > 0 ? '+' : ''}{fmtBaht(grand)}</span>}
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {computed > 0 ? `จาก ${computed} โปรเจคที่ผลจริงยืนยันแล้ว (หลังแก้ ≥${MIN_AFTER_DAYS} วันผลิต · ไม่รวมที่ยกเลิก)` : 'ยังไม่มีโปรเจคที่ผลจริงยืนยันแล้ว'}
                {earlyCnt > 0 ? ` · ⏳ อีก ${earlyCnt} โปรเจครอผลหลังแก้ (เพดานประหยัดถ้าแก้หายหมด ~${fmtBaht(earlyCap)}/เดือน — ยังไม่นับรวม)` : ''}
                {pending > 0 ? ` · อีก ${pending} โปรเจคยังคำนวณไม่ได้ — ดู ⚠ บนการ์ด` : ''} · รวมขึ้นจากระดับกลุ่มตามผังองค์กร
              </span>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
              {[...tree.entries()].sort((a, b) => b[1].total - a[1].total).map(([sec, s]) => (
                <div key={sec} style={{ fontSize: 11, color: 'var(--text2)' }}>
                  <b style={{ color: 'var(--text)' }}>🏛️ {sec}</b> <b style={{ color: col(s.total) }}>{fmtBaht(s.total)}</b>
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}( {[...s.groups.entries()].sort((a, b) => b[1] - a[1]).map(([g, v]) => `${g} ${fmtBaht(v)}`).join(' · ')} )
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {visibleItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)', fontSize: 13 }}>
          ยังไม่มีโปรเจคปรับปรุง{canManage ? ' — กด "➕ เพิ่มโปรเจคปรับปรุง" เลือกปัญหาจากพาเรโต้ได้เลย' : ''}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 14, marginTop: 14, alignItems: 'stretch' }}>
          {visibleItems.map(imp => {
            const st = STATUS_META[imp.status] || STATUS_META.monitoring;
            const r = results[imp.id];
            const pct = r && !r.noData && r.beforePerDay > 0
              ? Math.round(((r.beforePerDay - r.afterPerDay) / r.beforePerDay) * 100)
              : null;
            const improved = pct != null && pct > 0;
            const maxPerDay = r && !r.noData ? Math.max(r.beforePerDay, r.afterPerDay, 0.0001) : 1;
            return (
              <div key={imp.id} style={{ display: 'flex', flexDirection: 'column', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, height: '100%' }}>
                {/* title + status */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>{imp.title}</div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: st.color, background: st.bg, border: `1px solid ${st.color}55`, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>{st.label}</span>
                </div>
                {/* problem chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(77,159,255,0.13)', color: '#4d9fff', borderRadius: 5, padding: '2px 7px' }}>🏭 {imp.line_name}</span>
                  {imp.machine_no && <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,0.13)', color: '#f59e0b', borderRadius: 5, padding: '2px 7px' }}>⚙️ {imp.machine_no}</span>}
                  {imp.mat_no && <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(167,139,250,0.13)', color: '#a78bfa', borderRadius: 5, padding: '2px 7px' }}>📦 {imp.mat_no}</span>}
                  {(() => {
                    const meta = imp.problem_source === 'defect' ? { bg: 'rgba(236,72,153,0.13)', c: '#ec4899', t: '🔍 ของเสีย' }
                      : imp.problem_source === 'mtn' ? { bg: 'rgba(124,108,240,0.15)', c: '#a78bfa', t: '🛠️ ใบซ่อม MTN' }
                      : { bg: 'rgba(239,68,68,0.13)', c: '#ef4444', t: '🛑 Downtime' };
                    return <span style={{ fontSize: 11, fontWeight: 700, background: meta.bg, color: meta.c, borderRadius: 5, padding: '2px 7px' }}>{meta.t}: {typeName(imp)}</span>;
                  })()}
                  {(() => { const n = moCountSince(imp); return n > 0 ? <span title="จำนวนใบซ่อม MO ของเครื่อง/ไลน์นี้ ตั้งแต่วันเริ่มแก้" style={{ fontSize: 11, fontWeight: 700, background: 'rgba(124,108,240,0.13)', color: '#7c6cf0', borderRadius: 5, padding: '2px 7px' }}>🔧 ใบ MO {n} ใบ</span> : null; })()}
                </div>
                {/* description / action */}
                {imp.description && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, lineHeight: 1.45 }}><b style={{ color: 'var(--muted)' }}>ปัญหา:</b> {imp.description}</div>}
                {imp.action_taken
                  ? <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.45 }}><b style={{ color: 'var(--muted)' }}>การแก้ไข:</b> {imp.action_taken}</div>
                  : imp.status === 'monitoring' && canManage && (
                    /* จังหวะ 2: ยังไม่บันทึกการแก้ไข = ยังอยู่ช่วงวิเคราะห์ (Plan) — เริ่มลงมือจริงเมื่อไหร่กดที่นี่
                       (หรือติ๊กเริ่มขั้น D ในแผนงาน ระบบจะเด้งฟอร์มเดียวกันให้) ห้ามซ่อนเงียบ */
                    <button onClick={() => setDoModal({ imp, action: '', date: todayStr() })}
                      style={{ marginTop: 6, padding: '6px 10px', borderRadius: 7, textAlign: 'left', width: '100%',
                        border: '1px dashed rgba(245,158,11,0.6)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b',
                        fontSize: 11.5, fontWeight: 700, cursor: 'pointer', lineHeight: 1.5 }}>
                      🚀 ยังไม่บันทึกการแก้ไข (อยู่ช่วงวิเคราะห์/วางแผน) — เริ่มลงมือจริงเมื่อไหร่กดที่นี่
                      เพื่อบันทึกการแก้ไข + ตั้ง "วันเริ่มแก้" เป็นจุดตัดเทียบก่อน/หลัง
                    </button>
                  )}
                {/* before/after images */}
                {(imp.image_before_url || imp.image_after_url) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                    {[['image_before_url', 'ก่อนแก้ไข'], ['image_after_url', 'หลังแก้ไข']].map(([f, label]) => (
                      <div key={f}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
                        {imp[f]
                          ? <img src={imp[f]} alt={label} loading="lazy" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => window.open(imp[f], '_blank')} />
                          : <div style={{ width: '100%', height: 110, borderRadius: 8, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>ยังไม่มีรูป</div>}
                      </div>
                    ))}
                  </div>
                )}
                {/* ผลลัพธ์จากข้อมูลจริง */}
                <div style={{ marginTop: 10, padding: 10, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>📈 ผลจากข้อมูลจริง <span style={{ fontWeight: 600, color: 'var(--muted)' }}>(เริ่ม {fmtDate(imp.start_date)} · เทียบ {imp.baseline_days} วัน)</span></span>
                    {pct != null && ((r?.afterDays || 0) < MIN_AFTER_DAYS
                      /* หลังแก้ยังไม่ถึงเกณฑ์ — % จากตัวอย่างเล็กหลอกตา (1 วัน 0 นาที = ▼100%) ห้ามโชว์เหมือนยืนยันแล้ว */
                      ? <span title={`หลังแก้มีข้อมูลแค่ ${r?.afterDays || 0} วันผลิต (ต้อง ≥${MIN_AFTER_DAYS}) — ยังสรุป % ไม่ได้`}
                          style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b' }}>⏳ รอผล {r?.afterDays || 0}/{MIN_AFTER_DAYS} วัน</span>
                      : <span style={{ fontSize: 14, fontWeight: 800, color: improved ? '#22c55e' : '#ef4444' }}>
                          {improved ? '▼' : '▲'} {Math.abs(pct)}%
                        </span>
                    )}
                  </div>
                  {!r ? (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>กำลังคำนวณ...</div>
                  ) : r.noData ? (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>ยังไม่มีข้อมูลการผลิตในช่วงเทียบ</div>
                  ) : (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[['ก่อนแก้', r.beforePerDay, r.beforeTotal, r.beforeCount, r.beforeDays, '#ef4444'],
                        ['หลังแก้', r.afterPerDay, r.afterTotal, r.afterCount, r.afterDays, improved || r.afterPerDay === 0 ? '#22c55e' : '#f59e0b']].map(([label, perDay, total, count, days, color]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', width: 46, flexShrink: 0 }}>{label}</span>
                          <div style={{ flex: 1, height: 16, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, (perDay / maxPerDay) * 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s' }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 800, color, width: 150, flexShrink: 0, textAlign: 'right' }}>
                            {perDay.toFixed(1)} {r.unit}/วัน <span style={{ fontWeight: 600, color: 'var(--muted)' }}>({total.toFixed(0)} / {days}วัน)</span>
                          </span>
                        </div>
                      ))}
                      {r.source === 'mtn' && (r.beforeMin || r.afterMin) ? (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>⏱ breakdown รวม: <b style={{ color: '#ef4444' }}>{r.beforeMin}</b> → <b style={{ color: '#22c55e' }}>{r.afterMin}</b> นาที</div>
                      ) : null}
                      {r.afterDays === 0 && <div style={{ fontSize: 11, color: '#f59e0b' }}>⏳ ยังไม่มีวันผลิตหลังวันเริ่มแก้ — รอข้อมูล</div>}
                    </div>
                  )}
                  {imp.result_note && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}><b style={{ color: 'var(--muted)' }}>สรุปผล:</b> {imp.result_note}</div>}
                </div>

                {/* ── 💰 Cost Saving — แปลงผลจริงเป็นบาทด้วย activity rate (DL/OH/DP) + ต้นทุน/ชิ้น (2026-08-11)
                    2 โหมด (2026-08-19 · user ทัก "ประมาณการเอามาจากไหน ในเมื่อยังไม่มีข้อมูลว่าจะลดได้เท่าไหร่"):
                    หลังแก้ ≥5 วันผลิต = "ประหยัดจริง" · น้อยกว่านั้น = "มูลค่าปัญหา (เพดานประหยัด)" จาก baseline ล้วน ── */}
                {(() => {
                  const tooEarly = (r.afterDays || 0) < MIN_AFTER_DAYS;
                  const cs = costSavingOf(imp, r, tooEarly);
                  if (!cs) return null;
                  const good = !tooEarly && cs.totalPerDay != null && cs.totalPerDay > 0;
                  const bad = !tooEarly && cs.totalPerDay != null && cs.totalPerDay < 0;
                  return (
                    <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: good ? 'rgba(34,197,94,0.07)' : 'var(--bg3)', border: `1px solid ${good ? 'rgba(34,197,94,0.3)' : tooEarly ? 'rgba(245,158,11,0.35)' : 'var(--border)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>
                          {tooEarly ? '💰 มูลค่าปัญหานี้ (ก่อนแก้)' : '💰 Cost Saving'}{' '}
                          <span style={{ fontWeight: 600, color: 'var(--muted)' }}>({tooEarly ? 'จาก baseline ที่วัดแล้ว' : 'ประมาณการจากผลจริง'}{cs.cc ? ` · CC ${cs.cc}` : ''})</span>
                        </span>
                        {/* เลือกก้อน rate ที่นับเป็น saving — นโยบายบัญชีบางที่ไม่นับ DP (sunk cost) · มีผลทุกการ์ด */}
                        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>นับ:</span>
                          {RATE_COMPONENTS.map(c => {
                            const on = costComps.includes(c.key);
                            return (
                              <button key={c.key} onClick={() => toggleComp(c.key)} title={`${c.full} — ${on ? 'นับในยอดรวม (กดเพื่อไม่นับ)' : 'ไม่นับในยอดรวม (กดเพื่อนับ)'}`}
                                style={{ fontSize: 11, fontWeight: 800, padding: '1px 8px', borderRadius: 10, cursor: 'pointer',
                                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                                  background: on ? 'var(--accent-dim)' : 'transparent',
                                  color: on ? 'var(--accent)' : 'var(--muted)', textDecoration: on ? 'none' : 'line-through' }}>
                                {c.label}
                              </button>
                            );
                          })}
                        </span>
                      </div>
                      {cs.missing.map((m, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#f59e0b', marginTop: 5 }}>⚠ {m}</div>
                      ))}
                      {cs.totalPerDay == null ? (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>ยังคำนวณเป็นบาทไม่ได้ — เติมข้อมูลตามรายการด้านบนก่อน</div>
                      ) : (
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: good ? '#22c55e' : bad ? '#ef4444' : 'var(--muted)' }}>
                            {tooEarly ? 'มูลค่าความสูญเสีย' : good ? 'ประหยัด' : bad ? 'ต้นทุนเพิ่มขึ้น' : '±0'} ~{fmtBaht(Math.abs(cs.totalPerDay))} บาท/วัน
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}> · ~{fmtBaht(Math.abs(cs.totalPerMonth))} บาท/เดือน{tooEarly ? ' = เพดานประหยัดถ้าแก้หายหมด' : ''}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}> ({workDaysMonth} วันทำงาน/เดือน)</span>
                          </div>
                          {tooEarly && (
                            <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
                              ⏳ ผลจริงหลังแก้ยังสรุปไม่ได้ — มีข้อมูลหลังแก้ {r.afterDays || 0}/{MIN_AFTER_DAYS} วันผลิต · ตัวเลขนี้คือมูลค่าปัญหาก่อนแก้ ไม่ใช่ยอดที่ประหยัดแล้ว
                            </div>
                          )}
                          {/* breakdown DL/OH/DP โชว์ครบ 3 ก้อนเสมอ (ตกลง user 2026-08-11) — ก้อนที่ไม่เลือกขีดฆ่า ไม่เข้ายอดรวม */}
                          <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {RATE_COMPONENTS.map(c => (
                              <span key={c.key} style={{ textDecoration: costComps.includes(c.key) ? 'none' : 'line-through', opacity: costComps.includes(c.key) ? 1 : 0.5 }}>
                                {c.label} {fmtBaht(cs.comp[c.key])}
                              </span>
                            ))}
                            {imp.problem_source === 'defect' && <span>วัสดุ/Std {fmtBaht(cs.matPerDay)}</span>}
                            {imp.problem_source === 'mtn' && <span>ค่าซ่อมจริง {fmtBaht(cs.repairPerDay)}</span>}
                            <span style={{ color: 'var(--muted)' }}>(บาท/วัน)</span>
                          </div>
                          {imp.problem_source === 'defect' && cs.defectParts.length > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {cs.defectParts.map(p => (
                                <div key={p.mat || 'x'}>
                                  📦 {p.mat} · ลด {p.dQtyPerDay.toFixed(1)} ชิ้น/วัน × {fmtBaht(p.unit)} บาท/ชิ้น
                                  <span style={{ opacity: 0.8 }}> ({p.source === 'standard' ? 'standard cost' : 'วัสดุ+conversion'}{p.convMissing ? ' · ⚠ ไม่มี CT/rate — ยังไม่รวม conversion' : ''})</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {cs.invest > 0 && (
                            <div style={{ fontSize: 11, fontWeight: 700, color: cs.payback ? 'var(--accent)' : 'var(--muted)' }}>
                              🏗 ลงทุน {fmtBaht(cs.invest)} บาท{cs.payback ? ` → คืนทุน${tooEarly ? 'เร็วสุด (ถ้าแก้หายหมด)' : ''} ~${cs.payback < 10 ? cs.payback.toFixed(1) : Math.round(cs.payback)} เดือน` : ' — ยังไม่มี saving ให้คืนทุน'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── 🗓 แผนงานโปรเจค (milestone + gantt) — ตามงานทีมระหว่างทาง ไม่ใช่บันทึกทีเดียวจบ ── */}
                {(() => {
                  const ms = msByImp[imp.id] || [];
                  const doneCnt = ms.filter(m => m.status === 'done').length;
                  const nextMs = ms.find(m => m.status !== 'done');
                  const isOpen = !!ganttOpen[imp.id];
                  const today = todayStr();
                  // แกนเวลา gantt: ครอบทุก planned window + วันเริ่มโปรเจค + วันนี้
                  const dates = ms.flatMap(m => [m.planned_start, m.planned_end]).filter(Boolean).concat([imp.start_date, today]).sort();
                  const gStart = dates[0], gEnd = dates[dates.length - 1];
                  const spanMs = Math.max(1, new Date(`${gEnd}T00:00:00`) - new Date(`${gStart}T00:00:00`)) + 86400000;
                  const pctOf = (d) => Math.max(0, Math.min(100, ((new Date(`${d}T00:00:00`) - new Date(`${gStart}T00:00:00`)) / spanMs) * 100));
                  const stMeta = { todo: { c: '#8b8b96', l: 'รอเริ่ม' }, doing: { c: '#4d9fff', l: 'กำลังทำ' }, done: { c: '#22c55e', l: 'เสร็จ' } };
                  return (
                    <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg3)' }}>
                      <div onClick={() => setGanttOpen(p => ({ ...p, [imp.id]: !isOpen }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', userSelect: 'none' }}>
                        <span style={{ fontSize: 11, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--muted)' }}>▶</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>🗓 แผนงาน {ms.length ? `${doneCnt}/${ms.length} ขั้น` : '(ยังไม่วางแผน)'}</span>
                        {/* legend PDCA — บอกว่าแผนอิงหลักอะไร + ตัวอักษรสีตรงกับป้ายหน้าแต่ละขั้น */}
                        <span title={Object.values(PHASES).map(p => `${p.s} = ${p.label}`).join('\n')}
                          style={{ display: 'inline-flex', gap: 2, fontSize: 10, fontWeight: 900, flexShrink: 0 }}>
                          {Object.values(PHASES).map(p => <span key={p.s} style={{ color: p.c }}>{p.s}</span>)}
                        </span>
                        {ms.length > 0 && (
                          <div style={{ flex: 1, height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(doneCnt / ms.length) * 100}%`, height: '100%', background: '#22c55e', borderRadius: 3, transition: 'width 0.4s' }} />
                          </div>
                        )}
                        {nextMs && <span style={{ fontSize: 11, fontWeight: 700, color: '#4d9fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>ถัดไป: {nextMs.title}</span>}
                      </div>
                      {isOpen && (
                        <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {/* แถบวันที่หัว gantt */}
                          {ms.length > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', paddingLeft: 148 }}>
                              <span>{fmtDate(gStart)}</span><span>{fmtDate(gEnd)}</span>
                            </div>
                          )}
                          {ms.map(m => {
                            const meta = stMeta[m.status] || stMeta.todo;
                            const overdue = m.status !== 'done' && m.planned_end && m.planned_end < today;
                            const l = m.planned_start ? pctOf(m.planned_start) : 0;
                            const rgt = m.planned_end ? pctOf(addDays(m.planned_end, 1)) : l + 3;
                            return (
                              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {/* ป้ายสถานะกดวน todo→doing→done */}
                                <button className="tbtn" disabled={!canManage} onClick={() => cycleMilestone(m)}
                                  title={canManage ? 'กดเพื่อเปลี่ยนสถานะ' : ''}
                                  style={{ width: 142, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: canManage ? 'pointer' : 'default', padding: 0, textAlign: 'left' }}>
                                  <span style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: m.status === 'done' ? meta.c : 'transparent', border: `2px solid ${overdue ? '#ef4444' : meta.c}` }} />
                                  {/* ป้ายเฟส PDCA — จากคอลัมน์ phase (null = ขั้นที่ยังไม่ระบุเฟส โชว์ "–" ไม่เดาให้) */}
                                  {PHASES[m.phase]
                                    ? <span title={PHASES[m.phase].label} style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${PHASES[m.phase].c}26`, border: `1px solid ${PHASES[m.phase].c}`, color: PHASES[m.phase].c }}>{PHASES[m.phase].s}</span>
                                    : <span title="ยังไม่ระบุเฟส PDCA" style={{ width: 14, flexShrink: 0, fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>–</span>}
                                  <span title={`${m.title}${m.assignee ? ` · ${m.assignee}` : ''}${m.phase === 'check' ? '\n🤖 ขั้นนี้ระบบเทียบผลก่อน/หลังจากข้อมูลจริงให้อัตโนมัติ (แผงผลบนการ์ด)' : ''}`} style={{ fontSize: 11, fontWeight: 700, color: overdue ? '#ef4444' : 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: m.status === 'done' ? 'line-through' : 'none', opacity: m.status === 'done' ? 0.65 : 1 }}>{m.phase === 'check' ? '🤖 ' : ''}{m.title}</span>
                                </button>
                                {/* แถบ gantt ตามแผน */}
                                <div style={{ flex: 1, position: 'relative', height: 16, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden' }}>
                                  {/* เส้นวันนี้ — playhead ชมพูตาม convention */}
                                  {/* เส้นวันนี้ใช้ class กลาง .now-line (index.css) — ได้ [data-perf="lite"] override บนจอ TV
                                      ห้ามวาด playhead เองด้วย inline boxShadow (UI-CONVENTIONS §6 · QC audit 2026-08-03) */}
                                  <div className="now-line" style={{ left: `${pctOf(today)}%` }} />
                                  {(m.planned_start || m.planned_end) && (
                                    <div title={`${m.title}\nแผน ${fmtDate(m.planned_start)} – ${fmtDate(m.planned_end)}${m.done_at ? `\nเสร็จจริง ${fmtDate(m.done_at)}` : ''}${m.assignee ? `\nผู้รับผิดชอบ: ${m.assignee}` : ''}`}
                                      style={{ position: 'absolute', top: 2, bottom: 2, left: `${l}%`, width: `${Math.max(rgt - l, 1.5)}%`, borderRadius: 4, background: `${overdue ? '#ef4444' : meta.c}${m.status === 'done' ? 'cc' : '77'}`, border: `1px solid ${overdue ? '#ef4444' : meta.c}` }} />
                                  )}
                                  {m.done_at && (
                                    <div title={`เสร็จจริง ${fmtDate(m.done_at)}`} style={{ position: 'absolute', top: 1, left: `calc(${pctOf(m.done_at)}% - 4px)`, fontSize: 11, lineHeight: 1, zIndex: 3 }}>✅</div>
                                  )}
                                </div>
                                <span style={{ width: 64, flexShrink: 0, fontSize: 11, fontWeight: 700, color: overdue ? '#ef4444' : meta.c, textAlign: 'right' }}>{overdue ? '⚠ เลยแผน' : meta.l}</span>
                                {canManage && (
                                  <button className="tbtn" onClick={() => deleteMilestone(m)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: 0, flexShrink: 0 }}>✕</button>
                                )}
                              </div>
                            );
                          })}
                          {/* เพิ่มขั้นงาน */}
                          {canManage && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                              {/* width กัน index.css input{width:100%} ดันแถวแตก (กับดัก CSS ใน CLAUDE.md) */}
                              <input placeholder="ขั้นงานใหม่ เช่น สั่งทำ jig ใหม่" value={msDraft[imp.id]?.title || ''}
                                onChange={e => setMsDraft(p => ({ ...p, [imp.id]: { ...p[imp.id], title: e.target.value } }))}
                                style={{ width: 170, padding: '5px 8px', fontSize: 11, borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                              {/* เฟส PDCA ของขั้นใหม่ — ไม่เลือก = "–" (ไม่เดาให้) */}
                              <select value={msDraft[imp.id]?.phase || ''} title="เฟส PDCA ของขั้นนี้"
                                onChange={e => setMsDraft(p => ({ ...p, [imp.id]: { ...p[imp.id], phase: e.target.value } }))}
                                style={{ width: 92, padding: '4px 6px', fontSize: 11, borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                                <option value="">เฟส —</option>
                                {Object.entries(PHASES).map(([k, p]) => <option key={k} value={k}>{p.s} · {p.label.split(' — ')[0]}</option>)}
                              </select>
                              <input placeholder="ผู้รับผิดชอบ" value={msDraft[imp.id]?.assignee || ''}
                                onChange={e => setMsDraft(p => ({ ...p, [imp.id]: { ...p[imp.id], assignee: e.target.value } }))}
                                style={{ width: 100, padding: '5px 8px', fontSize: 11, borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                              <input type="date" value={msDraft[imp.id]?.planned_start || ''}
                                onChange={e => setMsDraft(p => ({ ...p, [imp.id]: { ...p[imp.id], planned_start: e.target.value } }))}
                                style={{ width: 125, padding: '4px 6px', fontSize: 11, borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                              <input type="date" value={msDraft[imp.id]?.planned_end || ''}
                                onChange={e => setMsDraft(p => ({ ...p, [imp.id]: { ...p[imp.id], planned_end: e.target.value } }))}
                                style={{ width: 125, padding: '4px 6px', fontSize: 11, borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                              <button onClick={() => addMilestone(imp.id)}
                                style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#4d9fff', color: '#08131f', fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>➕ เพิ่มขั้น</button>
                            </div>
                          )}
                          {ms.length === 0 && !canManage && <div style={{ fontSize: 11, color: 'var(--muted)' }}>ยังไม่มีแผนงาน</div>}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* footer actions */}
                <div style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 'auto' }}>{imp.created_by_name ? `โดย ${imp.created_by_name}` : ''}</span>
                  {canManage && imp.status === 'monitoring' && (
                    <>
                      <button onClick={() => setCloseModal({ imp, note: '', peImpact: null })} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>✅ ปิดจ๊อบ</button>
                      <button onClick={() => setStatus(imp, 'cancelled')} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>✖ ยกเลิก</button>
                    </>
                  )}
                  {canManage && imp.status !== 'monitoring' && (
                    <button onClick={() => setStatus(imp, 'monitoring', imp.result_note)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>👁 ติดตามต่อ</button>
                  )}
                  {/* 📐 คำขอแก้เอกสาร PE — เข้าได้ทุกเมื่อ (ดูสถานะคำขอ/เสนอเพิ่ม) ไม่ใช่ one-shot ตอนปิดจ๊อบ */}
                  <button onClick={() => setPeModal(imp)} title="เสนอ/ดูคำขอแก้ PFMEA · Control Plan จากโปรเจคนี้" style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>📐 PE</button>
                  {canManage && <button onClick={() => openEdit(imp)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>✏️ แก้ไข</button>}
                  {canDel && <button onClick={() => handleDelete(imp)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>🗑</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── modal สร้าง/แก้ไข (ฟอร์ม — ห้ามปิดจาก backdrop ตาม UI-CONVENTIONS §5) ── */}
      {modal && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(1150px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{modal.id ? '✏️ แก้ไขโปรเจคปรับปรุง' : '➕ เพิ่มโปรเจคปรับปรุง'}</h3>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 16 }}>
              {/* ซ้าย: ข้อมูลโปรเจค */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ชื่อโปรเจค *
                  <input value={modal.title} onChange={e => setModal({ ...modal, title: e.target.value })} placeholder="เช่น ลดดาวไทม์แม่พิมพ์ติดขัด HDF1" style={{ marginTop: 4 }} />
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>ไลน์ *
                    <select value={modal.line_name} onChange={e => setModal({ ...modal, line_name: e.target.value, machine_no: '', mat_no: '' })} style={{ marginTop: 4 }}>
                      <option value="">— เลือกไลน์ —</option>
                      {lineOptions.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>ประเภทปัญหา *
                    <select value={modal.problem_source} onChange={e => setModal({ ...modal, problem_source: e.target.value, problem_type_id: '', problem_label: '' })} style={{ marginTop: 4 }}>
                      <option value="downtime">🛑 Downtime</option>
                      <option value="defect">🔍 ของเสีย/คุณภาพ</option>
                      <option value="mtn">🛠️ ใบซ่อม MTN</option>
                    </select>
                  </label>
                </div>
                {modal.problem_source === 'mtn' ? (
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ลักษณะปัญหา (จากใบซ่อม MTN)
                    <select value={modal.problem_label || ''} onChange={e => setModal({ ...modal, problem_label: e.target.value, problem_type_id: '' })} style={{ marginTop: 4 }}>
                      <option value="">— ทุกอาการ —</option>
                      {mtnProblemTypes.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                ) : (
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ปัญหาที่แก้ (จาก master {modal.problem_source === 'defect' ? 'ของเสีย' : 'Downtime'})
                    <select value={modal.problem_type_id} onChange={e => setModal({ ...modal, problem_type_id: e.target.value })} style={{ marginTop: 4 }}>
                      <option value="">— ทุกประเภท —</option>
                      {typeOpts.map(t => <option key={t.id} value={t.id}>{t.name_th}</option>)}
                    </select>
                  </label>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>เครื่องจักร/จุดงาน
                    <select value={modal.machine_no || ''} onChange={e => setModal({ ...modal, machine_no: e.target.value })} style={{ marginTop: 4 }}>
                      <option value="">— ทั้งไลน์ —</option>
                      {/* ค่าที่ตั้งไว้แต่ไม่มีในทะเบียน (เช่นชื่อที่พิมพ์ในบันทึก downtime) ต้องยังแสดงได้ —
                          ไม่งั้น select โชว์ "ทั้งไลน์" ทั้งที่ state กรองรายเครื่องอยู่ = โกหกคนอ่าน */}
                      {modal.machine_no && !machineOpts.some(m => m.machine_no === modal.machine_no) && (
                        <option value={modal.machine_no}>⚠ {modal.machine_no} · ตามที่บันทึกไว้ (ไม่มีในทะเบียนเครื่องของไลน์นี้)</option>
                      )}
                      {machineOpts.map(m => <option key={m.id} value={m.machine_no}>{m.machine_no} {m.machine_name ? `· ${m.machine_name}` : ''}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>สินค้า
                    <select value={modal.mat_no || ''} onChange={e => setModal({ ...modal, mat_no: e.target.value })} style={{ marginTop: 4 }}>
                      <option value="">— ทุกสินค้า —</option>
                      {productOpts.map(p => <option key={p.id} value={p.mat_no}>{p.mat_no} · {p.name}</option>)}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }} title="จุดตัดเทียบก่อน/หลัง — ถ้ายังไม่ได้ลงมือจริง ระบบจะเลื่อนให้ตอนกดเริ่มขั้น Do">วันเริ่มแก้ไข * <span style={{ fontWeight: 600, fontSize: 11 }}>(= จุดตัดเทียบก่อน/หลัง)</span>
                    {/* width กัน index.css input{width:100%} (กับดัก CSS ใน CLAUDE.md) */}
                    <input type="date" value={modal.start_date} onChange={e => setModal({ ...modal, start_date: e.target.value })} style={{ marginTop: 4, width: 150, display: 'block' }} />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>หน้าต่างเทียบผล
                    <select value={modal.baseline_days} onChange={e => setModal({ ...modal, baseline_days: e.target.value })} style={{ marginTop: 4, width: 130, display: 'block' }}>
                      {[14, 30, 60, 90].map(d => <option key={d} value={d}>{d} วัน</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>เงินลงทุน (บาท)
                    {/* ใช้คิดระยะคืนทุนเทียบ cost saving/เดือน — ไม่บังคับ */}
                    <input type="number" min="0" step="any" value={modal.invest_cost ?? ''} onChange={e => setModal({ ...modal, invest_cost: e.target.value })}
                      placeholder="ค่าอะไหล่/จิ๊ก/ปรับปรุง" style={{ marginTop: 4, width: 150, display: 'block' }} />
                  </label>
                </div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>สภาพปัญหา/สาเหตุ
                  <textarea value={modal.description || ''} onChange={e => setModal({ ...modal, description: e.target.value })} rows={2} style={{ marginTop: 4 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>การแก้ไข (Action)
                  <span style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 11 }}> — ยังวิเคราะห์อยู่ก็เว้นได้ การ์ดจะชวนกรอกตอนกดเริ่มขั้น Do (แยกจังหวะ Plan/Do ตามหลัก PDCA)</span>
                  <textarea value={modal.action_taken || ''} onChange={e => setModal({ ...modal, action_taken: e.target.value })} rows={2} style={{ marginTop: 4 }} />
                </label>
                <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[['before', 'รูปก่อนแก้ไข', beforeFile, setBeforeFile, modal.image_before_url],
                    ['after', 'รูปหลังแก้ไข', afterFile, setAfterFile, modal.image_after_url]].map(([key, label, file, setFile, existing]) => (
                    <div key={key}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                      {(file || existing) && (
                        <img src={file ? URL.createObjectURL(file) : existing} alt={label} style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 4 }} />
                      )}
                      <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 11 }} />
                    </div>
                  ))}
                </div>
              </div>
              {/* ขวา: Pareto ปัญหา Top — คลิกเลือกเป็นเป้า */}
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, alignSelf: 'start' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>
                  🔝 พาเรโต้ {modal.problem_source === 'defect' ? 'ของเสีย' : modal.problem_source === 'mtn' ? 'ใบซ่อม MTN' : 'Downtime'} · {modal.line_name || 'เลือกไลน์ก่อน'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>ย้อนหลัง {modal.baseline_days} วัน — คลิกปัญหาเพื่อตั้งเป็นเป้าโปรเจค</div>
                {pareto.loading ? (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>กำลังโหลด...</div>
                ) : pareto.rows.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>ไม่พบข้อมูลในช่วงนี้</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {pareto.rows.map((row, i) => {
                      const max = Math.max(...pareto.rows.map(r => r.value)) || 1;
                      const isMtn = modal.problem_source === 'mtn';
                      const tn = isMtn ? row.label : (typeOpts.find(t => t.id === row.type_id)?.name_th || 'ไม่ระบุประเภท');
                      const selected = isMtn
                        ? (modal.problem_label || '') === (row.label === 'ทุกอาการ' ? '' : row.label) && sameMc(modal.machine_no, row.machine_no)
                        : modal.problem_type_id === (row.type_id || '') && (modal.problem_source === 'downtime' ? sameMc(modal.machine_no, row.machine_no) : (modal.mat_no || '') === row.mat_no);
                      // งานในแผน (5ส./นับสต็อก ฯลฯ) = priority รอง: จางลง แถบเทา + ป้ายกำกับ — ไม่ใช่เป้าหลักของ Kaizen
                      const barColor = row.planned ? '#94a3b8' : isMtn ? '#f59e0b' : '#ef4444';
                      return (
                        <button key={i} onClick={() => {
                          // เติมหมายเลขเครื่องเป็นชื่อตามทะเบียน (จับคู่แบบ normCode) — ให้ dropdown แสดงได้
                          const mc = canonMc(row.machine_no);
                          setModal({
                            ...modal,
                            ...(isMtn
                              ? { problem_label: row.label === 'ทุกอาการ' ? '' : row.label, problem_type_id: '', machine_no: mc }
                              : { problem_type_id: row.type_id || '', problem_label: tn, ...(modal.problem_source === 'downtime' ? { machine_no: mc } : { mat_no: row.mat_no || '' }) }),
                            title: modal.title || (isMtn ? `ลดใบซ่อม ${tn} ${mc}`.trim() : `ลด${modal.problem_source === 'defect' ? 'ของเสีย' : 'ดาวไทม์'} ${tn} ${(modal.problem_source === 'downtime' ? mc : row.mat_no) || ''}`.trim()),
                          });
                        }} style={{
                          textAlign: 'left', padding: '6px 8px', borderRadius: 7, cursor: 'pointer',
                          border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                          background: selected ? 'var(--accent-dim)' : 'var(--bg)',
                          opacity: row.planned ? 0.62 : 1,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {i + 1}. {tn}{row.machine_no ? ` · ⚙️${row.machine_no}` : ''}{row.mat_no ? ` · 📦${row.mat_no}` : ''}
                              {row.planned && <span style={{ marginLeft: 5, fontSize: 11, fontWeight: 700, color: '#94a3b8', background: 'rgba(148,163,184,0.15)', borderRadius: 4, padding: '0 5px' }}>📅 ในแผน</span>}
                            </span>
                            <span style={{ color: barColor, flexShrink: 0 }}>{modal.problem_source === 'mtn' ? `${row.value} ใบ · ${row.mins} นาที` : `${row.value.toFixed(0)} ${modal.problem_source === 'defect' ? 'ชิ้น' : 'นาที'} · ${row.count} ครั้ง`}</span>
                          </div>
                          <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, marginTop: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(row.value / max) * 100}%`, height: '100%', background: barColor, borderRadius: 3 }} />
                          </div>
                          {/* note ของพนักงาน — ตัวบอกปัญหาจริงโดยเฉพาะประเภท "อื่นๆ" ที่ชื่อประเภทบอกอะไรไม่ได้ */}
                          {row.topDescs?.length > 0 && (
                            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}
                              title={row.topDescs.map(([d, n]) => `${d} (×${n})`).join('\n')}>
                              {row.topDescs.map(([d, n], di) => (
                                <div key={di} style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  💬 {d}{n > 1 ? ` (×${n})` : ''}
                                </div>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setModal(null)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
              <button disabled={saving} onClick={handleSave} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── modal "เริ่มลงมือแก้จริง" (จังหวะ 2 — เข้าจากแถบ 🚀 บนการ์ด หรือติ๊กเริ่มขั้น Do ในแผน) ── */}
      {doModal && (
        <div className="overlay">
          <div className="modal">
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>🚀 เริ่มลงมือแก้ — "{doModal.imp.title}"</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.55 }}>
              วันเริ่มแก้คือ<b>จุดตัดเทียบก่อน/หลัง</b> — ตั้งเป็นวันที่ลงมือจริง ตัวเลข % ลด/Cost Saving ถึงจะแม่น
              (ปล่อยเป็นวันเปิดโปรเจคทั้งที่ยังวิเคราะห์อยู่ = ช่วง "หลังแก้" ปนวันที่ยังไม่ได้แก้)
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>การแก้ไขที่ลงมือทำ (Action) *
              <textarea value={doModal.action} onChange={e => setDoModal({ ...doModal, action: e.target.value })} rows={3}
                placeholder="เช่น แก้ JOB ROBOT จุดเชื่อม 12 · เปลี่ยน Reed sensor + ย้ายตำแหน่ง bracket" style={{ marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginTop: 8 }}>วันเริ่มแก้จริง *
              {/* width กัน index.css input{width:100%} */}
              <input type="date" value={doModal.date} onChange={e => setDoModal({ ...doModal, date: e.target.value })} style={{ marginTop: 4, width: 150, display: 'block' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setDoModal(null)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>ไว้ก่อน</button>
              <button onClick={saveDoStart} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#1b1204', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>🚀 บันทึกเริ่มลงมือ</button>
            </div>
          </div>
        </div>
      )}

      {/* ── modal คำขอแก้เอกสาร PE (ลูปปิด Improvement → PFMEA/CP — ขั้น Act) ──
          reuse PeChangeRequests mode="source" ตัวเดียวกับโมดัล 8D · ref_kind='improvement'
          (vocabulary ขยายแล้ว — migration 20260819_pe_ref_kind_improvement_main) */}
      {peModal && (
        <div className="overlay" onClick={() => setPeModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '86vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>📐 เอกสาร PE — "{peModal.title}"</h3>
              <button onClick={() => setPeModal(null)} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <PeChangeRequests
              mode="source"
              canPropose={canManage}
              canDecide={false}
              source={{
                kind: 'improvement', id: peModal.id, label: peModal.title,
                partNo: peModal.mat_no || null, lineName: peModal.line_name,
                symptom: [peModal.problem_label, peModal.description].filter(Boolean).join(' — '),
                rootCause: peModal.description || '',
                corrective: peModal.action_taken || '',
                isCustomer: false,
              }}
            />
          </div>
        </div>
      )}

      {/* ── modal ปิดจ๊อบ + สรุปผล ── */}
      {closeModal && (
        <div className="overlay">
          <div className="modal">
            <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>✅ ปิดโปรเจค "{closeModal.imp.title}"</h3>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>สรุปผลการปรับปรุง
              <textarea value={closeModal.note} onChange={e => setCloseModal({ ...closeModal, note: e.target.value })} rows={3} placeholder="เช่น ดาวไทม์ลดลง 70% หลังเปลี่ยน jig ใหม่" style={{ marginTop: 4 }} />
            </label>
            {/* ── soft gate ขั้น Act (2026-08-19): การแก้วิธีการ/จิ๊ก/พารามิเตอร์ = process change ที่ IATF
                ต้องทบทวน PFMEA/Control Plan — บังคับให้ "ตอบ" ก่อนปิด แต่ไม่บังคับให้แก้เอกสารเสร็จ
                (หลักเดียวกับด่านปิด D8 — แข็งเกินไปคนจะเลี่ยงด้วยการไม่เปิดโปรเจคเลย ซึ่งแย่กว่า) ── */}
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>📐 การแก้ไขนี้กระทบเอกสาร PE (PFMEA / Control Plan) ไหม?</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                {[['yes', 'กระทบ — เสนอคำขอแก้เข้ากล่อง PE'], ['no', 'ไม่กระทบ']].map(([v, l]) => (
                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
                    <input type="radio" name="peImpact" checked={closeModal.peImpact === v} onChange={() => setCloseModal({ ...closeModal, peImpact: v })} />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setCloseModal(null)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>ยกเลิก</button>
              <button disabled={!closeModal.peImpact}
                title={closeModal.peImpact ? '' : 'ตอบก่อนว่ากระทบเอกสาร PE ไหม (ขั้น Act ของ PDCA)'}
                onClick={() => {
                  setStatus(closeModal.imp, 'done', closeModal.note.trim() || null);
                  if (closeModal.peImpact === 'yes') setPeModal(closeModal.imp);
                  setCloseModal(null);
                }}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: closeModal.peImpact ? '#22c55e' : 'var(--bg3)', color: closeModal.peImpact ? '#08130a' : 'var(--muted)', fontWeight: 800, fontSize: 12, cursor: closeModal.peImpact ? 'pointer' : 'not-allowed' }}>✅ ปิดจ๊อบ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
