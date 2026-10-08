-- ══════════════════════════════════════════════════════════════════════════
-- EXP v2 — n_ref ต่อสถานี (จาก CT จริง) + นับ "รอบ" ให้ถูกตามสายไหล
-- Project: MAIN "MAIN" ewhdfqwfwofivojtsizn · 2026-10-08
--
-- 🔴 ปัญหาที่แก้: n_ref เดิมเป็นค่าเดียวทั้งโรงงาน (2,000 รอบ) แต่ CT จริงห่างกัน **109 เท่า**
--    (LINE D 2.5 วิ/จังหวะ → GWM 272 วิ · วัด 08/10) ⇒ สถานี CT สั้นไต่ขั้นเร็วกว่าที่ควรหลายสิบเท่า
--
-- หลักที่ใช้: **"เวลาลงมือ" เท่ากัน ไม่ใช่ "จำนวนรอบ" เท่ากัน**
--    n_ref (รอบ) = ref_hours × 3600 ÷ CT   ⇒ ทุกสถานีใช้เวลาฝึกเท่ากันถึงจะขึ้นขั้น
--    ref_hours = 120 ชม. ≈ 16 กะลงมือ → เพดานขั้น 1 (1.1×) ≈ 4-6 สัปดาห์ ตรงตารางใน
--    docs/SKILL-EXP-ALGORITHM-DESIGN.md §3 · ขั้น 2 ≈ 4-5 เดือน · ขั้น 3 ≈ 13-15 เดือน
--
-- 🔴 นับ "รอบ" = **ไม่หารจำนวนคนในกะ** (สายไหล: ชิ้นงานผ่านทุกสถานี ⇒ 1 shot = 1 รอบของคนที่สถานีนั้น)
--    หารจำนวนคน = ไลน์ 10 คน ดูเหมือนแต่ละคนฝึกน้อยกว่าจริง 10 เท่า
--    สถานีที่ "หลายคนทำงานเดียวกันสลับกัน" ให้ตั้ง `station_requirements.parallel_staff`
--    (เดาจากข้อมูลไม่ได้ ต้องให้คนบอก — ไม่ตั้ง = 1 = สายไหล)
--
-- 🔴 นับเป็น **shot ไม่ใช่ชิ้น** (กฎเหล็ก "ชิ้น ≠ shot") — งานคู่ปั๊มทีเดียวได้ 2 ชิ้น
--    ⇒ `station_output_rollup.shots` (แยกจาก `qty_ok` ที่ยังเป็นชิ้น ใช้กับคุณภาพ)
--
-- ผลที่วัดได้: ความคืบหน้าต่อวันทำงาน **เท่ากันทุกไลน์แล้ว** 0.035–0.069 เท่า/วัน
--    (ไลน์ปั๊ม LINE C 18,277 shot/คน อยู่กลางกลุ่มเดียวกับไลน์ประกอบ) — เดิมห่างกันหลายสิบเท่า
--
-- Rollback:
--   update skill_exp_config set is_enabled = false;        ← หยุดผลกระทบทันที
--   update station_requirements set n_ref = null;           ← กลับไปใช้ค่ากลางของ config
--   alter table station_requirements drop column if exists parallel_staff;
--   alter table station_output_rollup drop column if exists shots, drop column if exists ct_sec;
--   alter table employee_skill_evidence drop column if exists cum_ratio;
--   drop function if exists public.fn_skill_exp_set_nref(boolean, integer);
--   (แล้ว git revert โค้ด — ตัว rebuild เวอร์ชันก่อนหน้าอยู่ใน 20260924_skill_exp_v2_engine_main.sql)
-- ══════════════════════════════════════════════════════════════════════════

alter table public.station_output_rollup
  add column if not exists shots  bigint  not null default 0,
  add column if not exists ct_sec numeric;

comment on column public.station_output_rollup.shots is
  'จำนวนจังหวะ (shot) ที่มือทำจริง — งานคู่ (pair_mat_no) = ชิ้น ÷ 2 · ใช้กับขา "ปริมาณสะสม" ของ EXP v2 เท่านั้น (qty_ok = ชิ้น ใช้กับคุณภาพ)';
comment on column public.station_output_rollup.ct_sec is
  'CT กลาง (วินาที/shot) ของรุ่นที่รันในกะนั้น — ใช้ตั้ง station_requirements.n_ref';

alter table public.skill_exp_config
  add column if not exists ref_hours numeric not null default 120 check (ref_hours > 0);

alter table public.station_requirements
  add column if not exists parallel_staff integer not null default 1 check (parallel_staff >= 1);

comment on column public.station_requirements.n_ref is
  'รอบ (shot) สะสมที่คาดว่าถึง "ทำเองได้ตามมาตรฐาน" ของสถานีนี้ · ตั้งอัตโนมัติด้วย fn_skill_exp_set_nref() จาก CT จริงของไลน์ · null = ใช้ค่าสำรองจาก skill_exp_config';
comment on column public.station_requirements.parallel_staff is
  'จำนวนคนที่ทำ "งานเดียวกัน" สลับกันที่สถานีนี้ · 1 = สายไหล (ชิ้นงานผ่านทุกสถานี) · เดาจากข้อมูลไม่ได้ ต้องให้คนตั้ง';

alter table public.employee_skill_evidence
  -- 🔴 ต้องสะสมเป็น "สัดส่วน" ไม่ใช่ "รอบ" เพราะคนหนึ่งสลับหลายสถานีที่ n_ref ต่างกันถึง 34 เท่า
  --    (เอา cum_cycles มาหาร n_ref ตัวเดียวทีหลัง = เลือกไม่ถูกว่าจะใช้สถานีไหน · มีด่าน)
  add column if not exists cum_ratio numeric;

comment on column public.employee_skill_evidence.cum_cycles is
  'จำนวนจังหวะ (shot) สะสมที่ผ่านมือ — หารด้วย station_requirements.parallel_staff แล้ว · ใช้โชว์';
comment on column public.employee_skill_evidence.cum_ratio is
  'ความคืบหน้าสะสมเป็นเท่าของรอบอ้างอิง (Σ shots/n_ref รายวัน) — ตัวที่ใช้ตัดสินขั้นจริง';

-- ── ตั้ง n_ref ต่อสถานีจาก CT จริงที่ไลน์นั้นรัน ──────────────────────────────────────
-- รันซ้ำได้ (idempotent) · p_dry_run = true (default) คืนรายงานโดยไม่เขียน
-- ⚠️ percentile_cont() คืน double precision ⇒ round(double, int) ไม่มีใน PG ต้อง cast ::numeric ก่อน
create or replace function public.fn_skill_exp_set_nref(p_dry_run boolean default true,
                                                        p_days integer default 180)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  cfg           public.skill_exp_config%rowtype;
  v_fallback_ct numeric;
  v_rows        integer := 0;
  v_rep         jsonb;
begin
  if auth.uid() is not null and not has_perm('skills:run_weekly_update') then
    raise exception 'permission denied: set n_ref requires skills:run_weekly_update';
  end if;

  select * into cfg from public.skill_exp_config where id = 1;

  -- CT กลางของทั้งโรงงาน = ค่าสำรองเมื่อไลน์นั้นไม่มีข้อมูล CT (ออฟฟิศ/rework/ไลน์ทดสอบ)
  select (percentile_cont(0.5) within group (order by ct_sec))::numeric into v_fallback_ct
  from station_output_rollup
  where ct_sec > 0 and work_date >= (now() at time zone 'Asia/Bangkok')::date - p_days;

  create temp table _nref on commit drop as
  with line_ct as (
    -- CT กลางต่อไลน์ ถ่วงด้วย "ที่รันจริง" (ไม่ใช่ค่าในทะเบียนสินค้าเฉยๆ)
    select public.norm_line_key(line_name) as line_key,
           (percentile_cont(0.5) within group (order by ct_sec))::numeric as ct_sec,
           count(*) as n_shifts
    from station_output_rollup
    where ct_sec > 0 and work_date >= (now() at time zone 'Asia/Bangkok')::date - p_days
    group by 1
  )
  select sr.id,
         w.line_name,
         coalesce(lc.ct_sec, v_fallback_ct) as ct_sec,
         (lc.ct_sec is null)                as used_fallback,
         sr.n_ref                           as old_nref,
         greatest(100, round(cfg.ref_hours * 3600
                             / nullif(coalesce(lc.ct_sec, v_fallback_ct), 0)))::integer as new_nref
  from station_requirements sr
  join workstations w on w.id::text = sr.station_id::text
  left join line_ct lc on lc.line_key = public.norm_line_key(w.line_name)
  where sr.min_score >= 70;

  select jsonb_build_object(
    'dry_run', p_dry_run,
    'ref_hours', cfg.ref_hours,
    'fallback_ct_sec', round(v_fallback_ct, 1),
    'stations', (select count(*) from _nref),
    'used_fallback', (select count(*) from _nref where used_fallback),
    'by_line', (select jsonb_agg(x order by x->>'line_name') from (
        select jsonb_build_object('line', line_name,
                                  'ct', round(ct_sec, 1),
                                  'n_ref', new_nref,
                                  'fallback', used_fallback,
                                  'reqs', count(*)) as x
        from _nref group by line_name, ct_sec, new_nref, used_fallback) y)
  ) into v_rep;

  if not p_dry_run then
    update station_requirements sr
       set n_ref = n.new_nref, updated_at = now()
      from _nref n
     where sr.id = n.id and coalesce(sr.n_ref, -1) <> n.new_nref;
    get diagnostics v_rows = row_count;
    v_rep := v_rep || jsonb_build_object('updated', v_rows);
  end if;

  return v_rep;
end;
$function$;

revoke all on function public.fn_skill_exp_set_nref(boolean, integer) from public, anon;
grant execute on function public.fn_skill_exp_set_nref(boolean, integer) to authenticated, service_role;

-- ตั้งค่าครั้งแรก (08/10: 234 สถานี · n_ref 5,035 – 172,800 · ใช้ค่าสำรอง 52 แถว)
select public.fn_skill_exp_set_nref(false);
