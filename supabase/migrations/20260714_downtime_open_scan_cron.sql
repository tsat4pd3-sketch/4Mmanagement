-- Downtime overhaul (2026-07-14) — schedule the "open downtime past threshold" scan.
-- Project: Product DB / DR (eyhclzkifitbhbljgoav). pg_cron + pg_net drive the
-- downtime-open-scan edge function server-side every 5 minutes (no browser needed).
-- The function reads dt_alert_config.open_alert_min, finds downtime_logs still open
-- past that many minutes and not yet alerted, POSTs 'downtime_open_15min' to MAIN
-- send-notification, and stamps open_alerted_at to dedup. Applied via MCP.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  perform cron.unschedule('downtime-open-scan');
exception when others then null;
end $$;

select cron.schedule('downtime-open-scan', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://eyhclzkifitbhbljgoav.supabase.co/functions/v1/downtime-open-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGNsemtpZml0YmhibGpnb2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODExMDQsImV4cCI6MjA5MjQ1NzEwNH0.fHTA70fQ8yAvQuwAeM9HQ_UQjMdR3FUkxu_klvXs-h4',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGNsemtpZml0YmhibGpnb2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODExMDQsImV4cCI6MjA5MjQ1NzEwNH0.fHTA70fQ8yAvQuwAeM9HQ_UQjMdR3FUkxu_klvXs-h4'
    ),
    body := '{}'::jsonb
  );
$cron$);
