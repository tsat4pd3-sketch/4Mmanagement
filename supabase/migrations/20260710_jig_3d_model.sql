-- 3D model per PM equipment (optional, additive & backward-compatible).
-- Project: Product DB (eyhclzkifitbhbljgoav) — app uses the anon supabaseDR client.
--   model_path   : path in the 'jig-images' bucket of the renderable GLB
--                  (all uploads are normalised to GLB on the client — see src/lib/model3d.js)
--   model_format : original uploaded extension (glb/stl/obj/step/iges…) for display only
-- No RLS change needed: jigs already has an anon-open ALL policy, and the jig-images
-- bucket now allows anon insert/update/delete (20260710_jig_images_anon_storage_policy.sql).

alter table public.jigs
  add column if not exists model_path   text,
  add column if not exists model_format text;
