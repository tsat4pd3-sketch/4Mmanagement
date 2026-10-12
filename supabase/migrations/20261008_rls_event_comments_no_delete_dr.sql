-- ════════════════════════════════════════════════════════════════════════════
-- DR project ("Product DB" · eyhclzkifitbhbljgoav)
-- 🔴 คอมเมนต์ใต้ใบงาน **ลบไม่ได้** — เป็นส่วนหนึ่งของใบที่พิมพ์/ยื่นออกไปแล้ว (2026-10-08)
--
-- ที่มา (QC audit 08/10): `event_comments` มี policy เดียว `event_comments_open`
--   = `for all to public using (true) with check (true)` ⇒ **รวม DELETE**
--   เดิมไม่ค่อยสำคัญ (คอมเมนต์เป็นแค่การคุยกันบนจอ) แต่ตั้งแต่ **07/10** คอมเมนต์
--   ถูกพิมพ์ลงใบ MO (FM-JIG-008 / FM-MTN-006) และลง Excel export
--   ⇒ ลบคอมเมนต์ = พิมพ์ใบเดิมซ้ำแล้วได้เนื้อ **ไม่เหมือนใบที่ยื่นไปแล้ว**
--   ขัดกฎของระบบเอง: *"ฟอร์มที่ยื่นออกไปแล้ว = บันทึก ไม่ใช่ใบที่ generate ใหม่"*
--   (CLAUDE.md §ใบรายงานปัญหาการผลิต)
--
-- แก้: แตก policy `ALL` เป็น select / insert / update — **ไม่มี DELETE policy โดยเจตนา**
--   (หลักเดียวกับที่ตั้งใจไว้ตอนออกแบบรอบแรก · ดู `20261007_mo_comments_use_event_comments_dr.sql`)
--   · UPDATE ยังเปิด = แก้ข้อความคอมเมนต์ของตัวเองได้ (จอมีปุ่มนั้น)
--   · insert บังคับว่าต้องมีข้อความ + ชื่อคนพูด — คอมเมนต์ที่ไม่รู้ว่าใครพูด เชื่อไม่ได้
--     ⚠️ `author_name` มี `not null default 'ไม่ระบุชื่อ'` อยู่แล้ว ⇒ ด่านนี้กันเฉพาะช่องว่างล้วน
--
-- 🔴 RLS ฝั่ง DR วิ่งด้วย role `anon` เสมอ (กฎเหล็ก CLAUDE.md) ⇒ policy เป็น `public`
--    **ห้ามเปลี่ยนเป็น TO authenticated** — client ไม่มี JWT = พังทั้งระบบ
--
-- ⚠️ ของเดิม 74 คอมเมนต์ · 49 ใบ ไม่ถูกแตะ (เปลี่ยน policy ไม่แตะข้อมูล)
-- ⚠️ ไม่มีจอไหนเรียก `.delete()` บน event_comments อยู่แล้ว (grep = 0) ⇒ ถอด DELETE = ไม่มีปุ่มไหนพัง
-- ════════════════════════════════════════════════════════════════════════════

-- ── วิธีที่ใช้: **restrictive policy** (ไม่แตะ policy เดิมเลย) ───────────────────────
--   restrictive ถูก **AND** กับ permissive ⇒ ใส่ตัวที่ `for delete using (false)`
--   = DELETE เป็นไปไม่ได้ ขณะที่ select/insert/update ยังวิ่งผ่าน `event_comments_open` เหมือนเดิม
--   ดีกว่า drop+create ตรงที่ **ไม่มีช่วงที่ตารางไม่มี policy** (ถ้า migration ล้มกลางทาง
--   = ปฏิเสธทุกคน · บทเรียน 05/10) และของเดิมไม่ถูกแตะเลย ⇒ ย้อนง่าย
create policy event_comments_no_delete on public.event_comments
  as restrictive for delete to public using (false);

-- คอมเมนต์ที่ไม่มีข้อความ หรือไม่รู้ว่าใครพูด = เชื่อไม่ได้ (ยิ่งเมื่อมันไปอยู่บนใบพิมพ์)
create policy event_comments_body_required on public.event_comments
  as restrictive for insert to public
  with check (coalesce(btrim(body), '') <> '' and coalesce(btrim(author_name), '') <> '');

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ คิวรีเช็คผล (project "Product DB" · eyhclzkifitbhbljgoav)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) ต้องมี policy เดิม + restrictive 2 ตัว (วัดจริง 08/10 แล้ว ✅)
--    select cmd, policyname, permissive, roles::text from pg_policies
--     where tablename = 'event_comments' order by cmd, policyname;
--    -- คาดหวัง: ALL:event_comments_open(PERMISSIVE)
--    --          DELETE:event_comments_no_delete(RESTRICTIVE)
--    --          INSERT:event_comments_body_required(RESTRICTIVE)
--
-- 1b) ซ้อมด้วย role anon (ทดสอบแล้ว 08/10 ผ่านทั้ง 3 เคส แล้ว rollback):
--     ข้อความว่าง → ปฏิเสธ · ไม่มีชื่อผู้พูด → ปฏิเสธ · คอมเมนต์ปกติ → เขียนได้
--
-- 2) ข้อมูลเดิมต้องครบ (คาดหวัง 74 / 49 ณ 08/10 — ไม่ลดลง)
--    select count(*) as n, count(distinct ref_id) as n_orders
--      from public.event_comments where ref_kind = 'mtn_order';
--
-- ⏪ ROLLBACK (คืนสภาพเดิม — เปิด DELETE กลับ)
--  begin;
--  drop policy if exists event_comments_no_delete     on public.event_comments;
--  drop policy if exists event_comments_body_required on public.event_comments;
--  commit;
--  (policy เดิม `event_comments_open` ไม่เคยถูกแตะ ⇒ ลบ 2 ตัวนี้ = กลับสภาพเดิมเป๊ะ)
-- ════════════════════════════════════════════════════════════════════════════
