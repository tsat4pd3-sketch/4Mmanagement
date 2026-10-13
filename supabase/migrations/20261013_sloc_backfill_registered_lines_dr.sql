-- DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-13
-- 🏬 แปะ SLoc ย้อนหลังให้ ledger ของ "ไลน์ที่ลงทะเบียนพื้นที่แล้ว" (ต่อจาก 20261012_sloc_child_lines_backfill_dr.sql)
--
-- อาการ: ทะเบียน `storage_locations` มีไลน์ปั๊มครบแล้ว (P401 LINE C · P405 LINE D · P406 LINE B · P407 LINE A
--   — ลงหลังรอบ backfill 12/10) และ `line_delivery_points` ของ 4 ไลน์นั้นได้รหัสแล้วตอนบันทึกจุด
--   แต่ `line_stock_transactions` ยังว่าง 602 แถว เพราะ trigger `fn_stock_txn_fill_sloc` เติมได้แค่ตอน insert
--   ⇒ แถวที่เขียนไว้ "ก่อน" วันลงทะเบียน ไม่มีใครย้อนไปแปะ ⇒ `v_sloc_stock` ยอดต่ำกว่าจริงที่ P401/405/406/407
--
-- ยอดก่อนรัน (12/10 → 13/10): storage_location is null = 2,218 แถว
--   แปะได้ด้วยทะเบียนปัจจุบัน 602: P401 191 · P405 163 · P406 172 · P407 76
--   เหลือว่าง 1,616 แถว = ไลน์ที่ **ยังไม่มีใครลงทะเบียนพื้นที่** (ห้ามเดาแทนคน — กฎ `slocOfLine` คืน null)
--     Assy GOR 998 · ASSEMBLY 1 519 · Assy  LWR 94 · Line D6 - Sub Assembly 3 · Line D5 - BRK RR BMPR 2
--   ⇒ จุดส่ง PD2 7 จุดยังขึ้นป้าย "🏬 ไม่ผูกพื้นที่ SAP" ตามจริง (ถูกต้อง ไม่ใช่บั๊ก)
--
-- ⚠️ P411 (Apron Assy) ไม่ต้องแก้อะไรในรอบนี้ — ทะเบียนครอบครบทั้งแผนกแล้วตั้งแต่ 12/10:
--      line_names = {Line 60, Line 61, LINE APRON ASSY, SUB APRON} = ลูกทั้งหมดของ LINE APRON ASSY (PD3)
--      ledger ของ 4 ไลน์นั้น storage_location is null = 0 แถว
--
-- จับคู่ด้วยตรรกะเดียวกับ trigger (`line_names @> array[line_name]`) และกับปุ่ม ♻️ ใน StorageLocPanel
--   (เฉพาะแถวที่ยัง null · ไม่ทับที่แปะแล้ว · รันซ้ำได้) · ตรวจแล้วว่าไม่มีไลน์ไหนอยู่ 2 SLoc พร้อมกัน
-- Blast radius: คอลัมน์ `storage_location` ของ `line_stock_transactions` เท่านั้น (ไม่แตะ qty/status/ยอดคงเหลือ)
--   ปลายทางที่เปลี่ยนตาม = `v_sloc_stock` (มุมบัญชี SAP) — มุม WIP ของเรา (line_part_levels) ไม่พึ่งคอลัมน์นี้

create schema if not exists archive;

-- ภาพก่อนแก้ (ย้อนได้)
create table if not exists archive.lst_sloc_backfill_20261013 as
  select t.id
    from public.line_stock_transactions t
    join public.storage_locations s on s.is_active and s.line_names @> array[t.line_name]
   where t.storage_location is null;
alter table archive.lst_sloc_backfill_20261013 enable row level security;

update public.line_stock_transactions t
   set storage_location = s.code
  from public.storage_locations s
 where t.storage_location is null
   and s.is_active
   and s.line_names @> array[t.line_name];

-- ══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════════
--   select line_name, count(*) from line_stock_transactions where storage_location is null group by 1 order by 2 desc;
--   -- ต้องไม่มี LINE A/B/C/D อีก · ที่เหลือต้องเป็นไลน์ที่ยังไม่ลงทะเบียน (ASSEMBLY 1 · Assy GOR · Assy  LWR · Line D5/D6)
--   select storage_location, count(*) from line_stock_transactions group by 1 order by 1;
--
-- ══ ย้อน ════════════════════════════════════════════════════════════════════════
--   update public.line_stock_transactions t set storage_location = null
--     from archive.lst_sloc_backfill_20261013 a where a.id = t.id;
