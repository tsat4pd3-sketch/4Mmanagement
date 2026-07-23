-- ══════════════════════════════════════════════════════════════════════════
-- ประเภทแรงงาน Direct/Indirect ตั้งที่ผังองค์กร (org_nodes.labor_type) · Main · 2026-07-22
--
-- แนวคิด (คำสั่ง user): ตั้งที่ผังองค์กร — node ที่เกี่ยวกับการผลิต = direct
-- (ฝ่ายผลิต/operator) · ที่เหลือ = indirect (ช่างซ่อมบำรุง/QA/ธุรการ/ขาย)
-- ⚠️ ตั้งได้ทั้ง **section และ department** — ช่างส่วนใหญ่อยู่ระดับแผนก (department) ไม่ใช่ section
-- พนักงาน derive ประเภทจาก department ก่อน แล้ว section (คุมที่เดียว) — ดู src/utils/laborType.js
--
-- ช่างซ่อมบำรุง = พนักงาน section MTN/JIG/DIE (indirect) มี employee_skills เหมือน operator
-- แค่คนละชุดสกิล — รวมฐานข้อมูลคนที่ employees ที่เดียว (ดู CLAUDE.md "Direct/Indirect Labor")
--
-- Rollback: alter table org_nodes drop column labor_type;  (additive ล้วน)
-- ══════════════════════════════════════════════════════════════════════════

alter table public.org_nodes
  add column if not exists labor_type text;   -- 'direct' | 'indirect' (null = ใช้ default heuristic ในโค้ด)

-- seed ค่าเริ่มต้นให้ section ที่มีอยู่ (admin ปรับ/เพิ่มได้ที่ OrgSetup) —
-- section ผลิต (ชื่อเข้าเกณฑ์ production) = direct · ที่เหลือ = indirect
update public.org_nodes
   set labor_type = 'direct'
 where kind = 'section' and labor_type is null
   and upper(coalesce(code, name)) ~ 'PD\s?[0-9]|GOR|HYDRO|ASSY|ASSEMBLY|WELD|PRESS|LASER|BEND|LINE|FENDER|APRON';

update public.org_nodes
   set labor_type = 'indirect'
 where kind = 'section' and labor_type is null;
