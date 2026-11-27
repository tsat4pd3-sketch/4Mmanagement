-- 📈 Live Benefits (`/live-benefits` · 2026-11-26 · คำสั่ง user) — ฝั่ง Main ("MAIN" · ewhdfqwfwofivojtsizn)
-- โจทย์: "ฟอร์มที่มีระบบ export = ทดแทนกระดาษ (อยากได้ hard copy ค่อยปริ้น) · มองให้ออกว่าใบไหนรายกะ ใบไหนรายเดือน"
--
-- 1) doc_forms รับ 2 ช่องใหม่ (nullable · additive) — ทะเบียนเอกสารเป็นเจ้าของคำตอบ "ใบนี้ออกรอบละเท่าไร"
--    paper_basis: shift = ออกทุกกะ · month = เดือนละใบ (ใบเช็ครายวันที่เติมทั้งเดือน) · event = ออกต่อเรื่อง ·
--                 document = เอกสารควบคุม/ทะเบียน (แก้เป็นครั้งคราว) · report = รายงาน/ส่งออกข้อมูล (ไม่ใช่ฟอร์มที่คนกรอก) ·
--                 other = ป้าย/แม่แบบนำเข้า · null = ยังไม่จัด (จอต้องโชว์ ห้ามซ่อน)
--    paper_unit : ข้อความบอก "1 แผ่นต่ออะไร" เช่น 'ไลน์ × กะ'
--    แก้ได้เองที่ /doc-forms (ไม่ต้อง deploy)
-- 2) esm_benefits_rollup(p_from) — นับรายเดือนจากตารางจริง คืน "จำนวน" อย่างเดียว (ไม่คิด KPI · JS เป็นคนคิด)
--    kind='paper' : key = doc_key · n = จำนวนแผ่นตามหน่วยของใบ · val = ครั้งที่บันทึก (งานคีย์ Excel เดิม)
--    kind='flow'  : key = ชื่อตัวชี้วัด · n = จำนวนตัวอย่าง · val = มัธยฐาน
--    SECURITY DEFINER + has_perm('page:/live-benefits') — นับทั้งโรงงาน (จอผู้บริหาร precedent /adoption-outlook)
--    คืนแค่ตัวเลขรวม ไม่คืนแถว/ชื่อคน
-- 3) seed สิทธิ์หน้า admin/manager (ระบุ role ตรงๆ ไม่ใช้ enum_range — กับดัก role ใหม่เข้าไม่ได้เงียบๆ)
--
-- วันทำงาน: timestamp → (เวลาไทย − 8 ชม.)::date (กะดึกหลังเที่ยงคืนนับเป็นวันก่อน · ตรงกับ getWorkDate())
--
-- rollback (ย้อนได้ทั้งก้อน · ไม่มีข้อมูลเดิมถูกแตะ):
--   drop function if exists public.esm_benefits_rollup(date);
--   delete from public.role_permissions where permission_key = 'page:/live-benefits';
--   alter table public.doc_forms drop column if exists paper_basis, drop column if exists paper_unit;

alter table public.doc_forms add column if not exists paper_basis text;
alter table public.doc_forms add column if not exists paper_unit text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'doc_forms_paper_basis_chk') then
    alter table public.doc_forms add constraint doc_forms_paper_basis_chk
      check (paper_basis is null or paper_basis in ('shift','month','event','document','report','other'));
  end if;
end $$;

-- seed เฉพาะแถวที่ยังว่าง (รันซ้ำไม่ทับค่าที่คนแก้ไว้ที่ /doc-forms)
update public.doc_forms d set paper_basis = v.b, paper_unit = v.u
from (values
  -- ออกทุกกะ
  ('daily_production_report','shift','ไลน์ × กะ'),
  ('qa_inspection_sheet','shift','พาร์ท × กะ × รอบ'),
  ('qbin_red','shift','ไลน์ × วัน'),
  ('qbin_yellow','shift','ไลน์ × วัน'),
  ('morning_meeting','shift','พื้นที่ × วัน'),
  -- เดือนละใบ (ใบเช็ครายวันที่เติมทั้งเดือน)
  ('attendance_record','month','ไลน์ × กะ'),
  ('xlsx_am_monthly','month','เครื่อง × กะ'),
  ('lpa_plan','month','ไลน์ × กะ'),
  ('lpa_report','month','ไลน์ × กะ'),
  ('bbs_observation','month','ไลน์ × กะ'),
  ('changing_point','month','ไลน์'),
  ('cqi15_event_log','month','ไลน์'),
  -- ออกต่อเรื่อง
  ('mo_report','event','เรื่อง'),
  ('mo_report_mtn','event','เรื่อง'),
  ('pm_jig','event','ครั้งที่ตรวจ'),
  ('prod_problem_report','event','เรื่อง'),
  ('scrap_report','event','ใบ'),
  ('ojt','event','ครั้งที่อบรม'),
  ('material_request','event','ใบ'),
  ('pm_coordination','event','ใบ'),
  ('improvement_a3','event','โปรเจค'),
  ('mkt_production_order','event','ใบ'),
  ('mkt_production_parts','event','ใบ'),
  ('ot_booking','event','ใบ'),
  ('ot_compensation_report','event','ใบ'),
  ('individual_skill','event','คน × รอบประเมิน'),
  -- เอกสารควบคุม/ทะเบียน
  ('pe_cp','document','พาร์ท'),
  ('pe_fmea','document','พาร์ท'),
  ('pe_pfc','document','พาร์ท'),
  ('npi_ppap_checklist','document','พาร์ท'),
  ('vsm','document','สายผลิต'),
  ('org_chart','document','หน่วยงาน'),
  ('spare_part_list','document','เครื่อง'),
  ('mtn_machine_history','document','เครื่อง'),
  ('multi_skill','document','ไลน์'),
  -- ป้าย/แม่แบบนำเข้า
  ('qr_label','other',null),
  ('scan_sheet','other',null),
  ('rack_qr_labels','other',null),
  ('csv_parts_template','other',null),
  ('csv_product_template','other',null),
  ('xlsx_spare_import_template','other',null)
) v(k, b, u)
where d.doc_key = v.k and d.paper_basis is null;

-- ที่เหลือ = รายงาน/ส่งออกข้อมูล (สรุปจากข้อมูลที่บันทึกแล้ว ไม่ใช่ฟอร์มที่คนกรอก)
update public.doc_forms set paper_basis = 'report'
where paper_basis is null
  and (doc_key like 'csv\_%' or doc_key like 'xlsx\_%' or doc_key like 'kpi\_%' or doc_key like 'report\_%'
       or doc_key in ('daily_report_export','monthly_review','mtn_mo_monthly_export','ot_monthly_summary',
                      'skill_matrix','skill_pay_summary'));

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
  -- 4M: ยื่น → อนุมัติครบ (ชั่วโมง)
  select 'flow', 'fourm_approve_h', to_char(f.work_date,'YYYY-MM'), count(*)::bigint,
         round((percentile_cont(0.5) within group (order by extract(epoch from (f.approved_at - f.created_at)) / 3600))::numeric, 1)
  from four_m_logs f
  where f.work_date >= p_from and f.status = 'approved' and f.approved_at is not null and f.approved_at >= f.created_at
  group by 3;
end $$;

revoke all on function public.esm_benefits_rollup(date) from public, anon;
grant execute on function public.esm_benefits_rollup(date) to authenticated;

insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/live-benefits', true
from unnest(array['admin','manager']::user_role[]) r
on conflict (role, permission_key) do nothing;
