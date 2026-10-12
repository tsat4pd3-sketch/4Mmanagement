-- ════════════════════════════════════════════════════════════════════════════
-- v_store_abnormal — เติมคอลัมน์ตัวเลข qty_on_hand / min_qty / max_qty ท้ายวิว (2026-10-12)
-- Project: DR — ชื่อในจอ Supabase "Product DB" (eyhclzkifitbhbljgoav)
--
-- ที่มา: จอ TV สโตร์ (/tv?dept=store) ต้องบอก "เหลือเท่าไหร่ / Min เท่าไหร่" บนการ์ดพาร์ท
--   เดิมวิวคืนแค่ประโยค `detail` (docs/modules/demand-flow-tower.md §audit การ์ดมอนิเตอร์สต๊อก
--   ระบุว่าต้องเพิ่มคอลัมน์ในวิว · user สั่ง 12/10 "บอก ... จำนวน")
-- ⚠️ เงื่อนไขตรวจ 5 เคส **ไม่เปลี่ยนแม้แต่บรรทัดเดียว** — เติมแค่ 3 คอลัมน์ท้าย (append = backward compatible)
--   เคส A/B มีค่า · เคส C/D/E = null (ไม่ใช่ระดับพาร์ท-สต็อก)
-- Rollback: รัน def เดิมใน 20260825_store_abnormal_group_purchases.sql — แต่ create or replace
--   ลบคอลัมน์ไม่ได้ ⇒ ต้อง `drop view v_store_abnormal;` แล้ว create ใหม่ (คืน grant ด้วย)
-- ════════════════════════════════════════════════════════════════════════════
create or replace view public.v_store_abnormal as
 WITH wd AS (
         SELECT
                CASE
                    WHEN EXTRACT(hour FROM (now() AT TIME ZONE 'Asia/Bangkok'::text)) < 8::numeric THEN (now() AT TIME ZONE 'Asia/Bangkok'::text)::date - 1
                    ELSE (now() AT TIME ZONE 'Asia/Bangkok'::text)::date
                END AS work_date,
            ((EXTRACT(hour FROM (now() AT TIME ZONE 'Asia/Bangkok'::text)) * 60::numeric + EXTRACT(minute FROM (now() AT TIME ZONE 'Asia/Bangkok'::text)))::integer - 480 + 1440) % 1440 AS now_frame_min
        ), stock_mat AS (
         SELECT s.mat_no,
            sum(COALESCE(s.qty_on_hand, 0::numeric)) AS qty,
            max(s.part_name) AS part_name,
            string_agg((s.line_name || ' '::text) || round(COALESCE(s.qty_on_hand, 0::numeric)), ' · '::text ORDER BY (COALESCE(s.qty_on_hand, 0::numeric)) DESC) AS breakdown
           FROM line_stock_summary s
          GROUP BY s.mat_no
        ), ab AS (
         SELECT
                CASE
                    WHEN m.qty < k.min_qty::numeric THEN 'shortage'::text
                    ELSE 'over'::text
                END AS kind,
                CASE
                    WHEN m.qty < k.min_qty::numeric THEN 'A'::text
                    ELSE 'B'::text
                END AS code,
                CASE
                    WHEN m.qty < k.min_qty::numeric THEN 'ต่ำกว่า Min'::text
                    ELSE 'เกิน Max (ล้น)'::text
                END AS title,
            NULL::text AS line_name,
            m.mat_no,
            COALESCE(m.part_name, k.part_name) AS part_name,
                CASE
                    WHEN m.qty < k.min_qty::numeric THEN ((((('คงเหลือรวมทุกคลัง '::text || round(m.qty)) || ' < Min '::text) || round(k.min_qty::double precision)) || ' — ต้องเติมก่อนขาด ('::text) || m.breakdown) || ')'::text
                    ELSE ((((('คงเหลือรวมทุกคลัง '::text || round(m.qty)) || ' > Max '::text) || round(k.max_qty::double precision)) || ' — จ่ายเกิน/สั่งเกิน ('::text) || m.breakdown) || ')'::text
                END AS detail,
                CASE
                    WHEN m.qty <= 0::numeric THEN 3
                    WHEN m.qty < k.min_qty::numeric THEN 2
                    ELSE 1
                END AS sev,
            m.qty::numeric AS qty_on_hand,
            k.min_qty::numeric AS min_qty,
            k.max_qty::numeric AS max_qty
           FROM stock_mat m
             JOIN kanban_standards k ON k.mat_no = m.mat_no AND k.is_active
          WHERE k.min_qty > 0 AND m.qty < k.min_qty::numeric OR k.max_qty > 0 AND m.qty > k.max_qty::numeric
        ), c AS (
         SELECT 'shortage'::text AS kind,
            'C'::text AS code,
            'รอบส่งเลยเวลา'::text AS title,
            r.line_name,
            NULL::text AS mat_no,
            (('รอบ '::text || r.round_no) || ' · '::text) || r.shift AS part_name,
            ('กำหนดส่ง '::text || r.delivery_time) || ' ผ่านมาแล้วยังไม่ยืนยันส่ง'::text AS detail,
            3 AS sev
           FROM kanban_delivery_rounds r,
            wd
          WHERE r.is_active AND r.delivery_time IS NOT NULL AND wd.now_frame_min > ((EXTRACT(hour FROM r.delivery_time) * 60::numeric + EXTRACT(minute FROM r.delivery_time))::integer +
                CASE
                    WHEN EXTRACT(hour FROM r.delivery_time) < 8::numeric THEN 1440
                    ELSE 0
                END - 480 + COALESCE(NULLIF(r.points_count, 0), 1) * COALESCE(NULLIF(r.time_per_point_min, 0), 10)) AND NOT (EXISTS ( SELECT 1
                   FROM kanban_deliveries d
                  WHERE d.work_date = wd.work_date AND d.line_name = r.line_name AND d.shift = r.shift AND d.round_no = r.round_no AND d.confirmed_at IS NOT NULL))
        ), d AS (
         SELECT 'shortage'::text AS kind,
            'D'::text AS code,
            'รับไม่ครบ'::text AS title,
            k.line_name,
            NULL::text AS mat_no,
            (('รอบ '::text || k.round_no) || ' · '::text) || k.shift AS part_name,
            'ไลน์ยืนยัน "รับไม่ครบ" — ของขาดที่ไลน์'::text AS detail,
            2 AS sev
           FROM kanban_deliveries k,
            wd
          WHERE k.work_date = wd.work_date AND k.received_status = 'partial'::text
        ), e AS (
         SELECT 'shortage'::text AS kind,
            'E'::text AS code,
            'สั่งซื้อค้าง (ยังไม่รับ)'::text AS title,
            p.dest_line AS line_name,
            p.mat_no,
            max(p.part_name) AS part_name,
            (((((((
                CASE
                    WHEN p.status = 'ordered'::text THEN 'สั่งแล้ว'::text
                    ELSE 'รอสั่ง'::text
                END || ' '::text) || count(*)) || ' ใบ · รวม '::text) || round(sum(p.qty))) || ' ชิ้น'::text) || ' · ค้างตั้งแต่ '::text) || min(COALESCE(p.work_date, p.created_at::date))::text) || COALESCE(' · '::text || max(p.supplier), ''::text) AS detail,
            2 AS sev
           FROM purchase_requests p,
            wd
          WHERE (p.status = ANY (ARRAY['pending'::text, 'ordered'::text])) AND COALESCE(p.work_date, p.created_at::date) < wd.work_date
          GROUP BY p.dest_line, p.mat_no, p.status
        )
 SELECT ab.kind, ab.code, ab.title, ab.line_name, ab.mat_no, ab.part_name, ab.detail, ab.sev,
        ab.qty_on_hand, ab.min_qty, ab.max_qty
   FROM ab
UNION ALL
 SELECT c.kind, c.code, c.title, c.line_name, c.mat_no, c.part_name, c.detail, c.sev,
        NULL::numeric, NULL::numeric, NULL::numeric
   FROM c
UNION ALL
 SELECT d.kind, d.code, d.title, d.line_name, d.mat_no, d.part_name, d.detail, d.sev,
        NULL::numeric, NULL::numeric, NULL::numeric
   FROM d
UNION ALL
 SELECT e.kind, e.code, e.title, e.line_name, e.mat_no, e.part_name, e.detail, e.sev,
        NULL::numeric, NULL::numeric, NULL::numeric
   FROM e;

-- ตรวจผล (Product DB):
-- select code, count(*), count(qty_on_hand), count(min_qty) from v_store_abnormal group by code order by code;
