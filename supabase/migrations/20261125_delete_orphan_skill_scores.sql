-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 🧹 ลบคะแนนสกิลที่ "ไม่มีชื่อในทะเบียนแล้ว" (Main · MAIN · ewhdfqwfwofivojtsizn)
--    user 25/11: การ์ด Manpower Board ขึ้นสกิลเป็นรหัส (skill_79307a2adb ฯลฯ) —
--    "ถ้าไม่มีจุดงานไหนใช้ และไม่มีการอัพเดทอะไรสะสมเข้ามาแล้ว ลบออกให้ที" → เลือก "ลบทั้ง 22 ตัว"
--
--    ตรวจก่อนลบ (25/11):
--      · 22 รหัส (`employee_skills.skill_name` ที่ไม่มีใน `skill_definitions`) · 96 แถว
--      · ไม่มีจุดงานใช้ (`station_requirements` 0) · หลักฐาน/หัวข้อย่อย 0 · pending_level 0
--      · อัพเดทล่าสุด 23/06/2026 (19 ตัวบันทึกครั้งเดียว 29/05 · 3 ตัวเคยขึ้นขั้นถึง 23/06)
--      · ไม่มีบันทึกการลบ `skill_definitions` ใน audit_log ⇒ กู้ชื่อเดิมไม่ได้
--    ไม่ลบ: `skill_level_up_requests` 15 ใบ (approved) — เก็บเป็นประวัติตามที่ user เลือก
--
--    🔴 ด่านในตัว (ไม่ผ่าน = raise · rollback ทั้งก้อน): จำนวนรหัส/แถวต้องตรงที่ตรวจ ·
--       ห้ามมีจุดงาน/หลักฐาน/หัวข้อย่อยอ้าง · ห้ามมีแถวที่อัพเดทหลัง 23/06/2026
--    สำรอง: archive.employee_skills_orphan_20261125 (ทั้งแถว)
--    ย้อน:
--      insert into public.employee_skills select * from archive.employee_skills_orphan_20261125;
--    ⛔ ห้ามรันซ้ำ (บล็อกด้วย archive table)
--    ✅ apply แล้ว 25/11 ผ่าน MCP (ตรวจกลับ: archive 96 แถว/22 รหัส · เหลือคะแนนไร้ชื่อ 0 · ใบขึ้นขั้น 15 ใบยังอยู่)
-- ═══════════════════════════════════════════════════════════════════════════════════════════

create schema if not exists archive;

do $mig$
declare
  n_codes int; n_rows int; n_req int; n_ev int; n_sub int; n_late int; n_del int;
begin
  if to_regclass('archive.employee_skills_orphan_20261125') is not null then
    raise exception 'รันไปแล้ว (มี archive.employee_skills_orphan_20261125) — ห้ามรันซ้ำ';
  end if;

  create temp table _orph on commit drop as
    select distinct es.skill_name
    from public.employee_skills es
    where not exists (select 1 from public.skill_definitions d where d.name = es.skill_name);

  select count(*) into n_codes from _orph;
  select count(*) into n_rows from public.employee_skills where skill_name in (select skill_name from _orph);
  select count(*) into n_req  from public.station_requirements where skill_name in (select skill_name from _orph);
  select count(*) into n_ev   from public.employee_skill_evidence where skill_name in (select skill_name from _orph);
  select count(*) into n_sub  from public.skill_sub_items where skill_name in (select skill_name from _orph);
  select count(*) into n_late from public.employee_skills
    where skill_name in (select skill_name from _orph) and updated_at >= '2026-06-24';

  if n_codes <> 22 or n_rows <> 96 then
    raise exception 'จำนวนไม่ตรงที่ตรวจ (รหัส % · แถว %) — หยุด ให้ตรวจใหม่', n_codes, n_rows;
  end if;
  if exists (select 1 from _orph where skill_name !~ '^skill_[0-9a-f]{10}$') then
    raise exception 'มีชื่อที่ไม่ใช่รหัส skill_xxxxxxxxxx ปนมา — หยุด';
  end if;
  if n_req + n_ev + n_sub > 0 then
    raise exception 'ยังมีที่อ้างอยู่ (จุดงาน % · หลักฐาน % · หัวข้อย่อย %) — หยุด', n_req, n_ev, n_sub;
  end if;
  if n_late > 0 then
    raise exception 'มีแถวอัพเดทหลัง 23/06/2026 อีก % แถว (ยังสะสมอยู่) — หยุด', n_late;
  end if;

  create table archive.employee_skills_orphan_20261125 as
    select * from public.employee_skills where skill_name in (select skill_name from _orph);

  delete from public.employee_skills where skill_name in (select skill_name from _orph);
  get diagnostics n_del = row_count;
  if n_del <> 96 then
    raise exception 'ลบได้ % แถว ไม่ใช่ 96 — rollback', n_del;
  end if;
end
$mig$;
