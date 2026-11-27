-- MAIN (ewhdfqwfwofivojtsizn) · 2026-11-24 · 🤝 คะแนน Customer Satisfaction รายลูกค้า × Q/D × เดือน
-- user: "อัพ customer satisfaction ให้ที แยก Q/D และเจาะรายลูกค้าได้เลย"
-- แหล่งเดียว: ตารางนี้ (นำเข้าจากไฟล์ V5 ของ QSM) ⇒ trigger รวมเป็นตัวแปรฐาน kpi_base_inputs csat_* (ระดับ ทั้งโรงงาน)
-- ⇒ ค่ารวม/ขา Q·D ยังคิดผ่าน KPI_FORMULAS (csat_qd_pct) เหมือนเดิม — ไม่มีสูตรชุดที่ 2
-- rollback: drop trigger trg_kpi_csat_scores_rollup on public.kpi_csat_scores; drop function public.kpi_csat_rollup(int); drop table public.kpi_csat_scores;
--           (แถว kpi_base_inputs csat_* ที่ trigger เขียนไว้ ลบได้ด้วย delete … where var_key like 'csat\_%' and created_by_name='csat-rollup')
create table if not exists public.kpi_csat_scores (
  id              uuid primary key default gen_random_uuid(),
  year            int  not null,
  month           int  not null check (month between 1 and 12),
  customer        text not null,
  kind            text not null check (kind in ('delivery','quality')),
  result          numeric,            -- คะแนน/PPM ดิบจากลูกค้า (null = ไม่ประเมิน '*')
  score           numeric check (score is null or (score >= 0 and score <= 1)),   -- เกรด A=1 · B=0.5 · C=0
  evaluated       boolean not null default true,   -- false = '*' ไม่ประเมินเดือนนี้ (ไม่เข้าตัวหาร)
  grade_a         text,
  grade_b         text,
  grade_c         text,
  remark          text,
  source          text not null default 'import',  -- import | manual | auto
  source_file     text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (year, month, customer, kind)             -- คอลัมน์ล้วน ⇒ upsert ได้ (กฎ DB ข้อ 3)
);
comment on table public.kpi_csat_scores is 'Customer Satisfaction รายลูกค้า × ชนิด (delivery/quality) × เดือน จากไฟล์ V5 ของ QSM · trigger รวมเป็น kpi_base_inputs csat_* (plant)';
alter table public.kpi_csat_scores enable row level security;
do $$ begin
  create policy kpi_csat_scores_read  on public.kpi_csat_scores for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy kpi_csat_scores_write on public.kpi_csat_scores for all
    using (has_perm('kpi:manage')) with check (has_perm('kpi:manage'));
exception when duplicate_object then null; end $$;
grant select on public.kpi_csat_scores to anon, authenticated;
grant insert, update, delete on public.kpi_csat_scores to authenticated;
grant all on public.kpi_csat_scores to service_role;

drop trigger if exists trg_kpi_csat_scores_updated on public.kpi_csat_scores;
create trigger trg_kpi_csat_scores_updated before update on public.kpi_csat_scores
  for each row execute function public.fn_set_updated_at();
do $$ begin
  if exists (select 1 from pg_proc where proname='fn_audit') then
    drop trigger if exists trg_audit on public.kpi_csat_scores;
    create trigger trg_audit after insert or update or delete on public.kpi_csat_scores
      for each row execute function public.fn_audit();
  end if;
end $$;

-- 🔁 รวมคะแนน → ตัวแปรฐาน csat_* ระดับ ทั้งโรงงาน (scope_kind='plant', scope_value='') ของปีนั้น
--    csat_q_actual = Σ score (quality · evaluated) · csat_q_total = จำนวนที่ประเมิน · D เหมือนกัน
--    เดือนที่ไม่มีใครถูกประเมิน = ลบแถว csat_* ของเดือนนั้น (ห้ามเขียน 0) · เขียนเฉพาะแถวที่ตารางนี้เป็นเจ้าของ (created_by_name='csat-rollup')
create or replace function public.kpi_csat_rollup(p_year int) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v numeric; k text;
begin
  for r in
    select m.month,
      sum(case when s.kind='quality'  and s.evaluated then s.score end) q_sum, count(*) filter (where s.kind='quality'  and s.evaluated and s.score is not null) q_n,
      sum(case when s.kind='delivery' and s.evaluated then s.score end) d_sum, count(*) filter (where s.kind='delivery' and s.evaluated and s.score is not null) d_n
    from generate_series(1,12) m(month)
    left join public.kpi_csat_scores s on s.year=p_year and s.month=m.month
    group by m.month
  loop
    for k, v in select * from (values ('csat_q_actual', case when r.q_n>0 then r.q_sum end), ('csat_q_total', case when r.q_n>0 then r.q_n::numeric end),
                                      ('csat_d_actual', case when r.d_n>0 then r.d_sum end), ('csat_d_total', case when r.d_n>0 then r.d_n::numeric end)) t(k,v)
    loop
      if v is null then
        delete from public.kpi_base_inputs b where b.year=p_year and b.month=r.month and b.scope_kind='plant' and coalesce(b.scope_value,'')='' and b.var_key=k and b.created_by_name='csat-rollup';
      else
        update public.kpi_base_inputs b set value=v, updated_at=now(), created_by_name='csat-rollup'
          where b.year=p_year and b.month=r.month and b.scope_kind='plant' and coalesce(b.scope_value,'')='' and b.var_key=k;
        if not found then
          insert into public.kpi_base_inputs (year, month, scope_kind, scope_value, var_key, value, created_by_name)
            values (p_year, r.month, 'plant', '', k, v, 'csat-rollup');
        end if;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.kpi_csat_rollup(int) from public;
grant execute on function public.kpi_csat_rollup(int) to authenticated, service_role;

create or replace function public.trg_kpi_csat_rollup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.kpi_csat_rollup(coalesce(new.year, old.year));
  if tg_op = 'UPDATE' and new.year <> old.year then perform public.kpi_csat_rollup(old.year); end if;
  return null;
end $$;
drop trigger if exists trg_kpi_csat_scores_rollup on public.kpi_csat_scores;
create trigger trg_kpi_csat_scores_rollup after insert or update or delete on public.kpi_csat_scores
  for each row execute function public.trg_kpi_csat_rollup();
-- ตรวจผล: select month, var_key, value, created_by_name from kpi_base_inputs where year=2026 and var_key like 'csat\_%' order by 1,2;
