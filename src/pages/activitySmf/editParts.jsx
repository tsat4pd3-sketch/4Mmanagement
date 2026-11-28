/* ══ 🏭 Smart Factory → Edit Data — ชิ้นส่วนจอ (ผลงานรายเดือน · ดูข้อเสนอ · ฟอร์มข้อเสนอ) · hook หลักอยู่ `useEditSmf.jsx` ══ */
import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { toast } from '../../components/Toast';
import { AttachImage } from '../../components/ImageLightbox';
import PersonSelect from '../../components/PersonSelect';
import { tr } from '../../utils/i18n';
import { fmtDate, monthsShort } from '../../utils/dateFormat';
import { checkWrite } from '../../utils/dbWrite';
import { WF_BENEFITS, WF_BUDGET, WF_DIFFICULTY, WF_FREQUENCY, WF_STATUS, wfTechOptions } from './labels.js';
import { stamp } from './sections.js';
import { Chip, fmtNum, inp, lab, num, sel, statusOf, td, th } from './editStyles.js';

/* ── ผลงานรายเดือน ───────────────────────────────────────────────────────────────── */
export function MonthEditor({ data, canEdit, reload, yearPick }) {
  const projects = data.projects.filter(p => p.status === 'Active');
  const [code, setCode] = useState('');
  const proj = projects.find(p => p.code === code) || projects[0] || null;
  const saved = new Map(data.months.filter(r => proj && r.act_project === proj.act_project).map(r => [r.month, r]));
  const [draft, setDraft] = useState({ key: null, rows: {} });
  const dKey = proj ? proj.act_project : '';
  const rows = draft.key === dKey ? draft.rows : Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
    const r = saved.get(i + 1);
    return [i + 1, { target: r?.target ?? '', actual: r?.actual ?? '', note: r?.note ?? '' }];
  }));
  const setCell = (m, k, v) => setDraft({ key: dKey, rows: { ...rows, [m]: { ...rows[m], [k]: v } } });
  const dirty = draft.key === dKey;
  const [busy, setBusy] = useState(false);
  const names = monthsShort();

  const save = async () => {
    const list = Object.entries(rows).map(([m, r]) => ({ month: Number(m), target: num(r.target), actual: num(r.actual), note: String(r.note || '').trim() || null }))
      .filter(r => r.target != null || r.actual != null || r.note || saved.has(r.month))
      .map(r => ({ act_project: proj.act_project, ...r, ...stamp() }));
    if (!list.length) { toast.info(tr('ยังไม่มีตัวเลขให้บันทึก')); return; }
    setBusy(true);
    const res = await supabase.from('act03_project_month').upsert(list, { onConflict: 'act_project,month' }).select('month');
    setBusy(false);
    if (!checkWrite(res, tr('บันทึกผลงานรายเดือน'))) return;
    if (!res.data?.length) { toast.error(tr('บันทึกไม่ติด (0 แถว) — อาจไม่มีสิทธิ์แก้ Smart Factory')); return; }
    toast.success(`${tr('บันทึกผลงาน')} ${proj.name} ${res.data.length} ${tr('เดือนแล้ว')}`);
    setDraft({ key: null, rows: {} }); reload();
  };

  if (!proj) return <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('ปีนี้ยังไม่มีโครงการ — เพิ่มที่ Setting → โครงการ')}</div>;
  const totals = Object.values(rows).reduce((s, r) => ({ t: s.t + (num(r.target) || 0), a: s.a + (num(r.actual) || 0) }), { t: 0, a: 0 });
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {yearPick}
        <select style={sel} value={proj.code} onChange={e => { setCode(e.target.value); setDraft({ key: null, rows: {} }); }} aria-label={tr('โครงการ')}>
          {projects.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>KPI: {proj.target_name || '-'}{proj.unit ? ` (${proj.unit})` : ''}</span>
        <span style={{ flex: 1 }} />
        {canEdit && <button className="pg-btn" onClick={save} disabled={busy || !dirty} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? tr('กำลังบันทึก…') : tr('บันทึก')}</button>}
      </div>
      {!canEdit && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{tr('ดูอย่างเดียว — บัญชีนี้ยังไม่มีสิทธิ์แก้ข้อมูล Smart Factory')}</div>}
      <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['เดือน', 'เป้าหมาย', 'ผลงาน', 'ผลต่าง', '% บรรลุ', 'หมายเหตุ'].map((h, i) => <th key={h} style={{ ...th, textAlign: i > 0 && i < 5 ? 'right' : 'left' }}>{tr(h)}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
              const r = rows[m];
              const t = num(r.target), a = num(r.actual);
              const pct = t ? Math.round((a ?? 0) / t * 100) : null;
              return (
                <tr key={m}>
                  <td style={td}>{names[m - 1]}</td>
                  <td style={{ ...td, width: 140 }}><input type="number" style={{ ...inp, textAlign: 'right' }} value={r.target} disabled={!canEdit} onChange={e => setCell(m, 'target', e.target.value)} aria-label={`${tr('เป้าหมาย')} ${names[m - 1]}`} /></td>
                  <td style={{ ...td, width: 140 }}><input type="number" style={{ ...inp, textAlign: 'right' }} value={r.actual} disabled={!canEdit} onChange={e => setCell(m, 'actual', e.target.value)} aria-label={`${tr('ผลงาน')} ${names[m - 1]}`} /></td>
                  <td style={{ ...td, textAlign: 'right', color: t != null && a != null ? (a - t >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--muted)' }}>{t != null && a != null ? fmtNum(a - t) : '-'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{pct == null ? '-' : `${pct}%`}</td>
                  <td style={td}><input style={inp} value={r.note} disabled={!canEdit} onChange={e => setCell(m, 'note', e.target.value)} aria-label={`${tr('หมายเหตุ')} ${names[m - 1]}`} /></td>
                </tr>
              );
            })}
            <tr>
              <td style={{ ...td, fontWeight: 700 }}>{tr('รวม')}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtNum(totals.t)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtNum(totals.a)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtNum(totals.a - totals.t)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.t ? `${Math.round(totals.a / totals.t * 100)}%` : '-'}</td>
              <td style={td} />
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Work Flow: ดูแบบ Improvement Proposal ───────────────────────────────────────── */
export function IdeaView({ idea, images, evals, projName, onClose }) {
  const st = statusOf(idea.project_status);
  const group = (type) => images.filter(i => i.image_type === type);
  const all = images.map(i => ({ url: i.image_url, title: i.image_type === 'BEFORE' ? 'Before' : 'After', caption: i.image_description || null }));
  const save = (a, b) => (a != null && b != null && Number(a) > 0 ? `${Math.round((1 - Number(b) / Number(a)) * 100)}%` : '-');
  const box = { background: 'var(--bg3)', borderRadius: 'var(--r-md)', padding: 12 };
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 'min(96vw, 980px)', maxWidth: 980, maxHeight: '94vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Improvement Proposal · {projName(idea.project_code)}</div>
            <h3 style={{ margin: '4px 0 0', fontSize: 19, color: 'var(--text)' }}>{idea.project_name}</h3>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
              {idea.full_name}{idea.department ? ` · ${idea.department}` : ''}{idea.team_name ? ` · ${idea.team_name}` : ''} · {fmtDate(idea.created_at)}
            </div>
            {idea.members?.length > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{tr('สมาชิก')}: {idea.members.join(', ')}</div>}
          </div>
          <Chip tone={st.tone}>{st.label}</Chip>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12, marginTop: 14 }}>
          {['BEFORE', 'AFTER'].map(type => (
            <div key={type} style={box}>
              <div style={{ fontWeight: 800, color: type === 'BEFORE' ? 'var(--red)' : 'var(--green)', marginBottom: 8 }}>{type}</div>
              {group(type).length ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {group(type).map(img => (
                    <AttachImage key={img.act_image} url={img.image_url} items={all} index={images.indexOf(img)} title={type} caption={img.image_description || null} maxHeight={160} />
                  ))}
                </div>
              ) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ยังไม่มีรูป')}</div>}
              <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 8, whiteSpace: 'pre-wrap' }}>
                {type === 'BEFORE' ? [idea.process_name, idea.current_description, idea.current_problem].filter(Boolean).join('\n\n') : [idea.improvement_description, idea.proposed_technology && `${tr('เทคโนโลยี')}: ${idea.proposed_technology}`].filter(Boolean).join('\n\n')}
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...box, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>{tr('ผลลัพธ์ที่คาดหวัง')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['', 'ก่อน', 'หลัง', 'ลดลง'].map(h => <th key={h} style={{ ...th, background: 'transparent', textAlign: h ? 'right' : 'left' }}>{tr(h)}</th>)}</tr></thead>
            <tbody>
              {[['เวลาทำงาน (นาที)', 'time'], ['การใช้กระดาษ (แผ่น)', 'paper'], ['ขั้นตอนการทำงาน', 'steps']].map(([l, k]) => (
                <tr key={k}><td style={td}>{tr(l)}</td><td style={{ ...td, textAlign: 'right' }}>{fmtNum(idea[`${k}_before`])}</td><td style={{ ...td, textAlign: 'right' }}>{fmtNum(idea[`${k}_after`])}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{save(idea[`${k}_before`], idea[`${k}_after`])}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            {tr('ความถี่')}: {idea.frequency || '-'} · {tr('ความยาก')}: {idea.difficulty || '-'} · {tr('งบประมาณ')}: {idea.budget || '-'}
            {Array.isArray(idea.improvement_benefits) && idea.improvement_benefits.length > 0 && ` · ${tr('ประโยชน์')}: ${idea.improvement_benefits.map(b => tr(WF_BENEFITS.find(x => x.value === b)?.label || b)).join(', ')}`}
          </div>
        </div>
        {(evals.length > 0 || idea.admin_note) && (
          <div style={{ ...box, marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>{tr('ผลประเมิน')}</div>
            {idea.admin_note && <div style={{ fontSize: 13, marginBottom: 6 }}>{idea.admin_note}</div>}
            {evals.map(e => <div key={e.act_eval} style={{ fontSize: 12, color: 'var(--text2)' }}>{fmtDate(e.created_at)} · {e.evaluator_name || '-'} · {statusOf(e.evaluation_status).label}{e.evaluation_note ? ` · ${e.evaluation_note}` : ''}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}><button className="pg-btn" onClick={onClose}>{tr('ปิด')}</button></div>
      </div>
    </div>
  );
}

/* ── Work Flow: ฟอร์มเพิ่ม/แก้ไข (ไม่ปิดเมื่อคลิกพื้นหลัง) ───────────────────────────── */

export function IdeaForm({ value, onChange, projects, busy, onSave, onClose, mode }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const field = (k, label, opts = {}) => (
    <div style={opts.wide ? { gridColumn: '1 / -1' } : undefined}>
      <label style={lab}>{tr(label)}{opts.required ? ' *' : ''}</label>
      {opts.area
        ? <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' }} value={value[k] ?? ''} onChange={e => set(k, e.target.value)} />
        : <input style={inp} type={opts.number ? 'number' : 'text'} value={value[k] ?? ''} onChange={e => set(k, e.target.value)} />}
    </div>
  );
  const select = (k, label, list, labelFn = (x) => x) => (
    <div>
      <label style={lab}>{tr(label)}</label>
      <select style={inp} value={value[k] ?? ''} onChange={e => set(k, e.target.value)}>
        {list.map(x => <option key={x.value ?? x} value={x.value ?? x}>{tr(labelFn(x))}</option>)}
      </select>
    </div>
  );
  const head = (t) => <div style={{ gridColumn: '1 / -1', fontWeight: 800, color: 'var(--accent)', marginTop: 6 }}>{tr(t)}</div>;
  const techs = wfTechOptions(value.project_code);
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 'min(96vw, 760px)', maxWidth: 760, maxHeight: '94vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0, fontSize: 17, color: 'var(--text)' }}>{tr(mode === 'add' ? 'เพิ่มข้อเสนอ Work Flow Automation' : 'แก้ไขข้อเสนอ')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 10 }}>
          {head('01 ผู้เสนอ / ทีม')}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lab}>{tr('ผู้ส่ง')} *</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <PersonSelect source="employees" allowFree={false} value={value.full_name || ''}
                  onChange={(p) => onChange({ ...value, employee_code: p.employee_code || '', full_name: p.employee_code ? p.name : '', department: value.department || p.section || '' })} />
              </div>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, minWidth: 64 }}>{value.employee_code || '-'}</span>
            </div>
          </div>
          {select('project_code', 'โครงการ', projects.map(p => ({ value: p.code, label: p.name })), x => x.label)}
          {field('team_name', 'ชื่อทีม / กลุ่ม')}
          {field('department', 'หน่วยงาน')}
          {field('members', 'สมาชิกในทีม (คั่นด้วย ,)', { wide: true })}
          {head('02 กระบวนการเดิม (Before)')}
          {field('process_name', 'ชื่อกระบวนการ', { required: true, wide: true })}
          {field('current_description', 'วิธีทำงานปัจจุบัน', { area: true, wide: true })}
          {field('current_problem', 'ปัญหาที่พบ', { area: true, wide: true })}
          {select('frequency', 'ความถี่', WF_FREQUENCY)}
          {head('03 โครงการใหม่ (After)')}
          {field('project_name', 'ชื่อโครงการ', { required: true, wide: true })}
          {field('improvement_description', 'วิธีปรับปรุง', { area: true, wide: true })}
          {select('proposed_technology', 'เทคโนโลยี', ['', ...techs], x => x || '-')}
          {head('04 ประโยชน์')}
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {WF_BENEFITS.map(b => {
              const on = value.improvement_benefits.includes(b.value);
              return (
                <label key={b.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => set('improvement_benefits', on ? value.improvement_benefits.filter(x => x !== b.value) : [...value.improvement_benefits, b.value])} />
                  {tr(b.label)}
                </label>
              );
            })}
          </div>
          {head('05 ผลลัพธ์ที่คาดหวัง (ก่อน → หลัง)')}
          {field('time_before', 'เวลาก่อน (นาที)', { number: true })}{field('time_after', 'เวลาหลัง (นาที)', { number: true })}
          {field('paper_before', 'กระดาษก่อน (แผ่น)', { number: true })}{field('paper_after', 'กระดาษหลัง (แผ่น)', { number: true })}
          {field('steps_before', 'ขั้นตอนก่อน', { number: true })}{field('steps_after', 'ขั้นตอนหลัง', { number: true })}
          {head('06 ประเมิน')}
          {select('difficulty', 'ความยาก', WF_DIFFICULTY)}
          {select('budget', 'งบประมาณ', WF_BUDGET)}
          {select('project_status', 'สถานะ', WF_STATUS, x => x.label)}
          {field('admin_note', 'หมายเหตุผู้ประเมิน', { area: true, wide: true })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>{tr('รูป Before / After: แนบเพิ่มได้ในรอบถัดไป (รูปที่ย้ายมาจากเว็บเดิมยังอยู่ครบ)')}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="pg-btn" onClick={onClose} disabled={busy}>{tr('ยกเลิก')}</button>
          <button className="pg-btn" onClick={onSave} disabled={busy} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? tr('กำลังบันทึก…') : tr('บันทึก')}</button>
        </div>
      </div>
    </div>
  );
}

