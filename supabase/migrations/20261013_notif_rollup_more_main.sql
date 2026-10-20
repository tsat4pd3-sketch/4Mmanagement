/* ══ 🔕 ยุบกระดิ่งเพิ่ม — เรื่องที่ท่วมแต่ไม่ได้ตั้งยุบไว้ (2026-10-13 · user "ลดจำนวนแจ้งเตือนที่ edge ยิงออกด้วย") ══
 *
 * วัด 7 วัน (Main · 13/10) — ใบ / อ่าน %:
 *   defect_recorded 676 / 10.8%   ojt_training 216 / 11.6%   quality_bin_added 68 / 0%
 *   pm_plan_reminder 192 / 10.4%  mtn_pickup_pending 278 / 14%  mtn_accept_pending 149 / 7.4%
 *   mtn_qa_pending 112 / 8.9%     "🚨 เครื่องยังหยุด เกิน N นาที" ~800 / ~14% — **event_key ว่างทุกใบ**
 *     (edge ไม่ใส่ event_key + ชื่อเรื่องมีเลขนาทีต่างกันทุกใบ ⇒ fn_notification_fill_link เดาไม่ออก)
 *     ⇒ edge แก้คู่กันแล้ว: ใส่ event_key + ไม่ยิงซ้ำให้คนที่ยังไม่อ่านใบของเครื่องเดียวกัน
 *
 * ใช้กลไกเดิมของ 20260925_notif_rollup_main.sql ทุกข้อ (ยุบเฉพาะใบยังไม่อ่าน · สมอที่ใบแรก · ต้องมี link)
 * `link` ที่ตั้ง = หน้ารวมของเรื่องนั้น (ตรงกับ ROUTES ใน send-push) — ใบเดี่ยวยังพาไปที่ ref ของตัวเองตามเดิม
 *
 * 🚫 ห้ามเปิดยุบให้ `downtime_call_mtn` (เรียกช่างด่วน — ทุกใบต้องดังของมันเอง) · ไฟล์นี้ไม่แตะแถวนั้น
 * ย้อนกลับ: update ... set inapp_rollup_min = null where event_key in (...)  (link ทิ้งไว้ได้ ไม่มีผลถ้าไม่ยุบ)
 * ปลายทาง: **Main (MAIN · ewhdfqwfwofivojtsizn)**
 * ══════════════════════════════════════════════════════════════════════════════════ */

-- เรื่องรายใบที่ไม่ด่วน — 3 ชม. (เท่าชุด mtn_* เดิม)
update public.notification_rules set inapp_rollup_min = 180, link = coalesce(link, '/daily-report')
 where event_key = 'defect_recorded';
update public.notification_rules set inapp_rollup_min = 180, link = coalesce(link, '/ojt-training')
 where event_key = 'ojt_training';
update public.notification_rules set inapp_rollup_min = 180, link = coalesce(link, '/qa?tab=bins')
 where event_key = 'quality_bin_added';

-- ตัวเตือนซ้ำของเครื่องที่ยังหยุด — 60 นาที: ใบแรกยังดังทันที ใบถัดๆ ไปในชั่วโมงเดียวกันนับรวม
update public.notification_rules set inapp_rollup_min = 60, link = coalesce(link, '/daily-report')
 where event_key = 'downtime_open_15min';

-- ตัวเตือนรอบวัน (ยิงเป็นชุดตามรอบ) — 12 ชม. = ไม่เกิน ~1 ใบ/คน/กะ
update public.notification_rules set inapp_rollup_min = 720
 where event_key in ('pm_plan_reminder', 'mtn_pickup_pending', 'mtn_accept_pending', 'mtn_qa_pending')
   and link is not null;
