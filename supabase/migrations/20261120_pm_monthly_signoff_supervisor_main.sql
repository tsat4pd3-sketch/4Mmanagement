-- ════════════════════════════════════════════════════════════════════════════
-- ใบ PM ลงนามรายเดือน ③④ — ให้ role supervisor ถือคีย์ด้วย (20/11 · คำสั่ง user 19/11)
-- Project: Main ("MAIN" · ewhdfqwfwofivojtsizn)
--
-- user ตัดสิน 19/11: ผู้เซ็น ③④ = **หัวหน้า/รักษาการตามผังองค์กร** (`org_assignments` head/acting)
--   ไม่ใช่ตาม role — ตัวตัดสินอยู่ที่ client `pmMonthlySignVerdict()` (utils/pmMonthly.js)
-- แต่ RLS ของ `pm_monthly_signoffs` (20261113c) ยังต้องการคีย์ตาม kind ⇒ คนที่ได้รับมอบหมายแต่บัญชีเป็น
--   role supervisor (เช่น รักษาการของ Maintenance) จะถูกฐานปฏิเสธ ⇒ เติม supervisor ทั้ง 2 คีย์
-- คีย์ 2 ตัวนี้ยังไม่มีโค้ดบน main ใช้ (ตาราง 0 แถว ณ 20/11) ⇒ ไม่กระทบของเดิม · additive ล้วน
-- ย้อน: delete from public.role_permissions where role = 'supervisor' and permission_key in ('pm:monthly_approve','pm:monthly_ack');
-- ════════════════════════════════════════════════════════════════════════════
insert into public.role_permissions (role, permission_key, allowed)
select 'supervisor'::user_role, k, true
from (values ('pm:monthly_approve'), ('pm:monthly_ack')) as v(k)
where not exists (select 1 from public.role_permissions x where x.role = 'supervisor' and x.permission_key = v.k);

-- ตรวจผล: select role, permission_key, allowed from role_permissions where permission_key in ('pm:monthly_approve','pm:monthly_ack') order by 2,1;
