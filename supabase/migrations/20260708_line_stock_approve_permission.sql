-- ============================================================================
-- Permission seed: line_stock:approve
-- ============================================================================
-- TARGET PROJECT: main / "SHOP FLOOR MANAGEMENT DB" (ewhdfqwfwofivojtsizn) —
--   supabase client. role_permissions lives in the main project.
--
-- Gates who may approve/reject PENDING manual Line Stock movements (the store
-- review queue). Default policy: admin + manager only. Adjustable afterwards
-- from the จัดการสิทธิ์ (Permissions) page like any other permission key.
-- 'admin' always bypasses in code, but its row is seeded for matrix visibility.
-- ============================================================================

insert into public.role_permissions (role, permission_key, allowed) values
  ('admin',            'line_stock:approve', true),
  ('manager',          'line_stock:approve', true),
  ('supervisor',       'line_stock:approve', false),
  ('leader',           'line_stock:approve', false),
  ('qa',               'line_stock:approve', false),
  ('document_control', 'line_stock:approve', false),
  ('display',          'line_stock:approve', false)
on conflict (role, permission_key) do update set allowed = excluded.allowed;
