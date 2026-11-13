/* ══ 🧩 ออกแบบใบงาน e-Workflow — /workflow-designer (2026-11-13 · เฟส 1) ══════════════════════
   📄 docs/E-WORKFLOW-DESIGN.md §9.4 · docs/modules/e-workflow.md
   แท็บ: ใบงานทั้งหมด (list) · แก้ไข (edit) · รอเผยแพร่ (review — admin)
   ขั้นตอน: Key User (flag แอดมินหน่วยงาน · คีย์ wf:design) ร่าง → "ส่งขอเผยแพร่" → admin (wf:publish) กดเผยแพร่/ส่งกลับ
   🔴 แก้ได้เฉพาะใบของส่วนงานบ้านตัวเอง (ตัดสินฝั่ง DB `wf_can_own`) · เวอร์ชันที่เผยแพร่แล้วแก้ไม่ได้ (แก้ = เวอร์ชันใหม่)
   🔴 บันทึกทุกอย่างผ่าน RPC (wf_save_draft / wf_request_publish / wf_review_publish / wf_set_def_status)
   ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import StepFlow from '../components/StepFlow';
import PersonSelect from '../components/PersonSelect';
import WfFormFields from '../components/WfFormFields';
import { WarnBar, btn, ghost, card, inp, thSt, tdSt, Field } from '../components/NpiUi';
import { toast } from '../components/Toast';
import useTabParam, { useMergeParams } from '../utils/useTabParam';
import { hasPermission } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import { notifyEvent } from '../utils/notifyEvent';
import { useOrgSections } from '../utils/useOrgSections';
import { ROLE_OPTIONS, roleLabel } from '../utils/roleMeta';
import { FIELD_TYPES, STEP_KINDS, ASSIGNEE_RULES, validateDef, nextKey, TEMPLATE_4M } from '../utils/wfSchema';
import { wfFlow } from '../utils/wfFlow';
import { useSearchParams } from 'react-router-dom';
import { tr } from '../utils/i18n';

const TABS = [
  { key: 'list', label: '📋 ใบงานทั้งหมด' },
  { key: 'edit', label: '✎ ออกแบบ' },
  { key: 'review', label: '🛂 รอเผยแพร่' },
];
const VSTATUS = { draft: 'ร่าง', pending_publish: 'รอ admin เผยแพร่', published: 'เผยแพร่แล้ว' };
const DSTATUS = { draft: 'ยังไม่เคยเผยแพร่', active: 'ใช้งาน', retired: 'เลิกใช้' };
const EMPTY = { defId: null, key: '', name: '', description: '', ownerSection: '', numberPrefix: '', fields: [], steps: [], startRoles: [], onReturn: 'first' };

function fire(res) {
  for (const n of res?.notify || []) {
    const users = (n.users || []).filter(Boolean);
    if (users.length) notifyEvent({ event: n.event, lines: [n.text], extra_user_ids: users.slice(0, 20) });
  }
}

export default function WorkflowDesigner() {
  const { role, section } = useContext(UserContext);
  const canDesign = hasPermission('wf:design', role);
  const canPublish = hasPermission('wf:publish', role);
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'list');
  const [params] = useSearchParams();
  const merge = useMergeParams();
  const defParam = params.get('def') || '';
  const [defs, setDefs] = useState([]);
  const [vers, setVers] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from('wf_defs').select('id, key, name, description, owner_section, number_prefix, status, current_version_id, updated_at').order('name'),
      supabase.from('wf_versions').select('id, def_id, version_no, status, form_schema, flow_schema, start_roles, review_note, submitted_at').order('version_no', { ascending: false }),
    ]).then(([d, v]) => {
      if (!alive) return;
      const e = d.error || v.error;
      setLoadErr(e ? `โหลดใบงานไม่สำเร็จ: ${e.message}` : '');
      setDefs(d.data || []); setVers(v.data || []);
    });
    return () => { alive = false; };
  }, [reload]);

  const latestOf = useMemo(() => {
    const m = {};
    for (const v of vers) if (!m[v.def_id]) m[v.def_id] = v;
    return m;
  }, [vers]);
  const pending = vers.filter(v => v.status === 'pending_publish');
  const tabs = TABS.filter(t => t.key !== 'review' || canPublish).map(t => (t.key === 'review' && pending.length ? { ...t, label: `${t.label} (${pending.length})` } : t));
  const openDef = (id) => { merge({ tab: 'edit', def: id || null }); };
  const refresh = () => setReload(x => x + 1);

  return (
    <Page>
      <PageHeader title={tr('ออกแบบใบงาน (e-Workflow)')} icon="🗂️"
        sub={tr('สร้างแบบฟอร์ม + สายอนุมัติเองได้ · Key User ส่งขอเผยแพร่ → admin กดเผยแพร่')}
        tabs={tabs} tab={tab} onTab={(k) => merge({ tab: k, def: k === 'edit' ? defParam || null : null })}
        actions={canDesign ? <button type="button" className="pg-btn" onClick={() => openDef(null)}>{tr('+ ใบงานใหม่')}</button> : null} />
      {loadErr && <WarnBar>{loadErr}</WarnBar>}
      {!canDesign && <WarnBar color="var(--amber)">{tr('คุณดูได้อย่างเดียว — การออกแบบใบงานต้องมีสิทธิ์ wf:design (admin หรือ Key User = แอดมินหน่วยงาน)')}</WarnBar>}

      {tab === 'list' && (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          {!defs.length ? <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>{tr('ยังไม่มีใบงาน — กด "+ ใบงานใหม่"')}</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr><th style={thSt}>{tr('ใบงาน')}</th><th style={thSt}>{tr('รหัส')}</th><th style={thSt}>{tr('เจ้าของ')}</th><th style={thSt}>{tr('สถานะ')}</th><th style={thSt}>{tr('เวอร์ชันล่าสุด')}</th></tr></thead>
              <tbody>{defs.map(d => {
                const lv = latestOf[d.id];
                return (
                  <tr key={d.id} onClick={() => openDef(d.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdSt, fontWeight: 800, color: 'var(--text)' }}>{d.name}</td>
                    <td style={tdSt}>{d.key}</td><td style={tdSt}>{d.owner_section}</td>
                    <td style={tdSt}>{tr(DSTATUS[d.status] || d.status)}</td>
                    <td style={tdSt}>{lv ? `v${lv.version_no} · ${tr(VSTATUS[lv.status] || lv.status)}` : '—'}{lv?.review_note && lv.status === 'draft' ? ` · ↩ ${lv.review_note}` : ''}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'edit' && <Editor key={`${defParam || 'new'}:${latestOf[defParam]?.id || (defs.length ? "x" : "")}`} def={defs.find(d => d.id === defParam) || null} latest={latestOf[defParam] || null}
        canDesign={canDesign} canPublish={canPublish} mySection={section} onSaved={(id) => { refresh(); if (id && id !== defParam) merge({ def: id }); }} />}

      {tab === 'review' && canPublish && (
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {!pending.length && <div style={{ ...card, fontSize: 13, color: 'var(--muted)' }}>{tr('ไม่มีใบงานรอเผยแพร่')}</div>}
          {pending.map(v => <ReviewCard key={v.id} v={v} def={defs.find(d => d.id === v.def_id)} onDone={refresh} />)}
        </div>
      )}
    </Page>
  );
}

function Editor({ def, latest, canDesign, canPublish, mySection, onSaved }) {
  const sections = useOrgSections();
  const [s, setS] = useState(() => def && latest ? {
    defId: def.id, key: def.key, name: def.name, description: def.description || '', ownerSection: def.owner_section,
    numberPrefix: def.number_prefix || '', fields: latest.form_schema?.fields || [], steps: latest.flow_schema?.steps || [],
    startRoles: latest.start_roles || [], onReturn: latest.flow_schema?.onReturn || 'first',
  } : { ...EMPTY, ownerSection: mySection || '' });
  const [perms, setPerms] = useState([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState({});
  useEffect(() => {
    let alive = true;
    supabase.from('permission_catalog').select('resource, action, label').order('sort').then(({ data, error }) => {
      if (!alive) return;
      if (error) toast.error(`โหลดรายการสิทธิ์ไม่สำเร็จ: ${error.message}`);
      setPerms((data || []).filter(p => p.resource !== 'page' && p.resource !== 'wf').map(p => ({ key: `${p.resource}:${p.action}`, label: p.label })));
    });
    return () => { alive = false; };
  }, []);

  const locked = latest?.status === 'pending_publish';
  const readOnly = !canDesign || locked;
  const published = !!def?.current_version_id;
  const errs = validateDef({ key: s.key, name: s.name, ownerSection: s.ownerSection, form: { fields: s.fields }, flow: { steps: s.steps }, startRoles: s.startRoles });
  const up = (patch) => setS(x => ({ ...x, ...patch }));
  const setField = (i, patch) => up({ fields: s.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const setStep = (i, patch) => up({ steps: s.steps.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };
  const payload = () => ({
    def_id: s.defId, key: s.key.trim(), name: s.name, description: s.description, owner_section: s.ownerSection, number_prefix: s.numberPrefix,
    form_schema: { fields: s.fields }, flow_schema: { steps: s.steps, onReturn: s.onReturn }, start_roles: s.startRoles,
  });
  const save = async () => {
    setBusy(true);
    const res = await supabase.rpc('wf_save_draft', { p: payload() });
    setBusy(false);
    if (!checkWrite(res, 'บันทึกร่าง')) return null;
    toast.success(tr('บันทึกร่างแล้ว'));
    up({ defId: res.data.def_id });
    onSaved(res.data.def_id);
    return res.data;
  };
  const requestPublish = async () => {
    if (errs.length) { toast.error(errs[0]); return; }
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    const res = await supabase.rpc('wf_request_publish', { p_version: saved.version_id });
    setBusy(false);
    if (!checkWrite(res, 'ส่งขอเผยแพร่')) return;
    fire(res.data);
    toast.success(tr('ส่งขอเผยแพร่แล้ว — รอ admin'));
    onSaved(saved.def_id);
  };
  const setDefStatus = async (st) => {
    setBusy(true);
    const res = await supabase.rpc('wf_set_def_status', { p_def: def.id, p_status: st });
    setBusy(false);
    if (checkWrite(res, st === 'retired' ? 'เลิกใช้ใบงาน' : 'เปิดใช้ใบงาน')) { toast.success(tr('บันทึกแล้ว')); onSaved(def.id); }
  };
  const previewFlow = wfFlow({ status: 'in_progress', current_step: 0 }, { steps: s.steps });

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      {locked && <WarnBar color="var(--amber)">{tr('เวอร์ชันนี้รอ admin เผยแพร่ — แก้ไม่ได้จนกว่าจะได้ผล')}</WarnBar>}
      {latest?.status === 'draft' && latest?.review_note && <WarnBar color="var(--amber)">↩ {tr('admin ส่งกลับ')}: {latest.review_note}</WarnBar>}
      {published && latest?.status === 'published' && !readOnly && <WarnBar color="var(--accent)">{tr('ใบนี้เผยแพร่แล้ว — บันทึกครั้งถัดไปจะเป็นเวอร์ชันใหม่ (ใบที่เปิดไปแล้วยังเดินตามเวอร์ชันเดิม)')}</WarnBar>}
      {!s.defId && !readOnly && (
        <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{tr('เริ่มจากแม่แบบ:')}</span>
          <button type="button" style={ghost} onClick={() => up({ name: TEMPLATE_4M.name, key: s.key || 'test_4m', fields: TEMPLATE_4M.form.fields, steps: TEMPLATE_4M.flow.steps, onReturn: TEMPLATE_4M.flow.onReturn, startRoles: TEMPLATE_4M.startRoles })}>
            {tr('🧪 4M Change (ทดลอง)')}
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('ใบทดลองในตัวสร้าง — ไม่ใช่ใบ 4M จริงที่หน้า /report')}</span>
        </div>
      )}

      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>① {tr('ข้อมูลใบงาน')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          <Field label={tr('ชื่อใบงาน *')}><input value={s.name} disabled={readOnly} onChange={e => up({ name: e.target.value })} style={inp} /></Field>
          <Field label={tr('รหัส (key) *')} hint={tr('อังกฤษตัวเล็ก · เปลี่ยนไม่ได้หลังเผยแพร่')}>
            <input value={s.key} disabled={readOnly || published} onChange={e => up({ key: e.target.value.toLowerCase() })} style={inp} /></Field>
          <Field label={tr('ส่วนงานเจ้าของ *')} hint={tr('แก้ได้เฉพาะส่วนงานของคุณ')}>
            <select value={s.ownerSection} disabled={readOnly} onChange={e => up({ ownerSection: e.target.value })} style={inp}>
              <option value="">{tr('— เลือก —')}</option>
              {[...new Set([s.ownerSection, ...sections].filter(Boolean))].map(x => <option key={x} value={x}>{x}</option>)}
            </select></Field>
          <Field label={tr('คำนำหน้าเลขที่ใบ')} hint={tr('ว่าง = ใช้รหัส')}><input value={s.numberPrefix} disabled={readOnly} onChange={e => up({ numberPrefix: e.target.value.toUpperCase() })} style={inp} /></Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label={tr('คำอธิบาย')}><input value={s.description} disabled={readOnly} onChange={e => up({ description: e.target.value })} style={inp} /></Field></div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>② {tr('ช่องกรอกในฟอร์ม')}</div>
        {s.fields.map((f, i) => {
          const meta = FIELD_TYPES.find(t => t.type === f.type);
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none', alignItems: 'end' }}>
              <Field label={`${i + 1}. ${tr('ชื่อช่อง')}`}><input value={f.label || ''} disabled={readOnly} onChange={e => setField(i, { label: e.target.value })} style={inp} /></Field>
              <Field label={tr('ชนิด')}>
                <select value={f.type} disabled={readOnly} onChange={e => setField(i, { type: e.target.value })} style={inp}>
                  {FIELD_TYPES.map(t => <option key={t.type} value={t.type}>{tr(t.label)}</option>)}
                </select></Field>
              <Field label={tr('รหัสช่อง')}><input value={f.key || ''} disabled={readOnly} onChange={e => setField(i, { key: e.target.value.toLowerCase() })} style={inp} /></Field>
              {meta?.hasOptions && <Field label={tr('ตัวเลือก (คั่นด้วย ,)')}>
                <input value={(f.options || []).join(',')} disabled={readOnly} onChange={e => setField(i, { options: e.target.value.split(',').map(x => x.trim()) })} style={inp} /></Field>}
              {!meta?.display && <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!f.required} disabled={readOnly} onChange={e => setField(i, { required: e.target.checked })} /> {tr('บังคับกรอก')}</label>}
              {!readOnly && <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" style={ghost} onClick={() => up({ fields: move(s.fields, i, -1) })} aria-label={tr('เลื่อนขึ้น')}>↑</button>
                <button type="button" style={ghost} onClick={() => up({ fields: move(s.fields, i, 1) })} aria-label={tr('เลื่อนลง')}>↓</button>
                <button type="button" style={ghost} onClick={() => up({ fields: s.fields.filter((_, j) => j !== i) })} aria-label={tr('ลบช่อง')}>✕</button>
              </div>}
            </div>
          );
        })}
        {!readOnly && <button type="button" style={{ ...ghost, marginTop: 8 }} onClick={() => up({ fields: [...s.fields, { key: nextKey('f', s.fields), type: 'text', label: '', required: false }] })}>{tr('+ เพิ่มช่อง')}</button>}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>③ {tr('สายอนุมัติ (เรียงตามลำดับ)')}</div>
        {s.steps.map((st, i) => {
          const a = st.assignee || {};
          const setA = (patch) => setStep(i, { assignee: { ...a, ...patch } });
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8, padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none', alignItems: 'end' }}>
              <Field label={`${tr('ขั้นที่')} ${i + 1}`}><input value={st.label || ''} disabled={readOnly} onChange={e => setStep(i, { label: e.target.value })} style={inp} /></Field>
              <Field label={tr('ชนิดขั้น')}>
                <select value={st.kind || 'approve'} disabled={readOnly} onChange={e => setStep(i, { kind: e.target.value })} style={inp}>
                  {STEP_KINDS.map(k => <option key={k.kind} value={k.kind}>{tr(k.label)}</option>)}
                </select></Field>
              <Field label={tr('ใครทำขั้นนี้')}>
                <select value={a.rule || ''} disabled={readOnly} onChange={e => setStep(i, { assignee: { rule: e.target.value, unit: e.target.value === 'perm_in_unit' ? 'instance' : undefined } })} style={inp}>
                  <option value="">{tr('— เลือก —')}</option>
                  {ASSIGNEE_RULES.map(r => <option key={r.rule} value={r.rule}>{tr(r.label)}</option>)}
                </select></Field>
              {a.rule === 'perm_in_unit' && <>
                <Field label={tr('คีย์สิทธิ์')}>
                  <select value={a.perm || ''} disabled={readOnly} onChange={e => setA({ perm: e.target.value })} style={inp}>
                    <option value="">{tr('— เลือก —')}</option>
                    {[...new Set([a.perm, ...perms.map(p => p.key)].filter(Boolean))].map(k => <option key={k} value={k}>{perms.find(p => p.key === k)?.label || k}</option>)}
                  </select></Field>
                <Field label={tr('ส่วนงาน')}>
                  <select value={a.unit || 'instance'} disabled={readOnly} onChange={e => setA({ unit: e.target.value })} style={inp}>
                    <option value="instance">{tr('ส่วนงานของผู้เปิดใบ')}</option>
                    {[...new Set([a.unit !== 'instance' ? a.unit : null, ...sections].filter(Boolean))].map(x => <option key={x} value={x}>{x}</option>)}
                  </select></Field>
              </>}
              {a.rule === 'creator_head' && <Field label={tr('หัวหน้าชั้นที่')}>
                <select value={a.levels || 1} disabled={readOnly} onChange={e => setA({ levels: Number(e.target.value) })} style={inp}>
                  {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                </select></Field>}
              {a.rule === 'person' && <Field label={tr('คน')}>
                <PersonSelect value={a.profile_name || ''} allowFree={false} disabled={readOnly} onChange={(p) => setA({ profile_id: p?.uid || null, profile_name: p?.name || '' })} /></Field>}
              {!readOnly && <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" style={ghost} onClick={() => up({ steps: move(s.steps, i, -1) })} aria-label={tr('เลื่อนขึ้น')}>↑</button>
                <button type="button" style={ghost} onClick={() => up({ steps: move(s.steps, i, 1) })} aria-label={tr('เลื่อนลง')}>↓</button>
                <button type="button" style={ghost} onClick={() => up({ steps: s.steps.filter((_, j) => j !== i) })} aria-label={tr('ลบขั้น')}>✕</button>
              </div>}
            </div>
          );
        })}
        {!readOnly && <button type="button" style={{ ...ghost, marginTop: 8 }} onClick={() => up({ steps: [...s.steps, { key: nextKey('s', s.steps), label: '', kind: 'approve', assignee: {} }] })}>{tr('+ เพิ่มขั้น')}</button>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <Field label={tr('ส่งกลับให้แก้ แล้วส่งใหม่ เริ่มที่')}>
            <select value={s.onReturn} disabled={readOnly} onChange={e => up({ onReturn: e.target.value })} style={{ ...inp, width: 260 }}>
              <option value="first">{tr('ขั้นแรก (อนุมัติใหม่ทั้งหมด)')}</option>
              <option value="same">{tr('ขั้นที่ส่งกลับ')}</option>
            </select></Field>
        </div>
        {!!s.steps.length && <StepFlow steps={previewFlow.steps} style={{ marginTop: 12 }} />}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>④ {tr('ใครเปิดใบนี้ได้ (role)')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {ROLE_OPTIONS.filter(r => r.value !== 'display').map(r => (
            <label key={r.value} style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
              <input type="checkbox" disabled={readOnly} checked={s.startRoles.includes(r.value)}
                onChange={e => up({ startRoles: e.target.checked ? [...s.startRoles, r.value] : s.startRoles.filter(x => x !== r.value) })} />
              {roleLabel(r.value)}
            </label>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>👁 {tr('ตัวอย่างฟอร์ม')}</div>
        <WfFormFields form={{ fields: s.fields }} data={preview} onChange={setPreview} />
      </div>

      {!!errs.length && !readOnly && (
        <div style={{ ...card, borderColor: 'var(--amber)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--amber)', marginBottom: 4 }}>{tr('ยังส่งขอเผยแพร่ไม่ได้')} ({errs.length})</div>
          {errs.map(e => <div key={e} style={{ fontSize: 12, color: 'var(--text2)' }}>• {e}</div>)}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        {canPublish && def?.current_version_id && (def.status === 'active'
          ? <button type="button" style={ghost} disabled={busy} onClick={() => setDefStatus('retired')}>{tr('เลิกใช้ใบนี้')}</button>
          : <button type="button" style={ghost} disabled={busy} onClick={() => setDefStatus('active')}>{tr('เปิดใช้อีกครั้ง')}</button>)}
        {!readOnly && <button type="button" style={ghost} disabled={busy} onClick={save}>{tr('บันทึกร่าง')}</button>}
        {!readOnly && <button type="button" style={btn()} disabled={busy || !!errs.length} onClick={requestPublish}>{tr('ส่งขอเผยแพร่')}</button>}
      </div>
    </div>
  );
}

function ReviewCard({ v, def, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const steps = v.flow_schema?.steps || [];
  const f = wfFlow({ status: 'in_progress', current_step: 0 }, v.flow_schema);
  const act = async (approve) => {
    if (!approve && !note.trim()) { toast.error(tr('ส่งกลับต้องใส่เหตุผล')); return; }
    setBusy(true);
    const res = await supabase.rpc('wf_review_publish', { p_version: v.id, p_approve: approve, p_note: note || null });
    setBusy(false);
    if (!checkWrite(res, approve ? 'เผยแพร่' : 'ส่งกลับ')) return;
    fire(res.data);
    toast.success(approve ? tr('เผยแพร่แล้ว') : tr('ส่งกลับแล้ว'));
    onDone();
  };
  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 14 }}>{def?.name || '?'} · v{v.version_no} <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>({def?.key} · {tr('เจ้าของ')} {def?.owner_section})</span></div>
      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
        {tr('ช่องกรอก')} {(v.form_schema?.fields || []).length} · {tr('ขั้นอนุมัติ')} {steps.length} · {tr('เปิดใบได้')}: {(v.start_roles || []).map(roleLabel).join(', ') || '—'}
      </div>
      <StepFlow steps={f.steps} style={{ marginBottom: 8 }} />
      {steps.map((s, i) => <div key={s.key || i} style={{ fontSize: 12, color: 'var(--text2)' }}>{i + 1}. {s.label} — {ASSIGNEE_RULES.find(r => r.rule === s.assignee?.rule)?.label || '?'} {s.assignee?.perm ? `(${s.assignee.perm} · ${s.assignee.unit === 'instance' ? tr('ส่วนงานผู้เปิด') : s.assignee.unit})` : ''}{s.assignee?.profile_name ? `(${s.assignee.profile_name})` : ''}</div>)}
      <div style={{ marginTop: 10 }}><WfFormFields form={v.form_schema} data={{}} readOnly /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ flex: '1 1 240px' }}><Field label={tr('หมายเหตุ / เหตุผลส่งกลับ')}><input value={note} onChange={e => setNote(e.target.value)} style={inp} /></Field></div>
        <button type="button" style={ghost} disabled={busy} onClick={() => act(false)}>{tr('↩ ส่งกลับ')}</button>
        <button type="button" style={btn()} disabled={busy} onClick={() => act(true)}>{tr('✓ เผยแพร่')}</button>
      </div>
    </div>
  );
}
