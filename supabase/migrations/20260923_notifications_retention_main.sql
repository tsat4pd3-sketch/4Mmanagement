-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ══ 🔔 นโยบายเก็บย้อนหลังของตาราง `notifications` (ตารางใหญ่ที่สุดของระบบ) ══════════
-- 2026-09-23 · ต่อจากรายการ "ไม่มีนโยบายลบย้อนหลัง" ใน docs/modules/schema-map.md §7.5
--
-- ── ตัวเลขจริงที่วัดก่อนตั้งนโยบาย (23/09) ─────────────────────────────────────────
--   84,247 แถว · 93 MB (heap 84 MB + index 9 MB) = **ตารางใหญ่สุดของทั้ง 2 project**
--   โตวันละ ~2,725 แถว · แถวเก่ากว่า 90 วันมีแค่ 1,150 แถว
--   ⇒ **ตารางไม่ได้ใหญ่เพราะสะสมมานาน แต่ใหญ่เพราะอัตราการยิงวันนี้** (30 วันล่าสุด = 97% ของทั้งตาราง)
--      ตั้ง retention 30 วันจึงได้ขนาดเท่าเดิมเป๊ะ = ไม่ช่วยอะไร ต้องสั้นกว่านั้น
--
-- ── ทำไม 7 วัน (อ่านแล้ว) / 14 วัน (ยังไม่อ่าน) ถึงพอ ────────────────────────────
--   กระดิ่งในแอป (`src/App.jsx`) ดึง **30 รายการล่าสุดต่อคน** ไม่มีหน้าประวัติแจ้งเตือนย้อนหลังเลย
--   หัวหน้าไลน์คนหนึ่งได้รับ ~50-100 แถว/วัน ⇒ 30 รายการนั้นครอบคลุม **ไม่ถึง 1 วัน**
--   แถวที่เก่ากว่า 14 วันจึงมองไม่เห็นจากจอไหนอยู่แล้ว และคนเปิดอ่านจริงแค่ 8%
--   ⚠️ แจ้งเตือน = "ป้ายสะกิด" ไม่ใช่บันทึกความจริง — ตัวใบงานจริงอยู่ใน mtn_orders /
--      downtime_logs / four_m_logs ฯลฯ ซึ่งไม่ถูกแตะ ลบแถวนี้ไม่ทำให้สอบกลับอะไรหาย
--
-- 🔴 กันคนใช้งานน้อยกระดิ่งว่างเปล่า: **เก็บ 30 แถวล่าสุดของทุกคนไว้เสมอ ไม่ว่าจะเก่าแค่ไหน**
--    (= จำนวนที่กระดิ่งแสดงพอดี) · role อย่าง sale/document_control ได้แจ้งเตือนเดือนละไม่กี่ใบ
--    ตัดตามวันอย่างเดียวจะทำให้กระดิ่งของคนกลุ่มนี้ว่างสนิท
--
-- ผลที่คาด: ลบรอบแรก 32,309 แถว (38%) · เหลือ 51,938 · สถานะคงตัว ~40,000 แถว ≈ 45 MB
--   ⚠️ ขนาดไฟล์บนดิสก์ไม่หดทันที (autovacuum คืนพื้นที่ให้ "ใช้ซ้ำ" ไม่ได้คืนให้ OS)
--      แต่มันหยุดโต ซึ่งคือสิ่งที่ต้องการ — **ห้ามสั่ง `vacuum full` บนตารางนี้** (ล็อกทั้งตาราง)
--
-- ⚠️ นี่คือ "ฝาปิด" ไม่ใช่ "ทางแก้" — ต้นเหตุจริงคือผู้รับต่อเหตุการณ์เฉลี่ย 30 คน
--    ดูการแก้ฝั่งต้นทางใน docs/modules/notifications-flood.md

-- 1) ล้างของเก่าทันที
with ranked as (
  select id, row_number() over (partition by user_id order by created_at desc) rn,
         is_read, created_at
    from public.notifications
)
delete from public.notifications n
 using ranked r
 where r.id = n.id and r.rn > 30
   and ((r.is_read and r.created_at < now() - interval '7 days')
     or (not r.is_read and r.created_at < now() - interval '14 days'));

-- 2) ตั้ง job ล้างอัตโนมัติทุกวัน กันโตกลับ
--    17:45 UTC = 00:45 ไทย (pg_cron ใช้ UTC เสมอ) — เลี่ยงชน purge-audit-log 17:30 · purge-cron-logs 18:00
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-notifications') then
    perform cron.unschedule('purge-notifications');
  end if;
end $$;

select cron.schedule(
  'purge-notifications',
  '45 17 * * *',
  $$
  with ranked as (
    select id, row_number() over (partition by user_id order by created_at desc) rn,
           is_read, created_at
      from public.notifications
  )
  delete from public.notifications n
   using ranked r
   where r.id = n.id and r.rn > 30
     and ((r.is_read and r.created_at < now() - interval '7 days')
       or (not r.is_read and r.created_at < now() - interval '14 days'))
  $$
);

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
--   select count(*), pg_size_pretty(pg_total_relation_size('public.notifications'))
--     from public.notifications;
--   select jobname, schedule, active from cron.job where jobname = 'purge-notifications';
--   -- กระดิ่งของคนใช้งานน้อยต้องไม่ว่าง:
--   select user_id, count(*) from public.notifications group by 1 order by 2 asc limit 5;   -- ต่ำสุดต้อง ≥ 1
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   select cron.unschedule('purge-notifications');
--   (แถวที่ลบไปแล้วกู้ไม่ได้ — เป็นป้ายสะกิดที่กระดิ่งมองไม่เห็นอยู่แล้ว ไม่ใช่ข้อมูลการผลิต)
