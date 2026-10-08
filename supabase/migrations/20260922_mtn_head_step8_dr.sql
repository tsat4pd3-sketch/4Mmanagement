-- ═══════════════════════════════════════════════════════════════════════════
-- ขั้น 8 "หัวหน้าแผนก MTN" + ช่องเซ็นที่ 5 ของฟอร์ม FM-MTN-006   (DR)
-- 2026-09-22 · ทีม MTN ส่ง WI + ใบจริงมาให้เทียบ (user: "flow เอาตาม WI ที่ส่งให้")
--
-- 🔴 บั๊กที่เจอตอนเทียบ: ช่องเซ็นที่ 5 ในใบพิมพ์ (= "ลายเซ็นหัวหน้าแผนก MTN" ตาม WI)
--    ระบบดึงจาก `checker_name` ซึ่งคือ **ผู้ตรวจรับงานฝั่งผู้แจ้ง (ขั้น 4)** — คนละฝั่งกัน
--    วัดจริง: 6 จาก 8 ใบที่มีชื่อในช่องนี้ = คนเดียวกับผู้เปิดใบ
--    (ใบตัวอย่าง MTN.2026/09-5 ช่อง 1 และ 5 = "ฉัตรชัย ใจรักเรียน" คนเดียวกัน)
--    ⇒ เอกสารที่ออกไปแล้วทุกใบ "หัวหน้าแผนก MTN เซ็น" จริงๆ คือลายเซ็นผู้แจ้งซ้ำ
--
-- flow ใบ MTN: 7 ผจก.แผนกที่แจ้ง → **8 หัวหน้าแผนก MTN (ใหม่)** → 9 ผจก.MTN ปิดใบ
-- (ลำดับตาม WI ที่ทีมส่งมา · ใบ JIG/DIE ยัง 7 ขั้นเหมือนเดิม ไม่กระทบ)
--
-- ⚠️ status ยังคง `handover` ทั้งขั้น 7-8-9 (ห้ามเพิ่มค่า status ใหม่ — KPI/Andon/edge
--    อ่าน status ตรงๆ) · แยกขั้นด้วย **เวลาเซ็น** `cost_mgr_at` → `mtn_head_at` → `approve_at`
--    ไม่ใช่ `current_step` อย่างเดียว (current_step เชื่อไม่ได้กับใบเก่าที่ข้ามขั้นมา)
--
-- blast radius: ใบที่ค้างสถานะ handover ทั้งระบบ = **1 ใบ** (ทีม maintenance · step 7)
-- ไม่ backfill `mtn_head_*` ของใบเก่า — เดาย้อนหลังไม่ได้ว่าใครเซ็นจริง ปล่อยว่างให้เห็นว่าขาด
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.mtn_orders add column if not exists mtn_head_name text;
alter table public.mtn_orders add column if not exists mtn_head_uid  uuid;
alter table public.mtn_orders add column if not exists mtn_head_sign text;
alter table public.mtn_orders add column if not exists mtn_head_at   timestamptz;

comment on column public.mtn_orders.mtn_head_name is
  'หัวหน้าแผนก MTN — ขั้น 8 ตาม WI (ช่องเซ็นที่ 5 ของฟอร์ม FM-MTN-006) · เดิมใบพิมพ์ดึง checker_name (คนตรวจรับฝั่งผู้แจ้ง ขั้น 4) มาลงช่องนี้ผิดฝั่ง';
comment on column public.mtn_orders.mtn_head_at is
  'เวลาที่หัวหน้าแผนก MTN เซ็น — ตัวบอกว่าใบเดินผ่านขั้น 8 แล้ว (status คง handover · แยกขั้นด้วยเวลาเซ็น ไม่ใช่ current_step อย่างเดียว)';

-- ตรวจ: select count(*) from information_schema.columns where table_name='mtn_orders'
--         and column_name in ('mtn_head_name','mtn_head_uid','mtn_head_sign','mtn_head_at');  -- 4
-- ROLLBACK: alter table public.mtn_orders
--             drop column if exists mtn_head_name, drop column if exists mtn_head_uid,
--             drop column if exists mtn_head_sign, drop column if exists mtn_head_at;
