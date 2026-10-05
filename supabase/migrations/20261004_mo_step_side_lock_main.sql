-- ── MAIN project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ══ 🔒 ล็อก "ตำแหน่ง + ฝั่ง" ของคนกดในลูป MO — แยกคีย์ขั้น 6/7/8 ═══════════════════
-- 2026-10-04 · คำสั่ง user: *"ไม่มีลอคตำแหน่งในการกด บางทีหัวหน้าแผนกกดอนุมัติเลย
--   ก็ไปอนุมัติของคนอื่นได้ · ผจก ช่าง อนุมัติเลยก็มาอนุมัติแทน ผจก ผลิตได้"*
--
-- วัดจริง 02/10 (ฝั่ง DR `mtn_orders`): ใบที่เดินถึงขั้นเซ็นปิดมี 4 ใบ —
--   **1 ใน 4 คนเซ็น "ผจก.ฝ่ายที่แจ้ง" เป็นคนเดียวกับที่เซ็น "ผจก.ช่าง"**
--   และ 8 ใบของ PD3 ถูกปิดโดยคนตำแหน่ง `dept_head` ทั้งที่ช่องนั้นเป็นของ ผจก.ฝั่งผู้แจ้ง
--
-- ต้นเหตุข้อ 3 จาก 4: **ขั้น 6/7/8 ใช้คีย์สิทธิ์ตัวเดียวกัน (`mtn_repair:approve`)**
--   ⇒ ใครอนุมัติขั้นช่างได้ ก็กดขั้นของ ผจก.ฝ่ายที่แจ้งได้ ไม่ต้องแฮกอะไร
--   (อีก 3 ข้อ — manage_master ผ่านเงียบ · ด่านทีมช่างไม่เคยทำงาน · ไม่เคยดูตำแหน่ง —
--    แก้ในโค้ด `src/utils/mtnStepPerm.js` ไม่ใช่ที่ SQL)
--
-- 🔴 **ไม่เปลี่ยนว่า "ใครถือคีย์"** — seed คีย์ใหม่ให้ role ชุดเดียวกับที่ถือ `approve` อยู่แล้ว
--    ของใหม่ที่กั้นจริงคือ "ฝั่ง + ตำแหน่ง" ในโค้ด ไม่ใช่การหรี่ role ให้แคบลง
--    ⇒ blast radius = ศูนย์สำหรับคนที่กดถูกช่องอยู่แล้ว · คนที่เคยกดข้ามฝั่งจะโดนกั้น (ตามที่ user สั่ง)
--
-- ⚠️ โค้ดมี fallback: คีย์ใหม่ที่ยังไม่ seed → ถอยไปใช้ `approve` เดิม
--    ⇒ **deploy โค้ดก่อนรัน SQL ได้ ใบไม่ค้าง** · รัน SQL แล้วเกณฑ์ใหม่มีผลเอง

-- ── ① ขั้น 6 ใบ MTN: หัวหน้าแผนกช่างตรวจงานหลังแก้ไข ──────────────────────────────
insert into role_permissions (role, permission_key, allowed)
select r.role, 'mtn_repair:mtn_head', true
from (select unnest(enum_range(null::user_role)) as role) r
where r.role::text = any (array['admin','manager','supervisor','dept_admin','mtn'])
on conflict (role, permission_key) do update set allowed = true;

-- ── ② ขั้นปิดใบฝั่ง "ผู้แจ้ง" (ขั้น 7 ของฟอร์ม JIG/DIE · ขั้น 8 ของฟอร์ม MTN) ────────
--    = ผจก./หัวหน้าส่วนของฝ่ายที่แจ้ง (เจ้าของค่าใช้จ่าย) — **ไม่ใช่ฝั่งช่าง**
insert into role_permissions (role, permission_key, allowed)
select r.role, 'mtn_repair:close_cost', true
from (select unnest(enum_range(null::user_role)) as role) r
where r.role::text = any (array['admin','manager','supervisor','dept_admin'])
on conflict (role, permission_key) do update set allowed = true;

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
--   select permission_key, string_agg(role::text, ', ' order by role) roles
--     from role_permissions
--    where permission_key in ('mtn_repair:approve','mtn_repair:mtn_head','mtn_repair:close_cost')
--      and allowed group by 1 order by 1;
--   -- close_cost ต้องได้ชุดเดียวกับ approve (ยกเว้น mtn ที่ได้เฉพาะ mtn_head)
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   delete from role_permissions
--    where permission_key in ('mtn_repair:mtn_head','mtn_repair:close_cost');
--   -- ลบแล้วโค้ดถอยไปใช้ `approve` เดิมอัตโนมัติ (fallback) = กลับไปพฤติกรรมก่อนหน้าทันที
