-- ═══════════════════════════════════════════════════════════════════════════
-- 🔁 คิด %Q/OEE ใหม่ย้อนหลัง — กะที่ปิดแล้วที่ NG อยู่ในถังเหลืองรอพิจารณา   ·   project = DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- ที่มา: คำสั่ง user 2026-11-10 "คิดย้อนหลังทั้ง 15 กะเลย" — คู่กับ oee.js §7.2 (binCoveredSplit)
--   NG ที่ใบเหลืองครอบ + ยังไม่ตัดสิน = ยังไม่หัก %Q ⇒ ค่าที่ stamp ตอนปิดกะ (หัก NG ไปแล้ว) ต้องคิดใหม่
-- กติกาเดียวกับ restampQPatch(): แตะเฉพาะ oee_q + oee · Q = actual_qty ÷ (actual_qty + ของเสียที่ยังนับ)
--   · oee = oee_a × oee_p × Q (จาก A/P ที่ stamp ไว้) · %Q เท่าเดิม = ไม่เขียน
--   · แถวที่ไม่ครอบ (ลงแดงตรง / ใบเหลืองไม่พอ / ตัดสินแล้ว / งานทดลอง) = นับ NG แบบเดิม
-- 🔴 สำรองค่าเดิมไว้ใน schema `archive` ก่อนเขียน (กฎ CLAUDE.md)
-- ย้อน: update production_sessions s set oee_q = b.oee_q, oee = b.oee
--         from archive.restamp_q_20261110 b where b.id = s.id;
-- ═══════════════════════════════════════════════════════════════════════════
create schema if not exists archive;
create table if not exists archive.restamp_q_20261110 as
  select id, oee_q, oee, now() as backed_up_at from production_sessions where false;

with sids as (
  select distinct d.session_id from defect_logs d
  join quality_bin_records y on y.defect_log_id = d.id and y.bin = 'yellow' and y.is_active
  where d.qty_ng > 0),
rows_ as (
  select d.session_id, d.qty_ng, d.is_trial, coalesce(t.excl_from_q, false) excl,
    ( not exists (select 1 from quality_bin_records r where r.defect_log_id = d.id and r.bin = 'red' and r.is_active and r.from_yellow_id is null)
      and (select coalesce(sum(qty), 0) from quality_bin_records y where y.defect_log_id = d.id and y.bin = 'yellow' and y.is_active)
          >= d.qty_ng + coalesce(d.qty_suspect, 0)
      and coalesce(d.qty_suspect, 0) = 0
      and not exists (select 1 from quality_bin_records y where y.defect_log_id = d.id and y.bin = 'yellow' and y.is_active
                      and (y.qa_decision is not null or y.return_date is not null))
    ) covered_pending
  from defect_logs d left join dr_defect_types t on t.id = d.defect_type_id
  where d.session_id in (select session_id from sids)),
agg as (
  select session_id, sum(case when covered_pending or is_trial or excl then 0 else qty_ng end) ng_new,
         bool_or(false) _x
  from rows_ group by session_id),
calc as (
  select s.id, round(100.0 * s.actual_qty / (s.actual_qty + a.ng_new), 2) new_q,
         case when s.oee_a is null or s.oee_p is null then null
              else round((s.oee_a / 100.0) * (s.oee_p / 100.0) * (s.actual_qty::numeric / (s.actual_qty + a.ng_new)) * 100, 2) end new_oee
  from production_sessions s join agg a on a.session_id = s.id
  where s.status in ('closed', 'pending_close') and s.actual_qty > 0
    -- ⚠️ แถวที่มีของสงสัยปนอยู่ ข้าม (ให้ restamp ตอน QA ตัดสินจัดการด้วยสูตรเต็มในโค้ด)
    and not exists (select 1 from defect_logs x where x.session_id = s.id and coalesce(x.qty_suspect, 0) > 0)),
todo as (select c.* from calc c join production_sessions s on s.id = c.id where s.oee_q is distinct from c.new_q),
bk as (
  insert into archive.restamp_q_20261110 (id, oee_q, oee, backed_up_at)
  select s.id, s.oee_q, s.oee, now() from production_sessions s where s.id in (select id from todo)
    and not exists (select 1 from archive.restamp_q_20261110 b where b.id = s.id)
  returning id)
update production_sessions s set oee_q = t.new_q, oee = t.new_oee
from todo t where t.id = s.id;

-- ตรวจหลังรัน:
--   select s.id, s.work_date, s.line_name, b.oee_q old_q, s.oee_q new_q, b.oee old_oee, s.oee new_oee
--     from archive.restamp_q_20261110 b join production_sessions s on s.id = b.id order by s.work_date;
