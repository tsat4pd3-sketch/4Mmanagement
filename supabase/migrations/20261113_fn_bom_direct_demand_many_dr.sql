-- ════════════════════════════════════════════════════════════════════════════
-- `fn_bom_direct_demand_many` — แตก BOM หลาย FG ในคำขอเดียว · DR ("Product DB" · eyhclzkifitbhbljgoav)
--                                                                        2026-11-13
-- ที่มา (วัด 10-11/11/2026): `rpc/fn_bom_direct_demand` ถูกเรียก **25,512 ครั้ง/วัน**
--   = 59% ของ POST ทั้งหมดฝั่ง DR · มาจากจุดเดียว `src/lib/lineDemandSync.js`
--   ที่เขียนว่า `Promise.all(mats.map(m => rpc('fn_bom_direct_demand', { p_fg_mat: m })))`
--   = **1 คำขอ HTTP ต่อ 1 MAT (N+1)** คูณจำนวนจอที่เปิดอยู่
--   ⇒ วัด 13/11: ใบผลิตที่เปิดอยู่ 29 MAT = 29 คำขอ/รอบโหลด ต่อ 1 จอ
--
-- 🔑 **ตัวนี้ไม่ได้เขียนตรรกะ BOM ใหม่** — มัน `cross join lateral` เรียก `fn_bom_direct_demand`
--    ตัวเดิมทีละ MAT ⇒ **ผลลัพธ์เหมือนเดิมเป๊ะโดยโครงสร้าง** ไม่มีทางแตกต่าง
--    ที่ลดคือ **จำนวนคำขอ HTTP** ไม่ใช่ภาระ DB
--    🔴 ห้ามก๊อปตรรกะ recursive ของตัวเดิมมาไว้ที่นี่ — กฎ BOM มีชุดเดียว (CLAUDE.md §BOM)
--
-- 🔴 เพดาน 1000 แถวของ PostgREST: ฝั่ง client **ต้องแบ่งก้อน + เช็คว่าชนเพดานไหม**
--    (ดู `BOM_MANY_CHUNK` ใน `src/lib/lineDemandSync.js`) — วัด 13/11: 29 MAT = 109 แถว
--    แต่ถ้าเปิดครบทุกสินค้า (243 ตัว) จะ ~900 แถว = **ใกล้เพดานเกินไปที่จะยิงทีเดียว**
--
-- ของเดิมไม่ถูกแตะเลย: `fn_bom_direct_demand(text)` ยังอยู่ครบ และยังมีคนใช้อยู่จริง
--   (trigger `fn_explode_child_demand` ตอน confirm ใบผลิต) — **ห้ามถอด**
--
-- ย้อนกลับ: drop function if exists public.fn_bom_direct_demand_many(text[]);
--           (แล้ว revert โค้ดฝั่ง client — ของเดิมยังเรียกตัวเก่าได้ทันที)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.fn_bom_direct_demand_many(p_fg_mats text[])
returns table (
  fg_mat       text,
  mat_no       text,
  part_name    text,
  qty_per_unit numeric,
  source_line  text,
  via_phantom  text
)
language sql
stable
as $function$
  select f.fg_mat, d.mat_no, d.part_name, d.qty_per_unit, d.source_line, d.via_phantom
    from (
      -- ซ้ำในอาเรย์ = แตกซ้ำโดยเปล่าประโยชน์ · ว่าง/null = ข้าม (ตัวเดิมก็คืนศูนย์แถวอยู่แล้ว)
      select distinct btrim(m) as fg_mat
        from unnest(coalesce(p_fg_mats, '{}'::text[])) as t(m)
       where coalesce(btrim(m), '') <> ''
    ) f
    cross join lateral public.fn_bom_direct_demand(f.fg_mat) d;
$function$;

-- สิทธิ์ให้ตรงกับ `fn_bom_direct_demand` ตัวเดิม (ฝั่ง DR วิ่งด้วย role `anon` เสมอ)
grant execute on function public.fn_bom_direct_demand_many(text[]) to anon, authenticated, service_role;
