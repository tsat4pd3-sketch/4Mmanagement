-- ══ ช่องบนบอร์ด KPI (board_slot) — ทะเบียนบอกเองว่า KPI ตัวนี้ขึ้นแผ่นไหนบน OBEYA (MAIN · ewhdfqwfwofivojtsizn · 2026-09-30) ══
-- user: "inventory balance กับ DSI คือเรื่องเดียวกัน · training กับ TS ACADEMY คือสกอเดียวกัน"
-- เดิมบอร์ดจับคู่ 8 แผ่นหลักด้วย "ชื่อตรงตัว" (Inventory Balance / Training) แต่ทะเบียนใช้ชื่อทางการ
-- (Day Sales of Inventory (DSI) / TS Academy training) ⇒ แผ่นขึ้น "ยังไม่ได้ตั้ง KPI" ทั้งที่กรอกครบ
-- ⇒ ให้ทะเบียนถือ "ช่องบนบอร์ด" เอง (data-driven · แก้จากปุ่ม 📘 ได้ ไม่ต้องแก้โค้ดเมื่อชื่อ KPI เปลี่ยนปีหน้า)
-- คีย์ต้องตรงกับ KPI_BOARD_SLOTS ใน src/utils/kpiSetup.js · null = ไม่อยู่บน 8 แผ่นหลัก (ไปแผง Key Performance)
-- rollback: alter table public.kpi_catalog drop column board_slot;

alter table public.kpi_catalog
  add column if not exists board_slot text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_catalog_board_slot_chk') then
    alter table public.kpi_catalog add constraint kpi_catalog_board_slot_chk
      check (board_slot is null or board_slot in ('rm','dloh','dl','oh','inv','csat','oee','ppm','safe','train'));
  end if;
end $$;

comment on column public.kpi_catalog.board_slot is
  'แผ่นบนบอร์ด OBEYA ที่ KPI นี้ขึ้น (rm/dloh/dl/oh/inv/csat/oee/ppm/safe/train) · null = แผง Key Performance';

update public.kpi_catalog set board_slot = v.slot, updated_at = now()
from (values
  ('%rm (raw material)', 'rm'), ('dl+oh (direct labor + overhead)', 'dloh'), ('direct labor', 'dl'), ('overhead', 'oh'),
  ('inventory balance', 'inv'), ('day sales of inventory (dsi)', 'inv'),
  ('customer satisfaction', 'csat'), ('oee', 'oee'), ('ppm', 'ppm'), ('safety', 'safe'),
  ('training', 'train'), ('ts academy training', 'train')
) as v(nm, slot)
where lower(btrim(kpi_catalog.name)) = v.nm and kpi_catalog.board_slot is distinct from v.slot;

-- ตรวจ: select name, board_slot from kpi_catalog where board_slot is not null order by board_slot;
