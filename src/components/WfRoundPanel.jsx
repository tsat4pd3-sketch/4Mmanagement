/* ═══════════════════════════════════════════════════════════════════════════════
   ✍️ แผง "การเซ็นของรอบนี้" — e-Workflow โหมดผูกเอกสาร (2026-11-25 · คำสั่ง user)
   ใช้กับทุกเอกสารที่ผูกใน /workflow-designer (`flow_schema.binding.subject`) · ตอนนี้: Poka-Yoke

   · ใบไหน/ความถี่ไหน/ใครเซ็น = ตั้งที่ /workflow-designer (ไม่มีอะไร hardcode ในจอเอกสาร)
   · รอบรายวัน: เปิดใบเมื่อมีข้อมูลของรอบนั้นแล้ว (`hasData`) · รอบหลายวัน: เปิดได้หลังจบรอบ (DB ตัดสิน)
   · ปุ่มอนุมัติ/รับทราบถามยืนยันผ่าน `confirmSign` · ตีกลับ/เพิกถอนต้องพิมพ์เหตุผล (ไม่ถามซ้ำ)
   · เขียนทุกอย่างผ่าน RPC (`wf_bound_ensure` / `wf_act` / `wf_revoke`) — ตาราง wf_* เขียนตรงไม่ได้
   · อ่านไม่ได้ = บอกบนจอ ห้ามโชว์ "ยังไม่เซ็น" เงียบๆ
   ═══════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import { confirmSign } from '../utils/signConfirm';
import { wfPeriodRange, roundKey, roundState, PERIOD_LABEL, signoffRows } from '../utils/wfBound';
import { tr, dateLocale } from '../utils/i18n';

const ACTIVE = ['in_progress', 'returned', 'approved'];
const fmtD = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const STATE_META = {
  signed:      { icon: '✅', color: 'var(--green)', text: 'เซ็นแล้ว' },
  waiting:     { icon: '⏳', color: 'var(--amber)', text: 'รอเซ็น' },
  blocked:     { icon: '⛔', color: 'var(--red)',   text: 'หาผู้เซ็นไม่ได้' },
  period_open: { icon: '🗓️', color: 'var(--muted)', text: 'ยังไม่จบรอบ — เซ็นได้หลังจบรอบ' },
  no_data:     { icon: '⚪', color: 'var(--muted)', text: 'ยังไม่มีข้อมูลในรอบนี้' },
  closed:      { icon: '↩️', color: 'var(--muted)', text: 'ใบเดิมปิดแล้ว (ตีกลับ/เพิกถอน) — รอเปิดรอบใหม่' },
  not_active:  { icon: '⚪', color: 'var(--muted)', text: 'ใบนี้ปิดใช้อยู่' },
  unknown:     { icon: '❔', color: 'var(--amber)', text: 'ยังไม่รู้สถานะ' },
};

/**
 * @param subject   คีย์เอกสาร (BOUND_SUBJECTS) เช่น 'pokayoke'
 * @param line      ไลน์ที่ดูอยู่ · @param date วันที่ (YYYY-MM-DD) · @param shift 'day'|'night'
 * @param hasData   รอบรายวันมีข้อมูลแล้วไหม (false = ยังไม่เปิดใบ) · null = ไม่รู้
 * @param summary   ข้อความสรุปใส่ในกล่องยืนยัน (เช่น "ไม่ผ่าน 1 รายการ")
 * @param onChanged เรียกหลังเซ็น/เพิกถอน (หน้าแม่โหลดสถานะล็อกใหม่)
 * @param defKey    เฉพาะใบงานนี้ (ใบตรวจแบบตาราง subject 'grid' มีหลายใบงาน · 26/11)
 * @param openOnlyWithData ไม่เปิดใบรอบเมื่อ `hasData === false` ทุกความถี่ (BBS รายเดือน: ใบเปล่าไม่ต้องมีใครเซ็น · 25/11)
 */
export default function WfRoundPanel({ subject, defKey = null, line, date, shift, hasData = null, summary = '', onChanged, openOnlyWithData = false }) {
  const { fullName, userId: ctxUid } = useContext(UserContext);
  const [rows, setRows] = useState(null);          // null = กำลังโหลด
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState(null); // { id, mode: 'reject'|'revoke' }
  const [reason, setReason] = useState('');
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!subject || !line || !date) { setRows([]); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const me = ctxUid || user?.id || null;
    const dRes = await supabase.from('wf_defs').select('id, key, name, status, current_version_id, wf_versions!wf_defs_current_version_fk(flow_schema)')
      .eq('status', 'active');
    if (dRes.error) return { err: dRes.error.message };
    const defs = (dRes.data || []).filter(d => d.wf_versions?.flow_schema?.binding?.subject === subject && (!defKey || d.key === defKey));
    const out = [];
    for (const d of defs) {
      const flow = d.wf_versions.flow_schema;
      const b = flow.binding;
      const [from, to] = wfPeriodRange(b.period, date) || [];
      const sh = b.perShift ? shift : null;
      let ensureStatus = null;
      // รอบรายวันที่ยังไม่มีข้อมูล = ยังไม่ต้องเปิดใบ · ที่เหลือขอให้ DB เปิด/คืนใบเดิม (ไม่มีสิทธิ์ = แค่อ่าน)
      if (!(b.period === 'day' && hasData === false) && !(openOnlyWithData && hasData === false)) {
        const e = await supabase.rpc('wf_bound_ensure', { p_key: d.key, p_line: line, p_date: date, p_shift: sh });
        if (!e.error) ensureStatus = e.data?.status || null;
      }
      const iRes = await supabase.from('wf_instances')
        .select('id, doc_no, status, step_rev, current_step, blocked_reason, period_from, period_to, shift, wf_tasks(id, assignee_id, status, step_index), wf_actions(action, step_index, actor_id, actor_name, acted_at, comment)')
        .eq('def_id', d.id).eq('subject_key', roundKey(line, from, sh)).order('created_at', { ascending: false }).limit(3);
      if (iRes.error) return { err: iRes.error.message };
      const inst = (iRes.data || []).find(x => ACTIVE.includes(x.status)) || null;
      const lastClosed = !inst ? (iRes.data || [])[0] : null;
      out.push({ def: d, flow, b, from, to, inst, lastClosed, me, ensureStatus });
    }
    return { rows: out };
  }, [subject, defKey, line, date, shift, hasData, ctxUid, openOnlyWithData]);

  useEffect(() => {
    let alive = true;
    setRows(null);
    load().then(r => { if (!alive) return; if (r?.err) { setErr(r.err); setRows([]); } else { setErr(''); setRows(r?.rows || []); } });
    return () => { alive = false; };
  }, [load, tick]);

  const done = (label) => { toast.success(`${label}${tr('แล้ว')}`); setReasonFor(null); setReason(''); setTick(x => x + 1); onChanged?.(); };

  const approve = async (r, task, step) => {
    const isAck = step?.kind === 'ack';
    if (!await confirmSign({
      what: `${isAck ? 'รับทราบ' : 'อนุมัติ'} — ${r.def.name}`, docLabel: 'ใบรอบ',
      orderNo: `${r.inst.doc_no} · ${line} · ${r.from === r.to ? fmtD(r.from) : `${fmtD(r.from)}–${fmtD(r.to)}`}${r.inst.shift ? ` · ${r.inst.shift === 'night' ? 'กะดึก' : 'กะเช้า'}` : ''}`,
      actor: fullName, as: step?.label,
      effect: `${summary ? `${summary} · ` : ''}เซ็นแล้วผลตรวจในรอบนี้จะถูกล็อก (แก้ = ต้องเพิกถอนก่อน)`,
      warn: '⚠️ เซ็นแล้วแก้เองไม่ได้ — ต้องให้ผู้มีสิทธิ์เพิกถอนพร้อมเหตุผล',
    })) return;
    setBusy(true);
    const res = await supabase.rpc('wf_act', { p_task: task.id, p_action: 'approve', p_comment: null, p_expected_rev: r.inst.step_rev });
    setBusy(false);
    if (checkWrite(res, isAck ? 'รับทราบ' : 'อนุมัติ')) done(isAck ? 'รับทราบ' : 'อนุมัติ'); else setTick(x => x + 1);
  };
  const submitReason = async (r, task) => {
    if (reason.trim().length < 5) { toast.error(tr('ต้องใส่เหตุผลอย่างน้อย 5 ตัวอักษร')); return; }
    setBusy(true);
    const res = reasonFor.mode === 'revoke'
      ? await supabase.rpc('wf_revoke', { p_instance: r.inst.id, p_reason: reason.trim() })
      : await supabase.rpc('wf_act', { p_task: task.id, p_action: 'reject', p_comment: reason.trim(), p_expected_rev: r.inst.step_rev });
    setBusy(false);
    const label = reasonFor.mode === 'revoke' ? 'เพิกถอนลายเซ็น' : 'ตีกลับ';
    if (checkWrite(res, label)) done(label); else setTick(x => x + 1);
  };

  if (!line) return null;
  if (rows && !rows.length && !err) return null;   // ยังไม่มีใบรอบที่ผูกเอกสารนี้ = ไม่โชว์แผง

  return (
    <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
        ✍️ {tr('การเซ็นของรอบนี้')} <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>{tr('(e-Workflow · ตั้งความถี่/ผู้เซ็นที่หน้าออกแบบใบงาน)')}</span>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠ {tr('อ่านสถานะการเซ็นไม่สำเร็จ')}: {err}</div>}
      {rows == null && !err && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('กำลังโหลด...')}</div>}
      {(rows || []).map(r => {
        const st = roundState({ instance: r.inst || (r.lastClosed && !r.ensureStatus ? r.lastClosed : null), ensureStatus: r.ensureStatus, hasData: (r.b.period === 'day' || openOnlyWithData) ? hasData : null });
        // สายเซ็นหลายขั้น (ออกโดย → ตรวจสอบโดย → อนุมัติโดย) = โชว์ทุกช่อง ใครเซ็นแล้ว/รออยู่ขั้นไหน
        const chain = (r.flow.steps || []).length > 1 && r.inst ? signoffRows(r.flow, r.inst.wf_actions) : null;
        const meta = STATE_META[st] || STATE_META.unknown;
        const step = r.inst ? r.flow.steps?.[r.inst.current_step] : null;
        const myTask = r.inst?.wf_tasks?.find(t => t.status === 'open' && t.assignee_id === r.me && t.step_index === r.inst.current_step);
        const signed = (r.inst?.wf_actions || []).filter(a => a.action === 'approve').sort((a, b) => String(b.acted_at).localeCompare(String(a.acted_at)))[0];
        const openN = (r.inst?.wf_tasks || []).filter(t => t.status === 'open').length;
        const range = r.from === r.to ? fmtD(r.from) : `${fmtD(r.from)}–${fmtD(r.to)}`;
        const askingReason = reasonFor?.id === r.def.id;
        return (
          <div key={r.def.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px dashed var(--border)', fontSize: 12.5 }}>
            <b style={{ minWidth: 200 }}>{r.def.name}</b>
            <span style={{ color: 'var(--muted)' }}>{tr(PERIOD_LABEL[r.b.period]?.split(' ')[0] || '')} · {range}</span>
            <span style={{ color: meta.color, fontWeight: 700 }}>{meta.icon} {tr(meta.text)}</span>
            {st === 'signed' && signed && <span style={{ color: 'var(--muted)' }}>{tr('โดย')} {signed.actor_name} · {new Date(signed.acted_at).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
            {st === 'waiting' && <span style={{ color: 'var(--muted)' }}>{step?.label} · {tr('ผู้มีสิทธิ์')} {openN} {tr('คน')}</span>}
            {st === 'blocked' && <span style={{ color: 'var(--red)' }}>{r.inst.blocked_reason}</span>}
            {r.inst && <span style={{ color: 'var(--muted)', fontSize: 11 }}>{r.inst.doc_no}</span>}
            {chain && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', width: '100%' }}>
                {chain.map((c, i) => {
                  const now = r.inst.status === 'in_progress' && r.inst.current_step === i;
                  return (
                    <span key={i} style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 'var(--r-md)', border: `1px solid ${c.name ? 'var(--green)' : now ? 'var(--amber)' : 'var(--border)'}`, color: c.name ? 'var(--green)' : now ? 'var(--amber)' : 'var(--muted)' }}>
                      {c.name ? '✅' : now ? '⏳' : '○'} {c.label}{c.name ? `: ${c.name}` : ''}
                    </span>
                  );
                })}
              </div>
            )}
            <span style={{ flex: 1 }} />
            {st === 'waiting' && myTask && !askingReason && (
              <>
                <button disabled={busy} onClick={() => approve(r, myTask, step)}
                  style={{ padding: '4px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>
                  {step?.sig_label ? `${tr('เซ็น')} · ${step.sig_label}` : step?.kind === 'ack' ? tr('รับทราบ') : tr('อนุมัติ')}
                </button>
                {step?.kind !== 'ack' && <button disabled={busy} onClick={() => { setReasonFor({ id: r.def.id, mode: 'reject' }); setReason(''); }}
                  style={{ padding: '4px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}>{tr('ตีกลับ')}</button>}
              </>
            )}
            {st === 'signed' && !askingReason && (
              <button disabled={busy} onClick={() => { setReasonFor({ id: r.def.id, mode: 'revoke' }); setReason(''); }}
                title={tr('ปลดล็อกให้แก้ผลตรวจ — ได้เฉพาะผู้มีสิทธิ์เซ็นขั้นสุดท้ายของไลน์นี้ (ระบบตรวจ)')}
                style={{ padding: '4px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>{tr('เพิกถอน')}</button>
            )}
            {askingReason && (
              <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                <input autoFocus value={reason} onChange={e => setReason(e.target.value)}
                  placeholder={reasonFor.mode === 'revoke' ? tr('เหตุผลที่เพิกถอน (เช่น ต้องแก้ผลทดสอบเครื่อง X)') : tr('เหตุผลที่ตีกลับ')} style={{ flex: 1 }} />
                <button disabled={busy} onClick={() => submitReason(r, myTask)}
                  style={{ padding: '4px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontWeight: 700, cursor: 'pointer' }}>
                  {reasonFor.mode === 'revoke' ? tr('ยืนยันเพิกถอน') : tr('ยืนยันตีกลับ')}
                </button>
                <button onClick={() => setReasonFor(null)} style={{ padding: '4px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>{tr('ยกเลิก')}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
