-- ══ 🧪 จองเครื่อง "ทดลองงานใหม่" (new model trial) เข้าแผนสั่งงาน ══════════════════════════
-- DR project — "Product DB" (eyhclzkifitbhbljgoav)   ·   2026-10-01
--
-- ที่มา: หน้างานแจ้งว่ามีงาน new model มาขอ trial เครื่อง แล้ว**ไม่มีที่ลง** —
--   PE แจ้ง Planner ด้วยปากเปล่า/ไลน์ แล้ววางแผนจัดให้เอง ⇒ แผนในระบบไม่รู้ว่าเครื่องถูกยึด
--   ⇒ ไทม์ไลน์บอกว่าไลน์ว่าง ทั้งที่จริงเครื่องติดทดลองอยู่หลายชั่วโมง (แผนโกหก)
--
-- 📏 วัดก่อนทำ (180 วันล่าสุด): หมวด downtime **"ทดลองชิ้นงาน" มีอยู่ในทะเบียนแล้ว**
--   (category=planned · six_big_loss=startup · process_type=common ⇒ ไม่กด %A อยู่แล้ว)
--   แต่ถูกใช้จริงแค่ **3 ใบ / 130 นาที / 3 ไลน์** ⇒ ของที่เกิดจริงแทบไม่ถูกบันทึก
--   **จึงไม่เพิ่มหมวด downtime ใหม่** (ทะเบียนซ้ำ = แท่งซ้ำทุกจอ · กฎเดียวกับ machine_no)
--   ของที่ขาดจริงคือ "การจองล่วงหน้า" ⇒ ทำที่ชั้นแผน
--
-- 🔙 rollback (ตามลำดับนี้เท่านั้น):
--   1) revert โค้ด (จอจะเลิกสร้างใบ trial)
--   2) delete from public.production_plan_lots where source = 'trial';
--   3) alter table public.production_plan_lots
--        drop constraint if exists plan_lots_mat_required,
--        alter column mat_no set not null;
--      alter table public.production_plan_lots drop constraint production_plan_lots_source_check;
--      alter table public.production_plan_lots add constraint production_plan_lots_source_check
--        check (source = any (array['manual','auto']));
--   (คอลัมน์ใหม่ปล่อยไว้ได้ — nullable ทั้งหมด ไม่มีใครอ่านแล้วพัง)
--   ⚠️ ข้าม (2) ไม่ได้ — ใบ trial มี mat_no ว่าง ⇒ ใส่ not null กลับจะล้ม

-- ── ① ข้อมูลของใบทดลอง (nullable ทุกตัว = แถวเดิมไม่กระทบแม้แต่แถวเดียว) ──
alter table public.production_plan_lots
  add column if not exists est_min         numeric,
  add column if not exists trial_part_no   text,
  add column if not exists trial_part_name text,
  add column if not exists trial_customer  text,
  add column if not exists trial_reason    text,
  add column if not exists requested_by    text,
  add column if not exists npi_part_id     uuid;

comment on column public.production_plan_lots.est_min is
  '⏱️ เวลาที่ "ขอ" ไว้ (นาที) — ใช้แทน qty×CT เมื่อพาร์ทยังไม่มี cycle time (งานทดลอง) · ชนะ CT เสมอเมื่อกรอก · null = ไม่ได้ขอเวลา ให้คิดจาก CT ตามปกติ · 🔴 จอต้องบอกว่าเวลานี้ "คนกรอก" ไม่ใช่ "คำนวณ"';
comment on column public.production_plan_lots.trial_part_no is
  'Part No. ลูกค้าของงานทดลอง — พาร์ทที่ SAP ยังไม่ออกเลข MAT ⇒ เก็บบนใบไปก่อน **ห้ามยัดเข้า dr_products** (ทะเบียนสินค้าจริงจะเปื้อนด้วยพาร์ทที่อาจไม่เกิด)';
comment on column public.production_plan_lots.npi_part_id is
  'npi_parts.id ฝั่ง MAIN project — **ไม่ผูก FK ข้าม project** (pattern เดียวกับ die_set_code) · null = ยังไม่ได้ผูกใบ NPI';
comment on column public.production_plan_lots.trial_reason is
  'ทำไมต้องทดลอง — T0/T1 tryout · run@rate · ECI · 4M · อื่นๆ (freeform ไม่บังคับทะเบียน เพราะยังไม่รู้ว่าโรงงานเรียกกี่แบบ)';

alter table public.production_plan_lots drop constraint if exists plan_lots_est_min_positive;
alter table public.production_plan_lots add constraint plan_lots_est_min_positive
  check (est_min is null or est_min > 0);

-- ── ② source: เพิ่ม 'trial' ──
alter table public.production_plan_lots drop constraint if exists production_plan_lots_source_check;
alter table public.production_plan_lots add constraint production_plan_lots_source_check
  check (source = any (array['manual'::text, 'auto'::text, 'trial'::text]));

-- ── ③ 🔴 mat_no ว่างได้ "เฉพาะใบทดลอง" ──────────────────────────────────────────────
--   งานใหม่ยังไม่มีเลข MAT (SAP ยังไม่ออก) และอาจไม่เกิดจริงด้วย
--   ⇒ ปล่อย null แทนที่จะยัดค่าปลอมลง mat_no ซึ่งเป็น **คีย์ join แบบ text** ที่ใช้ทั้งระบบ
--     (ค่าปลอมใน mat_no = แท่งซ้ำ/พาร์ทผีทุกจอ — คลาสเดียวกับบั๊ก machine_no)
--   check กันไม่ให้ใบผลิตปกติหลุด null ตามไปด้วย
alter table public.production_plan_lots alter column mat_no drop not null;
alter table public.production_plan_lots drop constraint if exists plan_lots_mat_required;
alter table public.production_plan_lots add constraint plan_lots_mat_required
  check (source = 'trial' or mat_no is not null);

create index if not exists idx_plan_lots_trial
  on public.production_plan_lots (work_date, line_name) where source = 'trial';

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
-- select column_name, is_nullable from information_schema.columns
--  where table_name='production_plan_lots' and column_name in ('mat_no','est_min','trial_part_no');
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid='public.production_plan_lots'::regclass and contype='c';
-- select count(*) from production_plan_lots where mat_no is null;   -- ต้องได้ 0 ตอนเพิ่งรัน
