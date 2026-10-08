-- ══════════════════════════════════════════════════════════════════════════════════════
-- DR project (eyhclzkifitbhbljgoav · "Product DB")  —  สถานะกะ "โมฆะ (void)"
-- คำสั่ง user 2026-10-08 ("เพิ่มสถานะ void เลย")
--
-- โจทย์: กะที่ "เปิดผิดแล้วปิดทิ้ง" เคยมีแค่ 2 ทาง — ปล่อยไว้ (ไทม์ไลน์ลากแถบ 12 ชม. +
-- ถูกนับเป็นกะจริงอีก 1 กะ) หรือ `delete` (ลบประวัติ + ลบลูกทั้งหมด สืบย้อนไม่ได้)
-- ⇒ `void` = เก็บแถวไว้แต่ประกาศว่าไม่ใช่กะจริง (หลักเดียวกับ 4M `rejected` / แผนล็อต `cancelled`)
--
-- เคสที่รอใช้: SUB APRON 01/10 กะเช้า (ใบว่างเปล่าที่เปิดทับ 4 นาทีหลังปิดใบจริง · ดู
-- `docs/modules/daily-report.md` §กะซ้ำ) — ใบนั้นมีชีวิตบน 02/10 แต่ `work_date` 01/10
-- ⇒ แก้ด้วย start/end ให้ตรงความจริงไม่ได้ จึงต้องมีสถานะนี้
--
-- 🔴 ของเดิมไม่กระทบ:
--   · unique index `production_sessions_one_open_per_line_shift` คุม `status in ('open','pending_close')`
--     — `void` ไม่อยู่ในนั้น ⇒ ทำโมฆะแล้วเปิดกะใหม่ช่องเดิมได้ (ซึ่งคือสิ่งที่ต้องการ)
--   · RPC `obeya_year_rollup` กรอง `status = 'closed'` ⇒ `void` หลุดออกเองอยู่แล้ว
--   · คิวรีฝั่ง client 16 จุดที่ `.eq('status','closed')` ⇒ ไม่เห็น void เอง
--     (จุดที่ใช้ `.neq('status', …)` 2 จุด แก้เป็นระบุสถานะรายตัวแล้วในคอมมิทเดียวกัน + มีด่าน)
--
-- rollback (ปลอดภัย — คืนสถานะใบที่ทำโมฆะไว้ให้เป็น closed ก่อน ค่อยถอดของ):
--   update production_sessions set status = 'closed' where status = 'void';
--   drop trigger if exists trg_session_void_guard on production_sessions;
--   drop function if exists public.fn_session_void_guard();
--   alter table production_sessions drop constraint if exists production_sessions_void_reason_check;
--   alter table production_sessions drop column if exists void_reason,
--                                   drop column if exists voided_at,
--                                   drop column if exists voided_by_name;
--   alter table production_sessions drop constraint production_sessions_status_check;
--   alter table production_sessions add constraint production_sessions_status_check
--     check (status = any (array['open','pending_close','closed']));
-- ══════════════════════════════════════════════════════════════════════════════════════

-- 1) เปิดสถานะใหม่ใน CHECK เดิม (ของเดิม: open · pending_close · closed)
alter table public.production_sessions drop constraint if exists production_sessions_status_check;
alter table public.production_sessions add constraint production_sessions_status_check
  check (status = any (array['open'::text, 'pending_close'::text, 'closed'::text, 'void'::text]));

-- 2) ร่องรอยว่าใครทำโมฆะ เพราะอะไร (ไม่มีเหตุผล = ทำโมฆะไม่ได้)
alter table public.production_sessions
  add column if not exists void_reason    text,
  add column if not exists voided_at      timestamptz,
  add column if not exists voided_by_name text;

alter table public.production_sessions drop constraint if exists production_sessions_void_reason_check;
alter table public.production_sessions add constraint production_sessions_void_reason_check
  check (status <> 'void' or (void_reason is not null and length(btrim(void_reason)) > 0));

comment on column public.production_sessions.void_reason is
  'เหตุผลที่ทำใบนี้เป็นโมฆะ — บังคับกรอก (CHECK) · สถานะ void = "ไม่ใช่กะจริง" ห้ามจอไหนนับเป็นกะ';

-- 3) ด่านจริงฝั่ง DB — ทำโมฆะได้เฉพาะ "กะเปล่า"
--    (กะที่มีข้อมูลแล้วซ้ำซ้อนกัน = ต้องให้คนตัดสินว่าข้อมูลควรอยู่ใบไหน ห้ามซ่อนด้วย void)
--    ตรรกะต้องตรงกับ `voidBlockReason()` ใน src/utils/sessionStatus.js
create or replace function public.fn_session_void_guard()
returns trigger language plpgsql as $$
declare n_ord int; n_dt int; n_def int;
begin
  if new.status = 'void' and coalesce(old.status, '') <> 'void' then
    select count(*) into n_ord from public.prod_orders   where session_id = new.id;
    select count(*) into n_dt  from public.downtime_logs where session_id = new.id;
    select count(*) into n_def from public.defect_logs   where session_id = new.id;
    if n_ord > 0 or n_dt > 0 or n_def > 0
       or coalesce(new.actual_qty, 0) > 0 or coalesce(new.qty_ok, 0) > 0 then
      raise exception
        'ทำโมฆะไม่ได้: กะนี้มีข้อมูลแล้ว (ใบผลิต %, downtime %, ของเสีย %, ยอดผลิต %) — ต้องให้คนตัดสินว่าข้อมูลควรอยู่ใบไหน',
        n_ord, n_dt, n_def, coalesce(new.actual_qty, 0);
    end if;
    new.voided_at := coalesce(new.voided_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_session_void_guard on public.production_sessions;
create trigger trg_session_void_guard
  before update on public.production_sessions
  for each row execute function public.fn_session_void_guard();

comment on function public.fn_session_void_guard() is
  'กันทำโมฆะกะที่มีข้อมูลแล้ว (ใบผลิต/downtime/ของเสีย/ยอดผลิต) — fail-closed · คู่กับ voidBlockReason() ฝั่งจอ';
