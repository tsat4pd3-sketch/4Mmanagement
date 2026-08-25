-- 🛒 สรุปคิวจัดซื้อรายพาร์ท (DR)  — สำหรับแท็บ "จัดซื้อ" ใน /heijunka
--
-- ที่มา (user 2026-08-25): "ฟีเจอร์ store ใช้งานยากมาก · ดูรก · ระบบ filter ก็ไม่ดี"
--   เปิดแท็บจัดซื้อแล้วเจอกำแพงการ์ด 300 ใบที่หน้าตาเหมือนกันเป๊ะ
--   ข้อมูลจริง 25/08: purchase_requests ที่ยังไม่ยกเลิก = 2,211 ใบ แต่เป็นแค่ ~25 พาร์ท
--     30045438 (NUT WELD M8) 900 ชิ้น × 330 ใบ · 50031601 100 × 321 ใบ · 30042570 900 × 173 ใบ
--   เพราะ `fn_explode_child_demand` ออก **1 ใบต่อ 1 ล็อต** (เพดาน MAX_LOTS=50 ต่อการปิดออเดอร์ 1 ครั้ง)
--   ยอดค้างสะสมหลักล้านชิ้น ⇒ ทุกครั้งที่ปิดใบ FG ก็เติมอีก 50 ใบ
--
-- ⚠️ ทำไมต้องเป็น "วิว" ไม่ใช่ดึงแถวดิบมา group ที่หน้า:
--   PostgREST group by ไม่ได้ → หน้าเดิมจึงดึง `limit(400)` มาแล้วรวมเอง = **ยอดรวมต่อพาร์ทไม่ใช่ยอดจริง**
--   (โชว์ยอดที่ไม่ครบให้คนเอาไปสั่งซื้อ อันตรายกว่าไม่โชว์)
--   จะดึงครบ 2,211 แถวก็ไม่ได้ — ~550 KB ต่อรอบ poll ทุก 10 นาที (งบ egress ทั้งเดือน 5 GB)
--   วิวนี้คืน ~25 แถว ≈ 4 KB → ได้ตัวเลขจริงและถูกกว่าเดิมด้วย
--
-- ⚠️ ไม่รวม cancelled (ใบยกเลิกไม่ใช่งานค้าง) · เก็บ received ไว้ให้ปุ่ม "รวมที่เสร็จแล้ว" ใช้
-- ⚠️ first_id = ใบที่เก่าที่สุดของกลุ่ม — หน้าใช้เป็นเป้าของปุ่มเลื่อนสถานะ (ทีละใบเหมือนเดิม
--    ไม่เปลี่ยน write path · การสั่งซื้อรวมยอดหลายใบพร้อมกันเป็นงานเฟสถัดไป ต้องคุยเรื่อง stock ก่อน)

create or replace view public.v_purchase_open_summary as
select
  mat_no,
  status,
  min(part_name)                                     as part_name,
  min(supplier)                                      as supplier,
  min(dest_line)                                     as dest_line,
  count(*)::int                                      as slips,
  sum(qty)::numeric                                  as total_qty,
  min(qty)::numeric                                  as min_lot,
  max(qty)::numeric                                  as max_lot,
  min(created_at)                                    as first_at,
  (array_agg(id order by created_at))[1]             as first_id,
  (array_agg(work_date order by created_at))[1]      as first_work_date
from public.purchase_requests
where status <> 'cancelled'
group by mat_no, status;

grant select on public.v_purchase_open_summary to anon, authenticated;
