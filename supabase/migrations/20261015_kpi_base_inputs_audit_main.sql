-- 💰 kpi_base_inputs เริ่มใช้งานจริง 15/10 (แผงตัวเลขฐานจากบัญชี/SAP ในแท็บ ⚙️ KPI) — ผูก audit ให้เหมือนตาราง kpi_* ตัวอื่น     (Main · ewhdfqwfwofivojtsizn)
-- (ตารางสร้างไว้ตั้งแต่ 20260916 แต่ไม่มี trigger audit · RLS มีแล้ว: อ่านทุกคน · เขียน has_perm('kpi:manage') · ชั้น ③ ขอบเขต = ฝั่งจอ writeScope)
drop trigger if exists trg_audit on public.kpi_base_inputs;
create trigger trg_audit after insert or update or delete on public.kpi_base_inputs
  for each row execute function public.fn_audit();
-- ตรวจผล: select tgname from pg_trigger where tgrelid = 'public.kpi_base_inputs'::regclass and not tgisinternal;
-- ROLLBACK: drop trigger if exists trg_audit on public.kpi_base_inputs;
