-- MAIN (ewhdfqwfwofivojtsizn) · DB audit 05/10 set A1 · คำสั่ง user 06/10 "ทำ A ได้"
-- ผูก fn_audit ให้ 4 ตารางที่ไม่มีร่องรอยการแก้/ลบเลย
--   เหตุ: cqi15_event_logs = 0 แถว ทั้งที่ notifications อ้างถึง (ถูกลบโดยไม่มีร่องรอย) ·
--         four_m_logs เขียนได้ทุก authenticated แต่ไม่มี audit · meeting_action_items ยังไม่มี
-- ปลอดภัย: fn_audit มี `exception when others then null` — audit ล้มไม่ทำให้ write หลักพัง
-- rollback: drop trigger if exists trg_audit on public.<table>;
drop trigger if exists trg_audit on public.cqi15_event_logs;
create trigger trg_audit after insert or update or delete on public.cqi15_event_logs
  for each row execute function public.fn_audit();
drop trigger if exists trg_audit on public.cqi15_event_approvals;
create trigger trg_audit after insert or update or delete on public.cqi15_event_approvals
  for each row execute function public.fn_audit();
drop trigger if exists trg_audit on public.four_m_logs;
create trigger trg_audit after insert or update or delete on public.four_m_logs
  for each row execute function public.fn_audit();
drop trigger if exists trg_audit on public.meeting_action_items;
create trigger trg_audit after insert or update or delete on public.meeting_action_items
  for each row execute function public.fn_audit();
