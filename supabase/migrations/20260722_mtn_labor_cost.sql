-- MTN Work-Order — ค่าแรงซ่อมมาตรฐาน (standard price) + ค่าใช้จ่ายต่อใบ · DR project (eyhclzkifitbhbljgoav)
-- ช่างกรอก "ราคามาตรฐานค่าแรงซ่อม" ไว้ที่ master แล้วเลือกมาใส่ในใบ MO (ขั้นซ่อม)
--   → พิมพ์ลงฟอร์ม FM-MTN-006 ช่อง (1) ค่าซ่อม / (2) ค่าอะไหล่ / รวม
-- master ราคามาตรฐาน (anon-open ตาม convention DR)
create table if not exists public.mtn_labor_rates (
  id uuid primary key default gen_random_uuid(),
  name       text not null,               -- ประเภทงาน/ระดับช่าง เช่น "ค่าแรงช่างซ่อมทั่วไป"
  unit       text default 'บาท/ชม.',      -- หน่วยราคา (บาท/ชม. · บาท/ครั้ง)
  price      numeric default 0,           -- ราคามาตรฐาน
  dept       text,                        -- ทีม (null = ใช้ได้ทุกทีม)
  is_active  boolean default true,
  sort_order int default 0,
  created_at timestamptz default now()
);
alter table public.mtn_labor_rates enable row level security;
do $$ begin
  create policy mtn_labor_rates_all on public.mtn_labor_rates for all using (true) with check (true);
exception when duplicate_object then null; end $$;
grant all on public.mtn_labor_rates to anon, authenticated;

-- ค่าใช้จ่ายต่อใบ (กรอกขั้นซ่อม — ไม่บังคับ)
alter table public.mtn_orders add column if not exists labor_cost numeric;   -- (1) ค่าแรงซ่อม
alter table public.mtn_orders add column if not exists parts_cost numeric;   -- (2) ค่าอะไหล่และอุปกรณ์
