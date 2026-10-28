-- ═══ ใบขอเบิกแบบ "ไลน์ขอเอง" (ad-hoc) — เพิ่มค่า source = 'line_adhoc' ════════════════════
-- Project: **Main** (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)
-- วันที่: 2026-10-21
--
-- ทำไม (วัดจริง 20/10):
--   ปุ่ม "📦 เบิก" ของหัวหน้าไลน์โผล่เฉพาะพาร์ทที่ครบ 3 ข้อ — มีแถวจุดเรียกเติม **และใส่ min** ·
--   เคยมียอดหน้าไลน์ · ยอดคงเหลือ ≤ min · ⇒ ของที่ต้องเบิกจากสโตร์ 183 คู่ (ไลน์,พาร์ท)
--   ตั้ง min ไว้ **1 คู่** ⇒ แทบไม่มีพาร์ทไหนผ่านเงื่อนไข ⇒ ใบ "ไลน์เรียก" มี 4 ใบทั้งชีวิตระบบ
--   (ที่เหลือ 107 ใบสโตร์สร้างเองจาก forecast = ยัง push ไม่ใช่ pull)
--   ⇒ เปิดทางให้ไลน์ "ขอเบิกพาร์ทนี้เลย" ได้โดยไม่ต้องมี min และไม่ต้องรอถึง min
--
-- ทำไมต้องเป็นค่าใหม่ ไม่ใช่ใช้ 'line' แล้วเดาจาก min_at_req is null:
--   สโตร์ต้องรู้ด้วยตาว่า "ระบบเสนอ" หรือ "คนขอเอง" (คนละน้ำหนักเวลาจัดคิว) และต้องวัดได้ว่า
--   เดือนนี้ขอเองกี่ใบ = รายการพาร์ทที่ควรไปตั้ง min · เดาจากช่องว่าง = กฎที่พังเงียบวันหลัง
--
-- Blast radius: ทุกจุดที่อ่าน `source` เทียบ `=== 'store_forecast'` แล้วที่เหลือถือเป็นฝั่งไลน์
--   (LinePartCallPanel · HeijunkaKanban · utils/storeTvDemand) ⇒ ค่าใหม่ตกเข้าสาขา "ไลน์ขอเบิก"
--   เองโดยไม่ต้องแก้ตรรกะ · ไม่มี view/trigger/RLS ไหนอ้าง `source`
--
-- 🔙 Rollback: ต้องย้ายแถวที่ใช้ค่าใหม่กลับก่อน ไม่งั้น add constraint จะล้ม
--   update public.wip_replenish_requests set source = 'line' where source = 'line_adhoc';
--   alter table public.wip_replenish_requests drop constraint if exists wip_replenish_source_chk;
--   alter table public.wip_replenish_requests add constraint wip_replenish_source_chk
--     check (source = any (array['line'::text, 'store_forecast'::text]));
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.wip_replenish_requests
  drop constraint if exists wip_replenish_source_chk;

alter table public.wip_replenish_requests
  add constraint wip_replenish_source_chk
  check (source = any (array['line'::text, 'line_adhoc'::text, 'store_forecast'::text]));

comment on column public.wip_replenish_requests.source is
  'ที่มาของใบ: line = ระบบเสนอเพราะยอดถึง min · line_adhoc = หัวหน้าไลน์ขอเบิกเอง (ไม่ต้องมี min) · store_forecast = สโตร์สร้างจากแผนผลิต';

-- ตรวจผล:
--   select con.conname, pg_get_constraintdef(con.oid)
--     from pg_constraint con join pg_class c on c.oid = con.conrelid
--    where c.relname = 'wip_replenish_requests' and con.conname = 'wip_replenish_source_chk';
--   -- ต้องเห็น 3 ค่า: line · line_adhoc · store_forecast
