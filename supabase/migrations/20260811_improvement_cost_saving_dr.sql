-- Improvement cost saving — ข้อมูลต้นทุนฝั่ง DR (eyhclzkifitbhbljgoav) · additive ทั้งหมด
-- parts_master = ทะเบียนกลางตัวตนสินค้า (กฎเหล็ก 2026-08-06) → ต้นทุนต่อชิ้นเป็นคุณสมบัติสินค้า เก็บที่นี่ที่เดียว
--   material_cost = ต้นทุนวัตถุดิบ/ชิ้น (raw mat) — ใช้คู่กับ conversion cost ที่คำนวณจาก CT × activity rate
--   standard_cost = standard cost/ชิ้น ที่บัญชีคำนวณ (รวม mat+DL+OH+DP แล้ว) — มีค่า = ใช้ตัวนี้ก่อนเสมอ
alter table public.parts_master add column if not exists material_cost numeric;
alter table public.parts_master add column if not exists standard_cost numeric;
comment on column public.parts_master.material_cost is 'ต้นทุนวัตถุดิบ บาท/ชิ้น (ใช้คิด cost saving ของเสีย — บวก conversion จาก CT×activity rate)';
comment on column public.parts_master.standard_cost is 'Standard cost บาท/ชิ้น จากบัญชี (รวม mat+DL+OH+DP) — มีค่าแล้วชนะ material_cost';

-- เงินลงทุนของโปรเจคปรับปรุง → คิดระยะคืนทุน (payback)
alter table public.improvements add column if not exists invest_cost numeric;
comment on column public.improvements.invest_cost is 'เงินลงทุนของโปรเจค (บาท) — ใช้คิดระยะคืนทุนเทียบ cost saving/เดือน';
