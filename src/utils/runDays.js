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
 * @returns `{ ok, days: Set<string>|null, byKey: Map<string,Set<string>>|null, error }` — `days` มีทั้งคีย์ `วันที่` และ `วันที่|กะ`
 *          · `byKey` = คีย์เดียวกัน → ชื่อไลน์ที่เปิดกะ (ไล่ครอบครัวไลน์ต่อเองได้)
 *          ⇒ ผู้เรียกถามได้ทั้ง 2 ระดับโดยไม่ต้องโหลดซ้ำ
 */
export async function loadRunDays({ lineNames = [], from, to } = {}) {
  const names = [...new Set((lineNames || []).filter(Boolean))];
  if (!names.length || !from || !to) return { ok: true, days: new Set(), byKey: new Map(), error: null };

  /* 🔴 แบ่งหน้า (2026-11-03) — รายงาน AM รายเดือนถามหลายไลน์พร้อมกัน: 10+ ไลน์ × 2 กะ × 31 วัน
     เกินเพดาน 1000 แถว/คิวรีได้ ⇒ แถวที่เกินหายเงียบ = วันนั้นกลายเป็น "ไม่ได้ผลิต" (กลบวันขาดตรวจ)
     `order` คงที่คู่กับ `range` เสมอ (CLAUDE.md กฎเขียน DB ข้อ 5) */
  const PAGE = 1000;
  const data = [];
  for (let p = 0; p < 50; p++) {
    const { data: page, error } = await supabaseDR.from('production_sessions')
      .select('id, work_date, shift, line_name')
      .in('line_name', names)
      .in('status', SESSION_STATUSES_REAL)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date').order('id')
      .range(p * PAGE, (p + 1) * PAGE - 1);
    // 🔴 ล้ม = "ไม่รู้" ไม่ใช่ "ไม่ได้ผลิต" — คืน null ให้ผู้เรียกวาด ❔ แล้วเขียนบนจอ
    if (error) return { ok: false, days: null, byKey: null, error };
    data.push(...(page || []));
    if (!page || page.length < PAGE) break;
  }

  const days = new Set();
  // คีย์ → ชื่อไลน์ที่เปิดกะจริง (ผู้เรียกที่ต้องไล่ไลน์แม่-ลูกเองใช้ตัวนี้ · additive 03/11)
  const byKey = new Map();
  const put = (k, n) => { if (!byKey.has(k)) byKey.set(k, new Set()); if (n) byKey.get(k).add(n); };
  for (const r of data) {
    if (!r?.work_date) continue;
    days.add(runKey(r.work_date));
    put(runKey(r.work_date), r.line_name);
    if (r.shift) { days.add(runKey(r.work_date, r.shift)); put(runKey(r.work_date, r.shift), r.line_name); }
  }
  return { ok: true, days, byKey, error: null };
}
