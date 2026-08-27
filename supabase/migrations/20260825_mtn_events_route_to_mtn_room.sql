-- ══════════════════════════════════════════════════════════════════════════
-- ผูกแจ้งเตือนหมวดซ่อมบำรุงที่ยัง "ไม่มีห้อง" เข้าห้องช่าง  (2026-08-25 · คำสั่ง user)
-- Project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา: ตรวจ notification_rules แล้วพบว่า **8 event หมวด maintenance มี channel_ids ว่าง**
--        (mtn_assigned · mtn_repaired · mtn_checked · mtn_qa · mtn_handover · mtn_closed ·
--         mtn_daily_summary · pm_deferred · pm_coordination)
--        = ใบซ่อมตั้งแต่ขั้น 2 เป็นต้นไปไม่ได้ถูกผูกห้องไว้เลย → ตกไปที่ห้อง fallback ของบอท
--        (env TELEGRAM_CHAT_ID) ถ้าไม่ได้ตั้งไว้ก็ไม่ไปไหน
--        ⇒ อาการที่หน้างานเจอ: "แจ้งซ่อมเข้ามาแล้วเห็น แต่หลังจากนั้นเงียบ"
--
-- วิธี: **ก๊อปห้องจาก `mtn_reported`** (แจ้งซ่อมใหม่ — ห้องช่างอยู่แล้ว) ไม่ต้องเดาชื่อห้อง
--       ถ้า mtn_reported ก็ว่าง ค่อยถอยไปหาห้องที่ชื่อมีคำว่า Maintenance/MTN/ช่าง
--
-- ⚠️ ไม่ทับห้องที่ตั้งไว้แล้ว — แตะเฉพาะแถวที่ `channel_ids` ว่างจริงๆ · รันซ้ำได้
-- ⚠️ `send-mtn-notification` route ตาม `telegram_channels.team` ก่อนเสมอ —
--    ห้องที่แท็กทีมไว้ (JIG/DIE) ยังชนะ ตัวนี้เป็นแค่ "ห้องสำรอง" ของ event นั้น
-- ⚠️ `pm_coordination` ตั้งใจแจ้ง **Production** ไม่ใช่ช่าง — ใส่ห้องช่างไว้ก่อนเพื่อไม่ให้หายไปเฉยๆ
--    ถ้ามีห้องของฝ่ายผลิตแล้ว ย้ายเองที่ /notification-config
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare
  target uuid[];
begin
  -- 1) ห้องเดียวกับ "แจ้งซ่อมใหม่"
  select channel_ids into target
    from public.notification_rules
   where event_key = 'mtn_reported'
     and coalesce(array_length(channel_ids, 1), 0) > 0;

  -- 2) ไม่มี → หาห้องที่ชื่อสื่อถึงงานช่าง (ที่ยัง active และมี chat_id)
  if target is null then
    select array_agg(id) into target
      from (select id from public.telegram_channels
             where is_active and coalesce(chat_id, '') <> ''
               and (name ilike '%maintenance%' or name ilike '%mtn%' or name ilike '%ช่าง%')
             limit 1) x;
  end if;

  if target is null or coalesce(array_length(target, 1), 0) = 0 then
    raise notice 'ไม่พบห้องช่าง — ข้ามการผูกห้อง (ไปตั้งห้องที่ /notification-config ก่อน)';
    return;
  end if;

  update public.notification_rules
     set channel_ids = target
   where category = 'maintenance'
     and coalesce(array_length(channel_ids, 1), 0) = 0;

  raise notice 'ผูกห้องช่างให้ event หมวด maintenance ที่ยังว่างเรียบร้อย';
end $$;

-- Rollback (คืนให้ว่างเหมือนเดิม — ระบุ event ที่ต้องการเอง):
--   update public.notification_rules set channel_ids = '{}'
--    where event_key in ('mtn_assigned','mtn_repaired','mtn_checked','mtn_qa',
--                        'mtn_handover','mtn_closed','mtn_daily_summary',
--                        'pm_deferred','pm_coordination');
