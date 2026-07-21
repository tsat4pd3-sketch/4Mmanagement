-- 2026-07-21 · Main project (ewhdfqwfwofivojtsizn)
-- ShiftOrganize: ไลน์ลูก inherit กะจากไลน์แม่อัตโนมัติ ยกเว้นแก้ manual
-- is_manual = true → ไลน์ลูกตั้งกะเอง ไม่ตามไลน์แม่ (parent swap ไม่ override)
-- default false → ทุกแถวเดิมถือว่า "ตามไลน์แม่" (ไลน์ลูกวิ่งตามไลน์แม่)
alter table shift_schedules add column if not exists is_manual boolean not null default false;
