/* ══ 🪜 wfFlow — แถบขั้นของใบ e-Workflow (<StepFlow> · UI §6.30 ใบงาน) ══════════════════
   ขั้นที่ 0 = "ยื่นใบ" (ผู้เปิด) · ขั้นถัดไป = ตามนิยามของเวอร์ชันที่ใบตรึงไว้
   🔴 สถานะไม่รู้จัก = unknown (ห้ามเดา) · ตีกลับ = แดง · ยกเลิก = เทา · ส่งกลับแก้ = กลับมาที่ผู้เปิด
   ═══════════════════════════════════════════════════════════════════════════════════ */
import { linearFlow } from './stepFlow.js';
import { RULE_LABEL } from './wfSchema.js';

export const WF_STATUS = {
  in_progress: { label: 'กำลังอนุมัติ', tone: 'warn' },
  returned:    { label: 'ส่งกลับให้แก้', tone: 'warn' },
  approved:    { label: 'อนุมัติครบ',  tone: 'good' },
  rejected:    { label: 'ตีกลับ',      tone: 'bad' },
  cancelled:   { label: 'ยกเลิก',      tone: 'none' },
};

/** @param inst แถว wf_instances · @param flow flow_schema ของเวอร์ชันที่ใบตรึงไว้ */
export function wfFlow(inst, flow) {
  const defSteps = flow?.steps || [];
  const steps = [
    { key: '_submit', label: 'ยื่นใบ', who: 'ผู้เปิดใบ', action: 'แก้แล้วส่งใหม่' },
    ...defSteps.map(s => ({ key: s.key, label: s.label, who: RULE_LABEL[s.assignee?.rule] || null, action: s.kind === 'ack' ? 'รับทราบ' : 'อนุมัติ' })),
  ];
  const cur = Number.isInteger(inst?.current_step) ? inst.current_step + 1 : null;
  const at = { approved: steps.length, returned: 0 };
  if (cur != null) at.in_progress = cur;
  const stopAt = cur ?? steps.length - 1;
  const f = linearFlow({
    status: inst?.status, steps, at,
    exits: {
      rejected:  { tone: 'bad',  label: 'ตีกลับ', at: stopAt },
      cancelled: { tone: 'none', label: 'ยกเลิก', at: stopAt },
    },
  });
  if (inst?.status === 'in_progress' && inst?.blocked_reason) f.waiting = `⛔ หาผู้อนุมัติไม่ได้ — ${inst.blocked_reason}`;
  return f;
}
