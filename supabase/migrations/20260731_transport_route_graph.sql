-- ============================================================================
-- Transport route graph — ถนน/ทางเดินรถในโรงงาน (Teiki-bin/AMR route base)
-- ============================================================================
-- TARGET PROJECT: DR / "Product DB" (eyhclzkifitbhbljgoav) — supabaseDR client.
--
-- แกนหลัก + ผูก Transport (ดู docs/TRANSPORT_AMR_DESIGN.md):
--   วาด "กราฟถนน" ทับรูปผังใหญ่เดียวกับ /factory-map (factory_map ฝั่ง Main)
--   node = จุด/แยก/จุดจอด/จุดชาร์จ (พิกัดเป็น % ของรูป 0-100 เหมือน factory_line_regions)
--   edge = เส้นถนนเชื่อม node (undirected โดย default) — ใช้คำนวณเส้นทางสั้นสุด (Dijkstra)
--   round_stops = ลำดับจุดจอดต่อ "รอบส่ง" (kanban_delivery_rounds) → route จริงต่อรอบ
--
-- ⚠️ node เก็บแค่ %coord ไม่มี FK ข้ามไป Main (factory_map) — client โหลดรูปจาก Main เอง
--    (pattern เดียวกับ transport_carriers/round_assignments ที่ไม่ FK ข้าม project)
-- RLS mirrors other DR tables (allow_all, public) — supabaseDR เป็น anon เสมอ.
-- additive ล้วน · ยังไม่ apply = หน้า Store/AMR editor เตือน + ระบบเดิมไม่กระทบ
-- ============================================================================

-- node บนผังถนน (จุด/แยก/จุดจอด/จุดชาร์จ)
create table if not exists public.transport_nodes (
  id              uuid primary key default gen_random_uuid(),
  code            text,                         -- รหัสสั้น (optional)
  name            text,                         -- ชื่อจุด (เช่น "STORE-IN", "แยก A")
  kind            text not null default 'junction',  -- junction | stop | dock | charge
  x               numeric not null,             -- % ของรูป 0-100
  y               numeric not null,             -- % ของรูป 0-100
  line_name       text,                         -- ผูกไลน์/สโตร์ที่จุดจอดนี้บริการ (optional)
  is_active       boolean not null default true,
  note            text,
  updated_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- edge = เส้นถนนเชื่อม 2 node · undirected (bidir=true) โดย default
--   weight null = คำนวณจากระยะทาง %coord อัตโนมัติฝั่ง client (ปรับทับได้ถ้าถนนอ้อม/ช้า)
create table if not exists public.transport_edges (
  id              uuid primary key default gen_random_uuid(),
  a_node          uuid not null references public.transport_nodes(id) on delete cascade,
  b_node          uuid not null references public.transport_nodes(id) on delete cascade,
  bidir           boolean not null default true,   -- false = เดินได้ทางเดียว a→b (one-way)
  weight          numeric,                          -- null = auto (ระยะทาง %) · ตั้งเองเพื่อถ่วงน้ำหนัก
  is_active       boolean not null default true,
  updated_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (a_node <> b_node)
);

-- ลำดับจุดจอดต่อรอบส่ง (route = เดินผ่าน stop เหล่านี้ตาม seq แล้ว pathfind ระหว่างคู่)
create table if not exists public.transport_round_stops (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references public.kanban_delivery_rounds(id) on delete cascade,
  seq             int  not null default 0,
  node_id         uuid not null references public.transport_nodes(id) on delete cascade,
  updated_by_name text,
  created_at      timestamptz not null default now(),
  unique (round_id, seq)
);

create index if not exists idx_transport_edges_a       on public.transport_edges(a_node);
create index if not exists idx_transport_edges_b       on public.transport_edges(b_node);
create index if not exists idx_transport_round_stops_r on public.transport_round_stops(round_id);
create index if not exists idx_transport_nodes_active  on public.transport_nodes(is_active);

alter table public.transport_nodes        enable row level security;
alter table public.transport_edges        enable row level security;
alter table public.transport_round_stops  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['transport_nodes','transport_edges','transport_round_stops'] loop
    if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename=t and policyname='allow_all_'||t) then
      execute format('create policy %I on public.%I for all to public using (true) with check (true)',
                     'allow_all_'||t, t);
    end if;
  end loop;
end $$;
