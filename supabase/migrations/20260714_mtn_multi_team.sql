-- ขยาย MTN ให้ครอบคลุมหลายทีมซ่อม: PRODUCTION(Autonomous)/JIG MTN/DIE MTN/MTN (2026-07-14)
-- Project: DR (eyhclzkifitbhbljgoav) · additive
alter table public.mtn_technicians add column if not exists dept text;      -- ทีมของช่าง
alter table public.mtn_orders      add column if not exists mtn_dept text;   -- หน่วยงานที่รับผิดชอบใบนี้ (แจ้งถึงหน่วยงาน)
update public.mtn_technicians set dept = 'JIG MTN' where dept is null;       -- ช่างที่ seed จากข้อมูลเดิม
