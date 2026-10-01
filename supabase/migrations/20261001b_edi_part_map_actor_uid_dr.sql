-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- edi_part_map อยู่ใน DR_AUDIT_TABLES (src/supabaseClient.js) ⇒ ตัวห่อ supabaseDR.from ฝัง
-- updated_by_name + **updated_by_uid** ให้ทุก write · ขาดคอลัมน์นี้ = บันทึกพังทุกครั้ง
-- (เกิดจริง 01/10: "Could not find the 'updated_by_uid' column of 'edi_part_map'") — กฎอยู่ที่คอมเมนต์หัว DR_AUDIT_TABLES
alter table public.edi_part_map add column if not exists updated_by_uid uuid;
notify pgrst, 'reload schema';
