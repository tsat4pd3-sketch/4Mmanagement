-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🔻 คอนเฟิมแม่ → ตัดลูกตรงชั้นเดียว (หลัก SAP) + ทะเบียน "ของลม" (phantom)
--    DR project — "Product DB" · eyhclzkifitbhbljgoav              2026-11-04 · คำสั่ง user
--    ✅ apply แล้ว 4/11 ผ่าน MCP เป็น 4 migration: bom_phantom_registry_and_direct_demand_resolver
--       → bom_direct_demand_cross_sheet_kids → bom_kid_rows_prefer_current_sheet
--       → explode_child_demand_one_level_only (+ fn_bom_intermediates_for_phantom_screen)
--       ไฟล์นี้ = สถานะสุดท้ายรวมทั้งหมด (idempotent · รันซ้ำได้ ยกเว้นบล็อก seed ที่กันตัวเอง)
--
-- ปัญหา: fn_explode_child_demand วนลูป `where product_id = v_fg` โดย **ไม่กรอง parent_mat**
--        ⇒ แถว "หลาน" ที่นอนอยู่ในใบของแม่ (โมเดล bom_items.parent_mat · 16/09) ถูกนับเป็น
--        ลูกตรงของ FG แล้วตัดสต็อกด้วย · ซ้ำร้าย qty_per_unit ของแถวหลานคือ "ต่อ 1 ลูก"
--        ไม่ใช่ต่อ 1 FG ⇒ ผิดทั้งชั้นและผิดทั้งจำนวน (ตัวคูณของลูกกลางหายไป)
--
-- วัดก่อนแก้ (4/11): แถวหลาน 206/647 (32%) · ใบแบน 58/148 · คู่ที่ถูกตัด 2 รอบ 105 คู่
--        prod_no 0121060580 · FG 10100286 → mat 30042566 ได้ 5 แถว consume รวม 380 (ที่ถูก = 1 แถว)
--
-- ทำไมกรอง parent_mat เฉยๆ ไม่พอ (พิสูจน์ด้วย dry-run ก่อน apply):
--        ① ใบ "แบน" หลายใบเป็นต้นไม้หลายชั้น *ในใบเดียว* (10086024 มีลูกตรงแค่ 20058495 ตัวเดียว)
--           ⇒ ตัดหลานออกเฉยๆ = ของใต้ลูกกลางที่ไม่มีวันเปิดใบผลิตเองจะไม่ถูกตัดเลย = ของหายเงียบ
--           ⇒ ต้องมี "ของลม" (phantom assembly ของ SAP · special procurement 50) — SAP ก็ไม่
--             backflush ตัว phantom แต่ดึงลูกของมันขึ้นมาตัดที่ชั้นแม่
--        ② ลูกกลางหลายตัว **ไม่มีใบ BOM ของตัวเอง** (ลูกมันถูกกรอกไว้ในใบแม่) ⇒ resolver ที่มอง
--           ใบเดียวทำโซ่ขาด: 20063131 (มีใบผลิตเอง 36 ใบ · ค้าง 7,600) ไม่ถูกตัดที่ไหนเลย
--           ⇒ fn_bom_kid_rows ต้องหาลูกข้ามใบได้ (กฎเดิม "ใบว่าง ≠ ไม่มีลูก" · sheetsWithKidsOf)
--        ③ pull-up ต้องให้ "ใบที่กางอยู่" ชนะใบของตัวเอง ไม่งั้นทะลุของลมแล้วหลุดไปอ่านใบอื่น
--
-- 🔴 เกณฑ์ seed ห้ามใช้ line_stock_transactions: แถว consume ของลูกกลางเกิดจาก trigger ที่บั๊ก
--    อยู่เอง (หลักฐานวนกลับมาอ้างตัวเอง) ⇒ ใช้ "เคยมีใบผลิตของตัวเองที่ระเบิดได้จริงไหม"
--
-- ผลหลังแก้ (วัดกับข้อมูลจริงทั้งระบบ):
--    409 คู่ (ใบ,mat) เท่าเดิม · 246 คู่เลิกตัดที่ชั้น FG (ย้ายไปตัดที่ใบของลูกเอง) ·
--    41 คู่เกิดใหม่ (ใบลูกที่ไม่มี BOM ของตัวเอง — กลไกที่ทำให้ "ลูกไปผลิตเอง" ทำงาน) ·
--    21 คู่ qty เปลี่ยน (19 เพิ่ม = เติมตัวคูณลูกกลางที่หายไป · 2 ลด = เลิกนับซ้ำ)
--    🔑 **ด่านความปลอดภัย: mat ที่ "ไม่ถูกตัดที่ไหนเลย" = 0 แถว** (คิวรีตรวจท้ายไฟล์)
--
-- ย้อนกลับ: ดู §ROLLBACK ท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ─── 1) ทะเบียน "ของลม" — แหล่งความจริงชุดเดียว ───────────────────────────────────────
create table if not exists public.bom_phantom_mats (
  mat_no      text primary key,
  note        text,
  seeded      boolean     not null default false,   -- true = ระบบเดาให้ · PE ยังไม่ยืนยัน
  created_at  timestamptz not null default now(),
  created_by  text
);

comment on table public.bom_phantom_mats is
  'ของลม (phantom assembly) — mat ที่ไม่มีวันถูกตัดสต็อกในฐานะตัวมันเอง · คอนเฟิมแม่แล้วให้ดึง
   "ลูกของมัน" ในใบเดียวกันขึ้นมาตัดแทน (หลัก SAP special procurement 50) ·
   ครอบทั้ง mat ที่อยู่/ไม่อยู่ใน dr_products · seeded=true คือระบบเดาจากหลักฐาน "ไม่เคยมีใบผลิตของตัวเอง"';

alter table public.bom_phantom_mats enable row level security;

-- 🔴 ฝั่ง DR ทุก query วิ่งด้วย role anon เสมอ (supabaseClient ไม่เคย authenticate)
--    ห้ามเปลี่ยนเป็น TO authenticated — client ไม่มี JWT ให้เช็ค = พังทั้งระบบ
drop policy if exists bom_phantom_mats_all on public.bom_phantom_mats;
create policy bom_phantom_mats_all on public.bom_phantom_mats
  for all to public using (true) with check (true);

-- RLS ผ่านแต่ GRANT ขาด = PostgREST ตอบ 401 ⇒ ต้องให้ครบทุก cmd ที่ client ใช้ (จอ upsert+delete)
grant select, insert, update, delete on public.bom_phantom_mats to anon, authenticated;

-- ─── 2) กฎ "ตัวนี้เป็นของลมไหม" — จุดเดียว ห้ามเขียนซ้ำที่อื่น ─────────────────────────
create or replace function public.fn_bom_is_phantom(p_mat text)
returns boolean language sql stable as $fn$
  select case when p_mat is null or btrim(p_mat) = '' then false else
    exists (select 1 from public.bom_phantom_mats m
             where upper(btrim(m.mat_no)) = upper(btrim(p_mat)))
    or exists (select 1 from public.dr_products dp
                where upper(btrim(dp.mat_no)) = upper(btrim(p_mat))
                  and dp.is_active and coalesce(dp.is_operation, false))
  end;
$fn$;

comment on function public.fn_bom_is_phantom(text) is
  'ของลม = อยู่ในทะเบียน bom_phantom_mats หรือเป็นขั้น OP (dr_products.is_operation)';

-- ─── 3) "ลูกตรงของ mat นี้" — ① ใบที่กางอยู่ ② ใบของตัวเอง ③ ใบอื่นที่นิยามลูกไว้ ──────
drop function if exists public.fn_bom_direct_demand(uuid, text);
drop function if exists public.fn_bom_direct_demand(text);
drop function if exists public.fn_bom_kid_rows(text);

create or replace function public.fn_bom_kid_rows(p_mat text, p_prefer_sheet uuid default null)
returns table (mat_no text, part_name text, qty_per_unit numeric, source_line text, from_sheet uuid)
language sql stable as $fn$
  with here as (     -- ① ใบแบนต้องชนะ ไม่งั้นทะลุของลมแล้วหลุดไปอ่านใบอื่น = โซ่ขาด
    select b.mat_no, b.part_name, b.qty_per_unit::numeric as q, b.source_line, b.product_id
      from public.bom_items b
     where p_prefer_sheet is not null
       and b.product_id = p_prefer_sheet and b.is_active
       and upper(btrim(b.parent_mat)) = upper(btrim(p_mat))
  ),
  own_sheet as (     -- ② ใบของตัวเอง
    select b.mat_no, b.part_name, b.qty_per_unit::numeric as q, b.source_line, b.product_id
      from public.bom_items b
      join public.dr_products p on p.id = b.product_id
     where b.is_active and p.is_active
       and upper(btrim(p.mat_no)) = upper(btrim(p_mat))
       and (b.parent_mat is null or upper(btrim(b.parent_mat)) = upper(btrim(p_mat)))
  ),
  pick as (          -- ③ ใบอื่น — เลือก "ใบเดียว" ที่มีลูกมากสุด ห้ามรวมหลายใบ = นับซ้ำ
    select b.product_id
      from public.bom_items b
     where b.is_active and upper(btrim(b.parent_mat)) = upper(btrim(p_mat))
     group by b.product_id
     order by count(*) desc, b.product_id
     limit 1
  )
  select h.mat_no, h.part_name, h.q, h.source_line, h.product_id from here h
  union all
  select o.mat_no, o.part_name, o.q, o.source_line, o.product_id from own_sheet o
   where not exists (select 1 from here)
  union all
  select b.mat_no, b.part_name, b.qty_per_unit::numeric, b.source_line, b.product_id
    from public.bom_items b
   where not exists (select 1 from here)
     and not exists (select 1 from own_sheet)
     and b.is_active
     and upper(btrim(b.parent_mat)) = upper(btrim(p_mat))
     and b.product_id = (select product_id from pick);
$fn$;

comment on function public.fn_bom_kid_rows(text, uuid) is
  'ลูกตรงของ mat · ลำดับ: แถวในใบที่กางอยู่ → ใบของตัวเอง → ใบอื่นที่นิยามลูกไว้ (ใบเดียว ห้ามรวม)';

-- ─── 4) "ใบนี้ confirm แล้วต้องตัดอะไรบ้าง" = ลูกตรงชั้นเดียว + ทะลุเฉพาะของลม ─────────
create or replace function public.fn_bom_direct_demand(p_fg_mat text)
returns table (mat_no text, part_name text, qty_per_unit numeric, source_line text, via_phantom text)
language sql stable as $fn$
  with recursive kid as (
    select k.mat_no, k.part_name, k.qty_per_unit as q, k.source_line, k.from_sheet,
           1 as depth, array[upper(btrim(p_fg_mat)), upper(btrim(k.mat_no))] as path,
           null::text as via
      from public.fn_bom_kid_rows(p_fg_mat, null::uuid) k
    union all
    select g.mat_no, g.part_name, kd.q * g.qty_per_unit, g.source_line, g.from_sheet,
           kd.depth + 1, kd.path || upper(btrim(g.mat_no)), coalesce(kd.via, kd.mat_no)
      from kid kd
      cross join lateral public.fn_bom_kid_rows(kd.mat_no, kd.from_sheet) g
     where kd.depth < 10                                  -- เพดานกันโครงลึก
       and public.fn_bom_is_phantom(kd.mat_no)            -- 🔴 ทะลุเฉพาะใต้ของลม
       and not (upper(btrim(g.mat_no)) = any(kd.path))    -- กันวนลูป
  )
  -- ของลมที่กางต่อได้ = ไม่ตัดตัวมัน · ของลมที่ไม่มีลูก = ยังตัดตัวมัน (ห้ามให้ของหายเงียบ)
  select k.mat_no, min(k.part_name), sum(k.q), min(k.source_line), min(k.via)
    from kid k
   where not (public.fn_bom_is_phantom(k.mat_no)
              and exists (select 1 from public.fn_bom_kid_rows(k.mat_no, k.from_sheet)))
   group by k.mat_no;                                     -- 1 mat = 1 แถวตัด (เดิมแตกหลายแถว)
$fn$;

comment on function public.fn_bom_direct_demand(text) is
  'ความต้องการต่อ 1 หน่วย FG สำหรับ "ตัดตอน confirm" = ลูกตรงชั้นเดียว (หลัก SAP: คอนเฟิมแม่ ตัดลูก
   ไม่ตัดหลาน · ลูกไม่พอ = ออกใบให้ลูกไปผลิตเอง) · ทะลุเฉพาะของลม คูณ qty สะสม · ยุบ 1 mat = 1 แถว ·
   🔴 คนละคำถามกับ explodeBom ฝั่งแผน (ฝั่งแผนคูณสะสมทุกชั้น = "ต้องใช้ของเท่าไหร่")';

-- ─── 5) จอ PE: ลูกกลาง + หลักฐาน (สรุปฝั่ง server = ประหยัด egress) ───────────────────
create or replace function public.fn_bom_intermediates()
returns table (
  mat_no text, part_name text, in_registry boolean, seeded boolean, is_operation boolean,
  own_orders bigint, has_own_sheet boolean, on_hand numeric, used_in bigint, kid_rows bigint
) language sql stable as $fn$
  with inter as (
    select distinct upper(btrim(b.parent_mat)) as m
      from public.bom_items b
      join public.dr_products p on p.id = b.product_id
     where b.is_active and p.is_active and b.parent_mat is not null
       and upper(btrim(b.parent_mat)) <> upper(btrim(p.mat_no))
  )
  select i.m,
    (select dp.name from public.dr_products dp where upper(btrim(dp.mat_no)) = i.m and dp.is_active limit 1),
    exists (select 1 from public.bom_phantom_mats r where upper(btrim(r.mat_no)) = i.m),
    coalesce((select r.seeded from public.bom_phantom_mats r where upper(btrim(r.mat_no)) = i.m), false),
    exists (select 1 from public.dr_products dp
             where upper(btrim(dp.mat_no)) = i.m and dp.is_active and coalesce(dp.is_operation,false)),
    (select count(*) from public.prod_orders o
       join public.child_demand_explosions e on e.order_id = o.id
       join public.dr_products dp on upper(btrim(dp.mat_no)) = upper(btrim(o.mat_no)) and dp.is_active
      where upper(btrim(o.mat_no)) = i.m),
    exists (select 1 from public.bom_items b2 join public.dr_products p2 on p2.id = b2.product_id
             where upper(btrim(p2.mat_no)) = i.m and b2.is_active and p2.is_active),
    coalesce((select sum(s.qty_on_hand) from public.line_stock_summary s where upper(btrim(s.mat_no)) = i.m), 0),
    (select count(distinct b3.product_id) from public.bom_items b3
      where b3.is_active and upper(btrim(b3.parent_mat)) = i.m),
    (select count(*) from public.bom_items b4 where b4.is_active and upper(btrim(b4.parent_mat)) = i.m)
  from inter i;
$fn$;

comment on function public.fn_bom_intermediates() is
  'จอ /products?tab=phantom — ลูกกลาง + หลักฐาน ⇒ ตีป้ายที่ src/utils/bomPhantom.js (pure · มีเทส)';

-- ─── 5b) 🔴 โซ่ขาด — "mat ไหนอยู่ใน BOM แต่ไม่มีใบไหนตัดมันเลย" (apply 5/11) ──────────────
-- กฎ "ลูกไปตัดหลาน" ใช้ได้ต่อเมื่อโซ่เดินถึงทุกชั้น ⇒ ต้องตอบคำถามนี้ได้ · จอต้องโชว์ ห้ามซ่อน
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
      else 'ตัวมันเองมีใบผลิต แต่ไม่มีใบไหนตัดมันไปใช้ ⇒ แม่ของมันอาจชี้ผิดตัว หรือเป็นงานส่งออกไปชุบ/จ้างนอก'
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
 where not exists (select 1 from deducted x where x.m = d.m);
$fn$;

comment on function public.fn_bom_deduct_gaps() is
  'โซ่ขาด — mat ที่อยู่ใน BOM แต่ไม่มีใบไหนตัดมันเมื่อ confirm · จอ /products?tab=phantom ต้องโชว์
   ห้ามซ่อน ห้ามกลบด้วยการติ๊กของลม · ระบบชี้อย่างเดียว PE ตัดสิน';

grant execute on function public.fn_bom_deduct_gaps()             to anon, authenticated;
grant execute on function public.fn_bom_is_phantom(text)          to anon, authenticated;
grant execute on function public.fn_bom_kid_rows(text, uuid)      to anon, authenticated;
grant execute on function public.fn_bom_direct_demand(text)       to anon, authenticated;
grant execute on function public.fn_bom_intermediates()           to anon, authenticated;

-- ─── 6) ⛔ ไม่ seed ทะเบียนของลม — กฎ user 5/11 ────────────────────────────────────────
-- *"ควรจะตัดลูกที่ติดตัว ลูกมีหน้าที่ไปตัดหลาน และสร้างผัง bom ทีเดียว"*
-- ⇒ **ค่าเริ่มต้นคือตัดลูกตรงเสมอ** · ของลม = ข้อยกเว้นที่ PE ติ๊กเองที่ /products?tab=phantom
-- 🔴 migration รุ่นแรก (4/11) เคย seed 45 แถวจากการเดา = ทำให้ระบบข้ามลูกกลาง ขัดกฎข้างบน
--    ⇒ ล้างทิ้งแล้ว 5/11 (`delete from bom_phantom_mats where seeded`) · **ห้าม seed ซ้ำ**
--    (มีด่าน `bom-phantom-no-seed` ใน regressionGuards)

-- ─── 7) trigger — โครงเดิมทั้งหมด เปลี่ยนแค่ "วนอะไร" ─────────────────────────────────
create or replace function public.fn_explode_child_demand()
 returns trigger language plpgsql as $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; p record;
  v_gross numeric; v_onhand numeric; v_consume numeric; v_short numeric;
  v_lot integer; v_mode text; v_pending numeric; v_made int; v_qty numeric; v_is_op boolean;
  MAX_LOTS constant int := 50;
begin
  if NEW.status = 'confirmed' then
    if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
    v_qty := NEW.qty;
  elsif TG_OP = 'UPDATE' and NEW.status in ('carry_over', 'cancelled')
        and OLD.status is distinct from NEW.status then
    v_qty := NEW.qty_actual;
  else
    return null;
  end if;
  if v_qty is null or v_qty <= 0 then return null; end if;

  begin
    insert into public.child_demand_explosions(order_id) values (NEW.id);
  exception when unique_violation then
    return null;
  end;

  select ps.line_name, ps.work_date into v_line, v_workdate
    from production_sessions ps where ps.id = NEW.session_id;

  select id, name, coalesce(is_operation, false) into v_fg, v_fgname, v_is_op
    from dr_products where mat_no = NEW.mat_no and is_active limit 1;
  if v_fg is null then return null; end if;
  if v_is_op then return null; end if;

  -- 🔻 เดิม: select * from bom_items where product_id = v_fg  (= ทั้งใบ รวมแถวหลาน ⇒ ตัดหลานด้วย)
  --    ใหม่: ลูกตรงชั้นเดียว + ทะลุเฉพาะของลม  (หลัก SAP: คอนเฟิมแม่ ตัดลูก ไม่ตัดหลาน)
  for b in select * from public.fn_bom_direct_demand(NEW.mat_no) loop
    if exists (select 1 from dr_products dp where dp.mat_no = b.mat_no and dp.is_active
                 and coalesce(dp.is_operation, false)) then continue; end if;

    v_gross := v_qty * b.qty_per_unit;
    select coalesce(qty_on_hand,0) into v_onhand
      from line_stock_summary where line_name = v_line and mat_no = b.mat_no;
    if v_onhand is null then v_onhand := 0; end if;
    v_consume := least(v_onhand, v_gross);
    if v_consume < 0 then v_consume := 0; end if;
    v_short := v_gross - v_consume;
    if v_consume > 0 then
      insert into line_stock_transactions(line_name, mat_no, part_name, qty, type, work_date, note, created_by,
                                          ref_order_id, ref_session_id)
        values (v_line, b.mat_no, b.part_name, v_consume, 'consume', v_workdate,
                'auto: FG '||coalesce(NEW.prod_no,'')||' ใช้ mini-store'
                  ||case when b.via_phantom is not null then ' (ผ่านของลม '||b.via_phantom||')' else '' end,
                'auto', NEW.id, NEW.session_id);
    end if;
    if v_short <= 0 then continue; end if;

    v_lot := null; v_mode := null;
    select lot_size, lot_mode into v_lot, v_mode from kanban_standards where mat_no = b.mat_no and is_active limit 1;

    if v_mode = 'direct' then
      perform public.fn_emit_child_demand_slip(b.mat_no, b.part_name, ceil(v_short), v_line, v_workdate, NEW.prod_no, b.source_line);
      continue;
    end if;

    insert into child_demand_accumulator(child_mat_no, pending_qty, updated_at)
      values (b.mat_no, v_short, now())
    on conflict (child_mat_no) do update
      set pending_qty = child_demand_accumulator.pending_qty + excluded.pending_qty, updated_at = now();
    if v_lot is null or v_lot <= 0 then continue; end if;
    select pending_qty into v_pending from child_demand_accumulator where child_mat_no = b.mat_no;
    v_made := 0;
    while v_pending >= v_lot and v_made < MAX_LOTS loop
      perform public.fn_emit_child_demand_slip(b.mat_no, b.part_name, v_lot, v_line, v_workdate, NEW.prod_no, b.source_line);
      v_pending := v_pending - v_lot;
      v_made := v_made + 1;
    end loop;
    update child_demand_accumulator set pending_qty = v_pending, updated_at = now() where child_mat_no = b.mat_no;
  end loop;

  for p in select * from product_packaging where product_id = v_fg and is_active loop
    insert into packaging_withdrawal_requests(work_date, product_mat_no, product_name, source_line, packaging_code, packaging_name, qty, source_prod_no)
      values (v_workdate, NEW.mat_no, v_fgname, v_line, p.packaging_code, p.packaging_name,
              ceil(v_qty::numeric / greatest(p.pcs_per_pkg,1)), NEW.prod_no);
  end loop;

  return null;
end;
$function$;

-- ═══ คิวรีตรวจหลัง apply (รันบน "Product DB" · eyhclzkifitbhbljgoav) ══════════════════
-- ❶ ด่านสำคัญ — ต้องได้ 0 แถว: mat ที่ไม่ถูกตัดที่ไหนเลย (ของลมไม่นับ เพราะตั้งใจไม่ตัดตัวมัน)
--   with new as (select distinct d.mat_no m from dr_products p
--                  cross join lateral public.fn_bom_direct_demand(p.mat_no) d where p.is_active),
--        old as (select distinct b.mat_no m from dr_products p
--                  join bom_items b on b.product_id=p.id and b.is_active where p.is_active)
--   select o.m from old o
--    where not exists (select 1 from new n where upper(btrim(n.m))=upper(btrim(o.m)))
--      and not coalesce(public.fn_bom_is_phantom(o.m),false);
--
-- ❷ 🔴 โซ่ขาด — mat ที่อยู่ใน BOM แต่ไม่มีใบไหนตัดมันเลย (5/11 = 23 รายการ · จอต้องโชว์ ห้ามซ่อน)
--   select mat_no, part_name, reason, own_orders, on_hand, hangs_under
--     from public.fn_bom_deduct_gaps() order by in_products desc, own_orders desc, mat_no;
--
-- ❷b ทะเบียนของลมต้องว่าง เว้นแต่ PE ติ๊กเอง (ห้าม seed · 5/11 = 0 แถว)
--   select count(*) from public.bom_phantom_mats;
--
-- ❸ ใบ confirm แล้วตัดอะไร (เทียบกับที่เห็นบนจอ BOM)
--   select * from public.fn_bom_direct_demand('10100286') order by mat_no;
--
-- ❹ ไม่ควรมีใบไหนตัด mat เดิมหลายแถวอีก (เดิม 0121060580 ตัด 30042566 ถึง 5 แถว · ต้องได้ 0 แถว)
--   select t.ref_order_id, o.prod_no, o.mat_no fg, t.mat_no, count(*) rows_cnt
--     from line_stock_transactions t join prod_orders o on o.id=t.ref_order_id
--    where t.type='consume' and t.created_by='auto' and t.created_at > now() - interval '1 day'
--    group by 1,2,3,4 having count(*) > 1;
--
-- ═══ ROLLBACK ═════════════════════════════════════════════════════════════════════════
-- คืนพฤติกรรมเดิม (ตัดทั้งใบ) — create or replace fn_explode_child_demand() ทับ โดยแทนลูปด้วย:
--     for b in select * from bom_items where product_id = v_fg and is_active loop
--       v_child_op := false;
--       select coalesce(is_operation, false) into v_child_op from dr_products
--         where mat_no = b.mat_no and is_active limit 1;
--       if coalesce(v_child_op, false) then continue; end if;
--       ... (เนื้อในเหมือนเดิม · note ไม่มีส่วน via_phantom)
--   + declare เพิ่ม v_child_op boolean;
-- ตาราง/ฟังก์ชันใหม่ปล่อยไว้ได้ ไม่มีใครเรียก (จอ phantom จะว่าง) · จะล้างจริง:
--     drop function if exists public.fn_bom_intermediates();
--     drop function if exists public.fn_bom_direct_demand(text);
--     drop function if exists public.fn_bom_kid_rows(text, uuid);
--     drop function if exists public.fn_bom_is_phantom(text);
--     drop table if exists public.bom_phantom_mats;
-- ═════════════════════════════════════════════════════════════════════════════════════
