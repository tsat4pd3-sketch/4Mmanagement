-- ══════════════════════════════════════════════════════════════════════════════
-- Actor UID เฟส 1 (DR project = eyhclzkifitbhbljgoav "Product DB") — 2026-09-16
--
-- ปัญหาที่แก้: ชื่อคนถูกเก็บเป็น text ล้วน ไม่ผูกรหัสอะไรเลย ⇒ คนเดียวกันที่สะกดต่างกัน
--   ถูกนับเป็นคนละคน (เคสจริง: "อภิสิทธิ์ จำปาต้า" (profiles) vs "นายอภิสิทธิ์ จำปาต้น"
--   (mtn_technicians) · "ณัฐภัทร ฐานันต๊ะ" vs "นายณัฐภัทร ถานันต๊ะ") ⇒ ตอบไม่ได้ว่า
--   ฟังก์ชันงานหนึ่งมีคนทำจริงกี่คน และคนคนหนึ่งแตะงานอะไรบ้าง
--
-- แนวทาง: **เพิ่ม uid คู่กับชื่อ ไม่แทนที่ชื่อ** — ชื่อยังเป็น snapshot ที่ UI อ่านเหมือนเดิม
--   (ชื่อ ณ วันที่ทำงาน ต้องไม่เปลี่ยนตามการแก้ profiles ภายหลัง) · uid = คีย์ที่นับ/join ได้
--
-- ⚠️ DR เป็น anon เสมอ (supabaseDR ไม่เคย authenticate) → auth.uid() = null ตลอด
--    uid จึงต้องถูกส่งมาจาก client เหมือนที่ updated_by_name ทำอยู่แล้ว
--    (ผ่าน wrapper supabaseDR.from ใน src/supabaseClient.js — ครอบทุกหน้าในทีเดียว)
--    ⇒ uid นี้ **ไม่ใช่หลักฐานที่ verify ฝั่ง server ได้** เป็นคีย์สำหรับนับ/join เท่านั้น
--       (ข้อจำกัดเดิมของ DR ไม่ได้แย่ลงจาก migration นี้ — ดู known gap ใน CLAUDE.md)
--
-- Backward-compatible: คอลัมน์ใหม่ nullable ทั้งหมด ไม่มี default ไม่แตะ RLS ไม่แตะข้อมูลเดิม
--   โค้ดเก่าที่ยังไม่ส่ง uid ทำงานได้ปกติ (ได้ null) · โค้ดใหม่ที่ส่ง uid ก็ทำงานได้
--
-- Rollback: ดู docs/ROLLBACK_ACTOR_UID.md (drop คอลัมน์ + คืน fn_audit เดิม — อยู่ท้ายไฟล์นี้)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1) เพิ่ม updated_by_uid ให้ตารางชุดเดียวกับ DR_AUDIT_TABLES ใน src/supabaseClient.js ──
--    ⚠️ ลิสต์นี้ต้องตรงกับ DR_AUDIT_TABLES เสมอ — wrapper จะ stamp uid ให้ตารางในลิสต์นั้น
--    ถ้าตารางไหนไม่มีคอลัมน์ write จะพัง (บทเรียนเดียวกับ updated_by_name 2026-07-24)
do $$
declare t text;
  tbls text[] := array[
    'dr_products','kanban_standards','checklists','jig_checkpoints','jigs','pm_plans','machines',
    'dr_defect_types','dr_downtime_types','machine_types','process_types','container_types',
    'mtn_technicians','mtn_spare_parts','mtn_spare_categories','mtn_problem_types','mtn_repair_types',
    'mtn_labor_rates','mtn_item_types',
    'pm_daily_line_targets','pm_facility_areas','pm_checking_methods','pm_checkpoint_categories',
    'ship_to_plants','shipping_workflow_steps','dt_alert_config','stock_inflow_rules','lot_post_configs',
    'kanban_calc_settings','kanban_targets','product_packaging','scrap_defect_types','energy_monthly',
    'machine_automation_levels','machine_operation_modes',
    'die_sets','equipment_die','die_op_types','die_storage_areas','storage_zones','storage_locations',
    'part_routings','quality_bin_records','line_part_levels','line_delivery_points'
  ];
begin
  foreach t in array tbls loop
    if exists (select 1 from information_schema.tables
               where table_schema='public' and table_name=t) then
      execute format('alter table public.%I add column if not exists updated_by_uid uuid', t);
    else
      raise notice 'ข้ามตาราง % (ไม่มีในฐานนี้)', t;
    end if;
  end loop;
end $$;

-- ── 2) audit_log ฝั่ง DR ยังไม่มี actor_uid (ฝั่ง Main มีแล้ว) ──
--    เดิมประวัติฝั่ง DR ผูกกลับไปหา "คน" ไม่ได้เลยแม้แต่รายการเดียว
alter table public.audit_log add column if not exists actor_uid uuid;

create index if not exists idx_audit_log_actor_uid
  on public.audit_log (actor_uid, changed_at desc)
  where actor_uid is not null;

-- ── 3) fn_audit: เก็บ actor_uid ด้วย + ยกเว้น updated_by_uid ตอนเทียบ changed_fields ──
--
-- 🔴 จุดสำคัญที่พลาดไม่ได้: ของเดิมยกเว้นแค่ ('updated_at','updated_by_name')
--    ถ้าไม่เพิ่ม 'updated_by_uid' เข้าไปด้วย ⇒ พอ wrapper เริ่ม stamp uid ทุก UPDATE จะมี
--    คอลัมน์นี้ "เปลี่ยน" เสมอ (null → uid) ⇒ กฎ "UPDATE ที่ไม่มีอะไรเปลี่ยนจริง ไม่ log"
--    พังทันที ⇒ audit_log บวมขึ้นทุกครั้งที่ใครกดเซฟโดยไม่แก้อะไร
--    (audit_log เป็นตารางที่โตเร็วที่สุดของ project นี้อยู่แล้ว — ดู traceability-audit-log.md)
--
-- ส่วนที่เหลือคงพฤติกรรมเดิมทุกอย่าง รวมถึง `exception when others then null`
--   (audit ล้มเหลวห้ามทำให้ write หลักพัง — กฎเหล็กของโปรเจค)
create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor text; v_actor_uid uuid; v_changed text[];
begin
  begin
    v_actor := nullif(current_setting('app.actor', true), '');
    if v_actor is null then
      v_actor := coalesce(to_jsonb(NEW)->>'updated_by_name', to_jsonb(NEW)->>'last_edited_by');
    end if;

    -- uid มาจากแถว (client ส่งมาทาง wrapper) — แถวไหนยังไม่มีคอลัมน์/ค่า ก็ได้ null เฉยๆ
    -- ห่อ cast ไว้เพราะค่าที่ไม่ใช่ uuid ต้องไม่ทำให้ audit ล้ม (best-effort เหมือนเดิม)
    begin
      v_actor_uid := nullif(to_jsonb(NEW)->>'updated_by_uid','')::uuid;
    exception when others then v_actor_uid := null; end;

    if TG_OP = 'UPDATE' then
      select array_agg(key) into v_changed
      from jsonb_each(to_jsonb(NEW))
      where to_jsonb(NEW)->key is distinct from to_jsonb(OLD)->key
        and key not in ('updated_at','updated_by_name','updated_by_uid');
      if v_changed is null then return NEW; end if;
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,changed_fields,old_data,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'UPDATE', v_actor, v_actor_uid, v_changed, to_jsonb(OLD), to_jsonb(NEW));
    elsif TG_OP = 'DELETE' then
      -- DELETE: uid ของ "คนแก้ล่าสุด" ไม่ใช่คนลบ (ข้อจำกัดเดิม ยอมรับไว้แล้ว)
      begin
        v_actor_uid := nullif(to_jsonb(OLD)->>'updated_by_uid','')::uuid;
      exception when others then v_actor_uid := null; end;
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,old_data)
      values (TG_TABLE_NAME, to_jsonb(OLD)->>'id', 'DELETE', v_actor, v_actor_uid, to_jsonb(OLD));
    else
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'INSERT', v_actor, v_actor_uid, to_jsonb(NEW));
    end if;
  exception when others then null; end;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $function$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (คัดลอกไปรันถ้าต้องถอย — ลำดับ: revert โค้ดก่อน แล้วค่อยรันอันนี้)
--
--   1. revert โค้ดฝั่ง client ก่อน (ไม่งั้น wrapper ยัง stamp uid ให้คอลัมน์ที่ถูก drop = write พัง)
--   2. คืน fn_audit เดิม (ไม่มี actor_uid + ยกเว้นแค่ updated_at/updated_by_name)
--   3. drop คอลัมน์ (ไม่จำเป็นต้องทำ — คอลัมน์ nullable ที่ไม่มีใครเขียนไม่รบกวนอะไร
--      แนะนำให้ปล่อยไว้ ปลอดภัยกว่า drop)
-- ══════════════════════════════════════════════════════════════════════════════
