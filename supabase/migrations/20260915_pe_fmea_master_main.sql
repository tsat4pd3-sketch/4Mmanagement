-- ═══ 📚 คลัง PFMEA กลาง (Foundation / Family PFMEA) · Main project (ewhdfqwfwofivojtsizn) ═══
-- 2026-09-15 · คำสั่ง user: "ทำ master data ของ PFMEA เป็น reference — โปรเจคใหม่ดึงไปใช้ได้เลย
--   และถ้าโปรเจคไหนปรับปรุงแล้ว RPN ดีกว่าของ master ก็อัพเดท" · แบบเต็ม: docs/modules/pe-core-tools.md §คลัง PFMEA
--
-- หลักออกแบบ (mini-ADR):
--   1. หน่วยของ master = "กระบวนการมาตรฐาน" (PROJECTION WELD NUT · SPOT WELD · DRAW …) ไม่ใช่พาร์ท
--      พาร์ทถือ **สำเนา** (pe_fmea_items.master_item_id + master_version) — เอกสารควบคุมของพาร์ทต้องนิ่ง
--      แก้ master ไม่ย้อนแก้พาร์ท · จอบอกว่า "ล้าหลัง master" ให้คนตัดสินเอง
--   2. ไหลกลับ = **ระบบเสนอ คนตัดสิน** (pe_master_proposals · หลักเดียวกับ pe_change_requests)
--      RPN ต่ำกว่าไม่ได้แปลว่าดีกว่าเสมอ (อาจประเมิน O/D หลวม) — เกณฑ์เสนอ = มี action_taken + new S/O/D ครบ
--      ห้ามอัพเดท master อัตโนมัติ
--   3. seed ครั้งแรก = ระบบจับกลุ่ม OP ชื่อเดียวกันข้ามพาร์ทที่มีอยู่จริง แล้ว **confirmed_at = null**
--      (PE ต้องยืนยันว่าเป็นกระบวนการเดียวกันจริง) — ไม่ hardcode เนื้อหา FMEA ในไฟล์นี้
--   4. สิทธิ์ใช้ของเดิม: ผูก/ดึงใช้/เสนอ = pe:edit · ยืนยัน master/แก้ master/ตัดสินข้อเสนอ = pe:approve (ไม่เพิ่มคีย์ใหม่)
--
-- Rollback (revert โค้ดก่อน แล้วค่อยรัน):
--   alter table public.pe_fmea_items drop column if exists master_item_id, drop column if exists master_version;
--   alter table public.pe_processes drop column if exists master_process_id;
--   drop table if exists public.pe_master_proposals, public.pe_master_items, public.pe_master_processes cascade;

create table if not exists public.pe_master_processes (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,          -- slug จากชื่อ+ชนิด เช่น 'projection_weld_nut__process' — สร้างแล้วห้ามแก้
  name          text not null,                 -- ชื่อที่โชว์ (ตัวแรกที่เจอตอน seed / PE แก้ได้)
  kind          text not null default 'process'
                check (kind in ('process','incoming_insp','storage','transport','inspection','rework','warehouse','delivery')),
  process_type  text,                          -- key ของ process_types (DR) เป็น text — ใช้กรอง/จัดกลุ่ม
  family_tags   text[] not null default '{}',  -- ตระกูลพาร์ทที่ใช้ เช่น {fender_inner, rad_support}
  description   text,
  is_active     boolean not null default true,
  confirmed_by  text,                          -- null = ระบบจับกลุ่มให้ PE ยังไม่ยืนยัน
  confirmed_at  timestamptz,
  version       int not null default 1,        -- ขึ้นทุกครั้งที่ item ในกระบวนการนี้ถูกอัพเดทจากข้อเสนอ
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.pe_master_processes is 'กระบวนการมาตรฐาน (Foundation PFMEA) — คลังความรู้เหนือพาร์ท · พาร์ทดึงสำเนาไปใช้';

create table if not exists public.pe_master_items (
  id                uuid primary key default gen_random_uuid(),
  master_process_id uuid not null references public.pe_master_processes(id) on delete cascade,
  seq               int not null default 0,
  requirement       text,
  failure_mode      text not null,
  effects           text,
  severity          int check (severity between 1 and 10),
  classification    text,
  causes            text,
  prevention        text,
  occurrence        int check (occurrence between 1 and 10),
  detection_ctrl    text,
  detection         int check (detection between 1 and 10),
  best_practice     text,                      -- สิ่งที่พาร์ทไหนสักพาร์ททำแล้วดีขึ้น (จาก action_taken)
  version           int not null default 1,    -- เวอร์ชันของแถวนี้ — พาร์ทที่ถือ master_version ต่ำกว่า = ล้าหลัง
  origin_set_id     uuid references public.pe_doc_sets(id) on delete set null,   -- ถอดมาจากพาร์ทไหน
  origin_item_id    uuid references public.pe_fmea_items(id) on delete set null,
  is_active         boolean not null default true,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists pe_master_items_proc_idx on public.pe_master_items (master_process_id, seq);

-- ข้อเสนออัพเดท master จากพาร์ทที่ทำจริง (ระบบสร้างตอนออก revision / คนกดเสนอเอง)
create table if not exists public.pe_master_proposals (
  id                uuid primary key default gen_random_uuid(),
  master_process_id uuid not null references public.pe_master_processes(id) on delete cascade,
  master_item_id    uuid references public.pe_master_items(id) on delete cascade,   -- null = เสนอเป็นรายการใหม่
  kind              text not null check (kind in ('improve','new_item')),
  source_set_id     uuid references public.pe_doc_sets(id) on delete set null,
  source_item_id    uuid references public.pe_fmea_items(id) on delete set null,
  revision_id       uuid references public.pe_doc_revisions(id) on delete set null,
  before            jsonb,                     -- ค่า master ณ ตอนเสนอ (S/O/D/controls) — ให้คนเทียบ
  after             jsonb not null,            -- ค่าที่เสนอ
  rpn_before        int,
  rpn_after         int,
  note              text,
  status            text not null default 'proposed' check (status in ('proposed','accepted','rejected')),
  reject_reason     text,
  decided_by        text,
  decided_at        timestamptz,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint pe_mp_reject_needs_reason check (status <> 'rejected' or coalesce(btrim(reject_reason), '') <> '')
);
create index if not exists pe_master_proposals_status_idx on public.pe_master_proposals (status, created_at desc);
create index if not exists pe_master_proposals_src_idx on public.pe_master_proposals (source_item_id);

-- ตัวเชื่อมฝั่งพาร์ท (nullable = backward-compatible · โค้ดเก่าไม่รู้จักก็ทำงานเหมือนเดิม)
alter table public.pe_processes  add column if not exists master_process_id uuid references public.pe_master_processes(id) on delete set null;
alter table public.pe_fmea_items add column if not exists master_item_id    uuid references public.pe_master_items(id) on delete set null;
alter table public.pe_fmea_items add column if not exists master_version    int;
create index if not exists pe_processes_master_idx  on public.pe_processes (master_process_id);
create index if not exists pe_fmea_items_master_idx on public.pe_fmea_items (master_item_id);

-- RLS + updated_at + audit (pattern pe_*)
do $$
declare t text;
begin
  foreach t in array array['pe_master_processes','pe_master_items','pe_master_proposals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_write', t);
    if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
      execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
      execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    end if;
    if exists (select 1 from pg_proc where proname = 'fn_audit') then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed จากข้อมูลจริง: จับกลุ่ม OP ชื่อเดียวกัน (normalize) ข้ามทุกชุดเอกสาร → 1 master process ต่อกลุ่ม
--   · เนื้อหา item เอาจาก OP ที่มีแถว FMEA มากที่สุดในกลุ่ม (origin) · OP อื่นในกลุ่มผูกแถวด้วย failure_mode ตรงกัน
--   · confirmed_at = null ทั้งหมด — PE ยืนยันที่แท็บ 📚 คลัง PFMEA
--   · idempotent: กระบวนการที่มี key แล้วข้าม · OP ที่ผูกแล้วไม่ทับ · master ที่มี item แล้วไม่ copy ซ้ำ
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pe_master_norm(txt text) returns text
language sql immutable as $$
  select btrim(regexp_replace(lower(coalesce(txt, '')), '[^a-z0-9ก-๙]+', ' ', 'g'))
$$;

do $$
declare
  g record; origin_proc uuid; mp uuid; nitems int;
begin
  -- 1) กระบวนการมาตรฐานจากชื่อ OP ที่ normalize แล้ว (ต่อชนิด)
  for g in
    select public.pe_master_norm(p.name) as norm, p.kind,
           (array_agg(p.name order by p.created_at, p.id))[1] as first_name,
           count(*) as n_ops
      from public.pe_processes p
     where public.pe_master_norm(p.name) <> ''
     group by 1, 2
  loop
    insert into public.pe_master_processes (key, name, kind, created_by_name)
    values (replace(g.norm, ' ', '_') || '__' || g.kind, g.first_name, g.kind, 'ระบบ (seed จากชุดเอกสารที่มีอยู่)')
    on conflict (key) do nothing;
  end loop;

  -- 2) ผูก OP → master (เฉพาะที่ยังไม่ผูก)
  update public.pe_processes p
     set master_process_id = m.id
    from public.pe_master_processes m
   where p.master_process_id is null
     and m.key = replace(public.pe_master_norm(p.name), ' ', '_') || '__' || p.kind;

  -- 3) copy item จาก OP ต้นทาง (มีแถวมากสุด · เสมอ = ชุดที่สร้างก่อน) เข้า master ที่ยังว่าง
  for mp in select id from public.pe_master_processes loop
    if exists (select 1 from public.pe_master_items where master_process_id = mp) then continue; end if;
    select p.id into origin_proc
      from public.pe_processes p
      join public.pe_doc_sets s on s.id = p.set_id
      left join public.pe_fmea_items f on f.process_id = p.id
     where p.master_process_id = mp
     group by p.id, s.created_at
     order by count(f.id) desc, s.created_at asc
     limit 1;
    if origin_proc is null then continue; end if;
    insert into public.pe_master_items (master_process_id, seq, requirement, failure_mode, effects, severity, classification, causes, prevention, occurrence, detection_ctrl, detection, best_practice, origin_set_id, origin_item_id, created_by_name)
    select mp, f.seq, f.requirement, f.failure_mode, f.effects, f.severity, f.classification, f.causes, f.prevention, f.occurrence, f.detection_ctrl, f.detection,
           nullif(btrim(f.action_taken), ''), p.set_id, f.id, 'ระบบ (seed)'
      from public.pe_fmea_items f join public.pe_processes p on p.id = f.process_id
     where f.process_id = origin_proc and coalesce(btrim(f.failure_mode), '') <> '';
    get diagnostics nitems = row_count;
    -- แถวต้นทางถือ master_item_id ของตัวเอง
    update public.pe_fmea_items f set master_item_id = mi.id, master_version = 1
      from public.pe_master_items mi
     where mi.origin_item_id = f.id and f.master_item_id is null;
  end loop;

  -- 4) OP อื่นในกลุ่มเดียวกัน: ผูกแถวที่ failure_mode ตรงกัน (normalize) — 1 แถวต่อ master item ต่อ OP
  update public.pe_fmea_items f
     set master_item_id = x.mi_id, master_version = 1
    from (
      select distinct on (f2.id) f2.id as f_id, mi.id as mi_id
        from public.pe_fmea_items f2
        join public.pe_processes p2 on p2.id = f2.process_id
        join public.pe_master_items mi on mi.master_process_id = p2.master_process_id
       where f2.master_item_id is null
         and public.pe_master_norm(mi.failure_mode) = public.pe_master_norm(f2.failure_mode)
         and public.pe_master_norm(f2.failure_mode) <> ''
       order by f2.id, mi.seq
    ) x
   where f.id = x.f_id;
end $$;

-- ตรวจหลังรัน:
-- select count(*) masters, count(*) filter (where confirmed_at is null) unconfirmed from pe_master_processes;
-- select m.name, m.kind, count(distinct p.set_id) sets, (select count(*) from pe_master_items i where i.master_process_id = m.id) items
--   from pe_master_processes m left join pe_processes p on p.master_process_id = m.id group by m.id order by sets desc, m.name;
-- select count(*) linked, count(*) filter (where master_item_id is null) unlinked from pe_fmea_items;
