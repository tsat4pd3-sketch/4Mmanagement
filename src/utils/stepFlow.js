/* ═══════════════════════════════════════════════════════════════════════════════════════
   🪜 stepFlow — กฎกลางของแถบ "ตอนนี้ถึงขั้นไหน" (<StepFlow> · UI §6.30 · 2026-11-12 · คำสั่ง user
   "ใส่แถบขั้นตอนแบบนี้ … และเช็คกับทุกงานที่มีการส่งต่อข้อมูลกัน")

   `linearFlow()` = ใบที่เดินเป็นเส้นตรงตามสถานะ → { steps, waiting, closed, known } ให้ <StepFlow> วาด
     steps : [{ key, label, who, action? }]   ลำดับขั้น (who = ฝ่ายที่ลงมือในขั้นนั้น · action = ข้อความ "รอ: who — action")
     at    : { <status>: index }              สถานะนี้ "กำลังอยู่ที่ขั้นไหน" (index = steps.length ⇒ จบครบทุกขั้น)
     exits : { <status>: { tone, label, at? } } สถานะจบที่ไม่ใช่จบปกติ (ยกเลิก/ตีกลับ) → หยุดที่ขั้น `at`
             (default = ขั้นถัดจากที่ทำเสร็จ · ฟังก์ชัน (row) ⇒ index ก็ได้) ป้ายขั้นนั้นเป็น label + สี tone
   🔴 สถานะที่ไม่อยู่ทั้ง `at` และ `exits` = known:false (จอเขียน "สถานะนี้ระบบไม่รู้จัก" ห้ามเดา)
   🔴 helper นี้ "ไม่รู้ธุรกิจ" — ตาราง steps/at/exits ของแต่ละใบอยู่กับ utils เจ้าของสถานะของโมดูลนั้น
      (materialRequest.js · npi.js · peLink.js · stockDiscrepancy.js · mtnPurchase.js · qaDocStatus.js …)
      ใบที่ชุดสถานะยังอยู่ในหน้า (ScrapReport · PmCoordination · OJT · ขอปิดกะ) นิยาม flow ไว้ท้ายไฟล์นี้
   ═══════════════════════════════════════════════════════════════════════════════════════ */

export function linearFlow({ status, steps, at = {}, exits = {}, row = null, doneWaiting = null }) {
  const s = String(status ?? '').trim();
  const n = steps.length;
  const exit = exits[s] || null;
  const cur = exit ? null : (Object.prototype.hasOwnProperty.call(at, s) ? at[s] : null);
  const known = !!exit || cur != null;
  let stopAt = null;
  if (exit) {
    const a = typeof exit.at === 'function' ? exit.at(row) : exit.at;
    stopAt = a == null ? 0 : Math.max(0, Math.min(n - 1, a));
  }
  const out = steps.map((d, i) => {
    const st = { n: i + 1, label: d.label, who: d.who || null };
    if (!known) st.state = 'todo';
    else if (exit) {
      if (i < stopAt) st.state = 'done';
      else if (i === stopAt) { st.state = 'done'; st.tone = exit.tone || 'none'; st.label = exit.label ? `${d.label} — ${exit.label}` : d.label; }
      else st.state = 'todo';
    }
    else st.state = i < cur ? 'done' : i === cur ? 'current' : 'todo';
    return st;
  });
  const closed = !!exit || cur === n;
  const curStep = !exit && cur != null && cur < n ? steps[cur] : null;
  const waiting = curStep ? `${curStep.who ? `${curStep.who} — ` : ''}${curStep.action || curStep.label}` : (cur === n ? doneWaiting : null);
  return { steps: out, waiting, closed, known };
}

/* ── flow ของใบที่ชุดสถานะยังอยู่ในหน้า (ย้ายไป utils ของโมดูลเมื่อมี) ─────────────────── */

/** ใบรายงานของเสีย FM-PD2-002 (/scrap-report) — draft → submitted → approved */
export const scrapReportFlow = (r) => linearFlow({
  status: r?.status, row: r,
  steps: [
    { key: 'draft', label: 'เปิดใบ / กรอกของเสีย', who: 'ผู้ขอ (ไลน์)', action: 'กรอกรายการแล้วส่งอนุมัติ' },
    { key: 'submitted', label: 'ส่งอนุมัติ', who: 'ผู้มีสิทธิ์อนุมัติ (QA/PD)', action: 'อนุมัติใบ' },
    { key: 'approved', label: 'อนุมัติแล้ว' },
  ],
  at: { draft: 0, submitted: 1, approved: 3 },
});

/** PM coordination (/pm-coordination · MTN → ผลิต) — draft → notified → done */
export const pmCoordinationFlow = (r) => linearFlow({
  status: r?.status, row: r,
  steps: [
    { key: 'draft', label: 'ร่างแผน', who: 'ช่าง (MTN)', action: 'แจ้งฝ่ายผลิต' },
    { key: 'notified', label: 'แจ้งฝ่ายผลิตแล้ว', who: 'ฝ่ายผลิต + ช่าง', action: 'ทำ PM ตามแผน' },
    { key: 'done', label: 'เสร็จสิ้น' },
  ],
  at: { draft: 0, notified: 1, done: 3 },
  exits: { cancelled: { tone: 'none', label: 'ยกเลิก', at: (row) => (row?.status === 'cancelled' && row?.notified_at ? 1 : 0) } },
});

/** กะ (production_sessions · /daily-report) — open → pending_close → closed · void = โมฆะ */
export const shiftCloseFlow = (sess) => linearFlow({
  status: sess?.status, row: sess,
  steps: [
    { key: 'open', label: 'เปิดกะ / ลงยอด', who: 'หัวหน้ากะ (leader)', action: 'ลงยอดครบแล้วขอปิดกะ' },
    { key: 'pending_close', label: 'ขอปิดกะ', who: 'หัวหน้างาน (SV)', action: 'ตรวจแล้วอนุมัติปิดกะ' },
    { key: 'closed', label: 'ปิดกะแล้ว' },
  ],
  at: { open: 0, pending_close: 1, closed: 3 },
  exits: { void: { tone: 'none', label: 'โมฆะ (ไม่ใช่กะจริง)', at: 0 } },
});

/** ใบ OJT FM-HRM-004 (/ojt-training) — ผู้จัดทำ → ระดับจัดการอนุมัติ → HR รับทราบ · ตัดสินจากช่องเซ็นจริง */
export function ojtFlow(t) {
  // คอลัมน์จริงของ ojt_trainings (SELF_SIGN ใน OjtTraining.jsx): approver → approved_at/approver_uid · hr → hr_ack_at/hr_uid
  const approver = !!(t?.approved_at || t?.approver_uid || t?.approver_sig_url);
  const hr = !!(t?.hr_ack_at || t?.hr_uid || t?.hr_sig_url);
  const completed = t?.status === 'completed';
  const idx = completed ? 3 : hr ? 3 : approver ? 2 : (t?.status === 'open' ? 1 : null);
  return linearFlow({
    status: idx == null ? t?.status : 'k' + idx, row: t,
    steps: [
      { key: 'maker', label: 'ผู้สอนบันทึกการฝึก', who: 'ผู้สอน/หัวหน้างาน', action: 'บันทึกผลการฝึก' },
      { key: 'approver', label: 'ระดับจัดการอนุมัติ', who: 'หัวหน้าแผนกขึ้นไป', action: 'เซ็นอนุมัติ' },
      { key: 'hr', label: 'HR รับทราบ', who: 'HR', action: 'เซ็นรับทราบ' },
    ],
    at: { k1: 1, k2: 2, k3: 3 },
  });
}
