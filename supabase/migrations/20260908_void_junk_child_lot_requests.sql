-- 🧹 ล้างใบสั่งผลิตลูก "ขยะ" 2 ชุด  ·  ⚠️ DR project / "Product DB" (eyhclzkifitbhbljgoav)
--
-- ที่มา (audit จากภาพหน้า Daily Report ของ LASER-345 · user เคาะ 2026-09-08 "ใบขยะให้เอาออกเลย"):
--   (ก) ใบละ ≤1 ชิ้น 400 ใบ (20067543 · 20067544 · 20067545 · 20070738 — user ยืนยันว่าเป็น OP ทั้งหมด)
--       เกิด 2–4 ก.ย. จาก `kanban_standards.lot_size = 1` ที่ planner ใส่ตามคำแนะนำบนจอ Kanban Std
--       ("ใส่ 1 = ผลิตตามสั่ง") แต่ทริกเกอร์ตีความ 1 = "ออกใบละ 1 ชิ้น" — บั๊กเดิม 21/08 กลับมาอีกทาง
--       (แก้ต้นเหตุที่ `20260908_lot_mode_direct.sql` — โหมด "ไม่สะสมล็อต" แทนการใส่ 1)
--   (ข) ใบสั่งผลิตของ 5xx/3xx (50031601 coil 20 ใบ · 1,000 ชิ้น/ใบ · ค้าง 63–68 วัน)
--       เกิด 1–9 ก.ค. **ก่อน** migration 20260710 ที่ route ของซื้อ (3xx/5xx) ไป purchase_requests
--       ตอนล้าง 24/08 แตะเฉพาะใบ ≤1 ชิ้น จึงรอดมา 2 เดือน · เหล็กซื้อจากข้างนอกไม่มีทาง "ผลิตเสร็จ" ได้
--       และวันนี้มีคนกด "รับงาน" ไปแล้ว 5 ใบ = ไลน์รับงานปลอมเข้าคิว
--
-- ⚠️ ไม่ลบ — `status='cancelled'` + เหตุผลต่อท้ายชื่อพาร์ท (precedent: 20260824_void_tiny_lot_requests ·
--    purchase_requests 984 ใบ · 4M [Auto] 323 ใบ) · backup ก่อนทุกครั้ง
-- ⚠️ ครั้งนี้แตะ `producing` ด้วย (ต่างจาก 24/08) — user สั่ง "เอาออกเลย" และใบที่ถูกกดรับงานคือใบขยะชุดเดียวกัน
-- ⚠️ ใบเบิกวัตถุดิบที่ผูกกับใบเหล่านี้ (`raw_withdrawal_requests` pending) → cancelled ด้วย ไม่งั้นคิวสโตร์โชว์งานผี
-- ความต้องการจริงไม่หาย: ยอดของ (ก) ยังอยู่ใน `child_demand_accumulator` (775 ชิ้น) · (ข) ออกเป็นใบสั่งซื้ออยู่แล้ว (740 ใบ)

begin;

create table if not exists public.child_lot_req_bak_junk_20260908 as
select * from public.child_lot_requests where false;

insert into public.child_lot_req_bak_junk_20260908
select * from public.child_lot_requests c
 where c.status in ('pending', 'producing')
   and (coalesce(c.lot_qty, 0) <= 1 or c.child_mat_no like '3%' or c.child_mat_no like '5%')
   and not exists (select 1 from public.child_lot_req_bak_junk_20260908 b where b.id = c.id);

-- ใบเบิกวัตถุดิบของใบขยะ → cancelled (เฉพาะที่ยัง pending — ใบที่จ่ายแล้วคือของจริง ห้ามยุ่ง)
update public.raw_withdrawal_requests r
   set status = 'cancelled'
 where r.status = 'pending'
   and r.lot_request_id in (select id from public.child_lot_req_bak_junk_20260908);

update public.child_lot_requests c
   set status = 'cancelled',
       part_name = coalesce(c.part_name, '') ||
         case when coalesce(c.lot_qty, 0) <= 1
              then ' [ยกเลิก 08/09: ใบละ 1 ชิ้นจาก lot_size=1 — พาร์ทเป็น OP/ไม่สะสมล็อต]'
              else ' [ยกเลิก 08/09: เหล็ก 5xx เป็นของซื้อ ไม่ใช่ใบสั่งผลิต — ซากก่อน routing 10/07]' end
 where c.status in ('pending', 'producing')
   and (coalesce(c.lot_qty, 0) <= 1 or c.child_mat_no like '3%' or c.child_mat_no like '5%');

commit;

-- เช็คผลหลังรัน (คาด: junk_left = 0 · bak ≈ 420):
--   select count(*) filter (where status not in ('done','cancelled')
--                             and (coalesce(lot_qty,0) <= 1 or child_mat_no like '3%' or child_mat_no like '5%')) junk_left,
--          (select count(*) from child_lot_req_bak_junk_20260908) bak
--     from child_lot_requests;
-- Rollback:
--   update public.child_lot_requests c set status = b.status, part_name = b.part_name
--     from public.child_lot_req_bak_junk_20260908 b where b.id = c.id;
--   update public.raw_withdrawal_requests set status = 'pending'
--    where status = 'cancelled' and lot_request_id in (select id from public.child_lot_req_bak_junk_20260908);
