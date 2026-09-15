-- ══════════════════════════════════════════════════════════════════════════
-- แจ้งเตือน "ผจก.แผนกที่แจ้งอนุมัติแล้ว" ของใบ MO ทีม MTN (event mtn_approved)  2026-09-15
-- Project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา: ใบของทีม MTN มี 8 ขั้น (คำสั่ง user) — ขั้น 7 = ผจก.ของแผนกที่แจ้งเซ็นอนุมัติ
--        (ใบยังไม่ปิด) · ขั้น 8 = ผจก.ส่วนซ่อมบำรุงปิดจบ MO
--        ⇒ ขั้น 7 ต้องมี event ของตัวเอง ไม่งั้นจะยิง `mtn_closed` ทั้งที่ใบยังไม่ปิด
--
-- ก๊อปห้อง Telegram + role ในแอปจาก `mtn_handover` (คนกลุ่มเดียวกันที่ตามใบช่วงท้าย)
-- ไม่ทับถ้ามีแถวอยู่แล้ว · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, inapp_roles, sort_order)
select 'mtn_approved', 'ผจก.แผนกที่แจ้งอนุมัติ — รอ ผจก.ซ่อมบำรุงปิดใบ (ขั้น 7→8 · เฉพาะทีม MTN)', 'maintenance', true,
       coalesce(r.channel_ids, '{}'), coalesce(r.inapp_roles, '{}'), 36
  from (select 1) x
  left join public.notification_rules r on r.event_key = 'mtn_handover'
on conflict (event_key) do nothing;

-- ตรวจผล:
--   select event_key, label, channel_ids, inapp_roles from public.notification_rules where event_key = 'mtn_approved';
-- Rollback:
--   delete from public.notification_rules where event_key = 'mtn_approved';
