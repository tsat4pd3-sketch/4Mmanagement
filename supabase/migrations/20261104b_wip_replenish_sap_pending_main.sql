-- 2026-11-04 · Main ("MAIN" · ewhdfqwfwofivojtsizn)
-- ใบเบิก-ส่งพาร์ทที่ "ตัดจ่ายใน SAP ไม่ได้" ตอนส่งถึงไลน์ — จดยอดค้างตัดไว้ แล้วตามเคลียร์ในรายงาน (คำสั่ง user)
-- ไม่แตะยอดสต็อกใน ESM (ledger) — เป็นแค่ทะเบียนงานค้างฝั่ง SAP
-- ย้อนได้: alter table public.wip_replenish_requests drop column sap_pending_qty, drop column sap_pending_note,
--          drop column sap_pending_at, drop column sap_pending_by_name, drop column sap_cleared_at, drop column sap_cleared_by_name;
alter table public.wip_replenish_requests
  add column if not exists sap_pending_qty     numeric check (sap_pending_qty is null or sap_pending_qty > 0),
  add column if not exists sap_pending_note    text,
  add column if not exists sap_pending_at      timestamptz,
  add column if not exists sap_pending_by_name text,
  add column if not exists sap_cleared_at      timestamptz,
  add column if not exists sap_cleared_by_name text;
create index if not exists wip_replenish_sap_pending_idx on public.wip_replenish_requests (sap_pending_at)
  where sap_pending_qty is not null and sap_cleared_at is null;
