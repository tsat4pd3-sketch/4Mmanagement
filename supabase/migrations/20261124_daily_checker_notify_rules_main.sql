-- ═══════════════════════════════════════════════════════════════════════════════
-- Daily Checker — แจ้งเตือน (2026-11-24 · คำสั่ง user ข้อ N1–N5) · project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ① lpa_finding  : เพิ่ม leader (คนที่ต้องแก้) · ลิงก์ตั้งต้น /daily-checker?tab=lpa (โค้ดส่งลิงก์ตรงใบให้อยู่แล้ว)
-- ② pm_daily_orange (AM ไม่ทำตามเวลา) : ขึ้นในแอปถึง leader + supervisor ของส่วนงานไลน์ (เดิม Telegram อย่างเดียว)
--    pm_daily_red   : **คงไม่ขึ้นในแอป** — การ์ดในแอปของ AM NG = `pm_inspection_ng` ใบเดียว (N1 ยุบการ์ดซ้ำ)
--    pm_daily_green : คงไม่ขึ้นในแอป (ข่าวดีไม่ต้องรบกวน)
--    ลิงก์ของ pm_daily_* ย้ายจาก /daily-pm (route เก่า) → /daily-checker?tab=pm
-- ③ ใหม่ pokayoke_fail : supervisor + qa ของส่วนงานไลน์
-- ④ ใหม่ lpa_missed    : สแกนทุกเช้า 08:40 (ไทย) — แผน Leader เมื่อวานที่ยังไม่มีใบตรวจ → leader + supervisor ส่วนงานไลน์
--    ⚠️ ฝั่ง Main ไม่รู้ว่าไลน์ "เดินจริง" ไหม (ตารางกะอยู่ DR) ⇒ ข้อความเขียนว่า "ถ้าไลน์ไม่ได้ผลิต ข้ามได้" ไม่กล่าวหา
--    · ข้ามวันหยุดตามปฏิทินบริษัท (ไม่มาร์ค = ส-อา หยุด เหมือนจอ) · Telegram ไม่ส่ง (channel ว่าง · นโยบายในแอปก่อน)
--
-- ย้อนกลับ: ดูท้ายไฟล์ (UPDATE คืนค่าเดิม + DELETE 2 แถว + unschedule + drop function)
-- ═══════════════════════════════════════════════════════════════════════════════

update public.notification_rules
   set inapp_roles = array['leader','supervisor','manager','admin','qa'],
       link = '/daily-checker?tab=lpa', updated_at = now()
 where event_key = 'lpa_finding';

update public.notification_rules
   set inapp_roles = array['leader','supervisor'], inapp_match_section = true,
       link = '/daily-checker?tab=pm', updated_at = now()
 where event_key = 'pm_daily_orange';

update public.notification_rules
   set link = '/daily-checker?tab=pm', updated_at = now()
 where event_key in ('pm_daily_red', 'pm_daily_green');

insert into public.notification_rules
  (event_key, label, category, is_enabled, sort_order, channel_ids, inapp_roles, inapp_sections, inapp_depts,
   inapp_match_section, link, inapp_cast, can_mute)
values
  ('pokayoke_fail', '🛡️ Poka-Yoke ทดสอบไม่ผ่าน (อุปกรณ์จับของเสียไม่ได้)', 'quality', true, 421, '{}',
   array['supervisor','qa'], '{}', '{}', true, '/daily-checker?tab=pokayoke', 'always', true),
  ('lpa_missed', '📋 LPA ขาดตรวจ (แผน Leader เมื่อวานยังไม่มีผลตรวจ)', 'quality', true, 422, '{}',
   array['leader','supervisor'], '{}', '{}', true, '/daily-checker?tab=lpa&sub=plan', 'always', true)
on conflict (event_key) do nothing;

create or replace function public.fn_lpa_missed_scan(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_day  date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date - 1);
  v_type text;
  v_sent int := 0;
  r      record;
  v_url  text := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-event-notification';
begin
  -- วันหยุดโรงงาน = ไม่มีใครต้องตรวจ (มาร์คไว้ = ตาม day_type · ไม่มาร์ค = ส-อา หยุด)
  select day_type into v_type from company_calendar where work_date = v_day;
  if (v_type is not null and v_type <> 'working') or (v_type is null and extract(isodow from v_day) in (6, 7)) then
    return jsonb_build_object('day', v_day, 'skipped', 'holiday');
  end if;

  for r in
    select p.line_name, string_agg(case p.shift when 'night' then 'กะดึก' else 'กะเช้า' end, ' + ' order by p.shift) as shifts
    from lpa_plans p
    join lpa_plan_days d on d.plan_id = p.id and d.day = extract(day from v_day)::int and d.plan_leader
    where p.month_key = to_char(v_day, 'YYYY-MM')
      and not exists (select 1 from lpa_audits a
                       where a.line_name = p.line_name and a.shift = p.shift
                         and a.audit_date = v_day and a.layer = 'leader')
    group by p.line_name
  loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'event',     'lpa_missed',
        'title',     '📋 LPA ขาดตรวจ — ' || r.line_name,
        'line_name', r.line_name,
        'type',      'info',
        'ref_table', 'lpa_plans',
        'link',      '/daily-checker?tab=lpa&sub=plan&line=' || replace(replace(replace(replace(replace(r.line_name, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), ' ', '%20'),
        'lines',     to_jsonb(array[
                       '📅 ' || to_char(v_day, 'DD/MM/YYYY') || ' · ' || r.shifts,
                       'มีแผนตรวจชั้น Leader แต่ยังไม่มีผลตรวจในระบบ',
                       'ถ้าไลน์ไม่ได้ผลิตวันนั้น ข้ามได้ · ตรวจแล้วแต่ยังไม่บันทึก = บันทึกย้อนหลังที่แท็บบันทึกผลตรวจ'
                     ])
      )
    );
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('day', v_day, 'sent', v_sent);
end $function$;

revoke all on function public.fn_lpa_missed_scan(date) from public, anon, authenticated;

-- 01:40 UTC = 08:40 ไทย (หลังเปลี่ยนวันทำงาน 08:00 · ก่อนประชุมเช้า)
select cron.schedule('lpa-missed-scan', '40 1 * * *', $$ select public.fn_lpa_missed_scan(); $$);

-- ── ย้อนกลับ (รันเมื่อจำเป็น) ────────────────────────────────────────────────
-- select cron.unschedule('lpa-missed-scan');
-- drop function if exists public.fn_lpa_missed_scan(date);
-- delete from public.notification_rules where event_key in ('pokayoke_fail', 'lpa_missed');
-- update public.notification_rules set inapp_roles = array['supervisor','manager','admin','qa'], link = null where event_key = 'lpa_finding';
-- update public.notification_rules set inapp_roles = '{}', inapp_match_section = false, link = '/daily-pm' where event_key = 'pm_daily_orange';
-- update public.notification_rules set link = '/daily-pm' where event_key in ('pm_daily_red', 'pm_daily_green');
