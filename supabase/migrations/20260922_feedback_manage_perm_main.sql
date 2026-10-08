-- 20260922_feedback_manage_perm_main.sql  ·  ⚠️ Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- ปัญหา (user แจ้ง 22/09 "ยิงกลับหาคนแจ้งสิ ไม่ใช่เห็นทุกคน"):
--   policy `uf_admin_all` เดิม hardcode role array ('admin','manager') ⇒ ทุกคนที่ role = manager
--   เปิดกล่อง 💬 แล้วเห็น **เรื่องที่ทุกคนในโรงงานแจ้ง + คำตอบที่ทีมงานตอบคนอื่น** และแก้/ปิด/
--   ทับคำตอบของคนอื่นได้ด้วย · ของจริงตอนนี้: คุณสุรเสน (manager) เป็นทั้ง "คนแจ้ง" และคนที่เห็นของทุกคน
--   ⇒ คำตอบที่ตั้งใจส่งถึงคนแจ้งคนเดียว กลายเป็นของที่คนอื่นอ่านได้
--
-- แก้ตามกฎ PERMISSIONS-DESIGN / CLAUDE.md ข้อ 3 ของ "กฎเหล็กการเขียน DB":
--   policy ต้อง data-driven ผ่าน has_perm('<คีย์เดียวกับปุ่มบนจอ>') ห้าม hardcode role array
--   ⇒ คีย์ใหม่ `feedback:manage` = "เห็นกล่องขาเข้าของทุกคน + ตอบกลับ/ปิดงาน"
--   ติ๊กเพิ่มให้ใครทีหลังได้เองที่หน้า /permissions แท็บ 🛠️ สิทธิ์การทำงาน โดยไม่ต้องแก้โค้ด
--
-- ⚠️ ตั้งใจ seed ให้ 'admin' แถวเดียว — **ห้าม seed ด้วย enum_range/unnest ทุก role**
--    (กับดักที่เขียนเตือนไว้ใน FeedbackModal.jsx ตั้งแต่ 14/08: seed เหมาทุก role = เปิดกว้างกว่าเดิม
--     ซึ่งตรงข้ามกับสิ่งที่ต้องการแก้) · has_perm() ให้ admin = true อยู่แล้วโดยไม่ต้องมีแถว
--     แถวนี้ seed ไว้เพื่อให้ isActionSeeded()/เมทริกซ์ /permissions เห็นคีย์นี้ชัดเจน
--
-- ผลหลังรัน: admin เห็นทุกเรื่องเหมือนเดิม · manager/supervisor/leader/qa/... เห็นเฉพาะเรื่องที่ตัวเองแจ้ง
--   (policy `uf_select_own` + `uf_insert_own` ไม่แตะ — ทุกคนยังส่งเรื่องและเห็นคำตอบของตัวเองได้ครบ)
-- backward-compatible: ไม่แตะ schema/ข้อมูล แตะเฉพาะ policy + เพิ่มคีย์สิทธิ์
-- rollback: ดูท้ายไฟล์
begin;

-- 1) ทะเบียนคีย์สิทธิ์ (ให้โผล่ในเมทริกซ์ /permissions) — หมวดต้องตรงกับ NAV_GROUP_ORDER ใน App.jsx
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'feedback', 'manage',
       'กล่อง 💬 feedback: เห็นเรื่องที่ทุกคนแจ้ง + ตอบกลับ/ปิดงาน (ไม่ติ๊ก = เห็นเฉพาะเรื่องที่ตัวเองแจ้ง)',
       'ตั้งค่าโปรแกรม,ฐานข้อมูล', 945
where not exists (
  select 1 from public.permission_catalog where resource = 'feedback' and action = 'manage');

-- 2) ค่าเริ่มต้น = admin เท่านั้น (ดูหมายเหตุ ⚠️ ด้านบน ห้าม seed เหมาทุก role)
insert into public.role_permissions (role, permission_key, allowed)
select 'admin'::user_role, 'feedback:manage', true
where not exists (
  select 1 from public.role_permissions where role = 'admin'::user_role and permission_key = 'feedback:manage');

-- 3) policy — เลิก hardcode ('admin','manager') เปลี่ยนเป็นคีย์เดียวกับที่จอใช้
drop policy if exists uf_admin_all on public.user_feedback;
create policy uf_manage_all on public.user_feedback
  for all to authenticated
  using      (has_perm('feedback:manage'))
  with check (has_perm('feedback:manage'));

comment on table public.user_feedback is
  'feedback จากผู้ใช้หน้างาน (บั๊ก/ข้อเสนอแนะ/คำถาม) — ส่งจากปุ่ม 💬 ท้าย sidebar · คนแจ้งเห็นเฉพาะเรื่องตัวเอง+คำตอบของตัวเอง · ผู้ถือคีย์ feedback:manage เห็นทั้งกล่องและตอบกลับได้';

commit;

-- เช็คผลหลังรัน (MAIN · ewhdfqwfwofivojtsizn) — ควรเห็น qual เป็น has_perm ไม่มี 'ARRAY[' แล้ว:
--   select policyname, cmd, qual from pg_policies where tablename = 'user_feedback' order by cmd, policyname;
--   select * from public.role_permissions where permission_key = 'feedback:manage';
--
-- rollback (กลับไปให้ manager เห็นทั้งกล่องเหมือนเดิม):
--   drop policy if exists uf_manage_all on public.user_feedback;
--   create policy uf_admin_all on public.user_feedback for all to authenticated
--     using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager')))
--     with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','manager')));
--   delete from public.role_permissions where permission_key = 'feedback:manage';
--   delete from public.permission_catalog where resource = 'feedback' and action = 'manage';
