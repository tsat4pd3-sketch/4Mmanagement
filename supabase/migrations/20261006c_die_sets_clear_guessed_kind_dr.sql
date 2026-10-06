-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ล้างรูปแบบชุดแม่พิมพ์ที่ "เดาไว้" ให้เป็น "ยังไม่ระบุ" (null) — 2026-10-06 · คำสั่ง user
--
-- ที่มา: ชุดทั้ง 92 ชุดสร้างอัตโนมัติจากชื่อเครื่องเดิม (10/08) — kind ถูกเดาจากชื่อ ไม่มีคนยืนยัน
--   (ตรวจ audit_log แล้ว: ไม่มีใครเคยแก้ kind ด้วยมือสักชุด) · ใบแจ้งซ่อมดึงชนิดอุปกรณ์จากรูปแบบชุด
--   ⇒ ค่าที่เดาไว้ไหลไปถึงใบ MO · ล้างแล้วให้ทีม DIE ยืนยันเองทีละชุด (จอมีตัวนับ/ตัวกรอง "ยังไม่ระบุ")
-- ⚠️ ผลข้างเคียงที่ยอมรับ: แม่พิมพ์ที่ไม่มีประเภท OP จะเติมชนิดอุปกรณ์ในใบแจ้งซ่อมเองไม่ได้ จนกว่าทีมกรอก
--   (แม่พิมพ์ HDF 12 ตัวมีประเภท OP แล้ว — ยังเติมได้เหมือนเดิม)
-- apply แล้ว 06/10 โดย AI session ผ่าน MCP
-- สำรองค่าเดิม: archive.die_sets_kind_guess_20261006 (92 แถว · schema archive ไม่ถูก expose ผ่าน API)
-- rollback (คืนเฉพาะแถวที่ยังว่างอยู่ — ไม่ทับค่าที่ทีมกรอกใหม่):
--   update public.die_sets s set kind = b.kind from archive.die_sets_kind_guess_20261006 b
--    where b.id = s.id and s.kind is null;

create schema if not exists archive;
create table if not exists archive.die_sets_kind_guess_20261006 as
  select id, kind, part_name, line_name, note from public.die_sets where kind is not null;

update public.die_sets s set kind = null
  from archive.die_sets_kind_guess_20261006 b
 where b.id = s.id and s.kind = b.kind;
