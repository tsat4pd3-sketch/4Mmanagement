-- ═══════════════════════════════════════════════════════════════════
-- ออเดอร์ manual สำหรับไลน์ที่ไม่มี kanban card — DR project (eyhclzkifitbhbljgoav)
-- เช่น HDF1 ที่ส่งงานต่อให้ LASER CUT 123: SAP ไม่ gen barcode order ให้สแกน
-- → leader "เปิดเป้า" (target) เอง แล้วพนักงานอัพเดทยอดสะสม (qty_actual)
--   ทุกช่วงเบรคตาม break policy · ปิดใบด้วยยอดจริงโดยไม่ต้องสแกน
-- additive ทั้งหมด — ออเดอร์สแกนปกติไม่กระทบ (is_manual default false)
-- ═══════════════════════════════════════════════════════════════════

alter table prod_orders add column if not exists is_manual boolean not null default false;
alter table prod_orders add column if not exists qty_target integer;        -- เป้าที่ตั้งตอนเปิด (qty จะถูกแทนด้วยยอดจริงตอนปิดใบ)
alter table prod_orders add column if not exists qty_updated_at timestamptz; -- เวลาอัพเดทยอดสะสมล่าสุด (ใช้เตือนใบที่ไม่อัพเดทนาน)
