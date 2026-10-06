-- DR / Product DB (eyhclzkifitbhbljgoav) · DB audit 05/10 set A4 · คำสั่ง user 06/10 "ทำ A ได้"
-- index สำหรับคิวรีที่ช้าที่สุด (pg_stat_statements 05/10):
--   prod_orders + production_sessions!inner กรอง line_name+work_date = 148 ms × 20.4k ครั้ง
--   inspection_results: 5,191 seq scan · 0 index scan (FK ไม่มี index)
-- CONCURRENTLY = ไม่ล็อกตารางระหว่างสร้าง (ต้องรันทีละคำสั่ง นอก transaction)
-- rollback: drop index concurrently if exists public.<ชื่อ>;
create index concurrently if not exists idx_sessions_line_date on public.production_sessions (line_name, work_date);
create index concurrently if not exists idx_po_mat on public.prod_orders (mat_no);
create index concurrently if not exists idx_ir_inspection on public.inspection_results (inspection_id);
create index concurrently if not exists idx_ir_checkpoint on public.inspection_results (checkpoint_id);
