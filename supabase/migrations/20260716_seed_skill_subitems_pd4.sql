-- ══════════════════════════════════════════════════════════════════════════
-- Seed หัวข้อการพิจารณา (skill_sub_items) จากฟอร์มจริง F-PRS-P1-119 (Main) · 2026-07-16
--
-- map กลุ่มทักษะในฟอร์มกระดาษ → สกิลจริงในระบบที่ตรงความหมายที่สุด (เน้น PD4 + สกิลกลาง)
-- ข้อความหัวข้อ = ตามฟอร์มกระดาษเป๊ะ · ปรับ/เพิ่ม/ลบได้จาก /operator ⚙️ ปุ่ม 📝
--
--   ควบคุมการผลิต (Production Control)  → skill_management   (งานบริหาร)
--   ควบคุมหุ่นยนต์ (Teching Robot)      → skill_c7ead7ec39   (Control RB/MC)
--   ทักษะงานเชื่อมประกอบ (Welding)      → skill_414d445938   (งานเชื่อมบูท)
--   ควบคุมเลเซอร์และเบนดิ่ง (Laser&Bend)→ skill_3782b73e46   (Ben/Laser297/306)
--   ตรวจสอบคุณภาพ (Quality Check)       → skill_quality_check(งาน QC)
--   ความปลอดภัย (Safety)                → skill_safety       (Safety)
--
-- idempotent: ล้างหัวข้อเดิมของ 6 สกิลนี้ก่อน แล้ว insert ใหม่ (รันซ้ำได้)
-- Rollback: delete from skill_sub_items where skill_name in (...6 ชื่อ...);
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_data jsonb := jsonb_build_object(
    'skill_management', jsonb_build_array(
      jsonb_build_object('label','วางแผนการผลิต (plan production)'),
      jsonb_build_object('label','บันทึกผลการผลิต (record daily report)'),
      jsonb_build_object('label','สามารถทำงานตามเอกสารมาตรฐานการปฏิบัติงานได้ (SOP)'),
      jsonb_build_object('label','ติดต่อประสานงานหน่วยงานอื่นๆ (external contact)'),
      jsonb_build_object('label','ควบคุมการเปลี่ยนแปลงการผลิต (4M change)')
    ),
    'skill_c7ead7ec39', jsonb_build_array(
      jsonb_build_object('label','การปฏิบัติงานร่วมกับโรบอท'),
      jsonb_build_object('label','ควบคุมการผลิตงานระหว่างเริ่มงานและหยุดงาน (operate line start-stop)'),
      jsonb_build_object('label','สามารถเติมวัตถุดิบเข้าสู่กระบวนการประกอบได้ถูกต้อง'),
      jsonb_build_object('label','เข้าใจการบำรุงรักษาหุ่นยนต์เบื้องต้น (understand PPM robot machine)'),
      jsonb_build_object('label','เมื่อเจอปัญหาสามารถรายงานปัญหาตามขั้นตอนได้ (หยุด-เรียก-รอ)','wi','WI-PD4-001')
    ),
    'skill_414d445938', jsonb_build_array(
      jsonb_build_object('label','ทักษะการเชื่อมแบบอาร์ค (Arc Welding)'),
      jsonb_build_object('label','ทักษะการเชื่อมแบบความต้าน (Resistance Welding)')
    ),
    'skill_3782b73e46', jsonb_build_array(
      jsonb_build_object('label','สามารถใช้เครื่องเลเซอร์, Bending ตาม SOP ได้อย่างถูกต้อง (can use machine)'),
      jsonb_build_object('label','สามารถใช้เครื่อง Stationary ตาม SOP ได้อย่างถูกต้อง (can use machine)'),
      jsonb_build_object('label','รู้และเข้าใจการบำรุงรักษาเครื่องเลเซอร์, Ben, Station เบื้องต้น'),
      jsonb_build_object('label','บันทึกการเบิกจ่ายวัตถุดิบได้อย่างถูกต้อง'),
      jsonb_build_object('label','สามารถขับโฟล์คลิฟท์ยืนเพื่อเตรียมวัตถุดิบมาผลิตได้')
    ),
    'skill_quality_check', jsonb_build_array(
      jsonb_build_object('label','เข้าใจการตรวจสอบคุณภาพชิ้นงาน (understand part quality check)'),
      jsonb_build_object('label','สามารถทำงานตามเอกสาร Q-Point ได้'),
      jsonb_build_object('label','เข้าใจรายละเอียดงานเสียของไลน์ผลิต (understand parts NG)'),
      jsonb_build_object('label','สามารถนำชิ้นงานเข้าตรวจสอบบนจิ๊กได้ (can quality check on inspection jig)')
    ),
    'skill_safety', jsonb_build_array(
      jsonb_build_object('label','ขั้นตอนการปฏิบัติงานอย่างปลอดภัย, อุปกรณ์ป้องกันอันตรายติดเครื่องจักร'),
      jsonb_build_object('label','ความรู้ความเข้าใจเกี่ยวกับความปลอดภัยในการทำงาน (มาตรฐานหยุด-เรียก-รอ)'),
      jsonb_build_object('label','แผนฉุกเฉินในสายการผลิต'),
      jsonb_build_object('label','การค้นหาอันตรายในการทำงานและการป้องกันอันตราย (CCCF)')
    )
  );
  v_skill text;
  v_items jsonb;
  v_item  jsonb;
  v_seq   integer;
begin
  for v_skill, v_items in select * from jsonb_each(v_data) loop
    -- ข้ามถ้าไม่มีสกิลนี้ในระบบ (กันพังในสภาพแวดล้อมอื่น)
    if not exists (select 1 from skill_definitions where name = v_skill) then
      continue;
    end if;
    delete from skill_sub_items where skill_name = v_skill;
    v_seq := 0;
    for v_item in select * from jsonb_array_elements(v_items) loop
      v_seq := v_seq + 1;
      insert into skill_sub_items (skill_name, seq, label, wi_ref)
      values (v_skill, v_seq, v_item->>'label', v_item->>'wi');
    end loop;
  end loop;
end $$;
