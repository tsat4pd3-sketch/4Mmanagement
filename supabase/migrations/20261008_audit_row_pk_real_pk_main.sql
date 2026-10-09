-- ═══ audit_log.row_pk — ตารางที่ PK ไม่ใช่ `id` เคยบันทึกเป็น NULL = สืบไม่ได้ว่าแถวไหน ═══
-- Main project (ewhdfqwfwofivojtsizn) · 2026-10-08
--
-- เจอตอนไล่ว่า "06/10 ใครลบ cost center รหัสไหนไปบ้าง": `audit_log` มีแถว DELETE ครบ 31 แถว
-- แต่ `row_pk` เป็น NULL ทั้งหมด ต้องแกะจาก `old_data->>'code'` เอง
-- เหตุ: `fn_audit()` ตรึงว่า row_pk = to_jsonb(NEW/OLD)->>'id' ⇒ ตารางที่ PK เป็นคอลัมน์อื่นได้ NULL
-- วัดจริง (ก่อนแก้): 717 แถว 4 ตาราง — notification_rules(event_key) 370 ·
--   permission_catalog(resource,action) 213 · cost_centers(code) 132 · company_calendar(work_date) 2
--
-- กฎที่ขัด: "ห้ามล้มเหลวเงียบ" + Traceability = ต้องตอบได้ว่า "ใครแก้ **แถวไหน**"
--
-- blast radius: fn_audit ผูกกับตารางที่ audit ทั้งระบบ — การแก้นี้ **ไม่เปลี่ยนพฤติกรรมของตารางที่มี `id`**
--   (ยังใช้ ->>'id' ก่อนเสมอ · ตก null เมื่อไหร่จึงไปอ่าน PK จริงจาก pg_catalog)
--   PK หลายคอลัมน์ = ต่อด้วย '|' ตามลำดับคอลัมน์ใน PK
--
-- rollback: create or replace fn_audit() กลับเป็นรุ่นเดิม (ใช้ ->>'id' ล้วน) แล้ว
--   update public.audit_log set row_pk = null where table_name in
--     ('notification_rules','permission_catalog','cost_centers','company_calendar');

create or replace function public.fn_audit_pk(p_relid oid, p_row jsonb)
returns text language sql stable security definer set search_path to 'public' as $$
  select nullif(string_agg(p_row->>a.attname, '|' order by k.ord), '')
    from pg_index i
    cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = p_relid and i.indisprimary;
$$;
comment on function public.fn_audit_pk(oid, jsonb) is
  'row_pk ของ audit_log จาก PK จริงของตาราง (หลายคอลัมน์ต่อด้วย |) — ใช้เมื่อตารางไม่มีคอลัมน์ id';

create or replace function public.fn_audit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor text; v_uid uuid; v_changed text[]; v_pk text;
begin
  begin
    v_uid := auth.uid();
    if v_uid is not null then
      select nullif(btrim(full_name), '') into v_actor from public.profiles where id = v_uid;
      if v_actor is null then v_actor := v_uid::text; end if;  -- ไม่มีชื่อ/ไม่มีแถว → uid ยังสืบต่อได้
    end if;
    if v_actor is null then v_actor := nullif(current_setting('app.actor', true), ''); end if;

    if TG_OP = 'UPDATE' then
      select array_agg(key) into v_changed
      from jsonb_each(to_jsonb(NEW))
      where to_jsonb(NEW)->key is distinct from to_jsonb(OLD)->key
        and key <> 'updated_at';
      if v_changed is null then return NEW; end if;
      -- ⚠️ ->>'id' ต้องมาก่อนเสมอ (ตารางส่วนใหญ่ของระบบ) · ตก null = ตารางที่ PK เป็นคอลัมน์อื่น
      v_pk := coalesce(to_jsonb(NEW)->>'id', public.fn_audit_pk(TG_RELID, to_jsonb(NEW)));
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,changed_fields,old_data,new_data)
      values (TG_TABLE_NAME, v_pk, 'UPDATE', v_actor, v_uid, v_changed, to_jsonb(OLD), to_jsonb(NEW));
    elsif TG_OP = 'DELETE' then
      v_pk := coalesce(to_jsonb(OLD)->>'id', public.fn_audit_pk(TG_RELID, to_jsonb(OLD)));
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,old_data)
      values (TG_TABLE_NAME, v_pk, 'DELETE', v_actor, v_uid, to_jsonb(OLD));
    else
      v_pk := coalesce(to_jsonb(NEW)->>'id', public.fn_audit_pk(TG_RELID, to_jsonb(NEW)));
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,new_data)
      values (TG_TABLE_NAME, v_pk, 'INSERT', v_actor, v_uid, to_jsonb(NEW));
    end if;
  exception when others then
    null;  -- ⚠️ audit ล้มเหลวห้ามทำ write หลักพัง
  end;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $function$;

-- backfill แถวเก่า — ใช้ฟังก์ชันเดียวกัน รูปแบบจึงตรงกับของใหม่ · ตารางที่ถูก drop ไปแล้วข้าม (to_regclass null)
update public.audit_log a
   set row_pk = public.fn_audit_pk(to_regclass('public.' || a.table_name), coalesce(a.new_data, a.old_data))
 where a.row_pk is null
   and to_regclass('public.' || a.table_name) is not null;

-- ตรวจผล: select table_name, count(*) from public.audit_log where row_pk is null group by 1;  -- ควรเหลือ 0 แถว
