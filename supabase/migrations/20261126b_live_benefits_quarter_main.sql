-- 📈 Live Benefits รอบ 2 (2026-11-26 · คำสั่ง user "ใบ skill matrix ที่อัพทุก 3 เดือน · ใบ OJT เซ็นในจอได้ทั้งหมด = ลดกระดาษ")
-- ฝั่ง Main ("MAIN" · ewhdfqwfwofivojtsizn) · ต่อจาก 20261126_live_benefits_main.sql
-- 1) paper_basis รับค่าใหม่ 'quarter' (ทุก 3 เดือน) · 2) multi_skill = quarter ต่อไลน์ · 3) RPC นับ skill matrix
-- (OJT นับอยู่แล้วเป็นรายเรื่อง — ใบละครั้งที่อบรม)
-- rollback: รัน esm_benefits_rollup จากไฟล์ 20261126_live_benefits_main.sql อีกรอบ ·
--   update doc_forms set paper_basis='document' where doc_key='multi_skill';
--   แล้ว drop/สร้าง constraint เดิม (ไม่มี 'quarter')

alter table public.doc_forms drop constraint if exists doc_forms_paper_basis_chk;
alter table public.doc_forms add constraint doc_forms_paper_basis_chk
  check (paper_basis is null or paper_basis in ('shift','month','quarter','event','document','report','other'));

update public.doc_forms set paper_basis = 'quarter', paper_unit = 'ไลน์'
where doc_key = 'multi_skill' and paper_basis = 'document';

create or replace function public.esm_benefits_rollup(p_from date)
returns table(kind text, key text, month_key text, n bigint, val numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('page:/live-benefits') then
    raise exception 'ไม่มีสิทธิ์ดูหน้า Live Benefits' using errcode = '42501';
  end if;
  return query
  -- ใบบันทึกการมาทำงาน (เช็คชื่อ+PPE) = เดือนละใบ ต่อไลน์ × กะ · ครั้งที่บันทึก = ไลน์ × กะ × วัน
  select 'paper'::text, 'attendance_record'::text, to_char(d.work_date,'YYYY-MM'),
         count(distinct (e.line_id, coalesce(d.shift,'?')))::bigint,
         count(distinct (d.work_date, e.line_id, coalesce(d.shift,'?')))::numeric
  from daily_production_logs d left join employees e on e.id = d.employee_id
  where d.work_date >= p_from group by 3
  union all
  -- LPA ใบแผน: เดือนละใบ ต่อไลน์ × กะ
  select 'paper', 'lpa_plan', p.month_key, count(*)::bigint, count(*)::numeric
  from lpa_plans p where p.month_key >= to_char(p_from,'YYYY-MM') group by 3
  union all
  -- LPA ใบรายงาน FM-QMR-008: แผ่นต่อแผน · ครั้งที่บันทึก = ครั้งที่ตรวจ
  select 'paper', 'lpa_report', x.m, max(x.sheets)::bigint, sum(x.audits)::numeric from (
    select p.month_key m, count(*) sheets, 0::bigint audits from lpa_plans p
      where p.month_key >= to_char(p_from,'YYYY-MM') group by 1
    union all
    select to_char(a.audit_date,'YYYY-MM'), 0, count(*) from lpa_audits a
      where a.audit_date >= p_from group by 1
  ) x group by 2, 3
  union all
  select 'paper', 'bbs_observation', b.month_key, count(*)::bigint, count(*)::numeric
  from bbs_sheets b where b.month_key >= to_char(p_from,'YYYY-MM') group by 3
  union all
  -- ใบบันทึกการเปลี่ยนแปลง FM-PD-037 = เดือนละใบต่อไลน์ · ครั้งที่บันทึก = รายการ 4M
  select 'paper', 'changing_point', to_char(f.work_date,'YYYY-MM'),
         count(distinct f.line_name)::bigint, count(*)::numeric
  from four_m_logs f where f.work_date >= p_from group by 3
  union all
  select 'paper', 'cqi15_event_log', to_char(c.work_date,'YYYY-MM'),
         count(distinct c.line_name)::bigint, count(*)::numeric
  from cqi15_event_logs c where c.work_date >= p_from group by 3
  union all
  select 'paper', 'qa_inspection_sheet', to_char(q.work_date,'YYYY-MM'), count(*)::bigint, count(*)::numeric
  from qa_inspection_sheets q where q.work_date >= p_from group by 3
  union all
  select 'paper', 'ojt', to_char(o.train_date,'YYYY-MM'), count(*)::bigint, count(*)::numeric
  from ojt_trainings o where o.train_date >= p_from group by 3
  union all
  -- Poka-yoke ยังไม่มีแบบพิมพ์ในทะเบียน (doc_key นี้ไม่อยู่ใน doc_forms) — เดือนละใบต่ออุปกรณ์ × กะ
  select 'paper', 'pokayoke_check', to_char(k.check_date,'YYYY-MM'),
         count(distinct (k.device_id, coalesce(k.shift,'?')))::bigint, count(*)::numeric
  from pokayoke_checks k where k.check_date >= p_from group by 3
  union all
  -- Skill matrix สรุปทั้งไลน์ (FM-PD1-017) = ทุก 3 เดือน 1 แผ่นต่อไลน์ · วางที่เดือนต้นไตรมาส ·
  -- ครั้งที่บันทึก = ช่องคะแนนทักษะในตาราง · ⚠️ ทะเบียนทักษะไม่มีประวัติรายไตรมาส ⇒ ใช้ภาพปัจจุบันทุกรอบ
  select 'paper', 'multi_skill', to_char(qs.q,'YYYY-MM'), x.l, x.c::numeric
  from generate_series(date_trunc('quarter', p_from::timestamp), date_trunc('month', now() at time zone 'Asia/Bangkok'), interval '3 months') qs(q)
  cross join (select count(distinct e.line_id)::bigint l, count(*) c
              from employee_skills s join employees e on e.id = s.employee_id where e.line_id is not null) x
  where qs.q >= p_from::timestamp
  union all
  -- 4M: ยื่น → อนุมัติครบ (ชั่วโมง)
  select 'flow', 'fourm_approve_h', to_char(f.work_date,'YYYY-MM'), count(*)::bigint,
         round((percentile_cont(0.5) within group (order by extract(epoch from (f.approved_at - f.created_at)) / 3600))::numeric, 1)
  from four_m_logs f
  where f.work_date >= p_from and f.status = 'approved' and f.approved_at is not null and f.approved_at >= f.created_at
  group by 3;
end $$;

revoke all on function public.esm_benefits_rollup(date) from public, anon;
grant execute on function public.esm_benefits_rollup(date) to authenticated;
