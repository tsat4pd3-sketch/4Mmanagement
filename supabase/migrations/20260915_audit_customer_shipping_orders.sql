-- ═══════════════════════════════════════════════════════════════════════════════
-- audit ตารางใบส่งลูกค้า (DR project · eyhclzkifitbhbljgoav "Product DB")
--
-- 🔴 ที่มา 2026-09-15: หน่วยงานแจ้งว่า "ใบที่อัพจาก 862/830 โดน e-SMART ลบ"
--    ตรวจแล้วพบว่า **ตอบไม่ได้จากหลักฐาน** เพราะ `customer_shipping_orders`
--    ไม่มี trigger audit เลยสักตัว (ทั้งที่เป็นตารางหน้าตักติดต่อลูกค้า และมี
--    จุดที่ลบแถวจริงอยู่ใน PlannerSales — ลบ pending ทั้งช่วง horizon ตอนอัพ 862)
--    ⇒ ข้อพิพาทแบบนี้ต้องชี้ขาดด้วย log ไม่ใช่ด้วยการเดา
-- rollback: drop trigger trg_audit on public.customer_shipping_orders;
-- ═══════════════════════════════════════════════════════════════════════════════
drop trigger if exists trg_audit on public.customer_shipping_orders;
create trigger trg_audit
  after insert or update or delete on public.customer_shipping_orders
  for each row execute function public.fn_audit();
