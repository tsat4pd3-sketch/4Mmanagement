-- ═══ "รหัสคลังนี้ถูกใช้ที่ไหนบ้าง" — นับฝั่ง DB แทนการลากแถวดิบมานับในหน้า ═══
-- QC audit 15/10 · project: DR ("Product DB" · eyhclzkifitbhbljgoav)
--
-- 🔴 ปัญหาที่แก้ (`src/components/StorageLocPanel.jsx` · ด่านลบรหัสคลัง):
--   ด่าน fail-closed เขียนไว้ถูกแล้ว ("นับไม่ได้ = ห้ามลบ") แต่มัน **ตาบอดเรื่องการถูกตัดแถว**:
--     line_stock_transactions.select('storage_location').limit(1000)
--   วัดจริง 15/10: ตารางนี้ **23,195 แถว · ติดรหัสแล้ว 22,651 แถว · รหัสต่างกันแค่ 10 ตัว**
--   ⇒ โค้ดเห็นแค่ 1,000 แถวแรก และ **ไม่มี `.order()`** ⇒ ลำดับไม่คงที่
--   ⇒ รหัสที่ถูกใช้แต่ในใบเก่าๆ "หายจากชุดที่นับได้" ⇒ ด่านเชื่อว่านับครบ แล้ว**ปล่อยให้ลบ**
--     = ledger ย้อนหลังอ้างรหัสที่ไม่มีในทะเบียนอีกแล้ว (กฎ: ทะเบียนที่จับคู่ด้วยข้อความ
--       ลบได้หลังนับปลายทางครบ — นับไม่ได้ = ห้ามลบ)
--   ⇒ แถมลาก 22,651 แถวมาเพื่อเอาค่า distinct 10 ตัว = egress เปล่า (กฎเหล็ก DB ข้อ 11)
--
-- ✅ ตัวนี้คืน "รหัส + จำนวนที่อ้างถึง แยกตามปลายทาง" — payload เล็ก ไม่มีเพดาน นับครบทุกแถว
--    จอยังเป็นผู้ตัดสิน (ห้าม/ไม่ห้ามลบ) เหมือนเดิม · อ่านไม่ได้ = จอถือว่า "นับไม่ได้" (fail-closed)
--    normalize ด้วย upper(btrim(...)) ให้ตรงกับ `slocLabel()` ฝั่งจอ (src/utils/storageLoc.js)
-- ย้อนกลับ: drop function public.dr_sloc_usage();  (จอ fallback ไปทางเดิมได้ ไม่พัง)

create or replace function public.dr_sloc_usage()
returns table (code text, in_bom bigint, in_ledger bigint, in_delivery bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select upper(btrim(storage_location)) c, count(*) n from public.bom_items
    where is_active = true and btrim(coalesce(storage_location, '')) <> '' group by 1
  ), l as (
    select upper(btrim(storage_location)) c, count(*) n from public.line_stock_transactions
    where btrim(coalesce(storage_location, '')) <> '' group by 1
  ), d as (
    select upper(btrim(storage_location)) c, count(*) n from public.line_delivery_points
    where btrim(coalesce(storage_location, '')) <> '' group by 1
  ), all_codes as (
    select c from b union select c from l union select c from d
  )
  select a.c, coalesce(b.n, 0), coalesce(l.n, 0), coalesce(d.n, 0)
  from all_codes a
  left join b on b.c = a.c
  left join l on l.c = a.c
  left join d on d.c = a.c
$$;

grant execute on function public.dr_sloc_usage() to anon, authenticated;

comment on function public.dr_sloc_usage() is
  'รหัสคลังที่ถูกอ้างอิง + จำนวนแยกตามปลายทาง (BOM / ledger / จุดส่ง) — แทนการลาก line_stock_transactions 22,651 แถวมานับในหน้าแบบ limit(1000) ซึ่งนับไม่ครบและไม่มี order (QC audit 2026-10-15)';
