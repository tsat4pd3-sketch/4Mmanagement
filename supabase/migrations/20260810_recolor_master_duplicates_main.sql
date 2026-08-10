-- ล้างสีซ้ำ skill_definitions (Main project) — 2026-08-10 คำสั่ง user "จัดสีใหม่ให้เลย"
-- แถวแรกของแต่ละสีเก็บสีเดิม · ตัวซ้ำ (ส่วนใหญ่ #4d9fff default เดิม) ได้สีใหม่ไม่ซ้ำ · guard เขียนเฉพาะแถวที่ยังเป็นสีเดิม

-- skill_definitions: 21 แถวที่สีซ้ำ → สีใหม่ไม่ซ้ำ (guard: เขียนเฉพาะแถวที่ยังเป็นสีเดิม)
update skill_definitions t set color = v.new_color
from (values
  ('550515f8-6ee6-4153-b441-3438e62e7f7e', '#4d9fff', '#f59e0b'),
  ('39e09d40-4bc1-495a-aaa6-cc816fc78e41', '#4d9fff', '#eab308'),
  ('07419f50-11df-4a10-b3fd-a807ca6fc62a', '#4d9fff', '#84cc16'),
  ('90a0274c-e4b0-4007-9110-eb90445692ce', '#4d9fff', '#10b981'),
  ('51211e8e-573f-44ef-abd7-908c72e3d53c', '#4d9fff', '#14b8a6'),
  ('cca94141-d6c8-4bf7-8c1a-5c720a6c8494', '#4d9fff', '#06b6d4'),
  ('b3c2ceaf-2760-4c70-983e-445c6894da70', '#4d9fff', '#0ea5e9'),
  ('56328bab-d2ab-4372-acab-60b3e2d35a85', '#4d9fff', '#6366f1'),
  ('ef31f55d-6447-442a-911b-c3dd3eb6dac2', '#4d9fff', '#8b5cf6'),
  ('caf0e3b3-2408-4fa9-8c74-ae88b7181d3d', '#4d9fff', '#d946ef'),
  ('494f4d9d-ba4e-4958-acd2-5094c851fc9f', '#4d9fff', '#ec4899'),
  ('1a7c1ae3-3e69-4466-9aad-71e409ef12cd', '#4d9fff', '#f43f5e'),
  ('08f8cb8b-e31f-4eef-8b7c-0d9965d93782', '#ff4d4d', '#fb923c'),
  ('e5cab86f-c704-4eda-845f-0499561bc9ae', '#ff4d4d', '#facc15'),
  ('e6fe8f26-6fb1-401b-a81d-f8c660b38e7e', '#ff4d4d', '#4ade80'),
  ('39071aa4-ed95-48cc-8f92-8095ca40a23d', '#4d9fff', '#2dd4bf'),
  ('d7b0f722-117f-41f5-9c3e-7a23ccf0cef3', '#4d9fff', '#38bdf8'),
  ('05d5e8b7-7ee4-4338-a882-5f9a61b01b99', '#4d9fff', '#a78bfa'),
  ('cdea9d5d-f176-4dc2-bf68-4d198cdf3bf9', '#4d9fff', '#e879f9'),
  ('6a9926c6-a883-453e-96b1-d59a1702923b', '#4d9fff', '#f87171'),
  ('7715255f-ab58-402b-b2c8-35d7b4eecf13', '#4d9fff', '#94a3b8')
) as v(pk, old_color, new_color)
where t.id = v.pk::uuid and lower(t.color) = v.old_color;

