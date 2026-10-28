/* 🔐 ปิดรู: `profiles.resp_cost_centers` ไม่ได้อยู่ในรายการคอลัมน์ที่ `protect_profile_role()` กัน
   (QC audit 2026-10-20 · Main project "MAIN" ewhdfqwfwofivojtsizn)

   คอลัมน์นี้เพิ่มมา 16/10 (`20261016_profiles_resp_cost_centers_main.sql`) เป็น **แกนที่ 2 ของชั้นสิทธิ์ ③**
   (`utils/ccScope.js` · `canWriteScope` — "แก้ของหน่วยไหนได้บ้าง") แต่ไม่มีใครเติมเข้ารายการใน trigger
   ⇒ เจ้าของแถวยิง `PATCH /profiles?id=eq.<ตัวเอง>` ตั้งขอบเขตที่ตัวเองแก้ได้ ให้ตัวเองได้

   🔴 คลาสเดียวกับที่ migration 12/10 เขียนเตือนไว้เองในบล็อก ③:
      *"คอลัมน์ที่เพิ่มมาหลังเขียน trigger นี้ แล้วไม่มีใครเติมเข้ารายการ"* — เกิดซ้ำรอบที่ 2
      ⇒ รอบนี้เพิ่มด่านฝั่งเทสด้วย (`cc-scope-layer` ตรวจว่าชื่อคอลัมน์นี้อยู่ใน trigger)

   เปลี่ยนอะไร: `create or replace` ฟังก์ชันเดิม **เติมบล็อกเดียว** (ไม่แตะ trigger ที่ผูกอยู่
   ไม่แตะคอลัมน์ ไม่แตะ policy) · admin / service-role (auth.uid() is null) ยังผ่านเหมือนเดิมทุกทาง

   ย้อนกลับ: รัน `create or replace` ตัวเดิมโดยตัดบล็อก `resp_cost_centers` ออก
             (ของเดิมอยู่ใน `20261012_rls_round5_anon_scope_masters_main.sql`)

   ตรวจผล:
     select pg_get_functiondef(p.oid) ilike '%resp_cost_centers%' as protected
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'protect_profile_role';
     -- ต้องได้ protected = true
*/
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
  if auth.uid() is null then
    return new;
  end if;

  v_is_admin := current_user_role() is not distinct from 'admin'::user_role;
  if v_is_admin then
    return new;
  end if;

  -- ① แก้โปรไฟล์ของ "คนอื่น" = admin เท่านั้น
  if new.id is distinct from auth.uid() then
    raise exception 'Only admin can edit another user profile';
  end if;

  -- ② คอลัมน์ที่ให้สิทธิ์/ขอบเขต — เจ้าของแถวก็แก้เองไม่ได้
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

  /* ③ คอลัมน์ที่เพิ่มมาหลังเขียน trigger นี้ แล้วไม่มีใครเติมเข้ารายการ (QC audit รอบ 5 · 2026-10-12)
     🔴 `scope_depth` คือ "ตัวตัดสินขอบเขต" ตัวจริงตั้งแต่ 25/09 (effectiveSections ข้อ scope_depth)
        ⇒ ตั้งเป็น 'all' เองได้ = ปลดขอบเขตตัวเองทุกจอ ทั้งที่ trigger นี้ตั้งใจกันเรื่องนี้ไว้แล้ว
     · ทั้ง 4 คอลัมน์เขียนจาก /add-user (จอ admin) ที่เดียว — ไม่มี self-service ไหนแตะ
       (ลายเซ็น/รูป ไปทาง RPC set_my_signature / set_my_avatar) */
  if new.scope_depth is distinct from old.scope_depth then
    raise exception 'Only admin can change scope depth';
  end if;
  if new.scope_depth_src is distinct from old.scope_depth_src then
    raise exception 'Only admin can change scope-depth source';
  end if;
  if new.account_kind is distinct from old.account_kind then
    raise exception 'Only admin can change account kind';
  end if;
  if new.org_node_id is distinct from old.org_node_id then
    raise exception 'Only admin can change org affiliation';
  end if;

  /* ④ แกนที่ 2 ของชั้นสิทธิ์ ③ — Cost Center ที่รับผิดชอบ (เพิ่ม 2026-10-20 · QC audit)
     ตั้งที่ /add-user ช่อง ④ (จอ admin) ที่เดียวเหมือนกลุ่ม ③ · ว่าง = ถอยไปใช้ section
     ⇒ ปล่อยให้เจ้าของแถวแก้เอง = ตั้งขอบเขตที่ตัวเองแก้ได้ให้ตัวเอง */
  if new.resp_cost_centers is distinct from old.resp_cost_centers then
    raise exception 'Only admin can change responsible cost centers';
  end if;

  return new;
end;
$function$;
