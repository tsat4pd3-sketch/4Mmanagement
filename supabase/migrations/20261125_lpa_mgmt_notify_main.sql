/* ═══════════════════════════════════════════════════════════════════════════
   🔔 แจ้งเตือน LPA ชั้นบริหาร + ไลน์ที่ยังไม่มีแผน          2026-11-25
   project: MAIN (ewhdfqwfwofivojtsizn — ชื่อในจอ Supabase = "MAIN")

   คำสั่ง user 23/11: *"ตอนี้ ต้องไล่แจ้ง / แจ้งเตือนอนุมัติเอกสารพวกนี้ด้วยนะ
                        ตอนนี้เรายังแทบไม่ได้ตรวจ lpa หรือเซ็นอนุมัติอะไรเลย"*

   ── 🔴 บทเรียนของคอมมิทนี้: session ขนานทำครึ่งแรกไปแล้ว ───────────────────────
   ร่างแรก (24/11) ทำครบ 5 กฎรวมชั้น leader ด้วย · ตอนกลับมาเช็คฐานวันที่ 25/11 เจอว่า
   **มี `lpa_missed` + `fn_lpa_missed_scan()` + cron `lpa-missed-scan` (08:40 ไทย) อยู่แล้ว**
   และ **ยิงจริงเช้านี้ 40 แถว · 20 คน · 4 ไลน์** (ตอนคิวรีรอบแรก 24/11 ยังไม่มี)
   ⇒ ถ้าปล่อยร่างแรกลง = **กระดิ่ง 2 ใบเรื่องเดียวกันต่อวัน** ซึ่งเป็นคลาสบั๊กที่
     `docs/modules/notify-inapp-audit.md` เตือนไว้ตรงๆ (คนเลิกอ่านทั้งกระดิ่ง)
   📌 **กฎที่ได้: ก่อนเพิ่มกฎใน `notification_rules` ต้องคิวรีฐานสดว่ามีกฎ/cron/ฟังก์ชัน
      ที่ครอบเรื่องนั้นอยู่แล้วไหม — และคิวรีซ้ำอีกครั้งตอนจะ merge** (session ขนานแทรกได้)

   ── แบ่งเขตกับของเดิมให้ไม่ทับกัน ───────────────────────────────────────────
   | เรื่อง                                   | เจ้าของ                        |
   |------------------------------------------|--------------------------------|
   | ชั้น **Leader** ขาดตรวจ (เมื่อวาน · รายวัน) | `lpa_missed` (ของเดิม — ไม่แตะ) |
   | ชั้น **SV / ผจก. / GM** ถึงกำหนดวันนี้       | `lpa_due_mgmt` (ไฟล์นี้)        |
   | ชั้น **SV / ผจก. / GM** ค้างสะสมในเดือน     | `lpa_overdue_mgmt` (ไฟล์นี้)    |
   | **ไลน์รากที่ยังไม่มีแผน**เดือนนี้            | `lpa_no_plan` (ไฟล์นี้)         |
   🔴 **ห้ามเพิ่มกฎชั้น leader ที่นี่** — ของเดิมครอบแล้ว (ตารางนี้คือเส้นแบ่ง)

   ── ทำไมต้องมีชั้นบริหาร (วัดจริง 24/11 · แผนเดือน 2026-11 เฉพาะวันทำงานที่ผ่านมา) ──
     ชั้น supervisor  ตรวจ 40/63 → ขาด 23
     ชั้น manager     ตรวจ  0/15 → **ขาด 15 (ไม่เคยตรวจเลยทั้งเดือน)**
   `fn_lpa_missed_scan` มองแค่ **ชั้น leader + เมื่อวานวันเดียว** ⇒ 2 ชั้นนี้เงียบสนิท
   และวันที่ขาดไปแล้วเกิน 1 วัน **ไม่มีอะไรพูดถึงอีกเลย** ⇒ ต้องมีตัวสะสมรายสัปดาห์

   ── ไลน์ที่ยังไม่มีแผน (วัดจริง 24/11) ────────────────────────────────────────
   ไลน์ราก 8 ไลน์ไม่มีแผน LPA เดือนนี้: **PD1 ทั้งส่วนงาน 5 ไลน์** (Finishing · LINE A/B/C/D)
   · PD2 2 (Assembly Line B - FORD · SPARE PART) · PD3 1 (LINE APRON ASSY)
   **ไม่มีแผน = ไม่มีอะไรบอกได้ด้วยซ้ำว่าขาดตรวจกี่วัน** — `lpa_missed` มองจากแผน
   ⇒ ไลน์ที่ไม่มีแผนจะ "เงียบเพราะไม่มีแผน" ไม่ใช่ "เงียบเพราะตรวจครบ"
   🔴 **นับเฉพาะไลน์ราก** (`parent_line_name is null`) — ไลน์ลูกถือว่าแผนของไลน์แม่ครอบแล้ว
      (ของจริง: D2/D3/D5/D6 ใต้ Assembly Line D · HDF/LASER/BENDING ใต้ HYDROFORM
       ⇒ ถ้านับไลน์ลูกจะเตือนผิด 11 ไลน์)

   ── ซ่อม `lpa_missed` ของเดิม 2 จุด (ไม่เปลี่ยนพฤติกรรม แค่ให้ทะเบียนทำงาน) ──────
   1. **`title_match`** — ตัวส่งตั้ง title เอง ⇒ trigger `trg_notification_fill_link`
      เติม `event_key` ไม่ได้ · วัดจริง: 40/40 แถว `event_key is null`
      ⇒ **rollup ใช้ไม่ได้ · ป้ายราคาที่ /notification-config เป็น 0 ทั้งที่ยิงจริง**
      (กฎใน `docs/modules/edge-functions.md` §ป้ายราคา: ตัวส่งที่ตั้ง title เองต้อง seed title_match)
   2. **`inapp_rollup_min = 1440`** — เช้านี้ 4 ไลน์ = 40 แถวถึง 20 คน (คนละ 2 ใบ)
      ยุบแล้วเหลือ ~20 แถว · คนละ 1 ใบ/วัน (กฎ §8 ยุบกระดิ่งซ้ำ)

   ── 🔴 พลาดจริงรอบนี้ (เขียนไว้ให้ session หน้าไม่พลาดซ้ำ) ────────────────────
   ใส่ `title_match` ให้ `lpa_missed` ของคนอื่น **แต่ลืมใส่ให้ 3 กฎของตัวเอง**
   ⇒ ยิงรอบแรกจริง **124 แถว ถึง 29 คน `event_key` ว่างทั้ง 124** (rollup ไม่ทำงาน)
   ⇒ ลบ 124 แถวนั้น (ยังไม่มีใครอ่าน) → ใส่ `title_match` → ยิงใหม่ = **53 แถว**
     (`rollup_count` ขึ้นถึง 9) · รอบกะดึกต่อมาเพิ่มแค่ 4 แถว เพราะถูกยุบเข้าใบเดิม
   📌 **กฎ: กฎใหม่ที่ตัวส่งตั้ง title เอง = ต้องใส่ `title_match` ในคอมมิทเดียวกัน**
      ตรวจด้วย `select event_key from notification_rules where title_match is null`
      เทียบกับ label ที่ตัวส่งใช้จริง — ถ้า title ไม่เท่ากับ label เป๊ะ ต้องมี title_match

   ── กติกาที่ล็อกไว้ในฟังก์ชัน ───────────────────────────────────────────────
   · **ผู้รับคิดที่ `notify_recipients()` จุดเดียวตามกฎเหล็ก — ไฟล์นี้ไม่กรองผู้รับเอง**
     (ที่เรียก RPC = **นับเพื่อรายงานว่าข้อความไหนไม่ถึงใคร** ไม่ได้เอาไปตัดสินผู้รับ)
   · **"วันนี้" = วันทำงาน (`getWorkDate`)** = `(BKK now - 8 ชม.)::date` — กะดึกข้ามวัน
     ⇒ cron 2 รอบ: 14:00 ไทย = กะเช้า · 05:00 ไทย = กะดึกของวันทำงานที่เพิ่งจบ
   · **วันทำงาน** = `company_calendar.day_type='working'` **หรือ** ไม่มีแถว + จ-ศ
     (กฎเดียวกับ kanban/LPA) ⇒ วันหยุด/ot15/ot2/shutdown75 **ไม่นับว่าขาดตรวจ**
   · **ค้างสะสมนับแค่เดือนปัจจุบัน** — ใบ LPA เป็นฟอร์มรายเดือน เดือนที่ปิดแล้วไม่ไล่ย้อน
   · ตัวรายสัปดาห์ยิงวันจันทร์ (`isodow = 1`) · `p_force := true` เพื่อยิงมือ/ทดสอบ
   · `p_dry := true` = นับอย่างเดียวไม่ยิง (ใช้ตรวจก่อนเปิด cron)
   · 🔴 **ห้ามใส่ `exception when others then return null`** — อ่านฐานไม่ได้ต้องให้ cron
     บันทึกว่าล้ม ไม่ใช่เงียบแล้วตอบ ok (กฎ "ห้ามล้มเหลวเงียบ")
   · ลิงก์ใช้ route จริง `/daily-checker?tab=lpa&sub=…` (`/lpa` เป็น LegacyTabRedirect)
     + `&line=&shift=&date=` ลงใบตรงๆ (จออ่านครั้งเดียวตอนเปิด · ของกลางเดียวกับ `lpa_finding` N5)
     🔴 **ชื่อไลน์ต้อง encode** — มีช่องว่างและ `&` (เช่น 'Assembly Line D - GWM&RA')
       ไม่ encode = param ที่ตามหลังขาดหายเงียบๆ

   ── ย้อนกลับ (rollback) ─────────────────────────────────────────────────────
     select cron.unschedule('lpa-mgmt-scan-day');
     select cron.unschedule('lpa-mgmt-scan-night');
     drop function if exists public.fn_lpa_mgmt_scan(text, boolean, boolean);
     delete from notification_rules
      where event_key in ('lpa_due_mgmt','lpa_overdue_mgmt','lpa_no_plan');
     update notification_rules set title_match = null, inapp_rollup_min = null
      where event_key = 'lpa_missed';
   ═══════════════════════════════════════════════════════════════════════════ */

-- ── 0a) ล้างร่างแรกของคอมมิทนี้ที่ apply ไปแล้วเมื่อ 24/11 ก่อนรู้ว่ามีของเดิมอยู่ ──
--    (ชั้น leader ซ้ำกับ `lpa_missed` · ชื่อฟังก์ชันเดิม `fn_lpa_due_scan`)
--    🔴 ปลอดภัย: ทั้ง 2 คีย์ยังไม่เคยยิงเลย (`select count(*) from notifications
--       where event_key in (...)` = 0 ตอนล้าง) ⇒ ไม่มีกระดิ่งของใครหาย
delete from notification_rules
 where event_key in ('lpa_due_leader', 'lpa_overdue_leader');
drop function if exists public.fn_lpa_due_scan(text, boolean, boolean);
select cron.unschedule('lpa-due-scan-day')   where exists (select 1 from cron.job where jobname = 'lpa-due-scan-day');
select cron.unschedule('lpa-due-scan-night') where exists (select 1 from cron.job where jobname = 'lpa-due-scan-night');

-- ── 0b) ร่างแรกตั้ง link/ลำดับไว้คนละแบบ — ดันให้ตรงกับไฟล์นี้ (replay ซ้ำได้) ──
update notification_rules set link = '/daily-checker?tab=lpa',               sort_order = 423 where event_key = 'lpa_due_mgmt';
update notification_rules set link = '/daily-checker?tab=lpa&sub=report',    sort_order = 424 where event_key = 'lpa_overdue_mgmt';
update notification_rules set link = '/daily-checker?tab=lpa&sub=plan',      sort_order = 425 where event_key = 'lpa_no_plan';

-- ────────────────── 0c) ซ่อมทะเบียนของ `lpa_missed` (ของ session ขนาน) ──────────────────
update notification_rules
   set title_match      = '📋 LPA ขาดตรวจ — %',
       inapp_rollup_min = 1440
 where event_key = 'lpa_missed';

-- ───────────────────────────── 1) ทะเบียนกฎ 3 แถว ─────────────────────────────
/* 🔴 `title_match` บังคับทุกแถว — ตัวส่งตั้ง title เอง ⇒ trigger `trg_notification_fill_link`
      เติม `event_key` ได้ต่อเมื่อ title ตรงแพทเทิร์นนี้ · ไม่มี = `event_key` ว่าง
      ⇒ **rollup ไม่ทำงาน · ป้ายราคาที่ /notification-config เป็น 0**
      (พลาดจริงรอบนี้: ยิงรอบแรกได้ 124 แถว/29 คน · ใส่แล้วยิงใหม่เหลือ 53 แถว — ดูหัวไฟล์) */
insert into notification_rules
  (event_key, label, category, is_enabled, sort_order,
   inapp_roles, inapp_match_section, inapp_match_line, can_mute, inapp_rollup_min, link, title_match)
values
  ('lpa_due_mgmt',
   '📋 LPA ชั้น SV / ผจก. / GM ถึงกำหนดตรวจวันนี้ — ยังไม่บันทึกผล',
   'quality', true, 423,
   array['supervisor','engineer','manager']::text[], true, true, true, 1440,
   '/daily-checker?tab=lpa', '📋 LPA ถึงกำหนดตรวจวันนี้ — %'),

  ('lpa_overdue_mgmt',
   '🔴 LPA ชั้น SV / ผจก. / GM เลยกำหนด — เดือนนี้ตรวจไม่ครบ (เตือนทุกจันทร์)',
   'quality', true, 424,
   array['supervisor','engineer','manager']::text[], true, true, false, 1440,
   '/daily-checker?tab=lpa&sub=report', '🔴 LPA เลยกำหนด %'),

  ('lpa_no_plan',
   '🗓️ ไลน์ที่ยังไม่มีแผน LPA ของเดือนนี้ (เตือนทุกจันทร์)',
   'quality', true, 425,
   array['supervisor','manager']::text[], true, false, false, 1440,
   '/daily-checker?tab=lpa&sub=plan', '🗓️ ยังไม่มีแผน LPA เดือน %')
on conflict (event_key) do nothing;

-- replay-safe: แถวที่มีอยู่ก่อน (ร่างแรก 24/11 ไม่ได้ใส่ title_match) ต้องถูกดันให้ตรง
update notification_rules set title_match = '📋 LPA ถึงกำหนดตรวจวันนี้ — %' where event_key = 'lpa_due_mgmt'     and title_match is null;
update notification_rules set title_match = '🔴 LPA เลยกำหนด %'            where event_key = 'lpa_overdue_mgmt' and title_match is null;
update notification_rules set title_match = '🗓️ ยังไม่มีแผน LPA เดือน %'   where event_key = 'lpa_no_plan'      and title_match is null;

-- ─────────────────────────── 2) ตัวสแกน + ตัวส่ง ───────────────────────────
create or replace function public.fn_lpa_mgmt_scan(
  p_shift text default 'day',
  p_force boolean default false,
  p_dry   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  /* 🔴 วันทำงาน (getWorkDate) — ก่อน 08:00 ไทย = วันก่อนหน้า (กะดึกข้ามวัน)
     ห้ามใช้ current_date (= UTC) */
  v_wd       date := ((now() at time zone 'Asia/Bangkok') - interval '8 hours')::date;
  v_month    text;
  v_weekly   boolean;
  v_url      text := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-event-notification';
  v_shift    text := case when lower(coalesce(p_shift,'day')) = 'night' then 'night' else 'day' end;
  v_shift_th text;
  r          record;
  v_due      int := 0;
  v_over     int := 0;
  v_noplan   int := 0;
  v_norecv   int := 0;
  v_n        int;
begin
  v_month    := to_char(v_wd, 'YYYY-MM');
  v_weekly   := p_force or extract(isodow from v_wd) = 1;
  v_shift_th := case when v_shift = 'night' then 'กะดึก' else 'กะเช้า' end;

  /* เรียกซ้ำใน transaction เดียว (ทดสอบมือ 2 บรรทัดติดกัน) ต้องไม่ล้มเพราะตารางค้าง */
  drop table if exists _lpa_mgmt_miss;
  create temp table _lpa_mgmt_miss on commit drop as
  with d as (
    select p.line_name, p.shift,
           make_date(split_part(p.month_key, '-', 1)::int,
                     split_part(p.month_key, '-', 2)::int, pd.day) as dt,
           pd.plan_supervisor, pd.plan_manager, pd.plan_gm
      from lpa_plans p
      join lpa_plan_days pd on pd.plan_id = p.id
     where p.month_key = v_month
       and p.shift = v_shift
  ), flat as (
    /* 🔴 ชั้น leader ไม่อยู่ที่นี่ — `lpa_missed` ของเดิมเป็นเจ้าของ (ดูตารางเส้นแบ่งหัวไฟล์) */
    select line_name, shift, dt, layer, planned from (
      select line_name, shift, dt, 'supervisor'::text as layer, plan_supervisor as planned from d
      union all select line_name, shift, dt, 'manager', plan_manager from d
      union all select line_name, shift, dt, 'gm',      plan_gm      from d
    ) x
   where x.planned is true
  ), workdays as (
    select f.*
      from flat f
      left join company_calendar cc on cc.work_date = f.dt
     where f.dt <= v_wd
       and (cc.day_type = 'working'
            or (cc.work_date is null and extract(isodow from f.dt) between 1 and 5))
  )
  select w.line_name, w.shift, w.dt, w.layer
    from workdays w
    left join lpa_audits a
      on  a.line_name  = w.line_name
      and a.shift      = w.shift
      and a.audit_date = w.dt
      and a.layer      = w.layer
   where a.id is null;

  /* ── ① ถึงกำหนดวันนี้ ยังไม่บันทึก — ทุกวัน · 1 ไลน์ = 1 ข้อความ ── */
  for r in
    select m.line_name,
           string_agg(distinct m.layer, ', ' order by m.layer) as layers,
           count(*)::int as n
      from _lpa_mgmt_miss m
     where m.dt = v_wd
     group by m.line_name
     order by m.line_name
  loop
    select count(*) into v_n
      from notify_recipients('lpa_due_mgmt',
             (select pl.section from production_lines pl where pl.name = r.line_name),
             null, r.line_name);
    if coalesce(v_n, 0) = 0 then v_norecv := v_norecv + 1; end if;

    if not p_dry then
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
          'event',     'lpa_due_mgmt',
          'title',     '📋 LPA ถึงกำหนดตรวจวันนี้ — ' || r.line_name,
          'line_name', r.line_name,
          'type',      'info',
          'ref_table', 'lpa_audits',
          /* 🔗 ลงใบตรงๆ — จออ่าน ?line=&shift=&date= ครั้งเดียวตอนเปิด (ของกลางเดียวกับ lpa_finding N5)
             🔴 ชื่อไลน์ต้อง encode: มีช่องว่างและ `&` (เช่น 'Assembly Line D - GWM&RA') */
          'link',      '/daily-checker?tab=lpa&line=' || replace(replace(replace(replace(replace(r.line_name, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), ' ', '%20')
                         || '&shift=' || v_shift || '&date=' || to_char(v_wd, 'YYYY-MM-DD'),
          'lines',     to_jsonb(array[
                         '📅 ' || to_char(v_wd, 'DD/MM/YYYY') || ' · ' || v_shift_th
                           || ' · ชั้น ' || r.layers || ' ยังไม่มีใบตรวจ',
                         '👉 บันทึกที่ LPA → แท็บ ✅ บันทึกผลตรวจ',
                         'ถ้าไลน์ไม่ได้ผลิตวันนั้น ข้ามได้'
                       ]),
          'vars',      jsonb_build_object('count', r.n)
        ));
    end if;
    v_due := v_due + 1;
  end loop;

  /* ── ② ค้างสะสมในเดือน (วันก่อนหน้า) — เตือนทุกจันทร์ ── */
  if v_weekly then
    for r in
      select m.line_name,
             count(*)::int as n,
             min(m.dt) as first_dt,
             string_agg(distinct m.layer, ', ' order by m.layer) as layers,
             string_agg(to_char(m.dt, 'DD/MM'), ', ' order by m.dt) as days
        from _lpa_mgmt_miss m
       where m.dt < v_wd
       group by m.line_name
       order by count(*) desc
    loop
      select count(*) into v_n
        from notify_recipients('lpa_overdue_mgmt',
               (select pl.section from production_lines pl where pl.name = r.line_name),
               null, r.line_name);
      if coalesce(v_n, 0) = 0 then v_norecv := v_norecv + 1; end if;

      if not p_dry then
        perform net.http_post(
          url     := v_url,
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body    := jsonb_build_object(
            'event',     'lpa_overdue_mgmt',
            'title',     '🔴 LPA เลยกำหนด ' || r.n || ' วัน — ' || r.line_name,
            'line_name', r.line_name,
            'type',      'warning',
            'ref_table', 'lpa_audits',
            'link',      '/daily-checker?tab=lpa&sub=report&line=' || replace(replace(replace(replace(replace(r.line_name, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), ' ', '%20')
                           || '&shift=' || v_shift,
            'lines',     to_jsonb(array_remove(array[
                           'เดือน ' || v_month || ' · ' || v_shift_th || ' · ชั้น ' || r.layers
                             || ' — วางแผนไว้แต่ยังไม่มีใบตรวจ ' || r.n || ' วัน',
                           'ค้างมาตั้งแต่ ' || to_char(r.first_dt, 'DD/MM/YYYY'),
                           case when length(r.days) <= 180 then 'วันที่ขาด: ' || r.days end,
                           '👉 ดูช่องว่างทั้งเดือนที่ LPA → แท็บ 📊 รายงาน'
                         ], null)),
            'vars',      jsonb_build_object('count', r.n)
          ));
      end if;
      v_over := v_over + 1;
    end loop;
  end if;

  /* ── ③ ไลน์รากที่ยังไม่มีแผนเดือนนี้ — เตือนทุกจันทร์ · 1 ส่วนงาน = 1 ข้อความ
        (ยิงรอบกะเช้าเท่านั้น — แผนไม่ได้แยกตามกะที่สแกน ยิง 2 รอบก็ซ้ำเปล่าๆ) ── */
  if v_weekly and v_shift = 'day' then
    for r in
      select pl.section,
             count(*)::int as n,
             string_agg(pl.name, ' · ' order by pl.name) as names
        from production_lines pl
       where coalesce(pl.unit_kind, 'production') <> 'support'
         and pl.is_active
         and pl.parent_line_name is null        -- 🔴 ไลน์ลูก = แผนของไลน์แม่ครอบแล้ว
         and nullif(trim(pl.section), '') is not null
         and not exists (select 1 from lpa_plans p
                          where p.line_name = pl.name and p.month_key = v_month)
       group by pl.section
       order by count(*) desc
    loop
      select count(*) into v_n from notify_recipients('lpa_no_plan', r.section, null, null);
      if coalesce(v_n, 0) = 0 then v_norecv := v_norecv + 1; end if;

      if not p_dry then
        perform net.http_post(
          url     := v_url,
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body    := jsonb_build_object(
            'event',   'lpa_no_plan',
            'title',   '🗓️ ยังไม่มีแผน LPA เดือน ' || v_month || ' — ' || r.section
                         || ' ' || r.n || ' ไลน์',
            'section', r.section,
            'type',    'warning',
            'ref_table', 'lpa_plans',
            'link',    '/daily-checker?tab=lpa&sub=plan',
            'lines',   to_jsonb(array[
                         'ไม่มีแผนตรวจ = ไม่มีอะไรบอกได้ว่าขาดตรวจกี่วัน',
                         r.names,
                         '👉 วางแผนที่ LPA → แท็บ 📅 แผนตรวจ → ⚡ เติมแผนทั้งไตรมาส'
                       ]),
            'vars',    jsonb_build_object('count', r.n)
          ));
      end if;
      v_noplan := v_noplan + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'work_date', v_wd, 'month', v_month, 'shift', v_shift, 'weekly', v_weekly,
    'dry_run', p_dry,
    'due_today_msgs', v_due, 'overdue_msgs', v_over, 'no_plan_msgs', v_noplan,
    /* 🔴 ความซื่อสัตย์: ข้อความที่ส่งแล้วไม่ถึงใคร (ทะเบียนผู้ใช้ไม่มีคนในขอบเขตนั้น)
       ต้องรายงานออกมา ห้ามนับเป็นสำเร็จเงียบๆ — วัด 24/11 ได้ 3 ไลน์ที่ไม่มี supervisor */
    'msgs_with_no_recipient', v_norecv);
end $fn$;

comment on function public.fn_lpa_mgmt_scan(text, boolean, boolean) is
  'สแกน LPA ชั้น SV/ผจก./GM: ถึงกำหนดวันนี้ / ค้างสะสม (จันทร์) / ไลน์รากที่ยังไม่มีแผน (จันทร์) · ชั้น leader เป็นของ fn_lpa_missed_scan · ผู้รับคิดที่ notify_recipients จุดเดียว';

-- ───────────────────────────── 3) cron 2 รอบ ─────────────────────────────
-- 07:00 UTC = 14:00 ไทย → วันทำงานของกะเช้า (ยังเหลือเวลาไปตรวจก่อนเลิกกะ 17:30)
select cron.schedule('lpa-mgmt-scan-day',   '0 7 * * *',  $$select public.fn_lpa_mgmt_scan('day');$$);
-- 22:00 UTC = 05:00 ไทย → ยังอยู่ในวันทำงานเดิมของกะดึก (ก่อน 08:00 = วันก่อนหน้า)
select cron.schedule('lpa-mgmt-scan-night', '0 22 * * *', $$select public.fn_lpa_mgmt_scan('night');$$);
