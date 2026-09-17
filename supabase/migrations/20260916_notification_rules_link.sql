-- ─────────────────────────────────────────────────────────────────────────────
-- notification_rules.link — ปลายทาง "กดแล้วไปไหน" ของแจ้งเตือนสรุป  (Main project)
-- 2026-09-16 · ต่อจาก 20260916_notifications_link.sql
--
-- ปัญหา: แจ้งเตือนสรุปทุกก้อนออกจาก `notifyInApp()` ใน edge (send-notification ·
--   send-store-notification · mtn-daily-summary · daily-4m-summary · qa-fme-scan)
--   ซึ่ง insert แถวโดย **ไม่มี ref_table และไม่มี link** ⇒ กระดิ่งไม่มีลูกศร › กดแล้วแค่ mark อ่าน
--   วัดจริง 16/09: 6,819 แถว (walkback 5,489 · เตือน PM 379 · ส่งงานลูกค้า 338 · เฝ้าระวังสโตร์ 326
--   · EDI 156 · แผนประสานงาน PM 131) — ยังเกิดใหม่ทุกวัน
--
-- ทำไมแก้ที่ DB ไม่ใช่แก้ใน edge:
--   1. `send-notification/index.ts` = 59 KB · `qa-fme-scan` = 53 KB — เอกสาร `docs/modules/edge-functions.md`
--      สั่งห้าม deploy ไฟล์ขนาดนี้ผ่าน MCP (ต้องพิมพ์ทั้งไฟล์ซ้ำ พิมพ์ตกตัวเดียว = แจ้งเตือนทั้งระบบพัง)
--      และ user ไม่มี Supabase CLI ⇒ **ไม่มีทางแก้ในไฟล์นั้นอย่างปลอดภัย**
--   2. trigger ตัวเดียวครอบ **ทุกตัวส่ง** (edge ทั้ง 5 + โค้ดในอนาคต) — ไม่ต้องไล่แก้ทีละที่
--   3. เป็น data-driven: ปลายทางแก้ได้จาก `/notification-config` ทีหลังโดยไม่ต้อง deploy อะไร
--
-- วิธีจับคู่: ทุกตัวส่งตั้ง `title = notification_rules.label` ของ event นั้นเสมอ
--   (`const title = routes[event]?.label || event`) ⇒ join ด้วย label ได้แม่น — ยืนยันกับฐานจริงแล้ว
--   admin เปลี่ยน label ภายหลัง = แถวใหม่ไม่ match ⇒ ไม่มี link (เหมือนพฤติกรรมวันนี้ ไม่พัง)
--
-- ย้อนได้: drop trigger + drop function + drop column (แถวที่ backfill ไปแล้วอยู่ในตาราง backup)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.notification_rules add column if not exists link text;

comment on column public.notification_rules.link is
  'หน้าที่กระดิ่ง/Web Push เปิดเมื่อกดแจ้งเตือนของ event นี้ (path เริ่มด้วย /) '
  '— ใช้กับแจ้งเตือนสรุปที่ผูก ref_table ไม่ได้ · trigger trg_notification_fill_link เติมให้ตอน insert';

update public.notification_rules r set link = v.link
from (values
  ('checkin_summary',      '/checkin'),
  ('checkin_update',       '/checkin'),
  ('ot_booking',           '/report'),
  ('morning_meeting',      '/morning-meeting'),
  ('downtime',             '/daily-report'),
  ('downtime_recovered',   '/daily-report'),
  ('downtime_open_15min',  '/daily-report'),
  ('downtime_call_mtn',    '/daily-report'),
  ('prod_close',           '/daily-report'),
  ('pm_daily_red',         '/daily-pm'),
  ('pm_daily_orange',      '/daily-pm'),
  ('pm_daily_green',       '/daily-pm'),
  ('pm_plan_reminder',     '/pm-forecast?tab=due'),
  ('pm_deferred',          '/pm-schedule'),
  ('pm_coordination',      '/pm-coordination'),
  ('edi_import',           '/planner-sales'),
  ('shipping_shipped',     '/customer-demand?tab=shipping'),
  ('shipping_overdue',     '/customer-demand?tab=shipping'),
  ('shipping_phase_alert', '/customer-demand?tab=shipping'),
  ('store_abnormal',       '/store-monitor'),
  ('mtn_daily_summary',    '/mtn-repair'),
  ('mtn_pickup_pending',   '/mtn-repair'),
  ('four_m_daily_summary', '/event-log'),
  ('qa_fme_call',          '/qa'),
  ('qa_fme_overdue',       '/qa')
) as v(event_key, link)
where r.event_key = v.event_key and r.link is distinct from v.link;

-- เติม link ตอน insert ให้ทุกตัวส่งที่ไม่ได้ระบุมาเอง (ตัวส่งที่ระบุ link/ref_table มาแล้วไม่ถูกแตะ)
create or replace function public.fn_notification_fill_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.link is null and new.ref_table is null and new.title is not null then
    select r.link into new.link
    from public.notification_rules r
    where r.label = new.title and r.link is not null
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notification_fill_link on public.notifications;
create trigger trg_notification_fill_link
before insert on public.notifications
for each row execute function public.fn_notification_fill_link();

-- ── backfill ใบเก่า (ทีมงานเปิดกระดิ่งแล้วเห็นผลทันที ไม่ต้องรอแจ้งเตือนรอบใหม่) ──
create table if not exists public.bk_notifications_link_20260916 as
  select id, link from public.notifications where false;

insert into public.bk_notifications_link_20260916 (id, link)
select n.id, n.link from public.notifications n
where n.link is null and n.ref_table is null;

update public.notifications n set link = r.link
from public.notification_rules r
where n.link is null and n.ref_table is null and r.label = n.title and r.link is not null;

-- 💬 mention ใต้ใบซ่อม (EventComments) — ใบเก่าไม่ได้เก็บ id ของใบไว้ ⇒ พาไปหน้ารวมแจ้งซ่อมก่อน
-- (ใบใหม่ deep-link ถึงใบจริงผ่าน `link` ที่ client ใส่มา — src/components/EventComments.jsx)
update public.notifications
set link = '/mtn-repair'
where link is null and ref_table is null and title like '💬%ใบซ่อม%';

-- ── deep-link ตามตารางต้นทาง (2026-09-16 · เพิ่มในไฟล์เดียวกัน) ──
-- ใบ MO เป็นก้อนใหญ่สุดของกระดิ่ง (41,583 แถว) และ ref_id = id ของใบอยู่แล้ว
-- ⇒ เติม `?mo=<id>` ให้ **กดแล้วเปิดใบนั้นเลย** ไม่ใช่ลงหน้ารวมแล้วให้ไปไล่หาเอง
-- ทำที่ trigger แทนแก้ edge `send-mtn-notification` (30 KB · deploy ผ่าน MCP ต้องพิมพ์ทั้งไฟล์ซ้ำ =
-- ความเสี่ยงเกินเหตุสำหรับบรรทัดเดียว) — และได้ผลกับใบเก่าทั้งหมดผ่าน backfill ด้วย
-- ⚠️ MtnRepair.jsx รับ ?mo= ทั้ง id และเลข MO (useEffect moParam) — ห้ามถอด ไม่งั้นลิงก์นี้ตาย
create or replace function public.fn_notification_fill_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.link is not null then return new; end if;

  if new.ref_table = 'mtn_orders' and new.ref_id is not null then
    new.link := '/mtn-repair?mo=' || new.ref_id::text;
  elsif new.ref_table is null and new.title is not null then
    select r.link into new.link
    from public.notification_rules r
    where r.label = new.title and r.link is not null
    limit 1;
  end if;
  return new;
end;
$$;

insert into public.bk_notifications_link_20260916 (id, link)
select id, link from public.notifications
where link is null and ref_table = 'mtn_orders' and ref_id is not null;

update public.notifications
set link = '/mtn-repair?mo=' || ref_id::text
where link is null and ref_table = 'mtn_orders' and ref_id is not null;
