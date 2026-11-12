-- ═══════════════════════════════════════════════════════════════════════════
-- ✍️ คีย์ใหม่ `qa:bin_decide` — ตัดสินผลของในถังเหลือง (งานดี/ซ่อม/ขอใช้/ทำลาย)   ·   project = Main "MAIN" (ewhdfqwfwofivojtsizn)
--
-- ที่มา: คำสั่ง user 2026-11-10 "QA เท่านั้น" (WI-PD3-069 §5.4 — QA เป็นผู้พิจารณา)
--   เดิมปุ่มตัดสินใช้ `scrap:record` ซึ่ง supervisor/leader/dept_admin ถืออยู่ ⇒ หัวหน้าไลน์ตัดสิน "งานดี" เองได้
--   แล้วชื่อตัวเองไปอยู่ช่อง QA บนใบ
-- seed = role `qa` เท่านั้น (admin ผ่านเสมอใน canSeeded) · เพิ่ม role อื่นได้ที่ /permissions
-- ไม่แตะ RLS (ตาราง `quality_bin_records` อยู่ DR = anon-open ตามกฎ supabaseDR — ด่านนี้คือชั้นจอ · known gap)
-- ยังไม่ apply: canSeeded() = false ⇒ ปุ่มตัดสินปิด (ยกเว้น admin) — ต้อง apply คู่กับโค้ด
-- ย้อน: delete from role_permissions where permission_key='qa:bin_decide';
--       delete from permission_catalog where resource='qa' and action='bin_decide';
-- ═══════════════════════════════════════════════════════════════════════════

insert into permission_catalog (resource, action, label, group_name, sort)
values ('qa', 'bin_decide', 'QA: ตัดสินผลของในถังเหลือง (งานดี/ซ่อม/ขอใช้/ทำลาย)', 'คุณภาพ & วิศวกรรม', 707)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

insert into role_permissions (role, permission_key, allowed)
select 'qa'::user_role, 'qa:bin_decide', true
where not exists (select 1 from role_permissions x where x.role = 'qa'::user_role and x.permission_key = 'qa:bin_decide');

-- ตรวจหลังรัน:
--   select role, allowed from role_permissions where permission_key = 'qa:bin_decide';
