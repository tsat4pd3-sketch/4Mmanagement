-- ─────────────────────────────────────────────────────────────────────────────
-- 🏷️ แก้ cost center ของ PD2 / PD4 ให้ตรงผังองค์กรจริง        (Main project)
-- 2026-09-24 · user เคาะ: "PD2 = assembly1 · PD4 = assembly2 (GOR and LWR BAR)"
--             อ้างอิง ORG-001_TSAT4_Overall_Rev.09 · docs/modules/org-hierarchy.md §8
--
-- ── ปัญหาที่เจอตอนเทียบกับผังจริง ───────────────────────────────────────────
--   PD2 เก็บ `2140471000` = cost ของ **Assembly 2** (ตามผัง) ทั้งที่ PD2 คือ Assembly 1
--   PD4 เก็บ `2140472000` = **ไม่มีเลขนี้ในผังเลยสักหน่วย**
--   ⇒ ทุกจอที่จับคู่หน่วยงานด้วย cost center (KPI การเงิน · Obeya · ต้นทุน) ชี้ผิดส่วน
--   ⚠️ **ตัวคนผูกถูกอยู่แล้วทั้งหมด** — ศิริพร→PD2 (Assembly 1 ✓) ·
--      ดุลยทรรศน์→[PD3,PD4] (Hydroforming + Assembly 2 ✓) · ผิดแค่เลข cost center
--
-- ── ค่าที่ตั้งใหม่ ──────────────────────────────────────────────────────────
--   PD2 → `2140470000`  (Assembly 1)
--   PD4 → `2140471000`  (Assembly 2)
--
-- ⚠️⚠️ **ข้อความที่ user พิมพ์มาคือ `214047000` (9 หลัก) แต่ผังทางการเขียน `2140470000` (10 หลัก)**
--     เลือกใช้ค่าจาก**ผังทางการ** เพราะ cost center ของทุกส่วนในฝ่าย Production เป็น 10 หลัก
--     รูปแบบ `21404xxxxx` เหมือนกันหมด (2140461000 · 2140462000 · 2140471000)
--     ⇒ ถ้า 9 หลักถูกจริง ให้แก้ที่ migration ถัดไป **อย่าแก้ค่าในฐานตรงๆ**
--
-- 🔴 ลำดับสำคัญ: ต้องปล่อย `2140471000` จาก PD2 ก่อน แล้วค่อยให้ PD4
--    (cost_centers.code เป็น primary key — สลับพร้อมกันจะชนกันเอง)
--
-- ROLLBACK (ย้อนลำดับกลับ):
--   update cost_centers set code='2140472000' where code='2140471000';
--   update cost_centers set code='2140471000' where code='2140470000';
--   update org_nodes set cost_center='2140471000' where name='PD2';
--   update org_nodes set cost_center='2140472000' where name='PD4';
-- ─────────────────────────────────────────────────────────────────────────────

-- ① ทะเบียน cost_centers — ปล่อยเลขเก่าก่อน แล้วค่อยรับเลขใหม่
update public.cost_centers set code = '2140470000', name = 'PD2'
 where code = '2140471000';
update public.cost_centers set code = '2140471000', name = 'PD4'
 where code = '2140472000';

-- ② โหนดในผัง (เก็บเป็น text ไม่ผูก FK — ต้องอัพเดทเอง)
update public.org_nodes set cost_center = '2140470000' where name = 'PD2' and kind = 'section';
update public.org_nodes set cost_center = '2140471000' where name = 'PD4' and kind = 'section';
