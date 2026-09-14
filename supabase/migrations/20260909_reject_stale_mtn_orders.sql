-- ══════════════════════════════════════════════════════════════════════════
-- ใบแจ้งซ่อม MO — ปิดใบที่ค้างขั้น 1 (ไม่มีใครรับงาน) เกิน 45 วัน        2026-09-09
-- Project: DR (eyhclzkifitbhbljgoav · ชื่อในจอ "Product DB")
--
-- ที่มา (คำสั่ง user 2026-09-09 · รอบตรวจ feedback เช้า → "reject เลย"):
--   รอบตรวจเจอ 2 ใบค้างที่ขั้น 1 มา 49-50 วัน ไม่เคยมีใครกดรับงาน จึงยังไม่มีเลข MO ด้วยซ้ำ
--   ตกค้างจากช่วงเริ่มใช้ระบบ ไม่ใช่งานที่รอซ่อมอยู่จริง แต่ยังนับรวมในคิว = กลบใบจริง
--
-- แถวก่อนแก้ (บันทึกไว้เพื่อสอบกลับ — ไม่ได้ลบข้อมูล เปลี่ยนเฉพาะ status/reject_reason):
--   192fd061-6c8b-4321-8dcc-f6950860bdd4 · 2026-07-21 09:57 · JIG MTN · PD4 · GOR
--       · JIG · "ปรับจิ๊กฟิกเจอร์" · ผู้แจ้ง: กัญญารัตน์ · ต้องการเสร็จ 2026-07-24
--   d718c5b4-99df-42b2-8932-7a9ce930f88b · 2026-07-22 16:16 · PRODUCTION · PD4 · Assy GOR
--       · NUT FEEDER · "เซนเซอร์ ชำรุด" · ผู้แจ้ง: ADMIN
--
-- ⚠️ ทำไมใช้ `rejected` ไม่ใช่ `delete` และไม่ใช่ `closed`
--   กฎเดียวกับที่ตกผลึกไว้ตอนล้างคิว 4M อัตโนมัติ (CLAUDE.md · 4M Approval Workflow):
--   **เคลียร์คิวค้าง = `rejected` + เหตุผลที่อ่านรู้เรื่อง · ห้าม delete (เสียประวัติ) และห้าม
--   ปิดแบบผ่าน (โกหกว่ามีคนซ่อมจริง)** · `mtn_orders.status` ไม่มี check constraint และ
--   `rejected` เป็นค่าที่ STATUS_META ฝั่งเว็บรู้จักอยู่แล้ว (⛔ Reject MO · step 0)
--   ⇒ ใบหลุดจากคิวเปิด (`OPEN_MO_STATUSES` ใน src/utils/dieStatus.js) แต่ยังสืบกลับได้ครบ
--
-- ไม่แตะ KPI: report_at/accept_at/repair_done_at คงเดิม และสูตร KPI นับเฉพาะใบที่มี
-- repair_done_at (MtnRepair.jsx `kpiRows`) — 2 ใบนี้ไม่เคยเข้าสูตรอยู่แล้ว
-- ══════════════════════════════════════════════════════════════════════════

update public.mtn_orders
set status        = 'rejected',
    reject_reason = 'ปิดใบโดยผู้ดูแลระบบ 09/09/2026 — ใบนี้ค้างที่ขั้น 1 (ยังไม่มีใครกดรับงาน) '
                    || 'มา ' || (current_date - (report_at at time zone 'Asia/Bangkok')::date) || ' วัน '
                    || 'ตั้งแต่วันที่แจ้ง โดยไม่มีความเคลื่อนไหวเลยและยังไม่เคยออกเลข MO '
                    || '· ถือเป็นใบตกค้างจากช่วงเริ่มใช้ระบบ ไม่ใช่งานที่รอซ่อมอยู่จริง '
                    || '· ถ้าปัญหายังอยู่ รบกวนเปิดใบใหม่ เพื่อให้เวลาตอบสนอง (KPI) นับจากวันที่แจ้งจริง',
    updated_at    = now()
where status = 'pending'
  and current_step = 1
  and mo_no is null
  and report_at < now() - interval '45 days';

-- ตรวจผลหลังรัน (DR):
--   select mo_no, status, current_step, line_name, left(reject_reason,60)
--     from mtn_orders where status='rejected' order by updated_at desc limit 5;   -- ต้องเห็น 2 ใบนี้
--   select count(*) from mtn_orders
--    where status='pending' and current_step=1 and report_at < now() - interval '45 days';  -- ต้องได้ 0
--
-- Rollback:
--   update public.mtn_orders set status='pending', reject_reason=null
--    where id in ('192fd061-6c8b-4321-8dcc-f6950860bdd4','d718c5b4-99df-42b2-8932-7a9ce930f88b');
