-- 🌱 Carbon เฟส C1 — ตีหน่วยพลังงานเป็น CO2e + จัดชั้นจุดวัด (มีมิเตอร์ / ยังไม่มี)
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-19
--
-- ที่มา (user 2026-08-19):
--   (1) "เอา C1 ก่อนเลย แต่สุดท้ายต้องเอาทั้ง CFO และ CFP แหละ"
--   (2) "หน้ากรอกข้อมูล น่าจะต้องแยกส่วน ว่า utility ส่วนไหนของไลน์ผลิต ซึ่งตอนนี้น่าจะยังไม่มีมิเตอร์
--        ส่วนใหญ่ดูจาก main ที่ utility เลย และค่อย total ทั้งโรงงาน เป็น sum cumulate กันขึ้นมา"
--   ขอบเขตที่ตัดสินแล้ว: Scope 1+2 · ไม่ประเมิน Scope 3 (ดู ENERGY_MONITORING_DESIGN.md §12.3)
--
-- ⚠️ ปัญหาที่แก้ด้วย energy_points:
--   ของเดิมมองทุกจุดเท่ากันหมด → หน้าจอขึ้น "กรอกแล้ว 2/16 จุด" และเตือน "ผลรวมต่างจากบิล -85.1%"
--   ทั้งที่ความจริงคือ **มีมิเตอร์แค่ 2 จุด และกรอกครบแล้ว** ส่วนที่เหลือคือส่วนที่ยังไม่ได้แยกมิเตอร์
--   → ตัวเลขเดิมทำให้ดูเหมือน "ทำงานไม่เสร็จ/ข้อมูลผิด" ทั้งที่ทำครบเท่าที่วัดได้ (เตือนผิดที่ = คนเลิกเชื่อ)

-- ── (1) ชั้นของจุดวัด: จุดไหนมีมิเตอร์จริง ──────────────────────────────
-- แถวมีเฉพาะจุดที่ตั้งค่าไว้ · ไม่มีแถว = ยังไม่มีมิเตอร์ (ค่าเริ่มต้น ไม่ต้อง seed ทุกไลน์)
-- ⚠️ ไม่เก็บ "utility นี้จ่ายไลน์ไหน" ซ้ำที่นี่ — ของนั้นอยู่ `facility_supply_links` แล้ว
--    (กฎ single source of truth · เก็บ 2 ที่เมื่อไหร่ drift เมื่อนั้น)
create table if not exists public.energy_points (
  id          uuid primary key default gen_random_uuid(),
  scope_kind  text not null check (scope_kind in ('line','zone')),
  scope_name  text not null,
  is_metered  boolean not null default false,   -- ★ มีมิเตอร์อ่านได้จริง → นับเข้า "ผลรวมที่วัดได้"
  sort_order  int not null default 0,
  note        text,
  updated_by_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (scope_kind, scope_name)
);

alter table public.energy_points enable row level security;
drop policy if exists energy_points_all on public.energy_points;
create policy energy_points_all on public.energy_points
  for all to anon, authenticated using (true) with check (true);

drop trigger if exists trg_energy_points_updated on public.energy_points;
create trigger trg_energy_points_updated before update on public.energy_points
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_energy_points_audit on public.energy_points;
create trigger trg_energy_points_audit after insert or update or delete on public.energy_points
  for each row execute function public.fn_audit();

-- ติ๊กจุดที่ "เคยกรอกค่าจริงมาแล้ว" ให้เป็นมีมิเตอร์ไว้ก่อน (ข้อมูลที่มีอยู่ = หลักฐานว่าอ่านค่าได้)
-- คนแก้ทีหลังได้จากหน้าจอ — เดาให้แค่ค่าตั้งต้นเพื่อไม่ให้เปิดมาเจอ "ยังไม่มีจุดที่มีมิเตอร์" ทั้งที่กรอกไปแล้ว
insert into public.energy_points (scope_kind, scope_name, is_metered, note)
select distinct m.scope_kind, m.scope_name, true, 'ตั้งอัตโนมัติจากข้อมูลที่เคยกรอกไว้ (แก้ได้)'
  from public.energy_monthly m
 where m.scope_kind in ('line','zone') and m.qty is not null
on conflict (scope_kind, scope_name) do nothing;

-- ── (2) ชนิดพลังงาน/เชื้อเพลิง (data-driven — ห้าม hardcode รายการใน UI) ──
create table if not exists public.energy_utilities (
  key         text primary key,
  label       text not null,
  unit        text not null,                    -- 'kWh' | 'litre' | 'kg'
  ghg_scope   int,                              -- 1 = เผาไหม้เอง · 2 = ซื้อไฟฟ้า · null = ยังไม่จัด
  icon        text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  updated_by_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.energy_utilities (key, label, unit, ghg_scope, icon, sort_order) values
  ('electric', 'ไฟฟ้า', 'kWh', 2, '⚡', 10)
on conflict (key) do nothing;

-- ── (3) ค่าการปล่อยก๊าซเรือนกระจก (Emission Factor) ────────────────────
-- ★ 1 แถว = EF ของ 1 ชนิด ณ ช่วงเวลาหนึ่ง — **เก็บประวัติ ห้ามแก้ทับ**
--   EF เปลี่ยนเกือบทุกปี · ถ้าแก้ทับ ตัวเลขที่เคยรายงานลูกค้าไปแล้วจะเปลี่ยนเองเงียบๆ
--   (หลักเดียวกับ "ห้าม blanket-recompute OEE กะเก่าด้วย master ปัจจุบัน")
-- ★ source_ref บังคับ not null — ผู้ทวนสอบถามข้อแรกเสมอว่าเลขนี้มาจากไหน
create table if not exists public.energy_emission_factors (
  id             uuid primary key default gen_random_uuid(),
  utility_key    text not null references public.energy_utilities(key),
  kg_co2e        numeric not null check (kg_co2e >= 0),   -- kgCO2e ต่อ 1 หน่วยของ utility นั้น
  effective_from date not null,
  source_ref     text not null,                 -- 'TGO Emission Factor ฉบับ ... 25xx'
  note           text,
  updated_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (utility_key, effective_from)
);

-- ⚠️ **ไม่ seed ค่า EF ใดๆ โดยตั้งใจ** — ต้องให้คนเอาประกาศ TGO มากรอกเอง พร้อมระบุที่มา
--    ใส่เลขมั่วไว้ก่อน = ตัวเลขคาร์บอนผิดที่ดูเหมือนถูก ซึ่งอันตรายกว่าไม่มีตัวเลข
--    ยังไม่กรอก → หน้าจอขึ้น "ยังไม่ได้ตั้งค่าการปล่อย" และ tCO2e = null (กฎ: ประเมินไม่ได้ = null ห้ามเดา)

alter table public.energy_utilities enable row level security;
alter table public.energy_emission_factors enable row level security;
drop policy if exists energy_utilities_all on public.energy_utilities;
create policy energy_utilities_all on public.energy_utilities
  for all to anon, authenticated using (true) with check (true);
drop policy if exists energy_ef_all on public.energy_emission_factors;
create policy energy_ef_all on public.energy_emission_factors
  for all to anon, authenticated using (true) with check (true);

drop trigger if exists trg_energy_utilities_updated on public.energy_utilities;
create trigger trg_energy_utilities_updated before update on public.energy_utilities
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_energy_ef_updated on public.energy_emission_factors;
create trigger trg_energy_ef_updated before update on public.energy_emission_factors
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_energy_utilities_audit on public.energy_utilities;
create trigger trg_energy_utilities_audit after insert or update or delete on public.energy_utilities
  for each row execute function public.fn_audit();
drop trigger if exists trg_energy_ef_audit on public.energy_emission_factors;
create trigger trg_energy_ef_audit after insert or update or delete on public.energy_emission_factors
  for each row execute function public.fn_audit();

comment on table public.energy_points is
  'ชั้นของจุดวัดพลังงาน — is_metered = มีมิเตอร์อ่านได้จริง (นับเข้าผลรวมที่วัดได้) · ไม่มีแถว = ยังไม่มีมิเตอร์';
comment on table public.energy_emission_factors is
  'ค่าการปล่อย (EF) แยกตามช่วงเวลา — ห้ามแก้ทับของเก่า (ตัวเลขที่รายงานไปแล้วต้องนิ่ง) · source_ref บังคับ';

-- Rollback:
--   drop table public.energy_emission_factors;
--   drop table public.energy_utilities;
--   drop table public.energy_points;
--   (additive ล้วน · energy_monthly เดิมไม่ถูกแตะ — ลบแล้วหน้าพลังงานกลับไปทำงานแบบเฟส 1 เดิม)
