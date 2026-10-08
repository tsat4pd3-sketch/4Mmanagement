-- ══ 🔗 ผูกโปรเจค NPI เข้ากับรุ่นบนบอร์ด New Model (2026-10-06 · คำสั่ง user) ═══════════════
-- โจทย์ user: *"หลักๆ 2 หน้านี้ต้อง link กัน"* (/npi ↔ /nm-board)
--
-- 2 หน้านี้พูดถึง "รุ่นใหม่ 1 รุ่น" เหมือนกัน แต่คนละมุม:
--   /nm-board = บอร์ดผนัง IEC (21 แผง · EVA สีที่ "คนตั้งเอง" — กฎ IEC ข้อ 1)
--   /npi      = ทะเบียนของจริง (พาร์ท · เฟส · เอกสาร PPAP · ECI · tooling — มี workflow)
-- ⇒ ผูกด้วย "ตัวชี้" ไม่ใช่ copy ข้อมูลข้ามกัน · ห้ามให้ระบบเขียนทับสีบอร์ด
--
-- 🔴 ทำไมตัวชี้อยู่ฝั่ง NPI: ข้อมูลบอร์ดยังอยู่ในโค้ด (`src/data/nmBoard737D.js` — เฟสถอดจาก
--    บอร์ดกระดาษ) ถ้าให้บอร์ดถือตัวชี้ จะต้องแก้โค้ด+deploy ทุกครั้งที่ผูกรุ่นใหม่
--    ⇒ เก็บเป็น **text (ไม่ใช่ FK)** เพราะปลายทางยังไม่ใช่ตารางใน DB
--    เมื่อย้ายบอร์ดเข้า DB แล้วค่อยเปลี่ยนเป็น FK ได้โดยไม่กระทบข้อมูลเดิม (ค่าเดิมคือ id เดียวกัน)
--
-- 🔴 ไม่มี default · ไม่ backfill เดาให้ — การผูกผิดรุ่น = บอร์ดโชว์ตัวเลขของรุ่นอื่น
--    ซึ่งแย่กว่าไม่โชว์เลย · ยังไม่ผูก = จอเขียนว่า "ยังไม่ผูก" (กฎความซื่อสัตย์ของจอ)
--
-- ย้อนกลับได้ 100% (คอลัมน์ nullable เฉยๆ · โค้ดเก่าไม่รู้จักก็ทำงานได้เหมือนเดิม):
--   alter table public.npi_projects drop column if exists nm_board_id;

alter table public.npi_projects
  add column if not exists nm_board_id text;

comment on column public.npi_projects.nm_board_id is
  'รหัสรุ่นบนบอร์ด New Model (/nm-board · เช่น 737d-mlm) — text ไม่ใช่ FK เพราะบอร์ดยังอยู่ในโค้ด · null = ยังไม่ผูก (ห้ามเดาจากชื่อ/ลูกค้า)';

-- คิวรีจากฝั่งบอร์ดคือ "รุ่นนี้ผูกกับโปรเจคไหน" ⇒ index ที่ค่าที่ผูกแล้วเท่านั้น (ส่วนใหญ่เป็น null)
create index if not exists npi_projects_nm_board_id_idx
  on public.npi_projects (nm_board_id)
  where nm_board_id is not null;

-- ตรวจผลหลังรัน:
-- select project_code, name, customer, model, nm_board_id from public.npi_projects order by created_at;
