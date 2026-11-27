-- MAIN (ewhdfqwfwofivojtsizn) · 2026-11-25 · ⬆ วิธีรวมข้ามหน่วย (แผ่นรวมของหน่วยแม่/ทั้งโรงงาน)
-- user: "ค่าที่ไม่ใช่ของส่วนกลางระดับโรงงาน ควรรวมระดับส่วนทั้งหมดที่มีข้อมูลมาโชว์ เช่น DL-OH, inventory"
-- เจ้าของกฎ JS: rollupModeOf() ใน src/utils/kpiRollup.js · ว่าง = อัตโนมัติ (สูตร → formula · sum → sum · อื่น → average)
alter table public.kpi_catalog add column if not exists rollup_mode text
  check (rollup_mode is null or rollup_mode in ('sum','average','formula'));
comment on column public.kpi_catalog.rollup_mode is 'วิธีรวมค่าของหน่วยลูกขึ้นแผ่นรวม: sum | average | formula(Σ ตัวตั้ง ÷ ค่ากลาง) · null = อัตโนมัติ';
-- DSI / Inventory Balance รายแผนกบวกกันได้ = ของโรงงาน (ตัวหาร COGS เป็นของโรงงาน · obeya-kpi-board.md §14.3)
update public.kpi_catalog set rollup_mode = 'sum' where rollup_mode is null and (name ilike 'Day Sales of Inventory%' or name = 'Inventory Balance');
-- ตรวจผล: select name, rollup_mode from kpi_catalog where rollup_mode is not null;
