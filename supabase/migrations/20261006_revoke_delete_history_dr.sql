-- DR / Product DB (eyhclzkifitbhbljgoav) · DB audit 05/10 set A3 · คำสั่ง user 06/10 "ทำ A ได้"
-- ถอนสิทธิ์ DELETE จาก anon/authenticated บน "ตารางประวัติ" ที่แอป **ไม่เคยลบ**
--   เหตุ: DR anon-open ⇒ ใครมี public key ก็ลบประวัติได้ทั้งตารางด้วยคำสั่งเดียว
--   ตรวจแล้ว 06/10: ไม่มี .delete() ใน src/ + supabase/functions (รวม helper ลบแบบ dynamic
--   SimpleMasterPanel/TaxonomyManagerModal/PlannerSales.planReplace ที่ชี้ตารางอื่น) · ไม่มี function/trigger
--   ใน DR ที่ `delete from` ตารางเหล่านี้ · FK cascade จากแม่ทำงานด้วยสิทธิ์เจ้าของตาราง (ไม่กระทบ)
--   · edge function ใช้ service_role (ไม่กระทบ)
-- ⚠️ ไม่ใช่การเปลี่ยน RLS เป็น TO authenticated (กฎเหล็ก DR) — insert/update/select ยังเหมือนเดิมทุกอย่าง
-- rollback: grant delete on <รายชื่อเดียวกัน> to anon, authenticated;
revoke delete on
  public.prod_order_qty_updates, public.mtn_stock_txns, public.purchase_requests,
  public.raw_withdrawal_requests, public.stock_receipts, public.quality_bin_records,
  public.inspection_results, public.monitoring_shipments, public.mtn_order_parts,
  public.child_lot_requests, public.customer_pull_signals, public.audit_log,
  public.child_demand_explosions
from anon, authenticated;
