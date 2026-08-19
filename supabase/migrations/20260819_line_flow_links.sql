-- 🔗 สายการไหลระหว่างไลน์ (ไลน์ไหนป้อนงานให้ไลน์ไหน) — DR project
-- (2026-08-19 · คำขอ user: "hdf1 ป้อนงานเข้า laser345 และส่งต่อเข้าไลน์ apron assy 60 61
--  มันเกือบจะเป็น one piece flow แต่มีระบบ buffer มา mix เพื่อไม่ให้ไลน์เบรคดาวน์มากเกินไป")
--
-- ทำไมต้องมีตารางนี้ (ระบบเดิมไม่มีที่ไหนเก็บ "ไลน์ต่อไลน์" เลย — ตรวจแล้ว 2026-08-19):
--   · machine_flow_links = ทางเดินงาน "ในไลน์เดียวกัน" (ผูก machine_points ที่มี line_name เดียวกัน)
--   · part_routings      = routing "รายพาร์ท" (mat → seq → line) ถูกต้องกว่าแต่ต้องลงรายพาร์ททุกตัว
--                          ตอนนี้มีข้อมูลแค่ 1 แถว → ตอบคำถามระดับไลน์ยังไม่ได้
--   · facility_supply_links = utility → ไลน์ (คนละเรื่อง: ลม/ไฟ/น้ำ ไม่ใช่ชิ้นงาน)
--   ⇒ ตารางนี้เป็น "ระดับไลน์" ตั้งครั้งเดียวจบ ตอบได้ทันทีว่า "หยุดที่นี่ กระทบไลน์ไหนบ้าง"
--     เมื่อ part_routings ลงครบในอนาคต ให้ใช้เป็นตัว "ตรวจทาน" กันเอง (ดู lineFlow.js)
--
-- ⚠️ buffer เป็นหัวใจของโมเดลนี้ — ต้นน้ำหยุด ≠ ปลายน้ำหยุดทันที
--    ปลายน้ำจะหยุดก็ต่อเมื่อ buffer ระหว่างกลางหมด → เก็บ buffer_qty (ชิ้น) ไว้ประเมิน
--    "หยุดได้กี่นาทีก่อนปลายน้ำเริ่มรอ" (cover time) = buffer_qty × CT ของไลน์ปลายน้ำ
--    ไม่กรอก buffer_qty = ระบบไม่เดา แค่บอกว่าเชื่อมกัน (ห้ามเดาเป็น 0 = จะแปลว่าหยุดปุ๊บกระทบปั๊บ)

create table if not exists public.line_flow_links (
  id            uuid primary key default gen_random_uuid(),
  from_line     text not null,          -- ไลน์ต้นน้ำ (ผู้ป้อน)
  to_line       text not null,          -- ไลน์ปลายน้ำ (ผู้รับ)
  buffer_label  text,                   -- ชื่อจุดพัก/buffer ระหว่างกลาง (เช่น "ชั้นพัก HDF-Laser")
  buffer_qty    numeric,                -- จำนวนชิ้นที่พักได้ (null = ไม่รู้ ห้ามเดา)
  note          text,
  is_active     boolean not null default true,
  updated_by_name text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint line_flow_links_no_self check (from_line <> to_line),
  unique (from_line, to_line)
);

create index if not exists idx_line_flow_from on public.line_flow_links (from_line) where is_active;
create index if not exists idx_line_flow_to   on public.line_flow_links (to_line)   where is_active;

alter table public.line_flow_links enable row level security;
-- ⚠️ DR project = client anon เสมอ (กฎเหล็ก) ห้ามตั้ง TO authenticated
drop policy if exists line_flow_links_all on public.line_flow_links;
create policy line_flow_links_all on public.line_flow_links for all using (true) with check (true);

-- audit + updated_at (กฎเหล็ก: master ที่แก้ได้ต้องมี audit) — guard เผื่อ migration audit ยังไม่ apply
do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.line_flow_links;
    create trigger trg_set_updated_at before update on public.line_flow_links
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.line_flow_links;
    create trigger trg_audit after insert or update or delete on public.line_flow_links
      for each row execute function public.fn_audit();
  end if;
end $$;

-- ⚠️ ไม่ seed เส้นทางให้เอง — "ไลน์ไหนป้อนไลน์ไหน" เป็นความรู้ของหน้างาน ระบบเดาแล้วผิดจะเสียหายกว่า
--    ตั้งที่ /linesetup → แผง "🔗 สายการไหลระหว่างไลน์"
