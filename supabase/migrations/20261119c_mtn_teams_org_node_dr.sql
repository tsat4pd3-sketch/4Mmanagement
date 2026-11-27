-- ════════════════════════════════════════════════════════════════════════════
-- ทีมช่าง ↔ หน่วยในผังองค์กร (19/11 · ใบ PM ขั้น ③ · คำสั่ง user)
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav)
--
-- ขั้น ③ "ผจก.ส่วนของผู้ตรวจ อนุมัติรายเดือน" ต้องรู้ว่าทีมช่างเป็นหน่วยไหนในผัง (Main `org_nodes`)
-- เพื่อหา head/acting จาก `org_assignments` — เดิมผูกกันได้แค่ด้วยชื่อ (`dept_name` 'MTN' ≠ โหนด 'Maintenance')
-- ⇒ เก็บ id โหนดตรงๆ (ข้าม project ผูก FK ไม่ได้ · ว่าง = จอเขียนว่า "ทีมยังไม่ผูกผัง" ไม่เดา)
-- ไม่แตะ RLS · ย้อนได้: alter table public.mtn_teams drop column if exists org_node_id;
-- ════════════════════════════════════════════════════════════════════════════
alter table public.mtn_teams add column if not exists org_node_id uuid;
comment on column public.mtn_teams.org_node_id is
  'id ของ org_nodes (Main) ที่เป็นหน่วยของทีมนี้ — ใช้หาผู้มีสิทธิ์อนุมัติใบ PM รายเดือน (utils/pmMonthly.js) · ว่าง = ยังไม่ผูก';

update public.mtn_teams set org_node_id = 'f3d4de11-3245-48b6-8b78-d3586dddba1e' where key = 'maintenance'     and org_node_id is null; -- Maintenance (section)
update public.mtn_teams set org_node_id = '298ae0f1-bbfa-4b2a-9efd-84cbc6937a7d' where key = 'jig_maintenance' and org_node_id is null; -- JIG MTN (ใต้ PD4)
update public.mtn_teams set org_node_id = '8c493adf-beed-47e1-8721-72b0faf9cbd1' where key = 'die_maintenance' and org_node_id is null; -- Die MTN (ใต้ Tooling MTN)

-- ตรวจผล: select key, label, org_node_id from public.mtn_teams order by sort_order;
