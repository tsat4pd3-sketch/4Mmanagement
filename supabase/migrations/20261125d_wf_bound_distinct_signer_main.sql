-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ✍️ ใบรอบเอกสาร: 1 คนเซ็นได้ขั้นเดียวต่อใบ · project: MAIN (ewhdfqwfwofivojtsizn · จอ Supabase "MAIN")
-- 2026-11-25 · คำสั่ง user (ตอบคำถาม): "กัน — 1 คนเซ็นได้ขั้นเดียวต่อใบ"
--   เหตุ: BBS ผู้ถือ bbs:record รวม supervisor ⇒ คนเดียวเซ็น "ออกโดย" แล้ว "ตรวจสอบโดย" ต่อเองได้
--   (มาตรฐานคุมเอกสาร: ออก/ตรวจ/อนุมัติ คนละคน)
-- ขอบเขต: **ใบรอบเอกสารเท่านั้น** (`subject_key` ไม่ว่าง) — ใบฟอร์มทั่วไปเหมือนเดิมเป๊ะ
-- วิธี: ตอนเปิดขั้นถัดไป ตัดคนที่ "อนุมัติ/รับทราบขั้นก่อนหน้าของใบนี้แล้ว" ออกจากผู้รับงาน
--       ตัดแล้วไม่เหลือใคร = ใบค้าง + blocked_reason (fail-closed · ห้ามข้ามขั้น)
-- ↩️ ROLLBACK: รัน wf_open_step ตัวเดิม (ด้านล่างคอมเมนต์ "ของเดิม") ใน SQL Editor MAIN
-- ═══════════════════════════════════════════════════════════════════════════════════════
create or replace function public.wf_open_step(p_instance uuid)
returns uuid[] language plpgsql security definer set search_path to 'public' as $function$
declare i wf_instances%rowtype; st jsonb; res jsonb; uids uuid[]; n_before int;
begin
  select * into i from wf_instances where id = p_instance;
  select v.flow_schema->'steps'->i.current_step into st from wf_versions v where v.id = i.version_id;
  res := wf_resolve(p_instance, st);
  select array_agg(x::uuid) into uids from jsonb_array_elements_text(res->'uids') x;
  if uids is not null and i.subject_key is not null then
    n_before := array_length(uids, 1);
    select array_agg(u) into uids from unnest(uids) u
     where not exists (select 1 from wf_actions a where a.instance_id = p_instance and a.action = 'approve' and a.actor_id = u);
    if uids is null then
      res := jsonb_set(res, '{reason}', to_jsonb(format('ผู้มีสิทธิ์ขั้น "%s" ทั้ง %s คน เซ็นขั้นก่อนหน้าของใบนี้ไปแล้ว (1 คนเซ็นได้ขั้นเดียวต่อใบ)',
                                                        coalesce(st->>'label', st->>'key'), n_before)));
    end if;
  end if;
  if uids is null then
    update wf_instances set blocked_reason = coalesce(res->>'reason', 'หาผู้อนุมัติไม่ได้') where id = p_instance;
    return '{}';
  end if;
  insert into wf_tasks (instance_id, step_index, step_key, assignee_id, via)
  select p_instance, i.current_step, coalesce(st->>'key', 's' || i.current_step), u, res->>'via' from unnest(uids) u;
  update wf_instances set blocked_reason = null where id = p_instance;
  return uids;
end $function$;
revoke all on function public.wf_open_step(uuid) from public, anon, authenticated;

-- ของเดิม (ก่อน 25/11):
-- create or replace function public.wf_open_step(p_instance uuid) returns uuid[] language plpgsql security definer set search_path to 'public' as $function$
-- declare i wf_instances%rowtype; st jsonb; res jsonb; uids uuid[];
-- begin
--   select * into i from wf_instances where id = p_instance;
--   select v.flow_schema->'steps'->i.current_step into st from wf_versions v where v.id = i.version_id;
--   res := wf_resolve(p_instance, st);
--   select array_agg(x::uuid) into uids from jsonb_array_elements_text(res->'uids') x;
--   if uids is null then
--     update wf_instances set blocked_reason = coalesce(res->>'reason', 'หาผู้อนุมัติไม่ได้') where id = p_instance;
--     return '{}';
--   end if;
--   insert into wf_tasks (instance_id, step_index, step_key, assignee_id, via)
--   select p_instance, i.current_step, coalesce(st->>'key', 's' || i.current_step), u, res->>'via' from unnest(uids) u;
--   update wf_instances set blocked_reason = null where id = p_instance;
--   return uids;
-- end $function$;

-- ── ตรวจผล ──
-- select prosrc like '%เซ็นได้ขั้นเดียวต่อใบ%' from pg_proc where proname = 'wf_open_step';
