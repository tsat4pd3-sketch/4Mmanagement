/**
 * prodProblemDoc — ทะเบียนใบรายงานปัญหาการผลิต FM-PD1-019 (ตาราง `prod_problem_reports` · DR)
 *
 * ที่มา: user 2026-09-25 — "ใบบันทึกปัญหา ก็ไม่ได้เก็บข้อมูลหรอ เห็นหัวหน้าต้องปริ้นออกมาเก็บเป็นกระดาษทุกวัน"
 *   WI-PD3-069 §7 ให้เก็บใบนี้ 1 ปี แต่ระบบเดิม "พิมพ์แล้วจบ" ไม่มีร่องรอยว่าเคยออกใบไหน
 *
 * 🔴 กฎของโมดูลนี้ (ห้ามเปลี่ยนโดยไม่อ่านเอกสาร docs/modules/production-problem-report-bins.md)
 *   1. **ออกใบ = เขียนบันทึกก่อน แล้วค่อยพิมพ์** — พิมพ์ติดแล้วไม่มีบันทึก = ใบลอยเหมือนเดิม
 *      แต่ถ้าเขียนบันทึกไม่สำเร็จ **ห้ามพิมพ์ต่อเงียบๆ** (จะได้ใบที่ไม่มีเลขที่ ไม่มีใครรู้ว่ามีอยู่)
 *   2. **พิมพ์ซ้ำ = ใบเดิม ไม่ใช่ใบใหม่** — ใช้ snapshot เสมอ + นับ reprint_count ไม่ออกเลขใหม่
 *   3. **snapshot ไม่ตรงกับข้อมูลปัจจุบัน = บอกบนจอ** ห้ามพิมพ์ของใหม่ทับเลขใบเดิมเงียบๆ
 *      (คนถือกระดาษใบเดิมอยู่ — เลขเดียวกันต้องเป็นเนื้อเดียวกัน)
 */
import { supabaseDR } from '../supabaseClient';
import {
  buildProblemReport, serializeReport, reportFromSnapshot, reportSignature,
  printProdProblemReport, PROBLEM_MIN_MINUTES,
} from './prodProblemReport';

/** ใบนี้ยังไม่มีเลขฟอร์มทางการใน doc_forms — เลขที่ running ของ ESM ใช้ prefix สั้นๆ */
const PREFIX = 'PR';

/**
 * เลขที่ใบ running รายเดือน — "เลขสูงสุดของเดือนนั้น + 1"
 * ⚠️ ห้ามใช้ count()+1 (ออกใบย้อนวันแล้วเลขชนกัน — บทเรียนเดียวกับ nextDocNo ของใบรายงานของเสีย)
 */
export async function nextProblemDocNo(workDate) {
  const ym = String(workDate || '').slice(0, 7);          // YYYY-MM
  const [y, mo] = ym.split('-').map(Number);
  if (!y || !mo) return null;
  const monthStart = `${ym}-01`;
  const nextMonth = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  const { data, error } = await supabaseDR.from('prod_problem_reports')
    .select('doc_no').gte('work_date', monthStart).lt('work_date', nextMonth);
  if (error) return null;                                  // เขียนไม่ได้ดีกว่าเขียนเลขที่อาจซ้ำ
  const re = new RegExp(`^${PREFIX}\\s+(\\d+)`);
  let max = 0;
  (data || []).forEach(r => { const m = re.exec(r.doc_no || ''); if (m) max = Math.max(max, +m[1]); });
  return `${PREFIX} ${String(max + 1).padStart(4, '0')}/${String(mo).padStart(2, '0')}-${String(y).slice(2)}`;
}

/** ใบที่เคยออกของกะเหล่านี้ → { [session_id]: [row, …] } (ใหม่สุดก่อน) */
export async function loadProblemDocs(sessionIds = []) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (!ids.length) return {};
  const out = {};
  // `.in()` ยาวเกินไป = URL ทะลุเพดาน proxy แล้วคืนค่าว่างเงียบ (กฎเหล็กข้อ 5) → ตัดเป็นก้อน
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseDR.from('prod_problem_reports')
      .select('id, doc_no, session_id, work_date, line_name, shift, section, problem_title, snapshot, min_minutes, issued_by, issued_at, reprint_count, last_printed_at')
      .in('session_id', ids.slice(i, i + 100)).eq('is_active', true)
      .order('issued_at', { ascending: false });
    if (error) return out;                                  // ตารางยังไม่มี/คิวรีล้ม = ไม่โชว์ ดีกว่าโชว์ผิด
    (data || []).forEach(r => { (out[r.session_id] ||= []).push(r); });
  }
  return out;
}

/**
 * ออกใบใหม่: บันทึกทะเบียนก่อน → พิมพ์
 * @returns { ok, doc, reason } · ok=false = ไม่ได้พิมพ์ (ผู้เรียกต้องแจ้ง user ทุกกรณี ห้ามเงียบ)
 */
export async function issueProblemReport({
  session, downtimes = [], defects = [], section = null,
  title = '', actorName = null, actorUid = null, minMinutes = PROBLEM_MIN_MINUTES,
}) {
  if (!session?.id) return { ok: false, reason: 'ไม่มีข้อมูลกะ' };
  const R = buildProblemReport({ downtimes, defects, minMinutes });
  const doc_no = await nextProblemDocNo(session.work_date);
  if (!doc_no) return { ok: false, reason: 'ออกเลขที่ใบไม่สำเร็จ — ตารางทะเบียนใบรายงานปัญหายังไม่พร้อม' };

  const { data, error } = await supabaseDR.from('prod_problem_reports').insert({
    doc_no,
    session_id: session.id,
    work_date: session.work_date,
    line_name: session.line_name || null,
    shift: session.shift || null,
    section: section || null,
    problem_title: title ?? '',
    snapshot: serializeReport(R),
    min_minutes: minMinutes,
    issued_by: actorName || null,
    /* ⚠️ ใส่ issued_by_uid **เฉพาะเมื่อรู้จริง** — wrapper withActorStamp เติม uid ให้เองจาก
       DR_STEP_ACTORS แต่จะ "เคารพค่าที่หน้าส่งมา" ⇒ ส่ง null มาดื้อๆ = ปิดการเติมอัตโนมัติทิ้ง */
    ...(actorUid ? { issued_by_uid: actorUid } : {}),
    last_printed_at: new Date().toISOString(),
  }).select('*').single();

  if (error) {
    return { ok: false, reason: error.code === '42P01'
      ? 'ยังไม่ได้ติดตั้งทะเบียนใบรายงานปัญหา — แจ้ง admin ให้ apply migration 20260925_prod_problem_reports_dr'
      : `บันทึกใบไม่สำเร็จ: ${error.message}` };
  }
  // ⚠️ RLS ปฏิเสธ insert จะโยน 42501 (มี error) — ถึงตรงนี้แต่ไม่มีแถว = ผิดปกติจริง ห้ามพิมพ์ต่อ
  if (!data) return { ok: false, reason: 'บันทึกใบไม่สำเร็จ — ไม่มีแถวถูกสร้าง' };

  const printed = await printProdProblemReport({
    session, downtimes, defects, minMinutes, section,
    report: R, docNo: doc_no,
    issued: { by: actorName, at: data.issued_at },
    extra: { problem: title },
  });
  return { ok: true, doc: data, printed };
}

/**
 * พิมพ์ซ้ำใบเดิม — จาก snapshot เสมอ (ใบเลขเดียวกันต้องเป็นเนื้อเดียวกัน)
 * snapshot เสีย/ว่าง (ใบเก่าก่อนมีระบบนี้) = คืน ok:false ให้ผู้เรียกบอก user ว่าต้องออกใบใหม่
 */
export async function reprintProblemReport({ doc, session }) {
  const R = reportFromSnapshot(doc?.snapshot);
  if (!R) return { ok: false, reason: 'ใบนี้ไม่มีเนื้อใบที่บันทึกไว้ — ออกใบใหม่แทน' };
  const s = session || {
    work_date: doc.work_date, line_name: doc.line_name, shift: doc.shift, id: doc.session_id,
  };
  const printed = await printProdProblemReport({
    session: s, downtimes: [], defects: [], minMinutes: doc.min_minutes || PROBLEM_MIN_MINUTES,
    section: doc.section || null, report: R, docNo: doc.doc_no,
    issued: { by: doc.issued_by, at: doc.issued_at },
    extra: { problem: doc.problem_title ?? '' },
  });
  if (!printed) return { ok: false, reason: 'เบราว์เซอร์บล็อก popup — อนุญาต popup ของเว็บนี้ก่อน' };
  // นับพิมพ์ซ้ำ — ล้มเหลวไม่ทำให้การพิมพ์เป็นโมฆะ แต่ก็ไม่เงียบ (คืน countError ให้ผู้เรียกเลือกแจ้ง)
  const { error } = await supabaseDR.from('prod_problem_reports')
    .update({ reprint_count: (Number(doc.reprint_count) || 0) + 1, last_printed_at: new Date().toISOString() })
    .eq('id', doc.id).select('id');
  return { ok: true, countError: error?.message || null };
}

/**
 * ข้อมูลปัจจุบันยังตรงกับใบที่ออกไปแล้วไหม
 * @returns true = ตรง · false = เปลี่ยนไปแล้ว (จอต้องบอก ห้ามกลบ) · null = เทียบไม่ได้
 */
export function docMatchesNow(doc, { downtimes = [], defects = [] } = {}) {
  const old = reportFromSnapshot(doc?.snapshot);
  if (!old) return null;
  const now = buildProblemReport({ downtimes, defects, minMinutes: doc.min_minutes || PROBLEM_MIN_MINUTES });
  return reportSignature(old) === reportSignature(now);
}
