-- DR (eyhclzkifitbhbljgoav · ชื่อในจอ Supabase "Product DB") · 2026-11-26 · คำสั่ง user
-- SPC อุปกรณ์ (ค่าตัวเลขจากใบ AM/PM) — "ทุกข้อตัวเลขขึ้นกราฟอัตโนมัติ + ปิดรายข้อได้"
-- (ข้อที่เป็นตัวนับ เช่น "รอบการเปลี่ยนไกด์พิน 0–5000 รอบ" ไม่ใช่ข้อมูลกระบวนการ ⇒ PM Setup ปิดได้)
-- กติกาอยู่ src/utils/equipSpc.js · 📄 docs/modules/equipment-spc.md
-- backward-compatible: default true · ไม่มีผลกับการตรวจ/บันทึกใดๆ (ใช้แค่เลือกว่าข้อไหนขึ้นจอ SPC)
-- ↩️ rollback (ย้อนโค้ดก่อน): alter table public.jig_checkpoints drop column if exists spc_enabled;

alter table public.jig_checkpoints
  add column if not exists spc_enabled boolean not null default true;

-- ตรวจผล:
-- select spc_enabled, count(*) from public.jig_checkpoints group by 1;
