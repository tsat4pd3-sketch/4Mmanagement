# ROLLBACK — ผูก uid คู่ชื่อคน (actor uid) · 2026-09-16

> งานนี้แก้ปัญหา "ชื่อคนเก็บเป็น text ไม่ผูกรหัสอะไร ⇒ คนเดียวกันถูกนับเป็นหลายคน"
> โดย **เพิ่ม uid คู่กับชื่อ ไม่แทนที่ชื่อ** — ดู `docs/modules/traceability-audit-log.md`

## สิ่งที่เปลี่ยน (เรียงตามลำดับที่ทำ)

| # | อะไร | ที่ไหน | ย้อนยังไง |
|---|---|---|---|
| 1 | `updated_by_uid` (uuid, nullable) 45 ตาราง | DR | ไม่ต้องย้อน (คอลัมน์ว่างไม่รบกวนอะไร) |
| 2 | `audit_log.actor_uid` + index | DR | ไม่ต้องย้อน |
| 3 | `fn_audit()` — เก็บ actor_uid · ยกเว้น `updated_by_uid` ตอนเทียบ changed_fields · อ่าน OLD ตอน DELETE | DR | คืนฟังก์ชันเดิม (ด้านล่าง) |
| 4 | `*_uid` คอลัมน์ "ผู้ทำงานแต่ละขั้น" ~85 คู่ | DR + Main | ไม่ต้องย้อน |
| 5 | `norm_person_name(text)` | DR + Main | `drop function` ได้ ถ้าไม่มีอะไรเรียก |
| 6 | Backfill uid จากชื่อที่จับคู่ได้ไม่กำกวม | DR | `update ... set <col> = null` (ดูข้อควรระวัง) |
| 7 | โค้ด: `actorStamp.js` · wrapper ใน `supabaseClient.js` · `App.jsx` | repo | `git revert` |

## ลำดับการถอยที่ปลอดภัย

**เสมอ: revert โค้ดก่อน แล้วค่อยแตะ schema**
โค้ดที่ยัง stamp `updated_by_uid` อยู่ + คอลัมน์ถูก drop = **write พังทั้งระบบ**
(บทเรียนเดียวกับ `updated_by_name` 2026-07-24)

```
1. git revert -m 1 <merge-sha>      # โค้ดกลับไปไม่ส่ง uid
2. รอ deploy เสร็จ ยืนยันหน้าเว็บใช้งานได้
3. (ถ้าจำเป็น) คืน fn_audit เดิม  ← ดู SQL ด้านล่าง
4. (ไม่แนะนำ) ล้างค่า backfill    ← ดู SQL ด้านล่าง
```

> **คอลัมน์ที่เพิ่มไม่ต้อง drop** — nullable ที่ไม่มีใครเขียน ไม่กระทบ query/ขนาด/พฤติกรรมใดๆ
> โปรเจคนี้เก็บคอลัมน์ vestigial ไว้โดยตั้งใจอยู่แล้ว (`document_controls`, `mtn_mo_counter`, `target_oee`)

---

## ⚠️ ข้อควรระวังของการล้างค่า backfill

**ห้ามล้างทั้งคอลัมน์แบบเหมา** — 4 คอลัมน์นี้ **มีข้อมูลจากแอปอยู่ก่อนแล้ว** (เป็นชนิด `text`
ไม่ใช่ `uuid` เพราะเพิ่มมาก่อนงานนี้ และ `DailyReport.jsx` เขียนอยู่):

- `production_sessions.opened_by_uid` · `production_sessions.closed_by_uid`
- `downtime_logs.reported_by_uid` · `defect_logs.reported_by_uid`

ล้างเหมา = **ลบของจริงที่แอปเขียนไว้ ไม่ใช่แค่ของที่ backfill เติม**
ถ้าต้องล้างจริง ให้ล้างเฉพาะตารางอื่น หรือกู้จาก PITR ของ Supabase

```sql
-- DR project (eyhclzkifitbhbljgoav · "Product DB")
-- ล้างเฉพาะคอลัมน์ที่ "เกิดจาก backfill ล้วน" (ก่อนรันเป็น null ทั้งหมด)
update public.prod_orders            set opened_by_uid = null, confirmed_by_uid = null, reopened_by_uid = null;
update public.mtn_orders             set reported_by_uid = null, tech_main_uid = null, tech_secondary_uid = null,
                                         checker_uid = null, qa_checker_uid = null, approver_uid = null,
                                         accepted_by_uid = null, ho_reporter_uid = null, ho_checker_uid = null,
                                         mo_approved_by_uid = null;
update public.line_stock_transactions set created_by_uid = null, reviewed_by_uid = null;
update public.purchase_requests       set ordered_by_uid = null, received_by_uid = null;
update public.customer_shipping_orders set shipped_by_uid = null, created_by_uid = null;
-- (ตารางอื่นทำแบบเดียวกัน — ดูรายการเต็มใน supabase/migrations/20260916_actor_uid_phase3_backfill_dr.sql)
```

---

## คืน `fn_audit()` เดิม (DR project เท่านั้น)

> ⚠️ ของเดิมมีบั๊ก: ตอน DELETE อ่าน `to_jsonb(NEW)` ซึ่งเป็น null เสมอ ⇒ `actor` หายทุกแถว
> (วัดจริง 16/09/2026: แถว DELETE 3,557 แถว actor = null ครบ 100%)
> **คืนของเดิม = เอาบั๊กนี้กลับมาด้วย** — ถ้าถอยเพราะเรื่อง uid อย่างเดียว แนะนำเก็บเวอร์ชันใหม่ไว้

```sql
create or replace function public.fn_audit()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_actor text; v_changed text[];
begin
  begin
    v_actor := nullif(current_setting('app.actor', true), '');
    if v_actor is null then
      v_actor := coalesce(to_jsonb(NEW)->>'updated_by_name', to_jsonb(NEW)->>'last_edited_by');
    end if;
    if TG_OP = 'UPDATE' then
      select array_agg(key) into v_changed
      from jsonb_each(to_jsonb(NEW))
      where to_jsonb(NEW)->key is distinct from to_jsonb(OLD)->key
        and key not in ('updated_at','updated_by_name');
      if v_changed is null then return NEW; end if;
      insert into public.audit_log(table_name,row_pk,action,actor,changed_fields,old_data,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'UPDATE', v_actor, v_changed, to_jsonb(OLD), to_jsonb(NEW));
    elsif TG_OP = 'DELETE' then
      insert into public.audit_log(table_name,row_pk,action,actor,old_data)
      values (TG_TABLE_NAME, to_jsonb(OLD)->>'id', 'DELETE', v_actor, to_jsonb(OLD));
    else
      insert into public.audit_log(table_name,row_pk,action,actor,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'INSERT', v_actor, to_jsonb(NEW));
    end if;
  exception when others then null; end;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $function$;
```

---

## คิวรีตรวจหลังถอย (DR project)

```sql
select
  (select count(*) from information_schema.columns
    where table_schema='public' and column_name='updated_by_uid') tables_with_uid,
  (select count(*) from audit_log where actor_uid is not null) rows_with_actor_uid,
  (select count(*) from production_sessions where opened_by_uid is not null) ps_uid_left;
```
