/* ══ ⏩ Downtime ที่ "ยังซ่อมอยู่ ตัดยอดข้ามกะ" → เปิดต่อในกะถัดไป ═══════════════════════
 *
 * วงจรเต็ม:
 *   ปิดกะ → เลือก "ยังซ่อมอยู่ ตัดยอดข้ามกะ" ⇒ แถวเดิมถูกปิดที่ **เวลาเลิกกะ**
 *   (`ended_at` + `duration_min` ⇒ นาทีของกะนั้นเข้า %A ครบ) + ตั้งธง `carry_over = true`
 *   ⇒ กะถัดไปของไลน์เดียวกันต้องมีแถวใหม่ `carried_from_id` เริ่มที่ **เวลาเริ่มกะใหม่**
 *
 * 🔴🔴 กฎเหล็ก — ต้องทำ **2 ทาง** (2026-11-09 · วัดจากฐานจริง)
 *   เดิมมีแต่ทาง "ดึงตอนเปิดกะ" ซึ่งอ่านธง `carry_over` ของกะก่อน
 *   ⇒ ใช้ได้เฉพาะเมื่อ **ปิดกะเก่าเสร็จก่อนเปิดกะใหม่** ซึ่ง**ไม่ใช่ลำดับปกติของโรงงาน**
 *     (หัวหน้ากะเช้ามักปิดกะหลังกะดึกเริ่มเดินไปแล้ว)
 *   เคสจริงเคสเดียวที่เคยใช้ฟีเจอร์นี้ — HDF1 24/08: กะดึกถูกเปิด 21:02 น. แต่กะเช้าปิด 21:55 น.
 *   ⇒ ตอนเปิดกะดึก ธงยังเป็น false ⇒ **ไม่มีใครรับต่อ และไม่มีใครย้อนมาเติม** (0/1 สำเร็จ)
 *   ⇒ จึงต้องมีทาง "ดันตอนปิดกะ" ด้วย · กันซ้ำด้วย `carried_from_id` ⇒ เรียกซ้ำกี่ทางก็ปลอดภัย
 *
 * ⚠️ ห้ามกลืน error — อ่าน/เขียนพลาดแล้วเงียบ = เครื่องหยุดต่อเนื่องหายจากกะใหม่
 *    โดยไม่มีใครรู้ (ผิดกฎ "ห้ามล้มเหลวเงียบ") ⇒ ทุกทางคืน `error` ให้จอ toast เสมอ
 */
import { supabaseDR } from '../supabaseClient';
import { shiftWindow } from '../utils/shiftWindow';
import { SESSION_STATUSES_LIVE } from '../utils/sessionStatus';
import { pendingCarryRows, carryPayload } from '../utils/downtimeCarryRules';

export { pendingCarryRows, carryPayload };

/** คอลัมน์ที่ต้องก๊อปไปแถวใหม่ — `call_mtn` ไม่ก๊อป (ใบใหม่ต้องเรียกช่างใหม่ถ้ายังต้องการ) */
const CARRY_COLS = 'id, downtime_type_id, machine_no, mat_no, description';

/**
 * ย้าย downtime ที่ตัดยอดข้ามกะจาก `fromSessionId` → `toSession` (แถวของกะใหม่)
 * คืน `{ inserted, error }` · ไม่มีอะไรต้องทำ = `{ inserted: 0, error: null }`
 */
export async function carryDowntimesTo({ fromSessionId, toSession, by = null, byUid = null }) {
  if (!fromSessionId || !toSession?.id) return { inserted: 0, error: null };

  const { data: carryRows, error: cErr } = await supabaseDR.from('downtime_logs')
    .select(CARRY_COLS).eq('session_id', fromSessionId).eq('carry_over', true);
  if (cErr) return { inserted: 0, error: cErr.message };
  if (!carryRows?.length) return { inserted: 0, error: null };

  // กันสร้างซ้ำ (เปิดกะ→ลบกะ→เปิดใหม่ · หรือถูกเรียกทั้ง 2 ทาง)
  const { data: conts, error: dErr } = await supabaseDR.from('downtime_logs')
    .select('carried_from_id').in('carried_from_id', carryRows.map(d => d.id));
  if (dErr) return { inserted: 0, error: dErr.message };

  const pending = pendingCarryRows(carryRows, conts);
  if (!pending.length) return { inserted: 0, error: null };

  /* 🔴 เวลาเริ่มของแถวใหม่ = เวลาเริ่มกะใหม่ ผ่าน `shiftWindow()` เท่านั้น
     (ภายในใช้ `shiftStartDate` ⇒ กะดึกที่เริ่ม 00:00-07:59 ไม่เขียน timestamp เร็วไป 1 วัน)
     นาทีก่อนหน้านั้นถูกนับใน %A ของกะเก่าไปแล้ว — ห้ามนับซ้ำ */
  const w = shiftWindow(toSession);
  if (!w) return { inserted: 0, error: 'อ่านกรอบเวลาของกะใหม่ไม่ได้ (ไม่มี work_date/start_time)' };
  const startISO = new Date(w.startMs).toISOString();

  const { error: iErr } = await supabaseDR.from('downtime_logs')
    .insert(carryPayload({ rows: pending, toSessionId: toSession.id, startISO, by, byUid }));
  if (iErr) return { inserted: 0, error: iErr.message };
  return { inserted: pending.length, error: null };
}

/** กะล่าสุดของไลน์ก่อนหน้ากะนี้ — ใช้ตอน "เปิดกะใหม่" (ดึง) */
export async function prevSessionOfLine(lineName, exceptId) {
  let q = supabaseDR.from('production_sessions')
    .select('id').eq('line_name', lineName).order('created_at', { ascending: false }).limit(1);
  if (exceptId) q = q.neq('id', exceptId);
  const { data, error } = await q;
  if (error) return { session: null, error: error.message };
  return { session: data?.[0] || null, error: null };
}

/**
 * กะถัดไปของไลน์ที่ "เปิดไปแล้ว" — ใช้ตอน "ปิดกะ" (ดัน)
 * ⚠️ ต้องเป็นกะที่ **ถูกสร้างหลังกะนี้** และยังไม่ปิด · เอาตัวแรกตามลำดับเวลา
 *    (ไม่ใช่ `limit 1 desc` — กะค้างเก่าของไลน์เดียวกันจะแย่งรับแทนกะถัดไปจริง)
 */
export async function nextOpenSessionOfLine(session) {
  if (!session?.line_name || !session?.created_at) return { session: null, error: null };
  const { data, error } = await supabaseDR.from('production_sessions')
    .select('id, work_date, shift, start_time, end_time, shift_min, status, created_at')
    .eq('line_name', session.line_name).in('status', SESSION_STATUSES_LIVE)
    .gt('created_at', session.created_at).order('created_at', { ascending: true }).limit(1);
  if (error) return { session: null, error: error.message };
  return { session: data?.[0] || null, error: null };
}
