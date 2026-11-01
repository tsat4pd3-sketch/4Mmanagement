-- 🧹 ถอดคีย์ที่ "ไม่ใช่เรื่องคุณภาพ" ออกจากชุดสิทธิ์ qa  (Main · ewhdfqwfwofivojtsizn · 2026-11-01)
--
-- คำสั่ง user 31/10 "ลุย" หลังดูผลวัด (docs/ORG-SCALE-GLOBAL-DESIGN.md §ผลวัดแกน ① "เรื่อง")
-- หลัก (คำพูด user): "QA เห็นเรื่องคุณภาพได้ทั้งโรงงาน แต่ไม่ใช่เข้าไปงานคนอื่นที่ไม่เกี่ยวกับ QA ได้ทั้งโรงงาน"
--
-- วัดแล้ว 90 วัน: คน QA 23 คน ใช้คีย์ 6 ตัวนี้ = 0 ครั้ง ทุกตาราง
--   (ใบตรวจ PM/AM · pm_plans · prod_orders · kanban_* · เปิด/ปิดกะ · shift_schedules · แร็ค/ใบเบิก)
--   ขณะที่คนอื่นใช้ตารางเดียวกันตลอด (อนุมัติ PM 340 ครั้ง) ⇒ 0 = ไม่เคยใช้จริง ไม่ใช่ไม่มีข้อมูล
--
-- คงไว้: scope:all_units (พื้นที่ทั้งโรงงานถูกแล้ว) · npi:edit (APQP/PPAP เป็นงานคุณภาพ) · scrap/lpa/event_log/mtn_repair:report
-- ย้อนกลับ: insert 6 แถวคืนด้วยค่า allowed=true (block ท้ายไฟล์)

delete from public.role_permissions
 where role = 'qa'
   and permission_key in ('pm:approve','pm:record','am:record',
                          'heijunka:operate','shift_schedule:edit_dept','rack_center:operate');

-- เช็คผล: ต้องได้ 0 แถว
-- select permission_key from public.role_permissions where role='qa'
--   and permission_key in ('pm:approve','pm:record','am:record','heijunka:operate','shift_schedule:edit_dept','rack_center:operate');

-- ⏪ rollback
-- insert into public.role_permissions (role, permission_key, allowed)
-- select 'qa', k, true from unnest(array['pm:approve','pm:record','am:record','heijunka:operate','shift_schedule:edit_dept','rack_center:operate']) k
-- on conflict do nothing;
