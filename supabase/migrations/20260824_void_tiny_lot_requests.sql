-- 🧹 ล้างใบสั่งผลิตลูก "1 ชิ้น/ล็อต" ที่เกิดจากบั๊กหน่วย lot_size  (DR)
--
-- ที่มา (user 2026-08-24): "ฟีเจอร์ store ใช้งานยากมาก ดูรกและอะไรเยอะไปหมด"
--   เปิดบอร์ด Store Child แล้วเจอการ์ด `20066630 · 1 ชิ้น/ล็อต` ซ้ำกัน 20+ ใบเต็มจอ
--   ⇒ ไม่ใช่เรื่อง layout อย่างเดียว — **ตัวข้อมูลเองเป็นขยะ**
--
-- ต้นเหตุ = บั๊กหน่วย lot_size (ใบ vs ชิ้น) ที่เพิ่งแก้ไปเมื่อ 2026-08-21
--   `fn_explode_child_demand` ออกใบด้วย `while pending >= lot` → lot = 1 ชิ้น
--   = ออกใบละ 1 ชิ้นรัวๆ จนชนเพดาน MAX_LOTS
--   ข้อมูลตอนล้าง: pending 150 ใบ — **100 ใบเป็นใบละ ≤1 ชิ้น (67%)**
--
-- ⚠️ ไม่ลบ — `status='cancelled'` + เหตุผลต่อท้ายชื่อพาร์ท
--    (precedent เดียวกับการล้าง purchase_requests 984 ใบ และ 4M `[Auto]` 323 ใบ)
--    ความต้องการจริงไม่หาย: ยอดยังอยู่ใน `child_demand_accumulator` และจะออกใบใหม่
--    ด้วยขนาดล็อตที่ถูกหน่วยแล้วในรอบผลิตถัดไป
-- ⚠️ แตะเฉพาะ `status='pending'` — ใบที่ช่างกด "เริ่มผลิต"/"ผลิตเสร็จ" ไปแล้วคือของจริง ห้ามยุ่ง

create table if not exists public.child_lot_req_bak_tiny_20260824 as
select * from public.child_lot_requests where false;

insert into public.child_lot_req_bak_tiny_20260824
select * from public.child_lot_requests
 where status = 'pending' and coalesce(lot_qty, 0) <= 1
   and not exists (select 1 from public.child_lot_req_bak_tiny_20260824 b where b.id = child_lot_requests.id);

update public.child_lot_requests
   set status = 'cancelled',
       part_name = coalesce(part_name, '') || ' [ยกเลิก: ล็อต 1 ชิ้นจากบั๊กหน่วย lot_size 24/08]'
 where status = 'pending' and coalesce(lot_qty, 0) <= 1;

-- Rollback:
--   update public.child_lot_requests c set status = b.status, part_name = b.part_name
--     from public.child_lot_req_bak_tiny_20260824 b where b.id = c.id;
