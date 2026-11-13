/* 🖼️ PlanSlipFrame — กรอบ "คิวตามอุดมคติ" ของใบคัมบัง 1 ใบ (ที่เดียวทั้งระบบ · 2026-11-13)
 *
 * 🔴 **ไม่ใช่แผนของแพลนนิ่ง** — แผนจริงอยู่แถว `<PlanFrameRow>` (เส้นประม่วง · `production_plan_lots`)
 *    ตัวนี้คือ "ถ้าไล่ใบที่เปิดไว้แล้วชนกันรวดเดียว ใบนี้ควรตกช่วงไหน" (`utils/heijunkaQueue.js`)
 *
 * กติกาการวาด (ภาพร่าง user 30/09 · ทีมปั๊ม — **ห้ามเปลี่ยนโดยไม่ถาม**):
 *  · **วาดทุกใบ** — กรอบคือเส้นอ้างอิงที่ต้องอยู่เสมอ คนถึงเทียบได้ว่าแท่งจริงล้นออกขวาเท่าไหร่
 *    (ใบที่ตรงแผน กรอบทับแท่งพอดี = เหมือนเส้นขอบ)
 *  · ใบที่ **หลุดกรอบ** วาดทับแท่ง (z=2) เส้นหนาเข้ม ⇒ ส่วนที่ยื่นพ้นกล่อง = ขนาดที่หลุด
 *  · ใบที่ตรงแผน วาดไว้ข้างหลัง (z=0) จางๆ
 *
 * 🔴 **สีต้องมาจาก token เท่านั้น** — ของเดิม `Management.jsx` ฮาร์ดโค้ด `#e5e7eb`
 *    (= สีตัวหนังสือของธีม**มืด**) ⇒ บนธีมสว่างที่หน้างานใช้ กรอบของใบที่หลุดแผน**แทบมองไม่เห็น**
 *    ส่วนใบที่ตรงแผนกลับเห็นชัด = สัญญาณกับสิ่งรบกวนสลับที่กัน (เจอ 13/11 จากภาพหน้าจอ user)
 */
import React from 'react';

export default function PlanSlipFrame({
  planLeftPct = 0, planWidthPct = 0, planSlipped = false,
  planStartMs, plannedEndMs, startMs, realEndMs, occupiedEndMs, fmtMs = (v) => v,
}) {
  if (!(planWidthPct > 0)) return null;
  const lateStartMin = Math.max(0, Math.round((startMs - planStartMs) / 60000));
  const lateEndMin = Math.max(0, Math.round((Math.max(realEndMs, occupiedEndMs || realEndMs) - plannedEndMs) / 60000));
  const tip = `กรอบคิวตามอุดมคติของใบนี้: ${fmtMs(planStartMs)}–${fmtMs(plannedEndMs)}`
    + (planSlipped ? ` · หลุดกรอบ (เริ่มช้า ${lateStartMin} น. · จบช้า ${lateEndMin} น.)` : ' · อยู่ในกรอบ')
    + '\n— คิวที่ระบบไล่ให้จากใบที่เปิดไว้แล้ว ไม่ใช่แผนของทีมวางแผน';
  return (
    <div title={tip}
      style={{
        position: 'absolute', top: 1, bottom: 1,
        left: `${planLeftPct}%`, width: `${planWidthPct}%`,
        border: `${planSlipped ? 2 : 1}px dashed ${planSlipped ? 'var(--text)' : 'var(--muted)'}`,
        borderRadius: 'var(--r-xs)',
        opacity: planSlipped ? 0.95 : 0.35, zIndex: planSlipped ? 2 : 0, pointerEvents: 'none',
      }} />
  );
}
