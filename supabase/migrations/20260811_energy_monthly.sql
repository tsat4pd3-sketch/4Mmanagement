-- ⚡ Energy เฟส 1 — กรอกค่าพลังงานรายเดือน แล้วโชว์บนผังรวมโรงงาน
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-11
--
-- ที่มา (ทีมสรุปกันทางแชท 2026-08-11):
--   "เอาผังโรงงานที่สร้างไว้ แล้ว show ค่า kWh บริเวณ Line นั้นๆ ก่อน อยากดูละเอียดค่อยกดเข้าไป
--    ทำกราฟตัวเลขแบบ CMMS มันดูยาก" + "Phase แรก ขอ Input ข้อมูลรายเดือนได้ก่อน เพื่อเอาไปพรีเซนต์"
--
-- ⚠️ เฟสนี้ตั้งใจ "เบาที่สุด" — ตารางเดียว ไม่มีมิเตอร์/ไม่มีการปันส่วน
--    เพราะเป้าหมายคือ "ทำให้เป็นรูปร่างเพื่อพรีเซนต์" ไม่ใช่ระบบวัดจริง
--    โครงเต็ม (energy_meters/readings/tariffs) อยู่ใน docs/ENERGY_MONITORING_DESIGN.md เฟส 2-3
--
-- ⚠️ ค่าที่กรอกมือ **ห้ามแสดงให้ดูเหมือนค่าที่วัดได้จริง** — คอลัมน์ `source` บังคับให้ทุกจอ
--    ติดป้ายบอกที่มา (กรอกมือ / จากมิเตอร์ / ประมาณการ) หลักเดียวกับป้าย "จำลอง" ใน /group-overview

create table if not exists public.energy_monthly (
  id          uuid primary key default gen_random_uuid(),
  -- ผูกกับ "พื้นที่บนผัง" ไม่ใช่กับมิเตอร์ — เฟส 1 ยังไม่มีทะเบียนมิเตอร์
  --   line  = ชื่อไลน์ผลิต (production_lines.name)
  --   zone  = ชื่อโซน facility (pm_facility_areas.name / line_name ของเครื่อง facility)
  --   plant = ทั้งโรงงาน (ยอดจากบิลค่าไฟ — ใช้เทียบว่าผลรวมรายไลน์ห่างจากบิลแค่ไหน)
  scope_kind  text not null check (scope_kind in ('line','zone','plant')),
  scope_name  text not null,
  month_key   text not null,                     -- 'YYYY-MM'
  -- ⚠️ เฟสนี้ทำ **ไฟฟ้าอย่างเดียว** (คำสั่ง user 2026-08-11) — UI ไม่มีตัวเลือก utility
  --    คงคอลัมน์ไว้เพราะเป็นส่วนหนึ่งของ unique key ถ้าวันหน้าจะเพิ่มลม/น้ำ จะได้ไม่ต้องแก้ constraint
  utility     text not null default 'electric',
  qty         numeric,                           -- หน่วยที่ใช้ (kWh / m3)
  cost        numeric,                           -- บาท (กรอกเองได้ ไม่ต้องมีตารางอัตราค่าไฟในเฟสนี้)
  source      text not null default 'manual'     -- ★ manual = คนกรอก · meter = จากมิเตอร์ · estimated = ประมาณการ
                check (source in ('manual','meter','estimated')),
  note        text,
  updated_by_name text,                          -- ★ ต้องมี → ใส่ใน DR_AUDIT_TABLES ได้
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (scope_kind, scope_name, month_key, utility)
);

create index if not exists energy_monthly_month_idx on public.energy_monthly (month_key);

alter table public.energy_monthly enable row level security;
drop policy if exists energy_monthly_all on public.energy_monthly;
create policy energy_monthly_all on public.energy_monthly
  for all to anon, authenticated using (true) with check (true);

-- updated_at + audit (ตาราง master ที่แก้ได้ → ต้องรู้ว่าใครแก้ ตามกฎ Traceability)
drop trigger if exists trg_energy_monthly_updated on public.energy_monthly;
create trigger trg_energy_monthly_updated before update on public.energy_monthly
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_energy_monthly_audit on public.energy_monthly;
create trigger trg_energy_monthly_audit after insert or update or delete on public.energy_monthly
  for each row execute function public.fn_audit();

comment on table public.energy_monthly is
  'พลังงานรายเดือนต่อพื้นที่บนผัง (เฟส 1 กรอกมือ) — ดู docs/ENERGY_MONITORING_DESIGN.md';
comment on column public.energy_monthly.source is
  'manual=คนกรอก · meter=จากมิเตอร์ · estimated=ประมาณการ — ทุกจอต้องติดป้ายบอกที่มา ห้ามแสดงเหมือนค่าที่วัดจริง';

-- Rollback:
--   drop table public.energy_monthly;
--   (ไม่มีตารางอื่นอ้างถึง — additive ล้วน ลบแล้วระบบเดิมไม่กระทบ)
