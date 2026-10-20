/* ═══════════════════════════════════════════════════════════════════════════════
   เติม `scope:all_units` เข้าทะเบียน `permission_catalog`
   project: MAIN (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)   2026-10-15

   🔴 แก้ของที่พลาดไปใน `20261015_scope_all_units_main.sql` — ไฟล์นั้น seed `role_permissions`
   อย่างเดียว **ไม่ได้ insert `permission_catalog`** ⇒ จอ `/permissions` สร้างรายการจาก catalog
   เท่านั้น (`PermissionsManagement.jsx`) ⇒ **คีย์นี้ไม่โผล่บนจอเลย ให้/ถอนได้ด้วย SQL เท่านั้น**

   ที่ทำให้เป็นเรื่องใหญ่กว่าปกติ: มี 3 ที่บอกผู้ใช้ว่า "ปรับได้ที่ /permissions"
     · `src/pages/AddUser.jsx` (ใต้ช่องขอบเขตส่วนงาน)
     · `src/utils/writeScope.js` (ข้อความตอนถูกบล็อก — "ขอสิทธิ์ข้ามหน่วยงาน")
     · `docs/PERMISSIONS-DESIGN.md` + `docs/modules/permission-scope-audit.md`
   ⇒ จอ/เอกสารบอกทางแก้ที่ทำไม่ได้จริง = ผิดกฎ "ห้ามล้มเหลวเงียบ · ต้องบอกทางแก้ที่ทำได้"

   ⚠️ ไม่แตะ `role_permissions` — ค่าที่ seed ไว้ (และที่แอดมินอาจปรับไปแล้ว) คงเดิมทุกแถว
   ⇒ ไม่มีใครได้/เสียสิทธิ์จาก migration นี้ เปลี่ยนแค่ "เห็นคีย์นี้บนจอหรือไม่"

   sort = 946 (ต่อจาก 945 ที่เป็นค่าสูงสุดของกลุ่ม "ตั้งค่าโปรแกรม,ฐานข้อมูล")

   rollback:  delete from public.permission_catalog
               where resource = 'scope' and action = 'all_units';
              (ถอดแล้วกลับไปสภาพเดิม = คีย์ยังทำงาน แต่ไม่โผล่บนจอ)
   ═══════════════════════════════════════════════════════════════════════════════ */

insert into public.permission_catalog (resource, action, label, group_name, sort)
values ('scope', 'all_units',
        'ขอบเขต: แก้ข้อมูลข้ามหน่วยงานได้ (ใบผ่านชั้นที่ 3)',
        'ตั้งค่าโปรแกรม,ฐานข้อมูล', 946)
on conflict (resource, action) do nothing;
