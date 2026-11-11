-- 2026-11-11 · MAIN ("MAIN" ewhdfqwfwofivojtsizn) · apply แล้วผ่าน MCP 11/11
-- user: "ใช้ข้อ ข Plan รายเดือนจากชีทบัญชี" — KPI สะสมตัดสิน ○△✗ รายเดือนเทียบแผนสะสมของเดือนนั้น (kpi_month_plans) แทนเป้าทั้งปี
-- ธงต่อแถว (data-driven) · default false = พฤติกรรมเดิมทุกแถว · ตัวตัดสิน = planBarsOf()/scoreDef(value, def, { plan }) ใน src/utils/kpiSetup.js
alter table public.kpi_definitions add column if not exists score_by_plan boolean not null default false;
-- เปิดให้ ยอดขาย/หัว ทุกแถวของปี 2026 (แผ่นโรงงาน + PD1–PD4 + JIG MTN — แถวหน่วยอ่านค่าและแผนจากแผ่นโรงงาน)
update public.kpi_definitions set score_by_plan = true, updated_at = now()
 where year = 2026 and provider = 'formula' and provider_config->>'formula' = 'sale_per_head';
-- ตรวจ: select scope_kind, scope_value, score_by_plan from public.kpi_definitions where provider_config->>'formula'='sale_per_head';
-- ย้อน: alter table public.kpi_definitions drop column score_by_plan;
