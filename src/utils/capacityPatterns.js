/* ─── 📊 เพดานกำลังผลิตตาม "รูปแบบกะ" — ภาษาเดียวกับสไลด์ Capacity ของโรงงาน ──────
   ฟังก์ชันล้วน (pure) ไม่แตะ DB/React — ใช้โดย src/components/CapacityBoard.jsx
   (แท็บ 📊 Capacity ใน /production-plan · 2026-09-24)

   ที่มา: user ส่งไฟล์ `Capacity_TSATP.4_update_June_26.pptx` มาพร้อมภาพหน้า
   /production-plan แล้วบอกว่า *"capacity โรงงานเราดูกันแบบนี้ แต่ในโปรแกรมเราเป็นแบบนี้
   คนจะดูไม่เข้าใจ"* ⇒ จอต้องพูดภาษาเดียวกับสไลด์ ไม่ใช่ภาษาของโปรแกรม

   ────────────────────────────────────────────────────────────────────────────────
   🔤 คำศัพท์ (ถอดจากสไลด์ — ห้ามเปลี่ยนชื่อโดยไม่ถาม user)
   | สไลด์         | ความหมาย                                        |
   |---------------|------------------------------------------------|
   | `2 shift`     | **เพดานชั่วโมง**ของเดือนนั้นที่รูปแบบ 2 กะ = วันทำงาน × 15.5 ชม. |
   | `ActWorkload` | ภาระงานจริง = Σ (จำนวนชิ้น × CT) เป็นชั่วโมง — **ยังไม่คิด OEE** |
   | `RworkOEE`    | ชั่วโมงที่ต้องใช้จริงเมื่อคิด OEE = `ActWorkload ÷ OEE` |
   | `Cap OEE Act` | เพดานหลังคิด OEE = `เพดานชั่วโมง × OEE` |
   | `Diff OT OEE` | เหลือ/ขาด = `Cap OEE Act − ActWorkload` (บวก = เหลือ · ลบ = ต้องเพิ่มกะ) |

   ────────────────────────────────────────────────────────────────────────────────
   🔴 กฎเหล็ก 1 — **1 กะของโรงงาน = 7.75 ชม. (465 นาที) ไม่ใช่ 490 นาทีแบบ `capacityModel.js`**
   ถอดจากสไลด์: ทุกไลน์ `2 shift` = วันทำงาน × 15.5 ชม. ⇒ 1 กะ = 7.75 ชม.
   แต่ฝั่งโปรแกรม `netShiftMin(570, 80) = 490` (08:00–17:30 หักพัก 80 นาที)
   **ต่างกัน 25 นาที/กะ ≈ 5%** — ตั้งใจให้ต่างได้ เพราะคนละนิยาม:
     · 490 = เวลาที่ "เดินเครื่องได้" ใช้คิดว่ากะนี้ทำได้กี่ชิ้น (แผนรายวัน)
     · 465 = เวลาที่ฝ่ายวางแผนใช้คิดเพดานรายเดือน (ตัดเวลาเตรียม/ส่งงานออกอีกชั้น)
   ⇒ **ห้ามไปแก้ `DEFAULT_SHIFT_MIN` ให้เท่ากัน** จะทำให้แผนรายวันเพี้ยนทั้งระบบ
   ⇒ ตัวเลขนี้แก้ได้จากทะเบียน (`capacity_shift_patterns`) ไม่ต้องแก้โค้ด

   🔴 กฎเหล็ก 2 — **เพดานต่างกันที่ "จำนวนวัน" ด้วย ไม่ใช่แค่ชั่วโมง/วัน**
   `+Sat` = เอาวันเสาร์มานับเป็นวันทำงานเพิ่ม · `Max` = ทุกวันในเดือน
   ⇒ รูปแบบกะต้องมี `day_source` (`working` / `working_sat` / `all`) คู่กับ `hours_per_day`
   เขียนเป็น `hours × days` เฉยๆ = เพดาน +Sat/Max ผิดทุกเดือน

   🔴 กฎเหล็ก 3 — **ชิ้น ≠ shot** ภาระงานของคู่ RH/LH ต้องยุบผ่าน `pairLoadTotal()`
   (กฎเหล็กข้าม session ใน CLAUDE.md) — บวก qty×CT ทั้งสองข้าง = ภาระ 2 เท่า
   ──────────────────────────────────────────────────────────────────────────── */

/** ค่าเริ่มต้นที่ถอดจากสไลด์ Capacity_TSATP.4_update_June_26.pptx (มิ.ย. 2026)
 *  = แถว seed ของตาราง `capacity_shift_patterns` (DR) · ใช้เป็น fallback เมื่อโหลดทะเบียนไม่ได้
 *  🔴 ห้าม hardcode ตัวเลขพวกนี้ซ้ำในหน้า — อ่านจากทะเบียนเสมอ แล้วถอยมาที่นี่เมื่อโหลดไม่ได้ */
export const SEED_PATTERNS = [
  { key: '1s',      label: '1 กะ',            hours_per_day: 7.75,  day_source: 'working',     sort_order: 1, color: '#22c55e' },
  { key: '1s_ot',   label: '1 กะ + OT',       hours_per_day: 9.75,  day_source: 'working',     sort_order: 2, color: '#84cc16' },
  { key: '2s',      label: '2 กะ',            hours_per_day: 15.5,  day_source: 'working',     sort_order: 3, color: '#f59e0b' },
  { key: '2s_ot1',  label: '2 กะ + OT 1 กะ',  hours_per_day: 17.5,  day_source: 'working',     sort_order: 4, color: '#fb923c' },
  { key: '2s_ot2',  label: '2 กะ + OT 2 กะ',  hours_per_day: 19.5,  day_source: 'working',     sort_order: 5, color: '#ef4444' },
  { key: '2s_sat',  label: '+ ทำเสาร์',        hours_per_day: 19.5,  day_source: 'working_sat', sort_order: 6, color: '#a855f7' },
  { key: 'max',     label: 'Max (เต็มที่)',    hours_per_day: 24,    day_source: 'all',         sort_order: 7, color: '#64748b' },
];

export const DAY_SOURCE_LABEL = {
  working:     'วันทำงาน',
  working_sat: 'วันทำงาน + เสาร์',
  all:         'ทุกวันในเดือน',
};

/** นับวันของเดือนแยกตามนิยาม 3 แบบ — อ้างปฏิทินบริษัทก่อนเสมอ (กฎ CLAUDE.md ห้ามใช้ค่าคงที่ 22/26)
 *  @param {string} mk      'YYYY-MM'
 *  @param {Object} calMap  date 'YYYY-MM-DD' → day_type
 *  @returns {{ working:number, working_sat:number, all:number }}
 *    working     = จ-ศ ที่ไม่ถูกมาร์คเป็นวันหยุด + เสาร์/อาทิตย์ที่มาร์ค working
 *    working_sat = working + เสาร์ที่ยังไม่ถูกนับ (และไม่ได้มาร์คเป็นวันหยุดชนิดอื่น)
 *    all         = ทุกวันในเดือน
 */
export function monthDayCounts(mk, calMap = {}) {
  const [yy, mm] = String(mk).split('-').map(Number);
  if (!yy || !mm) return { working: 0, working_sat: 0, all: 0 };
  const nDays = new Date(yy, mm, 0).getDate();
  let working = 0, sat = 0;
  for (let d = 1; d <= nDays; d++) {
    const key = `${mk}-${String(d).padStart(2, '0')}`;
    const t = calMap[key];
    const dow = new Date(yy, mm - 1, d).getDay();
    const isWorking = t ? t === 'working' : (dow >= 1 && dow <= 5);
    if (isWorking) { working++; continue; }
    // เสาร์ที่ไม่ได้ถูกนับเป็นวันทำงานอยู่แล้ว = โควตาที่ "เรียกมาทำเพิ่มได้"
    // ⚠️ เสาร์ที่ถูกมาร์คเป็นวันหยุดยาว/ชัตดาวน์ ก็ยังเรียกมาทำ OT ได้ตามจริง จึงนับให้
    if (dow === 6) sat++;
  }
  return { working, working_sat: working + sat, all: nDays };
}

/** เพดานชั่วโมงของรูปแบบกะหนึ่ง ในเดือนหนึ่ง */
export function patternHours(pattern, dayCounts) {
  const h = Number(pattern?.hours_per_day) || 0;
  const days = Number(dayCounts?.[pattern?.day_source ?? 'working']) || 0;
  return h * days;
}

/** แถวสรุปต่อเดือน — ศัพท์ตรงกับสไลด์ทุกช่อง
 *  @param {number} a.workloadHr  ActWorkload (ชม.) — ยุบคู่ RH/LH มาแล้ว
 *  @param {number} a.oee         OEE ที่ใช้ตัดสิน (0-1)
 *  @param {Array}  a.patterns    รูปแบบกะเรียงจากน้อยไปมาก
 *  @param {Object} a.dayCounts   ผลจาก monthDayCounts()
 *  @param {string} [a.basePattern='2s'] รูปแบบที่ใช้เป็นคอลัมน์หลักของตาราง (เหมือนสไลด์ที่โชว์ `2 shift`)
 */
export function capacityRow({ workloadHr, oee, patterns, dayCounts, basePattern = '2s' }) {
  const list = [...(patterns || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const ceilings = list.map(p => ({ ...p, hours: patternHours(p, dayCounts) }));
  const base = ceilings.find(p => p.key === basePattern) || ceilings[0] || null;
  const o = Number(oee) > 0 ? Number(oee) : null;
  const work = Number(workloadHr) || 0;
  const baseHr = base?.hours || 0;
  return {
    ceilings,
    base,
    baseHours: baseHr,                                  // `2 shift`
    workloadHr: work,                                   // `ActWorkload`
    rworkOee:  o ? work / o : null,                     // `RworkOEE`
    capOeeAct: o ? baseHr * o : null,                   // `Cap OEE Act`
    diffOtOee: o ? baseHr * o - work : null,            // `Diff OT OEE`
    // รูปแบบกะที่ "เล็กที่สุดที่ยังรับภาระไหว" เมื่อคิด OEE แล้ว — null = ไม่มีรูปแบบไหนพอ
    fitPattern: o ? (ceilings.find(p => p.hours * o >= work) || null) : null,
  };
}

/** OEE ที่ใช้ตัดสิน — คืนทั้ง 2 เส้นเสมอ (คำสั่ง user: "โชว์ทั้งสองเส้นให้เทียบ")
 *  @param {number|null} actual  median OEE 60 วันของไลน์ (0-1)
 *  @param {Object|null} target  แถว oee_targets ของกรุ๊ป { target_a, target_p, target_q }
 *  🔴 เป้า OEE ห้ามตั้งเอง คำนวณจาก A×P×Q เสมอ (กฎเหล็ก CLAUDE.md) · ค่ามาตรฐาน 90/90/99
 */
export const DEFAULT_APQ = { a: 90, p: 90, q: 99 };
export function oeePair(actual, target) {
  const a = (Number(target?.target_a) || DEFAULT_APQ.a) / 100;
  const p = (Number(target?.target_p) || DEFAULT_APQ.p) / 100;
  const q = (Number(target?.target_q) || DEFAULT_APQ.q) / 100;
  const act = Number(actual) > 0 ? Number(actual) : null;
  return { actual: act, target: a * p * q, hasActual: act != null };
}
