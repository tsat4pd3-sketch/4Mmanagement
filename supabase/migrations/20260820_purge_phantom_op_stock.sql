-- 🧹 ล้าง "สต๊อกปลอม" ที่เกิดจากรายการขั้นตอน (OP) ถูกโพสต์เข้าคลัง  (DR)
--    ⚠️ ต้อง apply `20260820_op_items_never_enter_stock.sql` ก่อน ไม่งั้นล้างแล้วกลับมาใหม่
--    ✅ apply แล้ว 2026-08-20 — ลบ 74 แถว / 33,746 ชิ้น · ไม่มี mat ไหนติดลบหลังล้าง
--       (FG WAREHOUSE เหลือ 55,745 · STORE 82,536 · OP หายจากลิสต์ทั้ง 2 คลัง)
--
-- ⚠️ 50031601 / 50031602 (WSS-M1A367-A36 = คอยล์ 5xx ของ LASER-345) ถูกติดธง is_operation
--    โดยคน (สุวิทย์ชัย ดีทั่ว · 19/08) — การล้างนี้ **ไม่แตะ** เพราะแถวสต๊อกของมันเป็น manual
--    (created_by ≠ 'auto') ทั้งหมด · แต่ธงนั้นขัดกับตัวมันเอง: 50031601 อยู่ใน BOM 9 แถว +
--    parts_master + kanban active + เป็น op_parent_mat ของ 90031601/02 (พาร์ทแม่เป็น OP ไม่ได้)
--    → ให้ทีมตัดสินใจว่าจะปลดธงไหม **ห้ามปลดให้เอง** (คนตั้งใจกดเอง ไม่ใช่บั๊ก)
--
-- ล้างอะไร: แถว line_stock_transactions ที่ created_by='auto' type='issue'
--   ของ mat_no ที่เป็น OP (is_operation) + ชื่อ OP รุ่นเก่าที่ไม่มี master แล้ว
-- ไม่ล้าง: ใบผลิต (prod_orders) — ประวัติการผลิตของขั้นตอนยังอยู่ครบ
--
-- ย้อนกลับได้: snapshot ลงตาราง _bak ก่อนลบเสมอ

begin;

create table if not exists public.line_stock_txn_bak_op_20260820
  (like public.line_stock_transactions including all);

with op_mats as (
  select mat_no from public.dr_products where coalesce(is_operation, false)
  union
  -- ชื่อ OP รุ่นเก่าที่ถูกเปลี่ยนชื่อไปแล้ว ไม่เหลือ master (ตรวจแล้ว 2026-08-20)
  select unnest(array['173 (M6 มีเกลียว)','173 (M8 ไม่มีเกลียว)','20066660 (M6 ไม่มีเกลียว)'])
)
insert into public.line_stock_txn_bak_op_20260820
select t.* from public.line_stock_transactions t
where t.mat_no in (select mat_no from op_mats)
  and t.created_by = 'auto' and t.type = 'issue';

delete from public.line_stock_transactions t
where t.id in (select id from public.line_stock_txn_bak_op_20260820);

commit;

-- Rollback:
--   insert into public.line_stock_transactions
--   select * from public.line_stock_txn_bak_op_20260820
--   on conflict (id) do nothing;
