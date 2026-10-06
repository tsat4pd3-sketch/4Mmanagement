-- ══ บอร์ด Monitoring ชนิด 'fg' — ค้นบอร์ดด้วย "ลูกค้า" (DR "Product DB" eyhclzkifitbhbljgoav) ══
-- 2026-10-06 · คำขอ user: "อยากให้มอนิเตอร์ได้ทุก product FG ด้วย ที่อัพจาก 862 830"
--
-- ⚠️ คอลัมน์ `monitor_boards.customer` **มีอยู่แล้ว**ตั้งแต่ `20261001_monitoring_boards_dr.sql`
--    (ตอนนั้นใส่ไว้ให้บอร์ด rack/great/vendor) — migration นี้จึง**ไม่ได้เพิ่มคอลัมน์**
--    `add column if not exists` ข้างล่างคงไว้เพื่อให้ไฟล์นี้รันเดี่ยวๆ บน DB เปล่าได้ (no-op บน DB จริง)
--
-- สิ่งที่เพิ่มจริง = **index** สำหรับบอร์ดชนิดใหม่ `fg` ซึ่งหาบอร์ดด้วยชื่อลูกค้า
--   (บอร์ดชนิดอื่นหาด้วย `board_key`/`line_name` ⇒ ไม่เคยต้องใช้ index นี้)
--
-- ที่มา: บอร์ดเดิมผูก `line_name` เพราะแถวที่ระบบเติมให้ (IN/OUT/MIN) เป็นของ "ไลน์"
--   แต่ FG ที่ลูกค้าสั่งมาทาง EDI **862 (Shipping Schedule) / 830 (Planning Schedule)**
--   เป็นของ "ลูกค้า" ⇒ บอร์ด `fg` ผูกลูกค้า และ **IN ห้ามกรองไลน์** (FG ตัวเดียวผลิตได้หลายไลน์)
--
-- วัดจริง 06/10 (ออเดอร์ที่มีวันส่งย้อนหลัง 90 วัน): FG ที่ลูกค้าสั่ง **66 พาร์ท / 8 ลูกค้า / 1,647 แถว**
--   อยู่บนบอร์ดแล้วแค่ 34 (TSPK 16 · Argen 15 · HPUDA 2 · GRBNA 1) ⇒ **ขาด 32 พาร์ท**
--   และ 2 ลูกค้าที่ออเดอร์ถี่ที่สุด**ไม่มีบอร์ดเลย** (GRBNA 717 แถว · GBL9A 650 แถว)
--
-- rollback: โค้ดเก่าไม่เคยอ่าน index นี้ ⇒ revert โค้ดก่อน แล้ว
--   drop index public.monitor_boards_customer_idx;
--   (ห้าม drop คอลัมน์ `customer` — บอร์ด rack/great/vendor ใช้อยู่)
-- ════════════════════════════════════════════════════════════════════════════════════════

alter table public.monitor_boards add column if not exists customer text;

create index if not exists monitor_boards_customer_idx
    on public.monitor_boards (customer) where customer is not null;
