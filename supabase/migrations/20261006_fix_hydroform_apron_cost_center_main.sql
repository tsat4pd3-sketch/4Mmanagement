/* 🏭 MAIN project (ewhdfqwfwofivojtsizn · ชื่อในจอ Supabase = "MAIN")

   แก้รหัส cost center ระดับแผนกของ PD3 ที่สลับกัน — ค้างมาตั้งแต่ 23/09
   (บันทึกไว้เป็นข้อ 2 ในตาราง "ข้อมูลผัง ↔ ทะเบียน cc ไม่ตรงกัน" ของ docs/modules/obeya-kpi-board.md)

   ── ความจริงที่ user เคาะ (06/10) ────────────────────────────────────────────
   "562100 คือระดับแผนก HYDROFORM ที่ประกอบด้วยคอร์สกลุ่ม 66210x
    พนักงานเลยทำบอร์ดเพื่อให้เห็นว่าคอร์สย่อยคืออะไร"
   ⇒ `2140562100` = แผนก HYDROFORM · `2140562200` = แผนก LINE APRON ASSY

   ── ข้อมูลในฐานยืนยันเองด้วย (วัด 06/10) ──────────────────────────────────
   ลูกของ HYDROFORM ถือรหัส 66210x ทั้งชุด : HDF1/LASER-345=…2101 · HDF2/LASER-789=…2102
                                             LASER E50=…2103 · LASER EXPORT=…2104
   ลูกของ LINE APRON ASSY ถือ 66220x       : Line 60/61=…2201 · SUB APRON=…2202
   ⇒ แผนกแม่ของ 66210x ต้องเป็น HYDROFORM = …562100 (ไม่ใช่ APRON)

   ── ใครผิด / ใครถูก ──────────────────────────────────────────────────────
   ✅ `org_nodes`        ถูกอยู่แล้ว (HYDROFORM→…562100 · LINE APRON ASSY→…562200) — ไม่แตะ
   ❌ `cost_centers.name` สลับชื่อกัน
   ❌ `production_lines`  แถว**ไลน์แม่** 2 แถว ผูกรหัสสลับกัน (แถวลูกถูกหมดแล้ว ไม่แตะ)

   ── blast radius (เช็คแล้ว 06/10 = 0 แถวทั้งหมด) ─────────────────────────
   `kpi_definitions.scope_value` · `kpi_month_notes.scope_value` · `kpi_base_inputs.scope_value`
   · `cost_center_rates.cost_center` — ไม่มีใครอ้าง 2 รหัสนี้ ⇒ ไม่มีค่า KPI/เป้า/หมายเหตุใดเปลี่ยนความหมาย
   ผลที่เปลี่ยน: ป้ายในช่อง 💰 ของ <OrgScopePicker> ถูกต้องขึ้น · `ccOf('line_group', …)` ตอบตรงแผนก
   · `ccOwnersOf('2140562100')` เลิกคืน 2 หน่วยพร้อมกัน

   ⚠️ ทะเบียนไลน์ cache ใน localStorage อายุ 4 ชม. (`production_lines:v2`)
      ⇒ จอที่เปิดอยู่จะเห็นค่าใหม่ภายใน 4 ชม. หรือกด Ctrl+Shift+R
      **ไม่ bump คีย์ cache** เพราะนี่คือการแก้ "ค่า" ไม่ใช่เพิ่มคอลัมน์ และการ bump
      = บังคับทุกเครื่องในโรงงานโหลดทะเบียนใหม่หมด ไม่คุ้มกับป้ายรหัส 2 ตัว

   ── rollback ────────────────────────────────────────────────────────────
   update cost_centers set name='LINE APRON ASSY' where code='2140562100';
   update cost_centers set name='HYDROFORM'       where code='2140562200';
   update production_lines set cost_center='2140562100' where name='LINE APRON ASSY' and parent_line_name is null;
   update production_lines set cost_center='2140562200' where name='HYDROFORM'       and parent_line_name is null;

   🔴 idempotent: ทุก statement มี `and <ค่าเดิมที่ผิด>` ใน where ⇒ รันซ้ำไม่ทำอะไร
      และถ้ามีคนแก้มือทีหลังจนค่าไม่ใช่ของผิดเดิม migration นี้จะ **ไม่ทับของเขา** */

begin;

-- 1️⃣ ทะเบียน cost_centers — ชื่อสลับกัน
update public.cost_centers set name = 'HYDROFORM'
 where code = '2140562100' and btrim(name) = 'LINE APRON ASSY';

update public.cost_centers set name = 'LINE APRON ASSY'
 where code = '2140562200' and btrim(name) = 'HYDROFORM';

-- 2️⃣ ทะเบียนไลน์ — แถวไลน์แม่ผูกรหัสสลับกัน (กรองด้วย name ⇒ 2 คำสั่งไม่ชนกันเอง)
update public.production_lines set cost_center = '2140562200'
 where name = 'LINE APRON ASSY' and parent_line_name is null and cost_center = '2140562100';

update public.production_lines set cost_center = '2140562100'
 where name = 'HYDROFORM' and parent_line_name is null and cost_center = '2140562200';

commit;
