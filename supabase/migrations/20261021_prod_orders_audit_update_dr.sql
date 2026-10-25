-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- สอบกลับการ "แก้ใบผลิตหลังปิดกะ" — audit_log ของ prod_orders เดิมบันทึกแค่ DELETE
-- project: DR (ชื่อในจอ Supabase "Product DB" · eyhclzkifitbhbljgoav)
-- วันที่: 2026-10-21
--
-- ปัญหา (เจอจาก audit รอบ "แก้ไขเวลาจบรุ่นไม่ขึ้น" · เคส Apron Assy 20/10):
--   · `prod_orders` มีแค่ `trg_audit_delete` ⇒ การ **UPDATE** มองไม่เห็นเลย
--     ⇒ ตอบไม่ได้ว่าใครแก้เวลาเริ่ม/จบ · ใครเปลี่ยนยอด · ใครยกเลิก/ยกยอดใบที่ปิดแล้ว
--   · ตารางนี้ยังไม่มี `updated_by_name`/`updated_by_uid` ⇒ `fn_audit()` หา actor ไม่ได้
--     (actor = null ทุกแถว แม้แถว DELETE ที่มีอยู่เดิม — DR วิ่งด้วย role anon ไม่มี JWT)
--
-- ที่ทำ:
--   ① เพิ่ม `updated_by_name` / `updated_by_uid` (nullable · ไม่มี default = ย้อนได้ ของเดิมไม่พัง)
--      แล้วใส่ 'prod_orders' ใน `DR_AUDIT_TABLES` (src/supabaseClient.js) ให้ client stamp อัตโนมัติ
--   ② trigger AFTER UPDATE **แบบแคบ** — ยิงเฉพาะ "แก้ใบที่ปิดแล้ว" และเฉพาะคอลัมน์ที่มีผลกับ
--      ยอด/เวลา/สถานะ
--      🔴 เหตุที่ต้องแคบ: ใบผลิตถูก UPDATE ทุกครั้งที่สแกน/คอนเฟิร์ม (หลายร้อยครั้ง/วัน)
--         ถ้า log ทุก UPDATE = audit_log โตเป็นหลักแสนแถว/เดือน (old_data+new_data เป็น jsonb เต็มแถว)
--         ⇒ เงื่อนไข `OLD.status is distinct from 'open'` ตัด flow ปกติ (open → confirmed) ออกหมด
--            เหลือแต่ "ย้อนไปแก้ของที่ปิดแล้ว" ซึ่งคือสิ่งที่ต้องสอบกลับจริงๆ
--   · ไม่แตะ `fn_audit()` (มี branch UPDATE พร้อมอยู่แล้ว · ตัดคอลัมน์ updated_by_* ออกจาก
--     changed_fields ให้เองแล้ว ⇒ การ stamp ชื่อคนเฉยๆ ไม่สร้างแถวขยะ)
--
-- ⚠️ ข้อจำกัดที่ยังอยู่ (known gap เดิมของ DR): uid/ชื่อ มาจาก client ที่เป็น anon
--    = "คีย์สำหรับนับ/join" ไม่ใช่ลายเซ็นที่ปลอมไม่ได้ (ดู src/utils/actorStamp.js)
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ① คอลัมน์ผู้แก้ล่าสุด
alter table public.prod_orders add column if not exists updated_by_name text;
alter table public.prod_orders add column if not exists updated_by_uid  uuid;

-- ② trigger แคบ — เฉพาะการแก้ "ใบที่ปิดแล้ว"
-- 🔴 `create trigger` ขอ ACCESS EXCLUSIVE บนตารางที่หน้างานเขียนอยู่ตลอด ⇒ ค้างรอคิวล็อกได้
--    ตั้ง lock_timeout ให้ล้มเร็วแทนที่จะแขวนไว้ (รอบ 21/10 รันครั้งแรกไม่ตั้ง = timeout 60 วิ)
set lock_timeout = '8s';
drop trigger if exists trg_audit_update_closed on public.prod_orders;
create trigger trg_audit_update_closed
after update on public.prod_orders
for each row
when (
  OLD.status is distinct from 'open'
  and (
       OLD.opened_at    is distinct from NEW.opened_at
    or OLD.confirmed_at is distinct from NEW.confirmed_at
    or OLD.stopped_at   is distinct from NEW.stopped_at
    or OLD.status       is distinct from NEW.status
    or OLD.qty          is distinct from NEW.qty
    or OLD.qty_target   is distinct from NEW.qty_target
    or OLD.qty_actual   is distinct from NEW.qty_actual
    or OLD.qty_ok       is distinct from NEW.qty_ok
  )
)
execute function public.fn_audit();

-- ── ตรวจผล ────────────────────────────────────────────────────────────────────────────────
-- select tgname, pg_get_triggerdef(oid) from pg_trigger
--  where tgrelid = 'public.prod_orders'::regclass and not tgisinternal order by tgname;
-- select column_name from information_schema.columns
--  where table_name = 'prod_orders' and column_name like 'updated_by%';
-- หลังมีคนแก้เวลาจบ 1 ครั้ง:
-- select changed_at, actor, changed_fields, old_data->>'confirmed_at' old_c, new_data->>'confirmed_at' new_c
--   from public.audit_log where table_name = 'prod_orders' and action = 'UPDATE'
--  order by changed_at desc limit 20;

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────────────────
-- drop trigger if exists trg_audit_update_closed on public.prod_orders;
-- -- (คอลัมน์ทิ้งไว้ได้ ไม่มีใครบังคับใช้ · จะถอนจริงต้องเอา 'prod_orders' ออกจาก DR_AUDIT_TABLES ก่อน)
-- -- alter table public.prod_orders drop column if exists updated_by_name;
-- -- alter table public.prod_orders drop column if exists updated_by_uid;
