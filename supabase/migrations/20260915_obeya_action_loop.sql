-- ══ Main project — "MAIN" (ewhdfqwfwofivojtsizn) ════════════════════════════════════
-- 🏛️ OBEYA เฟส 1 — ทำ "ลูปปิด countermeasure" ให้เดินได้ก่อน (docs/OBEYA-DESIGN.md §6)
--
-- ที่มา: `meeting_action_items` มี **0 แถว** ตั้งแต่สร้าง 13/07 ทั้งที่ downtime ถูกกรอก 8,627 แถว
--        และใบ 4M 1,213 ใบในช่วงเดียวกัน ⇒ ระบบเก็บ "สิ่งที่เกิดขึ้น" ได้ดี
--        แต่ "สิ่งที่ตัดสินใจจะทำ" ยังอยู่นอกระบบ (ในหัวหัวหน้า / ไลน์แชท / กระดาษ)
--        → ตามงานไม่ได้ · พิสูจน์ไม่ได้ว่าแก้แล้วดีขึ้นจริง
--
-- migration นี้ทำ 3 อย่าง (backward-compatible ทั้งหมด — /morning-meeting เดิมไม่ต้องแก้):
--   1) เพิ่ม 4 คอลัมน์ให้ action item ผูกกับ "ตัวเลขที่มันจะไปแก้"
--   2) สิทธิ์ page:/obeya (ทุก role ดูได้ — จอ TV) + obeya:record (leader ขึ้นไป)
--   3) 🔴 แก้ RLS จาก using(true) → has_perm() ตามกฎเหล็ก DB ข้อ 3 ใน CLAUDE.md
-- ปลอดภัยต่อการรันซ้ำ (if not exists / on conflict do nothing)

-- ── 1) คอลัมน์ใหม่ ────────────────────────────────────────────────────────────────
-- ทั้ง 4 ตัวเป็น nullable ไม่มี default ⇒ แถวเดิม (ถ้ามี) และโค้ดเดิมที่ไม่รู้จักคอลัมน์ ยังทำงานเหมือนเดิม
alter table meeting_action_items
  add column if not exists source       text,   -- 'morning' | 'obeya' | null(=เดิม) — ใบนี้ตั้งจากที่ประชุมไหน
  add column if not exists kpi_key      text,   -- แกน/ตัวชี้วัดที่ใบนี้จะไปแก้: 'S'|'Q'|'D'|'C'|'M'|'OEE'
  add column if not exists target_value numeric, -- เป้าที่ตกลงกันในที่ประชุม (ค่าที่อยากให้เป็น)
  add column if not exists result_value numeric; -- ผลจริงตอนปิดใบ — มีทั้งคู่ถึงจะพิสูจน์ได้ว่า "แก้แล้วดีขึ้นจริง"

comment on column meeting_action_items.source       is 'ที่ประชุมต้นทาง: morning (ประชุมแถวเช้า) | obeya (ห้องบัญชาการ)';
comment on column meeting_action_items.kpi_key      is 'แกน SQDCM/OEE ที่ใบนี้จะไปแก้ — ค่าที่รับได้อยู่ใน src/utils/obeyaKpi.js (OBEYA_AXES)';
comment on column meeting_action_items.target_value is 'ค่าเป้าที่ตกลงกันในที่ประชุม';
comment on column meeting_action_items.result_value is 'ค่าจริงตอนปิดใบ — คู่กับ target_value ใช้วัดว่า countermeasure ได้ผลไหม';

-- ⚠️ ไม่ใส่ check constraint กับ kpi_key ตั้งใจ: แกนอาจเพิ่มทีหลัง (เช่น E ด้านพลังงาน)
--    การเพิ่มแกนไม่ควรต้องรอ migration — client เป็นคนคุมตัวเลือกผ่าน OBEYA_AXES
--    (บทเรียน process_types / line_type: hardcode รายการไว้ใน DB แล้วต้องตาม migration ทุกครั้ง)

-- ใบที่ยังไม่ปิด = สิ่งที่ห้องประชุมต้องเห็นก่อนเพื่อน → index เฉพาะใบเป็นๆ (partial ⇒ เล็กและเร็ว)
create index if not exists idx_meeting_action_items_live
  on meeting_action_items (due_date) where status in ('open', 'doing');
create index if not exists idx_meeting_action_items_kpi
  on meeting_action_items (kpi_key) where kpi_key is not null;

-- ── 2) สิทธิ์ ─────────────────────────────────────────────────────────────────────
-- หน้า /obeya: ทุก role ดูได้ (จอแขวนในห้อง Obeya ต้องเปิดได้ด้วยบัญชี display)
insert into role_permissions (role, permission_key, allowed)
select r.role, 'page:/obeya', true
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;

-- ตั้ง/ปิด action item จากห้อง Obeya: leader ขึ้นไป (ชุดเดียวกับ morning_meeting:record)
insert into permission_catalog (resource, action, label, group_name, sort)
values ('obeya', 'record', 'ตั้ง/ปิด Action Item ในห้อง OBEYA', 'ฝ่ายผลิต', 206)
on conflict (resource, action) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r.role, 'obeya:record',
       r.role in ('admin'::user_role, 'manager'::user_role, 'supervisor'::user_role, 'leader'::user_role)
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;

-- ── 3) 🔴 RLS ให้ตรงกับปุ่มบนจอ ───────────────────────────────────────────────────
-- เดิม: for all to authenticated using (true) with check (true)
--       = ใครก็ตามที่ login เขียนได้หมด แม้ /permissions จะปิดปุ่มให้ role นั้นแล้ว
--       (policy เดิมเขียนคอมเมนต์ไว้เองว่า "Phase 3 ค่อยย้ายเป็น has_perm" — ตอนนี้คือ Phase 3)
-- ⚠️ วัดผลกระทบก่อนเปลี่ยน: ตารางนี้มี 0 แถว และมีทางเขียนอยู่ทางเดียวคือปุ่มใน /morning-meeting
--    ซึ่ง client gate ด้วย can('morning_meeting','record') อยู่แล้ว ⇒ คนที่เคยกดได้ ยังกดได้เหมือนเดิม
-- SELECT ยังเปิดให้ทุกคนที่ login เหมือนเดิม (จอ TV/ผู้บริหารต้องอ่านได้ · scope กรองที่ client)
drop policy if exists meeting_action_items_select on meeting_action_items;
create policy meeting_action_items_select on meeting_action_items
  for select to authenticated using (true);

-- ⚠️ ต้องแยกครบทั้ง insert/update/delete — `for all` ตัวเดียวเคยทำให้ upsert พังมาแล้ว
--    (กฎเหล็ก DB ข้อ 3: ตารางใหม่ต้องมี policy ครบทุก cmd ที่ client ใช้)
drop policy if exists meeting_action_items_write on meeting_action_items;

drop policy if exists meeting_action_items_insert on meeting_action_items;
create policy meeting_action_items_insert on meeting_action_items
  for insert to authenticated
  with check (has_perm('morning_meeting:record') or has_perm('obeya:record'));

drop policy if exists meeting_action_items_update on meeting_action_items;
create policy meeting_action_items_update on meeting_action_items
  for update to authenticated
  using      (has_perm('morning_meeting:record') or has_perm('obeya:record'))
  with check (has_perm('morning_meeting:record') or has_perm('obeya:record'));

drop policy if exists meeting_action_items_delete on meeting_action_items;
create policy meeting_action_items_delete on meeting_action_items
  for delete to authenticated
  using (has_perm('morning_meeting:record') or has_perm('obeya:record'));

-- ══ ROLLBACK ═══════════════════════════════════════════════════════════════════════
-- ย้อนได้ทั้งก้อน (ข้อมูลไม่หาย — คอลัมน์ใหม่ปล่อยค้างไว้ได้ ไม่มีใครบังคับใช้):
--   drop policy if exists meeting_action_items_insert on meeting_action_items;
--   drop policy if exists meeting_action_items_update on meeting_action_items;
--   drop policy if exists meeting_action_items_delete on meeting_action_items;
--   create policy meeting_action_items_write on meeting_action_items
--     for all to authenticated using (true) with check (true);
--   delete from role_permissions where permission_key in ('page:/obeya', 'obeya:record');
--   delete from permission_catalog where resource = 'obeya' and action = 'record';
-- (ถ้าจะถอนคอลัมน์ด้วย — ต้องถอนโค้ดหน้า /obeya ก่อน:
--   alter table meeting_action_items drop column if exists source, drop column if exists kpi_key,
--     drop column if exists target_value, drop column if exists result_value;)
