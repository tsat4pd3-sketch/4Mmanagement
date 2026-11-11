-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ 🔗 ใบปลายทางของการส่งต่อ MO ลบไม่ได้ — ปิดรู "ปัญหาหายจากระบบ"              ║
-- ║ DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-11 · คำสั่ง user ║
-- ╚════════════════════════════════════════════════════════════════════════════╝
--
-- ที่มา (ไล่จากรอบตรวจรายวัน 11/11): แผง health check เห็น "transferred ค้าง 31 ใบ"
-- ซึ่งที่จริง `transferred` = **สถานะจบ** (`MO_DONE_STATUSES`) — โมเดลคือ 1 ปัญหา หลายใบ
-- ผูกกันเป็นสาย: ใบเดิมจบที่ transferred แล้วเปิดใบใหม่ของทีมปลายทาง ผูกด้วย mtn_order_handoffs
--
-- ไล่ปลายสายของ 31 ใบ: 25 ใบปลายทางปิดงานแล้ว · 2 ใบยังเปิดอยู่จริง · **4 ใบปลายทางหายไป**
-- 🔴 ต้นเหตุ: `to_order_id` ประกาศไว้ `on delete set null`
--    ⇒ ใบลูกถูกลบ = ลิงก์ถูกล้างเงียบๆ · ใบแม่ยัง transferred = จบแล้ว
--    ⇒ ปัญหาหลุดจากคิวของทุกคน และไม่มีจอไหนบอก
-- พิสูจน์จาก `audit_log` — ใบลูกถูก DELETE จริง 3/4 ใบ **ทีม JIG ทั้งหมด ลบตอนยัง `pending`**
--    (ลบได้เพราะใบลูกยังไม่ออกเลข MO ⇒ `moRemoveMode()` เดิมตอบ "ลบได้")
-- ของจริงที่ยังค้าง: Reed ชำรุด Line 61/SP-84 (22/09) · น้ำมันรั่ว HDF-01 (24/09)
--    · บูท Swing แคลมป์ Assy LWR/JHYD04-11 (24/10)
--
-- แก้ 3 ชั้นในคอมมิทเดียว:
--   ① ชั้น DB (ไฟล์นี้) — `on delete restrict` · ด่านจริงที่ client ข้ามไม่ได้
--   ② ชั้นกฎ — `moRemoveMode()` คืน `cancel` ให้ใบที่มี `transferred_from_mo` (บอกเหตุผลบนจอ)
--   ③ ชั้นจอ — แผง "🔗 ส่งต่อแล้วแต่ปลายทางไม่มีใครทำ" (`utils/moHandoffGaps.js`)
--     เอา 3 ปัญหาที่หายไปแล้วกลับมาให้เห็น (ของเก่าที่ลิงก์ขาดแล้ว แก้ย้อนหลังไม่ได้ด้วย FK)
--
-- ⚠️ ไม่แตะข้อมูลเดิมเลย — แถวที่ `to_order_id` เป็น null อยู่แล้ว 4 แถวยังอยู่ครบ
--    (เป็นหลักฐานของปัญหา · แผงชั้น ③ อ่านแถวพวกนี้มาโชว์)

alter table public.mtn_order_handoffs
  drop constraint if exists mtn_order_handoffs_to_order_id_fkey;

alter table public.mtn_order_handoffs
  add constraint mtn_order_handoffs_to_order_id_fkey
  foreign key (to_order_id) references public.mtn_orders(id) on delete restrict;

comment on column public.mtn_order_handoffs.to_order_id is
  'ใบของทีมปลายทาง — on delete RESTRICT (11/11): ลบใบลูกไม่ได้ เพราะใบแม่จบที่ transferred แล้ว ลบ = ปัญหาหายจากระบบ · ยกเลิกใบลูกพร้อมเหตุผลแทน';

-- ── คิวรีตรวจผล (รันใน SQL Editor ของ "Product DB") ───────────────────────────
--   select conname, confdeltype   -- ต้องได้ 'r' (restrict) · 'n' = set null (ของเดิม)
--     from pg_constraint
--    where conrelid = 'public.mtn_order_handoffs'::regclass and contype = 'f'
--      and conname = 'mtn_order_handoffs_to_order_id_fkey';
--
--   -- โซ่ที่ขาดอยู่แล้ว (แผงชั้น ③ โชว์ชุดนี้)
--   select h.handed_at::date, h.to_dept, h.reason, p.mo_no, p.line_name, p.machine_no
--     from mtn_order_handoffs h
--     left join mtn_orders p on p.id = h.from_order_id
--    where h.to_order_id is null order by h.handed_at;
--
-- ── ย้อนกลับ ──────────────────────────────────────────────────────────────────
--   alter table public.mtn_order_handoffs drop constraint mtn_order_handoffs_to_order_id_fkey;
--   alter table public.mtn_order_handoffs add constraint mtn_order_handoffs_to_order_id_fkey
--     foreign key (to_order_id) references public.mtn_orders(id) on delete set null;
