-- ════════════════════════════════════════════════════════════════════════════
-- DR project ("Product DB" · eyhclzkifitbhbljgoav) — 2026-11-13 · คำสั่ง user
-- ใบ MO ฟอร์ม MTN ช่อง "ผู้อนุมัติ (ผจก.ส่วนซ่อมบำรุง) รับทราบ" — ต้องให้ ผจก. กดเอง
--
-- เดิม: ช่างที่จ่ายงาน (ขั้น 2) เลือกชื่อ ผจก. แล้วระบบเขียน `mo_approved_by` + `mo_approved_at` ให้ทันที
--       ⇒ ใบพิมพ์มีชื่อ+วันที่ (และลายเซ็นสดจากโปรไฟล์ผ่าน uid ที่ resolve จากชื่อ) ทั้งที่ ผจก. ไม่เคยกด
--       วัด 13/11: 86 ใบมีชื่อ · 0 ใบมีลายเซ็นที่เจ้าตัวกด · 39 ใบมี uid (resolve จากชื่อ)
-- ใหม่: `mo_ack_at` = เวลาที่ ผจก. **กดรับทราบเอง** — มีค่า = รับทราบแล้ว · ว่าง = รอรับทราบ
--       `mo_approved_at` เดิมคงไว้เป็นประวัติ (ไม่ลบ ไม่ backfill) · ใบเก่าทั้งหมดจะขึ้น "รอรับทราบ" ตามจริง
-- เพิ่มคอลัมน์ nullable อย่างเดียว ⇒ ของเดิมไม่กระทบ · ย้อนกลับ: alter table mtn_orders drop column mo_ack_at;
-- ════════════════════════════════════════════════════════════════════════════
alter table public.mtn_orders add column if not exists mo_ack_at timestamptz;
comment on column public.mtn_orders.mo_ack_at is
  'เวลาที่ ผจก.ส่วนซ่อมบำรุง กดรับทราบใบ MO ด้วยตัวเอง (ฟอร์ม MTN ช่องเซ็น 4) · ว่าง = รอรับทราบ · 2026-11-13';

-- ตรวจกลับ:
-- select count(*) filter (where mo_ack_at is not null) acked, count(*) filter (where mo_approved_by is not null) named from mtn_orders;
