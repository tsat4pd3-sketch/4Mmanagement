/* ══ 🔕 ยุบกระดิ่งรอบ 2 (2026-10-21 · user "ทำทั้ง 4 ข้อเลย" หลังวัดผล 7 วันของรอบ 13/10) ══
 *
 * วัด 13→20/10 (Main): ยุบรอบแรกทำงานจริง (8 เรื่องเป้าหมาย เหตุการณ์ ×2 แต่แถว +8%) แต่กระดิ่งรวมยังท่วมจาก:
 *   1. shipping_phase_alert 43 → 1,030 แถว · ส่งแค่ 9 คน (~115/คน/สัปดาห์) · อ่าน 1% · **ไม่ได้ตั้งยุบ**
 *   2. mtn_* — แก้ที่ edge `send-mtn-notification` v27 (ทีม production = เฉพาะคนของไลน์นั้น) · ไฟล์นี้ไม่แตะ
 *   3. ตัวที่ไม่มี event_key (ยุบไม่ได้): "ผลการตรวจได้รับการอนุมัติ" 165 · "พบผลตรวจไม่ผ่าน (NG)" 91 ·
 *      "🗓️ ตารางกะหมดแล้ว/กำลังจะหมด" 58 — ตัวส่ง (PMCheckData / shift gap job) ไม่ใส่ event_key
 *      ⇒ ให้ `fn_notification_fill_link` เติม event_key จาก `title_match` (กลไกเดิม) แล้วตั้งยุบ
 *   4. pm_plan_reminder อ่าน 2% · 12 ชม. ยังเหลือ ~2 ใบ/คน/วัน ⇒ 24 ชม. = วันละใบ (ใบเดียวรวมทั้งวัน)
 *
 * กลไก = `fn_notification_rollup` เดิม (ยุบเฉพาะใบยังไม่อ่าน · สมอที่ใบแรก · ต้องมี link ที่ rule)
 * 🚫 ไม่แตะ downtime_call_mtn (เรียกช่างด่วน — ทุกใบต้องดังของมันเอง)
 * ปลายทาง: **Main (MAIN · ewhdfqwfwofivojtsizn)**
 * ย้อนกลับ: ดูบล็อก ROLLBACK ท้ายไฟล์
 * ══════════════════════════════════════════════════════════════════════════════════ */

-- 1) งานส่งหลุดเฟส — 4 ชม. (ไม่เกิน ~3 ใบ/คน/กะ · ใบแรกของรอบยังดังทันที)
update public.notification_rules set inapp_rollup_min = 240
 where event_key = 'shipping_phase_alert' and link is not null;

-- 3) ผลตรวจ PM (PMCheckData.jsx ใส่ title ตายตัว) + ตารางกะใกล้หมด — ให้ trigger เติม event_key ได้
insert into public.notification_rules (event_key, label, category, is_enabled, sort_order, title_match, link, inapp_rollup_min)
values
  ('pm_inspection_approved', 'ผลตรวจอุปกรณ์ได้รับการอนุมัติ (แจ้งผู้ตรวจ)', 'maintenance', true, 40,
   'ผลการตรวจได้รับการอนุมัติ%', '/pm?tab=check', 180),
  ('pm_inspection_ng', 'ตรวจอุปกรณ์พบ NG (แจ้งทีมเจ้าของอุปกรณ์)', 'maintenance', true, 41,
   'พบผลตรวจไม่ผ่าน (NG)%', '/pm?tab=check', 60)
on conflict (event_key) do update
  set title_match = excluded.title_match, link = coalesce(public.notification_rules.link, excluded.link),
      inapp_rollup_min = excluded.inapp_rollup_min;

update public.notification_rules
   set title_match = coalesce(title_match, '🗓️ ตารางกะ%'), link = coalesce(link, '/shift-organize'), inapp_rollup_min = 1440
 where event_key = 'shift_schedule_gap';

-- 4) เตือนรอบ PM — วันละใบ/คน (ใบเดียวรวมทุกแผนที่ใกล้ครบในวันนั้น)
update public.notification_rules set inapp_rollup_min = 1440
 where event_key = 'pm_plan_reminder' and link is not null;

/* ── ตรวจผล ──
select event_key, title_match, link, inapp_rollup_min from notification_rules
 where event_key in ('shipping_phase_alert','pm_inspection_approved','pm_inspection_ng','shift_schedule_gap','pm_plan_reminder');

── ROLLBACK ──
update notification_rules set inapp_rollup_min = null where event_key = 'shipping_phase_alert';
update notification_rules set inapp_rollup_min = 720  where event_key = 'pm_plan_reminder';
update notification_rules set inapp_rollup_min = null, title_match = null, link = null where event_key = 'shift_schedule_gap';
delete from notification_rules where event_key in ('pm_inspection_approved','pm_inspection_ng');
*/
