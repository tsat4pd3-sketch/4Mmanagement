-- ═══════════════════════════════════════════════════════════════════════════
-- 🔒 RLS ให้ตรงกับปุ่มบนจอ — Main project
--    (ewhdfqwfwofivojtsizn · ชื่อในจอ Supabase = "MAIN")            2026-09-16
--
-- จาก QC audit 16/09 หมวด C — 2 กลุ่มที่ "ปุ่มซ่อนแล้ว แต่ยิง API ตรงเขียนได้"
-- กฎเหล็ก CLAUDE.md: policy ต้อง has_perm('<คีย์เดียวกับปุ่มบนจอ>') ห้าม hardcode role array
--
-- ── ① skill_level_up_requests ── (ตารางที่ 6 ที่ 20260904_rls_match_ui_permissions ตกหล่น)
--   เดิม hardcode role = any(array['admin','manager','supervisor']) / ['admin','manager']
--   ⚠️ อันตรายเงียบ: employee_skills เป็น has_perm('skills:approve_levelup') ไปแล้วตั้งแต่ 20260817
--      ⇒ ถ้า admin ติ๊กสิทธิ์ให้ role อื่นที่ /permissions → **คะแนนขึ้นจริง แต่คำขอค้าง pending
--        ตลอดกาล และจอขึ้น "อนุมัติสำเร็จ"** (RLS ปฏิเสธ UPDATE = 0 แถว ไม่มี error)
--   ✅ ไม่กระทบใครวันนี้: วัดแล้ว skills:approve_levelup = {admin, manager, supervisor}
--      และ skills:approve_levelup_100 = {admin, manager} = ชุดเดียวกับที่ hardcode ไว้เป๊ะ
--      ⇒ พฤติกรรมวันนี้เหมือนเดิม 100% ต่างแค่ "ตามสิทธิ์ที่ /permissions แจกได้ในอนาคต"
--
-- ── ② npi_* (13 ตาราง) ── เดิม `for all to authenticated using (true) with check (true)`
--   = ใครก็ตามที่ login เขียนได้หมด รวมถึงปิด ECI / ปล่อย drawing revision / เปลี่ยนสถานะ PPAP
--   ซึ่งเป็นสิ่งที่คีย์ npi:approve มีไว้กัน · ร้ายขึ้นเพราะเฟส 4 จะเปิดให้ supplier ภายนอก login
--   ✅ ไม่กระทบใครวันนี้ (ไล่ call site ทุกจุดแล้ว — ทุก insert/update/delete ผ่าน can() อยู่แล้ว):
--      · วัดจริง npi:approve = {admin, engineer, manager} ⊆ npi:edit = {admin, engineer, manager, qa, supervisor}
--        ⇒ แมปตารางข้อมูลเป็น npi:edit ครอบทั้งขา edit และ approve ไม่มีใครเขียนไม่ได้
--      · ตารางแม่แบบ → npi:manage_templates (= ปุ่มที่ซ่อนด้วย canTemplates อยู่แล้ว)
--   · SELECT ยัง `true` เหมือนเดิมทุกตาราง — คนดูไม่กระทบ
--
-- ย้อนกลับ: แทน has_perm(...) ด้วย true ใน policy ที่ชื่อลงท้าย _write / _upd_* (ดูท้ายไฟล์)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ① skill_level_up_requests ──────────────────────────────────────────────
drop policy if exists skill_level_up_requests_update_below_100 on public.skill_level_up_requests;
drop policy if exists skill_level_up_requests_update_level_100 on public.skill_level_up_requests;

create policy skill_level_up_requests_update_below_100 on public.skill_level_up_requests
  for update to authenticated
  using      (to_level < 100 and (select public.has_perm('skills:approve_levelup')))
  with check (to_level < 100 and (select public.has_perm('skills:approve_levelup')));

create policy skill_level_up_requests_update_level_100 on public.skill_level_up_requests
  for update to authenticated
  using      (to_level = 100 and (select public.has_perm('skills:approve_levelup_100')))
  with check (to_level = 100 and (select public.has_perm('skills:approve_levelup_100')));

-- ── ② npi_* ───────────────────────────────────────────────────────────────
do $$
declare
  t text;
  k text;
  tpl text[] := array['npi_templates', 'npi_template_phases', 'npi_template_deliverables',
                      'npi_tooling_step_templates'];
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'npi\_%' and c.relkind = 'r'
  loop
    k := case when t = any(tpl) then 'npi:manage_templates' else 'npi:edit' end;
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    -- SELECT ยังเปิดผ่าน policy <t>_select เดิม (permissive OR กัน) — ตัวนี้คุมเฉพาะการเขียน
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.has_perm(%L))) with check ((select public.has_perm(%L)))',
      t || '_write', t, k, k);
  end loop;
end $$;

-- ── คิวรีเช็คหลังรัน ───────────────────────────────────────────────────────
-- ต้องไม่เหลือ policy เขียนที่เป็น true:
-- select tablename, policyname, cmd, qual::text from pg_policies
--  where schemaname='public' and tablename like 'npi\_%' and cmd='ALL' and qual::text='true';
-- ต้องได้ 13 แถวที่มี has_perm:
-- select count(*) from pg_policies where schemaname='public'
--   and tablename like 'npi\_%' and qual::text like '%has_perm%';
