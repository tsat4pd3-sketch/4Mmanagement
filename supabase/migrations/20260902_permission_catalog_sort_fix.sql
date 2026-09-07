-- 🔢 จัดเลข sort ของ permission_catalog ให้ตรงช่วงหมวด + เลิกซ้ำ  (Main project · cosmetic ล้วน)
--
-- ✅ apply แล้ว 2026-09-02
--
-- ที่มา: full QC audit 2026-09-02 — ตรวจฐานจริงพบ 3 จุด
--
-- กฎ C6(ข) ใน CLAUDE.md: "group_name ต้องเป็นชื่อหมวดตาม NAV_GROUP_ORDER + sort ตามช่วงของหมวด
--   (ภาพรวม 1xx · ฝ่ายผลิต 2xx · วิเคราะห์ 3xx · พนักงาน 4xx · Logistic 5xx · ซ่อมบำรุง 6xx
--    · QA/QC 7xx · PE 8xx · ตั้งค่า 9xx — เลือกเลขที่ยังว่าง ห้ามซ้ำ)"
--
-- ① storage:manage อยู่ sort 69 แต่หมวด Logistic - Store ใช้ช่วง 500-599
--    ⇒ PermissionsManagement.jsx:171 ดึงด้วย .order('sort') แล้วสร้างกลุ่ม "ตามลำดับที่แถวโผล่"
--      แถว 69 มาก่อนทุกอย่างในหมวด 2xx-9xx → **หัวข้อ "Logistic - Store" กระโดดขึ้นไปอยู่บนสุด**
--      ของแท็บ "สิทธิ์การทำงาน" = ไม่ mirror ลำดับ sidebar ตามที่กฎบังคับ
--    (มาจาก 20260825_storage_zones_permission_main.sql)
--
-- ② ฝ่ายผลิต sort 260 และ 261 มีอย่างละ 2 คีย์ → สลับที่กันเองแบบสุ่มทุกครั้งที่โหลด
--    bbs:* (20260821) ชนกับ wip/line_levels (20260831) — คนละ migration คนละ session
--
-- ③ ตั้งค่าฯ sort 905 มี 2 คีย์ (products:create ที่มาก่อน + org:manage_own_unit ที่ seed ทีหลัง)
--
-- ⚠️ ไม่แตะ role_permissions เลย — ไม่มีใครได้/เสียสิทธิ์จาก migration นี้
-- ⚠️ อัปเดตเฉพาะแถวที่ sort ยังเป็นค่าเดิม (where sort = ...) → รันซ้ำได้ และถ้ามี session อื่น
--    แก้ไปก่อนแล้วจะไม่เขียนทับของเขา

-- ① ย้ายเข้าช่วง Logistic (505-535 ใช้อยู่ → 540 ว่าง)
update public.permission_catalog
   set sort = 540
 where resource = 'storage' and action = 'manage' and sort = 69;

-- ② แยกคู่ที่ชนกัน — bbs:* คงเลขเดิม (มาก่อน) · wip/line_levels ขยับลง
update public.permission_catalog set sort = 265 where resource = 'line_levels'  and action = 'manage'  and sort = 260;
update public.permission_catalog set sort = 266 where resource = 'wip_request'  and action = 'decide'  and sort = 261;
update public.permission_catalog set sort = 267 where resource = 'wip_request'  and action = 'receive' and sort = 262;

-- ③ products:create คงเลขเดิม · org:manage_own_unit ขยับไป 908 (906/907 = products:edit/delete)
update public.permission_catalog
   set sort = 908
 where resource = 'org' and action = 'manage_own_unit' and sort = 905;

-- ตรวจหลังรัน — ทั้ง 2 คิวรีต้องได้ 0 แถว
-- select group_name, sort, count(*) from public.permission_catalog group by 1,2 having count(*) > 1;
-- select group_name, sort, resource||':'||action from public.permission_catalog
--  where (group_name = 'Logistic - Store'          and sort not between 500 and 599)
--     or (group_name = 'ฝ่ายผลิต'                  and sort not between 200 and 299)
--     or (group_name = 'ตั้งค่าโปรแกรม,ฐานข้อมูล' and sort not between 900 and 999);
--
-- Rollback: update ... set sort = 69/260/261/262/905 กลับตามคีย์เดิม (cosmetic ย้อนได้ปลอดภัย)
