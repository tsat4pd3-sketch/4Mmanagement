/* ── 🔁 restampSessionQ — คิด %Q ของกะที่ปิดแล้วใหม่ หลัง QA ตัดสินของในถัง (2026-11-10 · คำสั่ง user) ──
 *
 * ทำไมต้องมี: กะที่ปิดแล้ว stamp `oee_q`/`oee` ลง `production_sessions` ตอนปิด และจอรายงานหลายจอ
 *   (Obeya/KPI/Monthly Review) อ่านค่าที่ stamp ไว้ ⇒ ของในถังเหลืองที่ "รอพิจารณา" ตอนปิดกะ
 *   ถูกกันออกจาก %Q (oee.js §7.1/§7.2) — พอ QA ตัดสินทีหลังว่า "ทำลาย" ค่าที่ stamp ไว้จะสูงเกินจริงถาวร
 *   (CLAUDE.md: "กะที่ QA ยังไม่ตัดสิน = ค่าชั่วคราว ตัดสินทีหลังว่า scrap ต้องคิด %Q กะนั้นใหม่")
 *
 * 🔴 แตะเฉพาะ `oee_q` + `oee` — %A/%P/ยอดผลิตไม่เกี่ยวกับผลพิจารณา (ห้ามคิดใหม่ที่นี่)
 *    สูตรเดียวกับตอนปิดกะ (`computeOEE`): Q = ยอดผลิต ÷ (ยอดผลิต + ของเสีย) · ของเสีย = `sumDefectQty(…, 'line')`
 * 🔴 กะยังไม่ปิด = ไม่ทำอะไร (จอสดคิดจาก defect_logs เองอยู่แล้ว)
 * ⚠️ ไม่โยน error — คืน { ok, reason } ให้ผู้เรียกเขียนบอกบนจอ (คิดใหม่ไม่สำเร็จ ห้ามเงียบ)
 */
import { supabaseDR } from '../supabaseClient';
import { QBIN_EMBED } from '../utils/oee';
import { restampQPatch } from '../utils/restampQ';
import { SESSION_STATUSES_DONE } from '../utils/sessionStatus';

/**
 * @param {string[]} defectLogIds  แถว defect_logs ที่ใบถังเพิ่งถูกตัดสิน
 * @returns {Promise<{ok:boolean, changed:number, reason?:string}>}
 */
export async function restampSessionQByDefects(defectLogIds) {
  const ids = [...new Set((defectLogIds || []).filter(Boolean))];
  if (!ids.length) return { ok: true, changed: 0 };
  const { data: dl, error: e1 } = await supabaseDR.from('defect_logs').select('session_id').in('id', ids);
  if (e1) return { ok: false, changed: 0, reason: e1.message };
  const sids = [...new Set((dl || []).map(r => r.session_id).filter(Boolean))];
  let changed = 0;
  for (const sid of sids) {
    const { data: s, error: e2 } = await supabaseDR.from('production_sessions')
      .select('id, status, actual_qty, oee_a, oee_p, oee_q, oee').eq('id', sid).maybeSingle();
    if (e2) return { ok: false, changed, reason: e2.message };
    if (!s || !SESSION_STATUSES_DONE.includes(s.status)) continue;
    const { data: defs, error: e3 } = await supabaseDR.from('defect_logs')
      .select(`qty_ng, qty_suspect, is_trial, dr_defect_types(excl_from_q), ${QBIN_EMBED}`)
      .eq('session_id', sid);
    if (e3) return { ok: false, changed, reason: e3.message };
    const patch = restampQPatch(s, defs);
    if (!patch) continue;
    const { data: w, error: e4 } = await supabaseDR.from('production_sessions').update(patch).eq('id', sid).select('id');
    if (e4) return { ok: false, changed, reason: e4.message };
    if (!(w || []).length) return { ok: false, changed, reason: 'เขียนค่า %Q ของกะไม่ติด (0 แถว)' };
    changed += 1;
  }
  return { ok: true, changed };
}
