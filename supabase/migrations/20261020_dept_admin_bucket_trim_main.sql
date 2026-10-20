-- ═══════════════════════════════════════════════════════════════════════════
-- bucket `dept_admin` — ตัด "คีย์ข้ามสายงาน" ออก (QC audit §7.3 · คำสั่ง user 2026-10-20)
-- Project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา: bucket นี้ **มีคนถืออยู่จริง 13 คน** (`profiles.is_dept_admin` — ไม่ใช่ role `dept_admin`
--       ซึ่งมี 0 บัญชี · เอกสารเดิมเข้าใจผิด) · มันแจกคีย์ action ทับ role เดิมของแต่ละคน:
--         ช่าง (mtn) 5 คน +76 คีย์ · supervisor 5 คน +29 · document_control +90 · planner_store +83
--
-- 🔑 เกณฑ์ตัด = **ข้ามสายงาน + วัดแล้วว่าไม่มีใครในกลุ่มนี้เคยใช้** (ไม่ตัดของที่ใช้จริง)
--    วัดจาก `audit_log` ฝั่ง Main (15,154 แถว) + คอลัมน์ `*_by_uid` ฝั่ง DR
--    · ใช้จริง → **คงไว้**: kpi:manage (474 ครั้ง) · org:manage_own_unit (105) · lpa:manage/delete (209)
--      · skills:edit/delete (117) · employees:edit (422) · products:edit (120) · machines:edit (44)
--    · ไม่เคยใช้เลย → ตัด (ลิสต์ข้างล่าง)
--
-- ⚠️ ฝั่ง DR ไม่มี audit log ⇒ "ลบ" ไม่ทิ้งร่องรอย — `products:delete` / `machines:delete`
--    ตัดตามเกณฑ์ "ข้ามสายงาน" (ของทีม PE/ช่าง) ถ้าหน้างานเคยใช้จริงให้เปิดคืนได้ทันที (ดู rollback)
--
-- ⏮️ ย้อนกลับ: update role_permissions set allowed = true
--               where role = 'dept_admin' and permission_key in (<ลิสต์เดียวกัน>);
-- ═══════════════════════════════════════════════════════════════════════════

update public.role_permissions
   set allowed = false
 where role = 'dept_admin'
   and permission_key in (
     -- อนุมัติแทนสายงานอื่น
     'four_m:approve_qa',        -- อนุมัติ 4M ฝั่ง QA (0 ครั้ง — ไม่มีใครในกลุ่มแตะช่อง QA เลย)
     'four_m:approve_sv',        -- อนุมัติ 4M ฝั่งหัวหน้า (supervisor มีจาก role อยู่แล้ว)
     'qa:manage',                -- จัดการงานคุณภาพ (0 การเขียนตาราง qa_*)
     'pe:approve',               -- อนุมัติเอกสาร PE (0)
     'pe:edit',                  -- แก้เอกสาร PE — PFMEA/PFC/CP (0)
     'mtn_repair:manage_master', -- "หัวหน้าโมดูล MTN" — ปลดสิทธิ์รายขั้นของใบ MO (supervisor ได้จาก bucket)
     'doc_forms:manage',         -- ทะเบียนเอกสาร/เลขฟอร์มทั้งโรงงาน (document_control มีจาก role อยู่แล้ว · 0)
     -- ลบถาวรข้ามสายงาน
     'scrap:manage',             -- ถังเหลือง/แดง (0)
     'scrap:delete',             -- (0)
     'improvements:delete',      -- ลบ Kaizen (0)
     'ojt:delete',               -- ลบประวัติ OJT (0)
     'shift_schedule:delete',    -- ลบตารางกะ (0 · `shift_schedule:edit` คงไว้)
     'machines:delete',          -- ลบเครื่องจักร (`machines:edit` คงไว้ — ใช้จริง 44)
     'products:delete'           -- ลบสินค้า (`products:edit` คงไว้ — ใช้จริง 120)
   );

-- ═══ คิวรีเช็คผล (ต้องได้ allowed = false ครบ 14 แถว) ═══════════════════════
-- select permission_key, allowed from public.role_permissions
--  where role='dept_admin' and permission_key in (
--    'four_m:approve_qa','four_m:approve_sv','qa:manage','pe:approve','pe:edit',
--    'mtn_repair:manage_master','doc_forms:manage','scrap:manage','scrap:delete',
--    'improvements:delete','ojt:delete','shift_schedule:delete','machines:delete','products:delete')
--  order by permission_key;
