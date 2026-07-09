-- Notification message templates — admin-editable content per event.
-- Project: MAIN (ewhdfqwfwofivojtsizn).
-- `template` is a message body with {placeholders}; the send-notification edge
-- function renders it against per-event variables. NULL → the function's built-in
-- default. Lists (missing equipment, NG topics, ...) are pre-joined into scalar
-- placeholders so a flat template can show them.

alter table public.notification_rules add column if not exists template text;

update public.notification_rules set template = t.tpl from (values
  ('checkin_summary',
E'✅ เช็คชื่อเสร็จแล้ว\n🏭 ไลน์: {line_name} · {shift_label}\n📅 {work_date}\n👥 เข้างาน: {present}/{total} · OT {ot} · ลา {leave} · ขาด {absent}\n✍️ ตรวจโดย {checked_by}'),
  ('downtime',
E'🚨 เครื่องจักร DOWNTIME\n⚙️ {machine_no} {machine_name}\n🏭 {line_name} · {shift_label} · 📅 {work_date}\n🛑 {type_name}\n⏱ {duration_min} นาที\n🔩 {mat_no}\n📝 {description}\n👤 {reported_by}'),
  ('downtime_recovered',
E'✅ เครื่องกลับมารันได้แล้ว\n⚙️ {machine_no} {machine_name}\n🏭 {line_name} · {shift_label} · 📅 {work_date}\n⏱ หยุดรวม {duration_min} นาที\n👤 {reported_by}'),
  ('prod_close',
E'{title}\n🏭 {line_name} · {shift_label} · 📅 {work_date}\n📦 ผลิตรวม {total_qty} · ✅ {qty_ok} ❌ NG {qty_ng}\n📊 OEE {oee}%\n👤 {actor}'),
  ('four_m_status',
E'🔔 {title}\n📅 {work_date} · 🏭 {line_name}\n📋 {category}\n📝 {description}\n🔖 {status_label}\n👤 {creator}'),
  ('pm_daily_green',
E'🟢 ตรวจ Daily PM เรียบร้อย ทุกอย่างปกติ\n🏭 {line_name} · {shift_label}\n📅 {work_date}\n✅ ตรวจแล้ว {checked}/{total} เครื่อง'),
  ('pm_daily_orange',
E'🟠 ยังตรวจ Daily PM ไม่ครบ (เกินเวลา)\n🏭 {line_name} · {shift_label}\n📅 {work_date}\n✅ ตรวจแล้ว {checked}/{total} · ⏳ ขาด: {missing}'),
  ('pm_daily_red',
E'🔴 Daily PM พบความผิดปกติ\n🏭 {line_name} · {shift_label}\n📅 {work_date}\n⚠️ {ng}')
) as t(event_key, tpl)
where public.notification_rules.event_key = t.event_key
  and public.notification_rules.template is null;
