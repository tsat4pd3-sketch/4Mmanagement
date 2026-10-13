-- RLS รอบ 7 — กลุ่ม "เช็คชื่อ / ตารางกะ" (Main project · ewhdfqwfwofivojtsizn)
-- ⚠️ APPLY แล้วผ่าน MCP 2026-10-12 (ทีละ statement — ดู docs/modules/db-write-rules.md §ขอบเขตของ MCP Supabase)
-- ไฟล์นี้เก็บไว้ให้ session อื่นเห็นประวัติ ไม่ต้องรันซ้ำ
--
-- ปัญหาที่ปิด: 3 ตารางนี้เคยเป็น tier ข (policy เขียนว่า `using(true)` ให้ authenticated ทุกคน)
--   ⇒ ใครที่ login ได้ = แก้ใบเช็คชื่อ/ตารางกะของทั้งโรงงานได้ ทั้งที่ปุ่มบนจอถูก can() กันไว้แล้ว
--   (กฎ db-write-rules ข้อ 3: policy ต้อง has_perm('<คีย์เดียวกับปุ่มบนจอ>') ห้ามเปิดกว้างกว่าปุ่ม)
--
-- ผู้เขียนจริงของแต่ละตาราง (grep ทั้งรีโป + ไล่ DB function + edge function แล้ว):
--   daily_production_logs ← src/pages/Management.jsx:584 (can 'management:assign_manpower')
--                          ← src/pages/Checkin.jsx:610     (can 'checkin:record')
--   shift_schedules       ← src/pages/ShiftOrganize.jsx:307,311 + components/ShiftAutoFillModal.jsx:136
--                          (canEdit ส่งมาจาก ShiftOrganize — คีย์ shift_schedule:edit / :edit_dept)
--   attendances           ← ไม่มีใครเขียน ไม่มีใครอ่าน (ดูท้ายไฟล์)

-- ───────────────────────────────────────────────────────────────────
-- 1) daily_production_logs — INSERT/UPDATE ต้องถือคีย์ใดคีย์หนึ่ง
--    (OR 2 คีย์ เพราะมี 2 จอเขียนตารางเดียวกันคนละเรื่อง: เช็คชื่อรายวัน vs จัดกำลังคน)
--    SELECT ยังเปิดให้ authenticated ทุกคน (จอวิเคราะห์/ภาพรวมหลายหน้าอ่านตารางนี้ — เจตนา)
alter policy "Allow authenticated to insert logs" on public.daily_production_logs
  with check (
    (select public.has_perm('checkin:record'))
    or (select public.has_perm('management:assign_manpower'))
  );

alter policy "Allow authenticated to update logs" on public.daily_production_logs
  using (
    (select public.has_perm('checkin:record'))
    or (select public.has_perm('management:assign_manpower'))
  );

-- ───────────────────────────────────────────────────────────────────
-- 2) shift_schedules — policy เดิมชื่อ auth_all เป็น FOR ALL using(true)
--    🔴 FOR ALL ครอบ SELECT ด้วย ⇒ ถ้ารัดแต่ auth_all จอทุกหน้าที่อ่านตารางกะจะมืดทันที
--    ⇒ ต้อง create policy อ่านแยกก่อน แล้วค่อยรัด auth_all (ลำดับนี้ห้ามสลับ)
create policy shift_schedules_read on public.shift_schedules
  for select to authenticated using (true);

alter policy auth_all on public.shift_schedules
  using (
    (select public.has_perm('shift_schedule:edit'))
    or (select public.has_perm('shift_schedule:edit_dept'))
  )
  with check (
    (select public.has_perm('shift_schedule:edit'))
    or (select public.has_perm('shift_schedule:edit_dept'))
  );

-- ───────────────────────────────────────────────────────────────────
-- 3) attendances — ตารางตาย ❗ ยังไม่แตะ
--    0 แถว · ไม่มีไฟล์ไหนใน src/ อ้างถึง · policy ปัจจุบัน 4 ตัว using(true)/with check(true)
--    ไม่เขียน policy ใหม่ให้ตารางที่ไม่มีใครใช้ (= เดา requirement ของของที่ไม่มีอยู่)
--    ⇒ ข้อเสนอ: drop ทิ้งพร้อม profile_org_access (ตารางตายอีกตัว) ในรอบเก็บกวาด
--    ถ้าวันหนึ่งจะใช้จริง ต้องมาเขียน policy has_perm ก่อนใส่ข้อมูลแถวแรก

-- ───────────────────────────────────────────────────────────────────
-- ผลตรวจจริง (simulated JWT + set local role authenticated · rollback ทั้งก้อนด้วย raise exception)
--   display    อ่าน daily_production_logs 14,830 แถว · แก้ 0 แถว  ✓ (ไม่ถือคีย์ไหนเลย)
--   display    อ่าน shift_schedules 5,194 แถว · แก้ 0 แถว          ✓
--   leader     แก้ daily_production_logs 1 แถว                     ✓ (ถือ checkin:record)
--   qa         แก้ daily_production_logs 0 แถว                     ✓ (ไม่ถือ checkin:record)
--   qa         แก้ shift_schedules 1 แถว                           ✓ (ถือ shift_schedule:edit_dept)
--   supervisor แก้ shift_schedules 1 แถว                           ✓ (ถือ shift_schedule:edit)
--   ไม่มีแถวทดสอบค้าง (ตรวจซ้ำหลัง rollback แล้ว)
--
-- ผู้ถือคีย์ ณ วัน apply (จาก role_permissions):
--   checkin:record             admin, dept_admin, leader, manager, supervisor
--   management:assign_manpower admin, dept_admin, manager, supervisor
--   shift_schedule:edit        admin, dept_admin, document_control, manager, supervisor
--   shift_schedule:edit_dept   11 roles
--
-- ───────────────────────────────────────────────────────────────────
-- ROLLBACK (ย้อนเป็นพฤติกรรมเดิม = เปิดให้ authenticated ทุกคนเขียน)
--   alter policy "Allow authenticated to insert logs" on public.daily_production_logs with check (true);
--   alter policy "Allow authenticated to update logs" on public.daily_production_logs using (true);
--   alter policy auth_all on public.shift_schedules using (true) with check (true);
--   drop policy shift_schedules_read on public.shift_schedules;   -- ลบตัวนี้ทีหลังเสมอ
--   🔴 ลำดับสำคัญ: คืน auth_all ให้ using(true) ก่อน แล้วค่อย drop ตัวอ่าน
--      (drop ก่อน = ช่วงระหว่างนั้นไม่มีใครอ่านตารางกะได้)
