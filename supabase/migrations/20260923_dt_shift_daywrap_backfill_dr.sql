/*  ═══════════════════════════════════════════════════════════════════════════════════════
    BACKFILL — downtime ที่ถูก anchor ผิด "วัน" จากบั๊กกฎเลื่อนวันของกะดึก
    project: DR / "Product DB"  (eyhclzkifitbhbljgoav)          วันที่: 2026-09-23
    ⚠️ ยังไม่ apply — รอ user เคาะ (ดู docs/modules/daily-report.md §เวลาที่กรอกต้องอยู่ในกรอบกะ)
    ═══════════════════════════════════════════════════════════════════════════════════════

    ต้นเหตุ (แก้ในโค้ดแล้ว — `resolveShiftTime()` ใน src/utils/shiftWindow.js):
      `buildDT`/`backfillIsoFromTime`/`carryImportOpenedAt` เดิม hardcode
        `shift === 'night' && ชั่วโมง < 8  →  +1 วัน`
      ซึ่งพลาด 2 ทาง:
        1. กะดึก**จบ 08:00 หรือเลยไป** ⇒ คนกรอก 5ส./ส่งกะ "08:00"/"08:30" ไม่เข้าเงื่อนไข `< 8`
           → ถูกวางไว้วันเดียวกับ work_date = ก่อนเปิดกะ ~12 ชม.
        2. เช็คจาก **ป้ายกะ** (`shift`) ไม่ใช่เวลาเปิดจริง ⇒ session ที่ป้ายเป็น 'day' แต่เปิด 22:30
           (LINE APRON ASSY 29/06) เวลาหลังเที่ยงคืนไม่ถูกเลื่อนวันเลยทั้งกะ

    เลือกเฉพาะแถวที่ **แก้ได้แบบไม่ต้องเดาใจคน**: เวลาเดิมอยู่ก่อนเปิดกะ แต่ "+1 วัน" แล้ว
    ตกในกรอบกะพอดี ⇒ คนกรอกถูกแล้ว โค้ดวางผิดวันเอง (17 แถว)
      · 16 แถว = LINE APRON ASSY 29/06 (เปิด 22:30 ป้ายกะ 'day')
      · 1 แถว  = Assy LWR 21/07 กะดึก "08:00" Set up Machine
    **ไม่แตะ** แถวที่เข้าข่าย AM/PM สลับ (±12 ชม.) — นั่นคือการเดาเจตนาคน ต้องให้คนยืนยันเป็นใบๆ

    ── ROLLBACK ────────────────────────────────────────────────────────────────────────────
      update downtime_logs d set started_at = b.old_started_at, ended_at = b.old_ended_at
      from dt_daywrap_backfill_20260923 b where b.id = d.id;
    ═══════════════════════════════════════════════════════════════════════════════════════ */

create table if not exists dt_daywrap_backfill_20260923 (
  id uuid primary key,
  line_name text, work_date date, shift text, start_time time,
  old_started_at timestamptz, old_ended_at timestamptz,
  new_started_at timestamptz, new_ended_at timestamptz,
  applied_at timestamptz not null default now()
);
-- ฝั่ง DR เป็น anon-open ทั้ง project ⇒ ตารางงานภายในต้องปิดด้วย RLS ที่ไม่มี policy
alter table dt_daywrap_backfill_20260923 enable row level security;

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
)
insert into dt_daywrap_backfill_20260923
  (id, line_name, work_date, shift, start_time, old_started_at, old_ended_at, new_started_at, new_ended_at)
select d.id, sw.line_name, sw.work_date, sw.shift, sw.start_time,
       d.started_at, d.ended_at,
       d.started_at + interval '1 day',
       case when d.ended_at is not null then d.ended_at + interval '1 day' end
from downtime_logs d
join sw on sw.id = d.session_id
where d.started_at is not null
  and d.started_at < sw.ss                                        -- ก่อนเปิดกะ
  and d.started_at + interval '1 day' between sw.ss and sw.se     -- +1 วันแล้วเข้ากรอบพอดี
on conflict (id) do nothing;

update downtime_logs d
set started_at = b.new_started_at,
    ended_at   = coalesce(b.new_ended_at, d.ended_at)
from dt_daywrap_backfill_20260923 b
where b.id = d.id;
