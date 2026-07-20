-- Scrap Report (ใบรายงานของเสีย FM-PD2-002 Rev.06) — paperless + export
-- Target project: DR/Product (eyhclzkifitbhbljgoav) — client `supabaseDR` (role anon เสมอ)
-- ⚠️ ตารางใหม่ทุกตัวต้อง RLS anon-friendly: for all to anon, authenticated using(true) with check(true)
--    (ห้าม TO authenticated — client ไม่มี JWT จะพัง)
--
-- 1 ใบ = 1 วัน/ไลน์ · ยอด main product ดึงจาก defect_logs ตั้งต้นแล้วแก้/เพิ่มพาร์ทย่อยเองได้
-- (sync source = defect_logs, พาร์ทย่อยที่เสียก่อนเข้ากระบวนการหลักกรอกมือ)

-- ── master ประเภทงานเสีย (จากชีท Defect Type: P1-P20 กระบวนการ / A1-A18 ประกอบ-เชื่อม) ──
create table if not exists scrap_defect_types (
  code       text primary key,           -- P1..P20, A1..A18
  grp        text not null,              -- 'P' | 'A'
  label      text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

-- ── หัวใบ ──────────────────────────────────────────────────────────────────
create table if not exists scrap_reports (
  id                 uuid primary key default gen_random_uuid(),
  report_date        date not null,
  line_name          text,
  dept               text,               -- แผนก
  section            text,               -- ส่วน
  division           text default 'TSAT4', -- ฝ่าย
  other_note         text,
  product_categories text[] default '{}',-- FG/SEMI/RM/TR/OTHER (ติ๊กหัวฟอร์ม)
  storage_location   text,
  doc_no             text,               -- TSAT4-PDX RUNNING/เดือน-ปี (gen ฝั่ง client)
  inspector_name     text,               -- ผู้ตรวจสอบ (QC)
  requester_name     text,               -- ผู้ขออนุมัติ (หัวหน้าแผนก)
  approver_qa_name   text,               -- ผู้อนุมัติ (ผจก. QA/QC)
  approver_pd_name   text,               -- ผู้อนุมัติ (ผจก.ผลิต)
  approver_gm_name   text,               -- ผู้อนุมัติ (ผจก.ทั่วไป)
  sender_name        text,               -- ผู้ส่งของ
  receiver_name      text,               -- ผู้รับของ (HRM)
  status             text not null default 'draft'
                     check (status in ('draft','submitted','approved')),
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_scrap_reports_date_line on scrap_reports (report_date, line_name);

-- ── รายการต่อใบ (1 แถว = 1 พาร์ทที่เสีย) ────────────────────────────────────
create table if not exists scrap_report_items (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references scrap_reports(id) on delete cascade,
  seq           int not null default 1,
  source        text not null default 'main'  -- main = product หลักของไลน์ · sub = พาร์ทย่อย (เสียก่อนเข้ากระบวนการ)
                check (source in ('main','sub')),
  part_no       text,
  part_name     text,
  mat_no        text,               -- MAT'L SAP
  model         text,
  code          text,               -- รหัสประเภทชิ้นงาน A-E (A=FG B=SEMI C=RM D=TRY-OUT E=อื่นๆ)
  bom_ref       text,               -- ช่อง BOM
  qty           numeric not null default 0,
  m_cause       text check (m_cause in ('m1','m2','m3','m4','m5')), -- สาเหตุ 4M+5S
  stage         text check (stage in ('in_process','post_process')), -- เสียในกระบวนการ/หลังจบผลิต
  confirm_qty   numeric,            -- ยืนยันจำนวนของเสีย
  defect_codes  text,               -- รหัสประเภทงานเสีย เช่น "P3,A12"
  image_path    text,               -- รูป (bucket dr-images/scrap) — optional
  src_defect_from_logs boolean not null default false, -- true = ยอดตั้งต้นดึงจาก defect_logs
  created_at    timestamptz not null default now()
);
create index if not exists idx_scrap_report_items_report on scrap_report_items (report_id, seq);

-- ── RLS: anon-friendly (เหมือนตารางเดิมฝั่ง DR) ──────────────────────────────
alter table scrap_defect_types   enable row level security;
alter table scrap_reports        enable row level security;
alter table scrap_report_items   enable row level security;

drop policy if exists scrap_defect_types_all on scrap_defect_types;
create policy scrap_defect_types_all on scrap_defect_types
  for all to anon, authenticated using (true) with check (true);
drop policy if exists scrap_reports_all on scrap_reports;
create policy scrap_reports_all on scrap_reports
  for all to anon, authenticated using (true) with check (true);
drop policy if exists scrap_report_items_all on scrap_report_items;
create policy scrap_report_items_all on scrap_report_items
  for all to anon, authenticated using (true) with check (true);

-- ── seed ประเภทงานเสีย (จากชีท Defect Type จริง) ────────────────────────────
insert into scrap_defect_types (code, grp, label, sort_order) values
  ('P1','P','ทับเศษ Scrap',1),('P2','P','ย่น',2),('P3','P','แตก',3),('P4','P','ร้าว',4),
  ('P5','P','เสียรูป',5),('P6','P','รูเยื้อง',6),('P7','P','เสียรูป (วางไม่ตรงตำแหน่ง)',7),
  ('P8','P','งาน TRIAL แม่พิมพ์',8),('P9','P','ครีบ',9),('P10','P','รอยขูดขีด',10),
  ('P11','P','งานเสียจากวัตถุดิบ',11),('P12','P','รอยจิก',12),('P13','P','Trimline ขาด',13),
  ('P14','P','เจาะรูไม่ครบ',14),('P15','P','Gap out STD.',15),('P16','P','พับ',16),
  ('P17','P','บุบตุง',17),('P18','P','เป็นคลื่น',18),('P19','P','แหว่ง',19),('P20','P','อื่น ๆ',20),
  ('A1','A','ชิ้นงานผิด Spec.',21),('A2','A','ชิ้นงานไม่ตรงตำแหน่ง',22),('A3','A','ประกอบชิ้นงานไม่ครบ',23),
  ('A4','A','ชิ้นงานเสียรูป',24),('A5','A','ปัญหาเกลียว Nut/Bolt/Stud',25),('A6','A','ชิ้นงานทดลอง',26),
  ('A7','A','แนวเชื่อมทะลุ',27),('A8','A','แนวเชื่อมเป็นฟองอากาศ',28),('A9','A','แนวเชื่อมแหว่ง',29),
  ('A10','A','แนวเชื่อมไม่ติด',30),('A11','A','แนวเชื่อมกินขอบ',31),('A12','A','จุด Spot ไม่ครบ',32),
  ('A13','A','จุด Spot เป็นตามด',33),('A14','A','จุด Spot ไม่ติด',34),('A15','A','จุด Spot ทะลุ',35),
  ('A16','A','จุด Spot ไม่ตรงตำแหน่ง',36),('A17','A','จุด Spot มี Spatter',37),('A18','A','อื่น ๆ',38)
on conflict (code) do nothing;
