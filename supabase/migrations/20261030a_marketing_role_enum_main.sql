-- ── Main project (ewhdfqwfwofivojtsizn — ชื่อในจอ Supabase = "MAIN") ──────────────────
-- role ใหม่: marketing = ฝ่ายการตลาด (Q-neX / E-Quotation · คำสั่ง user 2026-10-30)
--   ต้นน้ำของสายธาร Marketing → New Model → โรงงาน (docs/MARKETING-QNEX-DESIGN.md)
--   ใช้เว็บ edition "ก่อน SOP" ร่วมกับทีม New Model (engineer_nm) — คนละ role เพราะชุดสิทธิ์ต่างกันจริง:
--   marketing = ออก RFQ / ส่ง CRD / บันทึก Award / ออกใบแจ้งจัดทำ · engineer_nm = APQP/PPAP ของพาร์ท
--   (เกณฑ์เพิ่ม role ตาม CLAUDE.md "Role System": ชุดสิทธิ์ต้องต่างจาก role เดิมจริง — ตรงนี้ต่างทั้งหน้าและปุ่ม)
--
-- ⚠️ ALTER TYPE ADD VALUE ใช้ค่าใหม่ในทรานแซกชันเดียวกันไม่ได้ ⇒ ไฟล์นี้มี**แค่ท่อนเดียว**
--    ท่อนที่ 2 (ตาราง + seed สิทธิ์) อยู่ `20261030b_mkt_rfq_phase1_main.sql` — รันหลังไฟล์นี้จบแล้วเท่านั้น
--
-- Rollback: ค่าใน enum ลบไม่ได้ (PostgreSQL ไม่รองรับ DROP VALUE) — ค่าที่ค้างไว้ไม่มีผลกับใคร
--   ถ้าไม่มี user ถือและไม่มีแถวสิทธิ์ (ลบแถวสิทธิ์ที่ไฟล์ b)
alter type user_role add value if not exists 'marketing';

-- ตรวจหลังรัน:
-- select unnest(enum_range(null::user_role))::text;   -- ต้องมี marketing
