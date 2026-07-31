-- แก้ข้อมูลเครื่อง facility/utility ที่เผลอบันทึกเป็น 'production' (ตอน column ยังไม่ apply → หมวดถูกตัดทิ้งเงียบ) — DR project
-- เคสจริง (user 2026-07-31): Cooling Tower (CT-xx) / Air Compressor (AC-xx) กลุ่มไลน์ "UTLITY STEEL" โผล่ใต้ไลน์ผลิต
-- best-effort cleanup — แตะเฉพาะแถวที่ยังเป็น production เท่านั้น (guard) · review/ปรับได้ · ต้องมีคอลัมน์ equipment_category ก่อน
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='machines' and column_name='equipment_category') then
    -- (1) ตามชื่อกลุ่มไลน์ที่เป็นพื้นที่ facility (utility/utlity — เผื่อพิมพ์ตกตัว)
    update public.machines
       set equipment_category='facility', updated_at=now()
     where coalesce(equipment_category,'production')='production'
       and (line_name ilike '%utility%' or line_name ilike '%utlity%');
    -- (2) ตามชนิดเครื่องที่เป็น facility/utility ชัดเจน (cooling tower / compressor / booster / chiller / pump ส่วนกลาง)
    update public.machines m
       set equipment_category='facility', updated_at=now()
      from public.machine_types mt
     where m.machine_type_id = mt.id
       and coalesce(m.equipment_category,'production')='production'
       and (mt.label ilike '%cooling tower%' or mt.label ilike '%compress%'
            or mt.label ilike '%booster%' or mt.label ilike '%chiller%' or mt.label ilike '%คอมเพรส%');
  end if;
end $$;
