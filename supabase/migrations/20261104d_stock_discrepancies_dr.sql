-- 2026-11-04 · DR ("Product DB" · eyhclzkifitbhbljgoav)
-- ยอด "รับไม่ครบ" ต้องไม่หาย (คำสั่ง user: "ต้องไม่หาย เป็น report transaction ที่มีปัญหา ไว้เพื่อสรุปรายเดือน
--   แก้ไขกันระหว่างผลิตกับสโตร์ ชนกันใน SAP")
-- · ตอนไลน์รับไม่ครบ: ส่วนที่ขาดย้ายจากไลน์ → คลังพัก 'ผลต่างรอเคลียร์' (ledger) + ทะเบียนเคสตารางนี้
-- · เคลียร์ = คืน STORE หรือ ตัดหาย (ledger ออกจากคลังพัก) + เก็บผู้เคลียร์/เลข SAP
-- · 🔴 ยืนยันคู่ (user 05/11 "ยืนยันคู่"): ฝ่ายหนึ่งเสนอผล (status=proposed) → อีกฝ่าย (คนละคน คนละฝ่าย) ยืนยัน
--   แล้วจึงขยับ ledger · ฝ่าย = 'store' (heijunka:operate) / 'line' (wip_request:receive) · ตัดสินที่ utils/stockDiscrepancy.js
-- ย้อนได้: drop table public.stock_discrepancies; (ledger ในคลังพักลบด้วย note like 'ผลต่าง:%')
create table if not exists public.stock_discrepancies (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  source        text not null check (source in ('wip_request', 'kanban_round', 'backfill')),
  ref_id        text,                       -- id ใบเบิก WIP (Main) / kanban_deliveries / ใบเดิม
  line_name     text not null,
  mat_no        text not null,
  part_name     text,
  sent_qty      numeric,
  received_qty  numeric,
  short_qty     numeric not null check (short_qty > 0),
  work_date     date not null,
  reported_by   text,
  note          text,
  status        text not null default 'open' check (status in ('open', 'proposed', 'returned', 'written_off')),
  proposed_outcome text check (proposed_outcome in ('returned', 'written_off')),
  proposed_by   text,
  proposed_side text check (proposed_side in ('store', 'line')),
  proposed_at   timestamptz,
  confirmed_by  text,
  confirmed_side text check (confirmed_side in ('store', 'line')),
  resolved_at   timestamptz,
  resolved_by   text,
  resolve_note  text,
  sap_doc       text
);
create index if not exists stock_discrepancies_open_idx on public.stock_discrepancies (work_date) where status in ('open', 'proposed');
create index if not exists stock_discrepancies_month_idx on public.stock_discrepancies (work_date);

alter table public.stock_discrepancies enable row level security;
-- 🔴 DR = role anon เสมอ — ห้ามเปลี่ยนเป็น TO authenticated
drop policy if exists stock_discrepancies_all on public.stock_discrepancies;
create policy stock_discrepancies_all on public.stock_discrepancies for all to public using (true) with check (true);
grant select, insert, update on public.stock_discrepancies to anon, authenticated;   -- ไม่ให้ delete (ประวัติห้ามหาย)

-- audit (ใครเคลียร์/แก้อะไร)
drop trigger if exists trg_audit on public.stock_discrepancies;
create trigger trg_audit after insert or update or delete on public.stock_discrepancies
  for each row execute function public.fn_audit();
