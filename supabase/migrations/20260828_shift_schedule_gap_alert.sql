-- 🗓️ เตือนหัวหน้าแผนกเมื่อ "ตารางกะกำลังจะหมด / หมดแล้ว"   (Project: MAIN)
--
-- ที่มา (feedback หน้างาน 2026-08-28 · Sup Assy2 "หน้านี้ไม่ขึ้นแสดงบางส่วน"):
--   ตารางกะ PD4 หมดที่ 23/08 แล้วไม่มีใครตั้งต่อ → resolveAssignedShift คืน null
--   → คนหายจาก *ทุก* กะพร้อมกัน (PPE 0/0 · OT 0 คน · "ยังไม่มีคนถูกจัดลงจุดงาน")
--   Dashboard มีแถบเตือนแล้ว แต่ต้องมีคนเปิดดูก่อนถึงเห็น → user สั่ง "alarm ให้หัวหน้าแผนกไปปรับเอง"
--
-- ⚠️ กฎเหล็กที่ยึด (CLAUDE.md):
--   1. งานค้างที่ยังไม่หาย = เตือนซ้ำ → dedupe ราย "สัปดาห์" ไม่ใช่ครั้งเดียวจบ
--      (ไม่เตือนรายวัน — บทเรียน shipping_phase_alert 592 ครั้ง/4 วัน จนต้องปิดทิ้ง)
--   2. 1 ข้อความ / 1 ส่วนงาน — ห้ามยิงรายไลน์ (PD4 มี 7 หน่วย = 7 ข้อความพร้อมกัน)
--   3. ผู้รับ/ห้อง/ข้อความ/เปิด-ปิด อยู่ที่ notification_rules → ปรับเองที่ /notification-config
--
-- ⚠️⚠️ ขอบเขตการเตือนวัดจาก "คนที่จะหายจากจอจริง" ไม่ใช่ "แถวที่มีในตาราง"
--   ตัวที่ทำให้คนหายคือ resolveAssignedShift คืน null ซึ่งเกิดกับ:
--     • พนักงานที่ผูก line_id  → ใช้ตารางกะของ "ไลน์" นั้น
--     • พนักงานที่ไม่มี line_id → ตกมาใช้ตารางกะของ "แผนก" (ลำดับ: ไลน์ก่อน แล้วค่อยแผนก)
--   วัดกับข้อมูลจริง 31/08:
--     • ไลน์ที่ปิดใช้งานแล้ว (is_active = false) = test / test child / test child 2 → ตัดออก (ไม่ใช่งานค้าง)
--     • แถวแผนก GOR / LWRBAR / ทั่วไป / ฝ่าผลิต = **0 คนที่ไม่มี line_id** (ทุกคนมีไลน์ ตารางไลน์ชนะ)
--       → กระทบใครไม่ได้เลย ถ้านับเป็นงานค้างจะกลายเป็นเสียงรบกวนถาวร
--     • แถวแผนก MTN = 9 คนไม่มี line_id (แผนกขึ้นตรงฝ่าย section เป็น null โดยดีไซน์) → กระทบจริง ต้องเตือน
--   ⇒ ส่วนงานจะถูกเตือนก็ต่อเมื่อ **มีคนถูกกระทบ ≥ 1 คน** (having sum(affected) > 0)
--      แต่ในข้อความ **ยังลิสต์หน่วยที่ยังไม่มีคนสังกัดให้เห็นด้วย** (ห้ามซ่อนเงียบ — 🔁 เติมทีเดียวได้ทั้งส่วนงาน)
--
-- ⚠️ ข้อจำกัดที่ยอมรับ: pg_net เป็น fire-and-forget เช็ค res.ok ไม่ได้ → ส่งพลาด = สัปดาห์นั้นเงียบ
--    (สัปดาห์ถัดไปยิงใหม่เอง) · ตัวที่ไม่พึ่งการส่งเลยคือแถบเตือนบนจอ Dashboard ซึ่ง ship ไปแล้ว

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── ทะเบียนกันเตือนซ้ำ (1 ส่วนงาน / 1 สัปดาห์) ──────────────────────────────
create table if not exists public.shift_schedule_alerts (
  scope_key   text        not null,               -- 'sec:PD4' · 'sec:—' (หน่วยที่ไม่มีส่วนงาน)
  week_key    text        not null,               -- 'IYYY-Wnn' ของวันที่ยิง
  notified_at timestamptz not null default now(),
  detail      jsonb,
  primary key (scope_key, week_key)
);
alter table public.shift_schedule_alerts enable row level security;   -- เขียนโดย SECURITY DEFINER เท่านั้น

comment on table public.shift_schedule_alerts is
  'กันเตือน "ตารางกะจะหมด" ซ้ำ — 1 ส่วนงาน/สัปดาห์ (เตือนซ้ำทุกสัปดาห์จนกว่าจะตั้งกะต่อ)';

-- ── ตัวสแกน ─────────────────────────────────────────────────────────────────
create or replace function public.fn_shift_schedule_scan(p_lead_days int default 14)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_week  text := to_char((now() at time zone 'Asia/Bangkok')::date, 'IYYY-"W"IW');
  v_cut   date := ((now() at time zone 'Asia/Bangkok')::date) + p_lead_days;
  v_sent  int  := 0;
  v_skip  int  := 0;
  r       record;
  v_lines text[];
  v_head  text;
  v_url   text := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-event-notification';
begin
  for r in
    with u0 as (                       -- 1 แถว = 1 หน่วยที่มีตารางกะ + วันสุดท้ายที่ตั้งไว้
      select s.line_id, s.dept_name, max(s.work_date) as last_date
      from shift_schedules s
      group by s.line_id, s.dept_name
    ), unit as (
      select
        coalesce(pl.section, pp.section)                    as sec,   -- ไลน์ลูกไม่ตั้ง section = ตกทอดจากแม่
        coalesce(pl.name, u0.dept_name, '(ไลน์ถูกลบ)')      as unit_name,
        (u0.dept_name is not null)                          as is_dept,
        u0.last_date,
        coalesce((
          select count(*)::int from employees e
          where e.is_active
            and case when u0.dept_name is not null
                     -- แผนก: เฉพาะคนที่ "ไม่มีไลน์" เท่านั้นที่ตกมาใช้ตารางกะแผนก
                     then e.line_id is null
                      and lower(trim(e.department)) = lower(trim(u0.dept_name))
                     else e.line_id = u0.line_id end
        ), 0)                                               as affected
      from u0
      left join production_lines pl on pl.id = u0.line_id
      left join production_lines pp on pp.name = pl.parent_line_name
      where u0.line_id is null or pl.is_active is not false  -- ไลน์ปิดใช้งานแล้ว = ไม่ใช่งานค้าง
    ), due as (
      -- ⚠️ เรียง "คนเยอะก่อน" ในวันเดียวกัน — หน่วยส่วนใหญ่หมดกะวันเดียวกันหมด
      --    เรียงด้วยชื่อจะทำให้หน่วยที่มีคนจริงถูกตัดออกจาก 6 แถวแรก (เจอจริง: Office PD4 7 คน โดนซ่อน)
      select unit.*, row_number() over (partition by sec order by last_date, affected desc, unit_name) as rn
      from unit where last_date < v_cut
    )
    select
      sec,
      count(*)::int                                        as units,
      sum(affected)::int                                   as people,
      min(last_date)                                       as worst,
      count(*) filter (where last_date < v_today)::int     as overdue,
      greatest(count(*)::int - 6, 0)                       as more,
      string_agg(
        case when rn <= 6 then
          '• ' || (case when is_dept then '🏢 ' else '' end) || unit_name
            || ' — ถึง ' || to_char(last_date, 'DD/MM')
            || (case when affected > 0 then ' (' || affected || ' คน)'
                     else ' (ยังไม่มีคนสังกัด)' end)
        end, E'\n' order by rn)                             as body
    from due
    group by sec
    having sum(affected) > 0        -- ไม่มีใครถูกกระทบ = ไม่ใช่งานค้างของใคร ห้ามเตือน
    order by min(last_date)
  loop
    -- กันเตือนซ้ำในสัปดาห์เดียวกัน · ชนคีย์ = เคยเตือนไปแล้วสัปดาห์นี้
    begin
      insert into shift_schedule_alerts (scope_key, week_key, detail)
      values ('sec:' || coalesce(r.sec, '—'), v_week,
              jsonb_build_object('units', r.units, 'people', r.people,
                                 'overdue', r.overdue, 'worst', r.worst));
    exception when unique_violation then
      v_skip := v_skip + 1;
      continue;
    end;

    v_head := 'ตารางกะถึง ' || to_char(r.worst, 'DD/MM')
      || (case when r.worst < v_today
               then ' (หมดแล้ว ' || (v_today - r.worst) || ' วัน)'
               else ' (อีก ' || (r.worst - v_today) || ' วัน)' end)
      || ' · ' || r.units || ' หน่วย · กระทบ ' || r.people || ' คน';

    -- ⚠️ เรียง "สรุป + สิ่งที่ต้องทำ" ไว้ก่อนลิสต์หน่วยเสมอ
    --    ในแอปตัด body ที่ 300 ตัวอักษร (send-event-notification) — เอาลิสต์ขึ้นก่อนแล้วบรรทัดปุ่มจะโดนตัด
    v_lines := array_remove(array[
      v_head,
      case when r.overdue > 0
           then '⚠️ หมดแล้ว ' || r.overdue || ' หน่วย — คนที่เช็คชื่อจะไม่ถูกนับเข้ากะไหนเลย (จอขึ้น 0 คน · PPE 0/0)'
           else 'ตั้งกะต่อไว้ก่อนหมด เพื่อไม่ให้คนหายจากจอ' end,
      '👉 ตั้งต่อที่ ตารางกะ (/shift-organize) — มีปุ่ม 🔁 เติมกะล่วงหน้า ที่ต่อรอบสลับเดิมให้',
      '',
      r.body,
      case when r.more > 0 then '+ อีก ' || r.more || ' หน่วย' end
    ], null);

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'event',     'shift_schedule_gap',
        'title',     (case when r.overdue > 0 then '🗓️ ตารางกะหมดแล้ว — ' else '🗓️ ตารางกะกำลังจะหมด — ' end)
                      || coalesce(r.sec, 'หน่วยงานสนับสนุน'),
        'section',   r.sec,
        'type',      case when r.overdue > 0 then 'error' else 'info' end,
        'ref_table', 'shift_schedules',
        'lines',     to_jsonb(v_lines),
        'vars',      jsonb_build_object('units', r.units, 'people', r.people,
                                        'overdue', r.overdue, 'worst', to_char(r.worst, 'DD/MM/YYYY'))
      )
    );
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('sent', v_sent, 'skipped_same_week', v_skip,
                            'week', v_week, 'lead_days', p_lead_days);
end $fn$;

revoke all on function public.fn_shift_schedule_scan(int) from public, anon;

-- ── ทะเบียนแจ้งเตือน — ปรับห้อง/ผู้รับ/ข้อความ/ปิด ได้เองที่ /notification-config ──
-- ผู้รับ: supervisor + manager + admin (ตาม precedent หมวด manpower) + **mtn**
--   เพราะแถวแผนก MTN (9 คนไม่มี line_id) เป็นงานค้างจริง และ role mtn ถือ shift_schedule:edit_dept
--   อยู่แล้ว (migration 20260819/20260820) — ไม่ใส่ = คนที่แก้ได้จริงไม่ได้รับข้อความ
-- inapp_match_section = true → หัวหน้า PD4 ได้ของ PD4
--   (บัญชี mtn ไม่ได้ตั้ง section → ผ่านตัวกรองเสมอตามกติกา notify_recipients — ตั้งใจ ช่างดูแลทุกไลน์)
-- ความถี่ที่วัดได้: อย่างมาก 1 ข้อความ/ส่วนงาน/สัปดาห์ (~5 ข้อความ/สัปดาห์ทั้งโรงงาน)
--   → ต่ำพอเปิดกระดิ่ง/Push ได้ตามกฎ "วัดความถี่ก่อนเปิด inapp_roles"
insert into notification_rules (event_key, label, category, is_enabled, sort_order,
                                inapp_roles, inapp_match_section, channel_ids)
select 'shift_schedule_gap', '🗓️ ตารางกะกำลังจะหมด / หมดแล้ว', 'manpower', true, 330,
       array['supervisor','manager','admin','mtn']::text[], true,
       coalesce((select channel_ids from notification_rules
                  where category = 'manpower' and coalesce(array_length(channel_ids,1),0) > 0
                  order by sort_order limit 1), '{}'::uuid[])
where not exists (select 1 from notification_rules where event_key = 'shift_schedule_gap');

-- ── cron: ทุกวัน 00:30 UTC = 07:30 น. ไทย (ก่อนเริ่มกะเช้า หัวหน้าเห็นตอนมาถึง) ──
do $$ begin perform cron.unschedule('shift-schedule-gap-scan'); exception when others then null; end $$;
select cron.schedule('shift-schedule-gap-scan', '30 0 * * *', $cron$
  select public.fn_shift_schedule_scan();
$cron$);
