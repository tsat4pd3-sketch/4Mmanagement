-- 🔧 FIXTURE SHIM RECORD & SUSTAINABILITY (DR project · 2026-09-01) — ✅ apply แล้ว 2026-09-01
--
-- โจทย์ลูกค้า: ต้องมี shim record เพื่อควบคุม fixture sustainability
-- ออกแบบเต็ม + ข้อมูลจริงที่วัดได้ + กฎเหล็ก: docs/FIXTURE-SHIM-DESIGN.md
--
-- ⚠️ ตัวตน fixture อยู่ `machines` (equipment_kind='jig') ตามกฎ "ชนิดอุปกรณ์เป็นแกน ไม่ใช่ตาราง"
--    **ห้ามสร้างทะเบียน fixture ใหม่** — ไฟล์นี้เพิ่มแค่ "รายละเอียดเฉพาะชนิด" (pattern เดียวกับ equipment_die)
--
-- ⚠️ ทุกตารางต้องมี updated_by_name เพราะจะอยู่ใน DR_AUDIT_TABLES
--    (supabaseClient.js stamp ชื่อผู้แก้ให้อัตโนมัติ — DR เป็น anon ไม่มี auth.uid())
--
-- Rollback:
--   drop table if exists fixture_shim_events;
--   drop table if exists fixture_points;
--   drop table if exists fixture_point_kinds;
--   alter table machines drop column if exists pieces_per_cycle;
--   delete from jigs_fixture_parts;  -- ถ้าสร้างในเฟสถัดไป

-- ── 1) master ชนิดจุด (data-driven — เพิ่มชนิดใหม่ = เพิ่มแถว ไม่ต้องแก้โค้ด) ────────
create table if not exists fixture_point_kinds (
  code                    text primary key,
  label                   text not null,
  icon                    text,
  color                   text,
  sort_order              int  not null default 0,
  is_active               boolean not null default true,
  -- ค่าเริ่มต้นตอนสร้างจุด — คนแก้ทับได้เสมอ (ระบบเสนอ คนตัดสิน)
  default_interval_days   int,
  default_interval_cycles int,
  default_life_cycles     int,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  updated_by_name         text
);
comment on table fixture_point_kinds is
  'ชนิดจุดปรับ/จุดอ้างอิงของ fixture + ค่าความถี่เริ่มต้น — เพิ่มชนิดใหม่ได้โดยไม่ต้องแก้โค้ด';

-- ค่าเริ่มต้นอิงเกณฑ์อุตสาหกรรม (ดู docs §6): ตรวจตาทุกกะ · วัดรายสัปดาห์ · เปลี่ยน pin รายไตรมาส
-- ⚠️ default_life_cycles = ค่าตั้งต้นชั่วคราว **ไม่ใช่มาตรฐาน** — ไม่มีมาตรฐานสากลเป็นจำนวน cycle
--    ระบบจะเสนอค่าจริงของโรงงานเราเมื่อมีประวัติเปลี่ยนครบ 3 ครั้ง (เสนอ ไม่แก้ให้เอง)
insert into fixture_point_kinds (code, label, icon, color, sort_order,
                                 default_interval_days, default_interval_cycles, default_life_cycles) values
  ('locator_pin', 'Locator Pin (พินระบุตำแหน่ง)', '📍', '#ef4444', 10,  7, 5000, 30000),
  ('bush',        'Bush / บุชนำ',                  '⭕', '#f59e0b', 20, 14, 8000, 40000),
  ('clamp',       'Clamp / ตัวกด',                 '🗜️', '#3b82f6', 30, 30, null,  null),
  ('rest_pad',    'Rest Pad / แผ่นรอง',            '▭', '#22c55e', 40, 90, null,  null),
  ('block',       'Block / บล็อกอ้างอิง',          '🧱', '#8b5cf6', 50, 90, null,  null),
  ('other',       'อื่นๆ',                         '•',  '#94a3b8', 90, null, null, null)
on conflict (code) do nothing;

-- ── 2) ทะเบียนจุดของ fixture ─────────────────────────────────────────────────────
create table if not exists fixture_points (
  id                   uuid primary key default gen_random_uuid(),
  machine_id           uuid not null references machines(id) on delete cascade,
  point_no             text not null,                    -- เลขจุดตาม drawing: L1, C3, RP2…
  kind_code            text references fixture_point_kinds(code),
  name                 text,                             -- คำอธิบายจุด (optional)
  -- ผูกหมุดบนรูปที่มีอยู่แล้วได้ (optional — ไม่ผูกก็ใช้งานได้เต็ม)
  checkpoint_id        uuid references jig_checkpoints(id) on delete set null,

  -- baseline: ค่า ณ วันรับมอบ — ⚠️ ห้ามแก้ทับ แก้ = ออก revision พร้อมเหตุผล
  baseline_shim_mm     numeric,
  baseline_at          date,
  baseline_by          text,

  current_shim_mm      numeric,      -- ค่ารวมปัจจุบัน (sync จาก event ล่าสุด)
  -- ⚠️ null = ยังไม่ตั้งเกณฑ์ = ไม่เตือนอะไรเลย · ห้ามตีเป็น 0 (0 = ห้ามใส่ชิมเลย)
  max_shim_mm          numeric,

  -- ความถี่ 2 แกน — null = ตามความถี่ของ checklist เหมือนเดิม (backward-compatible)
  interval_days        int,
  interval_cycles      int,
  expected_life_cycles int,

  last_check_at        timestamptz,
  last_check_shot      numeric,
  last_replaced_at     timestamptz,
  last_replaced_shot   numeric,      -- ใช้เรียนรู้ tool life จริงของโรงงานเรา

  note                 text,
  sort_order           int not null default 0,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by_name      text
);

-- 1 fixture มีเลขจุดซ้ำไม่ได้ (เฉพาะจุดที่ยังใช้งาน — จุดที่ปิดแล้วเก็บเป็นประวัติได้)
create unique index if not exists fixture_points_uniq
  on fixture_points (machine_id, point_no) where is_active;
create index if not exists fixture_points_machine_idx on fixture_points (machine_id);

comment on column fixture_points.baseline_shim_mm is
  'ค่าชิม ณ วันรับมอบ fixture — ห้ามแก้ทับ (แก้ = ออก revision) เพราะเป็นจุดอ้างอิงว่าเบี่ยงไปเท่าไหร่แล้ว';
comment on column fixture_points.max_shim_mm is
  'เพดานชิมสะสม — null = ยังไม่ตั้งเกณฑ์ = ไม่เตือน · ห้ามตีเป็น 0';
comment on column fixture_points.interval_cycles is
  'ความถี่ตรวจตาม shot (ครั้งที่จิ๊กจับ-ปล่อย) — null = ใช้ความถี่ของ checklist เหมือนเดิม';

-- ── 3) เหตุการณ์เปลี่ยนชิม (1 แถว = 1 ครั้ง) ─────────────────────────────────────
create table if not exists fixture_shim_events (
  id               uuid primary key default gen_random_uuid(),
  point_id         uuid not null references fixture_points(id) on delete cascade,
  event_at         timestamptz not null default now(),
  -- add / remove / replace_set / recount (ตรวจนับแล้วพิมพ์ทับ) / part_replaced (เปลี่ยนชิ้นส่วน)
  action           text not null default 'add',

  -- ⚠️ ค่ารวมคือความจริง · delta เป็นแค่วิธีกรอก **ห้ามบวกสะสมจาก delta**
  shim_before_mm   numeric,
  shim_after_mm    numeric,
  delta_mm         numeric,            -- = after − before (เก็บไว้อ่านง่าย ไม่ใช้คำนวณยอด)
  plates_text      text,               -- รายละเอียดแผ่น เช่น '0.5 + 0.2' (ข้อความประกอบ)

  measure_before   numeric,            -- ค่าที่วัดได้ก่อน (ตำแหน่งชิ้นงาน/gap)
  measure_after    numeric,
  measure_unit     text default 'mm',

  -- wear / part_rev_change / after_repair / quality_issue / new_setup / other
  reason           text,
  note             text,               -- บังคับกรอกเมื่อ reason = 'other' (คุมที่ UI)

  by_name          text,
  approved_by      text,               -- หัวหน้าช่าง JIG
  approved_at      timestamptz,

  -- ref ย้อนกลับ — ⚠️ four_m_log_id / qa_ncr_id อยู่ Main project จึง **ไม่มี FK ข้าม project**
  mtn_order_id     uuid references mtn_orders(id) on delete set null,
  four_m_log_id    uuid,
  qa_ncr_id        uuid,

  shot_at_event    numeric,            -- shot สะสมของ fixture ณ วันนั้น (ใช้เรียนรู้ tool life)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
create index if not exists fixture_shim_events_point_idx on fixture_shim_events (point_id, event_at desc);

comment on table fixture_shim_events is
  'บันทึกการใส่/ถอดชิมรายจุด — ค่ารวม (shim_after_mm) คือความจริง, delta เป็นแค่วิธีกรอก';

-- ── 4) จำนวนชิ้นต่อ 1 ครั้งที่จิ๊กทำงาน (ระดับ fixture — user ยืนยันว่าพอ) ────────
-- 1:1 = 1 · ออก 2 ชิ้นต่อครั้ง = 2 · ออกคู่ RH+LH = 2 (แต่การนับใช้ max ผ่าน pairAwareTotal)
alter table machines add column if not exists pieces_per_cycle int;
comment on column machines.pieces_per_cycle is
  'จำนวนชิ้นที่ออกต่อ 1 ครั้งที่จิ๊ก/แม่พิมพ์ทำงาน — ใช้แปลงยอดผลิตเป็น shot · null = ยังไม่ตั้ง (ถือเป็น 1 แต่ต้องเตือนบนจอ)';

-- ── 5) RLS (DR = anon เสมอ · สิทธิ์คุมที่ UI ผ่าน can()) ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['fixture_point_kinds','fixture_points','fixture_shim_events'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_all') then
      execute format('create policy %I on %I for all using (true) with check (true)', t || '_all', t);
    end if;
  end loop;
end $$;

-- ── 6) audit + updated_at (guard แบบเดียวกับ migration เดิม) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['fixture_point_kinds','fixture_points','fixture_shim_events'] loop
    if exists (select 1 from pg_proc where proname = 'fn_set_updated_at')
       and not exists (select 1 from pg_trigger where tgname = 'trg_' || t || '_updated_at') then
      execute format('create trigger %I before update on %I for each row execute function fn_set_updated_at()',
                     'trg_' || t || '_updated_at', t);
    end if;
    if exists (select 1 from pg_proc where proname = 'fn_audit')
       and not exists (select 1 from pg_trigger where tgname = 'trg_' || t || '_audit') then
      execute format('create trigger %I after insert or update or delete on %I for each row execute function fn_audit()',
                     'trg_' || t || '_audit', t);
    end if;
  end loop;
end $$;

-- ⚠️ อย่าลืมเพิ่ม 3 ตารางนี้ใน DR_AUDIT_TABLES (src/supabaseClient.js)
--    ไม่งั้น updated_by_name จะไม่ถูก stamp → audit_log ไม่รู้ว่าใครแก้

-- ตรวจหลังรัน:
-- select count(*) from fixture_point_kinds;                                   -- 6
-- select column_name from information_schema.columns
--  where table_name='machines' and column_name='pieces_per_cycle';            -- 1 แถว
