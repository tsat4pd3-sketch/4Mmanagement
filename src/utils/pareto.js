/* ═══ สูตรกลางของกราฟพาเรโต (Pareto) — pure + มีเทส ═══════════════════════════════════
   (แยกออกจาก `components/ParetoAbcChart.jsx` เมื่อ 2026-09-15 เพื่อให้เทสได้จริง —
    ตัวรันเทสรับเฉพาะ .mjs/.js · สูตรที่ฝังใน .jsx ไม่เคยถูกเทสเลย)

   ── Pareto chart ที่ถูกต้องตามสากล (ASQ · Juran · IATF core tools) ต้องมีครบ 4 อย่าง ──
     1. แท่งเรียงจากมากไปน้อย                        ← มีอยู่แล้ว
     2. **เส้นสะสม % (cumulative line)** ไต่ตามแท่ง   ← `_cum` / `_cumPrev` ในไฟล์นี้
     3. **เส้น 80% cut-off** แยก vital few ออกจาก trivial many
     4. **แกน % กำกับ** ให้อ่านเส้นสะสมออกโดยไม่ต้อง hover (จอ TV ไม่มี hover)
   เดิมโค้ดคำนวณ `_cum` ไว้แล้วแต่ **โชว์แค่ใน tooltip/ตาราง ไม่เคยวาดลงกราฟ**
   ⇒ สิ่งที่เรียกว่า "พาเรโต" ทั้งระบบเป็นแค่ *ranked bar chart* (feedback user 2026-09-15)

   ⚠️ แกนของกราฟแท่งนอนมี **2 สเกล** (เหมือน Pareto แท่งตั้งที่มีแกนซ้าย/ขวา):
      · ความยาวแท่ง = ค่า ÷ ค่าสูงสุด  (เทียบรายการต่อรายการได้ถนัด)
      · เส้นสะสม    = % ของยอดรวม 0–100 บนความกว้างรางเดียวกัน
      ⇒ **ต้องมีแกน % กำกับเสมอ** ไม่งั้นคนอ่านจะนึกว่าเส้นกับแท่งใช้สเกลเดียวกัน   */

/** จัดกลุ่ม ABC + คำนวณ % และ % สะสม จากรายการที่ยังไม่เรียง
 *  คืนรายการที่ "เรียงมาก→น้อยแล้ว" พร้อมฟิลด์:
 *    `_val` ค่า · `_pct` % ของยอดรวม · `_cumPrev` % สะสมก่อนถึงรายการนี้ · `_cum` % สะสมถึงรายการนี้
 *    `_cls` กลุ่ม ABC — A = สะสมถึง 80% แรก · B = 80–95% · C = 5% สุดท้าย
 *  รายการแรกเป็น A เสมอ (กันเคสรายการเดียวกินเกิน 80% แล้วกลายเป็นไม่มีกลุ่ม A) */
export function classifyAbc(items, valueOf) {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const total = sorted.reduce((s, d) => s + (valueOf(d) || 0), 0);
  let run = 0;
  return sorted.map((d, i) => {
    const v = valueOf(d) || 0;
    const cumPrev = total > 0 ? (run / total) * 100 : 0;
    run += v;
    return {
      ...d,
      _val: v,
      _pct: total > 0 ? (v / total) * 100 : 0,
      _cumPrev: cumPrev,
      _cum: total > 0 ? (run / total) * 100 : 0,
      _cls: i === 0 || cumPrev < 80 ? 'A' : cumPrev < 95 ? 'B' : 'C',
    };
  });
}

/** ขีดแกน % สะสม — คงที่ทุกกราฟ เพื่อให้คนอ่านเทียบข้ามกราฟได้โดยไม่ต้องอ่านเลขใหม่ทุกครั้ง */
export const PARETO_TICKS = Object.freeze([0, 25, 50, 75, 100]);

/** เส้น cut-off มาตรฐานของ Pareto (กฎ 80/20) */
export const PARETO_CUTOFF = 80;

/** รายการสุดท้ายที่ยังอยู่ใน 80% แรก — ใช้ลากเส้น cut-off ให้ตรงรอยต่อ A→B
 *  คืน index (-1 = ไม่มีรายการเลย) */
export function cutoffIndex(rows, cutoff = PARETO_CUTOFF) {
  if (!rows?.length) return -1;
  const i = rows.findIndex(r => r._cum >= cutoff);
  return i === -1 ? rows.length - 1 : i;
}

/** สัดส่วนที่ "บอกอะไรไม่ได้" ในชุดข้อมูล (อื่นๆ / ไม่ระบุ / ว่าง)
 *  พาเรโตที่ 90% เป็นถังขยะ = ชี้เป้าไม่ได้ ต่อให้วาดสวยแค่ไหน ⇒ ต้องเตือนบนจอ
 *  (เคสจริง 2026-09-15: KPI ใบซ่อม MTN มี "ไม่ระบุกลุ่ม" 224 + "อื่นๆ" 89 จาก 319 ใบ = 98%) */
const VAGUE_RE = /^\s*$|อื่น\s*ๆ?|ไม่ระบุ|ไม่ทราบ|^n\/?a$|^-+$|^other?s?$|^etc\.?$|^unknown$/i;
export const isVagueLabel = (name) => VAGUE_RE.test(String(name ?? '').trim());

/** @returns {{ vagueVal:number, total:number, pct:number, names:string[] }} */
export function vagueShare(rows) {
  const total = (rows || []).reduce((s, r) => s + (r._val || 0), 0);
  const vague = (rows || []).filter(r => isVagueLabel(r.name));
  const vagueVal = vague.reduce((s, r) => s + (r._val || 0), 0);
  return {
    vagueVal,
    total,
    pct: total > 0 ? (vagueVal / total) * 100 : 0,
    names: vague.map(r => r.name),
  };
}
