-- ══ QA FME — Middle ตาม "ยอดผลิตรายพาร์ท" คำนวณจาก lot size ═════════════════════════
-- Target project: MAIN (ewhdfqwfwofivojtsizn) · ต้องรันหลัง 20260819_qa_fme_call.sql
--
-- คำสั่ง user 2026-08-20: "คาบของ middle ต้องรายพาร์ท คำนวณจาก lot size"
--
-- ของเดิม (20260819): middle = เวลาเดียวทั้งโรงงาน (`mid_after_min`) และ unique key ทำให้
-- **เกิดได้ครั้งเดียวต่อรอบ** → ใช้กับของจริงไม่ได้:
--   • ไลน์ลอทใหญ่ผลิตทั้งวัน ต้องตรวจซ้ำเป็นระยะ ไม่ใช่ครั้งเดียวทั้งกะ
--   • ไลน์ลอทสั้น 2-3 ชม.จบ อาจไม่ต้องมี middle เลย
--   • เวลาเท่ากันทุกพาร์ทไม่มีความหมาย — พาร์ทเร็ว/ช้าผลิตได้จำนวนต่างกันมาก
-- ⇒ ผูกกับ **ยอดผลิตสะสมในรอบนั้น** เทียบ lot_size ของพาร์ทเอง (kanban_standards ฝั่ง DR)
--
-- ⚠️ ไม่รู้ lot_size = **ไม่เดา** → พาร์ทนั้นไม่มีการตรวจ Middle (แต่ First/End ยังทำงานปกติ)
--    และตัวสแกนต้องรายงานรายชื่อพาร์ทที่ตกหล่นออกมา ห้ามเงียบ (กฎ "ห้ามล้มเหลวเงียบ")

-- ── 1) obligation: middle เกิดซ้ำได้ในรอบเดียว → ต้องมีลำดับ ──────────────────
alter table qa_fme_obligations add column if not exists seq    int not null default 1;
alter table qa_fme_obligations add column if not exists at_qty int;   -- ยอดสะสมที่ทำให้ถึงคิวตรวจ

comment on column qa_fme_obligations.seq is
  'ลำดับงานตรวจของ stage นั้นในรอบเดียวกัน — middle ครั้งที่ 1,2,3... (first/end มีแค่ 1 เสมอ)';
comment on column qa_fme_obligations.at_qty is
  'ยอดผลิตสะสมของรอบนั้น ณ จุดที่ถึงคิวตรวจ (middle) — ให้ QA รู้ว่าตรวจตอนผลิตครบเท่าไหร่';

-- unique เดิม (line, date, shift, mat, stage) ทำให้ middle ซ้ำไม่ได้ → รวม seq เข้าไป
alter table qa_fme_obligations
  drop constraint if exists qa_fme_obligations_line_name_work_date_shift_mat_no_stage_key;
create unique index if not exists qa_fme_oblig_uniq
  on qa_fme_obligations (line_name, work_date, shift, mat_no, stage, seq);

-- ── 2) config ───────────────────────────────────────────────────────────────
alter table qa_fme_config add column if not exists mid_mode        text    not null default 'lot';
alter table qa_fme_config add column if not exists mid_lot_ratio   numeric not null default 1;
alter table qa_fme_config add column if not exists mid_max_per_run int     not null default 12;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qa_fme_config_mid_mode_chk') then
    alter table qa_fme_config add constraint qa_fme_config_mid_mode_chk
      check (mid_mode in ('off', 'lot', 'min'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qa_fme_config_mid_ratio_chk') then
    alter table qa_fme_config add constraint qa_fme_config_mid_ratio_chk
      check (mid_lot_ratio > 0 and mid_lot_ratio <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qa_fme_config_mid_max_chk') then
    alter table qa_fme_config add constraint qa_fme_config_mid_max_chk
      check (mid_max_per_run between 1 and 50);
  end if;
end $$;

comment on column qa_fme_config.mid_mode is
  'off = ไม่เรียกตรวจช่วงกลาง · lot = ทุกๆ (lot_size × mid_lot_ratio) ชิ้น (ค่าเริ่มต้น) · min = ตามเวลาแบบเดิม (mid_after_min)';
comment on column qa_fme_config.mid_lot_ratio is
  'ตัวคูณ lot_size → 1 = ตรวจทุก 1 ล็อต · 0.5 = ทุกครึ่งล็อต (ถี่ขึ้น) · 2 = ทุก 2 ล็อต';
comment on column qa_fme_config.mid_max_per_run is
  'เพดานจำนวน middle ต่อ 1 รอบ — กันพาร์ทที่ตั้ง lot_size ไว้เล็กมากแล้วเรียก QA รัวจนใช้งานไม่ได้';

-- ── 3) override รายพาร์ท (ไม่ตั้ง = ใช้ lot_size × ratio) ────────────────────
create table if not exists qa_fme_part_rules (
  mat_no        text primary key,
  mid_every_pcs int check (mid_every_pcs > 0),  -- null = ใช้ค่าที่คำนวณจาก lot_size
  is_active     boolean not null default true,  -- false = พาร์ทนี้ไม่ต้องตรวจ Middle เลย
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);
comment on table qa_fme_part_rules is
  'ตั้งคาบตรวจ Middle รายพาร์ท — ไม่มีแถว = คำนวณจาก kanban_standards.lot_size × mid_lot_ratio';

alter table qa_fme_part_rules enable row level security;
drop policy if exists qa_fme_rule_select on qa_fme_part_rules;
create policy qa_fme_rule_select on qa_fme_part_rules for select to authenticated using (true);
drop policy if exists qa_fme_rule_write on qa_fme_part_rules;
create policy qa_fme_rule_write on qa_fme_part_rules for all to authenticated
  using ((select has_perm('qa:manage'))) with check ((select has_perm('qa:manage')));

-- ไม่เพิ่ม permission key ใหม่ (ใช้ qa:record / qa:manage เดิม) — เลี่ยงกับดัก seed enum_range
