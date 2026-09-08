-- ══ ด่านขั้น 5 "สแกนยืนยันของที่เตรียม" + ตัดสต็อกตอนยืนยัน — ลูปสโตร์ตาม Smart Withdraw Kanban (2026-09-07) ═══
-- Target project: MAIN (ewhdfqwfwofivojtsizn) — `wip_replenish_requests` อยู่ Main
--
-- ที่มา: pptx "Smart Withdraw Kanban" (user 2026-09-07 · ต้องปิดลูปภายในสัปดาห์นี้) ฝั่ง Area Store:
--   Store prepare item as ordered → Scan confirm order → matching Order Request = Order scan
--   → ไม่ตรง: Alert in Smart Fac / Mobile → Check part & Quantity → Fix error
--   → ตรง: Scan for SAP update (Deduct stock) → TP Man transfer parts to PD
--   + user: "เรื่องการเตรียม ก็ต้อง scan verify ว่างานที่เตรียมถูกต้องด้วย"
--
-- ⚠️ เปลี่ยนกฎเหล็ก 5 เดิม ("ลูปเป็นการสื่อสาร ไม่ตัดสต็อก") — ตอนนี้ **ยืนยันเตรียม = ตัดสต็อกให้เลย**
--    (STORE −qty · ไลน์ +qty ใน line_stock_transactions ฝั่ง DR) ตามขั้น "Scan for SAP update" ในแผนผัง
--    · id ของแถว ledger เก็บที่ `stock_txn_ids` (uuid[] ข้าม project ไม่มี FK) กันตัดซ้ำ + ย้อนได้
--    · สโตร์**ไม่ต้อง**ไปบันทึก "จ่ายพาร์ทเข้าไลน์" ที่ Line Stock ซ้ำสำหรับใบเหล่านี้อีก (ทำซ้ำ = สต็อกโผล่ 2 เท่า)
--
-- trigger บังคับ (ตารางความจริงเดียวกับ validatePickPayload ใน src/utils/replenishGate.js):
--   ใบจากไลน์ status → preparing ต้องมี picked_qty > 0 และ
--     picked_gate = scanned  → picked_scan_raw ไม่ว่าง
--     picked_gate = override → picked_override_reason ไม่ว่าง
--   ใบจุด WIP (wip_point_id not null) ไม่เข้าด่านนี้
--
-- ⚠️ ลำดับ deploy: merge โค้ดก่อน แล้ว apply — โค้ดใหม่ทนคอลัมน์ยังไม่มี (42703 → บันทึกแบบเดิม + toast)
-- Rollback: ท้ายไฟล์

alter table wip_replenish_requests add column if not exists picked_qty               numeric;
alter table wip_replenish_requests add column if not exists picked_gate              text;
alter table wip_replenish_requests add column if not exists picked_scan_raw          text;
alter table wip_replenish_requests add column if not exists picked_override_reason   text;
alter table wip_replenish_requests add column if not exists picked_override_by_name  text;
alter table wip_replenish_requests add column if not exists stock_txn_ids            uuid[];   -- line_stock_transactions.id (DR) ที่ตัดให้ตอนยืนยันเตรียม
alter table wip_replenish_requests add column if not exists stock_txn_note           text;     -- เหตุที่ตัดไม่ครบ (เช่น STORE ไม่มีแถวสต็อก)

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wip_replenish_picked_gate_chk') then
    alter table wip_replenish_requests add constraint wip_replenish_picked_gate_chk
      check (picked_gate is null or picked_gate in ('scanned','override'));
  end if;
end $$;
comment on column wip_replenish_requests.picked_qty is 'จำนวนที่สโตร์หยิบได้จริง (ขั้น 5) — น้อยกว่า request_qty = ส่งไม่ครบ ไลน์เห็นตอนรับ';
comment on column wip_replenish_requests.picked_gate is 'ยืนยันของที่เตรียมทางไหน: scanned (ยิงบาร์โค้ดพาร์ทตรงใบ) · override (หัวหน้าปลดบล็อก+เหตุผล)';
comment on column wip_replenish_requests.stock_txn_ids is 'แถว line_stock_transactions (DR) ที่ตัดสต็อกให้ตอนยืนยันเตรียม — มีแล้วห้ามตัดซ้ำ';

create or replace function fn_wip_replenish_pick_gate() returns trigger
language plpgsql as $$
begin
  if new.status = 'preparing' and coalesce(old.status, '') <> 'preparing' and new.wip_point_id is null then
    if not (coalesce(new.picked_qty, 0) > 0) then
      raise exception 'ใส่จำนวนที่หยิบก่อนเริ่มเตรียม (picked_qty ว่าง)' using errcode = 'check_violation';
    end if;
    if new.picked_gate = 'scanned' then
      if coalesce(btrim(new.picked_scan_raw), '') = '' then
        raise exception 'สแกนพาร์ทก่อนเริ่มเตรียม (picked_gate=scanned แต่ไม่มีผลสแกน)' using errcode = 'check_violation';
      end if;
    elsif new.picked_gate = 'override' then
      if coalesce(btrim(new.picked_override_reason), '') = '' then
        raise exception 'ปลดบล็อกต้องระบุเหตุผล (picked_override_reason ว่าง)' using errcode = 'check_violation';
      end if;
    else
      raise exception 'ต้องสแกนพาร์ท หรือให้หัวหน้าปลดบล็อก ก่อนกด "เริ่มเตรียม" (picked_gate ว่าง)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_wip_replenish_pick_gate on wip_replenish_requests;
create trigger trg_wip_replenish_pick_gate before update on wip_replenish_requests
  for each row execute function fn_wip_replenish_pick_gate();

-- "Alert in Smart Fac / Mobile Phone" เมื่อสแกนไม่ตรงใบ — ผ่าน notifyEvent()/notification_rules ที่มีอยู่ (Telegram ห้อง logistic)
insert into notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order)
select 'wip_pick_blocked', '🔴 สโตร์หยิบผิดพาร์ท/จำนวน (ด่านสแกนขั้น 5)', 'logistic', true,
       coalesce((select channel_ids from notification_rules where category = 'logistic'
                 and channel_ids is not null limit 1), '{}'), 267
where not exists (select 1 from notification_rules where event_key = 'wip_pick_blocked');

-- ── ตรวจหลังรัน ──
-- select column_name from information_schema.columns where table_name='wip_replenish_requests' and column_name like 'picked_%';
-- select tgname from pg_trigger where tgname = 'trg_wip_replenish_pick_gate';

-- Rollback (ถอยโค้ดก่อน):
--   drop trigger if exists trg_wip_replenish_pick_gate on wip_replenish_requests;
--   drop function if exists fn_wip_replenish_pick_gate();
--   delete from notification_rules where event_key = 'wip_pick_blocked';
--   (คอลัมน์ picked_*/stock_txn_* ปล่อยไว้ได้ — additive/nullable)
