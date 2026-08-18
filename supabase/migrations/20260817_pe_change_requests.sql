-- ═══ ลูปปิด 8D → PFMEA / PFC / Control Plan (เฟส 1) · Main project ═══
-- 2026-08-17 · คำสั่ง user · แบบเต็ม: docs/CLOSED-LOOP-8D-PE.md
--
-- โจทย์: ปิด 8D แล้วเอกสาร PE ไม่เคยถูกตามแก้ → IATF 16949 §10.2.3/10.2.4 บังคับว่าต้องตาม
--        และตอบไม่ได้ว่า "อาการนี้เคยคาดไว้ใน PFMEA ไหม"
--
-- ⚠️ ตารางนี้เก็บ "คำขอแก้เอกสาร" ไม่ใช่ตัวเอกสาร — ระบบ/คน **เสนอ** เข้ามา แล้ว PE เป็นคนตัดสิน
--    ห้ามให้อะไรไปเขียน pe_fmea_items / pe_cp_items / pe_processes เองอัตโนมัติ (เอกสารควบคุม)

create table if not exists public.pe_change_requests (
  id            uuid primary key default gen_random_uuid(),

  -- ── ต้นเหตุ: ใช้ vocabulary ชุดเดียวกับ pe_doc_revisions.ref_kind ห้ามตั้งชุดใหม่ ──
  ref_kind      text not null check (ref_kind in ('capa','ncr','claim','defect','downtime','mtn','audit','other')),
  ref_id        text not null,            -- id ของต้นเหตุ (qa_capa.id / qa_ncr.id / …)
  ref_label     text,                     -- snapshot ป้ายที่คนอ่านออก เช่น 'CAPA-202608-0001'

  -- ── ปลายทาง: ชี้บรรทัดที่ต้องแก้ (ถ้ายังไม่รู้บรรทัด ชี้แค่ชุด+ชนิดเอกสารได้) ──
  set_id        uuid not null references public.pe_doc_sets(id) on delete cascade,
  doc_type      text not null check (doc_type in ('fmea','cp','pfc')),
  process_id    uuid references public.pe_processes(id) on delete set null,
  fmea_item_id  uuid references public.pe_fmea_items(id) on delete set null,
  cp_item_id    uuid references public.pe_cp_items(id) on delete set null,

  -- ── 3 ขาแบบ 8D (Ford/GM บังคับ 3-legged root cause) ──
  --    occurrence = ทำไมถึงเกิด · detection = ทำไมหลุดออกไป · systemic = พาร์ทอื่นเป็นด้วยไหม (yokoten)
  leg           text check (leg in ('occurrence','detection','systemic')),

  origin        text not null default 'manual' check (origin in ('suggested','manual')),
  confidence    numeric,                  -- คะแนนจับคู่ 0-1 (เฉพาะ suggested) — ต้องโชว์บนจอ ห้ามซ่อน
  match_note    text,                     -- ระบบจับคู่จากอะไร (ให้คนตรวจว่าเดาถูกไหม)

  proposal      text not null,            -- สิ่งที่เสนอให้แก้
  status        text not null default 'proposed'
                check (status in ('proposed','accepted','applied','rejected')),
  reject_reason text,                     -- ปฏิเสธต้องมีเหตุผล (auditor ถามว่าทำไมเคสนี้ไม่แก้)
  revision_id   uuid references public.pe_doc_revisions(id) on delete set null,

  created_by    text,
  created_at    timestamptz not null default now(),
  decided_by    text,
  decided_at    timestamptz,
  updated_at    timestamptz not null default now(),

  -- ⚠️ applied ต้องผูก revision จริงเสมอ — กันการ "ติ๊กว่าแก้แล้ว" โดยไม่มีเอกสารรองรับ
  constraint pe_cr_applied_needs_rev check (status <> 'applied' or revision_id is not null),
  -- ⚠️ ปฏิเสธต้องมีเหตุผล
  constraint pe_cr_reject_needs_reason check (status <> 'rejected' or coalesce(btrim(reject_reason), '') <> '')
);

create index if not exists pe_cr_ref_idx    on public.pe_change_requests (ref_kind, ref_id);
create index if not exists pe_cr_set_idx    on public.pe_change_requests (set_id, status);
create index if not exists pe_cr_status_idx on public.pe_change_requests (status, created_at desc);

-- ── qa_capa: ต้องรู้ว่าเป็นของพาร์ทไหน ไม่งั้นหาชุดเอกสารไม่เจอ ──
-- (วันนี้ CAPA ที่ไม่ได้ผูก NCR ไม่มีข้อมูลพาร์ทเลย — ลูปนี้เริ่มไม่ได้)
alter table public.qa_capa add column if not exists part_no          text;
alter table public.qa_capa add column if not exists line_name        text;
-- ด่านตอนปิด D8: pending = ยังไม่ตอบ · done = แก้เอกสารแล้ว · na = พิจารณาแล้วว่าไม่เกี่ยว (ต้องมีเหตุผล)
alter table public.qa_capa add column if not exists pe_review_status text not null default 'pending'
  check (pe_review_status in ('pending','done','na'));
alter table public.qa_capa add column if not exists pe_review_note   text;

-- ── qa_ncr: จับคู่ชุดเอกสารครั้งเดียวตอนเปิด แล้วใช้ต่อทั้งลูป ──
alter table public.qa_ncr add column if not exists pe_set_id uuid references public.pe_doc_sets(id) on delete set null;

-- ── RLS + audit (pattern เดียวกับ pe_* / qa_*) ──
alter table public.pe_change_requests enable row level security;
drop policy if exists pe_change_requests_select on public.pe_change_requests;
create policy pe_change_requests_select on public.pe_change_requests for select to authenticated using (true);
drop policy if exists pe_change_requests_write on public.pe_change_requests;
create policy pe_change_requests_write on public.pe_change_requests for all to authenticated using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.pe_change_requests;
    create trigger trg_set_updated_at before update on public.pe_change_requests
      for each row execute function public.fn_set_updated_at();
  end if;
  -- กฎเหล็ก: ของที่แก้ได้ต้องมี audit (ใครสั่งแก้เอกสาร / ใครปฏิเสธ ต้องสืบได้)
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.pe_change_requests;
    create trigger trg_audit after insert or update or delete on public.pe_change_requests
      for each row execute function public.fn_audit();
  end if;
end $$;

-- ⚠️ ไม่เพิ่ม permission key ใหม่โดยตั้งใจ — ใช้ของเดิม:
--    เสนอ/ตัดสินฝั่งคุณภาพ = qa:record / qa:manage · รับเข้าแก้เอกสาร = pe:edit / pe:approve
--    (เลี่ยงกับดัก seed enum_range ที่ทำให้ role ใหม่เข้าไม่ได้แบบ fail-closed)
