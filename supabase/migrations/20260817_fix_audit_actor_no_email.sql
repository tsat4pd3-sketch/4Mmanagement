-- ============================================================================
-- 🔴 แก้ audit_log ไม่เคยบันทึก "ใครแก้" เลยตั้งแต่วันแรก + RPC อ่านประวัติสกิล
-- (2026-08-17) ✅ apply แล้ว (Main)
--
-- ── อาการที่พบ ──────────────────────────────────────────────────────────────
--   audit_log 2,234 แถว จาก 15 ตาราง แต่ **actor = null ทั้งหมด · actor_uid = null ทั้งหมด**
--   → ระบบ traceability ที่สร้างไว้ตอบได้แค่ "อะไรเปลี่ยน" ตอบ "ใครเปลี่ยน" ไม่ได้เลย
--     ซึ่งเป็นคำถามหลักที่มันถูกสร้างมาเพื่อตอบ
--
-- ── สาเหตุ ─────────────────────────────────────────────────────────────────
--   `fn_audit` อ่าน `select coalesce(full_name, email) from public.profiles`
--   แต่ **public.profiles ไม่มีคอลัมน์ email**
--   (คอลัมน์จริง: id, full_name, role, line_id, section, team, signature_url,
--    notify_email, sections, position, avatar_url, mtn_teams, updated_at, is_dept_admin)
--   → error 42703 ทุกครั้งที่เข้าบรรทัดนั้น
--   → บรรทัดนั้นถูกเรียก **เฉพาะเมื่อ auth.uid() is not null** = "คนล็อกอินเป็นคนแก้"
--   → error โดน `exception when others then null` (กฎ best-effort) กลืน = ไม่ log ทั้งแถว
--   ⇒ การแก้โดยคนจริง **ไม่เคยถูกบันทึกสักครั้ง**
--     แถวที่ log สำเร็จ 2,234 แถว คือการเขียนที่ auth.uid() เป็น null
--     (migration / service role) ซึ่งข้ามบรรทัดนั้นไป จึงได้ actor ว่างเปล่า
--
-- ── บทเรียน (สำคัญกว่าตัวบั๊ก) ───────────────────────────────────────────────
--   `exception when others then null` จำเป็นจริง (audit ห้ามทำ write หลักพัง)
--   แต่มันทำให้บั๊กแบบนี้เงียบได้เป็นเดือนโดยไม่มีสัญญาณใดๆ
--   → **เทส audit ต้องเทสด้วย auth.uid() ที่ไม่ null เสมอ** ไม่ใช่แค่รัน SQL ด้วย service role
--     (service role = auth.uid() null = เดินคนละ path กับผู้ใช้จริง แล้วผ่านหมด)
--   → วิธีเทส: set_config('request.jwt.claims', json_build_object('sub', <uid>)::text, false)
--     แล้ว update จริง 1 แถว → เช็คว่า audit_log ได้แถวที่ actor ไม่ null
--
-- ── การแก้ ─────────────────────────────────────────────────────────────────
--   actor = full_name → ถ้าว่าง/ไม่มีแถว ใช้ uid (อ่านไม่สวยแต่ join สืบต่อได้)
--   **ไม่ใช้ email ใดๆ ทั้งสิ้น** — user ยืนยัน "เราไม่ได้มีระบบ email"
--   ตรวจแล้วจริง: ไม่มี provider ส่งเมลในโปรเจคเลย (resend/sendgrid/smtp/nodemailer = 0 จุด)
--   แจ้งเตือนทั้งหมดไป Telegram + in-app notifications + Web Push
--   (`profiles.notify_email` เก็บค่าไว้เฉยๆ ไม่เคยถูกใช้ส่งอะไร — ห้ามเอามาเป็นตัวระบุตัวตน)
--
-- ⚠️ แถวเก่า 2,234 แถวยังคง actor = null — กู้ไม่ได้ (ไม่มีข้อมูลต้นทางเก็บไว้ที่ไหนเลย)
--    ของใหม่ตั้งแต่ apply เป็นต้นไปจะมีชื่อผู้แก้ครบ
--
-- ROLLBACK: ไม่แนะนำ (= ปิดการบันทึกผู้แก้กลับไปเหมือนเดิม)
--   ถ้าจำเป็นจริง: create or replace fn_audit กลับเป็นเวอร์ชันใน 20260724_audit_log_main.sql
-- ============================================================================

create or replace function public.fn_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor text; v_uid uuid; v_changed text[];
begin
  begin
    v_uid := auth.uid();
    if v_uid is not null then
      -- ⚠️ profiles ไม่มีคอลัมน์ email — ห้ามใส่กลับมา (บั๊กเดิมที่ทำให้ไม่เคย log ผู้แก้)
      select nullif(btrim(full_name), '') into v_actor from public.profiles where id = v_uid;
      if v_actor is null then v_actor := v_uid::text; end if;
    end if;
    if v_actor is null then v_actor := nullif(current_setting('app.actor', true), ''); end if;

    if TG_OP = 'UPDATE' then
      select array_agg(key) into v_changed
      from jsonb_each(to_jsonb(NEW))
      where to_jsonb(NEW)->key is distinct from to_jsonb(OLD)->key
        and key <> 'updated_at';
      if v_changed is null then return NEW; end if;
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,changed_fields,old_data,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'UPDATE', v_actor, v_uid, v_changed, to_jsonb(OLD), to_jsonb(NEW));
    elsif TG_OP = 'DELETE' then
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,old_data)
      values (TG_TABLE_NAME, to_jsonb(OLD)->>'id', 'DELETE', v_actor, v_uid, to_jsonb(OLD));
    else
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'INSERT', v_actor, v_uid, to_jsonb(NEW));
    end if;
  exception when others then
    null;  -- ⚠️ audit ล้มเหลวห้ามทำ write หลักพัง
  end;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

-- ── RPC อ่านประวัติการแก้คะแนนทักษะของพนักงาน 1 คน ────────────────────────────
-- ใช้แทนการ filter jsonb ผ่าน PostgREST `.or()` ฝั่ง client เพราะ
--   (1) เงื่อนไขตรงกับ expression index `idx_audit_log_skills_emp` เป๊ะ → ใช้ index ได้จริง
--   (2) รูปร่าง jsonb ของ audit_log เป็นเรื่องของ DB ไม่ต้องให้ client รู้
-- ⚠️ SECURITY INVOKER (default) โดยตั้งใจ → RLS ของ audit_log ยังบังคับใช้
--    (policy audit_log_read = authenticated เท่านั้น) **ห้ามเปลี่ยนเป็น DEFINER**
create or replace function public.get_skill_edit_history(
  p_employee_id uuid,
  p_limit int default 30
)
returns table (
  action         text,
  actor          text,
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb,
  changed_at     timestamptz
)
language sql
stable
set search_path = public
as $$
  select a.action, a.actor, a.changed_fields, a.old_data, a.new_data, a.changed_at
    from public.audit_log a
   where a.table_name = 'employee_skills'
     and coalesce(a.new_data, a.old_data)->>'employee_id' = p_employee_id::text
   order by a.changed_at desc
   limit least(coalesce(p_limit, 30), 200)
$$;

revoke all on function public.get_skill_edit_history(uuid, int) from public, anon;
grant execute on function public.get_skill_edit_history(uuid, int) to authenticated;
