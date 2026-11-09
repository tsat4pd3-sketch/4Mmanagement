/* 🔔 "ผจก.แผนกอนุมัติใบซ่อม — รอ ผจก.ซ่อมบำรุงปิดใบ" ยุบได้ + กดแล้วไปถึงใบ  (MAIN · 2026-11-09)

   วัด 30 วัน: **1,188 แถว / 42 คน / อ่าน 1%** — และ rule นี้ **ไม่มีทั้ง `link` และ `inapp_rollup_min`**
   ⇒ (ก) กระดิ่งกดแล้วไม่พาไปไหน  (ข) `fn_notification_rollup()` ข้ามทันที (ต้องมี link ถึงจะยุบ)
      ⇒ ใบที่อนุมัติรัวๆ ในรอบเดียวเด้งทีละใบ
   180 นาที = ชุดเดียวกับพี่น้องในโมดูล MTN (mtn_closed / mtn_handover)

   🔴 **ห้ามเอาสูตรนี้ไปใช้กับ `downtime_call_mtn`** — "เรียกช่างครั้งแรก ทุกใบต้องดัง"
      (คอมเมนต์ใน supabase/functions/send-notification/index.ts)
      ยุบ = เครื่องหยุด 2 ตัวกลายเป็นใบเดียว = ช่างไปไม่ครบ

   ย้อนกลับ: SQL ท้ายไฟล์ */
update notification_rules
   set link             = coalesce(link, '/mtn-repair'),
       inapp_rollup_min = 180,
       updated_at       = now()
 where event_key = 'mtn_approved';

/* ═══ ย้อนกลับ (MAIN) ═══════════════════════════════════════════
update notification_rules set link = null, inapp_rollup_min = null
 where event_key = 'mtn_approved';
   ═══════════════════════════════════════════════════════════════ */
