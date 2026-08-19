-- PE Core Tools — รูป product/drawing ของชุดเอกสาร + รูปประกอบต่อ OP (2026-08-13 · additive)
-- Main project (ewhdfqwfwofivojtsizn) · bucket ใหม่ pe-images (5MB cap, image only)
-- รูปบีบก่อนอัปโหลดฝั่ง client 2560px/q0.9 (tier เดียวกับ drawing ฝั่ง QA — ต้องซูมอ่านได้ ห้ามบีบแรงกว่านี้)

alter table public.pe_doc_sets  add column if not exists image_url text;   -- รูป product/drawing หลักของพาร์ท
alter table public.pe_processes add column if not exists image_url text;   -- รูปประกอบ OP (จุดเชื่อม/ชิ้นงานใน op sheet)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pe-images', 'pe-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

-- policies: อ่าน public (รูปโชว์ในหน้า) · เขียน/ลบ = authenticated (สิทธิ์ทำงานคุมที่ UI ผ่าน can('pe','edit'))
drop policy if exists pe_images_read on storage.objects;
create policy pe_images_read on storage.objects for select using (bucket_id = 'pe-images');
drop policy if exists pe_images_write on storage.objects;
create policy pe_images_write on storage.objects for insert to authenticated with check (bucket_id = 'pe-images');
drop policy if exists pe_images_update on storage.objects;
create policy pe_images_update on storage.objects for update to authenticated using (bucket_id = 'pe-images');
drop policy if exists pe_images_delete on storage.objects;
create policy pe_images_delete on storage.objects for delete to authenticated using (bucket_id = 'pe-images');
