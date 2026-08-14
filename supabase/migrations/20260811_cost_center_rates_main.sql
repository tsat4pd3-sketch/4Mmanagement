-- Activity Rate ต่อ Cost Center (DL / OH / DP บาท/ชม.) — ใช้แปลงผล Improvement เป็น cost saving (บาท)
-- Main project (ewhdfqwfwofivojtsizn) — ผูกกับผังองค์กร: cost center มาจาก org_nodes.cost_center + production_lines.cost_center
-- เก็บแบบมี effective_from (rate ปรับรายปีโดยบัญชี) — โปรเจคเก่าคำนวณด้วย rate ณ ช่วงเวลานั้น ไม่เพี้ยนย้อนหลัง
-- จัดการที่หน้า /org-setup แผง "💰 Activity Rate" · อ่านที่ /improvements (คำนวณ cost saving)

create table if not exists public.cost_center_rates (
  id             uuid primary key default gen_random_uuid(),
  cost_center    text not null,
  effective_from date not null default '2000-01-01',
  dl_rate        numeric not null default 0,   -- Direct Labor บาท/ชม.
  oh_rate        numeric not null default 0,   -- Overhead บาท/ชม.
  dp_rate        numeric not null default 0,   -- Depreciation บาท/ชม.
  note           text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (cost_center, effective_from)
);

alter table public.cost_center_rates enable row level security;

-- pattern เดียวกับ org_nodes/section_signers: authenticated ทั้งอ่าน/เขียน (หน้า /org-setup gate ด้วย RoleRoute admin อยู่แล้ว)
drop policy if exists cost_center_rates_select on public.cost_center_rates;
create policy cost_center_rates_select on public.cost_center_rates for select to authenticated using (true);
drop policy if exists cost_center_rates_write on public.cost_center_rates;
create policy cost_center_rates_write on public.cost_center_rates for all to authenticated using (true) with check (true);

-- audit + updated_at (กฎเหล็ก: master ที่แก้ได้ต้องมี audit) — guard เผื่อ audit migration ยังไม่ apply
do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.cost_center_rates;
    create trigger trg_set_updated_at before update on public.cost_center_rates
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.cost_center_rates;
    create trigger trg_audit after insert or update or delete on public.cost_center_rates
      for each row execute function public.fn_audit();
  end if;
end $$;
