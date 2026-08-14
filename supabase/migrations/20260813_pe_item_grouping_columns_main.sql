-- คอลัมน์จัดกลุ่มรายการตามโครงไฟล์จริง (2026-08-13 · Main · additive)
-- FMEA: คอลัมน์ Item/Function ในฟอร์ม (INCOMING INSP. / PROGRESSIVE / FINAL INSPECTION …)
-- CP:   sub-op ในใบ Control Plan (เช่น "130.3 · PROGRESSIVE") — 1 OP มีหลาย sub-op
alter table public.pe_fmea_items add column if not exists item_function text;
alter table public.pe_cp_items   add column if not exists sub_op text;
comment on column public.pe_fmea_items.item_function is 'Item/Function จากฟอร์ม FMEA — ใช้จัดกลุ่มแถวใน UI';
comment on column public.pe_cp_items.sub_op is 'sub-op ในใบ CP เช่น "130.3 · PROGRESSIVE" — ใช้จัดกลุ่มแถวใน UI';
