/* ═══════════════════════════════════════════════════════════════════════════════
   คีย์สิทธิ์ใหม่ `mtn_repair:spare_master` — ทะเบียนอะไหล่อย่างเดียว ไม่แตะใบ MO
   project: MAIN (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)   2026-10-14

   ที่มา (คำสั่ง user): หัวหน้าแผนกผลิตไลน์มาขอ "ขอแอดอะไหล่หน่อยครับ" เพราะเพิ่มเองไม่ได้
   2 ทางเดิมกว้างเกินความต้องการ:
     · `mtn_repair:manage_master` = สิทธิ์หัวหน้าโมดูล MTN — แก้ใบ MO ย้อนหลังได้ทุกขั้นทุกใบ
       ทั้งโรงงาน (ไม่ติด scope) · ข้ามด่านอนุมัติ · เซ็นแทนช่องอนุมัติ  (src/utils/mtnStepPerm.js:325)
     · `is_dept_admin`           = bucket dept_admin ให้คีย์เพิ่ม 28 ตัว ในนั้นมีคีย์ลบ 8 โมดูล
   ⇒ แยกคีย์ใหม่ที่ให้เท่าที่ต้องการจริง: ทะเบียนอะไหล่ + ผังคลัง + รับเข้า/เบิก

   ⚠️ workflow ใบ MO ไม่เกี่ยวกับคีย์นี้เลย — แต่ละขั้นมีคีย์ของตัวเองอยู่แล้ว
      (report · approve · accept_work · handover · close_cost · mtn_head · service_own_team)
      การเพิ่มคีย์นี้จึงไม่เปลี่ยนการเปิด/อนุมัติ/รับมอบใบ MO ของ role ใดทั้งสิ้น

   seed: ให้ค่า true เฉพาะ role ที่ "ทำได้อยู่แล้ว" ผ่าน manage_master (admin·manager·dept_admin·mtn)
         ⇒ **พฤติกรรมวันนี้ไม่เปลี่ยนสำหรับใครเลย** · role อื่น seed เป็น false ให้โผล่ในจอ
         `/permissions` เพื่อให้ user ติ๊กเองได้ (จอนั้นอ่านรายการคีย์จากแถวที่มีอยู่)

   rollback:  delete from public.role_permissions where permission_key = 'mtn_repair:spare_master';
              (โค้ดฝั่งจอ fail-closed: คีย์หาย = ไม่มีใครได้สิทธิ์จากคีย์นี้ ของเดิมที่ใช้
               manage_master ยังทำงานเหมือนเดิมทุกประการ ⇒ ย้อนได้โดยไม่ต้อง revert โค้ด)
   ═══════════════════════════════════════════════════════════════════════════════ */

insert into public.role_permissions (role, permission_key, allowed)
select r::public.user_role,
       'mtn_repair:spare_master',
       r in ('admin', 'manager', 'dept_admin', 'mtn')
from unnest(enum_range(null::public.user_role)) as r
on conflict (role, permission_key) do nothing;
