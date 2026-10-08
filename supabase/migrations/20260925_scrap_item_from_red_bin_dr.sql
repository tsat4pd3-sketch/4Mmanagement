-- ══════════════════════════════════════════════════════════════════════════════
-- เชื่อม "ถังแดง" → "ใบรายงานของเสีย" ตาม WI-PD3-069 §5.5  (DR · 2026-09-25 · apply แล้ว)
--
-- WI สั่งว่า: หัวหน้างานจัดทำ Scrap Report (FM-PD2-002) **โดยอ้างอิงรายละเอียดชิ้นงาน
--            และจำนวนตามแท็กแดง (Tag Reject)** แล้วขออนุมัติทำลายตาม DOA
-- ของจริงในระบบก่อนหน้านี้: ใบรายงานของเสีย prefill จาก `defect_logs` ตรงๆ **ข้ามถังแดงไป**
--   ⇒ 2 เส้นทางขนานที่ไม่คุยกัน · วัดจริง 25/09: ถังแดง 24 แถว (15/08–24/09 ใช้ต่อเนื่อง)
--     แต่ใบรายงานของเสียมีแค่ 6 ใบ (18–19/08 แล้วเลิก) · ผูกกันแล้ว 0 ใบ
--   ⇒ ของเข้าถังแดงแล้วไม่มีใบขออนุมัติทำลาย = สาย DOA ขาดตอน
--
-- `quality_bin_records.scrap_report_id` มีอยู่ตั้งแต่ 2026-08-19 แต่ **ไม่มีโค้ดไหนอ่าน/เขียนเลย**
-- (grep ทั้ง src/ ได้ 0 จุด) = คอลัมน์ตาย · migration นี้เติมขาที่ขาดอีกข้างแล้วเปิดใช้ทั้งคู่
--
-- ย้อนกลับ: drop column src_bin_id (ข้อมูลเดิมไม่ถูกแตะ — เป็นคอลัมน์ใหม่ nullable ล้วน)
-- ══════════════════════════════════════════════════════════════════════════════
alter table scrap_report_items
  add column if not exists src_bin_id uuid references quality_bin_records(id) on delete set null;

comment on column scrap_report_items.src_bin_id is
  'แถวนี้มาจากถังแดงใบไหน (quality_bin_records) — WI-PD3-069 §5.5 ให้ Scrap Report อ้างอิงตามแท็กแดง · on delete set null: ใบ scrap เป็นบันทึกคุณภาพ ต้องอยู่ต่อแม้ใบถังถูกลบ (หลักเดียวกับ from_yellow_id/defect_log_id)';

create index if not exists idx_scrap_items_src_bin on scrap_report_items(src_bin_id) where src_bin_id is not null;
create index if not exists idx_qbin_scrap_report on quality_bin_records(scrap_report_id) where scrap_report_id is not null;
