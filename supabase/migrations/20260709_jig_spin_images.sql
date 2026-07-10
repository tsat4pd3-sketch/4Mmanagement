-- 360° spin viewer for PM equipment — many photo frames per jig, pins bound to a frame.
-- Project: Product DB (eyhclzkifitbhbljgoav), app uses the anon supabaseDR client →
-- anon-open RLS (NOT TO authenticated). Additive & backward-compatible:
--   jigs.image_path stays the "primary/first frame" (existing displays keep working)
--   jig_images      holds every frame (single image = 1 frame; spin = many)
--   jig_checkpoints.image_id binds a pin to a specific frame (NULL = the first frame)

create table if not exists public.jig_images (
  id            uuid primary key default gen_random_uuid(),
  jig_id        uuid not null references public.jigs(id) on delete cascade,
  title         text,
  image_path    text not null,          -- bucket 'jig-images'
  sort          int not null default 0, -- frame order (spin sequence)
  is_spin_frame boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table public.jig_images enable row level security;
drop policy if exists jig_images_all on public.jig_images;
create policy jig_images_all on public.jig_images
  for all to anon, authenticated using (true) with check (true);

alter table public.jig_checkpoints
  add column if not exists image_id uuid references public.jig_images(id) on delete set null;

-- Backfill: existing single equipment image → its first frame; pin its checkpoints to it.
do $$
declare r record; v_img uuid;
begin
  for r in select id, image_path from public.jigs where image_path is not null loop
    if exists (select 1 from public.jig_images where jig_id = r.id) then continue; end if;
    insert into public.jig_images (jig_id, image_path, sort, is_spin_frame, title)
      values (r.id, r.image_path, 0, false, 'รูปหลัก') returning id into v_img;
    update public.jig_checkpoints set image_id = v_img
      where jig_id = r.id and x_pos is not null and image_id is null;
  end loop;
end $$;
