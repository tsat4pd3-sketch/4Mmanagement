/**
 * QualityBinDetailModal — รายละเอียดรายการในถังเหลือง/ถังแดง 1 ใบ (2026-11-16 · คำสั่ง user)
 *
 * *"รายละเอียดแต่ละงาน มันน่าจะมี modal popup รูป หรือรายละเอียดให้หน่อย นี่บังคับ export pdf ดูอย่างเดียว
 *   และยิ่งหน้า QA ที่ต้องอนุมัติ ไม่เห็นรายละเอียดอะไรเลยจะอนุมัติยังไง"*
 *
 * ใช้ร่วมกันทั้ง `/scrap-report?tab=bins` (โหมด full) และ `/qa?tab=bins` (โหมด queue) — ห้ามวาดชุดที่ 2
 * · ปิดด้วย ✕ / ปิด / Esc เท่านั้น (ไม่ปิดจาก backdrop — ด่าน modal-closes-on-backdrop)
 * · ปุ่มตัดสิน/ตรวจรับ **ไม่ได้อยู่ในไฟล์นี้** — หน้าแม่ส่ง `actions` มา (ฟังก์ชันเดิมของ QualityBins
 *   ที่มีด่านสิทธิ์ + guardLines + confirmSign ครบ) ⇒ ไฟล์นี้ไม่เขียน DB เลย
 * · ที่มาจาก Daily Report อ่านจาก `defect_logs` ด้วย `defect_log_id` (DR · anon) — อ่านไม่ได้ = เขียนบนจอ
 *   ห้ามขึ้นว่า "ไม่มีข้อมูล" (กฎความซื่อสัตย์ของจอ)
 */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import StepFlow from './StepFlow';
import { PointThumb } from './inspect/PointZoom';
import { decisionOf, binTagAge, ncFlow, ncStep, SPECIAL_USE_FORM } from '../utils/qualityBin';
import { tr, dateLocale } from '../utils/i18n';

/* คอลัมน์ที่ใช้จริง — ห้าม select('*') (กฎเขียน DB ข้อ 11) */
const DEFECT_COLS = 'id, qty_ng, qty_suspect, qty_repair, description, reported_by_name, logged_at, is_trial, '
  + 'fix_action, fix_by, defect_img, child_part_name, '
  + 'dr_defect_types(name_th), prod_orders(prod_no, mat_no, part_name, machine_no), '
  + 'production_sessions(work_date, shift, line_name)';

const fmtTs = (v) => (v ? new Date(v).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : '');
const SHIFT_TH = { day: 'กะเช้า', night: 'กะดึก' };

function Row({ k, v, strong, color }) {
  if (v == null || v === '') return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr', gap: 8, padding: '5px 0', borderTop: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr(k)}</span>
      <span style={{ fontSize: 13, color: color || 'var(--text)', fontWeight: strong ? 800 : 500, wordBreak: 'break-word' }}>{v}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text2)', marginBottom: 4 }}>{tr(title)}</div>
      {children}
    </div>
  );
}

/**
 * @param {object}   props.row          แถว quality_bin_records (คอลัมน์ชุด BIN_COLS)
 * @param {boolean}  props.hasRedChild  ใบเหลืองนี้ย้ายลงถังแดงไปแล้ว
 * @param {object}   props.scrapDoc     { doc_no, status } ของใบรายงานของเสียที่ผูก (ถังแดง) | undefined
 * @param {string}   props.todayWd      วันทำงานวันนี้ (ส่งเข้า binTagAge — ฟังก์ชันไม่อ่านนาฬิกาเอง)
 * @param {Array}    props.actions      ปุ่มของขั้นปัจจุบัน (หน้าแม่สร้าง) — ว่าง = ไม่มีอะไรให้ทำ/ไม่มีสิทธิ์
 * @param {string}   props.actionNote   ข้อความใต้ปุ่ม (เช่น บอกว่าขั้นนี้รอใคร/ต้องมีสิทธิ์อะไร)
 */
export default function QualityBinDetailModal({ row, hasRedChild = false, scrapDoc, todayWd, actions = [], actionNote, onEdit, onClose }) {
  const [dl, setDl] = useState(null);       // defect_logs แถวต้นทาง
  const [dlErr, setDlErr] = useState('');
  const [dlLoading, setDlLoading] = useState(false);
  const defectId = row?.defect_log_id || null;

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  /* stale guard — เปิดใบอื่นเร็วๆ ผลเก่าห้ามทับ (กฎเขียน DB ข้อ 4) */
  useEffect(() => {
    let alive = true;
    setDl(null); setDlErr('');
    if (!defectId) return undefined;
    setDlLoading(true);
    supabaseDR.from('defect_logs').select(DEFECT_COLS).eq('id', defectId).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        setDlLoading(false);
        if (error) setDlErr(error.message);
        else if (!data) setDlErr('ไม่พบบันทึกต้นทาง (อาจถูกลบจาก Daily Report แล้ว)');
        else setDl(data);
      });
    return () => { alive = false; };
  }, [defectId]);

  if (!row) return null;
  const isY = row.bin === 'yellow';
  const age = binTagAge(row, todayWd);
  const st = ncStep(row, { hasRedChild });
  const flow = ncFlow(row, { hasRedChild });
  const dec = decisionOf(row.qa_decision);
  const qty = Number(row.qty) || 0;

  /* รูป: ของใบถัง + ของบันทึกต้นทาง (ถ้าเป็นคนละไฟล์) */
  const photos = [
    row.found_img && { url: row.found_img, name: 'รูปตอนพบ' },
    isY && row.repair_img && { url: row.repair_img, name: 'รูปหลังซ่อม' },
    dl?.defect_img && dl.defect_img !== row.found_img && { url: dl.defect_img, name: 'รูปจาก Daily Report' },
  ].filter(Boolean);

  const sess = dl?.production_sessions;
  const po = dl?.prod_orders;

  return (
    /* ไม่ปิดจาก backdrop — ในโมดัลมีปุ่มตัดสิน/ตรวจรับ เผลอแตะพื้นหลังระหว่างไล่ดูรูปแล้วหลุดจากใบที่กำลังพิจารณา
       ปิดด้วย ✕ / ปิด / Esc (ด่าน modal-closes-on-backdrop) */
    <div className="modal-scroll"
      style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
      <div role="dialog" aria-modal="true"
        style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
          width: 'min(96vw, 1100px)', maxHeight: '94vh', overflowY: 'auto', padding: 18 }}>
        {/* ── หัว ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: isY ? 'var(--amber)' : 'var(--red)' }}>
              {isY ? tr('🟡 ถังเหลือง — ชิ้นงานต้องสงสัย') : tr('🔴 ถังแดง — ชิ้นงานเสีย')}
            </div>
            <h3 style={{ margin: '2px 0 0', fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>
              {row.part_name || row.part_no || row.mat_no || '—'}
            </h3>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {[row.part_no, row.mat_no].filter(Boolean).join(' · ') || '—'}
              {row.line_name ? ` · ${row.line_name}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: isY ? 'var(--amber)' : 'var(--red)', lineHeight: 1 }}>{qty.toLocaleString()}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr('ชิ้น')}</div>
          </div>
          <button onClick={onClose} aria-label={tr('ปิด')}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* ── ขั้นตอน ── กฎอยู่ที่ ncFlow()/ncStep() ที่เดียว */}
        <div style={{ marginBottom: 12 }}>
          <StepFlow steps={flow.steps} waiting={flow.waiting} unknown={!flow.known} />
          {/* ป้าย "รอใคร" มากับ StepFlow แล้ว (waiting) — เขียนเพิ่มเฉพาะเรื่องที่ StepFlow ไม่บอก */}
          {!flow.waiting && st.key === 'done' && (
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)', marginTop: 4 }}>✓ {st.label}</div>
          )}
          {hasRedChild && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--red)', marginTop: 4 }}>🔴 {tr('ย้ายลงถังแดงแล้ว')}</div>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignContent: 'start' }}>
          {/* ── ซ้าย: รูป + รายการ ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section title={tr("📷 รูปหลักฐาน")}>
              {photos.length ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
                  {photos.map(p => (
                    <div key={p.url + p.name} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                      <PointThumb url={p.url} height={150} mobileMax={120} name={p.name} />
                      <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr(p.name)} · {tr('แตะเพื่อขยาย')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', paddingTop: 4 }}>
                  {dlLoading ? tr('กำลังโหลด…') : tr('ไม่มีรูปแนบ')}
                </div>
              )}
            </Section>
            <Section title={tr("📋 รายการ")}>
              <Row k={tr("วันที่ลงถัง")} v={row.work_date} />
              <Row k={tr("อายุแท็ก")} v={age ? `${age.days} / ${age.limit} ${tr("วัน")}${age.over && st.key !== 'done' ? ` · ${tr("เกิน")} ${age.overBy} ${tr("วัน")}` : ''}` : '—'}
                color={age?.over && st.key !== 'done' ? 'var(--red)' : undefined} strong={age?.over && st.key !== 'done'} />
              <Row k={tr("ไลน์")} v={row.line_name || '—'} />
              <Row k={tr("สาเหตุ")} v={row.cause || '—'} />
              <Row k={tr("ผู้แจ้ง")} v={row.reported_by || '—'} />
              <Row k={tr("หมายเหตุ")} v={row.note} />
              {!isY && row.from_yellow_id && <Row k={tr("ที่มา")} v={tr('🟡 ย้ายมาจากถังเหลือง')} />}
            </Section>
          </div>

          {/* ── ขวา: ที่มา + ผลพิจารณา ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section title={tr("🏭 ที่มาจาก Daily Report")}>
              {!defectId ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', paddingTop: 4 }}>{tr('คีย์ลงถังโดยตรง — ไม่ได้มาจากบันทึกงานเสียใน Daily Report')}</div>
              ) : dlErr ? (
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--red)', paddingTop: 4 }}>⚠️ {tr('อ่านบันทึกต้นทางไม่ได้')}: {dlErr}</div>
              ) : !dl ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', paddingTop: 4 }}>{tr('กำลังโหลด…')}</div>
              ) : (<>
                <Row k={tr("กะ")} v={sess ? [sess.work_date, SHIFT_TH[sess.shift] || sess.shift, sess.line_name].filter(Boolean).join(' · ') : null} />
                <Row k={tr("เวลาที่บันทึก")} v={fmtTs(dl.logged_at)} />
                <Row k={tr("ผู้บันทึก")} v={dl.reported_by_name} />
                <Row k={tr("ใบสั่งผลิต")} v={po ? [po.prod_no, po.mat_no, po.part_name].filter(Boolean).join(' · ') : null} />
                <Row k={tr("เครื่อง")} v={po?.machine_no} />
                <Row k={tr("ชิ้นส่วนย่อย")} v={dl.child_part_name} />
                <Row k={tr("ประเภทของเสีย")} v={dl.dr_defect_types?.name_th} />
                <Row k={tr("รายละเอียด")} v={dl.description} />
                <Row k={tr("จำนวน")} v={[
                  dl.qty_ng ? `เสีย ${dl.qty_ng}` : '', dl.qty_suspect ? `สงสัย ${dl.qty_suspect}` : '',
                  dl.qty_repair ? `ซ่อม ${dl.qty_repair}` : '', dl.is_trial ? 'งานทดลอง' : '',
                ].filter(Boolean).join(' · ')} />
                <Row k={tr("วิธีแก้ไข")} v={dl.fix_action ? `${dl.fix_action}${dl.fix_by ? ` (${dl.fix_by})` : ''}` : null} />
              </>)}
            </Section>

            {isY ? (
              <Section title={tr("✍️ ผลพิจารณา QA / การซ่อม")}>
                <Row k={tr("ผล QA")} v={dec ? tr(dec.label) : tr('⏳ ยังไม่พิจารณา')} color={dec ? dec.color : 'var(--amber)'} strong />
                <Row k={tr("ผู้พิจารณา")} v={row.qa_by ? `${row.qa_by}${row.qa_decision_at ? ` · ${fmtTs(row.qa_decision_at)}` : ''}` : null} />
                {row.qa_decision === 'use_as_is' && <Row k={`${tr("เลขใบ")} ${SPECIAL_USE_FORM}`} v={row.special_use_doc_no || tr('⏳ ยังไม่กรอก')} />}
                <Row k={tr("ซ่อมเมื่อ")} v={row.repair_date ? `${row.repair_date}${row.repair_by ? ` · ${row.repair_by}` : ''}` : null} />
                <Row k={tr("รายละเอียดการซ่อม")} v={row.repair_detail} />
                <Row k={tr("ผลซ่อม")} v={row.qty_ok != null || row.qty_ng != null ? `${tr("ดี")} ${row.qty_ok ?? 0} · ${tr("ซ่อมไม่ได้")} ${row.qty_ng ?? 0}` : null} />
                <Row k={tr("ตีกลับล่าสุด")} v={row.repair_reject_note ? `${row.repair_reject_note}${row.repair_reject_count ? ` (${tr("ครั้งที่")} ${row.repair_reject_count})` : ''}` : null} color="var(--red)" />
                <Row k={tr("QA ตรวจรับ")} v={row.repair_accepted_by ? `${row.repair_accepted_by}${row.repair_accepted_at ? ` · ${fmtTs(row.repair_accepted_at)}` : ''}` : null} />
                <Row k={tr("กลับเข้ากระบวนการ")} v={row.return_date} color="var(--green)" strong />
              </Section>
            ) : (
              <Section title={tr("🗑️ การกำจัดทำลาย (DOA)")}>
                <Row k="QA" v={row.qa_by || '—'} />
                <Row k={tr("ผู้กำจัดทำลาย")} v={row.disposed_by ? `${row.disposed_by}${row.disposed_position ? ` · ${row.disposed_position}` : ''}` : tr('— ยังไม่กรอก')} />
                <Row k={tr("ใบรายงานของเสีย")} v={row.scrap_report_id ? `${scrapDoc?.doc_no || tr('ออกใบแล้ว')}${scrapDoc?.status === 'draft' ? ` · ${tr('ร่าง ยังไม่ส่งอนุมัติ')}` : ''}` : tr('⏳ ยังไม่ออกใบ')}
                  color={row.scrap_report_id && scrapDoc?.status !== 'draft' ? 'var(--green)' : 'var(--amber)'} strong />
              </Section>
            )}
          </div>
        </div>

        {/* ── ปุ่มของขั้นปัจจุบัน (หน้าแม่สร้าง · ฟังก์ชันเดิมที่มีด่านครบ) ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {actions}
          {actionNote && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{actionNote}</span>}
          <span style={{ flex: 1 }} />
          {onEdit && (
            <button onClick={onEdit}
              style={{ padding: '7px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
              ✏️ {tr('แก้ไขรายการ')}
            </button>
          )}
          <button onClick={onClose}
            style={{ padding: '7px 16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontSize: 12.5 }}>
            {tr('ปิด')}
          </button>
        </div>
      </div>
    </div>
  );
}
