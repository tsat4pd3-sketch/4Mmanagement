-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- `line_stock_summary` เร็วขึ้น — index คลุมคอลัมน์ที่ view ใช้ (index-only scan)
-- project: DR (ชื่อในจอ Supabase "Product DB" · eyhclzkifitbhbljgoav)
-- วันที่: 2026-10-22
--
-- ปัญหา (วัดจาก log จริง 22/10 · 00:00-06:30 UTC):
--   `/rest/v1/line_stock_summary` ถูกเรียก **3,185 ครั้ง · เฉลี่ย 198 ms · รวม 631 วินาที**
--   ของเวลาฐานข้อมูล (อันดับ 5 ของทั้งระบบ) และเป็นตัวที่ timeout (57014) หลายครั้งเช้านั้น
--
--   EXPLAIN ของคิวรีจริง (ถาม 2 MAT):
--     Subquery Scan → HashAggregate → Bitmap Heap Scan on line_stock_transactions
--     rows=5113 · **Heap Blocks: exact=899** · Execution Time **620 ms**
--   ⇒ view รวมยอดจาก **ประวัติการเคลื่อนไหวทั้งหมด**ของ MAT นั้นใหม่ทุกครั้ง
--      index เดิม `lst_line_mat_idx (line_name, mat_no)` ขึ้นต้นด้วย `line_name` แต่คิวรีกรองด้วย
--      `mat_no` อย่างเดียว ⇒ ใช้ได้แค่บางส่วน แล้วต้องวิ่งไปอ่าน heap อีก 899 บล็อกเพื่อเอา
--      `status` / `type` / `qty` / `part_name`
--   🔴 **ยิ่งมีประวัติมากยิ่งช้าถาวร** — ไม่ใช่แค่ "เครื่องช้า"
--
-- ที่ทำ: index คลุมครบทุกคอลัมน์ที่ view ต้องใช้ + partial ตามเงื่อนไขของ view เอง
--   ⇒ อ่านจบใน index ไม่ต้องแตะ heap (index-only scan)
--   · `mat_no` ขึ้นก่อน เพราะคิวรีจริงกรองด้วยตัวนี้ (จอถามเป็นชุด MAT)
--   · `where status = 'approved'` = เงื่อนไขเดียวกับ view ⇒ index เล็กลงและตรงเป้า
--   · ไม่แตะ view / ไม่แตะข้อมูล / ไม่เปลี่ยนพฤติกรรมใดๆ — ถอนได้ด้วย DROP INDEX เฉยๆ
--
-- ⚠️ ตารางนี้ถูกเขียนตลอดเวลา (เบิก/คืน/ปรับยอด) ⇒ ใช้ CONCURRENTLY เพื่อไม่ล็อกการเขียน
--    ถ้า environment รัน CONCURRENTLY ไม่ได้ (อยู่ใน transaction) ให้ตัดคำว่า CONCURRENTLY ออก
--    ตารางเล็ก (~26,000 แถว · 10 MB) ล็อกจริงไม่ถึงวินาที
-- ═══════════════════════════════════════════════════════════════════════════════════════════

create index concurrently if not exists lst_summary_cover_idx
  on public.line_stock_transactions (mat_no, line_name)
  include (type, qty, part_name)
  where status = 'approved';

-- ── ตรวจผล ────────────────────────────────────────────────────────────────────────────────
-- explain (analyze, buffers, costs off)
--   select mat_no, qty_on_hand from public.line_stock_summary where mat_no = any(array['10100401']);
-- คาดหวัง: Index Only Scan using lst_summary_cover_idx · Heap Fetches ต่ำ · เวลาลดจาก ~620 ms
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────────────────────
-- drop index concurrently if exists public.lst_summary_cover_idx;
