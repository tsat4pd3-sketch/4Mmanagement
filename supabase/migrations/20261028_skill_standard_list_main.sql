-- ════════════════════════════════════════════════════════════════════════════
-- Skill Matrix มาตรฐานกลาง (ESM - Skill List.xlsx · 2026-10-28) — Main project
-- ⏳ สถานะ: ยังไม่ apply (รอ user ยืนยัน dry run · 28/10)
--
-- คำตัดสินของ user (28/10):
--   1. Product Skill = Part number (PD2-4) — ย้ายคะแนนสกิลรายไลน์ไปที่ P/N ที่ไลน์นั้นผลิต
--   2. สกิลที่แยกตามไลน์ (Hard/Machine) รวมเป็นตัวเดียว — "ความ unique อยู่ที่ product skill"
--   3. สกิลที่ไม่อยู่ใน Excel เก็บไว้ก่อน
--
-- ตัวที่ยังจับคู่ไม่ได้แน่นอน (Main Line Fender/5049 · Load Part297/306 · Bending222/297-306 ·
-- Die CHANG · งานสปอทนัท · Assembly for Welding/Spot · Assembly Main · Control Stock ·
-- ติดลาเบล E50) = ไม่แตะในไฟล์นี้ รอ user ชี้
--
-- กติกาการรวม (src → dst):
--   employee_skills  : คะแนน = สูงสุดของทุกตัวที่รวม · ห้ามเกิน 100
--   level-up request : ย้ายไป dst ทั้งประวัติ · ใบ pending ที่คะแนนถึงแล้ว/ซ้ำ = rejected + เหตุผล (ห้าม delete)
--   station_requirements : สถานีที่มีทั้ง 2 ตัว → เก็บตัวเดียว min_score สูงสุด
--   skill_sub_items  : ต่อท้ายหัวข้อของ dst
--   employee_skill_evidence : ลบแถว src (fn_skill_exp_rebuild สร้างใหม่ทั้งก้อนทุกคืน)
--
-- สำรองทั้งหมดไว้ที่ schema archive ก่อนแก้ — ย้อนกลับ: ดูท้ายไฟล์
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0) สำรอง ──────────────────────────────────────────────────────────────
create table archive.skill_std_20261028_definitions  as select * from public.skill_definitions;
create table archive.skill_std_20261028_emp_skills   as select * from public.employee_skills;
create table archive.skill_std_20261028_requests     as select * from public.skill_level_up_requests;
create table archive.skill_std_20261028_station_req  as select * from public.station_requirements;
create table archive.skill_std_20261028_sub_items    as select * from public.skill_sub_items;
create table archive.skill_std_20261028_evidence     as select * from public.employee_skill_evidence;

-- ── 1) รวมสกิล ───────────────────────────────────────────────────────────
create temp table _skill_merge (src text primary key, dst text not null) on commit drop;
insert into _skill_merge values
  -- Inspection Skill  ← INSPECTION60 · INSPECTION61 (dst = งาน QC ที่ใช้กว้างสุด)
  ('skill_f330675fea', 'skill_quality_check'),
  ('skill_ed1dc008cc', 'skill_quality_check'),
  -- Laser Machine TRUMPF ← Laser E50 · B222 · C347 (dst = Laser297/306)
  ('skill_74a61e6b4c', 'skill_3782b73e46'),
  ('skill_0d2cfa1ef7', 'skill_3782b73e46'),
  ('skill_e4550521f6', 'skill_3782b73e46'),
  -- Robot ABB ← ABB Handling (dst = ABB Welding)
  ('skill_4a7846ccf2', 'skill_7a2cf2c72e'),
  -- Grinder / Double Sander ← DOUBLE SANDER (dst = AIR GRINDER)
  ('skill_c3ef3c8298', 'skill_cf7aed368c'),
  -- RB3B-16E060-BA ← Load Part line60 (dst = Main Line 60)
  ('skill_refill_part', 'skill_welding'),
  -- RB3B-16E061-BA ← Main Line 61 (dst = Load Part line61)
  ('skill_1c94b93c44', 'skill_machine_control');

do $$
declare r record; v_off int;
begin
  -- กันชื่อผิด: ทุก key ต้องมีจริง
  if exists (select 1 from _skill_merge m
             where not exists (select 1 from skill_definitions d where d.name = m.src)
                or not exists (select 1 from skill_definitions d where d.name = m.dst)) then
    raise exception 'skill merge: key ไม่ครบใน skill_definitions';
  end if;

  -- employee_skills: คะแนนสูงสุด
  insert into employee_skills (employee_id, skill_name, score, pending_level, last_daily_farm_date, updated_at)
  select es.employee_id, m.dst, least(100, max(es.score)), max(es.pending_level), max(es.last_daily_farm_date), now()
    from employee_skills es join _skill_merge m on m.src = es.skill_name
   group by es.employee_id, m.dst
  on conflict (employee_id, skill_name) do update
     set score = greatest(employee_skills.score, excluded.score),
         pending_level = greatest(employee_skills.pending_level, excluded.pending_level),
         last_daily_farm_date = greatest(employee_skills.last_daily_farm_date, excluded.last_daily_farm_date),
         updated_at = now();
  delete from employee_skills es using _skill_merge m where es.skill_name = m.src;

  -- level-up requests: ย้ายประวัติทั้งหมดไป dst
  update skill_level_up_requests q set skill_name = m.dst from _skill_merge m where q.skill_name = m.src;

  -- station_requirements
  update station_requirements d
     set min_score = greatest(d.min_score, s.min_score),
         n_ref = coalesce(d.n_ref, s.n_ref),
         parallel_staff = greatest(d.parallel_staff, s.parallel_staff)
    from station_requirements s join _skill_merge m on m.src = s.skill_name
   where d.station_id = s.station_id and d.skill_name = m.dst;
  delete from station_requirements s using _skill_merge m, station_requirements d
   where s.skill_name = m.src and d.station_id = s.station_id and d.skill_name = m.dst;
  update station_requirements s set skill_name = m.dst from _skill_merge m where s.skill_name = m.src;

  -- skill_sub_items: ต่อท้าย
  for r in select src, dst from _skill_merge order by src loop
    select coalesce(max(seq), 0) into v_off from skill_sub_items where skill_name = r.dst;
    update skill_sub_items set skill_name = r.dst, seq = seq + v_off where skill_name = r.src;
  end loop;

  -- evidence: rebuild คืนนี้สร้างให้ใหม่
  delete from employee_skill_evidence e using _skill_merge m where e.skill_name = m.src;

  delete from skill_definitions d using _skill_merge m where d.name = m.src;
end $$;

-- ใบ pending ของสกิลที่รวม: คะแนนถึงแล้ว หรือซ้ำในคน+สกิลเดียวกัน → rejected (เก็บใบที่ to_level สูงสุดไว้ 1 ใบ)
with dsts as (select distinct dst from _skill_merge),
ranked as (
  select q.id, q.to_level, es.score,
         row_number() over (partition by q.employee_id, q.skill_name order by q.to_level desc, q.requested_at) rn
    from skill_level_up_requests q
    join dsts on dsts.dst = q.skill_name
    left join employee_skills es on es.employee_id = q.employee_id and es.skill_name = q.skill_name
   where q.status = 'pending')
update skill_level_up_requests q
   set status = 'rejected', reviewed_at = now(),
       reject_reason = case when r.to_level <= coalesce(r.score, 0)
                            then 'ระบบ: รวมสกิลตามมาตรฐาน Skill List (28/10) — คะแนนถึงระดับนี้แล้ว'
                            else 'ระบบ: รวมสกิลตามมาตรฐาน Skill List (28/10) — มีคำขอระดับสูงกว่าในสกิลเดียวกันแล้ว' end
  from ranked r
 where q.id = r.id and (r.rn > 1 or r.to_level <= coalesce(r.score, 0));

-- pending_level ของสกิลที่รวม = ใบ pending ที่เหลือ (ไม่มีใบ = ว่าง → farm ต่อได้)
update employee_skills es
   set pending_level = (select max(q.to_level) from skill_level_up_requests q
                         where q.employee_id = es.employee_id and q.skill_name = es.skill_name and q.status = 'pending')
 where es.skill_name in (select distinct dst from _skill_merge);

-- ── 2) เปลี่ยนชื่อ/หมวด/ขอบเขตให้ตรงมาตรฐาน ─────────────────────────────
-- sort_order: Hard 101.. · Machine 201.. · Product 301.. · Soft 401.. ตามลำดับใน Excel
-- ตัวที่ไม่อยู่ใน Excel ต่อท้าย (1000 + ลำดับเดิม)
update skill_definitions set sort_order = 1000 + coalesce(sort_order, 0) where sort_order < 1000;

create temp table _skill_std (
  name text, label text, category text, sort_order int,
  scope_section text, scope_division text, keep_scope boolean
) on commit drop;

insert into _skill_std values
  -- Hard Skill
  ('skill_assembly_for_edp',  'Assembly for EDP Skill',        'hard_skill', 103, null, null, true),
  ('skill_f00b2e0597',        'Rework Grinding Skill',         'hard_skill', 106, null, null, true),
  ('skill_c0101e34f7',        'Manual Press Skill',            'hard_skill', 113, null, null, true),
  ('skill_3eb93c9e21',        'Semi-Auto Press Skill',         'hard_skill', 112, null, null, true),
  ('skill_b03183fe0d',        'Progressive Press Skill',       'hard_skill', 114, null, null, true),
  ('skill_90b3a85ea0',        'Die-Set up Skill',              'hard_skill', 115, null, null, true),
  ('skill_2a74182010',        'Coil-Set up Skill',             'hard_skill', 116, null, null, true),
  ('skill_3ef51f422f',        'Forklift Skill',                'hard_skill', 118, null, null, true),
  ('skill_stracker',          'Stacker Skill',                 'hard_skill', 119, null, null, true),
  ('skill_quality_check',     'Inspection Skill',              'hard_skill', 122, null, 'production', false),
  ('skill_a65700f141',        'Packing Skill',                 'hard_skill', 123, null, 'production', false),
  -- Machine Skill
  ('skill_43cccf1095',        'Stationary',                    'machine_skill', 201, null, null, true),
  ('skill_gun_rivet',         'Rivet Gun',                     'machine_skill', 208, null, null, true),
  ('skill_robot_ctrl',        'Robot Yaskawa',                 'machine_skill', 209, null, null, true),
  ('skill_7a2cf2c72e',        'Robot ABB',                     'machine_skill', 211, null, 'production', false),
  ('skill_3782b73e46',        'Laser Machine TRUMPF',          'machine_skill', 212, null, 'production', false),
  ('skill_2d5725d7df',        'Hydroforming Machine',          'machine_skill', 216, null, null, true),
  ('skill_34d135ef53',        'Dot Mark Machine',              'machine_skill', 217, null, null, true),
  ('skill_456c26b327',        'Press Machine SEYI 300/110T',   'machine_skill', 218, null, null, true),
  ('skill_419bf3104c',        'Press Machine SEYI 250T',       'machine_skill', 219, null, null, true),
  ('skill_12f9bb2aff',        'Press Machine SIMPAC 800/600T', 'machine_skill', 220, null, null, true),
  ('skill_0203c69732',        'Coil Feeder SHUNGDAR',          'machine_skill', 221, null, null, true),
  ('skill_c364fa17b4',        'Press Hydraulic 80T',           'machine_skill', 222, null, null, true),
  ('skill_bcc612b8d1',        'Die Truck',                     'machine_skill', 223, null, null, true),
  ('skill_cf7aed368c',        'Grinder / Double Sander',       'machine_skill', 206, null, null, true),
  ('skill_3dcae1f3a2',        'Crane',                         'machine_skill', 226, null, null, true),
  ('skill_b920b88107',        'Forklift',                      'machine_skill', 227, null, null, true),
  -- Product Skill (P/N ที่ไลน์นั้นผลิต — dr_products)
  ('skill_welding',           'RB3B-16E060-BA',                'product_skill', 311, 'PD3', 'production', false),
  ('skill_machine_control',   'RB3B-16E061-BA',                'product_skill', 312, 'PD3', 'production', false),
  ('skill_4e50015651',        'RB3B-E111E50-AB',               'product_skill', 313, null, null, true),
  ('skill_f35756dd99',        'MB3B-8C347-CA',                 'product_skill', 314, null, null, true),
  -- Soft Skill
  ('skill_management',        'Management Skill',              'soft_skill', 401, null, null, true),
  ('skill_safety',            'Safety Skill',                  'soft_skill', 402, null, null, true),
  ('skill_bdb94b1edb',        'Computer Skill',                'soft_skill', 403, null, null, true),
  ('skill_e0e6689363',        'SAP / Kanban Skill',            'soft_skill', 404, null, null, true),
  ('skill_f6c2dac417',        'Coordinating Skill',            'soft_skill', 405, null, null, true),
  ('skill_634ca5b4eb',        'Document Control Skill',        'soft_skill', 406, null, null, true);

do $$ begin
  if exists (select 1 from _skill_std s where not exists (select 1 from skill_definitions d where d.name = s.name)) then
    raise exception 'skill rename: key ไม่ครบใน skill_definitions';
  end if;
end $$;

update skill_definitions d
   set label = s.label, category = s.category, sort_order = s.sort_order,
       scope_section  = case when s.keep_scope then d.scope_section  else s.scope_section  end,
       scope_division = case when s.keep_scope then d.scope_division else s.scope_division end
  from _skill_std s where d.name = s.name;

-- แก้ชื่อเสีย (อักขระ ฺ หลง · ช่องว่างซ้อน) ของตัวที่ไม่อยู่ใน Excel
update skill_definitions set label = replace(label, U&'\0E3A', '') where label like U&'%\0E3A%';
update skill_definitions set label = regexp_replace(btrim(label), '\s{2,}', ' ', 'g') where label ~ '\s{2,}|^\s|\s$';

-- ── 3) เพิ่มสกิลมาตรฐานที่ยังไม่มี ──────────────────────────────────────
insert into skill_definitions (name, label, category, sort_order, color, scope_section, scope_division)
select 'skill_' || substr(md5('std20261028:' || v.label), 1, 10), v.label, v.category, v.sort_order,
       case v.category when 'hard_skill' then '#ef4444' when 'machine_skill' then '#f97316'
                       when 'product_skill' then '#3b82f6' else '#a855f7' end,
       v.scope_section, 'production'
  from (values
    ('Manual Projection Welding Skill',    'hard_skill', 101, null),
    ('Auto Feed Projection Welding Skill', 'hard_skill', 102, null),
    ('Assembly / Load Part Skill',         'hard_skill', 104, null),
    ('Load Tube Skill',                    'hard_skill', 105, null),
    ('Torque Runner Skill',                'hard_skill', 107, null),
    ('Riveting Skill',                     'hard_skill', 108, null),
    ('Manual Welding (MIG) Skill',         'hard_skill', 109, null),
    ('Manual Welding (TIG) Skill',         'hard_skill', 110, null),
    ('Manual Stud Weld Skill',             'hard_skill', 111, null),
    ('Crane Skill',                        'hard_skill', 117, null),
    ('Control Line Assembly Skill',        'hard_skill', 120, null),
    ('Control Line Press Skill',           'hard_skill', 121, null),
    ('Nut/Bolt Feeder',                    'machine_skill', 202, null),
    ('Assembly Jig',                       'machine_skill', 203, null),
    ('Manual Welding Machine (MIG)',       'machine_skill', 204, null),
    ('Manual Welding Machine (TIG)',       'machine_skill', 205, null),
    ('Torque Runner',                      'machine_skill', 207, null),
    ('Robot Panasonic',                    'machine_skill', 210, null),
    ('Bending Machine BLM',                'machine_skill', 213, null),
    ('Bending Machine COMCO',              'machine_skill', 214, null),
    ('Bending Machine EXCEL',              'machine_skill', 215, null),
    ('Die Auto-Change 800/600T',           'machine_skill', 224, null),
    ('Die Auto-Change 300T',               'machine_skill', 225, null),
    ('Stacker',                            'machine_skill', 228, null),
    ('Auto Load Tube Machine',             'machine_skill', 229, null),
    ('N1WB-E20022-AB',                     'product_skill', 301, 'PD2'),
    ('N1WB-E20023-AB',                     'product_skill', 302, 'PD2'),
    ('N1WB-17G799-BB',                     'product_skill', 303, 'PD2'),
    ('N1WB-17G799-CA',                     'product_skill', 304, 'PD2'),
    ('N1WB-17B756-RE',                     'product_skill', 305, 'PD2'),
    ('N1WB-17B757-RE',                     'product_skill', 306, 'PD2'),
    ('N1WB-17A835-AD-PIA01',               'product_skill', 307, 'PD2'),
    ('R1WB-17E850-AB-PIA01',               'product_skill', 308, 'PD2'),
    ('R1WB-17E850-AB-PIA03',               'product_skill', 309, 'PD2'),
    ('MB3C-9068-A-PIA-10',                 'product_skill', 310, 'PD2'),
    ('Analysis Skill',                     'soft_skill', 407, null)
  ) v(label, category, sort_order, scope_section)
 where not exists (select 1 from skill_definitions d where lower(d.label) = lower(v.label));

-- ════════════════════════════════════════════════════════════════════════════
-- ย้อนกลับ (รันใน Main ทีละบล็อก):
--   begin;
--   delete from public.skill_level_up_requests; insert into public.skill_level_up_requests select * from archive.skill_std_20261028_requests;
--   delete from public.employee_skill_evidence; insert into public.employee_skill_evidence select * from archive.skill_std_20261028_evidence;
--   delete from public.skill_sub_items;         insert into public.skill_sub_items         select * from archive.skill_std_20261028_sub_items;
--   delete from public.station_requirements;    insert into public.station_requirements    select * from archive.skill_std_20261028_station_req;
--   delete from public.employee_skills;         insert into public.employee_skills         select * from archive.skill_std_20261028_emp_skills;
--   delete from public.skill_definitions;       insert into public.skill_definitions       select * from archive.skill_std_20261028_definitions;
--   commit;
--   ⚠️ คะแนนที่ farm/อนุมัติหลัง 28/10 จะหายไปด้วย — ย้อนเร็วที่สุดหลังพบปัญหา
-- ════════════════════════════════════════════════════════════════════════════
