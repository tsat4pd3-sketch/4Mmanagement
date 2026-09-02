-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- หน้า 📈 กำลังคน & Turnover (/workforce-insight) — 2026-09-02
--
-- ที่มา (คำขอ user): "อยากระบบที่บอก insight turn over ของพนักงาน และสรุปกำลังคนแต่ละวันเป็นกราฟ"
-- + "สรุปการเปลี่ยนตำแหน่งงานในแต่ละวัน" — รวม 3 อย่างในหน้าเดียว (3 แท็บ):
--   📊 กำลังคนรายวัน (daily_production_logs) · 🔀 เปลี่ยนจุดงานรายวัน (station_assignment_logs)
--   · 📉 Turnover (employees.is_active + audit_log)
--
-- อ่านอย่างเดียว ไม่มี resource:action ใหม่ (ไม่มีปุ่มเขียนข้อมูลในหน้านี้)
--
-- ⚠️ seed แบบระบุ role ชัด ห้ามใช้ enum_range (กับดักที่บันทึกไว้ใน CLAUDE.md —
--    role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้แบบ fail-closed โดยไม่มีใครรู้)
-- ให้ 4 role เดียวกับ /operator (ฐานข้อมูลพนักงาน — ระดับความอ่อนไหวใกล้เคียงกัน:
-- เห็นรายชื่อคนที่ inactive/turnover เป็นรายบุคคล) — role อื่นเปิดเพิ่มได้เองที่ /permissions

insert into role_permissions (role, permission_key, allowed)
select r, 'page:/workforce-insight', true
from unnest(array['admin','manager','supervisor','leader']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- rollback:
--   delete from role_permissions where permission_key = 'page:/workforce-insight';
