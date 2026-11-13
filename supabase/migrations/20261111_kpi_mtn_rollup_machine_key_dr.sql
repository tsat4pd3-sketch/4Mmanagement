-- ════════════════════════════════════════════════════════════════════════════
-- 🏷️ kpi_mtn_rollup — จับคู่เลขเครื่องด้วย machine_key() + บอกชั่วโมงที่ชี้เจ้าของไม่ได้
--    project: "Product DB" (DR) = eyhclzkifitbhbljgoav                    2026-11-11
--
-- คำสั่ง user: *"single source truth ต้องไม่มีค่าไหนหายไป แต่ต้องเคาะว่าจะไปอยู่ตรงไหน"*
-- ที่มา: ทีม MTN ดึงเลข MTBF/MTTR/Machine Break Down ไปส่งส่วนกลางไม่ได้ — "ข้อมูลสวิงมาก"
--
-- ── 🐞 บั๊กที่แก้ ────────────────────────────────────────────────────────────
-- เดิม RPC จับคู่ด้วย `m2.machine_no = d.machine_no` = **เทียบข้อความดิบ**
-- ขัดกฎ CLAUDE.md §machine_no: *"ยุบได้เฉพาะรูปแบบ ผ่าน snapMachineNo (ฝั่ง SQL
-- public.machine_key() ตรรกะต้องตรงกัน)"* ⇒ ตัวพิมพ์/ช่องว่าง/ขีด/0 นำหน้า ต่างนิดเดียว
-- = ชั่วโมงหล่นเข้าถัง `unknown` ไม่เข้า KPI ทีมไหนเลย
--
-- วัดจริง (ก.ย.–10 พ.ย. 2026 · กรอง downtime ตามแผนออกแล้ว):
--   ชนิด machine : ก.ย. 294.6 → 332.0 ชม. (+37.4 · +12.7%) · ต.ค. 795.8 → 810.1 (+1.8%) · พ.ย. ~0
--   เคสจริง: ทะเบียนมี `SP-72` แต่หน้างานลง downtime เป็น `SP-72/NF85`
--
-- ── 🔴 ชั้นการจับคู่ 4 ชั้น (ห้ามสลับลำดับ) ──────────────────────────────────
--   ① คีย์เต็ม ↔ คีย์เต็มของทะเบียน                      (SW10 = SW-10)
--   ② คีย์เต็ม ↔ **คีย์หน้า `/` ของทะเบียน**             (ทะเบียน `SP-78/NF56` · หน้างาน `SP-78`)
--   ③ **คีย์หน้า `/` ของ downtime** ↔ คีย์เต็มของทะเบียน (ทะเบียน `SP-72` · หน้างาน `SP-72/NF85`)
--   ④ คีย์หน้า `/` ทั้งสองฝั่ง
--   ⚠️ ③ กับ ④ เป็นของใหม่ — `resolveEquip()` ฝั่ง JS ตัด `/` **เฉพาะฝั่งทะเบียน** (ชั้น ②)
--      จึงจับเคส `SP-72/NF85` ไม่ได้เหมือนกัน (ต้องตามไปเพิ่มให้ตรงกันในคอมมิทเดียวกัน)
--
--   ⚡ **ต้อง `as materialized` ทุก CTE ของดัชนี + คำนวณคีย์ครั้งเดียวใน `raw`**
--      รอบแรกเขียนเป็น 4 left join ที่เรียก `machine_key(d.machine_no)` ในเงื่อนไข join ตรงๆ
--      → PG inline CTE แล้ว **re-scan ดัชนีต่อแถว** ⇒ RPC ค้างเกิน 60 วิ (ของเดิมไม่กี่วิ)
--      = regression ที่จอเรียกจริง · วัดแล้วแก้แล้ว — ห้ามถอด `materialized` ออก
--
--   🔴 **ชั้น ②-④ ใช้ได้เฉพาะคีย์ที่ไม่ชน** (`having count(distinct machine_no) = 1`)
--      แม่พิมพ์ 24 ตัวชื่อขึ้นต้นเหมือนกัน ต่างแค่ OP10/OP20 เช่น
--      `BMP END FACE RPA RH/LH - N1WB-… (OP10: FORM)` ⇒ ตัดหลัง `/` แล้วยุบเป็นตัวเดียวหมด
--      = ตัวเลขมั่วทันที · ชนกัน = **ข้าม ปล่อยเป็น unknown ห้ามเดา**
--      (หลักเดียวกับ `buildEquipIndex()` ใน src/utils/mtnMetrics.js)
--
-- ── 📤 ของใหม่ใน payload: `dt_gap` + `dt_gap_top` ───────────────────────────
-- *"ต้องไม่มีค่าไหนหายไป"* ⇒ ชั่วโมงที่ชี้เจ้าของไม่ได้ ต้อง**ส่งออกมาให้จอเขียนบนจอ**
-- ไม่ใช่เงียบอยู่ในถัง unknown · แยก 2 เหตุเพราะ **คนละทางแก้**:
--   `no_machine_no`  = ไม่ได้กรอกเลขเครื่องตอนลง downtime → แก้ที่ "คนกรอก"
--   `not_in_master`  = กรอกแล้วแต่ไม่มีในทะเบียน         → แก้ที่ "ทะเบียนเครื่อง /machines"
-- วัดจริง ก.ย.–10 พ.ย.: จับคู่ได้ 1,546 ชม. (81%) · ไม่กรอกเลย 256 ชม. (13.4%)
--                      · กรอกแล้วไม่มีในทะเบียน 106 ชม. (5.6% — JIG-005 · CONVEYOR ฯลฯ)
--
-- 🔴 **ไม่แตะนิยาม KPI** — สูตร MBD/MTBF/MTTR ยังเป็นของ KPI Guideline 2026 หน้า 10 เหมือนเดิม
--    (กลุ่มเป็นเจ้าของนิยาม · ESM เป็นที่ผลิตเลข Actual เท่านั้น) ไฟล์นี้แก้แค่ "ชั่วโมงเข้าทีมถูกไหม"
-- ⚠️ ผลข้างเคียงที่ต้องบอกหน้างาน: **ชั่วโมงเสียของทีมจะขยับขึ้น** ⇒ MBD ขึ้น · MTBF ลง
--    (เลขเดิมที่ส่งไปแล้วจะไม่ตรงกับที่จอโชว์หลังรันไฟล์นี้)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.kpi_mtn_rollup(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with mo as (
  select to_char(o.repair_done_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m,
         coalesce(o.mtn_dept, 'unknown') as team,
         count(*) as closed,
         count(*) filter (where o.target_done_at is not null and o.repair_done_at <= o.target_done_at) as on_target,
         count(*) filter (where o.target_done_at is null) as no_target
  from mtn_orders o
  where o.repair_done_at is not null
    and (o.repair_done_at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and coalesce(o.status, '') <> 'rejected'
  group by 1, 2
),
/* ── ดัชนีทะเบียน 2 ชั้น — ชนกัน = ไม่ใส่ (ห้ามเดา) ───────────────────────── */
reg_exact as materialized (
  select public.machine_key(machine_no) as k, max(equipment_kind) as kind, 1 as pri
  from machines where coalesce(is_active, true) and nullif(btrim(coalesce(machine_no,'')),'') is not null
  group by 1 having count(distinct machine_no) = 1
),
reg_prefix as materialized (
  select public.machine_key(split_part(machine_no, '/', 1)) as k, max(equipment_kind) as kind, 2 as pri
  from machines where coalesce(is_active, true) and nullif(btrim(coalesce(machine_no,'')),'') is not null
  group by 1 having count(distinct machine_no) = 1
),
/* ดัชนีเดียวที่ยุบ 2 ชั้นแล้ว — คีย์ซ้ำ เอาชั้นที่ priority ดีกว่า (exact ชนะ prefix) */
map as materialized (
  select k, (array_agg(kind order by pri))[1] as kind
  from (select * from reg_exact union all select * from reg_prefix) u
  group by k
),
/* คำนวณคีย์ของ downtime **ครั้งเดียว** (ไม่ใช่เรียก machine_key ในเงื่อนไข join 4 รอบ) */
raw as materialized (
  select to_char(d.started_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m,
         d.machine_no,
         public.machine_key(d.machine_no) as k_full,
         public.machine_key(split_part(d.machine_no, '/', 1)) as k_pre,
         case when d.duration_min is not null then d.duration_min::numeric
              when d.ended_at is not null then greatest(0, extract(epoch from (d.ended_at - d.started_at)) / 60)
              else null end as mins
  from downtime_logs d
  left join dr_downtime_types t on t.id = d.downtime_type_id
  where d.started_at is not null
    and (d.started_at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and coalesce(t.category, '') <> 'planned'
    and (d.ended_at is not null or d.duration_min is not null)
),
/* ชั้น ①② = คีย์เต็มของ downtime · ชั้น ③④ = คีย์หน้า '/' ของ downtime */
dtl as materialized (
  select x.m, x.machine_no, x.mins, coalesce(m1.kind, m2.kind) as kind_hit
  from raw x
  left join map m1 on m1.k = x.k_full
  left join map m2 on m2.k = x.k_pre
),
dt as (
  select m, coalesce(kind_hit, 'unknown') as kind, count(*) as events, sum(mins) as breakdown_min
  from dtl group by 1, 2
),
gap as (
  select m,
         case when nullif(btrim(coalesce(machine_no,'')),'') is null then 'no_machine_no'
              else 'not_in_master' end as reason,
         machine_no, mins
  from dtl where kind_hit is null
),
dt_gap as (
  select m, reason, count(*) as events, round(sum(mins)::numeric, 1) as mins
  from gap group by 1, 2
),
dt_gap_top as (
  select machine_no, count(*) as events, round(sum(mins)::numeric, 1) as mins
  from gap where reason = 'not_in_master'
  group by 1 order by sum(mins) desc nulls last limit 15
),
mach as (
  select coalesce(equipment_kind, 'unknown') as kind, count(*) as n
  from machines where coalesce(is_active, true)
  group by 1
),
mon as (
  select distinct to_char(d.started_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m
  from downtime_logs d
  where d.started_at is not null and (d.started_at at time zone 'Asia/Bangkok')::date between p_from and p_to
)
select jsonb_build_object(
  'mo',         coalesce((select jsonb_agg(to_jsonb(mo) order by m, team) from mo), '[]'::jsonb),
  'dt',         coalesce((select jsonb_agg(to_jsonb(dt) order by m, kind) from dt), '[]'::jsonb),
  'machines',   coalesce((select jsonb_agg(to_jsonb(mach) order by kind) from mach), '[]'::jsonb),
  'months',     coalesce((select jsonb_agg(m order by m) from mon), '[]'::jsonb),
  'dt_gap',     coalesce((select jsonb_agg(to_jsonb(dt_gap) order by m, reason) from dt_gap), '[]'::jsonb),
  'dt_gap_top', coalesce((select jsonb_agg(to_jsonb(dt_gap_top) order by mins desc) from dt_gap_top), '[]'::jsonb)
);
$$;

grant execute on function public.kpi_mtn_rollup(date, date) to anon, authenticated;

comment on function public.kpi_mtn_rollup(date, date) is
  'Σ ต่อเดือน/ชนิดอุปกรณ์ สำหรับ KPI ทีมช่าง (Guideline 2026 หน้า 10) — จับคู่เลขเครื่องด้วย machine_key() 4 ชั้น · dt_gap = ชั่วโมงที่ชี้เจ้าของไม่ได้ (2026-11-11)';

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ คิวรีเช็คผล (รันบน "Product DB" / eyhclzkifitbhbljgoav)
--
-- 1) ชั่วโมงต่อชนิด — `machine` ต้องเพิ่มขึ้น · `unknown` ต้องลดลงเท่ากัน (ยอดรวมห้ามเปลี่ยน)
--    select t.m, t.kind, t.events, round(t.breakdown_min/60.0,1) as hr
--      from kpi_mtn_rollup('2026-09-01','2026-11-30') r,
--           jsonb_to_recordset(r->'dt') as t(m text, kind text, events int, breakdown_min numeric)
--     order by t.m, t.kind;
--
-- 2) ชั่วโมงที่ยังชี้เจ้าของไม่ได้ แยกตามเหตุ (ตัวที่จอต้องเขียนบนจอ)
--    select * from kpi_mtn_rollup('2026-09-01','2026-11-30') r,
--           jsonb_to_recordset(r->'dt_gap') as g(m text, reason text, events int, mins numeric);
--
-- 3) เครื่องที่กรอกแล้วแต่ไม่มีในทะเบียน — เอาไปเพิ่มที่ /machines
--    select * from kpi_mtn_rollup('2026-09-01','2026-11-30') r,
--           jsonb_to_recordset(r->'dt_gap_top') as g(machine_no text, events int, mins numeric);
--
-- ⏪ ROLLBACK — คืนสูตรจับคู่แบบเดิม (เทียบข้อความดิบ · ไม่มี dt_gap)
--    รันไฟล์ supabase/migrations/20260924_kpi_mtn_rollup_dr.sql ซ้ำทั้งไฟล์
--    (เป็น `create or replace` ⇒ ทับกลับได้ทันที ไม่มี DDL ที่ย้อนไม่ได้)
-- ════════════════════════════════════════════════════════════════════════════
