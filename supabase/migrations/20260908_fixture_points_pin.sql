-- ══════════════════════════════════════════════════════════════════════════
-- จุดชิมของ fixture "ปักบนรูปเครื่อง" + ผูกเหตุการณ์ชิมกับใบตรวจ PM   2026-09-08
-- Project: DR (eyhclzkifitbhbljgoav)
--
-- ที่มา (คำสั่ง user): "shim record กับการตรวจสอบ ควรใช้กลไกเดียวกัน — กำหนดจุดตามตำแหน่งในรูป"
--   เดิม fixture_points เป็นแค่ลิสต์ ไม่มีตำแหน่งบนรูป · จุดตรวจ PM (jig_checkpoints) มี x_pos/y_pos/image_id
--   → ให้จุดชิมใช้รูปชุดเดียวกับ PM Setup (jig_images) และพิกัดแบบเดียวกัน (0..1 ของกล่องรูปจริง)
--   ⚠️ ไม่รวมตาราง — ความหมายคนละอย่าง (PM = OK/NG ตามรอบใบ · ชิม = ค่าสะสม mm + ความถี่รายจุด)
--   หมุดของจุด = x_pos/y_pos ของตัวเอง · ถ้าไม่ตั้งแต่ผูก checkpoint_id ไว้ → ใช้หมุดของ checkpoint นั้น (pointPin ฝั่งเว็บ)
-- additive · nullable · ของเดิมไม่กระทบ
-- ══════════════════════════════════════════════════════════════════════════
alter table public.fixture_points
  add column if not exists x_pos    numeric,
  add column if not exists y_pos    numeric,
  add column if not exists image_id uuid references public.jig_images(id) on delete set null;
comment on column public.fixture_points.x_pos    is 'ตำแหน่งหมุดบนรูป 0..1 (สัดส่วนของกล่องรูปจริง — convention เดียวกับ jig_checkpoints) · null = ยังไม่ปัก';
comment on column public.fixture_points.image_id is 'เฟรม jig_images ที่ปักหมุดไว้ · null + x_pos ไม่ null = เฟรมแรก (เหมือน jig_checkpoints)';

-- เหตุการณ์ชิมที่บันทึกจากใบตรวจ PM → สอบกลับได้ว่ามาจากใบตรวจไหน (golden thread)
alter table public.fixture_shim_events
  add column if not exists inspection_id uuid references public.inspections(id) on delete set null;
create index if not exists fixture_shim_events_inspection_idx on public.fixture_shim_events (inspection_id) where inspection_id is not null;

-- ตรวจผล:
--   select column_name from information_schema.columns where table_name='fixture_points' and column_name in ('x_pos','y_pos','image_id');  -- 3 แถว
--   select column_name from information_schema.columns where table_name='fixture_shim_events' and column_name='inspection_id';           -- 1 แถว
-- Rollback (ถอดโค้ดเว็บก่อน):
--   alter table public.fixture_points drop column x_pos, drop column y_pos, drop column image_id;
--   alter table public.fixture_shim_events drop column inspection_id;
