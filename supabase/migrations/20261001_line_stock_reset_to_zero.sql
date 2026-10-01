-- ══ 🧹 ตั้งต้นยอดสต็อกหน้าไลน์/คลังใหม่ทั้งหมด (คำสั่ง user 2026-10-01) ═══════════════════
-- Target project: DR — ชื่อในจอ Supabase "Product DB" (eyhclzkifitbhbljgoav)
--
-- user: *"ระบบตายอยู่ เราจะทำให้ระบบใช้งานได้จริงก่อน · พวก stock พาร์ทในไลน์ที่ diff
--        ก็ตายหมด ไม่ใช่เลขจริง เคลียร์ยอดค้างได้"* → เลือกทางเลือก (ค) ล้างทุกแถวแล้วนับใหม่
--
-- ── ทำไมยอดถึงตาย (ไล่ก่อนล้าง ไม่ได้ล้างมั่ว) ──────────────────────────────────────
--   ยอดคงเหลือ 1,715,071 ชิ้น · จ่ายเข้าไลน์ 1,747,916 · หักใช้ผลิตแค่ 140,634 = 8%
--   ดูเหมือน backflush พัง **แต่ไม่ใช่**:
--     🔴 10 แถว = 1,336,000 ชิ้น (76%) ลงโดย ADMIN 24–26 ส.ค. note "รับของซื้อเข้าสโตร์"
--        = น็อตเชื่อม 3 ตัว (30044771/30045438/30042571) ถูกลงเป็น issue ที่ **ไลน์ผลิต 4 ไลน์**
--   ตัดออกแล้ว: จ่ายจริง 409,996 · หัก 140,634 = 34% (Line 61 หักเกินด้วยซ้ำ) ⇒ ระบบไม่ได้ตาย
--   ต้นเหตุเชิงออกแบบแก้แล้วในโค้ด → `src/utils/stockReceipt.js` + ด่าน `purchase-receipt-to-dest-line`
--
-- ── วิธีล้าง: ออก `adjust` กลับ ไม่ลบประวัติ ──────────────────────────────────────────
--   `line_stock_summary` เป็น **view** ที่ Σ จาก ledger ⇒ "ล้างยอด" = เขียนรายการสวนทาง
--   ห้าม delete แถวเดิม (ประวัติการเคลื่อนไหวจริงต้องอยู่ครบ — สอบกลับได้)
--   ⚠️ สคริปต์นี้ **ไม่ idempotent โดยธรรมชาติ** — รันซ้ำจะล้างยอดที่นับเข้ามาใหม่ด้วย
--      `where qty_on_hand <> 0` กันไว้ชั้นหนึ่ง (รันซ้ำทันทีได้ 0 แถว) แต่ห้ามรันซ้ำหลังเริ่มนับแล้ว
--
-- ผลจริงหลัง apply (ผ่าน MCP 01/10): 154 แถว · รวม −1,715,051 ชิ้น · 13 ไลน์/คลัง ⇒ เหลือ 0 ทุกแถว
-- ⚠️ ภาพยอดก่อนล้างอยู่ `archive.line_stock_before_reset_20261001` (215 แถว · RLS เปิด)

create schema if not exists archive;

create table if not exists archive.line_stock_before_reset_20261001 as
  select *, now() as snapshot_at from public.line_stock_summary;
alter table archive.line_stock_before_reset_20261001 enable row level security;

insert into public.line_stock_transactions
  (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by, reviewed_by, reviewed_at)
select s.line_name, s.mat_no, s.part_name,
       -s.qty_on_hand, 'adjust', date '2026-10-01', 'approved',
       'ตั้งต้นใหม่ 01/10 — ยอดเดิมเชื่อถือไม่ได้ (คำสั่ง user) · ยอดก่อนล้าง '
         || round(s.qty_on_hand)::text || ' ชิ้น · ภาพก่อนล้างอยู่ archive.line_stock_before_reset_20261001',
       'ระบบ · ตั้งต้นใหม่ 01/10', 'ระบบ · ตั้งต้นใหม่ 01/10', now()
from public.line_stock_summary s
where s.qty_on_hand <> 0;

-- ── ตรวจหลังรัน ──
-- select count(*) from line_stock_summary where qty_on_hand <> 0;   -- 0
-- select count(*), round(sum(qty)) from line_stock_transactions
--   where created_by = 'ระบบ · ตั้งต้นใหม่ 01/10';                  -- 154 · -1715051
-- select count(*) from archive.line_stock_before_reset_20261001;    -- 215

-- Rollback (คืนยอดเดิม — ออกรายการสวนทางอีกรอบ ห้าม delete):
--   insert into public.line_stock_transactions
--     (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by)
--   select line_name, mat_no, part_name, -qty, 'adjust', current_date, 'approved',
--          'ยกเลิกการตั้งต้นใหม่ 01/10', 'ระบบ · rollback'
--     from public.line_stock_transactions
--    where created_by = 'ระบบ · ตั้งต้นใหม่ 01/10';
