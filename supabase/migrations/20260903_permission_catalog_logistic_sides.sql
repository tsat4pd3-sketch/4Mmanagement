-- แยกหมวด Logistic เป็น 3 ฝั่งตามความรับผิดชอบจริงของแผนกย่อย (2026-09-03 · คำสั่ง user)
-- ═══════════════════════════════════════════════════════════════════════════════
-- ฝ่าย Logistic & Sales มี 7 แผนกย่อย แบ่งงานเป็น 3 ฝั่ง:
--   📥 ขาเข้า  — Store                          : 3xx ซื้อนอก · 5xx raw · 2xx ผลิตเอง
--   📤 ขาออก  — Warehouse · Delivery · Rack     : FG 1xx · รอบส่งลูกค้า · ภาชนะ
--   🧭 แผนงาน — Sales · Planner · Billing        : ประสานข้อมูล ขาเข้า ↔ ผลิต ↔ ขาออก
--
-- ⚠️ Warehouse (ที่เก็บ FG 1xx → ขาออก) ≠ Store (คุม 2xx/3xx/5xx → ขาเข้า) — ห้ามสลับ
--
-- ⚠️ cosmetic ล้วน — แตะเฉพาะ `group_name`/`sort` ของ permission_catalog (ตารางทะเบียนที่ทำให้
--    คีย์ "โผล่ให้ติ๊ก" ในหน้า /permissions)  **ไม่แตะ role_permissions** สิทธิ์ของทุก role คงเดิมเป๊ะ
--
-- ⚠️ group_name ต้องตรงกับ NAV_GROUP_ORDER ใน App.jsx เป๊ะ ไม่งั้นได้หมวดกำพร้ากลางตาราง
--    (เคยพลาดมาแล้ว 2 ครั้ง — ดู 20260819_permission_catalog_regroup / 20260824_..._org_divisions_group)
--    ช่วง sort ของหมวด Logistic คือ 500-599 → ซอยเป็น ขาเข้า 500-519 · ขาออก 520-539 · แผนงาน 540-559

update public.permission_catalog c set
  group_name = v.grp,
  sort       = v.srt
from (values
  -- ── 📥 ขาเข้า (Store) ────────────────────────────────────────────────
  ('line_stock',  'issue',         'Logistic - ขาเข้า (Inbound)',  502),
  ('line_stock',  'manage_rounds', 'Logistic - ขาเข้า (Inbound)',  503),
  ('line_stock',  'approve',       'Logistic - ขาเข้า (Inbound)',  504),
  ('wip',         'adjust',        'Logistic - ขาเข้า (Inbound)',  505),
  ('heijunka',    'operate',       'Logistic - ขาเข้า (Inbound)',  506),
  -- โซนคลังเก็บได้ทั้ง FG และวัตถุดิบ แต่หน้าจัดการอยู่ใน /line-stock (ขาเข้า) → วางตามหน้า
  ('storage',     'manage',        'Logistic - ขาเข้า (Inbound)',  507),
  ('transport',   'manage',        'Logistic - ขาเข้า (Inbound)',  508),

  -- ── 📤 ขาออก (Warehouse · Delivery · Rack Center) ────────────────────
  ('rack_center', 'operate',       'Logistic - ขาออก (Outbound)',  522),
  ('shipping',    'config',        'Logistic - ขาออก (Outbound)',  523),

  -- ── 🧭 แผนงาน & ข้อมูล (Sales · Planner · Billing) ───────────────────
  ('demand',      'upload',        'Logistic - แผนงาน & ข้อมูล',   542)
) as v(res, act, grp, srt)
where c.resource = v.res and c.action = v.act;

-- ── ตรวจหลังรัน (ควรได้ 3 หมวด · 7 + 2 + 1 = 10 คีย์ · ไม่มีแถวไหนเหลือ 'Logistic - Store') ──
-- select group_name, count(*), min(sort), max(sort) from permission_catalog
--  where group_name like 'Logistic%' group by 1 order by 2 desc;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- update public.permission_catalog set group_name = 'Logistic - Store'
--  where group_name like 'Logistic - %';
--   (แล้ว revert โค้ดฝั่งหน้าเว็บด้วย — group_name ต้อง mirror NAV_GROUP_ORDER เสมอ)
