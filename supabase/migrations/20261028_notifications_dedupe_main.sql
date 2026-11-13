-- ════════════════════════════════════════════════════════════════════════════
-- กันแจ้งเตือนซ้ำที่ชั้น DB — Main project (ewhdfqwfwofivojtsizn)   2026-10-28
--
-- เคสจริง 26/10/2026: ตาราง notifications โตวันเดียว **44,570 แถว (12 MB)**
--   = 75% ของทั้งตาราง · ทั้งที่วันนั้นมีใบ 4M แค่ 49 ใบ
--   เจาะดูใบเดียว (e7c3706f…): สถานะ `pending` ได้ **316 แถว / ผู้รับ 79 คน = คนละ 4 ใบ
--   ภายใน 16 วินาที** (03:49:08 → 03:49:24)  ส่วน `pending_qa` กับ `approved` ได้คนละ 1 ใบ (ถูกต้อง)
--   ⇒ edge `send-notification` ถูก invoke **4 รอบ** ด้วยเหตุการณ์เดียวกันจากฝั่งจอ
--     ตัว edge ยุบผู้รับซ้ำ "ภายในรอบเดียว" ได้อยู่แล้ว แต่ข้ามรอบมันไม่รู้เรื่องกัน
--
-- 🔴 ทำไมต้องกันที่ชั้น DB ไม่ใช่แค่แก้ใน edge:
--    คนเขียน notifications มีหลายทาง (edge 10 ตัว + จอหลายหน้า + trigger)
--    กันที่ปลายทางจุดเดียว = ทุกทางได้ผลเหมือนกัน และทางใหม่ในอนาคตได้ฟรี
--
-- กติกา: แถวที่ (user_id, ref_table, ref_id, title) ซ้ำกับของเดิม **ภายใน 10 นาที** = ไม่เขียน
--  · `title` อยู่ในคีย์ด้วย — title มีชื่อสถานะในตัว ⇒ เปลี่ยนสถานะจริง (pending → pending_qa
--    → approved) ยังได้แจ้งเตือนครบทุกขั้น · ที่ถูกตัดคือ "เรื่องเดิม สถานะเดิม" เท่านั้น
--  · ใบที่ไม่มี ref_table/ref_id (แจ้งเตือนลอยๆ) = ไม่แตะ ปล่อยผ่านเหมือนเดิม
--  · ต้องทำงาน **ก่อน** trg_notification_rollup (ชื่อ 'dedupe' < 'fill_link' < 'rollup'
--    ⇒ BEFORE INSERT เรียงตามชื่อ ได้ลำดับที่ต้องการพอดี) ไม่งั้นตัวยุบจะไปนับใบซ้ำเข้า rollup_count
--
-- ย้อนกลับ: drop trigger trg_notification_dedupe on public.notifications;
--           (ของเดิมไม่ถูกแตะเลย — ตัวนี้เป็นด่านเพิ่ม ไม่ได้แก้พฤติกรรมอื่น)
-- ════════════════════════════════════════════════════════════════════════════

-- ดัชนีให้ด่านนี้ไม่เป็นภาระตอนพายุ (ตอนซ้ำเยอะ user คนเดียวมีหลายใบในหน้าต่างเดียว)
create index if not exists idx_notifications_dedupe
  on public.notifications (user_id, ref_table, ref_id, created_at desc);

create or replace function public.fn_notification_dedupe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dup boolean;
begin
  -- ไม่มีตัวอ้างอิง = ตัดสินไม่ได้ว่าซ้ำ ⇒ ปล่อยผ่าน (ห้ามเดา)
  if new.user_id is null or new.ref_table is null or new.ref_id is null or new.title is null then
    return new;
  end if;

  select exists (
    select 1 from public.notifications n
     where n.user_id   = new.user_id
       and n.ref_table = new.ref_table
       and n.ref_id    = new.ref_id
       and n.title     = new.title
       and n.created_at > now() - interval '10 minutes'
  ) into v_dup;

  if v_dup then
    return null;   -- ซ้ำ = ไม่เขียนแถวนี้ (ของเดิมที่คนยังไม่ได้อ่านยังอยู่ครบ)
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_notification_dedupe on public.notifications;
create trigger trg_notification_dedupe
  before insert on public.notifications
  for each row execute function public.fn_notification_dedupe();
