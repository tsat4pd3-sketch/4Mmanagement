-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 🛡️ ห้ามลบสกิลที่ยังมีคะแนนพนักงาน (Main · MAIN · ewhdfqwfwofivojtsizn)
--    user 25/11: "ทำด่านกันลบสกิลที่ยังมีคะแนนด้วย" — หลังเจอคะแนนค้าง 22 รหัสที่นิยามสกิลหายไป
--    (20261125_delete_orphan_skill_scores.sql) · การ์ดขึ้นเป็นรหัส skill_xxxxxxxxxx
--
--    ด่านฝั่ง DB (ไม่ขึ้นกับจอ — ลบจากที่ไหนก็โดน): BEFORE DELETE บน skill_definitions
--    · ยังมีแถว employee_skills ที่ skill_name = นิยามนี้ ⇒ raise (ไม่ลบอะไรเลย)
--    · จอ /operator (handleDeleteSkill) นับก่อนแล้วบอกเป็นภาษาคน · เลิกลบคะแนนพ่วงแล้ว
--    วัด 25/11: นิยาม 108 ตัว · มีคะแนน 102 (ลบไม่ได้แล้ว) · ลบได้ 6
--    ✅ apply แล้ว 25/11 ผ่าน MCP · ทดสอบ (rollback): สกิลมีคะแนน "Rivet/Bolt" 98 แถว = ถูกบล็อก · สกิลไม่มีคะแนน = ลบได้
--    ย้อน:
--      drop trigger if exists trg_skill_def_delete_guard on public.skill_definitions;
--      drop function if exists public.skill_def_delete_guard();
-- ═══════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.skill_def_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  select count(*) into n from public.employee_skills where skill_name = old.name;
  if n > 0 then
    raise exception 'ลบสกิล "%" ไม่ได้ — ยังมีคะแนนของพนักงาน % แถว (ลบได้เฉพาะสกิลที่ยังไม่มีใครมีคะแนน)',
      coalesce(old.label, old.name), n
      using errcode = 'P0001';
  end if;
  return old;
end
$$;

drop trigger if exists trg_skill_def_delete_guard on public.skill_definitions;
create trigger trg_skill_def_delete_guard
  before delete on public.skill_definitions
  for each row execute function public.skill_def_delete_guard();
