-- ═══ ซ่อน MAT เก่า: ปิด kanban_standards ของเลขที่ถูก EC แทนแล้ว (2026-08-17 · feedback ประชุมทีมงาน) ═══
-- โปรเจค: DR (eyhclzkifitbhbljgoav)
--
-- ที่มา: EC 2026-08-14 ออกเลขใหม่ (10105769/10105770) แทน 10100333/10100379 — dr_products ฝั่งเลขเก่า
--   ถูกปิด (superseded) แล้ว แต่แถว kanban_standards ของเลขเก่ายัง is_active → ยังโชว์ในลิสต์คัมบัง/
--   Store min-max/Planner ทั้งที่เลิกใช้แล้ว (ทีมงานขอ "hide mat เก่า")
-- การซ่อนเป็น "การตัดสินใจของคน" ตามหลัก EC (ช่วงเปลี่ยนผ่านให้ของเก่าไหลได้) — migration นี้คือการ
--   ตัดสินใจนั้น: user ยืนยันเลิกใช้เลขเก่าแล้ว (2026-08-17)
-- หมายเหตุ: สต็อกคงเหลือของเลขเก่า (line_stock_transactions) ไม่ถูกแตะ — ยอดยังอยู่/ตัดส่งได้ตามปกติ
--   (การเช็ค stock ฝั่ง Delivery อ่านจาก ledger ไม่ใช่ kanban_standards)
--
-- Rollback: update kanban_standards set is_active = true
--   where mat_no in ('10100333','10100379','M8 ไม่มีเกลียว');

update kanban_standards k
set is_active = false
where k.is_active
  and exists (
    select 1 from dr_products p
    where p.mat_no = k.mat_no and p.superseded_by is not null
  );
