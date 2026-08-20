-- ══ ขั้นงานโปรเจคปรับปรุงติดป้ายเฟส PDCA (DR · 2026-08-19 · คำสั่ง user) ══
-- "ระบบแผนงาน improvement ต้องอิงหลัก PDCA ให้เห็นชัด ส่วนไหนของพาร์ทไหน"
-- phase เป็น "ข้อมูล" ต่อขั้น ไม่ derive จากชื่อขั้น (ขั้นแก้/เพิ่มเองได้ ชื่ออิสระ — เดาจากชื่อ = พังเงียบ)
-- · null = ยังไม่ระบุเฟส (ขั้นเก่าก่อน migration / ขั้นที่คนไม่เลือก) — UI โชว์เป็น "–" ห้ามเดาให้
-- · จังหวะ "เริ่มลงมือ (Do)" ของโปรเจคผูกกับ phase='do' ตัวแรกที่ถูกติ๊กเริ่ม
-- additive · rollback: alter table public.improvement_milestones drop column phase;

alter table public.improvement_milestones
  add column if not exists phase text check (phase is null or phase in ('plan','do','check','act'));

-- backfill เฉพาะขั้นที่ seed จากระบบ (ชื่อมาตรฐาน 5 ขั้น ที่ยังไม่ถูกแก้ชื่อ) — ขั้นที่คนตั้งเองไม่เดา
update public.improvement_milestones set phase = 'plan'
  where phase is null and title in ('1. วิเคราะห์สาเหตุ (Plan)', '2. วางแผน/เตรียมการแก้ไข');
update public.improvement_milestones set phase = 'do'
  where phase is null and title = '3. ดำเนินการแก้ไข (Do)';
update public.improvement_milestones set phase = 'check'
  where phase is null and title like '4. ติดตามผลจากข้อมูลจริ%';
update public.improvement_milestones set phase = 'act'
  where phase is null and title like '5. สรุปผล/จัดทำมาตรฐา%';
