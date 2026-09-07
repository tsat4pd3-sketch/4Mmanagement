-- ══ ด่าน "จุดส่ง" ตอนสโตร์กดจัดส่งแล้ว — ลูป Store ⇄ Production เฟส 4 (ขั้น 7) ═══════════════
-- Target project: MAIN (ewhdfqwfwofivojtsizn) — `wip_replenish_requests` อยู่ Main มาแต่เดิม
-- คู่กับ 20260903_line_delivery_points.sql (DR — ตารางจุดส่ง)
--
-- ที่มา: docs/STORE-PULL-LOOP-DESIGN.md §4.5 + §4.6 (user 2026-08-27)
--   ขั้น 7 สโตร์ถึงไลน์ → สแกน QR จุดส่ง = หมุด delivered_at + ตรวจว่า "ส่งถูกจุดตามใบไหม"
--
-- ⚠️⚠️ กฎ §4.6 ข้อ 6: "เช็คฝั่งจออย่างเดียวไม่ใช่ poka-yoke — ต้องบังคับที่จุดเขียนแถวด้วย"
--    → trigger ด้านล่างบังคับว่าใบ "จากไลน์" (wip_point_id null) จะเป็น delivered ได้ **3 ทางเท่านั้น**
--      scanned  = มี delivered_point_id (สแกนจุดแล้ว)
--      no_point = ไลน์นั้นยังไม่ตั้งจุดส่ง (ตรวจไม่ได้ — "ไม่รู้ = ห้ามบล็อก" §4.6 ข้อ 3)
--      override = หัวหน้าปลดบล็อก + ต้องมีเหตุผล (§4.6 ข้อ 5 — ทางออกที่ถูกบันทึก)
--    ตารางความจริงนี้ต้องตรงกับ `validateDeliverPayload` ใน src/utils/replenishGate.js **เป๊ะ** (มีเทสล็อกฝั่ง JS)
--    ⚠️ DB ตรวจได้แค่ "ครบ 3 ทาง" — ตรวจว่าจุดตรงไลน์ไหม ทำที่ client (จุดอยู่ DR คนละ project)
--
-- ⚠️ ใบเก่าแบบ "จุด WIP" (wip_point_id not null) ไม่เข้าด่านนี้ — เป็นการเติมจุดในไลน์ ไม่ใช่ส่งจากสโตร์ถึงไลน์
--
-- ⚠️ ลำดับ deploy: **merge โค้ดก่อน แล้วค่อย apply ไฟล์นี้** — โค้ดใหม่ทนคอลัมน์ยังไม่มี (42703 → บันทึก
--    แบบเดิม + เตือนบนจอ) แต่โค้ดเก่าไม่ส่ง delivered_gate → ถ้า apply ก่อน deploy สโตร์จะกดส่งใบจากไลน์ไม่ได้
--
-- Rollback: ท้ายไฟล์

/* ── 1) คอลัมน์ผลด่านบนใบ (additive · nullable ทั้งหมด) ─────────────────────────── */
alter table wip_replenish_requests add column if not exists delivered_gate              text;
alter table wip_replenish_requests add column if not exists delivered_point_id          uuid;   -- line_delivery_points.id (DR — ไม่มี FK ข้าม project)
alter table wip_replenish_requests add column if not exists delivered_point_name        text;   -- snapshot ชื่อจุด (จุดถูกแก้/ลบทีหลัง ใบยังอ่านรู้เรื่อง)
alter table wip_replenish_requests add column if not exists delivered_override_reason   text;
alter table wip_replenish_requests add column if not exists delivered_override_by_name  text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wip_replenish_delivered_gate_chk') then
    alter table wip_replenish_requests add constraint wip_replenish_delivered_gate_chk
      check (delivered_gate is null or delivered_gate in ('scanned','no_point','override'));
  end if;
end $$;

comment on column wip_replenish_requests.delivered_gate is
  'ใบจากไลน์ถูกมาร์ก delivered ทางไหน: scanned (สแกนจุดส่ง) · no_point (ไลน์ยังไม่ตั้งจุด — ตรวจไม่ได้) · override (หัวหน้าปลดบล็อก+เหตุผล) · null = ใบเก่าก่อนเฟส 4 / ใบจุด WIP';
comment on column wip_replenish_requests.delivered_point_name is
  'ชื่อจุดส่งที่สแกน (snapshot) — ใช้ตอบ "ของไปวางที่ไหน" ในแผงฝั่งไลน์';

/* ── 2) trigger บังคับ "ครบ 3 ทาง" ตอน status → delivered ────────────────────────── */
create or replace function fn_wip_replenish_deliver_gate() returns trigger
language plpgsql as $$
begin
  -- เฉพาะจังหวะเปลี่ยนเป็น delivered ของใบ "จากไลน์" — ใบจุด WIP และ status อื่นผ่านเฉย
  if new.status = 'delivered' and coalesce(old.status, '') <> 'delivered' and new.wip_point_id is null then
    if new.delivered_gate = 'no_point' then
      null;
    elsif new.delivered_gate = 'scanned' then
      if new.delivered_point_id is null then
        raise exception 'สแกนจุดส่งก่อนกดส่ง (delivered_gate=scanned แต่ไม่มี delivered_point_id)'
          using errcode = 'check_violation';
      end if;
    elsif new.delivered_gate = 'override' then
      if coalesce(btrim(new.delivered_override_reason), '') = '' then
        raise exception 'ปลดบล็อกต้องระบุเหตุผล (delivered_override_reason ว่าง)'
          using errcode = 'check_violation';
      end if;
    else
      raise exception 'ต้องสแกนจุดส่ง หรือให้หัวหน้าปลดบล็อก ก่อนกด "จัดส่งแล้ว" (delivered_gate ว่าง)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_wip_replenish_deliver_gate on wip_replenish_requests;
create trigger trg_wip_replenish_deliver_gate before update on wip_replenish_requests
  for each row execute function fn_wip_replenish_deliver_gate();

/* ── 3) บันทึกเฉพาะ "ครั้งที่ถูกบล็อก" และ "ครั้งที่ override" (§4.6) ────────────────
   ไม่บันทึกการสแกนที่ผ่าน — 4 หมุดเวลาบนใบเก็บอยู่แล้ว · เก็บทุกครั้ง = แถวบวมโดยไม่ได้สัญญาณเพิ่ม
   ⚠️ ชื่อห้ามขึ้นต้น pokayoke_ (คนละโมดูลกับ /pokayoke ที่ทดสอบอุปกรณ์บนไลน์ — user ย้ำ 27/08) */
create table if not exists line_replenish_scan_blocks (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid references wip_replenish_requests(id) on delete cascade,
  line_name     text,                         -- ปลายทางบนใบ (snapshot ไว้สรุปสถิติโดยไม่ต้อง join)
  mat_no        text,
  step          text not null default 'deliver',  -- deliver (ขั้น 7) · เฟสหน้า: pick (ขั้น 5)
  check_kind    text not null default 'point',    -- point · เฟสหน้า: part / qty
  outcome       text not null,                    -- blocked · override
  status_code   text,                         -- ผลจาก checkDeliveryPoint: unknown / mismatch
  scanned_raw   text,                         -- ข้อความดิบที่ยิงมา
  expected      text,                         -- จุดที่ใบต้องการ (label)
  actual        text,                         -- จุดที่ยิงได้ (label) / ดิบ
  reason        text,                         -- override เท่านั้น
  actor_name    text,
  created_at    timestamptz not null default now()
);
create index if not exists line_replenish_scan_blocks_req_idx  on line_replenish_scan_blocks (request_id);
create index if not exists line_replenish_scan_blocks_time_idx on line_replenish_scan_blocks (created_at desc);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'line_replenish_scan_blocks_outcome_chk') then
    alter table line_replenish_scan_blocks add constraint line_replenish_scan_blocks_outcome_chk
      check (outcome in ('blocked','override'));
  end if;
end $$;
comment on table line_replenish_scan_blocks is
  'ด่านสแกนของลูปสโตร์ — เก็บเฉพาะครั้งที่บล็อก/override (ไม่เก็บครั้งที่ผ่าน) → ตอบ "ด่านนี้กันอะไรไว้ได้บ้าง" + worklist แก้ master';

-- log เขียนแล้วห้ามแก้ — ให้ authenticated อ่าน+เพิ่มเท่านั้น (ไม่มี update/delete policy)
alter table line_replenish_scan_blocks enable row level security;
drop policy if exists line_replenish_scan_blocks_select on line_replenish_scan_blocks;
create policy line_replenish_scan_blocks_select on line_replenish_scan_blocks for select to authenticated using (true);
drop policy if exists line_replenish_scan_blocks_insert on line_replenish_scan_blocks;
create policy line_replenish_scan_blocks_insert on line_replenish_scan_blocks for insert to authenticated with check (true);

/* ── 4) สิทธิ์ (Main) — ระบุ role ชัดเจน ห้ามใช้ enum_range ──────────────────────
   group_name ต้อง mirror NAV_GROUP_ORDER ใน App.jsx เป๊ะ (20260903_permission_catalog_logistic_sides.sql) */
insert into permission_catalog (resource, action, label, group_name, sort) values
  ('delivery_point', 'manage',   'ตั้งจุดส่งงานของไลน์ (ป้าย QR ที่สโตร์สแกนตอนส่งของ)', 'ฝ่ายผลิต', 263),
  ('wip_request',    'override', 'ปลดบล็อกสแกนส่งของผิดจุด (ต้องระบุเหตุผล · ถูกบันทึก)', 'Logistic - ขาเข้า (Inbound)', 509)
on conflict do nothing;

-- ตั้งจุดส่ง = คนที่รู้ว่าของวางตรงไหนหน้าไลน์: หัวหน้าไลน์ + หัวหน้าแผนกผลิต (กลุ่มเดียวกับ line_levels:manage)
--   + planner_store เพราะสโตร์เป็นคนเดินไปส่งจริง เห็นหน้างานว่าป้ายควรอยู่ตรงไหน
insert into role_permissions (role, permission_key, allowed)
select r, 'delivery_point:manage', true
from unnest(array['admin','manager','supervisor','leader','planner_store']::user_role[]) r
on conflict (role, permission_key) do nothing;

/* override = "ระดับหัวหน้า ไม่ใช่คนที่ถูกบล็อก" (§4.6 ข้อ 5) → เปิดวงแคบก่อน (admin/manager/supervisor)
   ⚠️ ถ้าหัวหน้าสโตร์ถือ role planner_store → ตี 2 จะไม่มีใครปลดได้ = คนกลับไป LINE chat (สิ่งที่กฎข้อ 5 เตือน)
      admin ติ๊กเพิ่มให้ planner_store ที่ /permissions ได้เลย ไม่ต้องแก้โค้ด — ทุก override ถูกบันทึกชื่อ+เหตุผลอยู่แล้ว */
insert into role_permissions (role, permission_key, allowed)
select r, 'wip_request:override', true
from unnest(array['admin','manager','supervisor']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- ── ตรวจหลังรัน ──
-- select column_name from information_schema.columns where table_name='wip_replenish_requests' and column_name like 'delivered_%';
-- select tgname from pg_trigger where tgname = 'trg_wip_replenish_deliver_gate';
-- select role, permission_key from role_permissions where permission_key in ('delivery_point:manage','wip_request:override') order by 2,1;

-- Rollback (ถอยโค้ดก่อน แล้วค่อยรัน):
--   drop trigger if exists trg_wip_replenish_deliver_gate on wip_replenish_requests;
--   drop function if exists fn_wip_replenish_deliver_gate();
--   drop table if exists line_replenish_scan_blocks;
--   delete from role_permissions where permission_key in ('delivery_point:manage','wip_request:override');
--   delete from permission_catalog where (resource, action) in (('delivery_point','manage'),('wip_request','override'));
--   (คอลัมน์ delivered_* ปล่อยไว้ได้ — additive/nullable ไม่กระทบโค้ดเดิม)
