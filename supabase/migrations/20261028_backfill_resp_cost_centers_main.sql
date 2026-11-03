/* ═══ backfill `profiles.resp_cost_centers` จากขอบเขตส่วนงานที่ตั้งไว้แล้ว (2026-10-28) ═══
   Main project (ewhdfqwfwofivojtsizn) · คำสั่ง user: "backfill cc ให้ 87 บัญชีเลย"

   เป้า: เดินไปสู่ "แกนเดียว" (Cost Center) ตามที่ user เคาะ — ช่องขอบเขตส่วนงานจะกลายเป็น
   ผลลัพธ์ของแกน CC ในอนาคต · ขั้นนี้แค่**เติมรหัสให้ตรงกับขอบเขตที่มีอยู่แล้ว ไม่เปลี่ยนสิทธิ์ใคร**

   🔴 กฎที่คุมงานนี้ (26/10 · คำสั่ง user): **ห้ามคืนน้อยกว่าที่ `profiles` ตั้งไว้**
   ⇒ ใส่ได้เฉพาะ **CC ของหน่วยที่ชื่อตรงกับ `sections` ที่ตั้งไว้** (ส่วนงาน ชนะ แผนก)
     = ขอบเขตเท่าเดิมเป๊ะ · พิสูจน์กับฟังก์ชันจริงแล้วว่าไม่มีไลน์ไหนแคบลง

   ❌ ข้ามโดยตั้งใจ (ใส่แล้ว "แคบลง" หรือไม่มีประโยชน์):
     · `role='admin'`           — ไม่จำกัดเสมอ (ตาข่ายกันตายใน effectiveSections)
     · `scope_depth='all'`      — วันนี้เห็นทั้งโรงงาน ⇒ ใส่ CC = บีบให้แคบลง
     · `role='display'`         — จอ TV ไม่เขียนอะไร · ใส่แล้วทุกจอต้องโหลดผังเพิ่มฟรีๆ (กฎ egress)
     · ชื่อหน่วยที่ผังไม่รู้จัก  — fail-closed ไม่เดา (เช่น 'MTN' ที่ไม่มีโหนดชื่อนี้)

   ↩️ ย้อนกลับ: ทุกแถวที่ถูกแตะมีค่าเดิมเป็น `{}` (บังคับด้วย WHERE) · เก็บรายชื่อไว้ที่
      `archive.resp_cc_backfill_20261028` ⇒ ย้อนด้วย
        update public.profiles p set resp_cost_centers = '{}'
          from archive.resp_cc_backfill_20261028 a where a.id = p.id;
   ♻️ รันซ้ำได้ — WHERE กันไว้ว่าแตะเฉพาะแถวที่ยังว่าง                                        */

create schema if not exists archive;

create table if not exists archive.resp_cc_backfill_20261028 (
  id          uuid primary key,
  full_name   text,
  role        text,
  sections    text[],
  new_ccs     text[],
  applied_at  timestamptz not null default now()
);

with tgt as (
  select p.id, p.full_name, p.role::text as role, p.sections, p.scope_depth
  from public.profiles p
  where coalesce(cardinality(p.sections), 0) > 0
    and coalesce(cardinality(p.resp_cost_centers), 0) = 0
    and p.role::text not in ('admin', 'display')
    and coalesce(p.scope_depth, '') <> 'all'
), ex as (
  select t.*, s as sec_name,
    (select o.cost_center from public.org_nodes o
      where o.is_active
        and lower(btrim(o.name)) = lower(btrim(s))
        and o.kind in ('section', 'department')
        and o.cost_center is not null
      order by case o.kind when 'section' then 0 else 1 end   -- ส่วนงานชนะแผนกเมื่อชื่อชนกัน
      limit 1) as cc
  from tgt t, unnest(t.sections) s
), agg as (
  select id, full_name, role, sections,
         array_agg(distinct cc) filter (where cc is not null) as ccs,
         bool_or(cc is null) as has_unresolved
  from ex
  group by id, full_name, role, sections
), ok as (
  select * from agg where not has_unresolved and coalesce(cardinality(ccs), 0) > 0
)
insert into archive.resp_cc_backfill_20261028 (id, full_name, role, sections, new_ccs)
select id, full_name, role, sections, ccs from ok
on conflict (id) do nothing;

update public.profiles p
   set resp_cost_centers = a.new_ccs
  from archive.resp_cc_backfill_20261028 a
 where a.id = p.id
   and coalesce(cardinality(p.resp_cost_centers), 0) = 0;   -- ♻️ idempotent
