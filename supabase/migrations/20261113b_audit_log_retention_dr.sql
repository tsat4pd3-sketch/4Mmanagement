-- ════════════════════════════════════════════════════════════════════════════
-- Retention ของ `audit_log` — ย้ายของเก่าไป schema `archive` (ไม่ลบทิ้ง)
-- DR ("Product DB" · eyhclzkifitbhbljgoav)                             2026-11-13
--
-- ที่มา (วัด 13/11): `audit_log` = **198 MB = 63% ของ public ทั้งหมดฝั่ง DR**
--   141k+ แถว · เก่าสุดแค่ 24/07 · **30 วันล่าสุด = 57% ของทั้งตาราง**
--   ⇒ ตัวนี้ไม่ได้ใหญ่เพราะเก็บนาน แต่ใหญ่เพราะ**อัตราการเขียนวันนี้**
--   📄 ที่มา + ใครเขียน + ใครอ่าน → `docs/modules/traceability-audit-log.md`
--
-- 🔴 หลักที่ยึด 3 ข้อ (ห้ามเปลี่ยนโดยไม่อ่านเอกสาร):
--   1. **ไม่อยู่ในทะเบียน = เก็บตลอดไป** — ค่าเริ่มต้นคือ "ไม่กวาด" (fail-safe)
--      เพิ่มตารางเข้าทะเบียนคือการ "อนุญาตให้กวาด" ไม่ใช่กลับกัน
--   2. **ย้าย ไม่ใช่ลบ** — ของเก่าไป `archive.audit_log_aged` ยังสอบกลับได้
--      (กฎโปรเจค: ข้อมูลที่ copy/ย้ายต้องอยู่ schema `archive` ห้ามอยู่ใน `public`)
--   3. **กวาดเฉพาะตารางที่ไม่มีจอไหนอ่าน audit ของมัน** — ไล่ครบทั้ง 5 จุดที่อ่าน `audit_log` แล้ว
--      (`WorkforceInsight` · `ProductHistory` · `OrderTrace` · `ManpowerBoard` · `AuditLogViewer`)
--
-- ⚠️ **ยังไม่แตะตารางธุรกรรมผลิต/คุณภาพ** (`production_sessions` · `prod_orders` · `defect_logs` · MO)
--    อายุบันทึกพวกนี้เป็นข้อกำหนด IATF/ลูกค้า — **ให้ doc control เคาะก่อน** แล้วค่อย
--    `insert into audit_log_retention` เพิ่ม ไม่ต้องแก้โค้ด
--
-- ⚠️ ลบแถวแล้ว **ไฟล์ตารางไม่หดเอง** — เนื้อที่กลายเป็น "ที่ว่างใช้ซ้ำได้" เท่านั้น
--    จะคืนดิสก์จริงต้อง `vacuum full public.audit_log` ซึ่ง**ล็อกตารางทั้งตัว** ⇒ ทำนอกเวลาทำงาน
--
-- ย้อนกลับทั้งหมด:
--   select cron.unschedule('audit-log-sweep');
--   insert into public.audit_log select id, table_name, row_pk, action, actor, changed_fields,
--          old_data, new_data, changed_at, actor_uid from archive.audit_log_aged
--     on conflict (id) do nothing;
--   drop function if exists public.fn_audit_log_sweep(int);
--   drop table if exists public.audit_log_retention;
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ทะเบียนอายุเก็บ (ค่าเกณฑ์อยู่ในข้อมูล ห้าม hardcode ในฟังก์ชัน) ──────────────
create table if not exists public.audit_log_retention (
  table_name text primary key,
  keep_days  int  not null check (keep_days >= 7),
  note       text,
  updated_at timestamptz not null default now()
);

comment on table public.audit_log_retention is
  'อายุเก็บ audit_log รายตาราง · ไม่มีชื่อในนี้ = เก็บตลอดไป (fail-safe) · 📄 docs/modules/traceability-audit-log.md';

alter table public.audit_log_retention enable row level security;

-- อ่านได้ (ให้จอ/คนตรวจดูได้ว่าตารางไหนตั้งไว้กี่วัน) · **ไม่มี policy เขียน = client เขียนไม่ได้เลย**
-- แก้ทะเบียนผ่าน SQL Editor / service_role เท่านั้น (เป็นการตั้งค่านโยบายเก็บเอกสาร ไม่ใช่งานประจำวัน)
drop policy if exists audit_log_retention_read on public.audit_log_retention;
create policy audit_log_retention_read on public.audit_log_retention for select using (true);

grant select on public.audit_log_retention to anon, authenticated;

-- ── 2. ปลายทางของเก่า ────────────────────────────────────────────────────────
create schema if not exists archive;

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

-- ── 3. ตัวกวาด ───────────────────────────────────────────────────────────────
/* ย้ายทีละก้อน (ก้อนใหญ่ = WAL พุ่ง + ล็อกนาน) · คืนจำนวนแถวที่ย้ายได้จริงในรอบนี้
   เรียกซ้ำจนได้ 0 = หมด · ปลอดภัยถ้าถูกเรียกซ้อน (ก้อนที่ถูกลบไปแล้วจะไม่ถูกเลือกอีก) */
create or replace function public.fn_audit_log_sweep(p_batch int default 10000)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_moved int;
begin
  with doomed as (
    select a.id
      from public.audit_log a
      join public.audit_log_retention r on r.table_name = a.table_name
     where a.changed_at < now() - make_interval(days => r.keep_days)
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

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$function$;

revoke all on function public.fn_audit_log_sweep(int) from public, anon, authenticated;
grant execute on function public.fn_audit_log_sweep(int) to service_role;

-- ── 4. ตั้งเวลา — ตี 4 เวลาไทย (21:00 UTC) = ช่วงที่เขียนน้อยที่สุดของวัน ──────────
select cron.unschedule('audit-log-sweep')
 where exists (select 1 from cron.job where jobname = 'audit-log-sweep');

select cron.schedule('audit-log-sweep', '0 21 * * *',
  $cron$ select public.fn_audit_log_sweep(20000); $cron$);

-- ── 5. ทะเบียนตั้งต้น — **เฉพาะตารางที่ไม่มีจอไหนอ่าน audit ของมัน** ─────────────────
insert into public.audit_log_retention (table_name, keep_days, note) values
  ('customer_shipping_orders', 30, 'นำเข้า EDI ซ้ำทั้งชุด (INSERT~DELETE) · ไม่มีจอไหนอ่าน audit'),
  ('monitor_cells',            30, 'ช่องกรอกรายวันของบอร์ด Monitoring · ไม่มีจอไหนอ่าน audit'),
  ('stock_receipts',           30, 'รับของเข้าสโตร์รายวัน · ไม่มีจอไหนอ่าน audit'),
  ('jig_checkpoints',          30, 'จุดตรวจจิ๊ก แก้ถี่รายวัน · ไม่มีจอไหนอ่าน audit')
on conflict (table_name) do nothing;
