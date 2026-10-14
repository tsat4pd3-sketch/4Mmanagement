-- 20261014_employee_flex_units_main.sql · ⚠️ Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- 🏃 คนวิ่งข้ามแผนก (flexible staff) — feedback ข้อ 2 ของ user
--   *"พนักงาน บางแผนก ต้อง flexible เพราะใช้ common ไป fix cost center และทำงานไม่ได้ แก้ยังไง"*
--   → ถามยืนยันแล้ว user ตอบ **"ใช่ คนวิ่งข้ามแผนก"** · และระบุว่าเป็นปัญหาของ "การจัดกำลังคน"
--
-- ที่มาของปัญหา (วัดจากฐานจริง 13/10):
--   · `buildManpowerBoard()` กรองคนด้วย `subIds.has(e.org_node_id)` ⇒ คน 1 คนมี org_node_id ได้
--     หน่วยเดียว ⇒ **โผล่บนบอร์ดได้แผนกเดียว** คนที่วิ่งไปช่วยแผนกอื่นประจำจึงหายจากบอร์ดฝั่งนั้น
--   · แผนกที่มีคน 12 แผนก · **11/12 มี cost_center ของตัวเอง** ⇒ ย้ายสังกัดเพื่อให้โผล่ = cost center เปลี่ยน
--   · `line_helpers` (ยืมตัวรายวัน+รายกะ) วัด 90 วันล่าสุด: 41 แถว · 14 คน · ปลายทางไลน์เดียว ·
--     ใช้แค่ 06/09–25/09 แล้วหยุด ⇒ กลไกรายวันไม่ตอบโจทย์ "คนที่วิ่งประจำ" (ไม่มีใครกรอกทุกวัน)
--
-- 🔴 **แบบอ้างอิง ไม่ใช่สำเนา** (หลักเดียวกับที่ user ตัดสินเรื่อง LPA: "1 แบบอ้างอิง")
--    บ้านจริงยังอยู่ที่ `employees.org_node_id` **ไม่แตะ · ไม่แตะ cost_center ของใครทั้งนั้น**
--    (cost center ผูกบ้านจริง · ขยับ = `src/utils/costSaving.js` activity rate เพี้ยนทุกจอ)
-- 🔴 **"ไปช่วย ≠ นับเป็นกำลังคน"** — การ์ดโผล่บนบอร์ดแผนกที่ไปช่วยพร้อมธง `flexFrom` แต่ไม่หัก
--    ช่องว่าง ไม่เข้าตัวนับทะเบียน (บ้านจริงนับเขาอยู่แล้ว · นับ 2 ที่ = กำลังคนปลอม แล้วเลิกเชื่อทั้งจอ)
--    ⇒ โครงเดียวกับ `line_technicians` + ธง `external` ที่แก้ปัญหาคลาสนี้มาแล้ว (ช่าง MTN ไม่มี line_id)
-- 🔴 ตารางว่าง = **พฤติกรรมเดิมเป๊ะ** (board รับ `flexUnits` เป็น optional default [])
--
-- สิทธิ์: คีย์เดิม `manpower_board:edit` (user สั่ง "2 เอาเหมือนเดิมก่อน") — ไม่ seed คีย์ใหม่
--   policy ผ่าน `has_perm()` ห้าม hardcode role · audit = `fn_audit` ตัวปกติ
-- backward-compatible: ตารางใหม่ล้วน ไม่แตะของเดิม
--
-- ⚠️ **apply ผ่าน MCP ต้องแยก 2 ก้อน** — MCP ค้างครบ 60 วิแล้ว rollback ทั้ง migration ถ้าในก้อน
--    มี `delete`/`drop` (รวม `drop policy if exists`) · เจอมา 3 รอบแล้ว
--    ก้อน (ก) = table + index + RLS + trigger · ก้อน (ข) = `create policy` ล้วน
--    **apply แล้ว 2026-10-14 · ตรวจกลับ tbl_ok=1 · policies=2 · triggers=2**
--
-- rollback (ย้อนโค้ดก่อน แล้วค่อยรัน — `drop` สั่งผ่าน MCP ไม่ได้ ให้รันใน SQL Editor):
--   drop table if exists public.employee_flex_units;
--   (ไม่ต้องแตะ permission_catalog/role_permissions — ใช้คีย์เดิมร่วมกับบอร์ด)
begin;

create table if not exists public.employee_flex_units (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  org_node_id uuid not null references public.org_nodes(id) on delete cascade,  -- หน่วยที่ไปช่วยประจำ
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, org_node_id)
);
create index if not exists employee_flex_units_node_idx on public.employee_flex_units (org_node_id);

comment on table public.employee_flex_units is
  'คนที่วิ่งไปช่วยหน่วยอื่นเป็นประจำ (flexible staff) — อ้างอิงเท่านั้น: บ้านจริงยังอยู่ที่ '
  'employees.org_node_id และ cost center ไม่เปลี่ยน · ไม่นับเป็นกำลังคนของหน่วยที่ไปช่วย '
  '(เขียน/อ่านผ่าน /manpower-board ⚙️ ตั้งค่าบอร์ด · กฎใน src/utils/manpowerBoard.js)';

alter table public.employee_flex_units enable row level security;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.employee_flex_units;
    create trigger trg_set_updated_at before update on public.employee_flex_units
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.employee_flex_units;
    create trigger trg_audit after insert or update or delete on public.employee_flex_units
      for each row execute function public.fn_audit();
  end if;
end $$;

commit;

-- ── ก้อน (ข) — policy ล้วน (apply แยกรอบ ห้ามรวมกับก้อนบน) ────────────────────────────────
-- อ่านได้ทุกบัญชีที่ login (บอร์ดนี้เปิดให้ admin/manager/supervisor/leader/display ดู)
-- เขียน = คีย์เดียวกับปุ่มบนจอ · ถ้าต้องรันซ้ำบน env ที่มี policy อยู่แล้ว ให้ลบ policy เก่าก่อนมือ
create policy efu_read  on public.employee_flex_units for select to authenticated using (true);
create policy efu_write on public.employee_flex_units for all to authenticated
  using (has_perm('manpower_board:edit')) with check (has_perm('manpower_board:edit'));
