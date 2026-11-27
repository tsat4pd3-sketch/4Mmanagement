-- ═══ แกน C รายสัปดาห์คิด "ค่า OT" — ค่าแรงมาตรฐานตัวเดียวระดับโรงงาน + rollup ปีนับวัน OT แยกชนิด (2026-11-26 · คำสั่ง user "ใช้ 50 บาทไปก่อน ทำเลย")
-- project: MAIN (ewhdfqwfwofivojtsizn) · ย้อนได้: ตารางใหม่ (drop ได้) · RPC = create or replace เพิ่มฟิลด์ (ฟิลด์เดิมคงอยู่)
-- 🔴 RPC คืน "จำนวน" เท่านั้น — ชั่วโมง/ตัวคูณ/บาท คิดใน JS (`src/utils/otCost.js`) ห้ามย้ายสูตรลง SQL (กฎ OBEYA: RPC ห้ามคำนวณ KPI)

-- ── 1) ค่าแรงมาตรฐาน OT (บาท/ชม.) — ตัวเลขเดียวทั้งโรงงาน "ประมาณการเพื่อให้เห็นภาพ ไม่ใช่ต้นทุนบัญชี" ──
create table if not exists public.obeya_cost_settings (
  id               text primary key default 'default',
  ot_wage_per_hour numeric not null default 50 check (ot_wage_per_hour >= 0),
  note             text,
  updated_by       uuid,
  updated_by_name  text,
  updated_at       timestamptz not null default now()
);
comment on table public.obeya_cost_settings is 'ตั้งค่าต้นทุนบนบอร์ด Obeya — ot_wage_per_hour = ค่าแรงมาตรฐาน OT บาท/ชม. ตัวเดียวทั้งโรงงาน (ประมาณการให้หน้างานเห็นภาพ ไม่ใช่ตัวเลขบัญชี · user 26/11)';
insert into public.obeya_cost_settings (id) values ('default') on conflict (id) do nothing;

alter table public.obeya_cost_settings enable row level security;
do $$ begin
  create policy obeya_cost_settings_read on public.obeya_cost_settings for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy obeya_cost_settings_write on public.obeya_cost_settings for all
    using (has_perm('kpi:manage')) with check (has_perm('kpi:manage'));
exception when duplicate_object then null; end $$;
grant select on public.obeya_cost_settings to anon, authenticated;
grant insert, update, delete on public.obeya_cost_settings to authenticated;
grant all on public.obeya_cost_settings to service_role;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_obeya_cost_settings_updated') then
    create trigger trg_obeya_cost_settings_updated before update on public.obeya_cost_settings
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit')
     and not exists (select 1 from pg_trigger where tgname = 'trg_audit' and tgrelid = 'public.obeya_cost_settings'::regclass) then
    create trigger trg_audit after insert or update or delete on public.obeya_cost_settings
      for each row execute function public.fn_audit();
  end if;
end $$;

-- ── 2) rollup ปี: นับวัน OT แยกชนิด (JS คูณชั่วโมง/ตัวคูณเอง) · ฟิลด์เดิม n/present/ppe_ok/ot คงอยู่ ──
--      ot_day = กะเช้า OT ปกติ · ot_ext = กะเช้า OT ขยาย · ot_night = กะดึก OT · ot_hol15/ot_hol2 = OT ในวันที่ปฏิทินมาร์ค ot15/ot2 (นับก่อน ไม่ซ้ำกับ 3 ตัวแรก)
create or replace function public.obeya_attendance_rollup(p_from date, p_to date)
returns jsonb language sql stable set search_path to 'pg_catalog', 'public' as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  from (
    select to_char(l.work_date, 'YYYY-MM') as m,
           l.assigned_line as line,
           count(*) as n,
           count(*) filter (where l.is_present) as present,
           count(*) filter (where l.is_present and l.has_helmet and l.has_boots and l.has_gloves) as ppe_ok,
           count(*) filter (where l.has_ot or l.has_extended_ot) as ot,
           count(*) filter (where (l.has_ot or l.has_extended_ot) and c.day_type = 'ot15') as ot_hol15,
           count(*) filter (where (l.has_ot or l.has_extended_ot) and c.day_type = 'ot2')  as ot_hol2,
           count(*) filter (where (l.has_ot or l.has_extended_ot) and coalesce(c.day_type, 'working') not in ('ot15', 'ot2') and l.shift = 'night') as ot_night,
           count(*) filter (where l.has_extended_ot and coalesce(c.day_type, 'working') not in ('ot15', 'ot2') and coalesce(l.shift, '') <> 'night') as ot_ext,
           count(*) filter (where l.has_ot and not coalesce(l.has_extended_ot, false) and coalesce(c.day_type, 'working') not in ('ot15', 'ot2') and coalesce(l.shift, '') <> 'night') as ot_day
    from public.daily_production_logs l
    left join public.company_calendar c on c.work_date = l.work_date
    where l.work_date between p_from and p_to
    group by 1, 2
  ) r;
$$;

-- ตรวจผล:
-- select ot_wage_per_hour from obeya_cost_settings;  → 50
-- select * from jsonb_to_recordset(obeya_attendance_rollup('2026-11-01','2026-11-30')) as x(m text, line text, n int, ot int, ot_day int, ot_ext int, ot_night int, ot_hol15 int, ot_hol2 int) limit 5;
-- ROLLBACK: drop table public.obeya_cost_settings; แล้ว restore ตัว RPC เดิม (เวอร์ชันใน 20261019? — ฟิลด์ใหม่ไม่กระทบจอเก่า ปล่อยไว้ได้)
