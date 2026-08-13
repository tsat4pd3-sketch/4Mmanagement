-- 🔮 ภาพเมื่อทุกแผนกใช้ครบ (Adoption Outlook) — ตอบผู้บริหารว่า "ถ้าทุกแผนกใช้เต็มรูปแบบจะได้อะไร" · 2026-08-13
-- หน้าอ่านอย่างเดียว: ฝั่ง "วันนี้" นับสดจากฐานจริงทั้ง 2 project · ฝั่ง "อนาคต" ติดป้ายคาดการณ์/สมมติฐาน
-- ไม่มีตาราง/คอลัมน์ใหม่ — migration นี้ seed สิทธิ์เข้าหน้าอย่างเดียว
--
-- seed เฉพาะ admin/manager: เป็นจอผู้บริหาร และมีตัวเลข "คาดการณ์" อยู่ด้วย
-- ไม่ควรให้หน้างานเปิดเจอแล้วเข้าใจผิดว่าเป็นผลลัพธ์ที่เกิดขึ้นแล้ว
-- role อื่นเปิดเพิ่มเองได้จากหน้า /permissions (ไม่ต้อง deploy)
--
-- ⚠️ ตั้งใจไม่ seed ด้วย enum_range(user_role) — กับดักที่เจอซ้ำในโปรเจคนี้คือ seed แบบ "ทุก role
--    ณ วันนั้น" แล้ว role ที่เพิ่มทีหลังไม่มีแถว = เข้าไม่ได้แบบเงียบๆ ที่นี่ระบุ role ตรงๆ ตามเจตนา
--
-- rollback: delete from public.role_permissions where permission_key = 'page:/adoption-outlook';
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/adoption-outlook', true
from unnest(array['admin','manager']::user_role[]) r
on conflict (role, permission_key) do nothing;
