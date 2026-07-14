-- ═══════════════════════════════════════════════════════════════════
-- สิทธิ์โมดูล MTN Work-Order (ใบแจ้งซ่อม MO) — Main project (ewhdfqwfwofivojtsizn)
-- page:/mtn-repair        → ทุก role เข้าดูได้
-- mtn_repair:report       → แจ้งซ่อม (step1) + รับมอบ/ติดตาม (step6) : ทุก role (ฝั่งผู้แจ้ง)
-- mtn_repair:service      → รับงาน/ซ่อม/ตรวจ (step2-4) : mtn/admin/manager (ทีมช่าง)
-- mtn_repair:qa           → คุณภาพหลังซ่อม (step5)     : qa/admin/manager
-- mtn_repair:approve      → อนุมัติปิด (step7)          : manager/admin
-- mtn_repair:manage_master→ ช่าง/อะไหล่/taxonomy         : admin/manager/mtn
-- ปรับภายหลังได้จากหน้า /permissions
-- ═══════════════════════════════════════════════════════════════════

insert into role_permissions (role, permission_key, allowed)
select r, 'page:/mtn-repair', true
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'mtn_repair:report', true
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'mtn_repair:service', (r::text in ('admin','manager','mtn'))
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'mtn_repair:qa', (r::text in ('admin','manager','qa'))
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'mtn_repair:approve', (r::text in ('admin','manager'))
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'mtn_repair:manage_master', (r::text in ('admin','manager','mtn'))
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;
