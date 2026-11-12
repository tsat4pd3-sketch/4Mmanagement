/* ═══════════════════════════════════════════════════════════════════════════════════════
   4M Change Management — แถบ "ตอนนี้ถึงขั้นไหน" ของใบ 4M (<StepFlow> · UI §6.30 · 2026-11-12)
   pure ล้วน · เทส src/utils/__tests__/fourMFlow.test.mjs · ใช้ที่ /report แท็บ 4M (+ จอที่โชว์ใบ 4M)

   ลูปจริง (docs/modules/four-m-workflow.md §ตารางเส้นทาง):
     pending_doc (แนบ OJT) → pending (รอ SV) → pending_qa (ถ้า requires_qa) → approved · ตีกลับ = rejected
   🔴 `requires_qa === false` เท่านั้นที่ไม่มีขั้น QA (null/undefined = ต้องผ่าน QA — ตรงกับ Report.handleApprove)
   🔴 ใบที่ถูกตีกลับ: รู้ว่าตกที่ขั้นไหนจาก `sv_approved_at` (มี = QA ตีกลับ · ไม่มี = SV ตีกลับ)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

export const FOUR_M_STATUSES = ['pending_doc', 'pending', 'pending_qa', 'approved', 'rejected'];

const WAITING = {
  pending_doc: 'ผู้แจ้ง — แนบเอกสาร OJT แล้วส่งเข้าคิว',
  pending:     'หัวหน้างาน (SV) — อนุมัติ',
  pending_qa:  'QA — อนุมัติ',
};

export function fourMFlow(log = {}) {
  const status = String(log?.status || '').trim();
  const known = FOUR_M_STATUSES.includes(status);
  const needsQa = log?.requires_qa !== false;
  const defs = [
    { n: 1, label: 'ยื่นใบ 4M', who: 'ผู้แจ้ง' },
    { n: 2, label: 'SV อนุมัติ', who: 'หัวหน้างาน' },
    ...(needsQa ? [{ n: 3, label: 'QA อนุมัติ', who: 'QA' }] : []),
    { n: needsQa ? 4 : 3, label: 'มีผลบังคับใช้', who: null },
  ];
  // ขั้นที่ "ถึงแล้ว" (current) ต่อสถานะ · approved = จบครบ
  const curIdx = { pending_doc: 0, pending: 1, pending_qa: 2 }[status];
  const rejectedAt = status === 'rejected' ? (log?.sv_approved_at && needsQa ? 2 : 1) : null;
  const steps = defs.map((d, i) => {
    const st = { n: d.n, label: d.label, who: d.who };
    if (!known) st.state = 'todo';
    else if (status === 'approved') st.state = 'done';
    else if (rejectedAt != null) {
      if (i < rejectedAt) st.state = 'done';
      else if (i === rejectedAt) { st.state = 'done'; st.tone = 'bad'; st.label = `${d.label} — ตีกลับ`; }
      else st.state = 'todo';
    }
    else st.state = i < curIdx ? 'done' : i === curIdx ? 'current' : 'todo';
    return st;
  });
  return { steps, waiting: known ? (WAITING[status] || null) : null, closed: status === 'approved' || status === 'rejected', known };
}
