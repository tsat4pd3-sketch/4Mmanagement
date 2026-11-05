-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🧪 "โซ่ขาด" ต้องไม่นับของที่ถูกตัดด้วยวงจรจ้างทำภายนอก (ชุบ)
--    DR project — "Product DB" · eyhclzkifitbhbljgoav              2026-11-05 · แก้ของตัวเอง
--    ✅ apply แล้ว 5/11 ผ่าน MCP
--
-- บั๊กที่ผมทำเอง: `fn_bom_deduct_gaps()` (migration 20261104) ถือว่า "ไม่มีใบ BOM ไหนตัด = โซ่ขาด"
--   แต่ระบบมีกลไกตัดอีกทางที่ไม่ใช่ BOM อยู่แล้ว = **วงจรชุบภายนอก** (`plating_orders` ·
--   migration 20261013) ซึ่ง `plating_send` ตัด "ก่อนชุบ" ออกจากคลังตอนส่งไปร้าน
--   ⇒ จอรายงานผิด 12 รายการ และจะส่ง PE ไปไล่ของที่ไม่ใช่ปัญหา
--
-- ของจริงตอนตรวจ (5/11): สโตร์ส่งชุบอยู่จริง **40 ใบ** (21/10 – 4/11) · ร้าน "บจก. จรูญรัตน์ โปรดักส์"
--   · `line_stock_transactions` ที่ note ขึ้นต้น 'ชุบ:' = **97 คู่ issue/consume · 49,210 ชิ้น**
--   · ของที่อยู่ร้านยังอยู่ในระบบจริง เช่น `20059346` 3,000 ชิ้นที่ "ร้านชุบ · บจก. จรูญรัตน์ โปรดักส์"
--     ตรงกับใบที่ยังไม่ปิดเป๊ะ
--   ⇒ ยอด "ก่อนชุบ" ที่เคยรายงานว่าค้าง 30,971 ชิ้น **ส่วนใหญ่คือของที่สโตร์ถืออยู่รอส่งรอบต่อไป**
--     (อยู่ที่ `STORE` / ไลน์) ไม่ใช่ของหาย
--
-- กฎใหม่: กันออกเมื่อ (ก) เคยมีใบส่งชุบจริง (`plating_orders.before_mat`) — พิสูจน์จากการใช้งาน
--         (ข) ตัวแม่ตั้งร้านจ้างทำไว้แล้ว (`dr_products.outsource_vendor`) — เส้นทางตั้งแล้วแต่ยังไม่ส่ง
-- 🔴 ห้ามกันออกด้วยการเดาจากชื่อ ("ก่อนชุบ"/"หลังชุบ") — ผิดกฎ "พจนานุกรมมาจากข้อมูลโรงงานเท่านั้น"
--
-- ผล: โซ่ขาด 23 → **16** รายการ (6 ตัวที่เหลือเป็นงานชุบที่ยังไม่ได้ตั้งเส้นทาง — ข้อความในจอ
--     บอกวิธีแก้ให้แล้ว · 10 ตัวเป็นของที่ไม่อยู่ในทะเบียนสินค้า)
--
-- ย้อน: create or replace ด้วย body ของ migration 20261104 (ตัด CTE `outsourced` + เงื่อนไขท้ายออก)
-- ═══════════════════════════════════════════════════════════════════════════════════════

create or replace function public.fn_bom_deduct_gaps()
returns table (
  mat_no text, part_name text, reason text,
  in_products boolean, own_orders bigint, on_hand numeric,
  hangs_under text, in_sheets text
) language sql stable as $fn$
  with defined as (
    select distinct upper(btrim(b.mat_no)) as m
      from public.bom_items b join public.dr_products p on p.id = b.product_id
     where b.is_active and p.is_active
  ),
  deducted as (
    select distinct upper(btrim(k.mat_no)) as m
      from public.dr_products p
      cross join lateral public.fn_bom_kid_rows(p.mat_no, null::uuid) k
     where p.is_active
  ),
  -- 🧪 ถูกตัดด้วยวงจรจ้างทำภายนอก ไม่ใช่ BOM
  outsourced as (
    select distinct upper(btrim(o.before_mat)) as m from public.plating_orders o
    union
    select distinct upper(btrim(b.mat_no))
      from public.bom_items b join public.dr_products p on p.id = b.product_id
     where b.is_active and p.is_active
       and coalesce(btrim(p.outsource_vendor), '') <> ''
  )
  select d.m,
    (select dp.name from public.dr_products dp where upper(btrim(dp.mat_no)) = d.m and dp.is_active limit 1),
    case
      when not exists (select 1 from public.dr_products dp
                        where upper(btrim(dp.mat_no)) = d.m and dp.is_active)
        then 'ไม่อยู่ในทะเบียนสินค้า — เปิดใบผลิตให้มันไม่ได้ ⇒ ต้องลงทะเบียน หรือย้ายไปห้อยใต้ตัวที่เปิดใบได้'
      when (select count(*) from public.prod_orders o
             join public.child_demand_explosions e on e.order_id = o.id
             where upper(btrim(o.mat_no)) = d.m) = 0
        then 'ตัวแม่ที่มันห้อยอยู่ไม่เคยเปิดใบผลิตเอง ⇒ โซ่ไม่เคยเดินถึงมัน'
      else 'ตัวมันเองมีใบผลิต แต่ไม่มีใบไหนตัดมันไปใช้ ⇒ ถ้าเป็นงานส่งชุบ/จ้างนอก '
           || 'ให้ตั้งร้านที่ "ตัวแม่" ในทะเบียนสินค้า แล้วรายการนี้จะหายจากลิสต์เอง '
           || '(สโตร์ส่งชุบผ่านแท็บ 🧪 งานชุบ) · ถ้าไม่ใช่ แม่ของมันชี้ผิดตัว'
    end,
    exists (select 1 from public.dr_products dp where upper(btrim(dp.mat_no)) = d.m and dp.is_active),
    (select count(*) from public.prod_orders o
       join public.child_demand_explosions e on e.order_id = o.id
      where upper(btrim(o.mat_no)) = d.m),
    coalesce((select sum(s.qty_on_hand) from public.line_stock_summary s
               where upper(btrim(s.mat_no)) = d.m), 0),
    (select string_agg(distinct coalesce(b2.parent_mat, p2.mat_no), ', ')
       from public.bom_items b2 join public.dr_products p2 on p2.id = b2.product_id
      where b2.is_active and p2.is_active and upper(btrim(b2.mat_no)) = d.m),
    (select string_agg(distinct p3.mat_no, ', ')
       from public.bom_items b3 join public.dr_products p3 on p3.id = b3.product_id
      where b3.is_active and p3.is_active and upper(btrim(b3.mat_no)) = d.m)
  from defined d
 where not exists (select 1 from deducted  x where x.m = d.m)
   and not exists (select 1 from outsourced y where y.m = d.m);
$fn$;

comment on function public.fn_bom_deduct_gaps() is
  'โซ่ขาด — mat ที่อยู่ใน BOM แต่ไม่มีใบไหนตัดมันเมื่อ confirm · 🔴 กันของที่ถูกตัดด้วยวงจรจ้างทำ
   ภายนอกออก (plating_orders / dr_products.outsource_vendor) เพราะนั่นไม่ใช่การตัดตาม BOM ·
   จอ /products?tab=phantom ต้องโชว์ ห้ามซ่อน ห้ามกลบด้วยการติ๊กของลม · ระบบชี้อย่างเดียว PE ตัดสิน';

-- ═══ คิวรีตรวจ ═════════════════════════════════════════════════════════════════════════
-- ❶ โซ่ขาดที่เหลือ (5/11 = 16 รายการ)
--   select mat_no, part_name, reason, own_orders, on_hand, hangs_under
--     from public.fn_bom_deduct_gaps() order by in_products desc, own_orders desc, mat_no;
-- ❷ วงจรชุบเดินอยู่จริงไหม
--   select count(*) ใบ, count(*) filter (where status='open') ค้างร้าน, max(sent_at)::date ล่าสุด
--     from public.plating_orders;
-- ❸ ของที่อยู่ร้านชุบตอนนี้ (ต้องตรงกับใบที่ยังไม่ปิด)
--   select mat_no, line_name, qty_on_hand from public.line_stock_summary
--    where line_name like 'ร้านชุบ%' and qty_on_hand <> 0 order by 1;
-- ❹ 🔴 ยังไม่ได้ตั้งเส้นทางชุบเลยแม้แต่ตัวเดียว (ควรเป็น > 0 หลังสโตร์ตั้งค่า)
--   select count(*) from public.dr_products
--    where is_active and coalesce(btrim(outsource_vendor),'') <> '';
-- ═════════════════════════════════════════════════════════════════════════════════════
