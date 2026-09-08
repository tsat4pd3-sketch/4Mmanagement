-- 🕵️ audit trail ให้ production_sessions  ·  ⚠️ DR project / "Product DB" (eyhclzkifitbhbljgoav)
--
-- ที่มา (audit 2026-09-08): ภาพหน้า Daily Report ตอน 09:33 ขึ้น "ค้างจากวันก่อน 56" (กลุ่ม LINE ASSY TSRA 39 กะ)
--   แต่ 2 ชม.ถัดมา DB เหลือกะค้าง 15 และไม่มีกะ TSRA ของวันก่อนเลย → น่าจะถูก "ลบกะเปล่า" (DailyReport deleteEmpty)
--   **แต่พิสูจน์ไม่ได้** เพราะตารางนี้ไม่มี audit trigger และ FK ของ prod_orders/downtime_logs/defect_logs เป็น ON DELETE CASCADE
--   = ลบกะ 1 ครั้ง ข้อมูลใต้กะหายเงียบทั้งชุดโดยไม่มีร่องรอย
-- กฎ Traceability (docs/modules/traceability-audit-log.md): ตารางที่แก้/ลบได้จากหน้าจอต้องผูก fn_audit
--   ตารางนี้ถูกแก้ทุกกะ (เปิด/ขอปิด/อนุมัติ/ตีกลับ/ลบ) แต่หลุดจากรายการเดิม (20260724_audit_log_dr.sql)
-- actor: fn_audit อ่าน updated_by_name/last_edited_by ซึ่งตารางนี้ไม่มี → actor จะว่าง แต่ new_data/old_data มี
--   closed_by_name / close_requested_by_name / close_reject_by_name ให้สืบได้ · แถว DELETE เก็บทั้งแถวเดิมไว้
-- ไม่แตะ fn_audit (blast radius = ทุกตาราง master ใน DR) · ไม่ใส่ trg_set_updated_at (ตารางไม่มี updated_at
--   และหน้า Daily Report ไม่ได้อ่าน — เพิ่มทีหลังได้)
-- Rollback: drop trigger if exists trg_audit on public.production_sessions;

drop trigger if exists trg_audit on public.production_sessions;
create trigger trg_audit after insert or update or delete on public.production_sessions
  for each row execute function public.fn_audit();

-- เช็ค: select tgname from pg_trigger where tgrelid = 'public.production_sessions'::regclass and tgname = 'trg_audit';
