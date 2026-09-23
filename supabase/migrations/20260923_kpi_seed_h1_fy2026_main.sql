-- ═══ 📊 Seed KPI H1 FY2026 · PD3–HDF · PD4–Assy2 · PD4–JIG Maintenance · Main (ewhdfqwfwofivojtsizn) ═══
-- 2026-09-23 · คำสั่ง user: "ในนี้มี KPI เรา PD3 PD4 JIGMTN ตั้งแต่ต้นปี เอาไป seed ให้ที"
--
-- ที่มา (ไฟล์เดียว ไม่มีการเดา):
--   `KPI Management Review H1 FY2026 v11.pptx` (15 สไลด์ · TSAT Branch 1 / Plant 4)
--     · สไลด์ 4 / 8 / 12  = KPI Scorecard  → นิยาม + Commitment + Target  (43 แถว)
--     · สไลด์ 5 / 9 / 13  = Internal Process Trend → ค่ารายเดือน Jan–Jun (JIG ถึง May) (87 ช่อง)
--   สรุปเนื้อเด็คถอดไว้แล้วที่ docs/OBEYA-KPI-SOURCES.md §12 — ไฟล์นี้คือการเอาลงฐานจริง
--
-- ✅ ตรวจแล้วทุกชุด: ค่ารายเดือนที่อ่านจากกราฟ รวมกลับได้ตรงกับ YTD ที่เด็คพิมพ์ไว้เองทั้ง 13 เส้น
--    เช่น PD3 OEE avg(84.51·82.7·86.34·85.08·81.8·82.34) = 83.795 → เด็คเขียน 83.8 ✔
--         PD3 Scrap Σ = 1,628.5 พันบาท → เด็คเขียน ฿1,628K ✔ · JIG MTBF avg = 341.018 → 341.0 ✔
--
-- 🔴 สิ่งที่ **ไม่** seed และเหตุผล (ห้ามเติมเองโดยไม่มีที่มา):
--   1. `weight` = null ทุกแถว — เด็คไม่มีคอลัมน์น้ำหนัก (อยู่ในใบ Appraisal คนละใบ)
--      ⇒ ผลรวมยังไม่ครบ 50 ตามประกาศ QSM-R2 001/2569 · `checkStdSelection` จะ "เตือน" (ไม่บล็อก) ถูกต้องแล้ว
--   2. KPI ที่เด็คให้แค่ตัวเลข H1 ตัวเดียว ไม่มีกราฟรายเดือน (RM · DL&OH · CSAT · Safety · Non-NC ·
--      Sales/Head · TS Academy) — **ไม่ยัดลงเดือนใดเดือนหนึ่ง** เพราะค่า H1 ไม่ใช่ค่าของเดือนนั้น
--      ⇒ นิยามถูกสร้างครบ แต่ช่องรายเดือนว่าง = จอขึ้น "ยังไม่มีข้อมูล" (ถูกตามกฎความซื่อสัตย์ของจอ)
--   3. `provider` = 'manual' ทุกแถว — ตัวเลขชุดนี้คือของที่คนสรุปมาแล้ว ไม่ใช่ของที่ระบบคำนวณ
--      (provider `auto` ยังไม่ได้ต่อสาย และห้ามให้ 2 แหล่งชนกันเงียบๆ)
--
-- ⚠️ ที่ต้องรู้ก่อนดูจอ: `summarizeMonths()` ยังไม่ถูกต่อเข้า KpiMonthly ⇒ คอลัมน์สรุปปีตอนนี้
--    เป็น "ค่าเฉลี่ยของเดือนที่กรอก" ทุกแถว · แถวที่วิธีรวมจริงไม่ใช่ average จะยังไม่ตรงกับเด็ค:
--      · Scrap / Cost Reduction (sum)  → เด็ค 1,628 แต่จอจะโชว์ 271.4  (= เฉลี่ย 6 เดือน)
--      · PPM (rate = Σdefect/Σproduce) → เด็ค 276 แต่จอจะโชว์ 287.3   (= เฉลี่ยรายเดือน)
--    วิธีรวมที่ถูกของแต่ละแถวถูกเก็บไว้แล้วใน `provider_config->>'summary'` รอจอมาอ่าน
--
-- Rollback (ปลอดภัย ลบเฉพาะของที่ไฟล์นี้ใส่):
--   delete from public.kpi_manual_entries e using public.kpi_definitions k
--     where e.kpi_id = k.id and k.year = 2026 and k.scope_value in ('PD3','PD4','JIG MTN');
--   delete from public.kpi_definitions where year = 2026 and scope_value in ('PD3','PD4','JIG MTN');
--   -- (แถว kpi_catalog ที่เพิ่มใหม่ปล่อยไว้ได้ — เป็นทะเบียนชื่อ ไม่ใช่ข้อมูลผล)

begin;

/* ── 1) ทะเบียนชื่อ KPI (`kpi_catalog`) — เติมเฉพาะชื่อที่ยังไม่มี ───────────────────────
   ของเดิม 10 แถวใช้ต่อทั้งหมด: %RM · DL+OH · Customer Satisfaction · Safety · OEE · PPM
   (`PPM` = ชื่อทะเบียนของ "Internal Quality Rate" — ชื่อทางการเก็บที่ `kpi_definitions.name`) */
insert into public.kpi_catalog (name, category, unit, direction, decimals, sort_order)
select v.name, v.category, v.unit, v.direction, v.decimals, v.sort_order
from (values
  ('Overall Cost Improvement (100P)',   'internal', '%',        'up',   2, 45),
  ('Day Sales of Inventory (DSI)',      'internal', 'วัน',      'down', 3, 55),
  ('Non NC Major (ISO External Audit)', 'internal', 'Major NC', 'down', 0, 65),
  ('Defect / Scrap Cost (COPQ)',        'internal', 'พันบาท',   'down', 1, 66),
  ('Cost Reduction',                    'internal', 'บาท',      'up',   2, 67),
  ('Machine Break Down',                'internal', '%',        'down', 2, 68),
  ('MTBF',                              'internal', 'ชม.',      'up',   2, 69),
  ('MTTR',                              'internal', 'ชม.',      'down', 3, 70),
  ('MO Closed on target',               'customer', '%',        'up',   2, 41),
  ('Internal Satisfaction',             'customer', '%',        'up',   2, 42),
  ('Annual Sale Per Head',              'learning', 'MB/Head',  'up',   2, 81),
  ('TS Academy training',               'learning', '%',        'up',   2, 82),
  ('QCC',                               'learning', '%',        'up',   2, 83),
  ('Engineering Day',                   'learning', 'Team',     'up',   0, 84)
) as v(name, category, unit, direction, decimals, sort_order)
where not exists (select 1 from public.kpi_catalog c where c.name = v.name);

/* ── 2) นิยาม KPI 43 แถว (PD3 15 · PD4 15 · JIG 13) ────────────────────────────────────
   ขอบเขต: PD3/PD4 = ส่วนงาน (org_nodes:section) · JIG MTN = แผนก — `section` ตั้งให้ตรงกับ
   ค่าที่ employees/profiles ใช้อยู่จริง ('PD3' 115 คน · 'PD4' 64 · 'JIG MTN' 7) เพื่อให้จอกรองเจอ
   `std_item_id` join ด้วย (std_unit, topic) **ไม่ใช่ seq** — ทะเบียน Production มี seq '6' ซ้ำ 2 แถว
   (Cost Reduction / DSI) join ด้วย seq จะได้แถวผิด                                          */
with d(scope_kind, scope_value, section, std_unit, seq, seq_label, category, name, std_topic, catalog_name,
       commitment, target, commit_compare, commit_value, target_compare, target_value, unit, direction, summary) as (
  values
  -- ══ PD3 – HDF (สไลด์ 4) ══
  ('section','PD3','PD3','Production',11,'1.1','financial','Raw Material Control',
     'Raw Material Control','%RM (Raw Material)',
     '-','≤68.40%', null::text, null::numeric,'<=',68.40::numeric,'%','down','average'),
  ('section','PD3','PD3','Production',12,'1.2','financial','Direct Labour & Overhead Expenses',
     'Direct Labour & Overhead Expenses','DL+OH (Direct Labor + Overhead)',
     '≤2.6148%','≤2.5364%','<=',2.6148,'<=',2.5364,'%','down','average'),
  ('section','PD3','PD3','Production',21,'2.1','customer','Customer Satisfaction',
     'Customer Satisfaction (Q&D)','Customer Satisfaction',
     '≥95%','100%','>=',95,'>=',100,'%','up','average'),
  ('section','PD3','PD3','Production',31,'3.1','internal','Safety (Serious/Absent/Minor/Fire)',
     'Safety','Safety',
     '-','0 Case',null,null,'<=',0,'Case','down','sum'),
  ('section','PD3','PD3','Production',32,'3.2','internal','Overall Cost Improvement (100P)',
     'Overall Cost Improvement (100P)','Overall Cost Improvement (100P)',
     '≥0.95%','≥1%','>=',0.95,'>=',1,'%','up','average'),
  ('section','PD3','PD3','Production',33,'3.3','internal','Day Sales of Inventory (DSI)',
     'Day Sales of Inventory (DSI)','Day Sales of Inventory (DSI)',
     '≤0.351 Day','≤0.324 Day','<=',0.351,'<=',0.324,'วัน','down','average'),
  ('section','PD3','PD3','Production',34,'3.4','internal','Internal Quality Rate (Internal defect)',
     'Internal Quality Rate','PPM',
     '≤350 PPM','≤300 PPM','<=',350,'<=',300,'PPM','down','rate'),
  ('section','PD3','PD3','Production',35,'3.5','internal','Overall Equipment Effectiveness (OEE)',
     'OEE','OEE',
     '≥83%','≥85%','>=',83,'>=',85,'%','up','average'),
  ('section','PD3','PD3','Production',36,'3.6','internal','Non NC Major (ISO External Audit)',
     null,'Non NC Major (ISO External Audit)',
     '-','0 NC major',null,null,'<=',0,'Major NC','down','sum'),
  -- 3.7 เด็คเขียน commitment ≤฿105.1K/เดือน กับ target ≤฿631K ทั้ง H1 = **บาร์เดียวกัน** คนละหน่วยเวลา
  --     (631 ÷ 6 = 105.2) ⇒ ตั้ง target รายเดือนตัวเดียว ไม่แต่ง commitment ปลอมให้เกิดขั้น 0.5
  ('section','PD3','PD3','Production',37,'3.7','internal','Defect / Scrap Cost (COPQ) — SAR',
     null,'Defect / Scrap Cost (COPQ)',
     '≤฿105.1K / month','≤฿631K (H1) · −25%',null,null,'<=',105.1,'พันบาท/เดือน','down','sum'),
  -- 3.8 เด็คเขียนเป้าว่า "Monitor / increase" = ไม่มีบาร์ตัวเลข ⇒ ปล่อยว่าง จอจะขึ้นเทา "ยังไม่ได้ตั้งเป้า"
  ('section','PD3','PD3','Production',38,'3.8','internal','Cost Reduction (additional)',
     'Cost Reduction','Cost Reduction',
     '-','Monitor / increase',null,null,null,null,'พันบาท','up','sum'),
  ('section','PD3','PD3','Production',41,'4.1','learning','Annual Sales Per Head',
     'Annual Sale Per Head','Annual Sale Per Head',
     '≥5.489 MB/Head','≥5.654 MB/Head','>=',5.489,'>=',5.654,'MB/Head','up','max'),
  ('section','PD3','PD3','Production',42,'4.2','learning','TS Academy training',
     'TS Academy training','TS Academy training',
     '≥80%','≥90%','>=',80,'>=',90,'%','up','max'),
  ('section','PD3','PD3','Production',43,'4.3','learning','QCC',
     'QCC','QCC',
     '-','≥30% / plant',null,null,'>=',30,'%','up','max'),
  ('section','PD3','PD3','Production',44,'4.4','learning','Engineering Day',
     'Engineering Day','Engineering Day',
     '-','1 Team per Plant',null,null,'>=',1,'Team','up','max'),

  -- ══ PD4 – Assy2 (สไลด์ 8) ══
  ('section','PD4','PD4','Production',11,'1.1','financial','Raw Material Control',
     'Raw Material Control','%RM (Raw Material)',
     '-','≤68.40%',null,null,'<=',68.40,'%','down','average'),
  ('section','PD4','PD4','Production',12,'1.2','financial','Direct Labour & Overhead Expenses',
     'Direct Labour & Overhead Expenses','DL+OH (Direct Labor + Overhead)',
     '≤1.3445%','≤1.3042%','<=',1.3445,'<=',1.3042,'%','down','average'),
  ('section','PD4','PD4','Production',21,'2.1','customer','Customer Satisfaction',
     'Customer Satisfaction (Q&D)','Customer Satisfaction',
     '≥95%','100%','>=',95,'>=',100,'%','up','average'),
  ('section','PD4','PD4','Production',31,'3.1','internal','Safety (Serious/Absent/Minor/Fire)',
     'Safety','Safety',
     '-','0 Case',null,null,'<=',0,'Case','down','sum'),
  ('section','PD4','PD4','Production',32,'3.2','internal','Overall Cost Improvement (100P)',
     'Overall Cost Improvement (100P)','Overall Cost Improvement (100P)',
     '≥0.95%','≥1%','>=',0.95,'>=',1,'%','up','average'),
  ('section','PD4','PD4','Production',33,'3.3','internal','Day Sales of Inventory (DSI) — GOR&LWR+Bending laser',
     'Day Sales of Inventory (DSI)','Day Sales of Inventory (DSI)',
     '≤0.053 Day','≤0.049 Day','<=',0.053,'<=',0.049,'วัน','down','average'),
  ('section','PD4','PD4','Production',34,'3.4','internal','Internal Quality Rate (Internal defect)',
     'Internal Quality Rate','PPM',
     '≤350 PPM','≤300 PPM','<=',350,'<=',300,'PPM','down','rate'),
  ('section','PD4','PD4','Production',35,'3.5','internal','Overall Equipment Effectiveness (OEE)',
     'OEE','OEE',
     '≥80%','≥85%','>=',80,'>=',85,'%','up','average'),
  ('section','PD4','PD4','Production',36,'3.6','internal','Non NC Major (ISO External Audit)',
     null,'Non NC Major (ISO External Audit)',
     '-','0 NC major',null,null,'<=',0,'Major NC','down','sum'),
  ('section','PD4','PD4','Production',37,'3.7','internal','Defect / Scrap Cost (COPQ) — SAR',
     null,'Defect / Scrap Cost (COPQ)',
     '≤฿38.1K / month','≤฿229K (H1) · −25%',null,null,'<=',38.1,'พันบาท/เดือน','down','sum'),
  ('section','PD4','PD4','Production',38,'3.8','internal','Cost Reduction (additional)',
     'Cost Reduction','Cost Reduction',
     '-','Monitor / increase',null,null,null,null,'พันบาท','up','sum'),
  ('section','PD4','PD4','Production',41,'4.1','learning','Annual Sales Per Head',
     'Annual Sale Per Head','Annual Sale Per Head',
     '≥5.489 MB/Head','≥5.654 MB/Head','>=',5.489,'>=',5.654,'MB/Head','up','max'),
  ('section','PD4','PD4','Production',42,'4.2','learning','TS Academy training',
     'TS Academy training','TS Academy training',
     '≥80%','≥90%','>=',80,'>=',90,'%','up','max'),
  ('section','PD4','PD4','Production',43,'4.3','learning','QCC',
     'QCC','QCC',
     '-','≥30% / plant',null,null,'>=',30,'%','up','max'),
  ('section','PD4','PD4','Production',44,'4.4','learning','Engineering Day',
     'Engineering Day','Engineering Day',
     '-','1 Team per Plant',null,null,'>=',1,'Team','up','max'),

  -- ══ PD4 – JIG Maintenance (สไลด์ 12) ══
  -- ⚠️ 3.3/3.4 ใบนี้ **Commitment เข้มกว่า Target** (MTBF ≥200 vs ≥180 · MTTR ≤0.2 vs ≤0.3)
  --    ไม่ใช่ความผิดพลาดตอน seed — ตัดสินอ่าน "ป้ายของบาร์" ไม่ใช่ความเข้ม (ประกาศ QSM-R2 001/2569)
  --    ⇒ ถึง Target = 1 · ตรงกับที่เด็คตัดสินว่า ✔ Achieved ทั้งคู่
  ('department','JIG MTN','JIG MTN','Maintenance',11,'1.1','financial','Direct Labour & Overhead Expenses',
     'Direct Labour & Overhead Expenses','DL+OH (Direct Labor + Overhead)',
     '≤0.2148%','≤0.2084%','<=',0.2148,'<=',0.2084,'%','down','average'),
  ('department','JIG MTN','JIG MTN','Maintenance',21,'2.1','customer','Internal Satisfaction',
     'Internal Satisfaction','Internal Satisfaction',
     '≥95%','100%','>=',95,'>=',100,'%','up','average'),
  ('department','JIG MTN','JIG MTN','Maintenance',22,'2.2','customer','MO Closed on target',
     'MO Closed on target','MO Closed on target',
     '≥95%','≥99%','>=',95,'>=',99,'%','up','average'),
  ('department','JIG MTN','JIG MTN','Maintenance',31,'3.1','internal','Safety (Serious/Absent/Minor/Fire)',
     'Safety','Safety',
     '-','0 Case',null,null,'<=',0,'Case','down','sum'),
  ('department','JIG MTN','JIG MTN','Maintenance',32,'3.2','internal','Machine Break Down',
     'Machine Break Down','Machine Break Down',
     '≤0.6%','≤0.5%','<=',0.6,'<=',0.5,'%','down','average'),
  ('department','JIG MTN','JIG MTN','Maintenance',33,'3.3','internal','Mean Time Between Failure (MTBF)',
     'Mean Time Between to Failure (MTBF)','MTBF',
     '≥200 Hr','≥180 Hr','>=',200,'>=',180,'ชม.','up','average'),
  ('department','JIG MTN','JIG MTN','Maintenance',34,'3.4','internal','Mean Time To Repair (MTTR)',
     'Mean Time To repair (MTTR)','MTTR',
     '≤0.2 Hr','≤0.3 Hr','<=',0.2,'<=',0.3,'ชม.','down','average'),
  ('department','JIG MTN','JIG MTN','Maintenance',35,'3.5','internal','Cost Reduction (JIG MTN)',
     'Cost Reduction (MTN)','Cost Reduction',
     '-','≥953,806.53 B',null,null,'>=',953806.53,'บาท','up','sum'),
  ('department','JIG MTN','JIG MTN','Maintenance',36,'3.6','internal','Non NC Major (ISO External Audit)',
     null,'Non NC Major (ISO External Audit)',
     '-','0 NC major',null,null,'<=',0,'Major NC','down','sum'),
  ('department','JIG MTN','JIG MTN','Maintenance',41,'4.1','learning','Annual Sales Per Head',
     'Annual Sale Per Head','Annual Sale Per Head',
     '≥5.489 MB/Head','≥5.654 MB/Head','>=',5.489,'>=',5.654,'MB/Head','up','max'),
  ('department','JIG MTN','JIG MTN','Maintenance',42,'4.2','learning','TS Academy training',
     'TS Academy training','TS Academy training',
     '≥80%','≥90%','>=',80,'>=',90,'%','up','max'),
  ('department','JIG MTN','JIG MTN','Maintenance',43,'4.3','learning','QCC',
     'QCC','QCC',
     '-','≥30% / plant',null,null,'>=',30,'%','up','max'),
  ('department','JIG MTN','JIG MTN','Maintenance',44,'4.4','learning','Engineering Day',
     'Engineering Day','Engineering Day',
     '-','1 Team per Plant',null,null,'>=',1,'Team','up','max')
)
insert into public.kpi_definitions
  (year, section, scope_kind, scope_value, category, seq, seq_label, name,
   commitment, target, commit_compare, commit_value, target_compare, target_value,
   unit, direction, catalog_id, std_item_id, provider, provider_config, scope_text, source, is_active)
select 2026, d.section, d.scope_kind, d.scope_value, d.category, d.seq, d.seq_label, d.name,
       d.commitment, d.target, d.commit_compare, d.commit_value, d.target_compare, d.target_value,
       d.unit, d.direction, c.id, s.id, 'manual',
       jsonb_build_object('summary', d.summary),
       'KPI Management Review H1 FY2026 v11 · KPI Scorecard',
       'manual', true
from d
left join public.kpi_catalog c on c.name = d.catalog_name
left join public.kpi_standard_items s
       on s.year = 2026 and s.std_unit = d.std_unit and s.topic = d.std_topic
where not exists (
  select 1 from public.kpi_definitions k
   where k.year = 2026 and coalesce(k.scope_value,'') = d.scope_value
);

/* ── 3) ค่ารายเดือน 87 ช่อง (สไลด์ 5 / 9 / 13) ─────────────────────────────────────────
   PD3+PD4 = Jan–Jun · JIG = Jan–May (เด็คหัวสไลด์เขียน "Jan–May 2026" เอง)
   🔴 3.2 (100P) ของ PD3 กับ PD4 เป็นเลขชุดเดียวกันจริง — เด็คหมายเหตุไว้ว่า "plant 100P (same PD3=PD4)"
      และไฟล์ pptx ใช้รูปกราฟ **ไฟล์เดียวกัน** ทั้ง 2 สไลด์ (image7.png) ⇒ ไม่ใช่การก๊อปผิด */
with m(scope_value, seq_label, month, value) as (
  values
  -- PD3 · 3.2 Cost Improvement (100P) %
  ('PD3','3.2',1,0::numeric),('PD3','3.2',2,0.23),('PD3','3.2',3,0.48),('PD3','3.2',4,0.43),('PD3','3.2',5,0.73),('PD3','3.2',6,0.90),
  -- PD3 · 3.3 DSI (วัน)
  ('PD3','3.3',1,0.662),('PD3','3.3',2,0.461),('PD3','3.3',3,0.409),('PD3','3.3',4,0.486),('PD3','3.3',5,0.367),('PD3','3.3',6,0.449),
  -- PD3 · 3.4 Internal Quality Rate (PPM)
  ('PD3','3.4',1,200),('PD3','3.4',2,262),('PD3','3.4',3,186),('PD3','3.4',4,378),('PD3','3.4',5,403),('PD3','3.4',6,295),
  -- PD3 · 3.5 OEE %
  ('PD3','3.5',1,84.51),('PD3','3.5',2,82.70),('PD3','3.5',3,86.34),('PD3','3.5',4,85.08),('PD3','3.5',5,81.80),('PD3','3.5',6,82.34),
  -- PD3 · 3.7 Defect / Scrap Cost (พันบาท)
  ('PD3','3.7',1,309.9),('PD3','3.7',2,212.9),('PD3','3.7',3,245.8),('PD3','3.7',4,194.2),('PD3','3.7',5,307.1),('PD3','3.7',6,358.6),
  -- PD3 · 3.8 Cost Reduction (พันบาท)
  ('PD3','3.8',1,0),('PD3','3.8',2,215.7),('PD3','3.8',3,442.9),('PD3','3.8',4,247.6),('PD3','3.8',5,714.3),('PD3','3.8',6,650.3),

  -- PD4 · 3.2 Cost Improvement (100P) % — ตัวเดียวกับ PD3 (ระดับ plant)
  ('PD4','3.2',1,0),('PD4','3.2',2,0.23),('PD4','3.2',3,0.48),('PD4','3.2',4,0.43),('PD4','3.2',5,0.73),('PD4','3.2',6,0.90),
  -- PD4 · 3.3 DSI (วัน)
  ('PD4','3.3',1,0.280),('PD4','3.3',2,0.190),('PD4','3.3',3,0.120),('PD4','3.3',4,0.129),('PD4','3.3',5,0.119),('PD4','3.3',6,0.128),
  -- PD4 · 3.4 Internal Quality Rate (PPM)
  ('PD4','3.4',1,501.5),('PD4','3.4',2,395.7),('PD4','3.4',3,478.1),('PD4','3.4',4,541),('PD4','3.4',5,271.1),('PD4','3.4',6,69.6),
  -- PD4 · 3.5 OEE %
  ('PD4','3.5',1,89.1),('PD4','3.5',2,86.5),('PD4','3.5',3,90.1),('PD4','3.5',4,87.3),('PD4','3.5',5,87.9),('PD4','3.5',6,86.4),
  -- PD4 · 3.7 Defect / Scrap Cost (พันบาท)
  ('PD4','3.7',1,74.5),('PD4','3.7',2,57.1),('PD4','3.7',3,101.3),('PD4','3.7',4,70.9),('PD4','3.7',5,143.5),('PD4','3.7',6,53.9),
  -- PD4 · 3.8 Cost Reduction (พันบาท)
  ('PD4','3.8',1,0),('PD4','3.8',2,0),('PD4','3.8',3,253.7),('PD4','3.8',4,151.7),('PD4','3.8',5,170.9),('PD4','3.8',6,174.3),

  -- JIG MTN · 3.2 Machine Break Down %
  ('JIG MTN','3.2',1,0.38),('JIG MTN','3.2',2,0.57),('JIG MTN','3.2',3,0.51),('JIG MTN','3.2',4,0.22),('JIG MTN','3.2',5,0.53),
  -- JIG MTN · 3.3 MTBF (ชม.)
  ('JIG MTN','3.3',1,304.53),('JIG MTN','3.3',2,311.88),('JIG MTN','3.3',3,355.04),('JIG MTN','3.3',4,379.70),('JIG MTN','3.3',5,353.94),
  -- JIG MTN · 3.4 MTTR (ชม.)
  ('JIG MTN','3.4',1,0.10),('JIG MTN','3.4',2,0.24),('JIG MTN','3.4',3,0.21),('JIG MTN','3.4',4,0.14),('JIG MTN','3.4',5,0.14)
)
insert into public.kpi_manual_entries (kpi_id, month, value, note)
select k.id, m.month, m.value, 'KPI Management Review H1 FY2026 v11 · Internal Process Trend'
from m
join public.kpi_definitions k
  on k.year = 2026 and coalesce(k.scope_value,'') = m.scope_value and k.seq_label = m.seq_label
where not exists (
  select 1 from public.kpi_manual_entries e where e.kpi_id = k.id and e.month = m.month
);

commit;
