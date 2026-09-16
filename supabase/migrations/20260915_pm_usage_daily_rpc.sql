-- ══════════════════════════════════════════════════════════════════════════
-- RPC `pm_usage_daily` — ยอดผลิตรายไลน์รายวัน (สำหรับ PM แบบ condition-based)  2026-09-15
-- Project: DR / "Product DB" (eyhclzkifitbhbljgoav)
--
-- 🔴 ที่มา — บั๊กเงียบที่เจอตอนทำ condition-based PM:
--    หน้า /pm-forecast ดึงใบผลิตดิบมาคำนวณเองด้วย
--      supabase.from('prod_orders').select(...).gte('work_date', <120 วันก่อน>)
--    แต่ช่วง 120 วันมีใบ confirmed **13,073 ใบ** ⇒ ชน "เพดาน 1000 แถว/คิวรี"
--    ได้ข้อมูลจริงแค่ ~7.6% **โดยไม่มี error** ⇒ ยอดสะสม / อัตราต่อวัน / buffer
--    ที่โชว์บนจอต่ำกว่าความจริงหลายเท่า (กฎเหล็กข้อ 5 ใน CLAUDE.md)
--
--    แก้ด้วยการ "รวมยอดฝั่ง server" แทน: 120 วัน = (ไลน์ × วัน) เพียง **575 แถว**
--    ⇒ ไม่ชนเพดาน · payload เล็กลง ~23 เท่า · คนละเรื่องกับการเพิ่ม limit (ซึ่งยังชนอยู่ดี)
--
-- ⚠️ ทำไมไม่รวมถึงระดับ "แผน PM" ไปเลยในฟังก์ชันนี้:
--    การกางครอบครัวไลน์ (แม่-ลูก) ต้องใช้ `production_lines` ซึ่งอยู่ **Main project คนละฐาน**
--    SQL ฝั่ง DR join ข้ามไม่ได้ ⇒ คืนยอดรายไลน์ แล้วให้ client รวมครอบครัวด้วย
--    `src/utils/pmUsage.js` (สูตรเดียวของทั้งระบบ · มีเทส)
--
-- ⚠️ นับจาก `qty` เท่านั้น (ไม่ใช่ qty_ok/qty_actual) — เหตุผลอยู่ในหัวไฟล์ pmUsage.js
--    วัดฐานจริง 15/09: qty ครบ 13,073 ใบ · qty_ok null 173 ใบ · qty_actual = 0 ถึง 11,641 ใบ (89%)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.pm_usage_daily(p_days integer default 120)
returns table (line_name text, work_date date, qty numeric, orders integer)
language sql
stable
security definer
set search_path = public
as $function$
  select ps.line_name,
         ps.work_date,
         sum(coalesce(po.qty, 0))::numeric as qty,
         count(*)::integer               as orders
    from public.prod_orders po
    join public.production_sessions ps on ps.id = po.session_id
   where po.status = 'confirmed'
     and ps.line_name is not null
     and ps.work_date >= ((now() at time zone 'Asia/Bangkok')::date - greatest(1, least(coalesce(p_days, 120), 730)))
   group by ps.line_name, ps.work_date
$function$;

-- ฝั่ง DR ไม่มี JWT (supabaseDR เป็น anon เสมอ — กฎเหล็กใน CLAUDE.md) ⇒ ต้องเปิดให้ anon
grant execute on function public.pm_usage_daily(integer) to anon, authenticated;

-- ตรวจผล (ควรได้ ~575 แถว · ไม่ใช่ 1000 พอดี = ไม่ชนเพดาน):
--   select count(*) from public.pm_usage_daily(120);
--   select * from public.pm_usage_daily(30) order by work_date desc limit 5;
-- Rollback:
--   drop function if exists public.pm_usage_daily(integer);
