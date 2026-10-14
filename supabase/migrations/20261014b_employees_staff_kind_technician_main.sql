/* ══ staff_kind: เพิ่มกลุ่มที่ 3 "technician" (ช่าง) ═══════════════════════════════════════
   project: Main "MAIN" (ewhdfqwfwofivojtsizn)   · 2026-10-14 · คำสั่ง user

   ที่มา: *"ช่าง วิศวกร ธุรการ หัวหน้าแผนก … มาขึ้นปนกับพนักงานหน้างานหมด อยากให้แยกออกจากกัน"*

   เดิมมี 2 ค่า ⇒ จะให้ช่าง/สายสนับสนุน "เช็คชื่อได้" ก็ต้องยอมให้ถูกนับเป็นกำลังคนไลน์ไปด้วย
   ⇒ แยกเป็น 3 กลุ่ม + ฝั่งโค้ดแยกเป็น **2 แกน** (`src/utils/staffKind.js`):
     · shopfloor  — เช็คชื่อ ✅ · นับกำลังคนไลน์ ✅
     · technician — เช็คชื่อ ✅ · นับกำลังคนไลน์ ❌  (ช่างประจำไลน์อยู่ที่ `line_technicians`)
     · support    — เช็คชื่อ ✅ · นับกำลังคนไลน์ ❌

   🔴 migration นี้ **ไม่ย้ายใครเลย** — แค่เปิดให้ค่าใหม่เขียนได้
      การย้ายคน (backfill) แยกเป็นอีกไฟล์ หลัง user ยืนยันรายชื่อ
      ⇒ apply ไฟล์นี้แล้ว **พฤติกรรมระบบไม่เปลี่ยนแม้แต่จุดเดียว** (ยังไม่มีแถวไหนเป็น technician)

   ค่าเก่า direct/indirect ยังรับไว้เหมือนเดิม (แท็บเก่าช่วง deploy เขียนได้ · ฝั่งโค้ด normalize ให้)

   🔁 rollback (ย้อนได้ ถ้ายังไม่มีแถวไหนใช้ค่าใหม่):
     alter table public.employees drop constraint if exists employees_staff_kind_chk;
     alter table public.employees add constraint employees_staff_kind_chk
       check (staff_kind = any (array['shopfloor','support','direct','indirect']));
     -- มีแถวเป็น technician แล้ว ⇒ ย้ายกลับก่อน:
     -- update public.employees set staff_kind='shopfloor' where staff_kind='technician';
   ═══════════════════════════════════════════════════════════════════════════════ */

alter table public.employees drop constraint if exists employees_staff_kind_chk;

alter table public.employees add constraint employees_staff_kind_chk
  check (staff_kind = any (array['shopfloor'::text, 'technician'::text, 'support'::text,
                                 'direct'::text, 'indirect'::text]));

comment on column public.employees.staff_kind is
  'shopfloor (default · นับกำลังคนไลน์) / technician (ช่าง · เช็คชื่อได้ ไม่นับกำลังคน) / support (สายสนับสนุน · เช็คชื่อได้ ไม่นับกำลังคน) · direct/indirect = ค่าเก่าก่อน 23/09 · กฎอยู่ที่ src/utils/staffKind.js';
