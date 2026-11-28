/* ══ 🏭 Smart Factory → Edit Data (รอบ 2 · 28/11 · loop smf01) — คืน { tools, body } ให้หน้าวาง ═══════════════════════════
   ส่วนย่อย (`?sec=`):
   · ผลงานรายเดือน — เลือกโครงการ → กรอกเป้า/ผลงาน 12 เดือน (act03_project_month · upsert คีย์ act_project+month) · ผลต่าง/% คิดให้
   · Work Flow Automation — ข้อเสนอปรับปรุง (act03_idea) · คลิกแถว = เลือก (แก้ไข/ลบ) · ดับเบิลคลิก = ดูแบบ Improvement Proposal
     (รูป Before/After = act03_idea_image กดขยายได้) · เปลี่ยนสถานะ = บันทึกผลประเมิน (act03_idea_eval) ด้วย
   · เขียน = สิทธิ์ `act_smf:manage` (RLS เดียวกัน) · อัปโหลดรูปใหม่ = รอบถัดไป (ต้องผ่านตัวบีบรูป + ทะเบียน UPLOAD_SITES)
   · ชิ้นส่วนจออยู่ `editParts.jsx` · สไตล์ `editStyles.js` */
import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { toast } from '../../components/Toast';
import { tr } from '../../utils/i18n';
import { fmtDate } from '../../utils/dateFormat';
import { fetchByIds } from '../../utils/fetchByIds';
import { checkWrite, checkWriteRows } from '../../utils/dbWrite';
import { askConfirm } from '../../utils/askConfirm';
import { actorFields } from '../../utils/actorStamp';
import { WF_FREQUENCY, WF_STATUS } from './labels.js';
import { stamp } from './sections.js';
import { Chip, fmtNum, num, sel, statusOf, td, th } from './editStyles.js';
import { IdeaForm, IdeaView, MonthEditor } from './editParts';

/* ── โหลดข้อมูลรายปี ─────────────────────────────────────────────────────────────── */
function useEditData(year, tick) {
  const [got, setGot] = useState({ key: null });
  const key = `${year}|${tick}`;
  useEffect(() => {
    let alive = true;
    (async () => {
      const [proj, ideas] = await Promise.all([
        supabase.from('act03_project').select('act_project, code, name, target_name, unit, status').eq('year', year).order('sort_no'),
        supabase.from('act03_idea').select('*').eq('year', year).order('created_at', { ascending: false }),
      ]);
      const pIds = (proj.data || []).map(p => p.act_project);
      const iIds = (ideas.data || []).map(i => i.act_idea);
      const [months, imgs, evals] = await Promise.all([
        pIds.length ? fetchByIds(pIds, (part) => supabase.from('act03_project_month').select('act_project, month, target, actual, note').in('act_project', part), { orderBy: 'month' }) : { rows: [] },
        iIds.length ? fetchByIds(iIds, (part) => supabase.from('act03_idea_image').select('act_image, act_idea, image_type, image_url, image_description, created_at').in('act_idea', part), { orderBy: 'created_at' }) : { rows: [] },
        iIds.length ? fetchByIds(iIds, (part) => supabase.from('act03_idea_eval').select('act_eval, act_idea, evaluator_name, evaluation_status, evaluation_note, created_at').in('act_idea', part), { orderBy: 'created_at' }) : { rows: [] },
      ]);
      if (!alive) return;
      const err = proj.error?.message || ideas.error?.message || months.error || imgs.error || evals.error || '';
      setGot({ key, projects: proj.data || [], ideas: ideas.data || [], months: months.rows || [], images: imgs.rows || [], evals: evals.rows || [], err });
    })();
    return () => { alive = false; };
  }, [year, key]);
  return got.key === key ? got : null;
}

const blankIdea = (year, code) => ({
  year, project_code: code || 'workflow', team_name: '', employee_code: '', full_name: '', department: '', members: '',
  process_name: '', current_description: '', current_problem: '', frequency: WF_FREQUENCY[0], project_name: '', improvement_description: '',
  proposed_technology: '', improvement_benefits: [], time_before: '0', time_after: '0', paper_before: '0', paper_after: '0', steps_before: '0', steps_after: '0',
  difficulty: 'Medium', budget: 'Free', project_status: 'Idea', admin_note: '',
});

/* ── hook หลัก ─────────────────────────────────────────────────────────────────────── */
export default function useEditSmf({ sec, year, yearPick, canEdit, tick, q, onLoaded, reload }) {
  const data = useEditData(year, tick);
  useEffect(() => { if (data) onLoaded?.(data.err || ''); }, [data, onLoaded]);
  const [fProj, setFProj] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [pick, setPick] = useState(null);
  const [view, setView] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const ideas = data?.ideas || [];
  const projName = (code) => data?.projects.find(p => p.code === code)?.name || code || '-';
  const needle = q.trim().toLowerCase();
  const shown = ideas.filter(i => (!fProj || i.project_code === fProj) && (!fStatus || i.project_status === fStatus)
    && (!needle || `${i.project_name} ${i.process_name} ${i.full_name} ${i.department || ''} ${i.team_name || ''}`.toLowerCase().includes(needle)));
  const current = ideas.find(i => i.act_idea === pick) || null;

  const openAdd = () => setForm({ mode: 'add', value: blankIdea(year, fProj || data?.projects.find(p => p.code === 'workflow')?.code || data?.projects[0]?.code) });
  const openEdit = (i) => setForm({ mode: 'edit', id: i.act_idea, oldStatus: i.project_status, value: {
    ...blankIdea(year, i.project_code), ...Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v == null ? '' : v])),
    members: (i.members || []).join(', '), improvement_benefits: Array.isArray(i.improvement_benefits) ? i.improvement_benefits : [],
    ...Object.fromEntries(['time_before', 'time_after', 'paper_before', 'paper_after', 'steps_before', 'steps_after'].map(k => [k, String(i[k] ?? 0)])),
  } });

  const save = async () => {
    const v = form.value;
    if (!/^\d{7}$/.test(v.employee_code || '')) { toast.error(tr('เลือกผู้ส่งจากทะเบียนพนักงาน')); return; }
    if (!String(v.process_name).trim() || !String(v.project_name).trim()) { toast.error(tr('กรอกชื่อกระบวนการและชื่อโครงการก่อน')); return; }
    const row = {
      year: Number(v.year) || year, project_code: v.project_code, team_name: String(v.team_name || '').trim() || null,
      employee_code: v.employee_code, full_name: v.full_name, department: String(v.department || '').trim() || null,
      members: String(v.members || '').split(',').map(s => s.trim()).filter(Boolean),
      process_name: String(v.process_name).trim(), current_description: v.current_description || null, current_problem: v.current_problem || null, frequency: v.frequency || null,
      project_name: String(v.project_name).trim(), improvement_description: v.improvement_description || null, proposed_technology: v.proposed_technology || null,
      improvement_benefits: v.improvement_benefits,
      ...Object.fromEntries(['time_before', 'time_after', 'paper_before', 'paper_after', 'steps_before', 'steps_after'].map(k => [k, num(v[k]) ?? 0])),
      difficulty: v.difficulty || null, budget: v.budget || null, project_status: v.project_status, admin_note: v.admin_note || null, ...stamp(),
    };
    setBusy(true);
    const res = form.mode === 'add'
      ? await supabase.from('act03_idea').insert([row]).select('act_idea')
      : await supabase.from('act03_idea').update(row).eq('act_idea', form.id).select('act_idea');
    if (form.mode === 'add' ? !checkWrite(res, tr('เพิ่มข้อเสนอ')) : !checkWriteRows(res, tr('บันทึกข้อเสนอ'))) { setBusy(false); return; }
    const id = res.data?.[0]?.act_idea;
    /* เปลี่ยนสถานะ = บันทึกผลประเมินไว้เป็นประวัติ (แบบเว็บเดิม) */
    if (id && form.mode === 'edit' && form.oldStatus !== row.project_status) {
      const a = actorFields();
      checkWrite(await supabase.from('act03_idea_eval').insert([{ act_idea: id, evaluator_code: a.updated_by_uid || '-', evaluator_name: a.updated_by_name || null, evaluation_status: row.project_status, evaluation_note: row.admin_note }]), tr('บันทึกผลประเมิน'));
    }
    setBusy(false);
    toast.success(`${tr(form.mode === 'add' ? 'เพิ่ม' : 'บันทึก')} ${row.project_name} ${tr('แล้ว')}`);
    setForm(null); setPick(id || null); reload();
  };

  const remove = async () => {
    if (!current || !await askConfirm(`${tr('ลบข้อเสนอ')} "${current.project_name}" ? ${tr('(รูปและผลประเมินของข้อนี้จะถูกลบด้วย)')}`)) return;
    const res = await supabase.from('act03_idea').delete().eq('act_idea', current.act_idea).select('act_idea');
    if (!checkWriteRows(res, tr('ลบข้อเสนอ'))) return;
    toast.success(`${tr('ลบ')} ${current.project_name} ${tr('แล้ว')}`);
    setPick(null); reload();
  };

  const wf = sec === 'workflow';
  const why = !canEdit ? 'ไม่มีสิทธิ์แก้ Smart Factory' : 'คลิกเลือกแถวในตารางก่อน';
  /* ป้ายเป็นไทยล้วน — ToolBar แปลตอนวาด */
  const tools = [
    { key: 'add', label: 'เพิ่ม', onClick: openAdd, disabled: !(wf && canEdit), why: !wf ? 'หน้านี้กรอกในตาราง แล้วกดบันทึก' : why },
    { key: 'edit', label: 'แก้ไข', onClick: () => current && openEdit(current), disabled: !(wf && canEdit && current), why: !wf ? 'หน้านี้กรอกในตาราง แล้วกดบันทึก' : why },
    { key: 'delete', label: 'ลบ', onClick: remove, disabled: !(wf && canEdit && current), why: !wf ? 'หน้านี้ไม่มีการลบรายแถว' : why },
  ];

  let body;
  if (!data) body = <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</div>;
  else if (sec === 'month') body = <MonthEditor key={year} data={data} canEdit={canEdit} reload={reload} yearPick={yearPick} />;
  else body = (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {yearPick}
        <select style={sel} value={fProj} onChange={e => setFProj(e.target.value)} aria-label={tr('โครงการ')}>
          <option value="">{tr('ทุกโครงการ')}</option>
          {data.projects.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
        <select style={sel} value={fStatus} onChange={e => setFStatus(e.target.value)} aria-label={tr('สถานะ')}>
          <option value="">{tr('ทุกสถานะ')}</option>
          {WF_STATUS.map(s => <option key={s.value} value={s.value}>{tr(s.label)}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{shown.length} {tr('รายการ')} · {tr('ดับเบิลคลิกเพื่อดูรายละเอียด')}</span>
      </div>
      {data.err && <div style={{ fontSize: 13, color: 'var(--red)' }}>{data.err}</div>}
      <div style={{ overflow: 'auto', maxHeight: '66vh', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['วันที่ส่ง', 'ชื่อโครงการ (After)', 'กระบวนการเดิม (Before)', 'ผู้เสนอ', 'โครงการ', 'เทคโนโลยี', 'เวลา ก่อน→หลัง (นาที)', 'สถานะ'].map(h => <th key={h} style={th}>{tr(h)}</th>)}</tr></thead>
          <tbody>
            {shown.map(i => {
              const on = pick === i.act_idea;
              const st = statusOf(i.project_status);
              return (
                <tr key={i.act_idea} onClick={() => setPick(on ? null : i.act_idea)} onDoubleClick={() => setView(i)}
                  style={{ cursor: 'pointer', background: on ? 'var(--bg2-surf)' : undefined, outline: on ? '1px solid var(--accent)' : undefined }}>
                  <td style={td}>{fmtDate(i.created_at)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{i.project_name}</td>
                  <td style={td}>{i.process_name}</td>
                  <td style={td}>{i.full_name}{i.department ? ` · ${i.department}` : ''}</td>
                  <td style={td}>{projName(i.project_code)}</td>
                  <td style={td}>{i.proposed_technology || '-'}</td>
                  <td style={td}>{fmtNum(i.time_before)} → {fmtNum(i.time_after)}</td>
                  <td style={td}><Chip tone={st.tone}>{tr(st.label)}</Chip></td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={8} style={{ ...td, color: 'var(--muted)', padding: 16 }}>{tr('ยังไม่มีข้อเสนอของปีนี้')}</td></tr>}
          </tbody>
        </table>
      </div>
      {view && <IdeaView idea={view} images={data.images.filter(m => m.act_idea === view.act_idea)} evals={data.evals.filter(e => e.act_idea === view.act_idea)} projName={projName} onClose={() => setView(null)} />}
      {form && <IdeaForm mode={form.mode} value={form.value} onChange={(v) => setForm(f => ({ ...f, value: v }))} projects={data.projects} busy={busy} onSave={save} onClose={() => setForm(null)} />}
    </>
  );
  return { tools, body };
}
