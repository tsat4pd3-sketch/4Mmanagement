-- ═══════════════════════════════════════════════════════════════
-- ESM — SEED DATA (ข้อมูลตั้งต้น)
-- รันหลังจาก schema แล้ว — แก้ค่าให้ตรงกับโรงงานของคุณก่อนรัน
-- ส่วน A รันในโปรเจคหลัก / ส่วน B รันในโปรเจค DR
-- ═══════════════════════════════════════════════════════════════

-- ╔═══ ส่วน A: โปรเจคหลัก ═══╗

-- ไลน์ผลิตตัวอย่าง (แก้ชื่อ/section ตามจริง)
insert into production_lines (name, section, std_day_shift, std_night_shift) values
  ('Line A', 'PD1', 10, 8),
  ('Line B', 'PD1', 12, 10),
  ('Line C', 'PD2', 8, 6)
on conflict (name) do nothing;

-- นิยามทักษะตัวอย่าง
insert into skill_definitions (name, label, color, category, sort_order) values
  ('Welding',    'งานเชื่อม',        '#f59e0b', 'hard_skill',    1),
  ('Spot',       'สปอตเชื่อม',       '#ef4444', 'hard_skill',    2),
  ('Assembly',   'งานประกอบ',        '#22c55e', 'hard_skill',    3),
  ('QC_Check',   'ตรวจสอบคุณภาพ',    '#a855f7', 'hard_skill',    4),
  ('Robot',      'หุ่นยนต์เชื่อม',    '#4d9fff', 'machine_skill', 5),
  ('Press',      'เครื่องปั๊ม',       '#06b6d4', 'machine_skill', 6),
  ('Safety',     'ความปลอดภัย',      '#84cc16', 'soft_skill',    7),
  ('Leadership', 'ภาวะผู้นำ',         '#ec4899', 'soft_skill',    8)
on conflict (name) do nothing;

-- PPE master
insert into ppe_items (name, sort_order) values
  ('หมวกนิรภัย', 1), ('รองเท้านิรภัย', 2), ('ถุงมือ', 3), ('แว่นตานิรภัย', 4),
  ('ปลั๊กอุดหู', 5), ('หน้ากากเชื่อม', 6), ('เอี๊ยมหนัง', 7), ('ปลอกแขน', 8),
  ('หน้ากากกันฝุ่น', 9), ('เสื้อสะท้อนแสง', 10);

-- ╔═══ ส่วน B: โปรเจค DR (Daily Report) ═══╗

-- ประเภท Downtime มาตรฐาน
insert into dr_downtime_types (name_th, color, category, sort_order) values
  ('เครื่องจักรเสีย',        '#ef4444', 'unplanned', 1),
  ('รอวัตถุดิบ',             '#f59e0b', 'unplanned', 2),
  ('ปรับตั้งเครื่อง (Setup)', '#a855f7', 'unplanned', 3),
  ('เปลี่ยนรุ่น (Changeover)','#06b6d4', 'unplanned', 4),
  ('ไฟดับ / ลมตก',           '#ef4444', 'unplanned', 5),
  ('รอ QC ตรวจ',             '#f59e0b', 'unplanned', 6),
  ('ขาดคน',                  '#ec4899', 'unplanned', 7),
  ('ประชุม / Morning talk',  '#22c55e', 'planned',   8),
  ('PM ตามแผน',              '#22c55e', 'planned',   9),
  ('ทดลองผลิต (Trial)',      '#4d9fff', 'planned',  10);

-- ประเภทงานเสียมาตรฐาน
insert into dr_defect_types (name_th, color, sort_order) values
  ('เชื่อมไม่ติด / เชื่อมขาด', '#ef4444', 1),
  ('รูเชื่อมทะลุ',             '#f97316', 2),
  ('มิติไม่ได้ตามแบบ',         '#f59e0b', 3),
  ('ชิ้นงานบิดงอ',             '#a855f7', 4),
  ('รอยขีดข่วน / บุบ',         '#06b6d4', 5),
  ('สนิม / คราบสกปรก',         '#84cc16', 6),
  ('ประกอบผิด / ใส่ผิดด้าน',   '#ec4899', 7),
  ('อื่นๆ',                    '#888888', 99);

-- นโยบายหยุดพักมาตรฐาน (แก้เวลาให้ตรงกับโรงงานของคุณ)
insert into break_policies (name, shift, process_type, start_time, duration_min, sort_order) values
  ('พักเบรกเช้า',   'day',   'common', '10:00', 10, 1),
  ('พักเที่ยง',     'day',   'common', '12:00', 60, 2),
  ('พักเบรกบ่าย',   'day',   'common', '15:00', 10, 3),
  ('พักเบรกค่ำ',    'night', 'common', '22:00', 10, 4),
  ('พักเที่ยงคืน',  'night', 'common', '00:00', 60, 5),
  ('พักเบรกดึก',    'night', 'common', '03:00', 10, 6);

-- ตัวอย่างสินค้า (แก้ตามจริง)
insert into dr_products (name, line_name, cycle_time_sec, target_per_shift, process_type) values
  ('MODEL-X Front Member',  'Line A', 45, 600, 'welding'),
  ('MODEL-Y Cross Member',  'Line B', 60, 450, 'welding');

-- ╔═══ ส่วน C: สร้าง Admin คนแรก ═══╗
-- 1. สร้าง user ใน Supabase Dashboard → Authentication → Add User
--    (ใส่ email + password, เลือก Auto Confirm)
-- 2. แล้วรัน SQL นี้ (แก้ email ให้ตรง):
--
-- update profiles set role = 'admin', full_name = 'ชื่อผู้ดูแลระบบ'
-- where email = 'admin@yourcompany.com';
