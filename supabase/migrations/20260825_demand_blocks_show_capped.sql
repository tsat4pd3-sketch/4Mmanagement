-- v_demand_flow_blocks v2 — ยอดค้างที่ "ตั้งล็อตแล้วแต่เกินเพดานออกใบ" ต้องมองเห็น (QC flow-audit #20)
-- Project: DR (eyhclzkifitbhbljgoav) · รันซ้ำได้ (create or replace view — เพิ่มคอลัมน์ต่อท้ายเท่านั้น)
--
-- ที่มา: guard MAX_LOTS=50 (migration 20260821_explode_demand_lot_guard) เขียน comment ไว้เองว่า
--   "ส่วนเกินไม่หาย ยังโผล่ใน v_demand_flow_blocks" — **ไม่จริง** เพราะวิวกรอง lot_size > 0 ทิ้ง
--   → พาร์ทที่ตั้งล็อตแล้วแต่ pending ท่วม (ทยอยออกได้รอบละ 50 ใบ) มองไม่เห็นที่ไหนเลย
-- กติกาใหม่: โชว์เมื่อ (ก) ยังไม่ตั้ง lot_size (เดิม) หรือ (ข) ตั้งแล้วแต่ pending ≥ lot_size
--   (= มียอดที่ "ควรออกใบไปแล้ว" ค้างอยู่) · pending < lot_size ที่ตั้งแล้ว = การสะสมปกติ ไม่ใช่จุดตัน
-- คอลัมน์ใหม่ block_reason: 'no_lot_size' (กดตั้งล็อตได้) · 'backlog_capped' (ห้ามให้ปุ่มตั้งล็อต —
--   จะเขียนทับค่าที่คนตั้งไว้) — ฝั่งจอ FlowTower/StoreLotQueue แยก render ตามคอลัมน์นี้แล้ว
--   (วิวเก่าไม่มีคอลัมน์ = undefined = พฤติกรรมเดิม backward-compatible)

create or replace view public.v_demand_flow_blocks as
select a.child_mat_no                                as mat_no,
       coalesce(bi.part_name, pm.part_name)          as part_name,
       round(a.pending_qty)                          as pending_qty,
       a.updated_at,
       case when a.child_mat_no like '3%' or a.child_mat_no like '5%'
            then 'purchase' else 'produce' end       as demand_kind,
       ks.qty_per_kanban                             as suggested_lot,
       (ks.mat_no is not null)                       as has_kanban_row,
       (select d.line_name from dr_products d
         where d.mat_no = a.child_mat_no and d.is_active limit 1) as maker_line,
       case when coalesce(ks.lot_size, 0) <= 0 then 'no_lot_size'
            else 'backlog_capped' end                as block_reason,
       ks.lot_size                                   as lot_size
  from child_demand_accumulator a
  left join kanban_standards ks on ks.mat_no = a.child_mat_no and ks.is_active
  left join parts_master     pm on pm.mat_no = a.child_mat_no
  left join lateral (select part_name from bom_items
                      where mat_no = a.child_mat_no and is_active limit 1) bi on true
 where a.pending_qty > 0
   and (coalesce(ks.lot_size, 0) <= 0 or a.pending_qty >= ks.lot_size);

comment on view public.v_demand_flow_blocks is
  'ความต้องการที่ค้างไม่กลายเป็นใบสั่ง — no_lot_size: ยังไม่ตั้งขนาดล็อต (worklist ให้ planner ตั้ง) · backlog_capped: ตั้งแล้วแต่ยอดเกินเพดานออกใบต่อรอบ (MAX_LOTS) รอทยอยออกใบตอนปิดใบผลิตครั้งถัดไป';

grant select on public.v_demand_flow_blocks to anon, authenticated;

-- ตรวจหลังรัน: select block_reason, count(*), sum(pending_qty) from v_demand_flow_blocks group by 1;
-- Rollback: รันส่วนวิวในไฟล์ 20260819_demand_flow_routing.sql เดิม
