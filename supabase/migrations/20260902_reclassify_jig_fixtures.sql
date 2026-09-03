-- 📐 จัดชนิดอุปกรณ์: jig/fixture ที่ "ชื่อชัดเจน" machine → jig (DR · 2026-09-02) — ✅ apply แล้ว
--
-- ที่มา: user สั่ง "ยังไม่ปรับจาก machine เป็น jig fixture ให้หรอ ที่ชื่อชัดปรับให้เลย"
-- backfill 2026-08-10 ติดป้ายทั้งตารางเป็น machine/die/facility โดยยังไม่มีแกน jig ใช้งานจริง
-- → จิ๊กบนไลน์เลยค้างเป็น 'machine' ทำให้ทะเบียน /fixture ว่างเปล่า
--
-- ⚠️ ปรับเฉพาะที่ "พิสูจน์ได้จากชื่อ" 2 เกณฑ์ · ที่เหลือให้คนติ๊กเองที่ /fixture แท็บ ⚙️ จัดชนิดอุปกรณ์
--   1) machine_no ขึ้นต้น JHYD / JYD / GPHYD = ระบบเลขจิ๊กของโรงงานเอง
--      (หลักฐาน: ซีรีส์เดียวกัน 53 ตัวถูกตั้งเป็น jig ไปแล้ว เช่น JHYD07-01..10 เป็น jig
--       แต่ JHYD07-11/13/14 ยังค้างเป็น machine — คือตกหล่น ไม่ใช่ตั้งใจ)
--   2) ชื่อ/เลขมีคำว่า JIG เป็นคำเดี่ยว (JIG SLIDELOAD · MARKING JIG · POKA-YOKE JIG)
--
-- ❌ ไม่แตะ (กำกวม — ให้คนตัดสิน): CENTERING HDF1/HDF2 · MARKING E50/B222/C347
--    เพราะมีจิ๊กของตัวเองแยกอยู่แล้ว (JHYD14-03 = "JIG MARKING TUBE E50") แปลว่าตัวที่ชื่อ
--    MARKING เฉยๆ น่าจะเป็น "เครื่องมาร์ค" จริง เดาแล้วผิดจะไปโผล่ผิดทะเบียน
--
-- ตรวจผลกระทบก่อนรัน (2026-09-02) — ไม่มีอะไรพัง:
--   · %A / OEE ไม่ขยับ — parallelUnitsOf fallback นับเครื่องด้วย line_name ไม่ได้กรอง equipment_kind
--     และ DailyReport โหลด machines ด้วย select('*') ไม่กรองชนิด
--   · picker เลือกเครื่อง (DailyReport downtime · MtnRepair · Improvements) กรองแค่ 'die' ออก
--     → จิ๊กพวกนี้ยังเลือกได้ตามปกติ (มี downtime อ้างถึง 837 แถว · ใบซ่อม 5 ใบ ต้องไม่หาย)
--   · prod_orders อ้างถึง 0 แถว · แถวเงา jigs 14 ตัว equipment_type='jig' อยู่แล้วทั้งหมด
--   · ผลที่ตั้งใจ: หายจากลิสต์ default ของ /machine-database (ซึ่งกรอง kind='machine')
--     และจอห้องช่างจะเดาทีมเป็น JIG MTN แทน MTN สำหรับ downtime ที่ยังไม่มีใบซ่อม (ถูกกว่าเดิม)
--
-- Rollback (คืนค่าเดิมตรงแถว):
--   update machines m set equipment_kind = b.old_kind
--     from _reclass_jig_20260902 b where b.id = m.id;
--   update jigs j set equipment_type = b.old_jig_type
--     from _reclass_jig_20260902 b where b.machine_id = j.machine_id and b.old_jig_type is not null;

create table if not exists public._reclass_jig_20260902 (
  id uuid primary key,
  machine_no text,
  machine_name text,
  line_name text,
  old_kind text,
  machine_id uuid,
  old_jig_type text,
  reason text,
  moved_at timestamptz default now()
);

with tgt as (
  select m.id, m.machine_no, m.machine_name, m.line_name, m.equipment_kind,
         case when upper(m.machine_no) ~ '^(JHYD|JYD|GPHYD)'
              then 'เลขซีรีส์จิ๊ก JHYD/JYD/GPHYD'
              else 'ชื่อมีคำว่า JIG' end as reason
  from public.machines m
  where m.is_active
    and coalesce(m.equipment_kind, 'machine') = 'machine'
    and ( upper(m.machine_no) ~ '^(JHYD|JYD|GPHYD)'
       or upper(coalesce(m.machine_no,'') || ' ' || coalesce(m.machine_name,'')) ~ '(^|[^A-Z])JIG([^A-Z]|$)' )
)
insert into public._reclass_jig_20260902 (id, machine_no, machine_name, line_name, old_kind, machine_id, old_jig_type, reason)
select t.id, t.machine_no, t.machine_name, t.line_name, t.equipment_kind, j.machine_id, j.equipment_type, t.reason
from tgt t
left join public.jigs j on j.machine_id = t.id
on conflict (id) do nothing;

-- ตัวตนอุปกรณ์ = แถวเดิมใน machines · เปลี่ยนแค่ "ป้ายชนิด" ไม่ย้ายตาราง ไม่แตะ machine_no
-- (กฎเหล็ก: ชนิดอุปกรณ์เป็นแกน ไม่ใช่ตาราง — MO/downtime/QR/ผังเครื่องจักร อ้างเลขเดิมได้ต่อ)
update public.machines m
   set equipment_kind = 'jig',
       updated_by_name = coalesce(updated_by_name, 'migration 20260902')
  from public._reclass_jig_20260902 b
 where b.id = m.id and coalesce(m.equipment_kind,'machine') = 'machine';

-- ⚠️ แถวเงาใน jigs ต้อง derive จาก machines เสมอ (กฎเหล็ก jigEquipTypeOf) — sync ให้ตรงกัน
update public.jigs j
   set equipment_type = 'jig'
  from public._reclass_jig_20260902 b
 where j.machine_id = b.id and coalesce(j.equipment_type,'') <> 'jig';

-- ตรวจหลังรัน:
-- ผลจริงหลัง apply 2026-09-02: ย้าย 50 ตัว · jig 54 → 104 · machine 241 → 191
--   Line 60 ได้จิ๊ก 11 ตัว · Line 61 ได้ 13 ตัว (ไลน์นำร่อง)
-- select equipment_kind, count(*) from machines where is_active group by 1;
-- select count(*) from machines m join _reclass_jig_20260902 b on b.id=m.id
--  where m.equipment_kind <> 'jig';                                          -- 0
-- select count(*) from jigs j join _reclass_jig_20260902 b on b.id=j.machine_id
--  where j.equipment_type <> 'jig';                                          -- 0
