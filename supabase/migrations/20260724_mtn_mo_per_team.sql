-- เลข MO แยกต่อทีม (นับต่อเนื่องต่อทีม + อ่านวันที่ออกได้ + เก็บประเภทงาน) — DR project (eyhclzkifitbhbljgoav)
-- คำสั่ง user 2026-07-24: เดิม mtn_mo_counter นับรวมทุกทีมต่อวัน → เลขปนกันข้ามทีม แยกทีมไม่ได้
-- ใหม่: format = <TEAMCODE>-<TYPE>-<DDMMYY>-<เลขรันต่อเนื่องต่อทีม>  เช่น MTN-BM-250726-0678
--   • TEAMCODE = mtn_teams.mo_code (data-driven) · TYPE = prefix ประเภทงานซ่อม (BM/IM/CM/PM/AM/RE)
--   • DDMMYY = วันที่ออกเลข (เวลาไทย) — อ่านออกว่าใบนี้ออกวันไหน
--   • เลขรัน = ต่อเนื่องต่อทีม ไม่รีเซ็ตรายวัน (mtn_mo_seq keyed by team_code) → ตั้งเลขเริ่มต้น (ต่อจากระบบเดิม) ได้
-- ⚠️ ต้อง apply หลัง 20260722_mtn_teams.sql (อ้าง mtn_teams)

-- 1) รหัสทีมสำหรับเลข MO (แก้ได้จาก ⚙️ ข้อมูลตั้งต้น → 🔢 เลขรัน MO)
alter table public.mtn_teams add column if not exists mo_code text;
update public.mtn_teams set mo_code = case key
  when 'maintenance' then 'MTN' when 'jig_maintenance' then 'JIG'
  when 'die_maintenance' then 'DIE' when 'production' then 'PRD' else upper(substr(regexp_replace(coalesce(dept_name,'MTN'),'\s','','g'),1,3)) end
  where mo_code is null;

-- 2) ตัวนับต่อเนื่องต่อทีม (last_seq — ตั้งค่าเริ่มต้นต่อทีมได้เพื่อต่อเลขเดิม)
create table if not exists public.mtn_mo_seq (
  team_code  text primary key,
  last_seq   int not null default 0,
  updated_at timestamptz default now()
);
alter table public.mtn_mo_seq enable row level security;
do $$ begin
  create policy mtn_mo_seq_all on public.mtn_mo_seq for all using (true) with check (true);
exception when duplicate_object then null; end $$;
grant all on public.mtn_mo_seq to anon, authenticated;

-- 3) RPC v2 — ออกเลขแยกต่อทีม (signature เดิม ไม่ต้องแก้ client) · idempotent · atomic ต่อทีม
create or replace function public.mtn_assign_mo_no(p_order_id uuid, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_ymd text; v_seq int; v_no text; v_existing text; v_dept text; v_code text;
begin
  select mo_no, mtn_dept, to_char(coalesce(report_at, now()) at time zone 'Asia/Bangkok', 'DDMMYY')
    into v_existing, v_dept, v_ymd
  from public.mtn_orders where id = p_order_id;
  if v_existing is not null and v_existing <> '' then
    return v_existing;                 -- idempotent — ออกเลขครั้งเดียวต่อใบ
  end if;
  -- รหัสทีมจาก mtn_teams (data-driven) — โยงด้วย dept_name · fallback ถ้าไม่พบ
  select mo_code into v_code from public.mtn_teams where dept_name = v_dept and mo_code is not null limit 1;
  v_code := coalesce(nullif(v_code, ''), upper(substr(regexp_replace(coalesce(v_dept,'MTN'),'\s','','g'),1,3)), 'MTN');
  -- เลขรันต่อเนื่องต่อทีม (ไม่รีเซ็ตรายวัน)
  insert into public.mtn_mo_seq(team_code, last_seq) values (v_code, 1)
    on conflict (team_code) do update set last_seq = public.mtn_mo_seq.last_seq + 1, updated_at = now()
    returning last_seq into v_seq;
  v_no := v_code || '-' || coalesce(nullif(p_prefix,''),'BM') || '-' || v_ymd || '-' || lpad(v_seq::text, 4, '0');
  update public.mtn_orders set mo_no = v_no, mo_seq = v_seq, updated_at = now() where id = p_order_id;
  return v_no;
end $$;
grant execute on function public.mtn_assign_mo_no(uuid, text) to anon, authenticated;
