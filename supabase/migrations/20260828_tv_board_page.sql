-- ══ สิทธิ์เข้าหน้า 📺 จอ TV แขวนห้อง — /tv (Main · 2026-08-28) ══
--
-- ที่มา (user): "เป็นหน้าสำหรับเปิดจอทีวีเลย มีหน้าที่ display อย่างเดียว ให้ระบบเบาที่สุด
--                เวลารันบน browser smart tv โดยแยกแผนกได้เลย (ช่าง / ผลิต / สโตร์)"
--
-- หน้านี้ **อ่านอย่างเดียว** — เป็นเปลือกเต็มจอของบอร์ดเดิม `<MtnAndonBoard>` (ไม่ใช่บอร์ดใบใหม่)
-- เนื้อในทั้งหมดคุมด้วยสิทธิ์/scope ของบัญชีที่ login อยู่แล้ว จึงเปิดหน้าให้ทุก role ได้
--
-- seed แบบ "ระบุ role ชัดเจน" ครบทุก role ปัจจุบัน
--   ⚠️ ห้ามใช้ enum_range — role ที่เพิ่มทีหลังจะไม่มีแถว = fail-closed เงียบๆ (กับดักเดิมของโปรเจค)
--   role `display` สำคัญสุด: จอ TV login ด้วยบัญชีนี้ และได้รับยกเว้น auto-logout + data-perf="lite"
insert into public.role_permissions (role, permission_key, allowed)
select v.r::user_role, 'page:/tv', true
from (values
  ('admin'), ('manager'), ('supervisor'), ('leader'), ('qa'), ('document_control'),
  ('sale'), ('mtn'), ('engineer'), ('planner_store'), ('display')
) v(r)
where not exists (
  select 1 from public.role_permissions
  where role = v.r::user_role and permission_key = 'page:/tv'
);

-- ตรวจหลังรัน:
--   select role, allowed from public.role_permissions where permission_key = 'page:/tv' order by role;
--   (ควรได้ 11 แถว allowed = true)
--
-- Rollback: delete from public.role_permissions where permission_key = 'page:/tv';
