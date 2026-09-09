-- ══════════════════════════════════════════════════════════════════════════
-- ตารางกะ — seed ต่อรอบสลับกะอัตโนมัติให้ PD1 / PD2 / PD4            2026-09-09
-- Project: Main (ewhdfqwfwofivojtsizn · ชื่อในจอ "MAIN")
--
-- ที่มา (คำสั่ง user 2026-09-09 · รอบตรวจ feedback เช้า):
--   PD1/PD2/PD4 มีตารางกะถึงแค่ 2026-09-06 แล้วหยุด → พนักงานตกจากทั้งกะเช้าและกะดึก
--   (resolveAssignedShift คืน null) → **Dashboard/กำลังคนของส่วนงานนั้นขึ้น 0 ทั้งที่คนมาทำงานเต็ม**
--   วัดจริง 09/09: PD2 เช็คชื่อ 16 คน · PD4 28 คน แต่ไลน์ที่มีตารางกะ = 0 ทั้งคู่
--   เป็นเหตุการณ์ซ้ำรอบที่ 3 (28/08 · 31/08 · 09/09) — user สั่งว่า "ให้ seed ให้ จากข้อมูลที่เคยเห็น
--   เพราะ default จะสลับกะทุกๆ 2 สัปดาห์"
--
-- รูปแบบที่ถอดจากข้อมูลจริง (ไม่ได้เดา — ยืนยันกับ PD3 ที่ตั้งล่วงหน้าไว้ถึง 2027-01-03):
--   • สลับทีมกะทุก 14 วัน ตรงกับ**วันจันทร์**เสมอ
--   • จุดสลับจริงในฐาน: 2026-08-31 · 09-14 · 09-28 · 10-12 · 10-26 · 11-09 · 11-23 · 12-07 · 12-21 (dow=1 ทุกตัว)
--   • บล็อกปัจจุบัน = 2026-08-31 → 2026-09-13 · anchor ต่อไลน์ = แถวสุดท้ายที่มีอยู่ (2026-09-06)
--   • ทีมกะ ณ anchor: PD1 = B (5 ไลน์) · PD2 = B (6 ไลน์) · PD4 = A (7 ไลน์)
--
-- ขอบเขต: เติม 2026-09-07 → 2027-01-03 (ให้จบพร้อม PD3 — ทุกส่วนงานจะหมดอายุพร้อมกัน
--          ตัวสแกนเตือนกะใกล้หมด (cron 07:30 · commit 6ca6100) จะเตือนทุกส่วนงานรอบเดียว)
--
-- ⚠️ ปลอดภัยกับของเดิม:
--   • `on conflict (work_date, line_id) do nothing` — แถวที่มีอยู่แล้ว/ที่คนตั้งเองไม่ถูกแตะ
--   • คัดลอก `is_manual` ของแต่ละไลน์จาก anchor มาตรงๆ → ความสัมพันธ์ไลน์แม่-ลูก (inherit vs ตั้งเอง) ไม่เปลี่ยน
--     (PD4: Assy LWR · Assy GOR · Laser GOR · Laser LWR เป็น is_manual=true อยู่แล้ว — คงไว้)
--   • ไม่แตะ schema · ไม่แตะ RLS · เป็น data seed ล้วน
--   • หัวหน้าแผนกยังแก้ทับได้ตามปกติที่ /shift-organize (เซฟทับแถวเดิม)
-- ══════════════════════════════════════════════════════════════════════════

insert into public.shift_schedules (work_date, line_id, day_team, is_manual, note)
select
  d::date,
  a.line_id,
  -- สลับทุก 14 วันจากบล็อกของ anchor: บล็อกคู่ = ทีมเดิม · บล็อกคี่ = สลับ
  case ((floor((d::date - date '2026-08-31')::numeric / 14)
       - floor((a.anchor_date - date '2026-08-31')::numeric / 14))::int % 2)
    when 0 then a.day_team
    else case a.day_team when 'A' then 'B' else 'A' end
  end,
  a.is_manual,
  'seed 2026-09-09: ต่อรอบสลับกะ 14 วัน (บล็อกอ้างอิง 2026-08-31) — แก้ทับได้ที่ /shift-organize'
from (
  -- anchor = แถวล่าสุดของแต่ละไลน์ (ทีมกะ + is_manual ที่ใช้อยู่จริง)
  select distinct on (s.line_id)
         s.line_id, s.day_team, s.is_manual, s.work_date as anchor_date
  from public.shift_schedules s
  join public.production_lines l on l.id = s.line_id
  where l.is_active and l.section in ('PD1', 'PD2', 'PD4')
  order by s.line_id, s.work_date desc
) a
cross join generate_series(date '2026-09-07', date '2027-01-03', interval '1 day') d
on conflict (work_date, line_id) do nothing;

-- ตรวจผลหลังรัน (MAIN):
--   -- 1) ทุกส่วนงานต้องมีตารางกะถึง 2027-01-03
--   select l.section, max(s.work_date) last_day
--     from production_lines l left join shift_schedules s on s.line_id = l.id
--    where l.is_active and l.section <> 'TEST' group by 1 order by 1;
--   -- 2) จุดสลับของ PD1/PD2/PD4 ต้องตรงกับ PD3 (จันทร์เว้นจันทร์)
--   select work_date, count(*) from (
--     select s.work_date, s.line_id, s.day_team,
--            lag(s.day_team) over (partition by s.line_id order by s.work_date) prev
--       from shift_schedules s join production_lines l on l.id = s.line_id
--      where l.section in ('PD1','PD2','PD4') and s.work_date >= '2026-09-01') t
--    where prev is distinct from day_team and prev is not null group by 1 order by 1;
--
-- Rollback (ลบเฉพาะแถวที่ seed รอบนี้ — ของเดิมและที่คนแก้ทีหลังไม่โดน):
--   delete from public.shift_schedules
--    where note like 'seed 2026-09-09:%' and work_date >= '2026-09-07';
