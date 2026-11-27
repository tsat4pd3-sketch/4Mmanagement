/* ══ 🏠 แจ้งตำแหน่งประจำ — ไม่แจ้งหน่วยสนับสนุน + แก้ประเภทหน่วย 2 ตัว (2026-11-20 · คำสั่ง user · project MAIN) ══
   1) ทะเบียนไลน์ตั้งสลับกับของจริง (user ยืนยัน 20/11):
      Office PD4 = สำนักงาน (สร้างไว้ให้เช็คชื่อ) → support · Finishing - PD1 = ไลน์ขัดงานส่วนงาน PD1 → production
      (ทั้งคู่ไม่มีกะผลิตฝั่ง DR · จอ /management ส่ง includeSupport แล้ว ⇒ ออฟฟิสยังวางคนได้)
   2) fn_home_position_scan ข้ามหน่วย unit_kind = 'support'
   ย้อนกลับ: ท้ายไฟล์                                                                                 */

update public.production_lines set unit_kind = 'support'    where name = 'Office PD4';
update public.production_lines set unit_kind = 'production' where name = 'Finishing - PD1';

create or replace function public.fn_home_position_scan(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_week  text := to_char((now() at time zone 'Asia/Bangkok')::date, 'IYYY-"W"IW');
  v_sent  int  := 0;
  v_skip  int  := 0;
  v_noline int := 0;
  r       record;
  v_url   text := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-event-notification';
begin
  -- คนที่ชี้ไลน์ไม่ได้ (จุดไม่มี line_name) = นับไว้รายงาน ห้ามเงียบ
  select count(*) into v_noline
  from (
    select distinct on (d.employee_id) d.employee_id, d.assigned_line
    from daily_production_logs d
    where d.work_date >= v_today - p_days and d.is_present and d.assigned_line ~ '^[0-9a-f-]{36}$'
    order by d.employee_id, d.work_date desc
  ) l
  join employees e on e.id = l.employee_id and e.is_active
  left join workstations w on w.id::text = l.assigned_line
  where w.line_name is null
    and not exists (select 1 from employee_home_positions h where h.employee_id = l.employee_id);

  for r in
    with last_st as (
      select distinct on (d.employee_id) d.employee_id, d.assigned_line, d.work_date
      from daily_production_logs d
      where d.work_date >= v_today - p_days and d.is_present and d.assigned_line ~ '^[0-9a-f-]{36}$'
      order by d.employee_id, d.work_date desc
    ), cand as (
      select l.employee_id, e.name, e.employee_id_code, w.line_name, w.station_name, l.work_date,
             row_number() over (partition by w.line_name order by e.name) as rn
      from last_st l
      join employees e on e.id = l.employee_id and e.is_active
      join workstations w on w.id::text = l.assigned_line
      left join production_lines pl on pl.name = w.line_name
      where w.line_name is not null
        -- หน่วยสนับสนุน (สำนักงาน ฯลฯ) ไม่แจ้ง (คำสั่ง user 20/11) · ค่าว่าง/ไม่รู้จัก = ไลน์ผลิต ตาม utils/unitKind.js
        and coalesce(pl.unit_kind, 'production') <> 'support'
        and not exists (select 1 from employee_home_positions h where h.employee_id = l.employee_id)
    )
    select line_name, count(*)::int as n,
           greatest(count(*)::int - 8, 0) as more,
           string_agg(case when rn <= 8 then '• ' || coalesce(name, '-') || ' (' || coalesce(employee_id_code, '-')
                           || ') — ล่าสุด ' || coalesce(station_name, '-') end, chr(10) order by rn) as body
    from cand
    group by line_name
    order by count(*) desc
  loop
    begin
      insert into home_position_alerts (scope_key, week_key, detail)
      values ('line:' || r.line_name, v_week, jsonb_build_object('people', r.n));
    exception when unique_violation then
      v_skip := v_skip + 1;
      continue;
    end;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'event',     'home_position_missing',
        'title',     '🏠 ยังไม่มีตำแหน่งประจำ ' || r.n || ' คน — ' || r.line_name,
        'line_name', r.line_name,
        'type',      'info',
        'ref_table', 'employee_home_positions',
        'link',      '/management',
        -- ⚠️ สรุป + สิ่งที่ต้องทำไว้ก่อนลิสต์ (ในแอปตัด body ที่ 300 ตัวอักษร)
        'lines',     to_jsonb(array_remove(array[
                       r.n || ' คน ยืนจุดงานใน ' || p_days || ' วันล่าสุด แต่ยังไม่มีตำแหน่งประจำ',
                       '👉 ตั้งที่ จัดการไลน์ผลิต → กดจุดงาน → บันทึกตำแหน่งประจำ',
                       '',
                       r.body,
                       case when r.more > 0 then '+ อีก ' || r.more || ' คน' end
                     ], null)),
        'vars',      jsonb_build_object('people', r.n)
      )
    );
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('sent', v_sent, 'skipped_same_week', v_skip,
                            'no_line_people', v_noline, 'week', v_week, 'days', p_days);
end $fn$;

revoke execute on function public.fn_home_position_scan(int) from public, anon, authenticated;

/* ── ย้อนกลับ (MAIN) ──
   update public.production_lines set unit_kind = 'production' where name = 'Office PD4';
   update public.production_lines set unit_kind = 'support'    where name = 'Finishing - PD1';
   แล้วรันฟังก์ชันจากไฟล์ 20261119_home_position_missing_notify_main.sql อีกรอบ (ตัวไม่กรอง support)
*/
