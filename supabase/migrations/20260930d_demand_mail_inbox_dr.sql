-- 📬 คิวไฟล์ความต้องการลูกค้าที่ดึงจากเมล (EDI 830/862) — DR project ("Product DB" · eyhclzkifitbhbljgoav)
-- 2026-09-30 · คำสั่ง user: "หาทางดึงข้อมูลจากเมล แล้วอัพโหลดเข้าระบบอัตโนมัติ"
--
-- สายงาน: Outlook บนเครื่อง user → สคริปต์ Python (tools/outlook-mail-ingest)
--         → Edge Function `ingest-demand-mail` (ตรวจ token) → Storage `demand-mail` + แถวในตารางนี้
--         → หน้า /planner-sales แผง 📬 → กดแล้วไฟล์วิ่งเข้าตัวอ่าน EDI เดิม (PlannerSales.jsx handleFiles/doImportEdi)
-- 🔴 ตารางนี้เป็น "คิวไฟล์" เท่านั้น — ห้ามให้ใครแกะไฟล์ลงตารางออเดอร์ข้ามตัวอ่านในแอป (single source of truth)
-- ย้อนกลับ: drop table demand_mail_inbox, demand_mail_tokens; ลบ bucket demand-mail (ไม่มีตารางอื่นอ้างถึง)

create table if not exists public.demand_mail_inbox (
  id            uuid primary key default gen_random_uuid(),
  message_id    text not null,                 -- Internet Message-ID (หรือ EntryID ถ้าไม่มี) — กันส่งซ้ำ
  subject       text,
  sender        text,
  received_at   timestamptz,
  file_name     text not null,
  storage_path  text not null,
  size_bytes    integer,
  status        text not null default 'pending'
                check (status in ('pending', 'imported', 'skipped')),
  batch_id      uuid,                          -- demand_upload_batches.id ที่นำเข้าจากไฟล์นี้
  handled_by    text,
  handled_at    timestamptz,
  note          text,
  source_host   text,                          -- ชื่อเครื่องที่ส่งมา (ไว้ตามว่าใครดึง)
  created_at    timestamptz not null default now(),
  unique (message_id, file_name)
);
create index if not exists demand_mail_inbox_status_idx on public.demand_mail_inbox (status, received_at desc);

alter table public.demand_mail_inbox enable row level security;
-- DR = anon เสมอ (supabaseDR ไม่ authenticate — ดูกฎเหล็กใน CLAUDE.md) ⇒ อ่าน/อัพเดทสถานะจากแอปด้วย anon
-- INSERT/DELETE ไม่เปิดให้ client — แถวเกิดจาก Edge Function (service role) เท่านั้น
drop policy if exists demand_mail_inbox_read on public.demand_mail_inbox;
create policy demand_mail_inbox_read on public.demand_mail_inbox for select to anon, authenticated using (true);
drop policy if exists demand_mail_inbox_update on public.demand_mail_inbox;
create policy demand_mail_inbox_update on public.demand_mail_inbox for update to anon, authenticated using (true) with check (true);

-- token ของเครื่องที่ส่งไฟล์ — เก็บแค่ sha256 · ไม่มี policy = service role เท่านั้น
create table if not exists public.demand_mail_tokens (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  token_sha256  text not null unique,
  is_active     boolean not null default true,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.demand_mail_tokens enable row level security;

-- ไฟล์จริง: bucket ส่วนตัว · client อ่านได้ (ไว้ดาวน์โหลดเข้าตัวอ่าน) · เขียน/ลบผ่าน service role เท่านั้น
insert into storage.buckets (id, name, public, file_size_limit)
values ('demand-mail', 'demand-mail', false, 20971520)
on conflict (id) do nothing;
drop policy if exists demand_mail_read on storage.objects;
create policy demand_mail_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'demand-mail');
