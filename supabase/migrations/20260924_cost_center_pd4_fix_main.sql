-- ═══ 💰 แยกรหัส cost center ของ PD4 ออกจาก PD2 · Main (ewhdfqwfwofivojtsizn) ═══
-- 2026-09-24 · user: "Pd4 น่าจะ 2140472000"
--
-- ปัญหาที่รายงานไว้ 23/09 (ข้อ 1 ในตารางขัดแย้ง `docs/modules/obeya-kpi-board.md`):
--   `org_nodes` ให้ **PD2 และ PD4 ชี้รหัสเดียวกัน** = `2140471000`
--   · ทะเบียน `cost_centers` ตั้งชื่อรหัสนั้นว่า **"PD2"**
--   ⇒ เลือก PD4 บนจอแล้วได้ชิป `💰 2140471000` ที่กดเข้าไปเจอชื่อ "PD2" · และ `ccOwnersOf()` คืน 2 หน่วย
--
-- หลักฐานที่ตรงกับที่ user บอก — รหัสระดับส่วนงานเดินเป็นคู่ `…46x000` / `…47x000`:
--   PD1 = 2140461000 · PD3 = 2140462000 · PD2 = 2140471000 · **PD4 = 2140472000 (ช่องที่ว่างอยู่พอดี)**
--   และ `2140472000` **ยังไม่มีอยู่ที่ไหนเลยในฐาน** (cost_centers · org_nodes · production_lines
--   · cost_center_rates) ⇒ ไม่ชนของเดิม
--
-- ⚠️ ที่ยังขัดกันอยู่ และไฟล์นี้ **ไม่ได้ตัดสินให้**:
--   ไฟล์ Excel `Key Performance Index Evaluation breakdown 2026` (แถว DL&OH ของ PD4) เขียน
--   cost center ของ PD4 ว่า **2140471000** (ดู docs/OBEYA-KPI-SOURCES.md §12.3)
--   ⇒ ถ้าใบบัญชีจริงยังใช้ 2140471000 กับ PD4 อยู่ ต้องกลับมาคุยกับบัญชีก่อนใช้ตัวเลขการเงินรายส่วนงาน
--   (ตอนนี้ไม่มีอะไรพังเพราะยังไม่มี KPI ตัวไหนตั้งขอบเขตเป็น cost center)
--
-- Blast radius วัดจริงก่อนรัน: `cost_center_rates` ที่รหัส 21404xxxxx = **0 แถว**
--   · `kpi_definitions` ที่ `scope_kind = 'cost_center'` = **0 แถว**
--   ⇒ กระทบแค่ "ชิป 💰 ข้างช่องขอบเขต" กับรายการในช่อง Cost Center เท่านั้น
--
-- Rollback:
--   update public.org_nodes set cost_center = '2140471000'
--    where kind = 'section' and coalesce(code, name) = 'PD4';
--   delete from public.cost_centers where code = '2140472000';

begin;

insert into public.cost_centers (code, name, section, is_active)
select '2140472000', 'PD4', null, true
where not exists (select 1 from public.cost_centers where code = '2140472000');

update public.org_nodes
   set cost_center = '2140472000'
 where kind = 'section' and coalesce(code, name) = 'PD4'
   and cost_center is distinct from '2140472000';

commit;
