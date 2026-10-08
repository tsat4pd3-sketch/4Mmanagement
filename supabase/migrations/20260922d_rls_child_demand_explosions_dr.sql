-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ══ 🛡️ ปิดช่อง anon อ่าน/ลบ `child_demand_explosions` (เปิด RLS · เหลือสิทธิ์แค่ INSERT) ══
-- 2026-09-22 · จากแท็บ 🩺 ใน /schema (หมวด "ตารางที่ปิด RLS") — ตัวเดียวที่เหลือฝั่ง DR
--   ที่ไม่ใช่ตารางสำรอง และมีข้อมูลจริง 14,505 แถว
--
-- ตารางนี้คืออะไร: **ตัวกันระเบิด BOM ซ้ำ** (dedupe marker) — 1 แถว = 1 order_id ที่ trigger
--   `fn_explode_child_demand` เคยระเบิดความต้องการลูกไปแล้ว · กันซ้ำด้วย unique(order_id)
--
-- 🔴 ทำไมต้องปิด: ฝั่ง DR client วิ่งด้วย role `anon` เสมอ (anon key ฝังในบันเดิลเว็บ) ·
--   RLS ปิด = ใครก็ **ลบ** marker ได้ทั้งตาราง ⇒ ใบผลิตที่ระเบิดไปแล้วถูกระเบิดซ้ำได้
--   (ออเดอร์ลูก/ใบเบิกบรรจุภัณฑ์งอกเป็นเท่าตัวโดยไม่มีใครรู้ว่าเกิดจากอะไร) · และอ่านได้ทั้งตาราง
--
-- ⚠️ ทำไมให้ policy แค่ INSERT — และทำไม**ต้องมี** INSERT:
--   `fn_explode_child_demand` เป็น **SECURITY INVOKER** (prosecdef = false) ⇒ ตอน trigger ทำงาน
--   มันวิ่งด้วยสิทธิ์ของคนที่ยิงคำสั่ง = `anon` ⇒ RLS มีผลกับตัว trigger ด้วย
--   **เปิด RLS เฉยๆ โดยไม่ให้ policy INSERT = ยืนยันใบผลิตพัง 42501 ทั้งระบบทันที**
--   ตัวฟังก์ชันอ่านตารางนี้หรือเปล่า: **ไม่เลย** (ตรวจ prosrc ทั้งตัว — มีแต่ insert + ดัก
--   unique_violation) · ไม่มี function/view อื่นแตะ · ไม่มีหน้าไหนใน client เรียก
--   ⇒ ไม่มี policy SELECT/UPDATE/DELETE = anon อ่าน/แก้/ลบไม่ได้ แต่ของเดิมทำงานเหมือนเดิมเป๊ะ
--   (unique_violation ยังทำงานปกติ — เป็นด่าน index ไม่ใช่ด่าน RLS)
--
-- ถ้าวันหลังมีจอที่ต้องอ่านตารางนี้ → เพิ่ม policy SELECT ด้วย has_perm('<คีย์ของปุ่มบนจอ>')
--   ห้ามเปิด `using (true)` เพื่อความสะดวก

alter table public.child_demand_explosions enable row level security;

drop policy if exists cde_insert_trigger on public.child_demand_explosions;
create policy cde_insert_trigger on public.child_demand_explosions
  for insert to public with check (true);
comment on table public.child_demand_explosions is
  'marker กันระเบิด BOM ซ้ำ (1 แถว = 1 order_id) — เขียนโดย trigger fn_explode_child_demand เท่านั้น · '
  'RLS: INSERT อย่างเดียว (trigger เป็น security invoker วิ่งด้วย anon) · ไม่มี policy อ่าน/แก้/ลบ โดยตั้งใจ';

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'child_demand_explosions';   -- true
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.child_demand_explosions'::regclass;                    -- แถวเดียว cmd = a (insert)
--   -- ของจริง: ยืนยันใบผลิต 1 ใบในแอป แล้วดูว่าจำนวนแถวเพิ่มขึ้น 1 และไม่มี error
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   alter table public.child_demand_explosions disable row level security;
--   drop policy if exists cde_insert_trigger on public.child_demand_explosions;
