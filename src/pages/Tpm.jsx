/* 🛠️ TPM — /tpm (หมวด การตรวจสอบและซ่อมบำรุง · 2026-11-27 · คำสั่ง user "เริ่มข้อ 1+2+5")
   📄 docs/modules/tpm.md

   แท็บ `?tab=ftag|crit|setup`
     · ftag  = กระดาน F-Tag (ใบแท็กความผิดปกติ) — ติดแท็ก · แท็กแดงกด "เปิดใบซ่อม MO" · แท็กขาวปิดเอง · ยกเลิกพร้อมเหตุผล
     · crit  = ระดับความสำคัญเครื่อง A/B/C — ให้คะแนนรายหัวข้อ แล้วระบบคิดเกรด
     · setup = เกณฑ์ให้คะแนน (หัวข้อ/น้ำหนัก/ความหมาย 1-3) + % ตัดเกรด
   🔴 สูตร/สถานะทั้งหมดมาจาก src/utils/tpm.js (critGrade · ftagState · ftagActions) — ห้ามคิดเองในหน้านี้
   🔴 สิทธิ์ 3 ชั้น: page:/tpm · can('tpm','ftag'|'assess') · ชั้น ③ canWriteLine(ไลน์ของแท็ก/เครื่อง)
      (ติดแท็กข้ามไลน์ได้เหมือนแจ้งซ่อม — เจอความผิดปกติที่ไหนก็แจ้งได้ · แต่ปิด/ยกเลิก/ประเมิน = ไลน์ในขอบเขตตัวเอง)
   🔴 ตาราง DR (anon) · ทุกการเขียนเช็คผลด้วย checkWrite/checkWriteRows · ไม่มีการลบ (ยกเลิก = สถานะ + เหตุผล)
   ⚠️ egress: เลือกคอลัมน์ · แท็กที่ปิด/ยกเลิกแล้วดึงแค่ 90 วันล่าสุด (บอกบนจอ) */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import NoticeBar from '../components/NoticeBar';
import Segmented from '../components/Segmented';
import SearchInput from '../components/SearchInput';
import LineScopeSelect from '../components/LineScopeSelect';
import MachineSelect from '../components/MachineSelect';
import { toast } from '../components/Toast';
import { supabaseDR } from '../supabaseClient';
import useTabParam from '../utils/useTabParam';
import useMachines from '../utils/useMachines';
import useProductionLines from '../utils/useProductionLines';
import { fetchAllRows } from '../utils/fetchAllRows';
import { fetchByIds } from '../utils/fetchByIds';
import { mergeById } from '../utils/mergeRows';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { can } from '../utils/permissions';
import { canWriteLine, writeBlockText } from '../utils/writeScope';
import { getWorkDate } from '../utils/workDate';
import { getActor } from '../utils/actorStamp';
import { teamOptions, teamForMachine, deptNameOf } from '../utils/mtnTeams';
import { kindLabel, kindOf } from '../utils/equipmentKinds';
import { ALL } from '../utils/filterLabels';
import { askConfirm } from '../utils/askConfirm';
import { tr, dateLocale } from '../utils/i18n';
import {
  CRIT_SCORES, GRADE_META, critThresholds, critGrade, critReasonText,
  FTAG_COLORS, FTAG_STATE_META, FTAG_OPEN_STATES, ftagState, ftagActions, ftagAgeDays, noteOk, FTAG_NOTE_MIN,
} from '../utils/tpm';

const FTAG_COLS = 'id, tag_no, color, machine_id, machine_no, line_name, type_key, detail, found_at, work_date, found_by_name, status, mo_id, closed_at, closed_by_name, close_note, cancel_reason';
const MO_COLS = 'id, mo_no, status, current_step, approve_at, cost_mgr_at';
const DONE_DAYS = 90;   // แท็กที่ปิด/ยกเลิกแล้ว ดึงย้อนหลังเท่านี้ (ค้างอยู่ = ดึงทั้งหมดเสมอ)

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };
const chip = (color) => ({ display: 'inline-block', fontSize: 12, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 6, padding: '1px 8px', whiteSpace: 'nowrap' });
const btn = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnPri = { ...btn, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

function GradeChip({ res }) {
  if (!res?.grade) return <span style={chip('var(--muted)')} title={tr(critReasonText(res))}>{tr('ไม่มีเกรด')}</span>;
  const m = GRADE_META[res.grade];
  return <span style={chip(m.color)} title={tr(m.hint)}>{tr('เกรด')} {m.label}</span>;
}

export default function Tpm() {
  const ctx = useContext(UserContext);
  const { role, fullName, section, sections, allUnits, respCostCenters, scopeIdx, writeUnits } = ctx;
  const lineCtx = useMemo(() => ({ role, section, sections, allUnits, respCostCenters, scopeIdx, writeUnits }),
    [role, section, sections, allUnits, respCostCenters, scopeIdx, writeUnits]);
  const canTag = can('tpm', 'ftag', role);
  const canAssess = can('tpm', 'assess', role);
  const canReportMo = can('mtn_repair', 'report', role);
  const [tab, setTab] = useTabParam(['ftag', 'crit', 'setup'], 'ftag');
  const { machines, failed: machinesFailed } = useMachines();
  const lines = useProductionLines();

  /* ── ข้อมูล ───────────────────────────────────────────────────────── */
  const [tags, setTags] = useState(null);          // null = กำลังโหลด
  const [mos, setMos] = useState({});              // mo_id → แถว MO
  const [moErr, setMoErr] = useState('');
  const [types, setTypes] = useState([]);
  const [factors, setFactors] = useState([]);
  const [settings, setSettings] = useState([]);
  const [critRows, setCritRows] = useState([]);
  const [err, setErr] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const since = new Date(Date.now() - DONE_DAYS * 86400000).toISOString();
    const [openR, doneR, ty, fa, se, cr] = await Promise.all([
      fetchAllRows(supabaseDR, 'tpm_ftags', FTAG_COLS, q => q.in('status', ['open', 'mo']).order('found_at', { ascending: false }).order('id')),
      fetchAllRows(supabaseDR, 'tpm_ftags', FTAG_COLS, q => q.in('status', ['closed', 'cancelled']).gte('found_at', since).order('found_at', { ascending: false }).order('id')),
      supabaseDR.from('tpm_ftag_types').select('key, label, sort_order, is_active').order('sort_order'),
      supabaseDR.from('tpm_crit_factors').select('id, key, label, guide_1, guide_2, guide_3, weight, force_a, sort_order, is_active').order('sort_order'),
      supabaseDR.from('tpm_settings').select('id, key, value, label'),
      fetchAllRows(supabaseDR, 'machine_criticality', 'id, machine_id, scores, note, assessed_at, assessed_by_name', q => q.order('id')),
    ]);
    if (id !== reqId.current) return;
    const firstErr = [openR, doneR, ty, fa, se, cr].find(r => r.error)?.error;
    setErr(firstErr ? (firstErr.message || String(firstErr)) : '');
    /* 2 คิวรีไม่ใช่ transaction — แท็กที่ถูกปิดระหว่าง 2 คิวรีเข้าได้ทั้งคู่ ⇒ ยุบด้วย id (utils/mergeRows.js) */
    const all = mergeById(openR.data || [], doneR.data || []);
    setTags(all);
    setTypes(ty.data || []); setFactors(fa.data || []); setSettings(se.data || []); setCritRows(cr.data || []);
    const moIds = all.map(t => t.mo_id).filter(Boolean);
    if (moIds.length) {
      const r = await fetchByIds(moIds, c => supabaseDR.from('mtn_orders').select(MO_COLS).in('id', c));
      if (id !== reqId.current) return;
      setMoErr(r.error ? String(r.error) : '');
      setMos(Object.fromEntries(r.rows.map(m => [m.id, m])));
    } else { setMos({}); setMoErr(''); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const th = useMemo(() => critThresholds(settings), [settings]);
  const critByMachine = useMemo(() => Object.fromEntries(critRows.map(r => [r.machine_id, r])), [critRows]);
  const typeLabel = useCallback((k) => types.find(t => t.key === k)?.label || k || '—', [types]);
  const machineById = useMemo(() => Object.fromEntries((machines || []).map(m => [m.id, m])), [machines]);

  /* ── ตัวกรอง (ใช้ร่วม 2 แท็บ) ─────────────────────────────────────── */
  const [scope, setScope] = useState({ section: '', line: '', names: null });
  const [q, setQ] = useState('');
  const inScope = useCallback((lineName) => !scope.names?.length || scope.names.includes(lineName), [scope.names]);
  const match = useCallback((...vals) => {
    const s = q.trim().toLowerCase();
    return !s || vals.some(v => String(v ?? '').toLowerCase().includes(s));
  }, [q]);

  /* ── modal ─────────────────────────────────────────────────────────── */
  const [newTag, setNewTag] = useState(null);      // ฟอร์มติดแท็ก
  const [act, setAct] = useState(null);            // { kind: 'close'|'cancel'|'mo', tag }
  const [assess, setAssess] = useState(null);      // { machine, scores, note }
  const [saving, setSaving] = useState(false);

  const lineGate = (lineName, what) => {
    const res = canWriteLine(lineCtx, lineName, lines, { unknownTarget: 'block' });
    if (!res.ok) toast.error(writeBlockText(res, { what, unit: lineName || tr('(ไม่ระบุไลน์)') }));
    return res.ok;
  };

  const header = (
    <PageHeader title={tr('TPM — F-Tag & ระดับความสำคัญเครื่อง')} icon="🛠️"
      sub={tr('ติดแท็กความผิดปกติ · แท็กแดงเปิดใบซ่อม · จัดเกรดเครื่อง A/B/C (เครื่องเกรด A ต้องมี Why-Why ก่อนปิดใบซ่อม)')}
      tabs={[{ key: 'ftag', label: tr('F-Tag') }, { key: 'crit', label: tr('ระดับความสำคัญเครื่อง') }, { key: 'setup', label: tr('เกณฑ์') }]}
      tab={tab} onTab={setTab}
      actions={tab === 'ftag' && canTag ? (
        <button type="button" style={btnPri} onClick={() => setNewTag({ color: 'red', machine_no: '', machine_id: null, line_name: '', type_key: '', detail: '' })}>
          + {tr('ติดแท็ก')}
        </button>
      ) : null}
      filters={tab !== 'setup' ? (<>
        <LineScopeSelect lines={lines} section={scope.section} line={scope.line}
          onChange={(sec, line, info) => setScope({ section: sec, line, names: info?.lines?.length ? info.lines : (sec || line ? [line || sec] : null) })} />
        <SearchInput value={q} onChange={setQ} fields={tab === 'ftag' ? tr('เลขแท็ก / เครื่อง / รายละเอียด') : tr('เลขเครื่อง / ชื่อเครื่อง')} />
      </>) : null} />
  );

  return (
    <Page>
      {header}
      {err && <NoticeBar tone="bad">{tr('โหลดข้อมูล TPM ไม่ครบ')}: {err} — {tr('ตัวเลขบนจออาจไม่ครบ · ถ้าเพิ่งติดตั้ง ให้แจ้ง admin ตรวจ migration 20261127_tpm_criticality_ftag_dr')}</NoticeBar>}
      {machinesFailed && <NoticeBar tone="bad">{tr('อ่านทะเบียนเครื่องไม่สำเร็จ — เลือกเครื่อง/แสดงเกรดไม่ได้ ลองรีเฟรช')}</NoticeBar>}
      {tab === 'ftag' && (
        <FtagBoard tags={tags} mos={mos} moErr={moErr} typeLabel={typeLabel} inScope={inScope} match={match}
          canTag={canTag} canReportMo={canReportMo} onAct={(kind, tag) => setAct({ kind, tag, note: '', team: teamForMachine(tag.machine_no, machines) })} />
      )}
      {tab === 'crit' && (
        <CritBoard machines={machines} critByMachine={critByMachine} factors={factors} th={th} inScope={inScope} match={match}
          canAssess={canAssess}
          onAssess={(m) => setAssess({ machine: m, scores: { ...(critByMachine[m.id]?.scores || {}) }, note: critByMachine[m.id]?.note || '' })} />
      )}
      {tab === 'setup' && (
        <CritSetup factors={factors} settings={settings} canEdit={canAssess} onSaved={load} />
      )}

      {newTag && (
        <NewTagModal form={newTag} setForm={setNewTag} types={types} machines={machines} lines={lines} saving={saving}
          onClose={() => setNewTag(null)}
          onSave={async () => {
            const f = newTag;
            if (!f.machine_no) return toast.error(tr('เลือกเครื่องที่พบความผิดปกติ'));
            if (!f.detail.trim()) return toast.error(tr('เขียนรายละเอียดสิ่งที่พบ'));
            setSaving(true);
            try {
              const actor = getActor();
              const res = await supabaseDR.from('tpm_ftags').insert({
                color: f.color, machine_id: f.machine_id || null, machine_no: f.machine_no, line_name: f.line_name || null,
                type_key: f.type_key || null, detail: f.detail.trim(), work_date: getWorkDate(),
                found_by_name: fullName || actor.name || null, found_by_uid: actor.uid || null,
              }).select('id, tag_no');
              if (!checkWriteRows(res, tr('ติดแท็ก'))) return;
              toast.success(`🏷️ ${tr('ติดแท็กแล้ว')} ${res.data[0].tag_no}${f.color === 'red' ? ` — ${tr('กด "เปิดใบซ่อม" เพื่อส่งให้ช่าง')}` : ''}`);
              setNewTag(null); load();
            } finally { setSaving(false); }
          }} />
      )}

      {act && (
        <TagActionModal act={act} setAct={setAct} saving={saving} canReportMo={canReportMo} typeLabel={typeLabel}
          onClose={() => setAct(null)}
          onSave={async () => {
            const { kind, tag, note, team } = act;
            const what = kind === 'mo' ? tr('แท็กของไลน์นี้') : tr('แท็กของไลน์นี้');
            if (!lineGate(tag.line_name, what)) return;
            const actor = getActor();
            setSaving(true);
            try {
              if (kind === 'close' || kind === 'cancel') {
                if (!noteOk(note)) return toast.error(`${tr('เขียนเหตุผลอย่างน้อย')} ${FTAG_NOTE_MIN} ${tr('ตัวอักษร')}`);
                const upd = kind === 'close'
                  ? { status: 'closed', close_note: note.trim(), closed_at: new Date().toISOString(), closed_by_name: fullName || actor.name || null, closed_by_uid: actor.uid || null }
                  : { status: 'cancelled', cancel_reason: note.trim(), closed_at: new Date().toISOString(), closed_by_name: fullName || actor.name || null, closed_by_uid: actor.uid || null };
                /* compare-and-swap: แก้ได้เฉพาะสถานะที่เห็นอยู่ตอนเปิด modal (กันอีกคนเพิ่งเปิด MO/ปิดไปแล้ว) */
                const res = await supabaseDR.from('tpm_ftags').update(upd).eq('id', tag.id).eq('status', tag.status).select('id');
                if (!checkWriteRows(res, kind === 'close' ? tr('ปิดแท็ก') : tr('ยกเลิกแท็ก'),
                  { zeroMsg: tr('แท็กนี้ถูกเปลี่ยนสถานะไปแล้วโดยคนอื่น — รีเฟรชแล้วดูใหม่') })) return;
                toast.success(kind === 'close' ? tr('ปิดแท็กแล้ว') : tr('ยกเลิกแท็กแล้ว'));
              } else if (kind === 'mo') {
                if (!canReportMo) return toast.error(tr('ต้องมีสิทธิ์แจ้งซ่อม (mtn_repair:report) จึงเปิดใบซ่อมได้'));
                const now = new Date();
                /* payload แบบเดียวกับ "เปิด MO จากผลตรวจ AM/PM" (PMCheckData) — อาการ = ประเภทแท็กจริง ห้าม 'อื่นๆ' */
                const ins = await supabaseDR.from('mtn_orders').insert({
                  status: 'pending', current_step: 1, report_at: now.toISOString(), work_date: getWorkDate(now),
                  repair_scope: 'in_line', line_name: tag.line_name || null, mtn_dept: team || 'maintenance',
                  machine_no: tag.machine_no || null,
                  problem_characteristic: typeLabel(tag.type_key) !== '—' ? typeLabel(tag.type_key) : tag.detail.slice(0, 60),
                  problem_group: 'F-Tag (TPM)',
                  report_note: `[F-Tag ${tag.tag_no}] ${tag.detail}`,
                  reporter_prod: fullName || null, reported_by_name: fullName || null, reported_by_uid: actor.uid || null,
                }).select().single();
                if (!checkWrite(ins, tr('เปิดใบซ่อม'))) return;
                const link = await supabaseDR.from('tpm_ftags').update({ status: 'mo', mo_id: ins.data.id })
                  .eq('id', tag.id).in('status', ['open', 'mo']).select('id');
                if (!checkWriteRows(link, tr('ผูกแท็กกับใบซ่อม'),
                  { zeroMsg: `${tr('เปิดใบซ่อมแล้ว แต่ผูกกลับแท็กไม่ได้ (แท็กถูกเปลี่ยนสถานะไปแล้ว)')} — ${tr('ใบซ่อมยังอยู่ ตรวจที่หน้าแจ้งซ่อม')}` })) { load(); return; }
                fetch('https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-mtn-notification', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ event: 'mtn_reported', mo: { ...ins.data, mtn_dept: deptNameOf(ins.data.mtn_dept) } }),
                }).catch(() => {});
                toast.success(`📝 ${tr('เปิดใบซ่อมแล้ว → แจ้งถึงทีม')} ${deptNameOf(team) || 'MTN'}`);
              } else if (kind === 'recolor') {
                const to = tag.color === 'red' ? 'white' : 'red';
                const res = await supabaseDR.from('tpm_ftags').update({ color: to }).eq('id', tag.id).eq('status', 'open').select('id');
                if (!checkWriteRows(res, tr('เปลี่ยนสีแท็ก'))) return;
                toast.success(tr('เปลี่ยนสีแท็กแล้ว'));
              }
              setAct(null); load();
            } finally { setSaving(false); }
          }} />
      )}

      {assess && (
        <AssessModal assess={assess} setAssess={setAssess} factors={factors} th={th} saving={saving}
          onClose={() => setAssess(null)}
          onSave={async () => {
            const m = assess.machine;
            if (!lineGate(m.line_name, tr('เกรดเครื่องของไลน์นี้'))) return;
            const res = critGrade(assess.scores, factors, th);
            if (res.reason === 'incomplete') return toast.error(tr(critReasonText(res, factors)));
            const actor = getActor();
            setSaving(true);
            try {
              const row = { scores: assess.scores, note: assess.note.trim() || null, assessed_at: new Date().toISOString(), assessed_by_name: fullName || actor.name || null, assessed_by_uid: actor.uid || null };
              const ex = critByMachine[m.id];
              const r = ex
                ? await supabaseDR.from('machine_criticality').update(row).eq('id', ex.id).select('id')
                : await supabaseDR.from('machine_criticality').insert({ machine_id: m.id, ...row }).select('id');
              if (!checkWriteRows(r, tr('บันทึกเกรดเครื่อง'))) return;
              toast.success(`${tr('บันทึกแล้ว')} — ${m.machine_no}: ${res.grade ? `${tr('เกรด')} ${res.grade}` : tr(critReasonText(res, factors))}`);
              setAssess(null); load();
            } finally { setSaving(false); }
          }} />
      )}
      {tab === 'crit' && !Object.keys(machineById).length && !machinesFailed && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังโหลดทะเบียนเครื่อง…')}</div>}
    </Page>
  );
}

/* ══ กระดาน F-Tag ═════════════════════════════════════════════════════ */
function FtagBoard({ tags, mos, moErr, typeLabel, inScope, match, canTag, canReportMo, onAct }) {
  const [view, setView] = useState('open');   // open | done | all
  const [nowMs] = useState(() => Date.now());
  const rows = useMemo(() => (tags || []).map(t => {
    const mo = t.mo_id ? mos[t.mo_id] : null;
    const state = ftagState(t, t.mo_id ? (mo || undefined) : null);
    return { t, mo, state, age: ftagAgeDays(t, nowMs, mo) };
  }), [tags, mos, nowMs]);
  const scoped = rows.filter(r => inScope(r.t.line_name) && match(r.t.tag_no, r.t.machine_no, r.t.detail, r.t.line_name, typeLabel(r.t.type_key)));
  const isOpen = (r) => FTAG_OPEN_STATES.includes(r.state);
  const shown = scoped.filter(r => (view === 'open' ? isOpen(r) : view === 'done' ? !isOpen(r) : true));
  const hidden = rows.length - scoped.length;
  const openRows = scoped.filter(isOpen);
  const red = openRows.filter(r => r.t.color === 'red').length;
  const old = openRows.filter(r => (r.age ?? 0) > 14).length;

  if (tags == null) return <div style={{ color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังโหลด…')}</div>;
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {[[tr('แท็กค้าง'), openRows.length, 'var(--amber)'], [tr('แท็กแดงค้าง'), red, 'var(--red)'], [tr('ค้างเกิน 14 วัน'), old, 'var(--red)'],
          [`${tr('ปิดแล้ว')} (${DONE_DAYS} ${tr('วัน')})`, scoped.length - openRows.length, 'var(--green)']].map(([k, v, c]) => (
          <div key={k} style={card}><div style={{ fontSize: 12, color: 'var(--text2)' }}>{k}</div><div style={{ fontSize: 26, fontWeight: 800, color: c }}>{v}</div></div>
        ))}
      </div>
      {moErr && <NoticeBar tone="warn">{tr('อ่านสถานะใบซ่อมของแท็กแดงบางใบไม่ได้')}: {moErr} — {tr('แท็กพวกนั้นขึ้นว่า "อ่านใบซ่อมไม่ได้"')}</NoticeBar>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Segmented label={tr('สถานะ')} value={view} onChange={setView}
          options={[{ value: 'open', label: tr('ค้างอยู่') }, { value: 'done', label: tr('ปิด/ยกเลิก') }, { value: 'all', label: ALL.status }]} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {tr('แสดง')} {shown.length} {tr('แท็ก')}{hidden > 0 ? ` · ${tr('ซ่อน')} ${hidden} ${tr('แท็กที่อยู่นอกไลน์/คำค้นที่เลือก')}` : ''}
        </span>
      </div>
      {!shown.length && <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>{view === 'open' ? tr('ไม่มีแท็กค้าง') : tr('ไม่มีรายการ')}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {shown.map(({ t, mo, state, age }) => {
          const c = FTAG_COLORS[t.color] || FTAG_COLORS.white;
          const s = FTAG_STATE_META[state] || FTAG_STATE_META.open;
          const a = ftagActions(t, state);
          return (
            <div key={t.id} style={{ ...card, borderLeft: `4px solid ${c.color}`, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14 }}>{t.tag_no}</b>
                <span style={chip(c.color)}>{tr(c.label)}</span>
                <span style={chip(s.color)}>{tr(s.label)}</span>
                {mo && <Link to={`/mtn-repair?mo=${mo.id}`} style={{ fontSize: 12 }}>MO {mo.mo_no || tr('(รอออกเลข)')}</Link>}
                <span style={{ fontSize: 12, color: (age ?? 0) > 14 && FTAG_OPEN_STATES.includes(state) ? 'var(--red)' : 'var(--muted)' }}>
                  {age != null ? `${age} ${tr('วัน')}` : ''}
                </span>
              </div>
              <div style={{ fontSize: 13 }}><b>{t.machine_no || '—'}</b> · {t.line_name || tr('(ไม่ระบุไลน์)')} · {tr(typeLabel(t.type_key))}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{t.detail}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {tr('พบโดย')} {t.found_by_name || '—'} · {fmtDate(t.found_at)}
                {t.close_note && ` · ${tr('ปิด')}: ${t.close_note}`}{t.cancel_reason && ` · ${tr('ยกเลิก')}: ${t.cancel_reason}`}
                {t.closed_by_name && ` (${t.closed_by_name})`}
              </div>
              {canTag && (a.toMo || a.close || a.cancel || a.recolor) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {a.toMo && <button type="button" style={btnPri} disabled={!canReportMo}
                    title={canReportMo ? '' : tr('ต้องมีสิทธิ์แจ้งซ่อม')} onClick={() => onAct('mo', t)}>📝 {tr('เปิดใบซ่อม MO')}</button>}
                  {a.close && <button type="button" style={btn} onClick={() => onAct('close', t)}>✓ {tr('ปิดแท็ก')}</button>}
                  {a.recolor && <button type="button" style={btn} onClick={() => onAct('recolor', t)}>
                    {t.color === 'red' ? tr('เปลี่ยนเป็นแท็กขาว') : tr('เปลี่ยนเป็นแท็กแดง')}</button>}
                  {a.cancel && <button type="button" style={btn} onClick={() => onAct('cancel', t)}>{tr('ยกเลิก (ติดผิด)')}</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══ ตารางเกรดเครื่อง ══════════════════════════════════════════════════ */
function CritBoard({ machines, critByMachine, factors, th, inScope, match, canAssess, onAssess }) {
  const [kind, setKind] = useState('machine');
  const [gradeF, setGradeF] = useState('');
  const rows = useMemo(() => (machines || []).filter(m => m.is_active !== false).map(m => {
    const row = critByMachine[m.id];
    return { m, row, res: critGrade(row?.scores || null, factors, th) };
  }), [machines, critByMachine, factors, th]);
  const byKind = rows.filter(r => kindOf(r.m.equipment_kind) === kind);
  const scoped = byKind.filter(r => inScope(r.m.line_name) && match(r.m.machine_no, r.m.machine_name, r.m.line_name));
  const shown = scoped.filter(r => !gradeF || (gradeF === 'none' ? !r.res.grade : r.res.grade === gradeF));
  const count = (g) => scoped.filter(r => (g === 'none' ? !r.res.grade : r.res.grade === g)).length;
  const kinds = ['machine', 'facility', 'die', 'jig'];
  const LIMIT = 300;

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      {!th && <NoticeBar tone="warn">{tr('ยังไม่ได้ตั้ง % ตัดเกรด A/B — เครื่องจะยังไม่มีเกรด (ยกเว้นข้อที่บังคับเป็น A) · ตั้งที่แท็บ "เกณฑ์"')}</NoticeBar>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Segmented label={tr('ชนิด')} value={kind} onChange={setKind} options={kinds.map(k => ({ value: k, label: kindLabel(k) }))} />
        <Segmented label={tr('เกรด')} value={gradeF} onChange={setGradeF}
          options={[{ value: '', label: `${tr('ทุกเกรด')} (${scoped.length})` }, { value: 'A', label: `A (${count('A')})` }, { value: 'B', label: `B (${count('B')})` },
            { value: 'C', label: `C (${count('C')})` }, { value: 'none', label: `${tr('ยังไม่มีเกรด')} (${count('none')})` }]} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {tr('ประเมินแล้ว')} {scoped.length - count('none')}/{scoped.length} {tr('เครื่อง')}
        {byKind.length - scoped.length > 0 ? ` · ${tr('ซ่อน')} ${byKind.length - scoped.length} ${tr('เครื่องที่อยู่นอกไลน์/คำค้นที่เลือก')}` : ''}
        {shown.length > LIMIT ? ` · ${tr('แสดง')} ${LIMIT} ${tr('แรก จาก')} ${shown.length} — ${tr('เลือกไลน์หรือค้นหาเพื่อแคบลง')}` : ''}
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: 'var(--bg2)', textAlign: 'left' }}>
            {[tr('เครื่อง'), tr('ไลน์'), tr('เกรด'), tr('ที่มา'), tr('ประเมินโดย'), ''].map((h, i) => <th key={i} style={{ padding: '8px 10px', fontSize: 12 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {shown.slice(0, LIMIT).map(({ m, row, res }) => (
              <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 10px' }}><b>{m.machine_no}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.machine_name || ''}</div></td>
                <td style={{ padding: '6px 10px' }}>{m.line_name || '—'}</td>
                <td style={{ padding: '6px 10px' }}><GradeChip res={res} /></td>
                <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text2)' }}>{tr(critReasonText(res, factors))}</td>
                <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--muted)' }}>{row?.assessed_by_name || '—'}{row?.assessed_at ? ` · ${fmtDate(row.assessed_at)}` : ''}</td>
                <td style={{ padding: '6px 10px' }}>{canAssess && <button type="button" style={btn} onClick={() => onAssess(m)}>{row ? tr('แก้คะแนน') : tr('ประเมิน')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div style={{ padding: 14, color: 'var(--muted)', fontSize: 13 }}>{tr('ไม่มีรายการ')}</div>}
      </div>
    </div>
  );
}

/* ══ เกณฑ์ ═══════════════════════════════════════════════════════════ */
function CritSetup({ factors, settings, canEdit, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft({
      factors: factors.map(f => ({ ...f })),
      a: settings.find(s => s.key === 'crit_a_min_pct')?.value ?? '',
      b: settings.find(s => s.key === 'crit_b_min_pct')?.value ?? '',
    });
  }, [factors, settings]);
  if (!draft) return null;
  const setF = (i, k, v) => setDraft(d => ({ ...d, factors: d.factors.map((f, j) => (j === i ? { ...f, [k]: v } : f)) }));
  const save = async () => {
    const a = Number(draft.a), b = Number(draft.b);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= b || b <= 0 || a > 100) return toast.error(tr('% เกรด A ต้องมากกว่า % เกรด B และอยู่ระหว่าง 1–100'));
    if (draft.factors.some(f => !String(f.label || '').trim())) return toast.error(tr('ชื่อหัวข้อห้ามว่าง'));
    if (!(await askConfirm({ title: tr('บันทึกเกณฑ์ใหม่?'), message: tr('เกรดของทุกเครื่องจะคิดใหม่ตามเกณฑ์นี้ทันที (คะแนนที่ให้ไว้ไม่เปลี่ยน)'), okLabel: tr('บันทึก') }))) return;
    setSaving(true);
    try {
      for (const f of draft.factors) {
        const orig = factors.find(o => o.id === f.id);
        const changed = ['label', 'guide_1', 'guide_2', 'guide_3', 'weight', 'force_a', 'is_active'].some(k => String(orig?.[k] ?? '') !== String(f[k] ?? ''));
        if (!changed) continue;
        const r = await supabaseDR.from('tpm_crit_factors').update({
          label: f.label.trim(), guide_1: f.guide_1 || null, guide_2: f.guide_2 || null, guide_3: f.guide_3 || null,
          weight: Math.min(5, Math.max(1, Number(f.weight) || 1)), force_a: !!f.force_a, is_active: f.is_active !== false,
        }).eq('id', f.id).select('id');
        if (!checkWriteRows(r, `${tr('บันทึกหัวข้อ')} "${f.label}"`)) return;
      }
      for (const [key, value] of [['crit_a_min_pct', a], ['crit_b_min_pct', b]]) {
        const ex = settings.find(s => s.key === key);
        if (ex && Number(ex.value) === value) continue;
        const r = ex
          ? await supabaseDR.from('tpm_settings').update({ value }).eq('id', ex.id).select('id')
          : await supabaseDR.from('tpm_settings').insert({ key, value }).select('id');
        if (!checkWriteRows(r, tr('บันทึก % ตัดเกรด'))) return;
      }
      toast.success(tr('บันทึกเกณฑ์แล้ว'));
      onSaved();
    } finally { setSaving(false); }
  };
  const dis = !canEdit || saving;
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      {!canEdit && <NoticeBar tone="info">{tr('ดูอย่างเดียว — แก้เกณฑ์ต้องมีสิทธิ์ "TPM: ให้คะแนนระดับความสำคัญเครื่อง"')}</NoticeBar>}
      <div style={{ ...card, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label><span style={lbl}>{tr('เกรด A เมื่อคะแนน ≥ (% ของเต็ม)')}</span>
          <input type="number" min={1} max={100} value={draft.a} disabled={dis} onChange={e => setDraft(d => ({ ...d, a: e.target.value }))} style={{ ...inp, width: 120 }} /></label>
        <label><span style={lbl}>{tr('เกรด B เมื่อคะแนน ≥ (% ของเต็ม)')}</span>
          <input type="number" min={1} max={100} value={draft.b} disabled={dis} onChange={e => setDraft(d => ({ ...d, b: e.target.value }))} style={{ ...inp, width: 120 }} /></label>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ต่ำกว่า B = เกรด C · ทุกข้อได้ 1 คะแนน = 33% · ทุกข้อได้ 3 = 100%')}</span>
      </div>
      {draft.factors.map((f, i) => (
        <div key={f.id} style={{ ...card, display: 'grid', gap: 8, opacity: f.is_active === false ? 0.6 : 1 }}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, alignItems: 'end' }}>
            <label><span style={lbl}>{tr('หัวข้อ')}</span><input value={f.label} disabled={dis} onChange={e => setF(i, 'label', e.target.value)} style={inp} /></label>
            <label><span style={lbl}>{tr('น้ำหนัก (1–5)')}</span><input type="number" min={1} max={5} value={f.weight} disabled={dis} onChange={e => setF(i, 'weight', e.target.value)} style={inp} /></label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!f.force_a} disabled={dis} onChange={e => setF(i, 'force_a', e.target.checked)} /> {tr('ได้ 3 = เกรด A ทันที')}</label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={f.is_active !== false} disabled={dis} onChange={e => setF(i, 'is_active', e.target.checked)} /> {tr('ใช้งาน')}</label>
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[1, 2, 3].map(n => (
              <label key={n}><span style={lbl}>{tr('คะแนน')} {n} {tr('หมายถึง')}</span>
                <input value={f[`guide_${n}`] || ''} disabled={dis} onChange={e => setF(i, `guide_${n}`, e.target.value)} style={inp} /></label>
            ))}
          </div>
        </div>
      ))}
      {canEdit && <div><button type="button" style={btnPri} disabled={saving} onClick={save}>{saving ? tr('กำลังบันทึก…') : tr('บันทึกเกณฑ์')}</button></div>}
    </div>
  );
}

/* ══ modal ══════════════════════════════════════════════════════════ */
function NewTagModal({ form, setForm, types, machines, lines, saving, onClose, onSave }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="overlay">{/* ไม่ปิดจาก backdrop — ฟอร์ม (UI §5) */}
      <div className="modal" style={{ width: 'min(560px, 96vw)', display: 'grid', gap: 12 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>🏷️ {tr('ติดแท็กความผิดปกติ')}</h3>
        <div>
          <span style={lbl}>{tr('สีแท็ก')}</span>
          <Segmented label={tr('สีแท็ก')} value={form.color} onChange={v => set('color', v)}
            options={Object.entries(FTAG_COLORS).map(([k, c]) => ({ value: k, label: `${tr(c.label)} — ${tr(c.hint)}` }))} />
        </div>
        <label><span style={lbl}>{tr('เครื่อง')} *</span>
          <MachineSelect value={form.machine_no} machines={machines} lines={lines}
            onChange={(m) => setForm(f => ({ ...f, machine_no: m?.machine_no || '', machine_id: m?.id || null, line_name: m?.line_name || '' }))} /></label>
        {form.machine_no && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ไลน์')}: {form.line_name || tr('(เครื่องนี้ไม่ได้ผูกไลน์ในทะเบียน)')}</div>}
        <label><span style={lbl}>{tr('ประเภทความผิดปกติ')}</span>
          <select value={form.type_key} onChange={e => set('type_key', e.target.value)} style={inp}>
            <option value="">{tr('— ไม่ระบุ —')}</option>
            {types.filter(t => t.is_active !== false).map(t => <option key={t.key} value={t.key}>{tr(t.label)}</option>)}
          </select></label>
        <label><span style={lbl}>{tr('สิ่งที่พบ')} *</span>
          <textarea value={form.detail} onChange={e => set('detail', e.target.value)} style={{ ...inp, minHeight: 80 }}
            placeholder={tr('เช่น น้ำมันรั่วที่ข้อต่อสายไฮดรอลิกด้านซ้าย')} /></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={btn} onClick={onClose} disabled={saving}>{tr('ยกเลิก')}</button>
          <button type="button" style={btnPri} onClick={onSave} disabled={saving}>{saving ? tr('กำลังบันทึก…') : tr('ติดแท็ก')}</button>
        </div>
      </div>
    </div>
  );
}

function TagActionModal({ act, setAct, saving, canReportMo, typeLabel, onClose, onSave }) {
  const { kind, tag } = act;
  const title = { close: tr('ปิดแท็ก'), cancel: tr('ยกเลิกแท็ก'), mo: tr('เปิดใบซ่อม MO จากแท็ก'), recolor: tr('เปลี่ยนสีแท็ก') }[kind];
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 'min(520px, 96vw)', display: 'grid', gap: 12 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>{title} — {tag.tag_no}</h3>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>{tag.machine_no} · {tag.line_name || '—'} · {tr(typeLabel(tag.type_key))}<br />{tag.detail}</div>
        {(kind === 'close' || kind === 'cancel') && (
          <label><span style={lbl}>{kind === 'close' ? tr('แก้ไขอย่างไร') : tr('เหตุผลที่ยกเลิก')} * ({tr('อย่างน้อย')} {FTAG_NOTE_MIN} {tr('ตัวอักษร')})</span>
            <textarea value={act.note} onChange={e => setAct(a => ({ ...a, note: e.target.value }))} style={{ ...inp, minHeight: 70 }} /></label>
        )}
        {kind === 'mo' && (<>
          {!canReportMo && <NoticeBar tone="bad">{tr('ต้องมีสิทธิ์แจ้งซ่อม (mtn_repair:report) จึงเปิดใบซ่อมได้')}</NoticeBar>}
          <label><span style={lbl}>{tr('ส่งให้ทีม')}</span>
            <select value={act.team} onChange={e => setAct(a => ({ ...a, team: e.target.value }))} style={inp}>
              {teamOptions().map(t => <option key={t.key} value={t.key}>{tr(t.name)}</option>)}
            </select></label>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ใบซ่อมเปิดที่ขั้น 1 (แจ้งซ่อม) ในนามคุณ · แท็กจะปิดเองเมื่อใบซ่อมปิด')}</div>
        </>)}
        {kind === 'recolor' && <div style={{ fontSize: 13 }}>{tag.color === 'red' ? tr('เปลี่ยนเป็นแท็กขาว (ผู้ปฏิบัติงานแก้เองได้)?') : tr('เปลี่ยนเป็นแท็กแดง (ต้องใช้ช่าง)?')}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={btn} onClick={onClose} disabled={saving}>{tr('ปิดหน้าต่าง')}</button>
          <button type="button" style={btnPri} onClick={onSave} disabled={saving || (kind === 'mo' && !canReportMo)}>{saving ? tr('กำลังบันทึก…') : tr('ยืนยัน')}</button>
        </div>
      </div>
    </div>
  );
}

function AssessModal({ assess, setAssess, factors, th, saving, onClose, onSave }) {
  const act = factors.filter(f => f.is_active !== false);
  const res = critGrade(assess.scores, factors, th);
  const m = assess.machine;
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 'min(640px, 96vw)', display: 'grid', gap: 12 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>{tr('ประเมินระดับความสำคัญ')} — {m.machine_no}</h3>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>{m.machine_name || ''} · {m.line_name || '—'}</div>
        {act.map(f => (
          <div key={f.key} style={{ display: 'grid', gap: 4 }}>
            <span style={lbl}>{tr(f.label)}{f.weight > 1 ? ` (×${f.weight})` : ''}{f.force_a ? ` · ${tr('ได้ 3 = เกรด A ทันที')}` : ''}</span>
            <Segmented label={tr(f.label)} value={String(assess.scores[f.key] ?? '')}
              onChange={v => setAssess(a => ({ ...a, scores: { ...a.scores, [f.key]: Number(v) } }))}
              options={CRIT_SCORES.map(n => ({ value: String(n), label: String(n) }))} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr(f[`guide_${assess.scores[f.key]}`] || '')}</span>
          </div>
        ))}
        <label><span style={lbl}>{tr('หมายเหตุ')}</span>
          <input value={assess.note} onChange={e => setAssess(a => ({ ...a, note: e.target.value }))} style={inp} /></label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><GradeChip res={res} /><span style={{ fontSize: 12, color: 'var(--text2)' }}>{tr(critReasonText(res, factors))}</span></div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={btn} onClick={onClose} disabled={saving}>{tr('ยกเลิก')}</button>
          <button type="button" style={btnPri} onClick={onSave} disabled={saving}>{saving ? tr('กำลังบันทึก…') : tr('บันทึก')}</button>
        </div>
      </div>
    </div>
  );
}
