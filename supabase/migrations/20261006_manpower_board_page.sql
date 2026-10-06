-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- หน้า 🧑‍🤝‍🧑 Manpower Control Board (/manpower-board) — 2026-10-06 (คำสั่ง user)
-- แทนบอร์ดกระดาษหน้าไลน์: ผังกำลังคน + ผัง LAYOUT รูปคนตามจุดงาน + ป้ายสถานะ 4M ของแผนก
--
-- อ่านอย่างเดียว ไม่มีตารางใหม่ ไม่มี resource:action ใหม่ — คำนวณจาก org_nodes / employees /
-- shift_schedules / daily_production_logs / employee_home_positions / four_m_logs ที่มีอยู่แล้ว
--
-- ⚠️ seed แบบระบุ role ชัด ห้ามใช้ enum_range (role ที่เพิ่มทีหลังเข้าไม่ได้แบบเงียบ)
-- ให้ 4 role ระดับหัวหน้า + display (จอ TV แขวนหน้าไลน์ — บอร์ดนี้ตั้งใจให้แขวน) · เปิดเพิ่มเองได้ที่ /permissions

insert into role_permissions (role, permission_key, allowed)
select r, 'page:/manpower-board', true
from unnest(array['admin','manager','supervisor','leader','display']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- rollback:
--   delete from role_permissions where permission_key = 'page:/manpower-board';
