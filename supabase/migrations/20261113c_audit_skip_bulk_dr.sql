-- ════════════════════════════════════════════════════════════════════════════
-- หยุด audit "การนำเข้าเป็นชุด" — เก็บสรุป 1 แถว แทน N แถว
-- DR ("Product DB" · eyhclzkifitbhbljgoav)                             2026-11-13
--
-- ⏳🔴 **ยังไม่ได้ apply** (13/11 · รออนุมัติจาก user) — เช็คของจริงก่อนเชื่อไฟล์นี้:
--      select to_regprocedure('public.fn_monitoring_orders_replace(jsonb,text)') is not null;
--   ⇒ `src/components/MonitoringUpload.jsx` **ยังเป็นของเดิม (delete + insert แยกคำขอ)**
--     apply เสร็จเมื่อไหร่ ต้องตามไปสลับหน้านั้นให้เรียก RPC ในคอมมิทเดียวกัน
--
-- ที่มา: `customer_shipping_orders` = **28.2% ของ audit_log ทั้งตาราง**
--   (INSERT 17,640 ≈ DELETE 14,933 — เกือบเท่ากัน = ลบทั้งชุดแล้วเขียนใหม่)
--   ต้นตอ: `src/components/MonitoringUpload.jsx` อัปโหลดไฟล์ Monitoring แล้วทำ
--     ① `.delete().eq('source','monitoring').eq('status','pending')`   ← ลบทั้งชุด
--     ② `insertChunked('customer_shipping_orders', …)`                 ← ใส่ใหม่ทั้งชุด
--   ⇒ trigger `fn_audit` จับทุกแถวของทั้งสองรอบ ทั้งที่ "ของเดิมหาย ของใหม่มา"
--      ไม่ใช่การแก้ที่ต้องสอบกลับรายแถว
--
-- 🔴 **และ ① กับ ② เป็นคนละ transaction** (คนละคำขอ HTTP) ⇒ ถ้า ② ล้มหลัง ① สำเร็จ
--    **ออเดอร์หายทั้งชุด ไม่มีอะไรย้อนให้** — migration นี้ปิดบั๊กนั้นไปด้วย
--
-- ─── ของที่เพิ่ม ───────────────────────────────────────────────────────────
-- 1. `fn_audit()` + ด่านเดียว: `app.audit = 'off'` ⇒ ข้าม audit รายแถว
--    🔑 **ยังไม่มีใครตั้งค่านี้นอกจาก RPC ข้อ 2 ⇒ ทุกตารางที่เหลือพฤติกรรมเดิมเป๊ะ**
--    (ใช้กลไกเดียวกับ `app.actor` ที่ fn_audit อ่านอยู่แล้ว)
-- 2. `fn_monitoring_orders_replace(rows, by)` — ลบ+ใส่ใน transaction เดียว
--    ปิด audit รายแถว แล้วเขียน audit **สรุป 1 แถว** (`action = 'BULK_REPLACE'`)
--
-- ⚠️ **`set_config(..., true)` = local ของ transaction นั้น** — จบคำสั่งแล้วคืนค่าเอง
--    ไม่มีทางรั่วไปงานอื่น แม้ connection จะถูก pool ใช้ซ้ำ
--
-- ย้อนกลับ:
--   drop function if exists public.fn_monitoring_orders_replace(jsonb, text);
--   -- แล้ว revert fn_audit กลับเวอร์ชันก่อนหน้า (ถอดบล็อก `app.audit` ออก)
--   -- โค้ดฝั่งจอ revert เป็น delete+insertChunked แบบเดิมได้ทันที
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ด่านใน fn_audit ───────────────────────────────────────────────────────
create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor text; v_actor_uid uuid; v_changed text[]; v_row jsonb;
begin
  /* 🔴 ด่านเดียวที่เพิ่ม (13/11): งานนำเข้าเป็นชุดตั้ง `app.audit='off'` ไว้ใน transaction ของมัน
     แล้วเขียน audit สรุปเองแทน · **ไม่มีใครตั้งค่านี้ = พฤติกรรมเดิมทุกประการ** */
  if nullif(current_setting('app.audit', true), '') = 'off' then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;

  begin
    -- DELETE ไม่มี NEW → ต้องอ่านจาก OLD ไม่งั้น actor/actor_uid เป็น null เสมอ
    v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

    v_actor := nullif(current_setting('app.actor', true), '');
    if v_actor is null then
      v_actor := coalesce(v_row->>'updated_by_name', v_row->>'last_edited_by');
    end if;

    begin
      v_actor_uid := nullif(v_row->>'updated_by_uid','')::uuid;
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
      -- หมายเหตุ: ได้ "คนแก้ล่าสุด" ไม่ใช่ "คนลบ" (ข้อจำกัดเดิมของ DR ที่เป็น anon — ยอมรับไว้แล้ว)
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

-- ── 2. นำเข้าออเดอร์จากไฟล์ Monitoring — ลบ+ใส่ ใน transaction เดียว ──────────────
create or replace function public.fn_monitoring_orders_replace(p_rows jsonb, p_by text default null)
returns table (deleted int, inserted int)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_del int := 0;
  v_ins int := 0;
begin
  -- ปิด audit รายแถวเฉพาะใน transaction นี้ (local — จบแล้วคืนค่าเอง)
  perform set_config('app.audit', 'off', true);

  delete from public.customer_shipping_orders
   where source = 'monitoring' and status = 'pending';
  get diagnostics v_del = row_count;

  insert into public.customer_shipping_orders
        (mat_no, part_name, customer, customer_part_no, due_date, qty, status, source, note, created_by_name)
  select nullif(btrim(r->>'mat_no'), ''),
         r->>'part_name',
         r->>'customer',
         r->>'customer_part_no',
         (r->>'due_date')::date,
         coalesce((r->>'qty')::numeric, 0),
         'pending', 'monitoring',
         r->>'note',
         p_by
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(btrim(r->>'mat_no'), '') <> ''
     and nullif(r->>'due_date', '') is not null;
  get diagnostics v_ins = row_count;

  -- เปิด audit กลับ แล้วเขียน "สรุปการนำเข้า 1 แถว" แทน N แถว
  perform set_config('app.audit', '', true);
  insert into public.audit_log(table_name, row_pk, action, actor, changed_fields, new_data)
  values ('customer_shipping_orders', null, 'BULK_REPLACE', nullif(btrim(coalesce(p_by,'')), ''),
          array['source','status'],
          jsonb_build_object('source','monitoring', 'status','pending',
                             'deleted', v_del, 'inserted', v_ins, 'rows_sent', jsonb_array_length(coalesce(p_rows,'[]'::jsonb))));

  return query select v_del, v_ins;
end $function$;

-- ฝั่ง DR วิ่งด้วย role `anon` เสมอ
grant execute on function public.fn_monitoring_orders_replace(jsonb, text) to anon, authenticated, service_role;
