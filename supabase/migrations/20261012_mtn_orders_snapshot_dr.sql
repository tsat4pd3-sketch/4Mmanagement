-- ════════════════════════════════════════════════════════════════════════════
-- DR project (ชื่อในจอ Supabase "Product DB" · eyhclzkifitbhbljgoav)
-- 📄 ใบ MO ที่ปิดแล้ว = **บันทึก** — เก็บเนื้อใบตอนปิด (คำสั่ง user 2026-10-12)
--
-- ปัญหา (QC audit 08/10 · user ตัดสิน 12/10 "ทำแบบเก็บตอนปิดใบ"):
--   ใบ MO มีเลขที่เอกสาร (`mo_no` — 633/674 ใบ ณ 12/10 · คนกรอกเอง ไม่มี trigger)
--   และขึ้นทะเบียนเป็นฟอร์มควบคุมแล้วทั้ง 2 ฟอร์ม (FM-JIG-008 / FM-MTN-006)
--   แต่ `printMoReport` **generate จากข้อมูลสดทุกครั้ง** ⇒ ใบที่เซ็นครบแล้ว กดพิมพ์ใหม่วันนี้
--   จะได้คอมเมนต์/ค่าอะไหล่/ค่าแรงที่แก้ทีหลัง = พิสูจน์ย้อนไม่ได้ว่าตอนเซ็นใบเขียนว่าอะไร
--   (ขัดกฎ CLAUDE.md §ฟอร์มที่ยื่นออกไปแล้ว = บันทึก ไม่ใช่ใบที่ generate ใหม่)
--
-- ── ขอบเขตที่ user เลือก (ตั้งใจ "ประหยัด" ไม่ทำระบบออกเลขใบใหม่) ─────────────────────
--   ✔ เก็บ snapshot **ครั้งเดียวตอนปิดใบ** (ขั้นสุดท้าย: cost_mgr_close ของ MTN · close ของ JIG/DIE/PD)
--   ✔ พิมพ์ใบที่ปิดแล้ว → อ่านจาก snapshot · ใบที่ยังไม่ปิด → generate สดเหมือนเดิม (ถูกแล้ว ยังแก้ได้)
--   ✘ **ไม่ backfill ใบเก่า** — เดาเนื้อใบตอนเซ็นไม่ได้ = จะโกหก
--     ⇒ ใบเก่าที่ปิดแล้วแต่ไม่มี snapshot ต้องติดป้ายบนใบว่า "ไม่มีบันทึกต้นฉบับ" (`moPrintSource`)
--   ✘ ไม่ออกเลขใบใหม่ (`mo_no` มีอยู่แล้ว) · ไม่นับ reprint (ใบนี้ไม่ได้ยื่นออกนอกองค์กร)
--
-- 🔴 snapshot เก็บ **เนื้อใบ** เท่านั้น — ห้ามเก็บเลขฟอร์ม / Rev / โลโก้ / footer / sig_blocks
--    พวกนั้นอยู่ทะเบียน `/doc-forms` ให้ doc_control แก้เองได้ ⇒ **ต้องอ่านสดตอนพิมพ์เสมอ**
--    (กฎ CLAUDE.md: ห้าม hardcode เลขฟอร์ม/Rev/โลโก้) · ตัวอ่าน = `docFormSync()` ในใบพิมพ์
--
-- ⚠️ ไม่แตะ RLS — ตารางนี้ฝั่ง DR วิ่งด้วย role `anon` เสมอ policy เดิมคลุม UPDATE อยู่แล้ว
--    (กฎเหล็ก: ห้ามเปลี่ยน RLS ฝั่ง DR เป็น TO authenticated)
-- ⚠️ ไม่ใส่ `snapshot` ใน `MO_LIST_COLS` — จอรายการต้องไม่ลาก jsonb มาทุกแถว (กฎ egress ข้อ 11)
--    ใบเต็มโหลดด้วย `select('*')` ตอนเปิดใบทีละใบ ⇒ ได้ snapshot มาพอดีตอนจะพิมพ์
--
-- ⏪ ROLLBACK (ปลอดภัย · คอลัมน์ใหม่ nullable ไม่มีใครบังคับใช้):
--   alter table public.mtn_orders drop column if exists snapshot;
--   alter table public.mtn_orders drop column if exists snapshot_at;
--   (revert โค้ดก่อน แล้วค่อย drop column — โค้ดเก่าไม่รู้จัก 2 คอลัมน์นี้ อยู่ร่วมกันได้)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.mtn_orders
  add column if not exists snapshot    jsonb,
  add column if not exists snapshot_at timestamptz;

comment on column public.mtn_orders.snapshot is
  'เนื้อใบ ณ เวลาปิดใบ (เก็บครั้งเดียว) — ใบที่ปิดแล้วพิมพ์จากตัวนี้ ไม่ generate สด '
  '· ไม่เก็บเลขฟอร์ม/Rev/โลโก้ (อ่านสดจากทะเบียน /doc-forms) · ตัวเขียน/อ่าน = src/lib/mtnMoSnapshot.js';
comment on column public.mtn_orders.snapshot_at is
  'เวลาที่เก็บ snapshot — null = ใบนี้ไม่มีบันทึกต้นฉบับ (ใบเก่าก่อน 12/10 หรือเก็บไม่สำเร็จ)';

-- ✅ ตรวจผล (project "Product DB" · eyhclzkifitbhbljgoav)
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema='public' and table_name='mtn_orders' and column_name like 'snapshot%';
--   -- ต้องได้ snapshot jsonb YES · snapshot_at timestamptz YES
--   select count(*) filter (where status='closed') as closed,
--          count(snapshot) as with_snap from mtn_orders;
--   -- วันที่ apply: closed ทั้งหมดยังไม่มี snapshot (ไม่ backfill) = ถูกต้อง
