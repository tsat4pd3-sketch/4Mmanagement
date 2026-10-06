-- ═══════════════════════════════════════════════════════════════════════════════
-- 📗 monitoring_shipments: คีย์ upsert ต้องเป็น "คอลัมน์ล้วน" (DR "Product DB" · eyhclzkifitbhbljgoav)
--    2026-10-06 · apply แล้วผ่าน MCP (migration name: monitoring_shipments_sheet_plain_uniq)
--
-- อาการจริง (user นำเข้าไฟล์ 1.Monitoring-Oct.xlsx 06/10):
--   toast แดง "บันทึกประวัติการส่งไม่สำเร็จ: there is no unique or exclusion constraint
--   matching the ON CONFLICT specification" (42P10) ⇒ **ประวัติการส่ง 804 แถวไม่ถูกบันทึกเลย**
--   และเพราะชั้น ① ② ลบของรอบก่อนไปแล้ว ⇒ นำเข้าค้างกลางคัน ต้องกดยืนยันใหม่
--
-- ต้นเหตุ — **คลาสบั๊กเดิมที่เกิดเป็นครั้งที่ 3** (09/09 · 15/09 · 06/10):
--   PostgREST ส่งได้แค่ `on_conflict=<ชื่อคอลัมน์>` ⇒ Postgres ต้อง *infer* index จากรายชื่อคอลัมน์
--   index ที่เป็น **expression** (`coalesce(sheet,'')`) หรือ **partial** (`where …`) อ้างแบบนี้ไม่ได้
--   index เดิม: monitoring_shipments_uniq (mat_no, ship_date, kind, coalesce(sheet,''))
--   client ส่ง: onConflict 'mat_no,ship_date,kind,sheet'  ⇒ หาไม่เจอ ⇒ 42P10
--
-- วิธีแก้ที่เป็นมาตรฐานของโปรเจคนี้แล้ว (ตรงกับ customer_pull_signals.dock_code 15/09):
--   **คอลัมน์ที่อยู่ในคีย์ ทำเป็น NOT NULL DEFAULT '' แล้ว index ด้วยคอลัมน์ล้วน**
--   ห้ามแก้ด้วย coalesce() ใน index เด็ดขาด — นั่นคือสิ่งที่พาเรากลับมา 42P10 ทุกครั้ง
--
-- ปลอดภัย: ก่อนรันตารางมี 1,434 แถว · `sheet is null` = 0 แถว · คีย์ไม่ซ้ำอยู่แล้ว 1,434/1,434
--          ⇒ set not null + unique index ใหม่ ผ่านโดยไม่ต้องล้างข้อมูล
-- Rollback: drop index public.monitoring_shipments_key_uniq;
--           alter table public.monitoring_shipments alter column sheet drop not null;
--           (index เดิม monitoring_shipments_uniq ยังอยู่ ⇒ ยังกันซ้ำได้เหมือนเดิมระหว่างย้อน)
-- ═══════════════════════════════════════════════════════════════════════════════

update public.monitoring_shipments set sheet = '' where sheet is null;

alter table public.monitoring_shipments alter column sheet set default '';
alter table public.monitoring_shipments alter column sheet set not null;

create unique index if not exists monitoring_shipments_key_uniq
  on public.monitoring_shipments (mat_no, ship_date, kind, sheet);

comment on index public.monitoring_shipments_key_uniq is
  'คีย์ธรรมชาติของประวัติการส่ง — คอลัมน์ล้วนเพื่อให้ upsert ฝั่ง client (on_conflict=mat_no,ship_date,kind,sheet) อ้างได้ · sheet เป็น NOT NULL DEFAULT '''' โดยเจตนา ห้ามเปลี่ยนกลับเป็น nullable + coalesce() ใน index';

comment on column public.monitoring_shipments.sheet is
  'ชีทต้นทางในไฟล์ (110T / Argen / TSPK …) — ไม่มี = '''' ห้าม null (เป็นส่วนหนึ่งของคีย์ upsert)';

-- ══ ของเก่าที่เหลือทิ้งไว้โดยเจตนา ════════════════════════════════════════════════
-- `monitoring_shipments_uniq` (expression index) ตอนนี้ **ซ้ำซ้อน** กับตัวใหม่
-- (sheet เป็น NOT NULL แล้ว ⇒ coalesce(sheet,'') = sheet เป๊ะ) — ไม่ผิด แค่เปลืองตอนเขียน
-- ⚠️ DROP INDEX รันผ่าน MCP ไม่ได้ (ค้างทุกท่า · พิสูจน์แล้ว 05/10) ⇒ ถ้าจะเก็บกวาด
--    ให้ user รันบรรทัดนี้เองใน SQL Editor ของ project "Product DB":
--      drop index if exists public.monitoring_shipments_uniq;
--
-- ══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════════
--   select indexname from pg_indexes where tablename='monitoring_shipments' order by 1;
--   -- ต้องมี monitoring_shipments_key_uniq
--   select count(*) filter (where sheet is null) from public.monitoring_shipments;  -- ต้อง 0
