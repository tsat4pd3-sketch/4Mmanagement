-- 20260923_role_warehouse_delivery_seed.sql  ·  ⚠️ Main project — "MAIN" (ewhdfqwfwofivojtsizn)
-- ต้องรันหลัง `20260923_role_warehouse_delivery_enum.sql` (คนละทรานแซกชัน — ดูเหตุผลในไฟล์นั้น)
--
-- ที่มา (user 23/09): *"เราแยกสิทธิ์เป็น inbound-outbound ดีกว่ามั้ย · sale planner จะใกล้ๆกัน ที่ต่างคือพวกจัดส่ง"*
-- แล้วนิยามหน้าที่ให้ชัด: **planning-store = บริหาร stock + จ่ายงานในโรงงาน · warehouse = เก็บสินค้าพร้อมขาย
-- · delivery = ส่งของให้ลูกค้า**
--
-- ทำไมต้องมี role ใหม่ (วัดกับฐานจริง 23/09):
--   ระบบแบ่ง Logistic เป็น 3 ฝั่งอยู่แล้ว (`LOGISTIC_GROUPS` ใน src/utils/logisticSide.js →
--   เมนู · `permission_catalog.group_name` · ตัวตัดสินฝั่งจากเลข MAT) แต่ **ชั้น role ไม่ได้ตามไปด้วย**:
--     · ฝั่ง Store (inbound)            → มี role แล้ว = `planner_store`
--     · ฝั่ง แผนงาน&ข้อมูล (control)    → มี role แล้ว = `sale`
--     · ฝั่ง Warehouse & Delivery (outbound) → **ไม่มี role ของตัวเอง**  ← ช่องว่างที่ปิดด้วยไฟล์นี้
--   ผลของการไม่มี: `planner_store` ⊇ `sale` ทุกหน้าในหมวด Logistic ⇒ เป็น "เต็ม vs ลดทอน"
--   ไม่ใช่ "คนละหน้าที่" · คนจัดส่งเลยต้องเลือกระหว่าง *ได้น้อยไป* กับ *ได้เกินมา*
--   และของที่แจกไว้ก็สลับฝั่ง: `rack_center:operate` (ภาชนะ = งานจัดส่ง) ให้ `planner_store`
--   แต่ไม่ให้ `sale` ที่คนจัดส่งใช้อยู่จริง
--
-- ตรวจก่อนย้ายว่าไม่มีอะไร hardcode role เดิมไว้:
--   · RLS: ไม่มี policy ไหนใน public อ้าง 'sale'/'planner_store' (ทุกตัวใช้ has_perm)
--   · โค้ด: `DeptDashboard.DEPTS` (แท็บสโตร์) — เพิ่ม role ใหม่ในคอมมิทเดียวกัน
--   · `get_user_roles` RPC อ่านจาก enum เอง ⇒ dropdown ที่ /add-user ขึ้นให้อัตโนมัติ
begin;

-- 1) ตั้งต้นเท่ากับชุดที่ delivery ใช้อยู่จริงวันนี้ (role `sale`) — **ย้ายแล้วต้องไม่มีใครเสียของ**
--    ตั้งใจ copy จาก role เดิมแทนการไล่ลิสต์เอง: ลิสต์มือตกหล่นแน่ และเจตนาคือ "เท่าเดิม" ตรงๆ
insert into public.role_permissions (role, permission_key, allowed)
select 'warehouse_delivery'::user_role, permission_key, true
from public.role_permissions
where role = 'sale'::user_role and allowed
on conflict (role, permission_key) do update set allowed = true;

-- 2) เติมของฝั่งจัดส่งที่ "ควรมีตั้งแต่แรกแต่ไม่เคยมี" — ภาชนะ/Packaging (Rack Center)
--    อยู่ในหมวด Logistic - Warehouse & Delivery ของทะเบียนสิทธิ์อยู่แล้ว แต่ `sale` ไม่เคยได้
insert into public.role_permissions (role, permission_key, allowed)
select 'warehouse_delivery'::user_role, k, true
from unnest(array['page:/rack-center','rack_center:operate']) k
on conflict (role, permission_key) do update set allowed = true;

-- 3) ย้ายบัญชีฝั่งจัดส่ง 4 ใบ (warehouse = เก็บสินค้าพร้อมขาย · delivery = ส่งลูกค้า)
--    · `planningstore` คงเป็น `planner_store` — บริหาร stock + จ่ายงานในโรงงาน (ฝั่ง Store)
--    · `billing` คงเป็น `sale` — ออกบิล ไม่ได้ถือของ (ฝั่งแผนงาน&ข้อมูล)
update public.profiles set role = 'warehouse_delivery'::user_role
 where id in (
   '7a197ca9-3a52-4cd7-91e2-22025bf191e7',  -- warehouse1
   'c5d5ffac-44c8-4b3b-9feb-232563e0ba09',  -- warehouse2
   '32c2968a-c802-4afe-87cb-a4a4150002fa',  -- delivery1
   'a286bc81-79de-455f-bcaa-0e6885bd948d'   -- delivery2
 );

commit;

-- ผลที่วัดได้หลัง apply (23/09):
--   planner_store = planningstore · sale = billing · warehouse_delivery = warehouse1/2 + delivery1/2
--   คีย์ของ warehouse_delivery = 52 (หน้า 42) · ของฝั่งจัดส่งครบ (customer-demand · rundown-stock ·
--   rack-center + rack_center:operate · shipping:config · store-monitor · mtn_repair:report)
--   · ของฝั่งสโตร์ที่ไม่ควรติดมา = 0 (line_stock:issue · heijunka:operate · products:edit ·
--     org:manage_own_unit · page:/line-stock ไม่มีสักตัว)
--
-- ⚠️ ผู้ใช้ 4 คนนี้ต้องรีเฟรชหน้า (F5) หรือเข้าระบบใหม่ — `fetchProfile` อ่าน role ตอนโหลดเซสชันเท่านั้น
--
-- 📌 2 คีย์ที่ตั้งใจ "ยกมาก่อน ไม่ตัด" เพราะ delivery ใช้อยู่วันนี้ — ถ้าทีมตกลงว่าเป็นงาน Sales/Planner
--    ล้วน ให้ปิดที่ /permissions ได้เลยทีละติ๊ก ไม่ต้องแก้โค้ด:
--      · `demand:upload`        อัพโหลด Forecast/Order จากลูกค้า
--      · `page:/planner-sales`  หน้า Planner & Sales
--
-- rollback (กลับไปสภาพก่อนหน้า — enum ลบไม่ได้ แต่ทำให้ไม่มีใครถือ role นี้ได้):
--   update public.profiles set role='sale'::user_role where id in
--     ('32c2968a-c802-4afe-87cb-a4a4150002fa','a286bc81-79de-455f-bcaa-0e6885bd948d');
--   update public.profiles set role='planner_store'::user_role where id in
--     ('7a197ca9-3a52-4cd7-91e2-22025bf191e7','c5d5ffac-44c8-4b3b-9feb-232563e0ba09');
--   delete from public.role_permissions where role='warehouse_delivery';
