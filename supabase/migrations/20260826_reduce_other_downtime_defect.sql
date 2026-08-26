-- ═══════════════════════════════════════════════════════════════════════════
--  ลด "อื่นๆ" ออกจากอันดับ 1 ของทั้ง Downtime และ Defect  (DR project)
--  2026-08-26 · คำสั่ง user: "ตั้งให้เลยและใช้อัลกอริทึมนี้จับให้เลย
--                             มันไม่ดีเลยที่อื่นๆเป็นอันดับ 1"
-- ───────────────────────────────────────────────────────────────────────────
--  ปัญหาที่วัดได้จริงก่อนทำ (25-26 ส.ค. 2569)
--    Downtime : "อื่นๆ" = 26,322 นาที · แต่ 76.7% เป็นแค่ 6 เรื่องที่ควรมีประเภทของตัวเอง
--    Defect   : "อื่นๆ" = 313 ชิ้น (อันดับ 1 · อันดับ 2 มี 120) · 99.7% จับกลุ่มได้
--    ต้นเหตุ  : พนักงานเขียนอิสระ 1,685 แบบ จาก 5,442 บันทึก
--               (พาเลส/พาเลท/พาเลสเต๊ม · "อาราม" = alarm เขียนไทย · พิมพ์ผิดแป้น rkg]lg9H,ik')
--
--  ⚠️⚠️ กฎเหล็กของ migration นี้ — ห้ามละเมิดถ้าจะทำซ้ำกับข้อมูลชุดอื่น
--   1. **คงหมวด ในแผน/นอกแผน (category) เดิมทุกแถว** (คำสั่ง user 2026-08-26:
--      "ถ้าข้อมูลที่จับได้ อื่นๆนอกแผน ก็เป็นนอกแผนเลย")
--      → ประเภทใหม่ถูกสร้าง "คู่" ตามหมวด และ UPDATE จับคู่ทั้ง k และ cat
--      → category คือตัวคิด %A ของ OEE — สลับหมวดเมื่อไหร่ KPI ย้อนหลังเพี้ยนทันที
--   2. **ไม่แตะ description** — ข้อความเดิมของพนักงานอยู่ครบ สอบกลับได้เสมอ
--   3. **ไม่แตะ duration_min / qty_ng** — ยอดไม่เปลี่ยน เปลี่ยนแค่ "ป้ายชื่อ"
--   4. **ค่า OEE ที่ stamp ไว้ตอนปิดกะไม่กระทบ** (production_sessions.oee_a/p/q)
--      เพราะ migration นี้ไม่แตะตารางนั้น · กะที่ปิดแล้วยังโชว์ค่าเดิมเป๊ะ
--   5. **`excl_from_q` ของงานทดลอง ตั้งเป็น false ไว้ก่อน** — การตัดงานทดลองออกจาก %Q
--      เป็นการตัดสินใจเชิง KPI ให้ user กดเองที่ ⚙️ ตั้งค่า (ดูหมายเหตุท้ายไฟล์)
--
--  🔄 ROLLBACK (ย้อนได้ 100% เพราะสำรอง type_id เดิมไว้ทุกแถว)
--     update downtime_logs d set downtime_type_id = b.old_type_id
--       from _reclass_dt_20260826 b where b.id = d.id;
--     update defect_logs d set defect_type_id = b.old_type_id
--       from _reclass_def_20260826 b where b.id = d.id;
--     update dr_downtime_types set is_active=false where sort_order between 71 and 79;
--     update dr_defect_types    set is_active=false where sort_order between 71 and 76;
--     -- แล้วคืน sort_order ของ "อื่นๆ" ตามตาราง _reclass_sort_20260826
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) สำรองสถานะเดิมไว้ก่อนแตะอะไรทั้งสิ้น ────────────────────────────────
create table if not exists _reclass_dt_20260826 as
  select d.id, d.downtime_type_id as old_type_id, now() as backed_up_at
  from downtime_logs d
  join dr_downtime_types ty on ty.id = d.downtime_type_id
  where ty.name_th like 'อื่นๆ%';

create table if not exists _reclass_def_20260826 as
  select d.id, d.defect_type_id as old_type_id, now() as backed_up_at
  from defect_logs d
  join dr_defect_types ty on ty.id = d.defect_type_id
  where ty.name_th = 'อื่นๆ';

create table if not exists _reclass_sort_20260826 as
  select 'downtime' as src, id, name_th, sort_order from dr_downtime_types
  where name_th like 'อื่นๆ%'
  union all
  select 'defect', id, name_th, sort_order from dr_defect_types where name_th = 'อื่นๆ';

-- ═══ 1) ประเภท DOWNTIME ใหม่ 9 ตัว ════════════════════════════════════════
--  six_big_loss / waste_type ตั้งให้ "เข้าชุดกับประเภทที่มีอยู่แล้ว" ไม่ได้คิดเอง:
--    รอพาเลท/ภาชนะ      ← ตามแบบ "รอภาชนะ"        (minor_stop / waiting)
--    Alarm              ← ตามแบบ "Robot (Alarm/Error)" (breakdown / waiting)
--    รอกระบวนการก่อนหน้า ← ตามแบบ "รอชิ้นงาน (HDF, Laser)" (minor_stop / waiting)
--    เคาะเศษ            ← minor_stop / extra_processing (งานที่ไม่ควรต้องทำ)
--    โรบอท/จิ๊กวางไม่ลง  ← minor_stop / extra_processing (operator เคลียร์เองได้)
--    แก้ไขคุณภาพ        ← defect / defect (ตามแบบประเภทของเสีย)
--  ⚠️ ปรับได้เองที่ Daily Report → ⚙️ ตั้งค่า → ประเภท Downtime (ไม่ต้องแก้โค้ด)
-- ⚠️ ตารางไม่มี unique constraint บน name_th → ต้องกันซ้ำด้วย NOT EXISTS เอง
--    (`on conflict do nothing` เฉยๆ จะไม่กันอะไรเลย รันซ้ำ = ได้ประเภทซ้ำ)
insert into dr_downtime_types
  (name_th, category, process_type, six_big_loss, waste_type, color, sort_order, is_active)
select v.* from (values
  ('รอพาเลท / ภาชนะเต็มราง (ในแผน)',  'planned',   'common', 'minor_stop', 'waiting',          '#f59e0b', 71, true),
  ('รอพาเลท / ภาชนะเต็มราง (นอกแผน)', 'unplanned', 'common', 'minor_stop', 'waiting',          '#f59e0b', 72, true),
  ('เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)', 'unplanned', 'common', 'breakdown', 'waiting',    '#ef4444', 73, true),
  ('รอกระบวนการก่อนหน้า (ในแผน)',    'planned',   'common', 'minor_stop', 'waiting',          '#f59e0b', 74, true),
  ('รอกระบวนการก่อนหน้า (นอกแผน)',   'unplanned', 'common', 'minor_stop', 'waiting',          '#ef4444', 75, true),
  ('เคาะเศษ / ทำความสะอาดสต๊อปเปอร์', 'planned',   'common', 'minor_stop', 'extra_processing', '#f59e0b', 76, true),
  ('โรบอท/จิ๊ก วางงานไม่ลง (ในแผน)',  'planned',   'common', 'minor_stop', 'extra_processing', '#f59e0b', 77, true),
  ('โรบอท/จิ๊ก วางงานไม่ลง (นอกแผน)', 'unplanned', 'common', 'minor_stop', 'extra_processing', '#ef4444', 78, true),
  ('แก้ไขคุณภาพระหว่างผลิต',          'unplanned', 'common', 'defect',     'defect',           '#ef4444', 79, true)
) as v(name_th, category, process_type, six_big_loss, waste_type, color, sort_order, is_active)
where not exists (select 1 from dr_downtime_types t where t.name_th = v.name_th);

-- ── 2) จัดประเภทให้บันทึกเดิม (คงหมวด ในแผน/นอกแผน เดิมเสมอ) ───────────────
--  ⚠️ ลำดับใน CASE = ลำดับความสำคัญ ห้ามสลับ (ตรงกับ dry-run ที่ตรวจแล้ว)
with c as (
  select d.id, ty.category as cat,
    case
      when lower(trim(d.description)) ~ 'พาเล|พ่เล|พาลท|ราพาเลท|rkg'                            then 'A'
      when lower(trim(d.description)) ~ 'อาราม|อราม|alarm'                                       then 'B'
      when lower(trim(d.description)) ~ 'hdf|เบนดิ่ง|เบนดิ้ง|bending|assy|เลเซอร์|laser|store|material|วัตถุดิบ' then 'C'
      when lower(trim(d.description)) ~ 'scrap|สแค|สแป|stopper|สต็อป|สต๊อป|เศษ'                  then 'D'
      when lower(trim(d.description)) ~ 'จิ๊ก|จิก|jig|rb[ _-]?[0-9]'                             then 'E'
      when lower(trim(d.description)) ~ 'คุณภาพ|reject|รีเจ|ปรับรู'                              then 'F'
    end as k
  from downtime_logs d
  join dr_downtime_types ty on ty.id = d.downtime_type_id
  where ty.name_th like 'อื่นๆ%' and coalesce(trim(d.description),'') <> ''
),
map(k, cat, new_name) as (values
  ('A','planned',  'รอพาเลท / ภาชนะเต็มราง (ในแผน)'),
  ('A','unplanned','รอพาเลท / ภาชนะเต็มราง (นอกแผน)'),
  ('B','unplanned','เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)'),
  ('C','planned',  'รอกระบวนการก่อนหน้า (ในแผน)'),
  ('C','unplanned','รอกระบวนการก่อนหน้า (นอกแผน)'),
  ('D','planned',  'เคาะเศษ / ทำความสะอาดสต๊อปเปอร์'),
  ('E','planned',  'โรบอท/จิ๊ก วางงานไม่ลง (ในแผน)'),
  ('E','unplanned','โรบอท/จิ๊ก วางงานไม่ลง (นอกแผน)'),
  ('F','unplanned','แก้ไขคุณภาพระหว่างผลิต')
  -- ⚠️ คู่ที่ "ไม่มี" ในตารางนี้ = จงใจไม่ย้าย เพราะขัดกับความหมาย เช่น
  --    (B,planned) Alarm ในแผน · (D,unplanned) เคาะเศษนอกแผน · (F,planned)
  --    → คงไว้ที่ "อื่นๆ" ตามเดิม ดีกว่าสร้างประเภทที่อ่านแล้วขัดกัน
)
update downtime_logs d
   set downtime_type_id = nt.id
  from c
  join map m  on m.k = c.k and m.cat = c.cat
  join dr_downtime_types nt on nt.name_th = m.new_name
 where d.id = c.id;

-- ═══ 3) ประเภท DEFECT ใหม่ 6 ตัว ══════════════════════════════════════════
insert into dr_defect_types
  (name_th, process_type, six_big_loss, waste_type, excl_from_q, color, sort_order, is_active)
select v.* from (values
  -- ⚠️ excl_from_q = false ไว้ก่อน! การตัดงานทดลองออกจาก %Q เป็นการตัดสินใจเชิง KPI
  --    user กดเปลี่ยนเองได้ที่ ⚙️ ตั้งค่า → ประเภทของเสีย (ดูหมายเหตุท้ายไฟล์)
  ('งานทดลอง / ปรับตั้งเครื่อง (Try-out)', 'common', 'startup', 'defect', false, '#a855f7', 71, true),
  ('ตัดไม่ขาด / ไม่จบ process',            'common', 'defect',  'defect', false, '#ef4444', 72, true),
  ('ขึ้นรูป / ปั๊มไม่จบ process',           'common', 'defect',  'defect', false, '#ef4444', 73, true),
  ('งานยุบ',                                'common', 'defect',  'defect', false, '#ef4444', 74, true),
  ('รู NOGO / ขนาดรูไม่ได้',                'common', 'defect',  'defect', false, '#ef4444', 75, true),
  ('มาร์คไม่ชัด / NG',                      'common', 'defect',  'defect', false, '#ef4444', 76, true)
) as v(name_th, process_type, six_big_loss, waste_type, excl_from_q, color, sort_order, is_active)
where not exists (select 1 from dr_defect_types t where t.name_th = v.name_th);

-- ── 4) จัดประเภทของเสียเดิม ───────────────────────────────────────────────
--  ⚠️ "ทดลอง|ปรับงาน" ต้องเช็คก่อน "nogo" เสมอ — ข้อความจริงมีทั้งสองคำในประโยคเดียว
--     ("ทดลอง ปรับงาน nogo 1L") ถ้าสลับลำดับ งานทดลอง 155 ชิ้นจะถูกตีเป็นรู NOGO
--  ✅ 2 กลุ่มถูกย้ายเข้า "ประเภทที่มีอยู่แล้ว" ไม่สร้างใหม่ซ้ำ (เจาะรูไม่ครบ · ย่น)
with c as (
  select d.id,
    case
      when lower(trim(d.description)) ~ 'ทดลอง|ปรับงาน'                              then 'งานทดลอง / ปรับตั้งเครื่อง (Try-out)'
      when lower(trim(d.description)) ~ 'ไม่เจาะรู|เจาะรูไม่ครบ'                       then 'เจาะรูไม่ครบ'
      when lower(trim(d.description)) ~ 'ตัด.*ไม่ขาด|ตัดไม่ขาด|ตัดไม่จบ|ตัดงานไม่จบ'   then 'ตัดไม่ขาด / ไม่จบ process'
      when lower(trim(d.description)) ~ 'ขึ้นรูปไม่จบ|ปั้มงานไม่จบ|ไม่จบโพเสษ'          then 'ขึ้นรูป / ปั๊มไม่จบ process'
      when lower(trim(d.description)) ~ 'ยุบ'                                         then 'งานยุบ'
      when lower(trim(d.description)) ~ 'nogo|out spec'                               then 'รู NOGO / ขนาดรูไม่ได้'
      when lower(trim(d.description)) ~ 'มาร์ค|mark'                                  then 'มาร์คไม่ชัด / NG'
      when lower(trim(d.description)) ~ 'ย่น'                                         then 'ย่น'
    end as new_name
  from defect_logs d
  join dr_defect_types ty on ty.id = d.defect_type_id
  where ty.name_th = 'อื่นๆ' and coalesce(trim(d.description),'') <> ''
)
update defect_logs d
   set defect_type_id = nt.id
  from c
  join dr_defect_types nt on nt.name_th = c.new_name and nt.is_active
 where d.id = c.id and c.new_name is not null;

-- ═══ 5) กันไม่ให้ "อื่นๆ" กลับมาเป็นอันดับ 1 อีก ══════════════════════════
--  เดิม "อื่นๆ (นอกแผน)" sort_order = 17 · "อื่นๆ (ในแผน)" = 24 → อยู่กลางลิสต์
--  = เลื่อนเจอก่อนตัวเลือกที่ตรงกว่า จึงถูกเลือกเพราะ "อยู่ใกล้มือ" ไม่ใช่เพราะตรง
--  ⚠️ นี่คือการแก้ที่ "ต้นทาง" — สำคัญกว่าการมาไล่จัดกลุ่มย้อนหลัง
update dr_downtime_types set sort_order = 900 + sort_order
 where name_th like 'อื่นๆ%' and sort_order < 900;   -- guard: รันซ้ำไม่บวกทบ
update dr_defect_types    set sort_order = 900 + sort_order
 where name_th = 'อื่นๆ' and sort_order < 900;

-- ═══════════════════════════════════════════════════════════════════════════
--  📌 สิ่งที่ยังต้องให้ "คน" ตัดสิน (ระบบไม่ทำให้เอง โดยตั้งใจ)
--
--  1. งานทดลอง (Try-out) 155 ชิ้น — ตอนนี้ยัง **นับเข้า %Q ตามเดิม**
--     ถ้าเห็นว่าไม่ควรนับ (ตามกฎที่บันทึกไว้ใน CLAUDE.md หัวข้อ "งานทดลอง")
--     ให้ติ๊ก `excl_from_q` ที่ ⚙️ ตั้งค่า → ประเภทของเสีย
--     → %Q จะขยับเฉพาะจอที่คำนวณสด · กะที่ปิดแล้วค่า stamp ไม่เปลี่ยน
--
--  2. 6 Big Losses / 8 Wastes ของประเภทใหม่ — ตั้งให้ตามประเภทใกล้เคียงที่มีอยู่
--     ไม่ใช่การตัดสินของระบบ · หัวหน้าเปลี่ยนเองได้ที่หน้าตั้งค่าเดียวกัน
--
--  3. Downtime ที่ยังคงอยู่ใน "อื่นๆ" (~131 รายการ / 6,144 นาที) คือของที่
--     กระจัดกระจายจริงๆ — ตรงนี้แหละที่ควรอ่านทีละอันในที่ประชุมเช้า
-- ═══════════════════════════════════════════════════════════════════════════
