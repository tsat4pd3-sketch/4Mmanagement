/* ══════════════════════════════════════════════════════════════════════════
   💼 RfqAssessPanel — เฟส 2a ของ Q-neX (2026-11-13 · คำสั่ง user "เริ่มเฟส 2a เลย IEC = engineer_nm ทั้งทีม")
   2 การ์ดในใบ RFQ: 📎 เอกสารแนบ (แยกชนิด) + 📐 ใบประเมินความเป็นไปได้ของ IEC

   ที่มา (feedback Marketing 12/11 · docs/MARKETING-QNEX-DESIGN.md §10 ข้อ 1·3·5·6·7·8):
     "ประเมิน (IEC) ✗" — เดิมขั้นประเมินเป็นแค่สถานะที่ MKT กดเอง ไม่มีของที่ IEC ต้องส่งกลับ
     ⇒ ใบนี้คือ "ของที่ส่งกลับ": ผลิตได้ไหม · ร่าง process flow ต่อพาร์ท · ไลน์อ้างอิง · ลงทุนเพิ่ม · ความเสี่ยง ·
        ราคาเป้าหมายลูกค้าเป็นไปได้ไหม — ส่งผลแล้วสถานะ RFQ ขยับ assessing → pre_review เอง + แจ้ง MKT ในแอป

   กฎ (เจ้าของ = utils/mktRfq.js · ห้ามคิดซ้ำที่นี่):
     · ชนิดไฟล์/ใครแนบได้ = FILE_KINDS · canUploadKind · visibleFileKinds (ตรงกับ RLS mkt_rfq_files)
     · ช่องที่ต้องครบก่อนส่งผล = assessmentMissing() · รอบ = latestAssessment/nextAssessmentRound
     · การเขียนทุกตัวผ่าน checkWriteRows (RLS ปฏิเสธ = 0 แถว ไม่มี error) · ส่งผล = compare-and-swap ที่ status='draft'
     · แจ้งเตือน = notifyEvent (fire-and-forget · ผู้รับตั้งใน notification_rules: rfq_assess_requested → engineer_nm · rfq_assessed → marketing)
     · ไฟล์: อัปขึ้น bucket ก่อน → insert แถว · insert ล้ม = ลบไฟล์คืน · ลบ = ลบแถวได้ (นับแถว) ค่อยลบไฟล์
   ══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useState, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { tr } from '../utils/i18n';
import { checkWriteRows } from '../utils/dbWrite';
import { uploadAttachmentInfo, removeAttachment, ATTACH_ACCEPT } from '../utils/fileAttach';
import FilePickBase from './FilePick';
import LineSelect from './LineSelect';
import MachineSelect from './MachineSelect';
import { loadLinesRes } from '../utils/useProductionLines';
import notifyEvent from '../utils/notifyEvent';
import { statusColor } from '../utils/statusTone';
import { fmtDate, fmtDateTime } from '../utils/dateFormat';
import { inp, card, btn, ghost, thSt, tdSt, Field, Pill, WarnBar } from './NpiUi';
import { DeleteButton } from './IconButton';
import {
  FILE_KINDS, fileKindMeta, canUploadKind, visibleFileKinds, FEASIBLE, TARGET_PRICE_FEASIBLE, ASSESS_STATUS, JOB_TYPES,
  latestAssessment, nextAssessmentRound, assessmentMissing, isClosed,
} from '../utils/mktRfq';

export const MKT_BUCKET = 'mkt-files';
const nowIso = () => new Date().toISOString();
const fmtSize = (b) => (b == null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const EMPTY_FLOW_ROW = { op: '', process: '', line_name: '', machine_no: '', ct_sec: '', note: '' };

/* ── 📎 เอกสารแนบ ───────────────────────────────────────────────────────── */
export function RfqFilesCard({ rfq, files, canEdit, canAssess, fullName, onReload }) {
  const [kind, setKind] = useState(canEdit ? 'rfq_letter' : 'assessment');
  const [busy, setBusy] = useState(false);
  const kinds = visibleFileKinds({ canEdit }).filter(k => canUploadKind(k, { canEdit, canAssess }));
  const canUpload = kinds.length > 0 && !isClosed(rfq.status);
  const upload = async (file) => {
    if (!canUploadKind(kind, { canEdit, canAssess })) return toast.error('ชนิดเอกสารนี้คุณแนบไม่ได้');
    setBusy(true);
    const info = await uploadAttachmentInfo(MKT_BUCKET, `rfq/${rfq.id}`, file);
    if (!info) { setBusy(false); return; }
    const res = await supabase.from('mkt_rfq_files').insert({
      rfq_id: rfq.id, kind, file_url: info.url, file_name: info.name, size_bytes: info.size, uploaded_by_name: fullName || null,
    }).select('id');
    setBusy(false);
    if (!checkWriteRows(res, 'บันทึกเอกสารแนบ')) { removeAttachment(MKT_BUCKET, info.url); return; }
    toast.success(`แนบ ${fileKindMeta(kind).label} แล้ว`); onReload?.();
  };
  const del = async (f) => {
    if (!window.confirm(`ลบไฟล์ ${f.file_name || ''} (${fileKindMeta(f.kind).label})?`)) return;
    // 🔴 ลบแถวให้สำเร็จ (นับแถว > 0) ก่อนค่อยลบไฟล์ใน storage — ไม่งั้นไฟล์หายแต่แถวยังชี้
    if (!checkWriteRows(await supabase.from('mkt_rfq_files').delete().eq('id', f.id).select('id'), 'ลบเอกสารแนบ')) return;
    removeAttachment(MKT_BUCKET, f.file_url);
    toast.success('ลบแล้ว'); onReload?.();
  };
  const groups = Object.keys(FILE_KINDS).map(k => ({ k, rows: files.filter(f => f.kind === k) })).filter(g => g.rows.length);
  const unknownKind = files.filter(f => !FILE_KINDS[f.kind]);
  return (
    <div style={{ ...card, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontWeight: 800 }}>📎 เอกสารแนบ <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {files.length} ไฟล์{!canEdit ? ' · ชนิดราคา (cost/ใบเสนอราคา) เห็นเฉพาะ Marketing' : ''}</span></div>
        {canUpload && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={kind} onChange={e => setKind(e.target.value)} style={{ ...inp, width: 'auto', fontSize: 12 }}>
              {kinds.map(k => <option key={k} value={k}>{fileKindMeta(k).icon} {fileKindMeta(k).label}</option>)}
            </select>
            <FilePickBase baseStyle={ghost} onFile={upload} disabled={busy} accept={`${ATTACH_ACCEPT},.zip,.step,.stp,.igs,.iges,.dwg,.dxf,.x_t`} label="📎 แนบไฟล์ (≤ 20MB)" />
          </div>
        )}
      </div>
      {!files.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่มีเอกสารแนบ{canUpload ? ' — เลือกชนิดแล้วแนบไฟล์ (ใบ RFQ ลูกค้า · แบบ · CAD · สเปค · volume sheet)' : ''}</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, alignContent: 'start' }}>
          {groups.map(g => (
            <div key={g.k} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--muted)', marginBottom: 3 }}>{fileKindMeta(g.k).icon} {fileKindMeta(g.k).label} · {g.rows.length}</div>
              {g.rows.map(f => (
                <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, padding: '2px 0' }}>
                  <a href={f.file_url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${f.file_name || ''} · ${fmtSize(f.size_bytes)} · ${f.uploaded_by_name || '—'} · ${fmtDateTime(f.created_at)}`}>
                    {f.file_name || f.file_url.split('/').pop()}
                  </a>
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtSize(f.size_bytes)}</span>
                  {canUploadKind(f.kind, { canEdit, canAssess }) && <DeleteButton onClick={() => del(f)} title="ลบไฟล์" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {unknownKind.length > 0 && <div style={{ fontSize: 11.5, color: statusColor('warn'), marginTop: 4 }}>⚠️ {unknownKind.length} ไฟล์เป็นชนิดที่ระบบไม่รู้จัก — ไม่ได้จัดกลุ่ม</div>}
    </div>
  );
}

/* ── 📐 ใบประเมินความเป็นไปได้ (IEC) ────────────────────────────────────── */
export function RfqAssessCard({ rfq, assessments, canEdit, canAssess, fullName, onReload }) {
  const { role, lineId, sections, scopeIdx } = useContext(UserContext);
  const latest = latestAssessment(assessments);
  const [form, setForm] = useState(null);      // ฟอร์มร่างของ IEC (เปิดเมื่อ latest เป็น draft และมีสิทธิ์)
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState([]);
  useEffect(() => { let alive = true; loadLinesRes().then((r) => { if (alive) setLines(r?.data || []); }); return () => { alive = false; }; }, []);
  // เปิดฟอร์มจากร่างล่าสุด (เปลี่ยนใบ/เปลี่ยนรอบ = รีเซ็ต) — ด่านชั้น 2 ตอนบันทึก: ตรวจ id ของร่างซ้ำ
  useEffect(() => {
    if (canAssess && latest?.status === 'draft') {
      setForm({
        id: latest.id, feasible: latest.feasible || '', feasible_note: latest.feasible_note || '', job_type_view: latest.job_type_view || rfq.job_type || '',
        process_flow: Array.isArray(latest.process_flow) && latest.process_flow.length ? latest.process_flow.map(r => ({ ...EMPTY_FLOW_ROW, ...r })) : [{ ...EMPTY_FLOW_ROW, op: '10' }],
        ref_line_name: latest.ref_line_name || '', new_investment: latest.new_investment || '', risks: latest.risks || '',
        lead_time_note: latest.lead_time_note || '', target_price_feasible: latest.target_price_feasible || '', target_price_note: latest.target_price_note || '',
      });
    } else setForm(null);
  }, [canAssess, latest?.id, latest?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  /* MKT: ส่งให้ IEC ประเมิน (เปิดรอบใหม่) */
  const request = async () => {
    if (latest?.status === 'draft') return toast.info(`รอบ ${latest.round} ยังอยู่ที่ IEC — ยังไม่ต้องส่งซ้ำ`);
    const round = nextAssessmentRound(assessments);
    if (!window.confirm(`ส่ง ${rfq.rfq_no} ให้ทีม IEC ประเมินความเป็นไปได้ (รอบ ${round})?\nระบบจะเปลี่ยนสถานะเป็น "IEC/แผนกกำลังประเมิน" และแจ้งทีม IEC ในแอป`)) return;
    setBusy(true);
    const res = await supabase.from('mkt_rfq_assessments').insert({ rfq_id: rfq.id, round, status: 'draft', requested_by_name: fullName || null, requested_at: nowIso() }).select('id');
    if (!checkWriteRows(res, 'เปิดรอบประเมิน')) { setBusy(false); return; }
    const r2 = await supabase.from('mkt_rfqs').update({ status: 'assessing', assess_requested_at: nowIso() }).eq('id', rfq.id).select('id');
    setBusy(false);
    if (!checkWriteRows(r2, 'เปลี่ยนสถานะ RFQ')) return;
    notifyEvent({
      event: 'rfq_assess_requested', title: `📐 RFQ ${rfq.rfq_no} รอ IEC ประเมิน (รอบ ${round})`,
      lines: [`${rfq.customer || '—'} · ${rfq.model || ''} ${rfq.title ? '· ' + rfq.title : ''}`.trim(), rfq.due_date ? `กำหนดส่งใบเสนอราคา ${fmtDate(rfq.due_date)}` : null, `ส่งโดย ${fullName || 'Marketing'}`],
      ref_table: 'mkt_rfqs', ref_id: rfq.id, actor: fullName || null, type: 'info',
    });
    toast.success(`ส่งให้ IEC ประเมินแล้ว (รอบ ${round})`); onReload?.();
  };

  const persist = async (submit) => {
    if (!form?.id) return;
    const flow = form.process_flow.filter(r => r.process || r.machine_no || r.line_name)
      .map(r => ({ ...r, ct_sec: r.ct_sec === '' || r.ct_sec == null ? null : Number(r.ct_sec) }));
    const payload = {
      feasible: form.feasible || null, feasible_note: form.feasible_note?.trim() || null, job_type_view: form.job_type_view || null,
      process_flow: flow, ref_line_name: form.ref_line_name || null, new_investment: form.new_investment?.trim() || null,
      risks: form.risks?.trim() || null, lead_time_note: form.lead_time_note?.trim() || null,
      target_price_feasible: form.target_price_feasible || null, target_price_note: form.target_price_note?.trim() || null,
    };
    if (submit) {
      const missing = assessmentMissing({ ...payload, process_flow: flow }, rfq);
      if (missing.length) return toast.error(`ยังขาด: ${missing.join(' · ')}`);
      Object.assign(payload, { status: 'submitted', submitted_at: nowIso(), assessed_by_name: fullName || null });
    }
    setBusy(true);
    // compare-and-swap: แก้ได้เฉพาะร่าง — ส่งไปแล้ว/มีคนส่งก่อน = 0 แถว ต้องบอก ไม่ใช่เงียบ
    const res = await supabase.from('mkt_rfq_assessments').update(payload).eq('id', form.id).eq('status', 'draft').select('id');
    if (!checkWriteRows(res, submit ? 'ส่งผลประเมิน' : 'บันทึกร่าง', { zeroMsg: 'ใบประเมินรอบนี้ถูกส่งไปแล้ว (มีคนกดก่อน) — โหลดใหม่' })) { setBusy(false); return; }
    if (submit) {
      // สถานะ RFQ ขยับเองเฉพาะตอนยังอยู่ "กำลังประเมิน" (ถ้า MKT ย้ายไปอย่างอื่นแล้ว ไม่ทับ)
      const r2 = await supabase.from('mkt_rfqs').update({ status: 'pre_review' }).eq('id', rfq.id).eq('status', 'assessing').select('id');
      if (r2.error) toast.error(`ส่งผลแล้ว แต่เปลี่ยนสถานะ RFQ ไม่สำเร็จ: ${r2.error.message}`);
      notifyEvent({
        event: 'rfq_assessed', title: `✅ IEC ส่งผลประเมิน ${rfq.rfq_no} แล้ว (รอบ ${latest?.round ?? ''})`,
        lines: [`${rfq.customer || '—'} · ${rfq.model || ''}`.trim(), `ผล: ${FEASIBLE[payload.feasible]?.label || payload.feasible}${payload.target_price_feasible ? ` · ราคาเป้าหมาย: ${TARGET_PRICE_FEASIBLE[payload.target_price_feasible]?.label}` : ''}`, `โดย ${fullName || 'IEC'}`],
        ref_table: 'mkt_rfqs', ref_id: rfq.id, actor: fullName || null, type: 'success',
      });
    }
    setBusy(false);
    toast.success(submit ? 'ส่งผลประเมินให้ Marketing แล้ว' : 'บันทึกร่างแล้ว'); onReload?.();
  };

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setRow = (i, k, v) => setForm(f => ({ ...f, process_flow: f.process_flow.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const addRow = () => setForm(f => ({ ...f, process_flow: [...f.process_flow, { ...EMPTY_FLOW_ROW, op: String((f.process_flow.length + 1) * 10) }] }));
  const delRow = (i) => setForm(f => ({ ...f, process_flow: f.process_flow.filter((_, j) => j !== i) }));
  const row = (k, v) => <div style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '2px 0' }}><span style={{ color: 'var(--muted)', minWidth: 150 }}>{k}</span><span style={{ fontWeight: 600, flex: 1 }}>{v ?? '—'}</span></div>;
  const missingNow = form ? assessmentMissing({ ...form, process_flow: form.process_flow.filter(r => r.process) }, rfq) : [];

  const FlowTable = ({ rows }) => !rows?.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>— ไม่มีร่าง process flow —</div> : (
    <table className="rec-list" style={{ width: '100%' }}>
      <thead><tr><th style={thSt}>OP</th><th style={thSt}>{tr('กระบวนการ')}</th><th style={thSt}>{tr('ไลน์')}</th><th style={thSt}>{tr('เครื่อง')}</th><th style={{ ...thSt, textAlign: 'right' }}>{tr('CT (วิ)')}</th><th style={thSt}>{tr('หมายเหตุ')}</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td style={tdSt}>{r.op || '—'}</td><td style={tdSt}><b>{r.process || '—'}</b></td><td style={tdSt}>{r.line_name || '—'}</td><td style={tdSt}>{r.machine_no || '—'}</td><td style={{ ...tdSt, textAlign: 'right' }}>{r.ct_sec ?? '—'}</td><td style={tdSt} className="rec-note">{r.note || ''}</td></tr>)}</tbody>
    </table>
  );

  return (
    <div style={{ ...card, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontWeight: 800 }}>📐 ประเมินความเป็นไปได้ (IEC)
          {latest && <Pill label={`รอบ ${latest.round} · ${ASSESS_STATUS[latest.status]?.label || latest.status}`} color={statusColor(ASSESS_STATUS[latest.status]?.tone || 'none')} small />}
          {latest?.status === 'submitted' && latest.feasible && <Pill label={FEASIBLE[latest.feasible]?.label || latest.feasible} color={statusColor(FEASIBLE[latest.feasible]?.tone || 'none')} small />}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canEdit && !isClosed(rfq.status) && latest?.status !== 'draft' && (
            <button style={btn()} disabled={busy} onClick={request}>{latest ? `ขอประเมินใหม่ (รอบ ${nextAssessmentRound(assessments)})` : 'ส่งให้ IEC ประเมิน'}</button>
          )}
        </div>
      </div>

      {!latest && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          ยังไม่ได้ส่งให้ IEC ประเมิน — ทีม IEC (role วิศวกร New Model) จะได้รับแจ้งในแอป แล้วตอบกลับว่า <b>ผลิตได้ไหม · ร่าง process flow · ไลน์อ้างอิง · ความเสี่ยง · ราคาเป้าหมายเป็นไปได้ไหม</b>
          {' '}· สถานะ RFQ เดินต่อขั้น 3 ขึ้นไปไม่ได้จนกว่าจะมีผลประเมิน
        </div>
      )}

      {latest && latest.status === 'draft' && !form && (
        <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
          ⏳ รอบ {latest.round} อยู่ที่ทีม IEC — ส่งเมื่อ {latest.requested_at ? fmtDateTime(latest.requested_at) : '—'} โดย {latest.requested_by_name || '—'}
          {!canAssess && <span style={{ color: 'var(--muted)' }}> · คุณไม่มีสิทธิ์กรอกใบประเมิน (rfq:assess)</span>}
        </div>
      )}

      {/* ── ฟอร์มของ IEC ── */}
      {form && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            รอบ {latest.round} · ส่งมาโดย {latest.requested_by_name || 'Marketing'} {latest.requested_at ? fmtDateTime(latest.requested_at) : ''} · ชนิดงานที่ MKT ตั้ง: <b>{JOB_TYPES[rfq.job_type] || 'ไม่ระบุ'}</b>
            {rfq.customer_target_price != null && <> · 🔒 ราคาเป้าหมายลูกค้ามีอยู่ (MKT เห็นตัวเลข) — ต้องตอบว่าเป็นไปได้ไหม</>}
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, alignItems: 'start' }}>
            <Field label="ผลิตได้ไหม *">
              <select style={inp} value={form.feasible} onChange={e => setF('feasible', e.target.value)}>
                <option value="">{tr('— เลือก —')}</option>{Object.entries(FEASIBLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="ชนิดงานในมุม IEC" hint="ต่างจากที่ MKT ตั้ง = ต้องคุย">
              <select style={inp} value={form.job_type_view} onChange={e => setF('job_type_view', e.target.value)}>
                <option value="">{tr('— ไม่ระบุ —')}</option>{Object.entries(JOB_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="ไลน์อ้างอิงที่จะผลิต" hint={form.feasible === 'no' ? 'ไม่บังคับเมื่อผลิตไม่ได้' : 'บังคับ'}>
              <LineSelect lines={lines} value={form.ref_line_name} onChange={v => setF('ref_line_name', v)} role={role} lineId={lineId} sections={sections} scopeIdx={scopeIdx} style={inp} placeholder={tr('— เลือกไลน์ —')} />
            </Field>
            <Field label={form.feasible === 'no' ? 'เหตุผลที่ผลิตไม่ได้ *' : 'เงื่อนไข / หมายเหตุผลประเมิน'} span={3}>
              <textarea style={{ ...inp, minHeight: 48 }} value={form.feasible_note} onChange={e => setF('feasible_note', e.target.value)} />
            </Field>
          </div>

          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12.5, fontWeight: 800 }}>ร่าง Process flow (flow setup ของพาร์ทนี้) <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· เป็น input ของการคิดต้นทุน (เฟส 3) · ได้งานแล้ว PE ทำ PFC จริงที่ /pe-docs</span></div>
            <button style={ghost} onClick={addRow}>{tr('+ ขั้น')}</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rec-list" style={{ width: '100%', minWidth: 720 }}>
              <thead><tr><th style={{ ...thSt, width: 56 }}>OP</th><th style={thSt}>{tr('กระบวนการ *')}</th><th style={thSt}>{tr('ไลน์')}</th><th style={thSt}>{tr('เครื่อง')}</th><th style={{ ...thSt, width: 80 }}>{tr('CT (วิ)')}</th><th style={thSt}>{tr('หมายเหตุ')}</th><th style={thSt} /></tr></thead>
              <tbody>
                {form.process_flow.map((r, i) => (
                  <tr key={i}>
                    <td style={tdSt}><input style={inp} value={r.op} onChange={e => setRow(i, 'op', e.target.value)} /></td>
                    <td style={tdSt}><input style={inp} value={r.process} onChange={e => setRow(i, 'process', e.target.value)} placeholder={tr('เช่น Blanking · Draw · Spot weld')} /></td>
                    <td style={tdSt}><LineSelect lines={lines} value={r.line_name} onChange={v => setRow(i, 'line_name', v)} role={role} lineId={lineId} sections={sections} scopeIdx={scopeIdx} style={inp} placeholder="—" /></td>
                    <td style={tdSt}><MachineSelect value={r.machine_no} onChange={(m) => setRow(i, 'machine_no', m?.machine_no ?? m ?? '')} allowFree freeHint="เครื่องใหม่ที่ยังไม่มีในทะเบียน" inputStyle={inp} placeholder={tr('เลขเครื่อง')} /></td>
                    <td style={tdSt}><input type="number" style={inp} value={r.ct_sec} onChange={e => setRow(i, 'ct_sec', e.target.value)} /></td>
                    <td style={tdSt}><input style={inp} value={r.note} onChange={e => setRow(i, 'note', e.target.value)} /></td>
                    <td style={{ ...tdSt, textAlign: 'right' }}><DeleteButton onClick={() => delRow(i)} title="ลบขั้น" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, alignItems: 'start', marginTop: 10 }}>
            <Field label="ต้องลงทุนเพิ่ม (เครื่อง / แม่พิมพ์ / JIG)"><textarea style={{ ...inp, minHeight: 56 }} value={form.new_investment} onChange={e => setF('new_investment', e.target.value)} /></Field>
            <Field label="ความเสี่ยง (คุณภาพ · กำลังผลิต · supplier)"><textarea style={{ ...inp, minHeight: 56 }} value={form.risks} onChange={e => setF('risks', e.target.value)} /></Field>
            <Field label="เวลาเตรียมการ เทียบ SOP ลูกค้า" hint={rfq.sop_date_customer ? `SOP ${fmtDate(rfq.sop_date_customer)}` : 'ยังไม่ระบุ SOP'}><textarea style={{ ...inp, minHeight: 56 }} value={form.lead_time_note} onChange={e => setF('lead_time_note', e.target.value)} /></Field>
            <Field label={`ราคาเป้าหมายลูกค้าเป็นไปได้ไหม${rfq.customer_target_price != null ? ' *' : ''}`} hint="ตอบจากประสบการณ์ — ตัวเลขจริงรอคิดต้นทุน">
              <select style={inp} value={form.target_price_feasible} onChange={e => setF('target_price_feasible', e.target.value)}>
                <option value="">{tr('— เลือก —')}</option>{Object.entries(TARGET_PRICE_FEASIBLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="หมายเหตุเรื่องราคา" span={2}><input style={inp} value={form.target_price_note} onChange={e => setF('target_price_note', e.target.value)} /></Field>
          </div>

          {missingNow.length > 0 && <div style={{ fontSize: 12, color: statusColor('warn'), marginTop: 8 }}>ส่งผลได้เมื่อครบ: {missingNow.join(' · ')}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button style={ghost} disabled={busy} onClick={() => persist(false)}>💾 บันทึกร่าง</button>
            <button style={btn()} disabled={busy || missingNow.length > 0} onClick={() => persist(true)}>📤 ส่งผลประเมินให้ Marketing</button>
          </div>
        </div>
      )}

      {/* ── ผลล่าสุดที่ส่งแล้ว (ทุกคนเห็น) ── */}
      {latest?.status === 'submitted' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '0 16px', alignItems: 'start' }} className="mgrid">
          <div>
            {row('ผล', <Pill label={FEASIBLE[latest.feasible]?.label || latest.feasible || '—'} color={statusColor(FEASIBLE[latest.feasible]?.tone || 'none')} small />)}
            {latest.feasible_note && row(latest.feasible === 'no' ? 'เหตุผล' : 'เงื่อนไข', latest.feasible_note)}
            {row('ชนิดงานในมุม IEC', latest.job_type_view ? <>{JOB_TYPES[latest.job_type_view]}{rfq.job_type && latest.job_type_view !== rfq.job_type && <span style={{ color: statusColor('warn') }}> · ต่างจากที่ MKT ตั้ง ({JOB_TYPES[rfq.job_type]})</span>}</> : '—')}
            {row('ไลน์อ้างอิง', latest.ref_line_name)}
            {row('ลงทุนเพิ่ม', latest.new_investment)}
            {row('ความเสี่ยง', latest.risks)}
            {row('เวลาเตรียมการ', latest.lead_time_note)}
            {row('ราคาเป้าหมายลูกค้า', latest.target_price_feasible
              ? <><Pill label={TARGET_PRICE_FEASIBLE[latest.target_price_feasible]?.label || latest.target_price_feasible} color={statusColor(TARGET_PRICE_FEASIBLE[latest.target_price_feasible]?.tone || 'none')} small />{latest.target_price_note ? ` ${latest.target_price_note}` : ''}</>
              : <span style={{ color: 'var(--muted)' }}>ไม่ได้ตอบ{rfq.customer_target_price == null ? ' (RFQ ไม่มีราคาเป้าหมาย)' : ''}</span>)}
            {row('ประเมินโดย', `${latest.assessed_by_name || '—'} · ${latest.submitted_at ? fmtDateTime(latest.submitted_at) : '—'}`)}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 4 }}>ร่าง Process flow</div>
            <FlowTable rows={latest.process_flow} />
          </div>
        </div>
      )}
      {assessments.length > 1 && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>ประวัติ: {assessments.slice().sort((a, b) => a.round - b.round).map(a => `รอบ ${a.round} ${ASSESS_STATUS[a.status]?.label || a.status}${a.feasible ? ` (${FEASIBLE[a.feasible]?.label})` : ''}`).join(' → ')}</div>}
      {latest?.status === 'draft' && canEdit && <WarnBar color="var(--amber)">สถานะ RFQ จะเดินต่อขั้น 3 ขึ้นไปได้ หลัง IEC ส่งผลรอบนี้กลับมา</WarnBar>}
    </div>
  );
}
