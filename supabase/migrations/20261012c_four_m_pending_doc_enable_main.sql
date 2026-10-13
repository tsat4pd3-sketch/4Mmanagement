-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn) — เปิดใช้สถานะ `pending_doc` ให้ได้จริง
-- (2026-10-12 · คำสั่ง user: *"ซ่อมให้ใช้ได้"* ต่อจากที่ QC audit รอบ 6 เจอว่าฟีเจอร์นี้ตายอยู่)
--
-- ── อาการเดิม ─────────────────────────────────────────────────────────────
-- `Management.jsx` insert `status:'pending_doc'` ตอนย้ายคนข้ามไลน์ที่ต้อง OJT
-- แต่ CHECK อนุญาตแค่ 4 ค่า ⇒ ล้มด้วย `23514` **ทุกครั้ง** (ฐานไม่มีแถว pending_doc เลยสักแถว)
-- ⇒ ใบ 4M Man "ย้ายข้ามไลน์ต้อง OJT" ไม่เคยถูกสร้าง · แผงแนบเอกสาร OJT เป็น dead code
--
-- ── ส่วนที่ "ลงให้แล้ว" ผ่าน MCP (additive ล้วน) ────────────────────────────
--   ✅ `doc_ref_log_id uuid references four_m_logs(id) on delete set null`
--      = ใบเดิมที่ "ยืมเอกสาร OJT" มาใช้ · null = ใบนี้มีเอกสารของตัวเอง/ไม่ต้องมี
--      (กฎการยืมอยู่ที่ `src/utils/fourMDoc.js` ที่เดียว · มีเทส `fourMDoc.test.mjs` 13 เคส)
--
-- ── 🔴 ส่วนที่ต้องให้ user รันเอง (MCP รัน `drop` ไม่ได้ · ค้างจน timeout) ──────
-- แก้ CHECK ในที่ ทำไม่ได้ — ต้อง drop แล้ว add ใหม่:
--
--   alter table public.four_m_logs drop constraint four_m_logs_status_check;
--   alter table public.four_m_logs add  constraint four_m_logs_status_check
--     check (status = any (array['pending_doc','pending','pending_qa','approved','rejected']::text[]));
--
-- ⚠️ **ก่อนรัน = ของเดิมทำงานเหมือนเดิมทุกอย่าง** (ทางที่ยืมใบเดิมได้ใช้ `status='pending'`
--    จึงผ่าน CHECK เดิมอยู่แล้ว · ทางที่ต้องแนบใหม่ยังล้ม 23514 เหมือนก่อนหน้านี้ ไม่แย่ลง)
--    **หลังรัน** ทางที่ต้องแนบใหม่จะเริ่มสร้างใบได้ แล้วใบจะไปโผล่ที่ `/report` ด้วยป้าย
--    "📎 รอแนบเอกสาร OJT" (`STATUS_META.pending_doc`) — ไม่ใช่ "รอ SV Approve"
--
-- ── ทำไมปลอดภัยที่จะเปิด (ไล่ดูทุกจอที่อ่านสถานะ 4M แล้ว) ──────────────────
--   · `Report.jsx` — `isActionable = ['pending','pending_qa'].includes(status)` ⇒ **ไม่มีปุ่มอนุมัติ**
--     ให้กดบนใบ pending_doc · `actionableCount` ก็ไม่นับ · เพิ่มป้าย + ตัวกรองให้แล้ว
--   · จอที่นับ "4M ค้าง" ทุกตัวกรอง `.in('status',['pending','pending_qa'])` อยู่แล้ว —
--     `MyQueuePanel` · `MorningMeeting` · `FactoryMap` · `DeptDashboard` · `monthlyReviewPptx`
--     ⇒ ใบ pending_doc **ไม่ไปบวกใน KPI/คิวงานของใคร** (ตรงกฎ §4M "ห้ามเข้าคิวอนุมัติเงียบๆ")
--   · `utils/personAlarm.js` มี `pending_doc` ใน `MAN_PENDING_STATUSES` อยู่แล้ว
--     ⇒ ไฟเหลืองเตือน "คนนี้ถูกย้ายแล้วใบยังไม่ปิด" จะเริ่มทำงานตามที่ออกแบบไว้แต่แรก
--   · `Dashboard.jsx` เติมป้าย '📎 รอแนบเอกสาร' ในลูกโซ่ ternary แล้ว
--
-- ── ตรวจกลับหลังรัน ────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.four_m_logs'::regclass and conname='four_m_logs_status_check';
--   -- ต้องเห็น pending_doc อยู่ในลิสต์
--   select status, count(*) from public.four_m_logs group by status order by 2 desc;
--   -- pending_doc จะเริ่มมีแถวเมื่อมีการย้ายคนข้ามไลน์ที่ยืมเอกสารเดิมไม่ได้
--
-- ROLLBACK
--   alter table public.four_m_logs drop constraint four_m_logs_status_check;
--   alter table public.four_m_logs add  constraint four_m_logs_status_check
--     check (status = any (array['pending','pending_qa','approved','rejected']::text[]));
--   -- ⚠️ ต้องเคลียร์แถว pending_doc ก่อน (ถ้ามี) — ห้าม delete: ใช้
--   --    update public.four_m_logs set status='rejected',
--   --           reject_reason='ปิดฟีเจอร์รอแนบเอกสาร OJT (rollback)' where status='pending_doc';
--   alter table public.four_m_logs drop column if exists doc_ref_log_id;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.four_m_logs
  add column if not exists doc_ref_log_id uuid references public.four_m_logs(id) on delete set null;

comment on column public.four_m_logs.doc_ref_log_id is
 'ใบ 4M เดิมที่ "ยืมเอกสาร OJT" มาใช้ (กฎ src/utils/fourMDoc.js · คำสั่ง user 2026-10-12) — null = ใบนี้มีเอกสารของตัวเอง/ไม่ต้องมี · ห้ามใช้แทนการแนบเอกสารโดยไม่มีใบต้นทาง';
