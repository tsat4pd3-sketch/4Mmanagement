-- ══ 🗄️ แผนที่ฐานข้อมูล (/schema) — RPC อ่านโครงสร้างจริง · DR project "Product DB" ══
-- (eyhclzkifitbhbljgoav) · 2026-09-22 · คู่กับ 20260922_schema_catalog_rpc_main.sql
--
-- ⚠️ กฎเหล็ก: client `supabaseDR` วิ่งด้วย role **anon เสมอ** (ไม่เคย authenticate)
--    → ฟังก์ชันฝั่งนี้ต้อง grant ให้ anon ไม่งั้นจอว่างเปล่าแบบเงียบๆ
--    ข้อมูลที่คืนคือ "ชื่อตาราง/คอลัมน์/PK/FK" ของ project ที่ anon อ่าน**ข้อมูลจริง**ได้อยู่แล้ว
--    ทั้งตาราง (ดู known gap ใน CLAUDE.md) — เมทาดาทาจึงไม่ได้เปิดอะไรใหม่ที่ยังปิดอยู่
--
-- rollback:
--   drop function if exists public.esm_schema_overview();
--   drop function if exists public.esm_schema_table(text);

-- ── 1) ภาพรวม: ตารางทั้งหมด + เส้น FK ทั้งหมด (ก้อนเดียว ~35-45 KB) ────────────────
create or replace function public.esm_schema_overview()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
with rels as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.reltuples,
         obj_description(c.oid, 'pg_class') as cmt
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m')
),
cols as (
  select a.attrelid, count(*)::int as n
  from pg_attribute a
  where a.attnum > 0 and not a.attisdropped
  group by a.attrelid
),
pk as (
  select con.conrelid,
         (select array_agg(a.attname order by x.ord)
            from unnest(con.conkey) with ordinality as x(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = x.attnum) as cols
  from pg_constraint con
  where con.contype = 'p'
),
fk as (
  select con.conrelid, con.confrelid, con.conname, con.confdeltype,
    (select array_agg(a.attname order by x.ord)
       from unnest(con.conkey) with ordinality as x(attnum, ord)
       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = x.attnum) as src,
    (select array_agg(a.attname order by x.ord)
       from unnest(con.confkey) with ordinality as x(attnum, ord)
       join pg_attribute a on a.attrelid = con.confrelid and a.attnum = x.attnum) as tgt
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f' and n.nspname = 'public'
)
select jsonb_build_object(
  'at', now(),
  'tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      't', r.relname, 'k', r.relkind, 'cols', coalesce(cl.n, 0),
      'rows', greatest(r.reltuples, 0)::bigint, 'rls', r.relrowsecurity,
      'pk', coalesce(p.cols, array[]::name[]), 'note', r.cmt
    ) order by r.relname)
    from rels r
    left join cols cl on cl.attrelid = r.oid
    left join pk p on p.conrelid = r.oid
  ), '[]'::jsonb),
  'fks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', f.conname, 't', sc.relname, 'c', f.src,
      -- ตารางปลายทางนอก schema public (เช่น auth.users) ต้องเห็นชื่อ schema ด้วย
      -- ไม่งั้นบนจอจะอ่านเป็น "users" แล้วไปตามหาในลิสต์ไม่เจอ
      'rt', case when tn.nspname = 'public' then tc.relname::text
                 else tn.nspname || '.' || tc.relname end,
      'rc', f.tgt, 'del', f.confdeltype
    ) order by sc.relname, f.conname)
    from fk f
    join pg_class sc on sc.oid = f.conrelid
    join pg_class tc on tc.oid = f.confrelid
    join pg_namespace tn on tn.oid = tc.relnamespace
  ), '[]'::jsonb)
);
$fn$;

-- ── 2) รายละเอียดทีละตาราง (เปิดดูใบเดียว ~2-8 KB) ────────────────────────────────
--    แยกจากภาพรวมตามกฎ egress: จอรายการเอาเท่าที่ใช้ · ใบเต็มดึงตอนเปิดทีละใบ
create or replace function public.esm_schema_table(p_table text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
with rel as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.reltuples,
         obj_description(c.oid, 'pg_class') as cmt
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m')
    and c.relname = p_table
  limit 1
)
select jsonb_build_object(
  'at', now(),
  't', r.relname,
  'k', r.relkind,
  'rls', r.relrowsecurity,
  'rows', greatest(r.reltuples, 0)::bigint,
  'note', r.cmt,
  'pk', coalesce((
    select array_to_json(array_agg(a.attname order by x.ord))
    from pg_constraint con
    cross join lateral unnest(con.conkey) with ordinality as x(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = x.attnum
    where con.conrelid = r.oid and con.contype = 'p'
  )::jsonb, '[]'::jsonb),
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'nn', a.attnotnull,
      'def', pg_get_expr(ad.adbin, ad.adrelid),
      'note', col_description(a.attrelid, a.attnum),
      'enum', (select array_to_json(array_agg(e.enumlabel order by e.enumsortorder))
                 from pg_enum e where e.enumtypid = a.atttypid)
    ) order by a.attnum)
    from pg_attribute a
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb),
  'fks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', con.conname,
      'c', (select array_agg(a.attname order by x.ord)
              from unnest(con.conkey) with ordinality as x(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = x.attnum),
      'rt', case when tn.nspname = 'public' then tc.relname::text
                 else tn.nspname || '.' || tc.relname end,
      'rc', (select array_agg(a.attname order by x.ord)
               from unnest(con.confkey) with ordinality as x(attnum, ord)
               join pg_attribute a on a.attrelid = con.confrelid and a.attnum = x.attnum),
      'del', con.confdeltype
    ) order by con.conname)
    from pg_constraint con
    join pg_class tc on tc.oid = con.confrelid
    join pg_namespace tn on tn.oid = tc.relnamespace
    where con.conrelid = r.oid and con.contype = 'f'
  ), '[]'::jsonb),
  'refs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', con.conname,
      't', sc.relname,
      'c', (select array_agg(a.attname order by x.ord)
              from unnest(con.conkey) with ordinality as x(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = x.attnum),
      'rc', (select array_agg(a.attname order by x.ord)
               from unnest(con.confkey) with ordinality as x(attnum, ord)
               join pg_attribute a on a.attrelid = con.confrelid and a.attnum = x.attnum),
      'del', con.confdeltype
    ) order by sc.relname, con.conname)
    from pg_constraint con
    join pg_class sc on sc.oid = con.conrelid
    join pg_namespace sn on sn.oid = sc.relnamespace
    where con.confrelid = r.oid and con.contype = 'f' and sn.nspname = 'public'
  ), '[]'::jsonb),
  'uniques', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', con.conname,
      'c', (select array_agg(a.attname order by x.ord)
              from unnest(con.conkey) with ordinality as x(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = x.attnum)
    ) order by con.conname)
    from pg_constraint con
    where con.conrelid = r.oid and con.contype = 'u'
  ), '[]'::jsonb),
  'checks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', con.conname, 'src', pg_get_constraintdef(con.oid)
    ) order by con.conname)
    from pg_constraint con
    where con.conrelid = r.oid and con.contype = 'c'
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', ic.relname, 'uniq', i.indisunique, 'def', pg_get_indexdef(i.indexrelid)
    ) order by ic.relname)
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = r.oid
  ), '[]'::jsonb),
  -- policy: เอาแค่ "คำสั่งไหน ให้ role ไหน" ไม่เอาตัวเงื่อนไข (using/with check)
  -- พอสำหรับตอบคำถามที่เจอบ่อยสุด — "ทำไมกดบันทึกแล้วเงียบ" = ไม่มี policy ของคำสั่งนั้น
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', pol.polname,
      'cmd', case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                             when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
      'roles', (select array_agg(pg_get_userbyid(oid)) from unnest(pol.polroles) as oid),
      'permissive', pol.polpermissive
    ) order by pol.polname)
    from pg_policy pol
    where pol.polrelid = r.oid
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object('name', tg.tgname, 'fn', p.proname) order by tg.tgname)
    from pg_trigger tg
    join pg_proc p on p.oid = tg.tgfoid
    where tg.tgrelid = r.oid and not tg.tgisinternal
  ), '[]'::jsonb)
)
from rel r;
$fn$;

-- ── สิทธิ์: DR = anon ด้วย (client ฝั่งนี้ไม่มี JWT) ──────────────────────────────
revoke all on function public.esm_schema_overview() from public;
revoke all on function public.esm_schema_table(text) from public;
grant execute on function public.esm_schema_overview() to anon, authenticated;
grant execute on function public.esm_schema_table(text) to anon, authenticated;
