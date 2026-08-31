-- ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01 (paperless)
-- ★ Apply on DR project (eyhclzkifitbhbljgoav)
--
-- ที่มา: user ส่งใบกระดาษมา 2026-08-24 — QA ต้องเขียนใบเบิกชิ้นงานจากฝ่ายผลิตไปทดสอบแบบทำลาย
--   แล้วชิ้นงานที่ถูกทำลายต้องไปโผล่ในใบรายงานของเสีย (scrap report)
--   → **scrap report ดึงได้ 2 ทาง: Daily Report (ของเสียจากการผลิต) + ใบเบิก QA (ของที่เอาไปทดสอบ)**
--
-- ⚠️ ทำไมอยู่ DR ไม่ใช่ Main (ทั้งที่ QA module อยู่ Main):
--   1. ปลายทางคือ `scrap_report_items` (DR) — อยู่ project เดียวกันถึงผูก FK ได้จริง
--      (ข้าม project ทำ FK ไม่ได้ ต้องเทียบด้วยข้อความ ซึ่งขาดง่าย)
--   2. ตัวเลือกรหัสสินค้ามาจาก `parts_master` (DR) = ทะเบียนกลางของทุก mat ตามกฎ CLAUDE.md
--   3. precedent ตรงตัว: `scrap_reports` เป็นฟอร์มอนุมัติหลายขั้นของ QA เหมือนกัน และอยู่ DR อยู่แล้ว
--   → สิทธิ์จึงคุมที่ UI (DR เป็น anon ไม่มี RLS จริง) ด้วยคีย์เดิม scrap:record / scrap:manage
--     **ไม่เพิ่ม permission key ใหม่** เลี่ยงกับดัก seed enum_range ที่ทำให้ role ใหม่ fail-closed

/* ── หัวใบ ─────────────────────────────────────────────────────────────────── */
create table if not exists public.material_requests (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text,                       -- Material Document No. (ช่อง "สำหรับเจ้าหน้าที่คลังสินค้า")
  -- เบิก / คืน — ฟอร์มเดียวใช้ได้ทั้งสองทาง (ตามใบกระดาษที่มี 2 บล็อก)
  kind          text not null default 'withdraw' check (kind in ('withdraw','return')),
  -- ประเภทของการเบิก: prod | 311 | 261 | 201 | 907
  -- ประเภทของการคืน:  prod | 311 | 202 | 908   (ค่าอยู่ที่ src/utils/materialRequest.js)
  move_code     text,
  requester_name text,
  requester_dept text,                      -- หน่วยงาน/ตำแหน่ง (ใบตัวอย่าง = QUALITY)
  request_date  date not null,              -- วันที่เบิก
  need_date     date,                       -- วันที่ต้องการสินค้า
  dest_storage_location text,               -- Storage Location ปลายทาง
  order_no      text,                       -- Production Order (261)
  cost_center   text,
  plant_code    text default '2140',        -- รหัสโรงงาน (Plant)
  storage_location text,                    -- รหัสคลังสินค้า / สโตร์
  detail        text,                       -- รายละเอียด (ใบตัวอย่าง = "Test ประจำปี")
  line_name     text,                       -- ไลน์ที่ขอของ — ใช้จับคู่ตอนดึงเข้าใบ scrap
  -- ผู้เบิก/คืน (3 ช่อง) + ผู้จ่ายสินค้าคงคลัง (2 ช่อง) ตามใบกระดาษ
  made_by_name text, made_by_sig_url text, made_by_date date,
  approved_by_name text, approved_by_sig_url text, approved_by_date date,
  received_by_name text, received_by_sig_url text, received_by_date date,
  recorded_by_name text, recorded_by_sig_url text, recorded_by_date date,
  checked_by_name text, checked_by_sig_url text, checked_by_date date,
  status        text not null default 'draft'
                check (status in ('draft','submitted','approved','issued','cancelled')),
  updated_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists material_req_date_idx on public.material_requests (request_date desc);
create index if not exists material_req_line_idx on public.material_requests (line_name);

/* ── รายการในใบ ────────────────────────────────────────────────────────────── */
create table if not exists public.material_request_items (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.material_requests(id) on delete cascade,
  seq           int  not null default 1,
  mat_no        text,                       -- รหัสสินค้าคงคลัง (เลือกจาก parts_master)
  description   text,                       -- รายละเอียด
  qty           numeric,                    -- จำนวนที่ขอเบิก/คืน
  unit          text default 'Pcs',
  qty_issued    numeric,                    -- จำนวนที่จ่าย/รับคืนจริง (สโตร์กรอก)
  produced_date date,                       -- วันที่ผลิต
  batch_no      text,
  updated_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists material_req_item_req_idx on public.material_request_items (request_id);

/* ── ผูกกับใบรายงานของเสีย ──────────────────────────────────────────────────
   null = รายการที่คนกรอกเอง / ดึงจาก Daily Report (ธงเดิม src_defect_from_logs)
   มีค่า = ดึงมาจากใบเบิก QA — ทำให้สืบย้อนได้ว่าชิ้นนี้ถูกเบิกไปทดสอบด้วยใบไหน
   ⚠️ on delete set null: ใบ scrap เป็นบันทึกคุณภาพ ต้องอยู่ต่อแม้ใบเบิกถูกลบ
      (หลักเดียวกับ quality_bin_records.defect_log_id) */
alter table public.scrap_report_items
  add column if not exists src_request_item_id uuid
    references public.material_request_items(id) on delete set null;
create index if not exists scrap_item_src_req_idx on public.scrap_report_items (src_request_item_id);

/* ── RLS — DR project = anon-open ตาม convention (สิทธิ์จริงคุมที่ UI) ────── */
alter table public.material_requests      enable row level security;
alter table public.material_request_items enable row level security;
drop policy if exists material_req_all on public.material_requests;
create policy material_req_all on public.material_requests for all using (true) with check (true);
drop policy if exists material_req_item_all on public.material_request_items;
create policy material_req_item_all on public.material_request_items for all using (true) with check (true);

/* ── updated_at ────────────────────────────────────────────────────────────── */
do $$ declare t text; begin
  foreach t in array array['material_requests','material_request_items'] loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format('create trigger trg_set_updated_at before update on public.%I
                    for each row execute function public.fn_set_updated_at()', t);
  end loop;
end $$;

-- Rollback:
--   alter table public.scrap_report_items drop column if exists src_request_item_id;
--   drop table public.material_request_items, public.material_requests;
