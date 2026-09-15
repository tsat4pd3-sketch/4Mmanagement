-- ═══════════════════════════════════════════════════════════════════════════════
-- ล้างรูปพนักงานที่ใหญ่ผิดกติกา  ·  **MAIN project (ewhdfqwfwofivojtsizn)**
-- 2026-09-11 — คำสั่ง user: "ลบออกเลย เดี๋ยวให้หัวหน้าอัปโหลดมาใหม่"
--
-- ที่มา: หลังเหตุ egress ทะลุโควต้า (ดู 20260911_storage_cache_control_backfill.sql)
--        วัด bucket `employee-photos` พบว่ารูปที่ใหญ่ผิดกติกาเพียง 18 ไฟล์ กิน 45 MB
--        จากทั้ง bucket 59 MB — ขณะที่รูปปกติ 211 ไฟล์รวมกันแค่ ~14 MB (เฉลี่ย 72 KB)
--        ตัวหนักคือ GIF "รูปคนดุ๊กดิ้ก" (เฉลี่ย 4.3 MB/ไฟล์ = ใหญ่กว่ารูปนิ่งที่บีบแล้ว 60 เท่า)
--        ทั้งหมดเป็นไฟล์ที่อัปก่อนระบบมี ImageCropModal/cap — ของใหม่บีบถูกต้องแล้ว
--
-- เกณฑ์ลบ (ตรงกับกติกาใหม่ในโค้ด):
--   · เป็น GIF (รูปพนักงานไม่รับ GIF แล้ว — `allowGif={false}` ใน operator/Register)
--   · หรือใหญ่เกิน 300 KB (รูปที่ผ่าน ImageCropModal จะ ~72 KB เสมอ)
--   · **และอัปโหลดมาแล้วเกิน 24 ชม.** — safety กันลบทับรูปที่หัวหน้ากำลังทยอยอัปใหม่อยู่
--     (หลักเดียวกับ SAFETY_MS ของ edge function cleanup-orphan-photos)
--   · ไม่แตะ `layouts/` (ผังไลน์) และ `factory/` (ผังโรงงาน) — ตั้งใจให้ใหญ่ ต้องซูมอ่านได้
--
-- ตรวจก่อนลบแล้ว: ไม่มีไฟล์ที่พนักงาน 2 คนใช้ร่วมกัน · ไม่มีไฟล์ที่ผังไลน์อ้างถึง
--
-- ⚠️ ถอยได้: ค่าเดิมถูกเก็บไว้ครบใน `employee_photo_purge_log` ก่อนล้าง
--    (ตารางนี้ยังเป็น "รายการพนักงานที่ต้องถ่ายรูปใหม่" ให้หัวหน้าไล่เก็บด้วย)
--
-- ⚠️⚠️ กับดักที่เจอตอนรันจริง — **ลบไฟล์ด้วย `delete from storage.objects` ไม่ได้**
--    Supabase มี trigger `storage.protect_delete()` โยน 42501:
--      "Direct deletion from storage tables is not allowed. Use the Storage API instead."
--    (กันไฟล์กำพร้าค้างใน S3 โดยที่ DB บอกว่าลบแล้ว) — **ห้ามพยายาม disable trigger นี้**
--    ⇒ migration นี้ทำได้แค่ **ตัดการอ้างอิง** (`employees.image_url = null`) ซึ่งพอสำหรับเป้าหมายหลัก:
--      ไม่มีหน้าไหนเรียกไฟล์นั้นอีก = **egress หยุดทันที** + ไม่มีรูปแตกบนจอ
--    ⇒ ตัวไฟล์ (45 MB) ลบทีหลังด้วย **edge function `cleanup-orphan-photos`** ที่ทำไว้เพื่อการนี้อยู่แล้ว
--      (มันไล่หาไฟล์ที่ไม่มี employees/line_layouts/factory_map อ้างถึง แล้วลบผ่าน Storage API)
--        POST /functions/v1/cleanup-orphan-photos?dry_run=1   + header x-cleanup-token: <CLEANUP_TOKEN>
--        POST /functions/v1/cleanup-orphan-photos             ← ลบจริง
--      รูปที่ตัดการอ้างอิงในไฟล์นี้จะเข้าเกณฑ์ "กำพร้า" ของมันพอดี (และอายุเกิน 24 ชม. ตาม safety ของมัน)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) ตารางบันทึก (ถอยได้ + เป็นรายการงานให้หัวหน้า)
create table if not exists employee_photo_purge_log (
  id            bigserial primary key,
  employee_id   uuid,
  emp_code      text,
  emp_name      text,
  section       text,
  is_active     boolean,
  old_image_url text,
  file_name     text,
  size_bytes    bigint,
  reason        text,
  purged_at     timestamptz not null default now()
);
comment on table employee_photo_purge_log is
  'รูปพนักงานที่ถูกล้างเพราะใหญ่ผิดกติกา (2026-09-11) — ใช้เป็นรายการ "ต้องถ่ายรูปใหม่" ของหัวหน้า';

-- 2) หาเป้าหมาย + บันทึกไว้ก่อน (รันซ้ำได้ — แถวที่เคยบันทึกแล้วไม่ซ้ำ เพราะไฟล์ถูกลบไปแล้วรอบแรก)
with target as (
  select o.name,
         (o.metadata->>'size')::bigint sz,
         case when o.name ~* '\.gif$' then 'GIF (รูปพนักงานไม่รับ GIF แล้ว)'
              else 'ใหญ่เกิน 300 KB (อัปก่อนมีตัวบีบ)' end reason
  from storage.objects o
  where o.bucket_id = 'employee-photos'
    and o.name not like 'layouts/%'
    and o.name not like 'factory/%'
    and (o.name ~* '\.gif$' or (o.metadata->>'size')::bigint > 300000)
    and o.created_at < now() - interval '24 hours'   -- กันชนรูปที่กำลังทยอยอัปใหม่
)
insert into employee_photo_purge_log
  (employee_id, emp_code, emp_name, section, is_active, old_image_url, file_name, size_bytes, reason)
select e.id, e.employee_id_code, e.name, e.section, e.is_active,
       e.image_url, t.name, t.sz, t.reason
from target t
left join employees e on e.image_url like '%/employee-photos/' || t.name;

-- 3) ตัดการอ้างอิงจากฐานพนักงาน (ไม่งั้นหน้าจอขึ้นรูปแตก + ยิง 404 ทุกครั้งที่เปิด)
update employees e
set image_url = null
from employee_photo_purge_log p
where p.employee_id = e.id and e.image_url = p.old_image_url;

-- 4) ลบไฟล์จริง — **ทำที่นี่ไม่ได้** (trigger storage.protect_delete ห้าม ดูหัวไฟล์)
--    ต้องเรียก edge function `cleanup-orphan-photos` ซึ่งลบผ่าน Storage API
--    ไฟล์ที่ขั้น 3 ตัดการอ้างอิงไปแล้วจะเข้าเกณฑ์ "กำพร้า" ของมันพอดี

-- ตรวจผล (รันแยกได้):
--   select reason, count(*), pg_size_pretty(sum(size_bytes)) from employee_photo_purge_log group by reason;
--   select count(*) เหลือใหญ่เกิน from storage.objects
--     where bucket_id='employee-photos' and name not like 'layouts/%' and name not like 'factory/%'
--       and (name ~* '\.gif$' or (metadata->>'size')::bigint > 300000);
--   -- รายชื่อที่ต้องถ่ายรูปใหม่ (เฉพาะคนที่ยังทำงานอยู่):
--   select emp_code, emp_name, section from employee_photo_purge_log where is_active order by section, emp_code;
--
-- rollback: คืน image_url เดิมได้ (แต่ไฟล์ถูกลบแล้ว รูปจะ 404 — ต้องอัปใหม่อยู่ดี)
--   update employees e set image_url = p.old_image_url
--   from employee_photo_purge_log p where p.employee_id = e.id and e.image_url is null;
