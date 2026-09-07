-- ═══ nav_groups: ทะเบียนหมวดเมนู (mirror NAV_GROUP_ORDER) + FK จาก permission_catalog — 2026-09-07 ═══
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- ที่มา: หมวดเมนูเปลี่ยน 4 รอบใน 3 สัปดาห์ (08-19 regroup · 08-24 org_divisions · 08-27 nav audit ·
--   09-03 แยก Logistic 3 ฝั่ง) และ "หมวดกำพร้า" ใน permission_catalog หลุดมาแล้ว 2 ครั้ง เพราะตัวตรวจ
--   เป็น do-block ที่ลิสต์ชื่อหมวด hardcode ไว้ในแต่ละ migration (20260827_..._nav_audit_regroup ลิสต์ 9 หมวด
--   → วันนี้ nav มี 12 หมวด รันซ้ำจะเตือนผิด) — และต่อให้ตรวจเจอก็แค่ `raise warning` ที่ไม่มีใครอ่าน
--
-- ทำอะไร (additive ล้วน · ไม่แตะ role_permissions · สิทธิ์ทุก role คงเดิมทุกช่อง):
--   ① ตาราง nav_groups = ทะเบียนหมวด 12 หมวด + ช่วง sort ของแต่ละหมวด
--      (ย้ายกติกา "ภาพรวม 1xx · ฝ่ายผลิต 2xx …" ที่เคยอยู่แค่ในคอมเมนต์/เอกสาร มาเป็นข้อมูล)
--   ② FK permission_catalog.group_name → nav_groups(name) ON UPDATE CASCADE
--      → seed คีย์ใหม่ด้วยชื่อหมวดที่ไม่มีในทะเบียน = **error ทันที** ตอนรัน migration (fail-fast)
--      → เปลี่ยนชื่อหมวด = update nav_groups แถวเดียว catalog ทั้งหมวดตามให้เอง
--   ③ วิว v_permission_catalog_sort_drift = แถวที่ sort หลุดช่วงหมวด / sort ซ้ำในหมวด (ควรว่างเสมอ)
--
-- ⚠️ nav_groups ต้อง mirror NAV_GROUP_ORDER ใน src/App.jsx เป๊ะ (ชื่อ + ลำดับ) — เทสล็อกไว้ที่
--   src/utils/__tests__/navGroupsRegistry.test.mjs (อ่าน migration `*_nav_groups_*` ตัวล่าสุด เทียบ App.jsx
--   → เปลี่ยนหมวดใน App.jsx โดยไม่มี migration ใหม่ = `npm run build` ไม่ผ่าน)
--   เปลี่ยนหมวดเมนู = แก้ App.jsx + เขียน migration ใหม่ชื่อ `YYYYMMDD_nav_groups_<เหตุผล>.sql`
--   ที่ upsert ทั้งชุด 12+ แถวแบบเดียวกับข้างล่าง ในคอมมิทเดียวกัน
--   ห้ามแก้ตารางนี้ตรงๆ ผ่าน SQL Editor โดยไม่มีไฟล์ (เทสจะไม่เห็น = drift เงียบเหมือนเดิม)
--
-- ลำดับรันที่ปลอดภัย: 20260903_permission_catalog_logistic_sides → 20260827_permission_catalog_sort_ranges
--   → ไฟล์นี้ (พรี-เช็คข้อ ③ จะ raise exception ถ้ายังมีหมวดที่ไม่อยู่ในทะเบียน — ไม่แตะอะไรทั้งนั้น)

-- ① ทะเบียนหมวด ────────────────────────────────────────────────────────────────
create table if not exists public.nav_groups (
  name       text primary key,
  seq        int  not null,               -- ลำดับใน NAV_GROUP_ORDER (1 = บนสุด)
  sort_lo    int  not null,               -- ช่วง sort ของ permission_catalog ในหมวดนี้
  sort_hi    int  not null,
  updated_at timestamptz not null default now(),
  constraint nav_groups_sort_range check (sort_lo <= sort_hi),
  -- deferrable: upsert ทั้งชุดที่สลับลำดับหมวด ต้องไม่ชนกันกลางทาง
  constraint nav_groups_seq_key unique (seq) deferrable initially deferred
);
comment on table public.nav_groups is
  'ทะเบียนหมวดเมนู sidebar — mirror NAV_GROUP_ORDER (src/App.jsx) · permission_catalog.group_name FK มาที่นี่ · เปลี่ยนหมวด = migration *_nav_groups_* ใหม่ (2026-09-07)';

alter table public.nav_groups enable row level security;
drop policy if exists nav_groups_select on public.nav_groups;
create policy nav_groups_select on public.nav_groups
  for select to authenticated using (true);
-- ไม่มี policy เขียนให้ client — แก้ได้ทาง migration (service role) เท่านั้น

-- seed 12 หมวด = NAV_GROUP_ORDER ณ 2026-09-07 (บรรทัดละหมวด · เทสอ่าน format นี้ ห้ามจัดใหม่เป็นหลายหมวดต่อบรรทัด)
-- ช่วง sort: ภาพรวม/จอแสดงผล แบ่ง 1xx คนละครึ่ง · Logistic 3 ฝั่งซอย 5xx (ตาม 20260903) · 8xx ว่างไว้ (PE เดิม
-- ยุบเข้าคุณภาพแล้ว 2026-08-27) · ผู้บริหาร & เดโม ต่อท้ายตั้งค่าฯ ใน 9xx ตามลำดับเมนู
insert into public.nav_groups (name, seq, sort_lo, sort_hi) values
  ('ภาพรวม',                        1, 100, 149),
  ('จอแสดงผล',                      2, 150, 199),
  ('ฝ่ายผลิต',                       3, 200, 299),
  ('วิเคราะห์ & รายงาน',             4, 300, 399),
  ('พนักงาน & ทักษะ',                5, 400, 499),
  ('Logistic - ขาเข้า (Inbound)',    6, 500, 519),
  ('Logistic - ขาออก (Outbound)',    7, 520, 539),
  ('Logistic - แผนงาน & ข้อมูล',     8, 540, 599),
  ('การตรวจสอบและซ่อมบำรุง',         9, 600, 699),
  ('คุณภาพ & วิศวกรรม',             10, 700, 799),
  ('ตั้งค่าโปรแกรม,ฐานข้อมูล',      11, 900, 949),
  ('ผู้บริหาร & เดโม',              12, 950, 999)
on conflict (name) do update
  set seq = excluded.seq, sort_lo = excluded.sort_lo, sort_hi = excluded.sort_hi, updated_at = now();

-- ② พรี-เช็คก่อนผูก FK — ยังมีหมวดกำพร้าอยู่ = หยุดทั้งไฟล์พร้อมบอกชื่อ (ห้ามเงียบ)
do $$
declare bad text;
begin
  select string_agg(distinct c.group_name, ' · ') into bad
    from public.permission_catalog c
    left join public.nav_groups g on g.name = c.group_name
   where c.group_name is not null and g.name is null;
  if bad is not null then
    raise exception 'permission_catalog มีหมวดที่ไม่อยู่ในทะเบียน nav_groups: % — แก้ group_name ให้ตรง NAV_GROUP_ORDER ก่อน แล้วรันไฟล์นี้ซ้ำ', bad;
  end if;
end $$;

-- ③ FK: ชื่อหมวดใน catalog ต้องมีในทะเบียนเสมอ · เปลี่ยนชื่อหมวดใน nav_groups → catalog ตามให้เอง
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'permission_catalog_group_name_fkey') then
    alter table public.permission_catalog
      add constraint permission_catalog_group_name_fkey
      foreign key (group_name) references public.nav_groups (name)
      on update cascade on delete restrict;
  end if;
end $$;

-- ④ วิวตรวจ drift ของ sort (ควรได้ 0 แถวเสมอ — ใช้เช็คหลัง seed คีย์ใหม่ทุกครั้ง)
create or replace view public.v_permission_catalog_sort_drift
  with (security_invoker = true) as
with x as (
  select c.resource, c.action, c.group_name, c.sort, g.sort_lo, g.sort_hi,
         count(*) over (partition by c.group_name, c.sort) as n_same
    from public.permission_catalog c
    join public.nav_groups g on g.name = c.group_name
)
select resource, action, group_name, sort, sort_lo, sort_hi,
       case when sort < sort_lo or sort > sort_hi then 'sort หลุดช่วงหมวด'
            else 'sort ซ้ำในหมวด' end as issue
  from x
 where sort < sort_lo or sort > sort_hi or n_same > 1;
comment on view public.v_permission_catalog_sort_drift is
  'แถว permission_catalog ที่ sort หลุดช่วงหมวด (nav_groups.sort_lo..sort_hi) หรือซ้ำในหมวด — ควรว่างเสมอ';

-- ── ตรวจหลังรัน ──────────────────────────────────────────────────────────────
-- select * from public.v_permission_catalog_sort_drift;               -- ต้องได้ 0 แถว
-- select g.seq, g.name, g.sort_lo, g.sort_hi, count(c.*) n, min(c.sort) lo, max(c.sort) hi
--   from public.nav_groups g left join public.permission_catalog c on c.group_name = g.name
--  group by 1,2,3,4 order by 1;                                        -- 12 หมวด · หมวดว่างได้ (จอแสดงผล/ผู้บริหาร)

-- ── Rollback (ย้อนได้ทั้งหมด ไม่เสียข้อมูล — catalog ไม่ถูกแก้ค่าใดๆ ในไฟล์นี้) ──
-- alter table public.permission_catalog drop constraint if exists permission_catalog_group_name_fkey;
-- drop view  if exists public.v_permission_catalog_sort_drift;
-- drop table if exists public.nav_groups;
