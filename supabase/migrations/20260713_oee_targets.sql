-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- Target OEE/A/P/Q ระดับ "กรุ๊ป" (production_lines ที่เป็น parent หรือไลน์เดี่ยวไม่มีแม่)
-- ระดับส่วน (section) ไม่เก็บในตาราง — หน้า OEE คำนวณเป็นค่าเฉลี่ยของกรุ๊ปใน section นั้น
-- เช่น APRON ASSY ≥75% + HYDROFORM ≥85% → PD3 ≥80% (เฉลี่ย) · กรุ๊ปที่ไม่ตั้งค่า = ไม่ถูกนำมาเฉลี่ย
-- ตั้งค่าจากหน้า /oee-analytics ปุ่ม 🎯 (สิทธิ์ manage_master_data) — ดู src/pages/OEEAnalytics.jsx

create table if not exists oee_targets (
  id          uuid primary key default gen_random_uuid(),
  group_name  text not null unique,  -- production_lines.name ของกรุ๊ป
  target_oee  numeric(5,2) check (target_oee is null or (target_oee >= 0 and target_oee <= 100)),
  target_a    numeric(5,2) check (target_a   is null or (target_a   >= 0 and target_a   <= 100)),
  target_p    numeric(5,2) check (target_p   is null or (target_p   >= 0 and target_p   <= 100)),
  target_q    numeric(5,2) check (target_q   is null or (target_q   >= 0 and target_q   <= 100)),
  updated_by      uuid,
  updated_by_name text,
  updated_at      timestamptz not null default now()
);

alter table oee_targets enable row level security;
-- pattern เดียวกับตาราง master ฝั่ง Main อื่นๆ: เปิด authenticated แล้วคุมสิทธิ์ที่ UI layer (manage_master_data)
create policy "oee_targets_select" on oee_targets for select to authenticated using (true);
create policy "oee_targets_write"  on oee_targets for all    to authenticated using (true) with check (true);
