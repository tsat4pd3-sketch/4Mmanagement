-- 🔧 ถอดคู่ RH/LH ที่ "ทั้ง 2 ข้างเป็น MAT เดียวกัน" (DR · Product DB eyhclzkifitbhbljgoav · apply แล้ว 04/11 ผ่าน MCP · คำสั่ง user)
-- ต้นเหตุ: บั๊กสแกนเปิดใบงานคู่ (แก้แล้ว hotfix 266c6a79 03/11 · docs/modules/daily-report.md §สแกนงานคู่ทีละข้าง)
--   สแกนข้างแรกแล้วระบบสลับช่อง MAT ไปข้างคู่ + บังคับใบถัดไปเป็นคู่ ⇒ คนยิง Tag ข้างเดียวกันติดกัน = ผูก LH กับ LH
-- ขอบเขต: 19 คู่ (38 ใบ) ตั้งแต่ 01/09 — LINE A (800 Ton) 14 · LINE D (110&300 Ton) 4 · LINE B (600 Ton) 1
--   ⚠️ ยังเหลือคู่ MAT ซ้ำของ HDF2 ก.ค.–ส.ค. 27 คู่ (MAT 20065635/20065715) — ยังไม่ถอด รอ user ตัดสิน
-- ทำ: paired_order_id = null ทั้ง 2 ข้าง · ไม่แตะ mat_no/qty/opened_at
--   (opened_at ใบที่ 2 เคยถูก sync ให้เท่าใบแรกตอนผูก — กู้ค่าเดิมไม่ได้ · ไม่กระทบยอด)
with bad as (
  select a.id a_id, b.id b_id from public.prod_orders a
  join public.prod_orders b on b.id = a.paired_order_id and a.id < b.id
  where a.mat_no = b.mat_no and a.opened_at >= '2026-09-01'
)
update public.prod_orders o set paired_order_id = null
where o.id in (select a_id from bad union select b_id from bad);

-- ตรวจผล (ต้องได้ 0):
--   select count(*) from prod_orders a join prod_orders b on b.id=a.paired_order_id
--   where a.mat_no=b.mat_no and a.opened_at >= '2026-09-01';

-- ย้อนกลับ (ผูกคืน a ↔ b):
-- with p(a,b) as (values
--  ('26171ad5-f098-4cea-8049-96b9ff5df987','a80524d2-7aa1-4934-afc2-dbac7629eee2'),
--  ('9af1873b-cb74-49e0-a9d2-e56dcc40a936','c0552c1e-a881-4b9f-aa78-2d7cbd3ae72b'),
--  ('35b66856-c709-4f6b-a044-9f3b8cbe3ea1','85e4d1b4-9000-47ab-9d19-d52b0a27bb23'),
--  ('93c70b70-70b9-41d1-b30e-67b4ccdd15c6','d5cc0e21-7808-4fa7-952c-2ecccc19df99'),
--  ('0a6b0b3c-f139-4d21-b1ea-535b5c2ae433','8d5c11ca-d4cd-4af5-a916-3c02485e9f80'),
--  ('1d26183d-2213-485a-8844-32bcbf76181e','cadfdab2-893f-4edb-8976-e3cdd2e8d52a'),
--  ('0422196b-66e0-4d12-945e-6de07ebe2de3','3cd7bdc7-172c-451f-b5e8-b252692327ca'),
--  ('181779c8-daa1-43a9-aab6-5f86383afc10','239910c3-a107-4098-849b-9d9ce9fb9452'),
--  ('e4327c9a-f5c6-4440-9708-fe6ff20af971','eb9ca36d-4a75-4a08-bc4d-676258e2b6bc'),
--  ('565f5203-7cde-4e13-aab8-42ae1b0648a6','8e8795ac-a949-4f29-a48f-cc464934aa68'),
--  ('059ecaf5-cac5-4d54-bcaf-924365d700aa','42679968-9e3e-4b5a-a60b-7da26a283405'),
--  ('0c313d65-2a98-40a8-a97a-7001206f89ef','6d771be5-9c52-4965-b2ff-925748e347bc'),
--  ('120fb03e-ae50-453e-b127-e8653c320ffc','e161bb44-f1b3-495e-ad9b-c19e74cfffdc'),
--  ('1aabd9cf-cc51-4bc0-962b-d0b11b86c976','c90b76af-9a3a-47b7-8b49-35a47b9f1fad'),
--  ('273ad928-50f4-4a3a-bd1b-d2031832a134','f5b361c1-285c-4c55-bed3-e6559afa2dd4'),
--  ('5e516e3d-0b6f-4293-a314-434a600d4427','b19b909a-4e81-4dea-8172-0005be319146'),
--  ('d2808089-d5d5-48e6-8c18-7a4c8465e560','f7cfe62b-851e-4239-8b65-9a8dfc92f403'),
--  ('2dc73635-01be-4628-bb5a-adb44bad6c61','9c04c21e-6ad2-4a35-aed3-4bc8d44a20f0'),
--  ('c704caed-0aab-44ee-a630-f2e56abd64b3','e2629108-7057-43ed-b411-d7614893456e'))
-- update prod_orders o set paired_order_id = case when o.id::text=p.a then p.b::uuid else p.a::uuid end
-- from p where o.id::text in (p.a, p.b);
