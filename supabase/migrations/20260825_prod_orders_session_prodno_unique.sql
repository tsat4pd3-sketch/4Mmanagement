-- กันเปิดใบผลิตซ้ำจาก 2 เครื่องสแกนการ์ดใบเดียวกันพร้อมกัน (QC flow-audit 2026-08-25 · finding #14)
-- Project ปลายทาง: DR (eyhclzkifitbhbljgoav)
--
-- ที่มา: DailyReport กันใบซ้ำด้วย state ฝั่ง client อย่างเดียว (prodOrders.find) —
-- realtime debounce 600ms + latency โหลด = หน้าต่าง race ~1-2 วิ → 2 เครื่องสแกนพร้อมกัน
-- ได้ใบซ้ำ 2 ใบ แล้วปิดใบ = เข้าคลัง 2 เท่า (trigger fn_post_confirmed_output ต่อใบ)
--
-- ⚠️ กติกาเดิมใน CLAUDE.md: "prod_no ไม่ unique ในตาราง (ทั้งตาราง) โดยตั้งใจ —
--    ยกยอดข้ามกะสร้างแถวใหม่ prod_no เดิม" → ข้อนั้นคือ unique ข้าม "ทุก session"
--    ตัวนี้เป็น partial unique ต่อ (session_id, prod_no) ซึ่งไม่ขัดกัน:
--    - chain ยกยอดอยู่คนละ session เสมอ (ใบเดิมกะเก่ากลายเป็น status='imported' — กันไว้ใน where ด้วย)
--    - ถอยใบ (↩️) เป็น update แถวเดิม ไม่ insert ใหม่
--    - แอปเองก็บล็อก prod_no ซ้ำในกะเดียวกันฝั่ง client อยู่แล้ว ("เปิดไปแล้วในกะนี้")
--    ฝั่ง client แปลง error 23505 เป็นข้อความ "ถูกเปิดโดยเครื่องอื่นแล้ว" ให้แล้ว
--
-- รันซ้ำได้ (if not exists)
create unique index if not exists prod_orders_session_prodno_uniq
  on public.prod_orders (session_id, prod_no)
  where status <> 'imported';

-- เช็คก่อนรัน: มีคู่ซ้ำค้างอยู่ไหม (ต้องได้ 0 แถว ไม่งั้น create index จะ fail)
-- select session_id, prod_no, count(*) from prod_orders
--   where status <> 'imported' group by 1,2 having count(*) > 1;
