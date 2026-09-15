-- ══════════════════════════════════════════════════════════════════════════
-- แจ้งเตือน MO — ให้ "ฝ่ายที่แจ้ง" รู้ว่าถึงคิวรับมอบ (ขั้น 6)          2026-09-09
-- Project: Main (ewhdfqwfwofivojtsizn · ชื่อในจอ "MAIN")
--
-- ที่มา: ใบซ่อมกองที่ขั้น 6 "รอรับมอบ" 140 ใบ (โต ~20 ใบ/วัน · เก่าสุด 25/08)
--   ไล่แล้วไม่ใช่เรื่องสิทธิ์ — คนที่มีสิทธิ์กดมีอยู่ แต่**ไม่มีใครบอกเขาว่าถึงคิวตัวเอง**:
--     • `mtn_qa`  (QA ตรวจเสร็จ → ใบไปรอรับมอบ) แจ้งเฉพาะ role `qa`  ⇒ ฝ่ายผู้แจ้งไม่รู้เรื่องเลย
--     • `mtn_handover` (รับมอบแล้ว → รอผู้อนุมัติปิด ขั้น 7) `inapp_roles = {}` ⇒ **ไม่แจ้งใครสักคน**
--     • `mtn_qa_skipped` (ข้าม QA → ไปขั้น 6) แจ้ง leader/qa แต่ไม่มี supervisor
--
-- 🔴 กับดักที่ทำให้ "เพิ่ม role อย่างเดียวแล้วยังเงียบ": `notify_recipients` กรองด้วย
--    `array_length(depts,1)=0 OR e.department = any(depts)` — `mtn_qa` ตั้ง inapp_depts='{QA}' ไว้
--    ⇒ ต่อให้ใส่ supervisor/leader เข้า inapp_roles ก็ถูกกรองทิ้งหมด เพราะ department ไม่ใช่ QA
--    ⇒ ต้อง**ล้าง inapp_depts เป็น '{}' พร้อมกัน** ไม่งั้นแก้แล้วเหมือนไม่ได้แก้
--
-- ขอบเขตที่ตั้งใจ: เพิ่มผู้รับให้ครบเฉพาะ "คนที่ต้องลงมือขั้นถัดไป" เท่านั้น
--   inapp_match_section แตะจุดเดียวคือ mtn_qa_skipped (false → true) เพื่อคุมปริมาณ ดูเหตุผลในข้อ 2
--   ไม่แตะ mtn_reported / mtn_assigned / mtn_repaired (ปริมาณสูงอยู่แล้ว ~60-200 เรื่อง/คน/วัน)
--   ไม่แตะสิทธิ์ใน role_permissions — ขั้น 6 ยังเป็นหน้าที่ฝ่ายผู้แจ้งตาม 20260902_mtn_step_ownership
--   ปรับเพิ่มเองได้ที่หน้า /notification-config โดยไม่ต้องแก้โค้ด (ตารางนี้เป็น data-driven)
-- ══════════════════════════════════════════════════════════════════════════

-- 1) QA ตรวจเสร็จ → หัวหน้า/หัวหน้ากลุ่มของฝ่ายที่แจ้งต้องรู้ว่าถึงคิวรับมอบ
update public.notification_rules
   set inapp_roles = array['qa','supervisor','leader']::text[],
       inapp_depts = '{}'::text[],            -- ⬅ ตัวบล็อกเดิม ต้องล้าง (ดูหมายเหตุด้านบน)
       updated_at  = now()
 where event_key = 'mtn_qa';

-- 2) ข้าม QA (ไม่เกี่ยวกับคุณภาพ) → ใบไปรอรับมอบเหมือนกัน ต้องถึง supervisor ด้วย
update public.notification_rules
   set inapp_roles = array['qa','supervisor','leader']::text[],
       inapp_depts = '{}'::text[],
       -- เดิม false = กระจายทั้งโรงงาน (วัดจริง 60 คน/ครั้ง) · ตั้ง true ให้เท่ากับ mtn_qa
       -- ซึ่งเป็น transition เดียวกัน (ใบไปรอรับมอบ) ⇒ 37 คน/ครั้งเฉพาะส่วนงานของใบ
       -- หมายเหตุ: ใบที่ dept_section เป็น null ยังกระจายเหมือนเดิม (notify_recipients ไม่กรองเมื่อ p_section is null)
       inapp_match_section = true,
       updated_at  = now()
 where event_key = 'mtn_qa_skipped';

-- 3) รับมอบแล้ว → ผู้อนุมัติปิด (ขั้น 7) ต้องรู้ · เดิมไม่แจ้งใครเลย ใบจึงค้างรอปิด
update public.notification_rules
   set inapp_roles = array['supervisor','manager']::text[],
       updated_at  = now()
 where event_key = 'mtn_handover';

-- ตรวจผลหลังรัน (MAIN):
--   select event_key, inapp_roles, inapp_depts, inapp_match_section
--     from notification_rules where event_key in ('mtn_qa','mtn_qa_skipped','mtn_handover');
--   -- ต้องได้ inapp_depts = {} ทั้ง mtn_qa และ mtn_qa_skipped
--   -- ทดสอบว่ามีคนรับจริง (ใส่ส่วนงานของใบที่ค้าง):
--   select count(*) from notify_recipients('mtn_qa','PD3');     -- ต้อง > 0 และมากกว่าเดิม
--   select count(*) from notify_recipients('mtn_handover','PD3');-- เดิม 0 · ต้อง > 0
--
-- Rollback (กลับค่าเดิมเป๊ะ):
--   update notification_rules set inapp_roles=array['qa']::text[],        inapp_depts=array['QA']::text[] where event_key='mtn_qa';
--   update notification_rules set inapp_roles=array['leader','qa']::text[], inapp_depts='{}'::text[], inapp_match_section=false where event_key='mtn_qa_skipped';
--   update notification_rules set inapp_roles='{}'::text[]                                                where event_key='mtn_handover';
