/* ═══ NpiDrawingsEci — ทะเบียน revision แบบ 2D/3D + ECI (Engineering Change) ของโปรเจค ═══
   · release แบบ = npi:approve → rev นั้นเป็น "ปัจจุบัน" ตัวเดียวต่อ (พาร์ท, ชนิด) · rev เดิมกลายเป็น obsolete
   · ECI ปิด implemented ได้ต่อเมื่อทุกขาที่ติ๊กว่ากระทบผูกของจริง (utils/npi.eciMissingLinks + DB check)
   · ขา "กระบวนการ" = ใบ 4M Method ใน /report (ไม่สร้างใบ 4M ให้เอง — คนเปิดใบเองแล้วมาผูก) */
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { notifyEvent } from '../utils/notifyEvent';
import { fmtDate } from '../utils/dateFormat';
import { ECI_STATUS, ECI_LEGS, eciMissingLinks, nextEciCode } from '../utils/npi';
import { inp, card, btn, ghost, thSt, tdSt, Field, Pill, MetaSelect, Modal, FilePick, uploadNpiFile, removeNpiFile, fileName, WarnBar } from './NpiUi';

const DWG_KIND = { '2d': '2D', '3d': '3D', spec: 'Spec', other: 'อื่นๆ' };
const DWG_STATUS = { draft: { label: 'ร่าง', color: '#94a3b8' }, released: { label: 'ปล่อยแล้ว', color: '#22c55e' }, obsolete: { label: 'ยกเลิก', color: '#64748b' } };

export default function NpiDrawingsEci({ project, parts, partId, onPickPart, drawings, ecis, tooling, canEdit, canApprove, fullName, today, onChanged }) {
  const [dwModal, setDwModal] = useState(null);
  const [eciModal, setEciModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fourM, setFourM] = useState([]);       // ใบ 4M Method ล่าสุด (ผูก ECI)
  const [peCrs, setPeCrs] = useState([]);       // คำขอแก้เอกสาร PE ของชุดที่พาร์ทในโปรเจคผูก
  const [linkWarn, setLinkWarn] = useState('');
  const part = parts.find(p => p.id === partId) || null;
  const partDrawings = drawings.filter(d => d.part_id === partId);

  useEffect(() => {
    (async () => {
      const w = [];
      const [fm, cr] = await Promise.all([
        supabase.from('four_m_logs').select('id, work_date, line_name, category, description, status').eq('category', 'Method').order('work_date', { ascending: false }).limit(150),
        (() => { const sets = parts.map(p => p.pe_set_id).filter(Boolean); return sets.length ? supabase.from('pe_change_requests').select('id, set_id, doc_type, proposal, status, ref_label, created_at').in('set_id', sets).order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] }); })(),
      ]);
      if (fm.error) w.push('โหลดใบ 4M ไม่ได้ (ผูกขากระบวนการไม่ได้)');
      if (cr.error) w.push('โหลดคำขอแก้ PE ไม่ได้');
      setFourM(fm.data || []); setPeCrs(cr.data || []); setLinkWarn(w.join(' · '));
    })();
  }, [parts]);

  /* ── แบบ ── */
  const saveDrawing = async () => {
    const m = dwModal;
    if (!m.rev?.trim()) return toast.error('กรอก Rev');
    setSaving(true);
    let file_url = m.file_url || null, file_name = m.file_name || null;
    if (m._file) {
      const url = await uploadNpiFile(`parts/${m.part_id}/drawings`, m._file);
      if (!url) { setSaving(false); return; }
      if (m.file_url) removeNpiFile(m.file_url);
      file_url = url; file_name = m._file.name;
    }
    const row = { part_id: m.part_id, kind: m.kind, rev: m.rev.trim(), rev_date: m.rev_date || null, eci_no: m.eci_no?.trim() || null,
      description: m.description?.trim() || null, file_url, file_name, external_url: m.external_url?.trim() || null };
    let res;
    if (m.id) res = await supabase.from('npi_drawing_revisions').update(row).eq('id', m.id);
    else res = await supabase.from('npi_drawing_revisions').insert({ ...row, status: 'draft', created_by_name: fullName || null });
    setSaving(false);
    if (res.error) return toast.error(`บันทึกไม่สำเร็จ: ${res.error.message}${res.error.code === '23505' ? ' (rev นี้มีอยู่แล้วในชนิดเดียวกัน)' : ''}`);
    toast.success('บันทึกแบบแล้ว'); setDwModal(null); onChanged();
  };
  const releaseDrawing = async (dw) => {
    if (!canApprove) return toast.error('ปล่อยแบบต้องมีสิทธิ์ npi:approve');
    if (!window.confirm(`ปล่อยแบบ ${DWG_KIND[dw.kind]} Rev ${dw.rev} เป็น "ปัจจุบัน"? rev เดิมของชนิดนี้จะถูกตั้งเป็นยกเลิก`)) return;
    setSaving(true);
    // ปลดตัวเดิมก่อน (unique index บังคับ is_current ตัวเดียวต่อ (พาร์ท, ชนิด))
    const e1 = (await supabase.from('npi_drawing_revisions').update({ is_current: false, status: 'obsolete' }).eq('part_id', dw.part_id).eq('kind', dw.kind).eq('is_current', true).neq('id', dw.id)).error;
    const e2 = e1 ? null : (await supabase.from('npi_drawing_revisions').update({ is_current: true, status: 'released', released_by: fullName || 'ไม่ระบุชื่อ', released_at: today }).eq('id', dw.id)).error;
    setSaving(false);
    if (e1 || e2) return toast.error(`ปล่อยแบบไม่สำเร็จ: ${(e1 || e2).message}`);
    toast.success(`ปล่อยแบบ Rev ${dw.rev} แล้ว`); onChanged();
  };
  const delDrawing = async (dw) => {
    if (!window.confirm(`ลบแบบ ${DWG_KIND[dw.kind]} Rev ${dw.rev}?`)) return;
    const { error } = await supabase.from('npi_drawing_revisions').delete().eq('id', dw.id);
    if (error) return toast.error(error.message);
    if (dw.file_url) removeNpiFile(dw.file_url);
    onChanged();
  };

  /* ── ECI ── */
  const blankEci = () => ({ eci_no: nextEciCode(ecis.map(e => e.eci_no), today), part_id: partId || '', source: 'customer', title: '', description: '', requested_by: '', requested_date: today,
    target_date: '', effective_date: '', status: 'open', affects_drawing: false, affects_pe: false, affects_process: false, affects_tooling: false, impact_note: '',
    drawing_revision_id: '', pe_change_request_id: '', four_m_log_id: '', tooling_plan_id: '' });
  const saveEci = async (statusOverride) => {
    const m = { ...eciModal, status: statusOverride || eciModal.status };
    if (!m.eci_no?.trim()) return toast.error('กรอกเลข ECI');
    if (!m.title?.trim()) return toast.error('กรอกหัวข้อ');
    const missing = eciMissingLinks(m);
    if (m.status === 'implemented' && missing.length) return toast.error(`ปิดงานไม่ได้ — ยังไม่ผูก: ${missing.join(' · ')}`);
    if (m.status === 'rejected' && !m.reject_reason?.trim()) return toast.error('ปฏิเสธต้องมีเหตุผล');
    const decided = ['approved', 'rejected', 'implemented'].includes(m.status);
    if (decided && m.status !== eciModal._orig_status && !canApprove) return toast.error('ตัดสิน ECI ต้องมีสิทธิ์ npi:approve');
    setSaving(true);
    const row = {
      eci_no: m.eci_no.trim(), part_id: m.part_id || null, source: m.source, title: m.title.trim(), description: m.description?.trim() || null,
      requested_by: m.requested_by?.trim() || null, requested_date: m.requested_date || null, target_date: m.target_date || null, effective_date: m.effective_date || null,
      status: m.status, affects_drawing: !!m.affects_drawing, affects_pe: !!m.affects_pe, affects_process: !!m.affects_process, affects_tooling: !!m.affects_tooling,
      impact_note: m.impact_note?.trim() || null,
      drawing_revision_id: m.drawing_revision_id || null, pe_change_request_id: m.pe_change_request_id || null, four_m_log_id: m.four_m_log_id || null, tooling_plan_id: m.tooling_plan_id || null,
      reject_reason: m.status === 'rejected' ? m.reject_reason.trim() : null,
      implemented_at: m.status === 'implemented' ? (m.implemented_at || today) : null,
      decided_by: decided ? (m.decided_by || fullName || null) : null, decided_at: decided ? (m.decided_at || new Date().toISOString()) : null,
    };
    let res;
    if (m.id) res = await supabase.from('npi_change_requests').update(row).eq('id', m.id);
    else res = await supabase.from('npi_change_requests').insert({ ...row, project_id: project.id, created_by_name: fullName || null });
    setSaving(false);
    if (res.error) return toast.error(`บันทึกไม่สำเร็จ: ${res.error.message}`);
    if (decided && m.status !== eciModal._orig_status) {
      const p = parts.find(x => x.id === m.part_id);
      notifyEvent({ event: 'npi_eci_decided', actor: fullName, line_name: p?.line_name || undefined,
        title: `🔁 ECI ${row.eci_no}: ${ECI_STATUS[m.status]?.label}`,
        lines: [`${project.name} (${project.project_code})`, p ? `พาร์ท ${p.part_no}` : '', row.title, m.status === 'rejected' ? `เหตุผล: ${row.reject_reason}` : ''],
        ref_table: 'npi_change_requests', ref_id: m.id || undefined });
    }
    toast.success('บันทึก ECI แล้ว'); setEciModal(null); onChanged();
  };
  const delEci = async (e) => {
    if (!window.confirm(`ลบ ECI ${e.eci_no}?`)) return;
    const { error } = await supabase.from('npi_change_requests').delete().eq('id', e.id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const eciPartDrawings = useMemo(() => drawings.filter(d => d.part_id === eciModal?.part_id), [drawings, eciModal?.part_id]);
  const eciPartTooling = useMemo(() => tooling.filter(t => t.part_id === eciModal?.part_id), [tooling, eciModal?.part_id]);
  const eciPeCrs = useMemo(() => { const set = parts.find(p => p.id === eciModal?.part_id)?.pe_set_id; return peCrs.filter(c => !set || c.set_id === set); }, [peCrs, parts, eciModal?.part_id]);

  return (
    <div>
      <WarnBar color="#f59e0b">{linkWarn}</WarnBar>
      {/* ── แบบ ── */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>📐 ทะเบียน revision แบบ</div>
            <select value={partId} onChange={e => onPickPart(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 200 }}>
              <option value="">— เลือกพาร์ท —</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.part_no} · {p.part_name || ''}</option>)}
            </select>
          </div>
          {canEdit && part && <button style={btn()} onClick={() => setDwModal({ part_id: part.id, kind: '2d', rev: '', rev_date: today, eci_no: '', description: '', external_url: '' })}>+ Rev แบบ</button>}
        </div>
        {!part ? <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>เลือกพาร์ทเพื่อดู/เพิ่ม revision แบบ · rev ปัจจุบันของแต่ละชนิดมีได้ตัวเดียว</div>
          : !partDrawings.length ? <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มี revision แบบของ {part.part_no}</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thSt}>ชนิด</th><th style={thSt}>Rev</th><th style={thSt}>วันที่</th><th style={thSt}>ECI</th><th style={thSt}>สถานะ</th><th style={thSt}>รายละเอียด</th><th style={thSt}>ไฟล์/ลิงก์</th><th style={thSt}>ปล่อยโดย</th><th style={thSt}></th></tr></thead>
              <tbody>
                {partDrawings.map(dw => (
                  <tr key={dw.id} style={{ opacity: dw.status === 'obsolete' ? 0.55 : 1 }}>
                    <td style={tdSt}>{DWG_KIND[dw.kind] || dw.kind}</td>
                    <td style={{ ...tdSt, fontFamily: 'monospace', fontWeight: 800, color: 'var(--text)' }}>{dw.rev} {dw.is_current && <Pill label="ปัจจุบัน" color="#22c55e" small />}</td>
                    <td style={tdSt}>{dw.rev_date ? fmtDate(dw.rev_date) : '—'}</td>
                    <td style={tdSt}>{dw.eci_no || '—'}</td>
                    <td style={tdSt}><Pill label={DWG_STATUS[dw.status]?.label || dw.status} color={DWG_STATUS[dw.status]?.color} /></td>
                    <td style={{ ...tdSt, maxWidth: 260 }}>{dw.description || ''}</td>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                      {dw.file_url && <a href={dw.file_url} target="_blank" rel="noreferrer" style={{ color: '#4d9fff' }}>📎 {(dw.file_name || fileName(dw.file_url)).slice(0, 24)}</a>}
                      {dw.external_url && <> <a href={dw.external_url} target="_blank" rel="noreferrer" style={{ color: '#4d9fff' }}>🔗 ลิงก์</a></>}
                      {!dw.file_url && !dw.external_url && <span style={{ color: '#f59e0b', fontSize: 11.5 }}>ไม่มีไฟล์</span>}
                    </td>
                    <td style={tdSt}>{dw.released_by ? `${dw.released_by} · ${fmtDate(dw.released_at)}` : '—'}</td>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                      {canApprove && dw.status !== 'released' && <button style={{ ...btn('#22c55e'), padding: '3px 8px', fontSize: 11 }} disabled={saving} onClick={() => releaseDrawing(dw)}>✅ ปล่อย</button>}{' '}
                      {canEdit && <><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setDwModal({ ...dw, rev_date: dw.rev_date || '', eci_no: dw.eci_no || '', description: dw.description || '', external_url: dw.external_url || '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => delDrawing(dw)}>🗑</button></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── ECI ── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>🔁 ECI / Engineering Change ({ecis.length})</div>
          {canEdit && <button style={btn()} onClick={() => setEciModal(blankEci())}>+ ECI</button>}
        </div>
        {!ecis.length ? <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มี ECI ในโปรเจคนี้</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thSt}>ECI</th><th style={thSt}>พาร์ท</th><th style={thSt}>หัวข้อ</th><th style={thSt}>ที่มา</th><th style={thSt}>สถานะ</th><th style={thSt}>กระทบ (ผูกแล้ว/ทั้งหมด)</th><th style={thSt}>ต้องมีผล</th><th style={thSt}></th></tr></thead>
              <tbody>
                {ecis.map(e => {
                  const p = parts.find(x => x.id === e.part_id);
                  const legs = ECI_LEGS.filter(l => e[l.flag]);
                  const linked = legs.filter(l => e[l.link]).length;
                  const late = e.target_date && e.status !== 'implemented' && e.status !== 'rejected' && e.target_date < today;
                  return (
                    <tr key={e.id}>
                      <td style={{ ...tdSt, fontFamily: 'monospace', fontWeight: 800, color: 'var(--text)' }}>{e.eci_no}</td>
                      <td style={tdSt}>{p?.part_no || <span style={{ color: 'var(--muted)' }}>ทั้งโปรเจค</span>}</td>
                      <td style={{ ...tdSt, maxWidth: 280 }}>{e.title}</td>
                      <td style={tdSt}>{e.source === 'customer' ? 'ลูกค้า' : 'ภายใน'}</td>
                      <td style={tdSt}><Pill label={ECI_STATUS[e.status]?.label} color={ECI_STATUS[e.status]?.color} />{e.status === 'rejected' && e.reject_reason && <div style={{ fontSize: 10.5, color: '#f59e0b' }}>{e.reject_reason}</div>}</td>
                      <td style={tdSt}>
                        {legs.length ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{legs.map(l => <Pill key={l.flag} label={`${e[l.link] ? '✓' : '○'} ${l.label}`} color={e[l.link] ? '#22c55e' : '#f59e0b'} small />)}</div> : <span style={{ color: 'var(--muted)' }}>ยังไม่ประเมิน</span>}
                        {legs.length > 0 && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{linked}/{legs.length}</div>}
                      </td>
                      <td style={{ ...tdSt, color: late ? '#ef4444' : undefined, fontWeight: late ? 800 : 400 }}>{e.target_date ? fmtDate(e.target_date) : '—'}{e.effective_date ? <div style={{ fontSize: 10.5, color: '#22c55e' }}>มีผล {fmtDate(e.effective_date)}</div> : null}</td>
                      <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                        {canEdit && <><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setEciModal({ ...blankEci(), ...e, _orig_status: e.status, requested_date: e.requested_date || '', target_date: e.target_date || '', effective_date: e.effective_date || '', drawing_revision_id: e.drawing_revision_id || '', pe_change_request_id: e.pe_change_request_id || '', four_m_log_id: e.four_m_log_id || '', tooling_plan_id: e.tooling_plan_id || '', reject_reason: e.reject_reason || '', part_id: e.part_id || '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => delEci(e)}>🗑</button></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dwModal && (
        <Modal title={dwModal.id ? `แก้ไขแบบ Rev ${dwModal.rev}` : 'เพิ่ม revision แบบ'} onClose={() => setDwModal(null)} width={600}
          footer={<><button style={ghost} onClick={() => setDwModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveDrawing}>{saving ? 'กำลังบันทึก…' : '💾 บันทึก'}</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชนิด"><select style={inp} value={dwModal.kind} onChange={e => setDwModal({ ...dwModal, kind: e.target.value })}>{Object.entries(DWG_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Rev *"><input style={inp} value={dwModal.rev} onChange={e => setDwModal({ ...dwModal, rev: e.target.value })} placeholder="A / Rev.03 / -CH" /></Field>
            <Field label="วันที่แบบ"><input type="date" style={inp} value={dwModal.rev_date || ''} onChange={e => setDwModal({ ...dwModal, rev_date: e.target.value })} /></Field>
            <Field label="ECI/ECN ที่ทำให้เกิด rev นี้"><input style={inp} value={dwModal.eci_no || ''} onChange={e => setDwModal({ ...dwModal, eci_no: e.target.value })} list="npi-eci-nos" /></Field>
            <Field label="รายละเอียดการเปลี่ยน" span={2}><textarea style={{ ...inp, minHeight: 56 }} value={dwModal.description || ''} onChange={e => setDwModal({ ...dwModal, description: e.target.value })} /></Field>
            <Field label="ไฟล์ (PDF/รูป ≤20MB)" hint="3D ไม่เก็บไฟล์ — ใส่ลิงก์">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <FilePick onFile={async f => setDwModal(m => ({ ...m, _file: f }))} accept=".pdf,image/*" label={dwModal._file ? `📎 ${dwModal._file.name.slice(0, 20)}` : (dwModal.file_url ? '↻ เปลี่ยนไฟล์' : '📎 เลือกไฟล์')} />
                {dwModal.file_url && !dwModal._file && <a href={dwModal.file_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: '#4d9fff' }}>ไฟล์เดิม</a>}
              </div>
            </Field>
            <Field label="ลิงก์ภายนอก (PLM / แชร์ไดรฟ์)"><input style={inp} value={dwModal.external_url || ''} onChange={e => setDwModal({ ...dwModal, external_url: e.target.value })} placeholder="https://…" /></Field>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>บันทึกเป็น "ร่าง" ก่อน · ผู้มีสิทธิ์ npi:approve กด ✅ ปล่อย เพื่อให้เป็น rev ปัจจุบัน</div>
          <datalist id="npi-eci-nos">{ecis.map(e => <option key={e.id} value={e.eci_no} />)}</datalist>
        </Modal>
      )}

      {eciModal && (
        <Modal title={eciModal.id ? `ECI ${eciModal.eci_no}` : 'รับ ECI ใหม่'} onClose={() => setEciModal(null)} width={760}
          footer={<>
            <button style={ghost} onClick={() => setEciModal(null)}>ยกเลิก</button>
            {canApprove && eciModal.id && eciModal.status !== 'implemented' && eciModal.status !== 'rejected' && (
              <>
                <button style={{ ...ghost, color: '#ef4444' }} disabled={saving} onClick={() => { if (!eciModal.reject_reason?.trim()) return toast.error('กรอกเหตุผลที่ปฏิเสธก่อน'); saveEci('rejected'); }}>ปฏิเสธ</button>
                {eciModal.status !== 'approved' && <button style={btn('#a855f7', '#fff')} disabled={saving} onClick={() => saveEci('approved')}>อนุมัติ</button>}
                <button style={btn('#22c55e')} disabled={saving} onClick={() => saveEci('implemented')} title="ต้องผูกของจริงครบทุกขาที่ติ๊กว่ากระทบ">✅ ปิดงาน (implemented)</button>
              </>
            )}
            <button style={btn()} disabled={saving} onClick={() => saveEci()}>{saving ? 'กำลังบันทึก…' : '💾 บันทึก'}</button>
          </>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="เลข ECI/ECN *" hint="ของลูกค้า หรือเลขภายใน"><input style={inp} value={eciModal.eci_no} onChange={e => setEciModal({ ...eciModal, eci_no: e.target.value })} /></Field>
            <Field label="พาร์ท"><select style={inp} value={eciModal.part_id} onChange={e => setEciModal({ ...eciModal, part_id: e.target.value, drawing_revision_id: '', tooling_plan_id: '' })}><option value="">ทั้งโปรเจค</option>{parts.map(p => <option key={p.id} value={p.id}>{p.part_no}</option>)}</select></Field>
            <Field label="ที่มา"><select style={inp} value={eciModal.source} onChange={e => setEciModal({ ...eciModal, source: e.target.value })}><option value="customer">ลูกค้า</option><option value="internal">ภายใน</option></select></Field>
            <Field label="หัวข้อ *" span={3}><input style={inp} value={eciModal.title} onChange={e => setEciModal({ ...eciModal, title: e.target.value })} /></Field>
            <Field label="รายละเอียด" span={3}><textarea style={{ ...inp, minHeight: 56 }} value={eciModal.description || ''} onChange={e => setEciModal({ ...eciModal, description: e.target.value })} /></Field>
            <Field label="ผู้ขอ/ต้นเรื่อง"><input style={inp} value={eciModal.requested_by || ''} onChange={e => setEciModal({ ...eciModal, requested_by: e.target.value })} /></Field>
            <Field label="วันที่รับ"><input type="date" style={inp} value={eciModal.requested_date || ''} onChange={e => setEciModal({ ...eciModal, requested_date: e.target.value })} /></Field>
            <Field label="ต้องมีผลภายใน"><input type="date" style={inp} value={eciModal.target_date || ''} onChange={e => setEciModal({ ...eciModal, target_date: e.target.value })} /></Field>
            <Field label="สถานะ"><MetaSelect value={eciModal.status} onChange={v => setEciModal({ ...eciModal, status: v })} meta={ECI_STATUS} exclude={canApprove ? [] : ['approved', 'rejected', 'implemented']} /></Field>
            <Field label="มีผลจริง (lot/วันแรกใช้ของใหม่)"><input type="date" style={inp} value={eciModal.effective_date || ''} onChange={e => setEciModal({ ...eciModal, effective_date: e.target.value })} /></Field>
            <Field label="เหตุผลที่ปฏิเสธ" hint="บังคับเมื่อปฏิเสธ"><input style={inp} value={eciModal.reject_reason || ''} onChange={e => setEciModal({ ...eciModal, reject_reason: e.target.value })} /></Field>
          </div>

          <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>ผลกระทบ — ติ๊กแล้วต้องผูก "ของจริง" ก่อนปิดงาน</div>
            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
              <Leg on={eciModal.affects_drawing} label="📐 แบบ/Drawing rev ใหม่" onToggle={v => setEciModal({ ...eciModal, affects_drawing: v })}>
                <select style={inp} value={eciModal.drawing_revision_id} onChange={e => setEciModal({ ...eciModal, drawing_revision_id: e.target.value })} disabled={!eciModal.affects_drawing}>
                  <option value="">— เลือก rev แบบของพาร์ท —</option>
                  {eciPartDrawings.map(d => <option key={d.id} value={d.id}>{DWG_KIND[d.kind]} Rev {d.rev} ({DWG_STATUS[d.status]?.label})</option>)}
                </select>
                {eciModal.affects_drawing && !eciPartDrawings.length && <div style={{ fontSize: 11, color: '#f59e0b' }}>พาร์ทนี้ยังไม่มี rev แบบ — เพิ่มที่ตารางแบบด้านบนก่อน</div>}
              </Leg>
              <Leg on={eciModal.affects_pe} label="🗺️ PFC / PFMEA / Control Plan" onToggle={v => setEciModal({ ...eciModal, affects_pe: v })}>
                <select style={inp} value={eciModal.pe_change_request_id} onChange={e => setEciModal({ ...eciModal, pe_change_request_id: e.target.value })} disabled={!eciModal.affects_pe}>
                  <option value="">— เลือกคำขอแก้เอกสาร PE —</option>
                  {eciPeCrs.map(c => <option key={c.id} value={c.id}>[{c.doc_type}] {c.status} · {(c.proposal || '').slice(0, 60)}</option>)}
                </select>
                {eciModal.affects_pe && <div style={{ fontSize: 11, color: 'var(--muted)' }}>สร้างคำขอที่ <Link to={`/pe-docs${parts.find(p => p.id === eciModal.part_id)?.pe_set_id ? `?set=${parts.find(p => p.id === eciModal.part_id).pe_set_id}` : ''}`} style={{ color: '#4d9fff' }}>/pe-docs</Link> (กล่องคำขอแก้เอกสาร) แล้วกลับมาเลือก</div>}
              </Leg>
              <Leg on={eciModal.affects_process} label="🔧 วิธีการผลิตหน้างาน (4M Method)" onToggle={v => setEciModal({ ...eciModal, affects_process: v })}>
                <select style={inp} value={eciModal.four_m_log_id} onChange={e => setEciModal({ ...eciModal, four_m_log_id: e.target.value })} disabled={!eciModal.affects_process}>
                  <option value="">— เลือกใบ 4M Method —</option>
                  {fourM.map(f => <option key={f.id} value={f.id}>{fmtDate(f.work_date)} · {f.line_name || '—'} · {f.status} · {(f.description || '').slice(0, 50)}</option>)}
                </select>
                {eciModal.affects_process && <div style={{ fontSize: 11, color: 'var(--muted)' }}>เปิดใบ 4M (Method) ที่หน้าเช็คชื่อ/Report ตามปกติ แล้วกลับมาผูก — ระบบไม่สร้างใบ 4M ให้เอง</div>}
              </Leg>
              <Leg on={eciModal.affects_tooling} label="🧱 แม่พิมพ์/จิ๊ก/CF" onToggle={v => setEciModal({ ...eciModal, affects_tooling: v })}>
                <select style={inp} value={eciModal.tooling_plan_id} onChange={e => setEciModal({ ...eciModal, tooling_plan_id: e.target.value })} disabled={!eciModal.affects_tooling}>
                  <option value="">— เลือกแผน tooling ของพาร์ท —</option>
                  {eciPartTooling.map(t => <option key={t.id} value={t.id}>{t.tool_name} ({t.status})</option>)}
                </select>
                {eciModal.affects_tooling && !eciPartTooling.length && <div style={{ fontSize: 11, color: '#f59e0b' }}>พาร์ทนี้ยังไม่มีแผน tooling — เพิ่มที่แท็บ 🔧 Tooling</div>}
              </Leg>
            </div>
            <Field label="บันทึกผลกระทบ / สิ่งที่ต้องทำ"><textarea style={{ ...inp, minHeight: 44, marginTop: 8 }} value={eciModal.impact_note || ''} onChange={e => setEciModal({ ...eciModal, impact_note: e.target.value })} /></Field>
            {eciMissingLinks(eciModal).length > 0 && <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, marginTop: 6 }}>ยังไม่ผูก: {eciMissingLinks(eciModal).join(' · ')} — ปิดงาน (implemented) ยังไม่ได้</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Leg({ on, label, onToggle, children }) {
  return (
    <div style={{ border: `1px solid ${on ? '#f59e0b66' : 'var(--border)'}`, borderRadius: 8, padding: 8, background: on ? 'rgba(245,158,11,0.06)' : 'transparent' }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input type="checkbox" checked={!!on} onChange={e => onToggle(e.target.checked)} /> {label}
      </label>
      {children}
    </div>
  );
}
