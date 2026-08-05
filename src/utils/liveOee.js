/*
  OEE สด (กะที่ยังเปิดอยู่) — สูตรย่อของ computeOEE ใน DailyReport
  ใช้เมื่อกะยังไม่ปิด จึงยังไม่มีค่า oee_a/oee_p/oee_q ที่ stamp ไว้ใน production_sessions
  (ปิดกะแล้วต้องใช้ค่าที่ stamp เสมอ — ห้ามคำนวณซ้ำด้วย master ปัจจุบัน ดู CLAUDE.md)

  A = เวลารันจริง ÷ เวลาที่ผ่านไปตั้งแต่เปิดกะ
  P = เวลามาตรฐานที่ผลิตได้ (Σ qty×CT) ÷ เวลารันจริง
  Q = ของดี ÷ ผลิตจริงทั้งหมด (ดี+เสีย) — ห้ามหักซ้ำ (กฎ Q · 2026-08-02)

  หมายเหตุความแม่นยำ: สูตรนี้ไม่หักเวลาพักตาม break policy และไม่แยก planned/unplanned
  ออกจากตัวหาร (ต่างจากสูตรตอนปิดกะ) — เป็นค่าประมาณระหว่างกะสำหรับดูแนวโน้ม
  ใช้ร่วมกันทุกจอที่โชว์ OEE สด (FactoryMap · OEEAnalytics) เพื่อให้ตัวเลขตรงกัน

  คืน null เมื่อประเมินไม่ได้ (ยังไม่ถึง 10 นาทีแรก / ไม่มีเวลาเริ่มกะ)
*/

export const LIVE_MIN_ELAPSED = 10; // นาทีแรกของกะ ยังประเมินไม่ได้ (ตัวหารเล็กเกินไป)

export function computeLiveOee({ session, orders = [], downtimes = [], ctMap = {}, ngQty = null, workDate, nowMs = Date.now() }) {
  if (!session?.start_time) return null;
  const wd = workDate || session.work_date;
  if (!wd) return null;

  const opened = new Date(`${wd}T${session.start_time.slice(0, 5)}:00`).getTime();
  let elapsed = (nowMs - opened) / 60000;
  if (session.shift_min) elapsed = Math.min(elapsed, session.shift_min);
  if (!(elapsed >= LIVE_MIN_ELAPSED)) return null;

  // Downtime ที่ยังเปิดค้าง (ไม่มีเวลาจบ/นาที) นับถึงตอนนี้
  const dtMin = downtimes.reduce((a, d) => {
    if (d.ended_at || d.duration_min != null) return a + (Number(d.duration_min) || 0);
    return a + (d.started_at ? Math.max(0, (nowMs - new Date(d.started_at).getTime()) / 60000) : 0);
  }, 0);
  const runMin = Math.max(1, elapsed - dtMin);

  let stdMin = 0, produced = 0, ngFromOrders = 0;
  orders.forEach(o => {
    const q = o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
    produced += q;
    stdMin += q * (ctMap[o.mat_no] || 0) / 60;
    ngFromOrders += o.qty_ng || 0;
  });
  const ng = ngQty != null ? ngQty : ngFromOrders;

  const A = Math.min(1, runMin / elapsed);
  const pct = v => Math.max(0, Math.min(100, Math.round(v * 1000) / 10));

  // ยังไม่ผลิตชิ้นแรก (เพิ่งเปิดกะ/รอของ) → ประเมิน P/Q/OEE ไม่ได้ ต้องคืน null
  // ห้ามคืน P=0 → OEE 0% (เคยทำการ์ด "กำลังผลิต" ขึ้น 0% แดง ทั้งที่กะเพิ่งเปิด 19 นาที · 2026-08-05)
  if (produced <= 0) {
    return { A: pct(A), P: null, Q: null, oee: null, elapsedMin: Math.round(elapsed), runMin: Math.round(runMin), produced: 0, ngQty: ng, noOutput: true };
  }

  const P = Math.min(1, runMin > 0 ? stdMin / runMin : 0);
  const Q = produced / (produced + ng);
  const oee = A * P * Q;
  if (!isFinite(oee)) return null;

  return { A: pct(A), P: pct(P), Q: pct(Q), oee: pct(oee), elapsedMin: Math.round(elapsed), runMin: Math.round(runMin), produced, ngQty: ng, noOutput: false };
}
