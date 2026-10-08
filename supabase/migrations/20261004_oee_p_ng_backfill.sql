-- ═══ Backfill ตัวเศษ %P ของกะที่ปิดแล้ว — ของเสีย/งานทดลอง/ของสงสัย เข้า %P ═══════════════
-- DR project · ชื่อในจอ Supabase "Product DB" · id eyhclzkifitbhbljgoav
-- กฎใหม่ 2026-10-04 (คำสั่ง user "ต้องเข้าหมดเพราะใช้เครื่องลองผลิต") — ดู §%P ใน src/utils/oee.js
--
-- 🔴 ตัวเลข factor ด้านล่าง **ไม่ได้คิดใน SQL** — มาจากสูตรจริงของระบบ (computeSessionOee)
--    รันสองรอบต่อกะด้วย scripts/backfill/ngInPFactor.mjs แล้วหารกัน:
--        factor = stdMin(มีของเสียในตัวเศษ) ÷ stdMin(ไม่มี)
--    (เขียนสูตร OEE ซ้ำใน SQL = มีสูตร 2 ชุด ผิดกฎ CLAUDE.md)
--
-- 🔴 A และ Q **ไม่ถูกแตะ** — ของเสียไม่เคยอยู่ในตัวหารของ A และ Q ยังเป็นค่าที่ stamp ไว้
--    OEE ใหม่ = oee_a × oee_p(ใหม่) × oee_q เท่านั้น ⇒ ไม่มีการ "คำนวณกะใหม่ด้วย master ปัจจุบัน"
--
-- ไม่อยู่ในชุดนี้ (ตั้งใจ — ไม่แตะ):
--   · 13 กะของ Laser LWR ที่ใช้ MAT 50031625 — แถว kanban_standards กำพร้า (product_id = null)
--     => วันนี้ระบบคำนวณเวลามาตรฐานไม่ได้ => คำนวณ factor ไม่ได้ => ปล่อยค่าเดิมไว้
--     (แก้ที่ต้นเหตุคือผูก product ให้ 50031625 ก่อน แล้วค่อยรันชุดนี้ซ้ำ)
--   · กะที่ของเสียตกข้าง RH/LH ที่ยอดน้อยกว่า => ยุบคู่แล้ว shot เท่าเดิม (factor = 1)
--   · กะที่ %P ชน 100 อยู่แล้ว => least(100, ...) คงค่าเดิม
--
-- ROLLBACK:
--   update public.production_sessions s set oee_p = a.oee_p_old, oee = a.oee_old
--     from archive.oee_p_before_ng_backfill_20261004 a where a.session_id = s.id;
-- ═══════════════════════════════════════════════════════════════════════════════════════

create schema if not exists archive;
create table if not exists archive.oee_p_before_ng_backfill_20261004 (
  session_id uuid primary key,
  oee_p_old  numeric,
  oee_old    numeric,
  oee_p_new  numeric,
  oee_new    numeric,
  factor     numeric,
  saved_at   timestamptz not null default now()
);
alter table archive.oee_p_before_ng_backfill_20261004 enable row level security;

with f(s8, factor) as (values
  ('3518ef61',1.41818182),
  ('8d090e68',1.10389610),
  ('710abff4',1.09638554),
  ('252acf59',1.07333333),
  ('6b0d9810',1.04888889),
  ('cfba53ea',1.03864734),
  ('68038f37',1.03833866),
  ('7d7decb3',1.03750000),
  ('0bd264f8',1.03250000),
  ('28dc92a4',1.03142857),
  ('42be95f4',1.02857143),
  ('778c839e',1.02750000),
  ('5ea7c5c7',1.02654867),
  ('3f05b9f1',1.02448980),
  ('761cfc4f',1.02346041),
  ('c1ccdf60',1.02263374),
  ('32686481',1.02000000),
  ('bb5cf3e8',1.01980198),
  ('9017169a',1.01904762),
  ('b849882e',1.01904762),
  ('794c93ee',1.01857585),
  ('9fc28f83',1.01818182),
  ('7faa2b7e',1.01818182),
  ('ff9b834f',1.01594896),
  ('df33eb06',1.01543210),
  ('f0d065c9',1.01509434),
  ('9eb15e1c',1.01466993),
  ('fc4616f1',1.01408451),
  ('637db242',1.01400000),
  ('f1d6d398',1.01363636),
  ('20707c1d',1.01250000),
  ('75935ae4',1.01190476),
  ('2727ecb7',1.01149425),
  ('ab8e2c8b',1.01061008),
  ('a615385c',1.01015228),
  ('bbe84a0d',1.01000000),
  ('e8f58c22',1.00924214),
  ('526751ba',1.00895522),
  ('f23c6242',1.00882353),
  ('8cde9efd',1.00854701),
  ('db08cecf',1.00833333),
  ('90dd431a',1.00800000),
  ('9a68d1a7',1.00800000),
  ('040126ea',1.00750000),
  ('a674e214',1.00750000),
  ('b910eec9',1.00748130),
  ('48ef6280',1.00681818),
  ('bea798f2',1.00632911),
  ('785aa549',1.00600000),
  ('927e4a52',1.00600000),
  ('9af1c660',1.00600000),
  ('b2e9f454',1.00600000),
  ('bd0cc711',1.00588235),
  ('cc370f96',1.00582524),
  ('0fbbe9f3',1.00571429),
  ('0a50afec',1.00560748),
  ('4a612bbe',1.00550459),
  ('086753b9',1.00529101),
  ('d582588a',1.00500000),
  ('2f06a20d',1.00476190),
  ('3c213c80',1.00444444),
  ('7cff840e',1.00444444),
  ('21fedff4',1.00400000),
  ('49d140cc',1.00400000),
  ('69ab553b',1.00400000),
  ('69b5dbe5',1.00400000),
  ('71e5fde4',1.00400000),
  ('9975f27e',1.00400000),
  ('faef55ec',1.00400000),
  ('e046b517',1.00369004),
  ('6da92bc6',1.00364964),
  ('835bbca0',1.00363636),
  ('9bd9b1b0',1.00352113),
  ('48badd8f',1.00348432),
  ('3add0f0e',1.00338983),
  ('3727868a',1.00333333),
  ('6ad8216c',1.00316456),
  ('88f1fb17',1.00312500),
  ('4fb8c1c2',1.00285714),
  ('fd1035a3',1.00285714),
  ('c9bd301c',1.00266667),
  ('f4642b60',1.00263158),
  ('fee7c07f',1.00263158),
  ('1582d6e2',1.00250000),
  ('3919198e',1.00250000),
  ('b70f4148',1.00250000),
  ('7be5b17c',1.00250000),
  ('f4e0beda',1.00243902),
  ('c7107a75',1.00238095),
  ('1a78ce26',1.00233645),
  ('36562ee4',1.00227273),
  ('4f607db5',1.00224215),
  ('70abc848',1.00222222),
  ('51b1cfc2',1.00222222),
  ('737df941',1.00222222),
  ('76f3d658',1.00222222),
  ('6cac17ad',1.00220264),
  ('0f015eb2',1.00218818),
  ('5d60a879',1.00216450),
  ('8d93431f',1.00216450),
  ('35a47303',1.00207039),
  ('2010b4aa',1.00206612),
  ('dd830d18',1.00206612),
  ('a60d063f',1.00206186),
  ('718b09f3',1.00205761),
  ('3da018bb',1.00203252),
  ('0d3ff88f',1.00200000),
  ('200028ae',1.00200000),
  ('50ca1c83',1.00200000),
  ('598a97d7',1.00200000),
  ('762fc711',1.00200000),
  ('80c802e5',1.00200000),
  ('84179979',1.00200000),
  ('99eb3dd2',1.00200000),
  ('0a3ab4f0',1.00192308),
  ('eae2fee5',1.00191939),
  ('b1de4e64',1.00189036),
  ('6738dcd7',1.00188324),
  ('0effefd6',1.00100000),
  ('5e315fda',1.00092593)
),
m as (
  select s.id,
         s.oee_p                                  as oee_p_old,
         s.oee                                    as oee_old,
         s.oee_a, s.oee_q,
         f.factor,
         least(100, round(s.oee_p * f.factor, 2)) as oee_p_new
  from f
  join public.production_sessions s
    on left(s.id::text, 8) = f.s8
   and s.status = 'closed'
   and s.oee_p is not null
)
insert into archive.oee_p_before_ng_backfill_20261004
      (session_id, oee_p_old, oee_old, oee_p_new, oee_new, factor)
select m.id, m.oee_p_old, m.oee_old, m.oee_p_new,
       case when m.oee_a is null or m.oee_q is null then m.oee_old
            else round(m.oee_a * m.oee_p_new * m.oee_q / 10000, 2) end,
       m.factor
from m
where m.oee_p_new <> m.oee_p_old
on conflict (session_id) do nothing;

-- 🔴 ต้องเป็น **คนละคำสั่ง** กับ insert ข้างบน — เคยพลาดมาแล้วตอนรันจริง 04/10:
--    เขียนเป็น CTE `with ins as (insert ... returning) update ... where id in (select from ins)`
--    แล้ว **UPDATE ลง 0 แถวเงียบๆ** (archive ได้ครบ แต่ production_sessions ไม่ขยับ)
--    เพราะ Postgres ให้ทุก sub-statement ในคำสั่งเดียวเห็น snapshot เดียวกัน
--    ⇒ UPDATE มองไม่เห็นแถวที่ CTE เพิ่ง insert
-- เงื่อนไข `s.oee_p = a.oee_p_old` ทำให้ idempotent: รันซ้ำไม่ทบค่า
update public.production_sessions s
   set oee_p = a.oee_p_new,
       oee   = a.oee_new
  from archive.oee_p_before_ng_backfill_20261004 a
 where a.session_id = s.id
   and s.oee_p = a.oee_p_old;
