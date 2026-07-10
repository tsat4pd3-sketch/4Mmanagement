-- Fix: PM Setup / MTN layout image upload fails with
--   "new row violates row-level security policy"
--
-- Project: Product DB (eyhclzkifitbhbljgoav). The app talks to this project ONLY
-- through the anon `supabaseDR` client (no JWT — see CLAUDE.md iron rule). The
-- `jig-images` bucket had INSERT/DELETE policies scoped to `authenticated` only,
-- so every upload from the app ran as `anon` and was rejected. The sibling
-- `product-images` bucket already allows anon (anon_upload/anon_delete) — mirror
-- that here. Read stays public; anon may insert/update(upsert)/delete jig-images.

drop policy if exists auth_upload_jig_images on storage.objects;
drop policy if exists auth_delete_jig_images on storage.objects;

drop policy if exists anon_upload_jig_images on storage.objects;
create policy anon_upload_jig_images on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'jig-images');

-- upsert (used by the uploader with { upsert: true }) updates an existing object
drop policy if exists anon_update_jig_images on storage.objects;
create policy anon_update_jig_images on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'jig-images')
  with check (bucket_id = 'jig-images');

drop policy if exists anon_delete_jig_images on storage.objects;
create policy anon_delete_jig_images on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'jig-images');
