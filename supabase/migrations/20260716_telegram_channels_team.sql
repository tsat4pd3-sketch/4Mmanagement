-- แจ้งเตือน MTN แยกห้องต่อทีมช่าง 4 ส่วน (2026-07-16)
-- Project: Main (ewhdfqwfwofivojtsizn) — client `supabase`
--
-- แท็กห้องแจ้งเตือน (telegram_channels) ว่าเป็นของทีมซ่อมไหน (JIG MTN/DIE MTN/MTN/PRODUCTION)
-- edge function send-mtn-notification จะเลือกส่งเข้าห้องของทีมตาม mtn_orders.mtn_dept ก่อน
-- ถ้าไม่มีห้องของทีมนั้น → ใช้ route เดิม (channel_ids ของ event / กลุ่ม fallback) เหมือนเดิม
--
-- Additive & backward-compatible: ห้องเดิมที่ team = NULL คือห้องรวม (พฤติกรรมเดิมไม่เปลี่ยน)
alter table public.telegram_channels
  add column if not exists team text;

comment on column public.telegram_channels.team is
  'ทีมซ่อมที่ห้องนี้รับแจ้งเตือน MTN (JIG MTN/DIE MTN/MTN/PRODUCTION) · NULL = ห้องรวมทุกทีม';
