-- ════════════════════════════════════════════════════════════════════════════
-- DR project ("Product DB" · eyhclzkifitbhbljgoav)
-- ใบซ่อม MO ที่เปิดจากดาวน์ไทม์ — เลิกติดป้าย "อื่นๆ / ไม่ระบุกลุ่ม" (2026-09-23)
--
-- ที่มา (user 23/09): "ไม่ระบุกับอื่นๆ มาอันดับ 1 กับ 2 การวิเคราะห์จะไม่มีประโยชน์เลย"
--
-- ต้นเหตุ (วัดจากข้อมูลจริง 493 ใบ):
--   · 325 ใบเปิดจากดาวน์ไทม์ → โค้ด hardcode problem_characteristic='อื่นๆ'
--     และ **ไม่เซ็ต problem_group เลย** ทั้งที่ประเภทดาวน์ไทม์รู้อยู่แล้วตั้งแต่กดปุ่ม
--     (เอาไปต่อท้ายเป็นข้อความแทน: "[จาก Downtime] เลเซอร์มีปัญหา — Alarm TC")
--   · ทีม production เป็นเจ้าของ 288/325 ใบ แต่ **ไม่มีอาการในทะเบียนเลยสักแถว**
--     (ทะเบียนเดิมเป็นของ die_maintenance 22 + maintenance 17 + jig_maintenance 13)
--   · 54 ใบเขียน "เปลี่ยนตามรอบ PM" = งานตามแผน ไม่ใช่ปัญหา แต่ถูกนับในพาเรโตปัญหา
--
-- การจับคู่ 32 ประเภท → 11 กลุ่ม = **user ตรวจและยืนยันเองในแชท 23/09**
--   (ห้าม AI เดา taxonomy ของโรงงาน — กฎ CLAUDE.md · "หัว Mandrel" user ชี้ว่าเป็น
--    tool die ของเครื่อง Bending จึงอยู่กลุ่มเครื่องขึ้นรูป ไม่ใช่กลุ่มงานเชื่อม)
--
-- ⚠️ ย้อนกลับได้: ดูบล็อก ROLLBACK ท้ายไฟล์ (สำรองค่าเดิมไว้ใน archive.* ก่อนแก้)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) ที่เก็บการจับคู่ "ประเภทดาวน์ไทม์ → กลุ่มปัญหาของใบซ่อม" ───────────────
--    เก็บไว้ข้างๆ ตัวประเภทดาวน์ไทม์เอง (ไม่สร้างตารางทะเบียนใหม่ — กฎ single source)
--    nullable ⇒ backward-compatible · แถวที่ไม่จับคู่ = ปล่อยเป็น "อื่นๆ" ตามจริง
alter table public.dr_downtime_types
  add column if not exists mo_problem_group text;

comment on column public.dr_downtime_types.mo_problem_group is
  'กลุ่มปัญหาที่ใบซ่อม MO จะได้เมื่อเปิดจากดาวน์ไทม์ประเภทนี้ (null = ปล่อยเป็น "อื่นๆ" ตามจริง ห้ามเดา) · ตั้งค่า 2026-09-23 โดย user';

-- ── 2) จับคู่ 32 ประเภทที่เกิดจริง (308 ใบ) ────────────────────────────────────
update public.dr_downtime_types set mo_problem_group = v.grp
from (values
  -- 1. เลเซอร์ — 85 ใบ
  ('เลเซอร์มีปัญหา',                          'เลเซอร์ (Laser)'),
  ('เครื่อง Laser มีปัญหา',                    'เลเซอร์ (Laser)'),
  -- 2. เชื่อม — ของสิ้นเปลือง/ปลายหัว — 82 ใบ (แก้ด้วยรอบเปลี่ยน/TPM คนละทางกับเครื่องเสีย)
  ('เปลี่ยน Cap Tip / Contact Tip',            'เชื่อม — ของสิ้นเปลือง/ปลายหัว'),
  ('เปลี่ยน Electrode / Pin',                  'เชื่อม — ของสิ้นเปลือง/ปลายหัว'),
  ('ลวดเชื่อมติด',                             'เชื่อม — ของสิ้นเปลือง/ปลายหัว'),
  ('เปลี่ยนถังลวดเชื่อม',                       'เชื่อม — ของสิ้นเปลือง/ปลายหัว'),
  ('ชุดป้อนลวด แตก/หัก',                       'เชื่อม — ของสิ้นเปลือง/ปลายหัว'),
  -- 3. หุ่นยนต์ / Gripper — 40 ใบ
  ('Robot (Alarm/Error)',                      'หุ่นยนต์ / Gripper'),
  ('Gripper ชำรุด/จับงานไม่ได้',                'หุ่นยนต์ / Gripper'),
  ('โรบอท/จิ๊ก วางงานไม่ลง (นอกแผน)',           'หุ่นยนต์ / Gripper'),
  -- 4. ไฟฟ้า / ควบคุม — 26 ใบ (ใช้ชื่อกลุ่มที่มีอยู่แล้วในทะเบียน)
  ('Sensor / Reed มีปัญหา',                    'ไฟฟ้า / ควบคุม'),
  ('ระบบ PLC มีปัญหา',                         'ไฟฟ้า / ควบคุม'),
  ('Prox ชำรุด',                               'ไฟฟ้า / ควบคุม'),
  ('เครื่อง Marker มีปัญหา',                    'ไฟฟ้า / ควบคุม'),
  ('เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)',     'ไฟฟ้า / ควบคุม'),
  -- 5. เชื่อม — เครื่อง/อุปกรณ์ — 23 ใบ
  ('Stationary มีปัญหา',                       'เชื่อม — เครื่อง/อุปกรณ์'),
  ('ปืนยิงรีเวทชำรุด',                          'เชื่อม — เครื่อง/อุปกรณ์'),
  ('เครื่อง stud Alarm',                        'เชื่อม — เครื่อง/อุปกรณ์'),
  ('ปรับแนวเชื่อม / ปรับจุด Spot',              'เชื่อม — เครื่อง/อุปกรณ์'),
  ('เปลี่ยนหัว Stud',                           'เชื่อม — เครื่อง/อุปกรณ์'),
  -- 6-7. ราง / จิ๊ก แยกกัน (user 23/09 "แยก" — คนละทีมดูแล)
  ('ราง Conveyor มีปํญหา',                     'ราง / ลำเลียง'),   -- สะกดตามข้อมูลจริง (ปํญหา)
  ('JIG มีปัญหา (ชำรุด/ปรับแก้)',               'จิ๊ก / ฟิกเจอร์'),
  -- 8. Nut / Stud / Feeder — 10 ใบ
  ('Feeder มีปัญหา',                           'Nut / Stud / Feeder'),
  ('Feed nut ติด/ปัญหาเกลียว Nut,Bolt,Stud',   'Nut / Stud / Feeder'),
  ('Nut Stud ติด',                             'Nut / Stud / Feeder'),
  -- 9. อาการที่ชิ้นงาน — 5 ใบ (ชื่อกลุ่มเดิมในทะเบียน)
  ('แก้ไขปัญหาคุณภาพ',                          'อาการที่ชิ้นงาน'),
  -- 10. เครื่องขึ้นรูป — 5 ใบ · "หัว Mendel" = tool die ของเครื่อง Bending (user ชี้ 23/09)
  ('ระบบ Hydraulic มีปัญหา',                   'เครื่องขึ้นรูป (ปั๊ม/เบนด์/ไฮดรอลิก)'),
  ('เครื่องBending มีปัญหา',                    'เครื่องขึ้นรูป (ปั๊ม/เบนด์/ไฮดรอลิก)'),
  ('เครื่องกด/ปั๊มมีปัญหา',                      'เครื่องขึ้นรูป (ปั๊ม/เบนด์/ไฮดรอลิก)'),
  ('หัว Mendel มัปัญหา',                        'เครื่องขึ้นรูป (ปั๊ม/เบนด์/ไฮดรอลิก)'),
  -- 11. สาธารณูปโภค — 2 ใบ (user 23/09 "รวมได้ตามนั้น" ไม่แยก 3 ระบบ)
  ('ระบบน้ำ / ลม / ไฟ มีปัญหา',                 'สาธารณูปโภค (น้ำ/ลม/ไฟ)')
  -- 'อื่นๆ (นอกแผน)' ตั้งใจไม่จับคู่ — ต้นทางไม่ระบุจริง ระบบห้ามเดาแทน
) as v(nm, grp)
where public.dr_downtime_types.name_th = v.nm;

-- ── 3) ทะเบียนอาการของ "ทีม production" — เดิมไม่มีเลยสักแถว ────────────────────
--    ช่างประจำไลน์เปิด 288/325 ใบ แต่เลือกอาการจากทะเบียนไม่ได้ (ไม่มีให้เลือก)
--    ⇒ seed จากประเภทดาวน์ไทม์ที่เกิดจริง เพื่อให้เลือกเองได้ในใบที่เปิดด้วยมือด้วย
insert into public.mtn_problem_types (characteristic, group_name, team, is_active, sort_order)
select t.name_th, t.mo_problem_group, 'production', true,
       row_number() over (order by t.mo_problem_group, t.name_th) * 10
from public.dr_downtime_types t
where t.mo_problem_group is not null
  and not exists (
    select 1 from public.mtn_problem_types p
    where p.team = 'production' and p.characteristic = t.name_th
  );

-- ── 4) สำรองค่าเดิมก่อนแก้ย้อนหลัง ────────────────────────────────────────────
--    🔴 ตารางสำรองต้องอยู่ schema `archive` ห้ามไว้ใน public
--       (กฎ CLAUDE.md — เคยค้าง 37 ตารางใน public · 35 ตัวไม่มี RLS = anon อ่านได้)
create schema if not exists archive;
create table if not exists archive.mtn_orders_problem_20260923 as
select id, problem_group, problem_characteristic from public.mtn_orders;

-- ── 5) ย้อนหลัง: ใบที่เปิดจากดาวน์ไทม์ → เอาประเภทจริงคืนมา (308 ใบ) ─────────────
update public.mtn_orders o
set problem_characteristic = t.name_th,
    problem_group          = coalesce(t.mo_problem_group, 'อื่นๆ')
from public.downtime_logs d
join public.dr_downtime_types t on t.id = d.downtime_type_id
where o.source_downtime_id = d.id
  and (o.problem_characteristic is null or o.problem_characteristic = 'อื่นๆ')
  and coalesce(trim(o.problem_group), '') = '';

-- ── 6) "เปลี่ยนตามรอบ PM" = งานตามแผน ไม่ใช่ปัญหา (user 23/09 "แยกออก") ────────
--    แยกเป็นกลุ่มของตัวเอง **ไม่ลบทิ้ง** — จอวิเคราะห์ปัญหากรองออก แต่ยังนับยอดได้
update public.mtn_orders
set problem_group = 'งานตามแผน (PM)'
where source_downtime_id is null
  and report_note ilike '%ตามรอบ PM%'
  and coalesce(trim(problem_group), '') in ('', 'อื่นๆ');

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (ถ้าต้องย้อน — รันทั้งบล็อกนี้)
--   update public.mtn_orders o set problem_group = b.problem_group,
--          problem_characteristic = b.problem_characteristic
--     from archive.mtn_orders_problem_20260923 b where b.id = o.id;
--   delete from public.mtn_problem_types where team = 'production';
--   update public.dr_downtime_types set mo_problem_group = null;
--   -- คอลัมน์ mo_problem_group ปล่อยไว้ได้ (nullable · ไม่มีใครบังคับใช้)
-- ════════════════════════════════════════════════════════════════════════════
