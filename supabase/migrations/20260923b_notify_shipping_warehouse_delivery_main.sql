-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ══ 🔴 เติม role `warehouse_delivery` เข้ากติกาแจ้งเตือนสายจัดส่ง ══════════════════
-- 2026-09-23 · แก้ต่อจาก `20260923_notify_narrow_mtn_shipping_main.sql` ในวันเดียวกัน
--
-- 🔴 สิ่งที่เกือบพลาด: วันเดียวกันนี้ session อื่นแยก role ฝั่งจัดส่งออกมาเป็น `warehouse_delivery`
--    แล้ว **ย้ายบัญชีคนจัดส่งทั้งหมดออกจาก `sale`** (migration `20260923_role_warehouse_delivery_seed`)
--    ⇒ วัดสดหลังย้าย: `sale` = **0 คน** · `warehouse_delivery` = 5 คน · `planner_store` = 1 คน
--    รอบตัด role ก่อนหน้าตั้งผู้รับสายจัดส่งเป็น `['planner_store','sale']` ตามค่าที่เห็นตอนนั้น
--    ⇒ เท่ากับ **คนจัดส่ง 5 คนหลุดจากกระดิ่งทั้งหมด เหลือคนรับจริง 1 คน**
--
-- บทเรียน (เขียนไว้ให้ session ถัดไป): **ตัดผู้รับต้องวัด "จำนวนคนที่เหลือจริง" หลังตัดเสมอ
--   ห้ามดูแค่ชื่อ role** — role ที่ดูสมเหตุสมผลบนกระดาษอาจไม่มีคนอยู่เลย
--   คิวรีตรวจอยู่ท้ายไฟล์ · ควรรันทุกครั้งที่แก้ `inapp_roles`
--
-- เจตนาของแต่ละเรื่อง (จากนิยามหน้าที่ใน 20260923_role_warehouse_delivery_seed):
--   planning-store = บริหาร stock + จ่ายงานในโรงงาน · warehouse = เก็บสินค้าพร้อมขาย
--   delivery = ส่งของให้ลูกค้า
--   ⇒ เรื่องที่เกี่ยวกับ "ของออกไปหาลูกค้า" (หลุดเฟสงานส่ง · เลยกำหนดส่ง · ภาชนะ/แร็ค)
--     ต้องถึงฝั่ง warehouse_delivery เสมอ

update notification_rules set inapp_roles = array['planner_store','sale','warehouse_delivery']
 where event_key in ('shipping_phase_alert','edi_import','store_abnormal');

update notification_rules set inapp_roles = array['planner_store','sale','warehouse_delivery','manager']
 where event_key = 'shipping_overdue';

-- ภาชนะ/แร็ค = งานฝั่งจัดส่งโดยตรง (role ใหม่ได้ `rack_center:operate` มาด้วยในรอบแยก role)
update notification_rules set inapp_roles = array['planner_store','warehouse_delivery']
 where event_key = 'rack_request';

-- ใบขอเบิก/คืนของจากสโตร์ = งาน inbound ล้วน ไม่ต้องกวนฝั่งจัดส่ง
update notification_rules set inapp_roles = array['planner_store','sale']
 where event_key = 'material_request';

-- ── 🔎 คิวรีตรวจ "มีเรื่องไหนไม่เหลือคนรับไหม" — รันทุกครั้งที่แก้ inapp_roles ──────────
--   select r.event_key, r.inapp_roles,
--          (select count(*) from notify_recipients(r.event_key, null, null, null)) as คนที่จะได้รับ
--     from notification_rules r
--    where coalesce(array_length(r.inapp_roles,1),0) > 0
--      and (select count(*) from notify_recipients(r.event_key, null, null, null)) <= 2
--    order by 3, 1;
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   update notification_rules set inapp_roles = array['planner_store','sale']
--    where event_key in ('shipping_phase_alert','edi_import','rack_request');
--   update notification_rules set inapp_roles = array['sale','planner_store'] where event_key = 'store_abnormal';
--   update notification_rules set inapp_roles = array['planner_store','sale','manager'] where event_key = 'shipping_overdue';
