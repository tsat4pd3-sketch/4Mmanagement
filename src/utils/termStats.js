/* ═══ 📐 คำไหน "ชี้หมวดได้จริง" — สถิติ ไม่ใช่สัดส่วนดิบ ═══════════ 2026-09-24

   ที่มา: รอบ downtime (23/09) ตัวเดาหมวดจากคำ **เดาผิดประมาณครึ่งหนึ่ง** เพราะกติกาเดิม
   คือ "คำนี้อยู่ในกลุ่มเดียวเกิน 80% ⇒ เชื่อ" ซึ่ง**ไม่สนใจว่าเห็นมากี่ใบ**:

     คำ         เจอ  อยู่กลุ่มเดียว   กติกาเดิม   ความจริง
     conveyor   125       88%         ✅ เชื่อ    ✅ ถูก
     ข้าง         2      100%         ✅ เชื่อ    ❌ บังเอิญล้วน (2 ใบ)
     line        14      100%         ✅ เชื่อ    ❌ คำโหล ไปโดน "Improved line" 990 นาที

   100% จาก 2 ใบ กับ 88% จาก 125 ใบ **ไม่ใช่หลักฐานระดับเดียวกัน** แต่กติกาเดิมมองเท่ากัน

   ── ทฤษฎีที่เอามาใช้ ──
   **Log-odds ratio with informative Dirichlet prior** (Monroe, Colaresi & Quinn 2008,
   "Fightin' Words: Lexical Feature Selection… for Political Text", Political Analysis 16(4))
   = วิธีมาตรฐานทาง computational linguistics สำหรับถามว่า "คำไหนเป็นเอกลักษณ์ของกลุ่ม A
   เทียบกับส่วนที่เหลือ" ออกแบบมาแก้ปัญหานี้ตรงๆ: คำที่เจอน้อยจะมี**ความแปรปรวนสูง**
   ⇒ หารด้วย σ แล้วได้ z-score ที่เทียบข้ามคำที่ความถี่ต่างกันมากได้
   prior = ความถี่ของคำนั้นในคลังทั้งหมด (informative) ⇒ คำโหลต้องมีหลักฐานมากกว่าจะชนะ

   ผลกับข้อมูลจริง (ดู `docs/modules/mtn-problem-analysis.md` §รอบ 4)

   ⚠️ pure — ห้าม import supabase                                                  */

/**
 * z-score ของ log-odds ratio (informative Dirichlet prior)
 * @param {number} yi  จำนวนครั้งที่คำนี้อยู่ในกลุ่มที่สนใจ
 * @param {number} y   จำนวนครั้งที่คำนี้อยู่ทั้งคลัง (ทุกกลุ่ม)
 * @param {number} ni  ขนาดกลุ่มที่สนใจ (จำนวน token ทั้งหมดของกลุ่ม)
 * @param {number} n   ขนาดคลังทั้งหมด
 * @param {number} a0  ความแรงของ prior (มาก = ต้องการหลักฐานมากขึ้น)
 * @returns {number} z — ยิ่งบวกมาก ยิ่งเป็นเอกลักษณ์ของกลุ่มนี้ · ~1.96 = 95%
 */
export function logOddsZ(yi, y, ni, n, a0 = 50) {
  if (!(n > 0) || !(ni > 0) || !(y > 0)) return 0;
  const aw = a0 * (y / n);                 // prior ของคำนี้ = ความถี่ในคลัง × ความแรง
  const yj = y - yi;                       // นอกกลุ่ม
  const nj = n - ni;
  const num_i = yi + aw, den_i = ni + a0 - yi - aw;
  const num_j = yj + aw, den_j = nj + a0 - yj - aw;
  if (num_i <= 0 || den_i <= 0 || num_j <= 0 || den_j <= 0) return 0;
  const delta = Math.log(num_i / den_i) - Math.log(num_j / den_j);
  const varr = 1 / num_i + 1 / num_j;      // ประมาณความแปรปรวนตามสูตรในเปเปอร์
  return delta / Math.sqrt(varr);
}

/**
 * ตัดสินคำทั้งชุด: คำไหนเชื่อได้ว่าชี้กลุ่มไหน
 * @param {Map<string, Map<string, number>>|Array} counts  term → (group → จำนวน)
 * @param {object} opt  { zMin = 1.96, a0 = 50, minCount = 3 }
 *   · minCount = **พื้นขั้นต่ำ** ที่ต้องมีคู่กับสถิติ เพราะ z เทียบกับ "คลังที่มีอยู่":
 *     ถ้ากลุ่มยังมีคำน้อยมาก (โรงงานเพิ่งเริ่มใช้ / กรองแคบ) คำที่เจอ 2 ครั้งอาจได้ z ผ่าน
 *     ได้เพราะคลังเล็ก ไม่ใช่เพราะมันชี้กลุ่มจริง — วัดจริงตอนเขียนเทส: คลัง 127 token
 *     "ข้าง" (2 ครั้ง) ได้ z = 1.98 ผ่านฉิวเฉียด ทั้งที่ในคลังจริง 40,000 token ได้แค่ 0.46
 * @returns {Map<string, {group, z, n}>}  เฉพาะคำที่ผ่านเกณฑ์
 */
export function pickDiscriminative(counts, { zMin = 1.96, a0 = 50, minCount = 3 } = {}) {
  const entries = counts instanceof Map ? [...counts.entries()] : counts;
  // ขนาดของแต่ละกลุ่ม + ขนาดคลัง (นับเป็น "จำนวนครั้งที่คำปรากฏ" ไม่ใช่จำนวนเอกสาร)
  const groupN = new Map();
  let n = 0;
  for (const [, byGroup] of entries) {
    for (const [g, c] of (byGroup instanceof Map ? byGroup : new Map(Object.entries(byGroup)))) {
      groupN.set(g, (groupN.get(g) || 0) + c);
      n += c;
    }
  }
  const out = new Map();
  for (const [term, byGroupRaw] of entries) {
    const byGroup = byGroupRaw instanceof Map ? byGroupRaw : new Map(Object.entries(byGroupRaw));
    let y = 0;
    for (const c of byGroup.values()) y += c;
    let best = null;
    for (const [g, yi] of byGroup) {
      const z = logOddsZ(yi, y, groupN.get(g) || 0, n, a0);
      if (!best || z > best.z) best = { group: g, z, n: yi };
    }
    if (best && best.z >= zMin && best.n >= minCount) out.set(term, best);
  }
  return out;
}
