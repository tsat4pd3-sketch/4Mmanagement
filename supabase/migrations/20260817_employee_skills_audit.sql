-- ============================================================================
-- Audit log การแก้คะแนนทักษะรายคน + คืนสิทธิ์ skills:edit ให้ leader (2026-08-17)
-- ✅ apply แล้ว 2026-08-17 (Main)
--
-- ที่มา: user สั่ง "ให้หัวหน้ากลุ่มทำได้แหละ ยังไงซักมี log ดูย้อนได้ใช่มั้ย"
--   → ตรวจแล้ว **ไม่มี** — `employee_skills` ไม่เคยผูก audit trigger
--     (ลิสต์ใน 20260724_audit_log_main.sql มีแค่ `skill_definitions`/`skill_sub_items`
--      = นิยามสกิล ไม่ใช่คะแนนรายคน)
--   แก้คะแนน 40→90 จึงไม่มีร่องรอยเลยว่าใครแก้ เมื่อไหร่ ค่าเดิมเท่าไหร่
--   → ต้องมี log ก่อน ถึงจะเปิดสิทธิ์ให้กว้างขึ้นได้อย่างรับผิดชอบ
--
-- ⚠️ ทำไมไม่ผูก fn_audit ตัวปกติ (generic) — จะทำ DB บวมเร็วมาก:
--   `employee_skills` ถูกเขียนโดย **job อัตโนมัติทุกวัน** (fn_daily_skill_farm +1 EXP
--   ต่อ (พนักงาน,สกิล) ที่มาทำงาน) → ระดับหลายร้อยแถว/วัน × old_data+new_data jsonb
--   ≈ 100MB/ปี บน free tier 500MB (ตอนนี้ Main ใช้ ~22MB) = เต็มภายในไม่กี่ปี
--   และ log ว่า "cron +1 EXP" ไม่ได้ตอบคำถามที่คนถามจริง ("ใครไปแก้คะแนน")
--
-- → `fn_audit_manual_only()` = log เฉพาะตอนมี auth.uid() (คนกดในแอป)
--   cron/pg_cron ไม่มี JWT → auth.uid() null → ข้าม ไม่เขียน audit
--   ผลพลอยได้ที่ตั้งใจ: ปุ่ม 🔄 รันอัพเดทรายสัปดาห์ใน /operator **ถูก log**
--   (คนกด = มี JWT) ซึ่งถูกต้อง — เป็นการกระทำของคนที่ควรสืบย้อนได้
--
-- ⚠️ ห้ามใช้ `email` หาชื่อผู้แก้ — `public.profiles` **ไม่มีคอลัมน์ email**
--   และระบบนี้ไม่มีการส่งอีเมลเลย (user ยืนยัน · ตรวจแล้วไม่มี provider ใดๆ ในโปรเจค)
--   เคยพลาดจุดนี้จน fn_audit ทั้งระบบไม่บันทึกผู้แก้มาตลอด — ดู 20260817_fix_audit_actor_no_email.sql
--
-- ⚠️ best-effort เหมือน fn_audit เดิม — audit ล้มเหลวห้ามทำ write หลักพัง
--
-- ── คืนสิทธิ์ leader ────────────────────────────────────────────────────────
--   `role_permissions` ตั้ง leader × skills:edit = false มาแต่เดิม แต่ RLS เก่า
--   hardcode role array ที่มี leader อยู่ → หน้างานแก้ได้มาตลอด
--   พอ 20260817_employee_skills_rls_data_driven ทำให้ 2 ฝั่งตรงกัน leader เลยหลุด 17 คน
--   user ยืนยันว่าให้หัวหน้ากลุ่มทำได้ → ตั้ง true ให้ตรงกับการใช้งานจริง
--   (มีผลทั้ง UI และ RLS ทันทีเพราะ policy อ่าน has_perm('skills:edit'))
--
-- ROLLBACK:
--   drop trigger if exists trg_audit_employee_skills on public.employee_skills;
--   update role_permissions set allowed = false
--     where role='leader'::user_role and permission_key='skills:edit';
--   -- แถว audit_log ที่เกิดแล้วปล่อยไว้ได้ (เป็นประวัติ ไม่กระทบ logic)
-- ============================================================================

-- ── trigger เฉพาะการแก้โดยคน (ข้าม cron) ─────────────────────────────────────
create or replace function public.fn_audit_manual_only() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor text; v_uid uuid; v_changed text[];
begin
  begin
    v_uid := auth.uid();
    -- ไม่มี JWT = job อัตโนมัติ (daily/weekly skill farm) → ไม่ log กัน DB บวม
    if v_uid is null then
      if TG_OP = 'DELETE' then return OLD; end if;
      return NEW;
    end if;

    -- ⚠️ profiles ไม่มีคอลัมน์ email — ห้ามใส่กลับมา
    select nullif(btrim(full_name), '') into v_actor from public.profiles where id = v_uid;
    if v_actor is null then v_actor := v_uid::text; end if;  -- ไม่มีชื่อ → uid ยังสืบต่อได้

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

drop trigger if exists trg_audit_employee_skills on public.employee_skills;
create trigger trg_audit_employee_skills
  after insert or update or delete on public.employee_skills
  for each row execute function public.fn_audit_manual_only();

-- index ให้ RPC get_skill_edit_history (เงื่อนไขต้องตรงกับ expression นี้เป๊ะ)
create index if not exists idx_audit_log_skills_emp
  on public.audit_log ((coalesce(new_data,old_data)->>'employee_id'), changed_at desc)
  where table_name = 'employee_skills';

-- ── คืนสิทธิ์แก้คะแนนทักษะให้หัวหน้ากลุ่ม ────────────────────────────────────
insert into public.role_permissions (role, permission_key, allowed)
values ('leader'::user_role, 'skills:edit', true)
on conflict (role, permission_key) do update set allowed = true;
