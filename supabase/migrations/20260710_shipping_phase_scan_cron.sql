-- Smart Logistic — schedule the shipping walkback phase scan every 10 minutes.
-- Project: Product DB (eyhclzkifitbhbljgoav). pg_cron + pg_net drive the
-- shipping-phase-scan edge function server-side (no browser needed). Applied via MCP.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  perform cron.unschedule('shipping-phase-scan');
exception when others then null;
end $$;

select cron.schedule('shipping-phase-scan', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://eyhclzkifitbhbljgoav.supabase.co/functions/v1/shipping-phase-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGNsemtpZml0YmhibGpnb2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODExMDQsImV4cCI6MjA5MjQ1NzEwNH0.fHTA70fQ8yAvQuwAeM9HQ_UQjMdR3FUkxu_klvXs-h4',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGNsemtpZml0YmhibGpnb2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODExMDQsImV4cCI6MjA5MjQ1NzEwNH0.fHTA70fQ8yAvQuwAeM9HQ_UQjMdR3FUkxu_klvXs-h4'
    ),
    body := '{}'::jsonb
  );
$cron$);
