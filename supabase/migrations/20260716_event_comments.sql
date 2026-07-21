-- ── คอมเมนต์ใต้เหตุการณ์ (นำร่อง: ใบซ่อม MO + Downtime) — DR project (2026-07-16) ──
-- ก้าวแรกของ "สื่อสารในระบบแทน chat แยก": คุยกันใต้ใบงานจริง มีประวัติติดใบ
-- ตารางอยู่ DR (ใบ MO/downtime อยู่ DR) — RLS anon-open ตาม convention ฝั่ง DR
-- (supabaseDR ไม่มี JWT — ห้ามใช้ TO authenticated เด็ดขาด ดู CLAUDE.md "Supabase Projects")
-- author_id = profiles.id ฝั่ง Main (เก็บอ้างอิงเฉยๆ ไม่มี FK ข้าม project) + snapshot ชื่อ

create table if not exists public.event_comments (
  id          bigint generated always as identity primary key,
  ref_kind    text not null check (ref_kind in ('mtn_order', 'downtime')),
  ref_id      text not null,
  author_id   uuid,
  author_name text not null default 'ไม่ระบุชื่อ',
  body        text not null check (length(body) between 1 and 2000),
  mentions    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists event_comments_ref_idx on public.event_comments (ref_kind, ref_id, created_at);

alter table public.event_comments enable row level security;
drop policy if exists event_comments_open on public.event_comments;
create policy event_comments_open on public.event_comments
  for all using (true) with check (true);
