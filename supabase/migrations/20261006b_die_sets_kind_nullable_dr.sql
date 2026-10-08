-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- รูปแบบชุดแม่พิมพ์: ค่าเริ่มต้น = "ยังไม่ระบุ" (null) แทน 'tandem' — 2026-10-06 · คำสั่ง user
--
-- ที่มา: `kind text not null default 'tandem'` ⇒ ชุดที่ไม่มีใครเลือกรูปแบบ ถูกบันทึกเป็น Tandem เงียบๆ
--   (ขัดกฎโมดูล "null = ยังไม่ระบุ ห้าม default เป็นค่าใดค่าหนึ่ง — ห้ามเดาแทนหน้างาน")
--   และตอนนี้ใบแจ้งซ่อมดึง "ชนิดอุปกรณ์" จากรูปแบบชุด ⇒ ค่าที่เดาไว้จะไหลไปถึงใบ MO
-- ไม่แตะข้อมูลเดิม (92 ชุด) — เปลี่ยนเฉพาะค่าเริ่มต้นของชุดใหม่
-- apply แล้ว 06/10 โดย AI session ผ่าน MCP
-- rollback (revert โค้ดก่อน · ต้องไม่มีแถว null ก่อน):
--   alter table public.die_sets alter column kind set default 'tandem', alter column kind set not null;

alter table public.die_sets alter column kind drop default, alter column kind drop not null;
