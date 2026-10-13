-- DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-13 · user ระบุรหัสพื้นที่ PD4
-- 🏬 ลงทะเบียน SLoc ของ PD4 + แปะ ledger ย้อนหลัง
--   *"GOR (PD4) ทั้ง ASSY และ LASER = P410 · LWR BAR (PD4) ทั้ง ASSY และ LASER = P412"*
--
-- ผูกชื่อ "ไลน์แม่ + ไลน์ลูกทุกตัว" ลง `line_names` ตรงๆ ตามกติกา 12/10 —
--   trigger `fn_stock_txn_fill_sloc` (DR) จับคู่ตรงตัว และ DR ไม่มีผังไลน์ให้ไล่หาแม่
--   (ฝั่งจอ `slocOfLine` ไล่หาแม่ได้อยู่แล้ว ⇒ ใส่ลูกด้วยไม่เปลี่ยนผลลัพธ์ แค่ทำให้ฝั่ง DB ตรงกัน)
--   ลูกจาก production_lines (Main) ณ 13/10: GOR → Assy GOR · Laser GOR
--                                           LWR BAR → "Assy  LWR" (**เว้นวรรค 2 ช่องตามทะเบียนจริง**) · Laser LWR
--   ⚠️ `Office PD4` ไม่ได้ผูก (user ไม่ได้ระบุ · ไม่มียอดใน ledger) — ห้ามเดา
--
-- ยอดก่อนรัน: storage_location is null = 1,618 แถว (Assy GOR 998 · Assy  LWR 94 ·
--   "Assembly Line D - GWM&RA" 521 — เดิมชื่อ ASSEMBLY 1 เปลี่ยนชื่อ 13/10 · D5 2 · D6 3)
--   รอบนี้แปะได้ 1,092 (P410 998 · P412 94) ⇒ เหลือ 526 แถวของ PD2 ที่ยังไม่มีรหัส (รอ user ระบุ)
-- หมายเหตุ: `P412` ถูกอ้างใน `bom_items` อยู่แล้ว 12 บรรทัด (เคยเป็น "รหัสกำพร้า" ที่แผงพื้นที่เตือน) ⇒ รอบนี้หายเตือน
-- Blast radius: 2 แถวใหม่ใน `storage_locations` + คอลัมน์ `storage_location` ของ `line_stock_transactions`
--   (ไม่แตะ qty/status) · ปลายทางที่เปลี่ยนตาม = `v_sloc_stock` + ป้าย 🏬 บนจอ

create schema if not exists archive;

create table if not exists archive.lst_sloc_backfill_20261013_pd4 as
  select id from public.line_stock_transactions
   where storage_location is null
     and line_name in ('GOR','Assy GOR','Laser GOR','LWR BAR','Assy  LWR','Laser LWR');
alter table archive.lst_sloc_backfill_20261013_pd4 enable row level security;

insert into public.storage_locations (code, name, kind, sort_order, line_names, note, is_active)
values ('P410', 'พื้นที่ผลิต GOR (Assy · Laser)',     'production', 23,
        array['GOR','Assy GOR','Laser GOR'],            'PD4 · user ระบุ 13/10', true),
       ('P412', 'พื้นที่ผลิต LWR BAR (Assy · Laser)', 'production', 24,
        array['LWR BAR','Assy  LWR','Laser LWR'],       'PD4 · user ระบุ 13/10', true)
on conflict (code) do update
   set name = excluded.name, kind = excluded.kind, sort_order = excluded.sort_order,
       line_names = excluded.line_names, note = excluded.note, is_active = true;

update public.line_stock_transactions t
   set storage_location = s.code
  from public.storage_locations s
 where t.storage_location is null
   and s.is_active
   and s.line_names @> array[t.line_name];

-- ══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════════
--   select code, line_names from storage_locations where code in ('P410','P412');
--   select storage_location, line_name, count(*) from line_stock_transactions
--    where line_name in ('Assy GOR','Assy  LWR') group by 1,2;          -- ต้องได้ P410 998 · P412 94
--   select line_name, count(*) from line_stock_transactions where storage_location is null group by 1;
--   -- ต้องเหลือเฉพาะ ASSEMBLY 1 / Line D5 / Line D6 (PD2 ยังไม่มีรหัส)
--
-- ══ ย้อน (ลำดับนี้) ═════════════════════════════════════════════════════════════
--   update public.line_stock_transactions t set storage_location = null
--     from archive.lst_sloc_backfill_20261013_pd4 a where a.id = t.id;
--   delete from public.storage_locations where code in ('P410','P412');
