-- กล่องรับ feedback จากผู้ใช้หน้างาน (2026-08-14 · คำขอ user)
-- เดิม feedback วิ่งผ่าน LINE แล้วตกหล่น/ค้นย้อนไม่ได้ ไม่รู้ว่าเรื่องไหนแก้แล้ว
-- Main project (ต้อง login ถึงส่งได้ — ผูก auth.uid เพื่อรู้ว่าใครแจ้ง ตามกลับได้)
create table if not exists public.user_feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid references auth.users(id) on delete set null,
  user_name    text,                 -- snapshot ชื่อ/role ณ วันที่แจ้ง (โปรไฟล์เปลี่ยนทีหลังได้)
  user_role    text,
  kind         text not null default 'bug' check (kind in ('bug','idea','question')),
  page_path    text,                 -- หน้าที่ผู้ใช้อยู่ตอนกดแจ้ง (เก็บอัตโนมัติ ไม่ต้องพิมพ์)
  message      text not null,
  status       text not null default 'new' check (status in ('new','seen','doing','done','wontfix')),
  admin_note   text,
  handled_by   text,
  handled_at   timestamptz
);
create index if not exists user_feedback_created_idx on public.user_feedback (created_at desc);
create index if not exists user_feedback_status_idx  on public.user_feedback (status);

alter table public.user_feedback enable row level security;

-- ส่งได้ทุกคนที่ login (ผูกกับตัวเอง) · เห็นของตัวเองเสมอ · admin/manager เห็น+จัดการทั้งหมด
drop policy if exists uf_insert_own on public.user_feedback;
create policy uf_insert_own on public.user_feedback
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists uf_select_own on public.user_feedback;
create policy uf_select_own on public.user_feedback
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists uf_admin_all on public.user_feedback;
create policy uf_admin_all on public.user_feedback
  for all to authenticated
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager')));

comment on table public.user_feedback is
  'feedback จากผู้ใช้หน้างาน (บั๊ก/ข้อเสนอแนะ/คำถาม) — ส่งจากปุ่ม 💬 ท้าย sidebar · admin/manager อ่านและปิดงานในโมดัลเดียวกัน';
