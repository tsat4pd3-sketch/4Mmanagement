-- ════════════════════════════════════════════════════════════════════════════
-- `audit_log_retention.mode` — เลือกได้ว่าของที่พ้นอายุ "ย้าย" หรือ "ลบทิ้ง"
-- DR ("Product DB" · eyhclzkifitbhbljgoav)                             2026-11-13
--
-- ที่มา: `20261113b_audit_log_retention_dr.sql` ย้ายของเก่าไป `archive.audit_log_aged`
--   แต่ **archive อยู่ในฐานเดียวกัน ⇒ ไม่ได้คืนดิสก์เลย** (วัดจริง: 198 MB → 255 MB = เพิ่ม 57 MB)
--   user เคาะ 13/11 ว่าของ 4 ตารางนั้นไม่ต้องเก็บ แล้วสั่ง `drop table archive.audit_log_aged`
--
-- 🔴 **แต่ drop ทิ้งเฉยๆ ทำให้ `fn_audit_log_sweep()` พังตอน cron ตี 4** (มันเขียนลงตารางนั้น)
--   ⇒ migration นี้แก้ให้ถูกทาง: ให้ "โหมด" เป็นของในทะเบียน ไม่ใช่สมมติฐานฝังในฟังก์ชัน
--
-- · `mode = 'archive'` (**ค่าเริ่มต้น**) — ย้ายไป `archive.audit_log_aged` · ปลอดภัยสุด
--   ใช้กับตารางที่จะเพิ่มทีหลัง (เช่นธุรกรรมผลิต/คุณภาพ เมื่อ doc control เคาะอายุแล้ว)
-- · `mode = 'delete'` — ลบทิ้งเลย · **ใช้เฉพาะตารางที่คนตัดสินแล้วว่าไม่ต้องเก็บ**
--
-- 🔴 ค่าเริ่มต้นต้องเป็น `archive` เสมอ — เพิ่มตารางเข้าทะเบียนแล้วลืมคิดเรื่องโหมด
--    ต้องได้ผลลัพธ์ที่ "เสียหายน้อยที่สุด" ไม่ใช่ลบทิ้ง
--
-- ย้อนกลับ: alter table public.audit_log_retention drop column mode;
--           (แล้ว revert fn_audit_log_sweep กลับเวอร์ชัน archive อย่างเดียว)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.audit_log_retention
  add column if not exists mode text not null default 'archive'
  check (mode in ('archive','delete'));

comment on column public.audit_log_retention.mode is
  'archive = ย้ายไป archive.audit_log_aged (default) · delete = ลบทิ้ง (เฉพาะตารางที่ user/doc control เคาะแล้ว)';

-- ปลายทางของโหมด archive — สร้างใหม่หลัง user สั่ง drop ของรอบแรกทิ้ง
create table if not exists archive.audit_log_aged (
  id             bigint primary key,
  table_name     text not null,
  row_pk         text,
  action         text not null,
  actor          text,
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb,
  changed_at     timestamptz not null,
  actor_uid      uuid,
  archived_at    timestamptz not null default now()
);
create index if not exists idx_audit_log_aged_tbl_time
  on archive.audit_log_aged (table_name, changed_at desc);

-- 4 ตารางที่ user เคาะ 13/11 ว่าไม่ต้องเก็บ (สั่ง drop สำเนารอบแรกทิ้ง)
update public.audit_log_retention
   set mode = 'delete', updated_at = now()
 where table_name in ('customer_shipping_orders','monitor_cells','stock_receipts','jig_checkpoints');

create or replace function public.fn_audit_log_sweep(p_batch int default 10000)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_arch int := 0;
  v_del  int := 0;
begin
  -- ① โหมด archive — ย้ายไปเก็บ แล้วค่อยลบออกจากตารางหลัก
  with doomed as (
    select a.id
      from public.audit_log a
      join public.audit_log_retention r on r.table_name = a.table_name
     where r.mode = 'archive'
       and a.changed_at < now() - make_interval(days => r.keep_days)
     limit greatest(p_batch, 1)
  ),
  moved as (
    delete from public.audit_log a
     where a.id in (select id from doomed)
    returning a.*
  )
  insert into archive.audit_log_aged
        (id, table_name, row_pk, action, actor, changed_fields, old_data, new_data, changed_at, actor_uid)
  select id, table_name, row_pk, action, actor, changed_fields, old_data, new_data, changed_at, actor_uid
    from moved
  on conflict (id) do nothing;
  get diagnostics v_arch = row_count;

  -- ② โหมด delete — ลบทิ้งเลย
  with doomed as (
    select a.id
      from public.audit_log a
      join public.audit_log_retention r on r.table_name = a.table_name
     where r.mode = 'delete'
       and a.changed_at < now() - make_interval(days => r.keep_days)
     limit greatest(p_batch, 1)
  )
  delete from public.audit_log a where a.id in (select id from doomed);
  get diagnostics v_del = row_count;

  return v_arch + v_del;
end;
$function$;

revoke all on function public.fn_audit_log_sweep(int) from public, anon, authenticated;
grant execute on function public.fn_audit_log_sweep(int) to service_role;
