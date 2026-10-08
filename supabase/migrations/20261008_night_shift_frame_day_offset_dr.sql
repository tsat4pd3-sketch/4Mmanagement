/* ══════════════════════════════════════════════════════════════════════════════════════════
   DR project — "Product DB" (eyhclzkifitbhbljgoav)

   คืนเวลาที่คนกรอกให้ตรงเจตนา สำหรับ **กะดึกที่บันทึกเวลาเริ่ม 00:00-07:59**
   ───────────────────────────────────────────────────────────────────────────────────────────
   ต้นเหตุ: โค้ดเคยประกอบ timestamp จาก `work_date + HH:MM` ตรงๆ (สำเนากฎ 11 จุดในรีโป)
     กะดึกที่ "เริ่ม 00:30 ของ work_date 25/09" จริงๆ คือ **26/09 00:30** (ก่อน 08:00 = วันก่อนหน้า
     ตามกฎ `getWorkDate()`) ⇒ ของที่เขียนลงฐาน **เร็วไป 1 วัน** แล้วตกนอกกรอบกะของตัวเอง
     แก้โค้ดแล้วด้วย `shiftStartDate()` (`src/utils/oee.js`) + ด่าน `shift-frame-start-via-helper`

   ขอบเขต: ทั้งฐานมี 1,521 กะ · เข้าข่าย `shift='night' AND start_time 00:00-07:59` = **5 กะ**
     (ไม่มีกะที่ `start_time`/`shift` เป็น null) ⇒ กะอื่นทั้งหมดไม่ถูกแตะ

   🔴 กติกา fail-closed — เลื่อน +1 วันเฉพาะค่าที่**พิสูจน์ได้ทั้ง 3 ข้อ**:
     1. `date_trunc('minute', ts) = ts` — ค่าที่คนกรอก HH:MM ลงนาทีกลม
        (ค่าที่ระบบ stamp เองมีเศษ ms เสมอ เช่น `confirmed_at` ⇒ **ไม่ถูกแตะ**)
     2. วันตามปฏิทินไทยของค่านั้น = `work_date` — คือยังเป็นค่าที่เก็บเร็วไป 1 วัน
     3. เลื่อน +1 วันแล้ว **ต้องตกในกรอบกะที่ถูกต้อง** [start, start+shift_min]
     ตกข้อใดข้อหนึ่ง = ไม่แตะ แล้วรายงาน (ดู §ที่ตั้งใจไม่แตะ ท้ายไฟล์)

   ผลที่คาด (ตรวจแล้วทั้งฝั่ง SQL และฝั่งสูตรจริง `computeSessionOee`):
     downtime_logs.started_at/ended_at  15 แถว (Laser GOR 23/09 ×4 · Assy LWR 25/09 ×11)
     prod_orders.opened_at               9 แถว (Assy LWR 25/09)
     prod_orders.stopped_at              1 แถว (Assy LWR 25/09)

   idempotent โดยโครงสร้าง: เลื่อนแล้วข้อ 2 เป็นเท็จทันที ⇒ รันซ้ำไม่ขยับอะไร
   ══════════════════════════════════════════════════════════════════════════════════════════ */

create schema if not exists archive;

/* ── ตารางย้อนกลับ (สำเนาข้อมูล ⇒ ต้องอยู่ schema `archive` ห้ามไว้ public) ─────────────── */
create table if not exists archive.fix_20261008_night_frame_day_offset (
  tbl          text        not null,
  row_id       uuid        not null,
  col          text        not null,
  old_value    timestamptz,
  new_value    timestamptz,
  fixed_at     timestamptz not null default now(),
  primary key (tbl, row_id, col)
);
alter table archive.fix_20261008_night_frame_day_offset enable row level security;
comment on table archive.fix_20261008_night_frame_day_offset is
  'ค่าก่อนแก้ของ migration 20261008 (กะดึกเริ่ม 00:00-07:59 · เวลาเก็บเร็วไป 1 วัน) — ใช้ย้อนกลับ';

/* ── กรอบกะที่ถูกต้องของ 5 กะที่เข้าข่าย ─────────────────────────────────────────────── */
create or replace view archive.v_20261008_night_frames as
select s.id, s.line_name, s.work_date, s.start_time, s.shift_min,
       (((s.work_date + 1) + s.start_time) at time zone 'Asia/Bangkok') as frame_start,
       (((s.work_date + 1) + s.start_time) at time zone 'Asia/Bangkok')
         + make_interval(mins => s.shift_min)                           as frame_end
from public.production_sessions s
where s.shift = 'night' and s.start_time >= '00:00' and s.start_time < '08:00';

/* ── เก็บค่าก่อนแก้ ───────────────────────────────────────────────────────────────────── */
insert into archive.fix_20261008_night_frame_day_offset (tbl, row_id, col, old_value, new_value)
select 'downtime_logs', d.id, 'started_at', d.started_at, d.started_at + interval '1 day'
from public.downtime_logs d join archive.v_20261008_night_frames f on f.id = d.session_id
where d.started_at is not null
  and date_trunc('minute', d.started_at) = d.started_at
  and (d.started_at at time zone 'Asia/Bangkok')::date = f.work_date
  and d.started_at + interval '1 day' between f.frame_start and f.frame_end
on conflict do nothing;

insert into archive.fix_20261008_night_frame_day_offset (tbl, row_id, col, old_value, new_value)
select 'downtime_logs', d.id, 'ended_at', d.ended_at, d.ended_at + interval '1 day'
from public.downtime_logs d join archive.v_20261008_night_frames f on f.id = d.session_id
where d.ended_at is not null
  and d.started_at is not null
  and date_trunc('minute', d.started_at) = d.started_at
  and (d.started_at at time zone 'Asia/Bangkok')::date = f.work_date
  and d.started_at + interval '1 day' between f.frame_start and f.frame_end
on conflict do nothing;

insert into archive.fix_20261008_night_frame_day_offset (tbl, row_id, col, old_value, new_value)
select 'prod_orders', o.id, 'opened_at', o.opened_at, o.opened_at + interval '1 day'
from public.prod_orders o join archive.v_20261008_night_frames f on f.id = o.session_id
where o.opened_at is not null
  and date_trunc('minute', o.opened_at) = o.opened_at
  and (o.opened_at at time zone 'Asia/Bangkok')::date = f.work_date
  and o.opened_at + interval '1 day' between f.frame_start and f.frame_end
on conflict do nothing;

insert into archive.fix_20261008_night_frame_day_offset (tbl, row_id, col, old_value, new_value)
select 'prod_orders', o.id, 'stopped_at', o.stopped_at, o.stopped_at + interval '1 day'
from public.prod_orders o join archive.v_20261008_night_frames f on f.id = o.session_id
where o.stopped_at is not null
  and date_trunc('minute', o.stopped_at) = o.stopped_at
  and (o.stopped_at at time zone 'Asia/Bangkok')::date = f.work_date
  and o.stopped_at + interval '1 day' between f.frame_start and f.frame_end
on conflict do nothing;

/* ── 🔴 ด่าน fail-closed: จำนวนแถวต้องเท่าที่ตรวจไว้ ไม่งั้นล้มทั้ง migration ─────────── */
do $$
declare n_dt int; n_od int; n_sp int;
begin
  select count(*) into n_dt from archive.fix_20261008_night_frame_day_offset
   where tbl='downtime_logs' and col='started_at';
  select count(*) into n_od from archive.fix_20261008_night_frame_day_offset
   where tbl='prod_orders' and col='opened_at';
  select count(*) into n_sp from archive.fix_20261008_night_frame_day_offset
   where tbl='prod_orders' and col='stopped_at';
  if (n_dt, n_od, n_sp) <> (15, 9, 1) then
    raise exception 'ขอบเขตไม่ตรงที่ตรวจไว้: downtime.started_at=% (คาด 15) · opened_at=% (คาด 9) · stopped_at=% (คาด 1) — หยุด ห้ามเดา', n_dt, n_od, n_sp;
  end if;
end $$;

/* ── เลื่อนเวลา ───────────────────────────────────────────────────────────────────────── */
update public.downtime_logs d
   set started_at = r.new_value
  from archive.fix_20261008_night_frame_day_offset r
 where r.tbl = 'downtime_logs' and r.col = 'started_at'
   and d.id = r.row_id and d.started_at = r.old_value;

update public.downtime_logs d
   set ended_at = r.new_value
  from archive.fix_20261008_night_frame_day_offset r
 where r.tbl = 'downtime_logs' and r.col = 'ended_at'
   and d.id = r.row_id and d.ended_at = r.old_value;

update public.prod_orders o
   set opened_at = r.new_value
  from archive.fix_20261008_night_frame_day_offset r
 where r.tbl = 'prod_orders' and r.col = 'opened_at'
   and o.id = r.row_id and o.opened_at = r.old_value;

update public.prod_orders o
   set stopped_at = r.new_value
  from archive.fix_20261008_night_frame_day_offset r
 where r.tbl = 'prod_orders' and r.col = 'stopped_at'
   and o.id = r.row_id and o.stopped_at = r.old_value;

/* ══════════════════════════════════════════════════════════════════════════════════════════
   §ที่ตั้งใจไม่แตะ (fail-closed — บันทึกไว้ให้ session ถัดไปไม่ต้องเดาซ้ำ)

   1. **Assy LWR 30/09 — downtime 2 แถว เวลา 22:40 / 23:00**
      กรอบกะที่ถูกคือ 01/10 00:00-08:00 ⇒ 22:40 อยู่นอกกรอบ **ทั้งก่อนและหลังแก้**
      (เลื่อน +1 วันก็ยังนอกกรอบ) · `confirmed_at` ใบแรกของกะนี้อยู่ 30/09 23:45 ด้วย
      ⇒ น่าจะกรอก `start_time` ผิด (กะเริ่มเย็น 30/09 จริง) — **คนต้องตัดสิน ไม่ใช่ migration**
      ทั้ง 2 แถวเป็น `planned` ⇒ ไม่กระทบ %A อยู่แล้ว

   2. **Laser LWR 30/09 — downtime 2 แถว เก็บไว้ 01/10 อยู่แล้ว** (day_diff = +1) ⇒ ถูกต้องแล้ว

   3. **Laser GOR 23/09 — `prod_orders.opened_at` = 23/09 13:30 (เวลาไทย)**
      ลงนาทีกลม + วันตรง work_date แต่เลื่อน +1 วันแล้วได้ 24/09 13:30 = **นอกกรอบ 01:00-08:00**
      ⇒ เป็นความเพี้ยนคนละแบบ (ไม่ใช่ +1 วัน) · ข้อ 3 กันไว้เอง ไม่ถูกแตะ

   4. **`prod_orders.confirmed_at` ทุกใบ** — มีเศษ ms = ระบบ stamp เวลาจริง (บางใบกรอกย้อนหลัง
      ถึง +7 วัน เช่นใบที่เปิดวันที่ 07/10) ⇒ ข้อ 1 กันไว้ **ห้ามเลื่อนเด็ดขาด**

   5. **LINE C (200&250 Ton) 05/10** — กะเปิด 07:40 ปิด 07:41 `shift_min=1` · ไม่มีใบ/ไม่มี
      downtime · `oee_*` เป็น null ทั้งแถว = กะที่เปิดผิดแล้วปิดทิ้ง **ไม่มีอะไรให้แก้**

   ══════════════════════════════════════════════════════════════════════════════════════════
   §วิธีย้อนกลับ (DR — "Product DB")

   update public.downtime_logs d set started_at = r.old_value
     from archive.fix_20261008_night_frame_day_offset r
    where r.tbl='downtime_logs' and r.col='started_at' and d.id=r.row_id and d.started_at=r.new_value;
   update public.downtime_logs d set ended_at = r.old_value
     from archive.fix_20261008_night_frame_day_offset r
    where r.tbl='downtime_logs' and r.col='ended_at' and d.id=r.row_id and d.ended_at=r.new_value;
   update public.prod_orders o set opened_at = r.old_value
     from archive.fix_20261008_night_frame_day_offset r
    where r.tbl='prod_orders' and r.col='opened_at' and o.id=r.row_id and o.opened_at=r.new_value;
   update public.prod_orders o set stopped_at = r.old_value
     from archive.fix_20261008_night_frame_day_offset r
    where r.tbl='prod_orders' and r.col='stopped_at' and o.id=r.row_id and o.stopped_at=r.new_value;
   -- แล้วคืนค่า OEE ตาม migration 20261008b (ตารางย้อนกลับของมันแยกไฟล์)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
