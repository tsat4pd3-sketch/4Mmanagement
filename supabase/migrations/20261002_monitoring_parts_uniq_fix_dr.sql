-- ── DR project ("Product DB" · eyhclzkifitbhbljgoav) ──
-- 🐛 แก้บั๊ก: นำเข้าไฟล์ Excel ไม่ได้ — `there is no unique or exclusion constraint
--    matching the ON CONFLICT specification` (user แจ้ง 2026-10-02 พร้อมภาพหน้าจอ)
--
-- ต้นเหตุ: `monitor_board_parts_uniq` ที่สร้างไว้ 01/10 เป็น **partial index**
--   create unique index … on monitor_board_parts (board_id, mat_no)
--     where mat_no is not null and is_active;        ← ตัว WHERE นี่แหละ
--
-- 🔴 **กฎที่ต้องจำ: คอลัมน์ที่โค้ดจะ `upsert` ต้องมี unique index แบบ "เต็ม" ห้ามเป็น partial**
--    Postgres ใช้ partial unique index กับ `ON CONFLICT (cols)` ได้ก็ต่อเมื่อคำสั่งนั้นมี WHERE
--    ที่ตรงกับ predicate ของ index ให้ inference จับคู่ได้ · แต่ PostgREST
--    (`.upsert({ onConflict: 'board_id,mat_no' })`) ส่ง WHERE แบบนั้นไม่ได้ ⇒ ล้มทุกครั้ง
--    · `monitor_cells_uniq` เป็น index เต็มอยู่แล้ว จึงไม่ล้ม — ล้มเฉพาะตารางพาร์ท
--    · บั๊กคลาสนี้ **build/lint/เทสจับไม่ได้เลย** เห็นตอนกดใช้จริงเท่านั้น
--
-- ✅ ปลอดภัยตอนรัน: `monitor_board_parts` ว่าง 0 แถว (นำเข้าล้มก่อนเขียนพาร์ทแรก)
--    ⇒ ไม่มีแถวซ้ำเดิมให้ unique index ตัวใหม่ติดขัด
--
-- ⚠️ ของจริงที่ apply ไป: สร้าง index **ตัวใหม่ชื่ออื่น** แทนการ drop-แล้ว-สร้างใหม่
--    เพราะ `DROP INDEX` ผ่าน MCP timeout ซ้ำๆ (ตรวจแล้วไม่มีล็อกค้างใน DB — เป็นที่ตัวเชื่อมต่อ)
--    `ON CONFLICT` จับคู่ด้วย **คอลัมน์ ไม่ใช่ชื่อ index** ⇒ ได้ผลเท่ากัน
--    ⇒ ตอนนี้มี unique index 2 ตัวบน (board_id, mat_no): ตัวเต็ม + ตัว partial เดิมที่ซ้ำซ้อน
--      ทั้งคู่สอดคล้องกัน (ตัวเต็มครอบคลุมตัว partial) **ไม่เป็นอันตราย** แต่เปลืองนิดหน่อย
--      📌 งานค้าง: ลบ `monitor_board_parts_uniq` ทิ้งเมื่อมีโอกาสรัน DDL ได้ปกติ
--
-- การตัด `is_active` ออกจาก predicate = **ตั้งใจ**: พาร์ทที่เคยถูกปิดใช้งาน แล้วนำเข้าไฟล์ใหม่
--   ที่มีพาร์ทนั้น ⇒ upsert ไป "ปลุก" แถวเดิมแทนที่จะสร้างซ้ำ — ถูกต้องกว่าของเดิม
-- `mat_no` ที่เป็น NULL ยังซ้ำได้หลายแถวตามเดิม (Postgres ถือว่า NULL ต่างกันเสมอ)
--   ⇒ ไม่กระทบแถวในไฟล์ที่ยังไม่มีเลข SAP
--
-- ✅ ทวนกับของจริงแล้ว: upsert ซ้ำเลข MAT เดิม → ทับแถวเดิม (part_no A→B) เหลือ 1 แถว ไม่ซ้ำ
--
-- Rollback: drop index if exists monitor_board_parts_bm_uniq;   (= กลับไปนำเข้าไม่ได้ ไม่แนะนำ)

create unique index if not exists monitor_board_parts_bm_uniq
  on public.monitor_board_parts (board_id, mat_no);

comment on index public.monitor_board_parts_bm_uniq is
  'ต้องเป็น unique index แบบเต็ม ห้ามใส่ WHERE — โค้ดนำเข้าใช้ ON CONFLICT (board_id, mat_no) ซึ่ง Postgres จับคู่กับ partial index ไม่ได้';

-- งานค้าง (รันเมื่อ DDL ทำได้ปกติ) — index เดิมที่ซ้ำซ้อน:
--   drop index if exists public.monitor_board_parts_uniq;

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
-- select indexname, indexdef from pg_indexes
--  where tablename = 'monitor_board_parts' and indexdef ilike '%UNIQUE%';
--   ⇒ ต้องเห็น monitor_board_parts_bm_uniq ที่ **ไม่มี WHERE** ต่อท้าย
