-- ══ QA FME (First–Middle–End) — ฝ่ายผลิตเรียก QA มาตรวจอัตโนมัติ ═══════════════════════
-- Target project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา: docs/INSPECTION_ALARM_SYSTEMS.md "ระบบ 2 — QA First–Middle–End" (ออกแบบไว้ตั้งแต่ต้น
-- แต่ยังไม่เคยสร้าง — ระบบ 1 = pm-daily-scan, ระบบ 3 = pm-plan-reminder สร้างไปแล้ว)
--
-- ⚠️ หน่วยของงานตรวจ = **ไลน์ × วันงาน × กะ × รุ่น** ไม่ใช่ต่อออเดอร์ (คำสั่ง user 2026-08-19:
--    "เฉพาะเปลี่ยนรุ่น หรือ เปลี่ยนกะ ไม่มองเป็นออเดอร์ เพราะบางงาน ลอทนึงมี 50 เลขออเดอร์")
--    ⇒ 50 ใบงานของรุ่นเดียวกันในกะเดียวกัน = เรียก QA ครั้งเดียว
--
-- trigger ที่ทำให้เกิดงานตรวจ (ทั้งหมด derive จากข้อมูลผลิตฝั่ง DR ไม่ต้องให้ใครกดแจ้ง):
--   • first  — รุ่นนั้นโผล่ในกะครั้งแรก  → ครอบทั้ง "เปลี่ยนกะ" (กะใหม่ = นับใหม่) และ "เปลี่ยนรุ่น"
--   • end    — รุ่นนั้นจบ (เปลี่ยนไปรุ่นอื่น / ปิดกะ)
--   • middle — รุ่นวิ่งยาวเกินเกณฑ์ (ค่าเริ่มต้น = ปิด เพราะ user ระบุ "เฉพาะ" 2 เหตุข้างบน)
--
-- ⚠️ งานคู่ RH/LH นับเป็น "รุ่นเดียวกัน" (จับกลุ่มด้วย dr_products.pair_mat_no) — ไม่งั้นสลับ
--    LH/RH จะถูกอ่านว่าเปลี่ยนรุ่นทุกครั้ง แล้วเรียก QA รัวๆ (กฎงานคู่ใน CLAUDE.md)

-- ── 1) ตั้งค่าระบบ (แถวเดียว) ────────────────────────────────────────────────
create table if not exists qa_fme_config (
  id              int primary key default 1 check (id = 1),
  -- ⚠️ ปิดไว้ตอน seed โดยตั้งใจ — ระบบนี้ยิงเข้าห้อง Telegram จริงของโรงงาน
  --    ต้องให้เจ้าของระบบกดเปิดเองที่ /qa (แท็บใบตรวจ → ⚙️ ตั้งค่าการเรียกตรวจ)
  is_enabled      boolean not null default false,
  first_due_min   int not null default 15,   -- เรียกแล้ว QA ต้องส่งผลภายในกี่นาที (ตามเอกสาร = 15)
  end_due_min     int not null default 15,
  mid_after_min   int not null default 0,    -- 0 = ไม่เรียกช่วงกลาง · >0 = รุ่นวิ่งเกินกี่นาทีถึงเรียก
  escalate_min    int not null default 30,   -- เกินเวลาแล้วเตือนซ้ำทุกกี่นาที (ตามเอกสาร = 30)
  max_alerts      int not null default 8,    -- เพดานเตือนซ้ำ กัน spam ไม่รู้จบ (ค้างต่อในหน้า QA แทน)
  -- กันน้ำท่วมตอนเพิ่งเปิดสวิตช์: ไม่สร้างงานตรวจย้อนหลังให้รุ่นที่เริ่มไปนานแล้ว
  skip_older_min  int not null default 120,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
insert into qa_fme_config (id) values (1) on conflict (id) do nothing;

-- ── 2) งานตรวจที่ต้องเกิด (obligation) ───────────────────────────────────────
create table if not exists qa_fme_obligations (
  id             uuid primary key default gen_random_uuid(),
  work_date      date not null,
  shift          text not null check (shift in ('day','night')),
  line_name      text not null,
  mat_no         text not null,              -- ตัวแทนกลุ่มรุ่น (คู่ RH/LH ใช้ตัวที่เรียงน้อยกว่า)
  mat_group      text[] not null default '{}',-- ทุก mat ในกลุ่ม (ไว้แสดง/สืบกลับ)
  product_name   text,
  stage          text not null check (stage in ('first','middle','end')),
  trigger_reason text not null check (trigger_reason in
                   ('shift_start','model_change','mid_run','model_change_out','shift_end')),
  -- ผูกกับพาร์ทในระบบตรวจได้ = ดี · ผูกไม่ได้ = ยังต้องเรียก QA อยู่ดี (part_id null + โชว์เตือนในหน้า QA)
  -- ⚠️ ห้ามข้ามการสร้างงานตรวจเพราะจับคู่พาร์ทไม่ได้ — จะกลายเป็นตรวจตกโดยไม่มีใครรู้
  part_id        uuid references qa_parts(id) on delete set null,
  session_id     text,                       -- id ฝั่ง DR (คนละ project → เก็บเป็น text ไม่ FK)
  triggered_at   timestamptz not null,
  due_at         timestamptz not null,
  status         text not null default 'pending'
                 check (status in ('pending','acked','done_ok','done_ng','cancelled')),
  sheet_id       uuid references qa_inspection_sheets(id) on delete set null,
  acked_at       timestamptz,
  done_at        timestamptz,
  alert_count    int not null default 0,
  last_alerted_at timestamptz,
  cancel_reason  text,
  created_at     timestamptz not null default now(),
  -- 1 ไลน์/วัน/กะ/รุ่น/สเตจ = งานตรวจชิ้นเดียว (นี่คือหัวใจของ "ไม่มองเป็นออเดอร์")
  unique (line_name, work_date, shift, mat_no, stage)
);
create index if not exists idx_qa_fme_open on qa_fme_obligations (status, due_at)
  where status in ('pending','acked');
create index if not exists idx_qa_fme_lookup on qa_fme_obligations (work_date desc, line_name);

-- ── 3) เชื่อมพาร์ทฝั่ง QA กับเลข MAT SAP ฝั่งผลิต ────────────────────────────
-- qa_parts.part_no ถูกเติมจาก Product Master ด้วย `p_no || mat_no || code` (QAInspectionSetup)
-- ⇒ บางแถวเป็นเลขลูกค้า บางแถวเป็นเลข SAP จับคู่ตรงๆ ไม่ได้เสมอ · คอลัมน์นี้ทำให้ผูกเป็น "ข้อมูล"
-- ไม่ใช่การเดา (หลักเดียวกับ dr_products.p_no ที่ใช้ map EDI) · ว่าง = ตัวสแกนถอยไปเดาแบบ normalize
alter table qa_parts add column if not exists mat_no text;
create index if not exists idx_qa_parts_mat on qa_parts (mat_no) where mat_no is not null;

-- ── 4) RLS — pattern เดียวกับ qa_inspection_sheets ───────────────────────────
--     อ่าน = ทุก user ที่ login (ผลิตต้องเห็นว่าเรียกไปแล้ว) · แก้ = qa:record · ลบ = qa:manage
--     insert ปกติมาจาก edge function (service role → ข้าม RLS อยู่แล้ว)
alter table qa_fme_obligations enable row level security;
alter table qa_fme_config      enable row level security;

drop policy if exists qa_fme_select on qa_fme_obligations;
create policy qa_fme_select on qa_fme_obligations for select to authenticated using (true);
drop policy if exists qa_fme_insert on qa_fme_obligations;
create policy qa_fme_insert on qa_fme_obligations for insert to authenticated
  with check ((select has_perm('qa:record')));
drop policy if exists qa_fme_update on qa_fme_obligations;
create policy qa_fme_update on qa_fme_obligations for update to authenticated
  using ((select has_perm('qa:record'))) with check ((select has_perm('qa:record')));
drop policy if exists qa_fme_delete on qa_fme_obligations;
create policy qa_fme_delete on qa_fme_obligations for delete to authenticated
  using ((select has_perm('qa:manage')));

drop policy if exists qa_fme_cfg_select on qa_fme_config;
create policy qa_fme_cfg_select on qa_fme_config for select to authenticated using (true);
drop policy if exists qa_fme_cfg_update on qa_fme_config;
create policy qa_fme_cfg_update on qa_fme_config for update to authenticated
  using ((select has_perm('qa:manage'))) with check ((select has_perm('qa:manage')));

-- ── 5) Notification rules — ปรับห้อง/ปิด/แก้ข้อความได้ที่ /notification-config ──
insert into notification_rules (event_key, label, category, is_enabled, sort_order)
select 'qa_fme_call', 'QA — เรียกตรวจชิ้นงาน (เปลี่ยนรุ่น/เปลี่ยนกะ)', 'quality', true, 46
where not exists (select 1 from notification_rules where event_key = 'qa_fme_call');

insert into notification_rules (event_key, label, category, is_enabled, sort_order)
select 'qa_fme_overdue', 'QA — เกินเวลาตรวจ (เตือนซ้ำ)', 'quality', true, 47
where not exists (select 1 from notification_rules where event_key = 'qa_fme_overdue');

-- หมายเหตุ: ไม่เพิ่ม permission key ใหม่ (ใช้ qa:record / qa:manage เดิม) — เลี่ยงกับดัก seed
-- ด้วย enum_range ที่ทำให้ role ที่เพิ่มทีหลังไม่มีแถว = ใช้ไม่ได้เงียบๆ (ดู CLAUDE.md)
