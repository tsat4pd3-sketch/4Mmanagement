-- 20261006b_manpower_board_slots_techs_main.sql · ⚠️ Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- 🧑‍🤝‍🧑 Manpower Control Board — งานค้าง 2 ข้อ (คำสั่ง user 06/10 "ทำส่วนที่ยังไม่ได้ทำต่อเลย")
--   1) manpower_slot_plans  = จำนวน "ช่องตำแหน่ง" ต่อ (แผนก, ทีม) ที่หัวหน้าตั้งเอง
--      ไม่ตั้ง = บอร์ดใช้ std กะของไลน์ (stdManpower.js) เหมือนเดิม ⇒ ตารางว่าง = พฤติกรรมเดิมเป๊ะ
--      เหตุที่ต้องมี: std ของไลน์ = "คนต่อกะทั้งกลุ่มไลน์" แต่บอร์ดกระดาษแขวนช่องตามทีมของแผนก
--      (แผนกที่ไม่ได้ผูกไลน์ / ทีม C ที่ไม่หมุนกะ ไม่มีทางคิดช่องจาก std ได้เลย)
--   2) line_technicians     = ช่างคนไหนประจำไลน์ไหน (หลายต่อหลาย)
--      เหตุที่ต้องมี: ช่าง MTN/DIE/JIG 18 คน `employees.line_id` ว่างทั้งหมด (สังกัดแผนกช่าง ไม่ใช่ไลน์)
--      ⇒ ห้ามยัด line_id ให้ (จะกลายเป็น "สังกัดไลน์" ผิดความหมาย + Checkin/Report นับเขาเป็นคนไลน์)
--
-- สิทธิ์: คีย์เดียว `manpower_board:edit` (ปุ่ม ⚙️ ตั้งค่าบอร์ดบนจอ) · policy ผ่าน has_perm ห้าม hardcode role
--   seed admin/manager/supervisor (คนที่ดูแลผังกำลังคนจริง) — เพิ่มเองได้ที่ /permissions
-- audit: fn_audit ตัวปกติ (คนกดในแอปเท่านั้น ไม่มี job เขียน)
-- backward-compatible: ตารางใหม่ล้วน ไม่แตะของเดิม
-- rollback (ย้อนโค้ดก่อน แล้วค่อยรัน):
--   drop table if exists public.line_technicians; drop table if exists public.manpower_slot_plans;
--   delete from public.role_permissions where permission_key = 'manpower_board:edit';
--   delete from public.permission_catalog where resource = 'manpower_board' and action = 'edit';
begin;

create table if not exists public.manpower_slot_plans (
  id          uuid primary key default gen_random_uuid(),
  org_node_id uuid not null references public.org_nodes(id) on delete cascade,
  team        text not null default '',            -- '' = ไม่ระบุทีม (คอลัมน์ "ไม่ระบุทีม" บนบอร์ด)
  slots       integer not null check (slots >= 0 and slots <= 500),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_node_id, team)
);

create table if not exists public.line_technicians (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  line_id     integer not null references public.production_lines(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, line_id)
);
create index if not exists line_technicians_line_idx on public.line_technicians (line_id);

alter table public.manpower_slot_plans enable row level security;
alter table public.line_technicians    enable row level security;

drop policy if exists msp_read  on public.manpower_slot_plans;
drop policy if exists msp_write on public.manpower_slot_plans;
create policy msp_read  on public.manpower_slot_plans for select to authenticated using (true);
create policy msp_write on public.manpower_slot_plans for all to authenticated
  using (has_perm('manpower_board:edit')) with check (has_perm('manpower_board:edit'));

drop policy if exists lt_read  on public.line_technicians;
drop policy if exists lt_write on public.line_technicians;
create policy lt_read  on public.line_technicians for select to authenticated using (true);
create policy lt_write on public.line_technicians for all to authenticated
  using (has_perm('manpower_board:edit')) with check (has_perm('manpower_board:edit'));

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.manpower_slot_plans;
    create trigger trg_set_updated_at before update on public.manpower_slot_plans
      for each row execute function public.fn_set_updated_at();
    drop trigger if exists trg_set_updated_at on public.line_technicians;
    create trigger trg_set_updated_at before update on public.line_technicians
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.manpower_slot_plans;
    create trigger trg_audit after insert or update or delete on public.manpower_slot_plans
      for each row execute function public.fn_audit();
    drop trigger if exists trg_audit on public.line_technicians;
    create trigger trg_audit after insert or update or delete on public.line_technicians
      for each row execute function public.fn_audit();
  end if;
end $$;

insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'manpower_board', 'edit',
       'Manpower Control Board: ตั้งจำนวนช่องตำแหน่งต่อทีม + ผูกช่างประจำไลน์',
       'ฝ่ายผลิต', 455
where not exists (select 1 from public.permission_catalog where resource = 'manpower_board' and action = 'edit');

insert into public.role_permissions (role, permission_key, allowed)
select r, 'manpower_board:edit', true
from unnest(array['admin','manager','supervisor']::user_role[]) r
on conflict (role, permission_key) do nothing;

commit;
