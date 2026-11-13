-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🌳 Single source ของผัง BOM — ผังอยู่ในใบแม่ใบเดียว · ลูกไม่ต้องมีใบของตัวเอง
--    DR project — "Product DB" · eyhclzkifitbhbljgoav              2026-11-05 · คำสั่ง user
--    ✅ apply แล้ว 5/11 ผ่าน MCP  ·  ⛔ **ห้ามรันซ้ำ** (บล็อกด้วย archive table ด้านล่าง)
--
-- คำสั่ง user: *"งานที่ซ้ำตรงกัน แม่ลงหลานไว้ ในลูกก็ไม่ต้องลงแล้วรึป่าว ได้เป็น single source
--   ไล่ปรับให้เลย"* + *"ไล่แก้ให้ตรงกฎ BOM ที มันเยอะ แก้เสร็จแล้วบอก เดี๋ยวค่อยให้ PE เช็ค"*
--   ⇒ เป็นการ**ยกเว้นกฎเดิม 19/10 ("จอชี้อย่างเดียว ห้ามแก้ bom_items ให้เอง") เฉพาะครั้งนี้**
--     กฎของ *จอ* ยังเหมือนเดิม — จอยังไม่ยุบ/ลบให้เอง · งานนี้เป็น migration ครั้งเดียวที่ user สั่ง
--
-- ทำอะไร: ปิด (is_active=false) แถว "ใบ BOM ของตัวลูกเอง" เมื่อผังของลูกถูกกางไว้ในใบแม่แล้ว
--   ⇒ `fn_bom_kid_rows` ② (ใบของตัวเอง) ว่าง → ตกไป ③ (ใบที่นิยามลูกไว้) = ใบแม่ · โซ่ยังเดินครบ
-- 🔴 ปิด ไม่ลบ · แถวเดิมสำรองครบใน `archive.bom_items_child_sheets_20261105`
--
-- แบ่งกลุ่มตามความเสี่ยง (เทียบลายเซ็น "ลูก×qty" ของทุกใบที่นิยาม mat นั้น):
--   A  ทุกใบเขียนตรงกัน                        → ปิดใบลูก · ยอดไม่เปลี่ยนเลย        13 mat
--   B  ใบลูกต่างจากใบแม่ แต่ใบแม่ตรงกันเอง      → ปิดใบลูก · **ใบแม่ (นำเข้าจาก SAP) ชนะ**  20 mat
--   C  ใบแม่เองยังเขียนไม่ตรงกัน                → **ไม่แตะ** PE ต้องตัดสินก่อน         2 mat
--      (`20058626`, `20066332`)
--
-- 🔴 ด่านความปลอดภัย: ปิดแล้วต้องไม่มี mat ไหน "ไม่ถูกตัดที่ไหนเลย"
--    รอบแรกเจอหลุด 3 ตัว (`20067543` คงเหลือ 2,825 · `20066630` · `20070738`) เพราะใบลูก
--    2 ใบ (`20067545`, `20070036`) มีของที่ใบแม่ไม่มี ⇒ **คืนทั้ง 2 ใบ** ปล่อยให้ PE ตัดสิน
--
-- ผลสุดท้าย (เทียบ before/after ของ `fn_bom_direct_demand` ทุก FG):
--   ปิดจริง 81 แถว · 31 ใบลูก · 452 คู่เท่าเดิม · 1 คู่ qty เปลี่ยน (20059369→30042566 2⇒1 · SAP ชนะ)
--   · 35 คู่เลิกตัดที่ใบนั้น (ย้ายไปตัดที่ใบแม่) · 12 คู่เกิดใหม่ · **mat หลุดจากระบบ = 0** ·
--   โซ่ขาด 16 → 13
--
-- ย้อนทั้งหมด:
--   update public.bom_items b set is_active = true
--     from archive.bom_items_child_sheets_20261105 a where b.id = a.id;
-- ═══════════════════════════════════════════════════════════════════════════════════════

create schema if not exists archive;

do $run$
begin
  if to_regclass('archive.bom_items_child_sheets_20261105') is not null then
    raise notice 'เคยรันแล้ว (archive.bom_items_child_sheets_20261105 มีอยู่) — ข้าม';
    return;
  end if;

  -- ① ภาพ "ตัดอะไรบ้าง" ก่อนแก้ ไว้เทียบ
  execute $q$
    create table archive.bom_deduct_before_20261105 as
      select p.mat_no as fg, d.mat_no, d.qty_per_unit
        from public.dr_products p
        cross join lateral public.fn_bom_direct_demand(p.mat_no) d
       where p.is_active $q$;

  -- ② สำรองแถวใบลูกที่เข้าเกณฑ์ A/B (เก็บทุกคอลัมน์ + กลุ่ม)
  execute $q$
    create table archive.bom_items_child_sheets_20261105 as
    with own_rows as (
      select b.*, upper(btrim(p.mat_no)) as owner_mat
        from public.bom_items b join public.dr_products p on p.id = b.product_id
       where b.is_active and p.is_active
         and (b.parent_mat is null or upper(btrim(b.parent_mat)) = upper(btrim(p.mat_no)))),
    own_sig as (
      select owner_mat m, string_agg(upper(btrim(mat_no))||'×'||qty_per_unit::text,'|'
               order by upper(btrim(mat_no)), qty_per_unit) sig
        from own_rows group by owner_mat),
    par_sig as (
      select upper(btrim(b.parent_mat)) m, b.product_id sheet_id,
             string_agg(upper(btrim(b.mat_no))||'×'||b.qty_per_unit::text,'|'
               order by upper(btrim(b.mat_no)), b.qty_per_unit) sig
        from public.bom_items b join public.dr_products p on p.id = b.product_id
       where b.is_active and p.is_active and b.parent_mat is not null
         and upper(btrim(b.parent_mat)) <> upper(btrim(p.mat_no))
       group by 1,2),
    grp as (
      select o.m, case when count(distinct pa.sig) > 1 then 'C'
                       when o.sig = min(pa.sig)        then 'A'
                       else 'B' end as grp
        from own_sig o join par_sig pa on pa.m = o.m
       group by o.m, o.sig)
    select r.*, g.grp from own_rows r join grp g on g.m = r.owner_mat
     where g.grp in ('A','B') $q$;

  -- ③ ปิดแถวใบลูก
  update public.bom_items b set is_active = false
    from archive.bom_items_child_sheets_20261105 a
   where b.id = a.id and b.is_active;

  -- ④ 🔴 ด่าน: คืนใบลูกที่มีของซึ่งใบแม่ไม่มี (ไม่งั้นของหายเงียบ)
  update public.bom_items b set is_active = true
    from archive.bom_items_child_sheets_20261105 a
   where b.id = a.id and not b.is_active
     and a.product_id in (
       select distinct a2.product_id
         from archive.bom_items_child_sheets_20261105 a2
         join (select distinct bf.mat_no m
                 from archive.bom_deduct_before_20261105 bf
                where not exists (select 1 from public.dr_products p
                                   cross join lateral public.fn_bom_direct_demand(p.mat_no) d
                                  where p.is_active and d.mat_no = bf.mat_no)) lost
           on lost.m = a2.mat_no);
end
$run$;

-- ═══ คิวรีตรวจ (รันบน "Product DB" · eyhclzkifitbhbljgoav) ════════════════════════════
-- ❶ 🔑 ด่านสำคัญ — ต้องได้ 0: mat ที่เคยถูกตัด แล้วตอนนี้ไม่มีใบไหนตัดเลย
--   with aft as (select distinct d.mat_no m from dr_products p
--         cross join lateral fn_bom_direct_demand(p.mat_no) d where p.is_active)
--   select count(distinct b.mat_no) from archive.bom_deduct_before_20261105 b
--    where not exists (select 1 from aft x where x.m = b.mat_no);
-- ❷ ปิดไปกี่แถว กี่ใบ (5/11 = 81 แถว · 31 ใบ)
--   select count(*) , count(distinct b.product_id) from bom_items b
--    where exists (select 1 from archive.bom_items_child_sheets_20261105 a where a.id=b.id)
--      and not b.is_active;
-- ❸ ของที่ PE ต้องตัดสินต่อ — ใบแม่เองยังขัดกัน (กลุ่ม C) + ใบลูกที่คืนไว้
--   select distinct owner_mat from archive.bom_items_child_sheets_20261105 a
--     join bom_items b on b.id=a.id where b.is_active;
-- ═════════════════════════════════════════════════════════════════════════════════════
