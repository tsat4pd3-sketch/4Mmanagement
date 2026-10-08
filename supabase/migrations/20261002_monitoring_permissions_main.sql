-- ── Main project (MAIN · ewhdfqwfwofivojtsizn) ──
-- 📉 สิทธิ์หน้า Monitoring (บอร์ดติดตามแผน-สต๊อก · /monitoring · 2026-10-02)
--
-- ที่มา: user 01/10 — *"ตอนนี้ทีมวางแผนจะต้องทำข้อมูลนี้ใน excel เค้าอยากทำในระบบเรา ทำได้มั้ย"*
--        → *"เอาทุกชีททุกหน้าเลย ให้โปรแกรมทำได้แบบนั้น"*
--
-- 🔑 2 คีย์ (กฎ PERMISSIONS-DESIGN: คีย์ = ปุ่มบนจอ):
--   · `page:/monitoring`   = เปิดหน้าดูบอร์ดได้ (อ่านอย่างเดียว)
--   · `monitoring:manage`  = กรอกช่อง / นำเข้าไฟล์ Excel
--
-- เจ้าของตัวเลขคือ**ทีมวางแผน** แต่ฝ่ายผลิตต้องเห็นด้วย (บอร์ดบอกว่าของจะขาดวันไหน)
--   ⇒ สิทธิ์ "ดู" ยกชุดมาจาก `page:/rundown-stock` ซึ่งเป็นหน้าที่ตอบคำถามใกล้กันที่สุด
--     (คาดการณ์ของจะขาด) — ใครเห็นหน้านั้นได้ ก็ควรเห็นบอร์ดนี้ได้ ไม่ต้องมานั่งไล่ให้สิทธิ์ใหม่
--   ⇒ สิทธิ์ "กรอก" ให้แคบกว่า — คนที่เป็นเจ้าของตัวเลขจริงเท่านั้น
--
-- ⚠️ ตาราง `monitor_*` อยู่ฝั่ง **DR** ซึ่ง client วิ่งด้วย anon เสมอ (ไม่มี JWT)
--    ⇒ RLS ฝั่งนั้นเป็น anon-open ตาม pattern ของ DR ทั้ง project · **สิทธิ์จริงคุมที่ client**
--    (known gap ของ DR ที่บันทึกใน CLAUDE.md — ห้ามไป "แก้ให้ปลอดภัย" ด้วย TO authenticated
--     เคยทำพังทั้งระบบมาแล้ว)
--
-- ⚠️ โค้ดใช้ `canSeeded('monitoring','manage')` ⇒ **ยังไม่รัน migration นี้ = หน้าเป็นโหมด
--    อ่านอย่างเดียว ไม่พัง** (deploy-safe — โค้ดขึ้นก่อน migration ได้)
--
-- 🔙 rollback:
--   delete from role_permissions where permission_key in ('page:/monitoring','monitoring:manage');
--   (ลบแล้ว = ไม่มีใครเข้าหน้าได้ และ canSeeded คืน false ⇒ กลับไปอ่านอย่างเดียว ไม่พัง)

-- ดูได้ = เท่ากับคนที่ดูหน้า "คาดการณ์ของจะขาด" ได้
insert into role_permissions (role, permission_key, allowed)
select role, 'page:/monitoring', allowed from role_permissions
where permission_key = 'page:/rundown-stock'
on conflict (role, permission_key) do nothing;

-- กรอก/นำเข้าได้ = ทีมวางแผน + ผู้บริหารสายงาน (ชุดเดียวกับ production_plan:write)
insert into role_permissions (role, permission_key, allowed)
select r.role, 'monitoring:manage',
       r.role in ('admin'::user_role, 'manager'::user_role, 'dept_admin'::user_role,
                  'planner_store'::user_role, 'supervisor'::user_role)
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
-- select permission_key, role, allowed from role_permissions
--  where permission_key in ('page:/monitoring','monitoring:manage')
--  order by permission_key, role;
