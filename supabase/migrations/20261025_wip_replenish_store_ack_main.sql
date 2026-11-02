-- ═══ 🔊 "สโตร์ได้ยินแล้ว" — ช่องรับทราบเสียงเตือนใบขอเบิกจากไลน์ ═════════════════════════
-- Project: **Main** (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)
-- วันที่: 2026-10-25
--
-- ทำไม (คำสั่ง user 24/10): *"เวลาเบิกของ สโตร์ ต้องได้ยินเสียงแจ้งเตือน เหมือนเวลา MTN
--   ได้ยินเสียงเรียกช่าง"* ⇒ ไซเรนต้องดังวนจนมีคน "รับทราบ" เหมือน `downtime_logs.call_mtn_ack_at`
--   (ของฝั่งช่างใช้ช่องนี้มาตั้งแต่ 07/2026 · ดู `components/DowntimeSiren.jsx`)
--
-- ทำไมต้องมีช่องใหม่ ไม่ใช้ `picked_at` (กด "เริ่มเตรียม") เป็นตัวหยุดเสียง:
--   "เริ่มเตรียม" ต้องสแกนพาร์ทที่ชั้นวาง = ทำจากจอแขวนไม่ได้ ⇒ ถ้าใช้ตัวนั้นหยุดเสียง
--   ไซเรนจะดังต่อเนื่องเป็นสิบนาทีระหว่างคนเดินไปหยิบ แล้วคนจะปิดเสียงทั้งจอ (= เงียบตลอดกาล)
--   ⇒ แยก "ได้ยินแล้ว กำลังไป" (ช่องนี้) ออกจาก "หยิบของแล้ว" (`picked_at`)
--
-- 🔴 ช่องนี้ **หยุดเสียงเท่านั้น ไม่ใช่สถานะงาน** — ใบยังเป็น `pending` อยู่ในคิวสโตร์เหมือนเดิม
--   (กฎ CLAUDE.md: ห้ามเพิ่มช่องที่ต้องมีคนกดปิดแล้วกลายเป็นของค้างเทียม — ที่นี่ไม่กดก็ไม่ค้าง
--    แค่เสียงดังต่อ · และไม่มีจอไหนเอาช่องนี้ไปกรองใบออกจากคิว)
--
-- Blast radius: คอลัมน์ใหม่ nullable ล้วน · ไม่มี view/trigger/RLS ไหนอ้าง · ใบเก่าทั้ง 120 ใบ
--   ได้ค่า null = "ยังไม่รับทราบ" ซึ่งถูกต้อง (ไซเรนดังเฉพาะใบ `pending` ซึ่งตอนนี้มี 2 ใบ)
--
-- 🔙 Rollback: alter table public.wip_replenish_requests
--                drop column if exists store_ack_at, drop column if exists store_ack_by_name,
--                drop column if exists store_ack_by_uid;
--   (ไซเรนฝั่งสโตร์จะถอยไปสถานะ "คอลัมน์ยังไม่มี" ⇒ `StoreCallSiren` ตรวจ 42703 แล้วเลิกกรอง
--    = ดังตามใบ pending เหมือนเดิม ไม่ล่ม)
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.wip_replenish_requests
  add column if not exists store_ack_at      timestamptz,
  add column if not exists store_ack_by_name text,
  add column if not exists store_ack_by_uid  uuid;

comment on column public.wip_replenish_requests.store_ack_at is
  'สโตร์กด "รับทราบ" เสียงเตือนใบนี้แล้วเมื่อไหร่ — หยุดไซเรนเท่านั้น ไม่ใช่สถานะงาน (ใบยังรอหยิบอยู่)';

-- ตรวจผล:
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema='public' and table_name='wip_replenish_requests'
--      and column_name like 'store_ack%' order by 1;
--   -- ต้องเห็น 3 แถว · is_nullable = YES ทั้งหมด
