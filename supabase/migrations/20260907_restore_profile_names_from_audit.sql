-- Main project (ewhdfqwfwofivojtsizn)
-- ✅ APPLY แล้ว 2026-09-07 ผ่าน MCP (บันทึกไว้เป็นประวัติ — รันซ้ำไม่มีผล เพราะเงื่อนไข full_name is null)
--
-- กู้ชื่อผู้ใช้ (profiles.full_name) ที่ถูกล้างเป็น null เมื่อ 2026-09-02 15:49:33 (+07)
-- จาก audit_log: แถว 'ชื่อเดิม' → '__hack__' ใน transaction เดียวกัน (49 บัญชี)
-- เติมเฉพาะแถวที่ยังว่างอยู่ — บัญชีที่ user พิมพ์ชื่อใหม่เองไปแล้ว (3–4 ก.ย.) ไม่แตะ
-- ผล: no_name 61 → 0 (ก่อนกู้มี 12 บัญชีที่ว่างมาก่อนเหตุการณ์ และ 24 บัญชีที่ user พิมพ์คืนเอง)

set local app.actor = 'restore-from-audit-2026-09-07';

with batch as (
  select distinct on (row_pk) row_pk, old_data->>'full_name' as orig
  from public.audit_log
  where table_name = 'profiles' and action = 'UPDATE' and changed_fields = array['full_name']
    and changed_at between '2026-09-02 15:49:00+07' and '2026-09-02 15:50:00+07'
    and new_data->>'full_name' = '__hack__'
    and coalesce(old_data->>'full_name', '') not in ('', '__hack__')
  order by row_pk, changed_at
)
update public.profiles p set full_name = b.orig
from batch b
where p.id::text = b.row_pk and (p.full_name is null or btrim(p.full_name) = '');

-- เช็คผล: select count(*) filter (where full_name is null or btrim(full_name)='') as no_name from profiles;  -- ต้องได้ 0
