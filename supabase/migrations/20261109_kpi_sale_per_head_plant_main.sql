-- 2026-11-09 · MAIN ("MAIN" ewhdfqwfwofivojtsizn) · apply แล้วผ่าน MCP 09/11
-- user: "sales/head ต้องเท่ากันทุกส่วนงาน เป็นค่ากลาง ยอดขายรวม/ยอดคนทั้งโรงงาน จากไฟล์บัญชี"
-- 1) catalog Annual Sale Per Head = ค่าโรงงาน ⇒ ทุกหน่วยอ่านแผ่นระดับ ทั้งโรงงาน (sharedValueDef)
update public.kpi_catalog set value_scope = 'plant', updated_at = now()
 where id = '0058277c-7abd-4553-81f0-19009fe556f8';
-- 2) แผ่นระดับโรงงาน = สูตร sale_per_head (Σ Total Sales ÷ กำลังคนทั้งโรงงาน ÷ 1e6) + เป้า/หน่วย/ทิศ (เดิมว่าง = "ไม่มีเป้า")
update public.kpi_definitions set provider = 'formula', provider_config = '{"formula":"sale_per_head"}'::jsonb,
  unit = 'MB/Head', direction = 'up', decimals = 3,
  target = '≥ 5.654 MB/Head', target_value = 5.654, commitment = '≥ 5.489 MB/Head', commit_value = 5.489, updated_at = now()
 where id = '4fca09cc-a3ee-4af5-9108-c58a110dad67';
-- ตรวจ: select id, scope_kind, provider, provider_config, target_value, commit_value from public.kpi_definitions where id='4fca09cc-a3ee-4af5-9108-c58a110dad67';
--       select value_scope from public.kpi_catalog where id='0058277c-7abd-4553-81f0-19009fe556f8';
-- ย้อน: update kpi_catalog set value_scope='own' where id='0058277c-…'; update kpi_definitions set provider=null, provider_config=null, target_value=null, commit_value=null where id='4fca09cc-…';
-- หมายเหตุ: แถว kpi_base_inputs manpower ระดับ section (PD1 33 · PD2 ~42) ไม่ถูกใช้อีก (สูตรอ่าน plant) — ปล่อยไว้ ไม่ลบ · ค่ากรอกมือรายเดือน 0.437… ของทุกหน่วยถูกสูตรทับเมื่อกำลังคนโรงงานครบ
