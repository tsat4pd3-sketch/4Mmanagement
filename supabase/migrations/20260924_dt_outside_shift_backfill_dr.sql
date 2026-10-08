/*  ═══════════════════════════════════════════════════════════════════════════════════════
    BACKFILL — downtime ที่เวลา "หลุดกรอบกะ"  (คำสั่ง user 2026-09-24 "แก้ให้หมดทั้ง 86 แถว")
    project: DR / "Product DB"  (eyhclzkifitbhbljgoav)
    ═══════════════════════════════════════════════════════════════════════════════════════

    ต้นเหตุ 2 ตัว (แก้ในโค้ดแล้ว 23/09 — `src/utils/shiftWindow.js`):
      A) กฎเลื่อนวัน hardcode `shift === 'night' && ชั่วโมง < 8` ⇒ กะดึกที่จบ 08:00+ และ session
         ที่ป้ายกะไม่ตรงเวลาเปิดจริง ถูก anchor ผิด "วัน"
      B) ไม่มีด่านตรวจกรอบกะ ⇒ AM/PM สลับ (จอ 12 ชม. ไม่แตะช่อง AM/PM = ค้างที่ AM) ไหลเข้าฐาน

    ไล่ทั้งฐาน 9,664 แถว → 86 แถวที่ `started_at` อยู่ก่อนเวลาเปิดกะ · แยกเป็น 3 กลุ่ม:
      1. **+1 วันแล้วเข้ากรอบพอดี = 17 แถว**  → บั๊ก A ล้วน คนกรอกถูก โค้ดวางผิดวัน
      2. **+12/−12 ชม. แล้วเข้ากรอบพอดี = 54 แถว** → ลายเซ็น AM/PM สลับ (บั๊ก B)
      3. เหลือ 15 แถว **ไม่แตะในไฟล์นี้** — ตรวจรายใบแล้วพบว่า*เวลา downtime น่าจะถูกอยู่แล้ว*
         แต่ **`production_sessions.start_time` ของกะนั้นผิด** (เปิดกะเป็น 22:30 ทั้งที่ทีมเข้า OT
         ตั้งแต่ 20:00) ⇒ ต้องแก้ที่เวลาเปิดกะ ซึ่งกระทบ `shift_min`/OEE ที่ stamp ไว้ — คนละงาน

    ไฟล์นี้แทนที่ `20260923_dt_shift_daywrap_backfill_dr.sql` (ซึ่งครอบเฉพาะกลุ่ม 1 และยังไม่เคย apply)

    ── ROLLBACK ────────────────────────────────────────────────────────────────────────────
      update downtime_logs d set started_at = b.old_started_at, ended_at = b.old_ended_at
      from archive.dt_outside_shift_backfill_20260924 b where b.id = d.id;
    (ห้าม drop ตารางสำรองจนกว่าจะมั่นใจ)
    ═══════════════════════════════════════════════════════════════════════════════════════ */

-- 🔴 ตารางสำรองต้องอยู่ schema `archive` ห้ามไว้ใน public (มีด่าน regressionGuards)
create schema if not exists archive;
create table if not exists archive.dt_outside_shift_backfill_20260924 (
  id uuid primary key,
  line_name text, work_date date, shift text, start_time time,
  fix_kind text,                              -- 'day_wrap' | 'ampm_12h'
  shift_ms  numeric,                          -- ส่วนต่างที่เลื่อน (นาที) — ตรวจย้อนได้
  old_started_at timestamptz, old_ended_at timestamptz,
  new_started_at timestamptz, new_ended_at timestamptz,
  applied_at timestamptz not null default now()
);
alter table archive.dt_outside_shift_backfill_20260924 enable row level security;

with s as (
  select id, line_name, work_date, shift, start_time, shift_min, end_time,
         (work_date + start_time) at time zone 'Asia/Bangkok' ss
  from production_sessions where start_time is not null
),
sw as (
  select s.*, case
    when end_time is not null then
      (case when (work_date + end_time) at time zone 'Asia/Bangkok' <= ss
            then ((work_date + end_time) at time zone 'Asia/Bangkok') + interval '1 day'
            else (work_date + end_time) at time zone 'Asia/Bangkok' end)
    when shift_min > 0 then ss + (shift_min || ' min')::interval
    else ss + interval '16 hours'      -- กะยังไม่ปิด: เพดานความยาวกะ (MAX_SHIFT_MIN)
  end se from s
),
cand as (
  select d.id, sw.line_name, sw.work_date, sw.shift, sw.start_time,
         d.started_at, d.ended_at,
         -- ลำดับสำคัญ: เช็ค +1 วันก่อน (บั๊กโค้ดล้วน) แล้วค่อย ±12 ชม. (เดาจากลายเซ็น AM/PM)
         case when d.started_at + interval '1 day'   between sw.ss and sw.se then interval '1 day'
              when d.started_at + interval '12 hours' between sw.ss and sw.se then interval '12 hours'
              when d.started_at - interval '12 hours' between sw.ss and sw.se then -interval '12 hours'
         end as shift_by
  from downtime_logs d
  join sw on sw.id = d.session_id
  where d.started_at is not null and d.started_at < sw.ss
)
insert into archive.dt_outside_shift_backfill_20260924
  (id, line_name, work_date, shift, start_time, fix_kind, shift_ms,
   old_started_at, old_ended_at, new_started_at, new_ended_at)
select id, line_name, work_date, shift, start_time,
  case when shift_by = interval '1 day' then 'day_wrap' else 'ampm_12h' end,
  extract(epoch from shift_by) / 60,
  started_at, ended_at,
  started_at + shift_by,
  case when ended_at is not null then ended_at + shift_by end
from cand
where shift_by is not null
on conflict (id) do nothing;

update downtime_logs d
set started_at = b.new_started_at,
    ended_at   = coalesce(b.new_ended_at, d.ended_at)
from archive.dt_outside_shift_backfill_20260924 b
where b.id = d.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- รอบ 2 (24/09) — บั๊กเลื่อนวันตัวเดียวกัน แต่ +1 วันแล้ว "เลยเวลาปิดกะไปนิดเดียว"
-- เคสจริง: กะดึกปิด 08:00 พนักงานลงหยุด 08:30 ตอนส่งกะ → กฎเก่า (hour < 8) ไม่บวกวัน
-- ⇒ ตกไปอยู่ก่อนเปิดกะ 14 ชม. · ผ่อนผันท้ายกะ 60 นาที (ลงตอนส่งกะ = ปกติของหน้างาน)
-- ─────────────────────────────────────────────────────────────────────────────
with s as (
  select id, line_name, work_date, shift, start_time, shift_min, end_time,
         (work_date + start_time) at time zone 'Asia/Bangkok' ss
  from production_sessions where start_time is not null),
sw as (
  select s.*, case
    when end_time is not null then (case when (work_date+end_time) at time zone 'Asia/Bangkok' <= ss
         then ((work_date+end_time) at time zone 'Asia/Bangkok') + interval '1 day'
         else (work_date+end_time) at time zone 'Asia/Bangkok' end)
    when shift_min > 0 then ss + (shift_min||' min')::interval
    else ss + interval '16 hours' end se
  from s),
cand as (
  select d.id, sw.line_name, sw.work_date, sw.shift, sw.start_time, d.started_at, d.ended_at
  from downtime_logs d join sw on sw.id = d.session_id
  where d.started_at is not null and d.started_at < sw.ss
    and d.started_at + interval '1 day' between sw.ss and sw.se + interval '60 min')
insert into archive.dt_outside_shift_backfill_20260924
  (id, line_name, work_date, shift, start_time, fix_kind, shift_ms,
   old_started_at, old_ended_at, new_started_at, new_ended_at)
select id, line_name, work_date, shift, start_time, 'day_wrap_grace', 1440,
       started_at, ended_at, started_at + interval '1 day',
       case when ended_at is not null then ended_at + interval '1 day' end
from cand
on conflict (id) do nothing;

update downtime_logs d
set started_at = b.new_started_at,
    ended_at   = coalesce(b.new_ended_at, d.ended_at)
from archive.dt_outside_shift_backfill_20260924 b
where b.id = d.id and b.fix_kind = 'day_wrap_grace';

-- ผลรวมที่รันจริง 24/09: ampm_12h 53 · day_wrap 17 · day_wrap_grace 1 = 71 แถว
-- เหลือนอกกรอบ 16 แถว (ก่อนเปิดกะ 14 · หลังปิดกะ 2) — คนละสาเหตุ ดู docs/modules/daily-report.md
