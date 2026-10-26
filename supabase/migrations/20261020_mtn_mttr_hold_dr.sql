-- DR project (eyhclzkifitbhbljgoav · "Product DB") — 2026-10-20 · คำสั่ง user
-- "MTN ต้อง judge ว่าซ่อมได้เองหรือต้องส่งภายนอก เพื่อหยุด MTTR · ซ่อมได้แต่ต้องเปิด PR สั่งอะไหล่ = หยุด MTTR ·
--  ซ่อมไม่ได้ ส่งภายนอก/เรียก supplier เข้ามา = มี PR และหยุด MTTR — หลังจาก MTN ตัดสินใจแล้ว"
-- ✅ สถานะ 20/10: apply แล้วผ่าน MCP (เช็คแล้ว: มีคอลัมน์ทั้ง 2)
--
-- ช่วงหยุดนับ MTTR ของช่าง 1 ช่วงต่อใบ:
--   เริ่ม = ตอน MTN เลือกเส้นทาง "ซ่อมเอง+PR" หรือ "ส่งภายนอก" (repair_path · ตัดสินใจ)
--   จบ   = อะไหล่ PR ของใบรับครบ / ของกลับจาก supplier / ช่างกด "กลับมาซ่อมต่อ"
--   สูตร `techRepairMin()` (src/utils/mtnVendor.js) หักช่วงนี้ ∪ ช่วงอยู่กับ supplier (ไม่หักซ้ำ)
--   🔴 downtime / machine breakdown ของเครื่อง **นับเต็ม** เหมือนเดิม (ไม่แตะ)
-- ย้อนกลับ: alter table public.mtn_orders drop column mttr_hold_from, drop column mttr_hold_to;
alter table public.mtn_orders add column if not exists mttr_hold_from timestamptz;
alter table public.mtn_orders add column if not exists mttr_hold_to   timestamptz;
comment on column public.mtn_orders.mttr_hold_from is 'เริ่มหยุดนับ MTTR ช่าง = เวลาที่ MTN ตัดสินเส้นทาง ซ่อมเอง+PR / ส่งภายนอก (20/10)';
comment on column public.mtn_orders.mttr_hold_to   is 'จบช่วงหยุด MTTR = อะไหล่รับครบ / ของกลับจาก supplier / ช่างกดซ่อมต่อ · null = ยังหยุดอยู่';
-- เช็คผล: select column_name from information_schema.columns where table_name='mtn_orders' and column_name like 'mttr_hold%';
