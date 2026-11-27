/* 📈 SPC กลาง — X̄-R / I-MR + Cp/Cpk/Pp/Ppk (AIAG SPC manual) — ที่เดียวทั้งระบบ
   ย้ายจาก src/pages/QualityControl.jsx (26/11 · ไม่เปลี่ยนสูตร) เพื่อให้ SPC อุปกรณ์ (ใบ AM/PM · shim) ใช้สูตรเดียวกับ QA
   🔴 ห้ามก๊อปสูตรไปไว้ในหน้า · เพิ่มกฎใหม่ (เช่นเกณฑ์จำนวนจุด) ห่อด้วยฟังก์ชันใหม่ ห้ามแก้พฤติกรรม computeSPC เงียบๆ (QA ใช้อยู่)
   📄 docs/modules/equipment-spc.md */

/* ── SPC constants (AIAG SPC manual, subgroup size n = 2..10) ──────────────
   n=1 ใช้ I-MR chart: X limits = X̄ ± 2.66·MR̄ (E2), d2 = 1.128 */
export const SPC_CONST = {
  1:  { A2: 2.660, D3: 0,     D4: 3.267, d2: 1.128 },
  2:  { A2: 1.880, D3: 0,     D4: 3.267, d2: 1.128 },
  3:  { A2: 1.023, D3: 0,     D4: 2.574, d2: 1.693 },
  4:  { A2: 0.729, D3: 0,     D4: 2.282, d2: 2.059 },
  5:  { A2: 0.577, D3: 0,     D4: 2.114, d2: 2.326 },
  6:  { A2: 0.483, D3: 0,     D4: 2.004, d2: 2.534 },
  7:  { A2: 0.419, D3: 0.076, D4: 1.924, d2: 2.704 },
  8:  { A2: 0.373, D3: 0.136, D4: 1.864, d2: 2.847 },
  9:  { A2: 0.337, D3: 0.184, D4: 1.816, d2: 2.970 },
  10: { A2: 0.308, D3: 0.223, D4: 1.777, d2: 3.078 },
};

export const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
export const stddev = a => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/**
 * คำนวณ control chart + capability จาก subgroup rows [{readings:[...], ...}]
 * คืน { points, xbarbar, rbar, uclX, lclX, uclR, lclR, sigmaWithin, sigmaOverall,
 *       cp, cpk, pp, ppk, all, n }
 */
export function computeSPC(rows, char) {
  const n = char?.subgroup_size || 1;
  const c = SPC_CONST[Math.min(Math.max(n, 1), 10)];
  /* ⚠️ SPC ต้องการ subgroup ขนาด "คงที่ = n" — ค่าคงที่ A2/D3/D4/d2 ผูกกับ n ตัวเดียว
     (QC audit 2026-08-20 · T1-7) เดิมรับทุกแถวไม่ตรวจความยาว → แถวที่ค่าน้อยกว่า n
     (เช่นแถวค่าเดียวปนในชุด n=5) มี Range เล็กผิดปกติ ดึง R̄ ลง → σ_within เล็กเกิน
     → Cpk เฟ้อทางเดียว (วัดจริง +52%) = false pass บนเลขที่รายงานลูกค้า
     → ตัดแถวที่ขนาดไม่ตรง n ออกจากการคำนวณ แล้ว "รายงานจำนวนที่ตัด" (excluded) ห้ามตัดเงียบ
     ⚠️ จับคู่ row↔group ไว้ด้วยกันก่อน filter — เดิม filter แค่ groups แล้ว points ไปอ่าน
     rows[i].work_date ด้วย index ที่เลื่อน → จุดหลุด control limit โยงผิดวัน (T3-35) */
  const paired = rows
    .map(r => ({ r, g: (r.readings || []).map(Number).filter(v => Number.isFinite(v)) }))
    .filter(x => x.g.length);
  const kept = paired.filter(x => x.g.length === n);
  const excluded = paired.length - kept.length;
  const groups = kept.map(x => x.g);
  const keptRows = kept.map(x => x.r);
  if (!groups.length) return excluded > 0 ? { excluded, allExcluded: true } : null;

  const all = groups.flat();
  const xbars = groups.map(g => mean(g));
  let ranges;
  if (n === 1) {
    // I-MR: moving range ระหว่างจุดติดกัน (จุดแรกไม่มี MR)
    ranges = xbars.map((v, i) => i === 0 ? null : Math.abs(v - xbars[i - 1]));
  } else {
    ranges = groups.map(g => Math.max(...g) - Math.min(...g));
  }
  const validRanges = ranges.filter(v => v != null);
  const xbarbar = mean(xbars);
  const rbar = mean(validRanges);
  const factor = n === 1 ? 2.660 : c.A2;
  const uclX = xbarbar + factor * (rbar ?? 0);
  const lclX = xbarbar - factor * (rbar ?? 0);
  const uclR = rbar != null ? c.D4 * rbar : null;
  const lclR = rbar != null ? c.D3 * rbar : null;
  const sigmaWithin = rbar != null && rbar > 0 ? rbar / c.d2 : null;
  const sigmaOverall = stddev(all);

  const usl = char?.usl != null ? Number(char.usl) : null;
  const lsl = char?.lsl != null ? Number(char.lsl) : null;
  const capa = (sigma) => {
    if (!sigma || sigma <= 0) return { cp: null, cpk: null };
    let cp = null, cpk = null;
    if (usl != null && lsl != null) cp = (usl - lsl) / (6 * sigma);
    const cpu = usl != null ? (usl - xbarbar) / (3 * sigma) : null;
    const cpl = lsl != null ? (xbarbar - lsl) / (3 * sigma) : null;
    if (cpu != null && cpl != null) cpk = Math.min(cpu, cpl);
    else cpk = cpu ?? cpl;
    return { cp, cpk };
  };
  const { cp, cpk } = capa(sigmaWithin);
  const { cp: pp, cpk: ppk } = capa(sigmaOverall);

  // จุดบนกราฟ + ตรวจกฎ: เกิน control limit / run 7 จุดข้างเดียวของ CL
  const points = groups.map((g, i) => ({
    idx: i + 1,
    xbar: +xbars[i].toFixed(4),
    range: ranges[i] != null ? +ranges[i].toFixed(4) : null,
    date: keptRows[i].work_date,
    oocX: xbars[i] > uclX || xbars[i] < lclX,
    oocR: ranges[i] != null && uclR != null && (ranges[i] > uclR || ranges[i] < lclR),
    run: false,
  }));
  let side = 0, runLen = 0;
  points.forEach(p => {
    const s = p.xbar > xbarbar ? 1 : p.xbar < xbarbar ? -1 : 0;
    if (s !== 0 && s === side) runLen += 1; else { side = s; runLen = 1; }
    if (runLen >= 7) p.run = true;
  });
  const oos = (usl != null || lsl != null)
    ? all.filter(v => (usl != null && v > usl) || (lsl != null && v < lsl)).length
    : 0;

  return {
    points, all, n, xbarbar, rbar, uclX, lclX, uclR, lclR,
    sigmaWithin, sigmaOverall, cp, cpk, pp, ppk, oos, usl, lsl, excluded,
  };
}

