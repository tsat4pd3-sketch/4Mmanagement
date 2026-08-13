-- Value Stream Map — เอกสาร VSM 1 ใบ (Current / Future / Ideal state)
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive
-- ออกแบบ: docs/VSM-DESIGN.md
--
-- ทำไมเก็บเป็น snapshot (jsonb) ไม่คำนวณสดตอนเปิดดู:
--   VSM คือ "ภาพ ณ ช่วงเวลาหนึ่ง" (ใบกระดาษจริงเขียน Information on July 25)
--   ถ้าคำนวณสดทุกครั้ง ใบที่อนุมัติไปแล้วจะเปลี่ยนตัวเลขเองเงียบๆ = สืบย้อนไม่ได้
--   หลักเดียวกับ lpa_audit_answers.question_text / ojt_training_attendees.emp_name
--   → หน้าจอมีปุ่ม "ดึงข้อมูลปัจจุบันมาเทียบ" ให้เห็น diff แล้วคนกดรับเป็นรายช่อง

create table if not exists public.vsm_maps (
  id             uuid primary key default gen_random_uuid(),
  mat_no         text not null,                       -- FG ที่เป็นเจ้าของสายธาร
  title          text,
  state          text not null default 'current'
                 check (state in ('current','future','ideal')),
  period_from    date,                                -- ช่วงข้อมูลที่ใช้คำนวณ
  period_to      date,
  effective_date text,                                -- ตามใบ (ข้อความ ไม่ใช่ date — ใบเขียน พ.ศ./ค.ศ. ปนกัน)
  approved_by    text,
  checked_by     text,
  issued_by      text,
  data           jsonb not null default '{}'::jsonb,  -- โมเดลที่ generate + ค่าที่คนแก้ทับ
  status         text not null default 'draft'
                 check (status in ('draft','approved','archived')),
  generated_at   timestamptz,
  updated_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists vsm_maps_mat_idx   on public.vsm_maps (mat_no);
create index if not exists vsm_maps_state_idx on public.vsm_maps (state);

alter table public.vsm_maps enable row level security;
drop policy if exists vsm_maps_all on public.vsm_maps;
create policy vsm_maps_all on public.vsm_maps for all using (true) with check (true);

drop trigger if exists trg_set_updated_at on public.vsm_maps;
create trigger trg_set_updated_at before update on public.vsm_maps
  for each row execute function public.fn_set_updated_at();

-- Rollback:
--   drop table public.vsm_maps;
