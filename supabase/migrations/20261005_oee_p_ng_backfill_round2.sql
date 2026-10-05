-- ═══ รอบ 2 ของ backfill ตัวเศษ %P — 13 กะ Laser LWR ที่รอบแรกคิดไม่ได้ (2026-10-05) ═══
-- DR project · "Product DB" · eyhclzkifitbhbljgoav   (**apply แล้ว 2026-10-05**)
-- รอบแรก (20261004_oee_p_ng_backfill.sql) ข้ามกะพวกนี้เพราะ MAT 50031625 ไม่มีทะเบียน => ไม่รู้ CT
-- คืนทะเบียนประวัติแล้วใน 20261005_dr_products_restore_50031625_history.sql จึงคิด factor ได้
-- factor มาจาก scripts/backfill/ngInPFactor.mjs (computeSessionOee รัน 2 รอบ) — **ไม่ได้คิดสูตรใน SQL**
-- ROLLBACK: เหมือนรอบแรก (คืนค่าจาก archive.oee_p_before_ng_backfill_20261004)

with f(s8, factor) as (values
  ('bf102893',1.11607143),('ae1a1676',1.10869565),('a22ade8e',1.01834862),('c3caed1b',1.00840336),
  ('cefbcb18',1.00803213),('124e49bd',1.00781250),('1efb3bb8',1.00450450),('08d6624b',1.00448430),
  ('9941870b',1.00401606),('44b323b2',1.00381679),('afd59400',1.00215517),('952b89e7',1.00208333),
  ('a93f45b2',1.00202429)
),
m as (
  select s.id, s.oee_p as oee_p_old, s.oee as oee_old, s.oee_a, s.oee_q, f.factor,
         least(100, round(s.oee_p * f.factor, 2)) as oee_p_new
  from f
  join public.production_sessions s
    on left(s.id::text, 8) = f.s8 and s.status = 'closed' and s.oee_p is not null
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

-- 🔴 แยกคำสั่งเสมอ — CTE ที่ insert แล้ว update ในคำสั่งเดียวมองไม่เห็นแถวของตัวเอง (เคยพลาดรอบแรก)
-- `s.oee_p = a.oee_p_old` ทำให้ idempotent: แถวที่เขียนไปแล้วไม่ถูกทบซ้ำ
update public.production_sessions s
   set oee_p = a.oee_p_new,
       oee   = a.oee_new
  from archive.oee_p_before_ng_backfill_20261004 a
 where a.session_id = s.id
   and s.oee_p = a.oee_p_old;
