-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- บันทึกย้อนหลัง (2026-07-10): SQL ชุดนี้ถูก apply ผ่าน MCP ไปแล้วเมื่อ 2026-07-08/09
-- (เดิมมีแค่ comment ใน docs/sql/04_customer_demand.sql — ย้ายมาเป็น migration file
--  ตามกฎ CLAUDE.md เพื่อให้ environment ใหม่/การ restore ได้ schema ครบ)
-- ปลอดภัยต่อการรันซ้ำ: ทุก statement เป็น if-not-exists / on conflict

-- role ใหม่ 'sale' (ทีมขาย — ใช้กับหน้า Planner & Sales / Delivery)
alter type user_role add value if not exists 'sale';

-- สิทธิ์เข้าหน้า Delivery (/customer-demand)
insert into role_permissions (role, permission_key, allowed) values
  ('manager','page:/customer-demand',true), ('supervisor','page:/customer-demand',true),
  ('leader','page:/customer-demand',true), ('qa','page:/customer-demand',true),
  ('sale','page:/customer-demand',true), ('sale','page:/',true),
  ('sale','page:/dashboard',true), ('sale','page:/heijunka',true)
on conflict (role, permission_key) do nothing;

-- สิทธิ์หน้า Planner & Sales (/planner-sales) — copy จากสิทธิ์ /customer-demand
insert into role_permissions (role, permission_key, allowed)
select role, 'page:/planner-sales', allowed from role_permissions
where permission_key = 'page:/customer-demand'
on conflict (role, permission_key) do nothing;
