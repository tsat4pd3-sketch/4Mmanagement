-- 🌳 ล้าง BOM "แบนซ้ำ" → ต่อโซ่หลายชั้นแบบ SAP  (DR project · 2026-09-22)
--
-- คำสั่ง user (audit แผนผลิต 22/09): *"ต่อโซ่หลายชั้นแบบ SAP (ลบแถวหลานที่โผล่ชั้น 1)"* + *"ลบให้เลย ตอนนี้ initial run"*
--
-- ── ทำไมต้องลบ ────────────────────────────────────────────────────────────────
-- BOM ของเราถูก "แบน" มาจากโครงหลายชั้นของ SAP แล้วเก็บไว้ทั้ง 2 ชั้น ⇒ ของก้อนเดียวถูกนับ 2 รอบ
-- ตอนระเบิดความต้องการ (ตัวคำนวณเลี่ยงให้แล้วด้วย `isDupeRow` แต่ข้อมูลยังซ้ำอยู่)
--
-- ── ⚠️ ทำไมต้องใช้ตรรกะ "ใบ (sheet)" ไม่ใช่ join ธรรมดา ──────────────────────────
-- `parent_mat` เก็บเป็น **mat** ไม่ใช่ id ⇒ ตัวแม่ตัวเดียวโผล่ได้ในใบ BOM ของ FG หลายตัว
-- (วัดจริง: 20058693 เป็นตัวแม่ใน 6 ใบ) · join แบบไม่สนใบ ให้ผล **182 แถว / 17 ตัวแม่ ซึ่งผิด**
-- ไล่ตามกติกาเดียวกับ `buildBomIndex`/`explodeBom` (ลูกของ mat ในใบ S = แถว parent_mat=mat ใน S
-- ถ้าไม่มี → ใบ BOM ของ mat เอง) ได้ผลจริง = **31 แถว / 7 ตัวแม่**
--
-- ── 🔴 กับดักที่เจอตอนตรวจ (ห้ามลบยกชุดเด็ดขาด) ─────────────────────────────────
-- `20067545` มีแถวที่ **ชี้หาตัวเอง** (parent = 20067545, ลูก = 20067545) อยู่ในใบของตัวเอง
-- ⇒ ตัวไล่ชั้นเดินวน root → ตัวเอง → กางใบเดิมซ้ำที่ชั้น 2 ⇒ **ลูกทั้ง 6 ตัวถูกตีว่า "แบนซ้ำ" ผิดๆ**
-- ถ้าลบตามนั้น = **BOM ของ 20067545 หายทั้งใบ** · ของจริงที่ผิดคือแถวชี้หาตัวเองแถวเดียว
-- ⇒ migration นี้ลบแถวชี้ตัวเองก่อน แล้วค่อยคำนวณแถวแบนซ้ำใหม่
--
-- ── ตรวจก่อนลบแล้วว่า "ยอดชั้น 1 = ผลรวมตามโซ่" ทุกแถวที่เหลือ ─────────────────────
--   10100286 → 30043572  ชั้น1 ×1      · โซ่ 20059345 ×1
--   10100333 → 50027085  ชั้น1 0.642KG · โซ่ 20058490 ×0.321 + 20058491 ×0.321
--   10100379 → 50027085  เหมือนกัน · 20066630 → 50027085 เหมือนกัน
--   10101158 → 18 แถว    ชั้น1 = โซ่ผ่าน 20058498/20058488/20058489/20058483 ตรงทุกตัว
--   10104955 → 3 แถว     ชั้น1 = โซ่ผ่าน 20066660/20066662/20066663 ตรงทุกตัว
--
-- rollback: ข้อมูลเดิมอยู่ครบใน `archive.bom_items_flat_dupes_20260922`
--   insert into public.bom_items (select <คอลัมน์ของ bom_items> from archive.bom_items_flat_dupes_20260922);
--   (ตาราง archive ไม่ถูก expose ผ่าน API และไม่ grant ให้ anon — ตามกฎ backup-tables-go-to-archive)

create schema if not exists archive;

-- ① เก็บสำรอง + ลบ "แถวที่ชี้หาตัวเอง" ก่อน (ผิดโดยนิยาม และทำให้ตัวไล่ชั้นเดินวน)
create table if not exists archive.bom_items_flat_dupes_20260922 as
select b.*, 'self_ref'::text as del_reason, null::text as del_root, now() as archived_at
from public.bom_items b
left join public.dr_products p on p.id = b.product_id
where b.mat_no = coalesce(nullif(b.parent_mat, ''), p.mat_no);

delete from public.bom_items b
using public.dr_products p
where p.id = b.product_id and b.mat_no = coalesce(nullif(b.parent_mat, ''), p.mat_no);

delete from public.bom_items b
where b.parent_mat is not null and b.mat_no = b.parent_mat;

-- ② หาแถว "หลานที่ถูกใส่ซ้ำไว้ชั้น 1" ด้วยกติกาใบ BOM เดียวกับ src/utils/bomTree.js
create temporary table _flat_dupes on commit drop as
with recursive
  prod as (select id, mat_no from public.dr_products where mat_no is not null),
  r_ as (select id, product_id, parent_mat, mat_no from public.bom_items where mat_no is not null),
  roots as (
    select p.mat_no as root, p.id as sheet from prod p
    where exists (select 1 from r_ x where x.product_id = p.id or x.parent_mat = p.mat_no)
  ),
  walk as (
    select rt.root, rt.root as mat, rt.sheet as sheet, 1 as lvl, b.id as row_id, b.mat_no as child,
           array[rt.root, b.mat_no] as path
    from roots rt
    join lateral (
      select x.* from r_ x where x.parent_mat = rt.root and x.product_id = rt.sheet
      union all
      select x.* from r_ x where x.parent_mat is null and x.product_id = rt.sheet
        and not exists (select 1 from r_ y where y.parent_mat = rt.root and y.product_id = rt.sheet)
    ) b on true
    union all
    select w.root, w.child, ks.sheet, w.lvl + 1, b.id, b.mat_no, w.path || b.mat_no
    from walk w
    cross join lateral (
      select case when exists (select 1 from r_ y where y.parent_mat = w.child and y.product_id = w.sheet)
                  then w.sheet
                  else coalesce((select p.id from prod p where p.mat_no = w.child), w.sheet) end as sheet
    ) ks
    join lateral (
      select x.* from r_ x where x.parent_mat = w.child and x.product_id = ks.sheet
      union all
      select x.* from r_ x where x.parent_mat is null
        and x.product_id = (select p.id from prod p where p.mat_no = w.child)
        and not exists (select 1 from r_ y where y.parent_mat = w.child and y.product_id = ks.sheet)
    ) b on true
    where w.lvl < 10 and not (b.mat_no = any(w.path))
  )
select distinct w.row_id, w.root
from walk w
where w.lvl = 1
  and exists (select 1 from walk d where d.root = w.root and d.lvl > 1 and d.child = w.child);

-- ③ สำรองแถวที่จะลบ (ครบทุกคอลัมน์ + บอกว่าอยู่ใบไหน) แล้วค่อยลบ
insert into archive.bom_items_flat_dupes_20260922
select b.*, 'flat_dupe'::text, f.root, now()
from public.bom_items b join _flat_dupes f on f.row_id = b.id;

delete from public.bom_items b using _flat_dupes f where f.row_id = b.id;
