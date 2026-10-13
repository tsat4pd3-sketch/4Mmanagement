/* ── runDays — "ไลน์นี้ วันนี้/กะนี้ มีการผลิตจริงไหม" สำหรับตารางตรวจรายวัน (2026-10-13) ────────
   ใช้คู่กับ `utils/dailyCheckDay.js` — ฟอร์มตรวจรายวันต้องแยก "ไม่ได้ตรวจ" ออกจาก "ไม่ได้ผลิต"

   แหล่งความจริง = `production_sessions` ฝั่ง **DR** (กะที่เปิดจริง) — ไม่ใช่ใบผลิต เพราะ
   กะที่เปิดแล้วไม่มีใบ (เช่น ไลน์ไม่มีแผนผลิตแต่คนมายืน) **ยังต้องตรวจ** ตามมาตรฐาน

   🔴 กฎเหล็ก:
   1. **อ่านไม่สำเร็จ = `ok: false` และ `days = null`** — ผู้เรียกต้องแปลเป็น `unknown`
      ⇒ ห้ามคืน Set ว่างแล้วให้จอสรุปว่า "ทั้งเดือนไม่ได้ผลิต" (= กลบวันขาดตรวจทั้งเดือน)
   2. กรองสถานะด้วย `SESSION_STATUSES_REAL` **ห้าม `.neq('status','void')`** (กะโมฆะไม่ใช่กะ · มีด่าน)
   3. ไลน์ลูก/ไลน์แม่เป็นคนละ `line_name` — ผู้เรียกส่งชื่อไลน์ที่ต้องการมาเอง (จอตรวจผูกกับไลน์ที่ตรวจ)  */
import { supabaseDR } from '../supabaseClient';
import { SESSION_STATUSES_REAL } from './sessionStatus';
import { runKey } from './dailyCheckDay';

// ส่วน pure อยู่ใน `dailyCheckDay.js` (ไม่แตะ supabase ⇒ เทสได้) — re-export ให้จอเรียกจากที่เดียว
export { runKey, ranOn } from './dailyCheckDay';

/**
 * โหลด "วันที่มีกะจริง" ของไลน์ชุดหนึ่งในช่วงวันที่
 * @param {object}   p
 * @param {string[]} p.lineNames ชื่อไลน์ (อย่างน้อย 1 ตัว) — ว่าง = ไม่ยิงคิวรี คืน ok:true days ว่าง
 * @param {string}   p.from  'YYYY-MM-DD'
 * @param {string}   p.to    'YYYY-MM-DD'
 * @returns `{ ok, days: Set<string>|null, error }` — `days` มีทั้งคีย์ `วันที่` และ `วันที่|กะ`
 *          ⇒ ผู้เรียกถามได้ทั้ง 2 ระดับโดยไม่ต้องโหลดซ้ำ
 */
export async function loadRunDays({ lineNames = [], from, to } = {}) {
  const names = [...new Set((lineNames || []).filter(Boolean))];
  if (!names.length || !from || !to) return { ok: true, days: new Set(), error: null };

  const { data, error } = await supabaseDR.from('production_sessions')
    .select('work_date, shift, line_name')
    .in('line_name', names)
    .in('status', SESSION_STATUSES_REAL)
    .gte('work_date', from).lte('work_date', to);

  // 🔴 ล้ม = "ไม่รู้" ไม่ใช่ "ไม่ได้ผลิต" — คืน null ให้ผู้เรียกวาด ❔ แล้วเขียนบนจอ
  if (error) return { ok: false, days: null, error };

  const days = new Set();
  for (const r of data || []) {
    if (!r?.work_date) continue;
    days.add(runKey(r.work_date));
    if (r.shift) days.add(runKey(r.work_date, r.shift));
  }
  return { ok: true, days, error: null };
}
