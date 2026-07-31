-- กันใบผลิต "ปิดก่อนเปิด" (confirmed_at < opened_at) — 2026-07-30 (DR project)
-- พบข้อมูลจริง 33 ใบ จาก 2 สาเหตุ:
--   (ก) clock skew: เปิดใบใช้ now() ฝั่ง DB แต่ปิดใบใช้เวลาเครื่อง client (ช้ากว่า ~25 วิ)
--       → ใบที่สแกนเปิด-ปิดไวติดลบ · ฝั่งที่ถูกคือ opened_at (server)
--   (ข) ยิงย้อนหลัง (is_backfill) กรอกเวลาเริ่มเป็น "อนาคต" (เช่น ปิดตอน 04:35 แต่กรอกเริ่ม 05:17)
--       → ติดลบได้เป็นชั่วโมง · ฝั่งที่ถูกคือ confirmed_at (เวลาปิดจริง)
-- แก้: trigger BEFORE INSERT/UPDATE เลือกซ่อมตามชนิดใบ + ซ่อมข้อมูลเก่าด้วยกติกาเดียวกัน
-- (ฝั่ง client เพิ่ม validation กันกรอกเวลาอนาคตแล้ว — trigger นี้เป็น safety net)

create or replace function fn_prod_orders_close_time_guard()
returns trigger language plpgsql as $$
begin
  if new.confirmed_at is not null and new.opened_at is not null
     and new.confirmed_at < new.opened_at then
    if coalesce(new.is_backfill, false) then
      new.opened_at := new.confirmed_at;   -- เวลาเปิดที่กรอกย้อนหลังผิด — เวลาปิดคือของจริง
    else
      new.confirmed_at := new.opened_at;   -- clock skew เครื่องปิด — เวลาเปิด (server) คือของจริง
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_prod_orders_close_time_guard on prod_orders;
create trigger trg_prod_orders_close_time_guard
before insert or update on prod_orders
for each row execute function fn_prod_orders_close_time_guard();

-- ซ่อมข้อมูลเก่า (กติกาเดียวกับ trigger)
update prod_orders set opened_at = confirmed_at
  where confirmed_at is not null and opened_at is not null
    and confirmed_at < opened_at and coalesce(is_backfill, false);
update prod_orders set confirmed_at = opened_at
  where confirmed_at is not null and opened_at is not null
    and confirmed_at < opened_at and not coalesce(is_backfill, false);
