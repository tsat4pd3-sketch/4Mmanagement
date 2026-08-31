-- ══ ใบขอเติมชิ้นส่วนจากสโตร์ — ปิดลูป Store ⇄ Production ═════════════════════════════
-- Target project: MAIN (ewhdfqwfwofivojtsizn) — ตารางนี้อยู่ Main มาแต่เดิม
--
-- ที่มา: docs/STORE-PULL-LOOP-DESIGN.md §4.1 (workflow ที่ user เขียนเอง 2026-08-27)
--   ขั้น 4 หัวหน้ากลุ่มยืนยันความต้องการ → สโตร์เห็นทันที
--   ขั้น 8 ผลิตกดยืนยันรับ ครบ/ไม่ครบ → จบลูป
--
-- ⚠️ **ไม่สร้างตารางใบขอเติมตัวที่ 2** (กฎในเอกสาร) — ต่อยอดบน `wip_replenish_requests` เดิม
--    ของเดิมผูกกับ "จุด WIP" (`wip_point_id` → wip_buffer_points) และมีโค้ดใช้งานจริงอยู่แล้ว
--    (LineSetup เรียกเติมจุด · HeijunkaKanban → 🔄 WIP Point จ่ายของ)
--    ของใหม่ผูกกับ "พาร์ทของไลน์" (line_name + mat_no) — `wip_point_id` = null
--    ⇒ 2 ที่มาอยู่ในคิวเดียวกัน สโตร์เห็นจอเดียว **ห้ามแตกคิวเป็น 2 จอ**
--
-- ⚠️⚠️ ชื่อสถานะ: **คงของเดิม (`pending`/`preparing`/`delivered`) ไม่เปลี่ยนเป็น requested/picking**
--    เอกสารเสนอชื่อ requested→picking แต่ของเดิมมีโค้ดวิ่งอยู่และความหมายตรงกันเป๊ะ
--    เปลี่ยนชื่อ = ได้ 2 คำศัพท์ของเรื่องเดียวกัน + ต้องไล่แก้โค้ดที่ทำงานดีอยู่แล้ว
--    map: requested = `pending` · picking = `preparing`
--
--    ที่ **เพิ่มใหม่และห้ามยุบ** (user เคาะ §6.4):
--      suggested = ระบบเสนอแล้วแต่ยังไม่มีคนกดยืนยัน → **สโตร์ต้องมองไม่เห็น** (ไม่ใช่คำสั่ง)
--      hold      = หัวหน้าเห็นแล้วเลือก "พักไว้ก่อน" → ความต้องการยังอยู่ ต้องกลับมาเตือนได้เอง
--                  **ห้ามใช้ cancelled แทน** และ **ห้ามให้หายจากจอ**
--                  (ของที่ถูกพักแล้วมองไม่เห็น = ต้นเหตุ "ลืมเบิกจนไลน์หยุด" ที่ระบบนี้มีไว้กัน)
--      received  = ผลิตยืนยันรับของแล้ว → จบลูป (สโตร์ไปรายการถัดไป)
--      cancelled = ยกเลิกจริง (เปลี่ยนรุ่นแล้วไม่ใช้พาร์ทนี้อีก)
--
-- ⚠️ 4 หมุดเวลาต้องครบตั้งแต่แรก ห้ามเก็บแค่ "เริ่ม-จบ" — ไม่งั้นตอบได้แค่ "ช้า"
--    แต่ตอบไม่ได้ว่า **ช้าตรงไหน** (รอสโตร์หยิบ? รอรถ? รอผลิตมาเซ็นรับ?)
--    ซึ่งเป็นคำถามเดียวที่ทำให้เอาไปแก้ได้จริง
--
-- Rollback: ท้ายไฟล์

/* ── 1) หมุดเวลา + ฟิลด์การตัดสินใจ ─────────────────────────────────────────── */
alter table wip_replenish_requests add column if not exists picked_at       timestamptz;
alter table wip_replenish_requests add column if not exists picked_by_name  text;
alter table wip_replenish_requests add column if not exists received_at     timestamptz;
alter table wip_replenish_requests add column if not exists received_by_name text;
alter table wip_replenish_requests add column if not exists received_qty    numeric;
alter table wip_replenish_requests add column if not exists received_note   text;
alter table wip_replenish_requests add column if not exists decided_by_name text;   -- ใครกดยืนยันเบิก
alter table wip_replenish_requests add column if not exists hold_at         timestamptz;
alter table wip_replenish_requests add column if not exists hold_by_name    text;
alter table wip_replenish_requests add column if not exists hold_reason     text;
alter table wip_replenish_requests add column if not exists on_hand_at_req  numeric;  -- ยอดในไลน์ ณ ตอนเสนอ (ไว้ย้อนดูว่าเสนอเพราะอะไร)
alter table wip_replenish_requests add column if not exists min_at_req      numeric;
alter table wip_replenish_requests add column if not exists part_name       text;

comment on column wip_replenish_requests.picked_at   is 'สโตร์เริ่มจัดของ (ขั้น 5-6)';
comment on column wip_replenish_requests.received_at is 'ผลิตยืนยันรับของ (ขั้น 8) — lead time = received_at − requested_at';
comment on column wip_replenish_requests.received_qty is 'รับจริงกี่ชิ้น — น้อยกว่า request_qty = ได้ไม่ครบ (ต้องเห็นบนจอ ห้ามกลืน)';
comment on column wip_replenish_requests.hold_reason is 'เหตุผลที่พักไว้ก่อน — hold ไม่ใช่ reject ความต้องการยังอยู่';
comment on column wip_replenish_requests.on_hand_at_req is 'ยอดคงเหลือในไลน์ ณ ตอนระบบเสนอ — snapshot ไว้ย้อนดู ไม่ใช่ยอดปัจจุบัน';

/* ── 2) `requested_at` ต้องว่างได้ ─────────────────────────────────────────────
   แถว `suggested` = ระบบเสนอ ยังไม่มีคนตัดสินใจ ⇒ ยังไม่เริ่มนับเวลา
   ถ้า stamp ตั้งแต่ตอนเสนอ lead time ที่วัดได้จะรวมเวลาที่หัวหน้ายังไม่ได้ตัดสินใจ
   = โทษสโตร์ทั้งที่ยังไม่ถึงคิวเขา (user เคาะ §4.1) */
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'wip_replenish_requests' and column_name = 'requested_at' and is_nullable = 'NO'
  ) then
    alter table wip_replenish_requests alter column requested_at drop not null;
  end if;
end $$;
comment on column wip_replenish_requests.requested_at is
  'เวลาที่ "คนกดยืนยันเบิก" (suggested/hold → pending) — ไม่ใช่ตอนระบบเสนอ · null = ยังไม่มีใครตัดสินใจ';

/* ── 3) ใบที่มาจาก "พาร์ทของไลน์" ไม่มีจุด WIP ⇒ wip_point_id ต้องว่างได้ ── */
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'wip_replenish_requests' and column_name = 'wip_point_id' and is_nullable = 'NO'
  ) then
    alter table wip_replenish_requests alter column wip_point_id drop not null;
  end if;
end $$;
-- point_name เดิมอาจ not null (ของเดิมมาจากจุด WIP เสมอ) — ใบพาร์ทไม่มีชื่อจุด
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'wip_replenish_requests' and column_name = 'point_name' and is_nullable = 'NO'
  ) then
    alter table wip_replenish_requests alter column point_name drop not null;
  end if;
end $$;

/* ── 4) สถานะใหม่ — ปลด check เดิมทุกตัวก่อน (ไม่ต้องรู้ชื่อ) แล้วสร้างใหม่ให้ครอบ
   บทเรียน `checklists.frequency`: UI ให้กดได้แต่ DB ปฏิเสธ = คนกดแล้วงานหายทั้งใบ ── */
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'wip_replenish_requests' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table wip_replenish_requests drop constraint %I', c.conname);
  end loop;
end $$;

-- แถวเก่าที่ค่านอกลิสต์ (ถ้ามี) → ปล่อยเป็น pending ไม่ลบทิ้ง
update wip_replenish_requests set status = 'pending'
where status is null
   or status not in ('suggested','hold','pending','preparing','delivered','received','cancelled');

alter table wip_replenish_requests add constraint wip_replenish_requests_status_chk
  check (status in ('suggested','hold','pending','preparing','delivered','received','cancelled'));

-- คิวสโตร์เรียงตามเวลาแจ้ง (ไม่ใช่ตารางเวลา — user กำหนดไว้ใน §1)
create index if not exists wip_replenish_queue_idx
  on wip_replenish_requests (requested_at)
  where status in ('pending','preparing','delivered');
-- ใบที่รอหัวหน้าไลน์ตัดสินใจ (suggested/hold) — สโตร์ต้องมองไม่เห็น กรองที่ index นี้
create index if not exists wip_replenish_pending_decision_idx
  on wip_replenish_requests (line_name, mat_no)
  where status in ('suggested','hold');

/* ── 5) กันเสนอซ้ำ — 1 พาร์ท/ไลน์ มีใบที่ยัง "ไม่จบ" ได้ใบเดียว ──────────────
   ไม่งั้นสแกนทุกครั้งที่ปิดใบผลิต = เสนอซ้ำจนคิวท่วม (บทเรียน purchase_requests 2,336 ใบ)
   ⚠️ ใบเก่าแบบจุด WIP (wip_point_id not null) ไม่เข้า index นี้ — ของเดิมกันซ้ำด้วย
      wip_point_id ในโค้ดอยู่แล้ว และ 1 จุดมีหลายพาร์ทได้ */
create unique index if not exists wip_replenish_open_per_part_uniq
  on wip_replenish_requests (line_name, mat_no)
  where wip_point_id is null and status in ('suggested','hold','pending','preparing','delivered');

/* ── 6) สิทธิ์ (Main) ─────────────────────────────────────────────────────────
   ⚠️ ระบุ role ชัดเจน **ห้ามใช้ enum_range** (กับดักที่ทำให้ role ใหม่ fail-closed เงียบ) */
insert into permission_catalog (resource, action, label, group_name, sort) values
  ('line_levels', 'manage', 'ตั้ง min/max พาร์ทต่อไลน์ (จุดเรียกเติม)', 'ฝ่ายผลิต', 260),
  ('wip_request', 'decide', 'ยืนยัน/พักการเบิกชิ้นส่วนจากสโตร์',        'ฝ่ายผลิต', 261),
  ('wip_request', 'receive', 'ยืนยันรับของจากสโตร์ (ครบ/ไม่ครบ)',        'ฝ่ายผลิต', 262)
on conflict do nothing;

-- ตั้งค่า min/max: หัวหน้าไลน์ + หัวหน้าแผนกฝ่ายผลิต (user เคาะ §6.3 — ไม่ใช่ Planning)
insert into role_permissions (role, permission_key, allowed)
select r, 'line_levels:manage', true
from unnest(array['admin','manager','supervisor','leader']::user_role[]) r
on conflict (role, permission_key) do nothing;

/* ปุ่ม "เบิก / พักไว้ก่อน" = **หัวหน้ากลุ่มเป็นคนตัดสิน** (user เคาะ §6.2)
   หัวหน้าแผนก (supervisor) ตั้งใจ **ไม่ให้** — เขาแค่รับรู้
   ถ้าหน้างานอยากให้ supervisor กดแทนตอน leader ไม่อยู่ → admin ติ๊กเพิ่มที่ /permissions
   (ไม่ใส่มาให้เองเพราะ user ระบุบทบาทไว้ชัด) */
insert into role_permissions (role, permission_key, allowed)
select r, 'wip_request:decide', true
from unnest(array['admin','manager','leader']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- ยืนยันรับของ = คนหน้าไลน์ทำได้กว้างกว่า (ใครอยู่หน้างานตอนของมาถึงก็เซ็นรับได้)
insert into role_permissions (role, permission_key, allowed)
select r, 'wip_request:receive', true
from unnest(array['admin','manager','supervisor','leader']::user_role[]) r
on conflict (role, permission_key) do nothing;

/* ── 7) แจ้งเตือน — ใช้ notifyEvent()/notification_rules ที่มีอยู่ ไม่แตะ edge ──
   ⚠️ inapp_roles เว้นว่างก่อน = Telegram อย่างเดียว (กฎ "วัดความถี่ก่อนเปิดกระดิ่ง")
      ถึง min เป็น "เหตุการณ์ต่อพาร์ท" → เคลียร์ backlog ทีเดียวระเบิดได้
      (บทเรียน shipping_shipped 338 ครั้งใน 23 นาที) · เปิดเองที่ /notification-config เมื่อวัดแล้ว
   ⚠️ ข้อความยุบเป็น 1 ใบ/ครั้ง — ตัวเรียกฝั่ง client รวมพาร์ทในข้อความเดียวต่อไลน์อยู่แล้ว */
insert into notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order)
select 'wip_part_below_min', '📉 พาร์ทในไลน์ถึงจุดเรียกเติม', 'logistic', true,
       coalesce((select channel_ids from notification_rules where category = 'logistic'
                 and channel_ids is not null limit 1), '{}'), 265
where not exists (select 1 from notification_rules where event_key = 'wip_part_below_min');

insert into notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order)
select 'wip_request_placed', '📦 ไลน์ขอเบิกชิ้นส่วนจากสโตร์', 'logistic', true,
       coalesce((select channel_ids from notification_rules where category = 'logistic'
                 and channel_ids is not null limit 1), '{}'), 266
where not exists (select 1 from notification_rules where event_key = 'wip_request_placed');

-- Rollback:
--   drop index if exists wip_replenish_open_per_part_uniq;
--   drop index if exists wip_replenish_queue_idx;
--   drop index if exists wip_replenish_pending_decision_idx;
--   alter table wip_replenish_requests drop constraint if exists wip_replenish_requests_status_chk;
--   delete from notification_rules where event_key in ('wip_part_below_min','wip_request_placed');
--   delete from role_permissions where permission_key in ('line_levels:manage','wip_request:decide','wip_request:receive');
--   delete from permission_catalog where resource in ('line_levels','wip_request');
--   (คอลัมน์ที่เพิ่มปล่อยไว้ได้ — additive ล้วน ไม่กระทบโค้ดเดิม)
