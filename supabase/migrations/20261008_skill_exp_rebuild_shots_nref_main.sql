-- ══════════════════════════════════════════════════════════════════════════
-- EXP v2 — ตัวสูตร rebuild: ใช้ shots + n_ref ต่อสถานี (Project: MAIN) · 2026-10-08
--
-- เปลี่ยนจากเวอร์ชัน 24/09 (20260924_skill_exp_v2_engine_main.sql) 3 จุด:
--   1) ขา "ปริมาณ" ใช้ `station_output_rollup.shots` (จังหวะ) **ไม่ใช่ `qty_ok` (ชิ้น)**
--      — กฎเหล็ก "ชิ้น ≠ shot": งานคู่ปั๊มทีเดียวได้ 2 ชิ้น ⇒ นับชิ้นเป็นรอบ = สายปั๊มงานคู่เร็ว 2 เท่า
--   2) **เลิกหารจำนวนคนในกะ** — สายไหล: ชิ้นงานผ่านทุกสถานี ⇒ 1 shot = 1 รอบของคนที่สถานีนั้น
--      หารแค่ `station_requirements.parallel_staff` (สถานีที่หลายคนทำงานเดียวกันสลับกัน · default 1)
--   3) สะสมเป็น **`cum_ratio` = Σ (shots ÷ parallel_staff ÷ n_ref ของสถานีวันนั้น) รายวัน**
--      🔴 ห้ามสะสมเป็น "รอบ" แล้วหาร n_ref ตัวเดียวทีหลัง — คนหนึ่งสลับ 5-6 สถานีที่ n_ref
--         ต่างกันถึง 34 เท่า ⇒ เลือกตัวหารไม่ถูก (มีด่าน `skill-exp-no-manual-nref-divide`)
--
-- กฎเดิมคงไว้ทั้งหมด: rebuild ทั้งก้อน (idempotent) · shadow_score = null แปลว่าประเมินไม่ได้ ·
-- band = least(ประตู, ปริมาณ, ขั้นปัจจุบัน) ⇒ ขึ้นขั้นต้องมีคนอนุมัติเสมอ · certified_level เป็นพื้น
--
-- Rollback: `update skill_exp_config set is_enabled=false;` แล้ว apply ไฟล์
--           20260924_skill_exp_v2_engine_main.sql ซ้ำ (create or replace — ตัวหลังชนะ)
-- ══════════════════════════════════════════════════════════════════════════

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
      coalesce(sr.n_ref, cfg.n_ref_default) as n_ref,
      greatest(coalesce(sr.parallel_staff, 1), 1) as parallel_staff,
      sr.min_score
    from daily_production_logs dpl
    join workstations w          on w.id::text = dpl.assigned_line::text
    join station_requirements sr on sr.station_id::text = dpl.assigned_line::text and sr.min_score >= 70
    where dpl.is_present = true and dpl.assigned_line is not null and dpl.work_date <= v_asof
  ),
  roll as (
    select public.norm_line_key(line_name) as line_key, work_date, shift,
           qty_ok, qty_ng, shots, n_changeover, n_downtime, n_defect_ev, parts_seen
    from station_output_rollup
  ),
  fourm as (
    select public.norm_line_key(line_name) as line_key, work_date, count(*) as n
    from four_m_logs where line_name is not null group by 1, 2
  ),
  per_day as (
    -- 🔴 สายไหล: ชิ้นงานผ่านทุกสถานี ⇒ 1 shot = 1 รอบของคนที่สถานีนั้น **ไม่หารจำนวนคนในกะ**
    select a.employee_id, a.skill_name, a.work_date, a.line_key, a.n_ref, a.min_score,
           coalesce(r.shots, 0)::numeric / a.parallel_staff as shots_share,
           (coalesce(r.shots, 0)::numeric / a.parallel_staff) / nullif(a.n_ref, 0) as day_ratio,
           coalesce(r.qty_ok, 0) as line_ok, coalesce(r.qty_ng, 0) as line_ng,
           coalesce(r.n_changeover, 0) as changeover,
           coalesce(r.n_downtime, 0) + coalesce(r.n_defect_ev, 0) + coalesce(f.n, 0) as abnormal,
           coalesce(r.parts_seen, '{}'::text[]) as parts,
           (r.line_key is not null) as has_output
    from att a
    left join roll  r on r.line_key = a.line_key and r.work_date = a.work_date and r.shift = a.shift
    left join fourm f on f.line_key = a.line_key and f.work_date = a.work_date
  ),
  agg as (
    select employee_id, skill_name,
           round(sum(shots_share))::bigint as cum_cycles,
           sum(coalesce(day_ratio, 0))     as cum_ratio,
           count(distinct work_date)  as days_worked,
           sum(changeover)::integer   as n_changeover,
           -- นับ "จำนวนวันที่อยู่ตอนมีเหตุผิดปกติ" ไม่ใช่จำนวนใบ (นับใบ = ประตูผ่านฟรี)
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
    select a.employee_id, a.skill_name, a.cum_cycles, a.cum_ratio, a.days_worked, a.n_changeover,
      a.n_abnormal_days, a.last_worked_date, a.min_score, a.any_output,
      coalesce(p.parts_seen[1:200], '{}'::text[]) as parts_seen,
      coalesce(o.has_ojt, false) as has_ojt, o.post_score as ojt_post_score,
      coalesce(tr.is_trainer, false) as is_trainer,
      coalesce(ct.certified_level, 0) as certified_level,
      coalesce(es.score, 0) as cur_score,
      (es.pending_level is not null) as has_pending,
      a.cum_ratio as r,
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
    -- 🔴 band = least(ประตู, ปริมาณ, ขั้นปัจจุบัน) — cur_band กัน "ข้ามขั้นเอง"
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
    employee_id, skill_name, cum_cycles, cum_ratio, days_worked, parts_seen, n_changeover, n_abnormal,
    ng_ratio, quality_ok, has_ojt, ojt_post_score, is_trainer,
    shadow_score, certified_level, verified, gate_missing, next_level, cur_band,
    last_worked_date, updated_at
  )
  select f.employee_id, f.skill_name, f.cum_cycles, round(f.cum_ratio, 4), f.days_worked, f.parts_seen,
    f.n_changeover, f.n_abnormal_days, f.ng_ratio, f.quality_ok,
    f.has_ojt, f.ojt_post_score, f.is_trainer,
    -- 🔴 ไลน์ไม่มีข้อมูลยอดผลิต = ประเมินไม่ได้ ⇒ null **ห้ามคืน 0**
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
    cum_cycles = excluded.cum_cycles, cum_ratio = excluded.cum_ratio,
    days_worked = excluded.days_worked,
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
