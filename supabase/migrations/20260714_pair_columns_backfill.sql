-- ── DR project (eyhclzkifitbhbljgoav) ──
-- Migration ย้อนหลัง (บันทึกประวัติ schema — คอลัมน์ถูกเพิ่มตรงใน dashboard เมื่อ 2026-07-13
-- ตอนทำฟีเจอร์งานคู่ RH/LH ของใบ manual โดยไม่มี migration file — QC audit รอบ 3 กฎ B3/G):
-- dr_products.pair_mat_no  = MAT.NO ของงานคู่ (RH↔LH)
-- prod_orders.paired_order_id = ผูกใบคู่สองทาง (เปิดเป้าคู่อัตโนมัติ)
-- idempotent: if not exists ทั้งคู่ — รันซ้ำ/รันบน DB ที่มีแล้วไม่พัง

alter table dr_products add column if not exists pair_mat_no text;
alter table prod_orders add column if not exists paired_order_id uuid;
