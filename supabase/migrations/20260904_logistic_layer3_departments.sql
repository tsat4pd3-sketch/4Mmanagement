-- ═══════════════════════════════════════════════════════════════════════════════
-- Logistic ชั้น 3 — 7 แผนกย่อยใต้ Planning&Store + ป้าย "ฝั่งงาน" + scope ฝั่งต่อบัญชี
-- (2026-09-04 · งานค้างจากคำสั่ง user 2026-09-03 "Warehouse ≠ Store")   ── Main project ──
-- ═══════════════════════════════════════════════════════════════════════════════
-- ที่มา: ระบบยุบ 2 ส่วนของฝ่าย Logistic & Sales (ผังจริง ORG001 Rev.09) เหลือ section เดียว
--   `Planning&Store` ที่มี **0 แผนกย่อย** → บัญชีทั้ง 8 กองรวมกัน แยกสิทธิ์ตามงานจริงไม่ได้
--   ชั้น 1 (เมนู 3 หมวด) + ชั้น 2 (ชิปกรองในหน้า) ทำแล้ว 2026-09-03 — นี่คือชั้น 3
--
-- โครงที่เลือก (หลักเดียวกับ `org_nodes.division` — 20260818_org_divisions.sql):
--   • **ไม่เพิ่มชั้นใหม่ในต้นไม้** และ **ไม่แยก section** (profiles.sections / employees.section
--     อ้าง 'Planning&Store' อยู่ — เปลี่ยนชื่อ/แยก = ทุกบัญชีหลุด scope)
--   • ติดป้าย `logistic_side` ที่ node (แผนก) แล้วลูกตกทอดขึ้นไปหา (`sideOfNode` ใน logisticSide.js)
--   • บัญชีได้ "ฝั่ง" 2 ทาง: `profiles.logistic_sides[]` ตั้งตรงที่ /add-user (บัญชีหน่วยงาน/shared
--     ที่ไม่ผูกพนักงาน — ข้อมูลจริง: sale 6 บัญชี account_kind='shared' ทั้งหมด) หรือ
--     ตกทอดจากแผนกของพนักงานที่ผูก (`profiles.employee_id` → `employees.department` → node)
--   • **ว่าง = ไม่จำกัด** (เห็นทุกฝั่งเหมือนวันนี้) → apply แล้ว **ไม่มีใครเสียสิทธิ์** จนกว่า admin
--     จะติ๊กฝั่งให้บัญชี · ไม่แตะ role_permissions / permission_catalog เลย
--
-- ค่าฝั่ง = key ใน src/utils/logisticSide.js SIDES (เก็บ key ไม่เก็บชื่อ — หลักเดียวกับ role/process_type):
--   inbound  📥 ขาเข้า  — Store                       (2xx ผลิตเอง · 3xx ซื้อนอก · 5xx raw)
--   outbound 📤 ขาออก  — Warehouse · Delivery · Rack   (FG 1xx · รอบส่งลูกค้า · ภาชนะ)
--   control  🧭 แผนงาน — Sales · Planner · Billing     (ไม่ถือของ ประสานข้อมูล)
--
-- ⚠️ Warehouse (FG 1xx → ขาออก) ≠ Store (2xx/3xx/5xx → ขาเข้า) — ห้ามสลับ
--
-- ROLLBACK (ย้อนโค้ดก่อน แล้วค่อยแตะ schema):
--   alter table public.profiles  drop column if exists logistic_sides;
--   delete from public.org_nodes where kind='department' and parent_id = (select id from public.org_nodes where name='Planning&Store' and kind='section')
--     and name in ('Store','Warehouse','Delivery','Rack Center','Sales','Planner','Billing');
--     -- ⚠️ ลบแผนกได้เฉพาะเมื่อยังไม่มีพนักงานลงทะเบียนใต้แผนกพวกนี้ (employees.department เป็น free text ไม่มี FK)
--   alter table public.org_nodes drop column if exists logistic_side;
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. ป้ายฝั่งที่ node ผังองค์กร ──────────────────────────────────────────────
alter table public.org_nodes add column if not exists logistic_side text;
do $$ begin
  alter table public.org_nodes
    add constraint org_nodes_logistic_side_chk
    check (logistic_side is null or logistic_side in ('inbound', 'outbound', 'control'));
exception when duplicate_object then null; end $$;
comment on column public.org_nodes.logistic_side is
  'ฝั่งงาน Logistic ของ node (inbound=Store · outbound=Warehouse/Delivery/Rack · control=Sales/Planner/Billing) — ลูกตกทอดจากแม่ · key ตาม src/utils/logisticSide.js';

-- ── 2. ฝั่งต่อบัญชี (ตั้งตรง — สำหรับบัญชีที่ไม่ผูกพนักงาน) ─────────────────────
alter table public.profiles add column if not exists logistic_sides text[];
comment on column public.profiles.logistic_sides is
  'ฝั่งงาน Logistic ที่บัญชีนี้ทำ (subset ของ inbound/outbound/control) — null/ว่าง = ไม่จำกัด · ถ้าว่างและผูกพนักงาน จะตกทอดจากแผนกของพนักงาน · แยกจาก sections (scope ผลิต) และ mtn_teams (คิวซ่อม)';

-- ── 3. seed 7 แผนกย่อยใต้ Planning&Store (ข้ามถ้ามีชื่อนั้นใต้ส่วนนี้แล้ว) ───────
--   cost_center เว้นว่าง (ผังจริงให้เลขระดับ "ส่วน" 21404290000 / 214025000 — ระดับแผนกยังไม่มีเลข
--   ให้ doc_control เติมที่ /org-setup) · division ไม่ติด (ตกทอด logistic จาก section)
--   · labor_type ไม่ติด (ตกทอด indirect จาก section)
with ps as (
  select id from public.org_nodes where kind = 'section' and name = 'Planning&Store' limit 1
), seed(name, side, sort_order) as (
  values
    ('Store',       'inbound',  1),   -- 📥 ขาเข้า
    ('Warehouse',   'outbound', 2),   -- 📤 ขาออก (FG 1xx)
    ('Delivery',    'outbound', 3),
    ('Rack Center', 'outbound', 4),
    ('Sales',       'control',  5),   -- 🧭 แผนงาน & ข้อมูล
    ('Planner',     'control',  6),
    ('Billing',     'control',  7)
)
insert into public.org_nodes (kind, name, parent_id, sort_order, logistic_side, is_active)
select 'department', s.name, ps.id, s.sort_order, s.side, true
  from seed s cross join ps
 where not exists (
   select 1 from public.org_nodes n
    where n.kind = 'department' and n.parent_id = ps.id and lower(btrim(n.name)) = lower(s.name)
 );

-- แผนกที่มีอยู่แล้ว (ถ้า session อื่นสร้างไว้ก่อน) แต่ยังไม่มีป้าย → ติดป้ายให้ตามชื่อ
with ps as (
  select id from public.org_nodes where kind = 'section' and name = 'Planning&Store' limit 1
)
update public.org_nodes n set logistic_side = v.side
  from (values
    ('store','inbound'), ('warehouse','outbound'), ('delivery','outbound'), ('rack center','outbound'),
    ('sales','control'), ('planner','control'), ('billing','control')
  ) v(nm, side), ps
 where n.kind = 'department' and n.parent_id = ps.id and n.logistic_side is null
   and lower(btrim(n.name)) = v.nm;

-- ── ตรวจหลังรัน (ควรได้ 7 แถว · ฝั่งครบ inbound 1 · outbound 3 · control 3) ──────
-- select n.name, n.logistic_side, n.sort_order
--   from public.org_nodes n join public.org_nodes p on p.id = n.parent_id
--  where p.name = 'Planning&Store' order by n.sort_order;
-- select column_name from information_schema.columns
--  where table_name in ('profiles','org_nodes') and column_name in ('logistic_sides','logistic_side');
