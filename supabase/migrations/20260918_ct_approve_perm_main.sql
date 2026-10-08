/*  ═══════════════════════════════════════════════════════════════════════════════════════
    สิทธิ์อนุมัติปรับ Cycle Time — `ct:approve`
    project: Main / "MAIN"  (ewhdfqwfwofivojtsizn)            วันที่: 2026-09-18
    ═══════════════════════════════════════════════════════════════════════════════════════

    คู่กับ `20260918_ct_proposals_dr.sql` (ฝั่ง DR) — คิวข้อเสนอปรับ CT

    ทำไมต้องเป็นคีย์แยก ไม่ใช้ `products:edit` เดิม:
      กด "อนุมัติ" = **เขียนทับ CT มาตรฐาน** ซึ่งผูกกับ Control Plan / PFC / งานที่ส่งลูกค้า (PPAP)
      ⇒ เป็นการตัดสินใจทางวิศวกรรม ไม่ใช่การแก้ master ทั่วไป
      user สั่ง 18/09: *"อาจจะรอวิศวกรอนุมัติปรับ ก็จะกลายเป็น CT มาตรฐานใหม่"*

    ให้ใคร: admin · manager · engineer   (เสนอได้ = ใครมี products:edit ตามเดิม)
    ⚠️ ใช้ array ชื่อ role ตรงๆ ไม่ใช้ enum_range() — ตามที่แก้ไว้ใน 20260916_obeya_perm_no_enum_range.sql

    ── ROLLBACK ────────────────────────────────────────────────────────────────────────────
      delete from role_permissions where permission_key = 'ct:approve';
      delete from permission_catalog where resource = 'ct' and action = 'approve';
    ═══════════════════════════════════════════════════════════════════════════════════════ */

begin;

insert into permission_catalog (resource, action, label, group_name, sort)
values ('ct', 'approve', 'อนุมัติปรับ Cycle Time มาตรฐาน', 'คุณภาพ & วิศวกรรม', 320)
on conflict (resource, action) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'ct:approve', r in ('admin', 'manager', 'engineer')
from unnest(array[
  'admin', 'manager', 'supervisor', 'leader', 'qa', 'mtn',
  'engineer', 'planner_store', 'sale', 'document_control', 'dept_admin', 'display'
]::user_role[]) as r
on conflict (role, permission_key) do nothing;

commit;

/* ── ตรวจผลหลังรัน ─────────────────────────────────────────────────────────────────────
-- ต้องได้ 12 แถว · allowed = true เฉพาะ admin/manager/engineer
select role, allowed from role_permissions where permission_key = 'ct:approve' order by allowed desc, role;

-- ต้องไม่คืนแถวไหนเลย = ไม่มี role ตกหล่น
select r from unnest(array['admin','manager','supervisor','leader','qa','mtn',
  'engineer','planner_store','sale','document_control','dept_admin','display']::user_role[]) as r
where not exists (select 1 from role_permissions p where p.role = r and p.permission_key = 'ct:approve');
─────────────────────────────────────────────────────────────────────────────────────── */
