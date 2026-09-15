-- ═══ 🧪 NPI DEMO SEED — ข้อมูลตัวอย่างให้เห็นภาพ /npi ครบทุกแท็บ · Main project (ewhdfqwfwofivojtsizn) ═══
-- 2026-09-15 · คำขอ user: "seed ค่าที่ต้องกรอกทั้งหมดให้เห็นภาพตัวอย่างของโปรแกรมเมื่อมีข้อมูล — ลูกพี่จะขอดู"
--
-- ⚠️ เป็นข้อมูล DEMO ไม่ใช่ข้อมูลจริง — โปรเจคติดป้าย 🧪 DEMO ทั้งชื่อและรหัส (NPI-DEMO-001 / NPI-DEMO-002)
--    วันที่ทั้งหมดอิง "วันที่รัน" (current_date) เพื่อให้เห็นครบทั้ง 🟢 ตามแผน · 🟡 ใกล้กำหนด · 🔴 เลยกำหนด
--    ผูกกับพาร์ทต้นแบบจริง (golden thread): pe_doc_sets ของ MB3B-16E060-CH / 061 / 8C306 ถ้ามี (ไม่มี = null ไม่พัง)
--
-- idempotent: ถ้ามี NPI-DEMO-001 อยู่แล้วจะไม่ทำอะไร (รันซ้ำไม่ซ้อน) — อยาก reset ให้รัน Rollback ก่อน
--
-- Rollback (ลบทั้งก้อน — FK cascade ล้าง พาร์ท/เฟส/เอกสาร/แบบ/ECI/tooling/งาน ให้หมด):
--   delete from public.npi_projects where project_code in ('NPI-DEMO-001','NPI-DEMO-002');

do $$
declare
  today      date := current_date;   -- seed อ่านครั้งเดียวตอนรัน — ไม่ใช่ work_date ของงานผลิต จึงไม่ต้องตัด 08:00
  tpl_apqp   uuid;
  tpl_sptt   uuid;
  prj        uuid;
  prj2       uuid;
  p060       uuid;  p061 uuid;  p306 uuid;  ptoy uuid;
  set060     uuid;  set061 uuid; set306 uuid;
  dwg060b    uuid;  dwg061b uuid;
  tool060_10 uuid;  tool060_20 uuid; tool061_cf uuid; tool061_10 uuid; tool306 uuid;
  r          record;
  n          int;
begin
  if exists (select 1 from public.npi_projects where project_code = 'NPI-DEMO-001') then
    raise notice 'NPI-DEMO-001 มีอยู่แล้ว — ข้าม (รัน rollback ก่อนถ้าต้องการ reset)';
    return;
  end if;

  select id into tpl_apqp from public.npi_templates where code = 'apqp_aiag';
  select id into tpl_sptt from public.npi_templates where code = 'toyota_sptt';
  if tpl_apqp is null then
    raise exception 'ไม่พบแม่แบบ apqp_aiag — ต้อง apply 20260907_npi_apqp_main.sql ก่อน';
  end if;

  select id into set060 from public.pe_doc_sets where part_no = 'MB3B-16E060-CH' limit 1;
  select id into set061 from public.pe_doc_sets where part_no = 'MB3B-16E061-CH' limit 1;
  select id into set306 from public.pe_doc_sets where part_no = 'MB3B-8C306-BE'  limit 1;

  -- ───────────────────────────── โปรเจค 1: P703 MCA (APQP) ─────────────────────────────
  insert into public.npi_projects (project_code, name, customer, model, template_id, kickoff_date, sop_date, status, leader_name, description, created_by_name)
  values ('NPI-DEMO-001', '🧪 DEMO · P703 MCA 2027 — Fender Inner / Rad Support', 'FORD', 'P703', tpl_apqp,
          today - 120, today + 75, 'active', 'PE · สมศักดิ์ วิศวกร',
          'ข้อมูลตัวอย่างเพื่อสาธิตโมดูล NPI — ไม่ใช่โปรเจคจริง ลบได้ด้วย delete npi_projects where project_code like ''NPI-DEMO-%''',
          'ระบบ (demo seed)')
  returning id into prj;

  insert into public.npi_parts (project_id, part_no, part_name, mat_no, line_name, pe_set_id, ppap_level, ppap_status, psw_no, psw_submitted_at, psw_approved_at, status, owner_name, remark) values
    (prj, 'MB3B-16E060-CH', 'REINF ASY FRT FNDR INR BDY RH', '10100060', 'Line 60', set060, 3, 'in_progress', null, null, null, 'active', 'PE · สมศักดิ์', 'พาร์ทต้นแบบ RH — กำลังทำ P3 (tooling + CP pre-launch)'),
    (prj, 'MB3B-16E061-CH', 'REINF ASY FRT FNDR INR BDY LH', '10100061', 'Line 61', set061, 3, 'submitted', 'PSW-P703-061-01', today - 3, null, 'active', 'PE · สมศักดิ์', 'ส่ง PPAP แล้ว รอลูกค้าอนุมัติ — P4 เลยแผนบางรายการ'),
    (prj, 'MB3B-8C306-BE',  'REINF ASY RAD SUPT LWR',       '10100306', 'LINE APRON ASSY / HYDROFORM', set306, 3, 'approved', 'PSW-P703-306-02', today - 40, today - 20, 'active', 'QA · วราภรณ์', 'PPAP ผ่านแล้ว อยู่ช่วง launch review 30/60/90 วัน');
  select id into p060 from public.npi_parts where project_id = prj and part_no = 'MB3B-16E060-CH';
  select id into p061 from public.npi_parts where project_id = prj and part_no = 'MB3B-16E061-CH';
  select id into p306 from public.npi_parts where project_id = prj and part_no = 'MB3B-8C306-BE';

  -- เฟสรายพาร์ท (snapshot label จากแม่แบบ) — วันแผนตั้งให้เห็นสถานะต่างกัน 3 พาร์ท
  --   060: P1-P2 เสร็จ · P3 กำลังทำ (เหลือ 10 วัน = 🟡) · P4-P5 ยังไม่เริ่ม
  --   061: P1-P3 เสร็จ · P4 กำลังทำแต่เลยแผน 5 วัน (= 🔴) · P5 ยังไม่เริ่ม
  --   306: P1-P4 เสร็จ · P5 กำลังทำ
  insert into public.npi_part_phases (part_id, phase_code, label, seq, plan_start, plan_end, actual_start, actual_end, status, owner_name)
  select p.part_id, ph.code, ph.label, ph.seq, v.ps, v.pe, v.as_, v.ae, v.st, v.own
  from (values
    -- part, phase, plan_start, plan_end, actual_start, actual_end, status, owner
    ('060','p1', today-120, today-95,  today-120, today-97,  'completed',   'PE · สมศักดิ์'),
    ('060','p2', today-95,  today-60,  today-96,  today-58,  'completed',   'PE · สมศักดิ์'),
    ('060','p3', today-60,  today+10,  today-57,  null,      'in_progress', 'PE · สมศักดิ์'),
    ('060','p4', today+10,  today+50,  null,      null,      'not_started', 'QA · วราภรณ์'),
    ('060','p5', today+50,  today+75,  null,      null,      'not_started', 'ผลิต · ประยุทธ'),
    ('061','p1', today-120, today-95,  today-120, today-96,  'completed',   'PE · สมศักดิ์'),
    ('061','p2', today-95,  today-60,  today-95,  today-61,  'completed',   'PE · สมศักดิ์'),
    ('061','p3', today-60,  today-20,  today-60,  today-18,  'completed',   'PE · สมศักดิ์'),
    ('061','p4', today-20,  today-5,   today-18,  null,      'in_progress', 'QA · วราภรณ์'),
    ('061','p5', today-5,   today+75,  null,      null,      'not_started', 'ผลิต · ประยุทธ'),
    ('306','p1', today-120, today-100, today-120, today-101, 'completed',   'PE · อนุชา'),
    ('306','p2', today-100, today-80,  today-100, today-80,  'completed',   'PE · อนุชา'),
    ('306','p3', today-80,  today-50,  today-80,  today-48,  'completed',   'PE · อนุชา'),
    ('306','p4', today-50,  today-20,  today-48,  today-20,  'completed',   'QA · วราภรณ์'),
    ('306','p5', today-20,  today+75,  today-20,  null,      'in_progress', 'ผลิต · ประยุทธ')
  ) as v(pk, ph, ps, pe, as_, ae, st, own)
  join (values ('060', p060), ('061', p061), ('306', p306)) as p(pk, part_id) on p.pk = v.pk
  join public.npi_template_phases ph on ph.template_id = tpl_apqp and ph.code = v.ph;

  -- เอกสารส่งมอบ: instantiate จากแม่แบบ (36 รายการ/พาร์ท) · due = plan_end ของเฟส
  insert into public.npi_deliverables (part_id, template_deliverable_id, phase_code, seq, code, label, doc_kind, required, ppap_element, status, due_date, owner_role)
  select pp.part_id, td.id, td.phase_code, td.seq, td.code, td.label, td.doc_kind, td.required, td.ppap_element,
         case when td.required then 'not_started' else 'not_required' end, pp.plan_end, td.owner_role
  from public.npi_template_deliverables td
  join public.npi_part_phases pp on pp.phase_code = td.phase_code and pp.part_id in (p060, p061, p306)
  where td.template_id = tpl_apqp and td.is_active;

  -- เฟสที่ปิดแล้ว → อนุมัติหมด (มีชื่อผู้อนุมัติ + วันที่)
  update public.npi_deliverables d
     set status = 'approved', approved_by = 'PE Manager · ธนพล', approved_at = (pp.actual_end::timestamp + interval '10 hours'), done_at = pp.actual_end - 2,
         owner_name = case d.owner_role when 'qa' then 'QA · วราภรณ์' when 'production' then 'ผลิต · ประยุทธ' when 'planning' then 'แพลนนิ่ง · นภา' when 'sales' then 'ขาย · กิตติ' else 'PE · สมศักดิ์' end
    from public.npi_part_phases pp
   where pp.part_id = d.part_id and pp.phase_code = d.phase_code and pp.status = 'completed' and d.status <> 'not_required';

  -- 060 P3 (กำลังทำ): ผสมสถานะ — อนุมัติ 4 · ส่งแล้ว 1 · กำลังทำ 2 · เลยกำหนด 1 (🔴) · ที่เหลือยังไม่เริ่ม (due อีก 10 วัน = 🟡)
  n := 0;
  for r in select id from public.npi_deliverables where part_id = p060 and phase_code = 'p3' and status = 'not_started' order by seq loop
    n := n + 1;
    if n <= 4 then
      update public.npi_deliverables set status = 'approved', approved_by = 'PE Manager · ธนพล', approved_at = now() - interval '6 days', done_at = today - 8, owner_name = 'PE · สมศักดิ์',
             ref_kind = case n when 1 then 'pe_set' when 2 then 'pe_set' when 3 then 'pe_set' else null end, ref_id = case when n <= 3 and set060 is not null then set060::text else null end
       where id = r.id;
    elsif n = 5 then
      update public.npi_deliverables set status = 'submitted', done_at = today - 1, owner_name = 'PE · สมศักดิ์', note = 'ส่งให้ PE Manager ตรวจแล้ว รออนุมัติ' where id = r.id;
    elsif n in (6, 7) then
      update public.npi_deliverables set status = 'in_progress', owner_name = 'QA · วราภรณ์' where id = r.id;
    elsif n = 8 then
      update public.npi_deliverables set status = 'in_progress', due_date = today - 4, owner_name = 'แพลนนิ่ง · นภา', note = 'รอสเปคกล่องจากลูกค้า — เลยกำหนดแล้ว' where id = r.id;
    end if;
  end loop;

  -- 061 P4 (เลยแผน): อนุมัติ 8 · ส่งแล้ว 2 · ตีกลับ 1 (🔴) · เลยกำหนด 2 (🔴) · ที่เหลือกำลังทำ
  n := 0;
  for r in select id from public.npi_deliverables where part_id = p061 and phase_code = 'p4' and status = 'not_started' order by seq loop
    n := n + 1;
    if n <= 8 then
      update public.npi_deliverables set status = 'approved', approved_by = 'QA Manager · ศิริพร', approved_at = now() - interval '9 days', done_at = today - 10, owner_name = 'QA · วราภรณ์' where id = r.id;
    elsif n in (9, 10) then
      update public.npi_deliverables set status = 'submitted', done_at = today - 3, owner_name = 'QA · วราภรณ์', note = 'ส่งลูกค้าพร้อม PSW' where id = r.id;
    elsif n = 11 then
      update public.npi_deliverables set status = 'rejected', owner_name = 'QA · วราภรณ์', note = 'ลูกค้าตีกลับ: Cpk จุด #7 ต่ำกว่า 1.33 — ต้องวัดซ้ำหลังปรับแม่พิมพ์' where id = r.id;
    elsif n in (12, 13) then
      update public.npi_deliverables set status = 'in_progress', due_date = today - 5, owner_name = 'ผลิต · ประยุทธ', note = 'รอผล trial run รอบ 2' where id = r.id;
    else
      update public.npi_deliverables set status = 'in_progress', due_date = today + 6, owner_name = 'QA · วราภรณ์' where id = r.id;
    end if;
  end loop;

  -- 306 P5 (launch): อนุมัติ 1 · กำลังทำ 1 · ยังไม่เริ่ม 1 (due วัน SOP)
  n := 0;
  for r in select id from public.npi_deliverables where part_id = p306 and phase_code = 'p5' and status = 'not_started' order by seq loop
    n := n + 1;
    if n = 1 then update public.npi_deliverables set status = 'approved', approved_by = 'PE Manager · ธนพล', approved_at = now() - interval '2 days', done_at = today - 3, owner_name = 'PE · อนุชา' where id = r.id;
    elsif n = 2 then update public.npi_deliverables set status = 'in_progress', owner_name = 'PE · อนุชา', note = 'รวบรวม lesson learned จากเคลม 2 เรื่อง' where id = r.id;
    end if;
  end loop;

  -- ───────────────────────────── แบบ (drawing revisions) ─────────────────────────────
  insert into public.npi_drawing_revisions (part_id, kind, rev, rev_date, eci_no, description, external_url, status, is_current, released_by, released_at, created_by_name) values
    (p060, '2d', 'A', today - 110, null,           'แบบชุดแรกจากลูกค้า (RFQ)', 'https://plm.example.com/p703/16E060/revA', 'obsolete', false, 'PE · สมศักดิ์', today - 108, 'ระบบ (demo seed)'),
    (p060, '3d', 'A', today - 110, null,           'CAD 3D ชุดแรก (STEP)',    'https://plm.example.com/p703/16E060/3d/revA', 'obsolete', false, 'PE · สมศักดิ์', today - 108, 'ระบบ (demo seed)'),
    (p061, '2d', 'A', today - 110, null,           'แบบชุดแรกจากลูกค้า (RFQ)', 'https://plm.example.com/p703/16E061/revA', 'released', true,  'PE · สมศักดิ์', today - 108, 'ระบบ (demo seed)'),
    (p306, '2d', 'C', today - 90,  'ECI-P703-009', 'เพิ่มรูเจาะ 2 จุดตาม ECI ลูกค้า', 'https://plm.example.com/p703/8C306/revC', 'released', true, 'PE · อนุชา', today - 88, 'ระบบ (demo seed)');
  insert into public.npi_drawing_revisions (part_id, kind, rev, rev_date, eci_no, description, external_url, status, is_current, released_by, released_at, created_by_name)
  values (p060, '2d', 'B', today - 35, 'ECI-P703-014', 'ย้ายตำแหน่ง nut M6 2 ตัว + เพิ่ม gusset ตาม ECI-P703-014', 'https://plm.example.com/p703/16E060/revB', 'released', true, 'PE · สมศักดิ์', today - 30, 'ระบบ (demo seed)')
  returning id into dwg060b;
  insert into public.npi_drawing_revisions (part_id, kind, rev, rev_date, eci_no, description, external_url, status, is_current, released_by, released_at, created_by_name)
  values (p060, '3d', 'B', today - 35, 'ECI-P703-014', 'CAD 3D ตาม Rev B', 'https://plm.example.com/p703/16E060/3d/revB', 'released', true, 'PE · สมศักดิ์', today - 30, 'ระบบ (demo seed)');
  insert into public.npi_drawing_revisions (part_id, kind, rev, rev_date, eci_no, description, status, is_current, created_by_name)
  values (p061, '2d', 'B', today - 2, 'ECI-P703-021', 'ร่างตาม ECI-P703-021 (รอลูกค้ายืนยันขนาด flange)', 'draft', false, 'PE · สมศักดิ์')
  returning id into dwg061b;

  -- ───────────────────────────── Tooling plans + ขั้นงาน ─────────────────────────────
  insert into public.npi_tooling_plans (part_id, tool_name, tool_kind, maker_name, maker_kind, po_no, plan_start, plan_end, actual_start, actual_end, status, owner_name, note)
  values (p060, 'OP10 DRAW DIE RH', 'die', 'Thai Summit Die Shop', 'internal', null, today - 100, today - 10, today - 98, null, 'tryout', 'DIE · วิชัย', 'T1 พบ wrinkle มุม flange — แก้ radius แล้วรอ tryout ซ้ำ')
  returning id into tool060_10;
  insert into public.npi_tooling_plans (part_id, tool_name, tool_kind, maker_name, maker_kind, po_no, plan_start, plan_end, actual_start, actual_end, status, owner_name, note)
  values (p060, 'OP20 TRIM & PIERCE DIE RH', 'die', 'S.K. Precision Tooling Co., Ltd.', 'external', 'PO-2026-0412', today - 90, today + 20, today - 88, null, 'in_progress', 'PE · สมศักดิ์', 'แก้ตำแหน่ง pierce ตาม ECI-P703-014 แล้ว')
  returning id into tool060_20;
  insert into public.npi_tooling_plans (part_id, tool_name, tool_kind, maker_name, maker_kind, po_no, plan_start, plan_end, actual_start, actual_end, status, owner_name, note)
  values (p061, 'CHECKING FIXTURE LH', 'checking_fixture', 'CF Tech Engineering', 'external', 'PO-2026-0377', today - 80, today - 15, today - 80, today - 17, 'completed', 'QA · วราภรณ์', 'CMM certify ผ่าน · รับเข้าแล้ว')
  returning id into tool061_cf;
  insert into public.npi_tooling_plans (part_id, tool_name, tool_kind, maker_name, maker_kind, po_no, plan_start, plan_end, actual_start, actual_end, status, owner_name, note)
  values (p061, 'OP10 DRAW DIE LH', 'die', 'Thai Summit Die Shop', 'internal', null, today + 5, null, null, null, 'planned', 'DIE · วิชัย', 'รอผล tryout ฝั่ง RH ก่อนเริ่ม')
  returning id into tool061_10;
  insert into public.npi_tooling_plans (part_id, tool_name, tool_kind, maker_name, maker_kind, po_no, plan_start, plan_end, actual_start, actual_end, status, owner_name, note)
  values (p306, 'PROGRESSIVE DIE SET OP10-40', 'die', 'Thai Summit Die Shop', 'internal', null, today - 115, today - 55, today - 115, today - 52, 'completed', 'DIE · วิชัย', 'transfer เข้าโรงงานแล้ว — ผูก die_sets ที่ /die-registry')
  returning id into tool306;

  -- ขั้นงานจากแม่แบบ die (11 ขั้น) / CF (5 ขั้น) แล้วตั้งความคืบหน้าให้เห็นภาพ
  -- 060 OP10: 1-8 เสร็จ · 9 (T1) 60% เลยแผน 🔴 · 10-11 ยังไม่เริ่ม
  insert into public.npi_tooling_steps (tooling_id, seq, name, plan_start, plan_end, actual_start, actual_end, progress_pct, responsible_name, status)
  select tool060_10, t.seq, t.name,
         (today - 100) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int,
         (today - 100) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int,
         case when t.seq <= 90 then (today - 100) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int end,
         case when t.seq <= 80 then (today - 100) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int end,
         case when t.seq <= 80 then 100 when t.seq = 90 then 60 else 0 end,
         case when t.seq <= 30 then 'PE · สมศักดิ์' else 'DIE · วิชัย' end,
         case when t.seq <= 80 then 'completed' when t.seq = 90 then 'in_progress' else 'not_started' end
  from public.npi_tooling_step_templates t where t.tool_kind = 'die' and t.is_active;
  -- 060 OP20 (ผู้ทำภายนอก): 1-6 เสร็จ · 7 กำลังทำ 40% · ที่เหลือยังไม่เริ่ม
  insert into public.npi_tooling_steps (tooling_id, seq, name, plan_start, plan_end, actual_start, actual_end, progress_pct, responsible_name, status)
  select tool060_20, t.seq, t.name,
         (today - 90) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int,
         (today - 90) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int,
         case when t.seq <= 70 then (today - 90) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int end,
         case when t.seq <= 60 then (today - 90) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int end,
         case when t.seq <= 60 then 100 when t.seq = 70 then 40 else 0 end,
         'S.K. Precision (คุณสมบัติ)',
         case when t.seq <= 60 then 'completed' when t.seq = 70 then 'in_progress' else 'not_started' end
  from public.npi_tooling_step_templates t where t.tool_kind = 'die' and t.is_active;
  -- 061 CF: เสร็จหมด
  insert into public.npi_tooling_steps (tooling_id, seq, name, plan_start, plan_end, actual_start, actual_end, progress_pct, responsible_name, status)
  select tool061_cf, t.seq, t.name,
         (today - 80) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int,
         (today - 80) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int,
         (today - 80) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int,
         (today - 80) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int,
         100, 'CF Tech (คุณอรรถพล)', 'completed'
  from public.npi_tooling_step_templates t where t.tool_kind = 'checking_fixture' and t.is_active;
  -- 061 OP10 LH: แผนล่วงหน้า ยังไม่เริ่ม
  insert into public.npi_tooling_steps (tooling_id, seq, name, plan_start, plan_end, progress_pct, responsible_name, status)
  select tool061_10, t.seq, t.name,
         (today + 5) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int,
         (today + 5) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int,
         0, 'DIE · วิชัย', 'not_started'
  from public.npi_tooling_step_templates t where t.tool_kind = 'die' and t.is_active;
  update public.npi_tooling_plans set plan_end = (select max(plan_end) from public.npi_tooling_steps where tooling_id = tool061_10) where id = tool061_10;
  -- 306: เสร็จหมด
  insert into public.npi_tooling_steps (tooling_id, seq, name, plan_start, plan_end, actual_start, actual_end, progress_pct, responsible_name, status)
  select tool306, t.seq, t.name,
         (today - 115) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int,
         (today - 115) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int,
         (today - 115) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - coalesce(t.default_days, 1))::int,
         (today - 115) + (sum(coalesce(t.default_days, 1)) over (order by t.seq) - 1)::int,
         100, 'DIE · วิชัย', 'completed'
  from public.npi_tooling_step_templates t where t.tool_kind = 'die' and t.is_active;

  -- ───────────────────────────── ECI ─────────────────────────────
  -- 1) ปิดงานแล้ว: ทุกขาที่ติ๊กผูกของจริงครบ (แบบ Rev B + แผน OP20)
  insert into public.npi_change_requests (eci_no, project_id, part_id, source, title, description, requested_by, requested_date, target_date, effective_date, status,
      affects_drawing, affects_pe, affects_process, affects_tooling, impact_note, drawing_revision_id, tooling_plan_id, decided_by, decided_at, implemented_at, created_by_name)
  values ('ECI-P703-014', prj, p060, 'customer', 'ย้ายตำแหน่ง weld nut M6 ×2 + เพิ่ม gusset มุม flange',
          'ลูกค้าแจ้งเปลี่ยนตำแหน่ง nut เพื่อหลบ harness clip ใหม่ และเพิ่ม gusset กันบิด', 'Ford PD (K. Somchai)', today - 40, today - 25, today - 25, 'implemented',
          true, false, false, true, 'กระทบแบบ 2D/3D → Rev B · แก้ตำแหน่ง pierce ที่ OP20 · ไม่กระทบ PFMEA/CP (nut เดิม เปลี่ยนแค่ตำแหน่ง)',
          dwg060b, tool060_20, 'PE Manager · ธนพล', now() - interval '32 days', today - 28, 'ระบบ (demo seed)');
  -- 2) กำลังประเมิน: ติ๊ก 3 ขา ยังไม่ผูกอะไร (บอร์ดจะโชว์ ○ 0/3) · เหลือ 7 วัน
  insert into public.npi_change_requests (eci_no, project_id, part_id, source, title, description, requested_by, requested_date, target_date, status,
      affects_drawing, affects_pe, affects_process, affects_tooling, impact_note, created_by_name)
  values ('ECI-P703-021', prj, p061, 'customer', 'เพิ่มความกว้าง flange ด้าน LH +3 มม.',
          'ลูกค้าพบ gap กับ panel ข้างเคียงตอน trial assembly', 'Ford PD (K. Somchai)', today - 6, today + 7, 'evaluating',
          true, true, true, false, 'ต้องออกแบบ Rev B · แก้ OP20 trim line ใน PFC/CP · แจ้ง 4M Method หน้างานตอนเปลี่ยน · ประเมิน tooling อยู่', 'ระบบ (demo seed)');
  -- 3) ภายใน อนุมัติแล้ว รอทำ: ผูกแผน CF แล้ว (1/1) แต่ยังไม่ปิด
  insert into public.npi_change_requests (eci_no, project_id, part_id, source, title, description, requested_by, requested_date, target_date, status,
      affects_drawing, affects_pe, affects_process, affects_tooling, impact_note, tooling_plan_id, decided_by, decided_at, created_by_name)
  values ('ECI-' || to_char(today, 'YYYYMM') || '-001', prj, p061, 'internal', 'เพิ่ม datum pin ที่ checking fixture LH เพื่อลด GR&R',
          'MSA รอบแรก GR&R 18% เกินเกณฑ์ 10% — เสนอเพิ่ม pin กันชิ้นงานขยับ', 'QA · วราภรณ์', today - 10, today + 14, 'approved',
          false, false, false, true, 'แก้ CF อย่างเดียว ไม่กระทบแบบ/PE', tool061_cf, 'PE Manager · ธนพล', now() - interval '5 days', 'ระบบ (demo seed)');

  -- ───────────────────────────── งานมอบหมาย ─────────────────────────────
  insert into public.npi_tasks (project_id, part_id, phase_code, title, detail, assignee_name, due_date, status, done_at, created_by_name) values
    (prj, p060, 'p3', 'ส่ง Packaging spec ให้ลูกค้า approve', 'รอสเปคกล่องจาก Ford — ตามกับ K. Somchai', 'แพลนนิ่ง · นภา', today - 4, 'doing', null, 'PE · สมศักดิ์'),
    (prj, p060, 'p3', 'Tryout T1 ซ้ำหลังแก้ radius OP10', 'นัด press line 60 กะเช้า', 'DIE · วิชัย', today + 3, 'open', null, 'PE · สมศักดิ์'),
    (prj, p061, 'p4', 'วัด Cpk จุด #7 ซ้ำ 50 ชิ้น (ลูกค้าตีกลับ)', 'หลังปรับ shim CF แล้ว', 'QA · วราภรณ์', today + 2, 'doing', null, 'QA Manager · ศิริพร'),
    (prj, p061, 'p4', 'ตอบ ECI-P703-021 ผลกระทบ + ราคา tooling', 'ต้องได้ quote จาก S.K. ก่อน', 'PE · สมศักดิ์', today + 5, 'open', null, 'PE Manager · ธนพล'),
    (prj, p306, 'p5', 'Launch review 30 วัน', 'สรุปของเสีย/OEE 30 วันแรก', 'ผลิต · ประยุทธ', today - 12, 'done', now() - interval '11 days', 'PE · อนุชา'),
    (prj, null, null, 'อัพเดท timing chart ส่งลูกค้า (weekly)', null, 'PE · สมศักดิ์', today + 1, 'open', null, 'PE Manager · ธนพล');

  -- ───────────────────────────── โปรเจค 2: Toyota (SPTT) — วางแผน ─────────────────────────────
  if tpl_sptt is not null then
    insert into public.npi_projects (project_code, name, customer, model, template_id, kickoff_date, sop_date, status, leader_name, description, created_by_name)
    values ('NPI-DEMO-002', '🧪 DEMO · IMV-0 MC — Bracket RR Bumper', 'TOYOTA', 'IMV', tpl_sptt, today + 10, today + 200, 'planning', 'PE · อนุชา',
            'ตัวอย่างโปรเจคที่ใช้แม่แบบ Toyota SPTT0-4 — ยังไม่เริ่ม', 'ระบบ (demo seed)')
    returning id into prj2;
    insert into public.npi_parts (project_id, part_no, part_name, mat_no, line_name, ppap_level, ppap_status, status, owner_name)
    values (prj2, '52611-0K900', 'BRACKET RR BUMPER SIDE RH', null, null, 3, 'not_started', 'active', 'PE · อนุชา')
    returning id into ptoy;
    insert into public.npi_part_phases (part_id, phase_code, label, seq, plan_start, plan_end, status)
    select ptoy, ph.code, ph.label, ph.seq,
           (today + 10) + round(190.0 * (ph.seq - 1) / 6)::int,
           case when ph.seq = 6 then today + 200 else (today + 10) + round(190.0 * ph.seq / 6)::int end,
           'not_started'
    from public.npi_template_phases ph where ph.template_id = tpl_sptt;
    insert into public.npi_deliverables (part_id, template_deliverable_id, phase_code, seq, code, label, doc_kind, required, ppap_element, status, due_date, owner_role)
    select ptoy, td.id, td.phase_code, td.seq, td.code, td.label, td.doc_kind, td.required, td.ppap_element,
           case when td.required then 'not_started' else 'not_required' end, pp.plan_end, td.owner_role
    from public.npi_template_deliverables td
    join public.npi_part_phases pp on pp.part_id = ptoy and pp.phase_code = td.phase_code
    where td.template_id = tpl_sptt and td.is_active;
  end if;

  raise notice 'seed NPI demo เสร็จ: โปรเจค % / %', prj, prj2;
end $$;

-- ตรวจหลังรัน:
-- select project_code, name, status, sop_date from npi_projects where project_code like 'NPI-DEMO-%';        -- 2 แถว
-- select p.part_no, p.ppap_status, count(d.*) filter (where d.status='approved') approved, count(d.*) total
--   from npi_parts p left join npi_deliverables d on d.part_id = p.id
--  where p.project_id in (select id from npi_projects where project_code like 'NPI-DEMO-%') group by 1,2 order by 1;
-- select eci_no, status from npi_change_requests order by eci_no;                                            -- 3 แถว
-- select tool_name, status, (select count(*) from npi_tooling_steps s where s.tooling_id = t.id) steps from npi_tooling_plans t order by tool_name;
