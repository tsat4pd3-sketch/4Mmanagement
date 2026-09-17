-- ─────────────────────────────────────────────────────────────────────────────
-- notifications.link — "กดแล้วไปไหน" ของแจ้งเตือนแต่ละใบ   (Main project)
-- 2026-09-16 · feedback ทีมงานผ่าน user: "กระดิ่งบางอันกดเข้าไปที่ปัญหาได้ บางอันไม่ได้"
--
-- ที่มา (วัดจากฐานจริง 16/09 · 60,272 แถว):
--   · ref_table = null  **6,873 แถว และยังเกิดใหม่ทุกวัน** → กระดิ่งไม่มีลูกศร › กดแล้วแค่ mark อ่าน
--     ก้อนใหญ่สุดคือแจ้งเตือน "สรุป" จาก edge scan: หลุดเฟสงานส่ง 5,433 · เตือนรอบ PM 379 ·
--     ส่งงานลูกค้า 338 · เฝ้าระวังสโตร์ 326 · EDI 156 · แผนประสานงาน PM 131
--     — ทั้งหมดยิงผ่าน notifyInApp() ใน edge `send-notification` ซึ่ง **ไม่เคยส่ง ref_table เลยสักตัว**
--   · 💬 mention ใต้คอมเมนต์ (EventComments) ก็ null → "กล่าวถึงคุณใน ใบซ่อม XXX" แต่กดเข้าใบไม่ได้
--
-- ทำไมไม่ยัด ref_table ให้ครบแทน:
--   1. แจ้งเตือนสรุป **ไม่ได้ผูกกับแถวเดียว** (เฝ้าระวังสโตร์ = 100 รายการ) → ref_table/ref_id จะเป็นคำโกหก
--      และ send-push ใช้ (ref_table, ref_id) เป็น `tag` ของ push ด้วย — ใส่มั่วแล้วการรวม/ทับ push เพี้ยน
--   2. `ref_id` เป็น **uuid** ⇒ ตารางที่ pk เป็น bigint (downtime_logs/defect_logs/skill_level_up_requests)
--      เก็บ id ไม่ได้อยู่แล้ว (เห็นได้จาก ref_id null 3,182 + 1,261 แถว) ⇒ deep-link ต้องพึ่ง link
-- ⇒ `link` = path ปลายทางตรงๆ (เริ่มด้วย / เสมอ) ทำ deep-link ได้ เช่น /mtn-repair?mo=PRO-BM-160926-0375
--
-- ปลอดภัย/ย้อนได้: additive ทั้งหมด (คอลัมน์ nullable + trigger ส่งคีย์เพิ่ม 1 ตัว)
--   rollback: alter table public.notifications drop column link;  แล้ว restore fn_notify_push เวอร์ชันเดิม
--   (โค้ดเก่าไม่รู้จัก link ก็ทำงานเหมือนเดิมเป๊ะ — bell ถอยไปใช้ NOTIF_ROUTE[ref_table] ตามเดิม)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.notifications add column if not exists link text;

comment on column public.notifications.link is
  'ปลายทางในแอปที่กดแล้วไป (path เริ่มด้วย / — ใส่ query ได้ เช่น /mtn-repair?mo=XXX). '
  'ชนะ ref_table เสมอเมื่อมีค่า · ใช้กับแจ้งเตือนสรุปที่ไม่ผูกแถวเดียว และ deep-link ที่ ref_id (uuid) เก็บไม่ได้. '
  'ฝั่งจอ resolve ผ่าน src/utils/notifLink.js เท่านั้น (กัน URL ภายนอก + เช็ค canAccessPage ก่อนเสมอ)';

-- trigger ส่ง link ต่อให้ Web Push ด้วย ไม่งั้นกระดิ่งกับ push พาไปคนละที่
create or replace function public.fn_notify_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object(
      'user_id', NEW.user_id, 'title', NEW.title, 'body', NEW.body,
      'type', NEW.type, 'ref_table', NEW.ref_table, 'ref_id', NEW.ref_id,
      'link', NEW.link
    )
  );
  return NEW;
exception when others then return NEW;
end;
$function$;
