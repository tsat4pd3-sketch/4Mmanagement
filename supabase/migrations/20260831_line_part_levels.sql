-- ══ min/max ของพาร์ท "ต่อไลน์" — ชั้นที่หายไปของลูป Store ⇄ Production ═══════════════
-- Target project: DR (eyhclzkifitbhbljgoav)
--
-- ที่มา: docs/STORE-PULL-LOOP-DESIGN.md §4.2 (workflow ที่ user เขียนเอง 2026-08-27 · ขั้น 3)
--   "ถึงค่า min → แจ้งหัวหน้าฝ่ายผลิตว่ามี child part / raw material ที่ต้องเบิกเติมเต็ม"
--
-- ⚠️ ทำไมต้องมีตารางใหม่ ไม่ใช้ `kanban_standards.min_qty/max_qty`
--    ค่านั้นเป็น min/max **ต่อ mat ทั้งโรงงาน** (กฎเหล็กใน CLAUDE.md: v_store_abnormal v3
--    เทียบระดับรวมทุกคลัง เพราะเทียบรายคลัง = แจ้งซ้ำ/แจ้งผิด)
--    แต่พาร์ทตัวเดียวกันวางที่ 3 ไลน์ **ต้องมี min คนละค่า** — พื้นที่วางไม่เท่ากัน กินไม่เท่ากัน
--    ⇒ คนละแนวคิด ไม่ใช่ master ซ้ำ (เหมือน std_day_shift ที่แยกจาก headcount จริง)
--
-- ⚠️ ไม่ตั้ง = **ไม่แจ้ง** (ไม่เดา min ให้) แล้วขึ้นเป็น worklist ว่าพาร์ทไหนยังไม่ตั้ง
--    "สั่งเติมเมื่อเหลือกี่ชิ้น" เป็นการตัดสินใจของคนที่ยืนหน้าไลน์ ไม่ใช่ของระบบ
--
-- ⚠️ `line_name` เป็น text snapshot → ต้องเข้า `handleRenameLine` cascade (LineSetup.jsx)
--    ไม่งั้นเปลี่ยนชื่อไลน์แล้วค่า min กำพร้าเงียบๆ
--
-- ตั้งค่าโดย: หัวหน้าไลน์ + หัวหน้าแผนกฝ่ายผลิต (user เคาะ §6.3 — ไม่ใช่ Planning)
--
-- Rollback: ท้ายไฟล์

create table if not exists line_part_levels (
  id            uuid primary key default gen_random_uuid(),
  line_name     text not null,
  mat_no        text not null,
  min_qty       numeric,
  max_qty       numeric,
  reorder_qty   numeric,          -- เบิกครั้งละเท่าไหร่ (null = เติมให้ถึง max)
  note          text,
  is_active     boolean not null default true,
  updated_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists line_part_levels_uniq on line_part_levels (line_name, mat_no);
create index if not exists line_part_levels_line_idx on line_part_levels (line_name) where is_active;

-- ค่าติดลบไม่มีความหมาย · max ต่ำกว่า min = ตั้งผิดแน่ๆ (เติมแล้วเกินทันที)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'line_part_levels_qty_chk') then
    alter table line_part_levels add constraint line_part_levels_qty_chk check (
      (min_qty is null or min_qty >= 0)
      and (max_qty is null or max_qty >= 0)
      and (reorder_qty is null or reorder_qty > 0)
      and (min_qty is null or max_qty is null or max_qty >= min_qty)
    );
  end if;
end $$;

comment on table  line_part_levels is 'min/max ของพาร์ทต่อไลน์ (จุดใช้งาน) — คนละชั้นกับ kanban_standards ที่เป็นระดับทั้งโรงงาน · ไม่ตั้ง = ไม่แจ้ง (ไม่เดาให้)';
comment on column line_part_levels.min_qty     is 'เหลือถึงเท่านี้ = เสนอให้หัวหน้าไลน์ตัดสินใจเบิก (null = ไม่เฝ้าพาร์ทนี้)';
comment on column line_part_levels.max_qty     is 'เติมเต็มถึงเท่านี้ — ใช้คำนวณจำนวนที่เสนอ (null = ใช้ reorder_qty)';
comment on column line_part_levels.reorder_qty is 'เบิกครั้งละเท่าไหร่ (null = เติมให้ถึง max)';

-- RLS: DR เป็น anon เสมอ (กฎเหล็ก — supabaseDR ไม่เคย authenticate) สิทธิ์คุมที่ UI ผ่าน can()
alter table line_part_levels enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'line_part_levels' and policyname = 'line_part_levels_all') then
    create policy line_part_levels_all on line_part_levels for all using (true) with check (true);
  end if;
end $$;

-- updated_at + audit (pattern เดียวกับ master ตัวอื่นฝั่ง DR)
do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_line_part_levels_updated on line_part_levels;
    create trigger trg_line_part_levels_updated before update on line_part_levels
      for each row execute function fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_line_part_levels_audit on line_part_levels;
    create trigger trg_line_part_levels_audit after insert or update or delete on line_part_levels
      for each row execute function fn_audit();
  end if;
end $$;

-- Rollback:
--   drop table if exists line_part_levels;
