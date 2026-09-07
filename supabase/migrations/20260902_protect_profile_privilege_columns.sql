-- ปิดช่องยกระดับสิทธิ์ตัวเอง — full QC audit 2026-09-02 (Main)
--
-- 🔴 ที่มา: RLS ของ profiles เป็น `auth_update_profiles: using(true) with check(true)`
--    = ผู้ใช้ที่ล็อกอินแล้วคนไหนก็ update แถวไหนก็ได้ · ตัวเดียวที่กันอยู่คือ trigger
--    `protect_profile_role()` ซึ่งกัน **คอลัมน์ `role` คอลัมน์เดียว**
--
--    ตอนเขียน trigger นั้น (ก่อน 2026-08) `role` เป็นคอลัมน์เดียวที่ให้สิทธิ์จริง — ถูกต้อง ณ เวลานั้น
--    แต่หลังจากนั้นโปรเจคเพิ่มแกนสิทธิ์อีก 2 แกนโดยไม่มีใครกลับมาขยาย trigger:
--      • `is_dept_admin` (2026-08-03) — bucket ที่ปลดล็อก action ของ dept_admin
--      • `sections[]` / `section` / `line_id` / `team` / `mtn_teams[]` / `employee_id` — ขอบเขตข้อมูล
--
-- 🧪 พิสูจน์กับฐานจริงแล้ว (สวมบท authenticated ด้วย JWT ของบัญชี role='leader'):
--      role -> admin              ✅ BLOCKED  (trigger เดิมทำงาน)
--      is_dept_admin -> true      🔴 เขียนสำเร็จ  ← ได้ 145 permission ของ bucket dept_admin ทันที
--                                    (four_m:approve_qa · pm:approve · mtn_repair:approve/delete ·
--                                     qa:manage · skills:edit_allowance · oee:set_target ·
--                                     employees:edit_all_sections · *:delete ทั่วระบบ)
--      sections -> [PD1..PD4]     🔴 เขียนสำเร็จ  ← ขยาย scope ตัวเองเห็นทั้งโรงงาน
--      แก้ชื่อ/ตำแหน่ง/ลายเซ็นคนอื่น  🔴 เขียนสำเร็จ 71 แถว (ทุกบัญชีในระบบ)
--
--    ทำได้จาก browser console ด้วย anon key + บัญชีของตัวเอง ไม่ต้องมีสิทธิ์อะไรเป็นพิเศษ
--
-- ⚠️ เหตุผลที่แก้ที่ trigger ไม่ใช่ที่ RLS: RLS จำกัด "รายคอลัมน์" ไม่ได้
--    และ /add-user ต้องให้ admin แก้ role/section/สิทธิ์ของคนอื่นผ่าน client ตรงๆ ต่อไป
--    (column GRANT ก็ใช้ไม่ได้ด้วยเหตุผลเดียวกัน — บันทึกไว้แล้วในกฎ set_my_signature RPC)

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_admin boolean;
begin
  -- ไม่มี JWT = service role / pg_cron / migration (edge function create-user, delete-user)
  -- → ปล่อยผ่าน · หลักเดียวกับ fn_audit ที่แยก "คนกด" ออกจาก "ระบบทำ"
  if auth.uid() is null then
    return new;
  end if;

  v_is_admin := current_user_role() is not distinct from 'admin'::user_role;
  if v_is_admin then
    return new;
  end if;

  -- ① แก้โปรไฟล์ของ "คนอื่น" = admin เท่านั้น
  --    (หน้าเดียวที่แก้ของคนอื่นคือ /add-user ซึ่ง seed ให้ admin เท่านั้นอยู่แล้ว)
  if new.id is distinct from auth.uid() then
    raise exception 'Only admin can edit another user profile';
  end if;

  -- ② คอลัมน์ที่ "ให้สิทธิ์/ขอบเขต" — เจ้าของแถวก็แก้เองไม่ได้
  --    เหลือให้แก้เองได้เฉพาะ full_name / position / signature_url / avatar_url / notify_email
  --    (ลายเซ็น+รูปโปรไฟล์เดินผ่าน RPC set_my_signature/set_my_avatar ตามกฎเดิม ไม่กระทบ)
  if new.role is distinct from old.role then
    raise exception 'Only admin can change a user role';
  end if;
  if new.is_dept_admin is distinct from old.is_dept_admin then
    raise exception 'Only admin can change dept-admin flag';
  end if;
  if new.sections is distinct from old.sections then
    raise exception 'Only admin can change section scope';
  end if;
  if new.section is distinct from old.section then
    raise exception 'Only admin can change section';
  end if;
  if new.line_id is distinct from old.line_id then
    raise exception 'Only admin can change line scope';
  end if;
  if new.team is distinct from old.team then
    raise exception 'Only admin can change team';
  end if;
  if new.mtn_teams is distinct from old.mtn_teams then
    raise exception 'Only admin can change maintenance teams';
  end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception 'Only admin can link a profile to an employee';
  end if;

  return new;
end;
$function$;

comment on function public.protect_profile_role() is
  'กันยกระดับสิทธิ์ตัวเอง: non-admin แก้ได้เฉพาะแถวตัวเอง และเฉพาะคอลัมน์ที่ไม่ให้สิทธิ์/ขอบเขต (audit 2026-09-02)';
