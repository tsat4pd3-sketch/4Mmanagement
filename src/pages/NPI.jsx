import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import PageHeader from '../components/PageHeader';
import ReadOnlyNote from '../components/ReadOnlyNote';
import InfoMore from '../components/InfoMore';
import LineSelect from '../components/LineSelect';
import useTabParam from '../utils/useTabParam';
import { todayLocal, fmtDate } from '../utils/dateFormat';
import { loadDocForms } from '../utils/docForms';
import {
  PROJECT_STATUS, PART_STATUS, PPAP_STATUS, LIGHT,
  partRollup, projectRollup, buildPartRows, daysBetween, nextProjectCode,
  toolingRollup,
} from '../utils/npi';
import { inp, card, btn, ghost, thSt, tdSt, Field, Pill, LightDot, MetaSelect, Modal, WarnBar } from '../components/NpiUi';
import NpiPartPanel from '../components/NpiPartPanel';
import NpiDrawingsEci from '../components/NpiDrawingsEci';
import NpiTooling from '../components/NpiTooling';
import NpiTasks from '../components/NpiTasks';
import NpiTemplates from '../components/NpiTemplates';

/* ═══════════════════════════════════════════════════════════════════════════
   🚀 NPI — พาร์ทใหม่: APQP / PPAP / Drawing Rev / ECI / Tooling Plan — /npi
   2026-09-07 · แบบเต็ม + กฎ: docs/modules/npi-apqp.md

   ทำอะไร: ติดตามพาร์ทรุ่นใหม่ตั้งแต่รับงานถึง SOP (ช่วง "ต้นน้ำ" ก่อน mass production ที่ ESM ที่เหลือคุมอยู่)
     📊 บอร์ด     — ทุกโปรเจค + ตารางพาร์ท × เฟส เป็นไฟสี (Obeya)
     📦 พาร์ท     — เอกสารส่งมอบต่อเฟส (= ทะเบียน PPAP) · ผูกชุด PFC/FMEA/CP · มาตรฐานตรวจ QA
     📐 แบบ & ECI — ทะเบียน revision แบบ 2D/3D + ECI ที่ต้องปิดครบทุกขา (แบบ/PE/4M/tooling)
     🔧 Tooling   — แผนทำแม่พิมพ์/จิ๊ก/CF/เกจ เป็น Gantt · transfer แล้วผูก die_sets
     ✅ งาน       — มอบหมาย + แจ้งเตือนเข้ากระดิ่งคนนั้น
     ⚙️ แม่แบบ   — เฟส/รายการเอกสารต่อลูกค้า (data-driven · gate npi:manage_templates)

   ใครใช้: PE (เจ้าของ) · QA · หัวหน้าผลิต · แพลนนิ่ง · ผู้จัดการ (ดู)
   ข้อจำกัด/ห้าม:
     · ตารางทั้งหมดอยู่ Main project (auth) — ห้ามย้ายไป DR (เฟส 4 จะเปิดให้ supplier ภายนอก login)
     · ไฟสี/สรุปคำนวณจาก src/utils/npi.js เท่านั้น ห้ามคิดสูตรใหม่ในหน้า
     · ไม่มี supplier master (เฟส 4) — ผู้ทำแม่พิมพ์เป็น text ไปก่อน
     · ไฟล์ 3D ไม่เก็บใน storage (ใส่ลิงก์) — ไม่มี viewer + ไฟล์ใหญ่
   ═══════════════════════════════════════════════════════════════════════════ */

const TABS_BASE = [
  { key: 'board',    label: '📊 บอร์ด' },
  { key: 'parts',    label: '📦 พาร์ท & PPAP' },
  { key: 'drawings', label: '📐 แบบ & ECI' },
  { key: 'tooling',  label: '🔧 Tooling' },
  { key: 'tasks',    label: '✅ งาน' },
  { key: 'templates', label: '⚙️ แม่แบบ' },
];
const ALL_KEYS = TABS_BASE.map(t => t.key);

/* ดึงทุกแถวแบบแบ่งหน้า — Supabase ตัด 1000 แถว/query · เอกสารส่งมอบ 36 รายการ/พาร์ท × 30 พาร์ท ก็เกินแล้ว
   (กฎ §7: ตารางที่โตได้ต้อง paginate ไม่งั้นบอร์ดรวมนับขาดเงียบๆ) */
async function fetchAll(table, select) {
  const PAGE = 1000, rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(select).order('id').range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: rows, error: null };
}

const emptyProject = { project_code: '', name: '', customer: '', model: '', template_id: '', kickoff_date: '', sop_date: '', status: 'planning', leader_name: '', description: '' };
const emptyPart = { part_no: '', part_name: '', mat_no: '', line_name: '', pe_set_id: '', qa_part_id: '', ppap_level: 3, owner_name: '', remark: '' };

export default function NPI() {
  const { role, fullName, lineId, sections } = useContext(UserContext);
  const canEdit = can('npi', 'edit', role);
  const canApprove = can('npi', 'approve', role);
  const canTemplates = can('npi', 'manage_templates', role);
  const [tab, setTab] = useTabParam(ALL_KEYS, 'board');
  const [sp, setSp] = useSearchParams();
  const projectId = sp.get('project') || '';
  const partParam = sp.get('part') || '';
  const today = todayLocal();

  // ── master / ทะเบียน ──
  const [templates, setTemplates] = useState([]);          // [{...t, phases, delivs}]
  const [projects, setProjects] = useState([]);
  const [peSets, setPeSets] = useState([]);
  const [qaParts, setQaParts] = useState([]);
  const [lines, setLines] = useState([]);
  const [users, setUsers] = useState([]);
  const [stepTemplates, setStepTemplates] = useState([]);
  const [dieSets, setDieSets] = useState([]);
  // ── ข้อมูลของโปรเจคที่เลือก ──
  const [parts, setParts] = useState([]);
  const [phases, setPhases] = useState([]);
  const [delivs, setDelivs] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [ecis, setEcis] = useState([]);
  const [tooling, setTooling] = useState([]);
  const [steps, setSteps] = useState([]);
  const [allDelivs, setAllDelivs] = useState([]);            // ทุกโปรเจค — ใช้บอร์ดรวม
  const [allPhases, setAllPhases] = useState([]);
  const [allParts, setAllParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warn, setWarn] = useState('');
  const [projModal, setProjModal] = useState(null);
  const [partModal, setPartModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [partIdRaw, setPartId] = useState(partParam);

  const setProject = useCallback((id, opts) => {
    const next = new URLSearchParams(sp);
    if (id) next.set('project', id); else next.delete('project');
    next.delete('part');
    setSp(next, { replace: !!opts?.replace });
  }, [sp, setSp]);

  /* ── โหลด master ครั้งเดียว ── */
  const loadMaster = useCallback(async () => {
    setLoading(true);
    const w = [];
    const [t, tp, td, pj, ps, qp, ln, us, st, ds, ap, aph, adv] = await Promise.all([
      supabase.from('npi_templates').select('*').order('sort'),
      supabase.from('npi_template_phases').select('*').order('seq'),
      supabase.from('npi_template_deliverables').select('*').order('seq'),
      supabase.from('npi_projects').select('*').order('created_at', { ascending: false }),
      supabase.from('pe_doc_sets').select('id, part_no, part_name, model, customer, line_name, mat_no').order('part_no'),
      supabase.from('qa_parts').select('id, part_no, part_name').eq('is_active', true).order('part_no'),
      supabase.from('production_lines').select('id, name, section, parent_line_name, is_active').order('name'),
      supabase.rpc('list_mention_users'),
      supabase.from('npi_tooling_step_templates').select('*').eq('is_active', true).order('tool_kind').order('seq'),
      supabaseDR.from('die_sets').select('set_code, part_no, model').eq('is_active', true).order('set_code'),
      fetchAll('npi_parts', '*'),
      fetchAll('npi_part_phases', '*'),
      fetchAll('npi_deliverables', 'id, part_id, phase_code, status, due_date, ppap_element'),
    ]);
    if (t.error || pj.error || adv.error) w.push(`โหลดทะเบียน NPI ไม่ได้ (${(t.error || pj.error || adv.error).message}) — ยังไม่ apply migration 20260907_npi_apqp_main (Main) ?`);
    if (ps.error) w.push('โหลดชุดเอกสาร PE ไม่ได้');
    if (us.error) w.push('โหลดรายชื่อผู้ใช้ไม่ได้ (มอบหมายงานไม่ได้)');
    setTemplates((t.data || []).map(x => ({
      ...x,
      phases: (tp.data || []).filter(p => p.template_id === x.id),
      delivs: (td.data || []).filter(d => d.template_id === x.id),
    })));
    setProjects(pj.data || []);
    setPeSets(ps.data || []);
    setQaParts(qp.data || []);
    setLines(ln.data || []);
    setUsers(us.data || []);
    setStepTemplates(st.data || []);
    setDieSets(ds.data || []);
    setAllParts(ap.data || []);
    setAllPhases(aph.data || []);
    setAllDelivs(adv.data || []);
    setWarn(w.join(' · '));
    setLoading(false);
  }, []);
  useEffect(() => { loadMaster(); loadDocForms(); }, [loadMaster]);

  /* ── โหลดข้อมูลโปรเจคที่เลือก ── */
  const loadProject = useCallback(async (id) => {
    if (!id) { setParts([]); setPhases([]); setDelivs([]); setTasks([]); setDrawings([]); setEcis([]); setTooling([]); setSteps([]); return; }
    const { data: p, error } = await supabase.from('npi_parts').select('*').eq('project_id', id).order('part_no');
    if (error) { toast.error(`โหลดพาร์ทไม่ได้: ${error.message}`); return; }
    const ids = (p || []).map(x => x.id);
    const [ph, dv, tk, dw, ec, tl] = await Promise.all([
      ids.length ? supabase.from('npi_part_phases').select('*').in('part_id', ids).order('seq') : { data: [] },
      ids.length ? supabase.from('npi_deliverables').select('*').in('part_id', ids).order('seq') : { data: [] },
      supabase.from('npi_tasks').select('*').eq('project_id', id).order('due_date', { nullsFirst: false }).order('created_at'),
      ids.length ? supabase.from('npi_drawing_revisions').select('*').in('part_id', ids).order('created_at', { ascending: false }) : { data: [] },
      supabase.from('npi_change_requests').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      ids.length ? supabase.from('npi_tooling_plans').select('*').in('part_id', ids).order('plan_start', { nullsFirst: false }) : { data: [] },
    ]);
    const tids = (tl.data || []).map(x => x.id);
    const st = tids.length ? await supabase.from('npi_tooling_steps').select('*').in('tooling_id', tids).order('seq') : { data: [] };
    setParts(p || []); setPhases(ph.data || []); setDelivs(dv.data || []); setTasks(tk.data || []);
    setDrawings(dw.data || []); setEcis(ec.data || []); setTooling(tl.data || []); setSteps(st.data || []);
  }, []);
  useEffect(() => { loadProject(projectId); }, [projectId, loadProject]);
  // reload ทั้งคู่หลังเขียน (บอร์ดรวมใช้ allParts/allDelivs)
  const reload = useCallback(async () => { await Promise.all([loadProject(projectId), loadMaster()]); }, [loadProject, loadMaster, projectId]);

  // พาร์ทที่เลือกต้องอยู่ในโปรเจคปัจจุบัน — derive แทน sync ด้วย effect (เปลี่ยนโปรเจคแล้วค่าเก่าหลุดเอง)
  const partId = parts.some(p => p.id === partIdRaw) ? partIdRaw : '';

  const project = projects.find(p => p.id === projectId) || null;
  const template = project ? templates.find(t => t.id === project.template_id) : null;
  const tplPhases = useMemo(() => [...(template?.phases || [])].sort((a, b) => a.seq - b.seq), [template]);

  /* ── rollups (สูตรกลาง) ── */
  const rollByPart = useMemo(() => {
    const m = {};
    parts.forEach(p => { m[p.id] = partRollup(p, phases.filter(x => x.part_id === p.id), delivs.filter(x => x.part_id === p.id), today); });
    return m;
  }, [parts, phases, delivs, today]);
  const rollByProject = useMemo(() => {
    const m = {};
    projects.forEach(pj => {
      const ps = allParts.filter(p => p.project_id === pj.id);
      m[pj.id] = projectRollup(ps.map(p => partRollup(p, allPhases.filter(x => x.part_id === p.id), allDelivs.filter(x => x.part_id === p.id), today)));
    });
    return m;
  }, [projects, allParts, allPhases, allDelivs, today]);

  /* ── CRUD โปรเจค ── */
  const saveProject = async () => {
    const m = projModal;
    if (!m.name.trim()) return toast.error('กรอกชื่อโปรเจค');
    if (!m.template_id) return toast.error('เลือกแม่แบบเฟส (ลูกค้า)');
    setSaving(true);
    const row = {
      project_code: m.project_code?.trim() || nextProjectCode(projects.map(p => p.project_code), today),
      name: m.name.trim(), customer: m.customer?.trim() || null, model: m.model?.trim() || null,
      template_id: m.template_id, kickoff_date: m.kickoff_date || null, sop_date: m.sop_date || null,
      status: m.status, leader_name: m.leader_name?.trim() || null, description: m.description?.trim() || null,
    };
    let res;
    if (m.id) res = await supabase.from('npi_projects').update(row).eq('id', m.id).select().single();
    else res = await supabase.from('npi_projects').insert({ ...row, created_by_name: fullName || null }).select().single();
    setSaving(false);
    if (res.error) return toast.error(`บันทึกไม่สำเร็จ: ${res.error.message}`);
    toast.success('บันทึกโปรเจคแล้ว');
    setProjModal(null);
    await loadMaster();
    if (!m.id) setProject(res.data.id, { replace: true });
  };
  const delProject = async (pj) => {
    if (!window.confirm(`ลบโปรเจค ${pj.project_code} ${pj.name} พร้อมพาร์ท/เอกสาร/ECI/tooling ทั้งหมด?\n(ถ้าแค่หยุดทำ ให้เปลี่ยนสถานะเป็น "ยกเลิก" แทน)`)) return;
    const { error } = await supabase.from('npi_projects').delete().eq('id', pj.id);
    if (error) return toast.error(error.message);
    toast.success('ลบแล้ว'); setProject('', { replace: true }); loadMaster();
  };

  /* ── CRUD พาร์ท ── */
  const pickPeSet = (id) => {
    const s = peSets.find(x => x.id === id);
    setPartModal(m => ({ ...m, pe_set_id: id,
      part_no: m.part_no || s?.part_no || '', part_name: m.part_name || s?.part_name || '',
      mat_no: m.mat_no || s?.mat_no || '', line_name: m.line_name || s?.line_name || '' }));
  };
  const savePart = async () => {
    const m = partModal;
    if (!m.part_no.trim()) return toast.error('กรอก Part No.');
    if (!project) return;
    setSaving(true);
    const row = {
      part_no: m.part_no.trim(), part_name: m.part_name?.trim() || null, mat_no: m.mat_no?.trim() || null,
      line_name: m.line_name || null, pe_set_id: m.pe_set_id || null, qa_part_id: m.qa_part_id || null,
      ppap_level: Number(m.ppap_level) || 3, owner_name: m.owner_name?.trim() || null, remark: m.remark?.trim() || null,
    };
    let res;
    if (m.id) res = await supabase.from('npi_parts').update(row).eq('id', m.id).select().single();
    else res = await supabase.from('npi_parts').insert({ ...row, project_id: project.id }).select().single();
    if (res.error) { setSaving(false); return toast.error(`บันทึกไม่สำเร็จ: ${res.error.message}`); }
    if (!m.id) {
      // instantiate เฟส + เอกสารส่งมอบจากแม่แบบ (snapshot) — วันแผนกระจายจาก kickoff→SOP ถ้ารู้
      const { phaseRows, delivRows } = buildPartRows({
        partId: res.data.id, templatePhases: template?.phases || [], templateDelivs: template?.delivs || [],
        sopDate: project.sop_date, kickoffDate: project.kickoff_date,
      });
      const e1 = phaseRows.length ? (await supabase.from('npi_part_phases').insert(phaseRows)).error : null;
      const e2 = delivRows.length ? (await supabase.from('npi_deliverables').insert(delivRows)).error : null;
      if (e1 || e2) toast.error(`สร้างพาร์ทแล้ว แต่สร้างเฟส/รายการเอกสารจากแม่แบบไม่ครบ: ${(e1 || e2).message} — กด 🔄 sync แม่แบบ ในแผงพาร์ท`);
      else if (!template?.phases?.length) toast.info('แม่แบบนี้ยังไม่มีเฟส — ไปตั้งที่แท็บ ⚙️ แม่แบบ แล้วกด 🔄 sync');
    }
    setSaving(false);
    toast.success('บันทึกพาร์ทแล้ว');
    setPartModal(null);
    await reload();
    if (!m.id) setPartId(res.data.id);
  };
  const delPart = async (p) => {
    if (!window.confirm(`ลบพาร์ท ${p.part_no} พร้อมเอกสาร/แบบ/tooling ของพาร์ทนี้ทั้งหมด?`)) return;
    const { error } = await supabase.from('npi_parts').delete().eq('id', p.id);
    if (error) return toast.error(error.message);
    toast.success('ลบแล้ว'); setPartId(''); reload();
  };

  const openPartIn = (pid, t = 'parts') => { setPartId(pid); setTab(t); };

  const tabs = TABS_BASE.filter(t => t.key !== 'templates' || canTemplates);
  const sopLeft = project?.sop_date ? daysBetween(today, project.sop_date) : null;
  const sub = project
    ? `${project.project_code} · ${project.customer || '—'} · ${template?.label || 'ไม่พบแม่แบบ'} · SOP ${project.sop_date ? fmtDate(project.sop_date) : '—'}${sopLeft != null ? ` (${sopLeft >= 0 ? `อีก ${sopLeft} วัน` : `เลยมา ${-sopLeft} วัน`})` : ''}`
    : `${projects.length} โปรเจค · เลือกโปรเจคเพื่อดูรายละเอียด`;

  const projectSelect = (
    <select value={projectId} onChange={e => setProject(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 220, maxWidth: 360 }}>
      <option value="">— เลือกโปรเจครุ่นใหม่ —</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} · {p.name}{p.status !== 'active' && p.status !== 'planning' ? ` (${PROJECT_STATUS[p.status]?.label})` : ''}</option>)}
    </select>
  );

  return (
    <div style={{ padding: '14px 18px 40px', maxWidth: 1800, margin: '0 auto' }}>
      <PageHeader title="พาร์ทใหม่ — APQP / PPAP" icon="🚀" sub={sub}
        actions={<>
          {projectSelect}
          {project && canEdit && <button style={ghost} onClick={() => setProjModal({ ...emptyProject, ...project })}>✏️ โปรเจค</button>}
          {canEdit && <button style={btn()} onClick={() => setProjModal({ ...emptyProject, project_code: nextProjectCode(projects.map(p => p.project_code), today), template_id: templates[0]?.id || '' })}>+ โปรเจค</button>}
        </>}
        tabs={tabs} tab={tab} onTab={setTab} />

      <WarnBar>{warn}</WarnBar>
      <ReadOnlyNote show={!canEdit} role={role} what="สร้าง/แก้โปรเจค พาร์ท เอกสารส่งมอบ แบบ ECI และแผน tooling" permKey="npi:edit" />
      {canEdit && !canApprove && (
        <ReadOnlyNote role={role} what="อนุมัติเอกสารส่งมอบ/PPAP · ปล่อยแบบ · ตัดสิน ECI" permKey="npi:approve" compact />
      )}
      <InfoMore id="npi_help" lead="ต้นน้ำของ ESM: ติดตามพาร์ทรุ่นใหม่ตั้งแต่รับงานจนถึง SOP">
        เฟสและรายการเอกสารส่งมอบมาจาก <b>แม่แบบต่อลูกค้า</b> (APQP 5 เฟส + PPAP 18 elements · Toyota SPTT0–4) — เพิ่มลูกค้าใหม่ที่แท็บ ⚙️ แม่แบบ ไม่ต้องแก้โค้ด ·
        พาร์ทจะได้สำเนาเฟส/รายการ ณ วันสร้าง (แม่แบบเปลี่ยนทีหลังไม่ย้อนแก้ — กด 🔄 sync เพื่อเติมรายการที่ขาด) ·
        ไฟสี: 🟢 อนุมัติ/ตามแผน · 🟡 กำลังทำ/รออนุมัติ/เหลือ ≤7 วัน · 🔴 เลยกำหนด/ตีกลับ/เฟสเลยวันแผน ·
        ผูกพาร์ทกับชุด PFC/FMEA/CP (`/pe-docs`) และมาตรฐานตรวจ QA (`/qa-setup`) เพื่อให้เอกสารตอน SOP เป็นชุดเดียวกับ mass production ·
        ECI ปิดได้ต่อเมื่อทุกขาที่ติ๊กว่ากระทบมีของจริงผูก (แบบ rev ใหม่ / คำขอแก้ PE / ใบ 4M / แผน tooling) ·
        ยังไม่ทำ: supplier portal (เฟส 4) · การแจ้งเตือนอัตโนมัติเมื่อเอกสารเลยกำหนด
      </InfoMore>

      {loading ? <div style={{ color: 'var(--muted)', padding: 30 }}>กำลังโหลด…</div> : (
        <>
          {tab === 'board' && (
            <Board projects={projects} rollByProject={rollByProject} templates={templates} project={project} tplPhases={tplPhases}
              parts={parts} rollByPart={rollByPart} phases={phases} today={today} ecis={ecis} tooling={tooling} steps={steps}
              onPickProject={setProject} onOpenPart={openPartIn} />
          )}
          {tab === 'parts' && (
            !project ? <NeedProject /> : (
              <>
                <PartsTable parts={parts} rollByPart={rollByPart} partId={partId} onPick={setPartId} canEdit={canEdit}
                  onAdd={() => setPartModal({ ...emptyPart })} onEdit={p => setPartModal({ ...emptyPart, ...p, pe_set_id: p.pe_set_id || '', qa_part_id: p.qa_part_id || '' })} onDel={delPart}
                  peSets={peSets} />
                {partId && parts.find(p => p.id === partId) && (
                  <NpiPartPanel part={parts.find(p => p.id === partId)} project={project} template={template}
                    phases={phases.filter(x => x.part_id === partId)} delivs={delivs.filter(x => x.part_id === partId)}
                    drawings={drawings.filter(x => x.part_id === partId)} tooling={tooling.filter(x => x.part_id === partId)}
                    peSets={peSets} qaParts={qaParts}
                    canEdit={canEdit} canApprove={canApprove} fullName={fullName} today={today} onChanged={reload} />
                )}
              </>
            )
          )}
          {tab === 'drawings' && (
            !project ? <NeedProject /> : (
              <NpiDrawingsEci project={project} parts={parts} partId={partId} onPickPart={setPartId}
                drawings={drawings} ecis={ecis} tooling={tooling} canEdit={canEdit} canApprove={canApprove}
                fullName={fullName} today={today} onChanged={reload} />
            )
          )}
          {tab === 'tooling' && (
            !project ? <NeedProject /> : (
              <NpiTooling project={project} parts={parts} tooling={tooling} steps={steps} stepTemplates={stepTemplates}
                dieSets={dieSets} canEdit={canEdit} fullName={fullName} today={today} onChanged={reload} />
            )
          )}
          {tab === 'tasks' && (
            !project ? <NeedProject /> : (
              <NpiTasks project={project} parts={parts} tplPhases={tplPhases} delivs={delivs} tasks={tasks} users={users}
                canEdit={canEdit} fullName={fullName} today={today} onChanged={reload} />
            )
          )}
          {tab === 'templates' && canTemplates && (
            <NpiTemplates templates={templates} onChanged={loadMaster} />
          )}
        </>
      )}

      {projModal && (
        <Modal title={projModal.id ? 'แก้ไขโปรเจครุ่นใหม่' : 'สร้างโปรเจครุ่นใหม่'} onClose={() => setProjModal(null)} width={680}
          footer={<>
            {projModal.id && <button style={{ ...ghost, color: '#ef4444', marginRight: 'auto' }} onClick={() => { setProjModal(null); delProject(projModal); }}>🗑 ลบโปรเจค</button>}
            <button style={ghost} onClick={() => setProjModal(null)}>ยกเลิก</button>
            <button style={btn()} disabled={saving} onClick={saveProject}>{saving ? 'กำลังบันทึก…' : '💾 บันทึก'}</button>
          </>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="รหัสโปรเจค" hint="เว้นว่าง = ระบบตั้งให้"><input style={inp} value={projModal.project_code} onChange={e => setProjModal({ ...projModal, project_code: e.target.value })} placeholder="NPI-2026-001" /></Field>
            <Field label="ชื่อโปรเจค *"><input style={inp} value={projModal.name} onChange={e => setProjModal({ ...projModal, name: e.target.value })} placeholder="P703 MCA 2027" /></Field>
            <Field label="ลูกค้า"><input style={inp} value={projModal.customer || ''} onChange={e => setProjModal({ ...projModal, customer: e.target.value })} placeholder="FORD" /></Field>
            <Field label="Model" hint="จุดโยง pe_doc_sets.model"><input style={inp} value={projModal.model || ''} onChange={e => setProjModal({ ...projModal, model: e.target.value })} placeholder="P703" /></Field>
            <Field label="แม่แบบเฟส (ลูกค้า) *" hint="เปลี่ยนภายหลังไม่ย้อนแก้พาร์ทที่สร้างแล้ว" span={2}>
              <select style={inp} value={projModal.template_id} onChange={e => setProjModal({ ...projModal, template_id: e.target.value })} disabled={!!projModal.id && parts.length > 0}>
                <option value="">— เลือก —</option>
                {templates.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.label}{t.customer ? ` (${t.customer})` : ''} · {t.phases.length} เฟส / {t.delivs.length} รายการ</option>)}
              </select>
            </Field>
            <Field label="วัน kickoff"><input type="date" style={inp} value={projModal.kickoff_date || ''} onChange={e => setProjModal({ ...projModal, kickoff_date: e.target.value })} /></Field>
            <Field label="วัน SOP" hint="พาร์ทใหม่จะกระจายวันแผนเฟสจาก kickoff→SOP ให้ (แก้ได้)"><input type="date" style={inp} value={projModal.sop_date || ''} onChange={e => setProjModal({ ...projModal, sop_date: e.target.value })} /></Field>
            <Field label="สถานะ"><MetaSelect value={projModal.status} onChange={v => setProjModal({ ...projModal, status: v })} meta={PROJECT_STATUS} /></Field>
            <Field label="Project leader"><input style={inp} value={projModal.leader_name || ''} onChange={e => setProjModal({ ...projModal, leader_name: e.target.value })} list="npi-users" /></Field>
            <Field label="รายละเอียด" span={2}><textarea style={{ ...inp, minHeight: 60 }} value={projModal.description || ''} onChange={e => setProjModal({ ...projModal, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {partModal && project && (
        <Modal title={partModal.id ? `แก้ไขพาร์ท ${partModal.part_no}` : 'เพิ่มพาร์ทในโปรเจค'} onClose={() => setPartModal(null)} width={720}
          footer={<>
            <button style={ghost} onClick={() => setPartModal(null)}>ยกเลิก</button>
            <button style={btn()} disabled={saving} onClick={savePart}>{saving ? 'กำลังบันทึก…' : '💾 บันทึก'}</button>
          </>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชุด PFC/FMEA/CP ที่มีอยู่" hint="เลือกแล้วเติมข้อมูลพาร์ทให้ · ไม่มี = เว้นว่าง" span={2}>
              <select style={inp} value={partModal.pe_set_id} onChange={e => pickPeSet(e.target.value)}>
                <option value="">— ยังไม่มีชุดเอกสาร PE (สร้างที่ /pe-docs แล้วค่อยผูก) —</option>
                {peSets.map(s => <option key={s.id} value={s.id}>{s.part_no} · {s.part_name || '—'} · {s.model || ''} {s.line_name ? `· ${s.line_name}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Part No. (ลูกค้า) *"><input style={inp} value={partModal.part_no} onChange={e => setPartModal({ ...partModal, part_no: e.target.value })} placeholder="MB3B-16E060-CH" /></Field>
            <Field label="ชื่อพาร์ท"><input style={inp} value={partModal.part_name || ''} onChange={e => setPartModal({ ...partModal, part_name: e.target.value })} /></Field>
            <Field label="MAT No. (SAP)" hint="โยง Product Master ตอน SOP"><input style={inp} value={partModal.mat_no || ''} onChange={e => setPartModal({ ...partModal, mat_no: e.target.value })} /></Field>
            <Field label="ไลน์ที่วางแผนผลิต">
              <LineSelect lines={lines} value={partModal.line_name || ''} onChange={v => setPartModal({ ...partModal, line_name: v })} role={role} lineId={lineId} sections={sections} style={inp} placeholder="— ยังไม่กำหนด —" />
            </Field>
            <Field label="มาตรฐานตรวจ QA (qa_parts)" hint="ตั้งที่ /qa-setup">
              <select style={inp} value={partModal.qa_part_id} onChange={e => setPartModal({ ...partModal, qa_part_id: e.target.value })}>
                <option value="">— ยังไม่ผูก —</option>
                {qaParts.map(q => <option key={q.id} value={q.id}>{q.part_no} · {q.part_name || ''}</option>)}
              </select>
            </Field>
            <Field label="PPAP level" hint="ลูกค้ากำหนด (default 3)">
              <select style={inp} value={partModal.ppap_level} onChange={e => setPartModal({ ...partModal, ppap_level: e.target.value })}>
                {[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>Level {l}</option>)}
              </select>
            </Field>
            <Field label="ผู้รับผิดชอบพาร์ท"><input style={inp} value={partModal.owner_name || ''} onChange={e => setPartModal({ ...partModal, owner_name: e.target.value })} list="npi-users" /></Field>
            <Field label="หมายเหตุ"><input style={inp} value={partModal.remark || ''} onChange={e => setPartModal({ ...partModal, remark: e.target.value })} /></Field>
          </div>
          {!partModal.id && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
              บันทึกแล้วระบบจะสร้าง <b>{template?.phases?.length || 0} เฟส</b> + <b>{template?.delivs?.filter(d => d.is_active !== false).length || 0} รายการเอกสารส่งมอบ</b> จากแม่แบบ "{template?.label || '—'}" ให้พาร์ทนี้
            </div>
          )}
        </Modal>
      )}
      <datalist id="npi-users">{users.map(u => <option key={u.id} value={u.full_name} />)}</datalist>
    </div>
  );
}

function NeedProject() {
  return <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>เลือกโปรเจครุ่นใหม่ที่หัวหน้าเพจก่อน (หรือกด + โปรเจค)</div>;
}

/* ── ตารางพาร์ทของโปรเจค ── */
function PartsTable({ parts, rollByPart, partId, onPick, canEdit, onAdd, onEdit, onDel, peSets }) {
  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>📦 พาร์ทในโปรเจค ({parts.length})</div>
        {canEdit && <button style={btn()} onClick={onAdd}>+ พาร์ท</button>}
      </div>
      {!parts.length ? <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีพาร์ท — กด + พาร์ท (เลือกจากชุด PFC/FMEA/CP ที่มีอยู่ได้เลย เช่น 060/061)</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thSt}></th><th style={thSt}>Part No.</th><th style={thSt}>ชื่อ</th><th style={thSt}>ไลน์</th>
              <th style={thSt}>เฟสปัจจุบัน</th><th style={{ ...thSt, textAlign: 'right' }}>เอกสาร</th><th style={thSt}>PPAP</th><th style={thSt}>PE docs</th><th style={thSt}>สถานะ</th><th style={thSt}></th>
            </tr></thead>
            <tbody>
              {parts.map(p => {
                const r = rollByPart[p.id] || {};
                const on = p.id === partId;
                return (
                  <tr key={p.id} onClick={() => onPick(p.id)} style={{ cursor: 'pointer', background: on ? 'rgba(77,159,255,0.10)' : undefined }}>
                    <td style={tdSt}><LightDot light={r.light} /></td>
                    <td style={{ ...tdSt, fontFamily: 'monospace', fontWeight: 800, color: 'var(--text)' }}>{p.part_no}</td>
                    <td style={tdSt}>{p.part_name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td style={tdSt}>{p.line_name || <span style={{ color: '#f59e0b', fontWeight: 700 }} title="ยังไม่กำหนดไลน์">—</span>}</td>
                    <td style={tdSt}>{r.current ? <Pill label={r.current.label} color="#4d9fff" /> : <span style={{ color: '#f59e0b' }}>ไม่มีเฟส</span>}</td>
                    <td style={{ ...tdSt, textAlign: 'right', whiteSpace: 'nowrap' }}>{r.done ?? 0}/{r.total ?? 0} <span style={{ color: 'var(--muted)' }}>({r.pct ?? 0}%)</span>{r.overdue ? <span style={{ color: '#ef4444', fontWeight: 800 }}> · เลย {r.overdue}</span> : null}</td>
                    <td style={tdSt}><Pill label={`${PPAP_STATUS[p.ppap_status]?.label || p.ppap_status} ${r.ppap ? `${r.ppap.done}/${r.ppap.total}` : ''}`} color={PPAP_STATUS[p.ppap_status]?.color} /></td>
                    <td style={tdSt} onClick={e => e.stopPropagation()}>
                      {p.pe_set_id ? <Link to={`/pe-docs?set=${p.pe_set_id}`} style={{ color: '#4d9fff', fontSize: 12 }}>📐 {peSets.find(s => s.id === p.pe_set_id)?.part_no || 'เปิด'}</Link> : <span style={{ color: '#f59e0b', fontSize: 11.5 }} title="ยังไม่ผูกชุด PFC/FMEA/CP">ยังไม่ผูก</span>}
                    </td>
                    <td style={tdSt}><Pill label={PART_STATUS[p.status]?.label || p.status} color={PART_STATUS[p.status]?.color} /></td>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      {canEdit && <><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => onEdit(p)}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => onDel(p)}>🗑</button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── บอร์ด Obeya ── */
function Board({ projects, rollByProject, templates, project, tplPhases, parts, rollByPart, phases, today, ecis, tooling, steps, onPickProject, onOpenPart }) {
  const active = projects.filter(p => p.status === 'planning' || p.status === 'active');
  const openEci = ecis.filter(e => e.status !== 'implemented' && e.status !== 'rejected').length;
  const toolRolls = tooling.map(t => toolingRollup(t, steps.filter(s => s.tooling_id === t.id), today));
  const toolDelayed = toolRolls.filter(r => r.light === 'red').length;
  const pr = project ? (rollByProject[project.id] || projectRollup([])) : null;
  const ppapApproved = parts.filter(p => p.ppap_status === 'approved').length;

  const kpi = (label, value, color) => (
    <div style={{ ...card, padding: '10px 14px', minWidth: 130, flex: '1 1 130px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: color || 'var(--text)', lineHeight: 1.15 }}>{value}</div>
    </div>
  );

  return (
    <div>
      {/* โปรเจคทั้งหมด */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, alignItems: 'start', marginBottom: 14 }}>
        {!projects.length && <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีโปรเจครุ่นใหม่ — กด + โปรเจค ที่หัวหน้าเพจ</div>}
        {projects.map(pj => {
          const r = rollByProject[pj.id] || projectRollup([]);
          const tpl = templates.find(t => t.id === pj.template_id);
          const left = pj.sop_date ? daysBetween(today, pj.sop_date) : null;
          const on = project?.id === pj.id;
          return (
            <div key={pj.id} onClick={() => onPickProject(pj.id)} style={{ ...card, cursor: 'pointer', borderColor: on ? '#4d9fff' : 'var(--border)', borderLeft: `5px solid ${(LIGHT[r.light] || LIGHT.grey).color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>{pj.name}</div>
                <Pill label={PROJECT_STATUS[pj.status]?.label} color={PROJECT_STATUS[pj.status]?.color} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{pj.project_code} · {pj.customer || '—'} · {tpl?.label || '—'}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                <span>📦 {r.parts} พาร์ท</span>
                <span>📄 {r.done}/{r.total} ({r.pct}%)</span>
                {r.overdue > 0 && <span style={{ color: '#ef4444', fontWeight: 800 }}>⏰ เลย {r.overdue}</span>}
                <span style={{ color: left != null && left < 0 ? '#ef4444' : 'var(--text2)' }}>🏁 SOP {pj.sop_date ? fmtDate(pj.sop_date) : '—'}{left != null ? ` (${left >= 0 ? `อีก ${left} วัน` : `เลย ${-left} วัน`})` : ''}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ width: `${r.pct}%`, height: '100%', background: (LIGHT[r.light] || LIGHT.grey).color }} />
              </div>
            </div>
          );
        })}
      </div>

      {project && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            {kpi('พาร์ท', parts.length)}
            {kpi('เอกสารอนุมัติ', `${pr.done}/${pr.total}`, pr.pct >= 100 && pr.total ? '#22c55e' : undefined)}
            {kpi('เลยกำหนด', pr.overdue, pr.overdue ? '#ef4444' : '#22c55e')}
            {kpi('PPAP อนุมัติ', `${ppapApproved}/${parts.length}`)}
            {kpi('ECI เปิดอยู่', openEci, openEci ? '#f59e0b' : undefined)}
            {kpi('Tooling ล่าช้า', `${toolDelayed}/${tooling.length}`, toolDelayed ? '#ef4444' : undefined)}
            {kpi('โปรเจค active ทั้งระบบ', active.length)}
          </div>

          <div style={{ ...card }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🗂️ พาร์ท × เฟส — {project.name}</div>
            {!parts.length ? <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีพาร์ท — เพิ่มที่แท็บ 📦 พาร์ท & PPAP</div>
              : !tplPhases.length ? <div style={{ color: '#f59e0b', fontSize: 12.5, fontWeight: 700 }}>แม่แบบของโปรเจคนี้ยังไม่มีเฟส — ตั้งที่แท็บ ⚙️ แม่แบบ</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thSt}>Part</th>
                    {tplPhases.map(ph => <th key={ph.code} style={{ ...thSt, textAlign: 'center', color: ph.color || 'var(--muted)' }}>{ph.label}</th>)}
                    <th style={{ ...thSt, textAlign: 'center' }}>PPAP</th>
                    <th style={{ ...thSt, textAlign: 'right' }}>รวม</th>
                  </tr></thead>
                  <tbody>
                    {parts.map(p => {
                      const r = rollByPart[p.id] || { rolls: [] };
                      return (
                        <tr key={p.id}>
                          <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><LightDot light={r.light} />
                              <button onClick={() => onOpenPart(p.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)', fontFamily: 'monospace', fontWeight: 800, fontSize: 12.5 }}>{p.part_no}</button>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.part_name || ''}</div>
                          </td>
                          {tplPhases.map(ph => {
                            const pr2 = (r.rolls || []).find(x => x.phase.phase_code === ph.code);
                            const phRow = phases.find(x => x.part_id === p.id && x.phase_code === ph.code);
                            return (
                              <td key={ph.code} style={{ ...tdSt, textAlign: 'center', cursor: 'pointer' }} onClick={() => onOpenPart(p.id)}
                                title={phRow ? `${ph.label}: ${pr2?.done ?? 0}/${pr2?.total ?? 0} · แผน ${phRow.plan_start ? fmtDate(phRow.plan_start) : '—'} → ${phRow.plan_end ? fmtDate(phRow.plan_end) : '—'}` : 'พาร์ทนี้ไม่มีเฟสนี้ (sync แม่แบบ)'}>
                                {phRow ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                                    <LightDot light={pr2?.light || 'grey'} size={18} />
                                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pr2?.done ?? 0}/{pr2?.total ?? 0}</span>
                                    {phRow.plan_end && <span style={{ fontSize: 10.5, color: phRow.status !== 'completed' && phRow.plan_end < today ? '#ef4444' : 'var(--muted)' }}>{fmtDate(phRow.plan_end)}</span>}
                                  </div>
                                ) : <span style={{ color: '#f59e0b', fontSize: 11 }}>—</span>}
                              </td>
                            );
                          })}
                          <td style={{ ...tdSt, textAlign: 'center' }}><Pill label={`${PPAP_STATUS[p.ppap_status]?.label || ''} ${r.ppap ? `${r.ppap.done}/${r.ppap.total}` : ''}`} color={PPAP_STATUS[p.ppap_status]?.color} small /></td>
                          <td style={{ ...tdSt, textAlign: 'right', fontWeight: 800, color: 'var(--text)' }}>{r.pct ?? 0}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              🟢 อนุมัติครบ/ตามแผน · 🟡 กำลังทำ/รออนุมัติ/เหลือ ≤7 วัน · 🔴 เลยกำหนด/ตีกลับ/เฟสเลยวันแผน · คลิกช่องเพื่อเปิดพาร์ท
            </div>
          </div>
        </>
      )}
    </div>
  );
}
