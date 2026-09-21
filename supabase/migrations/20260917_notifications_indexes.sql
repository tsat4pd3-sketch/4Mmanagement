-- ─────────────────────────────────────────────────────────────────────────────
-- index ของ `notifications`  (Main project) — 2026-09-17
-- เจอระหว่างทำป้ายราคา: ตารางนี้มี index ตัวเดียวคือ pkey **ไม่มี index บน user_id เลย**
-- กระดิ่งยิง `where user_id = ? order by created_at desc limit 30` ทุกครั้งที่เปิดแอป
-- + ทุก realtime event ⇒ seq scan ทั้งตาราง 64,456 แถว ทุก user ทุกจอ (โตวันละ 3,844 แถว)
-- ยืนยันด้วย explain analyze: seq scan (cost 11,459) → Index Scan 32 buffers
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

-- ป้ายราคาใน /notification-config: สรุปย้อนหลัง N วัน group by event_key
create index if not exists idx_notifications_created
  on public.notifications (created_at desc);

analyze public.notifications;
