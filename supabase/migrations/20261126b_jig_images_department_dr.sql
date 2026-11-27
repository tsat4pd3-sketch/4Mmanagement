-- DR project ("Product DB" · eyhclzkifitbhbljgoav)
-- 🖼️ แยกชุดรูปเครื่อง (jig_images) ตามแผนก — 26/11 คำสั่ง user
--   เหตุ: เครื่อง 1 ตัว = แถว jigs แถวเดียวร่วมกันทุกแผนก แต่ชุดรูปก็ร่วมกันด้วย
--   ⇒ AM (ผลิต) เปลี่ยนรูปที่ PM Setup แล้วกดบันทึก = ลบรูปของ JIG MTN ทิ้ง
--   ⇒ FK image_id ON DELETE SET NULL ล้างจุดตรวจ JIG MTN 1,567 จุด (37 เครื่อง · 140 รูป) ให้ตกไปอยู่บนรูป AM
--   (กู้คืนจาก audit_log แล้ว · backup ใน archive.bk_20261126_*)
-- กติกาใหม่: แผนกเชื่อมกันแค่ "id อุปกรณ์" · รูปเป็นของแผนก (department) · null = แถวเก่าที่ไม่รู้เจ้าของ (เห็นทุกแผนก · ไม่มีใครลบได้)
-- ย้อนกลับ: alter table public.jig_images drop column department;  (โค้ดเดิมไม่อ่านคอลัมน์นี้)

alter table public.jig_images add column if not exists department text;
create index if not exists jig_images_jig_dept_idx on public.jig_images (jig_id, department);

-- backfill ① รูปที่มีจุดตรวจอ้างอยู่ = แผนกของจุดตรวจนั้น (วัด 26/11: ไม่มีรูปไหนถูกอ้างจาก 2 แผนก)
update public.jig_images i set department = r.department
from (
  select k.image_id, min(c.department) as department
  from public.jig_checkpoints k join public.checklists c on c.id = k.checklist_id
  where k.image_id is not null
  group by k.image_id having count(distinct c.department) = 1
) r
where i.id = r.image_id and i.department is null;

-- backfill ② รูปที่ไม่มีจุดอ้าง บนเครื่องที่มีใบตรวจแผนกเดียว = แผนกนั้น
update public.jig_images i set department = d.department
from (
  select equipment_id, min(department) as department
  from public.checklists group by equipment_id having count(distinct department) = 1
) d
where i.jig_id = d.equipment_id and i.department is null;

-- ที่เหลือ (ถ้ามี) คง null = เห็นทุกแผนก · ลบไม่ได้จากจอ (fail-safe)
