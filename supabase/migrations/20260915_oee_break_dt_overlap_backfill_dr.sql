/*  ═══════════════════════════════════════════════════════════════════════════════════════
    BACKFILL — แก้ %A/%P/OEE ของกะที่ปิดแล้ว ที่เพี้ยนเพราะ "downtime ทับเวลาพัก ถูกหักซ้ำ"
    project: DR / "Product DB"  (eyhclzkifitbhbljgoav)          วันที่: 2026-09-15
    ═══════════════════════════════════════════════════════════════════════════════════════

    ต้นเหตุ (แก้ในโค้ดแล้ว — src/utils/oee.js §3.1 + computeOEE ใน DailyReport.jsx):
      พักตามนโยบาย (break_policies) เป็น planned stop ที่ถูกกันออกจากฐานเวลาไปแล้ว
      แต่ computeOEE บวก `duration_min` ของ downtime เต็มใบเข้าไปอีก ⇒ นาทีที่ทับกัน **ถูกหัก 2 รอบ**
        เครื่องเสีย 11:30-13:00 (90 น.) คร่อมพักเที่ยง 11:50-12:40 (50 น.)
          ที่ถูก  : 50 (พัก) + 40 (เสียนอกพัก) = 90
          ของเดิม : 50 + 90 = 140            ⇒ runMin หายเกินจริง 50 นาที
      ผล: %A ต่ำกว่าจริง · %P เฟ้อ (ตัวหาร runMin หดเกินจริง) · netAvail บางกะยุบเหลือ ~0

    วัดจริงก่อนแก้ (90 วัน · 1,298 กะที่ปิดแล้ว):
      planned DT ที่ตกในช่วงพัก 16,673 นาที (11.1%) · unplanned 3,659 นาที (5.4%)
      664 กะ (51%) โดนผลกระทบ · %A ต่ำกว่าจริงเฉลี่ย 1.52 จุด (สูงสุด 41.1)

    ── วิธีทำ (ตั้งใจให้ "แก้เฉพาะส่วนที่บั๊กทำพัง" ไม่ใช่เขียนทับประวัติทั้งก้อน) ──────────────
    1) จำลองสูตร %A ของ computeOEE ด้วย SQL (หน้าต่างรายตัว MAT.NO + พักตามนโยบาย + ถ่วง 1/N
       ของไลน์เครื่องขนาน) → ได้ a_old  แล้ว**เทียบกับ `oee_a` ที่ stamp ไว้เพื่อพิสูจน์ว่าจำลองตรง**
         ผลตรวจ: 666/1,031 ตรงเป๊ะ (±0.05) · 843 ตรงภายใน 0.5 จุด · 981 ตรงภายใน 2 จุด
    2) คำนวณ a_new ด้วยสูตรเดียวกันแต่ตัดนาที DT ที่ทับพักออก
    3) **เขียนเป็น "ส่วนต่าง" ไม่ใช่ค่าสัมบูรณ์**: oee_a ใหม่ = oee_a เดิม + (a_new − a_old)
       — ส่วนต่างขึ้นกับ "นาทีที่ทับพัก" ซึ่งอ่านจาก timestamp ในฐานล้วนๆ จึงถูกต้องแม้กะนั้น
         จำลองไม่ตรงเป๊ะ · และไม่ทำลายความละเอียดที่ SQL มองไม่เห็น (เช่นเวลาที่หัวหน้าแก้รายพาร์ท)
    4) เลือกเฉพาะกะที่จำลองตรงภายใน **2 จุด** — เกินกว่านั้น = SQL ไม่ได้โมเดลกะนั้นจริง ห้ามแตะ
    5) %P: ตัวหารคือ runMin ที่โตขึ้น ⇒ p ใหม่ = p เดิม × (run_old / run_new)
       **ข้าม** กะที่ %P ชนเพดาน 100 (ของจริงทะลุไปแล้ว ย้อนไม่ได้) และไลน์เครื่องขนาน
       (SUB APRON — ตัวหาร %P เป็น Σ ต่อกลุ่มสินค้า + clamp ด้วยจำนวนเครื่อง ใช้อัตราส่วนแทนไม่ได้)
    6) OEE = A × P × Q ใหม่เสมอ (ห้ามอ่าน oee เดิม)

    ── ROLLBACK ────────────────────────────────────────────────────────────────────────────
    ตาราง `oee_break_overlap_backfill_20260915` เก็บค่าก่อน-หลังครบทุกแถว ย้อนได้ด้วย:
      update production_sessions ps set oee_a = b.old_a, oee_p = b.old_p, oee = b.old_oee
      from oee_break_overlap_backfill_20260915 b where b.session_id = ps.id;
    (ห้าม drop ตารางนี้จนกว่าจะมั่นใจว่าตัวเลขใหม่ถูกต้อง)
    ═══════════════════════════════════════════════════════════════════════════════════════ */

create table if not exists oee_break_overlap_backfill_20260915 (
  session_id  uuid primary key,
  line_name   text,
  work_date   date,
  shift       text,
  old_a numeric, old_p numeric, old_oee numeric,
  new_a numeric, new_p numeric, new_oee numeric,
  repl_gap    numeric,   -- |a_old(จำลอง) − oee_a(stamp)| — 0 = จำลองตรงเป๊ะ
  dt_break_overlap_min numeric,
  applied_at  timestamptz not null default now()
);
-- ตารางภายในของงาน backfill — ฝั่ง DR เป็น anon-open ทั้ง project จึงต้องปิดด้วย RLS ที่ไม่มี policy
-- (อ่าน/เขียนได้เฉพาะ service role · ดูกฎเหล็ก supabaseDR ใน CLAUDE.md)
alter table oee_break_overlap_backfill_20260915 enable row level security;

with par(line_name, n) as (
  -- production_lines.parallel_stations อยู่ **Main project** (คนละฐาน) — ตรึงค่า ณ 2026-09-15
  -- ถ้ามีการตั้งไลน์ขนานเพิ่มทีหลัง ต้องอัพเดทลิสต์นี้ก่อนรันซ้ำ
  values ('LASER-345',3),('LASER-789',3),('LINE A ( 800 Ton )',5),('LINE B ( 600 Ton )',4),('SUB APRON',6)
),
s as (
  select ps.id, ps.line_name, ps.work_date, ps.shift, ps.start_time, ps.shift_min,
         ps.oee_a, ps.oee_p, ps.oee_q, ps.oee,
         (ps.work_date + ps.start_time) at time zone 'Asia/Bangkok' as ss,
         coalesce(p.n, 1) as pn
  from production_sessions ps
  left join par p on p.line_name = ps.line_name
  where ps.status = 'closed' and ps.shift_min > 0 and ps.start_time is not null and ps.oee_a is not null
),
sw as (select s.*, ss + (shift_min || ' min')::interval as se from s),
-- ── ช่วงพักตามนโยบายที่ทับกรอบกะ (กติกาเดียวกับ breakIntervalsIn ใน src/utils/oee.js) ──
cand as (
  select sw.id, sw.ss, sw.se, bp.ot_scope, bp.duration_min,
    case when ((sw.work_date + bp.start_time) at time zone 'Asia/Bangkok') + (bp.duration_min || ' min')::interval < sw.ss
         then ((sw.work_date + bp.start_time) at time zone 'Asia/Bangkok') + interval '1 day'   -- พักกะดึกหลังเที่ยงคืน
         else ((sw.work_date + bp.start_time) at time zone 'Asia/Bangkok') end as bs
  from sw
  join break_policies bp on bp.is_active and (bp.shift = 'both' or bp.shift = sw.shift)
  -- ทุกแถวปัจจุบันเป็น process_type = 'common' — ไม่ต้องกรอง process ระดับนี้
),
c2  as (select *, bs + (duration_min || ' min')::interval as be from cand),
ovv as (select id, ot_scope, greatest(bs, ss) b1, least(be, se) b2 from c2 where least(be, se) > greatest(bs, ss)),
otf as (select id, bool_or(ot_scope = 'ot') is_ot from ovv group by id),
-- กรอบกะครอบนโยบาย 'ot' = กะนี้ทำโอ ⇒ ทิ้ง 'no_ot' ทั้งหมด (กฎ ot_scope 2026-09-14)
brk as (select ovv.id, ovv.b1, ovv.b2 from ovv join otf using (id) where not (otf.is_ot and ovv.ot_scope = 'no_ot')),
-- ── หน้าต่างของแต่ละ MAT.NO (computeOEE คิด %A แยกรายพาร์ทแล้วรวม) ──
mat as (
  select o.session_id, o.mat_no, min(o.opened_at) ms,
         max(case when o.status = 'confirmed' then o.confirmed_at else o.stopped_at end) me
  from prod_orders o
  where o.mat_no is not null and o.opened_at is not null
  group by o.session_id, o.mat_no
),
matw as (select m.*, sw.pn from mat m join sw on sw.id = m.session_id where m.me is not null and m.me > m.ms),
dt as (
  select d.session_id, coalesce(t.category, 'unplanned') cat, d.machine_no, d.started_at d1,
         coalesce(d.ended_at, d.started_at + (coalesce(d.duration_min, 0) || ' min')::interval) d2
  from downtime_logs d
  left join dr_downtime_types t on t.id = d.downtime_type_id
  where d.started_at is not null
),
dtm as (
  select matw.session_id, matw.mat_no, dt.cat,
         case when matw.pn > 1 and dt.machine_no is not null then 1.0 / matw.pn else 1 end w,
         greatest(dt.d1, matw.ms) a1, least(dt.d2, matw.me) a2
  from matw
  join dt on dt.session_id = matw.session_id and least(dt.d2, matw.me) > greatest(dt.d1, matw.ms)
),
dtsum as (
  select session_id, mat_no, cat,
    sum(extract(epoch from (a2 - a1)) / 60 * w) raw_min,
    sum(greatest(0, extract(epoch from (a2 - a1)) / 60
        - coalesce((select sum(extract(epoch from (least(b.b2, dtm.a2) - greatest(b.b1, dtm.a1))) / 60)
                    from brk b where b.id = dtm.session_id and least(b.b2, dtm.a2) > greatest(b.b1, dtm.a1)), 0)) * w) eff_min
  from dtm group by session_id, mat_no, cat
),
mm as (
  select matw.session_id, matw.mat_no,
    extract(epoch from (matw.me - matw.ms)) / 60 winmin,
    coalesce((select sum(extract(epoch from (least(b.b2, matw.me) - greatest(b.b1, matw.ms))) / 60)
              from brk b where b.id = matw.session_id and least(b.b2, matw.me) > greatest(b.b1, matw.ms)), 0) brkmin,
    coalesce((select raw_min from dtsum x where x.session_id = matw.session_id and x.mat_no = matw.mat_no and x.cat = 'planned'), 0) pl_raw,
    coalesce((select raw_min from dtsum x where x.session_id = matw.session_id and x.mat_no = matw.mat_no and x.cat <> 'planned'), 0) un_raw,
    coalesce((select eff_min from dtsum x where x.session_id = matw.session_id and x.mat_no = matw.mat_no and x.cat = 'planned'), 0) pl_eff,
    coalesce((select eff_min from dtsum x where x.session_id = matw.session_id and x.mat_no = matw.mat_no and x.cat <> 'planned'), 0) un_eff
  from matw
),
agg as (
  select session_id,
    sum(greatest(0, winmin - brkmin - pl_raw))                                  na_old,
    sum(greatest(0, greatest(0, winmin - brkmin - pl_raw) - un_raw))            run_old,
    sum(greatest(0, winmin - brkmin - pl_eff))                                  na_new,
    sum(greatest(0, greatest(0, winmin - brkmin - pl_eff) - un_eff))            run_new,
    sum((pl_raw - pl_eff) + (un_raw - un_eff))                                  ov_min
  from mm group by session_id
),
calc as (
  select sw.id, sw.line_name, sw.work_date, sw.shift, sw.pn,
    sw.oee_a, sw.oee_p, sw.oee_q, sw.oee, a.ov_min, a.run_old, a.run_new,
    case when a.na_old > 0 then least(100, a.run_old / a.na_old * 100) end a_old,
    case when a.na_new > 0 then least(100, a.run_new / a.na_new * 100) end a_new
  from sw join agg a on a.session_id = sw.id
),
final as (
  select c.*,
    -- (3) ส่วนต่างจากบั๊ก ไม่ใช่ค่าสัมบูรณ์
    round(least(100, greatest(0, c.oee_a + (c.a_new - c.a_old)))::numeric, 2) as n_a,
    -- (5) %P: ตัวหาร runMin โตขึ้น ⇒ p ลดลงตามอัตราส่วน · ข้ามกะที่ P ชนเพดาน / ไลน์เครื่องขนาน
    case when c.oee_p is null or c.oee_p >= 99.95 or c.pn > 1 or c.run_new <= 0 or c.run_old <= 0
         then c.oee_p
         else round(least(100, greatest(0, c.oee_p * (c.run_old / c.run_new)))::numeric, 2) end as n_p
  from calc c
  where c.a_old is not null and c.a_new is not null
    and abs(c.a_old - c.oee_a) <= 2            -- (4) จำลองไม่ตรง = ไม่แตะ
    and abs(c.a_new - c.a_old) > 0.005         -- ไม่มีส่วนต่าง = ไม่ต้องเขียน
)
insert into oee_break_overlap_backfill_20260915
  (session_id, line_name, work_date, shift, old_a, old_p, old_oee, new_a, new_p, new_oee, repl_gap, dt_break_overlap_min)
select id, line_name, work_date, shift,
  oee_a, oee_p, oee,
  n_a, n_p,
  -- (6) OEE = A × P × Q ใหม่เสมอ · ขาดตัวใดตัวหนึ่ง = null (ห้ามเดา)
  case when n_a is not null and n_p is not null and oee_q is not null
       then round((n_a * n_p * oee_q / 10000)::numeric, 2) end,
  round(abs(a_old - oee_a)::numeric, 3), round(ov_min::numeric, 1)
from final
on conflict (session_id) do nothing;

update production_sessions ps
set oee_a = b.new_a,
    oee_p = b.new_p,
    oee   = b.new_oee
from oee_break_overlap_backfill_20260915 b
where b.session_id = ps.id;
