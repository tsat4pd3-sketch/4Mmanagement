-- ═══ PE Core Tools — Process Flow / PFMEA / Control Plan (2026-08-13 · คำสั่ง user) ═══
-- Main project (ewhdfqwfwofivojtsizn) — เหตุผลที่ลง Main: (1) เอกสารควบคุมมี workflow อนุมัติ ควรอยู่ฝั่ง
-- authenticated (DR เป็น anon-open) (2) เพื่อนร่วมชนิดเดียวกันอยู่ Main (doc_forms/LPA/QA/4M)
-- (3) DB Main ใช้ไป 30MB < DR 46MB และ DR ต้องเก็บที่ไว้ให้ข้อมูลผลิต/SCADA
-- โครงถอดจากเอกสารจริงของ TSAT: PFC-P703-01 / FMEA-P703-01 (AIAG 4th ed) / CNP-P703-01
-- กระดูกสันหลัง = เลข Process (OP 10..280) ใช้ร่วมทั้ง 3 เอกสาร → 1 ชุดข้อมูล 3 มุมมอง
-- การอ้างถึงข้อมูลฝั่ง DR (machines/dr_products) เก็บเป็น text (machine_no/mat_no) — FK ข้าม project ไม่ได้

-- ชุดเอกสารต่อพาร์ท (1 พาร์ท = 1 ชุด PFC+FMEA+CP)
create table if not exists public.pe_doc_sets (
  id           uuid primary key default gen_random_uuid(),
  part_no      text not null,            -- เลขพาร์ทลูกค้า เช่น MB3B-16E060-CH
  mat_no       text,                     -- เลข MAT SAP ภายใน (โยง dr_products/parts_master ฝั่ง DR)
  part_name    text,
  model        text,                     -- เช่น P703
  customer     text,
  line_name    text,                     -- ไลน์หลักที่ผลิต (จุดโยงข้อมูล mass production)
  doc_no_pfc   text,                     -- เช่น PFC-P703-01
  doc_no_fmea  text,                     -- เช่น FMEA-P703-01
  doc_no_cp    text,                     -- เช่น CNP-P703-01
  status       text not null default 'active' check (status in ('active','obsolete')),
  remark       text,
  created_by_name text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- กระบวนการ (OP) — แกนร่วมของ 3 เอกสาร · op_no เป็น text ('130', '100.8') เรียงด้วย seq
create table if not exists public.pe_processes (
  id           uuid primary key default gen_random_uuid(),
  set_id       uuid not null references public.pe_doc_sets(id) on delete cascade,
  op_no        text not null,
  seq          numeric not null default 0,
  name         text not null,            -- เช่น PROJECTION WELD NUT
  kind         text not null default 'process'
               check (kind in ('process','incoming_insp','storage','transport','inspection','rework','warehouse','delivery')),
  machine_no   text,                     -- เครื่องจริง เช่น SP-82 (โยง machines ฝั่ง DR)
  line_name    text,                     -- ไลน์/พื้นที่ที่ OP นี้อยู่ (โยง downtime/defect)
  child_parts  text,                     -- child part/nut ที่ใช้ใน OP (บรรทัดละตัว เช่น W520771-S)
  connector    text,                     -- ตัวเชื่อมผัง A-G
  special_class text,                    -- CC/SC ระดับ OP (จุดตีสัญลักษณ์บนผัง)
  sccaf_no     text,
  remark       text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (set_id, op_no)
);

-- แถว PFMEA (AIAG): 1 แถว = 1 failure mode ของ OP (สาเหตุ/การควบคุม หลายบรรทัดเก็บ multiline)
create table if not exists public.pe_fmea_items (
  id              uuid primary key default gen_random_uuid(),
  process_id      uuid not null references public.pe_processes(id) on delete cascade,
  seq             int not null default 0,
  requirement     text,
  failure_mode    text not null,
  effects         text,                  -- แยกผลต่อ TSAT4/Assembly plant/End user เป็นบรรทัด (ตามฟอร์มจริง)
  severity        int check (severity between 1 and 10),
  classification  text,                  -- CC / SC
  causes          text,
  prevention      text,                  -- Current Process Controls — Prevention
  occurrence      int check (occurrence between 1 and 10),
  detection_ctrl  text,                  -- Current Process Controls — Detection
  detection       int check (detection between 1 and 10),
  -- RPN ไม่เก็บ (คำนวณ S×O×D ในแอปเสมอ — กัน stale)
  recommended_action text,
  responsibility  text,
  target_date     date,
  action_taken    text,
  new_severity    int check (new_severity between 1 and 10),
  new_occurrence  int check (new_occurrence between 1 and 10),
  new_detection   int check (new_detection between 1 and 10),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- แถว Control Plan: 1 แถว = 1 จุดควบคุม (Char No.) ของ OP
create table if not exists public.pe_cp_items (
  id             uuid primary key default gen_random_uuid(),
  process_id     uuid not null references public.pe_processes(id) on delete cascade,
  char_no        int,
  seq            int not null default 0,
  product_char   text,                  -- Characteristics — Product
  process_char   text,                  -- Characteristics — Process
  special_class  text,                  -- CC / SC
  person         text,                  -- ผู้คุม: PD / QA / JIG MTN ฯลฯ
  spec           text,                  -- Specification/Tolerance เช่น ≥ 20 NM.
  method         text,                  -- Evaluation/Measurement Technique
  sample_size    text,
  frequency      text,                  -- เช่น EVERY SHIFT / EVERY 2 HOUR
  control_method text,                  -- เอกสารควบคุม เช่น PPM NO.FM-PD3-001
  reaction_plan  text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ประวัติ revision ต่อเอกสาร (ถอดจาก cover sheet จริง — เคลม/ECN เป็นตัวจุด revision)
create table if not exists public.pe_doc_revisions (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references public.pe_doc_sets(id) on delete cascade,
  doc_type    text not null check (doc_type in ('pfc','fmea','cp')),
  rev_no      int,
  rev_date    date,
  suffix      text,                     -- part no suffix ณ ตอนนั้น เช่น MB3B-16E060-CG
  ecn_no      text,
  content     text not null,            -- เนื้อหาการแก้ไข
  ref_kind    text check (ref_kind in ('claim','ncr','defect','downtime','mtn','other')),
  ref_id      text,                     -- id/เลขอ้างอิงต้นเหตุ (เช่น เลขเคลม WLS6033, ncr id)
  issued_by   text,
  checked_by  text,
  approved_by text,
  created_at  timestamptz default now()
);

create index if not exists pe_processes_set_idx on public.pe_processes(set_id, seq);
create index if not exists pe_fmea_process_idx on public.pe_fmea_items(process_id, seq);
create index if not exists pe_cp_process_idx on public.pe_cp_items(process_id, seq);
create index if not exists pe_rev_set_idx on public.pe_doc_revisions(set_id, doc_type, rev_no);

-- RLS: pattern เดียวกับ org_nodes (select/write = authenticated · สิทธิ์ทำงานคุมที่ UI ผ่าน can() +
-- role_permissions — data-driven ปรับที่ /permissions ได้ ไม่ hardcode role ใน policy)
do $$ declare t text;
begin
  foreach t in array array['pe_doc_sets','pe_processes','pe_fmea_items','pe_cp_items','pe_doc_revisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (true) with check (true)', t, t);
    -- audit + updated_at (กฎเหล็ก: master/เอกสารที่แก้ได้ต้องมี audit) — guard เผื่อ fn ยังไม่ apply
    if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') and t <> 'pe_doc_revisions' then
      execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
      execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    end if;
    if exists (select 1 from pg_proc where proname = 'fn_audit') then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
    end if;
  end loop;
end $$;

-- สิทธิ์: หน้า /pe-docs เข้าได้ทุก role (ฝ่ายผลิต/QA ต้องเช็คย้อนได้) · แก้ = pe:edit (engineer เจ้าของโมดูล)
-- · อนุมัติ = pe:approve — seed แบบระบุ role ชัด (กับดัก enum_range: role ใหม่ภายหลังไปติ๊กที่ /permissions)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/pe-docs', true
from unnest(enum_range(null::user_role)) r
where r::text <> 'dept_admin'   -- bucket ไม่รับ page:* ตาม convention
on conflict (role, permission_key) do nothing;

insert into public.role_permissions (role, permission_key, allowed)
select r.role, k.key, true
from (values ('admin'::user_role), ('manager'::user_role), ('engineer'::user_role), ('dept_admin'::user_role)) as r(role)
cross join (values ('pe:edit'), ('pe:approve')) as k(key)
on conflict (role, permission_key) do nothing;

insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('pe', 'edit',    'PE: แก้ไขเอกสาร Flow/FMEA/Control Plan',    'รายงาน/คุณภาพ', 60),
  ('pe', 'approve', 'PE: อนุมัติ/ออก revision เอกสาร PE',        'รายงาน/คุณภาพ', 61)
on conflict (resource, action) do nothing;
