-- QA setup: หลาย drawing ต่อ 1 part (หลายมุมมอง/หลายแผ่น เพื่อวางจุดตรวจ)
-- Target project: MAIN (ewhdfqwfwofivojtsizn)
--
--   qa_part_drawings                 1 แถว = 1 แผ่น/มุมมอง (title เช่น "View A")
--   qa_inspection_items.drawing_id   balloon อยู่บนแผ่นไหน (ลบแผ่น → set null)
--
-- ย้ายข้อมูลเดิม: qa_parts.drawing_url ที่มีอยู่ → กลายเป็นแผ่นแรกของ part นั้น
-- และ backfill drawing_id ให้จุดตรวจที่วาง balloon ไว้แล้ว
-- (คง qa_parts.drawing_url ไว้เฉยๆ เพื่อ backward compat — โค้ดใหม่ไม่ใช้แล้ว)

create table if not exists qa_part_drawings (
  id          uuid primary key default gen_random_uuid(),
  part_id     uuid not null references qa_parts(id) on delete cascade,
  title       text not null default 'Drawing',
  drawing_url text not null,
  drawing_rev text,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_qa_part_drawings_part on qa_part_drawings (part_id, sort, created_at);

alter table qa_part_drawings enable row level security;
drop policy if exists qa_part_drawings_select on qa_part_drawings;
create policy qa_part_drawings_select on qa_part_drawings
  for select to authenticated using (true);
drop policy if exists qa_part_drawings_write on qa_part_drawings;
create policy qa_part_drawings_write on qa_part_drawings
  for all to authenticated
  using ((select has_perm('qa:manage')))
  with check ((select has_perm('qa:manage')));

alter table qa_inspection_items
  add column if not exists drawing_id uuid references qa_part_drawings(id) on delete set null;

-- migrate drawing เดิม (ครั้งเดียว — ข้าม part ที่มีแผ่นในตารางใหม่แล้ว)
insert into qa_part_drawings (part_id, title, drawing_url, drawing_rev)
select p.id, 'Drawing 1', p.drawing_url, p.drawing_rev
from qa_parts p
where p.drawing_url is not null
  and not exists (select 1 from qa_part_drawings d where d.part_id = p.id);

-- backfill: จุดที่วาง balloon แล้วแต่ยังไม่รู้แผ่น → ผูกกับแผ่นแรกของ part
update qa_inspection_items i
set drawing_id = d.id
from qa_part_drawings d
where i.drawing_id is null
  and i.pos_x is not null
  and d.part_id = i.part_id;
