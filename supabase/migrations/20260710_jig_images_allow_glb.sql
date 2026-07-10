-- Allow 3D model (GLB) uploads into the jig-images bucket (Product DB / anon client).
-- The bucket was image-only (jpeg/png/webp) with a 512KB cap, so GLB uploads failed with
-- "mime type model/gltf-binary is not supported" (and would then hit the size cap).
-- Add the GLB mime types and raise the size cap to 40MB. Images are still compressed
-- client-side (~100KB) so the higher cap doesn't change image behaviour — it's just a
-- ceiling. Client-side, STEP/IGES are tessellated with a size-conscious deflection and
-- the setup UI warns when a converted model exceeds ~15MB (see src/lib/model3d.js).

update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','model/gltf-binary','application/octet-stream'],
    file_size_limit = 41943040  -- 40 MB
where id = 'jig-images';
