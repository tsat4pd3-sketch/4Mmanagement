-- 🔩 งานปั๊ม — ความสูงแม่พิมพ์ (die height) + ช่วง shut height ของเครื่อง + กฎเวลาเปลี่ยนรุ่น
--    (DR project "Product DB" · eyhclzkifitbhbljgoav · 2026-09-25 · คำสั่ง user)
--
-- โจทย์จาก user:
--   "งานปั๊มมันจะวุ่นวายกว่าที่ผ่านมา มันมี setup time change over die มาเป็นตัวแปร
--    ถ้า die height ต่างกันเกินมันมีผล เลยต้องมีการ drag จัดแผนเพื่อหา optimization"
--
-- = classic sequence-dependent setup time — ลำดับที่ผลิตเปลี่ยน ⇒ เวลา setup รวมเปลี่ยน
--   จัดลำดับให้ Δdie height น้อย = ปรับ shut height น้อย = ได้เวลาผลิตคืนมา
--
-- ⚠️ ก่อนหน้านี้ระบบไม่มีข้อมูลตั้งต้นเลยสักตัว (สำรวจ 2026-09-24):
--   · `equipment_die` มี tonnage_ton แต่ **ไม่มี die height**
--   · `machines` ไม่มีช่วง shut height ⇒ ไม่รู้ว่าแม่พิมพ์ขึ้นเครื่องไหนได้
--   · downtime "Set up Machine" 379 ครั้ง/120 วัน แต่ **336 ครั้ง (89%) กรอก 30 นาทีเป๊ะ**
--     = ค่าเหมา ไม่ใช่เวลาที่วัดจริง · และ **ไลน์ปั๊มไม่เคยบันทึกสักครั้ง**
--   ⇒ ถ้าสร้าง optimizer บนข้อมูลชุดนั้น = จอที่ดูฉลาดแต่แนะนำมั่ว (อันตรายกว่าไม่มี)
--   migration นี้จึงเป็น **"ชั้น 1 — เปิดที่ให้เก็บข้อมูล"** ยังไม่มีตัวจัดลำดับ
--
-- โครงจริงที่ต้องรู้ (เช็คแล้ว):
--   แม่พิมพ์ = machines แถว equipment_kind='die' (266 ตัว) + equipment_die (1:1 ผ่าน machine_id)
--   เครื่องปั๊ม = machines แถว equipment_kind='machine' บนไลน์เดียวกัน (LINE A/B/C/D · HDF1/2)
--   ⇒ die height ลง equipment_die · shut height ลง machines
--
-- 🔙 rollback (ปลอดภัย — ทุกอย่าง additive ไม่มี default ที่เปลี่ยนพฤติกรรมเดิม):
--   drop table if exists press_setup_rules;
--   alter table equipment_die drop column if exists die_height_mm;
--   alter table machines drop column if exists shut_height_min_mm, drop column if exists shut_height_max_mm;

-- ── 1) ความสูงแม่พิมพ์ (ต่อ 1 แม่พิมพ์ = 1 แถว equipment_die) ────────────────────────
alter table equipment_die add column if not exists die_height_mm numeric;
comment on column equipment_die.die_height_mm is
  'ความสูงแม่พิมพ์ (มม.) — ตัวแปรหลักของเวลาเปลี่ยนรุ่นงานปั๊ม: ต่างกันมาก = ปรับ shut height นาน · null = ยังไม่กรอก (จอต้องแสดงว่า "ไม่รู้" ห้ามตีเป็น 0 และห้ามเดา)';

-- ── 2) ช่วง shut height ที่เครื่องปั๊มรับได้ ───────────────────────────────────────────
alter table machines add column if not exists shut_height_min_mm numeric;
alter table machines add column if not exists shut_height_max_mm numeric;
comment on column machines.shut_height_min_mm is
  'shut height ต่ำสุดที่เครื่องรับได้ (มม.) — ใช้เช็คว่าแม่พิมพ์ขึ้นเครื่องนี้ได้ไหม · null = ไม่รู้ (ห้ามสรุปว่า "ขึ้นไม่ได้")';
comment on column machines.shut_height_max_mm is
  'shut height สูงสุดที่เครื่องรับได้ (มม.) · null = ไม่รู้';

-- ── 3) กฎเวลาเปลี่ยนรุ่น — data-driven ต่อ เครื่อง / ไลน์ / ทั้งโรงงาน ──────────────────
-- ⚠️ ตารางนี้ตั้งใจสร้างไว้ "ว่าง" — ตัวเลขจริงต้องมาจากช่างปั๊ม (user กำลังไปถาม 2026-09-25)
--    โค้ดที่อ่านต้องคืนสถานะ "ยังไม่มีกฎ" ให้จอบอกตรงๆ **ห้าม fallback เป็นเลขที่เดาเอง**
create table if not exists press_setup_rules (
  id               uuid primary key default gen_random_uuid(),
  scope_kind       text not null check (scope_kind in ('global','line','machine')),
  scope_value      text,          -- ชื่อไลน์ / machine_no · null เมื่อ scope_kind='global'
  base_min         numeric not null default 0,   -- เปลี่ยนเป็นแม่พิมพ์คนละตัว: เวลาฐาน (ยกลง-ยกขึ้น-จูน)
  same_die_min     numeric not null default 0,   -- แม่พิมพ์ตัวเดิม เปลี่ยนแค่ล็อต/ม้วน
  -- ขั้นบันไดตาม |Δ die height| — [{ "max_mm": 10, "add_min": 0 }, { "max_mm": null, "add_min": 30 }]
  -- เรียงจากน้อยไปมาก · max_mm = null คือขั้นสุดท้าย (ไม่จำกัด) · อ่าน/ตรวจด้วย src/utils/pressSetup.js
  height_steps     jsonb not null default '[]'::jsonb,
  note             text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by_name  text,
  updated_by_uid   text
);
comment on table press_setup_rules is
  'กฎเวลาเปลี่ยนรุ่นของงานปั๊ม (sequence-dependent setup) — resolve เครื่อง → ไลน์ → global ใน src/utils/pressSetup.js · ตารางว่าง = "ยังไม่มีกฎ" จอต้องบอก ห้ามเดาเลขแทน';
comment on column press_setup_rules.height_steps is
  'ขั้นบันได |Δ die height| → นาทีที่บวกเพิ่ม · [{max_mm, add_min}] เรียงน้อย→มาก · max_mm null = ขั้นสุดท้าย';

-- 1 ขอบเขต = 1 กฎที่ใช้งานอยู่ (coalesce เพราะ global มี scope_value = null)
create unique index if not exists press_setup_rules_scope_uniq
  on press_setup_rules (scope_kind, coalesce(scope_value, '')) where is_active;

alter table press_setup_rules enable row level security;
-- ⚠️ DR project: supabaseDR วิ่งด้วย role anon เสมอ (ไม่เคย authenticate) — policy ต้องเปิด public
--    ตามคอนเวนชันทั้ง project · ห้ามเปลี่ยนเป็น TO authenticated (เคยทำทั้งระบบพังมาแล้ว)
do $$ begin
  if not exists (select 1 from pg_policies where tablename='press_setup_rules' and policyname='press_setup_rules_all') then
    create policy press_setup_rules_all on press_setup_rules for all using (true) with check (true);
  end if;
end $$;

-- updated_at (guard — DR บาง instance อาจยังไม่มีฟังก์ชันกลาง)
do $$ begin
  if exists (select 1 from pg_proc where proname='fn_set_updated_at')
     and not exists (select 1 from pg_trigger where tgname='trg_press_setup_rules_updated') then
    create trigger trg_press_setup_rules_updated before update on press_setup_rules
      for each row execute function fn_set_updated_at();
  end if;
end $$;

-- ── 4) audit — ตารางนี้ "แก้ไขได้" ⇒ ต้องผูก audit ตามกฎเหล็ก (docs/modules/traceability-audit-log.md)
--    ตัวเลขในกฎนี้จะถูกเอาไปใช้จัดลำดับงานจริง ⇒ ต้องสืบได้ว่าใครเปลี่ยนเวลา setup เมื่อไหร่จากเท่าไหร่
--    fn_audit() ตัวปกติ (ไม่ใช่ manual_only) — ไม่มี cron/job แตะตารางนี้ · เขียนวันละไม่กี่แถว
--    ⚠️ คู่กับ `press_setup_rules` ในลิสต์ DR_AUDIT_TABLES ของ src/supabaseClient.js (ต้องมีทั้งคู่)
do $$ begin
  if exists (select 1 from pg_proc where proname='fn_audit') then
    drop trigger if exists trg_audit on public.press_setup_rules;
    create trigger trg_audit after insert or update or delete on public.press_setup_rules
      for each row execute function public.fn_audit();
  end if;
end $$;

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
-- select count(*) filter (where die_height_mm is not null) gotheight, count(*) total from equipment_die;
-- select count(*) from press_setup_rules;
