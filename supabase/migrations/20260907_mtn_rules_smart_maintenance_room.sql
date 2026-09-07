-- ══════════════════════════════════════════════════════════════════════════
-- ผูกห้อง "🔧 Smart Maintenance" ให้ event ใบแจ้งซ่อมที่ยังไม่มีห้อง   2026-09-07
-- Project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา: ตรวจฐาน 2026-09-03/07 — notification_rules หมวด maintenance มีห้องแค่ mtn_reported
--   (ห้อง "Report Technician PD3" team=production) ส่วน mtn_assigned/repaired/checked/qa/
--   qa_skipped/handover/closed/daily_summary/pm_deferred/pm_coordination **channel_ids ว่างทั้งหมด**
--   → ข้อความตั้งแต่ขั้น 2 ตกห้อง fallback ของบอท (env TELEGRAM_CHAT_ID) = หน้างานเห็นแค่ใบเปิดใหม่แล้วเงียบ
--   migration 20260825 ตั้งใจแก้เรื่องนี้แต่ไม่เคยถูกรัน (แถวยังว่างอยู่)
--
-- วิธี: ใช้ห้อง "🔧 Smart Maintenance" (ห้องรวมช่าง ไม่แท็กทีม) — ห้องเดียวกับที่ pm_daily_*/pm_plan_reminder ใช้อยู่แล้ว
--   หาด้วยชื่อ ไม่ hardcode uuid · แตะเฉพาะแถวที่ว่างจริง · รันซ้ำได้ · ย้ายห้องทีหลังได้ที่ /notification-config
--   ห้องทีม (telegram_channels.team) ยังถูก edge เติมให้เองตามทีมของใบ — ตัวนี้เป็นห้องรวมเพิ่มเข้าไป
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  room uuid;
  n int;
begin
  select id into room from public.telegram_channels
   where is_active and coalesce(chat_id, '') <> '' and coalesce(team, '') = ''
     and (name ilike '%smart maintenance%' or name ilike '%maintenance%' or name ilike '%ช่าง%')
   order by (name ilike '%smart maintenance%') desc limit 1;
  if room is null then
    raise notice 'ไม่พบห้อง Smart Maintenance ที่ active — ข้าม (ตั้งห้องที่ /notification-config ก่อน)';
    return;
  end if;
  update public.notification_rules
     set channel_ids = array[room]
   where category = 'maintenance'
     and coalesce(array_length(channel_ids, 1), 0) = 0;
  get diagnostics n = row_count;
  raise notice 'ผูกห้อง % ให้ % event', room, n;
end $$;

-- ตรวจผล:
--   select r.event_key, c.name from public.notification_rules r
--     left join public.telegram_channels c on c.id = any(r.channel_ids)
--    where r.category = 'maintenance' order by r.sort_order;   -- ทุกแถวต้องมีชื่อห้อง
-- Rollback: update public.notification_rules set channel_ids = '{}'
--   where category = 'maintenance' and event_key <> 'mtn_reported' and channel_ids <> '{}';
