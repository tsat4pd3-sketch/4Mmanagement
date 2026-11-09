/* 🗓️ เตือนตารางกะใกล้หมด — เลิกยิงทั้งโรงงานเพราะสาวหาเจ้าของไม่เจอ  (MAIN · 2026-11-09)

   ═══ อาการ ═══
   ใบ "ตารางกะหมดแล้ว — หน่วยงานสนับสนุน" ยิงถึง **57-59 คน ข้าม 11 ส่วนงาน** ทุกสัปดาห์
   (26/10 = 59 คน · 02/11 = 57 คน · อ่าน 3%) ทั้งที่หน่วยในใบกระทบคนจริง **3 คน**
   ⇒ หัวหน้า PD1 ได้ใบเรื่องตารางกะของ QA · ช่าง Die ได้เรื่องของ PD4 = "แจ้งเตือนมั่วแผนก"

   ═══ ต้นเหตุ (ไม่ใช่ที่ทะเบียนผู้รับ) ═══
   `sec` คำนวณจาก `coalesce(pl.section, pp.section)` = ไลน์ของตัวเอง → ไลน์แม่ เท่านั้น
   แถวที่ผูก **แกนเก่า `shift_schedules.dept_name`** ไม่มี `line_id` ⇒ ไม่มีไลน์ ⇒ `sec = null`
   ตัวส่งจึงยิง `'section', null` → ใน `notify_recipients` เงื่อนไข
       and (not r.match_sec or p_section is null or ...)
   ทำให้ **`p_section is null` ข้ามตัวกรองส่วนงานทั้งก้อน** (fail-open ที่ตั้งใจไว้สำหรับ
   "ไม่รู้ขอบเขต") — แต่ที่นี่ null ไม่ได้แปลว่าไม่รู้ มันคือ "กลุ่มหน่วยที่ยังสาวไม่ถึง"
   🔑 ทะเบียนตั้ง `inapp_match_section=true` ไว้ถูกแล้ว · แก้ทะเบียน/`scope_strict` ไม่ช่วยอะไร

   ═══ แก้ ═══
   สาวหาส่วนงานเจ้าของให้ครบ **4 ชั้น** ก่อนยอมแพ้ (เดิมมี 2):
     ① ไลน์ของตัวเอง  ② ไลน์แม่
     ③ ชื่อหน่วยตรงกับทะเบียนไลน์ — หน่วยสนับสนุนย้ายเข้าทะเบียนแล้ว (`unit_kind='support'` · 05/11)
        ชื่อซ้ำกันพอดี **7/11 หน่วย**: Inspection·PQA-Press·PQA-Incoming·QA Measuring & Testing·
        QA Improvement & Service → QA · Electric → Maintenance · GOR → PD4
     ④ ส่วนงานของ **คนที่จะหลุดตารางกะ** เอง — BIG PRESS·SMALL PRESS (1+1 คน) → PD1
   🔴 **ยัง fail-open:** สาวไม่ถึงจริง = `sec` ยัง null = ใบยังยิงทั้งโรงงาน **ห้ามทำให้เงียบ**
      (เงียบ = คนหลุดตารางกะแล้วไม่มีใครรู้ · จอขึ้น 0 คน · PPE 0/0)

   ═══ พิสูจน์ก่อน apply (รัน CTE เปล่า ไม่ยิงอะไร) ═══
   | ส่วนงาน | ก่อน หน่วย/คน | หลัง หน่วย/คน |
   |---|---|---|
   | 🔴 NULL (ยิง 57 คน) | 11 / 3 | **2 / 0 → ไม่ส่ง** |
   | Maintenance | 1 / 2 | 2 / 2 |
   | PD1 | 5 / 30 | 7 / **32** |
   | PD2 | 6 / 20 | 6 / 20 |
   | PD3 | 13 / 69 | 13 / 69 |
   | PD4 | 7 / 51 | 8 / 51 |
   | QA | 5 / 42 | 10 / **43** |
   **คนกระทบรวม 217 = 217 เท่าเดิมเป๊ะ** — ไม่มีหน่วยหาย ไม่มีนับซ้ำ
   bucket null เหลือ 2 หน่วยที่กระทบ 0 คน ⇒ ถูก `having sum(affected) > 0` ตัดอยู่แล้ว

   ═══ 🔴 สิ่งที่ทำให้เรื่องนี้ร้ายกว่าที่เห็น — ใบค้างนิรันดร์ ═══
   ทะเบียนกันเตือนซ้ำ `shift_schedule_alerts` บอกว่า:
     · `sec:—` (ถังว่าง) ยิงติดกัน **10 สัปดาห์** W36 → W45 ไม่เคยหยุด
     · รายส่วนงานยิงแค่ W36-W37 แล้วหยุด (sec:PD3 ยิงครั้งเดียว)
   เพราะหน่วยจริงถูก "ต่อตารางกะ" ไปแล้วจึงหลุดเกณฑ์ — แต่หน่วยในถังว่างเป็นแถว
   **แกนเก่า `dept_name` ที่ไม่มีอยู่ในทะเบียนไลน์** ⇒ ไม่มีจอไหนต่อให้ได้
   ⇒ ค้าง overdue ตั้งแต่ 30/08 แล้วเตือน 57 คนทุกสัปดาห์เรื่องที่ไม่มีใครแก้ได้

   ⚠️ **ตรวจแล้วว่าไม่ได้ย้ายใบค้างไปโผล่ส่วนงานอื่น** — วัดด้วยตัวกรอง "ถึงกำหนด"
      (`last_date < วันนี้+14`) ซึ่งเป็นเกณฑ์จริงของฟังก์ชัน:
        | ส่วนงาน | หน่วยถึงกำหนด | คนกระทบ | ผล |
        |---|---|---|---|
        | NULL | 2 (แกนเก่าทั้งคู่) | 0 | ไม่ส่ง |
        | PD4  | 1 (แกนเก่า)       | 0 | ไม่ส่ง |
      ⇒ หลังแก้ **ไม่มีใบไหนถูกส่งเลย** เพราะหน่วยที่ถึงกำหนดไม่มีคนสังกัด
      (`having sum(affected) > 0` ตัดให้อยู่แล้ว) · ไม่มีส่วนงานไหนได้ใบค้างใหม่

   ⚖️ **ความซื่อสัตย์ของตัวเลข:** ใบ W45 (02/11) รายงาน 48 คน แต่วันนี้ถังว่างเหลือ 0 คน
      ⇒ ส่วนหนึ่งที่เงียบลงมาจาก**ทีมวางแผนต่อตารางกะเอง**ในสัปดาห์นี้ ไม่ใช่ผลของ migration นี้
      ผลของ migration นี้คือ **"ถึงมีใบใหม่ ก็จะไปที่ส่วนงานเจ้าของ ไม่ยิงทั้งโรงงานอีก"**

   🧹 ยังเหลือที่ไม่ได้แตะ (เป็นข้อมูล ไม่ใช่โค้ด — ต้องให้ user ตัดสิน):
      แถว `shift_schedules` บนแกนเก่า `dept_name` 11 หน่วย ยังค้างอยู่และไม่มีจอไหนแก้ได้
      (CLAUDE.md: "🔴 `shift_schedules.dept_name` = แกนเก่า ห้ามเพิ่มชื่อใหม่")
      · 7 หน่วยมีตัวจริงในทะเบียนไลน์แล้ว = แถวซ้ำซ้อน · BIG PRESS/SMALL PRESS/LWRBAR/ทั่วไป ไม่มี
      · **ห้ามลบเอง** — ลบตารางกะคือลบ "ใครเข้ากะไหน" ย้อนหลัง

   ⏪ ย้อนกลับ: รัน `fn_shift_schedule_scan` เวอร์ชันใน
      `supabase/migrations/20260828_shift_schedule_gap_alert.sql` (บรรทัด 46-162) ซ้ำ
      — ไฟล์นี้แก้เฉพาะนิพจน์ `sec` + เพิ่ม left join `dn`/`dnp` ไม่แตะส่วนอื่นของฟังก์ชัน
      (grant ไม่เกี่ยว: `20261012_mtn_sec_revoke_scan_and_email_oracle_main.sql` ถอน
       execute จาก authenticated ไว้แล้ว cron วิ่งด้วย postgres — ไฟล์นี้ไม่คืน grant)
   ⚙️ หมายเหตุ: ตัวคั่นบรรทัดเขียน `chr(10)` แทน `E'\n'` เดิม (ผลเหมือนกันเป๊ะ)
      — กัน escape เพี้ยนตอนส่ง SQL ผ่าน JSON/heredoc ซึ่งเคยทำพลาดมาแล้ว
   📄 docs/modules/notify-inapp-audit.md §รอบ 6                                             */
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
        /* 🔴 สาวหาส่วนงานเจ้าของให้ครบ 4 ชั้น ก่อนยอมแพ้ (แก้ 2026-11-09)
           เดิมมีแค่ 2 ชั้นแรก ⇒ แถวแกนเก่า `dept_name` (ไม่มีไลน์) ได้ sec = null
           ⇒ ตัวส่งยิง `section: null` ⇒ ใน notify_recipients เงื่อนไข `or p_section is null`
              **ข้ามตัวกรองส่วนงานทั้งก้อน** ⇒ ใบเดียวถึง 57-59 คน ข้าม 11 ส่วนงาน ทุกสัปดาห์
              (วัดจริง 26/10 = 59 คน · 02/11 = 57 คน · อ่าน 3%) ทั้งที่กระทบคนจริงแค่ 3 คน    */
        coalesce(pl.section, pp.section,                    -- ① ไลน์ของตัวเอง → ② ไลน์แม่
                 dn.section, dnp.section,                   -- ③ ชื่อหน่วยตรงกับทะเบียนไลน์ (+แม่ของมัน)
                 (select e3.section                         -- ④ ส่วนงานของ "คนที่จะหลุดตารางกะ" เอง
                    from employees e3
                   where e3.is_active and e3.section is not null
                     and case when u0.dept_name is not null
                              then e3.line_id is null
                               and lower(trim(e3.department)) = lower(trim(u0.dept_name))
                              else e3.line_id = u0.line_id end
                   group by e3.section
                   order by count(*) desc, e3.section        -- ทายผลซ้ำได้ ไม่สุ่ม
                   limit 1)
        )                                                   as sec,
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
      /* ③ หน่วยบนแกนเก่า `dept_name` ที่ย้ายเข้าทะเบียนไลน์แล้ว (unit_kind='support' · 05/11)
            — ชื่อซ้ำกันพอดี 7/11 หน่วย เช่น Inspection/PQA-* → QA · Electric → Maintenance */
      left join production_lines dn
             on u0.line_id is null
            and lower(trim(dn.name)) = lower(trim(u0.dept_name))
            and dn.is_active is not false
      left join production_lines dnp on dnp.name = dn.parent_line_name
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
        end, chr(10) order by rn)                             as body
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
