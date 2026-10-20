/* ══ แยก "หน่วยที่ไม่ใช่ไลน์ผลิต" ออกจากไลน์ผลิต — production_lines.unit_kind ══════════════
   project: Main "MAIN" (ewhdfqwfwofivojtsizn)   · 2026-10-13 · คำสั่ง user

   ที่มา (user 13/10): *"office pd4 เราเห็น user อยากใช้ระบบเช็คชื่อ แต่สร้างเป็นผังออฟฟิส
     ซึ่งไม่ใช่ไลน์ผลิต มันจะทำให้ระบบงง"*

   ปัญหา: ทะเบียน `production_lines` ถูกใช้เป็นที่เก็บ "หน่วยงาน" ทุกชนิด เพราะเป็นทางเดียว
     ที่ผูกคนเข้าระบบเช็คชื่อได้ ⇒ สำนักงาน/งานแก้ไข โผล่ใน dropdown ของจอผลิตทุกจอ
     (แผนผลิต · OEE · LPA · AM · Daily Report) และถูกนับเป็นไลน์ในตัวหาร

   วิธี: ธง `unit_kind` — `production` (ไลน์ผลิตจริง · default) / `support` (หน่วยสนับสนุน)
     · 🔴 **ไม่ลบ ไม่ย้ายตาราง** — คนที่ผูกอยู่ยังเช็คชื่อได้เหมือนเดิม แค่ไม่โผล่ในจอผลิต
     · default = `production` ⇒ แถวเดิมทุกแถวพฤติกรรมไม่เปลี่ยน · โค้ดเก่าที่ไม่รู้จักคอลัมน์นี้ยังทำงานได้
       (backward-compatible — revert โค้ดได้โดยไม่ต้องแตะ schema)

   แถวที่ติดธง = user เลือกเอง 13/10: Office PD4 (7 คน) · Coating (0 คน) · Rework - PD1 (5 คน)
     — `test`/`test child`/`test child 2` user **ไม่ได้เลือก** จึงไม่แตะ

   🔁 rollback (ย้อนได้เต็ม · ไม่มีข้อมูลหาย):
     update public.production_lines set unit_kind = 'production'
      where name in ('Office PD4','Coating','Rework - PD1');
     -- ถอดคอลัมน์ทิ้งไปเลยก็ได้ (ไม่มีตารางอื่นอ้างถึง):
     -- alter table public.production_lines drop column if exists unit_kind;
   ═══════════════════════════════════════════════════════════════════════════════ */

alter table public.production_lines
  add column if not exists unit_kind text not null default 'production';

alter table public.production_lines
  drop constraint if exists production_lines_unit_kind_check;

alter table public.production_lines
  add constraint production_lines_unit_kind_check
  check (unit_kind in ('production', 'support'));

comment on column public.production_lines.unit_kind is
  'production = ไลน์ผลิตจริง (default) · support = หน่วยสนับสนุน (สำนักงาน/งานแก้ไข) — ไม่โผล่ในจอผลิต แต่ยังใช้เช็คชื่อ/ผังองค์กรได้ · กฎอยู่ที่ src/utils/unitKind.js';

update public.production_lines
   set unit_kind = 'support'
 where name in ('Office PD4', 'Coating', 'Rework - PD1')
   and unit_kind is distinct from 'support';
