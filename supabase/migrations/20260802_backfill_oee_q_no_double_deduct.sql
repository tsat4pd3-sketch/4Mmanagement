-- 20260802_backfill_oee_q_no_double_deduct.sql  (DR project: eyhclzkifitbhbljgoav)
--
-- Backfill oee_q / oee ของกะที่ปิดแล้ว ที่ถูก stamp ด้วยสูตร Q เก่า (หักของเสียซ้ำ)
--
-- กฎ Q (CLAUDE.md 2026-08-02 — user ยืนยัน): ยอดที่สแกนปิดใบงาน = "ของดี" ล้วน
--   ของเสียถูกผลิตเพิ่มต่างหากจนได้ของดีครบเป้า แล้วลง NG แยกที่ defect_logs
--   → Q = ของดี / ผลิตจริงทั้งหมด = actual_qty / (actual_qty + ng)
--   สูตรเก่า (good - ng)/good หักของเสียซ้ำ ทำ %Q ต่ำเกินจริง (เช่น ดี100 NG50 ได้ 50% ที่ถูก 66.7%)
--
-- ng นับจาก defect_logs ตรงๆ (replicate computeOEE ฝั่งแอป) — ไม่ใช้ session column qty_ng/qty_suspect
--   เพราะไม่น่าเชื่อถือ: เจอ Line 60 (2026-07-21) qty_ng=0 แต่ defect_logs มี NG 12 →
--   old oee_q = 100 (ผิด ไม่นับ NG เลย) ที่ถูกจาก defect_logs = 97.6
--
-- Idempotent: แตะเฉพาะแถวที่ค่าต่างจริง (>= 0.05) — รันซ้ำได้ไม่เปลี่ยนอะไรเพิ่ม
-- Backward-compatible: แถวไม่มีผลผลิต (actual_qty = 0) หรือ oee_a/p/q เป็น null ไม่ถูกแตะ

WITH ng AS (
  SELECT session_id,
         SUM(COALESCE(qty_ng,0) + COALESCE(qty_suspect,0))::numeric AS ng_total
  FROM defect_logs
  GROUP BY session_id
),
newq AS (
  SELECT s.id,
         ROUND(s.actual_qty::numeric / (s.actual_qty + COALESCE(n.ng_total,0)) * 100, 1) AS nq
  FROM production_sessions s
  LEFT JOIN ng n ON n.session_id = s.id
  WHERE s.status = 'closed'
    AND s.oee_q IS NOT NULL
    AND s.oee_a IS NOT NULL
    AND s.oee_p IS NOT NULL
    AND s.actual_qty > 0
)
UPDATE production_sessions s
SET oee_q = newq.nq,
    oee   = ROUND(s.oee_a::numeric * s.oee_p::numeric * newq.nq / 10000, 1)
FROM newq
WHERE s.id = newq.id
  AND ABS(newq.nq - s.oee_q) >= 0.05;
