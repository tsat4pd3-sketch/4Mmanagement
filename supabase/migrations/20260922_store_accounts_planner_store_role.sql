-- 20260922_store_accounts_planner_store_role.sql  ·  ⚠️ Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- ที่มา: ใบสรุปประชุม 21/09/2569 ข้อ 3 (Planning "กดผลิตไม่ได้") + ข้อ 4 (Store "เพิ่ม organize ส่วนงานไม่ได้"
--        / "ปรับยอด Stock over all ไม่ได้") · user เลือกทางเลือก ก. (ย้าย role ไม่ใช่ติ๊กสิทธิ์ให้ sale ทั้งก้อน)
--
-- รากของปัญหา (วัดกับฐานจริง 22/09):
--   role `planner_store` ที่ออกแบบไว้สำหรับงานสโตร์/วางแผน **ไม่มีบัญชีใช้เลยสักคน (0 คน)**
--   แต่สิทธิ์ "ลงมือทำ" ของงานสโตร์ทั้งชุดถูก seed ไว้ที่ role นี้ ส่วนบัญชีจริงถูกตั้งเป็น `sale`
--   ⇒ อาการ "เปิดหน้าได้ แต่ไม่มีปุ่ม" ซึ่งตรงกับที่หน้างานแจ้งทุกข้อ:
--     · page:/heijunka = true แต่ไม่มี heijunka:operate  → เห็นคิวคัมบัง กดปุ่ม ▶ เริ่มผลิต ไม่ได้
--     · page:/org-setup = true แต่ไม่มี org:manage_own_unit → เปิดผังองค์กรได้ แต่อ่านอย่างเดียว
--     · ไม่มี page:/line-stock เลย → หน้าที่มีเมนู 🔧 ปรับยอด เปิดไม่ได้ (เห็นยอดผิดจาก /store-monitor แต่แก้ไม่ได้)
--     · ไม่มี line_stock:issue · rack_center:operate · transport:manage · products:edit
--   ⚠️ คลาสเดียวกับ audit 2026-09-04 (RLS/สิทธิ์แคบกว่าปุ่มบนจอ) — ต่างที่รอบนี้ "role ของบัญชีผิดตัว"
--      ไม่ใช่ policy ผิด ⇒ แก้ที่ข้อมูลสิทธิ์ ไม่ต้องแก้โค้ด
--
-- ตรวจก่อนย้ายแล้วว่าไม่มีอะไรผูกกับ role 'sale' แบบ hardcode:
--   · โค้ด: มีจุดเดียว DeptDashboard.jsx:764 ซึ่งเขียน roles: ['planner_store','sale'] อยู่แล้ว (ครอบทั้งคู่)
--   · RLS: ไม่มี policy ไหนใน public อ้าง 'sale' เลย (ทุก policy ใช้ has_perm)
begin;

-- 1) เติมสิทธิ์ที่ `sale` มีแต่ `planner_store` ไม่มี — ย้ายแล้วต้องไม่เสียของเดิม
--    (mtn_repair:report สำคัญที่สุด — สโตร์ต้องแจ้งซ่อมรถยก/ชั้นวางได้)
--    ⚠️ ห้ามใช้ `where not exists` คัดแถวออก — แถวที่มีอยู่แล้วแต่ allowed=false จะถูกข้ามเงียบ
--       (เป็น false อยู่ดี) ⇒ upsert ตรงๆ แล้วบังคับ allowed=true เสมอ
insert into public.role_permissions (role, permission_key, allowed)
select 'planner_store'::user_role, k, true
from unnest(array['mtn_repair:report','page:/improvements','page:/morning-meeting']) k
on conflict (role, permission_key) do update set allowed = true;

-- 2) กัน "ย้ายแล้วได้สิทธิ์เกินที่ควรได้" — planner_store ถูก seed employees:edit_all_sections ไว้
--    ทั้งที่บัญชีสโตร์ตั้ง sections = [] (ไม่จำกัดขอบเขต) ⇒ ย้ายแล้วจะแก้ประวัติพนักงานได้ทุกส่วนงาน
--    ปิดไว้ก่อนตามหลัก least privilege · ตอนนี้ยังไม่มีใครถือ role นี้ = ไม่มีใครเสียสิทธิ์ที่เคยมี
--    ต้องการคืนเมื่อไหร่ = ติ๊กช่องเดียวที่ /permissions ไม่ต้องแก้โค้ด
--    (employees:deactivate ปล่อยไว้ — ถูกจำกัดด้วยส่วนงานตัวเองอยู่แล้ว และ role อื่นก็มีกันทั่ว)
update public.role_permissions set allowed = false
 where role = 'planner_store'::user_role and permission_key = 'employees:edit_all_sections';

-- 3) ย้าย 3 บัญชีงานสโตร์/วางแผน ไป role ที่ออกแบบไว้ให้งานนี้
--    (delivery1 · delivery2 · billing คงเป็น 'sale' ตามเดิม — งานจัดส่ง/วางบิล ไม่ใช่งานสโตร์
--     และไม่ควรได้สิทธิ์กดผลิต/ปรับยอดสต๊อกติดไปด้วย = เหตุผลที่เลือกทางเลือก ก. แทน ข.)
update public.profiles set role = 'planner_store'::user_role
 where id in (
   '33001c34-63ac-4732-93f9-2adc43525d6a',  -- planningstore
   '7a197ca9-3a52-4cd7-91e2-22025bf191e7',  -- warehouse1
   'c5d5ffac-44c8-4b3b-9feb-232563e0ba09'   -- warehouse2
 );

-- 4) สิทธิ์แก้ผังองค์กรของหน่วยงานตัวเอง — **ไม่มีทั้ง sale และ planner_store** (เดิมมีแค่
--    admin/dept_admin/manager/supervisor) ⇒ ย้าย role เฉยๆ ยังแก้ข้อ "เพิ่ม organize ส่วนงานไม่ได้" ไม่ได้
--    คีย์นี้ถูกจำกัดขอบเขตด้วย `profiles.section` ของคนกดอยู่แล้ว (แก้ได้เฉพาะแผนก/กลุ่มใต้ส่วนงานตัวเอง
--    · ตัว section เองยังเป็นของ admin) จึงปลอดภัยที่จะให้สโตร์ถือ
insert into public.role_permissions (role, permission_key, allowed)
values ('planner_store'::user_role, 'org:manage_own_unit', true)
on conflict (role, permission_key) do update set allowed = true;

-- 5) 🔴 ต้นเหตุจริงของ "store เพิ่ม organize ส่วนงานไม่ได้" — ชื่อส่วนงานไม่ตรงกัน
--    OrgSetup หา "ส่วนงานของฉัน" ด้วยการจับคู่ `profiles.section` กับ org_nodes.code **หรือ** .name
--    · บัญชีสโตร์ 8 คน: profiles.section = 'Planning&Store'
--    · แต่ node ส่วนงานในผังชื่อ 'PLN & STO' และ code = null
--    ⇒ จับคู่ไม่ติด → mySecId = null → ปุ่มเพิ่มแผนก/กลุ่มถูกปิดหมด **ต่อให้มีสิทธิ์ครบก็ยังกดไม่ได้**
--    แก้ด้วยการเติม code ให้ตรงกับค่าที่โปรไฟล์ใช้ (ชื่อที่แสดงบนผังยังเป็น 'PLN & STO' เหมือนเดิม)
--    ปลอดภัย: section_signers มีแค่ PD3/PD4 · production_lines.section ไม่มีค่านี้ ⇒ ไม่มีคีย์ไหนเปลี่ยนความหมาย
update public.org_nodes set code = 'Planning&Store'
 where kind = 'section' and name = 'PLN & STO' and code is null;

commit;

-- เช็คผลหลังรัน (MAIN · ewhdfqwfwofivojtsizn):
--   select full_name, role from public.profiles
--    where full_name in ('planningstore','warehouse1','warehouse2','delivery1','delivery2','billing') order by 1;
--   -- ต้องได้ planner_store 3 คน · sale 3 คน
--   select permission_key, allowed from public.role_permissions
--    where role='planner_store' and permission_key in
--      ('heijunka:operate','line_stock:issue','org:manage_own_unit','page:/line-stock','mtn_repair:report');
--
-- ⚠️ ผลข้างเคียงที่ตั้งใจ — 3 บัญชีนี้เสีย `skills:edit_high` (คีย์ที่ role sale มี แต่ planner_store ไม่มี)
--    = พิมพ์คะแนนสกิลเองได้สูงสุด 50 แทนที่จะถึง 100 · ตั้งใจไม่เติมให้ (งานสโตร์ไม่ใช่ผู้ประเมินฝีมือ)
--    ถ้าหน้างานต้องใช้จริง ติ๊ก skills:edit_high ให้ planner_store ที่ /permissions ได้เลย
--
-- rollback (กลับไปสภาพเดิมทั้งหมด):
--   update public.profiles set role='sale'::user_role where id in
--     ('33001c34-63ac-4732-93f9-2adc43525d6a','7a197ca9-3a52-4cd7-91e2-22025bf191e7','c5d5ffac-44c8-4b3b-9feb-232563e0ba09');
--   update public.role_permissions set allowed=true
--    where role='planner_store' and permission_key='employees:edit_all_sections';
--   delete from public.role_permissions where role='planner_store'
--    and permission_key in ('mtn_repair:report','page:/improvements','page:/morning-meeting','org:manage_own_unit');
--   update public.org_nodes set code=null where kind='section' and name='PLN & STO';
