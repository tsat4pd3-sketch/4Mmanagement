-- ทะเบียน "QRs ↔ WI การซ่อม" ตาม WI-PD3-069 §6
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — ตารางใหม่ + seed 6 แถวจากตัว WI
--
-- ที่มา: WI-PD3-069 Rev.02 §6 ลิสต์ไว้ว่าอาการไหนซ่อมตาม WI ตัวไหน (ตอนนี้อยู่บนกระดาษอย่างเดียว)
--   ⇒ หัวหน้ากลุ่มที่กำลังลง "วิธีการแก้ไข" ไม่มีทางรู้ว่าอาการนี้มี WI ซ่อมทางการอยู่แล้ว
--
-- ⚠️ **ไม่ใช่คลัง "วิธีแก้มาตรฐาน"** (ตารางแบบนั้นห้ามสร้าง — จะเป็นที่ที่ 4 ต่อจาก
--    mtn_orders.solution / improvements / pe_fmea_items แล้ว drift กัน · ดูโมดูล production-problem-report-bins)
--    ตารางนี้คือ **ทะเบียนเลขเอกสาร** ว่าอาการไหนอ้าง WI เล่มไหน — ตัวเนื้อหาการซ่อมอยู่ในเล่ม WI ตามเดิม
--
-- ⚠️ data-driven ตั้งแต่วันแรก: WI มีการแก้ไข/เพิ่มรายการทุกปี ห้าม hardcode 6 แถวนี้ในโค้ด
--    doc_control / QA แก้เองได้จากแผงทะเบียนในหน้า /qa แท็บถังเหลือง-แดง

create table if not exists public.repair_wi_registry (
  code       text primary key,          -- QRs / เลขพาร์ทที่ WI อ้าง (WLS6051)
  part_name  text,                      -- ชื่อชิ้นงาน (ถ้ามี)
  symptom    text not null,             -- อาการ (Missing nut / Skip process cutting hole)
  wi_no      text not null,             -- เลข WI ซ่อม — มีได้หลายเล่ม คั่นด้วย ", "
  note       text,
  is_active  boolean not null default true,
  updated_by_name text,
  updated_by_uid  uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.repair_wi_registry enable row level security;
-- ฝั่ง DR client เป็น anon เสมอ (กฎเหล็ก CLAUDE.md) — ห้ามตั้ง TO authenticated
drop policy if exists rwr_all on public.repair_wi_registry;
create policy rwr_all on public.repair_wi_registry for all using (true) with check (true);

drop trigger if exists trg_set_updated_at on public.repair_wi_registry;
create trigger trg_set_updated_at before update on public.repair_wi_registry
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_audit on public.repair_wi_registry;
create trigger trg_audit after insert or update or delete on public.repair_wi_registry
  for each row execute function public.fn_audit();

-- seed จาก WI-PD3-069 Rev.02 §6 (on conflict do nothing — รันซ้ำไม่ทับของที่ doc_control แก้แล้ว)
insert into public.repair_wi_registry (code, symptom, wi_no, note) values
  ('WLS6051',  'Missing nut',                 'WI-PD3-018', 'WI-PD3-069 Rev.02 §6'),
  ('WLS6005',  'Missing nut M6',              'WI-PD3-048', 'WI-PD3-069 Rev.02 §6'),
  ('WLS6033',  'Skip process cutting hole',   'WI-PD3-055', 'WI-PD3-069 Rev.02 §6'),
  ('WLS05295', 'Welding wrong position',      'WI-PD3-065', 'WI-PD3-069 Rev.02 §6'),
  ('W3501083', 'Feed nut double',             'WI-PD3-068, WI-PD3-050', 'WI-PD3-069 Rev.02 §6'),
  ('XLS00165', 'Missing weld nut',            'WI-PD3-071', 'WI-PD3-069 Rev.02 §6')
on conflict (code) do nothing;

-- Rollback:
--   drop table public.repair_wi_registry;
