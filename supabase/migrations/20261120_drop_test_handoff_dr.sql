-- ══ 🧹 ลบแถวส่งต่อของ "ใบทดสอบ" ที่ทำให้แผงโซ่ขาดมีขยะ — DR "Product DB" · eyhclzkifitbhbljgoav ══
-- 2026-11-20 · user: *"ตัวที่ test ลบได้เลย"*
--
-- แถวที่ลบ: mtn_order_handoffs id = b83ae11d-bd3c-4879-9bab-cc408cc9efaa
--   ส่งต่อ 31/10/2026 07:59 (ไทย) · production → jig_maintenance · โดย ชลทิตย์ วิฬุละหิต
--   reason = 'Test' · to_order_id = null (ปลายทางถูกลบไปแล้วตั้งแต่ก่อนปิดรู FK 11/11)
--
-- หลักฐานว่าเป็นใบทดสอบจริง (ไม่ใช่งานซ่อมจริง) — ใบต้นทาง PRO-BM-311026-1181-M633:
--   `report_note` = '[จาก Downtime] Test'   ← ตัวใบเองก็เขียนว่า Test
--   machine JHYD04-02 · Laser LWR · เปิดจากใบ downtime ของ จีระพล ตุทา
--   ไม่มี root_cause / solution / tech_main เลย ⇒ ไม่เคยมีการซ่อมจริง
--
-- 🔴 **ลบเฉพาะแถว "การส่งต่อ" ไม่ได้ลบใบ MO**
--    `PRO-BM-311026-1181-M633` มีเลขที่แล้ว ⇒ กฎโปรเจคห้ามลบ (ใบที่มีเลข = บันทึก)
--    และใบนั้นอยู่สถานะ `transferred` ซึ่งเป็นสถานะจบอยู่แล้ว ไม่ค้างในคิวใคร
--    สิ่งเดียวที่มันทำคือโผล่บนแผง "🔗 ส่งต่อแล้วแต่ปลายทางไม่มีใครทำ" ใน /mtn-repair
--
-- ⚠️ ไฟล์นี้บันทึกสิ่งที่ apply ผ่าน MCP ไปแล้ว 20/11 (ไม่ใช่ของค้างรอรัน)

delete from public.mtn_order_handoffs
 where id = 'b83ae11d-bd3c-4879-9bab-cc408cc9efaa'
   and reason = 'Test'
   and to_order_id is null;     -- fail-closed: ถ้าวันหลังมีคนผูกปลายทางให้แล้ว จะไม่ลบ

-- ── ตรวจผล (DR "Product DB" · eyhclzkifitbhbljgoav) ──────────────────────────────────────
--   select count(*) filter (where h.to_order_id is null) as missing,
--          count(*) filter (where c.status in ('rejected','cancelled')) as void_child
--     from mtn_order_handoffs h left join mtn_orders c on c.id = h.to_order_id;
--   วัดหลังลบ 20/11: missing 4 → 3 · void_child 1 (เท่าเดิม)
--
-- ── rollback (ใส่แถวกลับเป๊ะ) ──────────────────────────────────────────────────────────────
-- insert into public.mtn_order_handoffs
--   (id, from_order_id, to_order_id, from_dept, to_dept, reason, handed_by, handed_by_uid, handed_at, created_at)
-- values
--   ('b83ae11d-bd3c-4879-9bab-cc408cc9efaa', '9821f7de-6c55-485a-b19a-12d3cc33d5d9', null,
--    'production', 'jig_maintenance', 'Test', 'ชลทิตย์ วิฬุละหิต',
--    'cb97d9c8-f33d-428a-9c87-af6c341198bb',
--    '2026-10-31 00:59:12.814+00', '2026-10-31 01:00:59.011811+00');
