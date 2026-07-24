-- ── DR project (eyhclzkifitbhbljgoav) ──
-- Master กระบวนการผลิต (process types) — data-driven แทน hardcode (คำสั่ง user 2026-07-23
-- "อยากให้ user config เองได้จากที่นึง แล้วเอาไปใช้ร่วมกันหลายจุด — ยืดหยุ่นกับโรงงานอื่น")
-- ใช้ร่วม: machines.process_type · dr_products.process_type · dr_downtime_types/dr_defect_types/
-- break_policies.process_type — เทียบกันด้วย key (text) เหมือนเดิม ค่าเดิมไม่ต้อง migrate
-- จัดการที่ Daily Report → ⚙️ ตั้งค่า → 🏭 กระบวนการ · โค้ดอ่านผ่าน src/utils/processTypes.js (fallback ค่าเดิม)
-- หมายเหตุ: 'common' (ทุกกระบวนการ) เป็น sentinel ในโค้ด ไม่อยู่ในตารางนี้

create table if not exists process_types (
  key        text primary key,          -- ค่าที่เก็บในคอลัมน์ process_type ของตารางอื่น (สร้างแล้วห้ามแก้)
  label      text not null,
  icon       text,
  color      text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table process_types enable row level security;
create policy "process_types_all" on process_types for all using (true) with check (true); -- DR convention: anon-open

insert into process_types (key, label, icon, color, sort_order) values
  ('welding_assembly', 'Welding / Assembly', '🔥', '#f97316', 1),
  ('metal_forming', 'Metal Forming', '⚙', '#3b82f6', 2)
on conflict (key) do nothing;
