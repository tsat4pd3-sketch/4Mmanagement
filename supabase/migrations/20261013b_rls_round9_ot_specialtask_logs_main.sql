-- RLS รอบ 9 — OT / งานนอกไลน์ / ประวัติย้ายจุดงาน / ทะเบียนเล็ก (Main · ewhdfqwfwofivojtsizn)
-- ⚠️ APPLY แล้วผ่าน MCP 2026-10-13 (ทีละ statement · 14 คำสั่ง) — ไฟล์นี้เก็บประวัติ ไม่ต้องรันซ้ำ
--
-- ผู้เขียนจริง (grep ทั้งรีโป + ไล่ DB function แล้ว):
--   ot_night_bookings       ← Checkin.jsx:642,675,862 (upsert)      → checkin:record
--   line_helpers            ← Checkin.jsx:535,585                   → checkin:record
--   operator_special_tasks  ← Management.jsx:640,975,986            → management:assign_special_task
--   station_assignment_logs ← Management.jsx:620 (insert เท่านั้น)   → management:assign_manpower
--   special_task_types      ← Report.jsx:558 <SimpleNameMaster>     → ot_master:manage
--   leave_types             ← Report.jsx:560 <SimpleNameMaster>     → ot_master:manage
--   (2 ตัวท้ายไม่มี `from('<table>').insert` ตรงๆ เพราะ SimpleNameMaster รับชื่อตารางเป็น prop
--    — grep หาแค่ `from('leave_types').insert` จะไม่เจอ ต้อง grep ชื่อตารางเปล่าๆ ด้วย)
--
-- ✅ ตรวจแล้วว่าฝั่ง DB ไม่มีตัวเขียนที่จะพัง: มีแค่ fn_line_helpers_snapshot_names (SECURITY DEFINER
--    ⇒ ไม่ผ่าน RLS) ไม่มี view/FK ลูกของตารางกลุ่มนี้

-- ── 2 ตารางที่มี policy อ่านแยกอยู่แล้ว: รัดเฉพาะ write ──────────────────────
alter policy "Allow authenticated insert" on public.ot_night_bookings
  with check ((select public.has_perm('checkin:record')));
alter policy "Allow authenticated update" on public.ot_night_bookings
  using ((select public.has_perm('checkin:record')));
alter policy "Allow authenticated delete" on public.ot_night_bookings
  using ((select public.has_perm('checkin:record')));

alter policy "authenticated insert special tasks" on public.operator_special_tasks
  with check ((select public.has_perm('management:assign_special_task')));
alter policy "authenticated update special tasks" on public.operator_special_tasks
  using ((select public.has_perm('management:assign_special_task')));
alter policy "authenticated delete special tasks" on public.operator_special_tasks
  using ((select public.has_perm('management:assign_special_task')));

-- ── 4 ตารางที่มีแต่ policy `FOR ALL`: 🔴 สร้าง policy อ่านก่อน แล้วค่อยรัด ───
--    `FOR ALL` ครอบ SELECT ด้วย — สลับลำดับ = จอที่อ่านตารางพวกนี้มืดทันที
--    (รอบ 7 shift_schedules · รอบ 8 workstations ก็เคสเดียวกัน — นี่คือรูปแบบประจำ ไม่ใช่เหตุบังเอิญ)
create policy station_assignment_logs_read on public.station_assignment_logs for select to authenticated using (true);
create policy line_helpers_read           on public.line_helpers            for select to authenticated using (true);
create policy special_task_types_read     on public.special_task_types      for select to authenticated using (true);
create policy leave_types_read            on public.leave_types             for select to authenticated using (true);

-- station_assignment_logs = "ประวัติ" — มีแต่ insert จากจอ ไม่มีใคร update/delete
--   ⇒ รัดทั้ง ALL ด้วยคีย์ของคนที่ย้ายจุดงานได้ (เท่ากับคนที่ทำให้เกิดแถว)
alter policy app_all on public.station_assignment_logs
  using ((select public.has_perm('management:assign_manpower')))
  with check ((select public.has_perm('management:assign_manpower')));

alter policy line_helpers_all on public.line_helpers
  using ((select public.has_perm('checkin:record')))
  with check ((select public.has_perm('checkin:record')));

alter policy special_task_types_all on public.special_task_types
  using ((select public.has_perm('ot_master:manage')))
  with check ((select public.has_perm('ot_master:manage')));

alter policy leave_types_all on public.leave_types
  using ((select public.has_perm('ot_master:manage')))
  with check ((select public.has_perm('ot_master:manage')));

-- ════════════════════════════════════════════════════════════════════════════
-- ผลตรวจจริง (simulated JWT · rollback ด้วย raise exception · ไม่มีแถวทดสอบค้าง)
--   [engineer]  ไม่ถือคีย์ไหนเลย → อ่าน OT 3,561 / ประวัติย้ายจุด 9,158 / คนช่วยไลน์ 41 /
--               ประเภทลา 4 แถว · **เขียน 0 ทั้ง 6 ตาราง**                                  ✓
--   [leader]    ถือ checkin:record + assign_special_task →
--               OT 1 · คนช่วย 1 · งานพิเศษ 1 · ประวัติย้ายจุด 0 · ทะเบียนลา 0              ✓
--               (คู่นี้พิสูจน์ว่าแยกตามคีย์จริง ไม่ใช่ "ล็อกอินหรือยัง")
--   [manager]   ถือครบ → ประวัติ 1 · ทะเบียนลา 1 · ทะเบียนงานพิเศษ 1                       ✓
--
-- ผู้ถือคีย์จริง (กรอง allowed=true · admin ผ่านทุกคีย์โดย has_perm):
--   checkin:record                 dept_admin, leader, manager, supervisor
--   management:assign_special_task dept_admin, leader, manager, supervisor
--   management:assign_manpower     dept_admin, manager, supervisor
--   ot_master:manage               dept_admin, manager, supervisor
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (คืนพฤติกรรมเดิม = เปิดให้ authenticated ทุกคนเขียน)
--   alter policy "Allow authenticated insert" on public.ot_night_bookings with check (true);
--   alter policy "Allow authenticated update" on public.ot_night_bookings using (true);
--   alter policy "Allow authenticated delete" on public.ot_night_bookings using (true);
--   alter policy "authenticated insert special tasks" on public.operator_special_tasks with check (true);
--   alter policy "authenticated update special tasks" on public.operator_special_tasks using (true);
--   alter policy "authenticated delete special tasks" on public.operator_special_tasks using (true);
--   alter policy app_all               on public.station_assignment_logs using (true) with check (true);
--   alter policy line_helpers_all      on public.line_helpers            using (true) with check (true);
--   alter policy special_task_types_all on public.special_task_types     using (true) with check (true);
--   alter policy leave_types_all       on public.leave_types             using (true) with check (true);
--   -- 🔴 คืน using(true) ให้ครบ **ก่อน** แล้วค่อย drop policy อ่าน
--   drop policy station_assignment_logs_read on public.station_assignment_logs;
--   drop policy line_helpers_read           on public.line_helpers;
--   drop policy special_task_types_read     on public.special_task_types;
--   drop policy leave_types_read            on public.leave_types;
-- ════════════════════════════════════════════════════════════════════════════
