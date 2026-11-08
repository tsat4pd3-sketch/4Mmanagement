-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 AM ผิดปกติ → ต้องเปิดใบแจ้งซ่อม (MO) หรือระบุเหตุผลที่ไม่เปิด   ·   project = DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- ที่มา: ประชุมหน้างาน 2026-11-02 (B3) — ผลตรวจ AM ที่ NG ปิดหน้าต่าง "ไว้ก่อน" ได้เปล่าๆ ⇒ ไม่มีใครตอบได้ว่า
--   ผิดปกติที่เจอถูกส่งซ่อมหรือยัง · ตอนนี้: ต้องเปิด MO (mtn_orders.source_inspection_id) หรือเขียนเหตุผลที่นี่
--
-- additive ล้วน (nullable · ไม่มี default ที่เปลี่ยนแถวเดิม) — ไม่แตะ RLS/GRANT (ตาราง inspections เปิด anon อยู่แล้ว
--   ตามกฎ supabaseDR = anon เสมอ · update คอลัมน์ใหม่ใช้ policy UPDATE เดิม)
-- ยังไม่ apply: จอบอร์ด AM อ่านคอลัมน์นี้แบบแยกคิวรี (ทน 42703) · ปุ่ม "ไม่เปิดใบ (ระบุเหตุผล)" ขึ้น error ให้เปิด MO แทน
-- ย้อน: alter table public.inspections drop column mo_waived_reason, drop column mo_waived_by, drop column mo_waived_at;
--       (revert โค้ดก่อน แล้วค่อย drop)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.inspections add column if not exists mo_waived_reason text;
alter table public.inspections add column if not exists mo_waived_by uuid;
alter table public.inspections add column if not exists mo_waived_at timestamptz;

comment on column public.inspections.mo_waived_reason is
  'ผลตรวจ NG ที่ไม่เปิดใบแจ้งซ่อม — เหตุผลที่คนตรวจเขียน (AM ต้องมี MO หรือเหตุผลอย่างใดอย่างหนึ่ง · 2026-11-02)';
comment on column public.inspections.mo_waived_by is 'auth uid (Main) ของคนที่ระบุเหตุผลไม่เปิดใบซ่อม';

-- ตรวจหลังรัน:
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='inspections' and column_name like 'mo_waived%';
