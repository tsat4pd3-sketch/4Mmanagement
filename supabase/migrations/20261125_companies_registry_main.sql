-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- 🏢 ทะเบียนบริษัทในกลุ่ม `companies` — SPG · บริษัท · SAP 4 หลัก · Com Code 3 หลัก · SAP B1 (2026-11-25 · คำสั่ง user "ลุยเลย ต้องไม่กระทบงานเดิม")
--
-- ที่มา: template Com Code ของกลุ่ม (ส่งมา 25/11 · เคยคุย 03/11): Employee ID 7 หลัก = **Com Code 3 หลัก + running 4**
--   (เช่น 1100161 = TSA 110 + 0161) · Com Code = 3 หลักแรกของรหัส SAP (4 หลัก) · บริษัทที่ใช้ SAP B1 ใช้รหัส 3 หลักของมันเอง
--   เดิมระบบรู้จักแค่ TSAT ในผัง (org_nodes company 2100) + ชื่อย่อบริษัทใน cost_centers.company (11 บริษัทจากไฟล์บัญชี)
--   ⇒ ไม่มีที่เดียวที่ตอบว่า "บริษัทนี้อยู่ SPG ไหน · รหัส SAP/Com Code/B1 คืออะไร"
--
-- กติกา (ไม่กระทบของเดิม):
--   · **ตารางเพิ่มอย่างเดียว ไม่มี FK** — org_nodes(company).code · cost_centers.company · employees.employee_id_code ยังเก็บ text เหมือนเดิม
--     ทะเบียนนี้เป็น "ที่อ้างอิง" (เหมือน customers/suppliers) ⇒ ลบ/เปลี่ยนรหัสต้องผ่าน masterDeleteGuard นับปลายทางก่อน (utils/masterRefs.js)
--   · `code` = ชื่อย่อ (TSAT) เป็นคีย์ · `sap_code` 4 หลัก (null สำหรับบริษัท SAP B1) · `sap_b1_code` 3 หลัก · `com_code` 3 หลัก (เติมให้ตอน seed)
--   · ยังไม่ลงโหนดผังของบริษัทอื่น (ผังเรายังเป็นสาย P4 — ขั้น 4 ใน docs/ORG-SCALE-GLOBAL-DESIGN.md รอคำสั่ง)
--   · สิทธิ์: อ่านได้ทุกคนที่ login · เขียน = has_perm('org:manage_divisions') (คีย์ "ผังองค์กร: จัดการฝ่าย" — ทะเบียนชั้นกลุ่มอยู่ในหมวดเดียวกัน)
-- ย้อนกลับ: drop table public.companies;  (ไม่มีใครอ้างด้วย FK)

create table if not exists public.companies (
  code         text primary key,                 -- ชื่อย่อ เช่น TSAT (= ค่าที่ cost_centers.company ใช้)
  name         text,                             -- ชื่อเต็ม (เติมทีหลังได้)
  spg_no       text not null,                    -- '2000'
  spg_name     text not null,                    -- 'Automotive Metal Forming - AMF'
  sap_code     text,                             -- SAP 4 หลัก เช่น '2100' (null = บริษัทที่ใช้ SAP B1)
  sap_b1_code  text,                             -- SAP B1 3 หลัก เช่น '600'
  com_code     text,                             -- 3 หลักแรกของรหัสพนักงาน (เช่น '210')
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint companies_sap_code_4 check (sap_code is null or sap_code ~ '^[0-9]{4}$'),
  constraint companies_b1_code_3  check (sap_b1_code is null or sap_b1_code ~ '^[0-9]{3}$'),
  constraint companies_com_code_3 check (com_code is null or com_code ~ '^[0-9]{3}$'),
  constraint companies_some_code  check (sap_code is not null or sap_b1_code is not null)
);
comment on table public.companies is
  'ทะเบียนบริษัทในกลุ่ม TSG จาก template Com Code (25/11) — SPG · SAP 4 หลัก · Com Code 3 หลัก (= 3 หลักแรกของรหัสพนักงาน) · SAP B1 · ไม่มี FK: org_nodes/cost_centers/employees อ้างด้วยข้อความ (ดู utils/masterRefs.js)';

create unique index if not exists companies_sap_code_uniq on public.companies (sap_code) where sap_code is not null;
create unique index if not exists companies_sap_b1_code_uniq on public.companies (sap_b1_code) where sap_b1_code is not null;

-- seed จาก template (on conflict do nothing — รันซ้ำได้)
insert into public.companies (code, spg_no, spg_name, sap_code, sap_b1_code, com_code, sort_order) values
  ('TSA',    '1000', 'Holding',                               '1100', null,  '110', 1100),
  ('TSLA',   '2000', 'Automotive Metal Forming - AMF',        '1200', null,  '120', 1200),
  ('TSESA',  '2000', 'Automotive Metal Forming - AMF',        '1300', null,  '130', 1300),
  ('TSAT',   '2000', 'Automotive Metal Forming - AMF',        '2100', null,  '210', 2100),
  ('TSBP',   '2000', 'Automotive Metal Forming - AMF',        '2200', null,  '220', 2200),
  ('TSRF',   '2000', 'Automotive Metal Forming - AMF',        '2300', null,  '230', 2300),
  ('TSAP',   '2000', 'Automotive Metal Forming - AMF',        '2900', null,  '290', 2900),
  ('ITSA',   '2000', 'Automotive Metal Forming - AMF',        null,   '600', '600', 2600),
  ('TSSA',   '2000', 'Automotive Metal Forming - AMF',        null,   '608', '608', 2608),
  ('TSIS',   '3000', 'Interior & Exterior (Int & Ext)',       '1500', null,  '150', 1500),
  ('TSRA',   '3000', 'Interior & Exterior (Int & Ext)',       '1800', null,  '180', 1800),
  ('TSPT',   '3000', 'Interior & Exterior (Int & Ext)',       '3100', null,  '310', 3100),
  ('K99',    '3000', 'Interior & Exterior (Int & Ext)',       '3200', null,  '320', 3200),
  ('TSISVN', '3000', 'Interior & Exterior (Int & Ext)',       null,   '602', '602', 3602),
  ('TSISIN', '3000', 'Interior & Exterior (Int & Ext)',       null,   '603', '603', 3603),
  ('ITSP',   '3000', 'Interior & Exterior (Int & Ext)',       null,   '606', '606', 3606),
  ('ITSPP1', '3000', 'Interior & Exterior (Int & Ext)',       null,   '616', '616', 3616),
  ('ITSPP2', '3000', 'Interior & Exterior (Int & Ext)',       null,   '626', '626', 3626),
  ('TSGP',   '4000', 'Motorcycle (Mocy)',                     '1400', null,  '140', 1400),
  ('TSVN',   '4000', 'Motorcycle (Mocy)',                     null,   '601', '601', 4601),
  ('TSAI',   '4000', 'Motorcycle (Mocy)',                     null,   '604', '604', 4604),
  ('TCT',    '5000', 'Diecasting Forging and Machining (DFM)', '1600', null, '160', 1600),
  ('TSVT',   '6000', 'Electric car',                          '8100', null,  '810', 8100),
  ('FOTS',   '7000', 'OGI',                                   null,   '701', '701', 7701),
  ('CTSO',   '7000', 'OGI',                                   null,   '702', '702', 7702),
  ('CAC',    '8000', 'Advanced Composites',                   '8200', null,  '820', 8200)
on conflict (code) do nothing;

-- สิทธิ์ (RLS + GRANT ระดับตาราง — ขาด GRANT = PostgREST ตอบ 401 ทั้งที่ RLS ผ่าน)
alter table public.companies enable row level security;
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated using (true);
drop policy if exists companies_write on public.companies;
create policy companies_write on public.companies for all to authenticated
  using ((select public.has_perm('org:manage_divisions')))
  with check ((select public.has_perm('org:manage_divisions')));
grant select, insert, update, delete on public.companies to authenticated;
grant all on public.companies to service_role;

-- audit (Traceability) — ตัวเดียวกับ cost_centers
drop trigger if exists trg_companies_audit on public.companies;
create trigger trg_companies_audit after insert or update or delete on public.companies
  for each row execute function public.fn_audit();
drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at before update on public.companies
  for each row execute function public.fn_set_updated_at();

-- ตรวจผล:
-- select spg_no, count(*) from companies group by 1 order by 1;   -- 1000:1 · 2000:8 · 3000:9 · 4000:3 · 5000:1 · 6000:1 · 7000:2 · 8000:1 = 26
-- select code, sap_code, com_code from companies where code='TSAT';  -- 2100 / 210
-- select c.company from cost_centers c where c.company is not null and not exists (select 1 from companies x where x.code = c.company) group by 1;  -- ต้องว่าง
