-- 🗑️ ลบบัญชีซ้ำแล้วติด FK — "อะไรกันอยู่" + "โอนประวัติให้บัญชีที่เหลือ"  (Main · ewhdfqwfwofivojtsizn · 2026-11-05)
--
-- เหตุการณ์จริง 05/11: admin กดลบบัญชีซ้ำ `pubed.tun@pd4` (ของ ภูเบศ · มีบัญชีใหม่ `pubed@tsat4` แล้ว)
--   edge `delete-user` ตอบ 400 เงียบๆ ข้อความ "Database error deleting user" — จอไม่รู้ว่าติดอะไร
--   ต้นเหตุ: `daily_production_logs.checked_by → profiles(id)` เป็น NO ACTION และบัญชีเก่ามีใบเช็คชื่อ 99 ใบ
--   (21/10–05/11 — คนยังใช้บัญชีเก่าเช็คชื่ออยู่ทุกวัน)
--
-- หลัก: ประวัติ "ใครตรวจ/ใครสร้าง" ห้ามหายเงียบ (traceability) ⇒ ไม่เปลี่ยน FK เป็น set null / cascade
--   · ลบแล้วติด = บอกให้ชัดว่าติดตารางไหนกี่แถว (fn_profile_ref_blockers)
--   · บัญชีซ้ำของ "คนเดียวกัน" = โอนคอลัมน์ผู้กระทำทุกตัวไปบัญชีที่เหลือก่อนลบ (fn_profile_reassign_refs)
--     คอลัมน์ที่โอน = FK ไป profiles/auth.users ที่ **ไม่ใช่ cascade** (a/r/n) — cascade (notifications ฯลฯ) ปล่อยให้ลบตาม
--   · อ่าน pg_constraint สด ⇒ ตารางใหม่ในอนาคตถูกนับเอง ไม่ต้องมาเติมลิสต์
--
-- สิทธิ์: service_role เท่านั้น (edge `delete-user` ที่ตรวจ admin แล้ว) — client เรียกตรงไม่ได้
-- ย้อนกลับ: drop function ทั้ง 2 ตัว (ไม่มีตาราง/ข้อมูลเปลี่ยน · edge เวอร์ชันเก่าไม่ได้เรียก)

create or replace function public.fn_profile_ref_blockers(p_uid uuid)
returns table (tbl text, col text, n bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r   record;
  cnt bigint;
begin
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a  on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    join pg_namespace ns on ns.oid = c.connamespace
    where c.contype = 'f'
      and c.confdeltype in ('a', 'r')                              -- NO ACTION / RESTRICT = ตัวที่กันลบ
      and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
      and ns.nspname = 'public'
      and array_length(c.conkey, 1) = 1
      and c.conrelid <> 'public.profiles'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into cnt using p_uid;
    if cnt > 0 then
      tbl := r.tbl; col := r.col; n := cnt;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.fn_profile_reassign_refs(p_from uuid, p_to uuid)
returns table (tbl text, col text, n bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r   record;
  cnt bigint;
begin
  if p_to is null or p_from is null or p_from = p_to then
    raise exception 'reassign: ต้องระบุบัญชีปลายทางที่ไม่ใช่บัญชีเดิม';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_to) then
    raise exception 'reassign: ไม่พบบัญชีปลายทาง %', p_to;
  end if;
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a  on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    join pg_namespace ns on ns.oid = c.connamespace
    where c.contype = 'f'
      and c.confdeltype in ('a', 'r', 'n')                         -- ทุกตัวที่ไม่ cascade = ประวัติผู้กระทำ
      and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
      and ns.nspname = 'public'
      and array_length(c.conkey, 1) = 1
      and c.conrelid <> 'public.profiles'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_to, p_from;
    get diagnostics cnt = row_count;
    if cnt > 0 then
      tbl := r.tbl; col := r.col; n := cnt;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.fn_profile_ref_blockers(uuid)       from public, anon, authenticated;
revoke all on function public.fn_profile_reassign_refs(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_profile_ref_blockers(uuid)       to service_role;
grant execute on function public.fn_profile_reassign_refs(uuid, uuid) to service_role;

comment on function public.fn_profile_ref_blockers(uuid) is
  'edge delete-user: แถวในตารางอื่นที่อ้างบัญชีนี้ด้วย FK แบบ NO ACTION/RESTRICT (= สิ่งที่กันลบ) · service_role เท่านั้น';
comment on function public.fn_profile_reassign_refs(uuid, uuid) is
  'edge delete-user: โอนคอลัมน์ผู้กระทำ (FK ไป profiles/auth.users ที่ไม่ cascade) จากบัญชีซ้ำไปบัญชีที่เหลือก่อนลบ · service_role เท่านั้น';

-- ตรวจผล (SQL Editor · MAIN):
-- select * from public.fn_profile_ref_blockers('<uuid บัญชีที่จะลบ>');
