-- Monthly Performance Review (.pptx) export — 2026-07-30 (Main project)
-- 1) ลงทะเบียนเอกสารเข้า Document Master (กฎ: เอกสาร export ทุกตัวต้องมี doc_key)
-- 2) permission ปุ่ม export ใน /oee-analytics (idempotent — รันซ้ำได้)

-- 1) doc_forms — ยังไม่มีเลขฟอร์มทางการ seed form_code = null ให้ doc_control เติมเอง
insert into doc_forms (doc_key, form_code, title, paper, used_route, notes)
values ('monthly_review', null, 'Monthly Performance Review (.pptx)', '16:9 PowerPoint', '/oee-analytics',
        'เด็ค PPTX ตาม template TSG — โลโก้/เลขฟอร์ม override ได้จากทะเบียนนี้')
on conflict (doc_key) do nothing;

-- 2) catalog: oee:export_review
delete from public.permission_catalog where (resource, action) = ('oee', 'export_review');
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('oee', 'export_review', 'OEE: Export รายงานเดือน Monthly Review (.pptx)', 'ฝ่ายผลิต', 17);

-- 3) seed สิทธิ์ default = admin/manager/supervisor
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'oee:export_review', true
from (values ('admin'::user_role), ('manager'::user_role), ('supervisor'::user_role)) as r(role)
where not exists (
  select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = 'oee:export_review');
