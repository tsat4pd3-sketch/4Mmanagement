import { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { loadPmTeams, pmTeamsSync } from '../utils/pmTeams';
import { toast } from '../components/Toast';
import tsLogoUrl from '../assets/TS logo.png';

/* ── แผนประสานงาน PM ข้ามวัน (MTN แจ้ง Production) — 2026-07-23 ──────────────
   ใบแบบเมล "RE: แผนการ ..." — งาน PM/แก้เครื่องหลายวัน + ทีมรับผิดชอบแต่ละวัน
   + ช่วง Production Support → แจ้ง Production/ผู้เกี่ยวข้อง (Telegram) + พิมพ์ใบ
   ตาราง DR: pm_coordination_plans / pm_coordination_tasks · สิทธิ์ pm_coord:manage
*/

const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const btnPri = { background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

const STATUS_META = {
  draft:     { label: '📝 ร่าง', color: '#9ca3af' },
  notified:  { label: '📤 แจ้งแล้ว', color: '#4a90e0' },
  done:      { label: '✅ เสร็จสิ้น', color: '#22c55e' },
  cancelled: { label: '✖ ยกเลิก', color: '#ef4444' },
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const beDate = (s) => { if (!s) return '-'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d}/${+m}/${+y + 543}`; };
const teamLabelOf = (key) => (pmTeamsSync().find(t => t.key === key) || {}).label || key || '';

export default function PmCoordination() {
  const { role, lineId, sections: scopeSecs, fullName } = useContext(UserContext);
  const canManage = can('pm_coord', 'manage', role);

  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);
  const [teams, setTeams] = useState(pmTeamsSync());
  const [plans, setPlans] = useState([]);
  const [tasksByPlan, setTasksByPlan] = useState({});
  const [pmPlans, setPmPlans] = useState([]); // แผน PM เดิม (pm_plans) ที่มีวันครบกำหนด — ให้สร้างแผนประสานงานผูกจากตรงนี้
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // plan object (new/edit modal)
  const [fStatus, setFStatus] = useState('active'); // active = ยังไม่ done/cancelled

  useEffect(() => { loadPmTeams().then(setTeams); }, []);

  const scopeLines = useMemo(() => {
    if (role === 'admin') return null;
    if (role === 'leader' && lineId) { const self = lines.find(l => l.id === lineId); return self ? new Set(getLineFamilyNames(lines, self.name)) : new Set(); }
    if (scopeSecs?.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    return null;
  }, [lines, role, lineId, scopeSecs]);

  const load = useCallback(async () => {
    const [{ data: ln }, { data: mc }, { data: pl }, plansRes, clsRes] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('machines').select('id, machine_no, machine_name, line_name').eq('is_active', true).order('sort_order'),
      supabaseDR.from('pm_coordination_plans').select('*').order('created_at', { ascending: false }).limit(500),
      // แผน PM เดิม (best-effort — ยังไม่มีตารางก็ไม่พัง)
      supabaseDR.from('pm_plans').select('id, checklist_id, next_due_date, plan_type').eq('is_active', true).then(r => r).catch(() => ({ data: [] })),
      supabaseDR.from('checklists').select('id, equipment_id, department, name, frequency').eq('module', 'mtn').then(r => r).catch(() => ({ data: [] })),
    ]);
    setLines(ln || []); setMachines(mc || []);
    // ผูกแผน PM → อุปกรณ์ (checklist_id → checklists.equipment_id) · equipment เป็น jig (รวม shadow) หรือ machine
    const clById = {}; (clsRes?.data || []).forEach(c => { clById[c.id] = c; });
    const mcById = {}; (mc || []).forEach(m => { mcById[m.id] = m; });
    const eqIds = [...new Set((clsRes?.data || []).map(c => c.equipment_id).filter(Boolean))];
    let jigById = {};
    if (eqIds.length) {
      const { data: jigs } = await supabaseDR.from('jigs').select('id, name, line_name, machine_id, machine_no').in('id', eqIds).then(r => r).catch(() => ({ data: [] }));
      (jigs || []).forEach(j => { jigById[j.id] = j; });
    }
    const upcoming = (plansRes?.data || []).map(p => {
      const cl = clById[p.checklist_id]; if (!cl) return null;
      const jig = jigById[cl.equipment_id]; const mc2 = mcById[cl.equipment_id] || (jig?.machine_id ? mcById[jig.machine_id] : null);
      const machine_name = mc2?.machine_name || jig?.name || null;
      const machine_no = mc2?.machine_no || jig?.machine_no || null;
      const line_name = mc2?.line_name || jig?.line_name || null;
      if (!machine_name && !machine_no) return null;
      return { plan_id: p.id, next_due_date: p.next_due_date, department: cl.department, checklist_name: cl.name, frequency: cl.frequency,
        machine_id: mc2?.id || null, machine_no, machine_name, line_name };
    }).filter(Boolean).sort((a, b) => String(a.next_due_date || '9999').localeCompare(String(b.next_due_date || '9999')));
    setPmPlans(upcoming);
    const planIds = (pl || []).map(p => p.id);
    let tmap = {};
    if (planIds.length) {
      const { data: tk } = await supabaseDR.from('pm_coordination_tasks').select('*').in('plan_id', planIds).order('sort_order');
      (tk || []).forEach(t => { (tmap[t.plan_id] ||= []).push(t); });
    }
    setPlans(pl || []); setTasksByPlan(tmap); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // deep-link prefill จาก PmForecast/PMSchedule (sessionStorage) → เปิด modal สร้างแผนผูก PM plan ทันที
  useEffect(() => {
    if (loading || !canManage) return;
    try {
      const raw = sessionStorage.getItem('pmcoord_prefill');
      if (!raw) return;
      sessionStorage.removeItem('pmcoord_prefill');
      const d = JSON.parse(raw);
      setEditing({ _new: true, title: d.title || (d.machine_name ? `PM ${d.machine_name}` : ''), pm_plan_id: d.pm_plan_id || '',
        machine_id: d.machine_id || '', machine_no: d.machine_no || '', machine_name: d.machine_name || '', line_name: d.line_name || '',
        tasks: d.next_due_date ? [{ task_date: d.next_due_date, team: d.department || '', description: d.checklist_name ? `PM ตามแผน: ${d.checklist_name}` : 'PM ตามแผน', time_from: '', time_to: '', is_support: false }] : [] });
    } catch { /* ignore */ }
  }, [loading, canManage]);

  const shown = useMemo(() => {
    return (plans || []).filter(p => {
      if (scopeLines && p.line_name && !scopeLines.has(p.line_name)) return false;
      if (fStatus === 'active') return !['done', 'cancelled'].includes(p.status);
      if (fStatus === 'all') return true;
      return p.status === fStatus;
    });
  }, [plans, scopeLines, fStatus]);

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด…</div>;

  const cp = { lines, machines, teams, pmPlans, scopeLines, fullName, role, onClose: () => setEditing(null), onSaved: () => { setEditing(null); load(); } };

  return (
    <div style={{ padding: 'clamp(12px,2.5vw,24px)', maxWidth: 'min(97vw, 1400px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', paddingRight: 52, alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>🗓️ แผนประสานงาน PM / งานเครื่องจักร</h1>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>งาน PM/แก้เครื่องหลายวัน · แจ้ง Production ล่วงหน้า</span>
        {canManage && <button onClick={() => setEditing({ _new: true, title: '', tasks: [] })} style={{ ...btnPri, marginLeft: 'auto' }}>➕ สร้างแผนใหม่</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[['active', 'กำลังดำเนินการ'], ['notified', '📤 แจ้งแล้ว'], ['done', '✅ เสร็จ'], ['all', 'ทั้งหมด']].map(([k, t]) => (
          <button key={k} onClick={() => setFStatus(k)} style={{ ...(fStatus === k ? btnPri : btnGhost), padding: '7px 14px', fontSize: 12.5 }}>{t}</button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>{shown.length} แผน</span>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))' }}>
        {shown.map(p => (
          <PlanCard key={p.id} plan={p} tasks={tasksByPlan[p.id] || []} canManage={canManage} teams={teams}
            fullName={fullName} onEdit={() => setEditing({ ...p, tasks: tasksByPlan[p.id] || [] })} onReload={load} />
        ))}
        {!shown.length && <div style={{ color: 'var(--muted)', padding: 24 }}>ไม่มีแผน</div>}
      </div>

      {editing && <PlanModal plan={editing} {...cp} />}
    </div>
  );
}

/* ── การ์ดแผน ─────────────────────────────── */
function PlanCard({ plan: p, tasks, canManage, fullName, onEdit, onReload }) {
  const m = STATUS_META[p.status] || STATUS_META.draft;
  const doneN = tasks.filter(t => t.done).length;

  const notify = async () => {
    try {
      await supabase.functions.invoke('send-notification', {
        body: { event: 'pm_coordination', plan: {
          title: p.title, machine_name: p.machine_name, machine_no: p.machine_no, line_name: p.line_name,
          remark: p.remark, by_name: fullName || '',
          tasks: tasks.map(t => ({ task_date: t.task_date, team: teamLabelOf(t.team), description: t.description, time_from: t.time_from, time_to: t.time_to, is_support: t.is_support })),
        } },
      });
      await supabaseDR.from('pm_coordination_plans').update({ status: 'notified', updated_at: new Date().toISOString() }).eq('id', p.id);
      toast.success('แจ้ง Production แล้ว'); onReload();
    } catch (e) { toast.error('แจ้งไม่สำเร็จ: ' + (e.message || e)); }
  };
  const setStatus = async (status) => {
    await supabaseDR.from('pm_coordination_plans').update({ status, updated_at: new Date().toISOString() }).eq('id', p.id);
    onReload();
  };
  const toggleTask = async (t) => {
    await supabaseDR.from('pm_coordination_tasks').update({ done: !t.done }).eq('id', t.id);
    onReload();
  };
  const del = async () => {
    if (!confirm('ลบแผนนี้?')) return;
    await supabaseDR.from('pm_coordination_plans').delete().eq('id', p.id);
    toast.success('ลบแล้ว'); onReload();
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--card)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{p.title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            🔧 {[p.machine_name, p.machine_no].filter(Boolean).join(' ') || '—'}{p.line_name ? ` · 🏭 ${p.line_name}` : ''}
          </div>
          {p.pm_plan_id && <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(74,144,224,0.15)', color: '#4a90e0' }}>🔗 ผูกแผน PM</span>}
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: m.color + '22', color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '8px 0' }}>
        {tasks.map(t => (
          <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5,
            padding: '5px 8px', borderRadius: 8, background: t.is_support ? 'rgba(239,68,68,0.10)' : 'var(--bg2)',
            border: t.is_support ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--border)' }}>
            <input type="checkbox" checked={!!t.done} onChange={() => canManage && toggleTask(t)} disabled={!canManage} style={{ width: 'auto', marginTop: 2, cursor: canManage ? 'pointer' : 'default' }} />
            <div style={{ flex: 1, opacity: t.done ? 0.55 : 1, textDecoration: t.done ? 'line-through' : 'none' }}>
              <b style={{ color: t.is_support ? '#ef4444' : 'var(--accent2)' }}>{beDate(t.task_date)}</b>
              {(t.time_from || t.time_to) && <span style={{ color: 'var(--muted)' }}> {t.time_from || ''}{t.time_to ? '–' + t.time_to : ''} น.</span>}
              {t.team && <span style={{ fontSize: 11, color: 'var(--muted)' }}> · {teamLabelOf(t.team)}</span>}
              <div style={{ color: 'var(--text)' }}>{t.is_support ? '⚠️ ' : ''}{t.description}</div>
            </div>
          </div>
        ))}
        {!tasks.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีรายการงาน</div>}
      </div>

      {p.remark && <div style={{ fontSize: 12, color: '#ef4444', margin: '4px 0', padding: '5px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.08)' }}>📌 <b>Remark:</b> {p.remark}</div>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{doneN}/{tasks.length} ขั้น</span>
        <button onClick={() => printPlan(p, tasks)} style={{ ...btnGhost, padding: '5px 11px', fontSize: 11.5, marginLeft: 'auto' }}>🖨️ พิมพ์</button>
        {canManage && <>
          <button onClick={notify} style={{ ...btnGhost, padding: '5px 11px', fontSize: 11.5 }}>📤 แจ้ง Production</button>
          <button onClick={onEdit} style={{ ...btnGhost, padding: '5px 11px', fontSize: 11.5 }}>✏️ แก้ไข</button>
          {p.status !== 'done' && <button onClick={() => setStatus('done')} style={{ ...btnGhost, padding: '5px 11px', fontSize: 11.5, color: '#22c55e' }}>✓ เสร็จ</button>}
          <button onClick={del} style={{ ...btnGhost, padding: '5px 11px', fontSize: 11.5, color: '#ef4444' }}>🗑</button>
        </>}
      </div>
    </div>
  );
}

/* ── modal สร้าง/แก้แผน ─────────────────────── */
function PlanModal({ plan, lines, machines, teams, pmPlans = [], scopeLines, fullName, onClose, onSaved }) {
  const [f, setF] = useState({
    title: plan.title || '', machine_id: plan.machine_id || '', machine_no: plan.machine_no || '',
    machine_name: plan.machine_name || '', line_name: plan.line_name || '', remark: plan.remark || '',
    pm_plan_id: plan.pm_plan_id || '',
  });
  const [tasks, setTasks] = useState(
    (plan.tasks && plan.tasks.length ? plan.tasks : [{ task_date: todayStr(), team: '', description: '', time_from: '', time_to: '', is_support: false }])
      .map(t => ({ ...t }))
  );
  const [busy, setBusy] = useState(false);

  const machOpts = useMemo(() => {
    let arr = machines;
    if (scopeLines) arr = arr.filter(m => !m.line_name || scopeLines.has(m.line_name));
    return arr;
  }, [machines, scopeLines]);

  const pickMachine = (id) => {
    const mc = machines.find(m => m.id === id);
    setF(v => ({ ...v, machine_id: id, machine_no: mc?.machine_no || '', machine_name: mc?.machine_name || '', line_name: mc?.line_name || v.line_name }));
  };
  // สร้างจากแผน PM เดิม → เติมเครื่อง/ไลน์/ผูก pm_plan_id + เพิ่มขั้นงานวันครบกำหนดให้อัตโนมัติ
  const fromPmPlan = (planId) => {
    const pp = pmPlans.find(p => String(p.plan_id) === String(planId));
    if (!pp) { setF(v => ({ ...v, pm_plan_id: '' })); return; }
    setF(v => ({ ...v, pm_plan_id: pp.plan_id, machine_id: pp.machine_id || '', machine_no: pp.machine_no || '',
      machine_name: pp.machine_name || '', line_name: pp.line_name || v.line_name,
      title: v.title.trim() || (pp.machine_name ? `PM ${pp.machine_name}` : 'แผน PM') }));
    if (pp.next_due_date) setTasks(ts => {
      const has = ts.some(t => t.task_date === pp.next_due_date);
      return has ? ts : [{ task_date: pp.next_due_date, team: pp.department || '', description: pp.checklist_name ? `PM ตามแผน: ${pp.checklist_name}` : 'PM ตามแผน', time_from: '', time_to: '', is_support: false }, ...ts.filter(t => t.description || t.task_date !== todayStr())];
    });
  };
  const setTask = (i, k, val) => setTasks(ts => ts.map((t, j) => j === i ? { ...t, [k]: val } : t));
  const addTask = () => setTasks(ts => [...ts, { task_date: todayStr(), team: '', description: '', time_from: '', time_to: '', is_support: false }]);
  const rmTask = (i) => setTasks(ts => ts.filter((_, j) => j !== i));

  const save = async () => {
    if (!f.title.trim()) return toast.error('กรอกหัวเรื่องงาน');
    setBusy(true);
    const nowIso = new Date().toISOString();
    const head = { title: f.title.trim(), machine_id: f.machine_id || null, machine_no: f.machine_no || null,
      machine_name: f.machine_name || null, line_name: f.line_name || null, remark: f.remark || null,
      pm_plan_id: f.pm_plan_id || null, updated_at: nowIso };
    let planId = plan._new ? null : plan.id;
    if (plan._new) {
      const { data, error } = await supabaseDR.from('pm_coordination_plans').insert({ ...head, status: 'draft', created_by: fullName || null }).select('id').single();
      if (error) { setBusy(false); return toast.error(error.message); }
      planId = data.id;
    } else {
      const { error } = await supabaseDR.from('pm_coordination_plans').update(head).eq('id', planId);
      if (error) { setBusy(false); return toast.error(error.message); }
      await supabaseDR.from('pm_coordination_tasks').delete().eq('plan_id', planId);
    }
    const rows = tasks.filter(t => t.description?.trim() || t.task_date).map((t, i) => ({
      plan_id: planId, task_date: t.task_date || null, team: t.team || null, description: t.description || null,
      time_from: t.time_from || null, time_to: t.time_to || null, is_support: !!t.is_support, done: !!t.done, sort_order: i,
    }));
    if (rows.length) { const { error } = await supabaseDR.from('pm_coordination_tasks').insert(rows); if (error) { setBusy(false); return toast.error(error.message); } }
    setBusy(false); toast.success('บันทึกแล้ว'); onSaved();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'clamp(8px,3vh,40px) 12px', overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', width: 'min(760px, 100%)', padding: 18 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 12 }}>{plan._new ? '➕ สร้างแผนประสานงาน' : '✏️ แก้ไขแผน'}</div>

        {plan._new && pmPlans.length > 0 && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(74,144,224,0.10)', border: '1px solid rgba(74,144,224,0.4)' }}>
            <label style={{ ...lbl, color: '#4a90e0' }}>🔗 สร้างจากแผน PM เดิม (ผูกให้อัตโนมัติ + เติมวันครบกำหนด)</label>
            <select value={f.pm_plan_id} onChange={e => fromPmPlan(e.target.value)} style={inp}>
              <option value="">— ไม่ผูก (สร้างแผนอิสระ) —</option>
              {pmPlans.map(p => <option key={p.plan_id} value={p.plan_id}>
                {[p.machine_name, p.machine_no].filter(Boolean).join(' ')}{p.line_name ? ` · ${p.line_name}` : ''}{p.next_due_date ? ` · ครบ ${beDate(p.next_due_date)}` : ''}{p.checklist_name ? ` · ${p.checklist_name}` : ''}
              </option>)}
            </select>
          </div>
        )}

        <label style={lbl}>หัวเรื่องงาน *</label>
        <input value={f.title} onChange={e => setF(v => ({ ...v, title: e.target.value }))} placeholder="เช่น Cleaning Cutting Head" style={inp} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <div>
            <label style={lbl}>เครื่องจักร (จากฐานข้อมูล)</label>
            <select value={f.machine_id} onChange={e => pickMachine(e.target.value)} style={inp}>
              <option value="">— เลือกเครื่อง —</option>
              {machOpts.map(m => <option key={m.id} value={m.id}>{[m.machine_name, m.machine_no].filter(Boolean).join(' ')}{m.line_name ? ` (${m.line_name})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>ไลน์</label>
            <select value={f.line_name} onChange={e => setF(v => ({ ...v, line_name: e.target.value }))} style={inp}>
              <option value="">— เลือกไลน์ —</option>
              {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ ...lbl, margin: 0 }}>แผนงาน & รายละเอียด (แต่ละวัน)</label>
          <button onClick={addTask} style={{ ...btnGhost, padding: '4px 10px', fontSize: 11.5 }}>➕ เพิ่มขั้นงาน</button>
        </div>
        {tasks.map((t, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8, background: t.is_support ? 'rgba(239,68,68,0.06)' : 'var(--bg2)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={lblS}>วันที่</label>
                <input type="date" value={t.task_date || ''} onChange={e => setTask(i, 'task_date', e.target.value)} style={{ ...inp, width: '100%' }} />
              </div>
              <div>
                <label style={lblS}>ทีมรับผิดชอบ</label>
                <select value={t.team || ''} onChange={e => setTask(i, 'team', e.target.value)} style={inp}>
                  <option value="">— ทีม —</option>
                  <option value="production">PRODUCTION (ฝ่ายผลิต)</option>
                  {teams.map(tm => <option key={tm.key} value={tm.key}>{tm.label}</option>)}
                </select>
              </div>
              <button onClick={() => rmTask(i)} style={{ ...btnGhost, padding: '7px 10px', fontSize: 12, color: '#ef4444' }}>✕</button>
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={lblS}>รายละเอียด</label>
              <input value={t.description || ''} onChange={e => setTask(i, 'description', e.target.value)} placeholder="เช่น Production ถอดชุด Cutting ออกจากเครื่อง" style={inp} />
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ช่วงเวลา (ถ้ามี)</span>
                <input type="time" value={t.time_from || ''} onChange={e => setTask(i, 'time_from', e.target.value)} style={{ ...inp, width: 110 }} />
                <span style={{ color: 'var(--muted)' }}>–</span>
                <input type="time" value={t.time_to || ''} onChange={e => setTask(i, 'time_to', e.target.value)} style={{ ...inp, width: 110 }} />
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: t.is_support ? '#ef4444' : 'var(--text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!t.is_support} onChange={e => setTask(i, 'is_support', e.target.checked)} style={{ width: 'auto' }} />
                ⚠️ ต้อง Production Support (เน้นในใบแจ้ง)
              </label>
            </div>
          </div>
        ))}

        <label style={{ ...lbl, marginTop: 8 }}>Remark / หมายเหตุ</label>
        <textarea value={f.remark} onChange={e => setF(v => ({ ...v, remark: e.target.value }))} rows={2} placeholder="เช่น รบกวน Production Support เรื่องการปรับคุณภาพ…" style={{ ...inp, resize: 'vertical' }} />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
          <button onClick={save} disabled={busy} style={btnPri}>{busy ? 'กำลังบันทึก…' : '💾 บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}
const lbl = { display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 };
const lblS = { display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 3 };

/* ── พิมพ์ใบแจ้งแผน (แบบเมล) ─────────────────── */
function printPlan(p, tasks) {
  const beD = (s) => beDate(s);
  const rows = (tasks || []).map(t => {
    const time = (t.time_from || t.time_to) ? ` (${t.time_from || ''}${t.time_to ? '–' + t.time_to : ''} น.)` : '';
    const team = t.team ? `<b>[${teamLabelOf(t.team)}]</b> ` : '';
    return `<li style="margin:6px 0;${t.is_support ? 'color:#c00;font-weight:600;' : ''}">
      <b>${beD(t.task_date)}</b>${time} — ${team}${t.description || ''}</li>`;
  }).join('');
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>แผนประสานงาน PM</title>
  <style>
    body{font-family:'Sarabun','Tahoma',sans-serif;color:#111;padding:32px 40px;max-width:820px;margin:0 auto;font-size:15px;}
    .hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0b5c2e;padding-bottom:12px;margin-bottom:16px;}
    .hd img{height:46px;}
    h1{font-size:19px;margin:0;color:#0b5c2e;}
    .meta{font-size:14px;color:#333;margin:10px 0;}
    .sec{font-weight:700;margin:14px 0 4px;}
    ul{margin:4px 0 4px 4px;padding-left:20px;}
    .remark{color:#c00;font-weight:600;margin-top:14px;border-top:1px dashed #c00;padding-top:8px;}
    .sign{margin-top:40px;display:flex;justify-content:flex-end;gap:60px;font-size:14px;text-align:center;}
    .sign div{border-top:1px solid #444;padding-top:4px;min-width:180px;}
  </style></head><body>
  <div class="hd"><img src="${tsLogoUrl}" alt=""><div><h1>แผนประสานงาน PM / งานเครื่องจักร</h1>
    <div style="font-size:13px;color:#666;">Thai Summit — Maintenance</div></div></div>
  <div style="font-size:17px;font-weight:700;">${p.title || ''}</div>
  <div class="meta">🔧 เครื่อง: <b>${[p.machine_name, p.machine_no].filter(Boolean).join(' ') || '—'}</b>${p.line_name ? ` &nbsp;·&nbsp; 🏭 ไลน์: <b>${p.line_name}</b>` : ''}</div>
  <div class="sec">แผนงาน &amp; รายละเอียด</div>
  <ul>${rows || '<li>—</li>'}</ul>
  ${p.remark ? `<div class="remark">Remark : ${p.remark}</div>` : ''}
  <div class="sign"><div>ผู้จัดทำ (Maintenance)</div><div>รับทราบ (Production)</div></div>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast.error('เปิดหน้าต่างพิมพ์ไม่ได้ (popup ถูกบล็อก)'); return; }
  w.document.write(html); w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}
