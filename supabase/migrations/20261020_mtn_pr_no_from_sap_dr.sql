-- DR project (eyhclzkifitbhbljgoav · "Product DB") — 2026-10-19 · คำสั่ง user
-- "เลข PR ระบบออกเองไม่ได้ — เลขมาจาก SAP แอดมินช่างกรอกเข้าระบบ ลิงก์ไปที่ใบ MO ที่รอ PR"
-- ✅ สถานะ 20/10: user รันใน SQL Editor แล้ว (เช็คแล้ว: idx_mtn_pr_no มี · uq_mtn_pr_no ไม่มี)
-- · เลิกออกเลขอัตโนมัติ: client ไม่เรียก mtn_assign_pr_no / ไม่อ่าน mtn_pr_seq แล้ว (ด่าน regressionGuards)
--   ฟังก์ชัน/ตารางเลขรันคงไว้ก่อน (ไม่มีใครเรียก) — ลบทีหลังได้เมื่อแน่ใจ
-- · PR ใน SAP 1 ใบมีหลายรายการ ⇒ เลขเดียวผูกหลายแถว/หลายใบ MO ได้ → ถอด unique เป็น index ธรรมดา
--   (จอถามยืนยันเมื่อเลขซ้ำ ไม่บล็อก)
-- ย้อนกลับ: drop index idx_mtn_pr_no; create unique index uq_mtn_pr_no on public.mtn_purchase_requests(pr_no) where pr_no is not null;
--          (ทำได้เฉพาะตอนยังไม่มีเลขซ้ำ)
set local lock_timeout = '5s';
drop index if exists public.uq_mtn_pr_no;
create index if not exists idx_mtn_pr_no on public.mtn_purchase_requests (pr_no) where pr_no is not null;
comment on function public.mtn_assign_pr_no(uuid) is 'เลิกใช้ 2026-10-19 — เลข PR มาจาก SAP (แอดมินช่างกรอก) ห้ามเรียกจาก client';
