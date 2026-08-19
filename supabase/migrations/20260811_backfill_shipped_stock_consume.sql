-- ═══════════════════════════════════════════════════════════════════════════
-- เก็บตกการตัดสต็อกของรอบส่งที่ "กดส่งแล้ว" แต่ยอดคลังไม่เคยลด  (DR project)
--
-- ที่มา: โค้ดตัดสต็อกเดิมห่อด้วย `if (entry?.total > 0)` โดยไม่มี else — หาสต็อกไม่เจอ
-- ก็ไม่หักอะไรเลยแล้วขึ้น "ส่งแล้ว" เขียวปกติ (แก้ที่ CustomerDemand แล้ว 2026-08-11)
-- ผลคือมีรอบที่ของออกจากโรงงานจริงแต่ยอดคงเหลือค้างสูงเกินจริง และปุ่มแก้ไม่ได้แล้ว
-- เพราะสถานะเป็น shipped ไปแล้ว กดซ้ำไม่ได้ → ต้องเก็บตกด้วย migration ครั้งเดียว
--
-- ⚠️ ROLLBACK (ย้อนได้ตรงแถว ไม่แตะของเดิม):
--   delete from line_stock_transactions where created_by = 'backfill:shipped-20260811';
--   update line_stock_transactions set ref_shipment_id = null
--    where type='consume' and created_by <> 'backfill:shipped-20260811'
--      and created_at < '2026-08-11';   -- คืนสถานะ ref ของ 7 แถวเก่า (ส่วนที่ 1)
--
-- idempotent: รันซ้ำไม่หักซ้ำ (กันด้วย ref_shipment_id ที่ผูกใบไปแล้ว)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ส่วนที่ 1 · ผูกแถวที่ "เคยหักไปแล้ว" กลับเข้าใบรอบส่ง ────────────────────
-- 7 แถวจาก ก.ค. หักถูกต้องแล้วแต่เกิดก่อนมีคอลัมน์ ref_shipment_id
-- note ถูกเขียนโดยโค้ดตัวเดียวกันในรูปแบบคงที่ 'ส่งลูกค้า <cust> · <date> <time> · PO <no>'
-- → parse กลับได้แบบ deterministic (ตรวจแล้ว: จับคู่ได้ 1 ใบพอดีทุกแถว จำนวนตรงกันทุกใบ)
-- **ต้องทำก่อนส่วนที่ 2** ไม่งั้นส่วนที่ 2 จะมองว่าใบพวกนี้ยังไม่ถูกหัก แล้วหักซ้ำ
with m as (
  select c.id cid, min(o.id) oid, count(*) n
  from line_stock_transactions c
  join customer_shipping_orders o
    on o.order_no = substring(c.note from 'PO (\S+)$')
   and o.due_date = substring(c.note from '· (\d{4}-\d{2}-\d{2}) ')::date
   and o.ship_time::text like substring(c.note from '· \d{4}-\d{2}-\d{2} (\d{2}:\d{2})') || '%'
   and o.mat_no  = c.mat_no
   and o.qty     = c.qty
  where c.type = 'consume' and c.ref_shipment_id is null
  group by c.id
)
update line_stock_transactions t
   set ref_shipment_id = m.oid
  from m
 where m.cid = t.id
   and m.n = 1;   -- จับคู่ได้ใบเดียวเท่านั้น · กำกวม = ปล่อยไว้ ไม่เดา

-- ── ส่วนที่ 2 · กันเคสที่จัดสรรข้ามคลังไม่ได้ ────────────────────────────────
-- ตัวจัดสรรด้านล่างคิดยอดรวมต่อ mat แล้วลงที่คลังเดียว — ถ้า mat ไหนมีของกระจาย
-- หลายคลังจะจัดสรรผิด (ข้อมูลจริงตอนเขียน: FG อยู่ 'FG WAREHOUSE' ที่เดียวทั้งหมด)
-- เจอเมื่อไหร่ให้หยุด แล้วมาเขียนตัวจัดสรรข้ามคลังก่อน — ห้ามปล่อยผ่านเงียบ
do $$
declare bad text;
begin
  select string_agg(mat_no, ', ') into bad
  from (select mat_no from line_stock_summary
        where qty_on_hand > 0 group by mat_no having count(distinct line_name) > 1) x;
  if bad is not null then
    raise exception 'MAT ที่มีสต็อกหลายคลัง ยังจัดสรรไม่ได้: %', bad;
  end if;
end $$;

-- ── ส่วนที่ 3 · ลงรายการตัดสต็อกย้อนหลัง ────────────────────────────────────
-- กติกา (ตรงกับ pickStockMat ใน src/utils/matResolve.js):
--   ของอยู่ใต้เลขบน order → ใช้เลขนั้น · ไม่งั้น map p_no แบบชัดตัวเดียวและปลายทางเป็นเลขล้วน
--   · ไม่งั้นถ้าเป็นเลข SAP ใช้เลขนั้น · กำกวม/เลขปลอม/ไม่มี map = ข้าม (ห้ามเดา)
-- จัดสรรตามลำดับวันส่ง (ของที่ส่งก่อนได้หักก่อน) และ **ห้ามทำให้ยอดติดลบ**
-- ใบที่ของไม่พอจะถูกหักเท่าที่มี ส่วนที่เหลือปล่อยไว้ให้ไปเจอตอนตรวจนับจริง
with pn as (
  select upper(regexp_replace(p_no, '[^A-Za-z0-9]', '', 'g')) k, mat_no
    from dr_products where p_no is not null and p_no <> ''
  union
  select upper(regexp_replace(p_no, '[^A-Za-z0-9]', '', 'g')), mat_no
    from kanban_standards where p_no is not null and p_no <> ''
),
agg as (select k, count(distinct mat_no) n, min(mat_no) one from pn group by k),
stk as (
  select mat_no, min(line_name) line_name, sum(qty_on_hand) oh
    from line_stock_summary group by mat_no having sum(qty_on_hand) > 0
),
tgt as (
  select o.id, o.qty, o.part_name, o.customer, o.due_date, o.ship_time, o.order_no,
         case when exists (select 1 from stk where stk.mat_no = o.mat_no) then o.mat_no
              when a.n = 1 and a.one ~ '^[0-9]+$'                        then a.one
              when o.mat_no ~ '^[0-9]+$'                                 then o.mat_no
         end as key
    from customer_shipping_orders o
    left join agg a
      on a.k = upper(regexp_replace(o.mat_no, '[^A-Za-z0-9]', '', 'g'))
   where o.status = 'shipped'
     and not exists (            -- กันหักซ้ำ (รวมของที่ผูกไปในส่วนที่ 1)
           select 1 from line_stock_transactions c
            where c.ref_shipment_id = o.id and c.type = 'consume')
),
ranked as (
  select t.*, s.line_name, s.oh,
         sum(t.qty) over (partition by t.key
                          order by t.due_date, t.ship_time nulls last, t.id) as cum
    from tgt t
    join stk s on s.mat_no = t.key
   where t.key is not null
),
alloc as (
  -- ยอดที่หักได้จริงของใบนี้ = ส่วนที่ยังเหลือในคลังหลังหักใบก่อนหน้า (clamp 0..qty)
  select *, least(qty, greatest(oh - (cum - qty), 0))::numeric as cut from ranked
)
insert into line_stock_transactions
       (line_name, mat_no, part_name, qty, type, work_date, note, created_by, status, ref_shipment_id)
select a.line_name, a.key, a.part_name, a.cut, 'consume', a.due_date,
       'เก็บตกย้อนหลัง · ส่งลูกค้า ' || coalesce(a.customer, '') ||
       ' · ' || a.due_date || ' ' || coalesce(a.ship_time::text, '') ||
       coalesce(' · PO ' || a.order_no, '') ||
       ' · ระบบไม่ได้หักตอนกดส่ง (บั๊กเงียบ แก้ 2026-08-11)',
       'backfill:shipped-20260811', 'approved', a.id
  from alloc a
 where a.cut > 0;
