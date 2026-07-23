-- MTN Work-Order — ประเมินความพึงพอใจบริการซ่อม (step 6 รับมอบ/ติดตาม) · DR project (eyhclzkifitbhbljgoav)
-- KPI ให้หน่วยงานซ่อม · หน่วยงานผู้แจ้งให้คะแนน 5 ด้าน × 3 ระดับ (1 เฉยๆ / 2 พอใจ / 3 พอใจมาก)
--   { quality, response, problem, politeness, readiness } — เก็บเป็น jsonb (ด้านที่ไม่ประเมิน = ไม่มี key)
-- additive · ใบเดิมที่ยังไม่ประเมิน = null (KPI นับเฉพาะใบที่มีค่า)
alter table public.mtn_orders add column if not exists satisfaction jsonb;
