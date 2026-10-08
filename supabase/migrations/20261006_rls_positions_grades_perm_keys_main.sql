-- RLS: `positions` / `grades` เลิกพึ่ง role array กับคีย์ที่เกษียณแล้ว (QC audit 2026-10-06)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn
--
-- 🔴 2 อาการที่ขัดกฎเหล็กข้อ 3 ("policy ต้อง has_perm('<คีย์เดียวกับปุ่มบนจอ>') ห้าม hardcode role array")
--
--    1. `positions_write_admin` = `exists(select 1 from profiles where id=auth.uid() and role='admin')`
--       = **role array มือ** · วันนี้ตรงกับจอพอดี (`page:/add-user` แจกให้ admin เท่านั้น)
--       แต่พอ admin ไปเปิดหน้านี้ให้ dept_admin ที่ `/permissions` **จอจะเปิด แต่ DB ยังปฏิเสธ**
--       ⇒ "เพิ่มตำแหน่ง" ขึ้น 42501 ให้คนที่ระบบบอกว่ามีสิทธิ์ · นี่คือเหตุผลที่กฎห้าม role array
--       ⇒ ผูกกับคีย์ของจอตรงๆ แล้ว 2 ฝั่งขยับไปด้วยกันเสมอ
--
--    2. `grades_write` = `has_perm('manage_master_data')` — **คีย์ที่ประกาศเกษียณไปแล้ว 22/07**
--       (migration วันนั้นเขียนกำกับเองว่า "ไม่มีโค้ดอ่านแล้ว เก็บไว้เผื่อ rollback"
--        แล้ว policy ที่เพิ่มทีหลัง 24/09 กลับไปอ่านมันอีก = drift ข้าม session)
--       วันนี้ยังทำงานได้เพราะแถวเก่ายังอยู่ (admin/dept_admin/manager/supervisor)
--       แต่ถ้าใครมาเก็บกวาดคีย์เกษียณ **สิทธิ์แก้ทะเบียนเกรดจะหายเงียบๆ** โดยไม่มีใครโยงเหตุได้
--       ⇒ ออกคีย์จริง `grades:manage` seed ให้ **ชุดเดียวกับที่ถืออยู่วันนี้เป๊ะ** (พฤติกรรมไม่เปลี่ยน)
--
-- ⚠️ ไม่แตะแถว `manage_master_data` — ยังมี policy อื่นอ่านอยู่หรือไม่ ไม่ได้ไล่ครบในรอบนี้ (ลบ = เสี่ยง)

-- ── 1) คีย์ใหม่เข้าทะเบียน (โผล่ใน /permissions แท็บ "สิทธิ์การทำงาน") ──────────────
-- ⚠️ apply จริงใช้ `on conflict do nothing` แทน delete+insert — `delete` บนตารางนี้ค้าง 60s แล้ว rollback ผ่าน MCP
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('grades', 'manage', 'ทะเบียนเกรด/ระดับงาน: เพิ่ม-แก้-ลบ', 'พนักงาน & ทักษะ', 36)
on conflict do nothing;

-- ── 2) seed = ชุดที่ถือ manage_master_data อยู่วันนี้ (เท่ากันเป๊ะ → ไม่มี behavior change) ──
insert into public.role_permissions (role, permission_key, allowed)
select rp.role, 'grades:manage', true
from public.role_permissions rp
where rp.permission_key = 'manage_master_data' and rp.allowed
  and not exists (
    select 1 from public.role_permissions x
    where x.role = rp.role and x.permission_key = 'grades:manage');

-- ── 3) รัด policy (alter ในที่เดิม — ไม่มีช่วงที่ตารางไม่มี policy) ────────────────
alter policy positions_write_admin on public.positions
  using (has_perm('page:/add-user')) with check (has_perm('page:/add-user'));

alter policy grades_write on public.grades
  using (has_perm('grades:manage')) with check (has_perm('grades:manage'));

-- ══ ตรวจผล ══════════════════════════════════════════════════════════════════════
--   select tablename, policyname, cmd, qual from pg_policies
--   where schemaname='public' and tablename in ('positions','grades') order by 1,3 desc;
--   select role, allowed from public.role_permissions where permission_key='grades:manage' order by 1;
--     → ต้องได้ชุดเดียวกับ: select role from role_permissions where permission_key='manage_master_data' and allowed;
--
-- ══ Rollback ════════════════════════════════════════════════════════════════════
--   alter policy grades_write on public.grades
--     using (has_perm('manage_master_data')) with check (has_perm('manage_master_data'));
--   alter policy positions_write_admin on public.positions
--     using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
--     with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
--   delete from public.role_permissions where permission_key = 'grades:manage';
--   delete from public.permission_catalog where (resource, action) = ('grades','manage');
