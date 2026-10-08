-- ══════════════════════════════════════════════════════════════════════════
-- EXP farming v2 — ตัวสูตร (Project: MAIN "MAIN" ewhdfqwfwofivojtsizn) · 2026-09-24
--
-- 🔴 หลักการ: คะแนน = "ตัวประมาณความน่าจะเป็นที่คนนี้รันสถานีได้ตามมาตรฐานโดยไม่ต้องมีคนคุม"
--    ไม่ใช่ "แต้มที่สะสมได้จากการมาทำงาน"  (v1 มี input ตัวเดียวคือ is_present)
--
-- 4 ขา (ที่มา + งานวิจัยอ้างอิง → docs/modules/employee-skills-exp.md §v2):
--   1) ปริมาณสะสม  — Wright (1936): เส้นโค้งเป็นฟังก์ชันของ "รอบสะสม" ไม่ใช่ "วัน" ⇒ ขั้นสูงกินมากขึ้นทบเท่า
--   2) คุณภาพ      — เป็น "ประตู" ไม่ใช่แต้มลบ (ของเสียเป็นของทั้งสาย โทษรายคนไม่ได้)
--   3) หลากหลาย/ผิดปกติ — Dreyfus (1980): competent → proficient ต้องเจอของผิดปกติจริง
--   4) การรับรอง   — OJT / เคยเป็นผู้สอน / เอกสาร (ISO 9001 §7.2 ต้องประเมินประสิทธิผล)
--
-- 🔴 rebuild ทั้งก้อนทุกคืน ไม่ใช่บวกสะสมทีละวัน ⇒ idempotent โดยโครงสร้าง
--    บั๊กคลาส "รันซ้ำแล้วบวกซ้ำ" ที่เคยเกิดกับ v1 เกิดไม่ได้เลย · ทุกค่าเป็น derived ไม่มี state ค้าง
--    (ข้อมูลจริง 24/09: attendance 13,183 แถว · rollup 1,317 แถว — rebuild < 1 วินาที)
--
-- 🔴 shadow mode: skill_exp_config.is_enabled = false (default) ⇒ เขียนแค่ evidence.shadow_score
--    **ไม่แตะ employee_skills.score** · v1 ทำงานต่อเหมือนเดิมทุกประการ → เทียบผลก่อนสลับได้
--
-- 🔴 ขึ้นขั้น 25/50/75/100 ยังต้องผ่านคนอนุมัติเสมอ (band ถูก clamp ด้วย cur_band)
--    — จุดนี้คือสิ่งที่ทำให้ระบบอัตโนมัติยังตอบ auditor ได้
--
-- ⚠️ ไฟล์นี้รวมผลสุดท้ายของ migration ที่ apply จริง 5 ชุด (create or replace — ตัวสุดท้ายชนะ):
--    20260924_skill_exp_v2_engine_prep_main · _rebuild_fn_main · _rebuild_fn_v2_main ·
--    _rebuild_fn_v3_main · _apply_reeval_cron_main · 20260924_skill_reeval_hold_bucket_main
--
-- Rollback:
--   1) update skill_exp_config set is_enabled = false;   ← หยุดผลกระทบทันที (v1 ทำงานต่อ)
--   2) select cron.unschedule('skill-exp-rebuild'); select cron.unschedule('sync-station-output');
--   3) drop function if exists public.fn_skill_exp_rebuild(date);
--      drop function if exists public.fn_skill_exp_apply();
--      drop function if exists public.fn_skill_reeval_pending(boolean);
--      drop function if exists public.norm_line_key(text);
--   (ตารางจาก 20260924_skill_exp_v2_tables_main.sql เป็น additive — ทิ้งไว้ได้)
-- ══════════════════════════════════════════════════════════════════════════

-- ── 0. ค่าคงที่ของเส้นโค้ง (ยังคงกฎ: ตัวเลขเกณฑ์อยู่ในตาราง config ห้าม hardcode ในโค้ด) ──
-- band_cum_n = "cum_cycles / n_ref" ที่ต้องถึงเพื่อจบขั้นที่ n · ระยะห่างโตทบเท่า = รูปโค้ง Wright
--   0.1 จบขั้น 0 (ผ่าน OJT) ~2-4 วัน · 1.1 จบขั้น 1 (มาตรฐาน) ~4-8 สัปดาห์
--   4.1 จบขั้น 2 (แก้ปัญหาได้) ~3-6 เดือน · 12.1 จบขั้น 3 (ผู้เชี่ยวชาญ) ~1 ปีขึ้นไป
alter table public.skill_exp_config
  add column if not exists band_cum_0 numeric not null default 0.1,
  add column if not exists band_cum_1 numeric not null default 1.1,
  add column if not exists band_cum_2 numeric not null default 4.1,
  add column if not exists band_cum_3 numeric not null default 12.1,
  -- ⚠️ default false เพราะข้อมูล OJT ยังไม่ครบ (24/09: มีประวัติ OJT 66 จาก 231 คน)
  --    เปิดก่อน = เกือบทุกคนตกเกณฑ์ขั้นแรก · เปิดเมื่อ OJT ลงระบบครบแล้ว
  add column if not exists gate_25_needs_ojt boolean not null default false,
  -- v1 จำกัดคะแนนไม่ให้เกิน min_score ของสถานี — คงพฤติกรรมเดิมไว้ (ปิดได้ถ้าไม่ต้องการ)
  add column if not exists cap_by_min_score boolean not null default true;

alter table public.employee_skill_evidence
  add column if not exists next_level integer,
  add column if not exists cur_band   integer;

-- ── 1. เทียบชื่อไลน์ข้าม project (DR เขียน "SP-70 & 71" · Main เขียน "SP-70&71") ──────────
create or replace function public.norm_line_key(p text)
returns text language sql immutable parallel safe as $$
  select upper(regexp_replace(coalesce(p,''), '[\s\-_]', '', 'g'));
$$;

-- ── 2. rebuild หลักฐาน + shadow score ทั้งก้อน ───────────────────────────────────────
create or replace function public.fn_skill_exp_rebuild(p_asof date default null)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  cfg      public.skill_exp_config%rowtype;
  v_asof   date;
  v_rows   integer := 0;
  v_result text;
begin
  if auth.uid() is not null and not has_perm('skills:run_weekly_update') then
    raise exception 'permission denied: skill exp rebuild requires skills:run_weekly_update';
  end if;

  select * into cfg from public.skill_exp_config where id = 1;
  v_asof := coalesce(p_asof, (now() at time zone 'Asia/Bangkok')::date);

  with
  att as (
    select distinct dpl.employee_id, sr.skill_name, dpl.work_date,
      coalesce(dpl.shift, 'day') as shift,
      public.norm_line_key(w.line_name) as line_key,
      coalesce(sr.n_ref, cfg.n_ref_default) as n_ref, sr.min_score
    from daily_production_logs dpl
    join workstations w          on w.id::text = dpl.assigned_line::text
    join station_requirements sr on sr.station_id::text = dpl.assigned_line::text and sr.min_score >= 70
    where dpl.is_present = true and dpl.assigned_line is not null and dpl.work_date <= v_asof
  ),
  crew as (
    select public.norm_line_key(w.line_name) as line_key, dpl.work_date,
           coalesce(dpl.shift, 'day') as shift, count(distinct dpl.employee_id) as n
    from daily_production_logs dpl
    join workstations w on w.id::text = dpl.assigned_line::text
    where dpl.is_present = true and dpl.assigned_line is not null group by 1, 2, 3
  ),
  roll as (
    select public.norm_line_key(line_name) as line_key, work_date, shift,
           qty_ok, qty_ng, n_changeover, n_downtime, n_defect_ev, parts_seen
    from station_output_rollup
  ),
  fourm as (
    select public.norm_line_key(line_name) as line_key, work_date, count(*) as n
    from four_m_logs where line_name is not null group by 1, 2
  ),
  per_day as (
    select a.employee_id, a.skill_name, a.work_date, a.line_key, a.n_ref, a.min_score,
           coalesce(r.qty_ok, 0)::numeric / greatest(coalesce(c.n, 1), 1) as cycles,
           coalesce(r.qty_ok, 0) as line_ok, coalesce(r.qty_ng, 0) as line_ng,
           coalesce(r.n_changeover, 0) as changeover,
           coalesce(r.n_downtime, 0) + coalesce(r.n_defect_ev, 0) + coalesce(f.n, 0) as abnormal,
           coalesce(r.parts_seen, '{}'::text[]) as parts,
           (r.line_key is not null) as has_output
    from att a
    left join crew  c on c.line_key = a.line_key and c.work_date = a.work_date and c.shift = a.shift
    left join roll  r on r.line_key = a.line_key and r.work_date = a.work_date and r.shift = a.shift
    left join fourm f on f.line_key = a.line_key and f.work_date = a.work_date
  ),
  agg as (
    select employee_id, skill_name,
           round(sum(cycles))::bigint as cum_cycles,
           count(distinct work_date)  as days_worked,
           sum(changeover)::integer   as n_changeover,
           -- 🔴 นับ "จำนวนวันที่อยู่ตอนมีเหตุผิดปกติ" ไม่ใช่จำนวนใบ
           --    (นับใบ = ใบ downtime ของทั้งไลน์ทั้งกะ เฉลี่ย 123 ใบ/คน ⇒ ประตูผ่านฟรี ไม่ได้วัดอะไร)
           count(distinct work_date) filter (where abnormal > 0)::integer as n_abnormal_days,
           max(work_date) as last_worked_date, min(n_ref) as n_ref,
           max(min_score) as min_score, bool_or(has_output) as any_output,
           sum(line_ng) filter (where work_date > v_asof - cfg.quality_window_days) as my_ng,
           sum(line_ok + line_ng) filter (where work_date > v_asof - cfg.quality_window_days) as my_tot
    from per_day group by 1, 2
  ),
  parts as (
    select employee_id, skill_name, array_agg(distinct p) as parts_seen
    from (select employee_id, skill_name, unnest(parts) as p from per_day
          where array_length(parts, 1) is not null) u group by 1, 2
  ),
  my_lines as (select distinct employee_id, skill_name, line_key from per_day),
  base_ng as (
    select m.employee_id, m.skill_name,
           sum(r.qty_ng)::numeric / nullif(sum(r.qty_ok + r.qty_ng), 0) as base_ratio
    from my_lines m join roll r on r.line_key = m.line_key
    where r.work_date > v_asof - cfg.quality_window_days group by 1, 2
  ),
  ojt as (
    select employee_id, true as has_ojt, max(post_score) as post_score
    from ojt_training_attendees where employee_id is not null group by 1
  ),
  trainer as (
    select e.id as employee_id, true as is_trainer from employees e
    where exists (select 1 from ojt_trainings t where t.trainer_name is not null
                  and upper(btrim(t.trainer_name)) = upper(btrim(e.name)))
  ),
  cert as (
    select employee_id, skill_name, max(to_level) as certified_level
    from skill_level_up_requests where status = 'approved' group by 1, 2
  ),
  calc as (
    select a.employee_id, a.skill_name, a.cum_cycles, a.days_worked, a.n_changeover,
      a.n_abnormal_days, a.last_worked_date, a.min_score, a.any_output,
      coalesce(p.parts_seen[1:200], '{}'::text[]) as parts_seen,
      coalesce(o.has_ojt, false) as has_ojt, o.post_score as ojt_post_score,
      coalesce(tr.is_trainer, false) as is_trainer,
      coalesce(ct.certified_level, 0) as certified_level,
      coalesce(es.score, 0) as cur_score,
      (es.pending_level is not null) as has_pending,
      a.cum_cycles::numeric / nullif(a.n_ref, 0) as r,
      case when a.my_tot > 0 and bn.base_ratio > 0
           then round((a.my_ng::numeric / a.my_tot) / bn.base_ratio, 3) end as ng_ratio
    from agg a
    left join parts   p  on p.employee_id  = a.employee_id and p.skill_name  = a.skill_name
    left join base_ng bn on bn.employee_id = a.employee_id and bn.skill_name = a.skill_name
    left join ojt     o  on o.employee_id  = a.employee_id
    left join trainer tr on tr.employee_id = a.employee_id
    left join cert    ct on ct.employee_id = a.employee_id and ct.skill_name = a.skill_name
    left join employee_skills es on es.employee_id = a.employee_id and es.skill_name = a.skill_name
  ),
  gated as (
    select c.*, (c.ng_ratio is null or c.ng_ratio <= cfg.quality_max_ratio) as quality_ok from calc c
  ),
  banded as (
    select g.*,
      (case
        when cfg.gate_25_needs_ojt and not g.has_ojt then 0
        when coalesce(array_length(g.parts_seen, 1), 0) < cfg.gate_50_parts
          or g.n_changeover < cfg.gate_50_changeover or not g.quality_ok then 1
        when g.n_abnormal_days < cfg.gate_75_abnormal
          or (cfg.gate_75_needs_quality and not g.quality_ok) then 2
        when (cfg.gate_100_needs_trainer and not g.is_trainer) then 3
        else 4 end) as allowed_band,
      (case when g.r < cfg.band_cum_0 then 0 when g.r < cfg.band_cum_1 then 1
            when g.r < cfg.band_cum_2 then 2 when g.r < cfg.band_cum_3 then 3
            else 4 end) as cyc_band,
      (case when g.cur_score < 25 then 0 when g.cur_score < 50 then 1
            when g.cur_score < 75 then 2 when g.cur_score < 100 then 3
            else 4 end) as cur_band
    from gated g
  ),
  scored as (
    -- 🔴 band = least(ประตู, ปริมาณ, ขั้นปัจจุบัน) — cur_band คือสิ่งที่กัน "ข้ามขั้นเอง"
    --    ขึ้นขั้น 25/50/75/100 ต้องผ่านคนอนุมัติเสมอ (จุดที่ทำให้ตอบ ISO 9001 §7.2 ได้)
    select b.*,
      least(b.allowed_band, b.cyc_band, b.cur_band) as band,
      (array[0.0, cfg.band_cum_0, cfg.band_cum_1, cfg.band_cum_2, cfg.band_cum_3])
        [least(b.allowed_band, b.cyc_band, b.cur_band) + 1] as lo,
      (array[cfg.band_cum_0, cfg.band_cum_1, cfg.band_cum_2, cfg.band_cum_3, cfg.band_cum_3])
        [least(b.allowed_band, b.cyc_band, b.cur_band) + 1] as hi
    from banded b
  ),
  final as (
    select s.*,
      (case when s.band >= 4 then 100
            else (array[0, 25, 50, 75, 100])[s.band + 1]
                 + floor(least(1.0, greatest(0.0, (s.r - s.lo) / nullif(s.hi - s.lo, 0))) * 25)::integer
       end) as raw_score,
      (array[24, 49, 74, 99, 100])[s.band + 1] as band_ceiling,
      greatest(0, (v_asof - s.last_worked_date - cfg.grace_days)) / 7 * cfg.decay_per_week as decay,
      (case when s.cur_band < 4 and s.cyc_band > s.cur_band and s.allowed_band > s.cur_band
            then (array[25, 50, 75, 100])[s.cur_band + 1] end) as next_level
    from scored s
  )
  insert into employee_skill_evidence (
    employee_id, skill_name, cum_cycles, days_worked, parts_seen, n_changeover, n_abnormal,
    ng_ratio, quality_ok, has_ojt, ojt_post_score, is_trainer,
    shadow_score, certified_level, verified, gate_missing, next_level, cur_band,
    last_worked_date, updated_at
  )
  select f.employee_id, f.skill_name, f.cum_cycles, f.days_worked, f.parts_seen,
    f.n_changeover, f.n_abnormal_days, f.ng_ratio, f.quality_ok,
    f.has_ojt, f.ojt_post_score, f.is_trainer,
    -- 🔴 ไลน์ไม่มีข้อมูลยอดผลิต = ขา "ปริมาณ" ประเมินไม่ได้ ⇒ คืน null (= "ยังตัดสินไม่ได้")
    --    **ห้ามคืน 0** — 0 แปลว่า "วัดแล้วได้ศูนย์" ซึ่งไม่จริง · ถ้าเปิด LIVE จะกดคะแนนคนที่ทำงาน
    --    ไลน์ที่ยังไม่ลงระบบผลิตให้เหลือ 0 ทั้งที่เขาไม่ได้ทำอะไรผิด (กฎความซื่อสัตย์ของจอ)
    case when not f.any_output then null else
      greatest(f.certified_level,
        least(least(f.raw_score, f.band_ceiling) - f.decay,
              case when cfg.cap_by_min_score then f.min_score else 100 end))::integer end,
    f.certified_level,
    (f.any_output and f.allowed_band >= f.cur_band) as verified,
    (select coalesce(array_agg(m), '{}'::text[]) from (
       select unnest(array[
         case when not f.any_output then 'ไลน์นี้ยังไม่มีข้อมูลยอดผลิตในระบบ — ประเมินไม่ได้ (ไม่ใช่คะแนน 0)' end,
         case when cfg.gate_25_needs_ojt and not f.has_ojt then 'ยังไม่มีประวัติ OJT' end,
         case when f.allowed_band <= 1 and coalesce(array_length(f.parts_seen,1),0) < cfg.gate_50_parts
              then format('ผลิตมาแล้ว %s รุ่น (ต้องการ %s)', coalesce(array_length(f.parts_seen,1),0), cfg.gate_50_parts) end,
         case when f.allowed_band <= 1 and f.n_changeover < cfg.gate_50_changeover
              then format('เปลี่ยนรุ่น %s ครั้ง (ต้องการ %s)', f.n_changeover, cfg.gate_50_changeover) end,
         case when f.allowed_band <= 2 and f.n_abnormal_days < cfg.gate_75_abnormal
              then format('อยู่ตอนมีเหตุผิดปกติ %s วัน (ต้องการ %s)', f.n_abnormal_days, cfg.gate_75_abnormal) end,
         case when not f.quality_ok
              then format('ของเสียช่วงที่อยู่ สูงกว่าค่ากลางของไลน์ %sx (เพดาน %sx)', f.ng_ratio, cfg.quality_max_ratio) end,
         case when f.allowed_band <= 3 and cfg.gate_100_needs_trainer and not f.is_trainer
              then 'ยังไม่เคยเป็นผู้สอนในใบ OJT' end,
         case when f.has_pending then 'มีคำขอเลื่อนขั้นค้างอนุมัติอยู่' end
       ]) as m) x where m is not null),
    f.next_level, f.cur_band, f.last_worked_date, now()
  from final f
  on conflict (employee_id, skill_name) do update set
    cum_cycles = excluded.cum_cycles, days_worked = excluded.days_worked,
    parts_seen = excluded.parts_seen, n_changeover = excluded.n_changeover,
    n_abnormal = excluded.n_abnormal, ng_ratio = excluded.ng_ratio,
    quality_ok = excluded.quality_ok, has_ojt = excluded.has_ojt,
    ojt_post_score = excluded.ojt_post_score, is_trainer = excluded.is_trainer,
    shadow_score = excluded.shadow_score, certified_level = excluded.certified_level,
    verified = excluded.verified, gate_missing = excluded.gate_missing,
    next_level = excluded.next_level, cur_band = excluded.cur_band,
    last_worked_date = excluded.last_worked_date, updated_at = now();

  get diagnostics v_rows = row_count;
  v_result := format('rebuild %s: %s แถว (คน×สกิล) · mode=%s',
                     v_asof, v_rows, case when cfg.is_enabled then 'LIVE' else 'shadow' end);
  insert into skill_update_runs (run_kind, period_start, result) values ('exp_v2', v_asof, v_result)
  on conflict (run_kind, period_start) do update set ran_at = now(), result = excluded.result;
  return v_result;
end;
$function$;

revoke all on function public.fn_skill_exp_rebuild(date) from public, anon;
grant execute on function public.fn_skill_exp_rebuild(date) to authenticated, service_role;

-- ── 3. นำ shadow_score ไปใช้จริง (ทำงานเฉพาะเมื่อ skill_exp_config.is_enabled = true) ──
create or replace function public.fn_skill_exp_apply()
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  cfg      public.skill_exp_config%rowtype;
  v_upd    integer := 0;
  v_req    integer := 0;
  v_result text;
begin
  if auth.uid() is not null and not has_perm('skills:run_weekly_update') then
    raise exception 'permission denied: skill exp apply requires skills:run_weekly_update';
  end if;

  select * into cfg from public.skill_exp_config where id = 1;
  if not cfg.is_enabled then
    return 'shadow mode — ไม่แตะคะแนนจริง (เปิดที่ skill_exp_config.is_enabled)';
  end if;

  -- 1) อัพเดทคะแนนภายในขั้น (ข้ามแถวที่ประเมินไม่ได้ และแถวที่มีคำขอค้างอนุมัติ)
  with upd as (
    update employee_skills s
       set score = e.shadow_score, updated_at = now()
      from employee_skill_evidence e
     where e.employee_id = s.employee_id
       and e.skill_name  = s.skill_name
       and e.shadow_score is not null      -- null = ประเมินไม่ได้ ⇒ ปล่อยคะแนนเดิมไว้
       and s.pending_level is null         -- ค้างอนุมัติ = หยุดขยับ (กติกาเดิมของ v1)
       and s.score <> e.shadow_score
    returning 1
  ) select count(*) into v_upd from upd;

  -- 2) ยื่นคำขอเลื่อนขั้นให้คนที่ทั้งปริมาณและประตูผ่านแล้ว (ยังต้องมีคนอนุมัติเสมอ)
  with elig as (
    select e.employee_id, e.skill_name, e.next_level, coalesce(s.score, 0) as cur
    from employee_skill_evidence e
    left join employee_skills s on s.employee_id = e.employee_id and s.skill_name = e.skill_name
    where e.next_level is not null
      and e.shadow_score is not null
      and coalesce(s.pending_level, 0) = 0
      and not exists (select 1 from skill_level_up_requests q
                      where q.employee_id = e.employee_id and q.skill_name = e.skill_name
                        and q.status = 'pending')
  ), ins as (
    insert into skill_level_up_requests (employee_id, skill_name, from_score, to_level)
    select employee_id, skill_name, cur, next_level from elig
    returning employee_id, skill_name, to_level
  ), mark as (
    update employee_skills s set pending_level = i.to_level, updated_at = now()
    from ins i where s.employee_id = i.employee_id and s.skill_name = i.skill_name
    returning 1
  ) select count(*) into v_req from ins;

  v_result := format('apply: อัพเดทคะแนน %s แถว · ยื่นคำขอเลื่อนขั้น %s ใบ', v_upd, v_req);
  insert into skill_update_runs (run_kind, period_start, result)
  values ('exp_v2_apply', (now() at time zone 'Asia/Bangkok')::date, v_result)
  on conflict (run_kind, period_start) do update set ran_at = now(), result = excluded.result;
  return v_result;
end;
$function$;

revoke all on function public.fn_skill_exp_apply() from public, anon;
grant execute on function public.fn_skill_exp_apply() to authenticated, service_role;

-- ── 4. ประเมินคิวคำขอค้างใหม่ตามเกณฑ์ v2 ────────────────────────────────────────────
-- 🔴 p_dry_run = true เป็น default โดยตั้งใจ — ต้องดูรายงานก่อนเสมอ
-- 🔴 ใบที่ไม่ผ่าน = `rejected` + เหตุผลชัด **ห้าม delete ห้าม approved**
--    (กติกาเดียวกับตอนเคลียร์คิว 4M ค้างจากบั๊ก 2026-08-10 — docs/modules/four-m-workflow.md)
--    ต้องปิดใบ ไม่ใช่ปล่อยค้าง: pending_level ค้าง = หยุด farm ของคนนั้นถาวร
--    คนที่ถูกปฏิเสธจะถูกยื่นใหม่อัตโนมัติทันทีที่หลักฐานครบ (fn_skill_exp_apply)
-- 🔴 ถัง "hold" — ใบที่ระบบ **ประเมินไม่ได้** (ไลน์ยังไม่มีข้อมูลยอดผลิต) ต้องไม่ถูกปฏิเสธอัตโนมัติ
--    ปฏิเสธเพราะ "เราไม่มีข้อมูล" = โยนความผิดพลาดของระบบไปให้พนักงาน — ต้องให้คนตัดสิน
create or replace function public.fn_skill_reeval_pending(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pass integer := 0; v_fail integer := 0; v_hold integer := 0; v_done integer := 0;
  v_sample jsonb;
begin
  -- คนเท่านั้น (ไม่มี cron เรียก) — การปิดใบมีผลกับคนจริง
  if auth.uid() is null or not has_perm('skills:approve_levelup') then
    raise exception 'permission denied: reeval pending requires skills:approve_levelup';
  end if;

  create temp table _reeval on commit drop as
  select q.id, q.employee_id, q.skill_name, q.to_level,
    case
      when e.employee_id is not null and e.next_level is not null and e.next_level >= q.to_level then 'pass'
      when e.employee_id is not null and e.shadow_score is null then 'hold'
      else 'fail'
    end as verdict,
    case
      when e.employee_id is null then 'ไม่มีข้อมูลหลักฐาน (ไม่เคยลงเวลาที่สถานีที่ต้องใช้สกิลนี้)'
      when e.shadow_score is null then 'ไลน์นี้ยังไม่มีข้อมูลยอดผลิตในระบบ — ระบบประเมินไม่ได้ ต้องให้คนตัดสิน'
      else coalesce(nullif(array_to_string(
             array(select m from unnest(e.gate_missing) m
                   where m <> 'มีคำขอเลื่อนขั้นค้างอนุมัติอยู่'), ' · '), ''),
             'ปริมาณงานสะสมยังไม่ถึงขั้นถัดไป')
    end as reason
  from skill_level_up_requests q
  left join employee_skill_evidence e
    on e.employee_id = q.employee_id and e.skill_name = q.skill_name
  where q.status = 'pending';

  select count(*) filter (where verdict = 'pass'),
         count(*) filter (where verdict = 'fail'),
         count(*) filter (where verdict = 'hold')
    into v_pass, v_fail, v_hold from _reeval;

  select jsonb_agg(x) into v_sample from (
    select reason, count(*) as n from _reeval where verdict = 'fail' group by 1 order by 2 desc limit 8) x;

  if not p_dry_run then
    with rej as (
      update skill_level_up_requests q
         set status = 'rejected', reviewed_at = now(),
             reject_reason = format('ประเมินใหม่ตามเกณฑ์ EXP v2 (%s): %s',
                                    (now() at time zone 'Asia/Bangkok')::date, r.reason)
        from _reeval r
       where q.id = r.id and r.verdict = 'fail' and q.status = 'pending'
      returning q.employee_id, q.skill_name
    ), unfreeze as (
      -- ปลดล็อก pending_level เพื่อให้คนนั้นสะสมคะแนนต่อได้ (ไม่งั้นค้างถาวร)
      update employee_skills s set pending_level = null, updated_at = now()
      from rej where s.employee_id = rej.employee_id and s.skill_name = rej.skill_name
      returning 1
    ) select count(*) into v_done from unfreeze;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'pending_total', v_pass + v_fail + v_hold,
    'pass', v_pass, 'fail', v_fail, 'hold', v_hold,
    'rejected_now', v_done, 'top_reasons', coalesce(v_sample, '[]'::jsonb));
end;
$function$;

revoke all on function public.fn_skill_reeval_pending(boolean) from public, anon;
grant execute on function public.fn_skill_reeval_pending(boolean) to authenticated;

-- ── 5. cron ────────────────────────────────────────────────────────────────────────
-- ⚠️ pg_cron ใช้ UTC — เวลาไทยต้อง −7 ชม. (เคยตั้งผิดมาแล้ว ดู 20260713_skill_farming_server_side.sql)
-- 08:10 ไทย sync ยอดผลิตจาก DR → 08:25 ไทย rebuild หลักฐาน (หลัง v1 daily farm 08:20)
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin perform cron.unschedule('sync-station-output'); exception when others then null; end $$;
select cron.schedule('sync-station-output', '10 1 * * *', $cron$
  select net.http_post(
    url := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/sync-station-output',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"days":3}'::jsonb);
$cron$);

do $$ begin perform cron.unschedule('skill-exp-rebuild'); exception when others then null; end $$;
select cron.schedule('skill-exp-rebuild', '25 1 * * *', $cron$
  select public.fn_skill_exp_rebuild(); select public.fn_skill_exp_apply();
$cron$);
