-- ═══ permission_catalog ตามหมวดใหม่หลัง nav audit — 2026-08-27 ═══════════════════════
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- COSMETIC ล้วน: เปลี่ยนเฉพาะ group_name (ตำแหน่งที่แถวโผล่ในแท็บ "สิทธิ์การทำงาน" ของ /permissions)
-- **ไม่แตะ role_permissions — สิทธิ์ของทุก role คงเดิมทุกช่อง**
--
-- ที่มา: รีวิวโครงนำทางทั้งระบบ (58 เมนู · 107 แท็บ) พบว่า
--   1. หมวด 'วิศวกรรม (PE)' มีเมนูเดียว แต่กินที่บนแถบไอคอน rail เท่าหมวด 13 เมนู
--      → ยุบเข้ากับ QA/QC แล้วตั้งชื่อรวมเป็น 'คุณภาพ & วิศวกรรม'
--        (งาน PFMEA/Control Plan เป็นสายเดียวกับงานคุณภาพอยู่แล้ว — ลูปปิด 8D → PE)
--   2. จอผู้บริหาร/เดโม 3 หน้า (flow-tower · group-overview · adoption-outlook) นั่งปนกับ
--      Dashboard/ผังรวมในหมวด 'ภาพรวม' ทั้งที่ไม่ใช่หน้าที่หัวหน้ากะเปิดทุกวัน
--      → แยกเป็นหมวด 'ผู้บริหาร & เดโม' ท้ายสุด
--
-- กติกาเดิมยังอยู่: group_name ต้องเป็นชื่อหมวดตาม NAV_GROUP_ORDER เท่านั้น
-- ช่วง sort ต่อหมวดคงเดิม (700-799 = หมวดคุณภาพ · 800-899 เดิมของ PE ถูกดูดเข้า 700 ต่อท้าย)
--
-- Rollback:
--   update permission_catalog set group_name = 'ควบคุมคุณภาพ QA/QC'
--    where group_name = 'คุณภาพ & วิศวกรรม' and resource <> 'pe';
--   update permission_catalog set group_name = 'วิศวกรรม (PE)' where resource = 'pe';
--   update permission_catalog set group_name = 'ภาพรวม' where group_name = 'ผู้บริหาร & เดโม';

-- ① QA/QC + PE → 'คุณภาพ & วิศวกรรม'
update public.permission_catalog
   set group_name = 'คุณภาพ & วิศวกรรม'
 where group_name in ('ควบคุมคุณภาพ QA/QC', 'วิศวกรรม (PE)');

-- ② จอผู้บริหาร/เดโม แยกออกจาก 'ภาพรวม'
--    (ปัจจุบันหมวดภาพรวมมี action เดียวคือ factory_map:edit ซึ่งเป็นงานจริง ไม่ใช่เดโม → ไม่ต้องย้าย
--     บล็อกนี้เตรียมไว้เผื่อมี action ของ 3 หน้านั้นในอนาคต — ตอนนี้ match 0 แถวโดยตั้งใจ)
update public.permission_catalog
   set group_name = 'ผู้บริหาร & เดโม'
 where resource in ('flow_tower', 'group_overview', 'adoption_outlook');

-- ③ ตรวจผล — ต้องไม่เหลือหมวดที่ไม่มีใน NAV_GROUP_ORDER
do $$
declare bad text;
begin
  select string_agg(distinct group_name, ' · ') into bad
    from public.permission_catalog
   where group_name is not null
     and group_name not in (
       'ภาพรวม','ฝ่ายผลิต','วิเคราะห์ & รายงาน','พนักงาน & ทักษะ','Logistic - Store',
       'การตรวจสอบและซ่อมบำรุง','คุณภาพ & วิศวกรรม','ตั้งค่าโปรแกรม,ฐานข้อมูล','ผู้บริหาร & เดโม');
  if bad is not null then
    raise warning 'permission_catalog มีหมวดที่ไม่อยู่ใน NAV_GROUP_ORDER: %', bad;
  end if;
end $$;
