-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 💼 Marketing — Q-neX เฟส 1: ทะเบียน RFQ · CRD → NPI · Award/Lost · ใบแจ้งจัดทำ F-MKT-001/002
-- Main project (ewhdfqwfwofivojtsizn — ชื่อในจอ Supabase = "MAIN") · 2026-10-30 · คำสั่ง user
--   "ESM เป็น Q-neX เลย · เริ่มเฟส 1 ตามที่เสนอ" (docs/MARKETING-QNEX-DESIGN.md §8)
--
-- 🔴 ทำไมต้อง Main ไม่ใช่ DR: มีราคาเป้าหมายลูกค้า · ราคาเสนอ · PO — ฝั่ง DR เป็น anon-open
--    (ใครมี anon key อ่านได้ทั้งตาราง) · ข้อห้ามเดียวกับ "ราคาขายห้ามอยู่ใน parts_master"
--
-- ⚠️ ต้องรัน `20261030a_marketing_role_enum_main.sql` ให้จบก่อน (enum 'marketing' ถูกใช้ตอน seed สิทธิ์)
--
-- Rollback (ย้อนได้ทั้งก้อน — additive ล้วน ไม่แตะตารางเดิม):
--   drop table if exists public.mkt_awards, public.mkt_rfq_parts, public.mkt_rfqs cascade;
--   delete from public.role_permissions where permission_key in ('page:/rfq','rfq:edit','rfq:award');
--   delete from public.permission_catalog where resource = 'rfq';
--   delete from public.doc_forms where doc_key in ('mkt_production_order','mkt_production_parts');
--   (enum 'marketing' ลบไม่ได้ — ไม่มีผลถ้าไม่มี user ถือ)
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) mkt_rfqs — 1 แถว = 1 งานเสนอราคา (RFQ จากลูกค้า)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.mkt_rfqs (
  id              uuid primary key default gen_random_uuid(),
  rfq_no          text not null unique,                 -- 'RFQ-2026-001' (เลขสูงสุด+1 · utils/mktRfq.js)
  customer        text,                                  -- ชื่อลูกค้าตามทะเบียน customers (text เหมือนทั้งระบบ ไม่ผูก FK)
  model           text,                                  -- รุ่นรถ/โปรแกรม เช่น 'MY2020 T6'
  title           text,                                  -- ชื่องานสั้นๆ ที่คนเรียก (ว่าง = ใช้ part แรก)
  process_type    text not null default 'steel'
                  check (process_type in ('steel','plastic')),   -- โมดูล 1 ของ Q-neX (human-first)
  priority        text not null default 'normal'
                  check (priority in ('normal','urgent')),       -- Normal 24-48 ชม. · Urgent 12 ชม.
  received_date   date,                                  -- วันรับ RFQ
  due_date        date,                                  -- กำหนดส่งใบเสนอราคาให้ลูกค้า
  sop_date_customer date,                                -- SOP ที่ลูกค้ากำหนด (เอาไปตั้ง npi_projects.sop_date ตอนได้งาน)
  -- 🔴 สถานะเต็มตาม state machine (§6.2) — เฟส 1 จอใช้แค่บางค่า แต่ CHECK รองรับไว้ครบ จะได้ไม่ต้อง ALTER ทีหลัง
  status          text not null default 'received'
                  check (status in ('received','assessing','pre_review','costing','quote_review','quote_approval',
                                    'quoted','customer_review','design_change','declined','awarded','lost','cancelled')),
  -- 🔒 ราคาเป้าหมายลูกค้า — access matrix ของ Q-neX: MKT เห็นคนเดียว (เฟส 2 จะกรองด้วย rfq_doc:target_price:view)
  customer_target_price numeric,
  -- 🔴 volume ต้องบอกที่มาเสมอ (ชุดตัวอย่าง FORD มี 3 ชุด: RFQ annual 67k · ประมาณการขาย 471k/7 ปี · Model Report 10k)
  annual_volume   integer,
  volume_source   text check (volume_source in ('rfq','sales_estimate','model_report','other')),
  apw             integer,                               -- Average Production Weekly (จาก Volume sheet ของลูกค้า)
  mpw             integer,                               -- Max Production Weekly
  -- CRD — ใบขอให้ CSC/IEC คำนวณราคา (จุดเริ่มของทีม New Model)
  crd_no          text,                                  -- เลขที่ CRD เช่น 'MKT1/136/2020' (คนกรอก — รูปแบบยังไม่ล็อก §9 ข้อ 6)
  crd_sent_at     date,
  npi_project_id  uuid references public.npi_projects(id) on delete set null,  -- ผูกโปรเจค NPI เมื่อส่ง CRD / ได้งาน
  owner_name      text,                                  -- MKT Engineer เจ้าของงาน (PersonSelect)
  remark          text,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_mkt_rfqs_status   on public.mkt_rfqs(status);
create index if not exists idx_mkt_rfqs_customer on public.mkt_rfqs(customer);
create index if not exists idx_mkt_rfqs_npi      on public.mkt_rfqs(npi_project_id) where npi_project_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) mkt_rfq_parts — พาร์ทในงาน (RFQ 1 งานมีหลายพาร์ท · พาร์ทมีชิ้นย่อย PIA01-03)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.mkt_rfq_parts (
  id              uuid primary key default gen_random_uuid(),
  rfq_id          uuid not null references public.mkt_rfqs(id) on delete cascade,
  part_no         text not null,                         -- เลขพาร์ทลูกค้า เช่น MB3C-2B614-AA
  part_name       text,
  parent_part_id  uuid references public.mkt_rfq_parts(id) on delete set null,  -- ชิ้นย่อยชี้ตัวแม่ (assy)
  material_spec   text,                                  -- WSS-M1A367-A46
  thickness_mm    numeric,
  qty_per         integer not null default 1,            -- จำนวนต่อชิ้นแม่
  coating         text,                                  -- EDP / E-COATED PER …
  cad_revision    text,
  sort            integer not null default 0,
  remark          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (rfq_id, part_no)
);
create index if not exists idx_mkt_rfq_parts_rfq on public.mkt_rfq_parts(rfq_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) mkt_awards — ผลสุดท้ายของ RFQ (โมดูล 6 Award Tracking) + ทะเบียนใบแจ้งจัดทำ F-MKT-001
--    1 RFQ = 1 ผล (unique) · เปลี่ยนผล = update แถวเดิม (audit เก็บประวัติ)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.mkt_awards (
  id              uuid primary key default gen_random_uuid(),
  rfq_id          uuid not null unique references public.mkt_rfqs(id) on delete cascade,
  outcome         text not null check (outcome in ('awarded','lost','cancelled')),
  decided_at      date,
  loss_reason     text,                                  -- 🔴 lost ต้องมีเหตุผล (CHECK ล่าง)
  unit_price      numeric,                               -- ราคาชิ้น (THB/pc) ที่ชนะ/แพ้
  tooling_price   numeric,
  annual_volume   integer,                               -- volume ที่ใช้คิดยอดขาย (snapshot ตอนตัดสิน)
  annual_sales    numeric,                               -- = annual_volume × unit_price · null ถ้าขาดตัวใดตัวหนึ่ง (ห้าม 0)
  po_no           text,                                  -- PO จากลูกค้า
  to_no           text,                                  -- Tool Order จากลูกค้า
  -- ใบแจ้งจัดทำ (F-MKT-001) — "ออกใบ = เขียนทะเบียนก่อนพิมพ์ · พิมพ์ซ้ำ = ใบเดิม"
  production_order_no        text unique,                -- เลข running 'MKT/366/05-2026' (utils/mktRfq.js)
  production_order_snapshot  jsonb,                      -- เนื้อใบ ณ วันออก (พิมพ์ซ้ำจากตรงนี้ ไม่ regenerate)
  production_order_issued_at timestamptz,
  production_order_issued_by text,
  reprint_count   integer not null default 0,
  decided_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint mkt_awards_lost_needs_reason check (outcome <> 'lost' or nullif(btrim(loss_reason), '') is not null),
  constraint mkt_awards_po_only_when_awarded check (outcome = 'awarded' or production_order_no is null)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS + updated_at + audit
--    อ่าน = authenticated (ขอบเขตการเห็นคุมที่จอ · เฟส 2 ค่อยกรองต่อชนิดเอกสาร)
--    เขียน = has_perm('<คีย์เดียวกับปุ่ม>') ตามกฎเหล็กข้อ 3 (ห้าม hardcode role array)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.mkt_rfqs      enable row level security;
alter table public.mkt_rfq_parts enable row level security;
alter table public.mkt_awards    enable row level security;
do $$
declare t text; k text;
begin
  foreach t in array array['mkt_rfqs','mkt_rfq_parts','mkt_awards'] loop
    k := case when t = 'mkt_awards' then 'rfq:award' else 'rfq:edit' end;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_perm(%L)))', t || '_ins', t, k);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.has_perm(%L))) with check ((select public.has_perm(%L)))', t || '_upd', t, k, k);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.has_perm(%L)))', t || '_del', t, k);
    if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
      execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
      execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    end if;
    -- กฎเหล็ก traceability: ใครเปลี่ยนสถานะ RFQ / ราคา / ผล award ต้องสืบได้
    if exists (select 1 from pg_proc where proname = 'fn_audit') then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) สิทธิ์ — catalog + seed role ระบุชัด (ห้าม enum_range)
--    หมวด 'คุณภาพ & วิศวกรรม' ช่วง 700-799 · NPI ใช้ถึง 757 → เริ่ม 758
--    (หน้า /rfq อยู่หมวดเดียวกับ /npi และ /nm-board โดยตั้งใจ — เว็บ edition ก่อน SOP มีหมวดเดียว
--     · ไม่เปิดหมวดเมนู "การตลาด" ใหม่ในเฟสนี้ = ไม่ต้องแตะ nav_groups)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('rfq', 'edit',  'RFQ: สร้าง/แก้งานเสนอราคา · พาร์ท · ส่ง CRD ให้ IEC · ผูกโปรเจค NPI', 'คุณภาพ & วิศวกรรม', 758),
  ('rfq', 'award', 'RFQ: บันทึกผลได้งาน/ไม่ได้งาน · ออกใบแจ้งจัดทำ (F-MKT-001)',            'คุณภาพ & วิศวกรรม', 759)
on conflict (resource, action) do nothing;

-- เข้าหน้า /rfq: marketing (เจ้าของ) · engineer_nm/engineer (เห็น CRD ที่ส่งมาให้) · admin/manager
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'page:/rfq', true
from (values ('admin'::user_role),('manager'::user_role),('marketing'::user_role),
             ('engineer_nm'::user_role),('engineer'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = 'page:/rfq');

-- แก้/ตัดสิน = marketing + admin/manager (engineer_nm ดูอย่างเดียว — IEC ไม่ใช่คนออก RFQ)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, k.key, true
from (values ('admin'::user_role),('manager'::user_role),('marketing'::user_role)) as r(role)
cross join (values ('rfq:edit'),('rfq:award')) as k(key)
where not exists (select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = k.key);

-- marketing ต้องเปิดโปรเจค NPI ที่ตัวเองส่ง CRD ไปได้ (ดูอย่างเดียว — ไม่ให้ npi:edit)
-- ⚠️ "เห็นกัน" ตามคำ user = เว็บเดียวกัน · การเห็นงานกันจริงยังตัดสินที่นี่ · ปรับได้ที่ /permissions
insert into public.role_permissions (role, permission_key, allowed)
select 'marketing'::user_role, k.key, true
from (values ('page:/npi'),('page:/nm-board')) as k(key)
where not exists (select 1 from public.role_permissions rp where rp.role = 'marketing' and rp.permission_key = k.key);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) ทะเบียนเอกสาร — ใบแจ้งจัดทำ 2 ใบ (ฟอร์มจริงของ Marketing จากชุดตัวอย่าง FORD)
--    form_code = เลขที่ใช้อยู่จริงวันนี้ · rev/effective ยังไม่รู้ (ให้ doc_control ตั้งที่ /doc-forms)
--    ห้าม hardcode เลขพวกนี้ในโค้ด — ใบพิมพ์อ่านผ่าน docFormSync('mkt_production_order')
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.doc_forms (doc_key, form_code, title, rev, effective_date, paper, paper_size, orientation, layout_locked, used_route, sig_blocks, footer_note)
values
  ('mkt_production_order', 'F-MKT-001', 'ใบสั่งทำชิ้นส่วน (ใบแจ้งจัดทำ)', null, null, 'A4 แนวตั้ง', 'A4', 'portrait', true, '/rfq',
   '["ผู้จัดทำ (เจ้าหน้าที่/วิศวกร)","ผู้ตรวจสอบ (ผู้จัดการส่วน)","ผู้อนุมัติ (ผู้จัดการฝ่าย)"]'::jsonb, 'WIX-030-001'),
  ('mkt_production_parts', 'F-MKT-002', 'ใบแจ้งรายการชิ้นส่วนประกอบ', null, null, 'A4 แนวนอน', 'A4', 'landscape', true, '/rfq',
   '["REPORTED & CHECK BY (OFFICER / ENGINEER)","CHECKED BY (SECTION MANAGER)","APPROVED BY (DEPARTMENT MANAGER)"]'::jsonb, 'WIX-030-001')
on conflict (doc_key) do nothing;

-- ตรวจหลังรัน (project "MAIN"):
-- select table_name from information_schema.tables where table_name like 'mkt\_%' order by 1;   -- 3 ตาราง
-- select permission_key, role from role_permissions where permission_key in ('page:/rfq','rfq:edit','rfq:award') order by 1,2;
-- select doc_key, form_code from doc_forms where doc_key like 'mkt\_%';
-- select tgname, tgrelid::regclass from pg_trigger where tgrelid::regclass::text like 'mkt_%' order by 2,1;   -- trg_audit + trg_set_updated_at × 3
