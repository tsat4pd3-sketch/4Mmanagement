-- ═══ ทะเบียนเคลมลูกค้า (Customer Claim Registry) · Main project ═══
-- 2026-08-17 · เฟส 3 ของลูปปิด 8D → PE (docs/CLOSED-LOOP-8D-PE.md)
--
-- ทำไมตัวนี้คุ้มสุด (ตาม docs/IATF16949-GAP-REVIEW.md):
--   ประวัติ revision ที่นำเข้าจากไฟล์จริงพิสูจน์ว่ากระบวนการจริงคือ **เคลม → แก้ FMEA → ออก rev**
--   อยู่แล้ว แค่ยังไม่มีทะเบียนเคลมในระบบ · ทำตัวเดียวปิดพร้อมกัน 3 ข้อ:
--     §8.2.1 การสื่อสารกับลูกค้า · §9.1.2 ความพึงพอใจลูกค้า · §10.2 corrective action
--
-- โซ่ที่ต่อครบหลังมีตารางนี้:
--   เคลม → NCR (ของเสียจริง) → 8D/CAPA → pe_change_requests → pe_doc_revisions → PFMEA/CP ใหม่

create table if not exists public.qa_customer_claims (
  id             uuid primary key default gen_random_uuid(),
  claim_no       text not null unique,               -- CLM-YYYYMM-###
  claim_date     date not null,
  customer       text not null,
  customer_ref   text,                               -- เลขเคลมฝั่งลูกค้า เช่น WLS6033 (ใช้อ้างตอนตอบกลับ)
  part_no        text,
  part_name      text,
  line_name      text,                               -- ไลน์ที่ผลิต (กุญแจ scope + หาชุดเอกสาร)
  category       text not null default 'quality'
                 check (category in ('quality','delivery','packaging','warranty','other')),
  severity       text not null default 'major'
                 check (severity in ('minor','major','critical')),
  defect_desc    text not null,                      -- อาการที่ลูกค้าแจ้ง (ต้นทางของลูป)
  qty_claim      int not null default 0,
  qty_returned   int not null default 0,
  lot_ref        text,                               -- lot / invoice / วันส่ง ที่ลูกค้าอ้าง
  -- ── นาฬิกาตอบกลับ: ลูกค้ายานยนต์กำหนดเวลาตอบ (24h containment / 8D ภายใน N วัน) ──
  due_reply_date date,
  replied_at     timestamptz,
  reply_note     text,
  -- ── โซ่ไปยังงานแก้ไข ──
  ncr_id         uuid references public.qa_ncr(id)  on delete set null,
  capa_id        uuid references public.qa_capa(id) on delete set null,
  cost_impact    numeric,                            -- ค่าใช้จ่ายที่เกิด (คัดแยก/ขนส่ง/ชดเชย)
  status         text not null default 'open'
                 check (status in ('open','investigating','replied','closed')),
  remark         text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      text
);

create index if not exists qa_claims_status_idx on public.qa_customer_claims (status, claim_date desc);
create index if not exists qa_claims_part_idx   on public.qa_customer_claims (part_no, claim_date desc);

-- ── ให้ประวัติ revision อ้าง CAPA ได้ตรงๆ ──
-- เดิม pe_doc_revisions.ref_kind ไม่มี 'capa' → ตอนออก revision จากคำขอที่มาจาก 8D
-- ต้องแปลงเป็น 'ncr' ซึ่งเป็นการบิดความจริงเล็กๆ · เพิ่มค่าเข้าไปตรงๆ ดีกว่า
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'pe_doc_revisions_ref_kind_check') then
    alter table public.pe_doc_revisions drop constraint pe_doc_revisions_ref_kind_check;
  end if;
  alter table public.pe_doc_revisions add constraint pe_doc_revisions_ref_kind_check
    check (ref_kind is null or ref_kind in ('claim','ncr','capa','defect','downtime','mtn','audit','other'));
end $$;

-- ── RLS + audit (pattern เดียวกับ qa_* / pe_*) ──
alter table public.qa_customer_claims enable row level security;
drop policy if exists qa_customer_claims_select on public.qa_customer_claims;
create policy qa_customer_claims_select on public.qa_customer_claims for select to authenticated using (true);
drop policy if exists qa_customer_claims_write on public.qa_customer_claims;
create policy qa_customer_claims_write on public.qa_customer_claims for all to authenticated using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.qa_customer_claims;
    create trigger trg_set_updated_at before update on public.qa_customer_claims
      for each row execute function public.fn_set_updated_at();
  end if;
  -- เคลมลูกค้าเป็นบันทึกที่ auditor เปิดดูแน่ — ใครแก้อะไรต้องสืบได้
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.qa_customer_claims;
    create trigger trg_audit after insert or update or delete on public.qa_customer_claims
      for each row execute function public.fn_audit();
  end if;
end $$;

-- ⚠️ ไม่เพิ่ม permission key ใหม่ — ใช้ qa:record (บันทึก/ตอบกลับ) + qa:manage (ปิดเคลม)
--    เลี่ยงกับดัก seed enum_range ที่ทำให้ role ใหม่เข้าไม่ได้แบบ fail-closed
