-- Photo-hunt inspection evidence — TASK "ตรวจเครื่องด้วยการเทียบรูป" (2026-07-15)
-- Project: DR/Product (eyhclzkifitbhbljgoav) — client `supabaseDR` (role anon เสมอ)
--
-- เก็บ "เฉพาะรูปที่ผิดปกติ (NG)" ตอนตรวจสภาพเครื่องด้วยการเทียบกับรูปมาตรฐาน
-- (รูปมาตรฐานต่อจุด = jig_checkpoints.image_path ที่มีอยู่แล้ว) — ผ่าน = ไม่เก็บพิกเซล
-- เพื่อไม่ให้เปลือง storage (ดู CLAUDE.md ส่วน "PM Photo-Compare Inspection")
--
-- Additive & backward-compatible: เพิ่มคอลัมน์เดียว ไม่แตะ policy/พฤติกรรมเดิม
--   evidence_path → path ใน bucket 'jig-images' (anon-open) ของรูปหลักฐานตอน NG
alter table public.inspection_results
  add column if not exists evidence_path text;
