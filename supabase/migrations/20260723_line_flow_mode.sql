-- โหมดการไหลงานของไลน์ (2026-07-23) · Main project (production_lines)
-- one_piece_flow = สายเดียวไหลทีละชิ้น (บอร์ด Heijunka เรียงคิว 1 ใบต่อครั้ง — ค่าเดิม/ดีฟอลต์)
-- parallel_machine = เครื่อง stand-alone หลายตัวในไลน์ วิ่งพร้อมกันคนละรายการ (บอร์ดแตกเป็น N เลนขนาน)
-- parallel_stations = จำนวนเครื่องขนาน (null = นับจากทะเบียน machines ของไลน์ฝั่ง DR)
alter table public.production_lines
  add column if not exists flow_mode        text default 'one_piece_flow',
  add column if not exists parallel_stations integer;

comment on column public.production_lines.flow_mode is
  'one_piece_flow (เรียงคิวทีละใบ) | parallel_machine (N เครื่องวิ่งขนาน) — บอร์ด Heijunka ใช้จัดเลน';
