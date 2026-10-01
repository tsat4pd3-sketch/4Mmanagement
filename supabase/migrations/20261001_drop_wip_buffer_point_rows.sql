-- ══ 🗑️ ล้างแถว "จุด WIP" ทิ้ง — เลิกชั้นจุดย่อยในไลน์ (คำสั่ง user 2026-10-01) ═══════════
-- Target project: Main — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- บริบท: โค้ดฝั่งจอถอดทางเขียนออกหมดแล้ว (merge a9c471d2) — ไฟล์นี้เก็บกวาด "แถวที่ค้าง"
-- ไม่ drop ตาราง เพราะ `wip_replenish_requests.wip_point_id` ยังอ้างถึงอยู่ และเราเก็บโครง
-- ไว้อ่านประวัติ · ตรวจแล้วไม่มีใบไหนผูกจุด (0 ใบ) การลบแถวจึงไม่ทำให้เกิดใบกำพร้า
--
-- ทำไมต้องทิ้ง (วัดกับฐานจริง 01/10):
--   · ใบขอเติม 25 ใบ ผูกจุด WIP 0 ใบ — ทางเดินนี้ไม่เคยถูกใช้จริง
--   · current_qty ของ 10 จุดที่มียอด เท่ากับ min เป๊ะทุกตัว ไม่ขยับตั้งแต่ 1 ก.ย. = ยอดปลอม
--   · 18 จุดที่เหลือเป็นชื่อซ้ำที่ต่างกันแค่ช่องว่างท้ายบรรทัด / max=1-2 (นับภาชนะ) / แถว test
--   · 6 จุดที่ตั้ง min จริง ชื่อจุดไม่ใช่เลข MAT (088-AA · 16C172 · PIPE HDF1 LH …) map ไม่ได้
--     โดยไม่เดา → user สั่ง "ทิ้งเลย" แล้วไปตั้ง min/max ใหม่ที่ `line_part_levels` ผ่านจอ
--
-- ⚠️ สำเนาเต็มอยู่ `archive.wip_buffer_points_20261001` (24 แถว · RLS เปิด) — คืนค่าได้
-- ⚠️ ตามกฎโปรเจค: ตารางสำรองต้องอยู่ schema `archive` ห้ามไว้ public

create schema if not exists archive;

create table if not exists archive.wip_buffer_points_20261001 as
  select * from public.wip_buffer_points;
alter table archive.wip_buffer_points_20261001 enable row level security;

truncate table public.wip_buffer_points;

-- ── ตรวจหลังรัน ──
-- select count(*) from public.wip_buffer_points;                              -- 0
-- select count(*) from archive.wip_buffer_points_20261001;                    -- 24
-- select count(*) from wip_replenish_requests where wip_point_id is not null; -- 0 (ไม่มีใบกำพร้า)

-- Rollback:
--   insert into public.wip_buffer_points
--     select * from archive.wip_buffer_points_20261001
--     on conflict (id) do nothing;
--   (ถอยโค้ดก่อน แล้วค่อยคืนข้อมูล: git revert -m 1 a9c471d2)
