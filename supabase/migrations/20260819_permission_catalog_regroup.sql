-- ═══ จัดหมวด/ลำดับ permission_catalog ให้ตรง sidebar (NAV_GROUP_ORDER) — audit 2026-08-19 ═══
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- COSMETIC ล้วน: เปลี่ยนเฉพาะ group_name + sort (ตำแหน่งที่แถวโผล่ในแท็บ "สิทธิ์การทำงาน"
-- ของหน้า /permissions) — **ไม่แตะ role_permissions สิทธิ์ของทุก role คงเดิมทุกช่อง**
--
-- ปัญหาที่แก้ (สะสมจาก seed คนละ migration ไม่เคยเทียบกัน):
--   1. หมวดกำพร้า: 'ซ่อมบำรุง' (energy) กับ 'ประชุมแถวเช้า' (morning_meeting) โผล่เป็นหมวดเดี่ยว
--   2. หมวด 'รายงาน/คุณภาพ' ไม่มีใน sidebar — ปน 4M/CQI-15/QA/Scrap/PE
--   3. เลข sort ชนกันหลายคู่ (17,50,60,61,81,82,210,220) ลำดับแถวไม่นิ่ง
--   4. ไม่มีหมวด 'พนักงาน & ทักษะ' — skills/employees/ojt/ตารางกะ กองใน 'ตั้งค่าโปรแกรมฯ'
--
-- กติกาใหม่ (บันทึกใน CLAUDE.md แล้ว): group_name ต้องเป็นชื่อหมวดตาม NAV_GROUP_ORDER เท่านั้น
-- ยึด "หน้าที่ action นั้นถูกใช้งาน" เป็นตัวชี้หมวด · ช่วง sort ต่อหมวด (เว้นระยะให้แทรก):
--   ภาพรวม 100-199 · ฝ่ายผลิต 200-299 · วิเคราะห์ & รายงาน 300-399 · พนักงาน & ทักษะ 400-499
--   Logistic - Store 500-599 · การตรวจสอบและซ่อมบำรุง 600-699 · ควบคุมคุณภาพ QA/QC 700-799
--   วิศวกรรม (PE) 800-899 · ตั้งค่าโปรแกรม,ฐานข้อมูล 900-999
-- ข้อยกเว้นที่ตั้งใจ: ot_master:manage คงหมวด 'ฝ่ายผลิต' ตามคำสั่งเดิม 2026-07-22
-- (จองรถ OT เป็นงานธุรการฝ่ายผลิต แม้แผงอยู่ในหน้า Report)
--
-- Rollback: cosmetic — ตั้ง group_name/sort กลับตามค่าก่อนหน้า (ดู audit_log ตาราง permission_catalog)

update public.permission_catalog c
   set group_name = v.grp, sort = v.srt
  from (values
    -- ── ภาพรวม ──
    ('factory_map',   'edit',                'ภาพรวม',                    110),
    -- ── ฝ่ายผลิต (ลำดับตามหน้าใน sidebar: ประชุมเช้า → เช็คชื่อ → จัดการไลน์ → Daily Report → Daily Checker → Kaizen → Scrap) ──
    ('morning_meeting', 'record',            'ฝ่ายผลิต',                  205),
    ('checkin',       'record',              'ฝ่ายผลิต',                  210),
    ('ot_master',     'manage',              'ฝ่ายผลิต',                  215),
    ('management',    'assign_manpower',     'ฝ่ายผลิต',                  220),
    ('management',    'assign_special_task', 'ฝ่ายผลิต',                  221),
    ('daily_report',  'open_shift',          'ฝ่ายผลิต',                  230),
    ('daily_report',  'record',              'ฝ่ายผลิต',                  231),
    ('daily_report',  'request_close',       'ฝ่ายผลิต',                  232),
    ('daily_report',  'close_shift',         'ฝ่ายผลิต',                  233),
    ('daily_report',  'approve_close',       'ฝ่ายผลิต',                  234),
    ('daily_report',  'delete_session',      'ฝ่ายผลิต',                  235),
    ('daily_report',  'setup',               'ฝ่ายผลิต',                  236),
    ('pokayoke',      'record',              'ฝ่ายผลิต',                  240),
    ('pokayoke',      'manage',              'ฝ่ายผลิต',                  241),
    ('lpa',           'record',              'ฝ่ายผลิต',                  245),
    ('lpa',           'manage',              'ฝ่ายผลิต',                  246),
    ('lpa',           'delete',              'ฝ่ายผลิต',                  247),
    ('improvements',  'manage',              'ฝ่ายผลิต',                  250),
    ('improvements',  'delete',              'ฝ่ายผลิต',                  251),
    ('scrap',         'record',              'ฝ่ายผลิต',                  255),
    ('scrap',         'manage',              'ฝ่ายผลิต',                  256),
    ('scrap',         'delete',              'ฝ่ายผลิต',                  257),
    -- ── วิเคราะห์ & รายงาน (OEE → VSM → Report/4M) ──
    ('oee',           'set_target',          'วิเคราะห์ & รายงาน',        305),
    ('oee',           'export_review',       'วิเคราะห์ & รายงาน',        306),
    ('vsm',           'manage',              'วิเคราะห์ & รายงาน',        310),
    ('report',        'export',              'วิเคราะห์ & รายงาน',        315),
    ('four_m',        'approve_sv',          'วิเคราะห์ & รายงาน',        320),
    ('four_m',        'approve_qa',          'วิเคราะห์ & รายงาน',        321),
    ('four_m',        'reset',               'วิเคราะห์ & รายงาน',        322),
    ('four_m',        'manage_docs',         'วิเคราะห์ & รายงาน',        323),
    -- ── พนักงาน & ทักษะ (พนักงาน → สกิล → OJT → ตารางกะ) ──
    ('employees',     'register',            'พนักงาน & ทักษะ',           405),
    ('employees',     'edit',                'พนักงาน & ทักษะ',           406),
    ('employees',     'deactivate',          'พนักงาน & ทักษะ',           407),
    ('employees',     'edit_all_sections',   'พนักงาน & ทักษะ',           408),
    ('skills',        'edit',                'พนักงาน & ทักษะ',           415),
    ('skills',        'edit_high',           'พนักงาน & ทักษะ',           416),
    ('skills',        'edit_allowance',      'พนักงาน & ทักษะ',           417),
    ('skills',        'approve_levelup',     'พนักงาน & ทักษะ',           418),
    ('skills',        'approve_levelup_100', 'พนักงาน & ทักษะ',           419),
    ('skills',        'run_weekly_update',   'พนักงาน & ทักษะ',           420),
    ('skills',        'delete',              'พนักงาน & ทักษะ',           421),
    ('ojt',           'record',              'พนักงาน & ทักษะ',           425),
    ('ojt',           'delete',              'พนักงาน & ทักษะ',           426),
    ('shift_schedule', 'edit',               'พนักงาน & ทักษะ',           430),
    ('shift_schedule', 'delete',             'พนักงาน & ทักษะ',           431),
    -- ── Logistic - Store (Store → WIP → Kanban → Rack → Planner → Delivery → Transport) ──
    ('line_stock',    'issue',               'Logistic - Store',          505),
    ('line_stock',    'manage_rounds',       'Logistic - Store',          506),
    ('line_stock',    'approve',             'Logistic - Store',          507),
    ('wip',           'adjust',              'Logistic - Store',          510),
    ('heijunka',      'operate',             'Logistic - Store',          515),
    ('rack_center',   'operate',             'Logistic - Store',          520),
    ('demand',        'upload',              'Logistic - Store',          525),
    ('shipping',      'config',              'Logistic - Store',          530),
    ('transport',     'manage',              'Logistic - Store',          535),
    -- ── การตรวจสอบและซ่อมบำรุง (MO → AM → PM → ประสานงาน → พลังงาน) ──
    ('mtn_repair',    'report',              'การตรวจสอบและซ่อมบำรุง',    605),
    ('mtn_repair',    'service',             'การตรวจสอบและซ่อมบำรุง',    606),
    ('mtn_repair',    'qa',                  'การตรวจสอบและซ่อมบำรุง',    607),
    ('mtn_repair',    'approve',             'การตรวจสอบและซ่อมบำรุง',    608),
    ('mtn_repair',    'manage_master',       'การตรวจสอบและซ่อมบำรุง',    609),
    ('mtn_repair',    'delete',              'การตรวจสอบและซ่อมบำรุง',    610),
    ('am',            'record',              'การตรวจสอบและซ่อมบำรุง',    615),
    ('pm',            'record',              'การตรวจสอบและซ่อมบำรุง',    620),
    ('pm',            'approve',             'การตรวจสอบและซ่อมบำรุง',    621),
    ('pm',            'setup',               'การตรวจสอบและซ่อมบำรุง',    622),
    ('pm_coord',      'manage',              'การตรวจสอบและซ่อมบำรุง',    625),
    ('energy',        'record',              'การตรวจสอบและซ่อมบำรุง',    630),
    -- ── ควบคุมคุณภาพ QA/QC (QA → CQI-15) ──
    ('qa',            'record',              'ควบคุมคุณภาพ QA/QC',        705),
    ('qa',            'manage',              'ควบคุมคุณภาพ QA/QC',        706),
    ('event_log',     'create',              'ควบคุมคุณภาพ QA/QC',        710),
    ('event_log',     'approve_o',           'ควบคุมคุณภาพ QA/QC',        711),
    ('event_log',     'approve_qt',          'ควบคุมคุณภาพ QA/QC',        712),
    ('event_log',     'approve_jme',         'ควบคุมคุณภาพ QA/QC',        713),
    ('event_log',     'approve_me',          'ควบคุมคุณภาพ QA/QC',        714),
    ('event_log',     'delete',              'ควบคุมคุณภาพ QA/QC',        715),
    -- ── วิศวกรรม (PE) ──
    ('pe',            'edit',                'วิศวกรรม (PE)',             805),
    ('pe',            'approve',             'วิศวกรรม (PE)',             806),
    -- ── ตั้งค่าโปรแกรม,ฐานข้อมูล (Product → Routing → ผังไลน์ → เครื่องจักร → QR → ปฏิทิน → เอกสาร) ──
    ('products',      'create',              'ตั้งค่าโปรแกรม,ฐานข้อมูล',  905),
    ('products',      'edit',                'ตั้งค่าโปรแกรม,ฐานข้อมูล',  906),
    ('products',      'delete',              'ตั้งค่าโปรแกรม,ฐานข้อมูล',  907),
    ('routing',       'manage',              'ตั้งค่าโปรแกรม,ฐานข้อมูล',  910),
    ('line_setup',    'edit',                'ตั้งค่าโปรแกรม,ฐานข้อมูล',  915),
    ('line_setup',    'delete',              'ตั้งค่าโปรแกรม,ฐานข้อมูล',  916),
    ('machines',      'create',              'ตั้งค่าโปรแกรม,ฐานข้อมูล',  920),
    ('machines',      'edit',                'ตั้งค่าโปรแกรม,ฐานข้อมูล',  921),
    ('machines',      'delete',              'ตั้งค่าโปรแกรม,ฐานข้อมูล',  922),
    ('qr_labels',     'print',               'ตั้งค่าโปรแกรม,ฐานข้อมูล',  925),
    ('company_calendar', 'edit',             'ตั้งค่าโปรแกรม,ฐานข้อมูล',  930),
    ('doc_forms',     'manage',              'ตั้งค่าโปรแกรม,ฐานข้อมูล',  935)
  ) as v(resource, action, grp, srt)
 where c.resource = v.resource and c.action = v.action;

-- ── โบนัสจาก audit: employees:edit_all_sections ไม่เคยถูกลงทะเบียนใน catalog ──
-- (seed role_permissions ไว้ตั้งแต่ 20260817_sale_role_employee_management แต่ลืม insert catalog
--  = admin ปรับจากหน้า /permissions ไม่ได้เลย — ขัดกฎเหล็ก "action ใหม่ต้องลงทะเบียน")
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'employees', 'edit_all_sections',
       'พนักงาน: แก้ได้ทุกส่วนงาน (ไม่มี = แก้เฉพาะส่วนงานตัวเอง)',
       'พนักงาน & ทักษะ', 408
where not exists (
  select 1 from public.permission_catalog
  where resource = 'employees' and action = 'edit_all_sections'
);
