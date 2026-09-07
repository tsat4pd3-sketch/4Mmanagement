-- ══ 🎯 จุดส่งงานหน้าไลน์ (delivery points) — ลูป Store ⇄ Production เฟส 4 ═══════════════════
-- Target project: DR (eyhclzkifitbhbljgoav)
--
-- ที่มา: docs/STORE-PULL-LOOP-DESIGN.md §4.5 (workflow ที่ user เขียนเอง 2026-08-27 · ขั้น 7)
--   "นำพาร์ทไปส่ง → ถึงที่หมาย สแกน QR ตรงจุดส่งงาน (ต้อง gen QR เพิ่ม)"
--   + §4.6 ด่าน "จุดส่ง": เทียบตัวตนจุดกับปลายทางบนใบตรงๆ ห้าม infer จากพาร์ท
--
-- ⚠️ ทำไมไม่ใช้ `transport_nodes` (kind='stop') ตรงๆ
--    node ของกราฟถนนบังคับพิกัด x/y บนผังรวม — ไลน์ที่ยังไม่ได้วาดถนนบนผังจะตั้งจุดส่งไม่ได้เลย
--    = ทางตัน (หลัก "เจอพื้นที่ใหม่แล้วกรอกไม่ได้" ที่ทะเบียนรหัสคลังเจอมาแล้ว) · จุดส่ง = "ป้ายที่แปะไว้
--    หน้าไลน์" ไม่ต้องรู้พิกัด · ผูกกลับกราฟถนนได้ทีหลังผ่าน `transport_node_id` (optional)
--
-- ⚠️ ทำไมไม่ใช้ `storage_zones` — โซนคือ "ที่กองของในคลัง" (WMS) ไม่ใช่จุดวางของหน้าไลน์ผลิต
--
-- ⚠️ `line_names text[]` (ไม่ใช่ line_name เดี่ยว) — แร็คเดียวป้อนทั้ง Line 60+61 จริง (CLAUDE.md)
--    · ต้องเป็น **ไลน์ย่อยที่สุด (leaf)** ตามกฎ "ไลน์แม่ที่มีลูก = แผนก ไม่ใช่จุดวางของ" (คุมที่ UI)
--    · เป็น text snapshot → ต้องเข้า `handleRenameLine` cascade (LineSetup.jsx) แบบอ่าน-แก้-เขียน
--      (เหมือน lpa_questions.hidden_for_lines) ไม่งั้นเปลี่ยนชื่อไลน์แล้วจุดส่งกำพร้าเงียบๆ
--
-- ⚠️ QR เข้ารหัสด้วย `id` (uuid) ไม่ใช่ `code` — ป้ายอยู่หน้างานเป็นปี เปลี่ยนรหัสแล้วป้ายเก่าต้องไม่ชี้ผิด
--    (เหตุผลเดียวกับป้ายเครื่องจักร src/utils/qrCode.js) · `code` มีไว้ให้คนอ่าน/พิมพ์มือตอนป้ายเลอะ
--
-- Rollback: ท้ายไฟล์

create table if not exists line_delivery_points (
  id                uuid primary key default gen_random_uuid(),
  code              text,                                  -- รหัสสั้นบนป้ายให้คนอ่าน (เช่น DP-60A) — unique ไม่แคร์ตัวพิมพ์
  name              text not null,                         -- ชื่อจุด (เช่น "จุดรับของหน้า OP10")
  line_names        text[] not null default '{}',          -- ไลน์ (leaf) ที่จุดนี้รับของให้ — 1 จุดหลายไลน์ได้
  transport_node_id uuid,                                  -- ผูกจุดจอดบนกราฟถนน /transport (optional · เฟสหน้า)
  note              text,
  sort_order        int  not null default 0,
  is_active         boolean not null default true,
  updated_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- รหัสสั้นซ้ำ = สแกน/พิมพ์มือแล้วได้ 2 จุด → กันตั้งแต่ DB (ว่างได้ · เทียบตัวพิมพ์ใหญ่)
create unique index if not exists line_delivery_points_code_uniq
  on line_delivery_points (upper(code)) where code is not null and code <> '';
create index if not exists line_delivery_points_lines_idx on line_delivery_points using gin (line_names);

-- ผูกกราฟถนนแบบหลวม — ลบ node แล้วจุดส่งยังอยู่ (แค่หลุดจากผัง)
do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'transport_nodes')
     and not exists (select 1 from pg_constraint where conname = 'line_delivery_points_node_fk') then
    alter table line_delivery_points add constraint line_delivery_points_node_fk
      foreign key (transport_node_id) references transport_nodes(id) on delete set null;
  end if;
end $$;

comment on table  line_delivery_points is
  'จุดส่งงานหน้าไลน์ — ป้าย QR (ESM:D:<id>) ที่สโตร์ยิงตอนวางของถึงไลน์ (ลูป Store⇄Production ขั้น 7) · 1 จุดหลายไลน์ได้ · ไลน์ต้องเป็น leaf';
comment on column line_delivery_points.line_names is
  'ไลน์ย่อยที่สุด (leaf) ที่จุดนี้รับของให้ — text snapshot ต้องเข้า rename cascade ใน LineSetup';
comment on column line_delivery_points.code is
  'รหัสสั้นพิมพ์บนป้ายให้คนอ่าน/พิมพ์มือ — QR ใช้ id ไม่ใช่รหัสนี้ (เปลี่ยนรหัสได้โดยไม่ต้องพิมพ์ป้ายใหม่)';

-- RLS: DR เป็น anon เสมอ (กฎเหล็ก — supabaseDR ไม่เคย authenticate) สิทธิ์คุมที่ UI ผ่าน can('delivery_point','manage')
alter table line_delivery_points enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'line_delivery_points' and policyname = 'line_delivery_points_all') then
    create policy line_delivery_points_all on line_delivery_points for all using (true) with check (true);
  end if;
end $$;

-- updated_at + audit (pattern เดียวกับ line_part_levels / storage_zones)
-- ⚠️ ต้องเพิ่ม 'line_delivery_points' ใน DR_AUDIT_TABLES (src/supabaseClient.js) ให้ actor ถูก stamp
do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_line_delivery_points_updated on line_delivery_points;
    create trigger trg_line_delivery_points_updated before update on line_delivery_points
      for each row execute function fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_line_delivery_points_audit on line_delivery_points;
    create trigger trg_line_delivery_points_audit after insert or update or delete on line_delivery_points
      for each row execute function fn_audit();
  end if;
end $$;

-- ── ตรวจหลังรัน ──
-- select count(*) from line_delivery_points;          -- 0 (ยังไม่ seed — หัวหน้าไลน์ตั้งเองที่ /linesetup)
-- select policyname from pg_policies where tablename = 'line_delivery_points';

-- Rollback:
--   drop table if exists line_delivery_points;
--   (Main: ดู 20260903_wip_replenish_deliver_gate.sql — ถอยโค้ดก่อน แล้วค่อยแตะ schema)
