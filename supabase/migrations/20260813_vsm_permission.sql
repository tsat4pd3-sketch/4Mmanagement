-- VSM (Value Stream Mapping) — สิทธิ์ + ทะเบียนเอกสาร · 2026-08-13
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn) — additive
--
-- ⚠️ กับดัก enum_range (CLAUDE.md): seed ตอนนี้ล็อกรายชื่อ role ณ เวลานี้
--    role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้ (fail-closed) → เปิดเพิ่มที่ /permissions

-- 1) เข้าดู VSM — ทุก role (เป็นรายงาน read-only เหมือน /product-history)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/vsm', true
from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;

-- 2) สิทธิ์ระดับ action
insert into public.permission_catalog (permission_key, label, category)
values
  ('vsm:manage',      'VSM — สร้าง/แก้ไข/ลบแผนผังสายธาร',        'วิเคราะห์ & รายงาน'),
  ('routing:manage',  'ลำดับกระบวนการ (Routing) — เพิ่ม/แก้/ลบ',  'ตั้งค่า,ฐานข้อมูล')
on conflict (permission_key) do nothing;

-- vsm:manage = admin/manager/supervisor/leader/engineer (คนที่ทำ Lean หน้างาน)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'vsm:manage', true
from unnest(array['admin','manager','supervisor','leader','engineer']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- routing:manage = เจ้าของ master การผลิต (ชุดเดียวกับ products:edit)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'routing:manage', true
from unnest(array['admin','manager','supervisor','engineer']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- 3) ทะเบียนเอกสาร — ใบ VSM (A3 landscape · ยังไม่มีเลขฟอร์มทางการ = seed form_code null
--    ตามกฎ CLAUDE.md · ตั้งเลขเมื่อไหร่แถบเลขฟอร์มโผล่เอง ไม่ต้องแก้โค้ด)
--    layout_locked = false → เปลี่ยนขนาด/แนวกระดาษจาก /doc-forms ได้จริง
--    (ผังวาดด้วย SVG ที่ scale ตามหน้ากระดาษ ไม่ใช่ layout ตายตัวแบบฟอร์มทางการ)
insert into public.doc_forms (doc_key, title, form_code, rev, paper, paper_size, orientation, layout_locked, used_route, sig_blocks)
values ('vsm', 'แผนผังสายธารคุณค่า (Value Stream Map)', null, null,
        'A3 แนวนอน', 'A3', 'landscape', false, '/vsm',
        array['Approved By', 'Checked By', 'Issued By'])
on conflict (doc_key) do nothing;

-- Rollback:
--   delete from public.role_permissions where permission_key in ('page:/vsm','vsm:manage','routing:manage');
--   delete from public.permission_catalog where permission_key in ('vsm:manage','routing:manage');
--   delete from public.doc_forms where doc_key = 'vsm';
