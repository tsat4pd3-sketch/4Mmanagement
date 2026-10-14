-- RLS รอบ 10 (รอบปิด) — เรียกของหน้าไลน์ · OJT · โพกะโยเกะ · ผังไลน์ · สลับกะ · เคลมลูกค้า · CQI-15
-- Main project (ewhdfqwfwofivojtsizn) · ⚠️ APPLY แล้วผ่าน MCP 2026-10-14 (19 statement ทีละคำสั่ง)
--
-- 🏁 รอบนี้ปิด "ชั้น ข" (เขียนได้ทุกคนที่ล็อกอิน) จบ — เหลือ 11 ตารางที่ **ตั้งใจเปิดหรือไม่มีใครใช้**
--    (รายละเอียดท้ายไฟล์) ⇒ ไม่มีตารางที่ "เผลอเปิด" อีก
--
-- ผู้เขียนจริง (grep ทั้งรีโป + ไล่ DB function แล้ว):
--   wip_replenish_requests     ← LinePartCallPanel.jsx:260,262 · HeijunkaKanban.jsx:1916,1954,1977,1982,2011
--   line_replenish_scan_blocks ← HeijunkaKanban.jsx:1886 (ล็อกเหตุการณ์สแกนถูกบล็อก · best-effort)
--   ojt_trainings / ojt_training_attendees ← OjtTraining.jsx:310,327,331,336,372
--   pokayoke_devices           ← PokaYokeCheck.jsx:136,142       pokayoke_checks ← PokaYokeCheck.jsx:119
--   line_layouts               ← LineSetup.jsx:631 · recompressLayouts.js:168
--   shift_overrides            ← ShiftOrganize.jsx:327,345
--   qa_customer_claims         ← QaClaims.jsx:120,124,161 (รับ canRecord/canManage จาก QualityControl.jsx:1701-2)
--   cqi15_event_logs / _event_approvals / _check_completions ← EventLog.jsx:238,250,1048

-- ── 6 ตารางที่มีแต่ policy `FOR ALL`: สร้าง policy อ่านก่อน (ลำดับนี้สลับไม่ได้) ──
create policy wip_replenish_requests_read on public.wip_replenish_requests for select to authenticated using (true);
create policy ojt_trainings_read          on public.ojt_trainings          for select to authenticated using (true);
create policy ojt_training_attendees_read on public.ojt_training_attendees for select to authenticated using (true);
create policy pokayoke_devices_read       on public.pokayoke_devices       for select to authenticated using (true);
create policy pokayoke_checks_read        on public.pokayoke_checks        for select to authenticated using (true);
create policy line_layouts_read           on public.line_layouts           for select to authenticated using (true);
create policy shift_overrides_read        on public.shift_overrides        for select to authenticated using (true);

-- ── รัดฝั่งเขียน ────────────────────────────────────────────────────────────
-- ใบเรียกของหน้าไลน์: 2 จอคนละบทบาท (ไลน์เรียก · สโตร์จ่าย · หัวหน้า override) ⇒ OR 5 คีย์
alter policy allow_all_wip_replenish_requests on public.wip_replenish_requests
  using ((select public.has_perm('wip_request:decide')) or (select public.has_perm('wip_request:receive'))
      or (select public.has_perm('wip_request:override')) or (select public.has_perm('line_levels:manage'))
      or (select public.has_perm('heijunka:operate')))
  with check ((select public.has_perm('wip_request:decide')) or (select public.has_perm('wip_request:receive'))
      or (select public.has_perm('wip_request:override')) or (select public.has_perm('line_levels:manage'))
      or (select public.has_perm('heijunka:operate')));

alter policy line_replenish_scan_blocks_insert on public.line_replenish_scan_blocks
  with check ((select public.has_perm('heijunka:operate')) or (select public.has_perm('wip_request:override'))
           or (select public.has_perm('wip_request:receive')));

alter policy ojt_trainings_all on public.ojt_trainings
  using ((select public.has_perm('ojt:record')) or (select public.has_perm('ojt:delete')))
  with check ((select public.has_perm('ojt:record')) or (select public.has_perm('ojt:delete')));
alter policy ojt_attendees_all on public.ojt_training_attendees
  using ((select public.has_perm('ojt:record')) or (select public.has_perm('ojt:delete')))
  with check ((select public.has_perm('ojt:record')) or (select public.has_perm('ojt:delete')));

-- โพกะโยเกะ: ทะเบียนอุปกรณ์ = manage · ผลตรวจรายกะ = record หรือ manage (คนละคีย์ตามปุ่มจริง)
alter policy pokayoke_devices_all on public.pokayoke_devices
  using ((select public.has_perm('pokayoke:manage'))) with check ((select public.has_perm('pokayoke:manage')));
alter policy pokayoke_checks_all on public.pokayoke_checks
  using ((select public.has_perm('pokayoke:record')) or (select public.has_perm('pokayoke:manage')))
  with check ((select public.has_perm('pokayoke:record')) or (select public.has_perm('pokayoke:manage')));

alter policy "Allow All on line_layouts" on public.line_layouts
  using ((select public.has_perm('line_setup:edit')) or (select public.has_perm('storage_maintain:run')))
  with check ((select public.has_perm('line_setup:edit')) or (select public.has_perm('storage_maintain:run')));

alter policy auth_all on public.shift_overrides
  using ((select public.has_perm('shift_schedule:edit')) or (select public.has_perm('shift_schedule:edit_dept')))
  with check ((select public.has_perm('shift_schedule:edit')) or (select public.has_perm('shift_schedule:edit_dept')));

alter policy qa_customer_claims_write on public.qa_customer_claims
  using ((select public.has_perm('qa:record')) or (select public.has_perm('qa:manage')))
  with check ((select public.has_perm('qa:record')) or (select public.has_perm('qa:manage')));

-- CQI-15: 🔴 INSERT กับ UPDATE คนละความหมาย ห้ามใช้คีย์เดียว
--   INSERT = แถวอนุมัติ/จุดตรวจถูกสร้าง "พร้อมใบ" ตอน EventLog.jsx:238,250 ⇒ event_log:create
--   UPDATE = การ**อนุมัติจริง** ⇒ คีย์ event_log:approve_<role> (จอเรียกแบบ dynamic ที่ :1028)
alter policy "auth insert event_logs" on public.cqi15_event_logs
  with check ((select public.has_perm('event_log:create')));
alter policy "auth update event_logs" on public.cqi15_event_logs
  using ((select public.has_perm('event_log:create'))
      or (select public.has_perm('event_log:approve_qt')) or (select public.has_perm('event_log:approve_me'))
      or (select public.has_perm('event_log:approve_jme')) or (select public.has_perm('event_log:approve_o')));
alter policy "auth insert event_approvals" on public.cqi15_event_approvals
  with check ((select public.has_perm('event_log:create')));
alter policy "auth update event_approvals" on public.cqi15_event_approvals
  using ((select public.has_perm('event_log:approve_qt')) or (select public.has_perm('event_log:approve_me'))
      or (select public.has_perm('event_log:approve_jme')) or (select public.has_perm('event_log:approve_o')));
alter policy "auth insert check_completions" on public.cqi15_check_completions
  with check ((select public.has_perm('event_log:create')));
alter policy "auth update check_completions" on public.cqi15_check_completions
  using ((select public.has_perm('event_log:approve_qt')) or (select public.has_perm('event_log:approve_me'))
      or (select public.has_perm('event_log:approve_jme')) or (select public.has_perm('event_log:approve_o')));

-- ════════════════════════════════════════════════════════════════════════════
-- ผลตรวจจริง (simulated JWT · rollback ด้วย raise exception · ไม่มีแถวทดสอบค้าง)
--   [engineer] อ่านใบเรียกของ 111 · OJT 31 · โพกะโยเกะ 49 · ผังไลน์ 23 แถว
--              เขียน 0 ทุกตาราง **ยกเว้น shift_overrides = 1** ✅ ถูกต้อง —
--              engineer ถือ `shift_schedule:edit_dept` จริง (คีย์นี้ 11 role ถือ · เท่ากับรอบ 7)
--   [leader]   ใบเรียกของ 1 · OJT 1 · ผลตรวจโพกะโยเกะ 1 · **ทะเบียนอุปกรณ์ 0** (ไม่ถือ pokayoke:manage)
--              · ผังไลน์ 0  ⇒ พิสูจน์ว่าแยก record/manage ได้จริง
--   [manager]  ทะเบียนอุปกรณ์ 1 · ผังไลน์ 1 · สลับกะ 1
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🏁 สรุปชั้น ข หลังรอบ 10 — เหลือ 11 ตาราง **ทุกตัวอยู่ในหมวดที่ตั้งใจ**
--
-- 🔵 เปิดโดยเจตนา — ด่านจริงไม่ใช่ policy (3 ตาราง · ห้ามรัด policy ทับ)
--    notifications (INSERT · 16,057 แถว) — เขียนจาก **8 edge function** (service role ข้าม RLS)
--      + 5 จุดในจอข้ามโมดูล (FeedbackModal · EventComments · NpiTasks · App.jsx · lib/pmNotify)
--      ⇒ **ไม่มีคีย์เดียวครอบได้** · การแจ้งเตือนคนอื่นเป็นผลพลอยได้ของงานปกติ (คอมเมนต์/มอบงาน)
--      · รัดด้วย OR 5 คีย์ที่ไม่เกี่ยวกัน = ไม่ได้แคบลงจริง แต่เสี่ยงพังทุก flow
--    four_m_logs (ALL)        — ด่าน = trigger `protect_four_m_status` + restrictive delete guard (รอบ 6)
--    profiles (INSERT/UPDATE) — ด่าน = trigger `protect_profile_role` (รอบ 5 · คุมคอลัมน์ ซึ่ง policy ทำไม่ได้)
--
-- 📌 ตารางที่ "ไม่มีโค้ดไหนอ้างถึงเลย" (8 ตาราง) — รอ user ตัดสิน ไม่เขียน policy ให้
--    ppe_items (10) · ppe_requirements (0) · ppe_checks (0)  — grep ทั้งรีโป = 0 จุด (จอ PPE ใช้ตารางอื่น)
--    part_registry (4) · part_images (4) — มีแต่ "คีย์ cache" ชื่อเดียวกันในโค้ด
--      (`part_registry:main` / `part_images:v1`) ตัวโหลดจริงอ่าน pe_doc_sets+qa_parts / parts_master+dr_products
--      🔴 **กับดัก: ชื่อตารางไปตรงกับชื่อคีย์ cache ⇒ grep เจอแล้วหลงว่า "มีคนใช้"**
--    attendances (0) · profile_org_access (0) — ตารางตาย เสนอ drop (ตั้งแต่รอบ 7-8)
--    production_shots (0) — เตรียมรับ SCADA (docs/SCADA_REALTIME_DESIGN.md) ยังไม่เปิดใช้
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (คืนพฤติกรรมเดิม = เปิดให้ authenticated ทุกคนเขียน)
--   alter policy allow_all_wip_replenish_requests on public.wip_replenish_requests using (true) with check (true);
--   alter policy line_replenish_scan_blocks_insert on public.line_replenish_scan_blocks with check (true);
--   alter policy ojt_trainings_all  on public.ojt_trainings          using (true) with check (true);
--   alter policy ojt_attendees_all  on public.ojt_training_attendees using (true) with check (true);
--   alter policy pokayoke_devices_all on public.pokayoke_devices     using (true) with check (true);
--   alter policy pokayoke_checks_all  on public.pokayoke_checks      using (true) with check (true);
--   alter policy "Allow All on line_layouts" on public.line_layouts  using (true) with check (true);
--   alter policy auth_all on public.shift_overrides                  using (true) with check (true);
--   alter policy qa_customer_claims_write on public.qa_customer_claims using (true) with check (true);
--   alter policy "auth insert event_logs"        on public.cqi15_event_logs        with check (true);
--   alter policy "auth update event_logs"        on public.cqi15_event_logs        using (true);
--   alter policy "auth insert event_approvals"   on public.cqi15_event_approvals   with check (true);
--   alter policy "auth update event_approvals"   on public.cqi15_event_approvals   using (true);
--   alter policy "auth insert check_completions" on public.cqi15_check_completions with check (true);
--   alter policy "auth update check_completions" on public.cqi15_check_completions using (true);
--   -- 🔴 คืน using(true) ให้ครบ **ก่อน** แล้วค่อย drop policy อ่าน 7 ตัว
--   drop policy wip_replenish_requests_read on public.wip_replenish_requests;
--   drop policy ojt_trainings_read          on public.ojt_trainings;
--   drop policy ojt_training_attendees_read on public.ojt_training_attendees;
--   drop policy pokayoke_devices_read       on public.pokayoke_devices;
--   drop policy pokayoke_checks_read        on public.pokayoke_checks;
--   drop policy line_layouts_read           on public.line_layouts;
--   drop policy shift_overrides_read        on public.shift_overrides;
-- ════════════════════════════════════════════════════════════════════════════
