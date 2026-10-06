-- ════════════════════════════════════════════════════════════════════════════
-- DR project ("Product DB" · eyhclzkifitbhbljgoav)
-- ทะเบียนลักษณะปัญหา MO — จัดกลุ่มให้ครบ + ยุบคู่ซ้ำ + ตัด prefix "MTN ระบบ" (2026-10-06)
--
-- ที่มา (user 06/10): *"ตรงนี้มั่วด้วย ระบบ dropdown"* → *"มั่ว"* → สั่ง **ข้อ ก ลุย**
--   (ข้อ ก = จัดกลุ่มให้ JIG 13 แถว + ยุบคู่ซ้ำ + ตัด prefix "MTN ระบบ")
--
-- ── สิ่งที่วัดได้ก่อนแก้ (ทะเบียน 90 แถว active · ใบ 642 ใบ) ──
--   1. **JIG MTN 13/13 แถวไม่มี group_name** ⇒ ช่าง JIG เปิดฟอร์มเจอกลุ่มเดียวคือ
--      ถังสังเคราะห์ "อื่นๆ" → ตัวเลือก 2 ชั้นไร้ผลกับทีมนี้ (ผิดกฎ CLAUDE.md
--      §"อื่นๆ ห้ามขึ้นอันดับ 1" ชั้น 2 — ทะเบียนต้องครบ + มี group)
--   2. มีแถวจริงชื่อ "อื่นๆ" (ของกลาง ไม่มีกลุ่ม) **ชนกับถังสังเคราะห์ที่โค้ดตั้งชื่อ
--      `NO_GROUP='อื่นๆ'`** ⇒ ป้ายเดียวกัน 2 ความหมายใน dropdown เดียว
--   3. เรื่องเดียวกันแตกหลายกลุ่ม: ไฟฟ้า = `ไฟฟ้า / ควบคุม` + `MTN ระบบไฟฟ้า`
--      + `MTN ระบบ PLC HDF` · ลม = `ระบบลม` + `MTN ระบบนิวเมติก [ ระบบลม ]`
--   4. prefix "MTN ระบบ…" 6 กลุ่ม ทั้งที่ลิสต์ถูกกรองตามทีมอยู่แล้ว (เสียงรบกวน)
--   5. หัวข้อย่อยซ้ำที่คนแจ้งเห็นเรียงติดกัน (เพราะ `SEE_ALL_TEAMS=['production']`
--      ทำให้ฝ่ายผลิตเห็นแถวของกลาง + ของตัวเองปนกัน) — 4 คู่ (รายละเอียดข้อ 5 ล่าง)
--   6. ช่องว่างเกิน/ท้ายข้อความ 7 แถว ⇒ คีย์ที่ join ด้วยข้อความแตกเงียบๆ
--
-- ⚠️ การจับคู่กลุ่มในไฟล์นี้ **ไม่ใช่การคิดชื่อใหม่** — ใช้ชื่อกลุ่มที่มีอยู่ใน
--    ทะเบียนแล้วทั้งหมด (จิ๊ก / ฟิกเจอร์ · หุ่นยนต์ / Gripper · Nut / Stud / Feeder
--    · ระบบลม · ไฟฟ้า / ควบคุม) ⇒ เป็นการ "ย้ายเข้ากลุ่มที่โรงงานตั้งไว้แล้ว"
--    ไม่ใช่ AI เดา taxonomy ใหม่ (กฎเดียวกับ 20260923_mo_problem_group_from_downtime_dr.sql)
--
-- 🔒 ด่านกันพลาดที่ใส่ไว้ในไฟล์นี้:
--   · ขั้น 6 (re-derive กลุ่มของใบ) **ห้ามแตะใบที่กลุ่มมาจากระบบอื่น** —
--     `งานตามแผน (PM)` 54 ใบ (กฎ: งานตามแผนไม่ใช่ปัญหา ห้ามกลืน) และ
--     `ผลตรวจ PM/AM ไม่ผ่าน` 2 ใบ (เขียนจาก PMCheckData.jsx:869)
--     ⇒ คิดจาก `sysgrp` = กลุ่มที่ไม่มีในทะเบียนนี้เลย
--   · ทุก update มีเงื่อนไข "ค่าปัจจุบันยังเป็นของเดิม" ⇒ รันซ้ำไม่เพี้ยน (idempotent)
--   · ผู้ชนะของการยุบคู่ซ้ำ **ต้องมองเห็นได้จากทีมของผู้แพ้** — แถวของกลาง (team null)
--     เห็นได้ทุกทีม · ถ้าผู้ชนะเป็นของทีมเดียว ต้องเติม `shared_teams` ให้ครบ
--     (ไม่งั้นทีมที่เคยเลือกได้จะ "หายตัวเลือก" เงียบๆ — ดู utils/mtnTeams.js visibleToTeam)
--
-- ⚠️ ย้อนกลับได้: สำรองค่าเดิมไว้ใน archive.* แล้ว · ดูบล็อก ROLLBACK ท้ายไฟล์
-- ════════════════════════════════════════════════════════════════════════════

begin;

create schema if not exists archive;

-- ── 1) สำรองค่าเดิมก่อนแก้ (schema archive — ห้ามไว้ public · กฎ CLAUDE.md) ────
create table if not exists archive.mtn_problem_taxonomy_20261006_types as
  select id, group_name, characteristic, detail, team, shared_teams, is_active,
         now() as backed_up_at
    from public.mtn_problem_types;
alter table archive.mtn_problem_taxonomy_20261006_types enable row level security;

create table if not exists archive.mtn_problem_taxonomy_20261006_orders as
  select id, problem_group, problem_characteristic, now() as backed_up_at
    from public.mtn_orders;
alter table archive.mtn_problem_taxonomy_20261006_orders enable row level security;

-- ── 2) ล้างช่องว่างเกิน (ท้ายข้อความ / ซ้อนกลางข้อความ) ────────────────────────
--    คีย์ join ของโมดูลนี้เป็น "ข้อความ" ⇒ `"ระบบ Hydraulic รั่วซึม "` กับตัวไม่มี
--    ช่องว่างท้าย = คนละแท่งในพาเรโต · ทำทั้ง 2 ฝั่งพร้อมกันเพื่อให้ join ไม่ขาด
update public.mtn_problem_types set
    group_name     = nullif(btrim(regexp_replace(coalesce(group_name, ''),     '\s+', ' ', 'g')), ''),
    characteristic =        btrim(regexp_replace(coalesce(characteristic, ''), '\s+', ' ', 'g')),
    detail         = nullif(btrim(regexp_replace(coalesce(detail, ''),         '\s+', ' ', 'g')), '')
  where group_name     is distinct from nullif(btrim(regexp_replace(coalesce(group_name, ''),     '\s+', ' ', 'g')), '')
     or characteristic is distinct from        btrim(regexp_replace(coalesce(characteristic, ''), '\s+', ' ', 'g'))
     or detail         is distinct from nullif(btrim(regexp_replace(coalesce(detail, ''),         '\s+', ' ', 'g')), '');

update public.mtn_orders set
    problem_characteristic = btrim(regexp_replace(coalesce(problem_characteristic, ''), '\s+', ' ', 'g')),
    problem_group          = btrim(regexp_replace(coalesce(problem_group, ''),          '\s+', ' ', 'g'))
  where problem_characteristic is distinct from btrim(regexp_replace(coalesce(problem_characteristic, ''), '\s+', ' ', 'g'))
     or problem_group          is distinct from btrim(regexp_replace(coalesce(problem_group, ''),          '\s+', ' ', 'g'));

-- ── 3) เติม group ให้แถวที่ยังไม่มีกลุ่ม ───────────────────────────────────────
--    3a) JIG MTN 13 แถว → เข้ากลุ่มที่ทะเบียนมีอยู่แล้ว (ไม่ตั้งชื่อกลุ่มใหม่)
update public.mtn_problem_types p set group_name = v.grp
  from (values
    -- ตัวจับงาน / ตัวกำหนดตำแหน่งบนจิ๊ก
    ('แคลมป์ ชำรุด',            'จิ๊ก / ฟิกเจอร์'),
    ('ดาตั้มซัพพอร์ต ชำรุด',     'จิ๊ก / ฟิกเจอร์'),
    ('ปรับจิ๊กฟิกเจอร์',         'จิ๊ก / ฟิกเจอร์'),
    ('พาเลท ชำรุด',             'จิ๊ก / ฟิกเจอร์'),
    ('โลเคเตอร์ ชำรุด',          'จิ๊ก / ฟิกเจอร์'),
    ('สต็อปเปอร์ ชำรุด',         'จิ๊ก / ฟิกเจอร์'),
    -- หุ่นยนต์ (อะลาร์ม + งานปรับท่า ทั้งเชื่อมจุด/เชื่อมแก๊ส/หยิบจับ)
    ('แก้ไขโรบอทอะลาร์ม',        'หุ่นยนต์ / Gripper'),
    ('ปรับโรบอทเชื่อมแก๊ส',       'หุ่นยนต์ / Gripper'),
    ('ปรับโรบอทเชื่อมจุด',        'หุ่นยนต์ / Gripper'),
    ('ปรับโรบอทแฮนเดอร์ริ่ง',     'หุ่นยนต์ / Gripper'),
    -- ตัวป้อนนัท/สตัด
    ('นัทฟีดเดอร์ ชำรุด',        'Nut / Stud / Feeder'),
    ('นัทหรือโบลท์ ชำรุด',        'Nut / Stud / Feeder'),
    -- วาล์วลม
    ('โซลินอยด์วาวล์ ชำรุด',      'ระบบลม')
  ) as v(ch, grp)
  where p.characteristic = v.ch
    and p.team = 'jig_maintenance'
    and coalesce(btrim(p.group_name), '') = '';   -- เติมเฉพาะที่ยังว่าง (รันซ้ำไม่ทับ)

--    3b) แถวจริงชื่อ "อื่นๆ" — ให้มีกลุ่มของตัวเอง เลิกชนกับถังสังเคราะห์ของโค้ด
--        (โค้ดฝั่งจอเปลี่ยนชื่อถังสังเคราะห์เป็น "ยังไม่จัดกลุ่ม" ในคอมมิทเดียวกัน)
--        ⚠️ ป้ายนี้ยังเข้าเงื่อนไข `isVague()` ⇒ จอวิเคราะห์ยังนับเป็น "ชี้เป้าไม่ได้" ตามกฎ
update public.mtn_problem_types
   set group_name = 'อื่นๆ / ยังระบุไม่ได้'
  where characteristic = 'อื่นๆ'
    and coalesce(btrim(group_name), '') = '';

-- ── 4) ตัด prefix "MTN ระบบ" + ยุบกลุ่มที่เป็นเรื่องเดียวกัน ────────────────────
--    ลิสต์ถูกกรองตามทีมอยู่แล้ว ⇒ prefix บอกทีมซ้ำซ้อน · ไฟฟ้า/ลม เคยแตกหลายกลุ่ม
--    ทำทั้งทะเบียนและใบ (ใบเก็บ problem_group เป็นสำเนาข้อความ ไม่ผูก FK)
update public.mtn_problem_types p set group_name = v.new_g
  from (values
    ('MTN ระบบไฟฟ้า',                        'ไฟฟ้า / ควบคุม'),
    ('MTN ระบบ PLC HDF',                     'ไฟฟ้า / ควบคุม'),
    ('MTN ระบบนิวเมติก [ ระบบลม ]',            'ระบบลม'),
    ('MTN ระบบ Hydraulic',                   'ไฮดรอลิก (Hydraulic)'),
    ('MTN ระบบ Mechanic [ ระบบส่งกำลัง ]',     'ระบบส่งกำลัง (เกียร์/สายพาน/แบริ่ง)'),
    ('MTN ระบบหล่อเย็น [ Cooling Syst ]',      'ระบบหล่อเย็น (Cooling)')
  ) as v(old_g, new_g)
  where btrim(coalesce(p.group_name, '')) = v.old_g;

update public.mtn_orders o set problem_group = v.new_g
  from (values
    ('MTN ระบบไฟฟ้า',                        'ไฟฟ้า / ควบคุม'),
    ('MTN ระบบ PLC HDF',                     'ไฟฟ้า / ควบคุม'),
    ('MTN ระบบนิวเมติก [ ระบบลม ]',            'ระบบลม'),
    ('MTN ระบบ Hydraulic',                   'ไฮดรอลิก (Hydraulic)'),
    ('MTN ระบบ Mechanic [ ระบบส่งกำลัง ]',     'ระบบส่งกำลัง (เกียร์/สายพาน/แบริ่ง)'),
    ('MTN ระบบหล่อเย็น [ Cooling Syst ]',      'ระบบหล่อเย็น (Cooling)')
  ) as v(old_g, new_g)
  where btrim(coalesce(o.problem_group, '')) = v.old_g;

-- ── 5) ยุบหัวข้อย่อยที่ซ้ำกันจริง (4 คู่) ──────────────────────────────────────
--    เกณฑ์: ความหมายเดียวกัน และคนแจ้งคนเดียวเห็นทั้งคู่ใน dropdown เดียว
--      · เครื่อง Laser มีปัญหา (production · 16 ใบ) ↔ เลเซอร์มีปัญหา (production · 77 ใบ)
--        ⇒ ทีมเดียวกัน กลุ่มเดียวกัน = ซ้ำเป๊ะ · เก็บตัวที่ใบมากกว่า (รื้อประวัติน้อยกว่า)
--      · เครื่องมาร์ค ชำรุด (ของกลาง · 1) ↔ เครื่อง Marker มีปัญหา (production · 2)
--      · เซนเซอร์ ชำรุด (ของกลาง · 4)    ↔ Sensor / Reed มีปัญหา (production · 27)
--      · ระบบไฟฟ้าของเครื่องจักรผิดปกติ (maintenance · 1) ↔ ระบบไฟฟ้า ชำรุด (ของกลาง · 2)
--    ❌ **ไม่ยุบ** `ระบบ PLC มีปัญหา` (production) กับ `PLC / HMI ผิดปกติ` (maintenance)
--       — ไม่มีฝ่ายไหนเป็นของกลาง ยุบทางใดทางหนึ่งแล้วอีกทีม "หายตัวเลือก"
--       (ปล่อยเป็นมุมมองรายทีมตามการออกแบบของโมดูล)
--    ❌ **ไม่ยุบ** `Prox ชำรุด` — ชี้อุปกรณ์เฉพาะ (proximity switch) ไม่ใช่คำกำกวม

--    5a) ใบเก่าตามไปที่ผู้ชนะ (ไม่งั้นพาเรโตแตก 2 แท่งถาวร)
update public.mtn_orders o set problem_characteristic = v.winner
  from (values
    ('เครื่อง Laser มีปัญหา',            'เลเซอร์มีปัญหา'),
    ('เครื่องมาร์ค ชำรุด',               'เครื่อง Marker มีปัญหา'),
    ('เซนเซอร์ ชำรุด',                  'Sensor / Reed มีปัญหา'),
    ('ระบบไฟฟ้าของเครื่องจักรผิดปกติ',    'ระบบไฟฟ้า ชำรุด')
  ) as v(loser, winner)
  where btrim(coalesce(o.problem_characteristic, '')) = v.loser;

--    5b) ผู้ชนะที่เป็นของทีมเดียว ต้องเปิดให้ทีมที่เคยเห็นแถวของกลาง ยังเห็นอยู่
--        (ของกลางเห็นได้ทุกทีม · production ของตัวเองเห็นเฉพาะ production + AM)
update public.mtn_problem_types
   set shared_teams = array['maintenance', 'jig_maintenance', 'die_maintenance']::text[]
  where characteristic in ('เครื่อง Marker มีปัญหา', 'Sensor / Reed มีปัญหา')
    and team = 'production'
    and coalesce(array_length(shared_teams, 1), 0) = 0;

--    5c) ปลดผู้แพ้ออกจากตัวเลือก (soft delete แบบเดียวกับปุ่ม 🗑 บนจอ ห้าม delete)
update public.mtn_problem_types
   set is_active = false
  where characteristic in ('เครื่อง Laser มีปัญหา', 'เครื่องมาร์ค ชำรุด',
                           'เซนเซอร์ ชำรุด', 'ระบบไฟฟ้าของเครื่องจักรผิดปกติ')
    and is_active is not false;

-- ── 6) ใบที่กลุ่มล้าสมัย → อ่านกลุ่มใหม่จากทะเบียน (มีด่านกันกลืนงานตามแผน) ────
--    ทำไมต้องทำ: `NAME_CASCADE` เดิมไม่มี `group_name` ⇒ เปลี่ยนชื่อกลุ่มในทะเบียน
--    ใบเก่าค้างชื่อเดิม พาเรโตแตกเงียบๆ (แก้ที่โค้ดด้วยในคอมมิทเดียวกัน)
--    🔒 `sysgrp` = กลุ่มที่ "ไม่มีอยู่ในทะเบียนนี้เลย" ⇒ มาจากระบบอื่น ห้ามแตะ
--       (`งานตามแผน (PM)` · `ผลตรวจ PM/AM ไม่ผ่าน`) — กฎ: งานตามแผนไม่ใช่ปัญหา
--       แต่ก็ห้ามถูกเขียนทับให้หายไป
with reg as (
  select btrim(characteristic) as ch,
         nullif(btrim(coalesce(group_name, '')), '') as grp
    from public.mtn_problem_types
   where is_active is not false
), sysgrp as (
  select distinct btrim(coalesce(o.problem_group, '')) as g
    from public.mtn_orders o
   where coalesce(btrim(o.problem_group), '') <> ''
     and btrim(o.problem_group) <> 'อื่นๆ'   -- ป้ายที่โค้ดเก่าเขียนเอง = ให้ re-derive ได้
     and not exists (select 1 from reg r where r.grp = btrim(o.problem_group))
)
update public.mtn_orders o set problem_group = r.grp
  from reg r
 where btrim(coalesce(o.problem_characteristic, '')) = r.ch
   and r.grp is not null
   and o.problem_group is distinct from r.grp
   and coalesce(btrim(o.problem_group), '') not in (select g from sysgrp);

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ คิวรีเช็คผล (รันใน SQL Editor ของ project "Product DB" · eyhclzkifitbhbljgoav)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) ต้องไม่มีแถว active ที่ไม่มีกลุ่มเหลือเลย (คาดหวัง 0 ทุกทีม)
--    select coalesce(team,'(ของกลาง)') team, count(*) ungrouped
--      from public.mtn_problem_types
--     where is_active is not false and coalesce(btrim(group_name),'')=''
--     group by 1;
--
-- 2) ต้องไม่มีกลุ่มที่ยังขึ้นต้นด้วย "MTN ระบบ" (คาดหวัง 0)
--    select count(*) from public.mtn_problem_types
--     where is_active is not false and group_name like 'MTN ระบบ%';
--
-- 3) ต้องไม่มีหัวข้อย่อยซ้ำใน "ทีมเดียวกัน + กลุ่มเดียวกัน" (คาดหวัง 0 แถว)
--    select coalesce(team,'(ของกลาง)') team, group_name, characteristic, count(*) n
--      from public.mtn_problem_types where is_active is not false
--     group by 1,2,3 having count(*) > 1;
--
-- 4) งานตามแผนต้องยังอยู่ครบ (คาดหวัง 54 และ 2 — เท่าก่อนรัน)
--    select problem_group, count(*) from public.mtn_orders
--     where problem_group in ('งานตามแผน (PM)','ผลตรวจ PM/AM ไม่ผ่าน') group by 1;
--
-- 5) พาเรโตกลุ่มของใบ — "(ว่าง)" ควรเหลือเฉพาะใบที่อาการไม่อยู่ในทะเบียน
--    select coalesce(nullif(btrim(problem_group),''),'(ว่าง)') grp, count(*) n
--      from public.mtn_orders group by 1 order by 2 desc;
--
-- 6) ใบที่อาการยังชี้เป้าไม่ได้ (ก่อนรัน 221/642 = 34%)
--    select count(*) from public.mtn_orders where btrim(problem_characteristic)='อื่นๆ';
--    -- ⚠️ ตัวเลขนี้ "ไม่ลด" จาก migration นี้ และ **ต้องไม่ลด** — ใบเก่าที่คนเลือก
--    --    "อื่นๆ" ไว้ ระบบไม่รู้ว่าจริงๆ คืออาการอะไร การเดาแทนคน = ผิดกฎ
--    --    (ชั้น 5 "ห้ามเขียนผลเดากลับฐาน") · ที่ migration นี้แก้คือ **ใบใหม่จากนี้ไป
--    --    มีตัวเลือกให้เลือก** — ทีม JIG เดิมเลือกได้แค่ "อื่นๆ" เท่านั้น
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⏪ ROLLBACK (คืนค่าเดิมทุกคอลัมน์ที่แตะ จาก archive.*)
-- ════════════════════════════════════════════════════════════════════════════
--  begin;
--  update public.mtn_problem_types p set
--      group_name = b.group_name, characteristic = b.characteristic, detail = b.detail,
--      team = b.team, shared_teams = b.shared_teams, is_active = b.is_active
--    from archive.mtn_problem_taxonomy_20261006_types b where b.id = p.id;
--  update public.mtn_orders o set
--      problem_group = b.problem_group, problem_characteristic = b.problem_characteristic
--    from archive.mtn_problem_taxonomy_20261006_orders b where b.id = o.id;
--  commit;
--  -- ลำดับที่ปลอดภัย: revert โค้ด (NAME_CASCADE / NO_GROUP) ก่อน แล้วค่อยรัน ROLLBACK นี้
-- ════════════════════════════════════════════════════════════════════════════
