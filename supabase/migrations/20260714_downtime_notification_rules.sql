-- Downtime overhaul (2026-07-14) — register the two new downtime events in the
-- notification routing table so admins can toggle/route them from the config page.
-- Project: MAIN (ewhdfqwfwofivojtsizn). Idempotent: keeps any admin channel choices
-- on re-run. channel_ids empty → falls back to the legacy default group until routed.
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order)
values
  ('downtime_call_mtn',   'เรียกช่าง MTN เข้าหน้างาน (ด่วน)',      'production', true, '{}', 5),
  ('downtime_open_15min', 'เครื่องเปิดค้างเกินเกณฑ์เวลา',          'production', true, '{}', 6)
on conflict (event_key) do nothing;
