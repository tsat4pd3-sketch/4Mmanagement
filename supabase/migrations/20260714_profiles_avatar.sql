-- ── รูปโปรไฟล์ user ที่ login (2026-07-14) — Main project ──────────────────
-- profiles.avatar_url = รูปโปรไฟล์ของ "ผู้ใช้ระบบ" (คนละอย่างกับ employees.image_url ที่เป็นรูปพนักงานบนผังไลน์)
-- additive ล้วน: คอลัมน์ใหม่ nullable + bucket ใหม่ — revert โค้ดได้โดยไม่ต้องแตะ schema

alter table public.profiles add column if not exists avatar_url text;

-- bucket แยกใหม่ 'avatars' — ห้ามเอาไปรวมกับ employee-photos:
-- cleanup-orphan-photos สแกน employee-photos เทียบ employees.image_url/line_layouts.image_url
-- ไฟล์ avatar ที่ไปอยู่ที่นั่นจะถูกมองเป็นไฟล์กำพร้าแล้วโดนลบ
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- RLS: อ่านสาธารณะ (แสดงรูปทั่วระบบ) · เขียน/ลบได้เฉพาะโฟลเดอร์ของตัวเอง (<uid>/...)
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_own_insert" on storage.objects;
create policy "avatars_own_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_own_update" on storage.objects;
create policy "avatars_own_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_own_delete" on storage.objects;
create policy "avatars_own_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
