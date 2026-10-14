-- ⛔⛔ ห้ามรันซ้ำ — สคริปต์นี้มีจุดบอดที่พบหลังรันจริง 14/10 ⛔⛔
-- จุดบอด: กติกาตรวจเทียบ "ใบแม่ vs ใบของพาร์ทเอง" เท่านั้น แต่ตอนกางจริง ถ้า**ตัวกลางถูกเอาออกด้วย**
--   เส้นทางจะวิ่งไปอ่าน "ใบของตัวกลาง" ซึ่งอาจกรอกไว้ไม่ตรงกับอีก 2 ใบ
-- เคสจริงที่เจอ (1 บรรทัดจาก 784 บรรทัดทั้งโรงงาน):
--   ใบ FG 10092454 : 20059851 -> 30042571 x4   ✔ ตรงกับใบของ 20059851 เอง (x4) จึงถูกเอาออก
--   แต่ใบของตัวกลาง 20059822 กรอกไว้ x1  ⇒ หลังเอาออก เส้นทางไปอ่านใบนั้น ยอดเปลี่ยน 4 -> 1
--   แก้แล้วด้วยการ insert 3 แถวนั้นกลับ (จาก archive) · ยอดกลับไปเท่าเดิมเป๊ะ
-- ⇒ ก่อนรันสคริปต์ทำนองนี้อีก ต้องเพิ่มด่าน "ใบของตัวกลางทุกตัวในสายต้องกรอกตรงกันด้วย"
--   และ **ต้องเทียบต้นไม้ทั้งฐานก่อน/หลัง (ไม่ใช่เทียบแค่คู่)** — วิธีเทียบอยู่ใน docs/modules/bom-levels.md
--
-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──────────────────────────────
-- 🧹 ยุบ "ของชิ้นเดียวถูกนิยามไว้ 2 ใบ" ให้เหลือนิยามเดียว — 2026-10-14 · คำสั่ง user
--    *"ถ้าเจอแบบนี้ควรจะลบดาต้าลูกย่อยของตัวเองเพื่อ single source of truth ถูกมั้ย ถ้าถูกไล่ทำให้เลย"*
--
-- ── เก็บฝั่งไหน ─────────────────────────────────────────────────────────────────
-- เก็บ **ใบ BOM ของพาร์ทเอง** เป็นนิยามเดียว · ลบ **สำเนาในใบแม่** ทิ้ง
--   เพราะใบของพาร์ทถูกใบแม่ยืมไปกางได้ทุกใบ (วัดจริง: พาร์ทเดียวถูกก๊อปไว้ใน 4-5 ใบแม่)
--   เก็บฝั่งใบแม่แทน = ต้องแก้ทุกใบทุกครั้ง = ปัญหาเดิมที่ user เรียกว่า "ต้องแก้ 2 ที่"
-- ⚠️ หลังลบ **ต้นไม้ยังกางเหมือนเดิมทุกตัวทุก qty** — `bomOf` จะตกไปอ่านใบของพาร์ทเอง
--    (กติกา `same.length ? same : own` · src/utils/bomTree.js) แล้วจอติดป้าย "ชั้นล่างมาจากใบของ X เอง"
--
-- ── ลบเฉพาะที่พิสูจน์ได้ว่าตัวเลขไม่ขยับ (วัดจริง 14/10 · 95 คู่ทั้งฐาน) ──────────
--   ✅ ลบ  = ชุดลูก **และ qty ทุกตัว** ตรงกับใบของพาร์ทเองเป๊ะ  (74 คู่ / 150 แถว)
--   ⛔ ไม่ลบ = ขัดกันจริง 15 คู่ (ในนั้นเป็นใบขั้นงาน OP 5 คู่ = คนละคำถาม ไม่ใช่ขัดกัน)
--             · ใบแม่ขาดของ 3 คู่ · ชุดลูกเท่ากันแต่ qty ต่าง 3 คู่  → **PE ตัดสิน ห้ามลบอัตโนมัติ**
--
-- 🔴 ทำไมต้องวนหลายรอบ (ไม่ใช่ลบรวดเดียว):
--    30 จาก 74 คู่ ใบแม่จัด **ชั้นลึกกว่า 1 ชั้น** ไว้ด้วย (44 แถว) — ลบชั้นบนก่อน = แถวหลาน
--    กลายเป็นแถวลอยที่ไม่มีใครอ่านถึง (`parent_mat` ชี้ของที่ไม่อยู่ในใบนี้แล้ว)
--    ⇒ วนลบ **จากชั้นลึกขึ้นมา**: รอบหนึ่งลบเฉพาะคู่ที่ "ไม่มีชั้นลึกค้างอยู่ในใบเดียวกัน"
--      แล้วคำนวณใหม่ — คู่ที่เพิ่งพ้นเงื่อนไขจะถูกลบในรอบถัดไป
--
-- ย้อนกลับ (rollback) — ตารางสำรองอยู่ใน schema `archive` ตามกฎโปรเจค ห้ามไว้ใน `public`:
--   insert into public.bom_items
--   select (คอลัมน์ของ public.bom_items ตามลำดับเดิม)
--   from archive.bom_items_dup_removed_20261014;
--   (ง่ายสุด: รัน `select * from archive.bom_items_dup_removed_20261014` ดูก่อน แล้ว insert กลับทั้งก้อน)
-- ไม่แตะ schema/RLS/trigger ใดๆ · ไม่แตะ dr_products · additive ฝั่ง archive ทั้งหมด

create schema if not exists archive;

drop table if exists archive.bom_items_dup_removed_20261014;
create table archive.bom_items_dup_removed_20261014 (
  like public.bom_items including defaults,
  pass            int,
  own_sheet_mat   text,          -- ใบของพาร์ทเองที่ถูกเก็บไว้เป็นนิยามเดียว
  from_sheet_mat  text,          -- ใบแม่ที่สำเนาถูกลบออกไป
  removed_at      timestamptz default now(),
  reason          text
);
comment on table archive.bom_items_dup_removed_20261014 is
  'สำเนาแถว bom_items ที่ถูกลบรอบ single-source-of-truth 14/10 — ชุดลูก+qty ตรงกับใบของพาร์ทเองเป๊ะ จึงลบสำเนาในใบแม่ · ต้นไม้ที่กางออกมาเหมือนเดิมทุกตัว · กู้คืนได้จากตารางนี้';

do $$
declare
  cur_pass int := 1;
  n int;
begin
  loop
    with own as (
      select p.id sheet_id, p.mat_no from dr_products p where p.mat_no is not null
    ),
    here as (   -- ลูกที่ "ใบแม่" จัดไว้เอง ด้วย parent_mat
      select b.product_id sheet_id, b.parent_mat mat,
             array_agg((upper(btrim(b.mat_no)), round(coalesce(b.qty_per_unit,0)::numeric,6))
                       order by upper(btrim(b.mat_no))) kids
      from bom_items b
      where b.parent_mat is not null and b.is_active
      group by 1,2
    ),
    ownkids as ( -- ลูกชั้น 1 ในใบของพาร์ทเอง
      select o.mat_no mat, o.sheet_id,
             array_agg((upper(btrim(b.mat_no)), round(coalesce(b.qty_per_unit,0)::numeric,6))
                       order by upper(btrim(b.mat_no))) kids
      from own o
      join bom_items b on b.product_id = o.sheet_id and b.parent_mat is null and b.is_active
      group by 1,2
    ),
    ident as (   -- ตรงกันเป๊ะทั้งรายการและ qty
      select h.sheet_id, h.mat, o.sheet_id own_sheet
      from here h
      join ownkids o on o.mat = h.mat and h.sheet_id <> o.sheet_id
      where h.kids = o.kids
    ),
    safe as (    -- 🔴 และใบแม่ต้อง "ไม่มีชั้นลึกของคู่นี้ค้างอยู่" (ไม่งั้นลบแล้วแถวหลานลอย)
      select i.* from ident i
      where not exists (
        select 1 from bom_items g
        where g.product_id = i.sheet_id and g.is_active
          and upper(btrim(g.parent_mat)) in (
            select upper(btrim(b.mat_no)) from bom_items b
            where b.product_id = i.sheet_id and b.is_active
              and upper(btrim(b.parent_mat)) = upper(btrim(i.mat))))
    )
    insert into archive.bom_items_dup_removed_20261014
    select b.*, cur_pass,
           (select mat_no from dr_products where id = s.own_sheet),
           (select mat_no from dr_products where id = s.sheet_id),
           now(),
           'ซ้ำกับใบของพาร์ทเองทุกรายการ+ทุก qty — ลบสำเนาในใบแม่ ให้เหลือนิยามเดียวที่ใบของพาร์ท'
    from bom_items b
    join safe s on s.sheet_id = b.product_id
               and upper(btrim(s.mat)) = upper(btrim(b.parent_mat))
    where b.is_active;

    get diagnostics n = row_count;
    raise notice 'รอบ % — เก็บสำรอง % แถว', cur_pass, n;
    exit when n = 0 or cur_pass > 10;

    delete from bom_items b
    using archive.bom_items_dup_removed_20261014 a
    where a.id = b.id and a.pass = cur_pass;

    cur_pass := cur_pass + 1;
  end loop;
end $$;
