-- MTN Work-Order — "ตีกลับให้ผู้แจ้ง" (return/re-route ผิดแผนก) · DR project (eyhclzkifitbhbljgoav)
-- ทีมที่ได้รับผิดแผนกกด Reject → status 'returned' + เหตุผล → เด้งกลับหาผู้แจ้ง
--   ผู้แจ้งเห็นเหตุผล เลือกแผนกที่ถูก แล้วส่งใหม่ → status 'pending' + report_at รีเซ็ต
--   (นาฬิกา KPI เริ่มนับใหม่ให้แผนกที่ถูก · เก็บ first_report_at ไว้อ้างอิง) · ใบไม่ถูกทิ้ง
-- additive · reject_reason เดิม reuse เป็นเหตุผลตีกลับ
alter table public.mtn_orders add column if not exists returned_at        timestamptz; -- เวลาที่ถูกตีกลับ
alter table public.mtn_orders add column if not exists returned_from_dept text;        -- ตีกลับมาจากทีมไหน
alter table public.mtn_orders add column if not exists first_report_at    timestamptz; -- เวลาเปิดใบครั้งแรก (กันเวลา KPI งงหลังตีกลับ)
alter table public.mtn_orders add column if not exists bounce_count       int default 0; -- จำนวนครั้งที่ถูกตีกลับ/ส่งใหม่
