/* ═══════════════════════════════════════════════════════════════════════════════════════
   🏷️ machine_no — ยุบ "เครื่องเดียวกันที่เขียนต่างแบบ" ให้เหลือสะกดเดียว   (DR · 2026-11-09)

   คำสั่ง user 09/11: *"แก้ในฐานเลยดีกว่า มันไม่ควรมีแยกเป็น 2 เครื่อง"*

   ── ปัญหา ────────────────────────────────────────────────────────────────────────────
   `machine_no` เป็น **ข้อความอิสระ** และเป็นคีย์ join ของพาเรโต/KPI ช่าง/MTBF/Andon
   ⇒ `SP-78` กับ `SP78` = เครื่องเดียวกัน แต่แตกเป็น 2 แท่งในทุกจอวิเคราะห์
   วัดจริง 09/11: 53 คีย์ที่เขียนมากกว่า 1 แบบ · 331 แถวใน 5 ตาราง

   ── 🔴 ขอบเขต: "รูปแบบ" เท่านั้น ห้ามเดาตัวตนเครื่อง ─────────────────────────────────
   จับกลุ่มด้วย `public.machine_key()` ซึ่งตัด **ตัวพิมพ์ · ช่องว่าง · ขีด/จุด/ขีดล่าง ·
   เลขศูนย์นำหน้ากลุ่มตัวเลขท้ายคำ** เท่านั้น (ตรรกะตรงกับ `machineKey()` ใน
   `src/utils/machineNo.js` — แก้ฝั่งไหนต้องแก้อีกฝั่งเสมอ)
   ⇒ `เลเซอร์04` กับ `Laser4` **ยังเป็นคนละคีย์** (ทับศัพท์ = เดาทะเบียนโรงงาน ห้ามทำ)
   ⇒ `่jig 006` (มีไม้เอกลอยหน้า) กับ `jig 006` **ยังเป็นคนละคีย์** — เป็น typo ที่คนต้องแก้เอง
      ไม่ใช่ "รูปแบบ" · migration นี้จงใจไม่แตะ

   ── ตัวจริงของแต่ละคีย์เลือกยังไง ────────────────────────────────────────────────────
   1. **ทะเบียน `machines` ชนะเสมอ** (768 จาก 993 คีย์) — ทะเบียนเป็นตัวบอกตัวตน
   2. ไม่มีในทะเบียน → สะกดที่ใช้บ่อยที่สุด **หลังรีดช่องว่าง** (trim + ยุบช่องว่างซ้ำ)
      ⇒ ตัวที่ชนะด้วยจำนวนแต่มีช่องว่างหลงท้าย (`"Robot 104 "`) ไม่ได้เป็นตัวจริง

   ── ย้อนกลับ ─────────────────────────────────────────────────────────────────────────
   `archive.machine_no_backfill_20261109` เก็บ (ตาราง · id · ค่าเดิม) ทุกแถวที่แตะ
   `archive.machine_no_map_20261109`      เก็บแผนที่ คีย์ → ตัวจริง (auditable)
   คืนค่า: update ... from archive.machine_no_backfill_20261109 (SQL เต็มอยู่ท้ายไฟล์)
   🔴 ตาราง snapshot อยู่ schema `archive` ตามกฎ ห้ามไว้ `public`
   ═══════════════════════════════════════════════════════════════════════════════════════ */

create schema if not exists archive;

/* ── 1) แผนที่ คีย์ → ตัวจริง ─────────────────────────────────────────────────────── */
drop table if exists archive.machine_no_map_20261109;
create table archive.machine_no_map_20261109 as
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
alter table archive.machine_no_map_20261109 add primary key (machine_k);

/* ── 2) snapshot ค่าเดิมของทุกแถวที่จะแตะ (= ตัวย้อนกลับ) ─────────────────────────── */
drop table if exists archive.machine_no_backfill_20261109;
create table archive.machine_no_backfill_20261109 (
  tbl        text not null,
  row_id     uuid not null,
  old_value  text not null,
  new_value  text not null,
  taken_at   timestamptz not null default now(),
  primary key (tbl, row_id)
);

/* ── 3) snapshot + update ทีละตาราง (5 ตารางที่มีแถวต้องแก้จริง) ──────────────────── */
do $$
declare t text;
begin
  foreach t in array array['downtime_logs','machines','mtn_orders','pm_coordination_plans','jigs']
  loop
    execute format($f$
      insert into archive.machine_no_backfill_20261109 (tbl,row_id,old_value,new_value)
      select %L, x.id, x.machine_no, m.target
      from %I x join archive.machine_no_map_20261109 m on m.machine_k = machine_key(x.machine_no)
      where x.machine_no is not null and btrim(x.machine_no)<>'' and x.machine_no is distinct from m.target
      on conflict (tbl,row_id) do nothing
    $f$, t, t);

    execute format($f$
      update %I x set machine_no = m.target
      from archive.machine_no_map_20261109 m
      where m.machine_k = machine_key(x.machine_no)
        and x.machine_no is not null and btrim(x.machine_no)<>''
        and x.machine_no is distinct from m.target
    $f$, t);
  end loop;
end $$;

/* ═══ ย้อนกลับ (คัดลอกไปรันใน SQL Editor ของ Product DB ถ้าต้องถอย) ══════════════════
update downtime_logs         x set machine_no=b.old_value from archive.machine_no_backfill_20261109 b where b.tbl='downtime_logs'         and b.row_id=x.id;
update machines              x set machine_no=b.old_value from archive.machine_no_backfill_20261109 b where b.tbl='machines'              and b.row_id=x.id;
update mtn_orders            x set machine_no=b.old_value from archive.machine_no_backfill_20261109 b where b.tbl='mtn_orders'            and b.row_id=x.id;
update pm_coordination_plans x set machine_no=b.old_value from archive.machine_no_backfill_20261109 b where b.tbl='pm_coordination_plans' and b.row_id=x.id;
update jigs                  x set machine_no=b.old_value from archive.machine_no_backfill_20261109 b where b.tbl='jigs'                  and b.row_id=x.id;
   ══════════════════════════════════════════════════════════════════════════════════ */
