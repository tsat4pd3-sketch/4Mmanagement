/* ═══ qaFmeForecast — คาดการณ์ "อีกกี่โมงต้องไปตรวจชิ้นสุดท้าย" สำหรับบอร์ดไทม์ไลน์ QA ═══
   (2026-08-31 · ต่อยอดคำขอ user "งาน daily ที่จะต้องไปตรวจไลน์ไหน ใช้คอนเซปต์ timeline
    heijunka board เหมือนสโตร์ได้มั้ย")

   ⚠️ กฎเหล็กของไฟล์นี้ — **แยก "ข้อเท็จจริง" ออกจาก "คาดการณ์" ให้ขาด**
   งานตรวจที่อยู่ในตาราง `qa_fme_obligations` = ข้อเท็จจริง (ระบบเห็นว่าผลิตเปลี่ยนรุ่น/เปลี่ยนกะจริง)
   ส่วนไฟล์นี้ตอบคนละคำถาม: "รุ่นที่กำลังวิ่งอยู่ จะจบเมื่อไหร่" ซึ่งเป็น **การเดาจาก CT**
   → จอต้องวาดคนละแบบ (เส้นประ/จาง + ป้ายกำกับ) **ห้ามวาดปนกันจนดูเหมือนของแน่นอน**

   ⚠️ ไม่มี CT = **ไม่คาดการณ์เลย** ห้ามเดาเวลาให้ (คืน noCt แล้วให้จอรายงานเป็นข้อความ)
       — หลักเดียวกับ computeLiveOee ที่คืน null + noCt แทนจะแปลงเป็น 0

   ⚠️ ไม่คาดการณ์ Middle โดยตั้งใจ — คาบตรวจกลางคิดจาก lot size ซึ่งเป็นกติกาที่อยู่ใน
       edge function `qa-fme-scan` แล้ว · ทำซ้ำฝั่ง client = drift รออยู่ (บทเรียน SSOT 2026-08-19)
       ไฟล์นี้จึงคาดการณ์เฉพาะ **End (ชิ้นสุดท้าย)** ซึ่ง edge ไม่ได้คำนวณเวลาไว้ = ไม่ทับกัน
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { pairAwareTotal, collapseOps } from './pairTotals';

/** เดินเวลาไปข้างหน้า `workMin` นาที "ที่ทำงานจริง" โดยข้ามช่วงพัก
 *  ทำงานบนกรอบนาทีของวันงาน (08:00 = 480) เหมือน InternalTimeBoard
 *  breaks = [{ s, e }] จาก breaksToFrame (utils/timeFrame) */
export function addWorkMinutes(startMin, workMin, breaks = []) {
  let cur = startMin;
  let left = Math.max(0, workMin);
  const rest = [...breaks].filter(b => b.e > startMin).sort((a, b) => a.s - b.s);
  for (const b of rest) {
    if (left <= 0) break;
    const gap = b.s - cur;                 // เวลาทำงานที่ใช้ได้ก่อนถึงเบรคนี้
    if (gap >= left) return cur + left;
    if (gap > 0) { left -= gap; }
    cur = Math.max(cur, b.e);              // อยู่ในเบรค/ถึงเบรค → กระโดดข้ามไปท้ายเบรค
  }
  return cur + left;
}

/** ยุบ "รุ่นที่กำลังวิ่ง" จากใบงานที่ยังเปิดอยู่ → 1 แถวต่อ 1 รุ่นจริง
 *  ยุบ 2 ชั้นตามกติกาโปรเจค: รายการขั้นตอน (OP) → พาร์ทจริง แล้วค่อยจับคู่ RH/LH
 *  (ลำดับนี้ห้ามสลับ — ตรงกับ canon() ใน edge qa-fme-scan และกฎ collapseOps ใน pairTotals)
 *
 *  @param orders ใบงานที่ยังเปิด [{ line_name, shift, mat_no, qty, qty_target, qty_actual, opened_at }]
 *  @param opMap  จาก opInfoSync() (utils/opItems)
 *  @param pairOf (mat) => pair_mat_no | null
 *  @returns [{ lineName, shift, matNo, mats[], target, produced, remaining, startMin }] */
export function modelRuns({ orders = [], opMap = null, pairOf = () => null, toMin = () => null }) {
  const buckets = new Map();
  orders.forEach(o => {
    if (!o.line_name || o.mat_no == null) return;
    const k = `${o.line_name}|${o.shift || ''}`;
    if (!buckets.has(k)) buckets.set(k, { lineName: o.line_name, shift: o.shift || '', per: new Map() });
    const b = buckets.get(k);
    const r = b.per.get(o.mat_no) || { mat_no: o.mat_no, target: 0, produced: 0, startMin: null };
    r.target += Number(o.qty_target ?? o.qty) || 0;
    r.produced += Number(o.qty_actual) || 0;      // ใบยังเปิด = ยอดสะสมที่กรอกไว้ (ยังไม่ปิด)
    const m = toMin(o.opened_at);
    if (m != null && (r.startMin == null || m < r.startMin)) r.startMin = m;
    b.per.set(o.mat_no, r);
  });

  const out = [];
  buckets.forEach(b => {
    const rows = [...b.per.values()];
    // ชั้น 1: ยุบ OP เข้าพาร์ทจริง (ใช้ helper กลาง ห้ามเขียนกฎซ้ำ)
    const startOf = (mat) => {
      const own = b.per.get(mat)?.startMin ?? null;
      let best = own;
      rows.forEach(r => {
        if (opMap?.[r.mat_no]?.parent === mat && r.startMin != null && (best == null || r.startMin < best)) best = r.startMin;
      });
      return best;
    };
    const matsOf = (mat) => [mat, ...rows.map(r => r.mat_no).filter(m => opMap?.[m]?.parent === mat)]
      .filter((m, i, a) => a.indexOf(m) === i);
    const plain = rows.map(r => ({ mat_no: r.mat_no, target: r.target, produced: r.produced }));
    const collapsed = (opMap && Object.keys(opMap).length) ? collapseOps(plain, opMap) : plain;

    // ชั้น 2: จับคู่ RH/LH — 1 stroke = 1 คู่ (ใช้ pairAwareTotal กับคู่ทีละคู่ ไม่เขียน max เอง)
    const byMat = new Map(collapsed.map(r => [r.mat_no, r]));
    const seen = new Set();
    collapsed.forEach(r => {
      if (seen.has(r.mat_no)) return;
      const pm = pairOf(r.mat_no);
      const partner = pm && byMat.get(pm) ? byMat.get(pm) : null;
      const members = partner ? [r, partner] : [r];
      members.forEach(x => seen.add(x.mat_no));
      const tot = pairAwareTotal(members, pairOf);
      // ตัวแทนกลุ่ม = mat ที่เรียงน้อยกว่า (กติกาเดียวกับ canon() ใน edge — คิวจะได้ชี้รุ่นเดียวกัน)
      const canonMat = members.map(x => x.mat_no).sort()[0];
      const mats = members.flatMap(x => matsOf(x.mat_no));
      const starts = mats.map(startOf).filter(v => v != null);
      out.push({
        lineName: b.lineName, shift: b.shift, matNo: canonMat, mats,
        target: tot.target, produced: tot.produced,
        remaining: Math.max(0, tot.target - tot.produced),
        startMin: starts.length ? Math.min(...starts) : null,
      });
    });
  });
  return out;
}

/** คาดการณ์เวลาที่รุ่นนี้จะผลิตครบ = เวลาที่ต้องไปตรวจ "ชิ้นสุดท้าย"
 *  คืน `ct` ที่ใช้จริงมาด้วย เพื่อให้จอแสดงตัวเลขเดียวกับที่คำนวณ (ห้ามให้จอไปหา CT เองซ้ำ = drift)
 *  @returns { etaMin, ct } | { noCt: true } | null (ผลิตครบแล้ว/ไม่มีอะไรให้คาด) */
export function forecastEnd(run, { ctOf, nowMin, breaks = [] }) {
  if (!run || run.remaining <= 0 || nowMin == null) return null;
  // CT ของรุ่น: ลองตัวแทนกลุ่มก่อน แล้วค่อยไล่สมาชิก (คู่ RH/LH CT เท่ากัน · OP ใช้ของขั้นที่ตั้งไว้)
  let ct = 0;
  for (const m of [run.matNo, ...(run.mats || [])]) {
    const v = Number(ctOf(m)) || 0;
    if (v > 0) { ct = v; break; }
  }
  if (!ct) return { noCt: true };          // ⚠️ ไม่รู้ CT = ไม่เดาเวลา
  return { etaMin: addWorkMinutes(nowMin, (run.remaining * ct) / 60, breaks), ct };
}
