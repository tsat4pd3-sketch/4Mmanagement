-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ══ 🎯 ตัดผู้รับที่ "ไม่ได้ลงมือในขั้นนั้น" ออก — ใบแจ้งซ่อม + งานจัดส่ง ══════════════
-- 2026-09-23 · คำสั่ง user: *"เน้นงานแจ้งซ่อมกับจัดส่งก่อน อย่าแจ้งมั่ว เพราะมันถี่
--              ถ้ามั่วคนเยอะมันคูณเยอะ"*
--
-- หลักที่ใช้ตัด: **แต่ละขั้นแจ้งเฉพาะ "คนที่ต้องลงมือขั้นถัดไป"**
--   คนที่อยู่ในใบอยู่แล้ว (ผู้แจ้ง · ช่างที่รับ · ผู้ตรวจ) ไม่ต้องพึ่ง role — edge ส่งถึงตัวจาก
--   คอลัมน์ uid ในใบตรงๆ แล้ว (`MO_AUDIENCE` ใน send-mtn-notification)
--   ⇒ role ในทะเบียนเหลือไว้เฉพาะ "กลุ่มที่ยังไม่รู้ตัวบุคคล" เท่านั้น
--
-- ตัวเลขก่อนแก้ (ใบของ Line 61 · ส่วนงาน PD3 · ทีม production):
--   mtn_qa 38 คน · mtn_checked 26 · mtn_reported/assigned/repaired 24 · mtn_pickup_pending 28
--   คนเปิดอ่านจริง 4.7-10.5%
--
-- ⚠️ ค่าเดิมทั้งหมดอยู่ในบล็อก ROLLBACK ท้ายไฟล์ — ผู้ใช้ปรับเองได้ที่ /notification-config
--    (จอนั้นมี "ป้ายราคา" บอกจำนวนคน/แถวต่อวันอยู่แล้ว)

-- ── ใบแจ้งซ่อม ────────────────────────────────────────────────────────────────────
-- ขั้น 1 แจ้งใหม่ → คนที่ต้องลงมือ = ช่าง · หัวหน้ากลุ่มของไลน์นั้น (ตัด supervisor ทั้งส่วนงานออก)
update notification_rules set inapp_roles = array['leader','mtn']            where event_key = 'mtn_reported';
-- ขั้น 3 ซ่อมเสร็จ → ฝ่ายที่แจ้งต้องไปตรวจ (ช่างอยู่ในใบแล้ว ไม่ต้องยิงทั้ง role mtn)
update notification_rules set inapp_roles = array['leader','supervisor']     where event_key = 'mtn_repaired';
-- ขั้น 4 ตรวจแล้ว → งานของ QA ล้วน (ผู้ตรวจ/ช่าง/ผู้แจ้ง อยู่ในใบแล้ว)
update notification_rules set inapp_roles = array['qa']                      where event_key = 'mtn_checked';
-- ขั้น 5 QA ผ่าน / ข้าม QA → ฝ่ายที่แจ้งต้องมารับมอบ (QA กับช่างทำงานของตัวเองจบแล้ว)
update notification_rules set inapp_roles = array['leader','supervisor']     where event_key in ('mtn_qa','mtn_qa_skipped');
-- ขั้น 2/8/ตีกลับ/ส่งซ่อมนอก → edge ไม่ยิงตามทะเบียนแล้ว (cast:false) แต่เก็บ role ไว้ให้ตรงความหมาย
update notification_rules set inapp_roles = array['mtn']                     where event_key in ('mtn_vendor_sent','mtn_vendor_back');

/* 🔴 **ไม่แตะ `mtn_handover` / `mtn_approved` / `mtn_daily_summary` โดยตั้งใจ**
   2 ขั้นนี้คนที่ต้องลงมือคือ ผจก. แต่ `dept_manager_uid`/`cost_mgr_uid`/`mtn_head_uid`
   ยังไม่ถูกกรอกเลย (วัด 497 ใบ: 1 · 1 · 0) ⇒ ยิงตามทะเบียนเป็นทางเดียวที่ใบเดินต่อได้
   ตัดเมื่อไหร่ = ใบค้างที่ขั้น 6-7 เงียบๆ (เคยค้าง 140 ใบที่ขั้น 6 มาแล้ว) */

/* ไม่ยกเว้น admin/ผจก. จากตัวกรองส่วนงาน สำหรับขั้นที่เกิดถี่
   (ผจก. 4 คนเคยได้ทุกใบของทุกส่วนงาน — วัด 17/09: อ่านรวมกัน 2 จาก 2,920 แถว)
   ⚠️ เว้น mtn_handover/mtn_approved ไว้ตามเหตุผลด้านบน */
update notification_rules set inapp_scope_strict = true
 where event_key in ('mtn_reported','mtn_assigned','mtn_repaired','mtn_checked','mtn_qa',
                     'mtn_qa_skipped','mtn_closed','mtn_returned','mtn_vendor_sent',
                     'mtn_vendor_back','mtn_pickup_pending','downtime_call_mtn');

-- ── งานจัดส่ง / คลัง ──────────────────────────────────────────────────────────────
-- 🚨 ตัวถี่ที่สุดของสายนี้: shipping_phase_alert 2,330 แถว/14 วัน · **คนเปิดอ่าน 3.4%**
--    สแกนทุก 10 นาที · คนที่ต้องลงมือคือ planner/sale เจ้าของแผน ไม่ใช่ ผจก./admin
update notification_rules set inapp_roles = array['planner_store','sale']
 where event_key = 'shipping_phase_alert';
-- เลยกำหนดส่ง = เรื่องต้อง escalate → เก็บ ผจก. ไว้ ตัดแค่ admin (ไม่ใช่คนทำงานสายนี้)
update notification_rules set inapp_roles = array['planner_store','sale','manager']
 where event_key = 'shipping_overdue';
-- ใบขอเบิก/ขอแร็ค/เติม WIP = งานประจำของสโตร์ ไม่ต้องเข้ากระดิ่ง ผจก./admin ทุกใบ
update notification_rules set inapp_roles = array['planner_store','sale']
 where event_key in ('material_request','rack_request');
update notification_rules set inapp_roles = array['planner_store']
 where event_key = 'wip_replenish';

-- ── เช็คผลหลังรัน (Main) ────────────────────────────────────────────────────────────
--   select event_key, inapp_roles, inapp_scope_strict, inapp_match_line
--     from notification_rules
--    where event_key like 'mtn%' or event_key like 'shipping%' order by 1;
--   select count(*) from notify_recipients('mtn_qa','PD3','production','Line 61');   -- ควรเหลือหลักหน่วย
--
-- ── ROLLBACK (ค่าเดิมก่อน 23/09/2026) ───────────────────────────────────────────────
--   update notification_rules set inapp_roles = array['supervisor','leader','mtn']        where event_key in ('mtn_reported','mtn_vendor_sent','mtn_vendor_back');
--   update notification_rules set inapp_roles = array['leader','supervisor','mtn']        where event_key = 'mtn_repaired';
--   update notification_rules set inapp_roles = array['leader','qa','mtn']                where event_key = 'mtn_checked';
--   update notification_rules set inapp_roles = array['qa','supervisor','leader','mtn']   where event_key in ('mtn_qa','mtn_qa_skipped');
--   update notification_rules set inapp_roles = array['planner_store','sale','manager','admin']
--     where event_key in ('shipping_phase_alert','shipping_overdue','material_request','rack_request');
--   update notification_rules set inapp_roles = array['planner_store','manager','admin']  where event_key = 'wip_replenish';
--   update notification_rules set inapp_scope_strict = false
--     where event_key in ('mtn_reported','mtn_assigned','mtn_repaired','mtn_checked','mtn_qa',
--                         'mtn_qa_skipped','mtn_closed','mtn_returned','mtn_vendor_sent',
--                         'mtn_vendor_back','mtn_pickup_pending','downtime_call_mtn');
