/* ═══ NpiPartPanel — แผงพาร์ท 1 ตัวใน /npi: เฟส · เอกสารส่งมอบ (= ทะเบียน PPAP) · PSW ═══
   สถานะเอกสาร "approved" ต้องมี npi:approve (บันทึกชื่อผู้อนุมัติ — DB check บังคับ)
   ไฟสี/สรุปมาจาก utils/npi.js เท่านั้น */
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { notifyEvent } from '../utils/notifyEvent';
import { fmtDate } from '../utils/dateFormat';
import {
  DELIV_STATUS, PHASE_STATUS, PPAP_STATUS, DOC_KIND, OWNER_ROLE, REF_KIND,
  deliverableLight, phaseRollup, partRollup, buildPartRows, groupByPhase,
} from '../utils/npi';
import { inp, card, btn, ghost, thSt, tdSt, Field, Pill, LightDot, MetaSelect, Modal, FilePick, uploadNpiFile, removeNpiFile, fileName } from './NpiUi';
import { printPpapChecklist } from '../lib/npiPpapPrint';

export default function NpiPartPanel({ part, project, template, phases, delivs, drawings, tooling, peSets, qaParts, canEdit, canApprove, fullName, today, onChanged }) {
  const [phaseModal, setPhaseModal] = useState(null);
  const [dvModal, setDvModal] = useState(null);
  const [ppapModal, setPpapModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(() => new Set());   // เฟสที่ "ย่อ" (default กางทั้งหมด)
  const [filter, setFilter] = useState('all');          // all | open | ppap | red

  const roll = useMemo(() => partRollup(part, phases, delivs, today), [part, phases, delivs, today]);
  const groups = useMemo(() => groupByPhase(delivs, phases), [delivs, phases]);
  const peSet = peSets.find(s => s.id === part.pe_set_id);
  const qaPart = qaParts.find(q => q.id === part.qa_part_id);

  const visible = (d) => {
    if (filter === 'open') return d.status !== 'approved' && d.status !== 'not_required';
    if (filter === 'ppap') return d.ppap_element;
    if (filter === 'red') return deliverableLight(d, today) === 'red';
    return true;
  };

  /* ── sync จากแม่แบบ: เติมเฉพาะเฟส/รายการที่ยังไม่มี ── */
  const syncTemplate = async () => {
    if (!template) return toast.error('ไม่พบแม่แบบของโปรเจค');
    const { phaseRows, delivRows } = buildPartRows({ partId: part.id, templatePhases: template.phases, templateDelivs: template.delivs,
      existingPhases: phases, existingDelivs: delivs, sopDate: project.sop_date, kickoffDate: project.kickoff_date });
    if (!phaseRows.length && !delivRows.length) return toast.info('ครบตามแม่แบบแล้ว ไม่มีรายการเพิ่ม');
    if (!window.confirm(`เติมจากแม่แบบ: เฟส ${phaseRows.length} · รายการเอกสาร ${delivRows.length} (ของเดิมไม่ถูกแตะ) ?`)) return;
    setSaving(true);
    const e1 = phaseRows.length ? (await supabase.from('npi_part_phases').insert(phaseRows)).error : null;
    const e2 = delivRows.length ? (await supabase.from('npi_deliverables').insert(delivRows)).error : null;
    setSaving(false);
    if (e1 || e2) return toast.error(`sync ไม่สำเร็จ: ${(e1 || e2).message}`);
    toast.success('เติมจากแม่แบบแล้ว'); onChanged();
  };

  /* ── เฟส ── */
  const savePhase = async () => {
    const m = phaseModal;
    setSaving(true);
    const { error } = await supabase.from('npi_part_phases').update({
      plan_start: m.plan_start || null, plan_end: m.plan_end || null, actual_start: m.actual_start || null, actual_end: m.actual_end || null,
      status: m.status, owner_name: m.owner_name?.trim() || null, note: m.note?.trim() || null,
    }).eq('id', m.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('บันทึกเฟสแล้ว'); setPhaseModal(null); onChanged();
  };

  /* ── เอกสารส่งมอบ ── */
  const patchDeliv = async (d, patch) => {
    const { error } = await supabase.from('npi_deliverables').update(patch).eq('id', d.id);
    if (error) return toast.error(`บันทึกไม่สำเร็จ: ${error.message}`);
    onChanged();
  };
  const setStatus = (d, status) => {
    if (status === 'approved') {
      if (!canApprove) return toast.error('ต้องมีสิทธิ์ npi:approve จึงอนุมัติได้');
      return patchDeliv(d, { status, approved_by: fullName || 'ไม่ระบุชื่อ', approved_at: new Date().toISOString(), done_at: d.done_at || today });
    }
    const patch = { status, approved_by: null, approved_at: null };
    if (status === 'submitted' && !d.done_at) patch.done_at = today;
    patchDeliv(d, patch);
  };
  const saveDeliv = async () => {
    const m = dvModal;
    if (!m.label?.trim()) return toast.error('กรอกชื่อรายการ');
    setSaving(true);
    const row = {
      label: m.label.trim(), phase_code: m.phase_code, doc_kind: m.doc_kind || 'other', required: m.required !== false, ppap_element: !!m.ppap_element,
      due_date: m.due_date || null, done_at: m.done_at || null, owner_name: m.owner_name?.trim() || null, owner_role: m.owner_role || null,
      ref_kind: m.ref_kind || null, ref_id: m.ref_id || null, note: m.note?.trim() || null, seq: Number(m.seq) || 0,
    };
    let res;
    if (m.id) res = await supabase.from('npi_deliverables').update(row).eq('id', m.id);
    else res = await supabase.from('npi_deliverables').insert({ ...row, part_id: part.id, code: `custom_${Date.now().toString(36)}`, status: row.required ? 'not_started' : 'not_required' });
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success('บันทึกแล้ว'); setDvModal(null); onChanged();
  };
  const delDeliv = async (d) => {
    if (!window.confirm(`ลบรายการ "${d.label}" ?`)) return;
    const { error } = await supabase.from('npi_deliverables').delete().eq('id', d.id);
    if (error) return toast.error(error.message);
    if (d.file_url) removeNpiFile(d.file_url);
    onChanged();
  };
  const attach = async (d, file) => {
    const url = await uploadNpiFile(`parts/${part.id}/deliv`, file);
    if (!url) return;
    if (d.file_url) removeNpiFile(d.file_url);
    await patchDeliv(d, { file_url: url, ref_kind: d.ref_kind || 'file' });
  };

  /* ── PPAP / PSW ── */
  const savePpap = async () => {
    const m = ppapModal;
    if ((m.ppap_status === 'approved' || m.ppap_status === 'interim' || m.ppap_status === 'rejected') && !canApprove) return toast.error('บันทึกผลจากลูกค้าต้องมีสิทธิ์ npi:approve');
    setSaving(true);
    const { error } = await supabase.from('npi_parts').update({
      ppap_status: m.ppap_status, ppap_level: Number(m.ppap_level) || 3, psw_no: m.psw_no?.trim() || null,
      psw_submitted_at: m.psw_submitted_at || null, psw_approved_at: m.psw_approved_at || null, status: m.status,
    }).eq('id', part.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    if (m.ppap_status !== part.ppap_status && ['submitted', 'approved', 'interim', 'rejected'].includes(m.ppap_status)) {
      notifyEvent({ event: 'npi_ppap_submitted', actor: fullName, line_name: part.line_name || undefined,
        title: `📦 PPAP ${part.part_no}: ${PPAP_STATUS[m.ppap_status]?.label}`,
        lines: [`${project.name} (${project.project_code})`, `พาร์ท ${part.part_no} ${part.part_name || ''}`, `สถานะ PPAP → ${PPAP_STATUS[m.ppap_status]?.label}`, m.psw_no ? `PSW ${m.psw_no}` : ''],
        ref_table: 'npi_parts', ref_id: part.id });
    }
    toast.success('บันทึกสถานะ PPAP แล้ว'); setPpapModal(null); onChanged();
  };

  const refLink = (d) => {
    if (d.ref_kind === 'pe_set' && (d.ref_id || part.pe_set_id)) return <Link to={`/pe-docs?set=${d.ref_id || part.pe_set_id}${d.doc_kind === 'fmea' ? '&tab=fmea' : d.doc_kind === 'cp' ? '&tab=cp' : ''}`} style={{ color: '#4d9fff' }}>📐 PE docs</Link>;
    if (d.ref_kind === 'qa_part' && (d.ref_id || part.qa_part_id)) return <Link to="/qa-setup" style={{ color: '#4d9fff' }}>🔍 QA setup</Link>;
    if (d.ref_kind === 'drawing' && d.ref_id) { const dw = drawings.find(x => x.id === d.ref_id); return <span>📐 แบบ {dw ? `${dw.kind.toUpperCase()} ${dw.rev}` : '(ไม่พบ)'}</span>; }
    if (d.ref_kind === 'tooling' && d.ref_id) { const t = tooling.find(x => x.id === d.ref_id); return <span>🔧 {t?.tool_name || '(ไม่พบ)'}</span>; }
    if (d.ref_kind === 'url' && d.ref_id) return <a href={d.ref_id} target="_blank" rel="noreferrer" style={{ color: '#4d9fff' }}>🔗 ลิงก์</a>;
    return null;
  };

  return (
    <div style={{ ...card }}>
      {/* หัวพาร์ท */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <LightDot light={roll.light} size={16} />
            <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 17 }}>{part.part_no}</span>
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{part.part_name || ''}</span>
            {roll.current && <Pill label={`เฟสปัจจุบัน: ${roll.current.label}`} color="#4d9fff" />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>MAT {part.mat_no || '—'}</span><span>ไลน์ {part.line_name || '—'}</span><span>ผู้รับผิดชอบ {part.owner_name || '—'}</span>
            <span>{peSet ? <Link to={`/pe-docs?set=${peSet.id}`} style={{ color: '#4d9fff' }}>📐 PFC/FMEA/CP {peSet.part_no}</Link> : <span style={{ color: '#f59e0b', fontWeight: 700 }}>ยังไม่ผูกชุด PE (✏️ พาร์ท)</span>}</span>
            <span>{qaPart ? <Link to="/qa-setup" style={{ color: '#4d9fff' }}>🔍 QA {qaPart.part_no}</Link> : <span style={{ color: 'var(--muted)' }}>QA setup: ยังไม่ผูก</span>}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={ghost} onClick={() => printPpapChecklist({ project, part, delivs, phases, today }) || toast.error('เบราว์เซอร์บล็อกหน้าต่างพิมพ์')}>🖨️ PPAP checklist</button>
          {canEdit && <button style={ghost} onClick={() => setPpapModal({ ppap_status: part.ppap_status, ppap_level: part.ppap_level, psw_no: part.psw_no || '', psw_submitted_at: part.psw_submitted_at || '', psw_approved_at: part.psw_approved_at || '', status: part.status })}>📦 สถานะ PPAP/PSW</button>}
          {canEdit && <button style={ghost} disabled={saving} onClick={syncTemplate} title="เติมเฟส/รายการที่แม่แบบมีแต่พาร์ทนี้ยังไม่มี (ไม่แตะของเดิม)">🔄 sync แม่แบบ</button>}
          {canEdit && <button style={btn()} onClick={() => setDvModal({ label: '', phase_code: roll.current?.phase_code || phases[0]?.phase_code || '', doc_kind: 'other', required: true, ppap_element: false, seq: 900 })}>+ รายการ</button>}
        </div>
      </div>

      {/* สรุป + PPAP */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        <Stat label="เอกสารอนุมัติ" value={`${roll.done}/${roll.total}`} sub={`${roll.pct}%`} />
        <Stat label="เลยกำหนด" value={roll.overdue} color={roll.overdue ? '#ef4444' : '#22c55e'} />
        <Stat label="PPAP elements" value={`${roll.ppap.done}/${roll.ppap.total}`} sub={`${roll.ppap.pct}%`} />
        <div style={{ ...card, padding: '8px 12px', flex: '2 1 260px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>PPAP / PSW</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 3, fontSize: 12.5 }}>
            <Pill label={PPAP_STATUS[part.ppap_status]?.label || part.ppap_status} color={PPAP_STATUS[part.ppap_status]?.color} />
            <span>Level {part.ppap_level}</span>
            <span>PSW {part.psw_no || '—'}</span>
            <span>ส่ง {part.psw_submitted_at ? fmtDate(part.psw_submitted_at) : '—'}</span>
            <span>อนุมัติ {part.psw_approved_at ? fmtDate(part.psw_approved_at) : '—'}</span>
          </div>
        </div>
      </div>

      {/* เฟส (timeline) */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>🗓️ เฟส</div>
        {!phases.length ? <div style={{ color: '#f59e0b', fontSize: 12.5, fontWeight: 700 }}>พาร์ทนี้ยังไม่มีเฟส — กด 🔄 sync แม่แบบ (แม่แบบต้องมีเฟสก่อน)</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(phases.length, 6)}, minmax(150px, 1fr))`, gap: 8, alignItems: 'start' }}>
            {[...phases].sort((a, b) => a.seq - b.seq).map(ph => {
              const r = phaseRollup(ph, delivs, today);
              return (
                <div key={ph.id} onClick={() => canEdit && setPhaseModal({ ...ph, plan_start: ph.plan_start || '', plan_end: ph.plan_end || '', actual_start: ph.actual_start || '', actual_end: ph.actual_end || '' })}
                  style={{ ...card, padding: '8px 10px', cursor: canEdit ? 'pointer' : 'default', borderTop: `4px solid ${(ph.status === 'completed') ? '#22c55e' : r.light === 'red' ? '#ef4444' : r.light === 'amber' ? '#f59e0b' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 800, fontSize: 12.5 }}>{ph.label}</span><LightDot light={r.light} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                    แผน {ph.plan_start ? fmtDate(ph.plan_start) : '—'} → <span style={{ color: ph.status !== 'completed' && ph.plan_end && ph.plan_end < today ? '#ef4444' : undefined }}>{ph.plan_end ? fmtDate(ph.plan_end) : '—'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>จริง {ph.actual_start ? fmtDate(ph.actual_start) : '—'} → {ph.actual_end ? fmtDate(ph.actual_end) : '—'}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11.5 }}>
                    <Pill label={PHASE_STATUS[ph.status]?.label} color={PHASE_STATUS[ph.status]?.color} small />
                    <span>{r.done}/{r.total}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* เอกสารส่งมอบ */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>📄 เอกสารส่งมอบ / ทะเบียน PPAP</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {[['all', 'ทั้งหมด'], ['open', 'ยังไม่ปิด'], ['ppap', 'เฉพาะ PPAP'], ['red', '🔴 เลยกำหนด']].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ ...ghost, padding: '3px 9px', fontSize: 11.5, background: filter === k ? 'var(--accent)' : 'var(--bg2)', color: filter === k ? '#08130a' : 'var(--text)' }}>{l}</button>
            ))}
          </div>
        </div>
        {!delivs.length && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีรายการ — sync จากแม่แบบ หรือ + รายการ</div>}
        {groups.map(g => {
          const rows = g.rows.filter(visible);
          const r = phaseRollup(g.phase, delivs, today);
          const collapsed = open.has(g.phase.phase_code);
          const hidden = g.rows.length - rows.length;
          return (
            <div key={g.phase.phase_code} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
              <div onClick={() => setOpen(s => { const n = new Set(s); n.has(g.phase.phase_code) ? n.delete(g.phase.phase_code) : n.add(g.phase.phase_code); return n; })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', background: 'var(--bg2)', borderRadius: 8 }}>
                <LightDot light={r.light} /><span style={{ fontWeight: 800, fontSize: 12.5 }}>{g.phase.label}</span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.done}/{r.total} อนุมัติ{r.overdue ? ` · เลย ${r.overdue}` : ''}{hidden > 0 ? ` · ซ่อนตามตัวกรอง ${hidden}` : ''}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{collapsed ? '▼' : '▲'}</span>
              </div>
              {!collapsed && rows.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={thSt}></th><th style={thSt}>รายการ</th><th style={thSt}>สถานะ</th><th style={thSt}>กำหนด</th><th style={thSt}>เสร็จ</th><th style={thSt}>เจ้าของ</th><th style={thSt}>หลักฐาน/อ้างอิง</th><th style={thSt}>หมายเหตุ</th><th style={thSt}></th>
                    </tr></thead>
                    <tbody>
                      {rows.map(d => {
                        const lt = deliverableLight(d, today);
                        const kind = DOC_KIND[d.doc_kind] || DOC_KIND.other;
                        return (
                          <tr key={d.id} style={{ opacity: d.status === 'not_required' ? 0.55 : 1 }}>
                            <td style={tdSt}><LightDot light={lt} /></td>
                            <td style={{ ...tdSt, minWidth: 200 }}>
                              <span title={kind.label}>{kind.icon}</span> <span style={{ color: 'var(--text)', fontWeight: 700 }}>{d.label}</span>
                              {d.ppap_element && <Pill label="PPAP" color="#a855f7" small />}{' '}
                              {d.required === false && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>(ไม่บังคับ)</span>}
                            </td>
                            <td style={{ ...tdSt, minWidth: 130 }}>
                              {canEdit ? (
                                <MetaSelect value={d.status} onChange={v => setStatus(d, v)} meta={DELIV_STATUS} style={{ padding: '3px 6px', fontSize: 11.5, borderColor: DELIV_STATUS[d.status]?.color }} />
                              ) : <Pill label={DELIV_STATUS[d.status]?.label} color={DELIV_STATUS[d.status]?.color} />}
                              {d.status === 'approved' && d.approved_by && <div style={{ fontSize: 10.5, color: '#22c55e' }}>✓ {d.approved_by}</div>}
                            </td>
                            <td style={tdSt}>{canEdit ? <input type="date" value={d.due_date || ''} onChange={e => patchDeliv(d, { due_date: e.target.value || null })} style={{ ...inp, width: 128, padding: '3px 6px', fontSize: 11.5, color: lt === 'red' ? '#ef4444' : undefined }} /> : (d.due_date ? fmtDate(d.due_date) : '—')}</td>
                            <td style={tdSt}>{canEdit ? <input type="date" value={d.done_at || ''} onChange={e => patchDeliv(d, { done_at: e.target.value || null })} style={{ ...inp, width: 128, padding: '3px 6px', fontSize: 11.5 }} /> : (d.done_at ? fmtDate(d.done_at) : '—')}</td>
                            <td style={tdSt}>
                              <div>{d.owner_name || <span style={{ color: 'var(--muted)' }}>—</span>}</div>
                              {d.owner_role && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{OWNER_ROLE[d.owner_role] || d.owner_role}</div>}
                            </td>
                            <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                {refLink(d)}
                                {d.file_url && <a href={d.file_url} target="_blank" rel="noreferrer" style={{ color: '#4d9fff', fontSize: 11.5 }}>📎 {fileName(d.file_url).slice(0, 22)}</a>}
                                {canEdit && <FilePick onFile={f => attach(d, f)} label={d.file_url ? '↻' : '📎'} />}
                              </div>
                            </td>
                            <td style={{ ...tdSt, maxWidth: 220, fontSize: 11.5 }}>{d.note || ''}</td>
                            <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                              {canEdit && <><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setDvModal({ ...d, due_date: d.due_date || '', done_at: d.done_at || '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => delDeliv(d)}>🗑</button></>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!collapsed && !rows.length && <div style={{ padding: '6px 10px', fontSize: 11.5, color: 'var(--muted)' }}>{g.rows.length ? 'ไม่มีรายการตามตัวกรอง' : 'ไม่มีรายการในเฟสนี้'}</div>}
            </div>
          );
        })}
      </div>

      {phaseModal && (
        <Modal title={`เฟส ${phaseModal.label}`} onClose={() => setPhaseModal(null)} width={560}
          footer={<><button style={ghost} onClick={() => setPhaseModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={savePhase}>💾 บันทึก</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="แผนเริ่ม"><input type="date" style={inp} value={phaseModal.plan_start} onChange={e => setPhaseModal({ ...phaseModal, plan_start: e.target.value })} /></Field>
            <Field label="แผนจบ" hint="เลยวันนี้แล้วยังไม่ปิด = แดง"><input type="date" style={inp} value={phaseModal.plan_end} onChange={e => setPhaseModal({ ...phaseModal, plan_end: e.target.value })} /></Field>
            <Field label="เริ่มจริง"><input type="date" style={inp} value={phaseModal.actual_start} onChange={e => setPhaseModal({ ...phaseModal, actual_start: e.target.value })} /></Field>
            <Field label="จบจริง"><input type="date" style={inp} value={phaseModal.actual_end} onChange={e => setPhaseModal({ ...phaseModal, actual_end: e.target.value })} /></Field>
            <Field label="สถานะ"><MetaSelect value={phaseModal.status} onChange={v => setPhaseModal({ ...phaseModal, status: v, actual_end: v === 'completed' && !phaseModal.actual_end ? today : phaseModal.actual_end })} meta={PHASE_STATUS} /></Field>
            <Field label="ผู้รับผิดชอบเฟส"><input style={inp} value={phaseModal.owner_name || ''} onChange={e => setPhaseModal({ ...phaseModal, owner_name: e.target.value })} list="npi-users" /></Field>
            <Field label="หมายเหตุ" span={2}><input style={inp} value={phaseModal.note || ''} onChange={e => setPhaseModal({ ...phaseModal, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {dvModal && (
        <Modal title={dvModal.id ? 'แก้ไขรายการเอกสาร' : 'เพิ่มรายการเอกสาร (เฉพาะพาร์ทนี้)'} onClose={() => setDvModal(null)} width={640}
          footer={<><button style={ghost} onClick={() => setDvModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveDeliv}>💾 บันทึก</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชื่อรายการ *" span={2}><input style={inp} value={dvModal.label} onChange={e => setDvModal({ ...dvModal, label: e.target.value })} /></Field>
            <Field label="เฟส"><select style={inp} value={dvModal.phase_code} onChange={e => setDvModal({ ...dvModal, phase_code: e.target.value })}>{[...phases].sort((a, b) => a.seq - b.seq).map(p => <option key={p.phase_code} value={p.phase_code}>{p.label}</option>)}</select></Field>
            <Field label="ชนิดเอกสาร"><select style={inp} value={dvModal.doc_kind} onChange={e => setDvModal({ ...dvModal, doc_kind: e.target.value })}>{Object.entries(DOC_KIND).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}</select></Field>
            <Field label="กำหนดส่ง"><input type="date" style={inp} value={dvModal.due_date || ''} onChange={e => setDvModal({ ...dvModal, due_date: e.target.value })} /></Field>
            <Field label="เสร็จเมื่อ"><input type="date" style={inp} value={dvModal.done_at || ''} onChange={e => setDvModal({ ...dvModal, done_at: e.target.value })} /></Field>
            <Field label="ผู้รับผิดชอบ"><input style={inp} value={dvModal.owner_name || ''} onChange={e => setDvModal({ ...dvModal, owner_name: e.target.value })} list="npi-users" /></Field>
            <Field label="ทีมเจ้าของ"><select style={inp} value={dvModal.owner_role || ''} onChange={e => setDvModal({ ...dvModal, owner_role: e.target.value })}><option value="">—</option>{Object.entries(OWNER_ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="อ้างอิงของจริงในระบบ"><select style={inp} value={dvModal.ref_kind || ''} onChange={e => setDvModal({ ...dvModal, ref_kind: e.target.value, ref_id: '' })}><option value="">—</option>{Object.entries(REF_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="รายการที่อ้าง">
              {dvModal.ref_kind === 'drawing' ? <select style={inp} value={dvModal.ref_id || ''} onChange={e => setDvModal({ ...dvModal, ref_id: e.target.value })}><option value="">—</option>{drawings.map(dw => <option key={dw.id} value={dw.id}>{dw.kind.toUpperCase()} {dw.rev} {dw.is_current ? '(ปัจจุบัน)' : ''}</option>)}</select>
                : dvModal.ref_kind === 'tooling' ? <select style={inp} value={dvModal.ref_id || ''} onChange={e => setDvModal({ ...dvModal, ref_id: e.target.value })}><option value="">—</option>{tooling.map(t => <option key={t.id} value={t.id}>{t.tool_name}</option>)}</select>
                : dvModal.ref_kind === 'url' ? <input style={inp} value={dvModal.ref_id || ''} onChange={e => setDvModal({ ...dvModal, ref_id: e.target.value })} placeholder="https://…" />
                : dvModal.ref_kind === 'pe_set' ? <div style={{ fontSize: 12, color: 'var(--muted)', paddingTop: 6 }}>{peSet ? `ชุด ${peSet.part_no}` : 'พาร์ทยังไม่ผูกชุด PE'}</div>
                : dvModal.ref_kind === 'qa_part' ? <div style={{ fontSize: 12, color: 'var(--muted)', paddingTop: 6 }}>{qaPart ? `QA ${qaPart.part_no}` : 'พาร์ทยังไม่ผูก QA part'}</div>
                : <input style={inp} value={dvModal.ref_id || ''} onChange={e => setDvModal({ ...dvModal, ref_id: e.target.value })} placeholder="เลขเอกสาร/อ้างอิง" />}
            </Field>
            <Field label="ลำดับ"><input type="number" style={inp} value={dvModal.seq ?? 0} onChange={e => setDvModal({ ...dvModal, seq: e.target.value })} /></Field>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', paddingTop: 20 }}>
              <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={dvModal.required !== false} onChange={e => setDvModal({ ...dvModal, required: e.target.checked })} /> บังคับ</label>
              <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={!!dvModal.ppap_element} onChange={e => setDvModal({ ...dvModal, ppap_element: e.target.checked })} /> อยู่ในชุด PPAP</label>
            </div>
            <Field label="หมายเหตุ" span={2}><textarea style={{ ...inp, minHeight: 50 }} value={dvModal.note || ''} onChange={e => setDvModal({ ...dvModal, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {ppapModal && (
        <Modal title={`สถานะ PPAP / PSW — ${part.part_no}`} onClose={() => setPpapModal(null)} width={560}
          footer={<><button style={ghost} onClick={() => setPpapModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={savePpap}>💾 บันทึก</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="สถานะ PPAP" hint={canApprove ? '' : 'ผลจากลูกค้าต้องมี npi:approve'}><MetaSelect value={ppapModal.ppap_status} onChange={v => setPpapModal({ ...ppapModal, ppap_status: v, psw_submitted_at: v === 'submitted' && !ppapModal.psw_submitted_at ? today : ppapModal.psw_submitted_at, psw_approved_at: v === 'approved' && !ppapModal.psw_approved_at ? today : ppapModal.psw_approved_at })} meta={PPAP_STATUS} /></Field>
            <Field label="PPAP level"><select style={inp} value={ppapModal.ppap_level} onChange={e => setPpapModal({ ...ppapModal, ppap_level: e.target.value })}>{[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>Level {l}</option>)}</select></Field>
            <Field label="PSW No."><input style={inp} value={ppapModal.psw_no} onChange={e => setPpapModal({ ...ppapModal, psw_no: e.target.value })} /></Field>
            <Field label="สถานะพาร์ท"><select style={inp} value={ppapModal.status} onChange={e => setPpapModal({ ...ppapModal, status: e.target.value })}>{['active', 'on_hold', 'completed', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="วันส่งลูกค้า"><input type="date" style={inp} value={ppapModal.psw_submitted_at} onChange={e => setPpapModal({ ...ppapModal, psw_submitted_at: e.target.value })} /></Field>
            <Field label="วันลูกค้าอนุมัติ"><input type="date" style={inp} value={ppapModal.psw_approved_at} onChange={e => setPpapModal({ ...ppapModal, psw_approved_at: e.target.value })} /></Field>
          </div>
          {roll.ppap.total > 0 && roll.ppap.done < roll.ppap.total && (ppapModal.ppap_status === 'submitted' || ppapModal.ppap_status === 'approved') && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>⚠️ PPAP element ยังอนุมัติในระบบไม่ครบ ({roll.ppap.done}/{roll.ppap.total}) — บันทึกได้ แต่ควรปิดรายการให้ตรงกับที่ส่งจริง</div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ ...card, padding: '8px 12px', minWidth: 120, flex: '1 1 120px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: color || 'var(--text)', lineHeight: 1.15 }}>{value}{sub && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginLeft: 6 }}>{sub}</span>}</div>
    </div>
  );
}
