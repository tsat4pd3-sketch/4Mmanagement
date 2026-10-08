-- ══ /schema — เพิ่ม "ขนาดที่ใช้จริง (bytes)" ลงใน esm_schema_overview() ═══════════════
-- 2026-09-22 · ต่อจาก 20260922_schema_catalog_rpc_{main,dr}.sql
-- ⚠️ **รันทั้ง 2 project** (Main `ewhdfqwfwofivojtsizn` / DR "Product DB" `eyhclzkifitbhbljgoav`)
--    เนื้อในเหมือนกันเป๊ะ · `create or replace` ไม่แตะสิทธิ์เดิม (signature ไม่เปลี่ยน)
--
-- ที่มา: แท็บ 🩺 ตรวจสุขภาพโครงสร้าง ต้องตอบ "ตารางไหนกินที่มากสุด" — เดิม overview มีแค่
--   จำนวนแถวโดยประมาณ ซึ่งไม่บอกว่าตารางกว้าง/มี index เยอะแค่ไหน (mtn_orders 126 คอลัมน์
--   464 แถว = 4.8 MB · notifications 81k แถว = 97 MB)
--
-- rollback: apply เนื้อฟังก์ชันเดิมจาก 20260922_schema_catalog_rpc_*.sql ทับ (ถอด bytes ออก)

create or replace function public.esm_schema_overview()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
with rels as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.reltuples,
         pg_total_relation_size(c.oid) as bytes,
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
      'rows', greatest(r.reltuples, 0)::bigint, 'bytes', r.bytes, 'rls', r.relrowsecurity,
      'pk', coalesce(p.cols, array[]::name[]), 'note', r.cmt
    ) order by r.relname)
    from rels r
    left join cols cl on cl.attrelid = r.oid
    left join pk p on p.conrelid = r.oid
  ), '[]'::jsonb),
  'fks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', f.conname, 't', sc.relname, 'c', f.src,
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
