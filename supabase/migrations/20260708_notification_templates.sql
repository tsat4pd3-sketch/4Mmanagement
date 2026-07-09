-- Notification message templates — admin-editable content per event.
-- Project: MAIN (ewhdfqwfwofivojtsizn).
--
-- `template` holds a Telegram message body with {placeholders} (e.g. {line_name}).
-- The send-notification edge function renders it against that event's variables.
-- Templates are OPT-IN: NULL / empty → the function keeps its rich built-in
-- message, so nothing changes until an admin writes a template on the config
-- page. Lists (missing equipment, NG topics, …) are pre-joined into scalar
-- placeholders so a flat template can still show them.

alter table public.notification_rules add column if not exists template text;
