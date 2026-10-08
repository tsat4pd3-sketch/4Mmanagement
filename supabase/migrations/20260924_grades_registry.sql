-- ─────────────────────────────────────────────────────────────────────────────
-- 🎓 เกรดพนักงานตามผังองค์กรทางการ TSAT4 — ทะเบียน `grades`      (Main project)
-- 2026-09-24 · ถอดจากแม่แบบ HR `FM-HRM-1-00102 Organization TSAT4 Rev.03`
--             sheet "สายโรงงานระดับส่วน" · ดู docs/modules/org-hierarchy.md §2
--
-- ── ทำไมต้องมี ──────────────────────────────────────────────────────────────
-- `positions.level` (operator/technician/leader/supervisor/manager/staff) ที่ใช้อยู่
-- **เป็นของที่เราคิดขึ้นเอง ไม่ใช่ของบริษัท** — "ระดับพนักงาน" ที่ผังทางการใช้คือ **เกรด**
-- ⇒ ผลิตผังองค์กรทางการไม่ได้ · ตรวจไม่ได้ว่าใครเกรดไม่ตรงตำแหน่ง · ทำ "รักษาการ" ไม่ได้
--
-- ── 🔴 กฎเหล็ก: เลขน้อย = สูงกว่า ภายในตัวอักษรเดียวกัน ──────────────────────
--   หัวหน้าส่วน `S1` **สูงกว่า** หัวหน้าแผนก `S2-S3`
--   พนักงานทั่วไป `T6-T8` **ต่ำกว่า** หัวหน้ากลุ่ม/ช่างเทคนิค `T1-T3`
--   ⇒ **ห้ามเรียงด้วยการ sort ตัวอักษร** — ใช้คอลัมน์ `rank` (มาก = สูง) เท่านั้น
--   ยืนยันจากผังรวม ORG-001: `ส่วน Maintenance … รก.ผู้จัดการ(S1)*`
--     = คนเกรด S1 รักษาการตำแหน่งระดับ M ซึ่ง "สูงกว่าตำแหน่งจริง" (เครื่องหมาย `*`)
--
-- ⚠️ seed เฉพาะเกรดที่ **มีอยู่จริงในเอกสาร** — ไม่มี T4/T5 ในแม่แบบ จึงไม่ใส่
--    (ทะเบียนนี้แก้เพิ่มได้ ไม่ต้องแก้โค้ด · ห้ามเดาเกรดที่เอกสารไม่ได้เขียน)
--
-- ⚠️ **ขั้นนี้ยังไม่มีจอไหนบังคับอะไร** — เพิ่มทะเบียน + ช่องเก็บ + ช่องอนุญาต
--    `employees.grade` ว่างทั้งหมดในวันที่ apply ⇒ ไม่มีตัวเลขไหนขยับ
--
-- ROLLBACK:
--   alter table public.employees  drop column if exists grade;
--   alter table public.positions  drop column if exists grade_codes;
--   drop table if exists public.grades;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.grades (
  code       text primary key,
  band       text not null,               -- ตัวอักษร: VD/D/G/M/S/T/Y
  rank       integer not null,            -- **มาก = สูงกว่า** (ห้าม sort ด้วย code)
  label_th   text not null,               -- ตำแหน่งที่เกรดนี้ใช้ตามแม่แบบ
  is_active  boolean not null default true,
  sort_order integer not null default 0
);

comment on table public.grades is
  'เกรดพนักงานตามผังองค์กรทางการ TSAT4 (FM-HRM-1-00102 Rev.03) — 🔴 เรียงด้วย rank เท่านั้น (เลขในโค้ดน้อย = สูงกว่า เช่น S1 > S3) · อ่านผ่าน src/utils/grades.js';

insert into public.grades (code, band, rank, label_th, sort_order) values
  ('VD', 'VD', 1000, 'ที่ปรึกษา (Advisor)',                     10),
  ('D1', 'D',   930, 'ผู้อำนวยการ',                              20),
  ('D2', 'D',   920, 'ผู้อำนวยการ',                              21),
  ('D3', 'D',   910, 'ผู้อำนวยการ',                              22),
  ('G1', 'G',   830, 'ผู้จัดการทั่วไป / ผู้ชำนาญการพิเศษ',        30),
  ('G2', 'G',   820, 'ผู้จัดการทั่วไป / ผู้ชำนาญการพิเศษ',        31),
  ('G3', 'G',   810, 'ผู้จัดการทั่วไป / ผู้ชำนาญการพิเศษ',        32),
  ('M1', 'M',   730, 'ผู้จัดการ / ผู้ชำนาญการ',                   40),
  ('M2', 'M',   720, 'ผู้จัดการ / ผู้ชำนาญการ',                   41),
  ('M3', 'M',   710, 'ผู้จัดการ / ผู้ชำนาญการ',                   42),
  ('S1', 'S',   630, 'หัวหน้าส่วน · วิศวกรอาวุโส · เจ้าหน้าที่อาวุโส', 50),
  ('S2', 'S',   620, 'หัวหน้าแผนก · วิศวกร · เจ้าหน้าที่',          51),
  ('S3', 'S',   610, 'หัวหน้าแผนก · วิศวกร · เจ้าหน้าที่',          52),
  ('T1', 'T',   530, 'หัวหน้ากลุ่ม · ช่างเทคนิค · พนักงาน',         60),
  ('T2', 'T',   520, 'หัวหน้ากลุ่ม · ช่างเทคนิค · พนักงาน',         61),
  ('T3', 'T',   510, 'หัวหน้ากลุ่ม · ช่างเทคนิค · พนักงาน',         62),
  ('T6', 'T',   430, 'พนักงานทั่วไป',                             70),
  ('T7', 'T',   420, 'พนักงานทั่วไป',                             71),
  ('T8', 'T',   410, 'พนักงานทั่วไป',                             72),
  ('Y1', 'Y',   300, 'พนักงานชั่วคราว',                           80)
on conflict (code) do nothing;

alter table public.employees
  add column if not exists grade text references public.grades(code) on delete set null;
comment on column public.employees.grade is
  'เกรดตามผังองค์กรทางการ (grades.code) — ว่าง = ยังไม่ได้ระบุ · คนละแกนกับ positions.level ที่ระบบคิดเอง';

alter table public.positions
  add column if not exists grade_codes text[];
comment on column public.positions.grade_codes is
  'เกรดที่ตำแหน่งนี้ใช้ได้ตามแม่แบบ HR — null = แม่แบบไม่ได้ระบุ (อย่าเดา) · ใช้เสนอค่า + เตือนเมื่อเกรดไม่ตรงตำแหน่ง **ห้ามบล็อกการบันทึก** (ของจริงมีข้อยกเว้น เช่น รักษาการ)';

-- ตำแหน่งในทะเบียนของเรา ↔ เกรดที่แม่แบบกำหนด (เฉพาะที่จับคู่ได้ชัด — ที่เหลือปล่อย null)
update public.positions set grade_codes = v.codes from (values
  ('g',           array['G1','G2','G3']),
  ('manager',     array['M1','M2','M3']),
  ('section_head',array['S1']),
  ('dept_head',   array['S2','S3']),
  ('engineer',    array['S1','S2','S3']),
  ('officer',     array['S1','S2','S3']),
  ('clerk',       array['S1','S2','S3']),
  ('secretary',   array['S1','S2','S3']),
  ('line_leader', array['T1','T2','T3']),
  ('technician',  array['T1','T2','T3']),
  ('qc',          array['T1','T2','T3']),
  ('operator',    array['T6','T7','T8'])
) as v(key, codes) where public.positions.key = v.key;

alter table public.grades enable row level security;
do $$ begin
  create policy grades_read on public.grades for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy grades_write on public.grades for all to authenticated
    using (public.has_perm('manage_master_data')) with check (public.has_perm('manage_master_data'));
exception when duplicate_object then null; end $$;
