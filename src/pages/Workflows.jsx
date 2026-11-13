/* ══ 🧩 ใบงาน e-Workflow — /workflows (2026-11-13 · เฟส 1) ══════════════════════════════════
   📄 docs/E-WORKFLOW-DESIGN.md · docs/modules/e-workflow.md
   แท็บ: รอฉัน (inbox) · ใบของฉัน (mine) · เปิดใบใหม่ (new)
   🔴 ทุกการเปลี่ยนสถานะผ่าน RPC (wf_start / wf_act / wf_resubmit / wf_cancel) — ตารางเขียนตรงไม่ได้
   🔴 ปุ่มอนุมัติ/รับทราบถามยืนยันผ่าน `confirmSign` · ตีกลับ/ส่งกลับมีช่องเหตุผลแล้ว ไม่ถามซ้ำ
   🔴 กดซ้อน/ใบเปลี่ยนระหว่างเปิด = RPC ปฏิเสธ (step_rev) แล้วจอโหลดใหม่
   ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import StepFlow from '../components/StepFlow';
import WfFormFields from '../components/WfFormFields';
import { Modal, WarnBar, btn, ghost, card, inp, thSt, tdSt, Field } from '../components/NpiUi';
import { toast } from '../components/Toast';
import useTabParam from '../utils/useTabParam';
import { hasPermission } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import { confirmSign } from '../utils/signConfirm';
import { notifyEvent } from '../utils/notifyEvent';
import { checkData } from '../utils/wfSchema';
import { wfFlow, WF_STATUS } from '../utils/wfFlow';
import { statusColor } from '../utils/statusTone';
import { tr } from '../utils/i18n';

const TABS = [
  { key: 'inbox', label: '📥 รอฉัน' },
  { key: 'mine', label: '📄 ใบของฉัน' },
  { key: 'new', label: '➕ เปิดใบใหม่' },
];
const fmt = (ts) => (ts ? new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—');
const ACTION_LABEL = { submit: 'ยื่นใบ', approve: 'อนุมัติ', reject: 'ตีกลับ', return: 'ส่งกลับให้แก้', resubmit: 'ส่งใหม่', cancel: 'ยกเลิก' };

/** ยิงแจ้งเตือนในแอปตามที่ RPC บอก (fire-and-forget · ผู้รับ = เจ้าของงานตรง) */
function fireNotify(res, ref) {
  for (const n of res?.notify || []) {
    const users = (n.users || []).filter(Boolean);
    if (!users.length) continue;
    notifyEvent({ event: n.event, lines: [n.text], extra_user_ids: users.slice(0, 20), ref_table: 'wf_instances', ref_id: ref || undefined });
  }
}

function StatusChip({ status }) {
  const m = WF_STATUS[status];
  const c = statusColor(m?.tone || 'none');
  return <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: c, border: `1px solid ${c}`, whiteSpace: 'nowrap' }}>{tr(m?.label || 'สถานะไม่รู้จัก')}</span>;
}

export default function Workflows() {
  const { role } = useContext(UserContext);
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'inbox');
  const [me, setMe] = useState(null);
  const [defs, setDefs] = useState([]);
  const [versions, setVersions] = useState({});
  const [inbox, setInbox] = useState([]);
  const [mine, setMine] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setMe(data?.session?.user?.id || null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!me) return undefined;
    let alive = true;
    setLoading(true);
    (async () => {
      const [d, t, m] = await Promise.all([
        supabase.from('wf_defs').select('id, key, name, description, status, current_version_id, owner_section'),
        supabase.from('wf_tasks').select('id, instance_id, step_index, status, created_at').eq('assignee_id', me).eq('status', 'open').order('created_at', { ascending: false }).limit(200),
        supabase.from('wf_instances').select('id, def_id, version_id, doc_no, title, status, current_step, blocked_reason, created_at, closed_at').eq('created_by', me).order('created_at', { ascending: false }).limit(200),
      ]);
      if (!alive) return;
      const err = d.error || t.error || m.error;
      if (err) { setLoadErr(`โหลดใบงานไม่สำเร็จ: ${err.message}`); setLoading(false); return; }
      setLoadErr('');
      setDefs(d.data || []);
      const ids = [...new Set((t.data || []).map(x => x.instance_id))];
      let insts = [];
      if (ids.length) {
        const r = await supabase.from('wf_instances').select('id, def_id, version_id, doc_no, title, status, current_step, step_rev, blocked_reason, created_by_name, created_at').in('id', ids);
        if (!alive) return;
        if (r.error) { setLoadErr(`โหลดใบที่รอคุณไม่สำเร็จ: ${r.error.message}`); }
        insts = r.data || [];
      }
      const byId = Object.fromEntries(insts.map(x => [x.id, x]));
      setInbox((t.data || []).map(x => ({ task: x, inst: byId[x.instance_id] })).filter(x => x.inst));
      setMine(m.data || []);
      const vIds = [...new Set([...(d.data || []).map(x => x.current_version_id), ...insts.map(x => x.version_id), ...(m.data || []).map(x => x.version_id)].filter(Boolean))];
      if (vIds.length) {
        const v = await supabase.from('wf_versions').select('id, def_id, version_no, form_schema, flow_schema').in('id', vIds);
        if (!alive) return;
        if (v.error) setLoadErr(`โหลดแบบฟอร์มไม่สำเร็จ: ${v.error.message}`);
        setVersions(Object.fromEntries((v.data || []).map(x => [x.id, x])));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [me, reload]);

  const defById = useMemo(() => Object.fromEntries(defs.map(d => [d.id, d])), [defs]);
  const startable = useMemo(() => defs.filter(d => d.status === 'active' && d.current_version_id && hasPermission(`wf:start:${d.key}`, role)), [defs, role]);
  const refresh = useCallback(() => setReload(x => x + 1), []);

  const header = (
    <PageHeader title={tr('ใบงานออนไลน์ (e-Workflow)')} icon="✍️"
      sub={tr('เปิดใบ · อนุมัติ · ติดตามสถานะ — แบบฟอร์มและสายอนุมัติตั้งที่หน้า "ออกแบบใบงาน"')}
      tabs={TABS.map(t => ({ ...t, label: t.key === 'inbox' && inbox.length ? `${t.label} (${inbox.length})` : t.label }))} tab={tab} onTab={setTab} />
  );

  return (
    <Page>
      {header}
      {loadErr && <WarnBar>{loadErr}</WarnBar>}
      {loading && !loadErr && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</div>}

      {!loading && tab === 'inbox' && (
        <ListTable empty={tr('ไม่มีใบรอคุณ')} rows={inbox.map(x => ({ ...x.inst, defName: defById[x.inst.def_id]?.name, flow: versions[x.inst.version_id]?.flow_schema }))} onOpen={setOpenId} showCreator />
      )}
      {!loading && tab === 'mine' && (
        <ListTable empty={tr('คุณยังไม่เคยเปิดใบ')} rows={mine.map(x => ({ ...x, defName: defById[x.def_id]?.name, flow: versions[x.version_id]?.flow_schema }))} onOpen={setOpenId} />
      )}
      {!loading && tab === 'new' && (
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {!startable.length && <div style={{ ...card, fontSize: 13, color: 'var(--muted)' }}>
            {tr('ยังไม่มีใบงานที่คุณเปิดได้')} — {tr('ใบงานต้องเผยแพร่แล้ว และ role ของคุณต้องถูกเลือกให้เปิดใบได้')}
          </div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, alignContent: 'start' }}>
            {startable.map(d => (
              <button key={d.id} type="button" onClick={() => setNewKey(d.key)}
                style={{ ...card, textAlign: 'left', cursor: 'pointer', color: 'var(--text)', borderColor: newKey === d.key ? 'var(--accent)' : 'var(--border)' }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{d.name}</div>
                {d.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{d.description}</div>}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{tr('เจ้าของ')}: {d.owner_section}</div>
              </button>
            ))}
          </div>
          {newKey && (() => {
            const d = defs.find(x => x.key === newKey);
            const v = d && versions[d.current_version_id];
            if (!d || !v) return <WarnBar>{tr('โหลดแบบฟอร์มของใบนี้ไม่สำเร็จ')}</WarnBar>;
            return <NewForm def={d} version={v} onDone={(id) => { setNewKey(''); refresh(); setTab('mine'); setOpenId(id); }} />;
          })()}
        </div>
      )}

      {openId && <InstanceModal id={openId} me={me} defById={defById} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </Page>
  );
}

function ListTable({ rows, onOpen, empty, showCreator }) {
  if (!rows.length) return <div style={{ ...card, fontSize: 13, color: 'var(--muted)' }}>{empty}</div>;
  return (
    <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead><tr>
          <th style={thSt}>{tr('เลขที่')}</th><th style={thSt}>{tr('ใบงาน')}</th><th style={thSt}>{tr('เรื่อง')}</th>
          {showCreator && <th style={thSt}>{tr('ผู้เปิด')}</th>}
          <th style={thSt}>{tr('ขั้น')}</th><th style={thSt}>{tr('สถานะ')}</th><th style={thSt}>{tr('เปิดเมื่อ')}</th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const f = wfFlow(r, r.flow);
            return (
              <tr key={r.id} onClick={() => onOpen(r.id)} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdSt, fontWeight: 800, color: 'var(--text)' }}>{r.doc_no}</td>
                <td style={tdSt}>{r.defName || '—'}</td>
                <td style={tdSt}>{r.title || '—'}</td>
                {showCreator && <td style={tdSt}>{r.created_by_name || '—'}</td>}
                <td style={tdSt}><StepFlow compact steps={f.steps} unknown={!f.known} /></td>
                <td style={tdSt}><StatusChip status={r.status} />{r.blocked_reason && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 3 }}>⛔ {tr('หาผู้อนุมัติไม่ได้')}</div>}</td>
                <td style={tdSt}>{fmt(r.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewForm({ def, version, onDone }) {
  const [title, setTitle] = useState('');
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const err = checkData(version.form_schema, data);
  const submit = async () => {
    if (err) { toast.error(err); return; }
    setBusy(true);
    const res = await supabase.rpc('wf_start', { p_key: def.key, p_title: title, p_data: data });
    setBusy(false);
    if (!checkWrite(res, 'เปิดใบ')) return;
    fireNotify(res.data, res.data?.id);
    toast.success(`${tr('เปิดใบแล้ว')} ${res.data?.doc_no || ''}`);
    onDone(res.data?.id);
  };
  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>{def.name}</div>
      <div style={{ marginBottom: 12 }}><Field label={tr('เรื่อง (หัวข้อสั้นๆ)')}><input value={title} onChange={e => setTitle(e.target.value)} style={inp} /></Field></div>
      <WfFormFields form={version.form_schema} data={data} onChange={setData} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {err && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{err}</span>}
        <button type="button" style={btn()} disabled={busy} onClick={submit}>{busy ? tr('กำลังส่ง…') : tr('ยื่นใบ')}</button>
      </div>
    </div>
  );
}

function InstanceModal({ id, me, defById, onClose, onChanged }) {
  const { fullName } = useContext(UserContext);
  const [state, setState] = useState(null);   // { inst, version, tasks, actions }
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState(null);     // 'reject' | 'return' | 'cancel' | 'edit'
  const [editData, setEditData] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const i = await supabase.from('wf_instances').select('*').eq('id', id).maybeSingle();
      if (!alive) return;
      if (i.error || !i.data) { setErr(i.error ? `โหลดใบไม่สำเร็จ: ${i.error.message}` : 'ไม่พบใบนี้ หรือคุณไม่มีสิทธิ์เห็น'); return; }
      const [v, t, a] = await Promise.all([
        supabase.from('wf_versions').select('id, version_no, form_schema, flow_schema').eq('id', i.data.version_id).maybeSingle(),
        supabase.from('wf_tasks').select('id, step_index, assignee_id, status').eq('instance_id', id),
        supabase.from('wf_actions').select('id, step_index, action, comment, actor_name, acted_at').eq('instance_id', id).order('acted_at'),
      ]);
      if (!alive) return;
      const e2 = v.error || t.error || a.error;
      if (e2) { setErr(`โหลดรายละเอียดไม่สำเร็จ: ${e2.message}`); return; }
      setErr('');
      setState({ inst: i.data, version: v.data, tasks: t.data || [], actions: a.data || [] });
    })();
    return () => { alive = false; };
  }, [id, tick]);

  const reloadAll = () => { setTick(x => x + 1); onChanged(); setMode(null); setReason(''); };
  if (err) return <Modal title={tr('ใบงาน')} onClose={onClose}><WarnBar>{err}</WarnBar></Modal>;
  if (!state) return <Modal title={tr('ใบงาน')} onClose={onClose}><div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</div></Modal>;

  const { inst, version, tasks, actions } = state;
  const def = defById[inst.def_id];
  const flow = wfFlow(inst, version?.flow_schema);
  const myTask = tasks.find(t => t.status === 'open' && t.assignee_id === me && t.step_index === inst.current_step);
  const step = myTask ? version?.flow_schema?.steps?.[myTask.step_index] : null;
  const isAck = step?.kind === 'ack';
  const isCreator = inst.created_by === me;
  const noApprovals = !actions.some(a => a.action === 'approve');
  const canCancel = isCreator && ['in_progress', 'returned'].includes(inst.status) && noApprovals;
  const openCount = tasks.filter(t => t.status === 'open').length;

  const run = async (fn, label) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!checkWrite(res, label)) { setTick(x => x + 1); return; }
    fireNotify(res.data, inst.id);
    toast.success(`${label}แล้ว`);
    reloadAll();
  };
  const approve = () => {
    if (!confirmSign({ what: isAck ? 'รับทราบ' : 'อนุมัติ', orderNo: inst.doc_no, docLabel: def?.name || 'ใบงาน', actor: fullName, as: step?.label,
      effect: (inst.current_step + 1 >= (version?.flow_schema?.steps?.length || 0)) ? 'ใบจบ (อนุมัติครบ)' : 'ส่งต่อขั้นถัดไป' })) return;
    run(() => supabase.rpc('wf_act', { p_task: myTask.id, p_action: 'approve', p_comment: null, p_expected_rev: inst.step_rev }), isAck ? 'รับทราบ' : 'อนุมัติ');
  };
  const withReason = () => {
    if (!reason.trim()) { toast.error(tr('ต้องใส่เหตุผล')); return; }
    if (mode === 'cancel') run(() => supabase.rpc('wf_cancel', { p_instance: inst.id, p_reason: reason }), 'ยกเลิกใบ');
    else run(() => supabase.rpc('wf_act', { p_task: myTask.id, p_action: mode, p_comment: reason, p_expected_rev: inst.step_rev }), mode === 'reject' ? 'ตีกลับ' : 'ส่งกลับให้แก้');
  };
  const resubmit = () => {
    const e = checkData(version?.form_schema, editData);
    if (e) { toast.error(e); return; }
    run(() => supabase.rpc('wf_resubmit', { p_instance: inst.id, p_data: editData, p_expected_rev: inst.step_rev }), 'ส่งใหม่');
  };

  return (
    <Modal title={`${inst.doc_no} · ${def?.name || ''}`} onClose={onClose} width={820}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <StatusChip status={inst.status} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ผู้เปิด')}: {inst.created_by_name || '—'} · {tr('ส่วนงาน')}: {inst.section || '—'} · {fmt(inst.created_at)} · v{version?.version_no ?? '?'}</span>
      </div>
      {inst.title && <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{inst.title}</div>}
      <StepFlow steps={flow.steps} waiting={flow.waiting} unknown={!flow.known} style={{ marginBottom: 12 }} />
      {inst.status === 'in_progress' && !inst.blocked_reason && openCount > 1 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{tr('ขั้นนี้มีผู้มีสิทธิ์อนุมัติ')} {openCount} {tr('คน — ใครกดก่อนก็ได้')}</div>
      )}
      {inst.blocked_reason && <WarnBar>⛔ {tr('หาผู้อนุมัติขั้นนี้ไม่ได้')}: {inst.blocked_reason} — {tr('แจ้งเจ้าของใบงานให้แก้ผู้อนุมัติ หรือยกเลิกใบ')}</WarnBar>}

      {mode === 'edit'
        ? <WfFormFields form={version?.form_schema} data={editData || {}} onChange={setEditData} />
        : <WfFormFields form={version?.form_schema} data={inst.data || {}} readOnly />}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 6 }}>{tr('ประวัติ')}</div>
        {actions.map(a => (
          <div key={a.id} style={{ fontSize: 12, color: 'var(--text2)', padding: '3px 0', borderTop: '1px solid var(--border)' }}>
            {fmt(a.acted_at)} · <b>{tr(ACTION_LABEL[a.action] || a.action)}</b> · {a.actor_name || '—'}{a.comment ? ` — ${a.comment}` : ''}
          </div>
        ))}
      </div>

      {(mode === 'reject' || mode === 'return' || mode === 'cancel') && (
        <div style={{ marginTop: 12 }}>
          <Field label={tr(mode === 'cancel' ? 'เหตุผลที่ยกเลิก *' : mode === 'reject' ? 'เหตุผลที่ตีกลับ *' : 'สิ่งที่ต้องแก้ *')}>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={inp} />
          </Field>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {mode && <button type="button" style={ghost} disabled={busy} onClick={() => { setMode(null); setReason(''); }}>{tr('ย้อนกลับ')}</button>}
        {!mode && myTask && <>
          {!isAck && <button type="button" style={ghost} disabled={busy} onClick={() => setMode('return')}>{tr('↩ ส่งกลับให้แก้')}</button>}
          {!isAck && <button type="button" style={btn('var(--red)', '#fff')} disabled={busy} onClick={() => setMode('reject')}>{tr('✕ ตีกลับ')}</button>}
          <button type="button" style={btn()} disabled={busy} onClick={approve}>{isAck ? tr('✓ รับทราบ') : tr('✓ อนุมัติ')}</button>
        </>}
        {!mode && isCreator && inst.status === 'returned' && <button type="button" style={btn()} disabled={busy} onClick={() => { setEditData({ ...(inst.data || {}) }); setMode('edit'); }}>{tr('✎ แก้แล้วส่งใหม่')}</button>}
        {!mode && canCancel && <button type="button" style={ghost} disabled={busy} onClick={() => setMode('cancel')}>{tr('ยกเลิกใบ')}</button>}
        {(mode === 'reject' || mode === 'return' || mode === 'cancel') && <button type="button" style={btn(mode === 'reject' ? 'var(--red)' : undefined, mode === 'reject' ? '#fff' : undefined)} disabled={busy} onClick={withReason}>{tr('ยืนยัน')}</button>}
        {mode === 'edit' && <button type="button" style={btn()} disabled={busy} onClick={resubmit}>{tr('ส่งใหม่')}</button>}
      </div>
    </Modal>
  );
}
