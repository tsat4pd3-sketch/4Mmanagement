-- ══ 📺 role display = ดูอย่างเดียว — ปิดหน้าที่บันทึกข้อมูลได้ — MAIN · ewhdfqwfwofivojtsizn · ชื่อในจอ "MAIN" · 2026-10-15 ══
-- คำสั่ง user: "ปิดหน้าที่บันทึกข้อมูลได้ของ role display ให้ที"
-- เหตุผล: บัญชีจอ (tv-1…tv-13@tsat4) เปิดค้างไว้บนทีวีหน้างาน ใช้รหัสผ่านร่วมกัน + ไม่โดน idle-logout
--   ⇒ หน้าไหนที่ role display บันทึกได้ = ใครเดินผ่านก็บันทึกแทนได้ โดยไม่รู้ว่าใครทำ
--
-- วิธีตัดสิน (ตรวจโค้ดหน้า 15/10):
--   ปิด  = หน้าที่งานหลักคือ "กรอก/บันทึก" หรือมีจุดเขียนที่ไม่ได้กันด้วยสิทธิ์ action
--          (เช่น /management สร้างใบ 4M ได้โดยไม่เช็คสิทธิ์)
--   เก็บ = จอดู/วิเคราะห์ที่ปุ่มเขียนทุกปุ่มกันด้วย action ที่ display ไม่มี
--          (/obeya safety:record·kpi:manage · /factory-map factory_map:edit · /energy energy:record ฯลฯ)
--   action: ปิด heijunka:operate · rack_center:operate (ปุ่มสแกน/ยืนยันบนบอร์ด) · เก็บ report:export (ดาวน์โหลด ไม่ได้เขียน)
--
-- ใช้ allowed=false (ไม่ delete) — เห็นที่ /permissions ว่า "ปิดไว้ชัดเจน" และย้อนได้ทีละช่อง
-- ผลข้างเคียงที่รู้: TV-3 มี /management ในรอบ ⇒ จอจะข้ามหน้านั้น + ชิปขึ้น "⚠ ข้าม 1 หน้า"
--   · บัญชีคนที่เป็น role display (kamonwan.boo@…) เข้าหน้าเหล่านี้ไม่ได้ด้วย
--
-- rollback (คืนค่าเดิมทั้งชุด):
--   update public.role_permissions set allowed = true
--    where role = 'display'::user_role and permission_key in (<รายการเดียวกับข้างล่าง>);

update public.role_permissions
   set allowed = false
 where role = 'display'::user_role
   and allowed
   and permission_key in (
     -- งานบันทึกประจำวัน / ตรวจ
     'page:/checkin', 'page:/daily-report', 'page:/daily-pm', 'page:/pm-check', 'page:/bbs', 'page:/lpa', 'page:/pokayoke',
     'page:/morning-meeting', 'page:/ojt-training', 'page:/improvements',
     -- แจ้งซ่อม / แผน PM
     'page:/mtn-repair', 'page:/pm-coordination', 'page:/pm-schedule',
     -- จัดการไลน์ (สร้าง 4M ได้โดยไม่เช็คสิทธิ์) / สต๊อก / ขนส่ง
     'page:/management', 'page:/line-stock', 'page:/transport',
     -- ทะเบียน/เอกสาร/ตั้งค่า
     'page:/doc-forms', 'page:/qr-labels', 'page:/fixture', 'page:/npi', 'page:/pe-docs',
     -- action ปุ่มบนบอร์ด
     'heijunka:operate', 'rack_center:operate'
   );

-- ตรวจ: select permission_key from role_permissions where role='display' and allowed order by 1;
