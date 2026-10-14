-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──────────────────────────────
-- 🧹 ยุบ BOM ซ้ำ **รอบ 2** — ใบแม่ที่ก๊อป "ทั้งต้นไม้ย่อย" มาไว้ · 2026-10-14 (ต่อจาก 20261014_…)
--
-- รอบแรกยุบได้ 48 คู่ / 58 แถว (767 → 709) แล้วติดที่ 26 คู่:
--   ใบแม่ไม่ได้ก๊อปแค่ลูกชั้นเดียว แต่ก๊อป **หลาน-เหลน** มาด้วย ⇒ ลบชั้นบนอย่างเดียวไม่ได้ (แถวหลานจะลอย)
-- รอบนี้เทียบ **ทั้งต้นไม้ย่อย** (ทุกขอบ แม่→ลูก + qty ทุกชั้น ลึกสุด 6):
--   เท่ากันเป๊ะ 19 คู่ (60 แถว) = ลบทั้งต้นได้ · ต่างกัน 7 คู่ = ไม่แตะ
--
-- 🔴 ด่านที่ต้องผ่านก่อนลบ (ตรวจแล้ววันนี้ = 0 เคสเสี่ยง):
--   ① ชุดลูกชั้น 1 + qty ตรงกับใบของพาร์ทเอง
--   ② **ทุกขอบในต้นไม้ย่อยตรงกันหมด** — เทียบ (แม่, ลูก, qty) ทั้งชุด ไม่ใช่แค่รายชื่อ
--   ③ **ไม่มีกิ่งอื่นในใบเดียวกันใช้ของร่วมกับต้นไม้ย่อยนี้** — ถ้ามี ลบแล้วกิ่งนั้นจะไปอ่านใบอื่น
--      (ของที่ `mat` เดียวกันถูกใช้ 2 ที่ในใบเดียว) ⇒ ตัวเลขกิ่งนั้นเปลี่ยนเงียบ
--
-- หลังลบ: `bomOf` ตกไปอ่าน **ใบของพาร์ทเอง** ซึ่งมีต้นไม้ย่อยชุดเดียวกันเป๊ะ ⇒ ที่กางออกมาเท่าเดิมทุกตัว
-- ยังไม่แตะ (PE ตัดสิน): ต้นไม้ย่อยต่างกัน 7 · ขัดกันจริง 15 (ใบขั้นงาน 5) · ใบแม่ขาดของ 3 · qty ต่าง 3
--
-- ย้อนกลับ: แถวที่ลบไปอยู่ใน archive.bom_items_dup_removed_20261014 (pass = 100)
--   insert into public.bom_items select (คอลัมน์ของ bom_items) from archive.… where pass = 100;

do $$
declare n int;
begin
  with recursive own as (
    select p.id sheet_id, p.mat_no from dr_products p where p.mat_no is not null
  ),
  act as (
    select id, product_id, upper(btrim(mat_no)) mat, upper(btrim(parent_mat)) pmat,
           round(coalesce(qty_per_unit,0)::numeric,6) qty
    from bom_items where is_active
  ),
  here1 as (
    select a.product_id sheet_id, a.pmat mat, array_agg((a.mat,a.qty) order by a.mat) kids
    from act a where a.pmat is not null group by 1,2
  ),
  own1 as (
    select o.mat_no mat, o.sheet_id, array_agg((a.mat,a.qty) order by a.mat) kids
    from own o join act a on a.product_id = o.sheet_id and a.pmat is null group by 1,2
  ),
  pending as (   -- ① ชั้น 1 ตรงกันเป๊ะ
    select h.sheet_id, h.mat, o.sheet_id own_sheet
    from here1 h join own1 o on o.mat = h.mat and h.sheet_id <> o.sheet_id
    where h.kids = o.kids
  ),
  ea as (        -- ขอบทั้งหมดใต้ M ที่ "ใบแม่" ก๊อปไว้
    select p.sheet_id, p.mat root, a.id, a.pmat par, a.mat child, a.qty, 1 lv
    from pending p join act a on a.product_id = p.sheet_id and a.pmat = p.mat
    union all
    select e.sheet_id, e.root, a.id, a.pmat, a.mat, a.qty, e.lv+1
    from ea e join act a on a.product_id = e.sheet_id and a.pmat = e.child
    where e.lv < 6
  ),
  eb as (        -- ขอบทั้งหมดใต้ M ใน "ใบของ M เอง"
    select p.sheet_id, p.mat root, p.mat par, a.mat child, a.qty, 1 lv
    from pending p join act a on a.product_id = p.own_sheet and a.pmat is null
    union all
    select e.sheet_id, e.root, a.pmat, a.mat, a.qty, e.lv+1
    from eb e join pending p on p.sheet_id = e.sheet_id and p.mat = e.root
              join act a on a.product_id = p.own_sheet and a.pmat = e.child
    where e.lv < 6
  ),
  cmp as (
    select p.sheet_id, p.mat, p.own_sheet,
      (select array_agg(distinct (par,child,qty) order by (par,child,qty))
         from ea where ea.sheet_id = p.sheet_id and ea.root = p.mat) a_set,
      (select array_agg(distinct (par,child,qty) order by (par,child,qty))
         from eb where eb.sheet_id = p.sheet_id and eb.root = p.mat) b_set
    from pending p
  ),
  safe2 as (     -- ② ทั้งต้นตรงกัน  ③ ไม่มีกิ่งอื่นใช้ของร่วม
    select c.* from cmp c
    where c.a_set = c.b_set
      and not exists (
        select 1 from ea e
        where e.sheet_id = c.sheet_id and e.root = c.mat
          and exists (
            select 1 from act o2
            where o2.product_id = c.sheet_id and o2.pmat = e.par
              and o2.id not in (select id from ea x where x.sheet_id = c.sheet_id and x.root = c.mat)))
  ),
  doomed as (
    select distinct e.id, s.own_sheet, s.sheet_id, s.mat
    from safe2 s join ea e on e.sheet_id = s.sheet_id and e.root = s.mat
  )
  insert into archive.bom_items_dup_removed_20261014
  select b.*, 100,
         (select mat_no from dr_products where id = d.own_sheet),
         (select mat_no from dr_products where id = d.sheet_id),
         now(),
         'ใบแม่ก๊อปทั้งต้นไม้ย่อยมาไว้ — ทุกขอบ+qty ตรงกับใบของพาร์ทเองเป๊ะ และไม่มีกิ่งอื่นใช้ของร่วม'
  from bom_items b join doomed d on d.id = b.id
  where b.is_active;

  get diagnostics n = row_count;
  raise notice 'เก็บสำรอง % แถว', n;

  delete from bom_items b
  using archive.bom_items_dup_removed_20261014 a
  where a.id = b.id and a.pass = 100;
end $$;
