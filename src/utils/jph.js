/* ─── ⏱️ JPH — ชิ้นต่อชั่วโมง: มาตรฐาน vs ของจริง ──────────────────────────────
   ฟังก์ชันล้วน (pure) ใช้โดยแท็บ 📊 Capacity ใน /production-plan (2026-09-25 · คำขอ user)
   *"ขอ JPH standard เทียบกับ job per hour ปัจจุบันจากการคำนวนกับข้อมูล OEE"*

   3 ตัวเลขที่จอต้องแยกให้ชัด — ห้ามเอาไปปนกัน:
   | ตัว | สูตร | ความหมาย |
   |---|---|---|
   | `std`      | `3600 ÷ CT` | เพดานทฤษฎี — เครื่องเดินไม่หยุด ไม่มีของเสีย |
   | `expected` | `std × OEE` | ที่ "ควรได้" เมื่อคิดความสูญเสียตาม OEE ที่วัดได้ |
   | `actual`   | `ยอดผลิตจริงต่อกะ ÷ ชม.ทำงานสุทธิ` | ที่ได้จริงจากใบผลิตที่ปิดแล้ว |

   ────────────────────────────────────────────────────────────────────────────────
   🔴 กฎเหล็ก 1 — **`actual` ต้องมาจากใบผลิตจริงเท่านั้น (`method === 'actual'`)**
   `estimateCapacity()` (`capacityModel.js`) มี fallback: ถ้าใบปิดน้อยกว่า 3 กะ มันคืน
   `perShift` ที่คำนวณจาก **CT × OEE** แล้วตั้ง `method='ct'`
   ⇒ ถ้าเอาค่านั้นมาเป็น `actual` แล้วเทียบกับ `expected` (= std × OEE) **มันคือตัวเลขเดียวกัน**
   จอจะขึ้น "ตรงเป๊ะ 100%" ทุกพาร์ทที่ไม่มีข้อมูล = **เทียบตัวเองกับตัวเอง** (จอโกหกแบบที่ดูไม่ออก)
   ⇒ `method='ct'` ต้องคืน `actual = null` + เหตุผล `no_actual` เสมอ

   🔴 กฎเหล็ก 2 — **ชิ้น ≠ shot** (กฎข้าม session ใน CLAUDE.md)
   CT = เวลาต่อ **1 จังหวะ (shot)** · งานคู่ RH/LH ปั๊มทีเดียวได้ 2 ชิ้น (คนละ mat_no)
   ⇒ `std` ของ **พาร์ทนี้** = `3600 ÷ CT` เท่าเดิม (ชั่วโมงนั้นได้พาร์ทคู่อีก `3600 ÷ CT` ชิ้นด้วย)
   **ห้ามคูณ 2 ให้พาร์ทเดียว** — จะได้ JPH สูงเกินจริงเท่าตัว · จอต้องติดป้ายว่าเป็นงานคู่

   🔴 กฎเหล็ก 3 — **`actual > std` = CT master ผิด ไม่ใช่ไลน์เก่ง**
   ผลิตเร็วกว่าเพดานทฤษฎีเป็นไปไม่ได้ ⇒ ธง `ct_suspect` ให้ไปแก้ CT ที่ Product Master
   (เจอบ่อยเมื่อ CT ถูกกรอกเป็น "เวลาต่อชิ้นของงานคู่" แทนเวลาต่อ shot)

   🔴 กฎเหล็ก 4 — **`ratio` (actual ÷ std) ควรใกล้ OEE** ถ้าห่างกันมากคือมีอะไรผิด
   ทั้งสองตัววัด "ได้จริงกี่ % ของทฤษฎี" จากข้อมูลคนละชุด ⇒ เป็นการตรวจสอบกันเอง
   ห่างเกิน `GAP_ALERT` ⇒ ธง `mismatch` (CT ผิด / ฐานเวลา OEE ไม่ตรงกับเวลาที่ใช้หาร / ยอดผลิตไม่ครบ)
   ──────────────────────────────────────────────────────────────────────────── */

/** ห่างกันเกินกี่จุด (percentage point) ถึงเตือนว่า ratio กับ OEE ไม่สอดคล้อง */
export const GAP_ALERT = 0.20;

/** เพดานทฤษฎี — ชิ้นของพาร์ทนี้ต่อชั่วโมง (null = ไม่มี CT คิดไม่ได้) */
export function jphStandard(ctSec) {
  const ct = Number(ctSec) || 0;
  return ct > 0 ? 3600 / ct : null;
}

/** ของจริง — ยอดต่อกะ ÷ ชั่วโมงทำงานสุทธิต่อกะ */
export function jphActual(perShift, netMin) {
  const q = Number(perShift) || 0;
  const m = Number(netMin) || 0;
  if (!(q > 0) || !(m > 0)) return null;
  return q / (m / 60);
}

/** แถว JPH ของพาร์ทหนึ่ง
 *  @param {Object} a.est  ผลจาก estimateCapacity() — **ต้องมี `method`** (ดูกฎเหล็ก 1)
 *  @param {number} a.oee  OEE ที่ใช้ตัดสิน (0-1) · null = ไม่มี ⇒ expected เป็น null
 *  @returns {{std, actual, expected, ratio, flag, note, n, paired}}
 *    flag: ok · no_ct · no_actual · ct_suspect · mismatch
 */
export function jphRow({ ctSec, est, netMin, oee, paired = false }) {
  const std = jphStandard(ctSec);
  // 🔴 method='ct' = ค่าที่คำนวณจาก CT×OEE อยู่แล้ว ⇒ ไม่ใช่ของจริง ห้ามเอามาเทียบ
  const fromActual = est?.method === 'actual';
  const actual = fromActual ? jphActual(est?.perShift, netMin) : null;
  const o = Number(oee) > 0 ? Number(oee) : null;
  const expected = std != null && o != null ? std * o : null;
  const ratio = std != null && actual != null ? actual / std : null;

  let flag = 'ok', note = null;
  if (std == null) {
    flag = 'no_ct'; note = 'ไม่มี CT ในทะเบียน — คิด JPH มาตรฐานไม่ได้';
  } else if (actual == null) {
    flag = 'no_actual';
    note = est?.method === 'ct'
      ? `ใบปิดยังไม่ถึง 3 กะ — ตัวเลขกำลังผลิตที่มีคำนวณจาก CT×OEE อยู่แล้ว เอามาเทียบไม่ได้`
      : 'ยังไม่มีใบผลิตปิดของพาร์ทนี้';
  } else if (actual > std) {
    flag = 'ct_suspect';
    note = 'ผลิตเร็วกว่าเพดานทฤษฎี — CT ในทะเบียนน่าจะผิด (เช็คว่ากรอกเป็นเวลาต่อ shot ไม่ใช่ต่อชิ้น)';
  } else if (o != null && Math.abs(ratio - o) > GAP_ALERT) {
    flag = 'mismatch';
    note = `อัตราที่ทำได้ ${(ratio * 100).toFixed(0)}% ห่างจาก OEE ${(o * 100).toFixed(0)}% เกิน ${GAP_ALERT * 100} จุด — ตรวจ CT / ฐานเวลา / ความครบของยอดผลิต`;
  }
  return { std, actual, expected, ratio, flag, note, n: est?.n ?? 0, paired: !!paired };
}

/** ตาราง JPH ของทั้งไลน์ เรียง "ตัวที่น่าสงสัยขึ้นก่อน" แล้วค่อยเรียงตามยอด
 *  🔴 จอต้องโชว์แถวที่คิดไม่ได้ (no_ct / no_actual) ด้วย **ห้ามกรองทิ้ง**
 *     ไม่งั้นตารางจะดูสวยเพราะเหลือแต่ตัวที่ข้อมูลครบ (กฎความซื่อสัตย์ของจอ)
 */
const FLAG_RANK = { ct_suspect: 0, mismatch: 1, no_ct: 2, no_actual: 3, ok: 4 };
export function jphTable({ mats = [], ctOf, estOf, qtyOf, netMin, oee, pairOf, nameOf, customerOf }) {
  const rows = mats.map(mat => ({
    mat_no: mat,
    name: nameOf?.(mat) || '',
    customer: customerOf?.(mat) || null,
    qty: Number(qtyOf?.(mat)) || 0,
    ct: Number(ctOf?.(mat)) || 0,
    ...jphRow({ ctSec: ctOf?.(mat), est: estOf?.(mat), netMin, oee, paired: !!pairOf?.(mat) }),
  }));
  rows.sort((a, b) => (FLAG_RANK[a.flag] - FLAG_RANK[b.flag]) || (b.qty - a.qty)
                   || String(a.mat_no).localeCompare(String(b.mat_no)));
  return rows;
}

/** สรุปท้ายตาราง — จอต้องบอกว่าเทียบได้กี่พาร์ทจากทั้งหมด (ห้ามเงียบ) */
export function jphSummary(rows = []) {
  const n = rows.length;
  const comparable = rows.filter(r => r.flag === 'ok' || r.flag === 'mismatch');
  const wAvg = (pick) => {
    let num = 0, den = 0;
    comparable.forEach(r => { const v = pick(r); if (v != null && r.qty > 0) { num += v * r.qty; den += r.qty; } });
    return den > 0 ? num / den : null;
  };
  return {
    total: n,
    comparable: comparable.length,
    noCt: rows.filter(r => r.flag === 'no_ct').length,
    noActual: rows.filter(r => r.flag === 'no_actual').length,
    ctSuspect: rows.filter(r => r.flag === 'ct_suspect').length,
    mismatch: rows.filter(r => r.flag === 'mismatch').length,
    // ถ่วงน้ำหนักด้วยจำนวนชิ้น — พาร์ทที่ผลิตเยอะมีผลต่อกำลังไลน์มากกว่า
    avgStd: wAvg(r => r.std),
    avgActual: wAvg(r => r.actual),
    avgRatio: wAvg(r => r.ratio),
  };
}
