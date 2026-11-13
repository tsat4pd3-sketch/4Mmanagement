-- 🏭 ข้อมูลจากเครื่อง — แยก master เหตุผลให้ตรงต้นทาง (DR "Product DB" · eyhclzkifitbhbljgoav · 2026-11-13)
-- 📄 docs/modules/integration-hub.md §OEE Line D3
-- หลักฐาน: ช่วงหยุด 11:51 JTSRA03-03/04 สถานะ FAULT รหัส 15 — จอ Node-RED เขียน "Alarm · 15 Robot Water Flow Error"
--          (AlarmMaster) แต่ flow เดิม join UnplanMaster ได้ "รอชิ้นงานจาก Store" = ชื่อผิด
-- ⇒ FAULT = Alarm (AlarmMaster) · UNPLANNED (หยุดนอกแผน · oee_shift.unplanned_sec) = UnplanMaster · IDLE = UnplanMaster (user 11/11)
-- additive: ขยาย check เท่านั้น · ย้อน: ท้ายไฟล์ (ต้องไม่มีแถว 'unplanned'/'alarm' ก่อน)

alter table public.machine_state_events drop constraint if exists machine_state_events_state_check;
alter table public.machine_state_events add constraint machine_state_events_state_check
  check (state in ('fault','unplanned','idle','planned_stop','no_plan','comm_loss','other'));

alter table public.machine_reason_map drop constraint if exists machine_reason_map_reason_kind_check;
alter table public.machine_reason_map add constraint machine_reason_map_reason_kind_check
  check (reason_kind in ('onplan','unplan','alarm'));

-- ย้อน:
--   alter table public.machine_state_events drop constraint machine_state_events_state_check;
--   alter table public.machine_state_events add constraint machine_state_events_state_check check (state in ('fault','idle','planned_stop','no_plan','comm_loss','other'));
--   alter table public.machine_reason_map drop constraint machine_reason_map_reason_kind_check;
--   alter table public.machine_reason_map add constraint machine_reason_map_reason_kind_check check (reason_kind in ('onplan','unplan'));
