/* ═══════════════════════════════════════════════════════════════════════════════════════
   🏷️ machine_no — ตัด "วรรณยุกต์/สระไทยลอย" ที่พิมพ์ติดมา  (DR · 2026-11-09 · apply แล้ว)

   ต่อจาก `20261109_machine_no_canonical_dr.sql` — ยุบรูปแบบไปแล้วยังเหลืออีกชั้น:
     `ฺBD-08` (ฺ phinthu นำ) · `่jig 006` (ไม้เอกนำ) · `๋JIG005` · `์Jig-main` · `ิbending`
   = มาร์คอยู่**ต้นคำ หรือตามหลังอักขระที่ไม่ใช่อักษรไทยเลย** ⇒ อักขรวิธีเป็นไปไม่ได้
   ⇒ ตัดได้โดยไม่ต้อง "เดาตัวตนเครื่อง" (ต่างจากทับศัพท์ `เลเซอร์04`↔`Laser4` ที่ยังห้ามเดา)

   🔴🔴 **ฐานต้องรวมสระ `ก-๎` ไม่ใช่แค่พยัญชนะ `ก-ฮ`**
        ไทยซ้อนวรรณยุกต์บน*สระ*ได้: เครื่อง = ค ร ◌ื ◌่ อ ง
        เกณฑ์ที่ดูแค่พยัญชนะจะกิน **เครื่อง→เครือง · ติดตั้ง→ติดตัง · เบนดิ่ง→เบนดิง**
        (เคสจริง: รอบแรกผมใช้เกณฑ์ผิด ถ้าไม่พรีวิวคอลัมน์ผลลัพธ์ก่อนก็พังคำไทย 4 คำ)

   ผล: แก้มาร์คลอย 22 แถว (downtime_logs) → คีย์เปลี่ยน → ยุบซ้ำได้อีก 5 แถว
   ย้อนกลับ: `archive.machine_no_strayfix_20261109` (ทำก่อน) แล้วค่อย backfill ตัวแรก
   ═══════════════════════════════════════════════════════════════════════════════════════ */

create table if not exists archive.machine_no_strayfix_20261109 (
  tbl text not null, row_id uuid not null, old_value text not null, new_value text not null,
  taken_at timestamptz not null default now(), primary key (tbl,row_id)
);

do $$
declare t text; rx text := '(^|[^\u0E01-\u0E4E])[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]+';
begin
  foreach t in array array['downtime_logs','machines','mtn_orders','pm_coordination_plans','jigs','improvements']
  loop
    execute format($f$
      insert into archive.machine_no_strayfix_20261109 (tbl,row_id,old_value,new_value)
      select %L, id, machine_no, regexp_replace(machine_no, %L, '\1', 'g')
      from %I where machine_no is not null
        and machine_no is distinct from regexp_replace(machine_no, %L, '\1', 'g')
      on conflict (tbl,row_id) do nothing
    $f$, t, rx, t, rx);
    execute format($f$
      update %I set machine_no = regexp_replace(machine_no, %L, '\1', 'g')
      where machine_no is not null
        and machine_no is distinct from regexp_replace(machine_no, %L, '\1', 'g')
    $f$, t, rx, rx);
  end loop;
end $$;

/* ตัดมาร์คแล้วคีย์เปลี่ยน ⇒ บางค่าเพิ่งมาชนทะเบียน (๋JIG005 → JIG005 = คีย์เดียวกับ JIG-005)
   ⇒ สร้างแผนที่ใหม่ แล้วยุบอีกรอบด้วยตรรกะเดิม (ทะเบียนชนะ → ไม่มีในทะเบียนใช้ตัวที่พบบ่อยสุด) */
drop table if exists archive.machine_no_map2_20261109;
create table archive.machine_no_map2_20261109 as
with all_no as (
  select machine_no v from downtime_logs         where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from mtn_orders            where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from machines              where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from improvements          where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from jigs                  where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from part_routings         where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from pm_coordination_plans where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from prod_orders           where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from production_plan_lots  where machine_no is not null and btrim(machine_no)<>''
  union all select machine_no from production_shots      where machine_no is not null and btrim(machine_no)<>''
),
tidy as (select machine_key(v) kk, regexp_replace(btrim(v),'\s+',' ','g') tv from all_no),
cnt  as (select kk, tv, count(*) n from tidy group by kk, tv),
reg  as (select distinct machine_key(machine_no) kk, regexp_replace(btrim(machine_no),'\s+',' ','g') tv
         from machines where machine_no is not null and btrim(machine_no)<>'')
select c.kk as machine_k,
       coalesce((select r.tv from reg r where r.kk=c.kk limit 1),
                (select x.tv from cnt x where x.kk=c.kk order by x.n desc, x.tv limit 1)) as target,
       (select r.tv from reg r where r.kk=c.kk limit 1) is not null as from_registry
from cnt c group by c.kk;
alter table archive.machine_no_map2_20261109 add primary key (machine_k);

do $$
declare t text;
begin
  foreach t in array array['downtime_logs','machines','mtn_orders','pm_coordination_plans','jigs','improvements']
  loop
    execute format($f$
      insert into archive.machine_no_backfill_20261109 (tbl,row_id,old_value,new_value)
      select %L, x.id, x.machine_no, m.target
      from %I x join archive.machine_no_map2_20261109 m on m.machine_k = machine_key(x.machine_no)
      where x.machine_no is not null and btrim(x.machine_no)<>'' and x.machine_no is distinct from m.target
      on conflict (tbl,row_id) do nothing
    $f$, t, t);
    execute format($f$
      update %I x set machine_no = m.target from archive.machine_no_map2_20261109 m
      where m.machine_k = machine_key(x.machine_no)
        and x.machine_no is not null and btrim(x.machine_no)<>''
        and x.machine_no is distinct from m.target
    $f$, t);
  end loop;
end $$;

/* ═══ ย้อนกลับ (ลำดับสำคัญ: ยุบสะกด ก่อน แล้วค่อยคืนมาร์คลอย) ═════════════════════════
update downtime_logs x set machine_no=b.old_value from archive.machine_no_backfill_20261109 b where b.tbl='downtime_logs' and b.row_id=x.id;
-- …ทำครบทุกตารางตามไฟล์ 20261109_ ก่อน แล้วจึง:
update downtime_logs x set machine_no=s.old_value from archive.machine_no_strayfix_20261109 s where s.tbl='downtime_logs' and s.row_id=x.id;
   ══════════════════════════════════════════════════════════════════════════════════ */
